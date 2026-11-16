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
import { cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import MonitorOverview from "../../../../App/FeatureSet/StatusPage/src/Components/Monitor/MonitorOverview";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import { Green, Red } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import { MergedDowntimeTotals } from "../../../Types/StatusPage/MergedDowntimeTotals";
import ObjectID from "../../../Types/ObjectID";
import { UptimeDayBucket } from "../../../Types/StatusPage/UptimeDailyAggregate";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import UptimeUtil from "../../../Utils/Uptime/UptimeUtil";
import { NO_DATA_BAR_CLASS_NAME } from "../../../Utils/StatusPage/HistoryChartBarColors";

/*
 * A STATUS PAGE RESOURCE BEFORE ITS MONITOR'S FIRST CHECK (issue #8960).
 *
 * A monitor is created in the operational status, and until its first
 * check comes back nothing stands behind it: the server's day buckets leave
 * that time out now (MonitorStatusTimelineService), so its bars say "no
 * data" for it, not green, and its uptime is measured from the first check.
 * The rows the overview also ships still hold that time, in the status the
 * monitor was created in, so a figure from them would read it as up: the
 * page reads its buckets, and a reading that covers nothing is no figure at
 * all, never the rows' 100%.
 *
 * The real MonitorOverview with the real English locale; the buckets are
 * shaped as the server sends them.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/StatusPage/src/Locales",
);

const NOW: Date = new Date("2026-10-26T15:30:00.000Z");
const START: Date = new Date("2026-10-17T15:30:00.000Z");
const HOUR: number = 3600;
const DAY_MS: number = 24 * HOUR * 1000;

const OPERATIONAL_ID: string = "e8960000-0000-4000-8000-000000000001";
const OFFLINE_ID: string = "e8960000-0000-4000-8000-000000000003";

// The first check came back on the 22nd at 06:00.
const FIRST_CHECK: Date = new Date("2026-10-22T06:00:00.000Z");

function operationalStatus(): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = OPERATIONAL_ID;
  status.name = "Operational";
  status.color = Green;
  status.priority = 1;
  status.isOperationalState = true;
  return status;
}

function offlineStatus(): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = OFFLINE_ID;
  status.name = "Offline";
  status.color = Red;
  status.priority = 3;
  status.isOperationalState = false;
  status.isOfflineState = true;
  return status;
}

function bucket(data: {
  date: string;
  operationalSeconds: number;
  offlineSeconds?: number | undefined;
}): UptimeDayBucket {
  const start: Date = new Date(`${data.date}T00:00:00.000Z`);
  const offline: number = data.offlineSeconds || 0;

  return {
    bucketStart: start,
    bucketEnd: new Date(start.getTime() + DAY_MS),
    daySeconds: 86400,
    coveredSeconds: data.operationalSeconds + offline,
    statusDurations: [
      ...(data.operationalSeconds > 0
        ? [
            {
              monitorStatusId: new ObjectID(OPERATIONAL_ID),
              seconds: data.operationalSeconds,
            },
          ]
        : []),
      ...(offline > 0
        ? [{ monitorStatusId: new ObjectID(OFFLINE_ID), seconds: offline }]
        : []),
    ],
  };
}

// Nothing before the first check; then up, with one hour Offline on the 24th.
const BUCKETS: Array<UptimeDayBucket> = [
  ...["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"].map(
    (date: string): UptimeDayBucket => {
      return bucket({ date, operationalSeconds: 0 });
    },
  ),
  bucket({ date: "2026-10-22", operationalSeconds: 18 * HOUR }),
  bucket({ date: "2026-10-23", operationalSeconds: 24 * HOUR }),
  bucket({
    date: "2026-10-24",
    operationalSeconds: 23 * HOUR,
    offlineSeconds: HOUR,
  }),
  bucket({ date: "2026-10-25", operationalSeconds: 24 * HOUR }),
  bucket({ date: "2026-10-26", operationalSeconds: 15.5 * HOUR }),
];

const NO_DATA_BUCKETS: Array<UptimeDayBucket> = BUCKETS.map(
  (day: UptimeDayBucket): UptimeDayBucket => {
    return { ...day, coveredSeconds: 0, statusDurations: [] };
  },
);

/*
 * The rows the overview ships: the row the monitor was created in, on the
 * 10th, open, and the Offline hour on the 24th. They hold the time before
 * the first check, in the status it was created in.
 */
function rows(): Array<MonitorStatusTimeline> {
  const make: (data: {
    status: MonitorStatus;
    startsAt: string;
    endsAt?: string | undefined;
  }) => MonitorStatusTimeline = (data: {
    status: MonitorStatus;
    startsAt: string;
    endsAt?: string | undefined;
  }): MonitorStatusTimeline => {
    const row: MonitorStatusTimeline = new MonitorStatusTimeline();
    row.monitorId = new ObjectID("e8960000-0000-4000-8000-0000000000aa");
    row.monitorStatusId = new ObjectID(data.status._id!);
    row.monitorStatus = data.status;
    row.startsAt = new Date(data.startsAt);

    if (data.endsAt) {
      row.endsAt = new Date(data.endsAt);
    }

    return row;
  };

  return [
    make({
      status: operationalStatus(),
      startsAt: "2026-10-10T09:00:00.000Z",
      endsAt: "2026-10-24T10:00:00.000Z",
    }),
    make({
      status: offlineStatus(),
      startsAt: "2026-10-24T10:00:00.000Z",
      endsAt: "2026-10-24T11:00:00.000Z",
    }),
    make({ status: operationalStatus(), startsAt: "2026-10-24T11:00:00.000Z" }),
  ];
}

function renderResource(data: {
  uptimeBuckets?: Array<UptimeDayBucket> | undefined;
  mergedDowntime?: MergedDowntimeTotals | undefined;
  currentStatus?: MonitorStatus | undefined;
}): void {
  render(
    <MonitorOverview
      monitorName="Checkout API"
      currentStatus={data.currentStatus || operationalStatus()}
      monitorStatusTimeline={rows()}
      startDate={START}
      endDate={NOW}
      showHistoryChart={true}
      showCurrentStatus={true}
      showUptimePercent={true}
      uptimePrecision={UptimePrecision.THREE_DECIMAL}
      statusPageHistoryChartBarColorRules={[]}
      downtimeMonitorStatuses={[offlineStatus()]}
      uptimeBuckets={data.uptimeBuckets}
      mergedDowntime={data.mergedDowntime}
      uptimeTimezone="UTC"
      monitorStatuses={[operationalStatus(), offlineStatus()]}
      defaultBarColor={new Color("#10B981")}
      uptimeHistoryDays={10}
      isNotMonitored={false}
    />,
  );
}

function barOn(date: string): HTMLElement {
  const index: number = Math.round(
    (new Date(`${date}T00:00:00.000Z`).getTime() -
      new Date("2026-10-17T00:00:00.000Z").getTime()) /
      DAY_MS,
  );

  return screen.getAllByTestId("uptime-bar")[index] as HTMLElement;
}

// What the rows would read: the window measured from the row it was created in.
function uptimeFromTheRows(): number {
  return UptimeUtil.calculateUptimePercentage(
    rows(),
    UptimePrecision.THREE_DECIMAL,
    [offlineStatus()],
    { startDate: START, endDate: NOW },
  );
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: {
        translation: JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
        ) as JSONObject,
      },
    },
    interpolation: { escapeValue: false },
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

