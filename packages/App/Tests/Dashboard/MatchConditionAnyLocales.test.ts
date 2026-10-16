import {
  ENGLISH,
  getLocalePath,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";

/*
 * What the Dashboard's locale files say for a monitor criteria's Match
 * Condition, and for the incident switch's help next to it.
 *
 * A criteria with two filters or more asks how they combine: All (every
 * filter must match) or Any (one is enough). The editor draws the two
 * options through the locale files ("All", "Any"). Four languages drew Any
 * with their own word for all, every or everything, so both options read
 * "all":
 *
 *   ko  전체 / 모두   모두 is the "all" of "Match all" (모두 일치)
 *   fr  Tous / Tout   Tout is French's "Everything"
 *   nl  Alle / Elke   Elke is Dutch's "Every"
 *   fa  همه / هر      هر is Persian's "Every"
 *
 * Each now says "one or more" / "at least one", as its "Any condition"
 * already did. The bare "Any" key was also drawn in two places that mean
 * something else - Traces' Span Kind filter left open, and the workflow
 * value picker's badge for a value of any type - where "one or more" would
 * read wrong; they say "All" and "Any type" now (the Common tests and
 * MatchConditionAnyWordGuard pin that), so "Any" is the Match Condition's
 * word alone.
 *
 * The incident switch's help read "When you delcare an incident, ...". The
 * sentence is the key, so the fix re-keyed every locale in place.
 */

const ANY: string = "Any";
const ALL: string = "All";

// The Match Condition's two options must read differently from these.
const WORDS_FOR_ALL: Array<string> = ["All", "Every", "Everything"];

// Phrases that hold a language's word for "all" next to a noun or a verb.
const PHRASES_WITH_ALL: Array<string> = ["Match all", "All conditions"];

// What each of the four languages says now, and what it said.
const FIXED_ANY_WORDS: Record<string, { now: string; was: string }> = {
  ko: { now: "하나 이상", was: "모두" },
  fr: { now: "Au moins un", was: "Tout" },
  nl: { now: "Minstens één", was: "Elke" },
  fa: { now: "دست‌کم یکی", was: "هر" },
};

// The words the two other screens say instead of a bare "Any".
const ANY_TYPE: string = "Any type";

const INCIDENT_SWITCH_HELP: string =
  "When you declare an incident, it is used to notify the team and is shown on the status page as well.";

const MISSPELLED_INCIDENT_SWITCH_HELP: string =
  "When you delcare an incident, it is used to notify the team and is shown on the status page as well.";

const MISSPELLING: string = "delcare";

const EVERY_LOCALE: Array<string> = [ENGLISH, ...TRANSLATED_LOCALES];

const localeCache: Map<string, Record<string, unknown>> = new Map();

function locale(code: string): Record<string, unknown> {
  const cached: Record<string, unknown> | undefined = localeCache.get(code);

  if (cached) {
    return cached;
  }

  const parsed: Record<string, unknown> = JSON.parse(
    fs.readFileSync(getLocalePath(code), "utf8"),
  ) as Record<string, unknown>;

  localeCache.set(code, parsed);

  return parsed;
}

// What the Dashboard draws for this English text in this language.
function drawn(code: string, english: string): string {
  const value: unknown = locale(code)[english];

  return typeof value === "string" && value.trim() ? value : english;
}

// Every flat key and string value of a locale, nested keys included.
function textsOf(code: string): Array<string> {
  const texts: Array<string> = [];

  const walk: (node: unknown) => void = (node: unknown): void => {
    if (typeof node === "string") {
      texts.push(node);
      return;
    }

    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(
        node as Record<string, unknown>,
      )) {
        texts.push(key);
        walk(value);
      }
    }
  };

  walk(locale(code));

  return texts;
}

