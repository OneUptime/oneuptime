/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import { initReactI18next } from "react-i18next";
import React from "react";
import { LEFT_OUT_LEGEND_NAMES } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorUptimeHistoryCard";
import {
  MAINTENANCE_PAUSE_MESSAGES,
  PAUSED_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/DisabledWarning";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import { Green } from "../../../Types/BrandColors";
import MonitorPausedBy from "../../../Types/Monitor/MonitorPausedBy";
import UptimeHistoryLabels, {
  DefaultUptimeHistoryLabels,
  getUptimeHistoryLabels,
} from "../../../Types/Monitor/UptimeHistoryLabels";
import { Translator } from "../../../Types/Translator";
import DayUptimeGraph, {
  DayReading,
  MONITORING_OFF_BAR_CLASS_NAME,
} from "../../../UI/Components/Graphs/DayUptimeGraph";
import MonitoringOffIndicator, {
  getMonitoringOffIndicatorText,
  MONITORING_OFF_TEXT,
  PAUSED_BY_TEXTS,
  PAUSED_TEXT,
} from "../../../UI/Components/StateTimeline/MonitoringOffIndicator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * PAUSED TIME, IN EVERY LANGUAGE THE DASHBOARD SHIPS (issue #11433).
 *
 * Time an incident declared by hand, or scheduled maintenance, paused a
 * monitor's checks with no status set is left out of its uptime, as time
 * with monitoring turned off is, and read "monitoring off" everywhere: the
 * monitor's uptime strip and the dialog a day opens, its Status Timeline's
 * pills, bands and legend, and the banner across its pages. It says paused
 * now, and why - and "monitoring off" stays for a monitor turned off.
 *
 * Every one of those words is a key of the Dashboard's locales, worded in
 * each of its 17 translations with the English's placeholders, and the
 * words for the reasons differ from one another and from monitoring off in
 * every language. The strip passed no labels at all before, so it read
 * English in every language; it reads the reader's now
 * (getUptimeHistoryLabels), here in German, Persian and Arabic.
 */

const BAND_TEMPLATES: Array<string> = [
  "{{status}}, paused, since {{start}}, {{duration}} so far. Currently Active.",
  "{{status}}, paused, {{start}} – {{end}}, {{duration}}",
];

const MONITORING_OFF_BAND_TEMPLATES: Array<string> = [
  "{{status}}, monitoring off, since {{start}}, {{duration}} so far. Currently Active.",
  "{{status}}, monitoring off, {{start}} – {{end}}, {{duration}}",
];

const CARD_DESCRIPTION: string =
  "One bar per day for the last 90 days, in your time zone. Grey bars are days with no data, or with monitoring off or paused.";

const PAUSED_BY_COLUMN_TITLE: string =
  new MonitorStatusTimeline().getTableColumnMetadata("pausedBy")
    .title as string;

/*
 * Whether a text has words of its own: "{{label}}, {{maintenance}}", which
 * joins a day's name and its maintenance, has none, and is no key.
 */
const LETTER: RegExp = /\p{L}/u;

function hasWords(text: string): boolean {
  return LETTER.test(text.replace(/\{\{\w+\}\}/g, ""));
}

// Every word the Dashboard says of paused time, by where it is said.
const WORDS: Record<string, Array<string>> = {
  "the uptime strip and its dialog": Object.values(
    DefaultUptimeHistoryLabels,
  ).filter(hasWords),
  "the uptime card": [
    CARD_DESCRIPTION,
    ...Object.values(LEFT_OUT_LEGEND_NAMES),
  ],
  "the Status Timeline": [
    PAUSED_TEXT,
    ...Object.values(PAUSED_BY_TEXTS),
    ...BAND_TEMPLATES,
    PAUSED_BY_COLUMN_TITLE,
  ],
  "the banner": [PAUSED_TITLE, ...Object.values(MAINTENANCE_PAUSE_MESSAGES)],
};

const ALL_WORDS: Array<string> = Array.from(
  new Set(Object.values(WORDS).flat()),
);

function wordIn(language: string, english: string): string {
  return readDashboardLocale(language)[english] as string;
}

describe("the words for paused time are the Dashboard's", () => {
  test("each a key of the English locale, worded as itself", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(PAUSED_BY_COLUMN_TITLE).toBe("Paused By");
    expect(ALL_WORDS.length).toBeGreaterThanOrEqual(48);

    // The card's description and the bands' templates, as their sources say them.
    expect(
      fs
        .readFileSync(
          path.resolve(
            __dirname,
            "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorUptimeHistoryCard.tsx",
          ),
          "utf8",
        )
        .replace(/\s+/g, " "),
    ).toContain(`translationKey( "${CARD_DESCRIPTION}", )`);

    const band: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../UI/Components/StatusTimeline/StatusTimelineBand.tsx",
      ),
      "utf8",
    );

    for (const template of [
      ...BAND_TEMPLATES,
      ...MONITORING_OFF_BAND_TEMPLATES,
    ]) {
      expect(band).toContain(`"${template}"`);
    }

    for (const key of ALL_WORDS) {
      expect({ key, value: english[key] }).toEqual({ key, value: key });
    }
  });

  test("in English: paused, never monitoring off, and the pause's reason", () => {
    expect(PAUSED_BY_TEXTS).toEqual({
      [MonitorPausedBy.Incident]: "Paused by Incident",
      [MonitorPausedBy.ScheduledMaintenance]: "Paused for Maintenance",
      [MonitorPausedBy.IncidentAndScheduledMaintenance]:
        "Paused by Incident and Maintenance",
    });
    expect(getMonitoringOffIndicatorText(null)).toBe(MONITORING_OFF_TEXT);
    expect(MONITORING_OFF_TEXT).toBe("Monitoring Off");

    for (const field of [
      "dayLabelPausedByIncident",
      "dayLabelPausedForMaintenance",
      "dayLabelPausedByIncidentAndMaintenance",
      "pausedByIncidentOnThisDay",
      "pausedForMaintenanceOnThisDay",
      "pausedByIncidentAndMaintenanceOnThisDay",
      "pausedByIncidentFor",
      "pausedForMaintenanceFor",
      "pausedByIncidentAndMaintenanceFor",
    ] as Array<keyof UptimeHistoryLabels>) {
      const label: string = DefaultUptimeHistoryLabels[field];

      expect(label.toLowerCase()).toContain("paused");
      expect(label.toLowerCase()).not.toContain("monitoring off");
      expect(label.toLowerCase()).not.toContain("monitoring was off");
    }
  });
});

