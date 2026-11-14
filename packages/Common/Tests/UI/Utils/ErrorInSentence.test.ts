import {
  errorInSentence,
  getErrorInSentenceText,
  getErrorInSentenceWords,
  getPageErrorReader,
  setPageErrorReader,
  ErrorInSentenceWords,
} from "../../../UI/Utils/ErrorInSentence";
import {
  getErrorReader,
  registerPageErrorReader,
} from "../../../UI/Utils/ErrorReader";
import API from "../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import NewVersion, {
  NewVersionAudience,
} from "../../../UI/Utils/NewVersion/NewVersion";
import User from "../../../UI/Utils/User";
import {
  getUnexplainedServerErrorMessage,
  SERVER_DOWN_MESSAGE,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorKind,
  UnexplainedErrorReader,
  UnexplainedErrorWords,
} from "../../../Types/Exception/UnexplainedError";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  Translator,
} from "../../../Types/Translator";
import {
  getMonitorTypeMismatchRefusal,
  MONITOR_TYPE_MISMATCH_REFUSAL,
} from "../../../Utils/Monitor/MonitorTemplateLinkRefusal";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AN ERROR INSIDE A CARD'S OWN SENTENCE (#7307), as words.
 *
 * getErrorInSentenceWords says an error nobody explained - a gateway's 502
 * or 504 (SERVER_DOWN_MESSAGE), a server failure with or without its
 * reference, OneUptime unreachable, the page failing - as why it failed and
 * what to do next in the sentence's language, the reference apart; any
 * other message is looked up and otherwise kept as written. errorInSentence
 * is the same words as a template value, composed in the language the
 * sentence comes out in. Read here through the Dashboard's own locale files.
 */

const mockConfig: { billingEnabled: boolean } = { billingEnabled: false };

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return mockConfig.billingEnabled;
    },
  });

  return mockedConfig;
});

const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);
const REFERENCE: string = "a1b2c3d4";

const SELF_HOSTED_ADMIN: UnexplainedErrorReader = {
  isCloud: false,
  isMasterAdmin: true,
};
const SELF_HOSTED_MEMBER: UnexplainedErrorReader = {
  isCloud: false,
  isMasterAdmin: false,
};
const CLOUD_MEMBER: UnexplainedErrorReader = {
  isCloud: true,
  isMasterAdmin: false,
};
const VISITOR: UnexplainedErrorReader = {
  isCloud: true,
  isMasterAdmin: false,
  isVisitor: true,
};

const wordsOf: (
  message: string | null | undefined,
  reader?: UnexplainedErrorReader,
  translator?: Translator,
) => ErrorInSentenceWords = (
  message: string | null | undefined,
  reader: UnexplainedErrorReader = SELF_HOSTED_MEMBER,
  translator: Translator = ENGLISH,
): ErrorInSentenceWords => {
  return getErrorInSentenceWords({
    message: message,
    translator: translator,
    reader: reader,
  });
};

describe("a message somebody put into words is the message", () => {
  test("as written, in English", () => {
    expect(wordsOf("Monitor not found.")).toEqual({
      isUnexplained: false,
      text: "Monitor not found.",
    });
  });

  test("in the reader's language when the Dashboard has words for it, as written otherwise", () => {
    const de: Translator = dashboardTranslator("de");
    const keyed: string = "Something went wrong. Please try again.";
    const translated: string | undefined = readDashboardLocale("de")[keyed];

    expect(translated).toBeTruthy();
    expect(translated).not.toBe(keyed);
    expect(wordsOf(keyed, SELF_HOSTED_MEMBER, de)).toEqual({
      isUnexplained: false,
      text: translated,
    });
    expect(
      wordsOf("ClickHouse is down: connection refused", SELF_HOSTED_MEMBER, de),
    ).toEqual({
      isUnexplained: false,
      text: "ClickHouse is down: connection refused",
    });
  });

  test("no message at all is no words", () => {
    expect(wordsOf(undefined)).toEqual({ isUnexplained: false, text: "" });
    expect(wordsOf(null)).toEqual({ isUnexplained: false, text: "" });
    expect(wordsOf("")).toEqual({ isUnexplained: false, text: "" });
  });
});

