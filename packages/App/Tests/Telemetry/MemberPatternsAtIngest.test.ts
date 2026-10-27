/*
 * Only the engines' pure halves run here (no rule is loaded from Postgres),
 * so the DatabaseService module is a stub - see MetricPipelineRegexCompile
 * for why the stub answers these three calls.
 */
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
    },
  };
});

import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import SessionReplayScrubService, {
  CompiledScrubRule,
  SessionReplayScrubResult,
} from "../../FeatureSet/Telemetry/Services/SessionReplayScrubService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import {
  CompiledFilter,
  compileFilter,
  evaluateCompiledFilter,
} from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import { JSONObject, JSONValue } from "Common/Types/JSON";
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
import { describe, expect, jest, test } from "@jest/globals";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * PATTERNS A PROJECT WRITES, ON THE INGEST EVERY PROJECT SHARES.
 *
 * Custom scrub rules (logs, traces, session replays), metric pipeline regex
 * filters and LIKE filters (drop filters, pipelines, categories) are written
 * by a project's people and run over every record the project sends. They
 * ran on JavaScript's RegExp, so one pattern such as (a+)+$ and one long
 * record held the ingest worker for every project. Each now answers in time
 * in line with the record, through the engine's own code, with what it
 * answered before for every pattern that ran before; a pattern built to
 * need more steps than the record's length allows is stopped - a scrub rule
 * then scrubs the whole value, a filter does not match.
 *
 * PATTERN_TEXT_LENGTH shortens the records, so this suite can be run against
 * the old code and fail rather than never end.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = Number(process.env["PATTERN_TEXT_LENGTH"] || 100000);
const BUDGET_IN_MS: number = 2000;

const SLOW_RECORD: string = `${"a".repeat(LENGTH)}!`;
const SLOW_PATTERN: string = "(a+)+$";

// The work's result, once its fastest attempt (Tests/Helpers/FastestRun) is in budget.
function timed<T>(work: () => T): T {
  const run: FastestRun<T> = fastestRun({
    run: work,
    limitInMs: BUDGET_IN_MS,
  });

  expect(run.inMs).toBeLessThan(BUDGET_IN_MS);

  return run.result;
}

async function timedAsync<T>(work: () => Promise<T>): Promise<T> {
  const startedAt: number = Date.now();
  const result: T = await work();

  expect(Date.now() - startedAt).toBeLessThan(BUDGET_IN_MS);

  return result;
}

type GetRegexForPattern = (
  patternType: string,
  customRegex?: string,
) => ScrubRegExp | null;

function logCustomRule(pattern: string): Array<{
  rule: LogScrubRule;
  regex: ScrubRegExp;
}> {
  const rule: LogScrubRule = new LogScrubRule();
  rule.patternType = LogScrubPatternType.Custom;
  rule.customRegex = pattern;
  rule.scrubAction = LogScrubAction.Redact;
  rule.fieldsToScrub = "both";

  const regex: ScrubRegExp | null = (
    LogScrubRuleService as unknown as { getRegexForPattern: GetRegexForPattern }
  ).getRegexForPattern(LogScrubPatternType.Custom, pattern);

  expect(regex).not.toBeNull();

  return [{ rule: rule, regex: regex! }];
}

describe("a custom log scrub rule", () => {
  test("reads a long body with a pattern JavaScript never finishes on, quickly", () => {
    const row: JSONObject = timed((): JSONObject => {
      return LogScrubRuleService.scrubLog(
        { body: SLOW_RECORD, attributes: { note: SLOW_RECORD } },
        logCustomRule(SLOW_PATTERN) as never,
      );
    });

    // Nothing matched: the body is stored as it came.
    expect(row["body"]).toBe(SLOW_RECORD);
  });

  test("still scrubs what it matches, look-behind and all", () => {
    const row: JSONObject = LogScrubRuleService.scrubLog(
      {
        body: "login password=hunter2 user=ada token=abc123",
        attributes: { header: "Bearer xyz.987" },
      },
      [
        ...logCustomRule("(?<=password=)\\S+"),
        ...logCustomRule("\\btoken=\\w+"),
        ...logCustomRule("(?<=Bearer )\\S+"),
      ] as never,
    );

    expect(row["body"]).toBe("login password=[REDACTED] user=ada [REDACTED]");
    expect((row["attributes"] as JSONObject)["header"]).toBe(
      "Bearer [REDACTED]",
    );
  });

  test("scrubs the whole value when finding every match would read it over and over", () => {
    const body: string = "a".repeat(LENGTH);
    const row: JSONObject = timed((): JSONObject => {
      return LogScrubRuleService.scrubLog(
        { body: body },
        logCustomRule("(?:a.*c|a)") as never,
      );
    });

    /*
     * Every "a" is a match, but each costs a read to the end of the body: on
     * a long body the rule stops and scrubs all of it.
     */
    if (LENGTH >= 100000) {
      expect(row["body"]).toBe("[REDACTED]");
    }
  });
});