describe.each(DASHBOARD_LANGUAGES)("in %s", (language: string) => {
  test.each(Object.keys(WORDS))(
    "%s: every word worded, with the English's placeholders",
    (where: string) => {
      for (const english of WORDS[where]!) {
        const value: string | undefined = wordIn(language, english);

        expect({
          english,
          worded: isWordedInDashboardLocale(english, language),
        }).toEqual({ english, worded: true });
        expect({ english, placeholders: placeholdersOf(value || "") }).toEqual({
          english,
          placeholders: placeholdersOf(english),
        });
      }
    },
  );

  test("each reason is worded apart, and none as monitoring off", () => {
    const distinct: (keys: Array<string>) => number = (
      keys: Array<string>,
    ): number => {
      return new Set(
        keys.map((key: string): string => {
          return wordIn(language, key);
        }),
      ).size;
    };

    // The pill: three reasons and monitoring off.
    expect(
      distinct([...Object.values(PAUSED_BY_TEXTS), MONITORING_OFF_TEXT]),
    ).toBe(4);

    // A day's name, and what its tooltip and dialog say of it.
    expect(
      distinct([
        DefaultUptimeHistoryLabels.dayLabelPausedByIncident,
        DefaultUptimeHistoryLabels.dayLabelPausedForMaintenance,
        DefaultUptimeHistoryLabels.dayLabelPausedByIncidentAndMaintenance,
        DefaultUptimeHistoryLabels.dayLabelMonitoringOff,
        DefaultUptimeHistoryLabels.dayLabelNoData,
      ]),
    ).toBe(5);
    expect(
      distinct([
        DefaultUptimeHistoryLabels.pausedByIncidentOnThisDay,
        DefaultUptimeHistoryLabels.pausedForMaintenanceOnThisDay,
        DefaultUptimeHistoryLabels.pausedByIncidentAndMaintenanceOnThisDay,
        DefaultUptimeHistoryLabels.monitoringOffOnThisDay,
        DefaultUptimeHistoryLabels.noMonitoringData,
      ]),
    ).toBe(5);
    expect(
      distinct([
        DefaultUptimeHistoryLabels.pausedByIncidentFor,
        DefaultUptimeHistoryLabels.pausedForMaintenanceFor,
        DefaultUptimeHistoryLabels.pausedByIncidentAndMaintenanceFor,
        DefaultUptimeHistoryLabels.monitoringOffFor,
      ]),
    ).toBe(4);

    // The legend, the bands and the banner.
    expect(distinct(Object.values(LEFT_OUT_LEGEND_NAMES))).toBe(3);
    expect(
      distinct([BAND_TEMPLATES[1]!, MONITORING_OFF_BAND_TEMPLATES[1]!]),
    ).toBe(2);
    expect(distinct(Object.values(MAINTENANCE_PAUSE_MESSAGES))).toBe(3);
  });

  test("the strip's labels come in the language, filled as the strip fills them", () => {
    const translator: Translator = dashboardTranslator(language);
    const labels: UptimeHistoryLabels = getUptimeHistoryLabels(translator);

    for (const field of Object.keys(DefaultUptimeHistoryLabels) as Array<
      keyof UptimeHistoryLabels
    >) {
      const english: string = DefaultUptimeHistoryLabels[field];

      if (!hasWords(english)) {
        continue;
      }

      // The language's own words, or the English it keeps on purpose.
      expect({
        field,
        worded:
          labels[field] !== english ||
          isWordedInDashboardLocale(english, language),
      }).toEqual({
        field,
        worded: true,
      });
      expect({ field, placeholders: placeholdersOf(labels[field]) }).toEqual({
        field,
        placeholders: placeholdersOf(english),
      });
    }

    // English is what a language that had not worded a label would show.
    expect(labels.pausedForMaintenanceOnThisDay).not.toBe(
      DefaultUptimeHistoryLabels.pausedForMaintenanceOnThisDay,
    );
  });

  test("a Status Timeline band held by a pause says paused, in the language", () => {
    const translator: Translator = dashboardTranslator(language);
    const values: Record<string, string> = {
      status: "Operational",
      start: "START",
      end: "END",
      duration: "DURATION",
    };

    for (const [paused, off] of [
      [BAND_TEMPLATES[0]!, MONITORING_OFF_BAND_TEMPLATES[0]!],
      [BAND_TEMPLATES[1]!, MONITORING_OFF_BAND_TEMPLATES[1]!],
    ]) {
      const text: string = translator.translateTemplate(paused!, values);

      // Each value the template takes, filled in.
      for (const [name, value] of Object.entries(values)) {
        if (paused!.includes(`{{${name}}}`)) {
          expect(text).toContain(value);
        }
      }

      expect(text).not.toBe(translator.translateTemplate(off!, values));
      expect(text).not.toContain(", paused,");
    }
  });
});

