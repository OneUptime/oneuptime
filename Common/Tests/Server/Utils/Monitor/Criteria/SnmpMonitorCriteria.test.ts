import SnmpMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/SnmpMonitorCriteria";
import MetricBaselineService, {
  BaselineSummary,
} from "../../../../../Server/Services/MetricBaselineService";
import {
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import MonitorMetricType from "../../../../../Types/Monitor/MonitorMetricType";
import SnmpDataType from "../../../../../Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpInterface from "../../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "../../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";

const PSU_OID: string = "1.3.6.1.4.1.674.10892.5.4.600.12.1.5.1.2";

function buildDataToProcess(input: {
  oidResponses: Array<SnmpOidResponse>;
  interfaces?: Array<SnmpInterface>;
  isOnline?: boolean;
  responseTimeInMs?: number;
}): ProbeMonitorResponse {
  const snmpResponse: SnmpMonitorResponse = {
    isOnline: input.isOnline ?? true,
    responseTimeInMs: input.responseTimeInMs ?? 42,
    failureCause: "",
    oidResponses: input.oidResponses,
    ...(input.interfaces ? { interfaces: input.interfaces } : {}),
  };

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    snmpResponse,
    monitoredAt: new Date(),
  };
}

function buildInterface(input: {
  name: string;
  utilizationPercent?: number | undefined;
  alias?: string | undefined;
}): SnmpInterface {
  return {
    interfaceIndex: 1,
    name: input.name,
    alias: input.alias,
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    utilizationPercent: input.utilizationPercent,
  };
}

function buildBaseline(input: {
  mean: number;
  stddev: number;
  sampleCount?: number;
  isReliable?: boolean;
}): BaselineSummary {
  return {
    sampleCount: input.sampleCount ?? 100,
    mean: input.mean,
    stddev: input.stddev,
    median: input.mean,
    p95: input.mean + 2 * input.stddev,
    minObserved: input.mean - 2 * input.stddev,
    maxObserved: input.mean + 2 * input.stddev,
    isReliable: input.isReliable ?? true,
    windowDays: 14,
    hourOfWeek: 10,
  };
}

