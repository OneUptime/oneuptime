import PreviousCheckComparison, {
  PreviousCheckSource,
} from "../../../../../Server/Utils/Monitor/Criteria/PreviousCheckComparison";
import { CheckWindowJudgement } from "../../../../../Server/Utils/Monitor/Criteria/CheckWindowCounts";
import MetricService, {
  MonitorCheckAttributeFilter,
  MonitorPreviousCheckRow,
} from "../../../../../Server/Services/MetricService";
import MonitorMetricUtil from "../../../../../Server/Utils/Monitor/MonitorMetricUtil";
import GlobalConfigService from "../../../../../Server/Services/GlobalConfigService";
import TelemetryUtil from "../../../../../Server/Utils/Telemetry/Telemetry";
import DnsAnswerFingerprint, {
  DnsAnswerReading,
} from "../../../../../Server/Utils/Monitor/DnsAnswerFingerprint";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../../Types/Monitor/CriteriaFilter";
import {
  DNS_ANSWER_METRIC_NAME,
  DNS_ANSWER_TEXT_ATTRIBUTE,
} from "../../../../../Types/Monitor/DnsMonitor/DnsAnswer";
import DnsMonitorResponse from "../../../../../Types/Monitor/DnsMonitor/DnsMonitorResponse";
import DnsRecordType from "../../../../../Types/Monitor/DnsMonitor/DnsRecordType";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import { MONITOR_STEP_ID_ATTRIBUTE } from "../../../../../Types/Monitor/MonitorStepSeries";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import FilterCondition from "../../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import { decodedQueryParams } from "../../../../Helpers/StatementEcho";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A DNS ANSWER COMPARED WITH THE PREVIOUS CHECK'S (#10905).
 *
 * "Alert me when the DNS answer changes": DNS Record Value, Previous Check,
 * Not Equal To. These pin the filter's rules (only Previous Check, only Equal
 * To and Not Equal To), the row each check writes, the read of the previous
 * answer, and the judgement - changed, unchanged, reordered, no answer, no
 * previous check - with the database stubbed. DnsAnswerClickhouseIntegration
 * plays whole checks through a real ClickHouse.
 */

const WRITTEN_AT: Date = new Date("2026-11-24T12:00:05.300Z");
const MINUTE: number = 60 * 1000;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111110905",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222220905",
);
const STEP_ID: string = "33333333-3333-4333-8333-333333330905";
const PROBE_A: string = "44444444-4444-4444-8444-444444440905";
const PROBE_B: string = "55555555-5555-4555-8555-555555550905";

function dnsRecordValue(
  filterType: FilterType = FilterType.NotEqualTo,
  input: { minutes?: number; onNoDataPolicy?: NoDataPolicy } = {},
): CriteriaFilter {
  return {
    checkOn: CheckOn.DnsRecordValue,
    filterType: filterType,
    value: undefined,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: input.minutes ?? 5,
      evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
      ...(input.onNoDataPolicy ? { onNoDataPolicy: input.onNoDataPolicy } : {}),
    },
  };
}

function dnsResponse(
  values: Array<string>,
  isOnline: boolean = true,
): DnsMonitorResponse {
  return {
    isOnline: isOnline,
    responseTimeInMs: 12,
    failureCause: "",
    records: values.map((value: string) => {
      return { type: DnsRecordType.A, value: value, ttl: 300 };
    }),
  };
}

function reading(values: Array<string>): DnsAnswerReading {
  return DnsAnswerFingerprint.read(dnsResponse(values))!;
}

// The previous check's row, written `minutesAgo` before WRITTEN_AT.
function previousAnswer(input: {
  values: Array<string>;
  minutesAgo?: number;
  probeId?: string;
}): MonitorPreviousCheckRow {
  const answer: DnsAnswerReading = reading(input.values);

  return {
    group: { probeId: input.probeId ?? PROBE_A },
    value: answer.fingerprint,
    text: answer.text,
    at: new Date(WRITTEN_AT.getTime() - (input.minutesAgo ?? 1) * MINUTE),
  };
}

