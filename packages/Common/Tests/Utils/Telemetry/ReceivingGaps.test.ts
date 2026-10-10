import ReceivingGapsUtil, {
  INGEST_BACKLOG_ALLOWANCE_MS,
  MAX_RECEIVING_LOOKBACK_EXTENSION_MS,
  OPEN_GAP_MAX_TRUST_MS,
  RECEIVING_GAP_THRESHOLD_MS,
  RECEIVING_HEARTBEAT_INTERVAL_MS,
  RECONNECT_GRACE_MS,
  ReceivingGap,
  ReceivingGapReason,
  ReceivingPeriod,
} from "../../../Utils/Telemetry/ReceivingGaps";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

const SECOND: number = 1_000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;

// Every scenario reads the clock from here, never from the machine.
const NOW: Date = new Date("2026-10-09T12:00:00.000Z");

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

function period(startOffset: number, lastOffset: number): ReceivingPeriod {
  return { startedAt: at(startOffset), lastReceivingAt: at(lastOffset) };
}

function gap(
  startOffset: number,
  endOffset: number,
  reason: ReceivingGapReason = ReceivingGapReason.NotReceiving,
): ReceivingGap {
  return { startsAt: at(startOffset), endsAt: at(endOffset), reason };
}

function describeGaps(
  gaps: Array<ReceivingGap>,
): Array<[number, number, string]> {
  return gaps.map((g: ReceivingGap): [number, number, string] => {
    return [
      g.startsAt.getTime() - NOW.getTime(),
      g.endsAt.getTime() - NOW.getTime(),
      g.reason,
    ];
  });
}

describe("ReceivingGaps constants", () => {
  test("a gap needs three missed heartbeats, so one late beat is never a gap", () => {
    expect(RECEIVING_GAP_THRESHOLD_MS).toBe(
      3 * RECEIVING_HEARTBEAT_INTERVAL_MS,
    );
  });

  test("the reconnect grace outlasts an OpenTelemetry collector's 30 s retry backoff", () => {
    expect(RECONNECT_GRACE_MS).toBeGreaterThan(30 * SECOND);
  });

  test("an open gap is believed for an hour at most, and the backlog allowance matches the charts' ingest lag", () => {
    expect(OPEN_GAP_MAX_TRUST_MS).toBe(HOUR);
    expect(INGEST_BACKLOG_ALLOWANCE_MS).toBe(MINUTE);
    expect(MAX_RECEIVING_LOOKBACK_EXTENSION_MS).toBe(30 * 24 * HOUR);
  });
});

