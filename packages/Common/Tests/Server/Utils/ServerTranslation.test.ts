import { afterEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import {
  forgetRememberedDateTexts,
  getDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import { READER_LANGUAGE_CODES } from "../../../Types/ReaderLanguage";
import {
  getServerTranslator,
  SERVER_LOCALES,
  writeInLanguage,
} from "../../../Server/Utils/ServerTranslation";
import { Translator } from "../../../UI/Utils/TranslateTemplate";

/*
 * TEXT THE SERVER WRITES, IN ITS READER'S LANGUAGE.
 *
 * The server's translator looks a sentence up in Common/Server/Locales by
 * its English, in a language read the way every frontend reads one, and
 * writes the English exactly as it is written for English and for a
 * language OneUptime does not write in. writeInLanguage writes dates in the
 * language too, while its work runs, and English again after.
 */

const MAY_2026: Date = new Date("2026-05-06T10:15:00.000Z");

afterEach(() => {
  forgetRememberedDateTexts();
});

describe("getServerTranslator", () => {
  test("has a locale file for every language OneUptime writes in", () => {
    expect(Object.keys(SERVER_LOCALES).sort()).toEqual(
      [...READER_LANGUAGE_CODES].sort(),
    );
  });

  test("words a sentence whole in the reader's language", () => {
    const german: Translator = getServerTranslator("de");

    expect(german.language).toBe("de");
    expect(
      german.translateTemplate("[Incident] {{title}}", {
        title: "Checkout is down",
      }),
    ).toBe("[Vorfall] Checkout is down");
    expect(german.translateText("View Status Page")).toBe(
      "Statusseite ansehen",
    );
  });

  test("reads a regional or another-script tag as its language", () => {
    expect(getServerTranslator("de-AT").language).toBe("de");
    expect(getServerTranslator("zh-HK").translateText("Incident")).toBe("事件");
    expect(getServerTranslator("fa-IR").translateText("Incident")).toBe(
      "حادثه",
    );
  });

  test("writes English exactly as written, and for a language it does not write in", () => {
    for (const language of ["en", "en-GB", "xx", "", null, undefined]) {
      const translator: Translator = getServerTranslator(language);

      expect(translator.language).toBe("en");
      expect(
        translator.translateTemplate("[Incident] {{title}}", {
          title: "{{not a placeholder}} $t(x)",
        }),
      ).toBe("[Incident] {{not a placeholder}} $t(x)");
    }
  });

  test("a sentence nothing has worded reads in English, values as written", () => {
    expect(
      getServerTranslator("de").translateTemplate(
        "A sentence no locale has: {{value}}",
        { value: "Checkout" },
      ),
    ).toBe("A sentence no locale has: Checkout");
  });

  test("puts a value in literally, whatever it holds", () => {
    expect(
      getServerTranslator("fr").translateTemplate("Incident - {{title}}", {
        title: "{{title}} <b>x</b>",
      }),
    ).toBe("Incident - {{title}} <b>x</b>");
  });

  test("is built once per language", () => {
    expect(getServerTranslator("ja")).toBe(getServerTranslator("ja"));
    expect(getServerTranslator("ja-JP")).toBe(getServerTranslator("ja"));
  });
});

describe("writeInLanguage", () => {
  test("writes the work's dates in the language, and English again after", () => {
    const english: string =
      OneUptimeDate.getDateAsUserFriendlyFormattedString(MAY_2026);

    const german: string = writeInLanguage("de", (): string => {
      return OneUptimeDate.getDateAsUserFriendlyFormattedString(MAY_2026);
    });

    expect(german).not.toBe(english);
    expect(german).toContain("Mai");
    expect(getDateDisplayLanguage()).toBe("en");
    expect(OneUptimeDate.getDateAsUserFriendlyFormattedString(MAY_2026)).toBe(
      english,
    );
  });

  test("hands the work the language's translator", () => {
    expect(
      writeInLanguage("es", (translator: Translator): string => {
        return translator.translateText("Unsubscribe") || "";
      }),
    ).toBe("Cancelar suscripción");
  });

  test("puts English back when the work throws", () => {
    expect(() => {
      writeInLanguage("ru", (): string => {
        throw new Error("broken");
      });
    }).toThrow("broken");

    expect(getDateDisplayLanguage()).toBe("en");
  });

  test("writes English for a language it does not write in", () => {
    expect(
      writeInLanguage("xx", (): string => {
        return OneUptimeDate.getDateAsUserFriendlyFormattedString(MAY_2026);
      }),
    ).toBe(OneUptimeDate.getDateAsUserFriendlyFormattedString(MAY_2026));
  });

  test("a Persian date is written in Persian digits, as the status page writes them", () => {
    const persian: string = writeInLanguage("fa", (): string => {
      return OneUptimeDate.getDateAsUserFriendlyFormattedString(MAY_2026);
    });

    expect(persian).toMatch(/[۰-۹]/u);
    expect(persian).not.toMatch(/[0-9]/u);
  });
});
