import CriteriaBands from "../../../../Server/Utils/Monitor/CriteriaBands";
import ObjectID from "../../../../Types/ObjectID";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeMinutes,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import MonitorCriteriaInstance, {
  MonitorCriteriaInstanceType,
} from "../../../../Types/Monitor/MonitorCriteriaInstance";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import NetworkDeviceAlertPackUtil from "../../../../Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
import {
  SnmpTableColumnRole,
  SnmpTableDefinition,
  SnmpTableKind,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import { getHostAlertTemplateById } from "../../../../Types/Monitor/HostAlertTemplates";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, it } from "@jest/globals";

/*
 * WHICH CRITERIA ARE BANDS OF ONE ANOTHER (OneUptime issue #11349).
 *
 * Two criteria are bands of one another when they read the same set of
 * measurements and differ only in the lines they draw on them. A series in
 * two bands of one check gets one alert, from the first; criteria that check
 * different things each open their own (MonitorResource's claim, measured
 * end to end in CriteriaBandsEveryMonitorType.test.ts). These are the rule
 * itself, filter by filter.
 */

type CriteriaFilters = Pick<MonitorCriteriaInstanceType, "filters">;

function criteria(...filters: Array<CriteriaFilter>): CriteriaFilters {
  return { filters: filters };
}

function metric(
  alias: string | undefined,
  filterType: FilterType,
  value?: number | string | undefined,
): CriteriaFilter {
  return {
    checkOn: CheckOn.MetricValue,
    filterType: filterType,
    value: value,
    metricMonitorOptions:
      alias === undefined
        ? undefined
        : {
            metricAlias: alias,
            metricAggregationType: EvaluateOverTimeType.Average,
          },
  };
}

function disk(path: string, above: number): CriteriaFilter {
  return {
    checkOn: CheckOn.DiskUsagePercent,
    filterType: FilterType.GreaterThan,
    value: above,
    serverMonitorOptions: { diskPath: path },
  };
}

function port(
  checkOn: CheckOn,
  interfaceName: string | undefined,
  above: number,
): CriteriaFilter {
  return {
    checkOn: checkOn,
    filterType: FilterType.GreaterThan,
    value: above,
    snmpMonitorOptions:
      interfaceName === undefined ? undefined : { interfaceName },
  };
}

const bands: (
  first: CriteriaFilters | undefined,
  second: CriteriaFilters | undefined,
) => boolean = (
  first: CriteriaFilters | undefined,
  second: CriteriaFilters | undefined,
): boolean => {
  return CriteriaBands.areBandsOfOneAnother(first, second);
};

