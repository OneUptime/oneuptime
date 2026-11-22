import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ScrubRuleValueCountService, {
  ScrubRuleValueCountEntry,
  ScrubRuleValueCountService as ScrubRuleValueCountServiceClass,
} from "../../../../Server/Services/ScrubRuleValueCountService";
import ScrubRuleValueCounter, {
  MAX_PENDING_KEYS,
} from "../../../../Server/Utils/Telemetry/ScrubRuleValueCounter";
import TelemetryFanInWriter from "../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONObject } from "../../../../Types/JSON";

/*
 * THE SCRUB RULE COUNTER (#10366).
 *
 * The engines hand it each record's counts; it adds them up a key per
 * project, rule, kind of record, service, version and hour, and writes
 * them through the telemetry fan-in writer as one row a key. A write that
 * fails is logged and let go, never thrown. Counts of no project or no
 * rule are not kept, and past its bound a new key waits for the next
 * write.
 */

const PROJECT_ID: string = "0192f1a0-0000-7000-8000-0000001036a0";
const RULE_ID: string = "0192f1a0-0000-7000-8000-0000001036a1";
const OTHER_RULE_ID: string = "0192f1a0-0000-7000-8000-0000001036a2";
const CHECKOUT: string = "0192f1a0-0000-7000-8000-0000001036a3";

const TEN_PAST: Date = new Date("2026-11-22T10:10:00.000Z");
const FIFTY_PAST: Date = new Date("2026-11-22T10:50:00.000Z");
const ELEVEN: Date = new Date("2026-11-22T11:05:00.000Z");

function add(
  counts: Array<[string, number]>,
  more: { now?: Date; serviceVersion?: string; signal?: "log" | "trace" } = {},
): void {
  ScrubRuleValueCounter.add({
    projectId: PROJECT_ID,
    signal: more.signal || "log",
    serviceId: CHECKOUT,
    serviceVersion: more.serviceVersion ?? "1.0.0",
    counts,
    now: more.now || TEN_PAST,
  });
}

beforeEach(() => {
  ScrubRuleValueCounter.reset();
});

afterEach(() => {
  ScrubRuleValueCounter.reset();
  jest.restoreAllMocks();
});

describe("adding up", () => {
  test("one key a rule, kind, service, version and hour; the latest change kept", () => {
    add([[RULE_ID, 2]]);
    add([[RULE_ID, 3]], { now: FIFTY_PAST });
    add([[RULE_ID, 1]], { now: ELEVEN });
    add([[RULE_ID, 4]], { serviceVersion: "1.1.0" });
    add([[OTHER_RULE_ID, 5]], { signal: "trace" });

    const entries: Array<ScrubRuleValueCountEntry> =
      ScrubRuleValueCounter.getPendingEntries();

    expect(
      entries.map((entry: ScrubRuleValueCountEntry): Array<unknown> => {
        return [
          entry.scrubRuleId,
          entry.signal,
          entry.serviceVersion,
          entry.hour.toISOString(),
          entry.valueCount,
        ];
      }),
    ).toEqual([
      [RULE_ID, "log", "1.0.0", "2026-11-22T10:00:00.000Z", 5],
      [RULE_ID, "log", "1.0.0", "2026-11-22T11:00:00.000Z", 1],
      [RULE_ID, "log", "1.1.0", "2026-11-22T10:00:00.000Z", 4],
      [OTHER_RULE_ID, "trace", "1.0.0", "2026-11-22T10:00:00.000Z", 5],
    ]);
    expect(entries[0]!.lastChangedAt).toEqual(FIFTY_PAST);
  });

  test("counts of no project, of a rule with no id, or of nothing are not kept", () => {
    ScrubRuleValueCounter.add({
      projectId: "not-a-project",
      signal: "log",
      serviceId: CHECKOUT,
      serviceVersion: "",
      counts: [[RULE_ID, 1]],
    });
    add([
      ["", 3],
      ["rule-1", 3],
      [RULE_ID, 0],
      [RULE_ID, -2],
    ]);

    expect(ScrubRuleValueCounter.getPendingEntries()).toEqual([]);
  });

  test("past its bound, a new key waits; a key already kept still adds up", () => {
    for (let index: number = 0; index < MAX_PENDING_KEYS; index++) {
      add([[RULE_ID, 1]], { serviceVersion: `v${index}` });
    }

    add([[RULE_ID, 1]], { serviceVersion: "one too many" });
    add([[RULE_ID, 1]], { serviceVersion: "v0" });

    const entries: Array<ScrubRuleValueCountEntry> =
      ScrubRuleValueCounter.getPendingEntries();

    expect(entries).toHaveLength(MAX_PENDING_KEYS);
    expect(
      entries.find((entry: ScrubRuleValueCountEntry): boolean => {
        return entry.serviceVersion === "v0";
      })!.valueCount,
    ).toBe(2);
  });
});

describe("writing", () => {
  test("one row a key, through the fan-in writer, and nothing waits after", async () => {
    const submit: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetryFanInWriter, "submit")
      .mockResolvedValue({ flushed: Promise.resolve() } as never);

    add([
      [RULE_ID, 2],
      [OTHER_RULE_ID, 1],
    ]);

    await ScrubRuleValueCounter.flush();

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]![0]).toBe(ScrubRuleValueCountService);

    const rows: Array<JSONObject> = submit.mock
      .calls[0]![1] as Array<JSONObject>;

    expect(rows).toEqual([
      {
        projectId: PROJECT_ID,
        scrubRuleId: RULE_ID,
        signal: "log",
        serviceId: CHECKOUT,
        serviceVersion: "1.0.0",
        hour: "2026-11-22 10:00:00",
        valueCount: 2,
        lastChangedAt: "2026-11-22 10:10:00",
      },
      {
        projectId: PROJECT_ID,
        scrubRuleId: OTHER_RULE_ID,
        signal: "log",
        serviceId: CHECKOUT,
        serviceVersion: "1.0.0",
        hour: "2026-11-22 10:00:00",
        valueCount: 1,
        lastChangedAt: "2026-11-22 10:10:00",
      },
    ]);
    expect(ScrubRuleValueCounter.getPendingEntries()).toEqual([]);

    // Nothing waiting: nothing written.
    await ScrubRuleValueCounter.flush();

    expect(submit).toHaveBeenCalledTimes(1);
  });

  test("a write that fails is let go, never thrown", async () => {
    jest
      .spyOn(TelemetryFanInWriter, "submit")
      .mockRejectedValue(new Error("ClickHouse is away") as never);

    add([[RULE_ID, 2]]);

    await expect(ScrubRuleValueCounter.flush()).resolves.toBeUndefined();
    expect(ScrubRuleValueCounter.getPendingEntries()).toEqual([]);
  });

  test("a row is only an entry of a project, a rule and a count", () => {
    expect(
      ScrubRuleValueCountServiceClass.toRows([
        {
          projectId: PROJECT_ID,
          scrubRuleId: RULE_ID,
          signal: "log",
          serviceId: "",
          serviceVersion: "",
          hour: TEN_PAST,
          valueCount: 0,
          lastChangedAt: TEN_PAST,
        },
        {
          projectId: "x",
          scrubRuleId: RULE_ID,
          signal: "log",
          serviceId: "",
          serviceVersion: "",
          hour: TEN_PAST,
          valueCount: 3,
          lastChangedAt: TEN_PAST,
        },
      ]),
    ).toEqual([]);
  });
});
