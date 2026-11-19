/** @timezone UTC */
/*
 * THE BENCHMARK'S SCENARIOS HOLD TOGETHER (issue #6800).
 *
 * A scenario is made up end to end, so nothing but these tests says it is
 * one a real investigation could have: every tool it scripts is one the
 * model is offered, every argument it waits for is one that tool takes,
 * every response can be reached, the cause has evidence to cite, the
 * starting context reads as the investigation runner writes it, and the
 * words the scorer looks for name the planted cause and nothing else.
 * Each rule is one describe, checked for every scenario, against the real
 * toolbox and the real context builders - never a copy of them.
 *
 * The process runs in UTC (the docblock above), as OneUptime's servers do:
 * the incident's "Declared at" line is written in the server's zone.
 */
import AIToolbox from "../../../../../../Server/Utils/AI/Toolbox/Index";
import { LOOKBACK_MINUTES as CONTAINER_LOOKBACK_MINUTES } from "../../../../../../Server/Utils/AI/Toolbox/ContainerTools";
import {
  COMPLIANCE_NOTE,
  DEPLOYMENT_GATE_NOTE,
} from "../../../../../../Server/Utils/AI/Toolbox/SloTools";
import AIIncidentInvestigationRunner from "../../../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIAlertInvestigationRunner from "../../../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import RecentChangesContext, {
  CHANGE_LOOKAHEAD_MINUTES,
  CHANGE_LOOKBACK_MINUTES,
  ChangeRelation,
  RecentChange,
} from "../../../../../../Server/Utils/AI/SRE/RecentChangesContext";
import InvestigationImpactContext, {
  ImpactSlo,
  MAX_IMPACT_SLOS,
} from "../../../../../../Server/Utils/AI/SRE/InvestigationImpactContext";
import SloUtil from "../../../../../../Utils/Slo/SloUtil";
import { DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE } from "../../../../../../Utils/Slo/SloHealth";
import SloStatus from "../../../../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../../../../Types/ServiceLevelObjective/SloWindowType";
import {
  ChangeImpact,
  ChangeImpactVerdict,
  ChangeWindowStats,
  NewExceptionType,
  assessChangeImpact,
} from "../../../../../../Server/Utils/AI/SRE/ChangeImpact";
import BENCHMARK_SCENARIOS from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkScenarios";
import {
  BenchmarkExpectationKind,
  BenchmarkFaultKind,
  BenchmarkScenario,
  BenchmarkSubjectKind,
  BenchmarkToolResponse,
  getScenarioExpectationKind,
  getScenarioSubjectKind,
} from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkScenario";
import BenchmarkScorer, {
  INCONCLUSIVE_WORDS,
} from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkScorer";
import {
  getMissingSloRecommendedBurnRateRules,
  getSloRecommendedBurnRateRules,
  SloRecommendedBurnRateRule,
} from "../../../../../../Utils/Slo/SloRecommendedBurnRateRules";
import InvestigationBenchmark, {
  BENCHMARK_EXCLUDED_TOOL_NAMES,
} from "../../../../../../Server/Utils/AI/Eval/Benchmark/InvestigationBenchmark";
import ScenarioTools from "../../../../../../Server/Utils/AI/Eval/Benchmark/ScenarioTools";
import { LLMToolDefinition } from "../../../../../../Server/Utils/LLM/LLMService";
import Alert from "../../../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../../../../Models/DatabaseModels/AlertState";
import Incident from "../../../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../../../Models/DatabaseModels/IncidentState";
import Label from "../../../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../../../Models/DatabaseModels/Monitor";
import AIChatPermissionMode from "../../../../../../Types/AI/AIChatPermissionMode";
import OneUptimeDate from "../../../../../../Types/Date";
import { JSONObject, JSONValue } from "../../../../../../Types/JSON";
import ObjectID from "../../../../../../Types/ObjectID";
import {
  ChangeEventFields,
  ChangeEventSource,
  describeChangeEventSource,
} from "../../../../../../Utils/Telemetry/ChangeEventFields";
import { describe, expect, test } from "@jest/globals";

type ScenarioCase = [string, BenchmarkScenario];

const SCENARIO_CASES: Array<ScenarioCase> = BENCHMARK_SCENARIOS.map(
  (scenario: BenchmarkScenario): ScenarioCase => {
    return [scenario.id, scenario];
  },
);

// The tools the loop offers an investigation: the read-only toolbox, less the excluded.
const OFFERED_TOOLS: Map<string, LLMToolDefinition> = new Map(
  AIToolbox.getLlmToolDefinitions(AIChatPermissionMode.ReadOnly)
    .filter((definition: LLMToolDefinition): boolean => {
      return !BENCHMARK_EXCLUDED_TOOL_NAMES.includes(definition.name);
    })
    .map((definition: LLMToolDefinition): [string, LLMToolDefinition] => {
      return [definition.name, definition];
    }),
);

const ISO_TIME: RegExp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g;

/*
 * Words an investigation report often uses that hold a shorter word with
 * another meaning. A cause's word hidden in one of them is "named" by an
 * answer that never names it: "cert" in "uncertain", "down" in
 * "downstream", "bot" in "bottleneck".
 */
const WORDS_THAT_HIDE_OTHERS: Array<string> = [
  "about",
  "another",
  "bottleneck",
  "breakdown",
  "certain",
  "certainly",
  "collapsed",
  "concern",
  "dashboard",
  "database",
  "downstream",
  "elapsed",
  "however",
  "internal",
  "interval",
  "rollout",
  "shutdown",
  "slowdown",
  "throughput",
  "timeout",
  "together",
  "uncertain",
  "upstream",
  "workaround",
];

function describeResponse(response: BenchmarkToolResponse): string {
  return `${response.toolName} ${JSON.stringify(response.whenArguments || {})} (${
    response.citationLabel || "no label"
  })`;
}

function rowsOf(
  scenario: BenchmarkScenario,
  toolName: string,
): Array<JSONObject> {
  return scenario.responses
    .filter((response: BenchmarkToolResponse): boolean => {
      return response.toolName === toolName;
    })
    .flatMap((response: BenchmarkToolResponse): Array<JSONObject> => {
      return response.rows || [];
    });
}

function valuesOf(rows: Array<JSONObject>, key: string): Array<string> {
  return rows
    .map((row: JSONObject): JSONValue | undefined => {
      return row[key];
    })
    .filter((value: JSONValue | undefined): value is string => {
      return typeof value === "string";
    });
}

// Everything a scenario hands the model: its context and every response.
function textsOf(scenario: BenchmarkScenario): Array<[string, string]> {
  return [
    ["the context", scenario.contextText],
    ...scenario.responses.map(
      (response: BenchmarkToolResponse): [string, string] => {
        return [
          describeResponse(response),
          `${JSON.stringify(response.rows || [])}\n${response.text || ""}`,
        ];
      },
    ),
  ];
}

