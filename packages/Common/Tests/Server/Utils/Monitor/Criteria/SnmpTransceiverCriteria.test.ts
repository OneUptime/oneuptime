import SnmpTransceiverCriteria from "../../../../../Server/Utils/Monitor/Criteria/SnmpTransceiverCriteria";
import SnmpMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/SnmpMonitorCriteria";
import EvaluateOverTime from "../../../../../Server/Utils/Monitor/Criteria/EvaluateOverTime";
import MonitorCriteriaObservationBuilder from "../../../../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import {
  NetworkDeviceTransceiver,
  TransceiverFault,
  TransceiverHealth,
  TransceiverMeasurements,
  TransceiverReadingKind,
  TransceiverRxPowerHistory,
  TransceiverThresholds,
} from "../../../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";
import TransceiverHealthUtil from "../../../../../Utils/NetworkDevice/TransceiverHealthUtil";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The five transceiver criteria, judged port by port from the snapshot a
 * device poll hands its monitors. The texts they return are what an alert,
 * its incident and OneUptime AI read, so the important ones are pinned
 * word for word: "optic no longer detected", "past an alarm threshold",
 * and "RX power falling against its best day".
 */

const LR_RX: TransceiverThresholds = {
  lowAlarm: -18.4,
  lowWarning: -14.4,
  highWarning: 0.5,
  highAlarm: 2.5,
};

const TEMPERATURE: TransceiverThresholds = {
  lowAlarm: -5,
  lowWarning: 0,
  highWarning: 70,
  highAlarm: 75,
};

function readings(
  kind: TransceiverReadingKind,
  values: Array<number>,
  thresholds?: TransceiverThresholds,
): TransceiverMeasurements {
  return {
    [kind]: {
      readings:
        values.length === 1
          ? [{ value: values[0]! }]
          : values.map((value: number, index: number) => {
              return { value: value, lane: index + 1 };
            }),
      ...(thresholds ? { thresholds: thresholds } : {}),
    },
  };
}

function optic(input: {
  index: number;
  name?: string | undefined;
  alias?: string | undefined;
  isPresent?: boolean | undefined;
  measurements?: TransceiverMeasurements | undefined;
  faults?: Array<TransceiverFault> | undefined;
  isPortDisabled?: boolean | undefined;
  missingPolls?: number | undefined;
  history?: TransceiverRxPowerHistory | undefined;
}): NetworkDeviceTransceiver {
  const isPresent: boolean = input.isPresent ?? true;
  const measurements: TransceiverMeasurements = isPresent
    ? input.measurements ||
      readings(TransceiverReadingKind.RxPower, [-4], LR_RX)
    : {};

  return {
    interfaceIndex: input.index,
    interfaceName: input.name ?? `Te1/1/${input.index}`,
    ...(input.alias ? { interfaceAlias: input.alias } : {}),
    isPresent: isPresent,
    vendor: "FS",
    partNumber: "SFP-10GLR-31",
    serialNumber: `S${input.index}`,
    measurements: measurements,
    ...(input.faults ? { faults: input.faults } : {}),
    health: TransceiverHealthUtil.getHealth({
      isPresent: isPresent,
      measurements: measurements,
      faults: input.faults,
      isPortDisabled: input.isPortDisabled,
    }),
    lastSeenAt: "2026-10-09T09:55:00.000Z",
    ...(isPresent
      ? {}
      : {
          missingSince: "2026-10-09T10:00:00.000Z",
          missingPolls: input.missingPolls ?? 2,
        }),
    ...(input.history ? { rxPowerHistory: input.history } : {}),
  };
}

function filter(
  checkOn: CheckOn,
  filterType: FilterType,
  options: {
    value?: string | number | undefined;
    interfaceName?: string | undefined;
    transceiverReading?: string | undefined;
  } = {},
): CriteriaFilter {
  return {
    checkOn: checkOn,
    filterType: filterType,
    value: options.value,
    snmpMonitorOptions: {
      ...(options.interfaceName !== undefined
        ? { interfaceName: options.interfaceName }
        : {}),
      ...(options.transceiverReading !== undefined
        ? { transceiverReading: options.transceiverReading }
        : {}),
    },
  };
}

function evaluate(
  transceivers: Array<NetworkDeviceTransceiver> | undefined,
  criteriaFilter: CriteriaFilter,
): string | null {
  return SnmpTransceiverCriteria.evaluate({
    transceivers: transceivers,
    criteriaFilter: criteriaFilter,
  });
}

