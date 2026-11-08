import { describe, expect, test } from "@jest/globals";
import {
  SERVICE_NO_RECENT_DATA_AFTER_MINUTES,
  SERVICE_NO_RECENT_DATA_AFTER_MS,
  SERVICE_NO_RECENT_DATA_DESCRIPTION,
  SERVICE_NO_RECENT_DATA_LABEL,
  SERVICE_RECEIVING_DATA_DESCRIPTION,
  SERVICE_RECEIVING_DATA_LABEL,
  SERVICE_WAITING_FOR_DATA_DESCRIPTION,
  SERVICE_WAITING_FOR_DATA_LABEL,
  ServiceTelemetryStatus,
  ServiceTelemetryStatusDescription,
  ServiceTelemetryStatusWords,
  describeServiceTelemetryStatus,
  getServiceLastDataAt,
  getServiceTelemetryStatus,
  getServiceTelemetryStatusWords,
  isServiceDataRecent,
} from "../../../Types/Service/ServiceTelemetryStatus";
import {
  RUM_APPLICATION_RECEIVING_DATA_LABEL,
  RUM_APPLICATION_WAITING_FOR_DATA_LABEL,
} from "../../../Types/Rum/RumApplicationStatus";
import {
  SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_LABEL,
  SERVERLESS_FUNCTION_RECEIVING_DATA_LABEL,
  SERVERLESS_FUNCTION_WAITING_FOR_DATA_LABEL,
} from "../../../Types/Serverless/ServerlessFunctionStatus";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * What a service's status says (issue #6270): Receiving data while its
 * telemetry arrives, No recent data once nothing has for 30 minutes - grey,
 * because a service that sends spans only while it handles requests is
 * quiet whenever nobody calls it - and Waiting for data before its first
 * telemetry. Never "Disconnected", in amber, after half an hour of quiet.
 *
 * The status is read from lastSeenAt and the reader's clock, so this pins
 * the window at its edges - exactly 30 minutes, a millisecond either side -
 * dates in the future and dates that are not dates, the words, and a sweep
 * of drawn records held to an independent reading of the rules.
 */

const NOW: Date = new Date("2026-11-08T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function ago(milliseconds: number): Date {
  return new Date(NOW.getTime() - milliseconds);
}

function statusAt(
  lastSeenAt: Date | string | null | undefined,
  now: Date = NOW,
): ServiceTelemetryStatus {
  return getServiceTelemetryStatus({ lastSeenAt, now });
}

const ALL_STATUSES: Array<ServiceTelemetryStatus> = [
  ServiceTelemetryStatus.ReceivingData,
  ServiceTelemetryStatus.NoRecentData,
  ServiceTelemetryStatus.WaitingForData,
];

describe("the window", () => {
  test("is 30 minutes, in minutes and in milliseconds", () => {
    expect(SERVICE_NO_RECENT_DATA_AFTER_MINUTES).toBe(30);
    expect(SERVICE_NO_RECENT_DATA_AFTER_MS).toBe(30 * MINUTE);
  });

  test("data that arrived exactly 30 minutes ago is still receiving: the window includes its end", () => {
    expect(statusAt(ago(30 * MINUTE))).toBe(
      ServiceTelemetryStatus.ReceivingData,
    );
  });

  test("a millisecond inside the window is receiving", () => {
    expect(statusAt(ago(30 * MINUTE - 1))).toBe(
      ServiceTelemetryStatus.ReceivingData,
    );
  });

  test("a millisecond past it is no recent data", () => {
    expect(statusAt(ago(30 * MINUTE + 1))).toBe(
      ServiceTelemetryStatus.NoRecentData,
    );
  });

  test("data that arrived just now, a minute ago or 29 minutes ago is receiving", () => {
    for (const age of [0, 1, MINUTE, 5 * MINUTE, 29 * MINUTE]) {
      expect({ age, status: statusAt(ago(age)) }).toEqual({
        age,
        status: ServiceTelemetryStatus.ReceivingData,
      });
    }
  });

  test("31 minutes, three hours, a day and a year ago are no recent data", () => {
    for (const age of [
      31 * MINUTE,
      3 * 60 * MINUTE,
      24 * 60 * MINUTE,
      365 * 24 * 60 * MINUTE,
    ]) {
      expect({ age, status: statusAt(ago(age)) }).toEqual({
        age,
        status: ServiceTelemetryStatus.NoRecentData,
      });
    }
  });

  /*
   * The server writes lastSeenAt with its own clock; a reader's clock that
   * runs behind it sees the newest data arrive "in the future". That is as
   * recent as data gets.
   */
  test("a last data ahead of the reader's clock is receiving", () => {
    for (const ahead of [1, 30 * 1000, 30 * MINUTE + 1, 24 * 60 * MINUTE]) {
      expect({
        ahead,
        status: statusAt(new Date(NOW.getTime() + ahead)),
      }).toEqual({ ahead, status: ServiceTelemetryStatus.ReceivingData });
    }
  });

  test("the last data is read from a Date or from the API's ISO string, alike", () => {
    for (const age of [0, 30 * MINUTE, 30 * MINUTE + 1, 3 * 60 * MINUTE]) {
      expect(statusAt(ago(age).toISOString())).toBe(statusAt(ago(age)));
    }
  });

  test("a reader's clock that is not a date counts nothing as recent", () => {
    expect(statusAt(ago(0), new Date(NaN))).toBe(
      ServiceTelemetryStatus.NoRecentData,
    );
    // Never seen stays never seen.
    expect(statusAt(undefined, new Date(NaN))).toBe(
      ServiceTelemetryStatus.WaitingForData,
    );
  });
});