interface ReadAsked {
  metricName: string;
  windowStart: Date;
  before: Date;
  attributes: MonitorCheckAttributeFilter | undefined;
  groupByAttributeKeys: Array<string>;
  textAttributeKey: string | undefined;
}

let readsAsked: Array<ReadAsked> = [];

function stubPreviousChecks(rows: Array<MonitorPreviousCheckRow>): void {
  jest
    .spyOn(MetricService, "readPreviousMonitorChecks")
    .mockImplementation(
      async (data: {
        metricName: string;
        windowStart: Date;
        before: Date;
        attributes?: MonitorCheckAttributeFilter | undefined;
        groupByAttributeKeys: Array<string>;
        textAttributeKey?: string | undefined;
      }): Promise<Array<MonitorPreviousCheckRow>> => {
        readsAsked.push({
          metricName: data.metricName,
          windowStart: data.windowStart,
          before: data.before,
          attributes: data.attributes,
          groupByAttributeKeys: data.groupByAttributeKeys,
          textAttributeKey: data.textAttributeKey,
        });

        return rows.filter((previous: MonitorPreviousCheckRow): boolean => {
          return (
            previous.at.getTime() >= data.windowStart.getTime() &&
            previous.at.getTime() < data.before.getTime()
          );
        });
      },
    );
}

async function judge(input: {
  filter?: CriteriaFilter;
  thisAnswer: Array<string> | null;
  probeId?: string;
}): Promise<CheckWindowJudgement> {
  return await PreviousCheckComparison.judgeFilter({
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: STEP_ID,
    stepScope: { monitorStepId: STEP_ID, readsRowsWithoutStep: false },
    monitorType: MonitorType.DNS,
    probeId: input.probeId ?? PROBE_A,
    criteriaFilter: input.filter ?? dnsRecordValue(),
    checkWrittenAt: WRITTEN_AT,
    dnsAnswer: input.thisAnswer ? reading(input.thisAnswer) : null,
    isMetOnThisCheck: async (): Promise<boolean> => {
      throw new Error("A DNS answer is not judged as a yes or no check.");
    },
    judgeThisCheck: async (): Promise<string | null> => {
      throw new Error(
        "A DNS answer is not judged against a threshold made from the previous check.",
      );
    },
  });
}