/*
 * On the page, through the Dashboard's i18next and its translator: the
 * strip, its tooltip and the pill, in German and in the two languages that
 * read right to left.
 */
const PAGE_LANGUAGES: ReadonlyArray<string> = ["de", "fa", "ar"];

const NOW: Date = new Date("2026-10-26T15:30:00.000Z");
const START: Date = new Date("2026-10-17T15:30:00.000Z");
const HOUR: number = 3600;
const DAY: number = 24 * HOUR;

function reading(data: {
  date: string;
  coveredSeconds: number;
  monitoringOffSeconds?: number | undefined;
  pausedSeconds?: number | undefined;
  pausedBy?: MonitorPausedBy | undefined;
}): DayReading {
  return {
    dayStart: new Date(`${data.date}T00:00:00.000Z`),
    daySeconds: DAY,
    coveredSeconds: data.coveredSeconds,
    statusDurations:
      data.coveredSeconds > 0
        ? [
            {
              label: "Operational",
              seconds: data.coveredSeconds,
              color: Green,
              isDowntime: false,
              priority: 1,
            },
          ]
        : [],
    monitoringOffSeconds: data.monitoringOffSeconds,
    pausedSeconds: data.pausedSeconds,
    pausedBy: data.pausedBy,
  };
}

// Oct 21 paused for maintenance, Oct 22 by an incident, Oct 23 turned off.
const READINGS: Array<DayReading> = [
  reading({
    date: "2026-10-21",
    coveredSeconds: 0,
    monitoringOffSeconds: DAY,
    pausedSeconds: DAY,
    pausedBy: MonitorPausedBy.ScheduledMaintenance,
  }),
  reading({
    date: "2026-10-22",
    coveredSeconds: 0,
    monitoringOffSeconds: DAY,
    pausedSeconds: DAY,
    pausedBy: MonitorPausedBy.Incident,
  }),
  reading({
    date: "2026-10-23",
    coveredSeconds: 0,
    monitoringOffSeconds: DAY,
  }),
];

