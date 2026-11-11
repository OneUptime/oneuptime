import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createInstance, i18n as I18nInstance, TOptions } from "i18next";
import type { Mock, SpyInstance } from "jest-mock";
import { setCodeApartInSentence } from "../../../Types/CodeInSentence";
import {
  CODE_READS_AS_WRITTEN_POST_PROCESSOR,
  codeReadsAsWrittenPostProcessor,
  copyWithoutIsolates,
  getTranslationPostProcess,
  leaveIsolatesOutOfCopiedText,
  setCodeApartInTranslation,
  withoutIsolates,
} from "../../../UI/Utils/CodeReadsAsWritten";
import {
  PRODUCT_NAME_POST_PROCESSOR,
  productNamePostProcessor,
} from "../../../UI/Utils/ProductNameTranslation";

/*
 * The i18next post-processor every frontend runs each translated sentence
 * through (Common/UI/Utils/CodeReadsAsWritten): code in a sentence of a
 * language read from the right comes out set apart in a left-to-right
 * isolate, a sentence in any other language as it went in, and what a
 * reader copies from the page comes without the isolates' marks.
 */

const LRI: string = String.fromCharCode(0x2066);
const RLI: string = String.fromCharCode(0x2067);
const FSI: string = String.fromCharCode(0x2068);
const PDI: string = String.fromCharCode(0x2069);
const LRM: string = String.fromCharCode(0x200e);
const RLM: string = String.fromCharCode(0x200f);
const ZWNJ: string = String.fromCharCode(0x200c);

// "Call grantConsent() on your page.": the brackets drew before the name.
const ARABIC_WITH_CODE: string = "استدعِ الدالة grantConsent() في صفحتك.";
// "Add --help to any command for its flags.": --help read help--.
const PERSIAN_WITH_CODE: string = `برای دیدن پرچم‌ها، --help را به هر دستور اضافه کنید.`;

describe("a sentence handed to the page", () => {
  test.each([
    ["ar", ARABIC_WITH_CODE],
    ["ar-EG", ARABIC_WITH_CODE],
    ["fa", PERSIAN_WITH_CODE],
    ["fa-IR", PERSIAN_WITH_CODE],
    ["he", "הוסיפו --help לכל פקודה."],
    ["ur", "ہر کمانڈ میں --help شامل کریں۔"],
  ])(
    "in %s, a language read from the right, has its code set apart",
    (language: string, sentence: string) => {
      const shown: string = setCodeApartInTranslation(sentence, language);

      expect(shown).toBe(setCodeApartInSentence(sentence, language));
      expect(shown).toContain(LRI);
      expect(withoutIsolates(shown)).toBe(sentence);
    },
  );

  test.each(["en", "en-US", "de", "ja", "zh-CN", "hi"])(
    "in %s, read from the left, is handed back as it is",
    (language: string) => {
      expect(setCodeApartInTranslation(ARABIC_WITH_CODE, language)).toBe(
        ARABIC_WITH_CODE,
      );
      expect(
        setCodeApartInTranslation("Add --help to any command.", language),
      ).toBe("Add --help to any command.");
    },
  );

  test("with no language, or none of it, is handed back as it is", () => {
    for (const language of [null, undefined, ""]) {
      expect(setCodeApartInTranslation(ARABIC_WITH_CODE, language)).toBe(
        ARABIC_WITH_CODE,
      );
    }

    expect(setCodeApartInTranslation("", "ar")).toBe("");
  });

  test("in English left on an Arabic page, is handed back as it is", () => {
    expect(setCodeApartInTranslation("Add --help to any command.", "ar")).toBe(
      "Add --help to any command.",
    );
  });

  test("handed again, it is not set apart twice", () => {
    const once: string = setCodeApartInTranslation(PERSIAN_WITH_CODE, "fa");

    expect(setCodeApartInTranslation(once, "fa")).toBe(once);
  });
});

