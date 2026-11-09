import { describe, expect, test } from "@jest/globals";
import {
  SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_AFTER_MINUTES,
  SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_DESCRIPTION,
  SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_LABEL,
  SERVERLESS_FUNCTION_RECEIVING_DATA_DESCRIPTION,
  SERVERLESS_FUNCTION_RECEIVING_DATA_LABEL,
  SERVERLESS_FUNCTION_WAITING_FOR_DATA_DESCRIPTION,
  SERVERLESS_FUNCTION_WAITING_FOR_DATA_LABEL,
  ServerlessFunctionStatus,
  ServerlessFunctionStatusDescription,
  ServerlessFunctionStatusInput,
  ServerlessFunctionStatusWords,
  describeServerlessFunctionStatus,
  getServerlessFunctionLastDataAt,
  getServerlessFunctionStatus,
  getServerlessFunctionStatusWords,
  isServerlessFunctionStatusReceiving,
} from "../../../Types/Serverless/ServerlessFunctionStatus";
import {
  RUM_APPLICATION_RECEIVING_DATA_LABEL,
  RUM_APPLICATION_WAITING_FOR_DATA_LABEL,
} from "../../../Types/Rum/RumApplicationStatus";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * What a serverless function's status says (issue #6269): Receiving data
 * while its data arrives, No recent invocations once nothing has invoked it
 * for a while - grey, because a function sends data only while it runs -
 * and Waiting for data before its first data. Never "Disconnected": that
 * reads as a broken link between the function and OneUptime, which a
 * nightly job between its runs is not.
 *
 * Every branch of the reading, at its edges; the words for each status; and
 * a sweep of drawn records holding the reading to its three rules.
 */

const THREE_HOURS_AGO: Date = new Date("2026-11-07T09:00:00.000Z");

const ALL_STATUSES: Array<ServerlessFunctionStatus> = [
  ServerlessFunctionStatus.ReceivingData,
  ServerlessFunctionStatus.NoRecentInvocations,
  ServerlessFunctionStatus.WaitingForData,
];