describe("CriteriaFilterUtil - the transceiver CheckOns", () => {
  const transceiverCheckOns: Array<CheckOn> = [
    CheckOn.SnmpTransceiverNotDetected,
    CheckOn.SnmpTransceiverPastAlarmThreshold,
    CheckOn.SnmpTransceiverPastWarningThreshold,
    CheckOn.SnmpTransceiverReading,
    CheckOn.SnmpTransceiverRxPowerDrop,
  ];

  it("names exactly five transceiver CheckOns", () => {
    expect(
      Object.values(CheckOn).filter((checkOn: CheckOn) => {
        return CriteriaFilterUtil.isTransceiverCheckOn(checkOn);
      }),
    ).toEqual(transceiverCheckOns);
  });

  it("scopes every one of them, and the interface ones, by interface", () => {
    for (const checkOn of [
      ...transceiverCheckOns,
      CheckOn.SnmpInterfaceIsDown,
      CheckOn.SnmpInterfaceUtilizationPercent,
      CheckOn.SnmpInterfaceErrorsPerSecond,
    ]) {
      expect(CriteriaFilterUtil.isInterfaceScopedCheckOn(checkOn)).toBe(true);
    }

    expect(
      CriteriaFilterUtil.isInterfaceScopedCheckOn(CheckOn.SnmpOidValue),
    ).toBe(false);
    expect(CriteriaFilterUtil.isInterfaceScopedCheckOn(undefined)).toBe(false);
    expect(CriteriaFilterUtil.isTransceiverCheckOn(undefined)).toBe(false);
  });

  it("the three yes/no ones take no value; reading and drop take a number", () => {
    for (const checkOn of [
      CheckOn.SnmpTransceiverNotDetected,
      CheckOn.SnmpTransceiverPastAlarmThreshold,
      CheckOn.SnmpTransceiverPastWarningThreshold,
    ]) {
      expect(
        CriteriaFilterUtil.hasValueField({
          checkOn: checkOn,
          filterType: FilterType.True,
        }),
      ).toBe(false);
    }

    for (const checkOn of [
      CheckOn.SnmpTransceiverReading,
      CheckOn.SnmpTransceiverRxPowerDrop,
    ]) {
      expect(
        CriteriaFilterUtil.hasValueField({
          checkOn: checkOn,
          filterType: FilterType.GreaterThan,
        }),
      ).toBe(true);
    }
  });

  it("no transceiver CheckOn is judged over a window of stored samples", () => {
    for (const checkOn of transceiverCheckOns) {
      expect(CriteriaFilterUtil.isEvaluateOverTimeFilter(checkOn)).toBe(false);
    }
  });
});

describe("SnmpTransceiverCriteria - nothing to judge", () => {
  it("is not evaluated when the poll read no transceivers", () => {
    expect(
      evaluate(
        undefined,
        filter(CheckOn.SnmpTransceiverNotDetected, FilterType.False),
      ),
    ).toBeNull();
  });

  it("is not evaluated when no optic is in scope", () => {
    expect(
      evaluate(
        [],
        filter(CheckOn.SnmpTransceiverPastAlarmThreshold, FilterType.False),
      ),
    ).toBeNull();
    expect(
      evaluate(
        [optic({ index: 1 })],
        filter(CheckOn.SnmpTransceiverPastAlarmThreshold, FilterType.False, {
          interfaceName: "Te9/9/9",
        }),
      ),
    ).toBeNull();
  });

  it("a CheckOn it does not know is not evaluated", () => {
    expect(
      evaluate(
        [optic({ index: 1 })],
        filter(CheckOn.SnmpOidValue, FilterType.True),
      ),
    ).toBeNull();
  });
});

