import { describe, expect, test } from "@jest/globals";
import {
  NetworkDeviceTransceiver,
  SnmpTransceiverResult,
  TransceiverFault,
  TransceiverHealth,
  TransceiverMeasurements,
  TransceiverMibSource,
  TransceiverReadingKind,
  TransceiverRxPowerHistory,
  TransceiverThresholds,
} from "../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import TransceiverHealthUtil, {
  MAX_TRANSCEIVERS_PER_DEVICE,
  TRANSCEIVER_MISSING_CONFIRMATION_POLLS,
  TRANSCEIVER_RX_BASELINE_DAYS,
  TRANSCEIVER_RX_DROP_ALERT_DB,
  TransceiverInterfaceRef,
  TransceiverReadingLevel,
  TransceiverReadingVerdict,
  TransceiverRxPowerTrend,
} from "../../../Utils/NetworkDevice/TransceiverHealthUtil";

/*
 * The one judge of a transceiver. The device's Interfaces page, the five
 * transceiver criteria, the alert text and OneUptime AI all read it, so the
 * rules here are the product's rules: when a reading has crossed a
 * threshold, when an optic counts as gone, how the received power trend and
 * its "falling" rule are measured, and how each poll is folded into what a
 * device stores.
 */

const LR_RX_THRESHOLDS: TransceiverThresholds = {
  lowAlarm: -18.4,
  lowWarning: -14.4,
  highWarning: 0.5,
  highAlarm: 2.5,
};

function measurements(
  values: Partial<Record<TransceiverReadingKind, number | Array<number>>>,
  thresholds: Partial<Record<TransceiverReadingKind, TransceiverThresholds>> = {},
): TransceiverMeasurements {
  const result: TransceiverMeasurements = {};

  for (const kind of Object.keys(values) as Array<TransceiverReadingKind>) {
    const value: number | Array<number> = values[kind]!;
    result[kind] = {
      readings: Array.isArray(value)
        ? value.map((lane: number, index: number) => {
            return { value: lane, lane: index + 1 };
          })
        : [{ value: value }],
      ...(thresholds[kind] ? { thresholds: thresholds[kind] } : {}),
    };
  }

  return result;
}

function result(
  interfaceIndex: number,
  overrides: Partial<SnmpTransceiverResult> = {},
): SnmpTransceiverResult {
  return {
    interfaceIndex: interfaceIndex,
    vendor: "FS",
    partNumber: "SFP-10GLR-31",
    serialNumber: `SN-${interfaceIndex}`,
    measurements: measurements(
      { rxPower: -4, txPower: -2, temperature: 35 },
      { rxPower: LR_RX_THRESHOLDS },
    ),
    source: TransceiverMibSource.CiscoEntitySensor,
    ...overrides,
  };
}

function port(
  interfaceIndex: number,
  overrides: Partial<TransceiverInterfaceRef> = {},
): TransceiverInterfaceRef {
  return {
    interfaceIndex: interfaceIndex,
    name: `Te1/1/${interfaceIndex}`,
    isAdministrativelyUp: true,
    ...overrides,
  };
}

const NOW: Date = new Date("2026-10-09T12:00:00.000Z");

describe("normalizeThresholds", () => {
  test("keeps a complete, ordered set as it is", () => {
    expect(TransceiverHealthUtil.normalizeThresholds(LR_RX_THRESHOLDS)).toEqual(
      LR_RX_THRESHOLDS,
    );
  });

  test("keeps a partial set: plenty of devices report alarms only", () => {
    expect(
      TransceiverHealthUtil.normalizeThresholds({ highAlarm: 75, lowAlarm: -5 }),
    ).toEqual({ highAlarm: 75, lowAlarm: -5 });
  });

  test("drops a set where every value is the same - zeros for 'not supported'", () => {
    expect(
      TransceiverHealthUtil.normalizeThresholds({
        lowAlarm: 0,
        lowWarning: 0,
        highWarning: 0,
        highAlarm: 0,
      }),
    ).toBeUndefined();
    expect(
      TransceiverHealthUtil.normalizeThresholds({
        lowAlarm: -40,
        lowWarning: -40,
        highWarning: -40,
        highAlarm: -40,
      }),
    ).toBeUndefined();
  });

  test("drops a low limit above its high one, keeping the other pair", () => {
    expect(
      TransceiverHealthUtil.normalizeThresholds({
        lowAlarm: 10,
        highAlarm: 5,
        lowWarning: -1,
        highWarning: 4,
      }),
    ).toEqual({ lowWarning: -1, highWarning: 4 });
  });

  test("ignores values that are not finite numbers", () => {
    expect(
      TransceiverHealthUtil.normalizeThresholds({
        lowAlarm: NaN,
        highAlarm: Infinity,
        lowWarning: "x" as unknown as number,
      }),
    ).toBeUndefined();
  });

  test("undefined stays undefined", () => {
    expect(TransceiverHealthUtil.normalizeThresholds(undefined)).toBeUndefined();
  });
});