describe("a sentence the page draws again and again", () => {
  /*
   * CodeInSentence reads a sentence through: the post-processor remembers
   * what it read, per language, and forgets it all past a bound, so a page
   * left open for a day does not keep every sentence it ever drew.
   */
  const withCountedReads: () => {
    setApart: typeof setCodeApartInTranslation;
    reads: () => number;
  } = (): {
    setApart: typeof setCodeApartInTranslation;
    reads: () => number;
  } => {
    type SetApart = (sentence: string, language: string) => string;

    let setApart: typeof setCodeApartInTranslation = setCodeApartInTranslation;
    let counted: Mock<SetApart> = jest.fn<SetApart>();

    jest.isolateModules(() => {
      const actual: { setCodeApartInSentence: typeof setCodeApartInSentence } =
        jest.requireActual("../../../Types/CodeInSentence");

      counted = jest.fn<SetApart>(
        (sentence: string, language: string): string => {
          return actual.setCodeApartInSentence(sentence, language);
        },
      );

      jest.doMock("../../../Types/CodeInSentence", () => {
        return {
          ...actual,
          setCodeApartInSentence: counted,
        };
      });

      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      setApart = require("../../../UI/Utils/CodeReadsAsWritten")
        .setCodeApartInTranslation as typeof setCodeApartInTranslation;
    });

    return {
      setApart,
      reads: (): number => {
        return counted.mock.calls.length;
      },
    };
  };

  afterEach(() => {
    jest.dontMock("../../../Types/CodeInSentence");
  });

  test("is read once per language", () => {
    const { setApart, reads } = withCountedReads();
    const shown: string = setApart(ARABIC_WITH_CODE, "ar");

    expect(setApart(ARABIC_WITH_CODE, "ar")).toBe(shown);
    expect(setApart(ARABIC_WITH_CODE, "ar")).toBe(shown);
    expect(reads()).toBe(1);

    setApart(ARABIC_WITH_CODE, "fa");
    expect(reads()).toBe(2);

    // A language read from the left is never read at all.
    setApart(ARABIC_WITH_CODE, "en");
    expect(reads()).toBe(2);
  });

  test("is read afresh once five thousand others have been read", () => {
    const { setApart, reads } = withCountedReads();

    for (let index: number = 0; index <= 5000; index++) {
      setApart(`الأمر --flag-${index} هنا.`, "ar");
    }

    expect(reads()).toBe(5001);

    // The last one is remembered; the first was forgotten with the rest.
    setApart("الأمر --flag-5000 هنا.", "ar");
    expect(reads()).toBe(5001);
    setApart("الأمر --flag-0 هنا.", "ar");
    expect(reads()).toBe(5002);
  });
});

describe("the post-processor", () => {
  const process: (
    value: unknown,
    options?: TOptions,
    translator?: { language?: string },
  ) => unknown = (
    value: unknown,
    options?: TOptions,
    translator?: { language?: string },
  ): unknown => {
    return (
      codeReadsAsWrittenPostProcessor.process as unknown as (
        value: unknown,
        key: string,
        options: TOptions | undefined,
        translator: { language?: string } | undefined,
      ) => unknown
    )(value, "key", options, translator);
  };

  test("is an i18next post-processor by its name", () => {
    expect(codeReadsAsWrittenPostProcessor.type).toBe("postProcessor");
    expect(codeReadsAsWrittenPostProcessor.name).toBe(
      CODE_READS_AS_WRITTEN_POST_PROCESSOR,
    );
  });

  test("reads a sentence in the language a t() call asks for, else the instance's", () => {
    const setApart: string = setCodeApartInSentence(ARABIC_WITH_CODE, "ar");

    expect(process(ARABIC_WITH_CODE, { lng: "ar" }, { language: "en" })).toBe(
      setApart,
    );
    expect(process(ARABIC_WITH_CODE, {}, { language: "ar" })).toBe(setApart);
    expect(process(ARABIC_WITH_CODE, { lng: "en" }, { language: "ar" })).toBe(
      ARABIC_WITH_CODE,
    );
    expect(process(ARABIC_WITH_CODE, undefined, undefined)).toBe(
      ARABIC_WITH_CODE,
    );
  });

  test("hands back what is no sentence: an object i18next returns", () => {
    const tree: Record<string, string> = { a: ARABIC_WITH_CODE };

    expect(process(tree, { lng: "ar" }, { language: "ar" })).toBe(tree);
  });
});

