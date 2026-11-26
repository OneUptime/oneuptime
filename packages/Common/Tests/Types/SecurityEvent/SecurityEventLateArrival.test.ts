import { describe, expect, test } from "@jest/globals";
import { DETECTION_LATE_EVENT_WINDOW_IN_MINUTES } from "../../../Types/SecurityEvent/DetectionFindingConstants";
import { DETECTION_RETROHUNT_PERIODS_IN_HOURS } from "../../../Types/SecurityEvent/DetectionRetrohunt";
import {
  SECURITY_EVENT_LATE_ARRIVAL_IN_SECONDS,
  SECURITY_EVENT_LATE_ARRIVAL_KEPT_DAYS,
  SECURITY_EVENT_LATE_ARRIVAL_NOTICE_DAYS,
  SecurityEventLateArrivals,
  getLateArrivalsHappenedFrom,
  getLateArrivalsRetrohuntPeriodInHours,
  getLateArrivalsSince,
  lateArrivalsToJSON,
  parseLateArrivals,
} from "../../../Types/SecurityEvent/SecurityEventLateArrival";

/*
 * Events that arrived more than a day after they happened (#10491): how
 * late counts, which week the notice reads, which period Run on Past Events
 * opens on, and the answer as the API sends it and the Dashboard reads it.
 */

const HOUR: number = 60 * 60 * 1000;

const LATE: SecurityEventLateArrivals = {
  arrivedSince: new Date("2026-11-14T00:00:00.000Z"),
  eventCount: 312,
  sources: [
    {
      vendorName: "Okta",
      productName: "Okta Workforce Identity",
      eventCount: 300,
      happenedFrom: new Date("2026-11-15T03:00:00.000Z"),
      happenedTo: new Date("2026-11-17T21:30:00.000Z"),
      arrivedFrom: new Date("2026-11-19T08:00:00.000Z"),
      arrivedTo: new Date("2026-11-19T08:40:00.000Z"),
    },
    {
      vendorName: "CrowdStrike",
      productName: "Falcon",
      eventCount: 12,
      happenedFrom: new Date("2026-11-12T10:00:00.000Z"),
      happenedTo: new Date("2026-11-12T11:00:00.000Z"),
      arrivedFrom: new Date("2026-11-14T09:00:00.000Z"),
      arrivedTo: new Date("2026-11-14T09:00:00.000Z"),
    },
  ],
};

describe("how late is too late for a rule's runs", () => {
  test("later than the day a run reads back, to the second", () => {
    expect(SECURITY_EVENT_LATE_ARRIVAL_IN_SECONDS).toBe(86400);
    expect(SECURITY_EVENT_LATE_ARRIVAL_IN_SECONDS).toBe(
      DETECTION_LATE_EVENT_WINDOW_IN_MINUTES * 60,
    );
  });

  test("the counts are kept as long as Run on Past Events reads back", () => {
    expect(SECURITY_EVENT_LATE_ARRIVAL_KEPT_DAYS * 24).toBe(
      Math.max(...DETECTION_RETROHUNT_PERIODS_IN_HOURS),
    );
  });
});

describe("getLateArrivalsSince", () => {
  test("today and the six days before it, from midnight UTC", () => {
    expect(SECURITY_EVENT_LATE_ARRIVAL_NOTICE_DAYS).toBe(7);
    expect(getLateArrivalsSince(new Date("2026-11-20T15:42:10.000Z"))).toEqual(
      new Date("2026-11-14T00:00:00.000Z"),
    );
    expect(getLateArrivalsSince(new Date("2026-11-20T00:00:00.000Z"))).toEqual(
      new Date("2026-11-14T00:00:00.000Z"),
    );
    expect(getLateArrivalsSince(new Date("2026-11-20T23:59:59.999Z"))).toEqual(
      new Date("2026-11-14T00:00:00.000Z"),
    );
  });

  test("across a month's end", () => {
    expect(getLateArrivalsSince(new Date("2026-12-03T10:00:00.000Z"))).toEqual(
      new Date("2026-11-27T00:00:00.000Z"),
    );
  });
});