describe("never seen", () => {
  test("a service with no last data is waiting for data", () => {
    expect(statusAt(undefined)).toBe(ServiceTelemetryStatus.WaitingForData);
    expect(statusAt(null)).toBe(ServiceTelemetryStatus.WaitingForData);
    expect(statusAt("")).toBe(ServiceTelemetryStatus.WaitingForData);
  });

  test("a last data that is not a real date reads as never: not 'last seen Invalid Date ago'", () => {
    for (const lastSeenAt of [
      "not a date",
      "2026-13-45T99:99:99Z",
      "yesterday",
      new Date("nonsense"),
      new Date(NaN),
    ]) {
      expect(statusAt(lastSeenAt)).toBe(ServiceTelemetryStatus.WaitingForData);
      expect(
        describeServiceTelemetryStatus({ lastSeenAt, now: NOW }).lastDataAt,
      ).toBeNull();
    }
  });

  test("the epoch itself is a real date: long ago, not never", () => {
    expect(statusAt(new Date(0))).toBe(ServiceTelemetryStatus.NoRecentData);
  });
});

describe("getServiceLastDataAt", () => {
  test("hands a real Date back as it is", () => {
    const date: Date = ago(5 * MINUTE);

    expect(getServiceLastDataAt(date)).toBe(date);
  });

  test("parses the API's ISO string", () => {
    expect(getServiceLastDataAt("2026-11-08T11:00:00.000Z")?.toISOString()).toBe(
      "2026-11-08T11:00:00.000Z",
    );
  });

  test("is null for nothing, and for anything that is not a date", () => {
    expect(getServiceLastDataAt(undefined)).toBeNull();
    expect(getServiceLastDataAt(null)).toBeNull();
    expect(getServiceLastDataAt("")).toBeNull();
    expect(getServiceLastDataAt("soon")).toBeNull();
    expect(getServiceLastDataAt(new Date(NaN))).toBeNull();
  });
});

describe("isServiceDataRecent", () => {
  test("is the window, inclusive at its end", () => {
    expect(isServiceDataRecent(ago(30 * MINUTE), NOW)).toBe(true);
    expect(isServiceDataRecent(ago(30 * MINUTE + 1), NOW)).toBe(false);
    expect(isServiceDataRecent(new Date(NOW.getTime() + 1), NOW)).toBe(true);
    expect(isServiceDataRecent(NOW, new Date(NaN))).toBe(false);
  });
});

