import { describe, expect, test } from "@jest/globals";
import {
  RUM_APPLICATION_NO_RECENT_TRAFFIC_AFTER_MINUTES,
  RUM_APPLICATION_NO_RECENT_TRAFFIC_DESCRIPTION,
  RUM_APPLICATION_NO_RECENT_TRAFFIC_LABEL,
  RUM_APPLICATION_RECEIVING_DATA_DESCRIPTION,
  RUM_APPLICATION_RECEIVING_DATA_LABEL,
  RUM_APPLICATION_WAITING_FOR_DATA_DESCRIPTION,
  RUM_APPLICATION_WAITING_FOR_DATA_LABEL,
  RumApplicationStatus,
  RumApplicationStatusDescription,
  RumApplicationStatusInput,
  RumApplicationStatusWords,
  describeRumApplicationStatus,
  getRumApplicationLastDataAt,
  getRumApplicationStatus,
  getRumApplicationStatusWords,
  isRumApplicationStatusReceiving,
} from "../../../Types/Rum/RumApplicationStatus";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * What a RUM application's status says (issue #6191): Receiving data while
 * its data arrives, No recent traffic once nobody has used the app for a
 * while - grey, because that is normal - and Waiting for data before its
 * first data. Never "Disconnected": that reads as a broken link between the
 * app and OneUptime, which a quiet night is not.
 *
 * Every branch of the reading, at its edges; the words for each status; and
 * a sweep of drawn records holding the reading to its three rules.
 */

const THREE_HOURS_AGO: Date = new Date("2026-11-07T09:00:00.000Z");

const ALL_STATUSES: Array<RumApplicationStatus> = [
  RumApplicationStatus.ReceivingData,
  RumApplicationStatus.NoRecentTraffic,
  RumApplicationStatus.WaitingForData,
];

describe("getRumApplicationStatus", () => {
  test("an application ingest heard from recently is receiving data", () => {
    expect(
      getRumApplicationStatus({
        otelCollectorStatus: "connected",
        lastSeenAt: new Date(),
      }),
    ).toBe(RumApplicationStatus.ReceivingData);
  });

  test("one the sweep turned 'disconnected' is no recent traffic, not disconnected", () => {
    expect(
      getRumApplicationStatus({
        otelCollectorStatus: "disconnected",
        lastSeenAt: THREE_HOURS_AGO,
      }),
    ).toBe(RumApplicationStatus.NoRecentTraffic);
  });

  test("one added by hand, before its first data, is waiting for data", () => {
    for (const otelCollectorStatus of [undefined, null, ""]) {
      expect(
        getRumApplicationStatus({
          otelCollectorStatus,
          lastSeenAt: undefined,
        }),
      ).toBe(RumApplicationStatus.WaitingForData);
      expect(
        getRumApplicationStatus({ otelCollectorStatus, lastSeenAt: null }),
      ).toBe(RumApplicationStatus.WaitingForData);
    }
  });

  test("'disconnected' with no last data is still waiting: nothing ever arrived", () => {
    expect(
      getRumApplicationStatus({
        otelCollectorStatus: "disconnected",
        lastSeenAt: undefined,
      }),
    ).toBe(RumApplicationStatus.WaitingForData);
  });

  test("'connected' with no last data is receiving: the server says data arrives", () => {
    expect(
      getRumApplicationStatus({
        otelCollectorStatus: "connected",
        lastSeenAt: undefined,
      }),
    ).toBe(RumApplicationStatus.ReceivingData);
  });

  test("the stored value is read whatever its case, and 'active' counts too", () => {
    for (const otelCollectorStatus of [
      "connected",
      "Connected",
      "CONNECTED",
      "cOnNeCtEd",
      "active",
      "Active",
      "ACTIVE",
    ]) {
      expect({
        otelCollectorStatus,
        status: getRumApplicationStatus({
          otelCollectorStatus,
          lastSeenAt: THREE_HOURS_AGO,
        }),
      }).toEqual({
        otelCollectorStatus,
        status: RumApplicationStatus.ReceivingData,
      });
    }
  });

  test("anything else, spaces around 'connected' included, is not receiving - as the card reads it", () => {
    for (const otelCollectorStatus of [
      " connected",
      "connected ",
      "connect",
      "connectedd",
      "disconnected",
      "Disconnected",
      "inactive",
      "unknown",
      "true",
      "1",
    ]) {
      expect({
        otelCollectorStatus,
        status: getRumApplicationStatus({
          otelCollectorStatus,
          lastSeenAt: THREE_HOURS_AGO,
        }),
      }).toEqual({
        otelCollectorStatus,
        status: RumApplicationStatus.NoRecentTraffic,
      });
    }
  });

  test("the last data is read from a Date or from the API's ISO string", () => {
    expect(
      getRumApplicationStatus({
        otelCollectorStatus: "disconnected",
        lastSeenAt: THREE_HOURS_AGO.toISOString(),
      }),
    ).toBe(RumApplicationStatus.NoRecentTraffic);
  });

  test("a last data that is not a real date reads as never: not 'last seen Invalid Date ago'", () => {
    for (const lastSeenAt of [
      "",
      "not a date",
      "2026-13-45T99:99:99Z",
      new Date("nonsense"),
      new Date(NaN),
    ]) {
      expect(
        getRumApplicationStatus({
          otelCollectorStatus: "disconnected",
          lastSeenAt,
        }),
      ).toBe(RumApplicationStatus.WaitingForData);
    }
  });

  test("the clock is not read: the sweep decides when data stops counting as recent", () => {
    const longAgo: Date = new Date("2001-01-01T00:00:00.000Z");
    const inTheFuture: Date = new Date("2099-01-01T00:00:00.000Z");

    expect(
      getRumApplicationStatus({
        otelCollectorStatus: "connected",
        lastSeenAt: longAgo,
      }),
    ).toBe(RumApplicationStatus.ReceivingData);
    expect(
      getRumApplicationStatus({
        otelCollectorStatus: "disconnected",
        lastSeenAt: inTheFuture,
      }),
    ).toBe(RumApplicationStatus.NoRecentTraffic);
  });
});

