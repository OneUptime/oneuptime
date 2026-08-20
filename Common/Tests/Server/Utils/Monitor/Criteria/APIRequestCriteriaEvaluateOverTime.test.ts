import APIRequestCriteria from "../../../../../Server/Utils/Monitor/Criteria/APIRequestCriteria";
import MetricService from "../../../../../Server/Services/MetricService";
import FindBy from "../../../../../Server/Types/AnalyticsDatabase/FindBy";
import Metric from "../../../../../Models/AnalyticsModels/Metric";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../../Types/Monitor/CriteriaFilter";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * End-to-end cover for the bug in
 * https://github.com/OneUptime/oneuptime/issues/2321: a criteria filter set
 * to look at "All Values over the last N minutes" fired on the first bad
 * probe instead of waiting for the window.
 *
 * These tests drive the real APIRequestCriteria evaluator and stub only the
 * metric read, so the window arithmetic, the coverage guard, the no-data
 * policy and the comparison message are all exercised together.
 */

const NOW: Date = new Date("2026-08-20T12:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

/** Once a minute, oldest first, ending at `now`. */
function everyMinute(values: Array<number>): Array<Metric> {
  return values.map((value: number, index: number) => {
    const metric: Metric = new Metric();
    metric.value = value;
    metric.time = new Date(
      NOW.getTime() - (values.length - 1 - index) * 60 * 1000,
    );
    return metric;
  });
}

function buildResponse(
  overrides: Partial<ProbeMonitorResponse> = {},
): ProbeMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    monitoredAt: NOW,
    isOnline: true,
    responseCode: 200,
    responseTimeInMs: 100,
    ...overrides,
  };
}

let windowSamples: Array<Metric> = [];

function evaluate(input: {
  criteriaFilter: CriteriaFilter;
  dataToProcess: ProbeMonitorResponse;
  monitoringInterval?: string | undefined;
}): Promise<string | null> {
  return APIRequestCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: input.dataToProcess,
    criteriaFilter: input.criteriaFilter,
    monitoringInterval: input.monitoringInterval ?? "* * * * *",
  });
}