describe("SnmpTransceiverCriteria.scopeTransceivers", () => {
  const optics: Array<NetworkDeviceTransceiver> = [
    optic({ index: 1, name: "Te1/1/1", alias: "Uplink to core" }),
    optic({ index: 2, name: "Te1/1/2" }),
  ];

  it("empty and '*' mean every optic", () => {
    for (const scope of [undefined, "", "  ", "*", " * "]) {
      expect(
        SnmpTransceiverCriteria.scopeTransceivers(
          optics,
          filter(CheckOn.SnmpTransceiverNotDetected, FilterType.True, {
            interfaceName: scope,
          }),
        ),
      ).toHaveLength(2);
    }
  });

  it("a name or an alias picks one port, case-insensitive", () => {
    expect(
      SnmpTransceiverCriteria.scopeTransceivers(
        optics,
        filter(CheckOn.SnmpTransceiverNotDetected, FilterType.True, {
          interfaceName: "te1/1/2",
        }),
      ).map((entry: NetworkDeviceTransceiver) => {
        return entry.interfaceIndex;
      }),
    ).toEqual([2]);
    expect(
      SnmpTransceiverCriteria.scopeTransceivers(
        optics,
        filter(CheckOn.SnmpTransceiverNotDetected, FilterType.True, {
          interfaceName: " UPLINK TO CORE ",
        }),
      ).map((entry: NetworkDeviceTransceiver) => {
        return entry.interfaceIndex;
      }),
    ).toEqual([1]);
  });
});

describe("Transceiver Not Detected", () => {
  it("names the port and the optic that used to be in it", () => {
    expect(
      evaluate(
        [
          optic({ index: 1, alias: "Uplink to core", isPresent: false }),
          optic({ index: 2 }),
        ],
        filter(CheckOn.SnmpTransceiverNotDetected, FilterType.True),
      ),
    ).toBe(
      "Transceiver no longer detected in Te1/1/1 (Uplink to core): it was FS SFP-10GLR-31, serial S1. Missing for 2 polls (since 2026-10-09T10:00:00.000Z), last seen 2026-10-09T09:55:00.000Z. The port is enabled and the device still answers SNMP.",
    );
  });

  it("is not met after a single missing poll", () => {
    expect(
      evaluate(
        [optic({ index: 1, isPresent: false, missingPolls: 1 })],
        filter(CheckOn.SnmpTransceiverNotDetected, FilterType.True),
      ),
    ).toBeNull();
  });

  it("several missing optics are listed, five at most", () => {
    const missing: Array<NetworkDeviceTransceiver> = [1, 2, 3, 4, 5, 6, 7].map(
      (index: number) => {
        return optic({ index: index, isPresent: false });
      },
    );

    expect(
      evaluate(
        missing,
        filter(CheckOn.SnmpTransceiverNotDetected, FilterType.True),
      ),
    ).toBe(
      "7 transceivers are no longer detected while their ports are enabled: Te1/1/1, Te1/1/2, Te1/1/3, Te1/1/4, Te1/1/5 and 2 more. The device still answers SNMP.",
    );
  });

  it("False is met once every optic in scope is detected - the recovery rule", () => {
    expect(
      evaluate(
        [optic({ index: 1 })],
        filter(CheckOn.SnmpTransceiverNotDetected, FilterType.False),
      ),
    ).toBe("The transceiver in Te1/1/1 is detected.");
    expect(
      evaluate(
        [optic({ index: 1 }), optic({ index: 2 })],
        filter(CheckOn.SnmpTransceiverNotDetected, FilterType.False),
      ),
    ).toBe("Every transceiver in scope is detected (2).");
    expect(
      evaluate(
        [optic({ index: 1 }), optic({ index: 2, isPresent: false })],
        filter(CheckOn.SnmpTransceiverNotDetected, FilterType.False),
      ),
    ).toBeNull();
  });

  it("scoped to one port, an optic missing elsewhere does not count", () => {
    expect(
      evaluate(
        [optic({ index: 1 }), optic({ index: 2, isPresent: false })],
        filter(CheckOn.SnmpTransceiverNotDetected, FilterType.True, {
          interfaceName: "Te1/1/1",
        }),
      ),
    ).toBeNull();
  });

  it("an optic with nothing known about it still says where it was", () => {
    expect(
      SnmpTransceiverCriteria.describeMissing({
        interfaceIndex: 9,
        isPresent: false,
        measurements: {},
        health: TransceiverHealth.NotDetected,
      }),
    ).toBe(
      "Transceiver no longer detected in interface 9. Missing for 2 polls. The port is enabled and the device still answers SNMP.",
    );
  });
});

