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
import ObjectID from "../../../Types/ObjectID";
import { UptimeDayBucket } from "../../../Types/StatusPage/UptimeDailyAggregate";
import {
  MONITORING_OFF_BAR_CLASS_NAME,
  NO_DATA_BAR_CLASS_NAME,
} from "../../../Utils/StatusPage/HistoryChartBarColors";

/*
 * A STATUS PAGE'S BARS ON A DAY MONITORING WAS OFF (issue #7112).
 *
 * A resource whose monitoring is off reads Not monitored beside its name;
 * its history bars said "no data" for the days it was off, the same as a day
 * before the monitor existed - a planned pause read as a gap in monitoring.
 * Now a day it was off is drawn as one, and named and summed up in the
 * page's own word, Not monitored, in every language the status page speaks:
 * here in English and in Persian, which reads right to left.
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

const NOW: Date = new Date("2026-10-26T15:30:00.000Z");
const START: Date = new Date("2026-10-17T15:30:00.000Z");
const HOUR: number = 3600;

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
}): UptimeDayBucket {
  const start: Date = new Date(`${data.date}T00:00:00.000Z`);

  return {
    bucketStart: start,
    bucketEnd: new Date(start.getTime() + 24 * HOUR * 1000),
    daySeconds: 86400,
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
  };
}

// Off from noon on the 21st: the 21st in part, every day after it whole.
const BUCKETS: Array<UptimeDayBucket> = [
  bucket({ date: "2026-10-20", coveredSeconds: 86400 }),
  bucket({
    date: "2026-10-21",
    coveredSeconds: 12 * HOUR,
    monitoringOffSeconds: 12 * HOUR,
  }),
  bucket({
    date: "2026-10-22",
    coveredSeconds: 0,
    monitoringOffSeconds: 86400,
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
      isNotMonitored={true}
    />,
  );
}

function barOn(date: string): HTMLElement {
  const index: number = Math.round(
    (new Date(`${date}T00:00:00.000Z`).getTime() -
      new Date("2026-10-17T00:00:00.000Z").getTime()) /
      (24 * HOUR * 1000),
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

describe("every status page language words a day monitoring was off", () => {
  const KEYS: Array<string> = [
    "dayLabelMonitoringOff",
    "dayLabelMonitoringOffWithIncidents",
    "monitoringOffOnThisDay",
    "monitoringOffFor",
  ];

  test.each(LANGUAGES)("%s", (language: string) => {
    const words: Record<string, string> = historyWords(language);
    const english: Record<string, string> = historyWords("en");

    for (const key of KEYS) {
      expect({ key, worded: typeof words[key] === "string" }).toEqual({
        key,
        worded: true,
      });

      // The same placeholders as the English, each once.
      const placeholders: (text: string) => Array<string> = (
        text: string,
      ): Array<string> => {
        return (text.match(/\{\{\w+\}\}/g) || []).sort();
      };

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
    }
  });

  test("in the page's word for a resource nothing checks: Not monitored", () => {
    const english: Record<string, string> = historyWords("en");
    const notMonitored: string = (
      readLocale("en")["overview"] as unknown as Record<string, string>
    )["notMonitored"]!;

    expect(notMonitored).toBe("Not monitored");

    for (const key of [
      "dayLabelMonitoringOff",
      "monitoringOffOnThisDay",
      "monitoringOffFor",
    ]) {
      expect(english[key]!.toLowerCase()).toContain("not monitored");
    }
  });
});

describe("a resource's bars on the days its monitoring was off", () => {
  test("in English: the day off says Not monitored, the day off in part says for how long", async () => {
    renderResource();

    expect(screen.getByTestId("resource-not-monitored")).toHaveTextContent(
      "Not monitored",
    );

    const off: HTMLElement = barOn("2026-10-22");

    expect(off).toHaveClass(MONITORING_OFF_BAR_CLASS_NAME);
    expect(off).not.toHaveClass(NO_DATA_BAR_CLASS_NAME);
    expect(off).toHaveAttribute("aria-label", "Oct 22, 2026: not monitored");
    expect(await hover(off)).toHaveTextContent("Not monitored on this day");

    cleanup();
    renderResource();

    const part: HTMLElement = barOn("2026-10-21");

    expect(part).not.toHaveClass(MONITORING_OFF_BAR_CLASS_NAME);
    expect(part).toHaveAttribute("aria-label", "Oct 21, 2026: 100% uptime");
    expect(await hover(part)).toHaveTextContent("Not monitored for 12 hours");

    // A day before any of this is a day with data, as it always was.
    expect(barOn("2026-10-20")).not.toHaveClass(MONITORING_OFF_BAR_CLASS_NAME);
    // And a day nothing was recorded on is still no data.
    expect(barOn("2026-10-18")).toHaveClass(NO_DATA_BAR_CLASS_NAME);
  });

  test("in Persian, read right to left: the same days, in the page's words", async () => {
    document.documentElement.setAttribute("dir", "rtl");
    document.documentElement.setAttribute("lang", "fa");
    await act(async () => {
      await i18next.changeLanguage("fa");
    });

    const words: Record<string, string> = historyWords("fa");

    renderResource();

    const off: HTMLElement = barOn("2026-10-22");

    expect(off).toHaveClass(MONITORING_OFF_BAR_CLASS_NAME);
    expect(off.getAttribute("aria-label")).toBe(
      words["dayLabelMonitoringOff"]!.replace(
        "{{date}}",
        off.getAttribute("aria-label")!.split(":")[0]!,
      ),
    );
    expect(off.getAttribute("aria-label")).toContain("پایش نشده");

    const tooltip: HTMLElement = await hover(off);

    expect(tooltip).toHaveTextContent(words["monitoringOffOnThisDay"]!);
    // The tooltip reads the way the page does.
    expect(screen.getByTestId("uptime-bar-tooltip")).toHaveAttribute(
      "dir",
      "rtl",
    );

    cleanup();
    renderResource();

    await hover(barOn("2026-10-21"));

    const line: HTMLElement = screen.getByTestId(
      "uptime-day-monitoring-off-for",
    );
    const [before, after] = words["monitoringOffFor"]!.split("{{duration}}");

    expect(line.textContent!.startsWith(before!)).toBe(true);
    expect(line.textContent!.endsWith(after!)).toBe(true);
    expect(line.textContent).not.toContain("Not monitored");
  });
});
