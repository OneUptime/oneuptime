/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
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
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import MonitorOverview from "../../../../App/FeatureSet/StatusPage/src/Components/Monitor/MonitorOverview";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import { Green } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import MonitorPausedBy from "../../../Types/Monitor/MonitorPausedBy";
import ObjectID from "../../../Types/ObjectID";
import { UptimeDayBucket } from "../../../Types/StatusPage/UptimeDailyAggregate";
import { MONITORING_OFF_BAR_CLASS_NAME } from "../../../Utils/StatusPage/HistoryChartBarColors";

/*
 * A STATUS PAGE'S BARS ON THE DAYS A PAUSE LEFT OUT OF UPTIME (issue #11433).
 *
 * Time a scheduled maintenance event, or an incident declared by hand,
 * paused with no status set is left out of a resource's uptime and bars. A
 * day it filled read "Not monitored", as a day the monitor was turned off
 * does - even when the day's dialog listed the maintenance event that paused
 * it. It reads as paused now, and why: "paused for scheduled maintenance",
 * "paused by an incident", or both - in every language the status page
 * speaks, on the bar's name, its tooltip and the dialog a day opens. A day
 * the monitor was turned off still reads Not monitored.
 *
 * The real MonitorOverview with the real locale files; the buckets are the
 * server's, as the overview hands them on.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/StatusPage/src/Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  });

function readLocale(language: string): JSONObject {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as JSONObject;
}

function historyWords(language: string): Record<string, string> {
  return readLocale(language)["uptimeHistory"] as unknown as Record<
    string,
    string
  >;
}

const PAUSED_KEYS: Array<string> = [
  "dayLabelPausedByIncident",
  "dayLabelPausedByIncidentWithIncidents",
  "dayLabelPausedForMaintenance",
  "dayLabelPausedForMaintenanceWithIncidents",
  "dayLabelPausedByIncidentAndMaintenance",
  "dayLabelPausedByIncidentAndMaintenanceWithIncidents",
  "pausedByIncidentOnThisDay",
  "pausedForMaintenanceOnThisDay",
  "pausedByIncidentAndMaintenanceOnThisDay",
  "pausedByIncidentFor",
  "pausedForMaintenanceFor",
  "pausedByIncidentAndMaintenanceFor",
];

const NOW: Date = new Date("2026-10-26T15:30:00.000Z");
const START: Date = new Date("2026-10-17T15:30:00.000Z");
const HOUR: number = 3600;
const DAY: number = 24 * HOUR;

const OPERATIONAL_ID: string = "e8100000-0000-4000-8000-000000000001";

function operationalStatus(): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = OPERATIONAL_ID;
  status.name = "Operational";
  status.color = Green;
  status.priority = 1;
  status.isOperationalState = true;
  return status;
}

function bucket(data: {
  date: string;
  coveredSeconds: number;
  monitoringOffSeconds?: number | undefined;
  pausedSeconds?: number | undefined;
  pausedBy?: MonitorPausedBy | undefined;
}): UptimeDayBucket {
  const start: Date = new Date(`${data.date}T00:00:00.000Z`);

  return {
    bucketStart: start,
    bucketEnd: new Date(start.getTime() + DAY * 1000),
    daySeconds: DAY,
    coveredSeconds: data.coveredSeconds,
    statusDurations:
      data.coveredSeconds > 0
        ? [
            {
              monitorStatusId: new ObjectID(OPERATIONAL_ID),
              seconds: data.coveredSeconds,
            },
          ]
        : [],
    ...(data.monitoringOffSeconds !== undefined
      ? { monitoringOffSeconds: data.monitoringOffSeconds }
      : {}),
    ...(data.pausedSeconds !== undefined
      ? { pausedSeconds: data.pausedSeconds, pausedBy: data.pausedBy }
      : {}),
  };
}

/*
 * The 21st paused for maintenance all day, the 22nd by an incident, the 23rd
 * by both, the 24th checked for 18 hours and paused for maintenance for the
 * rest, the 25th turned off.
 */
const BUCKETS: Array<UptimeDayBucket> = [
  bucket({
    date: "2026-10-21",
    coveredSeconds: 0,
    monitoringOffSeconds: DAY,
    pausedSeconds: DAY,
    pausedBy: MonitorPausedBy.ScheduledMaintenance,
  }),
  bucket({
    date: "2026-10-22",
    coveredSeconds: 0,
    monitoringOffSeconds: DAY,
    pausedSeconds: DAY,
    pausedBy: MonitorPausedBy.Incident,
  }),
  bucket({
    date: "2026-10-23",
    coveredSeconds: 0,
    monitoringOffSeconds: DAY,
    pausedSeconds: DAY,
    pausedBy: MonitorPausedBy.IncidentAndScheduledMaintenance,
  }),
  bucket({
    date: "2026-10-24",
    coveredSeconds: 18 * HOUR,
    monitoringOffSeconds: 6 * HOUR,
    pausedSeconds: 6 * HOUR,
    pausedBy: MonitorPausedBy.ScheduledMaintenance,
  }),
  bucket({
    date: "2026-10-25",
    coveredSeconds: 0,
    monitoringOffSeconds: DAY,
  }),
];

function renderResource(): void {
  render(
    <MonitorOverview
      monitorName="Checkout API"
      currentStatus={operationalStatus()}
      monitorStatusTimeline={[]}
      startDate={START}
      endDate={NOW}
      showHistoryChart={true}
      showCurrentStatus={true}
      showUptimePercent={false}
      statusPageHistoryChartBarColorRules={[]}
      downtimeMonitorStatuses={[]}
      uptimeBuckets={BUCKETS}
      uptimeTimezone="UTC"
      monitorStatuses={[operationalStatus()]}
      defaultBarColor={new Color("#10B981")}
      uptimeHistoryDays={9}
    />,
  );
}