describe("the Match Condition's two options", () => {
  test("cover the seventeen Dashboard languages", () => {
    expect(EVERY_LOCALE).toHaveLength(17);
    expect(EVERY_LOCALE).toEqual(
      expect.arrayContaining(Object.keys(FIXED_ANY_WORDS)),
    );
  });

  test.each(EVERY_LOCALE)(
    "%s draws All and Any as two different words",
    (code: string) => {
      expect(drawn(code, ANY)).not.toBe(drawn(code, ALL));
    },
  );

  test.each(EVERY_LOCALE)(
    "%s never draws Any with its word for all, every or everything",
    (code: string) => {
      const any: string = drawn(code, ANY);

      for (const english of WORDS_FOR_ALL) {
        expect({ english, word: drawn(code, english) }).not.toEqual({
          english,
          word: any,
        });
      }

      // ko drew Any as 모두, the "all" of 모두 일치 (Match all).
      for (const phrase of PHRASES_WITH_ALL) {
        expect({ phrase, holdsAny: drawn(code, phrase).includes(any) }).toEqual(
          { phrase, holdsAny: false },
        );
      }
    },
  );

  test.each(Object.keys(FIXED_ANY_WORDS))(
    "%s says one or more / at least one, not the word for all it drew",
    (code: string) => {
      const words: { now: string; was: string } = FIXED_ANY_WORDS[code]!;

      expect(drawn(code, ANY)).toBe(words.now);
      expect(drawn(code, ANY)).not.toBe(words.was);
      // The old word was the language's "all" (or "every", "everything").
      expect(
        [ALL, "Every", "Everything", "Match all"].some(
          (english: string): boolean => {
            return drawn(code, english).includes(words.was);
          },
        ),
      ).toBe(true);
    },
  );

  test("Korean words Any as its 'Any condition' does, and All as 'All'", () => {
    expect(drawn("ko", "Any condition")).toBe(`${drawn("ko", ANY)}의 조건`);
    expect(drawn("ko", ALL)).toBe("전체");
    expect(drawn("ko", "Match all")).toBe("모두 일치");
    expect(drawn("ko", "Match any")).toBe("하나라도 일치");
  });

  test("Persian writes 'at least one' as its Dashboard does elsewhere, with a zero-width non-joiner", () => {
    const any: string = drawn("fa", ANY);

    expect(any).toContain("‌");
    expect(
      textsOf("fa").filter((text: string): boolean => {
        return text !== any && text.includes(any);
      }).length,
    ).toBeGreaterThan(0);
  });

  test("English keeps All and Any", () => {
    expect(locale(ENGLISH)[ANY]).toBe(ANY);
    expect(locale(ENGLISH)[ALL]).toBe(ALL);
  });
});

describe("the other screens that drew a bare Any", () => {
  test("Any type is a key of its own, translated in every language", () => {
    expect(locale(ENGLISH)[ANY_TYPE]).toBe(ANY_TYPE);

    for (const code of TRANSLATED_LOCALES) {
      const value: unknown = locale(code)[ANY_TYPE];

      expect({ code, isString: typeof value === "string" }).toEqual({
        code,
        isString: true,
      });
      expect({ code, value }).not.toEqual({ code, value: ANY_TYPE });
    }
  });

  test.each(EVERY_LOCALE)(
    "%s draws a value of any type differently from the Match Condition's Any",
    (code: string) => {
      expect(drawn(code, ANY_TYPE)).not.toBe(drawn(code, ANY));
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s translates All, the Span Kind filter's no-filter option",
    (code: string) => {
      expect(drawn(code, ALL)).not.toBe(ALL);
    },
  );

  test("Any type sits at the same place in every locale file", () => {
    const englishKeys: Array<string> = Object.keys(locale(ENGLISH));
    const at: number = englishKeys.indexOf(ANY_TYPE);

    expect(at).toBeGreaterThan(0);

    for (const code of TRANSLATED_LOCALES) {
      expect({ code, at: Object.keys(locale(code)).indexOf(ANY_TYPE) }).toEqual(
        { code, at },
      );
    }
  });
});

describe("the incident switch's help", () => {
  test("English spells 'declare' and maps the sentence to itself", () => {
    expect(locale(ENGLISH)[INCIDENT_SWITCH_HELP]).toBe(INCIDENT_SWITCH_HELP);
    expect(locale(ENGLISH)[MISSPELLED_INCIDENT_SWITCH_HELP]).toBeUndefined();
  });

  test.each(EVERY_LOCALE)(
    "%s has no 'delcare' in any key or value",
    (code: string) => {
      expect(
        textsOf(code).filter((text: string): boolean => {
          return text.toLowerCase().includes(MISSPELLING);
        }),
      ).toEqual([]);
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s kept its translation under the corrected key, at the same place",
    (code: string) => {
      const value: unknown = locale(code)[INCIDENT_SWITCH_HELP];

      expect(typeof value).toBe("string");
      expect(value).not.toBe(INCIDENT_SWITCH_HELP);
      expect((value as string).trim().length).toBeGreaterThan(0);
      expect(Object.keys(locale(code)).indexOf(INCIDENT_SWITCH_HELP)).toBe(
        Object.keys(locale(ENGLISH)).indexOf(INCIDENT_SWITCH_HELP),
      );
    },
  );

  /*
   * The re-key moved no key: the corrected sentence holds the place the
   * misspelled one had, so the files' order and every other key are as
   * they were.
   */
  test("took the place of the misspelled key in en.json, after the alert switch's help", () => {
    const keys: Array<string> = Object.keys(locale(ENGLISH));
    const at: number = keys.indexOf(INCIDENT_SWITCH_HELP);

    expect(at).toBeGreaterThan(0);
    expect(keys[at - 1]).toBe(
      "When you create an alert, it is used to notify the team but is not shown on the status page.",
    );
  });
});