beforeEach(() => {
  readsAsked = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the filter's rules", () => {
  test("DNS Record Value is offered a window whose only type is Previous Check", () => {
    expect(
      CriteriaFilterUtil.isEvaluateOverTimeFilter(
        CheckOn.DnsRecordValue,
        MonitorType.DNS,
      ),
    ).toBe(true);
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
        dnsRecordValue(),
        MonitorType.DNS,
      ),
    ).toEqual([EvaluateOverTimeType.PreviousCheck]);
  });

  test("it is never counted: no Count, Percentage or Status Changes of an answer", () => {
    expect(
      CriteriaFilterUtil.canCountChecks(
        CheckOn.DnsRecordValue,
        MonitorType.DNS,
      ),
    ).toBe(false);
    expect(CriteriaFilterUtil.canCountChecks(CheckOn.DnsRecordValue)).toBe(
      false,
    );

    for (const type of [
      EvaluateOverTimeType.Count,
      EvaluateOverTimeType.Percentage,
      EvaluateOverTimeType.StatusChanges,
    ]) {
      const filter: CriteriaFilter = {
        ...dnsRecordValue(),
        evaluateOverTimeOptions: {
          timeValueInMinutes: 5,
          evaluateOverTimeType: type,
        },
      };

      expect(
        CriteriaFilterUtil.isCountedOverChecks(filter, MonitorType.DNS),
      ).toBe(false);
      expect(
        CriteriaFilterUtil.isComparedWithPreviousCheck(filter, MonitorType.DNS),
      ).toBe(false);
    }
  });

  test("Previous Check on it is a comparison with the previous check, of a value: no value of its own is asked for", () => {
    expect(
      CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
        dnsRecordValue(),
        MonitorType.DNS,
      ),
    ).toBe(EvaluateOverTimeType.PreviousCheck);
    expect(
      CriteriaFilterUtil.isComparedWithPreviousCheck(
        dnsRecordValue(),
        MonitorType.DNS,
      ),
    ).toBe(true);
    expect(
      CriteriaFilterUtil.comparesValueWithPreviousCheck(
        dnsRecordValue(),
        MonitorType.DNS,
      ),
    ).toBe(true);
    // Not Equal To and Equal To take no change from the previous check.
    expect(
      CriteriaFilterUtil.isPreviousCheckChangeComparison(FilterType.NotEqualTo),
    ).toBe(false);
  });

  test("its conditions there are Not Equal To and Equal To; every other check keeps its own", () => {
    expect(
      CriteriaFilterUtil.getPreviousCheckFilterTypes(CheckOn.DnsRecordValue),
    ).toEqual([FilterType.NotEqualTo, FilterType.EqualTo]);

    for (const checkOn of [
      CheckOn.DnsResponseTime,
      CheckOn.DnsIsOnline,
      CheckOn.ResponseTime,
      CheckOn.ExpiresInDays,
    ]) {
      expect(
        CriteriaFilterUtil.getPreviousCheckFilterTypes(checkOn),
      ).toBeNull();
      expect(CriteriaFilterUtil.isComparedOnlyWithPreviousCheck(checkOn)).toBe(
        false,
      );
    }
  });

  test("the other DNS checks keep the windows they had", () => {
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
        { ...dnsRecordValue(), checkOn: CheckOn.DnsResponseTime },
        MonitorType.DNS,
      ),
    ).toContain(EvaluateOverTimeType.Average);
    expect(
      CriteriaFilterUtil.canCountChecks(
        CheckOn.DnsResponseTime,
        MonitorType.DNS,
      ),
    ).toBe(true);
  });
});

describe("the API's validation", () => {
  function criteriaWith(filter: CriteriaFilter): MonitorCriteriaInstance {
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    instance.data = {
      id: "answer-changed",
      monitorStatusId: undefined,
      filterCondition: FilterCondition.All,
      filters: [filter],
      incidents: [],
      alerts: [],
      name: "Answer changed",
      description: "",
    };
    return instance;
  }

  test("Not Equal To and Equal To are taken", () => {
    for (const filterType of [FilterType.NotEqualTo, FilterType.EqualTo]) {
      expect(
        MonitorCriteriaInstance.getValidationError(
          criteriaWith(dnsRecordValue(filterType)),
          MonitorType.DNS,
        ),
      ).toBeNull();
    }
  });

  test("any other condition is refused, in words that say what it takes", () => {
    for (const filterType of [
      FilterType.Contains,
      FilterType.NotContains,
      FilterType.StartsWith,
      FilterType.EndsWith,
      FilterType.GreaterThan,
    ]) {
      const error: string | null = MonitorCriteriaInstance.getValidationError(
        criteriaWith(dnsRecordValue(filterType)),
        MonitorType.DNS,
      );

      expect(error).toContain("DNS Record Value");
      expect(error).toContain("compares the whole DNS answer");
      expect(error).toContain("Not Equal To or Equal To");
      expect(error).toContain(`not ${filterType}`);
    }
  });

  test("it still needs a window: how long ago the previous check may be", () => {
    // With no minutes it is no comparison yet, so its value is asked for first.
    expect(
      MonitorCriteriaInstance.getValidationError(
        criteriaWith(dnsRecordValue(FilterType.NotEqualTo, { minutes: 0 })),
        MonitorType.DNS,
      ),
    ).toContain("Value is required");
    expect(
      MonitorCriteriaInstance.getValidationError(
        criteriaWith({
          ...dnsRecordValue(FilterType.NotEqualTo, { minutes: 0 }),
          value: "93.184.216.34",
        }),
        MonitorType.DNS,
      ),
    ).toContain("needs a window");
  });

  test("its value is not asked for, as no comparison with the previous check asks for one", () => {
    expect(
      MonitorCriteriaInstance.getValidationError(
        criteriaWith({ ...dnsRecordValue(), value: undefined }),
        MonitorType.DNS,
      ),
    ).toBeNull();
  });

  test("a DNS Record Value with no window keeps every condition it had, and needs its value", () => {
    const plain: CriteriaFilter = {
      checkOn: CheckOn.DnsRecordValue,
      filterType: FilterType.Contains,
      value: "93.184.216",
    };

    expect(
      MonitorCriteriaInstance.getValidationError(
        criteriaWith(plain),
        MonitorType.DNS,
      ),
    ).toBeNull();
    expect(
      MonitorCriteriaInstance.getValidationError(
        criteriaWith({ ...plain, value: undefined }),
        MonitorType.DNS,
      ),
    ).toContain("Value is required");
  });
});

