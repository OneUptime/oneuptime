import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  drawLine,
  getDrawnText,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";

/*
 * THE DASHBOARD'S COUNT SENTENCES IN PERSIAN, AS THEIR PAGES FILL THEM.
 *
 * A Persian page drew seven of its count sentences in English - the IoT
 * fleet's "devices online" chip, the Fleets table's online column, the
 * Docker Swarm and Kubernetes ready and running cells, a monitor's "Attempt
 * 2/3" and a ping's "(3/5 received)" - and the incident AI log's task link
 * "کار #42" with its sign after its number ("42#"), unlike every other
 * Persian task, incident and alert number. Each is filled here from the
 * Dashboard's own fa.json the way its page fills it, and laid out with a
 * copy of the bidi algorithm (Helpers/BidiLayout) as a page with dir="rtl"
 * draws it: read from the right, the count pair first, as written, then the
 * Persian words.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const PERSIAN_WORDS: Record<string, unknown> = JSON.parse(
  fs.readFileSync(path.join(LOCALES, "fa.json"), "utf8"),
) as Record<string, unknown>;

const RLM: string = String.fromCharCode(0x200f);
const ZWNJ: string = String.fromCharCode(0x200c);

// The Dashboard's lookup: a key's Persian text, as useTranslator reads it.
const persian: Translator = createTranslator(
  (text: string): string | undefined => {
    const value: unknown = PERSIAN_WORDS[text];

    return typeof value === "string" ? value : undefined;
  },
  "fa",
);

// Characters a Persian sentence has no business holding.
const LATIN_LETTER: RegExp = /[A-Za-z]/;
const LATIN_DIGIT: RegExp = /[0-9]/;
const PERSIAN_DIGIT: RegExp = /[۰-۹]/;

const drawnFromTheRight: (line: string) => string = (line: string): string => {
  return getDrawnText(drawLine(line, "rtl"));
};

// Whether `piece`, where it first appears in `line`, is drawn as written in a page read from the right.
const readsAsWritten: (line: string, piece: string) => boolean = (
  line: string,
  piece: string,
): boolean => {
  const from: number = line.indexOf(piece);

  expect(from).toBeGreaterThanOrEqual(0);

  return isDrawnAsWritten(drawLine(line, "rtl"), from, from + piece.length);
};

const DEVICES_ONLINE: { one: string; other: string } = {
  one: "{{online}}/{{count}} device online",
  other: "{{online}}/{{count}} devices online",
};

describe("the IoT fleet's devices-online chip", () => {
  // Pages/IoT/View/Index.tsx: both counts in the reader's digits.
  test("reads in Persian, in Persian digits, the pair as written", () => {
    const chip: string = persian.translatePlural(DEVICES_ONLINE, 3, {
      online: persian.formatNumber(2),
    });

    expect(chip).toBe("۲/۳ دستگاه آنلاین");
    expect(LATIN_LETTER.test(chip)).toBe(false);
    expect(LATIN_DIGIT.test(chip)).toBe(false);
    expect(readsAsWritten(chip, "۲/۳")).toBe(true);
    expect(drawnFromTheRight(chip)).toBe("نیالنآ هاگتسد ۲/۳");
  });

  test("and in its one form, for a fleet of one device", () => {
    const chip: string = persian.translatePlural(DEVICES_ONLINE, 1, {
      online: persian.formatNumber(1),
    });

    expect(chip).toBe("۱/۱ دستگاه آنلاین");
    expect(drawnFromTheRight(chip)).toBe("نیالنآ هاگتسد ۱/۱");
  });

  /*
   * The negative control: the online count passed as a number goes into
   * the sentence in Latin digits, beside a total in Persian ones - the
   * chip read "2/۳", where every other count chip reads "۲/۳".
   */
  test("its online count passed as a plain number was drawn in Latin digits", () => {
    const chip: string = persian.translatePlural(DEVICES_ONLINE, 3, {
      online: 2,
    });

    expect(chip).toBe("2/۳ دستگاه آنلاین");
    expect(LATIN_DIGIT.test(chip) && PERSIAN_DIGIT.test(chip)).toBe(true);
  });
});

/*
 * The table cells and lines that pass their counts as numbers: both in
 * Latin digits, as the numbers in the columns beside them are.
 */