describe("every scenario has its own id and title", () => {
  test("ids are unique and kebab-case", () => {
    const ids: Array<string> = BENCHMARK_SCENARIOS.map(
      (scenario: BenchmarkScenario): string => {
        return scenario.id;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);

    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  test("titles are unique", () => {
    const titles: Array<string> = BENCHMARK_SCENARIOS.map(
      (scenario: BenchmarkScenario): string => {
        return scenario.title.trim().toLowerCase();
      },
    );

    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("every scenario's fault is one of the benchmark's kinds", () => {
  test.each(SCENARIO_CASES)(
    "%s",
    (_id: string, scenario: BenchmarkScenario) => {
      expect(Object.values(BenchmarkFaultKind)).toContain(scenario.faultKind);
      expect(scenario.plantedFault.trim()).not.toBe("");
    },
  );
});

describe("every scripted tool is one the investigation is offered", () => {
  test("the offered tools are the toolbox's read-only ones, less the two a live investigation keeps", () => {
    expect(OFFERED_TOOLS.size).toBeGreaterThan(10);
    expect(OFFERED_TOOLS.has("get_ai_investigation")).toBe(false);
    expect(OFFERED_TOOLS.has("start_investigation")).toBe(false);
  });

  test.each(SCENARIO_CASES)(
    "%s",
    (_id: string, scenario: BenchmarkScenario) => {
      const notOffered: Array<string> = scenario.responses
        .filter((response: BenchmarkToolResponse): boolean => {
          return !OFFERED_TOOLS.has(response.toolName);
        })
        .map(describeResponse);

      expect(notOffered).toEqual([]);
    },
  );
});

describe("every argument a response waits for is one its tool takes", () => {
  test.each(SCENARIO_CASES)(
    "%s",
    (_id: string, scenario: BenchmarkScenario) => {
      const problems: Array<string> = [];

      for (const response of scenario.responses) {
        const properties: JSONObject =
          (OFFERED_TOOLS.get(response.toolName)?.inputSchema[
            "properties"
          ] as JSONObject) || {};

        for (const [argumentName, value] of Object.entries(
          response.whenArguments || {},
        )) {
          const property: JSONObject | undefined = properties[argumentName] as
            | JSONObject
            | undefined;

          if (!property) {
            problems.push(
              `${describeResponse(response)}: ${response.toolName} takes no "${argumentName}"`,
            );
            continue;
          }

          // A value an enum never holds is one no valid call can carry.
          const allowed: Array<JSONValue> | undefined = (property["enum"] ||
            (property["items"] as JSONObject | undefined)?.["enum"]) as
            | Array<JSONValue>
            | undefined;

          if (
            allowed &&
            !allowed.some((candidate: JSONValue): boolean => {
              return String(candidate)
                .toLowerCase()
                .includes(value.toLowerCase());
            })
          ) {
            problems.push(
              `${describeResponse(response)}: "${value}" is none of ${JSON.stringify(allowed)}`,
            );
          }
        }
      }

      expect(problems).toEqual([]);
    },
  );
});

/*
 * The first response that matches answers, so a response is reached
 * exactly when a call carrying just its own arguments reaches it: an
 * earlier response that catches that call (one waiting for nothing, or
 * for a part of the same values) catches every call it would match.
 */
describe("every response can be reached", () => {
  test.each(SCENARIO_CASES)(
    "%s",
    (_id: string, scenario: BenchmarkScenario) => {
      const unreachable: Array<string> = [];

      for (const response of scenario.responses) {
        const answeredBy: BenchmarkToolResponse | null =
          ScenarioTools.findResponse(
            scenario,
            response.toolName,
            response.whenArguments || {},
          );

        if (answeredBy !== response) {
          unreachable.push(
            `${describeResponse(response)} is shadowed by ${
              answeredBy ? describeResponse(answeredBy) : "nothing"
            }`,
          );
        }
      }

      expect(unreachable).toEqual([]);
    },
  );
});

describe("every response has its own citation label", () => {
  test.each(SCENARIO_CASES)(
    "%s",
    (_id: string, scenario: BenchmarkScenario) => {
      const labels: Array<string> = scenario.responses.map(
        (response: BenchmarkToolResponse): string => {
          return (response.citationLabel || "").trim();
        },
      );

      expect(labels).not.toContain("");
      expect(new Set(labels).size).toBe(labels.length);
    },
  );
});

describe("the cause has evidence to cite", () => {
  test.each(SCENARIO_CASES)(
    "%s",
    (_id: string, scenario: BenchmarkScenario) => {
      const keyResponses: Array<BenchmarkToolResponse> =
        scenario.responses.filter(
          (response: BenchmarkToolResponse): boolean => {
            return response.isKeyEvidence === true;
          },
        );

      expect(keyResponses.length).toBeGreaterThanOrEqual(2);
      // ...and somewhere wrong to look: evidence that is not the fault's.
      expect(keyResponses.length).toBeLessThan(scenario.responses.length);
    },
  );
});

describe("every service a response waits for is one the model can look up", () => {
  test.each(SCENARIO_CASES)(
    "%s",
    (_id: string, scenario: BenchmarkScenario) => {
      const listed: Set<string> = new Set(
        valuesOf(rowsOf(scenario, "lookup_context"), "serviceId"),
      );
      const unlisted: Array<string> = scenario.responses
        .filter((response: BenchmarkToolResponse): boolean => {
          const serviceId: string | undefined =
            response.whenArguments?.["serviceId"];

          return serviceId !== undefined && !listed.has(serviceId);
        })
        .map(describeResponse);

      expect(listed.size).toBeGreaterThan(0);
      expect(unlisted).toEqual([]);
    },
  );
});

describe("every change the model is shown can be opened", () => {
  test.each(SCENARIO_CASES)(
    "%s",
    (_id: string, scenario: BenchmarkScenario) => {
      const fromContext: Array<string> = Array.from(
        scenario.contextText.matchAll(/\[changeId: ([^\]]+)\]/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] || "";
      });
      const fromTool: Array<string> = valuesOf(
        rowsOf(scenario, "recent_changes"),
        "changeId",
      );
      const problems: Array<string> = [];

      for (const changeId of fromContext) {
        if (!fromTool.includes(changeId)) {
          problems.push(
            `${changeId}: in the context, not listed by recent_changes`,
          );
        }
      }

      for (const changeId of new Set([...fromContext, ...fromTool])) {
        const details: BenchmarkToolResponse | null =
          ScenarioTools.findResponse(scenario, "get_change_details", {
            changeId,
          });

        if (!details?.text?.includes(changeId)) {
          problems.push(`${changeId}: get_change_details has no details of it`);
        }
      }

      expect(fromContext.length).toBeGreaterThan(0);
      expect(problems).toEqual([]);
    },
  );
});

describe("every trace a row points at can be opened", () => {
  test.each(SCENARIO_CASES)(
    "%s",
    (_id: string, scenario: BenchmarkScenario) => {
      const traceIds: Set<string> = new Set(
        scenario.responses.flatMap(
          (response: BenchmarkToolResponse): Array<string> => {
            return valuesOf(response.rows || [], "traceId");
          },
        ),
      );
      const unopened: Array<string> = Array.from(traceIds).filter(
        (traceId: string): boolean => {
          return !ScenarioTools.findResponse(scenario, "get_trace", { traceId })
            ?.text;
        },
      );

      expect(unopened).toEqual([]);
    },
  );
});

describe("every scenario's clock holds together", () => {
  test.each(SCENARIO_CASES)(
    "%s: declared at an ISO 8601 time, and asked minutesSinceDeclared after it",
    (_id: string, scenario: BenchmarkScenario) => {
      expect(new Date(scenario.declaredAt).toISOString()).toBe(
        scenario.declaredAt,
      );
      expect(Number.isInteger(scenario.minutesSinceDeclared)).toBe(true);
      expect(scenario.minutesSinceDeclared).toBeGreaterThan(0);
      expect(InvestigationBenchmark.getPromptTime(scenario).toISOString()).toBe(
        new Date(
          Date.parse(scenario.declaredAt) +
            scenario.minutesSinceDeclared * 60 * 1000,
        ).toISOString(),
      );
    },
  );

  test.each(SCENARIO_CASES)(
    "%s: nothing it hands the model is dated after the prompt's now",
    (_id: string, scenario: BenchmarkScenario) => {
      const promptTime: number =
        InvestigationBenchmark.getPromptTime(scenario).getTime();
      const late: Array<string> = [];

      for (const [where, text] of textsOf(scenario)) {
        for (const time of text.match(ISO_TIME) || []) {
          if (Date.parse(time) > promptTime) {
            late.push(`${time} in ${where}`);
          }
        }
      }

      expect(late).toEqual([]);
    },
  );
});

// The summary's "Label: value" lines, read up to its first blank line.
function summaryFieldsOf(scenario: BenchmarkScenario): Map<string, string> {
  const fields: Map<string, string> = new Map();

  for (const line of scenario.contextText.split("\n").slice(1)) {
    if (!line.trim()) {
      break;
    }

    const separator: number = line.indexOf(": ");
    fields.set(line.substring(0, separator), line.substring(separator + 2));
  }

  return fields;
}

function namesIn(fields: Map<string, string>, label: string): Array<string> {
  return (fields.get(label) || "").split(", ").filter(Boolean);
}

function monitorNamed(name: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.name = name;
  return monitor;
}

function labelNamed(name: string): Label {
  const label: Label = new Label();
  label.name = name;
  return label;
}

// The incident's section, rebuilt by the investigation runner from its own lines.
function buildIncidentSummary(scenario: BenchmarkScenario): string {
  const fields: Map<string, string> = summaryFieldsOf(scenario);
  const incident: Incident = new Incident(ObjectID.generate());
  const description: string | undefined = fields.get("Description");
  incident.title = fields.get("Title") || "";
  incident.createdAt = new Date(scenario.declaredAt);

  if (description) {
    incident.description = description;
  }

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = fields.get("Severity") || "";
  incident.incidentSeverity = severity;

  const state: IncidentState = new IncidentState();
  state.name = fields.get("Current state") || "";
  incident.currentIncidentState = state;

  incident.monitors = namesIn(fields, "Affected monitors").map(monitorNamed);
  incident.labels = namesIn(fields, "Labels").map(labelNamed);

  return AIIncidentInvestigationRunner.buildIncidentSummary({
    incident,
    stateTimeline: [],
    internalNotes: [],
    publicNotes: [],
    workspaceMessages: [],
  });
}

// The alert's section, rebuilt by the alert investigation runner from its own lines.
function buildAlertSummary(scenario: BenchmarkScenario): string {
  const fields: Map<string, string> = summaryFieldsOf(scenario);
  const alert: Alert = new Alert(ObjectID.generate());
  const description: string | undefined = fields.get("Description");
  const monitorName: string | undefined = fields.get("Affected monitor");
  const rootCause: string | undefined = fields.get(
    "Root cause (as recorded so far)",
  );
  alert.title = fields.get("Title") || "";
  alert.createdAt = new Date(scenario.declaredAt);

  if (description) {
    alert.description = description;
  }

  const severity: AlertSeverity = new AlertSeverity();
  severity.name = fields.get("Severity") || "";
  alert.alertSeverity = severity;

  const state: AlertState = new AlertState();
  state.name = fields.get("Current state") || "";
  alert.currentAlertState = state;

  if (monitorName) {
    alert.monitor = monitorNamed(monitorName);
  }

  alert.labels = namesIn(fields, "Labels").map(labelNamed);

  if (rootCause) {
    alert.rootCause = rootCause;
  }

  return AIAlertInvestigationRunner.buildAlertSummary({
    alert,
    stateTimeline: [],
    internalNotes: [],
  });
}

function buildSubjectSummary(scenario: BenchmarkScenario): string {
  return getScenarioSubjectKind(scenario) === BenchmarkSubjectKind.Alert
    ? buildAlertSummary(scenario)
    : buildIncidentSummary(scenario);
}

describe("the starting context opens as the investigation runner writes it", () => {
  test("the process runs in UTC, as OneUptime's servers do", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("UTC");
  });

  test.each(SCENARIO_CASES)(
    "%s",
    (_id: string, scenario: BenchmarkScenario) => {
      const summary: string = buildSubjectSummary(scenario);
      const heading: string =
        getScenarioSubjectKind(scenario) === BenchmarkSubjectKind.Alert
          ? "# Alert"
          : "# Incident";

      expect(summary.startsWith(`${heading}\nTitle: `)).toBe(true);
      expect(scenario.contextText.substring(0, summary.length + 1)).toBe(
        `${summary}\n`,
      );
    },
  );
});

describe("the context's sections follow one another as the builders join them", () => {
  test("each section's builder opens it after one blank line", () => {
    expect(
      InvestigationImpactContext.buildContextSection({
        subjectKind: "incident",
        hasMonitors: true,
        slos: [],
        hasMoreSlos: false,
      }),
    ).toMatch(/^\n\n# Impact\n/);
    expect(
      RecentChangesContext.buildContextSection({
        subjectKind: "incident",
        subjectCreatedAt: new Date("2026-03-10T14:07:00.000Z"),
        windowStart: new Date("2026-03-10T12:07:00.000Z"),
        windowEnd: new Date("2026-03-10T14:11:00.000Z"),
        changes: [],
        hasMoreChanges: false,
      }),
    ).toMatch(/^\n\n# Recent changes\n/);
  });

  test.each(SCENARIO_CASES)(
    "%s",
    (_id: string, scenario: BenchmarkScenario) => {
      const headings: Array<string> = scenario.contextText
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("# ");
        });

      expect(scenario.contextText).not.toMatch(/\n\n\n/);

      for (const heading of headings.slice(1)) {
        expect(scenario.contextText).toContain(`\n\n${heading}\n`);
      }
    },
  );
});

/*
 * The recent changes section, read back into the changes it lists and
 * written again by RecentChangesContext: the times, the facts, the impact
 * sentences and the window must come out as the product writes them. An
 * impact's reasons are worked out again from their numbers by ChangeImpact,
 * so a change is a SUSPECT only when its numbers make it one.
 */
const CHANGE_LINE: RegExp =
  /^- (SUSPECT: )?(\S+) \(([^)]+)\)(?: - service ("(?:[^"\\]|\\.)*"))?: ("(?:[^"\\]|\\.)*")(?: \(([^)]*)\))? \[changeId: ([^\]]+)\]\. (.+)$/;
const VERSIONS_FACT: RegExp = /^(\S+) → (\S+)$/;
const VERSION_FACT: RegExp = /^version (\S+)$/;
const ONE_WORD_FACT: RegExp = /^[A-Za-z][\w-]*$/;
const RECORDED_FROM: string = "recorded from ";
const ERROR_RATE_REASON: RegExp =
  /^span error rate (\d+(?:\.\d+)?)% → (\d+(?:\.\d+)?)%$/;
const P99_REASON: RegExp = /^p99 latency (.+) → (.+)$/;
const EXCEPTIONS_REASON: RegExp =
  /^exceptions (\d+(?:\.\d+)?)\/min → (\d+(?:\.\d+)?)\/min$/;
const NEW_TYPES_REASON: RegExp =
  /^\d+ exception types? first seen in (?:"(?:[^"\\]|\\.)*"|this version): (.+)$/;
const NEW_TYPE: RegExp = /^("(?:[^"\\]|\\.)*") \(x(\d+)\)$/;
const DURATION: RegExp = /^(\d+(?:\.\d+)?) (ms|s)$/;
const WINDOW_SPANS: number = 100_000;
const REASONS_PLACEHOLDER: string = "<reasons>";