describe("judgeReading", () => {
  test.each<[number, TransceiverReadingLevel, string | undefined]>([
    [-4, TransceiverReadingLevel.Ok, undefined],
    [-14.4, TransceiverReadingLevel.Warning, "low warning"],
    [-16, TransceiverReadingLevel.Warning, "low warning"],
    [-18.4, TransceiverReadingLevel.Alarm, "low alarm"],
    [-40, TransceiverReadingLevel.Alarm, "low alarm"],
    [0.5, TransceiverReadingLevel.Warning, "high warning"],
    [1, TransceiverReadingLevel.Warning, "high warning"],
    [2.5, TransceiverReadingLevel.Alarm, "high alarm"],
    [5, TransceiverReadingLevel.Alarm, "high alarm"],
  ])(
    "RX power %s dBm against a 10G-LR's thresholds is %s",
    (value: number, level: TransceiverReadingLevel, crossed?: string) => {
      const verdict: ReturnType<typeof TransceiverHealthUtil.judgeReading> =
        TransceiverHealthUtil.judgeReading(value, LR_RX_THRESHOLDS);

      expect(verdict.level).toBe(level);
      expect(
        verdict.crossing
          ? `${verdict.crossing.side} ${verdict.crossing.severity}`
          : undefined,
      ).toBe(crossed);
    },
  );

  test("a reading AT a threshold has crossed it, as the devices compare", () => {
    expect(
      TransceiverHealthUtil.judgeReading(75, { highAlarm: 75 }).level,
    ).toBe(TransceiverReadingLevel.Alarm);
  });

  test("the crossing names the threshold it crossed", () => {
    expect(
      TransceiverHealthUtil.judgeReading(-20, LR_RX_THRESHOLDS).crossing
        ?.threshold,
    ).toBe(-18.4);
  });

  test("with no thresholds there is nothing to judge", () => {
    expect(TransceiverHealthUtil.judgeReading(-30, undefined)).toEqual({
      level: TransceiverReadingLevel.NotJudged,
    });
  });
});

describe("getReadingVerdicts and getHealth", () => {
  test("verdicts come in display order, every lane its own", () => {
    const verdicts: Array<TransceiverReadingVerdict> =
      TransceiverHealthUtil.getReadingVerdicts(
        measurements({
          temperature: 40,
          rxPower: [-2, -3],
          biasCurrent: 6,
        }),
      );

    expect(
      verdicts.map((verdict: TransceiverReadingVerdict) => {
        return `${verdict.kind}${verdict.lane ?? ""}`;
      }),
    ).toEqual(["rxPower1", "rxPower2", "temperature", "biasCurrent"]);
  });

  test("readings that are not finite numbers are skipped", () => {
    expect(
      TransceiverHealthUtil.getReadingVerdicts({
        rxPower: { readings: [{ value: NaN }, { value: -3 }] },
      }),
    ).toHaveLength(1);
  });

  test("not present is not detected, whatever else it carries", () => {
    expect(
      TransceiverHealthUtil.getHealth({
        isPresent: false,
        faults: [TransceiverFault.TxFault],
      }),
    ).toBe(TransceiverHealth.NotDetected);
  });

  test("a disabled port is not judged: its laser is off by design", () => {
    expect(
      TransceiverHealthUtil.getHealth({
        isPresent: true,
        isPortDisabled: true,
        measurements: measurements(
          { txPower: -40 },
          { txPower: { lowAlarm: -8.2, highAlarm: 3.5 } },
        ),
        faults: [TransceiverFault.TxFault],
      }),
    ).toBe(TransceiverHealth.PortDisabled);
  });

  test("a fault the device flags is an alarm", () => {
    expect(
      TransceiverHealthUtil.getHealth({
        isPresent: true,
        faults: [TransceiverFault.RxLossOfSignal],
        measurements: {},
      }),
    ).toBe(TransceiverHealth.Alarm);
  });

  test("the worst reading decides: alarm over warning over healthy", () => {
    expect(
      TransceiverHealthUtil.getHealth({
        isPresent: true,
        measurements: measurements(
          { rxPower: [-3, -15], temperature: 80 },
          {
            rxPower: LR_RX_THRESHOLDS,
            temperature: { highWarning: 70, highAlarm: 75 },
          },
        ),
      }),
    ).toBe(TransceiverHealth.Alarm);

    expect(
      TransceiverHealthUtil.getHealth({
        isPresent: true,
        measurements: measurements(
          { rxPower: [-3, -15] },
          { rxPower: LR_RX_THRESHOLDS },
        ),
      }),
    ).toBe(TransceiverHealth.Warning);

    expect(
      TransceiverHealthUtil.getHealth({
        isPresent: true,
        measurements: measurements(
          { rxPower: -3 },
          { rxPower: LR_RX_THRESHOLDS },
        ),
      }),
    ).toBe(TransceiverHealth.Healthy);
  });

  test("readings with no thresholds anywhere, or no readings at all, are not judged", () => {
    expect(
      TransceiverHealthUtil.getHealth({
        isPresent: true,
        measurements: measurements({ rxPower: -30 }),
      }),
    ).toBe(TransceiverHealth.NotJudged);
    expect(
      TransceiverHealthUtil.getHealth({ isPresent: true, measurements: {} }),
    ).toBe(TransceiverHealth.NotJudged);
  });
});