describe("bands of one check: the same measurements, other lines", () => {
  it("critical above 95% and warning above 80% of one metric are bands", () => {
    expect(
      bands(
        criteria(metric("cpu", FilterType.GreaterThan, 95)),
        criteria(metric("cpu", FilterType.GreaterThan, 80)),
      ),
    ).toBe(true);
  });

  it("the comparison may differ: above, at least, below, at most", () => {
    const lines: Array<FilterType> = [
      FilterType.GreaterThan,
      FilterType.GreaterThanOrEqualTo,
      FilterType.LessThan,
      FilterType.LessThanOrEqualTo,
    ];

    for (const first of lines) {
      for (const second of lines) {
        expect(
          bands(
            criteria(metric("cpu", first, 90)),
            criteria(metric("cpu", second, 75)),
          ),
        ).toBe(true);
      }
    }
  });

  it("an anomaly or a forecast of a metric is a band of a threshold of it", () => {
    const threshold: CriteriaFilters = criteria(
      metric("cpu", FilterType.GreaterThan, 90),
    );

    for (const filterType of [
      FilterType.AnomalouslyHigh,
      FilterType.AnomalouslyLow,
      FilterType.Anomalous,
      FilterType.ForecastAbove,
      FilterType.ForecastBelow,
    ]) {
      expect(
        bands(threshold, criteria(metric("cpu", filterType, undefined))),
      ).toBe(true);
    }
  });

  it("how a window's values are combined, its length, the unit and no-data are no part of it", () => {
    const plain: CriteriaFilter = metric("cpu", FilterType.GreaterThan, 90);
    const overTime: CriteriaFilter = {
      ...metric("cpu", FilterType.GreaterThan, 70),
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        timeValueInMinutes: Number(EvaluateOverTimeMinutes.FiveMinutes),
        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
      },
      metricMonitorOptions: {
        metricAlias: "cpu",
        metricAggregationType: EvaluateOverTimeType.MaximumValue,
        thresholdUnit: "%",
      },
    };

    expect(bands(criteria(plain), criteria(overTime))).toBe(true);
  });

  it("the minutes within which a request was or was not received are lines too", () => {
    expect(
      bands(
        criteria({
          checkOn: CheckOn.IncomingRequest,
          filterType: FilterType.NotRecievedInMinutes,
          value: 5,
        }),
        criteria({
          checkOn: CheckOn.IncomingRequest,
          filterType: FilterType.NotRecievedInMinutes,
          value: 15,
        }),
      ),
    ).toBe(true);
  });

  it("a band written as a range reads one measurement twice: a band of one written as a line", () => {
    const warningRange: CriteriaFilters = criteria(
      metric("cpu", FilterType.GreaterThan, 75),
      metric("cpu", FilterType.LessThanOrEqualTo, 90),
    );

    expect(
      bands(warningRange, criteria(metric("cpu", FilterType.GreaterThan, 90))),
    ).toBe(true);
  });

  it("the order of the filters, and whether they combine with All or Any, are no part of it", () => {
    const first: MonitorCriteriaInstanceType = {
      ...new MonitorCriteriaInstance().data!,
      filterCondition: FilterCondition.All,
      filters: [
        metric("cpu", FilterType.GreaterThan, 90),
        metric("memory", FilterType.GreaterThan, 90),
      ],
    };
    const second: MonitorCriteriaInstanceType = {
      ...new MonitorCriteriaInstance().data!,
      filterCondition: FilterCondition.Any,
      filters: [
        metric("memory", FilterType.GreaterThan, 70),
        metric("cpu", FilterType.GreaterThan, 70),
      ],
    };

    expect(bands(first, second)).toBe(true);
  });

  it("the criteria's name, status, templates and recovery filters are no part of it", () => {
    const critical: MonitorCriteriaInstanceType = {
      ...new MonitorCriteriaInstance().data!,
      name: "CPU critical",
      monitorStatusId: ObjectID.generate(),
      changeMonitorStatus: true,
      createIncidents: true,
      incidents: [
        {
          id: "critical-incident",
          title: "CPU critical on {{host.name}}",
          description: "",
          incidentSeverityId: ObjectID.generate(),
        },
      ],
      filters: [metric("cpu", FilterType.GreaterThan, 95)],
      recoveryFilters: [metric("cpu", FilterType.LessThan, 80)],
    };
    const warning: MonitorCriteriaInstanceType = {
      ...new MonitorCriteriaInstance().data!,
      name: "CPU warning",
      createAlerts: true,
      alerts: [
        {
          id: "warning-alert",
          title: "CPU high on {{host.name}}",
          description: "",
          alertSeverityId: ObjectID.generate(),
        },
      ],
      filters: [metric("cpu", FilterType.GreaterThan, 80)],
    };

    expect(bands(critical, warning)).toBe(true);
  });

  it("selectors are compared as written, less the spaces round them", () => {
    expect(
      bands(
        criteria(
          port(CheckOn.SnmpInterfaceUtilizationPercent, " Te1/1/1 ", 95),
        ),
        criteria(port(CheckOn.SnmpInterfaceUtilizationPercent, "Te1/1/1", 80)),
      ),
    ).toBe(true);

    // No selector, an empty one and one of spaces are all none.
    expect(
      bands(
        criteria(port(CheckOn.SnmpInterfaceUtilizationPercent, undefined, 95)),
        criteria(port(CheckOn.SnmpInterfaceUtilizationPercent, "", 80)),
      ),
    ).toBe(true);
    expect(
      bands(
        criteria(port(CheckOn.SnmpInterfaceUtilizationPercent, "  ", 95)),
        criteria(port(CheckOn.SnmpInterfaceUtilizationPercent, undefined, 80)),
      ),
    ).toBe(true);
  });

  it("a value that names what a filter looks for reads the same as a number or as text", () => {
    expect(
      bands(
        criteria({
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.EqualTo,
          value: 503,
        }),
        criteria({
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.EqualTo,
          value: " 503",
        }),
      ),
    ).toBe(true);
  });

  it("criteria with no filters are bands of one another, and of nothing else", () => {
    expect(bands(criteria(), criteria())).toBe(true);
    expect(bands(undefined, criteria())).toBe(true);
    expect(
      bands(criteria(), criteria(metric("cpu", FilterType.GreaterThan, 1))),
    ).toBe(false);
  });
});

