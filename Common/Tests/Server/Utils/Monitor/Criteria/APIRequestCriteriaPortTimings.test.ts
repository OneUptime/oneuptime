import APIRequestCriteria from "../../../../../Server/Utils/Monitor/Criteria/APIRequestCriteria";
import EvaluateOverTime from "../../../../../Server/Utils/Monitor/Criteria/EvaluateOverTime";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import PortMonitorTimings from "../../../../../Types/Monitor/PortMonitor/PortMonitorTimings";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

function buildResponse(portTimings?: PortMonitorTimings): ProbeMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    monitoredAt: new Date(),
    portTimings: portTimings,
  };
}

function criteria(input: {
  checkOn: CheckOn.PortDnsLookupTime | CheckOn.PortTcpConnectTime;
  filterType?: FilterType;
  value: number | string;
  evaluateOverTime?: boolean;
}): CriteriaFilter {
  return {
    checkOn: input.checkOn,
    filterType: input.filterType || FilterType.GreaterThan,
    value: input.value,
    evaluateOverTime: input.evaluateOverTime,
    evaluateOverTimeOptions: input.evaluateOverTime
      ? {
          timeValueInMinutes: 5,
          evaluateOverTimeType: EvaluateOverTimeType.Average,
        }
      : undefined,
  };
}

async function evaluate(
  response: ProbeMonitorResponse,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return APIRequestCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: response,
    criteriaFilter: criteriaFilter,
  });
}

describe("APIRequestCriteria Port connection phase timings", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("evaluates the current DNS lookup duration", async () => {
    const result: string | null = await evaluate(
      buildResponse({
        dnsLookupInMs: 151,
        tcpConnectInMs: 25,
        totalConnectionInMs: 176,
      }),
      criteria({ checkOn: CheckOn.PortDnsLookupTime, value: "150" }),
    );

    expect(result).toContain(CheckOn.PortDnsLookupTime);
  });

  test("returns null when the current DNS lookup duration is below the threshold", async () => {
    const result: string | null = await evaluate(
      buildResponse({
        dnsLookupInMs: 149,
        tcpConnectInMs: 25,
        totalConnectionInMs: 174,
      }),
      criteria({ checkOn: CheckOn.PortDnsLookupTime, value: 150 }),
    );

    expect(result).toBeNull();
  });

  test("evaluates the current TCP connect duration independently of DNS", async () => {
    const result: string | null = await evaluate(
      buildResponse({
        dnsLookupInMs: 300,
        tcpConnectInMs: 75,
        totalConnectionInMs: 375,
      }),
      criteria({
        checkOn: CheckOn.PortTcpConnectTime,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 75,
      }),
    );

    expect(result).toContain(CheckOn.PortTcpConnectTime);
  });

  test("treats an absent DNS phase on an IP-literal destination as no data", async () => {
    const result: string | null = await evaluate(
      buildResponse({ tcpConnectInMs: 20, totalConnectionInMs: 20 }),
      criteria({
        checkOn: CheckOn.PortDnsLookupTime,
        filterType: FilterType.LessThan,
        value: 100,
      }),
    );

    expect(result).toBeNull();
  });

  test("treats an absent TCP phase on a failed pre-connect check as no data", async () => {
    const result: string | null = await evaluate(
      buildResponse({ dnsLookupInMs: 100, totalConnectionInMs: 100 }),
      criteria({ checkOn: CheckOn.PortTcpConnectTime, value: 10 }),
    );

    expect(result).toBeNull();
  });

  test("preserves a legitimate zero-millisecond phase", async () => {
    const result: string | null = await evaluate(
      buildResponse({
        dnsLookupInMs: 0,
        tcpConnectInMs: 0,
        totalConnectionInMs: 0,
      }),
      criteria({
        checkOn: CheckOn.PortDnsLookupTime,
        filterType: FilterType.LessThan,
        value: 1,
      }),
    );

    expect(result).not.toBeNull();
  });

  test("uses an evaluate-over-time aggregate instead of the current phase", async () => {
    const overTimeSpy: jest.SpiedFunction<
      typeof EvaluateOverTime.getValueOverTime
    > = jest.spyOn(EvaluateOverTime, "getValueOverTime").mockResolvedValue(250);

    const response: ProbeMonitorResponse = buildResponse({
      dnsLookupInMs: 5,
      tcpConnectInMs: 10,
      totalConnectionInMs: 15,
    });
    const result: string | null = await evaluate(
      response,
      criteria({
        checkOn: CheckOn.PortDnsLookupTime,
        value: 200,
        evaluateOverTime: true,
      }),
    );

    expect(result).not.toBeNull();
    expect(overTimeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: response.projectId,
        monitorId: response.monitorId,
        metricType: CheckOn.PortDnsLookupTime,
      }),
    );
  });

  test("does not replace a zero evaluate-over-time aggregate with the current value", async () => {
    jest.spyOn(EvaluateOverTime, "getValueOverTime").mockResolvedValue(0);

    const result: string | null = await evaluate(
      buildResponse({
        dnsLookupInMs: 500,
        tcpConnectInMs: 10,
        totalConnectionInMs: 510,
      }),
      criteria({
        checkOn: CheckOn.PortDnsLookupTime,
        filterType: FilterType.LessThan,
        value: 1,
        evaluateOverTime: true,
      }),
    );

    expect(result).not.toBeNull();
  });

  test("falls back to the current phase if the history query fails", async () => {
    jest
      .spyOn(EvaluateOverTime, "getValueOverTime")
      .mockRejectedValue(new Error("history unavailable"));

    const result: string | null = await evaluate(
      buildResponse({
        dnsLookupInMs: 1,
        tcpConnectInMs: 250,
        totalConnectionInMs: 251,
      }),
      criteria({
        checkOn: CheckOn.PortTcpConnectTime,
        value: 200,
        evaluateOverTime: true,
      }),
    );

    expect(result).not.toBeNull();
  });
});