describe("getServerlessFunctionStatus", () => {
  test("a function ingest heard from recently is receiving data", () => {
    expect(
      getServerlessFunctionStatus({
        otelCollectorStatus: "connected",
        lastSeenAt: new Date(),
      }),
    ).toBe(ServerlessFunctionStatus.ReceivingData);
  });

  test("one the sweep turned 'disconnected' is no recent invocations, not disconnected", () => {
    expect(
      getServerlessFunctionStatus({
        otelCollectorStatus: "disconnected",
        lastSeenAt: THREE_HOURS_AGO,
      }),
    ).toBe(ServerlessFunctionStatus.NoRecentInvocations);
  });

  test("one added through the API, before its first data, is waiting for data", () => {
    for (const otelCollectorStatus of [undefined, null, ""]) {
      expect(
        getServerlessFunctionStatus({
          otelCollectorStatus,
          lastSeenAt: undefined,
        }),
      ).toBe(ServerlessFunctionStatus.WaitingForData);
      expect(
        getServerlessFunctionStatus({ otelCollectorStatus, lastSeenAt: null }),
      ).toBe(ServerlessFunctionStatus.WaitingForData);
    }
  });

  test("'disconnected' with no last data is still waiting: nothing ever arrived", () => {
    expect(
      getServerlessFunctionStatus({
        otelCollectorStatus: "disconnected",
        lastSeenAt: undefined,
      }),
    ).toBe(ServerlessFunctionStatus.WaitingForData);
  });

  test("'connected' with no last data is receiving: the server says data arrives", () => {
    expect(
      getServerlessFunctionStatus({
        otelCollectorStatus: "connected",
        lastSeenAt: undefined,
      }),
    ).toBe(ServerlessFunctionStatus.ReceivingData);
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
        status: getServerlessFunctionStatus({
          otelCollectorStatus,
          lastSeenAt: THREE_HOURS_AGO,
        }),
      }).toEqual({
        otelCollectorStatus,
        status: ServerlessFunctionStatus.ReceivingData,
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
      "idle",
      "unknown",
      "true",
      "1",
    ]) {
      expect({
        otelCollectorStatus,
        status: getServerlessFunctionStatus({
          otelCollectorStatus,
          lastSeenAt: THREE_HOURS_AGO,
        }),
      }).toEqual({
        otelCollectorStatus,
        status: ServerlessFunctionStatus.NoRecentInvocations,
      });
    }
  });

  test("the last data is read from a Date or from the API's ISO string", () => {
    expect(
      getServerlessFunctionStatus({
        otelCollectorStatus: "disconnected",
        lastSeenAt: THREE_HOURS_AGO.toISOString(),
      }),
    ).toBe(ServerlessFunctionStatus.NoRecentInvocations);
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
        getServerlessFunctionStatus({
          otelCollectorStatus: "disconnected",
          lastSeenAt,
        }),
      ).toBe(ServerlessFunctionStatus.WaitingForData);
    }
  });

  /*
   * The sweep turns "connected" to "disconnected" after its fifteen
   * minutes; the status only reads what it wrote. So a date long ago under
   * "connected" (the sweep has not run yet) is still receiving, and one in
   * the future under "disconnected" is still quiet.
   */
  test("the clock is not read: the sweep decides when data stops counting as recent", () => {
    const longAgo: Date = new Date("2001-01-01T00:00:00.000Z");
    const inTheFuture: Date = new Date("2099-01-01T00:00:00.000Z");

    expect(
      getServerlessFunctionStatus({
        otelCollectorStatus: "connected",
        lastSeenAt: longAgo,
      }),
    ).toBe(ServerlessFunctionStatus.ReceivingData);
    expect(
      getServerlessFunctionStatus({
        otelCollectorStatus: "disconnected",
        lastSeenAt: inTheFuture,
      }),
    ).toBe(ServerlessFunctionStatus.NoRecentInvocations);
  });

  test("the epoch itself is a real date, not 'never'", () => {
    expect(
      getServerlessFunctionStatus({
        otelCollectorStatus: "disconnected",
        lastSeenAt: new Date(0),
      }),
    ).toBe(ServerlessFunctionStatus.NoRecentInvocations);
  });
});

describe("isServerlessFunctionStatusReceiving", () => {
  test("only 'connected' and 'active', in any case", () => {
    expect(isServerlessFunctionStatusReceiving("connected")).toBe(true);
    expect(isServerlessFunctionStatusReceiving("ACTIVE")).toBe(true);
    expect(isServerlessFunctionStatusReceiving("disconnected")).toBe(false);
    expect(isServerlessFunctionStatusReceiving(" connected ")).toBe(false);
    expect(isServerlessFunctionStatusReceiving("")).toBe(false);
    expect(isServerlessFunctionStatusReceiving(null)).toBe(false);
    expect(isServerlessFunctionStatusReceiving(undefined)).toBe(false);
  });
});

describe("getServerlessFunctionLastDataAt", () => {
  test("hands a real Date back as it is", () => {
    expect(getServerlessFunctionLastDataAt(THREE_HOURS_AGO)).toBe(
      THREE_HOURS_AGO,
    );
  });

  test("parses the API's ISO string", () => {
    expect(
      getServerlessFunctionLastDataAt(
        "2026-11-07T09:00:00.000Z",
      )?.toISOString(),
    ).toBe("2026-11-07T09:00:00.000Z");
  });

  test("is null for nothing, and for anything that is not a date", () => {
    expect(getServerlessFunctionLastDataAt(undefined)).toBeNull();
    expect(getServerlessFunctionLastDataAt(null)).toBeNull();
    expect(getServerlessFunctionLastDataAt("")).toBeNull();
    expect(getServerlessFunctionLastDataAt("yesterday-ish")).toBeNull();
    expect(getServerlessFunctionLastDataAt(new Date(NaN))).toBeNull();
  });
});

