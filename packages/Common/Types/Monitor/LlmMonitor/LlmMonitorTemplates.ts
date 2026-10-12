import { CheckOn, FilterType } from "../CriteriaFilter";
import MonitorStepLlmMonitor, {
  MonitorStepLlmMonitorUtil,
} from "../MonitorStepLlmMonitor";
import { LlmAnswerIssue } from "../../Telemetry/LlmAnswerIssue";

/*
 * THE ALERTS MOST AI APPS WANT, ONE CLICK AWAY.
 *
 * Each template is an AI / LLM monitor ready to create: what counts as a
 * bad answer (the step), and when that is too many (the criteria). The
 * AI / LLM product's Alerts tab lists them; picking one opens Create
 * Monitor filled in, where everything can still be changed before saving.
 *
 * The thresholds follow one rule: a share of answers for anything that is
 * normal in small numbers (refusals, failures, slow answers) with a floor of
 * a few answers so one bad answer out of two pages nobody, and a plain
 * count for what should not happen at all (a flagged answer). The values
 * are not persisted as templates: a created monitor owns its copy.
 */

export enum LlmMonitorTemplateId {
  BadAnswers = "llm-bad-answers",
  FailedCalls = "llm-failed-calls",
  Refusals = "llm-refusals",
  CutOffAnswers = "llm-cut-off-answers",
  FlaggedAnswers = "llm-flagged-answers",
  SlowAnswers = "llm-slow-answers",
  NoAnswers = "llm-no-answers",
}

export type LlmMonitorTemplateSeverity = "Critical" | "Warning";

export interface LlmMonitorTemplateFilter {
  checkOn: CheckOn;
  filterType: FilterType;
  value: number;
}

/*
 * What a template DOES. Its words - the card's title and sentence, the
 * monitor's name and its alert's text - are the Dashboard's
 * (Components/LlmAlerts/LlmMonitorTemplateCopy.ts), where they are
 * translated.
 */
export interface LlmMonitorTemplate {
  id: LlmMonitorTemplateId;
  step: MonitorStepLlmMonitor;
  // All of these together raise the alert (FilterCondition.All).
  unhealthyFilters: Array<LlmMonitorTemplateFilter>;
  // Any of these brings the monitor back (FilterCondition.Any).
  healthyFilters: Array<LlmMonitorTemplateFilter>;
  severity: LlmMonitorTemplateSeverity;
}

function step(
  overrides: Partial<MonitorStepLlmMonitor>,
): MonitorStepLlmMonitor {
  return {
    ...MonitorStepLlmMonitorUtil.getDefault(),
    ...overrides,
  };
}

/*
 * More than `percent` of the answers, and at least `minimum` of them - and
 * its complement, so every check lands on one of the two criteria.
 */
function shareOfAnswers(
  percent: number,
  minimum: number,
): Pick<LlmMonitorTemplate, "unhealthyFilters" | "healthyFilters"> {
  return {
    unhealthyFilters: [
      {
        checkOn: CheckOn.LlmBadAnswerPercent,
        filterType: FilterType.GreaterThan,
        value: percent,
      },
      {
        checkOn: CheckOn.LlmBadAnswerCount,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: minimum,
      },
    ],
    healthyFilters: [
      {
        checkOn: CheckOn.LlmBadAnswerPercent,
        filterType: FilterType.LessThanOrEqualTo,
        value: percent,
      },
      {
        checkOn: CheckOn.LlmBadAnswerCount,
        filterType: FilterType.LessThan,
        value: minimum,
      },
    ],
  };
}

// At least `minimum` bad answers - and fewer than that.
function countOfAnswers(
  minimum: number,
): Pick<LlmMonitorTemplate, "unhealthyFilters" | "healthyFilters"> {
  return {
    unhealthyFilters: [
      {
        checkOn: CheckOn.LlmBadAnswerCount,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: minimum,
      },
    ],
    healthyFilters: [
      {
        checkOn: CheckOn.LlmBadAnswerCount,
        filterType: FilterType.LessThan,
        value: minimum,
      },
    ],
  };
}

const TEMPLATES: Array<LlmMonitorTemplate> = [
  {
    id: LlmMonitorTemplateId.BadAnswers,
    step: step({}),
    ...shareOfAnswers(5, 3),
    severity: "Warning",
  },
  {
    id: LlmMonitorTemplateId.FailedCalls,
    step: step({
      issues: [LlmAnswerIssue.Failed],
      lastXSecondsOfCalls: 300,
    }),
    ...shareOfAnswers(10, 3),
    severity: "Critical",
  },
  {
    id: LlmMonitorTemplateId.Refusals,
    step: step({
      issues: [LlmAnswerIssue.Refused],
      lastXSecondsOfCalls: 1800,
    }),
    ...shareOfAnswers(5, 3),
    severity: "Warning",
  },
  {
    id: LlmMonitorTemplateId.CutOffAnswers,
    step: step({
      issues: [LlmAnswerIssue.CutOff],
      lastXSecondsOfCalls: 1800,
    }),
    ...countOfAnswers(3),
    severity: "Warning",
  },
  {
    id: LlmMonitorTemplateId.FlaggedAnswers,
    step: step({
      issues: [LlmAnswerIssue.Flagged],
    }),
    ...countOfAnswers(1),
    severity: "Warning",
  },
  {
    id: LlmMonitorTemplateId.SlowAnswers,
    step: step({
      issues: [],
      slowAnswerSeconds: 30,
    }),
    ...shareOfAnswers(10, 3),
    severity: "Warning",
  },
  {
    id: LlmMonitorTemplateId.NoAnswers,
    step: step({
      lastXSecondsOfCalls: 1800,
    }),
    unhealthyFilters: [
      {
        checkOn: CheckOn.LlmAnswerCount,
        filterType: FilterType.EqualTo,
        value: 0,
      },
    ],
    healthyFilters: [
      {
        checkOn: CheckOn.LlmAnswerCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      },
    ],
    severity: "Critical",
  },
];

export default class LlmMonitorTemplates {
  public static getAll(): Array<LlmMonitorTemplate> {
    return TEMPLATES.map((template: LlmMonitorTemplate): LlmMonitorTemplate => {
      return LlmMonitorTemplates.copy(template);
    });
  }

  // A template by its id, or null for anything that is not one.
  public static get(id: unknown): LlmMonitorTemplate | null {
    const template: LlmMonitorTemplate | undefined = TEMPLATES.find(
      (candidate: LlmMonitorTemplate): boolean => {
        return candidate.id === id;
      },
    );

    return template ? LlmMonitorTemplates.copy(template) : null;
  }

  // Deep enough that a caller changing its copy never changes the table.
  private static copy(template: LlmMonitorTemplate): LlmMonitorTemplate {
    return {
      ...template,
      step: {
        ...template.step,
        telemetryServiceIds: [...template.step.telemetryServiceIds],
        issues: [...template.step.issues],
      },
      unhealthyFilters: template.unhealthyFilters.map(
        (filter: LlmMonitorTemplateFilter): LlmMonitorTemplateFilter => {
          return { ...filter };
        },
      ),
      healthyFilters: template.healthyFilters.map(
        (filter: LlmMonitorTemplateFilter): LlmMonitorTemplateFilter => {
          return { ...filter };
        },
      ),
    };
  }
}