describe("getExtremeReading / getLowestRxPowerDbm", () => {
  test("the weakest lane of a QSFP is its received power", () => {
    const quad: TransceiverMeasurements = measurements({
      rxPower: [-2.1, -2.4, -8.6, -2.0],
    });

    expect(TransceiverHealthUtil.getLowestRxPowerDbm(quad)).toBe(-8.6);
    expect(
      TransceiverHealthUtil.getExtremeReading(
        quad,
        TransceiverReadingKind.RxPower,
        "lowest",
      )?.lane,
    ).toBe(3);
    expect(
      TransceiverHealthUtil.getExtremeReading(
        quad,
        TransceiverReadingKind.RxPower,
        "highest",
      )?.value,
    ).toBe(-2.0);
  });

  test("no readings, no value", () => {
    expect(TransceiverHealthUtil.getLowestRxPowerDbm({})).toBeUndefined();
    expect(TransceiverHealthUtil.getLowestRxPowerDbm(undefined)).toBeUndefined();
  });
});

describe("isConfirmedMissing", () => {
  const missing: (polls: number | undefined) => NetworkDeviceTransceiver = (
    polls: number | undefined,
  ): NetworkDeviceTransceiver => {
    return {
      interfaceIndex: 1,
      isPresent: false,
      measurements: {},
      health: TransceiverHealth.NotDetected,
      missingPolls: polls,
    };
  };

  test(`takes ${TRANSCEIVER_MISSING_CONFIRMATION_POLLS} polls in a row`, () => {
    expect(TRANSCEIVER_MISSING_CONFIRMATION_POLLS).toBe(2);
    expect(TransceiverHealthUtil.isConfirmedMissing(missing(undefined))).toBe(
      false,
    );
    expect(TransceiverHealthUtil.isConfirmedMissing(missing(1))).toBe(false);
    expect(TransceiverHealthUtil.isConfirmedMissing(missing(2))).toBe(true);
    expect(TransceiverHealthUtil.isConfirmedMissing(missing(30))).toBe(true);
  });

  test("a present optic is never missing", () => {
    expect(
      TransceiverHealthUtil.isConfirmedMissing({
        ...missing(5),
        isPresent: true,
      }),
    ).toBe(false);
  });
});