describe("Transceiver Past Alarm / Warning Threshold", () => {
  const healthy: NetworkDeviceTransceiver = optic({ index: 1 });
  const warning: NetworkDeviceTransceiver = optic({
    index: 2,
    measurements: readings(TransceiverReadingKind.RxPower, [-15.1], LR_RX),
  });
  const alarm: NetworkDeviceTransceiver = optic({
    index: 3,
    measurements: {
      ...readings(TransceiverReadingKind.RxPower, [-19], LR_RX),
      ...readings(TransceiverReadingKind.Temperature, [71.5], TEMPERATURE),
    },
  });

  it("alarm: names the port and every reading past its line, alarms first", () => {
    expect(
      evaluate(
        [healthy, warning, alarm],
        filter(CheckOn.SnmpTransceiverPastAlarmThreshold, FilterType.True),
      ),
    ).toBe(
      "Te1/1/3 transceiver past an alarm threshold: RX Power -19.00 dBm is below the low alarm threshold of -18.40 dBm; Temperature 71.5 °C is above the high warning threshold of 70.0 °C.",
    );
  });

  it("alarm: a warning alone is not an alarm", () => {
    expect(
      evaluate(
        [healthy, warning],
        filter(CheckOn.SnmpTransceiverPastAlarmThreshold, FilterType.True),
      ),
    ).toBeNull();
  });

  it("warning: met by a warning, and by an alarm too", () => {
    expect(
      evaluate(
        [healthy, warning],
        filter(CheckOn.SnmpTransceiverPastWarningThreshold, FilterType.True),
      ),
    ).toBe(
      "Te1/1/2 transceiver past a warning threshold: RX Power -15.10 dBm is below the low warning threshold of -14.40 dBm.",
    );
    expect(
      evaluate(
        [alarm],
        filter(CheckOn.SnmpTransceiverPastWarningThreshold, FilterType.True),
      ),
    ).toContain("Te1/1/3 transceiver past an alarm threshold");
  });

  it("a fault the device flags is an alarm, said in words", () => {
    expect(
      evaluate(
        [
          optic({
            index: 4,
            measurements: {},
            faults: [TransceiverFault.RxLossOfSignal],
          }),
        ],
        filter(CheckOn.SnmpTransceiverPastAlarmThreshold, FilterType.True),
      ),
    ).toBe(
      "Te1/1/4 transceiver past an alarm threshold: Loss of signal on receive.",
    );
  });

  it("False is met when every judged optic is inside its thresholds", () => {
    expect(
      evaluate(
        [healthy, warning],
        filter(CheckOn.SnmpTransceiverPastAlarmThreshold, FilterType.False),
      ),
    ).toBe("Every transceiver in scope is within its alarm thresholds (2).");
    expect(
      evaluate(
        [healthy],
        filter(CheckOn.SnmpTransceiverPastWarningThreshold, FilterType.False),
      ),
    ).toBe("Every transceiver in scope is within its warning thresholds (1).");
    expect(
      evaluate(
        [healthy, alarm],
        filter(CheckOn.SnmpTransceiverPastAlarmThreshold, FilterType.False),
      ),
    ).toBeNull();
  });

  it("a disabled port, a missing optic and an optic with no thresholds are not judged", () => {
    const disabled: NetworkDeviceTransceiver = optic({
      index: 5,
      measurements: readings(TransceiverReadingKind.TxPower, [-40], {
        lowAlarm: -8.2,
        highAlarm: 3.5,
      }),
      isPortDisabled: true,
    });
    const missing: NetworkDeviceTransceiver = optic({
      index: 6,
      isPresent: false,
    });
    const unjudged: NetworkDeviceTransceiver = optic({
      index: 7,
      measurements: readings(TransceiverReadingKind.RxPower, [-30]),
    });

    expect(disabled.health).toBe(TransceiverHealth.PortDisabled);
    expect(unjudged.health).toBe(TransceiverHealth.NotJudged);

    for (const checkOn of [
      CheckOn.SnmpTransceiverPastAlarmThreshold,
      CheckOn.SnmpTransceiverPastWarningThreshold,
    ]) {
      for (const filterType of [FilterType.True, FilterType.False]) {
        expect(
          evaluate([disabled, missing, unjudged], filter(checkOn, filterType)),
        ).toBeNull();
      }
    }
  });

  it("names five ports and counts the rest", () => {
    const many: Array<NetworkDeviceTransceiver> = [1, 2, 3, 4, 5, 6, 7, 8].map(
      (index: number) => {
        return optic({
          index: index,
          measurements: readings(TransceiverReadingKind.RxPower, [-20], LR_RX),
        });
      },
    );

    const text: string | null = evaluate(
      many,
      filter(CheckOn.SnmpTransceiverPastAlarmThreshold, FilterType.True),
    );

    expect(text).toContain("Te1/1/5 transceiver past an alarm threshold");
    expect(text).not.toContain("Te1/1/6");
    expect(text!.endsWith("And 3 more.")).toBe(true);
  });
});

