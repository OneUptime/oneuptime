/*
 * Only the engines' pure halves run here (no rule is loaded from Postgres
 * but through the stub below), so the DatabaseService module is a stub -
 * see MemberPatternsAtIngest for why it answers these calls.
 */
let storedScrubRules: Array<unknown> = [];

jest.mock("Common/Server/Services/DatabaseService", () => {
  return {
    __esModule: true,
    default: class DatabaseServiceStub {
      public hardDeleteItemsOlderThanInDays(): void {
        // no-op: retention config.
      }

      public setDoNotAllowDelete(): void {
        // no-op: delete-permission config.
      }

      public keepRowsOnDeleteByQuery(): void {
        // no-op: what a delete by query keeps.
      }

      public async findBy(): Promise<Array<unknown>> {
        return storedScrubRules;
      }
    },
  };
});

import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import LogDropFilterService, {
  LoadedLogDropFilter,
} from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService, {
  LoadedPipeline,
} from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import SessionReplayScrubService, {
  CompiledScrubRule,
  SessionReplayScrubResult,
} from "../../FeatureSet/Telemetry/Services/SessionReplayScrubService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import {
  CompiledFilter,
  compileFilter,
  evaluateCompiledFilter,
} from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import LogDropFilter from "Common/Models/DatabaseModels/LogDropFilter";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import PatternWorkScope from "Common/Server/Utils/PatternWorkScope";
import logger from "Common/Server/Utils/Logger";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import LogDropFilterAction from "Common/Types/Log/LogDropFilterAction";
import LogPipelineProcessorType from "Common/Types/Log/LogPipelineProcessorType";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import MetricPipelineRuleType from "Common/Types/Metrics/MetricPipelineRuleType";
import {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import ObjectID from "Common/Types/ObjectID";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import TraceScrubAction from "Common/Types/Trace/TraceScrubAction";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import LinearRegExp from "Common/Utils/LinearRegExp/LinearRegExp";
import { clearLinearRegExpCache } from "Common/Utils/LinearRegExp/PatternCache";
import {
  PatternWorkAllowance,
  TELEMETRY_BATCH_WORK,
} from "Common/Utils/LinearRegExp/PatternWork";
import { clearGrokCompileCache } from "Common/Utils/Grok/Grok";
import { fastestRun, FastestRun } from "Common/Tests/Helpers/FastestRun";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A PROJECT'S INGEST PATTERNS SHARE ONE ALLOWANCE FOR EACH BATCH.
 *
 * Custom scrub rules, LIKE filters, grok processors and metric regex filters
 * run over every record of every batch a project sends, on ingest every
 * project shares. Each question was bounded on its own; a batch asked one
 * per rule, field and record - and a project's rules could be written so
 * each took all its own limit allowed. Now the questions of one batch share
 * one allowance (Common/Utils/LinearRegExp/PatternWork.ts): a pool, and a
 * share for every record a step hands its patterns. Once it is spent, a
 * custom scrub rule scrubs the whole value - rather than store what it was
 * written to hide - a filter that cannot answer does not apply, a grok line
 * stays unparsed. Plain patterns, the ones real projects write, take a
 * small part of it and answer as they did.
 * ---------------------------------------------------------------------------
 */

// Written to need many steps per character on a's and b's.
const EXPLODING: string = "(?:[ab]*a[ab]{14}|[ab]{0,2000})Q";

function randomAb(length: number, seed: number): string {
  const random: SeededRandom = seededRandom(seed);
  let text: string = "";

  for (let index: number = 0; index < length; index++) {
    text += random(2) === 0 ? "a" : "b";
  }

  return text;
}

type GetRegexForPattern = (
  patternType: string,
  customRegex?: string,
) => ScrubRegExp | null;

interface LogRule {
  rule: LogScrubRule;
  regex: ScrubRegExp;
}

function logCustomRule(pattern: string, fields: string = "both"): LogRule {
  const rule: LogScrubRule = new LogScrubRule();
  rule.patternType = LogScrubPatternType.Custom;
  rule.customRegex = pattern;
  rule.scrubAction = LogScrubAction.Redact;
  rule.fieldsToScrub = fields;

  const regex: ScrubRegExp | null = (
    LogScrubRuleService as unknown as { getRegexForPattern: GetRegexForPattern }
  ).getRegexForPattern(LogScrubPatternType.Custom, pattern);

  expect(regex).not.toBeNull();

  return { rule: rule, regex: regex! };
}

// Runs work as one batch's handling, with this allowance.
function asBatch<T>(allowance: PatternWorkAllowance, work: () => T): T {
  return PatternWorkScope.run(allowance, work);
}

function spentAllowance(): PatternWorkAllowance {
  const allowance: PatternWorkAllowance = new PatternWorkAllowance({
    pool: 0,
  });

  allowance.charge(1);

  return allowance;
}

function logRecord(index: number, body: string): JSONObject {
  return {
    body: body,
    attributes: {
      "http.route": `/api/v1/orders/${index}`,
      "user.email": `user${index}@example.com`,
      token: `token=abc${index}`,
    },
  };
}

beforeEach(() => {
  clearLinearRegExpCache();
  clearGrokCompileCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("custom log scrub rules over a batch", () => {
  test("rules built to take all the work they may are stopped within the batch's allowance, and every value they could not read is scrubbed whole", () => {
    const rules: Array<LogRule> = [];

    for (let index: number = 0; index < 200; index++) {
      rules.push(logCustomRule(`${EXPLODING}${index}?`));
    }

    const bodies: Array<string> = [];

    for (let index: number = 0; index < 300; index++) {
      bodies.push(randomAb(2000, index));
    }

    const run: FastestRun<Array<JSONObject>> = fastestRun({
      run: (): Array<JSONObject> => {
        const allowance: PatternWorkAllowance =
          PatternWorkAllowance.forTelemetryBatch();

        return asBatch(allowance, (): Array<JSONObject> => {
          return bodies.map((body: string, index: number): JSONObject => {
            return LogScrubRuleService.scrubLog(
              logRecord(index, body),
              rules as never,
            );
          });
        });
      },
      limitInMs: 8000,
    });

    expect(run.inMs).toBeLessThan(8000);

    for (const row of run.result) {
      // Nothing of what the rules were written to hide is stored.
      expect(row["body"]).toBe("[REDACTED]");
    }
  });

  test("plain rules scrub exactly what they did without an allowance, and spend a small part of it", () => {
    const rules: Array<LogRule> = [
      logCustomRule("token=\\w+"),
      logCustomRule("\\b\\d{3}-\\d{2}-\\d{4}\\b"),
      logCustomRule("[a-z0-9.]+@example\\.com"),
      logCustomRule("(?<=password=)\\S+"),
      logCustomRule("Bearer [A-Za-z0-9._-]+"),
    ];

    for (let index: number = 0; index < 25; index++) {
      rules.push(logCustomRule(`secret-${index}-[0-9a-f]{8}`));
    }

    const records: Array<() => JSONObject> = [];

    for (let index: number = 0; index < 200; index++) {
      records.push((): JSONObject => {
        return logRecord(
          index,
          `login password=hunter${index} ssn 123-45-678${index % 10} secret-${index % 25}-0badc0de Bearer abc.${index}`,
        );
      });
    }

    const without: Array<JSONObject> = records.map(
      (record: () => JSONObject): JSONObject => {
        return LogScrubRuleService.scrubLog(record(), rules as never);
      },
    );
    const allowance: PatternWorkAllowance =
      PatternWorkAllowance.forTelemetryBatch();
    const within: Array<JSONObject> = asBatch(
      allowance,
      (): Array<JSONObject> => {
        return records.map((record: () => JSONObject): JSONObject => {
          return LogScrubRuleService.scrubLog(record(), rules as never);
        });
      },
    );

    expect(within).toEqual(without);
    expect(within[0]!["body"]).toBe(
      "login password=[REDACTED] ssn [REDACTED] [REDACTED] [REDACTED]",
    );
    expect(allowance.stoppedQuestions).toBe(0);
    expect(allowance.usedWork).toBeLessThan(allowance.allowedWork / 4);
  });

  test("each record handed to the rules adds its share: with no pool at all, plain rules still scrub every record", () => {
    const rules: Array<LogRule> = [
      logCustomRule("token=\\w+"),
      logCustomRule("[a-z0-9.]+@example\\.com"),
    ];
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 0,
      workPerRecordText: 2048,
      workPerRecordCharacter: 128,
    });
    const rows: Array<JSONObject> = asBatch(
      allowance,
      (): Array<JSONObject> => {
        const scrubbed: Array<JSONObject> = [];

        for (let index: number = 0; index < 500; index++) {
          scrubbed.push(
            LogScrubRuleService.scrubLog(
              logRecord(index, `login token=abc${index} ok`),
              rules as never,
            ),
          );
        }

        return scrubbed;
      },
    );

    for (const row of rows) {
      expect(row["body"]).toBe("login [REDACTED] ok");
    }

    expect(allowance.stoppedQuestions).toBe(0);
  });

  test("once the allowance is spent, a custom rule scrubs the whole value; a built-in rule is not one of the project's patterns", () => {
    const builtIn: LogScrubRule = new LogScrubRule();
    builtIn.patternType = LogScrubPatternType.Email;
    builtIn.scrubAction = LogScrubAction.Redact;
    builtIn.fieldsToScrub = "body";

    const builtInRegex: ScrubRegExp | null = (
      LogScrubRuleService as unknown as {
        getRegexForPattern: GetRegexForPattern;
      }
    ).getRegexForPattern(LogScrubPatternType.Email);

    const row: JSONObject = asBatch(spentAllowance(), (): JSONObject => {
      return LogScrubRuleService.scrubLog(
        {
          body: "mail ada@example.com about order 42",
          attributes: { note: "fine" },
        },
        [
          { rule: builtIn, regex: builtInRegex! },
          logCustomRule("order \\d+", "body"),
        ] as never,
      );
    });

    expect(row["body"]).toBe("[REDACTED]");
    // The custom rule scrubs the body only; the attribute is left alone.
    expect((row["attributes"] as JSONObject)["note"]).toBe("fine");
  });

  test("a project's rules keep handles, not compiled patterns: dropped from the matcher's cache, they are compiled again", async () => {
    const rule: LogScrubRule = new LogScrubRule();
    rule.patternType = LogScrubPatternType.Custom;
    rule.customRegex = "token=\\w+";
    rule.scrubAction = LogScrubAction.Redact;
    rule.fieldsToScrub = "both";
    rule.isEnabled = true;
    storedScrubRules = [rule];

    const projectId: ObjectID = ObjectID.generate();
    const loaded: Array<LogRule> = (await LogScrubRuleService.loadScrubRules(
      projectId,
    )) as unknown as Array<LogRule>;

    expect(loaded).toHaveLength(1);

    const kept: Array<unknown> = [];
    const seen: Set<unknown> = new Set<unknown>();
    const collect: (value: unknown, depth: number) => void = (
      value: unknown,
      depth: number,
    ): void => {
      if (value === null || typeof value !== "object" || seen.has(value)) {
        return;
      }

      seen.add(value);
      kept.push(value);

      if (depth < 3) {
        for (const child of Object.values(value as Record<string, unknown>)) {
          collect(child, depth + 1);
        }
      }
    };

    collect(loaded[0]!.regex, 0);

    for (const value of kept) {
      expect(value).not.toBeInstanceOf(LinearRegExp);
    }

    clearLinearRegExpCache();

    expect(
      LogScrubRuleService.scrubLog({ body: "a token=abc b" }, loaded as never)[
        "body"
      ],
    ).toBe("a [REDACTED] b");
  });
});

describe("custom trace scrub rules over a batch", () => {
  function traceRule(pattern: string): Array<{
    rule: TraceScrubRule;
    regex: ScrubRegExp;
  }> {
    const rule: TraceScrubRule = new TraceScrubRule();
    rule.patternType = TraceScrubPatternType.Custom;
    rule.customRegex = pattern;
    rule.scrubAction = TraceScrubAction.Redact;
    rule.fieldsToScrub = TraceScrubField.All;

    const regex: ScrubRegExp | null = (
      TraceScrubRuleService as unknown as {
        getRegexForPattern: GetRegexForPattern;
      }
    ).getRegexForPattern(TraceScrubPatternType.Custom, pattern);

    return [{ rule: rule, regex: regex! }];
  }

  test("once the allowance is spent, a span's name and attributes are scrubbed whole", () => {
    const span: JSONObject = asBatch(spentAllowance(), (): JSONObject => {
      return TraceScrubRuleService.scrubSpan(
        {
          name: "GET /orders/42",
          attributes: { "db.statement": "select * from orders where id = 42" },
        },
        traceRule("\\d+") as never,
      );
    });

    expect(span["name"]).toBe("[REDACTED]");
    expect((span["attributes"] as JSONObject)["db.statement"]).toBe(
      "[REDACTED]",
    );
  });

  test("while it holds, they scrub what they match, as before", () => {
    const allowance: PatternWorkAllowance =
      PatternWorkAllowance.forTelemetryBatch();
    const span: JSONObject = asBatch(allowance, (): JSONObject => {
      return TraceScrubRuleService.scrubSpan(
        { name: "GET /orders/42", attributes: { "user.id": "id 7" } },
        traceRule("\\d+") as never,
      );
    });

    expect(span["name"]).toBe("GET /orders/[REDACTED]");
    expect((span["attributes"] as JSONObject)["user.id"]).toBe("id [REDACTED]");
    expect(allowance.stoppedQuestions).toBe(0);
  });
});

describe("custom rules on a session replay", () => {
  function replayRule(pattern: string): CompiledScrubRule {
    const rule: LogScrubRule = new LogScrubRule();
    rule.patternType = LogScrubPatternType.Custom;
    rule.scrubAction = LogScrubAction.Redact;

    return { rule: rule, regex: logCustomRule(pattern).regex };
  }

  function events(texts: Array<string>): Array<JSONValue> {
    return [
      {
        type: 3,
        data: {
          source: 0,
          texts: texts.map((value: string, index: number) => {
            return { id: index, value: value };
          }),
        },
      },
    ];
  }

  function textsOf(scrubbed: Array<JSONValue>): Array<string> {
    const data: JSONObject = (scrubbed[0] as JSONObject)["data"] as JSONObject;

    return (data["texts"] as Array<JSONObject>).map(
      (text: JSONObject): string => {
        return text["value"] as string;
      },
    );
  }

  test("once the allowance is spent, every text is scrubbed whole, and the recording is still complete", async () => {
    const replay: Array<JSONValue> = events(["card 4111", "hello"]);
    const result: SessionReplayScrubResult = await PatternWorkScope.run(
      spentAllowance(),
      (): Promise<SessionReplayScrubResult> => {
        return SessionReplayScrubService.scrubEvents(replay, [
          replayRule("\\d{4}"),
        ]);
      },
    );

    expect(textsOf(replay)).toEqual(["[REDACTED]", "[REDACTED]"]);
    expect(result.isComplete).toBe(true);
  });

  test("a replay of many short texts with rules built to take all they may is stopped within its allowance", async () => {
    const texts: Array<string> = [];

    for (let index: number = 0; index < 20_000; index++) {
      texts.push(randomAb(40, index));
    }

    const rules: Array<CompiledScrubRule> = [];

    for (let index: number = 0; index < 50; index++) {
      rules.push(replayRule(`${EXPLODING}${index}?`));
    }

    const replay: Array<JSONValue> = events(texts);
    const startedAt: number = performance.now();

    await PatternWorkScope.run(
      PatternWorkAllowance.forTelemetryBatch(),
      (): Promise<SessionReplayScrubResult> => {
        return SessionReplayScrubService.scrubEvents(replay, rules);
      },
    );

    expect(performance.now() - startedAt).toBeLessThan(20_000);
  });

  test("while it holds, rules scrub what they match, as before", async () => {
    const replay: Array<JSONValue> = events(["card 4111", "hello"]);

    await PatternWorkScope.run(
      PatternWorkAllowance.forTelemetryBatch(),
      (): Promise<SessionReplayScrubResult> => {
        return SessionReplayScrubService.scrubEvents(replay, [
          replayRule("\\d{4}"),
        ]);
      },
    );

    expect(textsOf(replay)).toEqual(["card [REDACTED]", "hello"]);
  });
});

describe("LIKE filters", () => {
  function dropFilter(query: string): Array<LoadedLogDropFilter> {
    const filter: LogDropFilter = new LogDropFilter();
    filter.id = ObjectID.generate();
    filter.action = LogDropFilterAction.Drop;

    return [
      {
        filter: filter,
        compiledFilter: compileFilter(query, { emptyQueryMatches: false }),
        projectId: ObjectID.generate(),
      },
    ] as unknown as Array<LoadedLogDropFilter>;
  }

  test("a NOT LIKE the batch cannot answer does not hold: the record is kept, not dropped", () => {
    jest
      .spyOn(LogDropFilterService as never, "recordDrop" as never)
      .mockImplementation((() => {}) as never);

    const filters: Array<LoadedLogDropFilter> = dropFilter(
      "NOT body LIKE '%keep%me%'",
    );
    const record: JSONObject = { body: "an ordinary line" };

    // Answered, the line does not match the LIKE: NOT holds, and it is dropped.
    expect(LogDropFilterService.shouldDropLog(record, filters)).toBe(true);

    // With no answer, the filter does not apply.
    expect(
      asBatch(spentAllowance(), (): boolean => {
        return LogDropFilterService.shouldDropLog(record, filters);
      }),
    ).toBe(false);
  });

  test("a LIKE with no answer makes the whole filter not apply, whatever its other conditions say", () => {
    const filter: CompiledFilter = compileFilter(
      "severityText = 'Error' AND NOT body LIKE '%health%check%'",
    );
    const record: JSONObject = { body: "db timeout", severityText: "Error" };

    expect(evaluateCompiledFilter(record, filter)).toBe(true);
    expect(
      asBatch(spentAllowance(), (): boolean => {
        return evaluateCompiledFilter(record, filter);
      }),
    ).toBe(false);
  });

  test("a filter compiled while the allowance is spent is not kept as one that matches nothing", () => {
    const filter: CompiledFilter = asBatch(
      spentAllowance(),
      (): CompiledFilter => {
        return compileFilter("body LIKE '%conn%refused%'");
      },
    );

    expect(filter.kind).toBe("expr");
    // The next batch, with an allowance to spend, gets its answer.
    expect(
      evaluateCompiledFilter({ body: "Connection refused on 5432" }, filter),
    ).toBe(true);
  });

  test("filters without a % never ask a pattern, and answer while the allowance is spent", () => {
    const filter: CompiledFilter = compileFilter("body LIKE 'refused'");

    expect(
      asBatch(spentAllowance(), (): boolean => {
        return evaluateCompiledFilter({ body: "connection refused" }, filter);
      }),
    ).toBe(true);
  });
});

describe("grok processors", () => {
  function grokPipeline(pattern: string): Array<LoadedPipeline> {
    return [
      {
        pipeline: { name: "parse" },
        compiledFilter: compileFilter(""),
        processors: [
          {
            name: "grok",
            processorType: LogPipelineProcessorType.GrokParser,
            configuration: { pattern: pattern, source: "body" },
          },
        ],
      },
    ] as unknown as Array<LoadedPipeline>;
  }

  test("once the allowance is spent, the line stays unparsed, and the pattern is not reported as invalid", () => {
    const errors: Array<string> = [];

    jest.spyOn(logger, "error").mockImplementation((message: unknown) => {
      errors.push(String(message));
      return undefined as never;
    });

    const pipelines: Array<LoadedPipeline> = grokPipeline(
      "%{IPV4:client} %{WORD:method}",
    );
    const row: JSONObject = asBatch(spentAllowance(), (): JSONObject => {
      return LogPipelineService.processLog(
        { body: "10.0.0.1 GET", attributes: {} },
        pipelines,
      );
    });

    expect(row["attributes"]).toEqual({});
    expect(
      errors.filter((message: string): boolean => {
        return message.toLowerCase().includes("grok");
      }),
    ).toEqual([]);

    // The next batch parses the line: nothing was kept as a refusal.
    const parsed: JSONObject = asBatch(
      PatternWorkAllowance.forTelemetryBatch(),
      (): JSONObject => {
        return LogPipelineService.processLog(
          { body: "10.0.0.1 GET", attributes: {} },
          pipelines,
        );
      },
    );

    expect(parsed["attributes"]).toEqual({
      client: "10.0.0.1",
      method: "GET",
    });
  });
});

describe("metric pipeline regex filters", () => {
  function regexRule(
    conditionType: MetricPipelineRuleFilterConditionType,
    pattern: string,
  ): MetricRulesForProject {
    const rule: MetricPipelineRule = new MetricPipelineRule();
    rule.id = ObjectID.generate();
    rule.ruleType = MetricPipelineRuleType.Drop;
    rule.filters = [
      {
        checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
        conditionType: conditionType,
        value: pattern,
      },
    ];

    return { projectRules: [rule], rulesByServiceId: new Map() };
  }

  test.each([
    MetricPipelineRuleFilterConditionType.MatchesRegex,
    MetricPipelineRuleFilterConditionType.DoesNotMatchRegex,
  ])(
    "%s does not match when the batch cannot answer it: the drop rule keeps the row",
    (conditionType: MetricPipelineRuleFilterConditionType) => {
      MetricPipelineRuleService.clearCache();

      const kept: JSONObject | null = asBatch(
        spentAllowance(),
        (): JSONObject | null => {
          return MetricPipelineRuleService.applyRules(
            { name: "node_cpu_seconds", attributes: {}, attributeKeys: [] },
            undefined,
            regexRule(conditionType, "^node_"),
          );
        },
      );

      expect(kept).not.toBeNull();
    },
  );

  test("a pattern that is not compiled only because the allowance is spent is not warned about as invalid", () => {
    MetricPipelineRuleService.clearCache();

    const warnings: Array<string> = [];

    jest.spyOn(logger, "warn").mockImplementation((message: unknown) => {
      warnings.push(String(message));
      return undefined as never;
    });

    asBatch(spentAllowance(), (): JSONObject | null => {
      return MetricPipelineRuleService.applyRules(
        { name: "node_cpu_seconds", attributes: {}, attributeKeys: [] },
        undefined,
        regexRule(
          MetricPipelineRuleFilterConditionType.MatchesRegex,
          "^never_compiled_\\d+",
        ),
      );
    });

    expect(warnings).toEqual([]);
  });

  test("an invalid pattern of megabytes is warned about once, by its beginning only", () => {
    MetricPipelineRuleService.clearCache();

    const warnings: Array<string> = [];

    jest.spyOn(logger, "warn").mockImplementation((message: unknown) => {
      warnings.push(String(message));
      return undefined as never;
    });

    const huge: string = `(${"a".repeat(2_000_000)}`;

    for (let index: number = 0; index < 50; index++) {
      MetricPipelineRuleService.applyRules(
        { name: "node_cpu_seconds", attributes: {}, attributeKeys: [] },
        undefined,
        regexRule(MetricPipelineRuleFilterConditionType.MatchesRegex, huge),
      );
    }

    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.length).toBeLessThan(1500);
  });

  test("while it holds, filters answer as before", () => {
    MetricPipelineRuleService.clearCache();

    expect(
      asBatch(PatternWorkAllowance.forTelemetryBatch(), (): unknown => {
        return MetricPipelineRuleService.applyRules(
          { name: "node_cpu_seconds", attributes: {}, attributeKeys: [] },
          undefined,
          regexRule(
            MetricPipelineRuleFilterConditionType.MatchesRegex,
            "^node_(?!memory).*_seconds$",
          ),
        );
      }),
    ).toBeNull();
  });
});

describe("a batch handled by an ingest service", () => {
  test("runs with an allowance of its own, of a batch's size", async () => {
    const made: Array<PatternWorkAllowance> = [];
    const original: () => PatternWorkAllowance =
      PatternWorkAllowance.forTelemetryBatch;

    jest
      .spyOn(PatternWorkAllowance, "forTelemetryBatch")
      .mockImplementation((): PatternWorkAllowance => {
        const allowance: PatternWorkAllowance = original();
        made.push(allowance);
        return allowance;
      });
    jest.spyOn(logger, "warn").mockImplementation((() => {}) as never);

    await OtelLogsIngestService.processLogsFromQueue({ body: {} } as never);

    expect(made).toHaveLength(1);
    expect(made[0]!.allowedWork).toBe(TELEMETRY_BATCH_WORK);
  });
});