function barOn(date: string): HTMLElement {
  const index: number = Math.round(
    (new Date(`${date}T00:00:00.000Z`).getTime() -
      new Date("2026-10-17T00:00:00.000Z").getTime()) /
      (DAY * 1000),
  );

  return screen.getAllByTestId("uptime-bar")[index] as HTMLElement;
}

// The parts of a label around its placeholders, each of which a filled label holds.
function fixedParts(label: string): Array<string> {
  return label
    .split(/\{\{\w+\}\}/)
    .map((part: string): string => {
      return part.trim();
    })
    .filter((part: string): boolean => {
      return part.length > 0;
    });
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      ["en", ...PAGE_LANGUAGES].map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

afterAll(async () => {
  await inLanguage("en");
});

describe.each(PAGE_LANGUAGES)(
  "the strip and the pill on the page, in %s",
  (language: string) => {
    beforeEach(async () => {
      await inLanguage(language);
    });

    test("a paused day is named and summed up in the language, a day turned off too", async () => {
      const labels: UptimeHistoryLabels = getUptimeHistoryLabels(
        dashboardTranslator(language),
      );

      render(
        <DayUptimeGraph
          startDate={START}
          endDate={NOW}
          timezone="UTC"
          events={[]}
          defaultBarColor={Green}
          height={10}
          dayReadings={READINGS}
          labels={labels}
        />,
      );

      for (const [date, label] of [
        ["2026-10-21", labels.dayLabelPausedForMaintenance],
        ["2026-10-22", labels.dayLabelPausedByIncident],
        ["2026-10-23", labels.dayLabelMonitoringOff],
      ] as Array<[string, string]>) {
        const bar: HTMLElement = barOn(date);
        const name: string = bar.getAttribute("aria-label") || "";

        expect(bar).toHaveClass(MONITORING_OFF_BAR_CLASS_NAME);

        for (const part of fixedParts(label)) {
          expect({ date, name, part, holds: name.includes(part) }).toEqual({
            date,
            name,
            part,
            holds: true,
          });
        }

        expect(name.toLowerCase()).not.toContain("paused");
        expect(name.toLowerCase()).not.toContain("monitoring off");
      }

      fireEvent.mouseEnter(barOn("2026-10-21"));

      await act(async () => {
        jest.advanceTimersByTime(200);
      });

      const tooltip: HTMLElement = screen.getByRole("tooltip");

      expect(
        within(tooltip).getByTestId("uptime-day-paused"),
      ).toHaveTextContent(labels.pausedForMaintenanceOnThisDay);
      expect(tooltip.textContent || "").not.toContain("Monitoring was");
    });

    test("the Status Timeline's pill says what paused it, and monitoring off for one turned off", () => {
      const reasons: Array<MonitorPausedBy | null> = [
        MonitorPausedBy.Incident,
        MonitorPausedBy.ScheduledMaintenance,
        MonitorPausedBy.IncidentAndScheduledMaintenance,
        null,
      ];

      for (const pausedBy of reasons) {
        render(<MonitoringOffIndicator pausedBy={pausedBy} />);

        const pill: HTMLElement = screen.getByTestId(
          "monitoring-off-indicator",
        );

        expect(pill).toHaveTextContent(
          wordIn(language, getMonitoringOffIndicatorText(pausedBy)),
        );
        expect(pill.textContent || "").not.toMatch(/Paused|Monitoring Off/);

        cleanup();
      }
    });
  },
);