describe("updateRxPowerHistory", () => {
  test("the first reading starts the history on today's UTC day", () => {
    expect(
      TransceiverHealthUtil.updateRxPowerHistory(undefined, -4.5, NOW),
    ).toEqual({
      firstDay: "2026-10-09",
      dailyAverageDbm: [-4.5],
      lastDaySamples: 1,
    });
  });

  test("readings on the same day make a running average", () => {
    let history: TransceiverRxPowerHistory =
      TransceiverHealthUtil.updateRxPowerHistory(undefined, -4, NOW);
    history = TransceiverHealthUtil.updateRxPowerHistory(history, -5, NOW);
    history = TransceiverHealthUtil.updateRxPowerHistory(history, -6, NOW);

    expect(history.dailyAverageDbm).toEqual([-5]);
    expect(history.lastDaySamples).toBe(3);
  });

  test("a new day gets its own entry", () => {
    let history: TransceiverRxPowerHistory =
      TransceiverHealthUtil.updateRxPowerHistory(undefined, -4, NOW);
    history = TransceiverHealthUtil.updateRxPowerHistory(
      history,
      -4.2,
      new Date("2026-10-10T00:05:00.000Z"),
    );

    expect(history).toEqual({
      firstDay: "2026-10-09",
      dailyAverageDbm: [-4, -4.2],
      lastDaySamples: 1,
    });
  });

  test("days with no reading are kept as gaps", () => {
    const history: TransceiverRxPowerHistory =
      TransceiverHealthUtil.updateRxPowerHistory(
        { firstDay: "2026-10-06", dailyAverageDbm: [-4], lastDaySamples: 10 },
        -4.4,
        NOW,
      );

    expect(history.dailyAverageDbm).toEqual([-4, null, null, -4.4]);
  });

  test("a gap wider than the baseline window starts over", () => {
    expect(
      TransceiverHealthUtil.updateRxPowerHistory(
        { firstDay: "2026-08-01", dailyAverageDbm: [-4], lastDaySamples: 10 },
        -6,
        NOW,
      ),
    ).toEqual({
      firstDay: "2026-10-09",
      dailyAverageDbm: [-6],
      lastDaySamples: 1,
    });
  });

  test(`never holds more than ${TRANSCEIVER_RX_BASELINE_DAYS} days plus today`, () => {
    let history: TransceiverRxPowerHistory | undefined = undefined;
    const start: number = NOW.getTime();

    for (let day: number = 0; day < 45; day++) {
      history = TransceiverHealthUtil.updateRxPowerHistory(
        history,
        -4 - day * 0.01,
        new Date(start + day * 24 * 3600 * 1000),
      );
    }

    expect(history!.dailyAverageDbm).toHaveLength(
      TRANSCEIVER_RX_BASELINE_DAYS + 1,
    );
    expect(history!.firstDay).toBe(
      TransceiverHealthUtil.addDays("2026-10-09", 45 - 31),
    );
    expect(history!.dailyAverageDbm[30]).toBeCloseTo(-4.44, 5);
  });

  test("a clock that went backwards leaves the history as it was", () => {
    const history: TransceiverRxPowerHistory = {
      firstDay: "2026-10-09",
      dailyAverageDbm: [-4],
      lastDaySamples: 3,
    };

    expect(
      TransceiverHealthUtil.updateRxPowerHistory(
        history,
        -9,
        new Date("2026-10-08T12:00:00.000Z"),
      ),
    ).toBe(history);
  });

  test("a damaged stored history is started over rather than trusted", () => {
    expect(
      TransceiverHealthUtil.updateRxPowerHistory(
        {
          firstDay: "not a day",
          dailyAverageDbm: [-4],
          lastDaySamples: 1,
        },
        -5,
        NOW,
      ).dailyAverageDbm,
    ).toEqual([-5]);
  });
});

