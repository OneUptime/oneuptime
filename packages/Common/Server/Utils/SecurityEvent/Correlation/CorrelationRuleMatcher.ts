import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import {
  SigmaCorrelation,
  SigmaCorrelationStep,
  SigmaCorrelationType,
} from "../../../../Types/SecurityEvent/SigmaCorrelation";
import {
  CorrelationMatch,
  countStepTimes,
  findOrderedChain,
  findTogetherWindow,
} from "../../../../Utils/SecurityEvent/Sigma/CorrelationTimeline";
import {
  describeSigmaTimespan,
  minimumCountFor,
} from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { DetectionMatchGroup } from "../../../Services/SecurityEventService";
import { Statement } from "../../AnalyticsDatabase/Statement";
import CorrelationQueries, {
  CORRELATION_TEMPORAL_CANDIDATE_LIMIT,
  CorrelationCountRow,
  CorrelationNewValueRow,
  CorrelationReadWindow,
  CorrelationTemporalRow,
  getCorrelationRollingWindow,
} from "./CorrelationQueries";

/*
 * Runs one correlation rule over one run's window and answers what the
 * single-rule engine answers: the groups that matched, each with its count,
 * its sample, and a sentence of what happened. Everything after - alerts,
 * incidents, Detection Findings and cases - is the evaluator's, and reads a
 * correlation's groups like a single rule's.
 *
 * The windows each type reads (`startTime` is where the run's window
 * starts, `endTime` where it ends):
 *
 *   - event_count, value_count: a rolling window - every timespan that ends
 *     in this run, in steps of a sixtieth of the timespan - so a burst is
 *     counted whole whichever runs it straddles, and a group fires only with
 *     events in this run.
 *   - temporal, temporal_ordered: from startTime less the timespan (and an
 *     event_count step's own timespan) to endTime, so a chain whose first
 *     step came before this run still counts when its last step is in it.
 *   - new_value: this run's window, against the timespan of history before
 *     it.
 */

export interface CorrelationMatchResult {
  groups: Array<DetectionMatchGroup>;
  // The earliest event the run read.
  readFrom: Date;
  // A temporal run read its candidate limit: busier groups may wait for the next run.
  candidatesCapped: boolean;
}

export interface CorrelationRuleMatchInput {
  projectId: ObjectID;
  correlation: SigmaCorrelation;
  steps: Array<SigmaCorrelationStep>;
  startTime: Date;
  endTime: Date;
  maxGroups: number;
  restrictTo?: Statement | undefined;
}

// "3 minutes", "45 seconds", "less than a second": how far apart two times are.
export function describeGap(milliseconds: number): string {
  const seconds: number = Math.floor(Math.max(0, milliseconds) / 1000);

  if (seconds < 1) {
    return "less than a second";
  }

  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }

  const minutes: number = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const hours: number = Math.floor(minutes / 60);

  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function groupValueOf(values: Array<string>): string {
  return values
    .filter((value: string): boolean => {
      return value.length > 0;
    })
    .join(" / ");
}

function groupFieldsOf(
  correlation: SigmaCorrelation,
  values: Array<string>,
): Array<{ field: string; value: string }> {
  return correlation.groupBy
    .map((field: string, index: number): { field: string; value: string } => {
      return { field, value: values[index] || "" };
    })
    .filter((entry: { field: string; value: string }): boolean => {
      return entry.value.length > 0;
    });
}

// The step's title, with the count it took for a step that counts.
function stepLabel(step: SigmaCorrelationStep): string {
  if (step.count) {
    const minimum: number = minimumCountFor(
      step.count.correlation.condition.comparisons,
    );

    return `${step.title} (${minimum}+ events in ${describeSigmaTimespan(
      step.count.correlation.timespanInSeconds,
    )})`;
  }

  return step.title;
}

