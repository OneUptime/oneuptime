import NtpMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/NtpMonitorCriteria";
import EvaluateOverTime, {
  OverTimeCriteriaValue,
} from "../../../../../Server/Utils/Monitor/Criteria/EvaluateOverTime";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import NtpMonitorResponse from "../../../../../Types/Monitor/NtpMonitor/NtpMonitorResponse";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * The NTP criteria judge what the probe found. The rule the tests below keep
 * coming back to: a filter about the server's time (synchronized, stratum,
 * offset, root dispersion, response time) has nothing to judge when the
 * server did not answer, so it is not met either way. Reachability is what
 * "NTP Is Online" is for.
 */

// A healthy stratum 2 server, 3.5 ms ahead of the probe.
function answered(
  overrides: Partial<NtpMonitorResponse> = {},
): NtpMonitorResponse {
  return {
    isOnline: true,
    isSynchronized: true,
    responseTimeInMs: 18,
    failureCause: "",
    serverAddress: "192.0.2.10",
    port: 123,
    version: 4,
    leapIndicator: 0,
    stratum: 2,
    referenceId: "192.0.2.1",
    rootDelayInMs: 12.5,
    rootDispersionInMs: 3.25,
    clockOffsetInMs: 3.5,
    roundTripDelayInMs: 17.2,
    serverTime: "2026-07-14T09:55:00.000Z",
    ...overrides,
  };
}

function silent(failureCause: string): NtpMonitorResponse {
  return {
    isOnline: false,
    isSynchronized: false,
    responseTimeInMs: 0,
    failureCause: failureCause,
    isTimeout: true,
    serverAddress: "192.0.2.10",
    port: 123,
  };
}

function probeResponse(
  ntpResponse: NtpMonitorResponse | undefined,
  overrides: Partial<ProbeMonitorResponse> = {},
): ProbeMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    isOnline: ntpResponse?.isOnline,
    responseTimeInMs: ntpResponse?.isOnline
      ? ntpResponse.responseTimeInMs
      : undefined,
    failureCause: ntpResponse?.failureCause || "",
    ntpResponse: ntpResponse,
    monitoredAt: new Date(),
    ...overrides,
  };
}

function filter(
  checkOn: CheckOn,
  filterType: FilterType,
  value?: string | number | undefined,
): CriteriaFilter {
  return { checkOn, filterType, value };
}

async function evaluate(
  ntpResponse: NtpMonitorResponse | undefined,
  criteriaFilter: CriteriaFilter,
  overrides: Partial<ProbeMonitorResponse> = {},
): Promise<string | null> {
  return NtpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: probeResponse(ntpResponse, overrides),
    criteriaFilter: criteriaFilter,
  });
}

const NTP_CHECK_ONS: Array<CheckOn> = [
  CheckOn.NtpIsOnline,
  CheckOn.NtpIsSynchronized,
  CheckOn.NtpStratum,
  CheckOn.NtpClockOffset,
  CheckOn.NtpResponseTime,
  CheckOn.NtpRootDispersion,
];