describe("getRxPowerTrend - the 'falling' rule", () => {
  function withHistory(
    days: Array<number | null>,
    currentDbm: number | undefined,
  ): Pick<NetworkDeviceTransceiver, "rxPowerHistory" | "measurements"> {
    return {
      rxPowerHistory: {
        firstDay: "2026-09-20",
        dailyAverageDbm: days,
        lastDaySamples: 5,
      },
      measurements:
        currentDbm === undefined ? {} : measurements({ rxPower: currentDbm }),
    };
  }

  test("drop = best day of the previous days - the latest reading", () => {
    const trend: TransceiverRxPowerTrend = TransceiverHealthUtil.getRxPowerTrend(
      withHistory([-4.0, -3.8, -4.4, -5.6, -6.1], -6.3),
    );

    expect(trend.baselineDbm).toBe(-3.8);
    expect(trend.baselineDay).toBe("2026-09-21");
    expect(trend.currentDbm).toBe(-6.3);
    expect(trend.dropDb).toBe(2.5);
    expect(trend.dropDb!).toBeGreaterThanOrEqual(TRANSCEIVER_RX_DROP_ALERT_DB);
  });

  test("today is not part of its own baseline, so a drop today shows in full", () => {
    const trend: TransceiverRxPowerTrend = TransceiverHealthUtil.getRxPowerTrend(
      withHistory([-4, -4, -12], -20),
    );

    expect(trend.baselineDbm).toBe(-4);
    expect(trend.dropDb).toBe(16);
  });

  test("a slow slide is measured from where the link started", () => {
    const days: Array<number> = Array.from({ length: 25 }, (_v: unknown, i: number) => {
      return -4 - i * 0.1;
    });
    const trend: TransceiverRxPowerTrend = TransceiverHealthUtil.getRxPowerTrend(
      withHistory(days, -6.5),
    );

    expect(trend.baselineDbm).toBe(-4);
    expect(trend.dropDb).toBe(2.5);
  });

  test("a light that got better is a negative drop", () => {
    expect(
      TransceiverHealthUtil.getRxPowerTrend(withHistory([-6, -6], -4)).dropDb,
    ).toBe(-2);
  });

  test("days without readings are not points and not baselines", () => {
    const trend: TransceiverRxPowerTrend = TransceiverHealthUtil.getRxPowerTrend(
      withHistory([null, -5, null, -5.5], -5.5),
    );

    expect(
      trend.points.map((point: { day: string }) => {
        return point.day;
      }),
    ).toEqual(["2026-09-21", "2026-09-23"]);
    expect(trend.baselineDbm).toBe(-5);
  });

  test("one day of history is no baseline yet", () => {
    const trend: TransceiverRxPowerTrend = TransceiverHealthUtil.getRxPowerTrend(
      withHistory([-4], -4),
    );

    expect(trend.baselineDbm).toBeUndefined();
    expect(trend.dropDb).toBeUndefined();
    expect(trend.points).toHaveLength(1);
  });

  test("no reading now, no drop", () => {
    expect(
      TransceiverHealthUtil.getRxPowerTrend(withHistory([-4, -5], undefined))
        .dropDb,
    ).toBeUndefined();
  });

  test("no history at all", () => {
    expect(
      TransceiverHealthUtil.getRxPowerTrend({
        measurements: measurements({ rxPower: -3 }),
      }),
    ).toEqual({ points: [], currentDbm: -3 });
  });
});