const PROBE_CHANGE: RecentChange = {
  id: "probe",
  ids: ["probe"],
  time: new Date("2026-03-10T14:00:00.000Z"),
  eventType: "deploy",
  titles: ["probe"],
  fields: {},
  relation: ChangeRelation.Other,
};

// The sentence the product writes for an impact, split where its reasons go.
function impactSentence(change: Partial<RecentChange>): [string, string] {
  const sentence: string = RecentChangesContext.describeImpact({
    ...PROBE_CHANGE,
    ...change,
  });
  const at: number = sentence.indexOf(REASONS_PLACEHOLDER);

  return at < 0
    ? [sentence, ""]
    : [
        sentence.substring(0, at),
        sentence.substring(at + REASONS_PLACEHOLDER.length),
      ];
}

function readFacts(facts: string | undefined): ChangeEventFields {
  const fields: ChangeEventFields = {};

  for (const fact of facts ? facts.split(", ") : []) {
    const versions: RegExpExecArray | null = VERSIONS_FACT.exec(fact);
    const version: RegExpExecArray | null = VERSION_FACT.exec(fact);

    if (versions) {
      fields.previousVersion = versions[1];
      fields.version = versions[2];
    } else if (version) {
      fields.version = version[1];
    } else if (fact.startsWith(RECORDED_FROM)) {
      fields.source = Object.values(ChangeEventSource).find(
        (source: string): boolean => {
          return (
            describeChangeEventSource(source) ===
            fact.substring(RECORDED_FROM.length)
          );
        },
      );

      if (!fields.source) {
        throw new Error(`a source the product never names: "${fact}"`);
      }
    } else if (ONE_WORD_FACT.test(fact) && !fields.environment) {
      fields.environment = fact;
    } else {
      throw new Error(`a fact the product never writes: "${fact}"`);
    }
  }

  return fields;
}

