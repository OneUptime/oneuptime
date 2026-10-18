import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import RestrictionTimesFieldElement from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/RestrictionTimesFieldElement";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";

/*
 * The From: and To: labels over a layer's on-call hours, in each language.
 *
 * Only time fields draw them - a layer's restriction hours and the shared
 * date range - yet nine languages had them as an email's sender and
 * recipient: Japanese read 差出人: (sender) and 宛先: (addressee) over two
 * clocks, German An:, Russian Кому: (to whom), Chinese 收件人 (recipient).
 * Each now names the start and the end of a window, and the error for a
 * window that starts when it ends names the two fields the way the form
 * labels them. The three choices above them - No Restrictions, Specific
 * Times of the Day, Specific Times of the Week - were drawn in English in
 * every language; they are now in the reader's, as the error names them.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);
const COMMON_UI: string = path.resolve(__dirname, "../../../UI");
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const SAME_TIME_ERROR: string =
  "From and To cannot be the same time. Choose a longer window, or No Restrictions to be on call around the clock.";

interface TimeLabels {
  from: string;
  to: string;
}

// The start and the end of a window, as each language labels them.
const TIME_LABELS: Record<string, TimeLabels> = {
  de: { from: "Von:", to: "Bis:" },
  fr: { from: "De :", to: "À :" },
  es: { from: "Desde:", to: "Hasta:" },
  it: { from: "Da:", to: "A:" },
  pt: { from: "De:", to: "Até:" },
  nl: { from: "Van:", to: "Tot:" },
  da: { from: "Fra:", to: "Til:" },
  no: { from: "Fra:", to: "Til:" },
  sv: { from: "Från:", to: "Till:" },
  ru: { from: "От:", to: "До:" },
  ja: { from: "開始：", to: "終了：" },
  ko: { from: "시작:", to: "종료:" },
  "zh-CN": { from: "开始：", to: "结束：" },
  "zh-TW": { from: "開始：", to: "結束：" },
  hi: { from: "से:", to: "तक:" },
  fa: { from: "از:", to: "تا:" },
};

// An email's sender and recipient - what the labels used to say.
const ADDRESS_WORDS: Array<string> = [
  "An:",
  "Para:",
  "Aan:",
  "Кому:",
  "差出人:",
  "宛先:",
  "보낸 사람:",
  "받는 사람:",
  "收件人：",
  "收件者：",
  "來自:",
  "प्रति:",
  "به:",
];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

// A label without its colon, ASCII or full-width, as a sentence names it.
function bareLabel(label: string): string {
  let bare: string = label.trim();

  while (bare.endsWith(":") || bare.endsWith("：")) {
    bare = bare.slice(0, -1).trim();
  }

  return bare;
}

// Every .ts/.tsx file under `root`, locale files and node_modules left out.
function sourceFiles(root: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "Locales") {
      continue;
    }

    const full: string = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }

  return files;
}

function dailyRestriction(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Daily;
  restrictionTimes.dayRestrictionTimes = {
    startTime: new Date("2026-09-23T09:00:00.000Z"),
    endTime: new Date("2026-09-23T17:00:00.000Z"),
  };
  restrictionTimes.weeklyRestrictionTimes = [];
  return restrictionTimes;
}

function weeklyRestriction(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Weekly;
  restrictionTimes.dayRestrictionTimes = null;
  restrictionTimes.weeklyRestrictionTimes = [
    {
      startDay: DayOfWeek.Monday,
      endDay: DayOfWeek.Friday,
      startTime: new Date("2026-09-21T09:00:00.000Z"),
      endTime: new Date("2026-09-25T17:00:00.000Z"),
    },
    {
      startDay: DayOfWeek.Saturday,
      endDay: DayOfWeek.Sunday,
      startTime: new Date("2026-09-26T10:00:00.000Z"),
      endTime: new Date("2026-09-27T12:00:00.000Z"),
    },
  ];
  return restrictionTimes;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: readLocale("de") },
      ja: { translation: readLocale("ja") },
      en: { translation: readLocale("en") },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

describe("the From: and To: labels name the start and end of a window", () => {
  test("only time fields draw them: a layer's hours and the date range", () => {
    const users: Array<string> = [
      ...sourceFiles(DASHBOARD_SRC),
      ...sourceFiles(COMMON_UI),
    ]
      .filter((file: string) => {
        const code: string = fs.readFileSync(file, "utf8");
        return code.includes('"From:"') || code.includes('"To:"');
      })
      .map((file: string) => {
        return path.basename(file);
      })
      .sort();

    expect(users).toEqual([
      "RestrictionTimesFieldElement.tsx",
      "StartAndEndDate.tsx",
    ]);
  });

  test.each(Object.keys(TIME_LABELS))(
    "%s labels them as times, not as an email's sender and recipient",
    (locale: string) => {
      const strings: Record<string, string> = readLocale(locale);

      expect(strings["From:"]).toBe(TIME_LABELS[locale]!.from);
      expect(strings["To:"]).toBe(TIME_LABELS[locale]!.to);
      expect(ADDRESS_WORDS).not.toContain(strings["From:"]);
      expect(ADDRESS_WORDS).not.toContain(strings["To:"]);
    },
  );

  test("English keeps From: and To:", () => {
    const strings: Record<string, string> = readLocale("en");

    expect(strings["From:"]).toBe("From:");
    expect(strings["To:"]).toBe("To:");
  });

  test.each(Object.keys(TIME_LABELS))(
    "%s names both fields in the same-time error the way the form labels them",
    (locale: string) => {
      const sentence: string | undefined = readLocale(locale)[SAME_TIME_ERROR];

      expect(sentence).toBeDefined();
      expect(sentence).not.toBe(SAME_TIME_ERROR);
      expect(sentence).toContain(bareLabel(TIME_LABELS[locale]!.from));
      expect(sentence).toContain(bareLabel(TIME_LABELS[locale]!.to));
      // And the choice that is on call around the clock, as the radio names it.
      expect(sentence).toContain(readLocale(locale)["No Restrictions"]);
    },
  );

  test("the same-time error is the one the layer form gives", () => {
    const form: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Components/OnCallPolicy/OnCallScheduleLayer/LayerConfigForm.tsx",
      ),
      "utf8",
    );

    expect(form).toContain(`"${SAME_TIME_ERROR}"`);
  });
});

describe("a layer's restriction hours, drawn in the reader's language", () => {
  test("Japanese reads 開始： and 終了： over the two clocks of a daily window", async () => {
    await act(async () => {
      await i18next.changeLanguage("ja");
    });

    render(
      <RestrictionTimesFieldElement
        value={dailyRestriction()}
        timezone="UTC"
      />,
    );

    expect(screen.getAllByText("開始：")).toHaveLength(1);
    expect(screen.getAllByText("終了：")).toHaveLength(1);
    expect(screen.queryByText("差出人:")).not.toBeInTheDocument();
    expect(screen.queryByText("宛先:")).not.toBeInTheDocument();
  });

  test("Japanese and German name the three choices in their own words", async () => {
    for (const [language, choices] of [
      ["ja", ["制限なし", "1 日の特定の時刻", "1 週間の特定の時刻"]],
      [
        "de",
        [
          "Keine Einschränkungen",
          "Bestimmte Tageszeiten",
          "Bestimmte Zeiten der Woche",
        ],
      ],
    ] as Array<[string, Array<string>]>) {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      const view: ReturnType<typeof render> = render(
        <RestrictionTimesFieldElement
          value={dailyRestriction()}
          timezone="UTC"
        />,
      );

      for (const choice of choices) {
        expect(screen.getByRole("radio", { name: choice })).toBeInTheDocument();
      }

      expect(screen.queryByText("No Restrictions")).not.toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: choices[1] as string }),
      ).toBeChecked();
      view.unmount();
    }
  });

  test("German reads Von: and Bis: on every weekly window", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    render(
      <RestrictionTimesFieldElement
        value={weeklyRestriction()}
        timezone="UTC"
      />,
    );

    expect(screen.getAllByText("Von:")).toHaveLength(2);
    expect(screen.getAllByText("Bis:")).toHaveLength(2);
    expect(screen.queryByText("An:")).not.toBeInTheDocument();
  });

  test("English still reads From: and To:", () => {
    render(
      <RestrictionTimesFieldElement
        value={dailyRestriction()}
        timezone="UTC"
      />,
    );

    expect(screen.getAllByText("From:")).toHaveLength(1);
    expect(screen.getAllByText("To:")).toHaveLength(1);
  });
});