describe("an i18next instance that runs it", () => {
  const ENGLISH: Record<string, string> = {
    "Add --help to any command.": "Add --help to any command.",
    "Run {{command}} on the host.": "Run {{command}} on the host.",
    "OneUptime reads --config.": "OneUptime reads --config.",
  };

  const instance: (options: {
    language: string;
    postProcess: Array<string> | false;
  }) => Promise<I18nInstance> = async (options: {
    language: string;
    postProcess: Array<string> | false;
  }): Promise<I18nInstance> => {
    const i18n: I18nInstance = createInstance();

    await i18n
      .use(productNamePostProcessor)
      .use(codeReadsAsWrittenPostProcessor)
      .init({
        lng: options.language,
        fallbackLng: "en",
        postProcess: options.postProcess,
        resources: {
          en: { translation: ENGLISH },
          ar: {
            translation: {
              "Add --help to any command.": "أضف --help إلى أي أمر.",
              "Run {{command}} on the host.": "شغّل {{command}} على المضيف.",
              "OneUptime reads --config.": "يقرأ OneUptime الخيار --config.",
            },
          },
          fa: {
            translation: {
              "Add --help to any command.": "--help را به هر دستور اضافه کنید.",
            },
          },
        },
        interpolation: { escapeValue: false },
      });

    return i18n;
  };

  const setBranding: (value: string | null) => void = (
    value: string | null,
  ): void => {
    const browserWindow: { process?: { env?: Record<string, unknown> } } =
      window as unknown as { process?: { env?: Record<string, unknown> } };

    browserWindow.process = browserWindow.process || {};
    browserWindow.process.env = browserWindow.process.env || {};

    if (value === null) {
      delete browserWindow.process.env["PRODUCT_BRANDING"];
    } else {
      browserWindow.process.env["PRODUCT_BRANDING"] = value;
    }
  };

  afterEach(() => {
    setBranding(null);
  });

  test("sets code apart in every Arabic and Persian sentence t() hands back", async () => {
    const i18n: I18nInstance = await instance({
      language: "ar",
      postProcess: getTranslationPostProcess(),
    });

    expect(i18n.t("Add --help to any command.")).toBe(
      setCodeApartInSentence("أضف --help إلى أي أمر.", "ar"),
    );
    expect(i18n.t("Add --help to any command.", { lng: "fa" })).toBe(
      setCodeApartInSentence("--help را به هر دستور اضافه کنید.", "fa"),
    );

    await i18n.changeLanguage("en");
    expect(i18n.t("Add --help to any command.")).toBe(
      "Add --help to any command.",
    );
  });

  test("reads a value t() fills in, as the sentence it fills", async () => {
    const i18n: I18nInstance = await instance({
      language: "ar",
      postProcess: getTranslationPostProcess(),
    });

    expect(
      i18n.t("Run {{command}} on the host.", { command: "--version" }),
    ).toBe(setCodeApartInSentence("شغّل --version على المضيف.", "ar"));
  });

  test("does nothing an instance does not turn on", async () => {
    const i18n: I18nInstance = await instance({
      language: "ar",
      postProcess: false,
    });

    expect(i18n.t("Add --help to any command.")).toBe("أضف --help إلى أي أمر.");
  });

  test("runs after the installation's own name is put in", async () => {
    setBranding(JSON.stringify({ productName: "Acme" }));

    expect(getTranslationPostProcess()).toEqual([
      PRODUCT_NAME_POST_PROCESSOR,
      CODE_READS_AS_WRITTEN_POST_PROCESSOR,
    ]);

    const i18n: I18nInstance = await instance({
      language: "ar",
      postProcess: getTranslationPostProcess(),
    });

    expect(i18n.t("OneUptime reads --config.")).toBe(
      setCodeApartInSentence("يقرأ Acme الخيار --config.", "ar"),
    );
  });

  test("is the only post-processor where the installation keeps OneUptime's name", () => {
    expect(getTranslationPostProcess()).toEqual([
      CODE_READS_AS_WRITTEN_POST_PROCESSOR,
    ]);

    setBranding(JSON.stringify({ logoUrl: "/api/branding/logo?v=1" }));
    expect(getTranslationPostProcess()).toEqual([
      CODE_READS_AS_WRITTEN_POST_PROCESSOR,
    ]);
  });
});

describe("the isolates' marks, taken out", () => {
  test("are LRI, RLI, FSI and PDI, and nothing else", () => {
    expect(withoutIsolates(`${LRI}a${PDI} ${RLI}b${PDI} ${FSI}c${PDI}`)).toBe(
      "a b c",
    );
  });

  /*
   * A mark a translator placed by hand steadies a key's sign, and Persian
   * writes its words with a zero-width non-joiner (می‌توانید): both are
   * the text's own.
   */
  test("leave a hand-placed mark and a Persian non-joiner where they are", () => {
    const text: string = `(${LRM}}${LRM}) ${RLM} می${ZWNJ}توانید`;

    expect(withoutIsolates(text)).toBe(text);
  });
});

