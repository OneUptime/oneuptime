import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * PERSIAN NAMES EACH FRUSTRATION SIGNAL WITH ONE WORD (#6519).
 *
 * The Frustration Signals page called a rage click کلیک‌های عصبی, while the
 * session list, the player, User Flows, the Users page and the Persian
 * docs, written before it, said کلیک خشمگین. Dead clicks were بی‌اثر in one
 * place and مرده in another, refresh rage خشم بازخوانی, بارگذاری مجدد
 * پیاپی and تازه‌سازی پیاپی, frustration کلافگی, سرخوردگی and ناامیدی. A
 * Persian reader met two or three words for one signal. Every Session
 * Replay, User Flows and RUM line now uses the settings page's word:
 *
 *   rage click     کلیک عصبی (کلیک‌های عصبی)
 *   dead click     کلیک بی‌اثر
 *   error click    کلیک خطا
 *   refresh rage   تازه‌سازی پیاپی
 *   frustration    کلافگی (frustrated: کلافه)
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
const LOCALE: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard/src/Locales/fa.json",
);
const PERSIAN_DOCS: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Docs/Content/fa",
);

// The zero-width non-joiner Persian writes inside a word (کلیک‌ها).
const ZWNJ: string = String.fromCharCode(0x200c);

function persian(text: string): string {
  return text.split("|").join(ZWNJ);
}

const RAGE: string = "کلیک عصبی";
const RAGE_PLURAL: string = persian("کلیک|های عصبی");
const DEAD: string = persian("بی|اثر");
const ERROR_CLICK: string = "کلیک خطا";
const REFRESH_RAGE: string = persian("تازه|سازی پیاپی");
const FRUSTRATION: string = "کلافگی";

// An Arabic-script letter (U+0600 to U+06FF).
const LETTER: string = `[${String.fromCharCode(0x0600)}-${String.fromCharCode(0x06ff)}]`;

// A click's "مرده", as a word of its own.
const DEAD_CLICK: RegExp = new RegExp(
  `کلیک[^.،؛]{0,24}(?<!${LETTER})مرده`,
  "u",
);

/*
 * The words the older lines used. "مرده" alone is not one: it is also a
 * dead host or a dead letter, so only a dead click's is, and only as a
 * word of its own (شمرده, "counted", ends with it).
 */
const RETIRED: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "rage (خشمگین)", pattern: /خشمگین/ },
  { name: "refresh rage (خشم بازخوانی)", pattern: /خشم بازخوانی/ },
  {
    name: "refresh rage (بارگذاری مجدد پیاپی)",
    pattern: /بارگذاری مجدد پیاپی/,
  },
  {
    name: "dead click (مرده)",
    pattern: DEAD_CLICK,
  },
  { name: "error click (کلیک با خطا)", pattern: /کلیک با خطا/ },
  { name: "frustration (سرخوردگی)", pattern: /سرخوردگ/ },
  { name: "frustration (ناامیدی)", pattern: /ناامید/ },
];

function retiredIn(text: string): Array<string> {
  return RETIRED.filter((word: { name: string; pattern: RegExp }): boolean => {
    return word.pattern.test(text);
  }).map((word: { name: string }): string => {
    return word.name;
  });
}

const FA: Record<string, string> = JSON.parse(
  fs.readFileSync(LOCALE, "utf8"),
) as Record<string, string>;

function markdownUnder(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...markdownUnder(absolute));
    } else if (entry.name.endsWith(".md")) {
      found.push(absolute);
    }
  }

  return found.sort();
}