describe("a refusal of the server's with values in it is said in the reader's language, with its values (#7678)", () => {
  const MISMATCH: string = getMonitorTypeMismatchRefusal({
    monitorType: "Incoming Request",
    templateType: "SSL Certificate",
  });

  // The language's sentence, with its own words for the two types.
  const mismatchIn: (language: string) => string = (
    language: string,
  ): string => {
    const words: Record<string, string> = readDashboardLocale(language);

    return (words[MONITOR_TYPE_MISMATCH_REFUSAL.template] as string)
      .split("{{monitorType}}")
      .join(words["Incoming Request"] as string)
      .split("{{templateType}}")
      .join(words["SSL Certificate"] as string);
  };

  test("in English, as the server wrote it", () => {
    expect(wordsOf(MISMATCH)).toEqual({ isUnexplained: false, text: MISMATCH });
  });

  test("in German, the types in German too", () => {
    expect(
      getErrorInSentenceText({
        message: MISMATCH,
        translator: dashboardTranslator("de"),
      }),
    ).toBe(
      "Dieser Monitor hat den Typ Eingehende Anfrage, diese Vorlage den Typ SSL-Zertifikat. Nur Monitore vom Typ der Vorlage können mit ihr verknüpft werden.",
    );
  });

  test.each(["fa", "ja", "ar", "hi"])(
    "in %s, the types in that language too",
    (language: string) => {
      const said: string = getErrorInSentenceText({
        message: MISMATCH,
        translator: dashboardTranslator(language),
      });

      expect(said).toBe(mismatchIn(language));
      expect(said).not.toContain("Incoming Request");
    },
  );

  test("in a language with no wording of the sentence, in English", () => {
    const withoutTheSentence: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === MONITOR_TYPE_MISMATCH_REFUSAL.template
          ? undefined
          : readDashboardLocale("de")[text];
      },
      "de",
    );

    expect(
      getErrorInSentenceText({
        message: MISMATCH,
        translator: withoutTheSentence,
      }),
    ).toBe(MISMATCH);
  });
});

describe("a gateway's 502 or 504 says the server did not answer, and to try again in a few minutes", () => {
  test("in English: never SERVER_DOWN_MESSAGE, word for word or in part", () => {
    const words: ErrorInSentenceWords = wordsOf(SERVER_DOWN_MESSAGE);

    expect(words).toEqual({
      isUnexplained: true,
      kind: UnexplainedErrorKind.ServerDown,
      text: "The OneUptime server did not answer. It may be starting or restarting. Try again in a few minutes.",
      reference: null,
      whereToLook: null,
      fullStop: ".",
    });
    expect(words.text).not.toContain("Error connecting to server");
  });

  test("where to look is left to the page that did not load: not said even to a self-hosted master admin", () => {
    const words: ErrorInSentenceWords = wordsOf(
      SERVER_DOWN_MESSAGE,
      SELF_HOSTED_ADMIN,
    );

    expect(words.isUnexplained && words.whereToLook).toBeNull();
  });

  test.each(["de", "fa", "ja", "zh-CN", "hi", "ar"])(
    "in %s: the language's own two sentences, joined its way",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const locale: Record<string, string> = readDashboardLocale(language);
      const why: string = locale[UnexplainedErrorWords.serverDownWhy]!;
      const next: string = locale[UnexplainedErrorWords.serverDownNext]!;

      expect(why).toBeTruthy();
      expect(next).toBeTruthy();
      expect(why).not.toBe(UnexplainedErrorWords.serverDownWhy);

      const words: ErrorInSentenceWords = wordsOf(
        SERVER_DOWN_MESSAGE,
        SELF_HOSTED_MEMBER,
        translator,
      );
      // A full-width stop needs no space after it (joinSentences).
      const fullWidthStop: RegExp = /[。！？]$/u;
      const separator: string = fullWidthStop.test(why) ? "" : " ";

      expect(words.text).toBe(`${why.trim()}${separator}${next.trim()}`);
      expect(words.text).not.toContain(SERVER_DOWN_MESSAGE);
      expect(words.text).not.toContain("did not answer");
    },
  );
});