describe("where the previous answer is read from", () => {
  test("the answers' series, of the step and the probe, with the answer itself", () => {
    const source: PreviousCheckSource | null =
      PreviousCheckComparison.getSource({
        criteriaFilter: dnsRecordValue(),
        monitorType: MonitorType.DNS,
        monitorStepId: STEP_ID,
        stepScope: { monitorStepId: STEP_ID, readsRowsWithoutStep: false },
      });

    expect(source).toEqual({
      metricName: DNS_ANSWER_METRIC_NAME,
      attributes: { [MONITOR_STEP_ID_ATTRIBUTE]: [STEP_ID] },
      groupByAttributeKeys: ["probeId"],
      isMatchHistory: false,
      condition: null,
      textAttributeKey: DNS_ANSWER_TEXT_ATTRIBUTE,
    });
  });

  test("on a monitor with one step, the rows written before rows named their step too", () => {
    expect(
      PreviousCheckComparison.getSource({
        criteriaFilter: dnsRecordValue(),
        monitorType: MonitorType.DNS,
        monitorStepId: STEP_ID,
        stepScope: { monitorStepId: STEP_ID, readsRowsWithoutStep: true },
      })?.attributes,
    ).toEqual({ [MONITOR_STEP_ID_ATTRIBUTE]: [STEP_ID, ""] });
  });

  test("the read asks for the step's answers of the window before this check, by probe, with their words", async () => {
    stubPreviousChecks([]);

    await judge({ thisAnswer: ["10.0.0.1"] });

    expect(readsAsked).toEqual([
      {
        metricName: DNS_ANSWER_METRIC_NAME,
        windowStart: new Date(WRITTEN_AT.getTime() - 5 * MINUTE),
        before: WRITTEN_AT,
        attributes: { [MONITOR_STEP_ID_ATTRIBUTE]: [STEP_ID] },
        groupByAttributeKeys: ["probeId"],
        textAttributeKey: DNS_ANSWER_TEXT_ATTRIBUTE,
      },
    ]);
  });
});