describe("mergeSnapshot", () => {
  test("a poll that read nothing new leaves the stored snapshot alone", () => {
    expect(
      TransceiverHealthUtil.mergeSnapshot({
        previous: [],
        results: undefined,
        source: undefined,
        interfaces: [port(1)],
        now: NOW,
      }),
    ).toBeUndefined();
  });

  test("an empty answer from no MIB at all is not every optic pulled", () => {
    const previous: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: [],
        results: [result(1)],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1)],
        now: NOW,
      })!;

    expect(
      TransceiverHealthUtil.mergeSnapshot({
        previous: previous,
        results: [],
        source: undefined,
        interfaces: [port(1)],
        now: NOW,
      }),
    ).toBeUndefined();
  });

  test("nothing stored and nothing found writes nothing", () => {
    expect(
      TransceiverHealthUtil.mergeSnapshot({
        previous: undefined,
        results: [],
        source: TransceiverMibSource.EntitySensor,
        interfaces: [port(1)],
        now: NOW,
      }),
    ).toBeUndefined();
  });

  test("a new optic is present, judged, named after its port and starts a history", () => {
    const merged: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: [],
        results: [result(1)],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1, { alias: "Uplink" })],
        now: NOW,
      })!;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      interfaceIndex: 1,
      interfaceName: "Te1/1/1",
      interfaceAlias: "Uplink",
      isPresent: true,
      vendor: "FS",
      serialNumber: "SN-1",
      health: TransceiverHealth.Healthy,
      firstSeenAt: NOW.toISOString(),
      lastSeenAt: NOW.toISOString(),
      rxPowerHistory: {
        firstDay: "2026-10-09",
        dailyAverageDbm: [-4],
        lastDaySamples: 1,
      },
    });
    expect(merged[0]!.missingSince).toBeUndefined();
  });

  test("the same optic keeps its first-seen time and history", () => {
    const first: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: [],
        results: [result(1)],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1)],
        now: NOW,
      })!;
    const later: Date = new Date(NOW.getTime() + 5 * 60 * 1000);
    const second: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: first,
        results: [
          result(1, {
            measurements: measurements({ rxPower: -6 }, { rxPower: LR_RX_THRESHOLDS }),
          }),
        ],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1)],
        now: later,
      })!;

    expect(second[0]!.firstSeenAt).toBe(NOW.toISOString());
    expect(second[0]!.lastSeenAt).toBe(later.toISOString());
    expect(second[0]!.rxPowerHistory).toEqual({
      firstDay: "2026-10-09",
      dailyAverageDbm: [-5],
      lastDaySamples: 2,
    });
  });

  test("a swapped optic (new serial) starts over: new first-seen, new history", () => {
    const first: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: [],
        results: [result(1)],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1)],
        now: NOW,
      })!;
    const later: Date = new Date(NOW.getTime() + 24 * 3600 * 1000);
    const swapped: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: first,
        results: [result(1, { serialNumber: "NEW-SERIAL" })],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1)],
        now: later,
      })!;

    expect(swapped[0]!.firstSeenAt).toBe(later.toISOString());
    expect(swapped[0]!.rxPowerHistory?.dailyAverageDbm).toEqual([-4]);
    expect(swapped[0]!.rxPowerHistory?.firstDay).toBe("2026-10-10");
  });

  test("an optic gone from an enabled port is not detected, counting polls, keeping who it was", () => {
    const first: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: [],
        results: [result(1), result(2)],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1), port(2)],
        now: NOW,
      })!;
    const t1: Date = new Date(NOW.getTime() + 5 * 60 * 1000);
    const afterOne: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: first,
        results: [result(2)],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1), port(2)],
        now: t1,
      })!;

    const gone: NetworkDeviceTransceiver = afterOne.find(
      (entry: NetworkDeviceTransceiver) => {
        return entry.interfaceIndex === 1;
      },
    )!;

    expect(gone).toMatchObject({
      isPresent: false,
      health: TransceiverHealth.NotDetected,
      missingSince: t1.toISOString(),
      missingPolls: 1,
      serialNumber: "SN-1",
      partNumber: "SFP-10GLR-31",
      lastSeenAt: NOW.toISOString(),
      measurements: {},
    });
    expect(gone.rxPowerHistory?.dailyAverageDbm).toEqual([-4]);
    expect(TransceiverHealthUtil.isConfirmedMissing(gone)).toBe(false);

    const t2: Date = new Date(NOW.getTime() + 10 * 60 * 1000);
    const afterTwo: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: afterOne,
        results: [result(2)],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1), port(2)],
        now: t2,
      })!;
    const stillGone: NetworkDeviceTransceiver = afterTwo.find(
      (entry: NetworkDeviceTransceiver) => {
        return entry.interfaceIndex === 1;
      },
    )!;

    expect(stillGone.missingPolls).toBe(2);
    expect(stillGone.missingSince).toBe(t1.toISOString());
    expect(TransceiverHealthUtil.isConfirmedMissing(stillGone)).toBe(true);
  });

  test("every optic pulled while the MIB still answers is every optic missing", () => {
    const first: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: [],
        results: [result(1)],
        source: TransceiverMibSource.JuniperDom,
        interfaces: [port(1)],
        now: NOW,
      })!;

    const merged: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: first,
        results: [],
        source: TransceiverMibSource.JuniperDom,
        interfaces: [port(1)],
        now: NOW,
      })!;

    expect(merged[0]!.isPresent).toBe(false);
  });

  test("an optic that comes back is present again, history resumed", () => {
    const first: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: [],
        results: [result(1)],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1)],
        now: NOW,
      })!;
    const gone: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: first,
        results: [],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1)],
        now: NOW,
      })!;
    const back: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: gone,
        results: [result(1)],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1)],
        now: NOW,
      })!;

    expect(back[0]).toMatchObject({
      isPresent: true,
      health: TransceiverHealth.Healthy,
      firstSeenAt: NOW.toISOString(),
    });
    expect(back[0]!.missingSince).toBeUndefined();
    expect(back[0]!.missingPolls).toBeUndefined();
    expect(back[0]!.rxPowerHistory?.lastDaySamples).toBe(2);
  });

  test("an optic pulled from a disabled port is forgotten - housekeeping, not a fault", () => {
    const first: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: [],
        results: [result(1), result(2)],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1), port(2)],
        now: NOW,
      })!;

    const merged: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: first,
        results: [result(2)],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1, { isAdministrativelyUp: false }), port(2)],
        now: NOW,
      })!;

    expect(
      merged.map((entry: NetworkDeviceTransceiver) => {
        return entry.interfaceIndex;
      }),
    ).toEqual([2]);
  });

  test("a port this poll did not walk keeps its entry exactly as it was", () => {
    const first: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: [],
        results: [result(1), result(2)],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1), port(2)],
        now: NOW,
      })!;

    const merged: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: first,
        results: [result(2)],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(2)],
        now: new Date(NOW.getTime() + 60000),
      })!;

    expect(
      merged.find((entry: NetworkDeviceTransceiver) => {
        return entry.interfaceIndex === 1;
      }),
    ).toEqual(first[0]);
  });

  test("an optic in a disabled port is present but not judged", () => {
    const merged: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: [],
        results: [
          result(1, {
            measurements: measurements(
              { txPower: -40 },
              { txPower: { lowAlarm: -8.2, highAlarm: 3.5 } },
            ),
          }),
        ],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1, { isAdministrativelyUp: false })],
        now: NOW,
      })!;

    expect(merged[0]!.health).toBe(TransceiverHealth.PortDisabled);
  });

  test("faults travel through; unknown fault names are dropped", () => {
    const merged: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: [],
        results: [
          result(1, {
            faults: [
              TransceiverFault.TxFault,
              "somethingElse" as TransceiverFault,
            ],
          }),
        ],
        source: TransceiverMibSource.MikroTik,
        interfaces: [port(1)],
        now: NOW,
      })!;

    expect(merged[0]!.faults).toEqual([TransceiverFault.TxFault]);
    expect(merged[0]!.health).toBe(TransceiverHealth.Alarm);
  });

  test("one entry per port, the first result wins; sorted by interface", () => {
    const merged: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: [],
        results: [
          result(3),
          result(1, { serialNumber: "FIRST" }),
          result(1, { serialNumber: "SECOND" }),
        ],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1), port(3)],
        now: NOW,
      })!;

    expect(
      merged.map((entry: NetworkDeviceTransceiver) => {
        return `${entry.interfaceIndex}:${entry.serialNumber}`;
      }),
    ).toEqual(["1:FIRST", "3:SN-3"]);
  });

  test("stored entries carry no explicit undefined keys", () => {
    const merged: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: [],
        results: [
          {
            interfaceIndex: 4,
            measurements: {},
            source: TransceiverMibSource.JuniperDom,
          },
        ],
        source: TransceiverMibSource.JuniperDom,
        interfaces: [port(4)],
        now: NOW,
      })!;

    for (const [key, value] of Object.entries(merged[0]!)) {
      expect([key, value]).not.toEqual([key, undefined]);
    }
  });

  test(`a device never stores more than ${MAX_TRANSCEIVERS_PER_DEVICE} optics`, () => {
    const results: Array<SnmpTransceiverResult> = Array.from(
      { length: MAX_TRANSCEIVERS_PER_DEVICE + 5 },
      (_v: unknown, i: number) => {
        return result(i + 1);
      },
    );

    expect(
      TransceiverHealthUtil.mergeSnapshot({
        previous: [],
        results: results,
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [],
        now: NOW,
      })!,
    ).toHaveLength(MAX_TRANSCEIVERS_PER_DEVICE);
  });

  test("damaged stored entries are skipped", () => {
    const merged: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.mergeSnapshot({
        previous: [
          null as unknown as NetworkDeviceTransceiver,
          { interfaceIndex: "x" } as unknown as NetworkDeviceTransceiver,
        ],
        results: [result(1)],
        source: TransceiverMibSource.CiscoEntitySensor,
        interfaces: [port(1)],
        now: NOW,
      })!;

    expect(merged).toHaveLength(1);
  });
});

