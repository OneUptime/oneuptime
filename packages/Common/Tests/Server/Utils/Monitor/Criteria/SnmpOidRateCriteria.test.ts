import SnmpMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/SnmpMonitorCriteria";
import EvaluateOverTime from "../../../../../Server/Utils/Monitor/Criteria/EvaluateOverTime";
import MonitorCriteriaObservationBuilder from "../../../../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../../Types/Monitor/CriteriaFilter";
import SnmpDataType from "../../../../../Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "../../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * SNMP OID Rate (per second): how fast a counter OID grows between polls.
 * A counter only grows, so a threshold on its raw value stays crossed from
 * the moment it is first passed until the device restarts - the rate is
 * what says something about now. The server works it out on ingest
 * (SnmpOidRateUtil) and the criteria compares it; until there is a rate
 * (a device's first poll, a counter that wrapped) the criteria is not
 * evaluated at all, so it never raises or resolves anything on a guess.
 */

const IF_IN_ERRORS: string = "1.3.6.1.2.1.2.2.1.14.3";

function buildDataToProcess(
  oidResponses: Array<SnmpOidResponse>,
): ProbeMonitorResponse {
  const snmpResponse: SnmpMonitorResponse = {
    isOnline: true,
    responseTimeInMs: 42,
    failureCause: "",
    oidResponses: oidResponses,
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

function counterRead(data: {
  value?: number | string;
  ratePerSecond?: number | undefined;
  oid?: string;
  type?: SnmpDataType;
}): SnmpOidResponse {
  return {
    oid: data.oid ?? IF_IN_ERRORS,
    name: "ifInErrors.3",
    value: data.value ?? 1200,
    type: data.type ?? SnmpDataType.Counter32,
    ...(data.ratePerSecond === undefined
      ? {}
      : { ratePerSecond: data.ratePerSecond }),
  };
}

function rateFilter(data: {
  filterType: FilterType;
  value: string | number | undefined;
  oid?: string | undefined;
}): CriteriaFilter {
  return {
    checkOn: CheckOn.SnmpOidRatePerSecond,
    filterType: data.filterType,
    value: data.value,
    snmpMonitorOptions: { oid: "oid" in data ? data.oid : IF_IN_ERRORS },
  };
}

async function evaluate(
  oidResponses: Array<SnmpOidResponse>,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: buildDataToProcess(oidResponses),
    criteriaFilter,
  });
}

describe("SNMP OID Rate (per second) criteria", () => {
  test("is met when the counter grows faster than the threshold, and says by how much", async () => {
    const result: string | null = await evaluate(
      [counterRead({ ratePerSecond: 4.5 })],
      rateFilter({ filterType: FilterType.GreaterThan, value: "1" }),
    );

    expect(result).toBe(
      `SNMP OID ${IF_IN_ERRORS} (ifInErrors.3): SNMP OID Rate (per second) was 4.5, above the 1 threshold.`,
    );
  });

  test("is not met while the counter grows slower than the threshold", async () => {
    expect(
      await evaluate(
        [counterRead({ ratePerSecond: 0.2 })],
        rateFilter({ filterType: FilterType.GreaterThan, value: "1" }),
      ),
    ).toBeNull();
  });

  test("compares the rate, never the counter's raw value", async () => {
    /*
     * A switch port that logged a million errors since boot and logs none
     * now: the raw value is far over 100, the rate is zero.
     */
    expect(
      await evaluate(
        [counterRead({ value: 1000000, ratePerSecond: 0 })],
        rateFilter({ filterType: FilterType.GreaterThan, value: "100" }),
      ),
    ).toBeNull();

    expect(
      await evaluate(
        [counterRead({ value: 5, ratePerSecond: 250 })],
        rateFilter({ filterType: FilterType.GreaterThan, value: "100" }),
      ),
    ).toBeTruthy();
  });

  test("keeps a threshold's decimals: 0.5 a second is not read as 0", async () => {
    // 0.2 errors a second is below 0.5; truncated to 0 it would be above.
    expect(
      await evaluate(
        [counterRead({ ratePerSecond: 0.2 })],
        rateFilter({ filterType: FilterType.GreaterThan, value: "0.5" }),
      ),
    ).toBeNull();

    expect(
      await evaluate(
        [counterRead({ ratePerSecond: 0.75 })],
        rateFilter({ filterType: FilterType.GreaterThan, value: "0.5" }),
      ),
    ).toBeTruthy();

    expect(
      await evaluate(
        [counterRead({ ratePerSecond: 0.75 })],
        rateFilter({ filterType: FilterType.GreaterThan, value: 0.5 }),
      ),
    ).toBeTruthy();
  });

  test("below, at least and at most compare as written", async () => {
    const cases: Array<{
      filterType: FilterType;
      rate: number;
      isMet: boolean;
    }> = [
      { filterType: FilterType.LessThan, rate: 9, isMet: true },
      { filterType: FilterType.LessThan, rate: 10, isMet: false },
      { filterType: FilterType.LessThanOrEqualTo, rate: 10, isMet: true },
      { filterType: FilterType.LessThanOrEqualTo, rate: 10.01, isMet: false },
      { filterType: FilterType.GreaterThanOrEqualTo, rate: 10, isMet: true },
      { filterType: FilterType.GreaterThanOrEqualTo, rate: 9.99, isMet: false },
      { filterType: FilterType.GreaterThan, rate: 10, isMet: false },
      { filterType: FilterType.GreaterThan, rate: 10.01, isMet: true },
    ];

    for (const entry of cases) {
      const result: string | null = await evaluate(
        [counterRead({ ratePerSecond: entry.rate })],
        rateFilter({ filterType: entry.filterType, value: "10" }),
      );

      expect({ ...entry, isMet: Boolean(result) }).toEqual(entry);
    }
  });

  test("is not evaluated before there is a rate (a device's first poll, a counter that wrapped)", async () => {
    /*
     * "Below 10 a second" would hold for a missing rate read as zero - and
     * resolve a real incident on a guess. No rate, no verdict.
     */
    for (const filterType of [
      FilterType.LessThan,
      FilterType.LessThanOrEqualTo,
      FilterType.GreaterThan,
      FilterType.GreaterThanOrEqualTo,
    ]) {
      expect(
        await evaluate(
          [counterRead({ ratePerSecond: undefined })],
          rateFilter({ filterType, value: "10" }),
        ),
      ).toBeNull();
    }
  });

  test("is not evaluated for a rate that is not a finite number", async () => {
    for (const ratePerSecond of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        await evaluate(
          [counterRead({ ratePerSecond })],
          rateFilter({ filterType: FilterType.LessThan, value: "10" }),
        ),
      ).toBeNull();
    }
  });

  test("is not evaluated when the poll did not read the OID", async () => {
    expect(
      await evaluate(
        [
          counterRead({
            oid: "1.3.6.1.2.1.2.2.1.20.3",
            ratePerSecond: 3,
          }),
        ],
        rateFilter({ filterType: FilterType.LessThan, value: "10" }),
      ),
    ).toBeNull();

    expect(
      await evaluate(
        [],
        rateFilter({ filterType: FilterType.LessThan, value: "10" }),
      ),
    ).toBeNull();
  });

  test("is not evaluated without an OID or without a number to compare with", async () => {
    for (const oid of [undefined, ""]) {
      expect(
        await evaluate(
          [counterRead({ ratePerSecond: 3 })],
          rateFilter({ filterType: FilterType.LessThan, value: "10", oid }),
        ),
      ).toBeNull();
    }

    // Alert on it leaves a counter's threshold blank: nothing fires until one is set.
    for (const value of [undefined, "", "abc"]) {
      expect(
        await evaluate(
          [counterRead({ ratePerSecond: 3 })],
          rateFilter({ filterType: FilterType.GreaterThan, value }),
        ),
      ).toBeNull();
    }
  });

  test("matches the OID however it is spelled (a leading dot or not)", async () => {
    expect(
      await evaluate(
        [counterRead({ oid: `.${IF_IN_ERRORS}`, ratePerSecond: 3 })],
        rateFilter({ filterType: FilterType.GreaterThan, value: "1" }),
      ),
    ).toBeTruthy();

    expect(
      await evaluate(
        [counterRead({ ratePerSecond: 3 })],
        rateFilter({
          filterType: FilterType.GreaterThan,
          value: "1",
          oid: ` .${IF_IN_ERRORS} `,
        }),
      ),
    ).toBeTruthy();
  });

  test("a counter's raw value is still what SNMP OID Value compares", async () => {
    // The rate is an addition beside the value, not in place of it.
    expect(
      await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: buildDataToProcess([
          counterRead({ value: 1200, ratePerSecond: 0 }),
        ]),
        criteriaFilter: {
          checkOn: CheckOn.SnmpOidValue,
          filterType: FilterType.GreaterThan,
          value: "1000",
          snmpMonitorOptions: { oid: IF_IN_ERRORS },
        },
      }),
    ).toBeTruthy();
  });

  test("a poll that ran no walk does not evaluate it", async () => {
    expect(
      await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: {
          projectId: ObjectID.generate(),
          monitorId: ObjectID.generate(),
          monitorStepId: ObjectID.generate(),
          probeId: ObjectID.generate(),
          failureCause: "",
          isOnline: true,
          monitoredAt: new Date(),
        },
        criteriaFilter: rateFilter({
          filterType: FilterType.LessThan,
          value: "10",
        }),
      }),
    ).toBeNull();
  });

  /*
   * The check is walk-dependent: on a poll that walked nothing it is not
   * evaluated before any window is looked up. A window set through the API
   * would otherwise ask for samples nobody records, and a "breach on no
   * data" policy would raise an alert on a device that is only pinged.
   */
  test("a poll that ran no walk looks up no window, whatever the filter asks", async () => {
    const overTime: ReturnType<typeof jest.spyOn> = jest.spyOn(
      EvaluateOverTime,
      "getOverTimeValueForCriteriaFilter",
    );

    expect(
      await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: {
          projectId: ObjectID.generate(),
          monitorId: ObjectID.generate(),
          monitorStepId: ObjectID.generate(),
          probeId: ObjectID.generate(),
          failureCause: "",
          isOnline: true,
          monitoredAt: new Date(),
        },
        criteriaFilter: {
          ...rateFilter({ filterType: FilterType.GreaterThan, value: "10" }),
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
            onNoDataPolicy: NoDataPolicy.Trigger,
          },
        },
      }),
    ).toBeNull();
    expect(overTime).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * What the criteria evaluation summary (and the alert, and OneUptime AI)
 * reads for the check: the rate the poll had, or why it had none.
 */
