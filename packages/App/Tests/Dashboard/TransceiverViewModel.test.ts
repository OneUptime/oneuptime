import { describe, expect, test } from "@jest/globals";
import {
  SPARKLINE_MIN_RANGE_DB,
  SparklineGeometry,
  ThresholdBarLayout,
  TRANSCEIVER_READING_COLUMN_TITLES,
  TRANSCEIVER_READINGS_HIDDEN_ON_MOBILE,
  TRANSCEIVER_ROWS_SHOWN,
  TRANSCEIVER_SOURCE_LABELS,
  TRANSCEIVER_TABLE_READINGS,
  TransceiverTone,
  formatReadingValue,
  getCrossingLabel,
  getLaneCount,
  getLastReadAt,
  getRxTrendView,
  getSparklineGeometry,
  getStatusView,
  getSummaryChips,
  getThresholdBarLayout,
  getThresholdItems,
  getToneForLevel,
  hasReadings,
  isNoLight,
  pickDisplayVerdict,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TransceiverViewModel";
import {
  NetworkDeviceTransceiver,
  TRANSCEIVER_READING_KINDS,
  TransceiverHealth,
  TransceiverMibSource,
  TransceiverReadingKind,
  TransceiverThresholds,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTransceiver";
import TransceiverHealthUtil, {
  TRANSCEIVER_RX_DROP_ALERT_DB,
  TransceiverReadingLevel,
  TransceiverReadingVerdict,
} from "Common/Utils/NetworkDevice/TransceiverHealthUtil";

/*
 * What the Transceivers card shows, without React: what each status is
 * called and coloured, which lane stands for a QSFP, how a crossed threshold
 * is said in words, where the threshold bar draws its bands, when a drop in
 * received power is news, and how the sparkline is scaled so a healthy optic
 * draws a calm line. Rendering is covered in
 * Common/Tests/App/Dashboard/TransceiverHealthCard.test.tsx.
 */

const LR_RX: TransceiverThresholds = {
  lowAlarm: -18.4,
  lowWarning: -14.4,
  highWarning: 0.5,
  highAlarm: 2.5,
};

function optic(
  overrides: Partial<NetworkDeviceTransceiver> = {},
): NetworkDeviceTransceiver {
  return {
    interfaceIndex: 1,
    interfaceName: "Te1/1/1",
    isPresent: true,
    measurements: { rxPower: { readings: [{ value: -4 }], thresholds: LR_RX } },
    health: TransceiverHealth.Healthy,
    ...overrides,
  };
}

describe("status", () => {
  test.each<[TransceiverHealth, string, TransceiverTone]>([
    [TransceiverHealth.NotDetected, "Not detected", TransceiverTone.Critical],
    [TransceiverHealth.Alarm, "Alarm", TransceiverTone.Critical],
    [TransceiverHealth.Warning, "Warning", TransceiverTone.Warning],
    [TransceiverHealth.Healthy, "Healthy", TransceiverTone.Healthy],
    [TransceiverHealth.PortDisabled, "Port disabled", TransceiverTone.Neutral],
  ])(
    "%s reads %s",
    (health: TransceiverHealth, label: string, tone: TransceiverTone) => {
      expect(getStatusView(optic({ health: health }))).toEqual({
        label: label,
        tone: tone,
      });
    },
  );

  test("an optic with nothing to judge says why: no thresholds, or nothing to read", () => {
    expect(
      getStatusView(
        optic({
          health: TransceiverHealth.NotJudged,
          measurements: { rxPower: { readings: [{ value: -4 }] } },
        }),
      ),
    ).toEqual({ label: "No thresholds", tone: TransceiverTone.Neutral });
    expect(
      getStatusView(
        optic({ health: TransceiverHealth.NotJudged, measurements: {} }),
      ),
    ).toEqual({ label: "Detected", tone: TransceiverTone.Neutral });
  });

  test("hasReadings ignores measurements with no readings", () => {
    expect(hasReadings(optic({ measurements: {} }))).toBe(false);
    expect(
      hasReadings(optic({ measurements: { voltage: { readings: [] } } })),
    ).toBe(false);
    expect(hasReadings(optic())).toBe(true);
  });

  test("a reading's tone follows its level", () => {
    expect(getToneForLevel(TransceiverReadingLevel.Alarm)).toBe(
      TransceiverTone.Critical,
    );
    expect(getToneForLevel(TransceiverReadingLevel.Warning)).toBe(
      TransceiverTone.Warning,
    );
    expect(getToneForLevel(TransceiverReadingLevel.Ok)).toBe(
      TransceiverTone.Healthy,
    );
    expect(getToneForLevel(TransceiverReadingLevel.NotJudged)).toBe(
      TransceiverTone.Neutral,
    );
    expect(getToneForLevel(undefined)).toBe(TransceiverTone.Neutral);
  });
});

describe("the table's columns", () => {
  test("one column per reading, the most telling first", () => {
    expect(TRANSCEIVER_TABLE_READINGS).toEqual(TRANSCEIVER_READING_KINDS);
    expect(
      TRANSCEIVER_TABLE_READINGS.map((kind: TransceiverReadingKind) => {
        return TRANSCEIVER_READING_COLUMN_TITLES[kind];
      }),
    ).toEqual(["RX Power", "TX Power", "Temperature", "Voltage", "Bias Current"]);
  });

  test("a phone keeps the light and the temperature", () => {
    expect(TRANSCEIVER_READINGS_HIDDEN_ON_MOBILE).toEqual([
      TransceiverReadingKind.Voltage,
      TransceiverReadingKind.BiasCurrent,
    ]);
    expect(TRANSCEIVER_ROWS_SHOWN).toBe(10);
  });

  test("every MIB a reading can come from has a label", () => {
    for (const source of Object.values(TransceiverMibSource)) {
      expect(TRANSCEIVER_SOURCE_LABELS[source]).toBe(source);
    }
  });
});

describe("pickDisplayVerdict - which lane stands for a QSFP", () => {
  const quad: NetworkDeviceTransceiver = optic({
    measurements: {
      rxPower: {
        readings: [
          { value: -2.1, lane: 1 },
          { value: -15.2, lane: 2 },
          { value: -19.0, lane: 3 },
          { value: -2.0, lane: 4 },
        ],
        thresholds: LR_RX,
      },
      temperature: {
        readings: [
          { value: 41, lane: 1 },
          { value: 47.5, lane: 2 },
        ],
      },
    },
  });

  test("the worst judged lane", () => {
    const verdict: TransceiverReadingVerdict = pickDisplayVerdict(
      quad,
      TransceiverReadingKind.RxPower,
    )!;

    expect(verdict.lane).toBe(3);
    expect(verdict.level).toBe(TransceiverReadingLevel.Alarm);
    expect(getLaneCount(quad, TransceiverReadingKind.RxPower)).toBe(4);
  });

  test("among equals, the one nearest to failing: the hottest, the weakest light", () => {
    expect(
      pickDisplayVerdict(quad, TransceiverReadingKind.Temperature)!.value,
    ).toBe(47.5);
    expect(
      pickDisplayVerdict(
        optic({
          measurements: {
            txPower: {
              readings: [
                { value: -1, lane: 1 },
                { value: -3, lane: 2 },
              ],
            },
          },
        }),
        TransceiverReadingKind.TxPower,
      )!.value,
    ).toBe(-3);
  });

  test("a reading the optic does not report has nothing to show", () => {
    expect(
      pickDisplayVerdict(quad, TransceiverReadingKind.Voltage),
    ).toBeUndefined();
    expect(getLaneCount(quad, TransceiverReadingKind.Voltage)).toBe(0);
  });
});

describe("words beside the value", () => {
  test.each<[number, string | undefined]>([
    [-19, "Low alarm"],
    [-15, "Low warning"],
    [1, "High warning"],
    [3, "High alarm"],
    [-4, undefined],
  ])("%s dBm is marked %s", (value: number, label: string | undefined) => {
    expect(
      getCrossingLabel(
        pickDisplayVerdict(
          optic({
            measurements: {
              rxPower: { readings: [{ value: value }], thresholds: LR_RX },
            },
          }),
          TransceiverReadingKind.RxPower,
        ),
      ),
    ).toBe(label);
  });

  test("no verdict, no label", () => {
    expect(getCrossingLabel(undefined)).toBeUndefined();
  });

  test("values are printed the way switch CLIs print them", () => {
    expect(formatReadingValue(TransceiverReadingKind.RxPower, -4.7)).toBe(
      "-4.70 dBm",
    );
    expect(formatReadingValue(TransceiverReadingKind.TxPower, 0)).toBe(
      "0.00 dBm",
    );
    expect(formatReadingValue(TransceiverReadingKind.Temperature, 34.62)).toBe(
      "34.6 °C",
    );
    expect(formatReadingValue(TransceiverReadingKind.Voltage, 3.3)).toBe(
      "3.30 V",
    );
    expect(formatReadingValue(TransceiverReadingKind.BiasCurrent, 6.1)).toBe(
      "6.10 mA",
    );
  });

  test("power at the -40 dBm floor is no light; nothing else is", () => {
    expect(isNoLight(TransceiverReadingKind.RxPower, -40)).toBe(true);
    expect(isNoLight(TransceiverReadingKind.TxPower, -40)).toBe(true);
    expect(isNoLight(TransceiverReadingKind.RxPower, -39.99)).toBe(false);
    expect(isNoLight(TransceiverReadingKind.Temperature, -40)).toBe(false);
  });
});

describe("thresholds", () => {
  test("listed low to high, only the ones the device reports", () => {
    expect(getThresholdItems(LR_RX)).toEqual([
      { label: "Low alarm", value: -18.4 },
      { label: "Low warning", value: -14.4 },
      { label: "High warning", value: 0.5 },
      { label: "High alarm", value: 2.5 },
    ]);
    expect(getThresholdItems({ highWarning: 70, highAlarm: 75 })).toEqual([
      { label: "High warning", value: 70 },
      { label: "High alarm", value: 75 },
    ]);
    // Zeros in every slot mean "not supported", not "alarm at 0".
    expect(
      getThresholdItems({
        lowAlarm: 0,
        lowWarning: 0,
        highWarning: 0,
        highAlarm: 0,
      }),
    ).toEqual([]);
    expect(getThresholdItems(undefined)).toEqual([]);
  });

  test("the bar: alarm, warning, healthy, warning, alarm, and the value's marker", () => {
    const bar: ThresholdBarLayout = getThresholdBarLayout(-4, LR_RX)!;

    expect(
      bar.segments.map((segment: { tone: TransceiverTone }) => {
        return segment.tone;
      }),
    ).toEqual([
      TransceiverTone.Critical,
      TransceiverTone.Warning,
      TransceiverTone.Healthy,
      TransceiverTone.Warning,
      TransceiverTone.Critical,
    ]);

    // The bands tile the bar from edge to edge.
    expect(bar.segments[0]!.fromPercent).toBe(0);
    expect(bar.segments[bar.segments.length - 1]!.toPercent).toBe(100);
    for (let i: number = 1; i < bar.segments.length; i++) {
      expect(bar.segments[i]!.fromPercent).toBeCloseTo(
        bar.segments[i - 1]!.toPercent,
        6,
      );
    }

    // -4 dBm sits in the healthy band.
    const healthy: { fromPercent: number; toPercent: number } =
      bar.segments[2]!;
    expect(bar.markerPercent).toBeGreaterThan(healthy.fromPercent);
    expect(bar.markerPercent).toBeLessThan(healthy.toPercent);
  });

  test("a value far outside its thresholds stays on the bar, in its band", () => {
    const bar: ThresholdBarLayout = getThresholdBarLayout(-40, LR_RX)!;

    expect(bar.markerPercent).toBeGreaterThanOrEqual(0);
    expect(bar.markerPercent).toBeLessThan(bar.segments[0]!.toPercent);
  });

  test("high limits only: no low bands are drawn", () => {
    const bar: ThresholdBarLayout = getThresholdBarLayout(41, {
      highWarning: 70,
      highAlarm: 75,
    })!;

    expect(
      bar.segments.map((segment: { tone: TransceiverTone }) => {
        return segment.tone;
      }),
    ).toEqual([
      TransceiverTone.Healthy,
      TransceiverTone.Warning,
      TransceiverTone.Critical,
    ]);
  });

  test("no thresholds, no bar", () => {
    expect(getThresholdBarLayout(-4, undefined)).toBeUndefined();
  });
});

describe("the received power trend", () => {
  function fading(
    days: Array<number>,
    nowDbm: number,
  ): NetworkDeviceTransceiver {
    return optic({
      measurements: {
        rxPower: { readings: [{ value: nowDbm }], thresholds: LR_RX },
      },
      rxPowerHistory: {
        firstDay: "2026-09-20",
        dailyAverageDbm: [...days, nowDbm],
        lastDaySamples: 3,
      },
    });
  }

  test(`a drop is news from the alert's own ${TRANSCEIVER_RX_DROP_ALERT_DB} dB on`, () => {
    expect(getRxTrendView(fading([-4, -4.5], -6.0)).isDropping).toBe(true);
    expect(getRxTrendView(fading([-4, -4.5], -5.9)).isDropping).toBe(false);
  });

  test("a receiver gone dark is its own alarm, not a drop", () => {
    expect(getRxTrendView(fading([-4, -4.5], -40)).isDropping).toBe(false);
  });

  test("a missing optic is not dropping", () => {
    expect(
      getRxTrendView({
        ...fading([-4, -4.5], -9),
        isPresent: false,
        measurements: {},
      }).isDropping,
    ).toBe(false);
  });

  test("the page and the alerts measure the same drop", () => {
    const transceiver: NetworkDeviceTransceiver = fading(
      [-3.8, -4.1, -5.2],
      -6.3,
    );

    expect(getRxTrendView(transceiver).trend).toEqual(
      TransceiverHealthUtil.getRxPowerTrend(transceiver),
    );
  });
});

describe("the header", () => {
  test("problems first, only the counts that are not zero, plural-aware", () => {
    expect(
      getSummaryChips({
        total: 9,
        healthy: 5,
        warning: 0,
        alarm: 2,
        notDetected: 1,
        notJudged: 1,
        portDisabled: 0,
      }).map((chip: { template: { other: string }; count: number }) => {
        return `${chip.template.other}:${chip.count}`;
      }),
    ).toEqual([
      "{{count}} not detected:1",
      "{{count}} alarms:2",
      "{{count}} healthy:5",
    ]);
  });

  test("last read: the most recent time any optic was seen", () => {
    expect(
      getLastReadAt([
        optic({ lastSeenAt: "2026-10-09T09:00:00.000Z" }),
        optic({ lastSeenAt: "2026-10-09T10:00:00.000Z" }),
        optic({ lastSeenAt: undefined }),
        optic({ lastSeenAt: "not a date" }),
      ])?.toISOString(),
    ).toBe("2026-10-09T10:00:00.000Z");
    expect(getLastReadAt([])).toBeUndefined();
  });
});

describe("getSparklineGeometry", () => {
  test("one point a day across the width, the newest at the right edge", () => {
    const geometry: SparklineGeometry = getSparklineGeometry({
      values: [-4, -5, -6],
      width: 100,
      height: 20,
      padding: 2,
    });

    expect(
      geometry.points.map((point: { x: number }) => {
        return point.x;
      }),
    ).toEqual([2, 50, 98]);
    // Lower power is lower on the line.
    expect(geometry.points[2]!.y).toBeGreaterThan(geometry.points[0]!.y);
  });

  test(`a calm optic draws a calm line: the scale spans at least ${SPARKLINE_MIN_RANGE_DB} dB`, () => {
    const geometry: SparklineGeometry = getSparklineGeometry({
      values: [-4.0, -4.2, -3.9, -4.1],
      width: 100,
      height: 20,
      padding: 0,
    });

    const ys: Array<number> = geometry.points.map((point: { y: number }) => {
      return point.y;
    });

    // 0.3 dB of wobble on a 2 dB scale: 3 of the box's 20 pixels...
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(3, 6);

    // ...where scaling to fit would have stretched it over all twenty.
    const stretched: SparklineGeometry = getSparklineGeometry({
      values: [-4.0, -4.2, -3.9, -4.1],
      width: 100,
      height: 20,
      padding: 0,
      minRange: 0,
    });
    const stretchedYs: Array<number> = stretched.points.map(
      (point: { y: number }) => {
        return point.y;
      },
    );
    expect(Math.max(...stretchedYs) - Math.min(...stretchedYs)).toBeCloseTo(
      20,
      6,
    );
  });

  test("a real drop fills the box", () => {
    const geometry: SparklineGeometry = getSparklineGeometry({
      values: [-3, -5, -9],
      width: 100,
      height: 20,
      padding: 0,
    });

    expect(geometry.points[0]!.y).toBe(0);
    expect(geometry.points[2]!.y).toBe(20);
  });

  test("the baseline is on the same scale", () => {
    const geometry: SparklineGeometry = getSparklineGeometry({
      values: [-5, -6],
      baseline: -3,
      width: 100,
      height: 20,
      padding: 0,
    });

    expect(geometry.baselineY).toBe(0);
  });

  test("nothing to draw, and one day drawn at the right edge", () => {
    expect(
      getSparklineGeometry({ values: [], width: 100, height: 20 }).points,
    ).toEqual([]);
    expect(
      getSparklineGeometry({ values: [-4], width: 100, height: 20 }).points[0]!
        .x,
    ).toBe(98);
  });
});