describe("sortForDisplay and summarize", () => {
  function entry(
    interfaceIndex: number,
    health: TransceiverHealth,
  ): NetworkDeviceTransceiver {
    return {
      interfaceIndex: interfaceIndex,
      isPresent: health !== TransceiverHealth.NotDetected,
      measurements: {},
      health: health,
    };
  }

  const entries: Array<NetworkDeviceTransceiver> = [
    entry(1, TransceiverHealth.Healthy),
    entry(2, TransceiverHealth.PortDisabled),
    entry(3, TransceiverHealth.Warning),
    entry(4, TransceiverHealth.NotDetected),
    entry(5, TransceiverHealth.Alarm),
    entry(6, TransceiverHealth.NotJudged),
    entry(7, TransceiverHealth.Alarm),
  ];

  test("problems first, worst first, then by port", () => {
    expect(
      TransceiverHealthUtil.sortForDisplay(entries).map(
        (transceiver: NetworkDeviceTransceiver) => {
          return transceiver.interfaceIndex;
        },
      ),
    ).toEqual([4, 5, 7, 3, 1, 6, 2]);
  });

  test("sorting does not touch the input", () => {
    TransceiverHealthUtil.sortForDisplay(entries);
    expect(entries[0]!.interfaceIndex).toBe(1);
  });

  test("summarize counts every health", () => {
    expect(TransceiverHealthUtil.summarize(entries)).toEqual({
      total: 7,
      healthy: 1,
      warning: 1,
      alarm: 2,
      notDetected: 1,
      notJudged: 1,
      portDisabled: 1,
    });
  });
});