describe("count cells and lines filled with plain numbers", () => {
  const CASES: Array<{
    page: string;
    key: string;
    values: Record<string, number>;
    sentence: string;
    pair: string;
    drawn: string;
  }> = [
    {
      page: "IoT Fleets table, Online column",
      key: "{{online}}/{{total}} online",
      values: { online: 9, total: 10 },
      sentence: "9/10 آنلاین",
      pair: "9/10",
      drawn: "نیالنآ 9/10",
    },
    {
      page: "Docker Swarm clusters table, Nodes column; a Kubernetes deployment's Ready line",
      key: "{{ready}}/{{total}} ready",
      values: { ready: 3, total: 5 },
      sentence: "3/5 آماده",
      pair: "3/5",
      drawn: "هدامآ 3/5",
    },
    {
      page: "Docker Swarm clusters table, Tasks column",
      key: "{{running}}/{{total}} running",
      values: { running: 3, total: 5 },
      sentence: "3/5 در حال اجرا",
      pair: "3/5",
      drawn: "ارجا لاح رد 3/5",
    },
    {
      page: "a monitor's probe attempts",
      key: "Attempt {{number}}/{{total}}",
      values: { number: 2, total: 3 },
      sentence: "تلاش 2/3",
      pair: "2/3",
      drawn: "2/3 شالت",
    },
  ];

  for (const item of CASES) {
    test(`${item.page}: ${item.sentence}`, () => {
      const sentence: string = persian.translateTemplate(item.key, item.values);

      expect(sentence).toBe(item.sentence);
      expect(LATIN_LETTER.test(sentence)).toBe(false);
      expect(readsAsWritten(sentence, item.pair)).toBe(true);
      expect(drawnFromTheRight(sentence)).toBe(item.drawn);
    });
  }

  test("a ping's packet loss: the percent, then the count pair in its brackets", () => {
    const sentence: string = persian.translateTemplate(
      "{{percent}} ({{received}}/{{sent}} received)",
      { percent: "40%", received: 3, sent: 5 },
    );

    expect(sentence).toBe(`40% (3/5 دریافت${ZWNJ}شده)`);
    expect(LATIN_LETTER.test(sentence)).toBe(false);
    expect(readsAsWritten(sentence, "40%")).toBe(true);
    expect(readsAsWritten(sentence, "3/5")).toBe(true);

    const drawn: string = drawnFromTheRight(sentence);

    // From the right: the percent, the bracket, the pair, the word.
    expect(drawn.endsWith("40%")).toBe(true);
    expect(drawn.indexOf("3/5")).toBeLessThan(drawn.indexOf("40%"));
    expect(drawn.indexOf("هدش")).toBeLessThan(drawn.indexOf("3/5"));
  });
});

describe("the incident AI log's task link", () => {
  // IncidentAlertAiLogsPage.tsx fills it with the task's number.
  test("draws its sign in front of the number, as the task trail's link does: #42", () => {
    const link: string = persian.translateTemplate("Task #{{taskNumber}}", {
      taskNumber: 42,
    });
    const trail: string = persian.translateTemplate("Task #{{number}}", {
      number: 42,
    });

    expect(link).toBe(`وظیفه ${RLM}#42`);
    expect(readsAsWritten(link, "#42")).toBe(true);
    expect(drawnFromTheRight(link)).toBe("#42 هفیظو");
    expect(drawnFromTheRight(link)).toBe(drawnFromTheRight(trail));
  });

  test("in Persian digits too: #۴۲", () => {
    const link: string = persian.translateTemplate("Task #{{taskNumber}}", {
      taskNumber: persian.formatNumber(42),
    });

    expect(drawnFromTheRight(link)).toBe("#۴۲ هفیظو");
  });

  /*
   * The negative control: without the mark, after a Persian word, the
   * number is read as an Arabic number and the sign goes with the words -
   * the link was drawn "42#".
   */
  test("without the right-to-left mark it was drawn 42#", () => {
    expect(drawnFromTheRight("کار #42")).toBe("42# راک");
    expect(drawnFromTheRight("وظیفه #42")).toBe("42# هفیظو");
    expect(readsAsWritten("کار #42", "#42")).toBe(false);
  });
});

/*
 * Each sentence says what its translated siblings say, in their words:
 * "{{online}}/{{count}} گره آنلاین", "{{running}}/{{count}} در حال اجرا",
 * "تلاش {{number}}", "دریافت‌شده", "وظیفه #{{number}}".
 */
describe("in the words its siblings use", () => {
  const SIBLINGS: Array<[string, string, string]> = [
    [
      "{{online}}/{{count}} devices online",
      "{{online}}/{{count}} nodes online",
      "آنلاین",
    ],
    [
      "{{online}}/{{count}} devices online_one",
      "{{online}}/{{count}} nodes online",
      "آنلاین",
    ],
    ["{{online}}/{{total}} online", "Online", "آنلاین"],
    ["{{ready}}/{{total}} ready", "Ready", "آماده"],
    [
      "{{ready}}/{{total}} ready",
      "{{ready}}/{{count}} containers ready",
      "آماده",
    ],
    [
      "{{running}}/{{total}} running",
      "{{running}}/{{count}} running",
      "در حال اجرا",
    ],
    ["Attempt {{number}}/{{total}}", "Attempt {{number}}", "تلاش"],
    [
      "{{percent}} ({{received}}/{{sent}} received)",
      "Received",
      `دریافت${ZWNJ}شده`,
    ],
    ["Task #{{taskNumber}}", "Task #{{number}}", `وظیفه ${RLM}#`],
  ];

  for (const [key, sibling, word] of SIBLINGS) {
    test(`"${key}" says "${word}", as "${sibling}" does`, () => {
      expect(PERSIAN_WORDS[sibling]).toEqual(expect.stringContaining(word));
      expect(PERSIAN_WORDS[key]).toEqual(expect.stringContaining(word));
    });
  }
});