describe("the judgement", () => {
  test("a changed answer matches Not Equal To, and says what it was and what it is", async () => {
    stubPreviousChecks([
      previousAnswer({ values: ["93.184.216.34"], minutesAgo: 3 }),
    ]);

    const judged: CheckWindowJudgement = await judge({
      thisAnswer: ["10.6.6.6"],
    });

    expect(judged.rootCause).toBe(
      "The DNS answer is different from the previous check, 3 minutes ago: it was A 93.184.216.34, and is now A 10.6.6.6.",
    );
    expect(judged.message).toBe(judged.rootCause);
  });

  test("an unchanged answer does not match Not Equal To, and says so", async () => {
    stubPreviousChecks([previousAnswer({ values: ["93.184.216.34"] })]);

    const judged: CheckWindowJudgement = await judge({
      thisAnswer: ["93.184.216.34"],
    });

    expect(judged.rootCause).toBeNull();
    expect(judged.message).toBe(
      "The DNS answer is the same as on the previous check, 1 minute ago: A 93.184.216.34.",
    );
  });

  test("the same records in another order are no change", async () => {
    stubPreviousChecks([
      previousAnswer({ values: ["10.0.0.1", "10.0.0.2", "10.0.0.3"] }),
    ]);

    expect(
      (await judge({ thisAnswer: ["10.0.0.3", "10.0.0.1", "10.0.0.2"] }))
        .rootCause,
    ).toBeNull();
  });

  test("a record added, or one gone, is a change", async () => {
    stubPreviousChecks([previousAnswer({ values: ["10.0.0.1", "10.0.0.2"] })]);

    expect(
      (await judge({ thisAnswer: ["10.0.0.1", "10.0.0.2", "10.0.0.3"] }))
        .rootCause,
    ).toContain("is now A 10.0.0.1, A 10.0.0.2, A 10.0.0.3");
    expect((await judge({ thisAnswer: ["10.0.0.1"] })).rootCause).toContain(
      "it was A 10.0.0.1, A 10.0.0.2, and is now A 10.0.0.1.",
    );
  });

  test("Equal To matches the answer that did not change, and not one that did", async () => {
    stubPreviousChecks([previousAnswer({ values: ["10.0.0.1"] })]);

    expect(
      (
        await judge({
          filter: dnsRecordValue(FilterType.EqualTo),
          thisAnswer: ["10.0.0.1"],
        })
      ).rootCause,
    ).toBe(
      "The DNS answer is the same as on the previous check, 1 minute ago: A 10.0.0.1.",
    );
    expect(
      (
        await judge({
          filter: dnsRecordValue(FilterType.EqualTo),
          thisAnswer: ["10.0.0.9"],
        })
      ).rootCause,
    ).toBeNull();
  });

  test("a check that got no answer is not compared, whichever way it is asked", async () => {
    stubPreviousChecks([previousAnswer({ values: ["10.0.0.1"] })]);

    for (const filterType of [FilterType.NotEqualTo, FilterType.EqualTo]) {
      const judged: CheckWindowJudgement = await judge({
        filter: dnsRecordValue(filterType),
        thisAnswer: null,
      });

      expect(judged.rootCause).toBeNull();
      expect(judged.message).toBe(
        "This check got no DNS answer, so it was not compared with the previous one.",
      );
    }
  });

  test("each probe's answer is compared with its own previous answer", async () => {
    stubPreviousChecks([
      previousAnswer({ values: ["10.0.0.1"], probeId: PROBE_A }),
      previousAnswer({ values: ["10.9.9.9"], probeId: PROBE_B }),
    ]);

    // Geo DNS: each probe is answered with its own region's address.
    expect(
      (await judge({ thisAnswer: ["10.0.0.1"], probeId: PROBE_A })).rootCause,
    ).toBeNull();
    expect(
      (await judge({ thisAnswer: ["10.9.9.9"], probeId: PROBE_B })).rootCause,
    ).toBeNull();
    expect(
      (await judge({ thisAnswer: ["10.0.0.1"], probeId: PROBE_B })).rootCause,
    ).toContain("it was A 10.9.9.9, and is now A 10.0.0.1");
  });

  test("a previous answer older than the window is no previous check", async () => {
    stubPreviousChecks([
      previousAnswer({ values: ["10.0.0.1"], minutesAgo: 6 }),
    ]);

    const judged: CheckWindowJudgement = await judge({
      thisAnswer: ["10.0.0.2"],
    });

    expect(judged.rootCause).toBeNull();
    expect(judged.message).toBe(
      "The DNS answer has no previous check in the last 5 minutes to be compared with. This check's answer: A 10.0.0.2.",
    );
  });

  describe("with no previous check in the window, If No Data decides", () => {
    test("Ignore waits", async () => {
      stubPreviousChecks([]);

      expect(
        (
          await judge({
            filter: dnsRecordValue(FilterType.NotEqualTo, {
              onNoDataPolicy: NoDataPolicy.Ignore,
            }),
            thisAnswer: ["10.0.0.1"],
          })
        ).rootCause,
      ).toBeNull();
    });

    test("Trigger matches", async () => {
      stubPreviousChecks([]);

      expect(
        (
          await judge({
            filter: dnsRecordValue(FilterType.NotEqualTo, {
              onNoDataPolicy: NoDataPolicy.Trigger,
            }),
            thisAnswer: ["10.0.0.1"],
          })
        ).rootCause,
      ).toBe(
        "The DNS answer has no previous check in the last 5 minutes, and its If No Data setting is Trigger. This check's answer: A 10.0.0.1.",
      );
    });

    test("Treat As Zero reads no previous answer as a different one: Not Equal To matches, Equal To does not", async () => {
      stubPreviousChecks([]);

      const notEqual: CheckWindowJudgement = await judge({
        filter: dnsRecordValue(FilterType.NotEqualTo, {
          onNoDataPolicy: NoDataPolicy.TreatAsZero,
        }),
        thisAnswer: ["10.0.0.1"],
      });
      const equal: CheckWindowJudgement = await judge({
        filter: dnsRecordValue(FilterType.EqualTo, {
          onNoDataPolicy: NoDataPolicy.TreatAsZero,
        }),
        thisAnswer: ["10.0.0.1"],
      });

      expect(notEqual.rootCause).toContain(
        "which its If No Data setting (Treat As Zero) reads as a different answer",
      );
      expect(equal.rootCause).toBeNull();
      expect(equal.message).toBe(notEqual.message);
    });
  });

  test("a condition an answer does not take, sent through the API, is not judged", async () => {
    stubPreviousChecks([previousAnswer({ values: ["10.0.0.1"] })]);

    const judged: CheckWindowJudgement = await judge({
      filter: dnsRecordValue(FilterType.Contains),
      thisAnswer: ["10.0.0.2"],
    });

    expect(judged.rootCause).toBeNull();
    expect(judged.message).toContain(
      "Contains is neither, so it was not judged",
    );
  });

  test("a previous answer without its words still reads as a change", async () => {
    stubPreviousChecks([
      { ...previousAnswer({ values: ["10.0.0.1"] }), text: "" },
    ]);

    expect((await judge({ thisAnswer: ["10.0.0.2"] })).rootCause).toBe(
      "The DNS answer is different from the previous check, 1 minute ago: it was another answer, and is now A 10.0.0.2.",
    );
  });

  test("a read that fails is never a breach", async () => {
    jest
      .spyOn(MetricService, "readPreviousMonitorChecks")
      .mockRejectedValue(new Error("ClickHouse is down"));

    const judged: CheckWindowJudgement = await judge({
      thisAnswer: ["10.0.0.2"],
    });

    expect(judged.rootCause).toBeNull();
    expect(judged.message).toContain("could not be read");
  });
});

