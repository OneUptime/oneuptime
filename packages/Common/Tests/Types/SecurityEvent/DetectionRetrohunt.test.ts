import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  DETECTION_RETROHUNT_DEFAULT_PERIOD_IN_HOURS,
  DETECTION_RETROHUNT_MAX_GROUPS,
  DETECTION_RETROHUNT_NOISY_FIRINGS_PER_DAY,
  DETECTION_RETROHUNT_PERIODS_IN_HOURS,
  DetectionRetrohuntResult,
  detectionRetrohuntResultToJSON,
  getDetectionRetrohuntFiringsPerDay,
  isDetectionRetrohuntNoisy,
  isDetectionRetrohuntPeriod,
  parseDetectionRetrohuntResult,
} from "../../../Types/SecurityEvent/DetectionRetrohunt";

/*
 * RETROHUNT: WHAT A RULE WOULD HAVE FOUND ON PAST EVENTS.
 *
 * The answer's shape is shared by the server, which runs it, and the
 * Dashboard, which draws it: the periods a run reads, how busy is too busy,
 * and an answer that survives the trip through JSON - read defensively, so
 * a field the server left out reads as nothing rather than throwing.
 */

function result(
  overrides: Partial<DetectionRetrohuntResult> = {},
): DetectionRetrohuntResult {
  return {
    startTime: new Date("2026-10-20T12:00:00.000Z"),
    endTime: new Date("2026-10-27T12:00:00.000Z"),
    periodInHours: 168,
    isCorrelation: false,
    windowInMinutes: 5,
    threshold: 3,
    firedCount: 42,
    groupCount: 3,
    eventCount: 900,
    matchedEventCount: 1204,
    exceptionCount: 2,
    skippedEventCount: 310,
    preventedFiredCount: 12,
    groups: [
      {
        value: "alice@example.com",
        entityType: "User",
        firedCount: 30,
        eventCount: 700,
        firstFiredAt: new Date("2026-10-21T03:05:00.000Z"),
        lastFiredAt: new Date("2026-10-27T09:40:00.000Z"),
        sampleMessage: "Failed sign-in for alice@example.com",
        summary: "",
      },
    ],
    hasMoreGroups: false,
    candidateLimit: null,
    ...overrides,
  };
}

describe("the periods a run reads", () => {
  test("the last day, week and month, a week to start with", () => {
    expect(DETECTION_RETROHUNT_PERIODS_IN_HOURS).toEqual([24, 168, 720]);
    expect(DETECTION_RETROHUNT_DEFAULT_PERIOD_IN_HOURS).toBe(168);
    expect(
      DETECTION_RETROHUNT_PERIODS_IN_HOURS.includes(
        DETECTION_RETROHUNT_DEFAULT_PERIOD_IN_HOURS,
      ),
    ).toBe(true);
  });

  test("only those periods are periods", () => {
    for (const hours of DETECTION_RETROHUNT_PERIODS_IN_HOURS) {
      expect(isDetectionRetrohuntPeriod(hours)).toBe(true);
    }

    expect(isDetectionRetrohuntPeriod(48)).toBe(false);
    expect(isDetectionRetrohuntPeriod("168")).toBe(false);
    expect(isDetectionRetrohuntPeriod(168.5)).toBe(false);
    expect(isDetectionRetrohuntPeriod(undefined)).toBe(false);
  });

  test("an answer lists at most 50 groups", () => {
    expect(DETECTION_RETROHUNT_MAX_GROUPS).toBe(50);
  });
});

