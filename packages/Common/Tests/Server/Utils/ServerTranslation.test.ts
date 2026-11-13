import { afterEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import {
  forgetRememberedDateTexts,
  getDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import { READER_LANGUAGE_CODES } from "../../../Types/ReaderLanguage";
import {
  FIRST_STRONG_ISOLATE,
  getEveryWordingOf,
  getRecordWordsTranslator,
  getServerTranslator,
  POP_DIRECTIONAL_ISOLATE,
  SERVER_LOCALES,
  writeInLanguage,
} from "../../../Server/Utils/ServerTranslation";
import { composedValue, Translator } from "../../../UI/Utils/TranslateTemplate";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";

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

/*
 * A Persian sentence holds the team's own words - titles and names, most
 * often English. Each goes in isolated (Unicode's FIRST STRONG ISOLATE ...
 * POP DIRECTIONAL ISOLATE, what <bdi> is on a page), so its bracket or full
 * stop stays at its end and two values never run together.
 */
describe("a value in a sentence read from the right", () => {
  const PERSIAN: Translator = getServerTranslator("fa");

  const isolated: (text: string) => string = (text: string): string => {
    return `${FIRST_STRONG_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`;
  };

  test("the isolates are U+2068 and U+2069", () => {
    expect(FIRST_STRONG_ISOLATE).toBe("\u{2068}");
    expect(POP_DIRECTIONAL_ISOLATE).toBe("\u{2069}");
  });

  test("is isolated in a sentence Persian words", () => {
    expect(
      PERSIAN.translateTemplate("[Incident] {{title}}", {
        title: "Payments (EU)",
      }),
    ).toBe(
      `[\u{062D}\u{0627}\u{062F}\u{062B}\u{0647}] ${isolated("Payments (EU)")}`,
    );
  });

  test("so is a value composed in the reader's language - a state's name", () => {
    const subject: string = PERSIAN.translateTemplate(
      "[Incident {{state}}] {{title}}",
      {
        state: composedValue((translator: Translator): string => {
          return translator.translateText("Resolved") || "";
        }),
        title: "Checkout",
      },
    );

    expect(subject).toContain(isolated(PERSIAN.translateText("Resolved")!));
    expect(subject.endsWith(isolated("Checkout"))).toBe(true);
  });

  test("a link and a number go in as they are", () => {
    const text: string = PERSIAN.translateTemplate(
      "Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}",
      {
        detailsUrl: "https://status.acme.example/incidents/42",
        unsubscribeUrl: "HTTPS://status.acme.example/u/1",
      },
    );

    expect(text).not.toContain(FIRST_STRONG_ISOLATE);
    expect(text).toContain(" https://status.acme.example/incidents/42 ");
    expect(
      PERSIAN.translatePlural(
        { one: "{{count}} resource", other: "{{count}} resources" },
        3,
        { name: 5 },
      ),
    ).not.toContain(FIRST_STRONG_ISOLATE);
  });

  test("a sentence Persian has not worded is the English it always was", () => {
    expect(
      PERSIAN.translateTemplate("A sentence no locale has: {{value}}", {
        value: "Checkout",
      }),
    ).toBe("A sentence no locale has: Checkout");
  });

  test("a language read from the left isolates nothing", () => {
    for (const language of ["en", "de", "ja", "zh-CN"]) {
      expect(
        getServerTranslator(language).translateTemplate(
          "[Incident] {{title}}",
          { title: "Payments (EU)" },
        ),
      ).not.toContain(FIRST_STRONG_ISOLATE);
    }
  });
});

/*
 * WORDS ONEUPTIME SUGGESTS FOR A RECORD (#7247): a new monitor's criteria,
 * which Ask AI writes in the language the person reads the Dashboard in,
 * worded and put together exactly as the Dashboard's translator does it -
 * never with a message's isolate marks, which a record would keep.
 */
describe("getRecordWordsTranslator", () => {
  const ONLINE: string = "Check if {{monitorName}} is online";

  test("English, and a language OneUptime does not write in, are the builders' own English", () => {
    for (const language of [
      undefined,
      null,
      "",
      "en",
      "en-GB",
      "xx",
      "klingon",
      "<script>",
    ]) {
      expect([language, getRecordWordsTranslator(language)]).toEqual([
        language,
        undefined,
      ]);
    }
  });

  test("a language OneUptime writes in words a criteria in it, the value as it is", () => {
    const german: Translator = getRecordWordsTranslator("de")!;

    expect(german.language).toBe("de");
    expect(
      german.translateTemplate(ONLINE, { monitorName: "acme.example" }),
    ).toBe(
      dashboardTranslator("de").translateTemplate(ONLINE, {
        monitorName: "acme.example",
      }),
    );
    expect(
      german.translateTemplate(ONLINE, { monitorName: "acme.example" }),
    ).not.toBe("Check if acme.example is online");
    expect(
      german.translateTemplate(ONLINE, { monitorName: "acme.example" }),
    ).toContain("acme.example");
  });

  test("reads a regional tag as its language", () => {
    expect(getRecordWordsTranslator("de-AT")?.language).toBe("de");
    expect(getRecordWordsTranslator("zh-HK")?.language).toBe("zh-TW");
  });

  test.each(["ar", "fa"])(
    "in %s, read from the right, the value goes in with no isolate marks, as the Dashboard puts it",
    (language: string) => {
      const words: Translator = getRecordWordsTranslator(language)!;
      const written: string = words.translateTemplate(ONLINE, {
        monitorName: "api.acme.example/health",
      });

      expect(written).not.toContain(FIRST_STRONG_ISOLATE);
      expect(written).not.toContain(POP_DIRECTIONAL_ISOLATE);
      expect(written).toBe(
        dashboardTranslator(language).translateTemplate(ONLINE, {
          monitorName: "api.acme.example/health",
        }),
      );
      // Where a message to a reader of the language sets it apart.
      expect(
        getServerTranslator(language).translateTemplate(ONLINE, {
          monitorName: "api.acme.example/health",
        }),
      ).toContain(FIRST_STRONG_ISOLATE);
    },
  );
});

describe("getEveryWordingOf", () => {
  test("the English, then every language's own wording, each once", () => {
    const wordings: Array<string> = getEveryWordingOf("Note:");

    expect(wordings[0]).toBe("Note:");
    expect(wordings).toContain("Notiz:");
    expect(wordings).toContain("\u{5907}\u{6CE8}\u{FF1A}");
    expect(new Set(wordings).size).toBe(wordings.length);
    // Danish writes "Note:" as English does: once.
    expect(
      wordings.filter((wording: string): boolean => {
        return wording === "Note:";
      }),
    ).toHaveLength(1);
  });

  test("a text no locale has is its English alone", () => {
    expect(getEveryWordingOf("A sentence no locale has")).toEqual([
      "A sentence no locale has",
    ]);
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