describe("ReceivingGapsUtil.gapsFromPeriods", () => {
  test("an empty ledger knows nothing and invents no gap", () => {
    expect(
      ReceivingGapsUtil.gapsFromPeriods({
        periods: [],
        latestReceivingAt: null,
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("one period that is still being heartbeated has no gap at all", () => {
    expect(
      ReceivingGapsUtil.gapsFromPeriods({
        periods: [period(-5 * HOUR, -20 * SECOND)],
        latestReceivingAt: at(-20 * SECOND),
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("time before the first recorded period is unknown, not a gap", () => {
    // The ledger began an hour ago; nothing is claimed about the time before.
    const gaps: Array<ReceivingGap> = ReceivingGapsUtil.gapsFromPeriods({
      periods: [period(-1 * HOUR, -10 * SECOND)],
      latestReceivingAt: at(-10 * SECOND),
      now: NOW,
    });
    expect(gaps).toEqual([]);
    expect(ReceivingGapsUtil.getReceivingMs(gaps, at(-3 * HOUR), NOW)).toBe(
      3 * HOUR,
    );
  });

  test("a restart between two periods is a gap, followed by the reconnect grace", () => {
    // Receiving until 11:00, down until 11:12, receiving since.
    const gaps: Array<ReceivingGap> = ReceivingGapsUtil.gapsFromPeriods({
      periods: [
        period(-3 * HOUR, -1 * HOUR),
        period(-48 * MINUTE, -5 * SECOND),
      ],
      latestReceivingAt: at(-5 * SECOND),
      now: NOW,
    });
    expect(describeGaps(gaps)).toEqual([
      [-1 * HOUR, -48 * MINUTE, ReceivingGapReason.NotReceiving],
      [
        -48 * MINUTE,
        -48 * MINUTE + RECONNECT_GRACE_MS,
        ReceivingGapReason.Reconnecting,
      ],
    ]);
  });

  test("periods may arrive in any order", () => {
    const ordered: Array<ReceivingGap> = ReceivingGapsUtil.gapsFromPeriods({
      periods: [
        period(-3 * HOUR, -1 * HOUR),
        period(-48 * MINUTE, -5 * SECOND),
      ],
      latestReceivingAt: at(-5 * SECOND),
      now: NOW,
    });
    const reversed: Array<ReceivingGap> = ReceivingGapsUtil.gapsFromPeriods({
      periods: [
        period(-48 * MINUTE, -5 * SECOND),
        period(-3 * HOUR, -1 * HOUR),
      ],
      latestReceivingAt: at(-5 * SECOND),
      now: NOW,
    });
    expect(reversed).toEqual(ordered);
  });

  test("the reconnect grace never runs past now", () => {
    // OneUptime came back 30 seconds ago: grace has only run 30 seconds.
    const gaps: Array<ReceivingGap> = ReceivingGapsUtil.gapsFromPeriods({
      periods: [
        period(-2 * HOUR, -10 * MINUTE),
        period(-30 * SECOND, -30 * SECOND),
      ],
      latestReceivingAt: at(-30 * SECOND),
      now: NOW,
    });
    expect(describeGaps(gaps)).toEqual([
      [-10 * MINUTE, -30 * SECOND, ReceivingGapReason.NotReceiving],
      [-30 * SECOND, 0, ReceivingGapReason.Reconnecting],
    ]);
  });

  test("two replicas that each started a period after the same outage merge into one (multi-replica)", () => {
    const gaps: Array<ReceivingGap> = ReceivingGapsUtil.gapsFromPeriods({
      periods: [
        period(-2 * HOUR, -40 * MINUTE),
        // Both replicas found the ledger stale and both started a period.
        period(-30 * MINUTE, -29 * MINUTE),
        period(-30 * MINUTE + 2 * SECOND, -10 * SECOND),
      ],
      latestReceivingAt: at(-10 * SECOND),
      now: NOW,
    });
    expect(describeGaps(gaps)).toEqual([
      [-40 * MINUTE, -30 * MINUTE, ReceivingGapReason.NotReceiving],
      [
        -30 * MINUTE,
        -30 * MINUTE + RECONNECT_GRACE_MS,
        ReceivingGapReason.Reconnecting,
      ],
    ]);
  });

  test("periods closer than the threshold are one continuous stretch, not a gap", () => {
    const gaps: Array<ReceivingGap> = ReceivingGapsUtil.gapsFromPeriods({
      periods: [
        period(-2 * HOUR, -1 * HOUR),
        period(-1 * HOUR + RECEIVING_GAP_THRESHOLD_MS, -10 * SECOND),
      ],
      latestReceivingAt: at(-10 * SECOND),
      now: NOW,
    });
    expect(gaps).toEqual([]);
  });

  test("a stretch just over the threshold is a gap", () => {
    const gaps: Array<ReceivingGap> = ReceivingGapsUtil.gapsFromPeriods({
      periods: [
        period(-2 * HOUR, -1 * HOUR),
        period(-1 * HOUR + RECEIVING_GAP_THRESHOLD_MS + SECOND, -10 * SECOND),
      ],
      latestReceivingAt: at(-10 * SECOND),
      now: NOW,
    });
    expect(gaps[0]?.reason).toBe(ReceivingGapReason.NotReceiving);
    expect(gaps[0]?.startsAt).toEqual(at(-1 * HOUR));
  });

  test("no heartbeat for longer than the threshold is an open gap that runs to now", () => {
    const gaps: Array<ReceivingGap> = ReceivingGapsUtil.gapsFromPeriods({
      periods: [period(-3 * HOUR, -5 * MINUTE)],
      latestReceivingAt: at(-5 * MINUTE),
      now: NOW,
    });
    expect(describeGaps(gaps)).toEqual([
      [-5 * MINUTE, 0, ReceivingGapReason.NotReceiving],
    ]);
  });

  test("a heartbeat only just older than one interval is not an open gap", () => {
    const gaps: Array<ReceivingGap> = ReceivingGapsUtil.gapsFromPeriods({
      periods: [period(-3 * HOUR, -RECEIVING_GAP_THRESHOLD_MS)],
      latestReceivingAt: at(-RECEIVING_GAP_THRESHOLD_MS),
      now: NOW,
    });
    expect(gaps).toEqual([]);
  });

  test("an open gap is believed for an hour at most, so silence counts again after that", () => {
    const gaps: Array<ReceivingGap> = ReceivingGapsUtil.gapsFromPeriods({
      periods: [period(-10 * HOUR, -3 * HOUR)],
      latestReceivingAt: at(-3 * HOUR),
      now: NOW,
    });
    expect(describeGaps(gaps)).toEqual([
      [
        -3 * HOUR,
        -3 * HOUR + OPEN_GAP_MAX_TRUST_MS,
        ReceivingGapReason.NotReceiving,
      ],
    ]);
  });

  test("only the ledger's newest period can have an open gap after it", () => {
    /*
     * Reading yesterday: the last period read ended at 09:00, but the ledger
     * holds a newer heartbeat, so 09:00 onwards is not an open gap.
     */
    const gaps: Array<ReceivingGap> = ReceivingGapsUtil.gapsFromPeriods({
      periods: [period(-10 * HOUR, -3 * HOUR)],
      latestReceivingAt: at(-5 * SECOND),
      now: NOW,
    });
    expect(gaps).toEqual([]);
  });

  test("a heartbeat stamped in the future (clock skew) still only proves receiving up to now", () => {
    const gaps: Array<ReceivingGap> = ReceivingGapsUtil.gapsFromPeriods({
      periods: [period(-1 * HOUR, 30 * SECOND)],
      latestReceivingAt: at(30 * SECOND),
      now: NOW,
    });
    expect(gaps).toEqual([]);
  });

  test("malformed periods are ignored", () => {
    const gaps: Array<ReceivingGap> = ReceivingGapsUtil.gapsFromPeriods({
      periods: [
        { startedAt: new Date("not a date"), lastReceivingAt: at(-HOUR) },
        null as unknown as ReceivingPeriod,
        period(-2 * HOUR, -10 * SECOND),
      ],
      latestReceivingAt: at(-10 * SECOND),
      now: NOW,
    });
    expect(gaps).toEqual([]);
  });

  test("a restart that recurs within the grace keeps the not-receiving reason where they overlap", () => {
    const gaps: Array<ReceivingGap> = ReceivingGapsUtil.gapsFromPeriods({
      periods: [
        period(-3 * HOUR, -60 * MINUTE),
        // Back for only 40 seconds, then down again.
        period(-50 * MINUTE, -50 * MINUTE + 40 * SECOND),
        period(-40 * MINUTE, -5 * SECOND),
      ],
      latestReceivingAt: at(-5 * SECOND),
      now: NOW,
    });
    expect(describeGaps(gaps)).toEqual([
      [-60 * MINUTE, -50 * MINUTE, ReceivingGapReason.NotReceiving],
      [
        -50 * MINUTE,
        -50 * MINUTE + 40 * SECOND,
        ReceivingGapReason.Reconnecting,
      ],
      [
        -50 * MINUTE + 40 * SECOND,
        -40 * MINUTE,
        ReceivingGapReason.NotReceiving,
      ],
      [
        -40 * MINUTE,
        -40 * MINUTE + RECONNECT_GRACE_MS,
        ReceivingGapReason.Reconnecting,
      ],
    ]);
  });
});

describe("ReceivingGapsUtil.normalize", () => {
  test("sorts, drops empty and malformed gaps, and joins touching ones of the same reason", () => {
    const normalized: Array<ReceivingGap> = ReceivingGapsUtil.normalize([
      gap(10 * MINUTE, 20 * MINUTE),
      gap(0, 10 * MINUTE),
      gap(30 * MINUTE, 30 * MINUTE),
      gap(40 * MINUTE, 35 * MINUTE),
      {
        startsAt: at(0),
        endsAt: at(MINUTE),
        reason: "Nope" as ReceivingGapReason,
      },
      {
        startsAt: "2026" as unknown as Date,
        endsAt: at(MINUTE),
        reason: ReceivingGapReason.NotReceiving,
      },
    ]);
    expect(describeGaps(normalized)).toEqual([
      [0, 20 * MINUTE, ReceivingGapReason.NotReceiving],
    ]);
  });

  test("where gaps overlap, not receiving outranks reconnecting, which outranks catching up", () => {
    const normalized: Array<ReceivingGap> = ReceivingGapsUtil.normalize([
      gap(0, 30 * MINUTE, ReceivingGapReason.CatchingUp),
      gap(5 * MINUTE, 20 * MINUTE, ReceivingGapReason.Reconnecting),
      gap(10 * MINUTE, 15 * MINUTE, ReceivingGapReason.NotReceiving),
    ]);
    expect(describeGaps(normalized)).toEqual([
      [0, 5 * MINUTE, ReceivingGapReason.CatchingUp],
      [5 * MINUTE, 10 * MINUTE, ReceivingGapReason.Reconnecting],
      [10 * MINUTE, 15 * MINUTE, ReceivingGapReason.NotReceiving],
      [15 * MINUTE, 20 * MINUTE, ReceivingGapReason.Reconnecting],
      [20 * MINUTE, 30 * MINUTE, ReceivingGapReason.CatchingUp],
    ]);
  });

  test("a null list normalizes to no gaps", () => {
    expect(
      ReceivingGapsUtil.normalize(null as unknown as Array<ReceivingGap>),
    ).toEqual([]);
  });
});

describe("ReceivingGapsUtil time arithmetic", () => {
  const gaps: Array<ReceivingGap> = [
    gap(-50 * MINUTE, -40 * MINUTE),
    gap(-40 * MINUTE, -38 * MINUTE, ReceivingGapReason.Reconnecting),
    gap(-5 * MINUTE, 0, ReceivingGapReason.CatchingUp),
  ];

  test("clip keeps only the parts inside the window", () => {
    expect(
      describeGaps(
        ReceivingGapsUtil.clip(gaps, at(-45 * MINUTE), at(-39 * MINUTE)),
      ),
    ).toEqual([
      [-45 * MINUTE, -40 * MINUTE, ReceivingGapReason.NotReceiving],
      [-40 * MINUTE, -39 * MINUTE, ReceivingGapReason.Reconnecting],
    ]);
    expect(ReceivingGapsUtil.clip(gaps, at(0), at(-1 * MINUTE))).toEqual([]);
  });

  test("overlaps tells a window that touches a gap from one that does not", () => {
    expect(
      ReceivingGapsUtil.overlaps(gaps, at(-60 * MINUTE), at(-49 * MINUTE)),
    ).toBe(true);
    expect(
      ReceivingGapsUtil.overlaps(gaps, at(-30 * MINUTE), at(-10 * MINUTE)),
    ).toBe(false);
    // Touching a gap's edge is not overlapping it.
    expect(
      ReceivingGapsUtil.overlaps(gaps, at(-38 * MINUTE), at(-5 * MINUTE)),
    ).toBe(false);
  });

  test("not-receiving and receiving time always add up to the window", () => {
    const from: Date = at(-60 * MINUTE);
    const notReceivingMs: number = ReceivingGapsUtil.getNotReceivingMs(
      gaps,
      from,
      NOW,
    );
    const receivingMs: number = ReceivingGapsUtil.getReceivingMs(
      gaps,
      from,
      NOW,
    );
    expect(notReceivingMs).toBe(17 * MINUTE);
    expect(receivingMs).toBe(43 * MINUTE);
    expect(notReceivingMs + receivingMs).toBe(60 * MINUTE);
  });

  test("a silence that partly overlaps a gap only counts the receiving part", () => {
    // Last heard at 11:15; OneUptime was down 11:10-11:20 and reconnecting to 11:22.
    expect(
      ReceivingGapsUtil.getReceivingMs(
        gaps,
        at(-45 * MINUTE),
        at(-30 * MINUTE),
      ),
    ).toBe(8 * MINUTE);
  });

  test("an empty or reversed window has no receiving time", () => {
    expect(ReceivingGapsUtil.getReceivingMs(gaps, NOW, NOW)).toBe(0);
    expect(ReceivingGapsUtil.getReceivingMs(gaps, NOW, at(-MINUTE))).toBe(0);
    expect(ReceivingGapsUtil.getReceivingMs(gaps, new Date("x"), NOW)).toBe(0);
  });

  test("the latest overlapping end is the end of the newest gap inside the window", () => {
    expect(
      ReceivingGapsUtil.getLatestOverlappingEnd(
        gaps,
        at(-55 * MINUTE),
        at(-20 * MINUTE),
      ),
    ).toEqual(at(-38 * MINUTE));
    expect(
      ReceivingGapsUtil.getLatestOverlappingEnd(
        gaps,
        at(-30 * MINUTE),
        at(-10 * MINUTE),
      ),
    ).toBeNull();
  });
});

describe("ReceivingGapsUtil.getReceivingWindowStart", () => {
  test("with no gaps the window is simply the requested length", () => {
    expect(
      ReceivingGapsUtil.getReceivingWindowStart({
        gaps: [],
        endsAt: NOW,
        receivingMs: 15 * MINUTE,
      }),
    ).toEqual(at(-15 * MINUTE));
  });

  test("a gap inside the window pushes its start back by the gap's length", () => {
    expect(
      ReceivingGapsUtil.getReceivingWindowStart({
        gaps: [gap(-10 * MINUTE, -4 * MINUTE)],
        endsAt: NOW,
        receivingMs: 15 * MINUTE,
      }),
    ).toEqual(at(-21 * MINUTE));
  });

  test("a gap that ends at now means all the receiving time comes from before it", () => {
    expect(
      ReceivingGapsUtil.getReceivingWindowStart({
        gaps: [gap(-12 * MINUTE, 0)],
        endsAt: NOW,
        receivingMs: 3 * MINUTE,
      }),
    ).toEqual(at(-15 * MINUTE));
  });

  test("several gaps are all skipped", () => {
    expect(
      ReceivingGapsUtil.getReceivingWindowStart({
        gaps: [
          gap(-2 * MINUTE, 0, ReceivingGapReason.CatchingUp),
          gap(-30 * MINUTE, -20 * MINUTE),
          gap(-20 * MINUTE, -18 * MINUTE, ReceivingGapReason.Reconnecting),
        ],
        endsAt: NOW,
        receivingMs: 20 * MINUTE,
      }),
    ).toEqual(at(-34 * MINUTE));
  });

  test("a gap older than the window does not move it", () => {
    expect(
      ReceivingGapsUtil.getReceivingWindowStart({
        gaps: [gap(-3 * HOUR, -2 * HOUR)],
        endsAt: NOW,
        receivingMs: 15 * MINUTE,
      }),
    ).toEqual(at(-15 * MINUTE));
  });

  test("a gap after the window's end does not move it", () => {
    expect(
      ReceivingGapsUtil.getReceivingWindowStart({
        gaps: [gap(-5 * MINUTE, 0)],
        endsAt: at(-10 * MINUTE),
        receivingMs: 15 * MINUTE,
      }),
    ).toEqual(at(-25 * MINUTE));
  });

  test("the walk back never reaches further than the extension cap", () => {
    expect(
      ReceivingGapsUtil.getReceivingWindowStart({
        gaps: [gap(-3 * 24 * HOUR, -1 * MINUTE)],
        endsAt: NOW,
        receivingMs: 15 * MINUTE,
        maxExtensionMs: 2 * HOUR,
      }),
    ).toEqual(at(-(15 * MINUTE + 2 * HOUR)));
  });

  test("an outage over a long weekend is walked past in full: the silence threshold is still receiving time", () => {
    // Down for three days, back a minute ago: 14 of the 15 minutes come from before.
    expect(
      ReceivingGapsUtil.getReceivingWindowStart({
        gaps: [gap(-3 * 24 * HOUR, -1 * MINUTE)],
        endsAt: NOW,
        receivingMs: 15 * MINUTE,
      }),
    ).toEqual(at(-(3 * 24 * HOUR + 14 * MINUTE)));
  });

  test("the default extension cap is thirty days", () => {
    expect(
      ReceivingGapsUtil.getReceivingWindowStart({
        gaps: [gap(-60 * 24 * HOUR, 0)],
        endsAt: NOW,
        receivingMs: 15 * MINUTE,
      }),
    ).toEqual(at(-(15 * MINUTE + MAX_RECEIVING_LOOKBACK_EXTENSION_MS)));
  });

  test("a negative length is treated as zero", () => {
    expect(
      ReceivingGapsUtil.getReceivingWindowStart({
        gaps: [],
        endsAt: NOW,
        receivingMs: -5 * MINUTE,
      }),
    ).toEqual(NOW);
  });

  test("the window it returns holds exactly the requested receiving time", () => {
    const gaps: Array<ReceivingGap> = [
      gap(-7 * MINUTE, -5 * MINUTE),
      gap(-40 * MINUTE, -22 * MINUTE),
      gap(-90 * SECOND, 0, ReceivingGapReason.CatchingUp),
    ];
    for (const minutes of [1, 3, 5, 10, 15, 30, 60]) {
      const start: Date = ReceivingGapsUtil.getReceivingWindowStart({
        gaps,
        endsAt: NOW,
        receivingMs: minutes * MINUTE,
      });
      expect(ReceivingGapsUtil.getReceivingMs(gaps, start, NOW)).toBe(
        minutes * MINUTE,
      );
    }
  });
});

describe("ReceivingGapsUtil JSON", () => {
  test("round-trips through toJSON and fromJSON", () => {
    const gaps: Array<ReceivingGap> = [
      gap(-50 * MINUTE, -40 * MINUTE),
      gap(-40 * MINUTE, -38 * MINUTE, ReceivingGapReason.Reconnecting),
      gap(-90 * SECOND, 0, ReceivingGapReason.CatchingUp),
    ];
    const json: JSONArray = ReceivingGapsUtil.toJSON(gaps);
    expect((json[0] as JSONObject)["startsAt"]).toBe(
      at(-50 * MINUTE).toISOString(),
    );
    expect(ReceivingGapsUtil.fromJSON(json)).toEqual(
      ReceivingGapsUtil.normalize(gaps),
    );
  });

  test("anything that is not a gap is dropped rather than trusted", () => {
    expect(ReceivingGapsUtil.fromJSON(undefined)).toEqual([]);
    expect(ReceivingGapsUtil.fromJSON("gaps")).toEqual([]);
    expect(
      ReceivingGapsUtil.fromJSON([
        null,
        "x",
        [],
        {
          startsAt: "nope",
          endsAt: at(0).toISOString(),
          reason: "NotReceiving",
        },
        { startsAt: at(-MINUTE).toISOString(), endsAt: at(0).toISOString() },
        {
          startsAt: at(-MINUTE).toISOString(),
          endsAt: at(0).toISOString(),
          reason: "Down",
        },
        {
          startsAt: at(-MINUTE).getTime(),
          endsAt: at(0).toISOString(),
          reason: "CatchingUp",
        },
      ]),
    ).toEqual([gap(-MINUTE, 0, ReceivingGapReason.CatchingUp)]);
  });
});