describe("a server failure with its reference", () => {
  const message: string = getUnexplainedServerErrorMessage(REFERENCE);

  test("the reference is kept apart from the words, for its copy button", () => {
    const words: ErrorInSentenceWords = wordsOf(message, SELF_HOSTED_MEMBER);

    expect(words).toEqual({
      isUnexplained: true,
      kind: UnexplainedErrorKind.ServerWithReference,
      text: "The server ran into a problem it could not explain. Try again. If it keeps failing, give this reference to whoever runs your OneUptime server:",
      reference: REFERENCE,
      whereToLook: null,
      fullStop: ".",
    });
  });

  test("on OneUptime Cloud the reference goes to OneUptime support", () => {
    const words: ErrorInSentenceWords = wordsOf(message, CLOUD_MEMBER);

    expect(words.text).toBe(
      "The server ran into a problem it could not explain. Try again. If it keeps failing, contact OneUptime support and give them this reference:",
    );
    expect(words.isUnexplained && words.whereToLook).toBeNull();
  });

  test("a visitor of a status page is told to try again in a moment, and is given the reference to quote", () => {
    const words: ErrorInSentenceWords = wordsOf(message, VISITOR);

    expect(words.text).toBe(
      "The server ran into a problem it could not explain. Try again in a moment.",
    );
    expect(words.isUnexplained && words.reference).toBe(REFERENCE);
  });

  test("a self-hosted master admin is told where to look", () => {
    const words: ErrorInSentenceWords = wordsOf(message, SELF_HOSTED_ADMIN);

    expect(words.isUnexplained && words.whereToLook).toBe(
      UnexplainedErrorWords.adminWhereToLookWithReference,
    );
  });

  test("as text, the reference closes the sentence with the language's own full stop", () => {
    expect(
      getErrorInSentenceText({
        message: message,
        translator: ENGLISH,
        reader: SELF_HOSTED_MEMBER,
      }),
    ).toBe(
      "The server ran into a problem it could not explain. Try again. If it keeps failing, give this reference to whoever runs your OneUptime server: a1b2c3d4.",
    );

    const ja: Translator = dashboardTranslator("ja");
    const jaText: string = getErrorInSentenceText({
      message: message,
      translator: ja,
      reader: SELF_HOSTED_MEMBER,
    });

    expect(jaText.endsWith(`${REFERENCE}。`)).toBe(true);
    expect(jaText).not.toContain("The server");

    const de: Translator = dashboardTranslator("de");
    const deText: string = getErrorInSentenceText({
      message: message,
      translator: de,
      reader: SELF_HOSTED_MEMBER,
    });

    expect(deText.endsWith(` ${REFERENCE}.`)).toBe(true);
    expect(deText).toContain(
      readDashboardLocale("de")[
        UnexplainedErrorWords.serverNextWithReferenceSelfHosted
      ]!,
    );
  });
});

describe("the other errors nobody explained", () => {
  test("a server failure without a reference, OneUptime unreachable, the page failing", () => {
    expect(
      wordsOf(UNEXPLAINED_ERROR_MESSAGES.server, SELF_HOSTED_ADMIN),
    ).toEqual({
      isUnexplained: true,
      kind: UnexplainedErrorKind.Server,
      text: "The server ran into a problem it could not explain. Try again in a moment.",
      reference: null,
      whereToLook: UnexplainedErrorWords.adminWhereToLook,
      fullStop: ".",
    });
    expect(wordsOf(UNEXPLAINED_ERROR_MESSAGES.unreachable)).toEqual({
      isUnexplained: true,
      kind: UnexplainedErrorKind.Unreachable,
      text: "OneUptime could not be reached. Check your internet connection, then try again.",
      reference: null,
      whereToLook: null,
      fullStop: ".",
    });
    expect(wordsOf(UNEXPLAINED_ERROR_MESSAGES.page, SELF_HOSTED_ADMIN)).toEqual(
      {
        isUnexplained: true,
        kind: UnexplainedErrorKind.Page,
        text: "This page ran into a problem. Reload the page, then try again.",
        reference: null,
        whereToLook: null,
        fullStop: ".",
      },
    );
  });
});

describe("errorInSentence: a template value in the sentence's language", () => {
  const template: string = "Couldn't work out who is told. {{error}}";

  test("in a sentence the reader's language words, the error is in that language", () => {
    const de: Translator = dashboardTranslator("de");
    const locale: Record<string, string> = readDashboardLocale("de");

    expect(
      de.translateTemplate(template, {
        error: errorInSentence(SERVER_DOWN_MESSAGE, SELF_HOSTED_MEMBER),
      }),
    ).toBe(
      locale[template]!.replace(
        "{{error}}",
        `${locale[UnexplainedErrorWords.serverDownWhy]} ${locale[UnexplainedErrorWords.serverDownNext]}`,
      ),
    );
  });

  test("in a sentence the reader's language has no wording of, the error is in English too", () => {
    const de: Translator = dashboardTranslator("de");
    const unworded: string = "A sentence nobody has translated yet. {{error}}";

    expect(
      de.translateTemplate(unworded, {
        error: errorInSentence(SERVER_DOWN_MESSAGE, SELF_HOSTED_MEMBER),
      }),
    ).toBe(
      "A sentence nobody has translated yet. The OneUptime server did not answer. It may be starting or restarting. Try again in a few minutes.",
    );
  });

  test("a message somebody explained goes in as before", () => {
    expect(
      ENGLISH.translateTemplate(template, {
        error: errorInSentence("Gateway Timeout"),
      }),
    ).toBe("Couldn't work out who is told. Gateway Timeout");
  });
});