describe("copying from the page", () => {
  interface FakeCopy {
    event: ClipboardEvent;
    copied: Record<string, string>;
    prevented: () => boolean;
  }

  const fakeCopy: (options?: {
    defaultPrevented?: boolean;
    withClipboard?: boolean;
  }) => FakeCopy = (options?: {
    defaultPrevented?: boolean;
    withClipboard?: boolean;
  }): FakeCopy => {
    const copied: Record<string, string> = {};
    let prevented: boolean = false;
    const event: ClipboardEvent = {
      defaultPrevented: Boolean(options?.defaultPrevented),
      clipboardData:
        options?.withClipboard === false
          ? null
          : {
              setData: (type: string, data: string): void => {
                copied[type] = data;
              },
            },
      preventDefault: (): void => {
        prevented = true;
      },
    } as unknown as ClipboardEvent;

    return {
      event,
      copied,
      prevented: (): boolean => {
        return prevented;
      },
    };
  };

  const select: (node: Node) => void = (node: Node): void => {
    const range: Range = document.createRange();

    range.selectNodeContents(node);

    const selection: Selection = window.getSelection() as Selection;

    selection.removeAllRanges();
    selection.addRange(range);
  };

  const SHOWN: string = `أضف ${LRI}--help${PDI} إلى أي أمر.`;
  const WRITTEN: string = "أضف --help إلى أي أمر.";

  beforeEach(() => {
    document.body.innerHTML = "";
    window.getSelection()?.removeAllRanges();
  });

  const paragraph: (text: string) => HTMLElement = (
    text: string,
  ): HTMLElement => {
    const element: HTMLElement = document.createElement("p");

    element.textContent = text;
    document.body.appendChild(element);

    return element;
  };

  test("copies a sentence as the reader saw it, without the isolates' marks", () => {
    select(paragraph(SHOWN));

    const copy: FakeCopy = fakeCopy();

    copyWithoutIsolates(copy.event);

    expect(copy.copied["text/plain"]).toBe(WRITTEN);
    expect(copy.copied["text/html"]).toBe(WRITTEN);
    expect(copy.prevented()).toBe(true);
  });

  test("keeps the markup of what is copied, without the marks", () => {
    const element: HTMLElement = document.createElement("p");

    element.innerHTML = `أضف <code>${LRI}--help${PDI}</code> إلى أي أمر.`;
    document.body.appendChild(element);
    select(element);

    const copy: FakeCopy = fakeCopy();

    copyWithoutIsolates(copy.event);

    expect(copy.copied["text/html"]).toBe(
      "أضف <code>--help</code> إلى أي أمر.",
    );
    expect(copy.copied["text/plain"]).toBe(WRITTEN);
  });

  test("leaves a copy with no such mark to the browser", () => {
    select(paragraph(WRITTEN));

    const copy: FakeCopy = fakeCopy();

    copyWithoutIsolates(copy.event);

    expect(copy.copied).toEqual({});
    expect(copy.prevented()).toBe(false);
  });

  test("leaves a copy alone when nothing is selected", () => {
    paragraph(SHOWN);

    const copy: FakeCopy = fakeCopy();

    copyWithoutIsolates(copy.event);

    expect(copy.copied).toEqual({});
    expect(copy.prevented()).toBe(false);
  });

  test("leaves a copy a component already handled, or one with no clipboard", () => {
    select(paragraph(SHOWN));

    for (const copy of [
      fakeCopy({ defaultPrevented: true }),
      fakeCopy({ withClipboard: false }),
    ]) {
      copyWithoutIsolates(copy.event);

      expect(copy.copied).toEqual({});
      expect(copy.prevented()).toBe(false);
    }
  });

  // What a reader copies where they type is their own text, as typed.
  test("leaves a copy from where the reader types to the browser", () => {
    const editable: HTMLElement = document.createElement("div");

    editable.setAttribute("contenteditable", "true");
    editable.textContent = SHOWN;
    document.body.appendChild(editable);
    select(editable);

    const fromEditable: FakeCopy = fakeCopy();

    copyWithoutIsolates(fromEditable.event);
    expect(fromEditable.copied).toEqual({});

    const field: HTMLTextAreaElement = document.createElement("textarea");

    field.value = SHOWN;
    document.body.appendChild(field);
    select(paragraph(SHOWN));
    field.focus();

    const whileTyping: FakeCopy = fakeCopy();

    copyWithoutIsolates(whileTyping.event);
    expect(whileTyping.copied).toEqual({});
    expect(whileTyping.prevented()).toBe(false);
  });

  test("a frontend listens for it once per document", () => {
    const page: Document = document.implementation.createHTMLDocument("page");
    const listen: SpyInstance<Document["addEventListener"]> = jest.spyOn(
      page,
      "addEventListener",
    );

    leaveIsolatesOutOfCopiedText(page);
    leaveIsolatesOutOfCopiedText(page);

    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith("copy", copyWithoutIsolates);
  });

  test("and a copy on the page is copied without the marks", () => {
    leaveIsolatesOutOfCopiedText(document);
    select(paragraph(SHOWN));

    const copied: Record<string, string> = {};
    const event: Event = new Event("copy", {
      bubbles: true,
      cancelable: true,
    });

    Object.defineProperty(event, "clipboardData", {
      value: {
        setData: (type: string, data: string): void => {
          copied[type] = data;
        },
      },
    });

    document.dispatchEvent(event);

    expect(copied["text/plain"]).toBe(WRITTEN);
    expect(event.defaultPrevented).toBe(true);
  });
});