describe("Transceiver Reading", () => {
  const quad: NetworkDeviceTransceiver = optic({
    index: 1,
    name: "Et49/1",
    measurements: readings(TransceiverReadingKind.RxPower, [-2.1, -2.4, -15.2, -14.9]),
  });

  it("names the worst lane: the lowest for 'less than'", () => {
    expect(
      evaluate(
        [quad],
        filter(CheckOn.SnmpTransceiverReading, FilterType.LessThan, {
          value: "-14",
          transceiverReading: TransceiverReadingKind.RxPower,
        }),
      ),
    ).toBe(
      "Et49/1 transceiver RX Power is -15.20 dBm on lane 3, which is less than -14 (2 readings in scope match).",
    );
  });

  it("the highest for 'greater than'", () => {
    expect(
      evaluate(
        [
          optic({
            index: 2,
            measurements: readings(TransceiverReadingKind.Temperature, [61.2]),
          }),
          optic({
            index: 3,
            measurements: readings(TransceiverReadingKind.Temperature, [66.04]),
          }),
        ],
        filter(CheckOn.SnmpTransceiverReading, FilterType.GreaterThan, {
          value: 60,
          transceiverReading: TransceiverReadingKind.Temperature,
        }),
      ),
    ).toBe(
      "Te1/1/3 transceiver Temperature is 66.0 °C, which is greater than 60 (2 readings in scope match).",
    );
  });

  it("decimals are read as typed: -14.4 is not -14", () => {
    const at: NetworkDeviceTransceiver = optic({
      index: 1,
      measurements: readings(TransceiverReadingKind.RxPower, [-14.2]),
    });

    expect(
      evaluate(
        [at],
        filter(CheckOn.SnmpTransceiverReading, FilterType.LessThanOrEqualTo, {
          value: "-14.4",
          transceiverReading: TransceiverReadingKind.RxPower,
        }),
      ),
    ).toBeNull();
    expect(
      evaluate(
        [at],
        filter(CheckOn.SnmpTransceiverReading, FilterType.LessThanOrEqualTo, {
          value: "-14.1",
          transceiverReading: TransceiverReadingKind.RxPower,
        }),
      ),
    ).toContain("less than or equal to -14.1");
  });

  it("works on a device that reports no thresholds at all - the point of it", () => {
    const unjudged: NetworkDeviceTransceiver = optic({
      index: 1,
      measurements: readings(TransceiverReadingKind.Voltage, [3.05]),
    });

    expect(unjudged.health).toBe(TransceiverHealth.NotJudged);
    expect(
      evaluate(
        [unjudged],
        filter(CheckOn.SnmpTransceiverReading, FilterType.LessThan, {
          value: "3.135",
          transceiverReading: TransceiverReadingKind.Voltage,
        }),
      ),
    ).toBe(
      "Te1/1/1 transceiver Supply Voltage is 3.05 V, which is less than 3.135.",
    );
  });

  it("is not evaluated without a reading picked, a number, or a reading to compare", () => {
    expect(
      evaluate(
        [quad],
        filter(CheckOn.SnmpTransceiverReading, FilterType.LessThan, {
          value: "-14",
        }),
      ),
    ).toBeNull();
    expect(
      evaluate(
        [quad],
        filter(CheckOn.SnmpTransceiverReading, FilterType.LessThan, {
          value: "-14",
          transceiverReading: "wavelength",
        }),
      ),
    ).toBeNull();
    expect(
      evaluate(
        [quad],
        filter(CheckOn.SnmpTransceiverReading, FilterType.LessThan, {
          value: "low",
          transceiverReading: TransceiverReadingKind.RxPower,
        }),
      ),
    ).toBeNull();
    expect(
      evaluate(
        [quad],
        filter(CheckOn.SnmpTransceiverReading, FilterType.LessThan, {
          value: "-14",
          transceiverReading: TransceiverReadingKind.BiasCurrent,
        }),
      ),
    ).toBeNull();
  });

  it("ignores optics that are missing or in a disabled port", () => {
    expect(
      evaluate(
        [
          optic({ index: 1, isPresent: false }),
          optic({
            index: 2,
            measurements: readings(TransceiverReadingKind.TxPower, [-40]),
            isPortDisabled: true,
          }),
        ],
        filter(CheckOn.SnmpTransceiverReading, FilterType.LessThan, {
          value: "-10",
          transceiverReading: TransceiverReadingKind.TxPower,
        }),
      ),
    ).toBeNull();
  });

  it("a dark lane reads as no light", () => {
    expect(
      evaluate(
        [
          optic({
            index: 1,
            measurements: readings(TransceiverReadingKind.RxPower, [-40]),
          }),
        ],
        filter(CheckOn.SnmpTransceiverReading, FilterType.LessThan, {
          value: "-30",
          transceiverReading: TransceiverReadingKind.RxPower,
        }),
      ),
    ).toBe(
      "Te1/1/1 transceiver RX Power is -40.00 dBm (no light), which is less than -30.",
    );
  });
});