function readDurationMs(text: string): number {
  const duration: RegExpExecArray | null = DURATION.exec(text);

  if (!duration) {
    throw new Error(`a duration the product never writes: "${text}"`);
  }

  return Number(duration[1]) * (duration[2] === "s" ? 1000 : 1);
}

// The impact ChangeImpact finds from the numbers the reasons name.
function assessFromReasons(
  reasons: Array<string>,
  fields: ChangeEventFields,
): ChangeImpact {
  const before: ChangeWindowStats = {
    durationMinutes: 30,
    spanCount: WINDOW_SPANS,
    errorSpanCount: 0,
    p99Ms: 100,
    exceptionCount: 0,
  };
  const after: ChangeWindowStats = { ...before };
  const newExceptionTypes: Array<NewExceptionType> = [];

  for (const reason of reasons) {
    const errorRate: RegExpExecArray | null = ERROR_RATE_REASON.exec(reason);
    const p99: RegExpExecArray | null = P99_REASON.exec(reason);
    const exceptions: RegExpExecArray | null = EXCEPTIONS_REASON.exec(reason);
    const newTypes: RegExpExecArray | null = NEW_TYPES_REASON.exec(reason);

    if (errorRate) {
      before.errorSpanCount = Math.round(
        (Number(errorRate[1]) / 100) * WINDOW_SPANS,
      );
      after.errorSpanCount = Math.round(
        (Number(errorRate[2]) / 100) * WINDOW_SPANS,
      );
    } else if (p99) {
      before.p99Ms = readDurationMs(p99[1] || "");
      after.p99Ms = readDurationMs(p99[2] || "");
    } else if (exceptions) {
      before.exceptionCount = Number(exceptions[1]) * before.durationMinutes;
      after.exceptionCount = Number(exceptions[2]) * after.durationMinutes;
    } else if (newTypes) {
      for (const named of (newTypes[1] || "").split(", ")) {
        const one: RegExpExecArray | null = NEW_TYPE.exec(named);

        if (!one) {
          throw new Error(
            `an exception type the product never writes: ${named}`,
          );
        }

        newExceptionTypes.push({
          exceptionType: JSON.parse(one[1] || '""') as string,
          message: "",
          occurrenceCount: Number(one[2]),
        });
      }
    } else {
      throw new Error(`a reason the product never writes: "${reason}"`);
    }
  }

  return assessChangeImpact({
    before,
    after,
    newExceptionTypes,
    version: fields.version,
  });
}