describe("SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  describe("SnmpOidValue with Integer values (regression for issue #2439)", () => {
    test("Integer 3 equals 3 → criteria is met", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.EqualTo,
        value: "3",
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            name: "PSU2 Status",
            value: 3,
            type: SnmpDataType.Integer,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
      expect(result).toContain(PSU_OID);
      expect(result).toContain("equal to 3");
    });

    test("Integer 3 equals 5 → criteria is not met", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.EqualTo,
        value: "5",
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            value: 3,
            type: SnmpDataType.Integer,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeNull();
    });

    test("Integer 3 not-equal 6 → criteria is met", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.NotEqualTo,
        value: "6",
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            value: 3,
            type: SnmpDataType.Integer,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
      expect(result).toContain("not equal to 6");
    });

    test("Integer 3 contains '3' → criteria is met (string fallback path)", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.Contains,
        value: "3",
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            value: 3,
            type: SnmpDataType.Integer,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
      expect(result).toContain("contains 3");
    });

    test("Integer 3 greater-than-or-equal 3 → criteria is met", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: "3",
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            value: 3,
            type: SnmpDataType.Integer,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
    });
  });

  describe("SnmpOidValue with string (OctetString) values", () => {
    test("'OK' equals 'OK' → criteria is met", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.EqualTo,
        value: "OK",
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            value: "OK",
            type: SnmpDataType.OctetString,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
      expect(result).toContain("equal to OK");
    });

    test("empty OctetString is NOT coerced to numeric 0 for an 'equal to 0' filter", async () => {
      /*
       * Regression: Number("") === 0, so an empty value used to spuriously
       * satisfy a numeric "== 0" criterion. It must fall through to a string
       * comparison ("" !== "0") and not match.
       */
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.EqualTo,
        value: "0",
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            value: "",
            type: SnmpDataType.OctetString,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeNull();
    });

    test("whitespace-only OctetString is NOT coerced to numeric 0", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.EqualTo,
        value: "0",
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            value: "   ",
            type: SnmpDataType.OctetString,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeNull();
    });
  });

  describe("SnmpOidValue guards", () => {
    test("returns null when no OID is configured on the criteria filter", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.EqualTo,
        value: "3",
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            value: 3,
            type: SnmpDataType.Integer,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeNull();
    });

    test("returns null when the configured OID is not in the SNMP response", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.EqualTo,
        value: "3",
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: "1.3.6.1.2.1.1.1.0",
            value: "Linux server",
            type: SnmpDataType.OctetString,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeNull();
    });
  });

  describe("SnmpOidExists", () => {
    test("True filter matches when OID is present and has a value", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidExists,
        filterType: FilterType.True,
        value: undefined,
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            value: 3,
            type: SnmpDataType.Integer,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
      expect(result).toContain("exists");
    });

    test("False filter matches when OID is absent", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidExists,
        filterType: FilterType.False,
        value: undefined,
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
      expect(result).toContain("does not exist");
    });
  });

  describe("SnmpInterfaceUtilizationPercent anomaly filters", () => {
    let getBaselineSpy: jest.SpyInstance;

    beforeEach(() => {
      getBaselineSpy = jest.spyOn(MetricBaselineService, "getBaseline");
    });

    afterEach(() => {
      getBaselineSpy.mockRestore();
    });

    test("AnomalouslyHigh fires when utilization exceeds mean + 3σ (Medium default)", async () => {
      // mean 20, σ 5 → 3σ band is [5, 35]; observed 90 breaches high.
      getBaselineSpy.mockResolvedValue(buildBaseline({ mean: 20, stddev: 5 }));

      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
        interfaces: [buildInterface({ name: "Gi0/1", utilizationPercent: 90 })],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
      expect(result).toContain("above the same-hour baseline");
      expect(result).toContain("90.00%");
    });

    test("baseline lookup is keyed by monitorId and the utilization metric name", async () => {
      getBaselineSpy.mockResolvedValue(buildBaseline({ mean: 20, stddev: 5 }));

      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
        interfaces: [buildInterface({ name: "Gi0/1", utilizationPercent: 90 })],
      });

      await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess,
        criteriaFilter,
      });

      expect(getBaselineSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: dataToProcess.projectId.toString(),
          primaryEntityId: dataToProcess.monitorId.toString(),
          metricName: MonitorMetricType.SnmpInterfaceUtilizationPercent,
        }),
      );
    });

    test("no fire when utilization is inside the expected band", async () => {
      getBaselineSpy.mockResolvedValue(buildBaseline({ mean: 20, stddev: 5 }));

      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
        interfaces: [buildInterface({ name: "Gi0/1", utilizationPercent: 25 })],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeNull();
    });

    test("AnomalouslyLow fires when utilization drops below mean - 3σ", async () => {
      // mean 50, σ 10 → 3σ band is [20, 80]; observed 2 breaches low.
      getBaselineSpy.mockResolvedValue(buildBaseline({ mean: 50, stddev: 10 }));

      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.AnomalouslyLow,
        value: undefined,
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
        interfaces: [buildInterface({ name: "Gi0/1", utilizationPercent: 2 })],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
      expect(result).toContain("below the same-hour baseline");
    });

    test("Anomalous (either direction) fires on a high breach", async () => {
      getBaselineSpy.mockResolvedValue(buildBaseline({ mean: 20, stddev: 5 }));

      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.Anomalous,
        value: undefined,
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
        interfaces: [buildInterface({ name: "Gi0/1", utilizationPercent: 99 })],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
    });

    test("High sensitivity (2σ) fires where Medium (3σ) would not", async () => {
      // mean 20, σ 5 → 2σ band tops out at 30; observed 32 breaches at 2σ only.
      getBaselineSpy.mockResolvedValue(buildBaseline({ mean: 20, stddev: 5 }));

      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
        metricMonitorOptions: {
          anomalyDetection: {
            sensitivity: AnomalyDetectionSensitivity.High,
          },
        },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
        interfaces: [buildInterface({ name: "Gi0/1", utilizationPercent: 32 })],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
      expect(result).toContain("sensitivity High");
    });

    test("no baseline yet (learning) → never fires", async () => {
      getBaselineSpy.mockResolvedValue(null);

      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
        interfaces: [
          buildInterface({ name: "Gi0/1", utilizationPercent: 100 }),
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeNull();
    });

    test("unreliable (thin) baseline → never fires", async () => {
      getBaselineSpy.mockResolvedValue(
        buildBaseline({ mean: 20, stddev: 5, isReliable: false }),
      );

      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
        interfaces: [
          buildInterface({ name: "Gi0/1", utilizationPercent: 100 }),
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeNull();
    });

    test("zero-variance baseline → never fires", async () => {
      getBaselineSpy.mockResolvedValue(buildBaseline({ mean: 20, stddev: 0 }));

      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
        interfaces: [
          buildInterface({ name: "Gi0/1", utilizationPercent: 100 }),
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeNull();
    });

    test("interface scope applies: only the scoped interface's utilization is observed", async () => {
      getBaselineSpy.mockResolvedValue(buildBaseline({ mean: 20, stddev: 5 }));

      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
        snmpMonitorOptions: { interfaceName: "Gi0/2" },
      };

      // Out-of-scope Gi0/1 is anomalous; in-scope Gi0/2 is normal.
      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
        interfaces: [
          buildInterface({ name: "Gi0/1", utilizationPercent: 99 }),
          buildInterface({ name: "Gi0/2", utilizationPercent: 22 }),
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeNull();
    });

    test("no interfaces in the response → no baseline lookup, no fire", async () => {
      getBaselineSpy.mockResolvedValue(buildBaseline({ mean: 20, stddev: 5 }));

      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeNull();
      expect(getBaselineSpy).not.toHaveBeenCalled();
    });

    test("baseline lookup failure is swallowed (no fire, no throw)", async () => {
      getBaselineSpy.mockRejectedValue(new Error("clickhouse down"));

      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
        interfaces: [
          buildInterface({ name: "Gi0/1", utilizationPercent: 100 }),
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeNull();
    });

    test("static threshold path is untouched: GreaterThan still compares numerically", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.GreaterThan,
        value: 80,
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
        interfaces: [buildInterface({ name: "Gi0/1", utilizationPercent: 90 })],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
      expect(getBaselineSpy).not.toHaveBeenCalled();
    });
  });
});