describe("criteria that check different things are not bands", () => {
  it("the recommended pack's Interface saturated and Interface errors (#11349)", () => {
    expect(
      bands(
        criteria(port(CheckOn.SnmpInterfaceUtilizationPercent, undefined, 80)),
        criteria(port(CheckOn.SnmpInterfaceErrorsPerSecond, undefined, 1)),
      ),
    ).toBe(false);
  });

  it("two metrics of one host: the CPU and the memory", () => {
    expect(
      bands(
        criteria(metric("cpu", FilterType.GreaterThan, 90)),
        criteria(metric("memory", FilterType.GreaterThan, 90)),
      ),
    ).toBe(false);
  });

  it("one disk and another, one port and another", () => {
    expect(bands(criteria(disk("/", 90)), criteria(disk("/data", 90)))).toBe(
      false,
    );
    expect(
      bands(
        criteria(port(CheckOn.SnmpInterfaceUtilizationPercent, "Gi1/0/1", 80)),
        criteria(port(CheckOn.SnmpInterfaceUtilizationPercent, "Te1/1/1", 80)),
      ),
    ).toBe(false);
  });

  it("every selector tells one measurement from another", () => {
    const pairs: Array<[CriteriaFilter, CriteriaFilter]> = [
      [
        {
          checkOn: CheckOn.SnmpOidValue,
          filterType: FilterType.GreaterThan,
          value: 70,
          snmpMonitorOptions: { oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1" },
        },
        {
          checkOn: CheckOn.SnmpOidValue,
          filterType: FilterType.GreaterThan,
          value: 70,
          snmpMonitorOptions: { oid: "1.3.6.1.4.1.9.9.48.1.1.1.5.1" },
        },
      ],
      [
        {
          checkOn: CheckOn.SnmpTableValue,
          filterType: FilterType.GreaterThan,
          value: 70,
          snmpMonitorOptions: { tableKey: "fans", tableColumnOid: "1.2.3" },
        },
        {
          checkOn: CheckOn.SnmpTableValue,
          filterType: FilterType.GreaterThan,
          value: 70,
          snmpMonitorOptions: { tableKey: "power", tableColumnOid: "1.2.3" },
        },
      ],
      [
        {
          checkOn: CheckOn.SnmpTableValue,
          filterType: FilterType.GreaterThan,
          value: 70,
          snmpMonitorOptions: { tableKey: "fans", tableColumnOid: "1.2.3" },
        },
        {
          checkOn: CheckOn.SnmpTableValue,
          filterType: FilterType.GreaterThan,
          value: 70,
          snmpMonitorOptions: { tableKey: "fans", tableColumnOid: "1.2.4" },
        },
      ],
      [
        {
          checkOn: CheckOn.SnmpTableRowIsUnhealthy,
          filterType: FilterType.True,
          value: undefined,
          snmpMonitorOptions: { tableKey: "fans", tableRow: "*" },
        },
        {
          checkOn: CheckOn.SnmpTableRowIsUnhealthy,
          filterType: FilterType.True,
          value: undefined,
          snmpMonitorOptions: { tableKey: "fans", tableRow: "Fan 1" },
        },
      ],
      [
        {
          checkOn: CheckOn.SnmpTransceiverReading,
          filterType: FilterType.LessThan,
          value: -14,
          snmpMonitorOptions: {
            interfaceName: "*",
            transceiverReading: "rxPower",
          },
        },
        {
          checkOn: CheckOn.SnmpTransceiverReading,
          filterType: FilterType.LessThan,
          value: -14,
          snmpMonitorOptions: {
            interfaceName: "*",
            transceiverReading: "txPower",
          },
        },
      ],
      [
        {
          checkOn: CheckOn.SnmpFibreChannelCounterPerSecond,
          filterType: FilterType.GreaterThan,
          value: 1,
          snmpMonitorOptions: { fibreChannelCounter: "crcErrors" },
        },
        {
          checkOn: CheckOn.SnmpFibreChannelCounterPerSecond,
          filterType: FilterType.GreaterThan,
          value: 1,
          snmpMonitorOptions: { fibreChannelCounter: "creditLoss" },
        },
      ],
      [
        {
          checkOn: CheckOn.DatabaseMetric,
          filterType: FilterType.GreaterThan,
          value: 80,
          databaseMonitorOptions: {
            metricType: MonitorMetricType.DatabaseConnectionsUsedPercent,
          },
        },
        {
          checkOn: CheckOn.DatabaseMetric,
          filterType: FilterType.GreaterThan,
          value: 80,
          databaseMonitorOptions: {
            metricType: MonitorMetricType.DatabaseReplicationLagSeconds,
          },
        },
      ],
      [
        {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.GreaterThan,
          value: 80,
          customCodeMonitorOptions: { resultValuePath: "cpu_busy_percent" },
        },
        {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.GreaterThan,
          value: 80,
          customCodeMonitorOptions: { resultValuePath: "queue.depth" },
        },
      ],
      [
        metric("cpu", FilterType.GreaterThan, 80),
        metric(undefined, FilterType.GreaterThan, 80),
      ],
    ];

    for (const [first, second] of pairs) {
      expect(bands(criteria(first), criteria(second))).toBe(false);

      // Each reads the same as itself, wherever its line is.
      if (CriteriaBands.isLineFilterType(first.filterType)) {
        expect(bands(criteria(first), criteria({ ...first, value: 1 }))).toBe(
          true,
        );
      }
    }
  });

  it("a value that names what a filter looks for is part of what it reads: two processes are two problems", () => {
    function notRunning(process: string): CriteriaFilter {
      return {
        checkOn: CheckOn.ServerProcessName,
        filterType: FilterType.IsNotExecuting,
        value: process,
      };
    }

    expect(
      bands(criteria(notRunning("nginx")), criteria(notRunning("postgres"))),
    ).toBe(false);
    expect(
      bands(criteria(notRunning("nginx")), criteria(notRunning("nginx"))),
    ).toBe(true);
  });

  it("so are a text looked for, a status code, a trap's OID and a script's expression", () => {
    const pairs: Array<[CriteriaFilter, CriteriaFilter]> = [
      [
        {
          checkOn: CheckOn.ResponseBody,
          filterType: FilterType.Contains,
          value: "error",
        },
        {
          checkOn: CheckOn.ResponseBody,
          filterType: FilterType.Contains,
          value: "timeout",
        },
      ],
      [
        {
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.EqualTo,
          value: 500,
        },
        {
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.EqualTo,
          value: 503,
        },
      ],
      [
        {
          checkOn: CheckOn.SnmpTrapReceived,
          filterType: FilterType.EqualTo,
          value: "1.3.6.1.6.3.1.1.5.3",
        },
        {
          checkOn: CheckOn.SnmpTrapReceived,
          filterType: FilterType.EqualTo,
          value: "1.3.6.1.6.3.1.1.5.1",
        },
      ],
      [
        {
          checkOn: CheckOn.JavaScriptExpression,
          filterType: FilterType.EvaluatesToTrue,
          value: "{{responseBody.status}} === 'degraded'",
        },
        {
          checkOn: CheckOn.JavaScriptExpression,
          filterType: FilterType.EvaluatesToTrue,
          value: "{{responseBody.queue}} > 100",
        },
      ],
    ];

    for (const [first, second] of pairs) {
      expect(bands(criteria(first), criteria(second))).toBe(false);
    }
  });

  it("the comparison that says what a filter looks for: True and False, Contains and Not Contains", () => {
    expect(
      bands(
        criteria({
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        }),
        criteria({
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        }),
      ),
    ).toBe(false);
    expect(
      bands(
        criteria({
          checkOn: CheckOn.ResponseBody,
          filterType: FilterType.Contains,
          value: "ok",
        }),
        criteria({
          checkOn: CheckOn.ResponseBody,
          filterType: FilterType.NotContains,
          value: "ok",
        }),
      ),
    ).toBe(false);
  });

  it("a threshold of a metric and an exact value of it read different things", () => {
    expect(
      bands(
        criteria(metric("restarts", FilterType.GreaterThan, 5)),
        criteria(metric("restarts", FilterType.EqualTo, 0)),
      ),
    ).toBe(false);
  });

  it("a criteria that reads more than another is no band of it", () => {
    expect(
      bands(
        criteria(
          metric("cpu", FilterType.GreaterThan, 90),
          metric("memory", FilterType.GreaterThan, 90),
        ),
        criteria(metric("cpu", FilterType.GreaterThan, 75)),
      ),
    ).toBe(false);
  });
});

describe("the criteria OneUptime writes", () => {
  const FAN_TABLE: SnmpTableDefinition = {
    key: "fans",
    name: "Fans",
    kind: SnmpTableKind.Hardware,
    rowLabelColumnOids: ["1.3.6.1.4.1.9.9.13.1.4.1.2"],
    columns: [
      {
        oid: "1.3.6.1.4.1.9.9.13.1.4.1.3",
        name: "State",
        role: SnmpTableColumnRole.Status,
        valueLabels: { "1": "normal", "4": "shutdown" },
        healthyValues: ["1"],
      },
    ],
  };

  const POWER_TABLE: SnmpTableDefinition = {
    ...FAN_TABLE,
    key: "power",
    name: "Power supplies",
  };

  it("no two criteria of the recommended network device pack are bands: each opens its own", () => {
    const pack: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances({
        downMonitorStatusId: ObjectID.generate(),
        upMonitorStatusId: ObjectID.generate(),
        incidentSeverityId: ObjectID.generate(),
        alertSeverityId: ObjectID.generate(),
        tables: [FAN_TABLE, POWER_TABLE],
      });

    const keys: Array<string> = pack.map(
      (instance: MonitorCriteriaInstance): string => {
        return CriteriaBands.getBandKey(instance.data);
      },
    );

    expect(pack.length).toBeGreaterThan(8);
    expect(new Set<string>(keys).size).toBe(keys.length);
  });

  it("a Host template's criteria and a warning copied from it with another threshold are bands", () => {
    const step: MonitorStep = getHostAlertTemplateById(
      "host-high-filesystem",
    )!.getMonitorStep({
      hostIdentifier: "web-01",
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "web-01",
    });

    const firing: MonitorCriteriaInstance =
      step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray.find(
        (instance: MonitorCriteriaInstance): boolean => {
          return (instance.data?.filters || []).length > 0;
        },
      )!;

    const warning: CriteriaFilters = criteria(
      ...firing.data!.filters.map((filter: CriteriaFilter) => {
        return { ...filter, value: 75 };
      }),
    );

    expect(bands(firing.data, warning)).toBe(true);
  });
});

describe("being bands of one another is an equivalence, on drawn criteria", () => {
  const CHECKS: Array<CheckOn> = [
    CheckOn.MetricValue,
    CheckOn.DiskUsagePercent,
    CheckOn.SnmpInterfaceUtilizationPercent,
    CheckOn.ServerProcessName,
  ];
  const ALIASES: Array<string | undefined> = ["a", "b", undefined];
  const NAMES: Array<string | undefined> = ["/", "/data", undefined];
  const TYPES: Array<FilterType> = [
    FilterType.GreaterThan,
    FilterType.LessThan,
    FilterType.EqualTo,
    FilterType.IsNotExecuting,
  ];
  const VALUES: Array<number | string> = [10, 80, "nginx"];

  function drawFilter(random: SeededRandom): CriteriaFilter {
    const checkOn: CheckOn = CHECKS[random(CHECKS.length)]!;
    const name: string | undefined = NAMES[random(NAMES.length)];

    return {
      checkOn: checkOn,
      filterType: TYPES[random(TYPES.length)]!,
      value: VALUES[random(VALUES.length)],
      metricMonitorOptions: { metricAlias: ALIASES[random(ALIASES.length)] },
      serverMonitorOptions: { diskPath: name },
      snmpMonitorOptions: { interfaceName: name },
    };
  }

  function drawCriteria(random: SeededRandom): CriteriaFilters {
    const filters: Array<CriteriaFilter> = [];
    const count: number = 1 + random(2);

    for (let index: number = 0; index < count; index++) {
      filters.push(drawFilter(random));
    }

    return criteria(...filters);
  }

  it("reflexive, symmetric and transitive over 300 drawn criteria", () => {
    const random: SeededRandom = seededRandom(11349);
    const drawn: Array<CriteriaFilters> = [];

    for (let index: number = 0; index < 300; index++) {
      drawn.push(drawCriteria(random));
    }

    let bandPairs: number = 0;

    for (const first of drawn) {
      expect(bands(first, first)).toBe(true);

      for (const second of drawn) {
        const firstAndSecond: boolean = bands(first, second);

        expect(bands(second, first)).toBe(firstAndSecond);

        if (firstAndSecond && first !== second) {
          bandPairs++;
        }
      }
    }

    // Transitive: bands of a third that is a band of one are bands of it.
    for (let index: number = 0; index < drawn.length; index++) {
      const first: CriteriaFilters = drawn[index]!;
      const second: CriteriaFilters = drawn[(index * 7 + 3) % drawn.length]!;

      if (!bands(first, second)) {
        continue;
      }

      for (const third of drawn) {
        if (bands(second, third)) {
          expect(bands(first, third)).toBe(true);
        }
      }
    }

    // The draws do hold bands, and criteria that are not.
    expect(bandPairs).toBeGreaterThan(50);
    expect(bandPairs).toBeLessThan(drawn.length * drawn.length);
  });

  it("a criteria's lines can move anywhere and it stays a band of itself", () => {
    const random: SeededRandom = seededRandom(1134901);

    for (let index: number = 0; index < 200; index++) {
      const drawnCriteria: CriteriaFilters = drawCriteria(random);

      const moved: CriteriaFilters = criteria(
        ...drawnCriteria.filters.map((filter: CriteriaFilter) => {
          return CriteriaBands.isLineFilterType(filter.filterType)
            ? {
                ...filter,
                filterType:
                  filter.filterType === FilterType.GreaterThan
                    ? FilterType.LessThanOrEqualTo
                    : FilterType.GreaterThanOrEqualTo,
                value: random(1000),
              }
            : filter;
        }),
      );

      expect(bands(drawnCriteria, moved)).toBe(true);
    }
  });
});