describe("isRumApplicationStatusReceiving", () => {
  test("only 'connected' and 'active', in any case", () => {
    expect(isRumApplicationStatusReceiving("connected")).toBe(true);
    expect(isRumApplicationStatusReceiving("ACTIVE")).toBe(true);
    expect(isRumApplicationStatusReceiving("disconnected")).toBe(false);
    expect(isRumApplicationStatusReceiving(" connected ")).toBe(false);
    expect(isRumApplicationStatusReceiving("")).toBe(false);
    expect(isRumApplicationStatusReceiving(null)).toBe(false);
    expect(isRumApplicationStatusReceiving(undefined)).toBe(false);
  });
});

describe("getRumApplicationLastDataAt", () => {
  test("hands a real Date back as it is", () => {
    expect(getRumApplicationLastDataAt(THREE_HOURS_AGO)).toBe(THREE_HOURS_AGO);
  });

  test("parses the API's ISO string", () => {
    expect(
      getRumApplicationLastDataAt("2026-11-07T09:00:00.000Z")?.toISOString(),
    ).toBe("2026-11-07T09:00:00.000Z");
  });

  test("is null for nothing, and for anything that is not a date", () => {
    expect(getRumApplicationLastDataAt(undefined)).toBeNull();
    expect(getRumApplicationLastDataAt(null)).toBeNull();
    expect(getRumApplicationLastDataAt("")).toBeNull();
    expect(getRumApplicationLastDataAt("yesterday-ish")).toBeNull();
    expect(getRumApplicationLastDataAt(new Date(NaN))).toBeNull();
  });
});