describe("Transceiver RX Power Drop", () => {
  function drifting(index: number, days: Array<number>, nowDbm: number): NetworkDeviceTransceiver {
    return optic({
      index: index,
      measurements: readings(TransceiverReadingKind.RxPower, [nowDbm], LR_RX),
      history: {
        firstDay: "2026-09-20",
        dailyAverageDbm: [...days, nowDbm],
        lastDaySamples: 12,
      },
    });
  }

  it("measures the latest reading against the best day of the month", () => {
    expect(
      evaluate(
        [drifting(1, [-3.8, -4.1, -4.9, -5.6], -6.3)],
        filter(
          CheckOn.SnmpTransceiverRxPowerDrop,
          FilterType.GreaterThanOrEqualTo,
          { value: 2 },
        ),
      ),
    ).toBe(
      "Te1/1/1 RX power -6.30 dBm is 2.50 dB below its best daily average of the last 30 days (-3.80 dBm on 2026-09-20).",
    );
  });

  it("a link holding steady is not a drop", () => {
    expect(
      evaluate(
        [drifting(1, [-4.0, -4.1, -3.9, -4.0], -4.1)],
        filter(
          CheckOn.SnmpTransceiverRxPowerDrop,
          FilterType.GreaterThanOrEqualTo,
          { value: 2 },
        ),
      ),
    ).toBeNull();
  });

  it("the worst of several falling links is named, the others counted", () => {
    expect(
      evaluate(
        [
          drifting(1, [-3.8, -4.4], -6.0),
          drifting(2, [-2.0, -2.5], -7.0),
          drifting(3, [-4.0], -4.2),
        ],
        filter(
          CheckOn.SnmpTransceiverRxPowerDrop,
          FilterType.GreaterThanOrEqualTo,
          { value: "2" },
        ),
      ),
    ).toBe(
      "Te1/1/2 RX power -7.00 dBm is 5.00 dB below its best daily average of the last 30 days (-2.00 dBm on 2026-09-20). 2 transceivers in scope match.",
    );
  });

  it("is not evaluated before an optic has a day of history", () => {
    expect(
      evaluate(
        [
          optic({
            index: 1,
            history: {
              firstDay: "2026-10-09",
              dailyAverageDbm: [-4],
              lastDaySamples: 3,
            },
          }),
          optic({ index: 2 }),
        ],
        filter(
          CheckOn.SnmpTransceiverRxPowerDrop,
          FilterType.GreaterThanOrEqualTo,
          { value: 2 },
        ),
      ),
    ).toBeNull();
  });

  it("'less than' is the recovery rule; a light that improved reads as above", () => {
    expect(
      evaluate(
        [drifting(1, [-5.0, -5.0], -4.5)],
        filter(CheckOn.SnmpTransceiverRxPowerDrop, FilterType.LessThan, {
          value: 1,
        }),
      ),
    ).toBe(
      "Te1/1/1 RX power -4.50 dBm is 0.50 dB above its best daily average of the last 30 days (-5.00 dBm on 2026-09-20).",
    );
  });

  it("a missing optic or a disabled port has no drop", () => {
    const disabled: NetworkDeviceTransceiver = {
      ...drifting(1, [-3, -3], -40),
      health: TransceiverHealth.PortDisabled,
    };

    expect(
      evaluate(
        [disabled, optic({ index: 2, isPresent: false })],
        filter(CheckOn.SnmpTransceiverRxPowerDrop, FilterType.GreaterThan, {
          value: 1,
        }),
      ),
    ).toBeNull();
  });

  it("describeRxPowerDrop without a baseline", () => {
    expect(
      SnmpTransceiverCriteria.describeRxPowerDrop(optic({ index: 3 }), {
        points: [],
      }),
    ).toBe("Te1/1/3 RX power has no baseline yet.");
  });
});