describe("words", () => {
  const transceiver: NetworkDeviceTransceiver = {
    interfaceIndex: 7,
    interfaceName: "Te1/1/7",
    interfaceAlias: "Uplink to core",
    isPresent: true,
    vendor: "FLEXOPTIX",
    partNumber: "P.1396.10",
    serialNumber: "F123",
    measurements: measurements(
      { rxPower: [-3, -19], temperature: 72 },
      {
        rxPower: LR_RX_THRESHOLDS,
        temperature: { highWarning: 70, highAlarm: 75 },
      },
    ),
    health: TransceiverHealth.Alarm,
  };

  test("formatReading writes each unit the way switch CLIs do", () => {
    expect(
      TransceiverHealthUtil.formatReading(TransceiverReadingKind.RxPower, -4.7),
    ).toBe("-4.70 dBm");
    expect(
      TransceiverHealthUtil.formatReading(TransceiverReadingKind.RxPower, -40),
    ).toBe("-40.00 dBm (no light)");
    expect(
      TransceiverHealthUtil.formatReading(
        TransceiverReadingKind.Temperature,
        34.62,
      ),
    ).toBe("34.6 °C");
    expect(
      TransceiverHealthUtil.formatReading(TransceiverReadingKind.Voltage, 3.3),
    ).toBe("3.30 V");
    expect(
      TransceiverHealthUtil.formatReading(
        TransceiverReadingKind.BiasCurrent,
        6.1,
      ),
    ).toBe("6.10 mA");
  });

  test("describePort and describeOptic", () => {
    expect(TransceiverHealthUtil.describePort(transceiver)).toBe(
      "Te1/1/7 (Uplink to core)",
    );
    expect(
      TransceiverHealthUtil.describePort({
        ...transceiver,
        interfaceName: undefined,
        interfaceAlias: undefined,
      }),
    ).toBe("interface 7");
    expect(TransceiverHealthUtil.describeOptic(transceiver)).toBe(
      "FLEXOPTIX P.1396.10, serial F123",
    );
    expect(
      TransceiverHealthUtil.describeOptic({
        ...transceiver,
        vendor: undefined,
        partNumber: undefined,
        serialNumber: undefined,
      }),
    ).toBeUndefined();
  });

  test("describeIssues lists alarms before warnings, lanes named", () => {
    expect(TransceiverHealthUtil.describeIssues(transceiver)).toEqual([
      "RX Power -19.00 dBm on lane 2 is below the low alarm threshold of -18.40 dBm",
      "Temperature 72.0 °C is above the high warning threshold of 70.0 °C",
    ]);
  });

  test("describeIssues for a missing optic and for a healthy one", () => {
    expect(
      TransceiverHealthUtil.describeIssues({
        ...transceiver,
        isPresent: false,
        missingSince: "2026-10-09T10:00:00.000Z",
      }),
    ).toEqual(["Not detected since 2026-10-09T10:00:00.000Z"]);
    expect(
      TransceiverHealthUtil.describeIssues({
        ...transceiver,
        measurements: measurements({ rxPower: -3 }, { rxPower: LR_RX_THRESHOLDS }),
      }),
    ).toEqual([]);
  });

  test("a fault is an issue in words", () => {
    expect(
      TransceiverHealthUtil.describeIssues({
        ...transceiver,
        measurements: {},
        faults: [TransceiverFault.RxLossOfSignal],
      }),
    ).toEqual(["Loss of signal on receive"]);
  });

  test("a disabled port has no issues to describe", () => {
    expect(
      TransceiverHealthUtil.describeIssues({
        ...transceiver,
        health: TransceiverHealth.PortDisabled,
      }),
    ).toEqual([]);
  });
});

describe("days", () => {
  test("getUtcDay, addDays and daysBetween agree across month ends", () => {
    expect(
      TransceiverHealthUtil.getUtcDay(new Date("2026-10-09T23:59:59.000Z")),
    ).toBe("2026-10-09");
    expect(TransceiverHealthUtil.addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(TransceiverHealthUtil.addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(TransceiverHealthUtil.daysBetween("2026-09-28", "2026-10-02")).toBe(
      4,
    );
    expect(TransceiverHealthUtil.daysBetween("2026-10-02", "2026-09-28")).toBe(
      -4,
    );
  });
});