function readChange(line: string): RecentChange {
  const match: RegExpExecArray | null = CHANGE_LINE.exec(line);

  if (!match) {
    throw new Error(`a change line the product never writes: ${line}`);
  }

  const fields: ChangeEventFields = readFacts(match[6]);
  const impactText: string = match[8] || "";
  const [suspectLead, suspectEnd]: [string, string] = impactSentence({
    impact: {
      verdict: ChangeImpactVerdict.Suspect,
      reasons: [REASONS_PLACEHOLDER],
      newExceptionTypes: [],
    },
  });
  const [notCheckedLead, notCheckedEnd]: [string, string] = impactSentence({
    notCheckedReason: REASONS_PLACEHOLDER,
  });
  const change: RecentChange = {
    id: match[7] || "",
    ids: [match[7] || ""],
    time: new Date(match[2] || ""),
    eventType: "deploy",
    titles: [JSON.parse(match[5] || '""') as string],
    serviceName: match[4] ? (JSON.parse(match[4]) as string) : undefined,
    fields,
    relation: ChangeRelation.Other,
  };

  for (const verdict of [
    ChangeImpactVerdict.NoStep,
    ChangeImpactVerdict.Unknown,
  ]) {
    const impact: ChangeImpact = {
      verdict,
      reasons: [],
      newExceptionTypes: [],
    };

    if (impactText === impactSentence({ impact })[0]) {
      return { ...change, impact };
    }
  }

  if (impactText.startsWith(suspectLead) && impactText.endsWith(suspectEnd)) {
    return {
      ...change,
      impact: assessFromReasons(
        impactText
          .substring(suspectLead.length, impactText.length - suspectEnd.length)
          .split("; "),
        fields,
      ),
    };
  }

  if (
    impactText.startsWith(notCheckedLead) &&
    impactText.endsWith(notCheckedEnd)
  ) {
    return {
      ...change,
      notCheckedReason: impactText.substring(
        notCheckedLead.length,
        impactText.length - notCheckedEnd.length,
      ),
    };
  }

  throw new Error(`an impact the product never writes: "${impactText}"`);
}

describe("the recent changes read as RecentChangesContext writes them", () => {
  test.each(SCENARIO_CASES)(
    "%s",
    (_id: string, scenario: BenchmarkScenario) => {
      const at: number = scenario.contextText.indexOf("# Recent changes\n");

      expect(at).toBeGreaterThan(0);

      const end: number = scenario.contextText.indexOf("\n\n# ", at);
      const section: string = scenario.contextText.substring(
        at,
        end < 0 ? undefined : end,
      );
      const changes: Array<RecentChange> = section
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("- ") && !line.startsWith("- (");
        })
        .map(readChange);

      // The context lists suspects first (RecentChangesContext.read).
      const verdicts: Array<boolean> = changes.map(
        (change: RecentChange): boolean => {
          return change.impact?.verdict === ChangeImpactVerdict.Suspect;
        },
      );
      expect(verdicts).toEqual(
        [...verdicts].sort((a: boolean, b: boolean): number => {
          return Number(b) - Number(a);
        }),
      );

      /*
       * The window as a run reads it when it starts, at the prompt's now:
       * CHANGE_LOOKBACK_MINUTES before the declaration, to
       * CHANGE_LOOKAHEAD_MINUTES after it or now, whichever is first.
       */
      const declaredAt: Date = new Date(scenario.declaredAt);
      const promptTime: Date = InvestigationBenchmark.getPromptTime(scenario);
      const lookahead: Date = OneUptimeDate.addRemoveMinutes(
        declaredAt,
        CHANGE_LOOKAHEAD_MINUTES,
      );
      const written: string = RecentChangesContext.buildContextSection({
        subjectKind: getScenarioSubjectKind(scenario),
        subjectCreatedAt: declaredAt,
        windowStart: OneUptimeDate.addRemoveMinutes(
          declaredAt,
          -CHANGE_LOOKBACK_MINUTES,
        ),
        windowEnd:
          lookahead.getTime() < promptTime.getTime() ? lookahead : promptTime,
        changes,
        hasMoreChanges: section.includes("\n- (more changes"),
      });

      expect(changes.length).toBeGreaterThan(0);
      expect(section).toBe(written.replace(/^\n+/, ""));
    },
  );
});

/*
 * The impact section, written again by InvestigationImpactContext from the
 * SLOs the scenario's query_slos answers with: the ones that count one of
 * the incident's monitors, with the figures that tool reads. So the context
 * and the tool tell one story, the sloId the context names opens the SLO it
 * names, and the model gets the impact instruction a live run gets. The
 * figures are ones the SLO evaluation could have written: the budget its
 * SLI leaves, and the status that budget gives at the default threshold.
 */
const ROLLING_WINDOW: RegExp = /^Rolling (\d+)d$/;
const SECONDS_IN_A_DAY: number = 24 * 60 * 60;

// An incident names its monitors; an alert, the one it was raised for.
function affectedMonitorsOf(scenario: BenchmarkScenario): Array<string> {
  const fields: Map<string, string> = summaryFieldsOf(scenario);

  return getScenarioSubjectKind(scenario) === BenchmarkSubjectKind.Alert
    ? namesIn(fields, "Affected monitor").slice(0, 1)
    : namesIn(fields, "Affected monitors");
}

/*
 * The SLO rows query_slos lists: an answer to any call that names no sloId.
 * Reading one SLO by its sloId answers it in full (ScenarioSlos), and its
 * rows are checked against these below.
 */
function sloListRowsOf(scenario: BenchmarkScenario): Array<JSONObject> {
  return scenario.responses
    .filter((response: BenchmarkToolResponse): boolean => {
      return (
        response.toolName === "query_slos" &&
        response.whenArguments?.["sloId"] === undefined
      );
    })
    .flatMap((response: BenchmarkToolResponse): Array<JSONObject> => {
      return response.rows || [];
    });
}

function numberIn(row: JSONObject, key: string): number | undefined {
  const value: JSONValue | undefined = row[key];
  return typeof value === "number" ? value : undefined;
}

function windowDaysOf(row: JSONObject): number {
  const window: RegExpExecArray | null = ROLLING_WINDOW.exec(
    String(row["window"]),
  );

  if (!window) {
    throw new Error(`a window the scenario's SLOs never use: ${row["window"]}`);
  }

  return Number(window[1]);
}