describe("getErrorReader: the page's reader", () => {
  beforeEach(() => {
    mockConfig.billingEnabled = false;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockConfig.billingEnabled = false;
  });

  test("a self-hosted server's master admin, on the Dashboard", () => {
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    jest
      .spyOn(NewVersion, "getAudience")
      .mockReturnValue(NewVersionAudience.Members);

    expect(getErrorReader()).toEqual({
      isCloud: false,
      isMasterAdmin: true,
      isVisitor: false,
    });
  });

  test("OneUptime Cloud, a member who is not a master admin", () => {
    mockConfig.billingEnabled = true;
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
    jest
      .spyOn(NewVersion, "getAudience")
      .mockReturnValue(NewVersionAudience.Members);

    expect(getErrorReader()).toEqual({
      isCloud: true,
      isMasterAdmin: false,
      isVisitor: false,
    });
  });

  test("a visitor of a status page or a public dashboard", () => {
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
    jest
      .spyOn(NewVersion, "getAudience")
      .mockReturnValue(NewVersionAudience.Visitors);

    expect(getErrorReader().isVisitor).toBe(true);
  });

  test("errorInSentence without a reader reads the page's, each time it says an error", () => {
    registerPageErrorReader();
    mockConfig.billingEnabled = true;
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
    jest
      .spyOn(NewVersion, "getAudience")
      .mockReturnValue(NewVersionAudience.Members);

    const say: () => string = (): string => {
      return ENGLISH.translateTemplate("{{error}}", {
        error: errorInSentence(getUnexplainedServerErrorMessage(REFERENCE)),
      });
    };

    expect(say()).toContain("contact OneUptime support");

    // The same page on a server somebody runs: read again, not remembered.
    mockConfig.billingEnabled = false;

    expect(say()).toContain("whoever runs your OneUptime server");
  });

  test("before the page says who reads it, the reader is a member of a server somebody runs", () => {
    jest.isolateModules(() => {
      const fresh: typeof import("../../../UI/Utils/ErrorInSentence") =
        jest.requireActual(
          "../../../UI/Utils/ErrorInSentence",
        ) as typeof import("../../../UI/Utils/ErrorInSentence");

      expect(fresh.getPageErrorReader()).toEqual({
        isCloud: false,
        isMasterAdmin: false,
        isVisitor: false,
      });
    });
  });

  test("API.getFriendlyMessage, which writes these sentences, tells ErrorInSentence the page's reader", () => {
    setPageErrorReader((): UnexplainedErrorReader => {
      return VISITOR;
    });

    expect(getPageErrorReader()).toEqual(VISITOR);

    mockConfig.billingEnabled = true;
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    jest
      .spyOn(NewVersion, "getAudience")
      .mockReturnValue(NewVersionAudience.Members);

    expect(
      API.getFriendlyMessage(
        new HTTPErrorResponse(500, { reference: REFERENCE }, {}),
      ),
    ).toBe(getUnexplainedServerErrorMessage(REFERENCE));
    expect(getPageErrorReader()).toEqual({
      isCloud: true,
      isMasterAdmin: true,
      isVisitor: false,
    });
  });

  test("ErrorInSentence reads no page config: the Dashboard's React-free modules load in plain Node", () => {
    // What a module imports: `from "x"`, a bare `import "x"`, `import("x")` and `require("x")`.
    const importsOf: (file: string) => Array<string> = (
      file: string,
    ): Array<string> => {
      const source: string = fs.readFileSync(
        path.resolve(__dirname, "../../..", file),
        "utf8",
      );

      return Array.from(
        source.matchAll(
          /(?:\bfrom\s+|\bimport\s*\(?\s*|\brequire\(\s*)"([^"]+)"/g,
        ),
      )
        .map((match: RegExpMatchArray): string => {
          return match[1]!;
        })
        .sort();
    };

    expect(importsOf("UI/Utils/ErrorInSentence.ts")).toEqual(
      [
        "../../Types/Exception/RefusalWithValues",
        "../../Types/Exception/UnexplainedError",
        "../../Types/Translator",
        "../../Utils/Monitor/MonitorTemplateLinkRefusal",
        "./SentenceSeparator",
      ].sort(),
    );

    /*
     * Sentences are joined with a module that imports nothing, rather than
     * through DeleteConsequences, whose table of sentences would come along
     * into every page's first load (first-load-budgets.js).
     */
    expect(importsOf("UI/Utils/SentenceSeparator.ts")).toEqual([]);

    // The refusals it reads back (#7678) bring nothing of the page's either.
    expect(importsOf("Types/Exception/RefusalWithValues.ts")).toEqual([
      "../Translator",
    ]);
    expect(importsOf("Utils/Monitor/MonitorTemplateLinkRefusal.ts")).toEqual([
      "../../Types/Exception/RefusalWithValues",
      "../../Types/Translator",
    ]);
  });
});