describe("how busy is too busy", () => {
  test("firings a day, to one decimal place", () => {
    expect(getDetectionRetrohuntFiringsPerDay(result())).toBe(6);
    expect(
      getDetectionRetrohuntFiringsPerDay(
        result({ firedCount: 10, periodInHours: 720 }),
      ),
    ).toBe(0.3);
    expect(
      getDetectionRetrohuntFiringsPerDay(
        result({ firedCount: 7, periodInHours: 24 }),
      ),
    ).toBe(7);
    expect(
      getDetectionRetrohuntFiringsPerDay(
        result({ firedCount: 0, periodInHours: 168 }),
      ),
    ).toBe(0);
  });

  test("a period shorter than a day counts as one", () => {
    expect(
      getDetectionRetrohuntFiringsPerDay(
        result({ firedCount: 5, periodInHours: 1 }),
      ),
    ).toBe(5);
  });

  test("more than 20 a day is more than a person can look at", () => {
    expect(DETECTION_RETROHUNT_NOISY_FIRINGS_PER_DAY).toBe(20);
    expect(
      isDetectionRetrohuntNoisy(result({ firedCount: 140, periodInHours: 168 })),
    ).toBe(false);
    expect(
      isDetectionRetrohuntNoisy(result({ firedCount: 141, periodInHours: 168 })),
    ).toBe(true);
    expect(
      isDetectionRetrohuntNoisy(result({ firedCount: 21, periodInHours: 24 })),
    ).toBe(true);
  });
});

describe("an answer through JSON", () => {
  test("round-trips whole", () => {
    const answer: DetectionRetrohuntResult = result({
      candidateLimit: 500,
      hasMoreGroups: true,
    });

    const json: JSONObject = JSON.parse(
      JSON.stringify(detectionRetrohuntResultToJSON(answer)),
    );

    expect(parseDetectionRetrohuntResult(json)).toEqual(answer);
  });

  test("dates travel as ISO text, and nulls stay null", () => {
    const json: JSONObject = detectionRetrohuntResultToJSON(
      result({
        isCorrelation: true,
        threshold: null,
        matchedEventCount: null,
        skippedEventCount: null,
        preventedFiredCount: null,
        groups: [
          {
            value: "10.0.0.5",
            entityType: "IP Address",
            firedCount: 1,
            eventCount: 6,
            firstFiredAt: null,
            lastFiredAt: null,
            sampleMessage: "",
            summary: "5 failed sign-ins, then a success",
          },
        ],
      }),
    );

    expect(json["startTime"]).toBe("2026-10-20T12:00:00.000Z");
    expect(json["threshold"]).toBeNull();
    expect(json["matchedEventCount"]).toBeNull();
    expect(json["skippedEventCount"]).toBeNull();
    expect((json["groups"] as Array<JSONObject>)[0]!["firstFiredAt"]).toBeNull();

    const parsed: DetectionRetrohuntResult = parseDetectionRetrohuntResult(json);

    expect(parsed.threshold).toBeNull();
    expect(parsed.matchedEventCount).toBeNull();
    expect(parsed.skippedEventCount).toBeNull();
    expect(parsed.preventedFiredCount).toBeNull();
    expect(parsed.groups[0]!.summary).toBe("5 failed sign-ins, then a success");
  });

  test("an empty answer reads as nothing found, never as a throw", () => {
    expect(parseDetectionRetrohuntResult({})).toEqual({
      startTime: new Date(0),
      endTime: new Date(0),
      periodInHours: 0,
      isCorrelation: false,
      windowInMinutes: 0,
      threshold: null,
      firedCount: 0,
      groupCount: 0,
      eventCount: 0,
      matchedEventCount: null,
      exceptionCount: 0,
      skippedEventCount: null,
      preventedFiredCount: null,
      groups: [],
      hasMoreGroups: false,
      candidateLimit: null,
    });
  });

  test("odd values read as the nearest sensible thing", () => {
    const parsed: DetectionRetrohuntResult = parseDetectionRetrohuntResult({
      firedCount: "7",
      eventCount: "lots",
      isCorrelation: "yes",
      hasMoreGroups: 1,
      startTime: "not a date",
      groups: [
        null,
        "a group",
        [],
        {
          value: 42,
          firedCount: "3",
          lastFiredAt: "2026-10-27T09:40:00.000Z",
        },
      ],
    } as unknown as JSONObject);

    expect(parsed.firedCount).toBe(7);
    expect(parsed.eventCount).toBe(0);
    expect(parsed.isCorrelation).toBe(false);
    expect(parsed.hasMoreGroups).toBe(false);
    expect(parsed.startTime.getTime()).toBe(0);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0]).toEqual({
      value: "",
      entityType: "",
      firedCount: 3,
      eventCount: 0,
      firstFiredAt: null,
      lastFiredAt: new Date("2026-10-27T09:40:00.000Z"),
      sampleMessage: "",
      summary: "",
    });
  });
});