describe("the row each check writes", () => {
  let written: Array<JSONObject>;

  beforeEach(() => {
    written = [];
    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        written.push(...rows);
      });
    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockResolvedValue(undefined as never);
  });

  async function save(response: DnsMonitorResponse): Promise<void> {
    await MonitorMetricUtil.saveMonitorMetrics({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      dataToProcess: {
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        monitorStepId: new ObjectID(STEP_ID),
        probeId: new ObjectID(PROBE_A),
        isOnline: response.isOnline,
        responseTimeInMs: response.responseTimeInMs,
        failureCause: response.failureCause,
        dnsResponse: response,
        monitoredAt: WRITTEN_AT,
      } as ProbeMonitorResponse,
      probeName: "Oslo",
      monitorName: "example.com",
      monitorStepId: STEP_ID,
    });
  }

  function answerRows(): Array<JSONObject> {
    return written.filter((row: JSONObject): boolean => {
      return row["name"] === DNS_ANSWER_METRIC_NAME;
    });
  }

  test("an answer writes its fingerprint, named for its probe and step, and the answer in words", async () => {
    await save(dnsResponse(["93.184.216.35", "93.184.216.34"]));

    const rows: Array<JSONObject> = answerRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]!["value"]).toBe(
      reading(["93.184.216.34", "93.184.216.35"]).fingerprint,
    );
    expect(rows[0]!["metricPointType"]).toBe("Gauge");
    expect(rows[0]!["attributes"]).toMatchObject({
      probeId: PROBE_A,
      [MONITOR_STEP_ID_ATTRIBUTE]: STEP_ID,
      [DNS_ANSWER_TEXT_ATTRIBUTE]: "A 93.184.216.34, A 93.184.216.35",
      monitorId: MONITOR_ID.toString(),
    });
  });

  test("a check that got no answer writes none, and a check of another monitor type none either", async () => {
    await save(dnsResponse([], false));
    await save(dnsResponse([]));

    expect(answerRows()).toHaveLength(0);
  });

  test("the series is the evaluator's, not a metric anyone picks: it is never indexed", async () => {
    const indexed: Array<unknown> = [];

    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockImplementation((async (data: {
        metricNameServiceNameMap: Record<string, unknown>;
      }): Promise<void> => {
        indexed.push(...Object.keys(data.metricNameServiceNameMap));
      }) as never);

    await save(dnsResponse(["10.0.0.1"]));

    expect(answerRows()).toHaveLength(1);
    expect(indexed).not.toContain(DNS_ANSWER_METRIC_NAME);
  });
});