describe("SnmpTransceiverCriteria.describeObservation", () => {
  const optics: Array<NetworkDeviceTransceiver> = [
    optic({ index: 1 }),
    optic({
      index: 2,
      measurements: readings(TransceiverReadingKind.RxPower, [-15], LR_RX),
    }),
    optic({
      index: 3,
      measurements: readings(TransceiverReadingKind.RxPower, [-19], LR_RX),
    }),
    optic({ index: 4, isPresent: false }),
  ];

  function observe(
    criteriaFilter: CriteriaFilter,
    transceivers: Array<NetworkDeviceTransceiver> = optics,
  ): string | null {
    return SnmpTransceiverCriteria.describeObservation({
      transceivers: transceivers,
      criteriaFilter: criteriaFilter,
    });
  }

  it("says what it saw, met or not", () => {
    expect(
      observe(filter(CheckOn.SnmpTransceiverNotDetected, FilterType.True)),
    ).toBe("1 of 4 transceiver(s) in scope not detected.");
    expect(
      observe(
        filter(CheckOn.SnmpTransceiverPastAlarmThreshold, FilterType.True),
      ),
    ).toBe(
      "4 transceiver(s) in scope: 1 past an alarm threshold, 1 past a warning threshold.",
    );
    expect(
      observe(
        filter(CheckOn.SnmpTransceiverReading, FilterType.LessThan, {
          transceiverReading: TransceiverReadingKind.RxPower,
        }),
      ),
    ).toBe(
      "RX Power in scope - Te1/1/1: -4.00 dBm, Te1/1/2: -15.00 dBm, Te1/1/3: -19.00 dBm.",
    );
    expect(
      observe(filter(CheckOn.SnmpTransceiverRxPowerDrop, FilterType.GreaterThan)),
    ).toBe(
      "RX power drop against the best day of the last 30 - Te1/1/1: no baseline yet, Te1/1/2: no baseline yet, Te1/1/3: no baseline yet.",
    );
  });

  it("explains why there is nothing to judge", () => {
    expect(
      SnmpTransceiverCriteria.describeObservation({
        transceivers: undefined,
        criteriaFilter: filter(
          CheckOn.SnmpTransceiverNotDetected,
          FilterType.True,
        ),
      }),
    ).toBe("Transceivers were not read on this poll.");
    expect(
      observe(filter(CheckOn.SnmpTransceiverNotDetected, FilterType.True), []),
    ).toBe("The device reports no transceivers.");
    expect(
      observe(
        filter(CheckOn.SnmpTransceiverNotDetected, FilterType.True, {
          interfaceName: "Gi0/48",
        }),
      ),
    ).toBe("No transceiver on interface Gi0/48.");
    expect(
      observe(filter(CheckOn.SnmpTransceiverReading, FilterType.LessThan)),
    ).toBe("No transceiver reading is selected on this criteria.");
  });

  it("is the observation the criteria evaluation summary shows", () => {
    const response: ProbeMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      monitorStepId: ObjectID.generate(),
      probeId: ObjectID.generate(),
      failureCause: "",
      isOnline: true,
      monitoredAt: new Date(),
      snmpResponse: {
        isOnline: true,
        responseTimeInMs: 10,
        failureCause: "",
        oidResponses: [],
        transceivers: optics,
      },
    };

    expect(
      MonitorCriteriaObservationBuilder.describeFilterObservation({
        monitor: new Monitor(),
        monitorStep: new MonitorStep(),
        dataToProcess: response,
        criteriaFilter: filter(
          CheckOn.SnmpTransceiverNotDetected,
          FilterType.True,
        ),
      }),
    ).toBe("1 of 4 transceiver(s) in scope not detected.");
  });
});