describe("a status page resource before its monitor's first check (issue #8960)", () => {
  test("its bars before the first check say no data, never the green of a day up", () => {
    renderResource({ uptimeBuckets: BUCKETS });

    for (const date of ["2026-10-17", "2026-10-19", "2026-10-21"]) {
      expect(barOn(date)).toHaveClass(NO_DATA_BAR_CLASS_NAME);
      expect(barOn(date).getAttribute("aria-label")).toContain("no data");
    }

    // The day of the first check is measured over the hours since it.
    expect(barOn("2026-10-22")).not.toHaveClass(NO_DATA_BAR_CLASS_NAME);
    expect(barOn("2026-10-22")).toHaveAttribute(
      "aria-label",
      "Oct 22, 2026: 100% uptime",
    );
    expect(barOn("2026-10-24").getAttribute("aria-label")).toContain(
      "95.83% uptime",
    );
  });

  test("its uptime is measured from the first check, not from the row it was created in", () => {
    renderResource({ uptimeBuckets: BUCKETS });

    // One Offline hour in the hours since the first check.
    const measuredSeconds: number =
      (NOW.getTime() - FIRST_CHECK.getTime()) / 1000;
    const fromTheFirstCheck: number = UptimeUtil.roundToPrecision({
      number: ((measuredSeconds - HOUR) / measuredSeconds) * 100,
      precision: UptimePrecision.THREE_DECIMAL,
    });

    expect(fromTheFirstCheck).toBe(99.052);
    expect(uptimeFromTheRows()).not.toBe(fromTheFirstCheck);

    expect(
      screen.getByText(`${fromTheFirstCheck}% uptime`),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(`${uptimeFromTheRows()}% uptime`),
    ).not.toBeInTheDocument();
  });

  test("a reading that covers nothing is no uptime, not the rows' figure", () => {
    /*
     * Every day measured and nothing to count: its first check has not
     * come back. Its row may still show a status something else recorded.
     */
    renderResource({
      uptimeBuckets: NO_DATA_BUCKETS,
      currentStatus: operationalStatus(),
    });

    expect(screen.getByText("— uptime")).toBeInTheDocument();
    expect(
      screen.queryByText(`${uptimeFromTheRows()}% uptime`),
    ).not.toBeInTheDocument();

    for (const bar of screen.getAllByTestId("uptime-bar")) {
      expect(bar).toHaveClass(NO_DATA_BAR_CLASS_NAME);
    }
  });

  test("so is a monitor group's merged figure that covers nothing", () => {
    renderResource({
      mergedDowntime: { coveredSeconds: 0, downtimeSeconds: 0 },
    });

    expect(screen.getByText("— uptime")).toBeInTheDocument();
  });

  test("a page from a server with no reading at all still reads the rows, as before", () => {
    renderResource({});

    expect(
      screen.getByText(`${uptimeFromTheRows()}% uptime`),
    ).toBeInTheDocument();
  });
});
