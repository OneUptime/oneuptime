import {
  SECURITY_EVENTS_ARRIVED_AFTER_PARAM,
  SECURITY_EVENTS_ARRIVED_UNTIL_PARAM,
  SECURITY_EVENT_ARRIVAL_QUERY_KEY,
  SECURITY_EVENT_MAX_FUTURE_SKEW_IN_MINUTES,
  SecurityEventArrivalRange,
  floorToSecond,
  getArrivalEventTimeBounds,
  readSecurityEventArrivalRange,
  readSecurityEventArrivalRangeFromSearch,
  toSecurityEventArrivalQueryValue,
} from "../../../Types/SecurityEvent/SecurityEventArrival";
import { DETECTION_LATE_EVENT_WINDOW_IN_MINUTES } from "../../../Types/SecurityEvent/DetectionFindingConstants";
import { MAX_SECURITY_EVENT_FUTURE_SKEW_IN_MINUTES } from "../../../Server/Utils/SecurityEvent/SecurityEventRow";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT ARRIVED, AND WHEN IT MAY HAVE HAPPENED (#10488): the range a
 * scheduled hunt counts and the Events page opens a run on, shared by the
 * server and the Dashboard. A range is (arrivedAfter, arrivedUntil], whole
 * seconds as createdAt is, and a range that cannot be read is no range at
 * all: a read carrying one matches nothing, never everything.
 */

const MINUTE: number = 60 * 1000;
const AFTER: Date = new Date("2026-10-29T10:58:00.000Z");
const UNTIL: Date = new Date("2026-10-29T11:58:00.000Z");

describe("the key and the names a range travels under", () => {
  test("its own query key and the address's two params", () => {
    expect(SECURITY_EVENT_ARRIVAL_QUERY_KEY).toBe("securityEventArrival");
    expect(SECURITY_EVENTS_ARRIVED_AFTER_PARAM).toBe("arrivedAfter");
    expect(SECURITY_EVENTS_ARRIVED_UNTIL_PARAM).toBe("arrivedUntil");
  });

  test("the skew a source's clock may run ahead is the one ingest allows", () => {
    expect(SECURITY_EVENT_MAX_FUTURE_SKEW_IN_MINUTES).toBe(
      MAX_SECURITY_EVENT_FUTURE_SKEW_IN_MINUTES,
    );
  });
});

describe("a whole second, as createdAt keeps it", () => {
  test("drops what is past the second, and leaves a whole one as it is", () => {
    expect(floorToSecond(new Date("2026-10-29T10:58:00.999Z"))).toEqual(
      new Date("2026-10-29T10:58:00.000Z"),
    );
    expect(floorToSecond(AFTER)).toEqual(AFTER);
  });
});

describe("when the events of a range may have happened", () => {
  test("a day before the first arrived, to the skew past the last and a minute more", () => {
    expect(
      getArrivalEventTimeBounds({ arrivedAfter: AFTER, arrivedUntil: UNTIL }),
    ).toEqual({
      happenedAfter: new Date(
        AFTER.getTime() - DETECTION_LATE_EVENT_WINDOW_IN_MINUTES * MINUTE,
      ),
      happenedBefore: new Date(
        UNTIL.getTime() +
          (SECURITY_EVENT_MAX_FUTURE_SKEW_IN_MINUTES + 1) * MINUTE,
      ),
    });
  });
});

describe("a range read from an untrusted query or address", () => {
  test("two moments, as Dates or ISO strings, on whole seconds", () => {
    expect(
      readSecurityEventArrivalRange({
        arrivedAfter: "2026-10-29T10:58:00.400Z",
        arrivedUntil: UNTIL,
      }),
    ).toEqual({ arrivedAfter: AFTER, arrivedUntil: UNTIL });
  });

  test("survives the trip as a query carries it", () => {
    const range: SecurityEventArrivalRange = {
      arrivedAfter: AFTER,
      arrivedUntil: UNTIL,
    };
    const carried: { arrivedAfter: string; arrivedUntil: string } =
      toSecurityEventArrivalQueryValue(range);

    expect(carried).toEqual({
      arrivedAfter: "2026-10-29T10:58:00.000Z",
      arrivedUntil: "2026-10-29T11:58:00.000Z",
    });
    expect(
      readSecurityEventArrivalRange(JSON.parse(JSON.stringify(carried))),
    ).toEqual(range);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "2026-10-29T10:58:00.000Z"],
    ["a list", [AFTER, UNTIL]],
    ["a number", 7],
    ["no start", { arrivedUntil: UNTIL }],
    ["no end", { arrivedAfter: AFTER }],
    ["a start that is no date", { arrivedAfter: "soon", arrivedUntil: UNTIL }],
    ["an end that is no date", { arrivedAfter: AFTER, arrivedUntil: "" }],
    [
      "a date that is not one",
      { arrivedAfter: new Date("nope"), arrivedUntil: UNTIL },
    ],
    ["numbers", { arrivedAfter: 1, arrivedUntil: 2 }],
    ["an empty range", { arrivedAfter: UNTIL, arrivedUntil: UNTIL }],
    [
      "one within a second",
      {
        arrivedAfter: "2026-10-29T10:58:00.100Z",
        arrivedUntil: "2026-10-29T10:58:00.900Z",
      },
    ],
    ["a range turned round", { arrivedAfter: UNTIL, arrivedUntil: AFTER }],
  ])("%s is no range", (_label: string, value: unknown) => {
    expect(readSecurityEventArrivalRange(value)).toBeNull();
  });
});

describe("a range an address names", () => {
  test("its two params, as a hunt's link writes them", () => {
    expect(
      readSecurityEventArrivalRangeFromSearch(
        `?range=Custom&${SECURITY_EVENTS_ARRIVED_AFTER_PARAM}=${encodeURIComponent(AFTER.toISOString())}&${SECURITY_EVENTS_ARRIVED_UNTIL_PARAM}=${encodeURIComponent(UNTIL.toISOString())}`,
      ),
    ).toEqual({ arrivedAfter: AFTER, arrivedUntil: UNTIL });
  });

  test("an address with none, half of one, or one that is not one names none", () => {
    expect(readSecurityEventArrivalRangeFromSearch("")).toBeNull();
    expect(
      readSecurityEventArrivalRangeFromSearch("?range=Custom&start=x&end=y"),
    ).toBeNull();
    expect(
      readSecurityEventArrivalRangeFromSearch(
        `?${SECURITY_EVENTS_ARRIVED_AFTER_PARAM}=${AFTER.toISOString()}`,
      ),
    ).toBeNull();
    expect(
      readSecurityEventArrivalRangeFromSearch(
        `?${SECURITY_EVENTS_ARRIVED_AFTER_PARAM}=later&${SECURITY_EVENTS_ARRIVED_UNTIL_PARAM}=${UNTIL.toISOString()}`,
      ),
    ).toBeNull();
  });
});