describe("SnmpTransceiverCriteria.toNumber and compare", () => {
  it("reads typed decimals and refuses what is not a number", () => {
    expect(SnmpTransceiverCriteria.toNumber("-14.4")).toBe(-14.4);
    expect(SnmpTransceiverCriteria.toNumber(" 2 ")).toBe(2);
    expect(SnmpTransceiverCriteria.toNumber(3.3)).toBe(3.3);
    expect(SnmpTransceiverCriteria.toNumber("")).toBeNull();
    expect(SnmpTransceiverCriteria.toNumber("2 dB")).toBeNull();
    expect(SnmpTransceiverCriteria.toNumber(undefined)).toBeNull();
    expect(SnmpTransceiverCriteria.toNumber(NaN)).toBeNull();
  });

  it("compares with every numeric filter type, and nothing else", () => {
    expect(SnmpTransceiverCriteria.compare(2, 2, FilterType.GreaterThan)).toBe(
      false,
    );
    expect(
      SnmpTransceiverCriteria.compare(2, 2, FilterType.GreaterThanOrEqualTo),
    ).toBe(true);
    expect(SnmpTransceiverCriteria.compare(1, 2, FilterType.LessThan)).toBe(
      true,
    );
    expect(
      SnmpTransceiverCriteria.compare(2, 2, FilterType.LessThanOrEqualTo),
    ).toBe(true);
    expect(SnmpTransceiverCriteria.compare(2, 2, FilterType.EqualTo)).toBe(
      true,
    );
    expect(SnmpTransceiverCriteria.compare(2, 3, FilterType.NotEqualTo)).toBe(
      true,
    );
    expect(SnmpTransceiverCriteria.compare(2, 2, FilterType.Contains)).toBe(
      false,
    );
    expect(SnmpTransceiverCriteria.compare(2, 2, undefined)).toBe(false);
  });
});

describe("SnmpMonitorCriteria routes the transceiver checks", () => {
  let overTimeSpy: jest.SpiedFunction<
    typeof EvaluateOverTime.getOverTimeValueForCriteriaFilter
  >;

  beforeEach(() => {
    overTimeSpy = jest.spyOn(
      EvaluateOverTime,
      "getOverTimeValueForCriteriaFilter",
    );
  });

  afterEach(() => {
    overTimeSpy.mockRestore();
  });

  function poll(input: {
    transceivers?: Array<NetworkDeviceTransceiver> | undefined;
    walked?: boolean | undefined;
    trap?: boolean | undefined;
  }): ProbeMonitorResponse {
    return {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      monitorStepId: ObjectID.generate(),
      probeId: ObjectID.generate(),
      failureCause: "",
      isOnline: true,
      monitoredAt: new Date(),
      ...(input.walked === false
        ? {}
        : {
            snmpResponse: {
              isOnline: true,
              responseTimeInMs: 10,
              failureCause: "",
              oidResponses: [],
              ...(input.transceivers
                ? { transceivers: input.transceivers }
                : {}),
            },
          }),
      ...(input.trap
        ? {
            snmpTrapResponse: {
              sourceIpAddress: "10.0.0.1",
              trapOid: "1.3.6.1.6.3.1.1.5.3",
              snmpVersion: "2c",
              receivedAt: new Date(),
              varbinds: [],
            },
          }
        : {}),
    };
  }

  it("judges this poll's snapshot - never a window of stored samples", async () => {
    await expect(
      SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: poll({
          transceivers: [optic({ index: 1, isPresent: false })],
        }),
        criteriaFilter: filter(
          CheckOn.SnmpTransceiverNotDetected,
          FilterType.True,
        ),
      }),
    ).resolves.toContain("Transceiver no longer detected in Te1/1/1");

    expect(overTimeSpy).not.toHaveBeenCalled();
  });

  it("is not evaluated on a poll that walked nothing, or read no transceivers", async () => {
    for (const dataToProcess of [
      poll({ walked: false }),
      poll({ transceivers: undefined }),
    ]) {
      await expect(
        SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: dataToProcess,
          criteriaFilter: filter(
            CheckOn.SnmpTransceiverNotDetected,
            FilterType.False,
          ),
        }),
      ).resolves.toBeNull();
    }

    expect(overTimeSpy).not.toHaveBeenCalled();
  });

  it("a trap never evaluates a transceiver check", async () => {
    await expect(
      SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: poll({
          transceivers: [optic({ index: 1, isPresent: false })],
          trap: true,
        }),
        criteriaFilter: filter(
          CheckOn.SnmpTransceiverNotDetected,
          FilterType.True,
        ),
      }),
    ).resolves.toBeNull();
  });
});