describe("APIRequestCriteria evaluate over time", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    windowSamples = [];

    jest
      .spyOn(MetricService, "findBy")
      .mockImplementation((_findBy: FindBy<Metric>): Promise<Array<Metric>> => {
        return Promise.resolve(windowSamples);
      });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("the reported scenario: one bad status code in a healthy window", () => {
    const offlineCriteria: CriteriaFilter = {
      checkOn: CheckOn.ResponseStatusCode,
      filterType: FilterType.NotEqualTo,
      value: 200,
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 5,
        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
      },
    };

    test("does not fire when only the newest sample is bad", async () => {
      windowSamples = everyMinute([200, 200, 200, 200, 404]);

      const result: string | null = await evaluate({
        criteriaFilter: offlineCriteria,
        dataToProcess: buildResponse({ responseCode: 404 }),
      });

      expect(result).toBeNull();
    });

    /*
     * The heart of the bug. Nothing had been recorded yet, so the evaluator
     * used to compare the single status code that arrived with this check
     * and report it as "all values over the last 5 minutes".
     */
    test("does not fire when the window is empty", async () => {
      windowSamples = [];

      const result: string | null = await evaluate({
        criteriaFilter: offlineCriteria,
        dataToProcess: buildResponse({ responseCode: 404 }),
      });

      expect(result).toBeNull();
    });

    test("does not fire on a monitor that has only checked once", async () => {
      windowSamples = everyMinute([404]);

      const result: string | null = await evaluate({
        criteriaFilter: offlineCriteria,
        dataToProcess: buildResponse({ responseCode: 404 }),
      });

      expect(result).toBeNull();
    });

    test("does not fire two minutes into a five minute window", async () => {
      windowSamples = everyMinute([404, 404]);

      const result: string | null = await evaluate({
        criteriaFilter: offlineCriteria,
        dataToProcess: buildResponse({ responseCode: 404 }),
      });

      expect(result).toBeNull();
    });

    test("fires once the whole window has been bad", async () => {
      windowSamples = everyMinute([404, 404, 404, 404, 404]);

      const result: string | null = await evaluate({
        criteriaFilter: offlineCriteria,
        dataToProcess: buildResponse({ responseCode: 404 }),
      });

      expect(result).toContain("All values of");
      expect(result).toContain(CheckOn.ResponseStatusCode as string);
      expect(result).toContain("over the last 5 minutes");
      expect(result).toContain("not equal to 200");
    });

    /*
     * The recovery direction matters too: a single good sample inside an
     * otherwise bad window must clear the criteria.
     */
    test("stops firing as soon as one sample recovers", async () => {
      windowSamples = everyMinute([404, 404, 404, 404, 200]);

      const result: string | null = await evaluate({
        criteriaFilter: offlineCriteria,
        dataToProcess: buildResponse({ responseCode: 200 }),
      });

      expect(result).toBeNull();
    });
  });

  describe("the reported scenario: a single latency spike", () => {
    /*
     * From the second report on the issue - one 9171 ms tick inside a two
     * minute window of sub-second responses opened an incident that
     * auto-resolved 72 seconds later.
     */
    const slowCriteria: CriteriaFilter = {
      checkOn: CheckOn.ResponseTime,
      filterType: FilterType.GreaterThan,
      value: 8000,
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 2,
        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
      },
    };

    test("does not fire on a lone spike among healthy samples", async () => {
      windowSamples = everyMinute([397, 805, 9171]);

      const result: string | null = await evaluate({
        criteriaFilter: slowCriteria,
        dataToProcess: buildResponse({ responseTimeInMs: 9171 }),
      });

      expect(result).toBeNull();
    });

    test("fires when the whole window is slow", async () => {
      windowSamples = everyMinute([9171, 9002, 8800]);

      const result: string | null = await evaluate({
        criteriaFilter: slowCriteria,
        dataToProcess: buildResponse({ responseTimeInMs: 8800 }),
      });

      expect(result).toContain("All values of");
      expect(result).toContain("greater than 8000");
    });

    /*
     * "Any Value" is the setting for "tell me the moment one check
     * breaches", and it must keep behaving that way.
     */
    test("Any Value still fires on the lone spike", async () => {
      windowSamples = everyMinute([397, 805, 9171]);

      const result: string | null = await evaluate({
        criteriaFilter: {
          ...slowCriteria,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 2,
            evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
          },
        },
        dataToProcess: buildResponse({ responseTimeInMs: 9171 }),
      });

      expect(result).toContain("Any value of");
    });

    test("Any Value fires off the very first sample", async () => {
      windowSamples = everyMinute([9171]);

      const result: string | null = await evaluate({
        criteriaFilter: {
          ...slowCriteria,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 2,
            evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
          },
        },
        dataToProcess: buildResponse({ responseTimeInMs: 9171 }),
      });

      expect(result).not.toBeNull();
    });
  });

  describe("Is Online over time", () => {
    const offlineCriteria: CriteriaFilter = {
      checkOn: CheckOn.IsOnline,
      filterType: FilterType.False,
      value: undefined,
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 5,
        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
      },
    };

    test("fires only after the whole window has been offline", async () => {
      windowSamples = everyMinute([0, 0, 0, 0, 0]);

      const result: string | null = await evaluate({
        criteriaFilter: offlineCriteria,
        dataToProcess: buildResponse({ isOnline: false }),
      });

      expect(result).toContain(CheckOn.IsOnline as string);
    });

    test("does not fire on the first failed check", async () => {
      windowSamples = everyMinute([1, 1, 1, 1, 0]);

      const result: string | null = await evaluate({
        criteriaFilter: offlineCriteria,
        dataToProcess: buildResponse({ isOnline: false }),
      });

      expect(result).toBeNull();
    });

    test("does not fire while the window is still filling", async () => {
      windowSamples = everyMinute([0]);

      const result: string | null = await evaluate({
        criteriaFilter: offlineCriteria,
        dataToProcess: buildResponse({ isOnline: false }),
      });

      expect(result).toBeNull();
    });
  });

  describe("no-data policy", () => {
    const criteriaWith: (policy: NoDataPolicy) => CriteriaFilter = (
      policy: NoDataPolicy,
    ): CriteriaFilter => {
      return {
        checkOn: CheckOn.ResponseStatusCode,
        filterType: FilterType.NotEqualTo,
        value: 200,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 5,
          evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          onNoDataPolicy: policy,
        },
      };
    };

    test("Ignore keeps quiet when there is nothing to look at", async () => {
      windowSamples = [];

      const result: string | null = await evaluate({
        criteriaFilter: criteriaWith(NoDataPolicy.Ignore),
        dataToProcess: buildResponse({ responseCode: 404 }),
      });

      expect(result).toBeNull();
    });

    /*
     * For heartbeat-style checks the absence of data is itself the problem,
     * which is what Trigger is for.
     */
    test("Trigger reports the missing data as the root cause", async () => {
      windowSamples = [];

      const result: string | null = await evaluate({
        criteriaFilter: criteriaWith(NoDataPolicy.Trigger),
        dataToProcess: buildResponse({ responseCode: 200 }),
      });

      expect(result).toContain("no data");
      expect(result).toContain("5 minutes");
    });

    test("Treat As Zero compares the window as a single zero", async () => {
      windowSamples = [];

      const result: string | null = await evaluate({
        criteriaFilter: criteriaWith(NoDataPolicy.TreatAsZero),
        dataToProcess: buildResponse({ responseCode: 200 }),
      });

      // 0 is not equal to 200, so the filter is met.
      expect(result).toContain("not equal to 200");
    });
  });

  describe("monitors that are polled less often than the window", () => {
    /*
     * A monitor checked every five minutes can only ever put one sample into
     * a five minute window, so that sample IS the whole window. Requiring
     * more would mean it never fires at all.
     */
    test("a single sample covers the window at a five minute interval", async () => {
      windowSamples = everyMinute([404]);

      const result: string | null = await evaluate({
        criteriaFilter: {
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.NotEqualTo,
          value: 200,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
        },
        dataToProcess: buildResponse({ responseCode: 404 }),
        monitoringInterval: "*/5 * * * *",
      });

      expect(result).not.toBeNull();
    });
  });

  describe("attribute scoping", () => {
    /*
     * Only the disk-usage series carries a diskPath attribute. A stray
     * serverMonitorOptions left on a non-disk filter used to be harmless
     * because an empty window fell back to the live value; now it would
     * silence the filter, so it must not reach the query.
     */
    test("does not scope a response-time window by a stray disk path", async () => {
      windowSamples = everyMinute([9000, 9000, 9000]);

      const findBySpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        MetricService,
        "findBy",
      );

      const result: string | null = await evaluate({
        criteriaFilter: {
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
          value: 8000,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 2,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
          serverMonitorOptions: { diskPath: "/" },
        },
        dataToProcess: buildResponse({ responseTimeInMs: 9000 }),
      });

      const query: Record<string, unknown> = (
        findBySpy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;

      expect(query["attributes"]).toBeUndefined();
      expect(result).not.toBeNull();
    });
  });

  describe("filters that do not evaluate over time", () => {
    test("still compare the value that arrived with this check", async () => {
      windowSamples = [];

      const result: string | null = await evaluate({
        criteriaFilter: {
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.NotEqualTo,
          value: 200,
          evaluateOverTime: false,
        },
        dataToProcess: buildResponse({ responseCode: 404 }),
      });

      expect(result).toContain("not equal to 200");
    });

    test("the metric store is never read for them", async () => {
      const findBySpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        MetricService,
        "findBy",
      );

      await evaluate({
        criteriaFilter: {
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.NotEqualTo,
          value: 200,
          evaluateOverTime: false,
        },
        dataToProcess: buildResponse({ responseCode: 404 }),
      });

      expect(findBySpy).not.toHaveBeenCalled();
    });
  });

  describe("checks with no metric series of their own", () => {
    /*
     * Response Body is not recorded as a metric, so an over-time flag on it
     * cannot be honoured. It falls back to the body from this check rather
     * than silently never matching.
     */
    test("fall back to the value from this check", async () => {
      windowSamples = [];

      const result: string | null = await evaluate({
        criteriaFilter: {
          checkOn: CheckOn.ResponseBody,
          filterType: FilterType.Contains,
          value: "healthy",
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
        },
        dataToProcess: buildResponse({ responseBody: "all healthy here" }),
      });

      expect(result).toContain("Response body contains healthy");
    });
  });
});