describe("the status's words", () => {
  test("each status has its own label, tooltip and tone", () => {
    expect(
      getServiceTelemetryStatusWords(ServiceTelemetryStatus.ReceivingData),
    ).toEqual({
      label: "Receiving data",
      description: "Data has arrived from this service in the last 30 minutes.",
      tone: "positive",
    });
    expect(
      getServiceTelemetryStatusWords(ServiceTelemetryStatus.NoRecentData),
    ).toEqual({
      label: "No recent data",
      description:
        "Nothing has arrived in the last 30 minutes. A service that sends data only while it handles requests is quiet when nobody calls it. If it should be busy, check that it is running and still sends its telemetry to OneUptime with this service.name.",
      tone: "neutral",
    });
    expect(
      getServiceTelemetryStatusWords(ServiceTelemetryStatus.WaitingForData),
    ).toEqual({
      label: "Waiting for data",
      description:
        "Nothing has arrived from this service yet. Send its OpenTelemetry data with service.name set to exactly this service's name.",
      tone: "neutral",
    });
  });

  test("the exported words are the ones each status draws", () => {
    const receiving: ServiceTelemetryStatusWords =
      getServiceTelemetryStatusWords(ServiceTelemetryStatus.ReceivingData);
    const quiet: ServiceTelemetryStatusWords = getServiceTelemetryStatusWords(
      ServiceTelemetryStatus.NoRecentData,
    );
    const waiting: ServiceTelemetryStatusWords =
      getServiceTelemetryStatusWords(ServiceTelemetryStatus.WaitingForData);

    expect(SERVICE_RECEIVING_DATA_LABEL).toBe(receiving.label);
    expect(SERVICE_RECEIVING_DATA_DESCRIPTION).toBe(receiving.description);
    expect(SERVICE_NO_RECENT_DATA_LABEL).toBe(quiet.label);
    expect(SERVICE_NO_RECENT_DATA_DESCRIPTION).toBe(quiet.description);
    expect(SERVICE_WAITING_FOR_DATA_LABEL).toBe(waiting.label);
    expect(SERVICE_WAITING_FOR_DATA_DESCRIPTION).toBe(waiting.description);
  });

  /*
   * Data arriving and nothing ever having arrived read the same on a
   * service, a serverless function and a RUM application: one key each,
   * worded once in every language. The quiet state is the service's own,
   * and claims no cause: a service may be idle or may have stopped.
   */
  test("receiving and waiting are the words a function and an application use; quiet claims no cause", () => {
    expect(SERVICE_RECEIVING_DATA_LABEL).toBe(
      RUM_APPLICATION_RECEIVING_DATA_LABEL,
    );
    expect(SERVICE_RECEIVING_DATA_LABEL).toBe(
      SERVERLESS_FUNCTION_RECEIVING_DATA_LABEL,
    );
    expect(SERVICE_WAITING_FOR_DATA_LABEL).toBe(
      RUM_APPLICATION_WAITING_FOR_DATA_LABEL,
    );
    expect(SERVICE_WAITING_FOR_DATA_LABEL).toBe(
      SERVERLESS_FUNCTION_WAITING_FOR_DATA_LABEL,
    );
    expect(SERVICE_NO_RECENT_DATA_LABEL).not.toBe(
      SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_LABEL,
    );
    expect(SERVICE_NO_RECENT_DATA_LABEL).not.toMatch(
      /traffic|invocation|idle/i,
    );
  });

  test("only data arriving is green; no status is a warning or a fault", () => {
    const tones: Array<string> = ALL_STATUSES.map(
      (status: ServiceTelemetryStatus): string => {
        return getServiceTelemetryStatusWords(status).tone;
      },
    );

    expect(tones).toEqual(["positive", "neutral", "neutral"]);
    expect(tones).not.toContain("warning");
    expect(tones).not.toContain("danger");
  });

  test("no word calls a service disconnected, or its link broken", () => {
    for (const status of ALL_STATUSES) {
      const words: ServiceTelemetryStatusWords =
        getServiceTelemetryStatusWords(status);

      for (const text of [words.label, words.description]) {
        expect(text).not.toMatch(
          /disconnect|connection|broken|offline|error|fail|down\b/i,
        );
      }
    }
  });

  test("the labels are short enough for a pill and differ from one another", () => {
    const labels: Array<string> = ALL_STATUSES.map(
      (status: ServiceTelemetryStatus): string => {
        return getServiceTelemetryStatusWords(status).label;
      },
    );

    expect(new Set(labels).size).toBe(3);
    for (const label of labels) {
      expect(label.length).toBeLessThanOrEqual(20);
      expect(label).toBe(label.trim());
    }
  });

  test("every tooltip is whole sentences, with nothing put in where it is drawn", () => {
    for (const status of ALL_STATUSES) {
      const description: string =
        getServiceTelemetryStatusWords(status).description;

      expect(description).toMatch(/^[A-Z].*\.$/);
      expect(description).not.toMatch(/\s{2}/);
      expect(description).not.toMatch(/\{\{/);
    }

    // Quiet: what it often is, and what to check when it should be busy.
    expect(SERVICE_NO_RECENT_DATA_DESCRIPTION).toContain(
      "quiet when nobody calls it",
    );
    expect(SERVICE_NO_RECENT_DATA_DESCRIPTION).toContain(
      "If it should be busy, check",
    );
    // Waiting: what its telemetry must carry.
    expect(SERVICE_WAITING_FOR_DATA_DESCRIPTION).toContain("service.name");
  });

  // The window and the words say one number: change one, this fails.
  test("the words say the window's number of minutes", () => {
    expect(SERVICE_RECEIVING_DATA_DESCRIPTION).toContain(
      `last ${SERVICE_NO_RECENT_DATA_AFTER_MINUTES} minutes`,
    );
    expect(SERVICE_NO_RECENT_DATA_DESCRIPTION).toContain(
      `last ${SERVICE_NO_RECENT_DATA_AFTER_MINUTES} minutes`,
    );
  });

  test("a status it does not know reads as waiting, the state that claims least", () => {
    for (const unknown of ["connected", "disconnected", "", undefined, null]) {
      expect(
        getServiceTelemetryStatusWords(
          unknown as unknown as ServiceTelemetryStatus,
        ),
      ).toEqual(
        getServiceTelemetryStatusWords(ServiceTelemetryStatus.WaitingForData),
      );
    }
  });
});

describe("describeServiceTelemetryStatus", () => {
  test("is the status, its words and when data last arrived", () => {
    const lastSeenAt: Date = ago(3 * 60 * MINUTE);

    expect(describeServiceTelemetryStatus({ lastSeenAt, now: NOW })).toEqual({
      status: ServiceTelemetryStatus.NoRecentData,
      ...getServiceTelemetryStatusWords(ServiceTelemetryStatus.NoRecentData),
      lastDataAt: lastSeenAt,
    });
  });

  test("hands the hero a real Date for the API's string, and nothing for never", () => {
    const iso: string = ago(2 * MINUTE).toISOString();
    const described: ServiceTelemetryStatusDescription =
      describeServiceTelemetryStatus({ lastSeenAt: iso, now: NOW });

    expect(described.lastDataAt).toBeInstanceOf(Date);
    expect(described.lastDataAt?.toISOString()).toBe(iso);
    expect(
      describeServiceTelemetryStatus({ lastSeenAt: undefined, now: NOW })
        .lastDataAt,
    ).toBeNull();
  });
});

/*
 * Drawn records - last data from a year before the reader's clock to a day
 * after it, around the window's edge in particular, as a Date, as an ISO
 * string, missing or not a date - each read by an independent statement of
 * the rules: no real date is waiting; otherwise an age of at most 30
 * minutes (a negative one included) is receiving; otherwise it is no
 * recent data. And the words always belong to the status they describe.
 */
describe("a sweep of drawn records", () => {
  const drawAge: (random: SeededRandom) => number = (
    random: SeededRandom,
  ): number => {
    switch (random(4)) {
      // Within a few seconds of the window's edge.
      case 0:
        return 30 * MINUTE + random(20001) - 10000;
      // Within the window, or a little ahead of the clock.
      case 1:
        return random(31 * MINUTE) - MINUTE;
      // Up to a day ahead of the clock.
      case 2:
        return -random(24 * 60 * MINUTE);
      // Up to a year ago.
      default:
        return random(365 * 24 * 60) * MINUTE;
    }
  };

  test("reads 5,000 records by the three rules", () => {
    const random: SeededRandom = seededRandom(6270);
    const seen: Set<ServiceTelemetryStatus> = new Set();

    for (let index: number = 0; index < 5000; index++) {
      const now: Date = new Date(
        Date.UTC(2021, 0, 1) + random(5 * 365 * 24 * 60) * MINUTE,
      );
      const age: number = drawAge(random);
      const moment: Date = new Date(now.getTime() - age);
      const form: number = random(6);
      const lastSeenAt: Date | string | null | undefined = [
        moment,
        moment.toISOString(),
        null,
        undefined,
        "",
        "not-a-date",
      ][form];

      const expected: ServiceTelemetryStatus =
        form >= 2
          ? ServiceTelemetryStatus.WaitingForData
          : age <= 30 * MINUTE
            ? ServiceTelemetryStatus.ReceivingData
            : ServiceTelemetryStatus.NoRecentData;

      const described: ServiceTelemetryStatusDescription =
        describeServiceTelemetryStatus({ lastSeenAt, now });

      expect({ index, age, form, status: described.status }).toEqual({
        index,
        age,
        form,
        status: expected,
      });
      expect(described.label).toBe(
        getServiceTelemetryStatusWords(expected).label,
      );
      expect(described.tone).toBe(
        expected === ServiceTelemetryStatus.ReceivingData
          ? "positive"
          : "neutral",
      );
      expect(described.lastDataAt?.getTime() ?? null).toBe(
        form < 2 ? moment.getTime() : null,
      );
      seen.add(described.status);
    }

    // The draws reached every status.
    expect(seen).toEqual(new Set(ALL_STATUSES));
  });

  /*
   * What changed for a service that was seen: the Overview used to call
   * it connected while `now - lastSeenAt < 30 minutes`, strictly. Over the
   * same draws the new reading agrees everywhere except at exactly 30
   * minutes, which now counts as receiving, as the other resources' sweeps
   * count their own window's end.
   */
  test("agrees with the Overview's old reading everywhere but the window's last millisecond", () => {
    const random: SeededRandom = seededRandom(62700);

    for (let index: number = 0; index < 5000; index++) {
      const age: number = 30 * MINUTE + random(4001) - 2000;
      const lastSeenAt: Date = ago(age);
      const wasConnected: boolean =
        NOW.getTime() - lastSeenAt.getTime() < 30 * MINUTE;
      const isReceiving: boolean =
        statusAt(lastSeenAt) === ServiceTelemetryStatus.ReceivingData;

      expect({ index, age, isReceiving }).toEqual({
        index,
        age,
        isReceiving: age === 30 * MINUTE ? true : wasConnected,
      });
    }
  });
});