/*
 * Ping-first polling. A device with no usable SNMP credentials is only
 * pinged, and the walk pipeline hands its monitors a response with
 * `snmpResponse` undefined - never a synthesized failure. Every criterion
 * that reads the walk must then be NOT EVALUATED (null) rather than
 * breaching, while reachability keeps reading the top-level isOnline.
 */
function buildPingOnlyDataToProcess(input: {
  isOnline: boolean;
}): ProbeMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: input.isOnline ? "" : "Request timed out",
    isOnline: input.isOnline,
    pingResponse: {
      packetsSent: 2,
      packetsReceived: input.isOnline ? 2 : 0,
      packetLossPercent: input.isOnline ? 0 : 100,
      avgRoundTripTimeInMs: input.isOnline ? 1.5 : undefined,
    },
    monitoredAt: new Date(),
  };
}

describe("SnmpMonitorCriteria — ping-first polling", () => {
  describe("a poll that ran no walk evaluates no walk-dependent criterion", () => {
    const walkDependentFilters: Array<CriteriaFilter> = [
      {
        checkOn: CheckOn.SnmpWalkIsSucceeding,
        filterType: FilterType.False,
        value: undefined,
      },
      {
        checkOn: CheckOn.SnmpOidExists,
        filterType: FilterType.False,
        value: undefined,
        snmpMonitorOptions: { oid: PSU_OID },
      },
      {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.EqualTo,
        value: "3",
        snmpMonitorOptions: { oid: PSU_OID },
      },
      {
        checkOn: CheckOn.SnmpResponseTime,
        filterType: FilterType.GreaterThan,
        value: 0,
      },
      {
        checkOn: CheckOn.SnmpInterfaceIsDown,
        filterType: FilterType.False,
        value: undefined,
      },
      {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.LessThan,
        value: 100,
      },
      {
        checkOn: CheckOn.SnmpInterfaceErrorsPerSecond,
        filterType: FilterType.LessThan,
        value: 100,
      },
    ];

    for (const criteriaFilter of walkDependentFilters) {
      /*
       * Each of these filters is chosen to MATCH an empty/absent walk if it
       * were evaluated ("OID Exists is False", "Interface Is Down is
       * False", "Walk Is Succeeding is False"), which is exactly the
       * false incident a ping-only device must never raise.
       */
      test(`${criteriaFilter.checkOn} is not evaluated (null) on a reachable ping-only poll`, async () => {
        const result: string | null =
          await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
            dataToProcess: buildPingOnlyDataToProcess({ isOnline: true }),
            criteriaFilter,
          });

        expect(result).toBeNull();
      });
    }
  });

  describe("SnmpIsOnline reads device reachability, with or without a walk", () => {
    test("a reachable ping-only poll satisfies 'Is Online = True'", async () => {
      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: buildPingOnlyDataToProcess({ isOnline: true }),
          criteriaFilter: {
            checkOn: CheckOn.SnmpIsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
        });

      expect(result).toBeTruthy();
    });

    test("an unreachable ping-only poll satisfies 'Is Online = False' (the unreachable incident)", async () => {
      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: buildPingOnlyDataToProcess({ isOnline: false }),
          criteriaFilter: {
            checkOn: CheckOn.SnmpIsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
        });

      expect(result).toBeTruthy();
    });

    /*
     * ICMP-filtered SNMP gear: the walk succeeded, so the device is
     * reachable even though the top-level verdict is what is read - the
     * pipeline stamps isOnline = ping || walk, and that is what arrives.
     */
    test("reads the top-level verdict, not the walk's: a failed walk on a reachable device is still online", async () => {
      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
        isOnline: false,
      });
      dataToProcess.isOnline = true;

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter: {
            checkOn: CheckOn.SnmpIsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
        });

      expect(result).toBeTruthy();
    });
  });

  describe("SnmpWalkIsSucceeding reads the walk itself", () => {
    test("a failed walk satisfies 'Walk Is Succeeding = False' (the walk-failing alert)", async () => {
      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
        isOnline: false,
      });
      // The device still answers ping; only the walk is broken.
      dataToProcess.isOnline = true;

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter: {
            checkOn: CheckOn.SnmpWalkIsSucceeding,
            filterType: FilterType.False,
            value: undefined,
          },
        });

      expect(result).toBeTruthy();
    });

    test("a successful walk satisfies 'Walk Is Succeeding = True' and not 'False'", async () => {
      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
        isOnline: true,
      });

      expect(
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter: {
            checkOn: CheckOn.SnmpWalkIsSucceeding,
            filterType: FilterType.True,
            value: undefined,
          },
        }),
      ).toBeTruthy();

      expect(
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter: {
            checkOn: CheckOn.SnmpWalkIsSucceeding,
            filterType: FilterType.False,
            value: undefined,
          },
        }),
      ).toBeNull();
    });
  });
});