describe("a custom trace scrub rule", () => {
  test("reads a long span name and attribute with a pattern JavaScript never finishes on, quickly", () => {
    const rule: TraceScrubRule = new TraceScrubRule();
    rule.patternType = TraceScrubPatternType.Custom;
    rule.customRegex = SLOW_PATTERN;
    rule.scrubAction = TraceScrubAction.Redact;
    rule.fieldsToScrub = TraceScrubField.All;

    const regex: ScrubRegExp | null = (
      TraceScrubRuleService as unknown as {
        getRegexForPattern: GetRegexForPattern;
      }
    ).getRegexForPattern(TraceScrubPatternType.Custom, SLOW_PATTERN);

    const span: JSONObject = timed((): JSONObject => {
      return TraceScrubRuleService.scrubSpan(
        { name: SLOW_RECORD, attributes: { query: SLOW_RECORD } },
        [{ rule: rule, regex: regex! }] as never,
      );
    });

    expect(span["name"]).toBe(SLOW_RECORD);
  });
});

describe("a custom rule on a session replay", () => {
  test("reads a long text node with a pattern JavaScript never finishes on, quickly", async () => {
    const rule: LogScrubRule = new LogScrubRule();
    rule.patternType = LogScrubPatternType.Custom;
    rule.scrubAction = LogScrubAction.Redact;

    const compiled: CompiledScrubRule = {
      rule: rule,
      regex: logCustomRule(SLOW_PATTERN)[0]!.regex,
    };
    const text: string = `${"a".repeat(Math.min(LENGTH, 60000))}!`;
    const events: Array<JSONValue> = [
      { type: 3, data: { source: 0, texts: [{ id: 1, value: text }] } },
    ];

    const result: SessionReplayScrubResult = await timedAsync(
      (): Promise<SessionReplayScrubResult> => {
        return SessionReplayScrubService.scrubEvents(events, [compiled]);
      },
    );

    expect(result.isComplete).toBe(true);
    expect(result.stringsScrubbed).toBe(0);
  });
});

describe("a metric pipeline regex filter", () => {
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

  test("reads a long metric name with a pattern JavaScript never finishes on, quickly", () => {
    MetricPipelineRuleService.clearCache();

    const kept: JSONObject | null = timed((): JSONObject | null => {
      return MetricPipelineRuleService.applyRules(
        { name: SLOW_RECORD, attributes: {}, attributeKeys: [] },
        undefined,
        regexRule(
          MetricPipelineRuleFilterConditionType.MatchesRegex,
          SLOW_PATTERN,
        ),
      );
    });

    // No match, so the drop rule keeps the row.
    expect(kept).not.toBeNull();
  });

  test("still drops what its pattern matches", () => {
    MetricPipelineRuleService.clearCache();

    expect(
      MetricPipelineRuleService.applyRules(
        { name: "node_cpu_seconds", attributes: {}, attributeKeys: [] },
        undefined,
        regexRule(
          MetricPipelineRuleFilterConditionType.MatchesRegex,
          "^node_(?!memory).*_seconds$",
        ),
      ),
    ).toBeNull();
  });
});

describe("a LIKE filter", () => {
  /*
   * Each % is a run of anything; JavaScript's RegExp took time that grew
   * with the record's length to the power of the number of runs.
   */
  const MANY_RUNS: string = "body LIKE '%a%a%a%a%a%a%a%a%a%a%a%a%b'";

  test("reads a long body with a dozen runs, quickly, and does not match", () => {
    const filter: CompiledFilter = compileFilter(MANY_RUNS);

    expect(
      timed((): boolean => {
        return evaluateCompiledFilter({ body: "a".repeat(LENGTH) }, filter);
      }),
    ).toBe(false);
  });

  test("matches as it did: case-insensitive, % any run, _ one character", () => {
    const filter: CompiledFilter = compileFilter(
      "body LIKE '%connection _efused%port%'",
    );

    expect(
      evaluateCompiledFilter(
        { body: "ERROR Connection refused on port 5432" },
        filter,
      ),
    ).toBe(true);
    expect(
      evaluateCompiledFilter({ body: "Connection reset on port 5432" }, filter),
    ).toBe(false);
  });
});