function barOn(date: string): HTMLElement {
  const index: number = Math.round(
    (new Date(`${date}T00:00:00.000Z`).getTime() -
      new Date("2026-10-17T00:00:00.000Z").getTime()) /
      (DAY * 1000),
  );

  return screen.getAllByTestId("uptime-bar")[index] as HTMLElement;
}

async function hover(bar: HTMLElement): Promise<HTMLElement> {
  fireEvent.mouseEnter(bar);

  await act(async () => {
    jest.advanceTimersByTime(200);
  });

  return screen.getByRole("tooltip");
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

function expectFilled(text: string, label: string): void {
  for (const part of fixedParts(label)) {
    expect({ text, part, holds: text.includes(part) }).toEqual({
      text,
      part,
      holds: true,
    });
  }
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
  await i18next.changeLanguage("en");
});

describe("every status page language words a paused day", () => {
  test("the status page speaks the languages the Dashboard does, and English", () => {
    expect(LANGUAGES.length).toBe(18);
    expect(LANGUAGES).toContain("en");
  });

  test.each(LANGUAGES)(
    "%s: each label worded, with English's placeholders",
    (language: string) => {
      const words: Record<string, string> = historyWords(language);
      const english: Record<string, string> = historyWords("en");

      const placeholders: (text: string) => Array<string> = (
        text: string,
      ): Array<string> => {
        return (text.match(/\{\{\w+\}\}/g) || []).sort();
      };

      for (const key of PAUSED_KEYS) {
        expect({
          key,
          worded:
            typeof words[key] === "string" && words[key]!.trim().length > 0,
        }).toEqual({
          key,
          worded: true,
        });
        expect({ key, placeholders: placeholders(words[key]!) }).toEqual({
          key,
          placeholders: placeholders(english[key]!),
        });

        if (language !== "en") {
          expect({ key, translated: words[key] !== english[key] }).toEqual({
            key,
            translated: true,
          });
        }

        // A pause is not "not monitored": no paused label takes that word.
        expect({
          key,
          saysNotMonitored: words[key] === words["monitoringOffOnThisDay"],
        }).toEqual({ key, saysNotMonitored: false });
      }

      // Three reasons, three different sentences.
      expect(
        new Set([
          words["pausedByIncidentOnThisDay"],
          words["pausedForMaintenanceOnThisDay"],
          words["pausedByIncidentAndMaintenanceOnThisDay"],
        ]).size,
      ).toBe(3);
    },
  );

  test("in English, paused and why, never not monitored", () => {
    const english: Record<string, string> = historyWords("en");

    for (const key of PAUSED_KEYS) {
      expect(english[key]!.toLowerCase()).toContain("paused");
      expect(english[key]!.toLowerCase()).not.toContain("not monitored");
    }
  });
});

describe.each(LANGUAGES)(
  "a resource's bars on its paused days, in %s",
  (language: string) => {
    beforeEach(async () => {
      if (language === "fa" || language === "ar") {
        document.documentElement.setAttribute("dir", "rtl");
      }

      document.documentElement.setAttribute("lang", language);

      await act(async () => {
        await i18next.changeLanguage(language);
      });
    });

    test("each paused day is named for what paused it, and a day turned off still reads not monitored", () => {
      const words: Record<string, string> = historyWords(language);

      renderResource();

      const cases: Array<[string, string]> = [
        ["2026-10-21", "dayLabelPausedForMaintenance"],
        ["2026-10-22", "dayLabelPausedByIncident"],
        ["2026-10-23", "dayLabelPausedByIncidentAndMaintenance"],
        ["2026-10-25", "dayLabelMonitoringOff"],
      ];

      for (const [date, key] of cases) {
        const bar: HTMLElement = barOn(date);

        // Left out of uptime, drawn as such.
        expect(bar).toHaveClass(MONITORING_OFF_BAR_CLASS_NAME);
        expectFilled(bar.getAttribute("aria-label") || "", words[key]!);
      }

      expect(barOn("2026-10-21")).toHaveAttribute(
        "data-paused-by",
        MonitorPausedBy.ScheduledMaintenance,
      );
      expect(barOn("2026-10-25")).not.toHaveAttribute("data-paused-by");
    });

    test("the tooltip says the day was paused, and why", async () => {
      const words: Record<string, string> = historyWords(language);

      renderResource();

      const tooltip: HTMLElement = await hover(barOn("2026-10-22"));

      expect(
        within(tooltip).getByTestId("uptime-day-paused"),
      ).toHaveTextContent(words["pausedByIncidentOnThisDay"]!);
      expect(tooltip).not.toHaveTextContent(words["monitoringOffOnThisDay"]!);
    });

    test("the day dialog says the same, and for how long a part of a day was paused", async () => {
      const words: Record<string, string> = historyWords(language);

      renderResource();

      fireEvent.click(barOn("2026-10-23"));

      const dialog: HTMLElement = await screen.findByRole("dialog");
      expect(within(dialog).getByTestId("uptime-day-paused")).toHaveTextContent(
        words["pausedByIncidentAndMaintenanceOnThisDay"]!,
      );

      cleanup();
      renderResource();

      fireEvent.click(barOn("2026-10-24"));

      const partDialog: HTMLElement = await screen.findByRole("dialog");
      expectFilled(
        within(partDialog).getByTestId("uptime-day-paused-for").textContent ||
          "",
        words["pausedForMaintenanceFor"]!,
      );
    });
  },
);