describe("SNMP OID Rate (per second) observation", () => {
  function observe(
    dataToProcess: ProbeMonitorResponse,
    oid: string | undefined = IF_IN_ERRORS,
  ): string | null {
    return MonitorCriteriaObservationBuilder.describeFilterObservation({
      monitor: new Monitor(),
      monitorStep: new MonitorStep(),
      dataToProcess,
      criteriaFilter: rateFilter({
        filterType: FilterType.GreaterThan,
        value: "1",
        oid,
      }),
    });
  }

  test("names the counter and how fast it grew", () => {
    expect(
      observe(buildDataToProcess([counterRead({ ratePerSecond: 4.5 })])),
    ).toBe(`SNMP OID ifInErrors.3 (${IF_IN_ERRORS}) grew 4.5 per second.`);
  });

  test("a counter that has not grown grew 0 per second", () => {
    expect(
      observe(buildDataToProcess([counterRead({ ratePerSecond: 0 })])),
    ).toBe(`SNMP OID ifInErrors.3 (${IF_IN_ERRORS}) grew 0 per second.`);
  });

  test("says why there is no rate yet", () => {
    expect(
      observe(buildDataToProcess([counterRead({ ratePerSecond: undefined })])),
    ).toBe(
      `SNMP OID ifInErrors.3 (${IF_IN_ERRORS}) has no rate yet: it needs two polls, and a counter that went back (wrapped, or the device restarted) starts again.`,
    );
  });

  test("says an OID that is not a counter has no rate", () => {
    expect(
      observe(
        buildDataToProcess([
          counterRead({ value: 7, type: SnmpDataType.Gauge32 }),
        ]),
      ),
    ).toBe(
      `SNMP OID ifInErrors.3 (${IF_IN_ERRORS}) is not a counter (Gauge32), so it has no rate.`,
    );
  });

  test("says when the device did not return the OID, or no OID is set", () => {
    expect(observe(buildDataToProcess([]))).toBe(
      `SNMP OID ${IF_IN_ERRORS} was not returned by the device.`,
    );
    expect(observe(buildDataToProcess([]), "")).toBe(
      "No OID is configured on this criteria. Pick one from the OID dropdown in the criteria editor.",
    );
  });

  test("finds the OID however it is spelled, as the criteria does", () => {
    expect(
      observe(
        buildDataToProcess([
          counterRead({ oid: `.${IF_IN_ERRORS}`, ratePerSecond: 2 }),
        ]),
      ),
    ).toBe(`SNMP OID ifInErrors.3 (${IF_IN_ERRORS}) grew 2 per second.`);
    expect(
      observe(
        buildDataToProcess([counterRead({ ratePerSecond: 2 })]),
        `.${IF_IN_ERRORS}`,
      ),
    ).toBe(`SNMP OID ifInErrors.3 (.${IF_IN_ERRORS}) grew 2 per second.`);
  });

  test("numbers read as the device reports them: no trailing zeros, two decimals at most", () => {
    function valueObservation(
      value: number,
      type: SnmpDataType,
    ): string | null {
      return MonitorCriteriaObservationBuilder.describeFilterObservation({
        monitor: new Monitor(),
        monitorStep: new MonitorStep(),
        dataToProcess: buildDataToProcess([
          { oid: IF_IN_ERRORS, name: "sample", value: value, type: type },
        ]),
        criteriaFilter: {
          checkOn: CheckOn.SnmpOidValue,
          filterType: FilterType.GreaterThan,
          value: "1",
          snmpMonitorOptions: { oid: IF_IN_ERRORS },
        },
      });
    }

    expect(valueObservation(8640000, SnmpDataType.TimeTicks)).toBe(
      `SNMP OID sample (${IF_IN_ERRORS}) value was 8640000 (TimeTicks)`,
    );
    expect(valueObservation(41.256, SnmpDataType.Gauge32)).toBe(
      `SNMP OID sample (${IF_IN_ERRORS}) value was 41.26 (Gauge32)`,
    );
    expect(valueObservation(0.5, SnmpDataType.Gauge32)).toBe(
      `SNMP OID sample (${IF_IN_ERRORS}) value was 0.5 (Gauge32)`,
    );
    expect(
      observe(buildDataToProcess([counterRead({ ratePerSecond: 125000000 })])),
    ).toBe(
      `SNMP OID ifInErrors.3 (${IF_IN_ERRORS}) grew 125000000 per second.`,
    );
  });

  test("the OID value check finds a dotted OID too", () => {
    expect(
      MonitorCriteriaObservationBuilder.describeFilterObservation({
        monitor: new Monitor(),
        monitorStep: new MonitorStep(),
        dataToProcess: buildDataToProcess([
          counterRead({ oid: `.${IF_IN_ERRORS}`, value: 1200 }),
        ]),
        criteriaFilter: {
          checkOn: CheckOn.SnmpOidExists,
          filterType: FilterType.True,
          value: undefined,
          snmpMonitorOptions: { oid: IF_IN_ERRORS },
        },
      }),
    ).toBe(`SNMP OID ${IF_IN_ERRORS} returned 1200 (Counter32).`);
  });
});