describe("the status's words", () => {
  test("each status has its own label, tooltip and tone", () => {
    expect(
      getRumApplicationStatusWords(RumApplicationStatus.ReceivingData),
    ).toEqual({
      label: "Receiving data",
      description:
        "Data has arrived from this application in the last 15 minutes.",
      tone: "positive",
    });
    expect(
      getRumApplicationStatusWords(RumApplicationStatus.NoRecentTraffic),
    ).toEqual({
      label: "No recent traffic",
      description:
        "Nothing has arrived in the last 15 minutes. An application sends data only while people use it, so this is normal when nobody is, for example overnight. If people are using it right now, its Overview lists what to check.",
      tone: "neutral",
    });
    expect(
      getRumApplicationStatusWords(RumApplicationStatus.WaitingForData),
    ).toEqual({
      label: "Waiting for data",
      description:
        "Nothing has arrived from this application yet. Add the OpenTelemetry SDK or the Session Replay snippet to your app; its Documentation tab shows how.",
      tone: "neutral",
    });
  });

  test("the exported words are the ones each status draws", () => {
    expect(RUM_APPLICATION_RECEIVING_DATA_LABEL).toBe(
      getRumApplicationStatusWords(RumApplicationStatus.ReceivingData).label,
    );
    expect(RUM_APPLICATION_RECEIVING_DATA_DESCRIPTION).toBe(
      getRumApplicationStatusWords(RumApplicationStatus.ReceivingData)
        .description,
    );
    expect(RUM_APPLICATION_NO_RECENT_TRAFFIC_LABEL).toBe(
      getRumApplicationStatusWords(RumApplicationStatus.NoRecentTraffic).label,
    );
    expect(RUM_APPLICATION_NO_RECENT_TRAFFIC_DESCRIPTION).toBe(
      getRumApplicationStatusWords(RumApplicationStatus.NoRecentTraffic)
        .description,
    );
    expect(RUM_APPLICATION_WAITING_FOR_DATA_LABEL).toBe(
      getRumApplicationStatusWords(RumApplicationStatus.WaitingForData).label,
    );
    expect(RUM_APPLICATION_WAITING_FOR_DATA_DESCRIPTION).toBe(
      getRumApplicationStatusWords(RumApplicationStatus.WaitingForData)
        .description,
    );
  });

  test("only data arriving is green; no status is a warning or a fault", () => {
    const tones: Array<string> = ALL_STATUSES.map(
      (status: RumApplicationStatus): string => {
        return getRumApplicationStatusWords(status).tone;
      },
    );

    expect(tones).toEqual(["positive", "neutral", "neutral"]);
    expect(tones).not.toContain("warning");
    expect(tones).not.toContain("danger");
  });

  test("no word calls an application disconnected, or its link broken", () => {
    for (const status of ALL_STATUSES) {
      const words: RumApplicationStatusWords =
        getRumApplicationStatusWords(status);

      for (const text of [words.label, words.description]) {
        expect(text).not.toMatch(
          /disconnect|connection|broken|offline|error|fail/i,
        );
      }
    }
  });

  test("the labels are short enough for a pill and differ from one another", () => {
    const labels: Array<string> = ALL_STATUSES.map(
      (status: RumApplicationStatus): string => {
        return getRumApplicationStatusWords(status).label;
      },
    );

    expect(new Set(labels).size).toBe(3);
    for (const label of labels) {
      expect(label.length).toBeLessThanOrEqual(20);
      expect(label).toBe(label.trim());
    }
  });

  test("every tooltip is whole sentences that say what to do, if anything", () => {
    for (const status of ALL_STATUSES) {
      const description: string =
        getRumApplicationStatusWords(status).description;

      expect(description).toMatch(/^[A-Z].*\.$/);
      expect(description).not.toMatch(/\s{2}/);
    }

    // Quiet: it is normal, and if it is not, where to look.
    expect(RUM_APPLICATION_NO_RECENT_TRAFFIC_DESCRIPTION).toContain("normal");
    expect(RUM_APPLICATION_NO_RECENT_TRAFFIC_DESCRIPTION).toContain(
      "what to check",
    );
    // Waiting: how to start.
    expect(RUM_APPLICATION_WAITING_FOR_DATA_DESCRIPTION).toContain(
      "Documentation tab",
    );
  });

  /*
   * The tooltips say the number the sweep waits for (the sweep reads the
   * same constant): change one, and this fails until the words say it too.
   */
  test("the words say the sweep's number of minutes", () => {
    expect(RUM_APPLICATION_NO_RECENT_TRAFFIC_AFTER_MINUTES).toBe(15);
    expect(RUM_APPLICATION_RECEIVING_DATA_DESCRIPTION).toContain(
      `last ${RUM_APPLICATION_NO_RECENT_TRAFFIC_AFTER_MINUTES} minutes`,
    );
    expect(RUM_APPLICATION_NO_RECENT_TRAFFIC_DESCRIPTION).toContain(
      `last ${RUM_APPLICATION_NO_RECENT_TRAFFIC_AFTER_MINUTES} minutes`,
    );
  });

  test("a status it does not know reads as waiting, the state that claims least", () => {
    expect(
      getRumApplicationStatusWords("disconnected" as RumApplicationStatus),
    ).toEqual(
      getRumApplicationStatusWords(RumApplicationStatus.WaitingForData),
    );
    expect(
      getRumApplicationStatusWords(
        undefined as unknown as RumApplicationStatus,
      ),
    ).toEqual(
      getRumApplicationStatusWords(RumApplicationStatus.WaitingForData),
    );
  });
});