describe("NtpMonitorCriteria", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("isNtpCheckOn", () => {
    test.each(NTP_CHECK_ONS)("claims %s", (checkOn: CheckOn) => {
      expect(NtpMonitorCriteria.isNtpCheckOn(checkOn)).toBe(true);
    });

    test.each([
      CheckOn.IsOnline,
      CheckOn.ResponseTime,
      CheckOn.DnsIsOnline,
      CheckOn.SnmpIsOnline,
    ])("leaves %s to its own evaluator", (checkOn: CheckOn) => {
      expect(NtpMonitorCriteria.isNtpCheckOn(checkOn)).toBe(false);
    });

    test("nothing at all is not an NTP check", () => {
      expect(NtpMonitorCriteria.isNtpCheckOn(undefined)).toBe(false);
    });
  });

  test("a CheckOn of another monitor type is not met", async () => {
    expect(
      await evaluate(
        answered(),
        filter(CheckOn.ResponseTime, FilterType.LessThan, 1000),
      ),
    ).toBeNull();
  });

  describe("NTP Is Online", () => {
    test("an answering server matches True", async () => {
      expect(
        await evaluate(
          answered(),
          filter(CheckOn.NtpIsOnline, FilterType.True),
        ),
      ).toBe("NTP Is Online is true.");
    });

    test("an answering server does not match False", async () => {
      expect(
        await evaluate(
          answered(),
          filter(CheckOn.NtpIsOnline, FilterType.False),
        ),
      ).toBeNull();
    });

    test("a silent server matches False and says why", async () => {
      const result: string | null = await evaluate(
        silent("No NTP reply from 192.0.2.10:123 within 5 seconds."),
        filter(CheckOn.NtpIsOnline, FilterType.False),
      );

      expect(result).toBe(
        "NTP Is Online is false. No NTP reply from 192.0.2.10:123 within 5 seconds.",
      );
    });

    test("a silent server does not match True", async () => {
      expect(
        await evaluate(
          silent("No NTP reply."),
          filter(CheckOn.NtpIsOnline, FilterType.True),
        ),
      ).toBeNull();
    });

    test("a kiss-o'-death is an answer", async () => {
      expect(
        await evaluate(
          answered({
            isSynchronized: false,
            stratum: 0,
            kissCode: "RATE",
            leapIndicator: 3,
            clockOffsetInMs: undefined,
            failureCause:
              "The server answered with a kiss-o'-death (RATE): the server is rate-limiting this probe and asks it to poll less often.",
          }),
          filter(CheckOn.NtpIsOnline, FilterType.True),
        ),
      ).toBe("NTP Is Online is true.");
    });

    test("an answering server's message carries no failure cause", async () => {
      const result: string | null = await evaluate(
        answered({ isSynchronized: false, failureCause: "Not synchronized." }),
        filter(CheckOn.NtpIsOnline, FilterType.True),
      );

      expect(result).toBe("NTP Is Online is true.");
    });

    test("falls back to the probe's isOnline when no NTP response came", async () => {
      expect(
        await evaluate(
          undefined,
          filter(CheckOn.NtpIsOnline, FilterType.False),
          {
            isOnline: false,
            failureCause: "NTP server is not specified.",
          },
        ),
      ).toBe("NTP Is Online is false. NTP server is not specified.");
    });

    test("nothing to judge is not met", async () => {
      expect(
        await evaluate(
          undefined,
          filter(CheckOn.NtpIsOnline, FilterType.False),
          { isOnline: undefined },
        ),
      ).toBeNull();
    });
  });

  describe("NTP Is Synchronized", () => {
    test("a synchronized server matches True", async () => {
      expect(
        await evaluate(
          answered(),
          filter(CheckOn.NtpIsSynchronized, FilterType.True),
        ),
      ).toBe("NTP Is Synchronized is true.");
    });

    test("an unsynchronized server matches False and says why", async () => {
      const result: string | null = await evaluate(
        answered({
          isSynchronized: false,
          leapIndicator: 3,
          failureCause:
            "The server reports its clock as not synchronized (leap indicator 3, alarm).",
        }),
        filter(CheckOn.NtpIsSynchronized, FilterType.False),
      );

      expect(result).toBe(
        "NTP Is Synchronized is false. The server reports its clock as not synchronized (leap indicator 3, alarm).",
      );
    });

    test("a kiss-o'-death is not synchronized", async () => {
      const result: string | null = await evaluate(
        answered({
          isSynchronized: false,
          stratum: 0,
          kissCode: "DENY",
          failureCause:
            "The server answered with a kiss-o'-death (DENY): the server denies access to this probe.",
        }),
        filter(CheckOn.NtpIsSynchronized, FilterType.False),
      );

      expect(result).toContain("NTP Is Synchronized is false.");
      expect(result).toContain("(DENY)");
    });

    test("a synchronized server does not match False", async () => {
      expect(
        await evaluate(
          answered(),
          filter(CheckOn.NtpIsSynchronized, FilterType.False),
        ),
      ).toBeNull();
    });

    test("is not judged when the server did not answer, either way", async () => {
      for (const filterType of [FilterType.True, FilterType.False]) {
        expect(
          await evaluate(
            silent("No NTP reply."),
            filter(CheckOn.NtpIsSynchronized, filterType),
          ),
        ).toBeNull();
      }
    });
  });

  describe("NTP Stratum", () => {
    test("compares the stratum", async () => {
      const result: string | null = await evaluate(
        answered({ stratum: 3 }),
        filter(CheckOn.NtpStratum, FilterType.GreaterThan, "2"),
      );

      expect(result).toContain("3");
      expect(result).toContain("Stratum 3 (secondary server).");
    });

    test("does not match a stratum inside the bound", async () => {
      expect(
        await evaluate(
          answered({ stratum: 1 }),
          filter(CheckOn.NtpStratum, FilterType.GreaterThan, "1"),
        ),
      ).toBeNull();
    });

    test("Equal To and Not Equal To work on the stratum", async () => {
      expect(
        await evaluate(
          answered({ stratum: 1 }),
          filter(CheckOn.NtpStratum, FilterType.EqualTo, "1"),
        ),
      ).not.toBeNull();
      expect(
        await evaluate(
          answered({ stratum: 1 }),
          filter(CheckOn.NtpStratum, FilterType.NotEqualTo, "1"),
        ),
      ).toBeNull();
    });

    test("a kiss-o'-death's stratum 0 counts as 16, so it is not 'at most 2'", async () => {
      const kissOfDeath: NtpMonitorResponse = answered({
        isSynchronized: false,
        stratum: 0,
        kissCode: "RATE",
      });

      expect(
        await evaluate(
          kissOfDeath,
          filter(CheckOn.NtpStratum, FilterType.LessThanOrEqualTo, "2"),
        ),
      ).toBeNull();

      const result: string | null = await evaluate(
        kissOfDeath,
        filter(CheckOn.NtpStratum, FilterType.GreaterThan, "15"),
      );

      expect(result).toContain("16");
      expect(result).toContain("Stratum 0 (kiss-o'-death RATE).");
    });

    test("is not judged when the server did not answer", async () => {
      expect(
        await evaluate(
          silent("No NTP reply."),
          filter(CheckOn.NtpStratum, FilterType.GreaterThan, "0"),
        ),
      ).toBeNull();
    });

    test("a threshold that is not a number is not met", async () => {
      expect(
        await evaluate(
          answered({ stratum: 3 }),
          filter(CheckOn.NtpStratum, FilterType.GreaterThan, "high"),
        ),
      ).toBeNull();
    });
  });

  describe("NTP Clock Offset (in ms)", () => {
    test("a server behind the probe is judged by how far off it is", async () => {
      const result: string | null = await evaluate(
        answered({ clockOffsetInMs: -1500 }),
        filter(CheckOn.NtpClockOffset, FilterType.GreaterThanOrEqualTo, "1000"),
      );

      expect(result).toContain("1500");
      expect(result).toContain(
        "The server's clock is 1,500 ms behind the probe.",
      );
    });

    test("a server ahead of the probe says so", async () => {
      const result: string | null = await evaluate(
        answered({ clockOffsetInMs: 250.4 }),
        filter(CheckOn.NtpClockOffset, FilterType.GreaterThan, "100"),
      );

      expect(result).toContain(
        "The server's clock is 250 ms ahead of the probe.",
      );
    });

    test("a server within the bound does not match", async () => {
      expect(
        await evaluate(
          answered({ clockOffsetInMs: -3.5 }),
          filter(
            CheckOn.NtpClockOffset,
            FilterType.GreaterThanOrEqualTo,
            "1000",
          ),
        ),
      ).toBeNull();
    });

    test("Less Than matches a server within the bound, whichever way it is off", async () => {
      expect(
        await evaluate(
          answered({ clockOffsetInMs: -999 }),
          filter(CheckOn.NtpClockOffset, FilterType.LessThan, "1000"),
        ),
      ).not.toBeNull();
    });

    test("a decimal threshold is read as a decimal", async () => {
      // parseInt would read "0.5" as 0 and match every server.
      expect(
        await evaluate(
          answered({ clockOffsetInMs: 0.25 }),
          filter(CheckOn.NtpClockOffset, FilterType.GreaterThan, "0.5"),
        ),
      ).toBeNull();
      expect(
        await evaluate(
          answered({ clockOffsetInMs: 0.75 }),
          filter(CheckOn.NtpClockOffset, FilterType.GreaterThan, "0.5"),
        ),
      ).not.toBeNull();
    });

    test("is not judged when the server did not answer", async () => {
      expect(
        await evaluate(
          silent("No NTP reply."),
          filter(CheckOn.NtpClockOffset, FilterType.LessThan, "1000"),
        ),
      ).toBeNull();
    });

    test("a kiss-o'-death has no offset to judge", async () => {
      expect(
        await evaluate(
          answered({
            isSynchronized: false,
            stratum: 0,
            kissCode: "RATE",
            clockOffsetInMs: undefined,
          }),
          filter(CheckOn.NtpClockOffset, FilterType.LessThan, "1000"),
        ),
      ).toBeNull();
    });
  });

  describe("NTP Root Dispersion (in ms)", () => {
    test("compares the server's error estimate", async () => {
      const result: string | null = await evaluate(
        answered({ rootDispersionInMs: 8180.6 }),
        filter(CheckOn.NtpRootDispersion, FilterType.GreaterThan, "500"),
      );

      expect(result).toContain("8180.6");
    });

    test("a small dispersion does not match", async () => {
      expect(
        await evaluate(
          answered({ rootDispersionInMs: 3.25 }),
          filter(CheckOn.NtpRootDispersion, FilterType.GreaterThan, "500"),
        ),
      ).toBeNull();
    });

    test("is not judged when the server did not answer", async () => {
      expect(
        await evaluate(
          silent("No NTP reply."),
          filter(CheckOn.NtpRootDispersion, FilterType.LessThan, "500"),
        ),
      ).toBeNull();
    });
  });

  describe("NTP Response Time (in ms)", () => {
    test("compares the time from request to reply", async () => {
      const result: string | null = await evaluate(
        answered({ responseTimeInMs: 1500 }),
        filter(CheckOn.NtpResponseTime, FilterType.GreaterThan, "1000"),
      );

      expect(result).toContain("1500");
    });

    test("a fast reply does not match Greater Than", async () => {
      expect(
        await evaluate(
          answered({ responseTimeInMs: 18 }),
          filter(CheckOn.NtpResponseTime, FilterType.GreaterThan, "1000"),
        ),
      ).toBeNull();
    });

    test("a silent server's wait is not a response time", async () => {
      expect(
        await evaluate(
          silent("No NTP reply."),
          filter(CheckOn.NtpResponseTime, FilterType.GreaterThan, "0"),
          { responseTimeInMs: 5000 },
        ),
      ).toBeNull();
    });
  });

  describe("evaluate over time", () => {
    function mockOverTime(result: OverTimeCriteriaValue): void {
      jest
        .spyOn(EvaluateOverTime, "getOverTimeValueForCriteriaFilter")
        .mockResolvedValue(result);
    }

    function overTime(
      checkOn: CheckOn,
      filterType: FilterType,
      evaluateOverTimeType: EvaluateOverTimeType,
      value?: string | undefined,
    ): CriteriaFilter {
      return {
        checkOn,
        filterType,
        value,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 5,
          evaluateOverTimeType: evaluateOverTimeType,
        },
      };
    }

    test("judges the window's offsets instead of this check's", async () => {
      mockOverTime({ earlyReturn: null, value: [1200, 1300] });

      const result: string | null = await evaluate(
        answered({ clockOffsetInMs: 2 }),
        overTime(
          CheckOn.NtpClockOffset,
          FilterType.GreaterThan,
          EvaluateOverTimeType.AllValues,
          "1000",
        ),
      );

      expect(result).toContain("1200");
      // The window decided, so this check's own offset is not described.
      expect(result).not.toContain("ahead of the probe");
    });

    test("a window of offsets can judge a check the server did not answer", async () => {
      mockOverTime({ earlyReturn: null, value: [1200] });

      expect(
        await evaluate(
          silent("No NTP reply."),
          overTime(
            CheckOn.NtpClockOffset,
            FilterType.GreaterThan,
            EvaluateOverTimeType.AllValues,
            "1000",
          ),
        ),
      ).not.toBeNull();
    });

    test("judges the window of synchronized samples", async () => {
      mockOverTime({ earlyReturn: null, value: [false, false, false] });

      expect(
        await evaluate(
          answered(),
          overTime(
            CheckOn.NtpIsSynchronized,
            FilterType.False,
            EvaluateOverTimeType.AllValues,
          ),
        ),
      ).toContain("NTP Is Synchronized");
    });

    test("one synchronized sample in the window spoils All Values = False", async () => {
      mockOverTime({ earlyReturn: null, value: [false, true, false] });

      expect(
        await evaluate(
          answered({ isSynchronized: false }),
          overTime(
            CheckOn.NtpIsSynchronized,
            FilterType.False,
            EvaluateOverTimeType.AllValues,
          ),
        ),
      ).toBeNull();
    });

    test("the no-data policy's answer is returned as it is", async () => {
      mockOverTime({
        earlyReturn: {
          result: "NTP Stratum has no data over the last 5 minutes.",
        },
        value: undefined,
      });

      expect(
        await evaluate(
          answered({ stratum: 9 }),
          overTime(
            CheckOn.NtpStratum,
            FilterType.GreaterThan,
            EvaluateOverTimeType.MaximumValue,
            "2",
          ),
        ),
      ).toBe("NTP Stratum has no data over the last 5 minutes.");
    });

    test("a window that could not back the filter matches nothing", async () => {
      mockOverTime({ earlyReturn: { result: null }, value: undefined });

      expect(
        await evaluate(
          answered({ stratum: 9 }),
          overTime(
            CheckOn.NtpStratum,
            FilterType.GreaterThan,
            EvaluateOverTimeType.MaximumValue,
            "2",
          ),
        ),
      ).toBeNull();
    });

    test("passes the monitor's interval through to size the window", async () => {
      const spy: jest.SpiedFunction<
        typeof EvaluateOverTime.getOverTimeValueForCriteriaFilter
      > = jest
        .spyOn(EvaluateOverTime, "getOverTimeValueForCriteriaFilter")
        .mockResolvedValue({ earlyReturn: null, value: undefined });

      await NtpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: probeResponse(answered()),
        criteriaFilter: overTime(
          CheckOn.NtpRootDispersion,
          FilterType.GreaterThan,
          EvaluateOverTimeType.Average,
          "500",
        ),
        monitoringInterval: "*/5 * * * *",
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![0].monitoringInterval).toBe("*/5 * * * *");
    });
  });
});