describe("the read of the previous answer", () => {
  test("reads the newest row's words with its value, of the same row", async () => {
    const statements: Array<Statement> = [];

    jest.spyOn(MetricService, "executeQuery").mockImplementation((async (
      statement: Statement,
    ): Promise<unknown> => {
      statements.push(statement);

      return {
        json: async (): Promise<{ data: Array<JSONObject> }> => {
          return {
            data: [
              {
                g0: PROBE_A,
                previousText: "A 10.0.0.1",
                previousValue: 123456789,
                previousAt: "2026-11-24 11:59:00.000000000",
              },
            ],
          };
        },
      };
    }) as never);

    const rows: Array<MonitorPreviousCheckRow> =
      await MetricService.readPreviousMonitorChecks({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        metricName: DNS_ANSWER_METRIC_NAME,
        windowStart: new Date(WRITTEN_AT.getTime() - 5 * MINUTE),
        before: WRITTEN_AT,
        attributes: { [MONITOR_STEP_ID_ATTRIBUTE]: [STEP_ID] },
        groupByAttributeKeys: ["probeId"],
        textAttributeKey: DNS_ANSWER_TEXT_ATTRIBUTE,
      });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      group: { probeId: PROBE_A },
      value: 123456789,
      text: "A 10.0.0.1",
    });

    const query: string = statements[0]!.query;

    expect(query).toMatch(
      /argMax\(attributes\[\{p\d+:String\}\], time\) AS previousText/,
    );
    expect(query).toContain(
      "argMax(assumeNotNull(value), time) AS previousValue",
    );
    expect(Object.values(decodedQueryParams(statements[0]!))).toContain(
      DNS_ANSWER_TEXT_ATTRIBUTE,
    );
  });

  test("a read that asks for no words reads none, as before", async () => {
    const statements: Array<Statement> = [];

    jest.spyOn(MetricService, "executeQuery").mockImplementation((async (
      statement: Statement,
    ): Promise<unknown> => {
      statements.push(statement);

      return {
        json: async (): Promise<{ data: Array<JSONObject> }> => {
          return {
            data: [
              {
                g0: PROBE_A,
                previousValue: 512,
                previousAt: "2026-11-24 11:59:00.000000000",
              },
            ],
          };
        },
      };
    }) as never);

    const rows: Array<MonitorPreviousCheckRow> =
      await MetricService.readPreviousMonitorChecks({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        metricName: "oneuptime.monitor.response.time",
        windowStart: new Date(WRITTEN_AT.getTime() - 5 * MINUTE),
        before: WRITTEN_AT,
        groupByAttributeKeys: ["probeId"],
      });

    expect(rows[0]).not.toHaveProperty("text");
    expect(statements[0]!.query).not.toContain("previousText");
  });
});