describe("describeRumApplicationStatus", () => {
  test("is the status and its words together", () => {
    const input: RumApplicationStatusInput = {
      otelCollectorStatus: "disconnected",
      lastSeenAt: THREE_HOURS_AGO,
    };

    expect(describeRumApplicationStatus(input)).toEqual({
      status: RumApplicationStatus.NoRecentTraffic,
      ...getRumApplicationStatusWords(RumApplicationStatus.NoRecentTraffic),
    });
  });
});

/*
 * Drawn records - every stored value the column has held, odd cases and
 * casings, and dates real, unreal and missing - each read by the three
 * rules: "connected" or "active" in any case is receiving; otherwise a real
 * last-data date is no recent traffic; otherwise it is waiting. And the
 * words always belong to the status they describe.
 */
describe("a sweep of drawn records", () => {
  const STATUS_VALUES: Array<string | null | undefined> = [
    "connected",
    "Connected",
    "CONNECTED",
    "active",
    "Active",
    "disconnected",
    "Disconnected",
    "DISCONNECTED",
    " connected",
    "connected ",
    "",
    "stale",
    null,
    undefined,
  ];

  const drawLastSeenAt: (
    random: SeededRandom,
  ) => Date | string | null | undefined = (
    random: SeededRandom,
  ): Date | string | null | undefined => {
    const moment: Date = new Date(
      Date.UTC(2020, 0, 1) + random(7 * 365) * 24 * 60 * 60 * 1000,
    );

    switch (random(7)) {
      case 0:
        return moment;
      case 1:
        return moment.toISOString();
      case 2:
        return null;
      case 3:
        return undefined;
      case 4:
        return "";
      case 5:
        return new Date(NaN);
      default:
        return "not-a-date";
    }
  };

  test("reads 5,000 records by the three rules", () => {
    const random: SeededRandom = seededRandom(6191);
    const seen: Set<RumApplicationStatus> = new Set();

    for (let index: number = 0; index < 5000; index++) {
      const input: RumApplicationStatusInput = {
        otelCollectorStatus: STATUS_VALUES[random(STATUS_VALUES.length)],
        lastSeenAt: drawLastSeenAt(random),
      };
      const normalized: string = (
        input.otelCollectorStatus || ""
      ).toLowerCase();
      const hasRealDate: boolean =
        input.lastSeenAt instanceof Date
          ? !isNaN(input.lastSeenAt.getTime())
          : typeof input.lastSeenAt === "string" &&
            input.lastSeenAt !== "" &&
            !isNaN(new Date(input.lastSeenAt).getTime());

      const expected: RumApplicationStatus =
        normalized === "connected" || normalized === "active"
          ? RumApplicationStatus.ReceivingData
          : hasRealDate
            ? RumApplicationStatus.NoRecentTraffic
            : RumApplicationStatus.WaitingForData;

      const described: RumApplicationStatusDescription =
        describeRumApplicationStatus(input);

      expect({ index, input, status: described.status }).toEqual({
        index,
        input,
        status: expected,
      });
      expect(described.label).toBe(
        getRumApplicationStatusWords(expected).label,
      );
      seen.add(described.status);
    }

    // The draws reached every status.
    expect(seen).toEqual(new Set(ALL_STATUSES));
  });
});