// The SLOs counting one of the incident's monitors, as the product reads them.
function impactSlosOf(scenario: BenchmarkScenario): Array<ImpactSlo> {
  const incidentMonitors: Array<string> = affectedMonitorsOf(scenario);

  return sloListRowsOf(scenario)
    .map((row: JSONObject): ImpactSlo => {
      return {
        id: String(row["id"]),
        name: String(row["name"]),
        isLinked: false,
        monitorNames: String(row["monitors"] || "")
          .split(", ")
          .filter((name: string): boolean => {
            return incidentMonitors.includes(name);
          }),
        targetPercentage: numberIn(row, "targetPercentage"),
        currentSliPercentage: numberIn(row, "currentSliPercentage"),
        errorBudgetRemainingPercentage: numberIn(
          row,
          "errorBudgetRemainingPercentage",
        ),
        currentBurnRate: numberIn(row, "currentBurnRate"),
        sloStatus: String(row["sloStatus"]),
        lastEvaluatedAt: new Date(String(row["lastEvaluatedAt"])),
        window: `a rolling ${windowDaysOf(row)} days`,
      };
    })
    .filter((slo: ImpactSlo): boolean => {
      return slo.monitorNames.length > 0;
    })
    .sort((a: ImpactSlo, b: ImpactSlo): number => {
      return a.name.localeCompare(b.name);
    });
}

function impactSectionOf(scenario: BenchmarkScenario): string {
  const at: number = scenario.contextText.indexOf("# Impact\n");

  if (at < 0) {
    return "";
  }

  const end: number = scenario.contextText.indexOf("\n\n# ", at);
  return scenario.contextText.substring(at, end < 0 ? undefined : end);
}

describe("the impact reads as InvestigationImpactContext writes it, for the SLOs query_slos answers with", () => {
  test.each(SCENARIO_CASES)(
    "%s: the impact section is the product's, for those SLOs",
    (_id: string, scenario: BenchmarkScenario) => {
      const slos: Array<ImpactSlo> = impactSlosOf(scenario);
      const written: string = InvestigationImpactContext.buildContextSection({
        subjectKind: getScenarioSubjectKind(scenario),
        hasMonitors: affectedMonitorsOf(scenario).length > 0,
        slos: slos.slice(0, MAX_IMPACT_SLOS),
        hasMoreSlos: slos.length > MAX_IMPACT_SLOS,
      });

      expect(slos.length).toBeGreaterThan(0);
      expect(impactSectionOf(scenario)).toBe(written.replace(/^\n+/, ""));
    },
  );

  test.each(SCENARIO_CASES)(
    "%s: the sloId the impact names opens that SLO",
    (_id: string, scenario: BenchmarkScenario) => {
      const ids: Array<string> = Array.from(
        impactSectionOf(scenario).matchAll(/\(sloId: ([^)]+)\)/g),
        (match: RegExpMatchArray): string => {
          return match[1] || "";
        },
      );

      expect(ids.length).toBeGreaterThan(0);

      for (const sloId of ids) {
        const answer: string = ScenarioTools.answer(scenario, "query_slos", {
          sloId,
        }).textForLlm;

        expect(answer).toContain(`id=${sloId}`);
      }
    },
  );

  test.each(SCENARIO_CASES)(
    "%s: each SLO's budget and status are the ones its SLI gives",
    (_id: string, scenario: BenchmarkScenario) => {
      const rows: Array<JSONObject> = sloListRowsOf(scenario);

      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        const targetPercentage: number = numberIn(row, "targetPercentage")!;
        const budgetRemainingPercentage: number = SloUtil.getErrorBudget({
          sliPercentage: numberIn(row, "currentSliPercentage")!,
          totalSeconds: windowDaysOf(row) * SECONDS_IN_A_DAY,
          targetPercentage,
        }).budgetRemainingPercentage;

        expect(numberIn(row, "errorBudgetRemainingPercentage")).toBeCloseTo(
          budgetRemainingPercentage,
          6,
        );
        expect(row["sloStatus"]).toBe(
          SloUtil.computeSloStatus({
            budgetRemainingPercentage,
            currentStatus: SloStatus.Healthy,
            atRiskThresholdPercentage: DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
          }),
        );
        expect(row["window"]).toMatch(
          new RegExp(`^${SloWindowType.Rolling} \\d+d$`),
        );
      }
    },
  );

  test.each(SCENARIO_CASES)(
    "%s: each SLO was measured after the incident began, before the prompt's now",
    (_id: string, scenario: BenchmarkScenario) => {
      const declaredAt: number = Date.parse(scenario.declaredAt);
      const promptTime: number =
        InvestigationBenchmark.getPromptTime(scenario).getTime();

      for (const slo of impactSlosOf(scenario)) {
        const measuredAt: number = slo.lastEvaluatedAt!.getTime();

        expect(measuredAt).toBeGreaterThan(declaredAt);
        expect(measuredAt).toBeLessThan(promptTime);
      }
    },
  );

  test("the scenarios do not all report the same SLO status", () => {
    const statuses: Set<string> = new Set(
      SCENARIO_CASES.flatMap(([, scenario]: ScenarioCase): Array<string> => {
        return valuesOf(sloListRowsOf(scenario), "sloStatus");
      }),
    );

    expect(Array.from(statuses).sort()).toEqual([
      SloStatus.AtRisk,
      SloStatus.Healthy,
    ]);
  });
});

describe("the scorer's words name the planted cause, and nothing else", () => {
  test.each(SCENARIO_CASES)(
    "%s: every group has words, and every distractor has a name and words",
    (_id: string, scenario: BenchmarkScenario) => {
      const { mustMention, distractors } = scenario.expectation;

      expect(mustMention.length).toBeGreaterThan(0);

      for (const group of mustMention) {
        expect(group.length).toBeGreaterThan(0);

        for (const word of group) {
          expect(word.trim()).not.toBe("");
        }
      }

      expect(distractors.length).toBeGreaterThan(0);

      for (const distractor of distractors) {
        expect(distractor.name.trim()).not.toBe("");
        expect(distractor.terms.length).toBeGreaterThan(0);
      }
    },
  );

  test.each(SCENARIO_CASES)(
    "%s: the planted root cause holds every group, and names no distractor",
    (_id: string, scenario: BenchmarkScenario) => {
      const { rootCause, mustMention, distractors } = scenario.expectation;

      for (const group of mustMention) {
        expect([group, BenchmarkScorer.holdsAny(rootCause, group)]).toEqual([
          group,
          true,
        ]);
      }

      for (const distractor of distractors) {
        expect([
          distractor.name,
          BenchmarkScorer.holdsAny(rootCause, distractor.terms),
        ]).toEqual([distractor.name, false]);
      }
    },
  );

  test.each(SCENARIO_CASES)(
    "%s: no word of the cause is a word of a distractor",
    (_id: string, scenario: BenchmarkScenario) => {
      const shared: Array<string> = [];

      for (const word of scenario.expectation.mustMention.flat()) {
        for (const distractor of scenario.expectation.distractors) {
          for (const text of [distractor.name, ...distractor.terms]) {
            if (BenchmarkScorer.holdsAny(text, [word])) {
              shared.push(`"${word}" in "${text}" (${distractor.name})`);
            }
          }
        }
      }

      expect(shared).toEqual([]);
    },
  );

  test.each(SCENARIO_CASES)(
    "%s: no word of the cause hides inside a common word with another meaning",
    (_id: string, scenario: BenchmarkScenario) => {
      const hidden: Array<string> = [];

      for (const word of scenario.expectation.mustMention.flat()) {
        for (const common of WORDS_THAT_HIDE_OTHERS) {
          if (
            common.toLowerCase() !== word.toLowerCase() &&
            BenchmarkScorer.holdsAny(common, [word])
          ) {
            hidden.push(`"${word}" in "${common}"`);
          }
        }
      }

      expect(hidden).toEqual([]);
    },
  );
});

