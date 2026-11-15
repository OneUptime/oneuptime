import {
  isEmptyErrorPhrase,
  isErrorSentence,
} from "../../../Types/Exception/ErrorMessageRule";
import {
  ERROR_REFERENCE_FIELD,
  ERROR_REFERENCE_LENGTH,
  getExplanationWords,
  getUnexplainedServerErrorMessage,
  isErrorReference,
  readUnexplainedError,
  SERVER_DOWN_MESSAGE,
  toErrorReference,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorKind,
  UnexplainedErrorReader,
  UnexplainedErrorWords,
} from "../../../Types/Exception/UnexplainedError";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * An error nobody explained (#6836) says what happened and what to do next,
 * and a failure on the server names a reference to its log lines. These are
 * the words that travel between the server, API.getFriendlyMessage and
 * ErrorExplanation, and the reference they carry.
 */

const REQUEST_ID: string = "1f0c9a2b-7d4e-4a1b-9c3d-5e6f7a8b9c0d";

describe("the reference", () => {
  test("is the first eight hex digits of the request's id", () => {
    expect(toErrorReference(REQUEST_ID)).toBe("1f0c9a2b");
    expect(toErrorReference(REQUEST_ID)).toHaveLength(ERROR_REFERENCE_LENGTH);
  });

  test("skips the dashes and lowers the case", () => {
    expect(toErrorReference("ABC-DEF12-345")).toBe("abcdef12");
  });

  test("is null without an id long enough to make one", () => {
    expect(toErrorReference(undefined)).toBeNull();
    expect(toErrorReference(null)).toBeNull();
    expect(toErrorReference("")).toBeNull();
    expect(toErrorReference("abc-12")).toBeNull();
    expect(toErrorReference("not hex at all")).toBeNull();
  });

  test("is recognised only as eight lower-case hex digits", () => {
    expect(isErrorReference("1f0c9a2b")).toBe(true);
    expect(isErrorReference("1F0C9A2B")).toBe(false);
    expect(isErrorReference("1f0c9a2")).toBe(false);
    expect(isErrorReference("1f0c9a2bc")).toBe(false);
    expect(isErrorReference("1f0c9a2g")).toBe(false);
    expect(isErrorReference(12345678)).toBe(false);
    expect(isErrorReference(undefined)).toBe(false);
  });

  test("travels in the error answer's reference field", () => {
    expect(ERROR_REFERENCE_FIELD).toBe("reference");
  });
});

describe("the server's answer", () => {
  test("names the reference when it has one, and says what to do next", () => {
    const message: string = getUnexplainedServerErrorMessage("1f0c9a2b");

    expect(message).toBe(
      "The server ran into a problem it could not explain, so this did not finish. Try again, and if it keeps failing, give this reference to your administrator or OneUptime support: 1f0c9a2b.",
    );
  });

  test("says to try again in a moment when it has none", () => {
    expect(getUnexplainedServerErrorMessage(null)).toBe(
      UNEXPLAINED_ERROR_MESSAGES.server,
    );
    expect(getUnexplainedServerErrorMessage("not-a-ref")).toBe(
      UNEXPLAINED_ERROR_MESSAGES.server,
    );
  });
});

describe("every sentence meets the rule it exists for", () => {
  const sentences: Array<string> = [
    getUnexplainedServerErrorMessage("1f0c9a2b"),
    UNEXPLAINED_ERROR_MESSAGES.server,
    UNEXPLAINED_ERROR_MESSAGES.unreachable,
    UNEXPLAINED_ERROR_MESSAGES.page,
    UNEXPLAINED_ERROR_MESSAGES.tooLarge,
    ...Object.values(UnexplainedErrorWords).filter((words: string) => {
      // The two that end in the reference, and the dialog title.
      return (
        !words.endsWith(":") &&
        words !== UnexplainedErrorWords.pageDidNotLoadTitle &&
        words !== UnexplainedErrorWords.openHealth
      );
    }),
  ];

  test.each(sentences)(
    "%j is a sentence, and not an empty phrase",
    (s: string) => {
      expect(isErrorSentence(s)).toBe(true);
      expect(isEmptyErrorPhrase(s)).toBe(false);
    },
  );

  test("none says Server Error or Something went wrong", () => {
    for (const s of sentences) {
      expect(s.toLowerCase()).not.toContain("server error");
      expect(s.toLowerCase()).not.toContain("something went wrong");
    }
  });

  test("the sentences that end in the reference end with a colon", () => {
    expect(
      UnexplainedErrorWords.serverNextWithReferenceCloud.endsWith(":"),
    ).toBe(true);
    expect(
      UnexplainedErrorWords.serverNextWithReferenceSelfHosted.endsWith(":"),
    ).toBe(true);
  });
});

describe("readUnexplainedError", () => {
  test("reads the server's answer back, with its reference", () => {
    expect(
      readUnexplainedError(getUnexplainedServerErrorMessage("1f0c9a2b")),
    ).toEqual({
      kind: UnexplainedErrorKind.ServerWithReference,
      reference: "1f0c9a2b",
    });
  });

  test("reads each of the other sentences as its kind", () => {
    expect(readUnexplainedError(UNEXPLAINED_ERROR_MESSAGES.server)).toEqual({
      kind: UnexplainedErrorKind.Server,
      reference: null,
    });
    expect(readUnexplainedError(SERVER_DOWN_MESSAGE)).toEqual({
      kind: UnexplainedErrorKind.ServerDown,
      reference: null,
    });
    expect(
      readUnexplainedError(UNEXPLAINED_ERROR_MESSAGES.unreachable),
    ).toEqual({ kind: UnexplainedErrorKind.Unreachable, reference: null });
    expect(readUnexplainedError(UNEXPLAINED_ERROR_MESSAGES.page)).toEqual({
      kind: UnexplainedErrorKind.Page,
      reference: null,
    });
  });

  test("forgives the space around a message", () => {
    expect(
      readUnexplainedError(` ${UNEXPLAINED_ERROR_MESSAGES.page}\n`),
    ).not.toBeNull();
  });

  test("leaves every message somebody put into words alone", () => {
    expect(readUnexplainedError("Promo code is invalid.")).toBeNull();
    expect(readUnexplainedError("Server Error")).toBeNull();
    expect(readUnexplainedError("")).toBeNull();
    expect(readUnexplainedError(undefined)).toBeNull();
    expect(readUnexplainedError(null)).toBeNull();
  });

  test("does not read a near miss as the server's answer", () => {
    const answer: string = getUnexplainedServerErrorMessage("1f0c9a2b");

    // A reference that is not one.
    expect(
      readUnexplainedError(answer.replace("1f0c9a2b", "1F0C9A2B")),
    ).toBeNull();
    expect(
      readUnexplainedError(answer.replace("1f0c9a2b", "1f0c9a2bff")),
    ).toBeNull();
    // The sentence quoted inside another.
    expect(
      readUnexplainedError(`The verification code was not sent. ${answer}`),
    ).toBeNull();
    // The sentence without its full stop.
    expect(readUnexplainedError(answer.slice(0, -1))).toBeNull();
  });
});

/*
 * WHAT WAS SENT WAS TOO LARGE (#8278): a proxy's 413 page, or one that says
 * nothing, read as a failure the server could not explain, with "Try again
 * in a moment". Its own kind says to send less, and tells whoever can raise
 * the proxy's limit where it is.
 */
describe("what was sent was too large", () => {
  const SELF_HOSTED_ADMIN: UnexplainedErrorReader = {
    isCloud: false,
    isMasterAdmin: true,
    isVisitor: false,
  };

  const TOO_LARGE: { kind: UnexplainedErrorKind; reference: null } = {
    kind: UnexplainedErrorKind.TooLarge,
    reference: null,
  };

  test("its sentence is read back as its kind, with no reference", () => {
    expect(readUnexplainedError(UNEXPLAINED_ERROR_MESSAGES.tooLarge)).toEqual(
      TOO_LARGE,
    );
    expect(
      readUnexplainedError(` ${UNEXPLAINED_ERROR_MESSAGES.tooLarge}\n`),
    ).toEqual(TOO_LARGE);
  });

  test("its words, not a near miss, are what is read back", () => {
    expect(readUnexplainedError(UnexplainedErrorWords.tooLargeWhy)).toBeNull();
    expect(
      readUnexplainedError(UNEXPLAINED_ERROR_MESSAGES.tooLarge.slice(0, -1)),
    ).toBeNull();
    expect(
      readUnexplainedError(
        `The file was not uploaded. ${UNEXPLAINED_ERROR_MESSAGES.tooLarge}`,
      ),
    ).toBeNull();
  });

  test("the sentence that travels is its why and what to do next, as the others are", () => {
    expect(UNEXPLAINED_ERROR_MESSAGES.tooLarge).toBe(
      `${UnexplainedErrorWords.tooLargeWhy.slice(0, -1)}, so this did not finish. ${UnexplainedErrorWords.tooLargeNext}`,
    );
  });

  test("it says to send less, never to try again in a moment", () => {
    for (const words of [
      UNEXPLAINED_ERROR_MESSAGES.tooLarge,
      UnexplainedErrorWords.tooLargeNext,
    ]) {
      expect(words).toContain("less at once");
      expect(words).not.toContain("in a moment");
      expect(words).not.toContain(UnexplainedErrorWords.serverNext);
    }
  });

  test("a self-hosted master admin is told which limit to raise", () => {
    expect(
      getExplanationWords({ error: TOO_LARGE, ...SELF_HOSTED_ADMIN }),
    ).toEqual({
      why: UnexplainedErrorWords.tooLargeWhy,
      next: UnexplainedErrorWords.tooLargeNext,
      whereToLook: UnexplainedErrorWords.tooLargeWhereToLook,
    });
  });

  test.each([
    [
      "a member of a self-hosted server",
      { isCloud: false, isMasterAdmin: false },
    ],
    [
      "a master admin on OneUptime Cloud",
      { isCloud: true, isMasterAdmin: true },
    ],
    ["a member on OneUptime Cloud", { isCloud: true, isMasterAdmin: false }],
    [
      "a status page's visitor on a self-hosted server",
      { isCloud: false, isMasterAdmin: true, isVisitor: true },
    ],
  ])(
    "%s is told to send less, and nothing about a proxy",
    (_reader: string, reader: UnexplainedErrorReader) => {
      expect(getExplanationWords({ error: TOO_LARGE, ...reader })).toEqual({
        why: UnexplainedErrorWords.tooLargeWhy,
        next: UnexplainedErrorWords.tooLargeNext,
        whereToLook: null,
      });
    },
  );

  test("the limit it names is the one OneUptime's own ingress sets on its API and its uploads", () => {
    const template: string = fs.readFileSync(
      path.resolve(__dirname, "../../../../Nginx/default.conf.template"),
      "utf8",
    );

    // What every request the Dashboard sends goes through: /api and /file.
    for (const prefix of ["/api", "/file"]) {
      const start: number = template.indexOf(`\n    location ${prefix} {`);

      expect({ prefix, found: start >= 0 }).toEqual({ prefix, found: true });

      const block: string = template.substring(
        start,
        template.indexOf("\n    }", start + 1),
      );

      expect({
        prefix,
        limits: block.match(/client_max_body_size \S+;/g),
      }).toEqual({
        prefix,
        limits: ["client_max_body_size 50M;"],
      });
    }

    expect(UnexplainedErrorWords.tooLargeWhereToLook).toContain(
      "client_max_body_size 50M",
    );
    expect(UnexplainedErrorWords.tooLargeWhereToLook).toContain("50 MB");
  });

  test("every locale that words it keeps the setting and the size as written", () => {
    const featureSets: string = path.resolve(
      __dirname,
      "../../../../App/FeatureSet",
    );

    for (const app of ["Dashboard", "Accounts", "AdminDashboard"]) {
      const folder: string = path.join(featureSets, app, "src", "Locales");

      const files: Array<string> = fs
        .readdirSync(folder)
        .filter((file: string): boolean => {
          return file.endsWith(".json");
        });

      // English and the 17 languages each app speaks.
      expect({ app, files: files.length }).toEqual({ app, files: 18 });

      for (const file of files) {
        const words: Record<string, unknown> = JSON.parse(
          fs.readFileSync(path.join(folder, file), "utf8"),
        ) as Record<string, unknown>;
        const translated: unknown =
          words[UnexplainedErrorWords.tooLargeWhereToLook];

        expect({ app, file, translated: typeof translated }).toEqual({
          app,
          file,
          translated: "string",
        });
        expect(translated as string).toContain("client_max_body_size 50M");
        expect(translated as string).toContain("nginx");
        expect(translated as string).toContain("OneUptime");
        // 50, in the language's digits.
        expect(translated as string).toMatch(/(50|۵۰)/);
      }
    }
  });
});
