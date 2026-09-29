import APIRequestCriteria from "../../../../../Server/Utils/Monitor/Criteria/APIRequestCriteria";
import DatabaseMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/DatabaseMonitorCriteria";
import DnsMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/DnsMonitorCriteria";
import ExternalStatusPageMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/ExternalStatusPageMonitorCriteria";
import SnmpMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/SnmpMonitorCriteria";
import MetricService from "../../../../../Server/Services/MetricService";
import FindBy from "../../../../../Server/Types/AnalyticsDatabase/FindBy";
import Metric from "../../../../../Models/AnalyticsModels/Metric";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
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
 * End-to-end cover for true/false over-time filters saved with Average, Sum,
 * Maximum Value or Minimum Value.
 *
 * The dashboard offered those on DNS Is Online, SNMP Device Is Online and
 * External Status Page Is Online, and the API and Terraform accept them on
 * every true/false check. Reducing a 1/0 window handed the True / False
 * comparators a number such as 0.6, which matches neither, so the filter
 * never fired. Such a filter is now judged as All Values.
 *
 * These tests drive the real evaluators and stub only the metric read, so
 * the window, the comparison and the message are exercised together.
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

function buildResponse(isOnline: boolean): ProbeMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    monitoredAt: NOW,
    isOnline: isOnline,
    responseTimeInMs: 100,
  };
}

type EvaluatorInput = {
  dataToProcess: ProbeMonitorResponse;
  criteriaFilter: CriteriaFilter;
  monitoringInterval: string;
};

type Evaluator = (input: EvaluatorInput) => Promise<string | null>;

interface BooleanSeriesCase {
  checkOn: CheckOn;
  evaluator: Evaluator;
}

const CASES: Array<BooleanSeriesCase> = [
  {
    checkOn: CheckOn.IsOnline,
    evaluator: (input: EvaluatorInput): Promise<string | null> => {
      return APIRequestCriteria.isMonitorInstanceCriteriaFilterMet(input);
    },
  },
  {
    checkOn: CheckOn.DnsIsOnline,
    evaluator: (input: EvaluatorInput): Promise<string | null> => {
      return DnsMonitorCriteria.isMonitorInstanceCriteriaFilterMet(input);
    },
  },
  {
    checkOn: CheckOn.SnmpIsOnline,
    evaluator: (input: EvaluatorInput): Promise<string | null> => {
      return SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet(input);
    },
  },
  {
    checkOn: CheckOn.ExternalStatusPageIsOnline,
    evaluator: (input: EvaluatorInput): Promise<string | null> => {
      return ExternalStatusPageMonitorCriteria.isMonitorInstanceCriteriaFilterMet(
        input,
      );
    },
  },
  {
    checkOn: CheckOn.DatabaseIsOnline,
    evaluator: (input: EvaluatorInput): Promise<string | null> => {
      return DatabaseMonitorCriteria.isMonitorInstanceCriteriaFilterMet(input);
    },
  },
];

const AGGREGATE_TYPES: Array<EvaluateOverTimeType> = [
  EvaluateOverTimeType.Average,
  EvaluateOverTimeType.Sum,
  EvaluateOverTimeType.MaximumValue,
  EvaluateOverTimeType.MunimumValue,
];

let windowSamples: Array<Metric> = [];

describe("true/false filters evaluated over time", () => {
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

  describe.each(CASES)("$checkOn", (testCase: BooleanSeriesCase) => {
    function evaluate(input: {
      filterType: FilterType;
      evaluateOverTimeType: EvaluateOverTimeType;
      samples: Array<number>;
      isOnline: boolean;
    }): Promise<string | null> {
      windowSamples = everyMinute(input.samples);

      return testCase.evaluator({
        dataToProcess: buildResponse(input.isOnline),
        criteriaFilter: {
          checkOn: testCase.checkOn,
          filterType: input.filterType,
          value: undefined,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: input.evaluateOverTimeType,
          },
        },
        monitoringInterval: "* * * * *",
      });
    }

    test.each(AGGREGATE_TYPES)(
      "%s matches False when the whole window was offline",
      async (evaluateOverTimeType: EvaluateOverTimeType) => {
        const result: string | null = await evaluate({
          filterType: FilterType.False,
          evaluateOverTimeType: evaluateOverTimeType,
          samples: [0, 0, 0, 0, 0],
          isOnline: false,
        });

        expect(result).toBe(
          `All values of ${testCase.checkOn} over the last 5 minutes is false.`,
        );
      },
    );

    test.each(AGGREGATE_TYPES)(
      "%s matches True when the whole window was online",
      async (evaluateOverTimeType: EvaluateOverTimeType) => {
        const result: string | null = await evaluate({
          filterType: FilterType.True,
          evaluateOverTimeType: evaluateOverTimeType,
          samples: [1, 1, 1, 1, 1],
          isOnline: true,
        });

        expect(result).toBe(
          `All values of ${testCase.checkOn} over the last 5 minutes is true.`,
        );
      },
    );

    /*
     * The newest check is offline, so an instantaneous comparison or Any
     * Value would both match. All Values must not: the window started online.
     */
    test.each(AGGREGATE_TYPES)(
      "%s needs every sample to agree, like All Values",
      async (evaluateOverTimeType: EvaluateOverTimeType) => {
        const falseResult: string | null = await evaluate({
          filterType: FilterType.False,
          evaluateOverTimeType: evaluateOverTimeType,
          samples: [1, 0, 0, 0, 0],
          isOnline: false,
        });

        expect(falseResult).toBeNull();

        const trueResult: string | null = await evaluate({
          filterType: FilterType.True,
          evaluateOverTimeType: evaluateOverTimeType,
          samples: [1, 0, 0, 0, 0],
          isOnline: false,
        });

        expect(trueResult).toBeNull();
      },
    );

    test("All Values matches False when the whole window was offline", async () => {
      const result: string | null = await evaluate({
        filterType: FilterType.False,
        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
        samples: [0, 0, 0, 0, 0],
        isOnline: false,
      });

      expect(result).toBe(
        `All values of ${testCase.checkOn} over the last 5 minutes is false.`,
      );
    });

    test("Any Value matches False off a single offline sample", async () => {
      const result: string | null = await evaluate({
        filterType: FilterType.False,
        evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
        samples: [1, 1, 1, 1, 0],
        isOnline: false,
      });

      expect(result).toBe(
        `Any value of ${testCase.checkOn} over the last 5 minutes is false.`,
      );
    });
  });
});