/*
 * WHAT A REAL TOOL WRITES AROUND ITS ROWS (#7766). query_slos opens every
 * answer that has an SLO row with its deploy-gate and compliance notes, and
 * reads one SLO in full - its row, then its burn-rate rules - when its sloId
 * is asked for. A scripted answer does the same, in the tool's own words.
 * Every other tool these scenarios script writes no note before rows like
 * theirs, so no other answer carries one: a note added to one is a note the
 * product writes, added here first.
 */
const TOOL_NOTES: { [toolName: string]: Array<string> } = {
  query_slos: [DEPLOYMENT_GATE_NOTE, COMPLIANCE_NOTE],
};

const SLO_FIGURES: Array<string> = [
  "id",
  "name",
  "isEnabled",
  "sliType",
  "targetPercentage",
  "window",
  "monitors",
  "sloStatus",
  "currentSliPercentage",
  "errorBudgetRemainingPercentage",
  "currentBurnRate",
  "deploymentsAllowed",
  "lastEvaluatedAt",
];

describe("an answer carries the notes the real tool writes before its rows, and only those", () => {
  test.each(SCENARIO_CASES)(
    "%s",
    (_id: string, scenario: BenchmarkScenario) => {
      const problems: Array<string> = [];

      for (const response of scenario.responses) {
        const expected: Array<string> = TOOL_NOTES[response.toolName] || [];
        const notes: Array<string> = response.notes || [];

        if (JSON.stringify(notes) !== JSON.stringify(expected)) {
          problems.push(
            `${describeResponse(response)}: notes ${JSON.stringify(notes)}, the tool writes ${JSON.stringify(expected)}`,
          );
        }

        for (const note of notes) {
          if (!note.endsWith("\n")) {
            problems.push(`${describeResponse(response)}: a note ends a line`);
          }
        }

        if (notes.length > 0 && (response.rows || []).length === 0) {
          problems.push(
            `${describeResponse(response)}: the tool writes its notes only with rows`,
          );
        }
      }

      expect(problems).toEqual([]);
    },
  );

  /*
   * query_containers writes its notes after its rows, on a line of its own
   * (ContainerTools): the host and the window it read - the hour to now
   * unless asked for another - how many containers reported and stopped,
   * and how to read the numbers. No other tool here writes notes after rows.
   */
  test.each(SCENARIO_CASES)(
    "%s: notes after the rows are query_containers' own, for its host, window and rows",
    (_id: string, scenario: BenchmarkScenario) => {
      const promptTime: Date = InvestigationBenchmark.getPromptTime(scenario);
      const windowStart: string = OneUptimeDate.addRemoveMinutes(
        promptTime,
        -60,
      ).toISOString();
      const problems: Array<string> = [];

      for (const response of scenario.responses) {
        const after: Array<string> = response.notesAfterRows || [];

        if (response.toolName !== "query_containers") {
          if (after.length > 0) {
            problems.push(
              `${describeResponse(response)}: only query_containers writes notes after its rows`,
            );
          }
          continue;
        }

        const host: string = (response.citationLabel || "").replace(
          /^Containers of /,
          "",
        );
        const rows: Array<JSONObject> = response.rows || [];
        const stopped: number = rows.filter((row: JSONObject): boolean => {
          return row["status"] === "stopped reporting";
        }).length;

        expect(after).toEqual([
          `Containers of ${host}, window ${windowStart} – ${promptTime.toISOString()} (containers seen in the ${CONTAINER_LOOKBACK_MINUTES} minutes before it count too).`,
          `${rows.length} container(s) reported; ${stopped} stopped reporting. A stopped or crashed container sends nothing rather than zero.`,
          "Stopped containers first, then the busiest by cpu. CPU is in percent of one core (100 = one full core), averaged per bucket; memory is the peak percent of the container's limit or the host's memory.",
        ]);
      }

      expect(problems).toEqual([]);
    },
  );

  test("the notes read as query_slos writes them", () => {
    expect(DEPLOYMENT_GATE_NOTE).toMatch(/^Note: deploymentsAllowed /);
    expect(COMPLIANCE_NOTE).toMatch(/^Note: compliance figures /);
  });
});

describe("every SLO query_slos lists can be read in full by its sloId", () => {
  test.each(SCENARIO_CASES)(
    "%s: its row, with the list's figures, then OneUptime's burn-rate rules for its window",
    (_id: string, scenario: BenchmarkScenario) => {
      const listed: Array<JSONObject> = sloListRowsOf(scenario);

      expect(listed.length).toBeGreaterThan(0);

      for (const row of listed) {
        const full: BenchmarkToolResponse | null = ScenarioTools.findResponse(
          scenario,
          "query_slos",
          { sloId: String(row["id"]) },
        );
        const rows: Array<JSONObject> = full?.rows || [];
        const sloRow: JSONObject = rows[0] || {};
        const rules: Array<JSONObject> = rows.slice(1);

        expect(full?.whenArguments).toEqual({ sloId: row["id"] });
        expect(full?.citationLabel).toBe(`SLO ${row["name"]}`);
        expect(sloRow["record"]).toBe("slo");

        for (const figure of SLO_FIGURES) {
          expect([figure, sloRow[figure]]).toEqual([figure, row[figure]]);
        }

        // Its error budget in seconds, as its SLI gives it.
        const budget: { budgetRemainingSeconds: number } =
          SloUtil.getErrorBudget({
            sliPercentage: numberIn(row, "currentSliPercentage")!,
            totalSeconds: windowDaysOf(row) * SECONDS_IN_A_DAY,
            targetPercentage: numberIn(row, "targetPercentage")!,
          });
        expect(sloRow["errorBudgetRemainingSeconds"]).toBe(
          Math.round(budget.budgetRemainingSeconds),
        );

        // Every one of OneUptime's rules for its window: the tool writes no note of one it lacks.
        expect(
          rules.map((rule: JSONObject): unknown => {
            return rule["record"];
          }),
        ).toEqual(["burnRateRule", "burnRateRule", "burnRateRule"]);
        expect(
          getMissingSloRecommendedBurnRateRules({
            window: {
              windowType: SloWindowType.Rolling,
              windowDays: windowDaysOf(row),
            },
            existingRules: rules.map(
              (
                rule: JSONObject,
              ): { name: string; longWindowInMinutes: number } => {
                return {
                  name: String(rule["name"]),
                  longWindowInMinutes: Number(rule["longWindowInMinutes"]),
                };
              },
            ),
          }),
        ).toEqual([]);
        expect(
          rules.map((rule: JSONObject): string => {
            return `${rule["name"]} ${rule["burnRateThreshold"]}x ${rule["longWindowInMinutes"]}/${rule["shortWindowInMinutes"]}`;
          }),
        ).toEqual(
          getSloRecommendedBurnRateRules({
            windowType: SloWindowType.Rolling,
            windowDays: windowDaysOf(row),
          }).map((rule: SloRecommendedBurnRateRule): string => {
            return `${rule.name} ${rule.burnRateThreshold}x ${rule.longWindowInMinutes}/${rule.shortWindowInMinutes}`;
          }),
        );
      }
    },
  );
});