describe("the status's words", () => {
  test("each status has its own label, tooltip and tone", () => {
    expect(
      getServerlessFunctionStatusWords(ServerlessFunctionStatus.ReceivingData),
    ).toEqual({
      label: "Receiving data",
      description:
        "Data has arrived from this function in the last 15 minutes.",
      tone: "positive",
    });
    expect(
      getServerlessFunctionStatusWords(
        ServerlessFunctionStatus.NoRecentInvocations,
      ),
    ).toEqual({
      label: "No recent invocations",
      description:
        "Nothing has arrived in the last 15 minutes. A function sends data only while it runs, so this is normal when nothing has invoked it, for example between scheduled runs. If it should be running, its Overview lists what to check.",
      tone: "neutral",
    });
    expect(
      getServerlessFunctionStatusWords(ServerlessFunctionStatus.WaitingForData),
    ).toEqual({
      label: "Waiting for data",
      description:
        "Nothing has arrived from this function yet. Add the OpenTelemetry SDK to it and invoke it once; its Documentation tab shows how.",
      tone: "neutral",
    });
  });

  test("the exported words are the ones each status draws", () => {
    const receiving: ServerlessFunctionStatusWords =
      getServerlessFunctionStatusWords(ServerlessFunctionStatus.ReceivingData);
    const quiet: ServerlessFunctionStatusWords =
      getServerlessFunctionStatusWords(
        ServerlessFunctionStatus.NoRecentInvocations,
      );
    const waiting: ServerlessFunctionStatusWords =
      getServerlessFunctionStatusWords(ServerlessFunctionStatus.WaitingForData);

    expect(SERVERLESS_FUNCTION_RECEIVING_DATA_LABEL).toBe(receiving.label);
    expect(SERVERLESS_FUNCTION_RECEIVING_DATA_DESCRIPTION).toBe(
      receiving.description,
    );
    expect(SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_LABEL).toBe(quiet.label);
    expect(SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_DESCRIPTION).toBe(
      quiet.description,
    );
    expect(SERVERLESS_FUNCTION_WAITING_FOR_DATA_LABEL).toBe(waiting.label);
    expect(SERVERLESS_FUNCTION_WAITING_FOR_DATA_DESCRIPTION).toBe(
      waiting.description,
    );
  });

  /*
   * Data arriving and nothing ever having arrived mean the same for a
   * function as for a RUM application, so they are the same words - the
   * same keys of the locales, worded once in every language. Only the
   * quiet state says what is quiet.
   */
  test("receiving and waiting are the RUM application's words; the quiet state is its own", () => {
    expect(SERVERLESS_FUNCTION_RECEIVING_DATA_LABEL).toBe(
      RUM_APPLICATION_RECEIVING_DATA_LABEL,
    );
    expect(SERVERLESS_FUNCTION_WAITING_FOR_DATA_LABEL).toBe(
      RUM_APPLICATION_WAITING_FOR_DATA_LABEL,
    );
    expect(SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_LABEL).not.toBe(
      "No recent traffic",
    );
  });

  test("only data arriving is green; no status is a warning or a fault", () => {
    const tones: Array<string> = ALL_STATUSES.map(
      (status: ServerlessFunctionStatus): string => {
        return getServerlessFunctionStatusWords(status).tone;
      },
    );

    expect(tones).toEqual(["positive", "neutral", "neutral"]);
    expect(tones).not.toContain("warning");
    expect(tones).not.toContain("danger");
  });

  test("no word calls a function disconnected, or its link broken", () => {
    for (const status of ALL_STATUSES) {
      const words: ServerlessFunctionStatusWords =
        getServerlessFunctionStatusWords(status);

      for (const text of [words.label, words.description]) {
        expect(text).not.toMatch(
          /disconnect|connection|broken|offline|error|fail|stopped/i,
        );
      }
    }
  });

  test("the labels are short enough for a pill and differ from one another", () => {
    const labels: Array<string> = ALL_STATUSES.map(
      (status: ServerlessFunctionStatus): string => {
        return getServerlessFunctionStatusWords(status).label;
      },
    );

    expect(new Set(labels).size).toBe(3);
    for (const label of labels) {
      expect(label.length).toBeLessThanOrEqual(24);
      expect(label).toBe(label.trim());
    }
  });

  test("every tooltip is whole sentences that say what to do, if anything", () => {
    for (const status of ALL_STATUSES) {
      const description: string =
        getServerlessFunctionStatusWords(status).description;

      expect(description).toMatch(/^[A-Z].*\.$/);
      expect(description).not.toMatch(/\s{2}/);
      // Whole sentences: nothing is put in where the tooltip is drawn.
      expect(description).not.toMatch(/\{\{/);
    }

    // Quiet: why it is normal, and if it is not, where to look.
    expect(SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_DESCRIPTION).toContain(
      "only while it runs",
    );
    expect(SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_DESCRIPTION).toContain(
      "normal",
    );
    expect(SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_DESCRIPTION).toContain(
      "what to check",
    );
    // Waiting: how to start.
    expect(SERVERLESS_FUNCTION_WAITING_FOR_DATA_DESCRIPTION).toContain(
      "Documentation tab",
    );
  });

  /*
   * The tooltips say the number the sweep waits for (the sweep reads the
   * same constant): change one, and this fails until the words say it too.
   */
  test("the words say the sweep's number of minutes", () => {
    expect(SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_AFTER_MINUTES).toBe(15);
    expect(SERVERLESS_FUNCTION_RECEIVING_DATA_DESCRIPTION).toContain(
      `last ${SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_AFTER_MINUTES} minutes`,
    );
    expect(SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_DESCRIPTION).toContain(
      `last ${SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_AFTER_MINUTES} minutes`,
    );
  });

  test("a status it does not know reads as waiting, the state that claims least", () => {
    for (const unknown of [
      "disconnected",
      "connected",
      "no-recent-traffic",
      "",
      undefined,
      null,
    ]) {
      expect(
        getServerlessFunctionStatusWords(
          unknown as unknown as ServerlessFunctionStatus,
        ),
      ).toEqual(
        getServerlessFunctionStatusWords(
          ServerlessFunctionStatus.WaitingForData,
        ),
      );
    }
  });
});

describe("describeServerlessFunctionStatus", () => {
  test("is the status and its words together", () => {
    const input: ServerlessFunctionStatusInput = {
      otelCollectorStatus: "disconnected",
      lastSeenAt: THREE_HOURS_AGO,
    };

    expect(describeServerlessFunctionStatus(input)).toEqual({
      status: ServerlessFunctionStatus.NoRecentInvocations,
      ...getServerlessFunctionStatusWords(
        ServerlessFunctionStatus.NoRecentInvocations,
      ),
    });
  });

  test("leaves the record it reads as it was", () => {
    const input: ServerlessFunctionStatusInput = {
      otelCollectorStatus: "Connected",
      lastSeenAt: THREE_HOURS_AGO.toISOString(),
    };
    const before: string = JSON.stringify(input);

    describeServerlessFunctionStatus(input);

    expect(JSON.stringify(input)).toBe(before);
  });
});

/*
 * Drawn records - every stored value the column has held, odd cases and
 * casings, and dates real, unreal and missing - each read by the three
 * rules: "connected" or "active" in any case is receiving; otherwise a real
 * last-data date is no recent invocations; otherwise it is waiting. And the
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
    const random: SeededRandom = seededRandom(6269);
    const seen: Set<ServerlessFunctionStatus> = new Set();

    for (let index: number = 0; index < 5000; index++) {
      const input: ServerlessFunctionStatusInput = {
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

      const expected: ServerlessFunctionStatus =
        normalized === "connected" || normalized === "active"
          ? ServerlessFunctionStatus.ReceivingData
          : hasRealDate
            ? ServerlessFunctionStatus.NoRecentInvocations
            : ServerlessFunctionStatus.WaitingForData;

      const described: ServerlessFunctionStatusDescription =
        describeServerlessFunctionStatus(input);

      expect({ index, input, status: described.status }).toEqual({
        index,
        input,
        status: expected,
      });
      expect(described.label).toBe(
        getServerlessFunctionStatusWords(expected).label,
      );
      expect(described.tone).toBe(
        expected === ServerlessFunctionStatus.ReceivingData
          ? "positive"
          : "neutral",
      );
      seen.add(described.status);
    }

    // The draws reached every status.
    expect(seen).toEqual(new Set(ALL_STATUSES));
  });
});