export default class CorrelationRuleMatcher {
  public static async findMatches(
    input: CorrelationRuleMatchInput,
  ): Promise<CorrelationMatchResult> {
    switch (input.correlation.type) {
      case SigmaCorrelationType.EventCount:
      case SigmaCorrelationType.ValueCount:
        return this.findCountMatches(input);
      case SigmaCorrelationType.Temporal:
      case SigmaCorrelationType.TemporalOrdered:
        return this.findTemporalMatches(input);
      case SigmaCorrelationType.NewValue:
        return this.findNewValueMatches(input);
      default:
        throw new Error(
          `Correlation type "${String(input.correlation.type)}" is not supported.`,
        );
    }
  }

  private static async findCountMatches(
    input: CorrelationRuleMatchInput,
  ): Promise<CorrelationMatchResult> {
    const countDistinct: boolean =
      input.correlation.type === SigmaCorrelationType.ValueCount;
    // The timespan before the run's first step, so its first window is whole.
    const readFrom: Date = getCorrelationRollingWindow({
      timespanInSeconds: input.correlation.timespanInSeconds,
      startTime: input.startTime,
    }).readFrom;

    const window: CorrelationReadWindow = {
      projectId: input.projectId,
      readFrom,
      startTime: input.startTime,
      endTime: input.endTime,
      restrictTo: input.restrictTo,
    };

    const rows: Array<CorrelationCountRow> =
      await CorrelationQueries.findCountGroups({
        window,
        correlation: input.correlation,
        steps: input.steps,
        countDistinct,
        limit: input.maxGroups,
      });

    const span: string = describeSigmaTimespan(
      input.correlation.timespanInSeconds,
    );
    const fields: string = input.correlation.condition.fields.join(" / ");

    return {
      readFrom,
      candidatesCapped: false,
      groups: rows.map((row: CorrelationCountRow): DetectionMatchGroup => {
        return {
          groupValue: groupValueOf(row.values),
          matchCount: row.matchCount,
          distinctCount: countDistinct ? row.distinctCount : 0,
          sampleMessage: row.sampleMessage,
          sampleObservables: row.sampleObservables,
          groupFields: groupFieldsOf(input.correlation, row.values),
          summary: countDistinct
            ? `${row.distinctCount} different ${fields} value${
                row.distinctCount === 1 ? "" : "s"
              } in ${span} (${row.matchCount} event${row.matchCount === 1 ? "" : "s"})`
            : `${row.matchCount} event${row.matchCount === 1 ? "" : "s"} in ${span}`,
        };
      }),
    };
  }