describe("getLateArrivalsRetrohuntPeriodInHours", () => {
  const now: Date = new Date("2026-11-20T12:00:00.000Z");

  test("the shortest period that reaches back to the earliest of them", () => {
    expect(
      getLateArrivalsRetrohuntPeriodInHours({
        happenedFrom: new Date(now.getTime() - 20 * HOUR),
        now,
      }),
    ).toBe(24);
    expect(
      getLateArrivalsRetrohuntPeriodInHours({
        happenedFrom: new Date(now.getTime() - 24 * HOUR),
        now,
      }),
    ).toBe(24);
    expect(
      getLateArrivalsRetrohuntPeriodInHours({
        happenedFrom: new Date(now.getTime() - 25 * HOUR),
        now,
      }),
    ).toBe(168);
    expect(
      getLateArrivalsRetrohuntPeriodInHours({
        happenedFrom: new Date(now.getTime() - 9 * 24 * HOUR),
        now,
      }),
    ).toBe(720);
  });

  test("the longest when none reaches that far: what it can still check", () => {
    expect(
      getLateArrivalsRetrohuntPeriodInHours({
        happenedFrom: new Date(now.getTime() - 90 * 24 * HOUR),
        now,
      }),
    ).toBe(720);
  });

  test("always a period Run on Past Events offers", () => {
    for (const hoursBack of [1, 30, 200, 2000]) {
      expect(DETECTION_RETROHUNT_PERIODS_IN_HOURS).toContain(
        getLateArrivalsRetrohuntPeriodInHours({
          happenedFrom: new Date(now.getTime() - hoursBack * HOUR),
          now,
        }),
      );
    }
  });
});

describe("getLateArrivalsHappenedFrom", () => {
  test("the earliest of every source's", () => {
    expect(getLateArrivalsHappenedFrom(LATE)).toEqual(
      new Date("2026-11-12T10:00:00.000Z"),
    );
  });

  test("none when nothing arrived late", () => {
    expect(
      getLateArrivalsHappenedFrom({
        arrivedSince: LATE.arrivedSince,
        eventCount: 0,
        sources: [],
      }),
    ).toBeNull();
  });
});

describe("the answer, sent and read back", () => {
  test("round trips", () => {
    expect(parseLateArrivals(lateArrivalsToJSON(LATE))).toEqual(LATE);
  });

  test("dates travel as ISO strings", () => {
    expect(lateArrivalsToJSON(LATE)["arrivedSince"]).toBe(
      "2026-11-14T00:00:00.000Z",
    );
  });

  test("is not one when it has no day it reads from", () => {
    expect(parseLateArrivals(undefined)).toBeNull();
    expect(parseLateArrivals("late")).toBeNull();
    expect(parseLateArrivals([])).toBeNull();
    expect(parseLateArrivals({ eventCount: 3, sources: [] })).toBeNull();
  });

  test("a source without a count or a time is left out, and the total holds what is left", () => {
    const json: ReturnType<typeof lateArrivalsToJSON> =
      lateArrivalsToJSON(LATE);

    const parsed: SecurityEventLateArrivals | null = parseLateArrivals({
      arrivedSince: json["arrivedSince"]!,
      sources: [
        ...(json["sources"] as Array<never>),
        { productName: "No count", happenedFrom: "x" },
        "not a source",
      ],
    });

    expect(parsed?.sources).toHaveLength(2);
    expect(parsed?.eventCount).toBe(312);
  });

  test("a total the server sent above what the sources hold is kept", () => {
    expect(
      parseLateArrivals({ ...lateArrivalsToJSON(LATE), eventCount: 400 })
        ?.eventCount,
    ).toBe(400);
  });
});