describe("Persian's frustration signal words", () => {
  test("the check finds each retired word (negative control)", () => {
    expect(retiredIn("کلیک خشمگین")).toEqual(["rage (خشمگین)"]);
    expect(retiredIn(persian("کلیک|های خشمگین / مرده / خطا"))).toEqual([
      "rage (خشمگین)",
      "dead click (مرده)",
    ]);
    expect(retiredIn("سرخوردگی بعدی")).toEqual(["frustration (سرخوردگی)"]);
    // A dead host is not a dead click, nor is a click that is counted.
    expect(retiredIn("اینستنس روی میزبان مرده")).toEqual([]);
    expect(retiredIn(persian("کلیک روی این|ها هرگز شمرده نشود"))).toEqual([]);
  });

  test("the settings page's names are the words", () => {
    expect(FA["Rage clicks"]).toBe(RAGE_PLURAL);
    expect(FA["Dead clicks"]).toBe(persian(`کلیک|های ${DEAD}`));
    expect(FA["Error clicks"]).toBe(persian("کلیک|های خطا"));
    expect(FA["Refresh rage"]).toBe(REFRESH_RAGE);
    expect(FA["Frustration"]).toBe(FRUSTRATION);
  });

  // English keys that name a signal.
  const NAMES_REFRESH_RAGE: RegExp = /\brefresh rages?\b/i;
  const NAMES_RAGE: RegExp = /\brage\b/i;
  const NAMES_DEAD_CLICK: RegExp = /\bdead clicks?\b/i;

  test("every line that names a signal names it with that word", () => {
    expect(FA["{{count}} rage clicks"]).toBe(`{{count}} ${RAGE}`);
    expect(FA["rage click"]).toBe(RAGE);
    expect(FA["{{count}} dead clicks"]).toBe(`{{count}} کلیک ${DEAD}`);
    expect(FA["{{count}} error clicks"]).toBe(`{{count}} ${ERROR_CLICK}`);
    expect(FA["{{count}} refresh rage"]).toBe(`{{count}} ${REFRESH_RAGE}`);
    expect(FA["{{count}} refresh rages"]).toBe(`{{count}} ${REFRESH_RAGE}`);
    expect(FA["Next frustration"]).toBe(`${FRUSTRATION} بعدی`);
    expect(FA["With frustration signals"]).toContain(FRUSTRATION);

    for (const key of Object.keys(FA)) {
      const value: string = FA[key] as string;

      if (typeof value !== "string") {
        continue;
      }

      if (NAMES_REFRESH_RAGE.test(key)) {
        expect({ key, value, says: value.includes(REFRESH_RAGE) }).toEqual({
          key,
          value,
          says: true,
        });
      } else if (NAMES_RAGE.test(key)) {
        expect({ key, value, says: value.includes("عصبی") }).toEqual({
          key,
          value,
          says: true,
        });
      }

      if (NAMES_DEAD_CLICK.test(key)) {
        expect({ key, value, says: value.includes(DEAD) }).toEqual({
          key,
          value,
          says: true,
        });
      }
    }
  });

  test("no Dashboard line uses a retired word", () => {
    const lines: Array<string> = Object.keys(FA).filter(
      (key: string): boolean => {
        return (
          typeof FA[key] === "string" && retiredIn(FA[key] as string).length > 0
        );
      },
    );

    expect(lines).toEqual([]);
  });

  test("no Persian docs page uses a retired word", () => {
    const pages: Array<string> = markdownUnder(PERSIAN_DOCS);

    expect(pages.length).toBeGreaterThan(0);

    const found: Array<{ page: string; line: number; words: Array<string> }> =
      [];

    for (const page of pages) {
      fs.readFileSync(page, "utf8")
        .split("\n")
        .forEach((line: string, index: number) => {
          const words: Array<string> = retiredIn(line);

          if (words.length > 0) {
            found.push({
              page: path.relative(PERSIAN_DOCS, page),
              line: index + 1,
              words: words,
            });
          }
        });
    }

    expect(found).toEqual([]);
  });

  test("the Session Replay docs name the signals with the Dashboard's words", () => {
    const page: string = fs.readFileSync(
      path.join(PERSIAN_DOCS, "telemetry/session-replay.md"),
      "utf8",
    );

    for (const word of [
      RAGE,
      DEAD,
      ERROR_CLICK,
      REFRESH_RAGE,
      `${FRUSTRATION} بعدی`,
    ]) {
      expect({ word, used: page.includes(word) }).toEqual({
        word,
        used: true,
      });
    }
  });
});