/*
 * A SCENARIO WHOSE EVIDENCE NAMES NO CAUSE (#7766) is scored on whether the
 * answer says it could not tell: its words are the scorer's own, never a
 * hand-picked few, and the root cause people would write says so too.
 */
describe("a scenario whose evidence names no cause is scored on saying so", () => {
  const NO_CAUSE_CASES: Array<ScenarioCase> = SCENARIO_CASES.filter(
    ([, scenario]: ScenarioCase): boolean => {
      return (
        getScenarioExpectationKind(scenario) ===
        BenchmarkExpectationKind.Inconclusive
      );
    },
  );

  test("there is at least one", () => {
    expect(NO_CAUSE_CASES.length).toBeGreaterThan(0);
  });

  test.each(NO_CAUSE_CASES)(
    "%s: its words are the scorer's, and its kind says no evidence",
    (_id: string, scenario: BenchmarkScenario) => {
      expect(scenario.expectation.mustMention).toEqual([INCONCLUSIVE_WORDS]);
      expect(scenario.faultKind).toBe(BenchmarkFaultKind.NoEvidence);
      expect(
        BenchmarkScorer.holdsAny(
          scenario.expectation.rootCause,
          INCONCLUSIVE_WORDS,
        ),
      ).toBe(true);
    },
  );

  test.each(SCENARIO_CASES)(
    "%s: only a scenario whose evidence names no cause is scored on those words",
    (_id: string, scenario: BenchmarkScenario) => {
      const isNoCause: boolean =
        getScenarioExpectationKind(scenario) ===
        BenchmarkExpectationKind.Inconclusive;

      expect(scenario.faultKind === BenchmarkFaultKind.NoEvidence).toBe(
        isNoCause,
      );

      if (!isNoCause) {
        expect(
          BenchmarkScorer.holdsAny(
            scenario.expectation.rootCause,
            INCONCLUSIVE_WORDS,
          ),
        ).toBe(false);
      }
    },
  );
});

/*
 * A planted cause's words should be ones only it uses (#7766): with no
 * judge, an answer is scored by its words, and an answer that blames a
 * distractor in the words of the distractor's own evidence must not hold
 * them all. So a result that holds every group of the cause's words is the
 * fault's own evidence, and is marked so.
 */
describe("a result that names the planted cause in full is the fault's own evidence", () => {
  test.each(SCENARIO_CASES)(
    "%s",
    (_id: string, scenario: BenchmarkScenario) => {
      if (
        getScenarioExpectationKind(scenario) ===
        BenchmarkExpectationKind.Inconclusive
      ) {
        return;
      }

      const unmarked: Array<string> = scenario.responses
        .filter((response: BenchmarkToolResponse): boolean => {
          if (response.isKeyEvidence === true) {
            return false;
          }

          const answer: string = ScenarioTools.answer(
            scenario,
            response.toolName,
            response.whenArguments || {},
          ).textForLlm;

          return scenario.expectation.mustMention.every(
            (group: Array<string>): boolean => {
              return BenchmarkScorer.holdsAny(answer, group);
            },
          );
        })
        .map(describeResponse);

      expect(unmarked).toEqual([]);
    },
  );
});

/*
 * WHAT THE BENCHMARK COVERS (#7766): an alert, a scenario whose evidence
 * names no cause, one with two causes, one with a past incident whose fix
 * does not apply, and the toolbox's reach - a host's containers, a
 * connected cloud's resources, and the code.
 */
describe("the benchmark covers more than incidents with one cause in their logs", () => {
  function scenariosWhere(
    predicate: (scenario: BenchmarkScenario) => boolean,
  ): Array<string> {
    return BENCHMARK_SCENARIOS.filter(predicate).map(
      (scenario: BenchmarkScenario): string => {
        return scenario.id;
      },
    );
  }

  function scriptsTool(
    toolName: string,
  ): (scenario: BenchmarkScenario) => boolean {
    return (scenario: BenchmarkScenario): boolean => {
      return scenario.responses.some(
        (response: BenchmarkToolResponse): boolean => {
          return response.toolName === toolName;
        },
      );
    };
  }

  test("an alert", () => {
    expect(
      scenariosWhere((scenario: BenchmarkScenario): boolean => {
        return getScenarioSubjectKind(scenario) === BenchmarkSubjectKind.Alert;
      }).length,
    ).toBeGreaterThan(0);
  });

  test("two causes", () => {
    expect(
      scenariosWhere((scenario: BenchmarkScenario): boolean => {
        return scenario.faultKind === BenchmarkFaultKind.TwoCauses;
      }).length,
    ).toBeGreaterThan(0);
  });

  test("a past incident in its context", () => {
    expect(
      scenariosWhere((scenario: BenchmarkScenario): boolean => {
        return scenario.contextText.includes(
          "\n\n# Past resolved incidents in this project (recurrence context)\n",
        );
      }).length,
    ).toBeGreaterThan(0);
  });

  test.each([
    ["a host's containers", "query_containers"],
    ["a connected cloud's resource", "query_cloud_resource"],
    ["the code behind an exception", "find_code_for_exception"],
    ["a file of the code", "read_code_file"],
  ])("the toolbox's reach: %s (%s)", (_what: string, toolName: string) => {
    expect(scenariosWhere(scriptsTool(toolName)).length).toBeGreaterThan(0);
  });
});