  private static async findTemporalMatches(
    input: CorrelationRuleMatchInput,
  ): Promise<CorrelationMatchResult> {
    const ordered: boolean =
      input.correlation.type === SigmaCorrelationType.TemporalOrdered;
    const timespanMs: number = input.correlation.timespanInSeconds * 1000;

    // An event_count step looks back its own timespan before it happens.
    let longestStepSpanInSeconds: number = 0;

    for (const step of input.steps) {
      if (step.count) {
        longestStepSpanInSeconds = Math.max(
          longestStepSpanInSeconds,
          step.count.correlation.timespanInSeconds,
        );
      }
    }

    const readFrom: Date = OneUptimeDate.addRemoveSeconds(
      input.startTime,
      -(input.correlation.timespanInSeconds + longestStepSpanInSeconds),
    );

    const stepMinimums: Array<number> = input.steps.map(
      (step: SigmaCorrelationStep): number => {
        return step.count
          ? minimumCountFor(step.count.correlation.condition.comparisons)
          : 1;
      },
    );

    const gte: number | undefined =
      input.correlation.condition.comparisons.find(
        (comparison: { operator: string; value: number }): boolean => {
          return comparison.operator === "gte";
        },
      )?.value;

    const minimumSteps: number = ordered
      ? input.steps.length
      : Math.min(input.steps.length, gte || input.steps.length);

    const rows: Array<CorrelationTemporalRow> =
      await CorrelationQueries.findTemporalGroups({
        window: {
          projectId: input.projectId,
          readFrom,
          startTime: input.startTime,
          endTime: input.endTime,
          restrictTo: input.restrictTo,
        },
        correlation: input.correlation,
        steps: input.steps,
        stepMinimums,
        minimumSteps,
        limit: CORRELATION_TEMPORAL_CANDIDATE_LIMIT,
      });

    const notBefore: number = input.startTime.getTime();
    const groups: Array<DetectionMatchGroup> = [];

    for (const row of rows) {
      // When each step happened: every event of a rule step, the count reached for a counting step.
      const happened: Array<Array<number>> = input.steps.map(
        (step: SigmaCorrelationStep, index: number): Array<number> => {
          const times: Array<number> = row.stepTimes[index] || [];

          return step.count
            ? countStepTimes(
                times,
                step.count.correlation.timespanInSeconds * 1000,
                stepMinimums[index]!,
              )
            : times;
        },
      );

      const match: CorrelationMatch | null = ordered
        ? findOrderedChain(happened, timespanMs, notBefore)
        : findTogetherWindow(happened, timespanMs, minimumSteps, notBefore);

      if (!match) {
        continue;
      }

      const matchedSteps: Array<string> = input.steps
        .filter((_step: SigmaCorrelationStep, index: number): boolean => {
          return match.stepTimes[index] !== undefined
            ? match.stepTimes[index]! >= 0
            : false;
        })
        .map(stepLabel);

      const gap: string = describeGap(match.end - match.start);

      groups.push({
        groupValue: groupValueOf(row.values),
        matchCount: row.matchCount,
        distinctCount: 0,
        sampleMessage: row.sampleMessage,
        sampleObservables: row.sampleObservables,
        groupFields: groupFieldsOf(input.correlation, row.values),
        summary: ordered
          ? `${matchedSteps.join(", then ")}, ${gap} apart`
          : `${matchedSteps.join(", ")}, within ${gap}`,
      });

      if (groups.length >= input.maxGroups) {
        break;
      }
    }

    return {
      groups,
      readFrom,
      candidatesCapped: rows.length >= CORRELATION_TEMPORAL_CANDIDATE_LIMIT,
    };
  }

  private static async findNewValueMatches(
    input: CorrelationRuleMatchInput,
  ): Promise<CorrelationMatchResult> {
    const historyFrom: Date = OneUptimeDate.addRemoveSeconds(
      input.startTime,
      -input.correlation.timespanInSeconds,
    );

    const rows: Array<CorrelationNewValueRow> =
      await CorrelationQueries.findNewValueGroups({
        window: {
          projectId: input.projectId,
          readFrom: input.startTime,
          startTime: input.startTime,
          endTime: input.endTime,
          restrictTo: input.restrictTo,
        },
        historyFrom,
        correlation: input.correlation,
        steps: input.steps,
        limit: input.maxGroups,
      });

    const fields: string = input.correlation.condition.fields.join(" / ");
    const span: string = describeSigmaTimespan(
      input.correlation.timespanInSeconds,
    );

    return {
      readFrom: historyFrom,
      candidatesCapped: false,
      groups: rows.map((row: CorrelationNewValueRow): DetectionMatchGroup => {
        const shown: Array<string> = row.newValues.slice(0, 5);
        const more: number = row.newValueCount - shown.length;

        return {
          groupValue: groupValueOf(row.values),
          matchCount: row.matchCount,
          distinctCount: row.newValueCount,
          sampleMessage: row.sampleMessage,
          // The new values first: they are what the case is about, beside the group.
          sampleObservables: Array.from(
            new Set<string>([
              ...row.newValues.flatMap((value: string): Array<string> => {
                return value.split(" / ");
              }),
              ...row.sampleObservables,
            ]),
          ),
          groupFields: groupFieldsOf(input.correlation, row.values),
          summary: `First ${fields} in ${span}: ${shown.join(", ")}${
            more > 0 ? ` and ${more} more` : ""
          }`,
        };
      }),
    };
  }
}
