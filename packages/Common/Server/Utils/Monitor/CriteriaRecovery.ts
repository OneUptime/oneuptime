import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import {
  MonitorEvaluationCriteriaResult,
  MonitorEvaluationFilterResult,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import { PerSeriesCriteriaMatch } from "../../../Types/Probe/ProbeApiIngestResponse";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";

/**
 * A CRITERIA'S OWN RECOVERY CONDITION (#10355).
 *
 * Without one, a criteria stops acting as soon as its filters stop
 * matching: on that check its incident or alert resolves (Auto Resolve) and
 * the monitor moves on to the next criteria that matches, or to its default
 * status. That is right for "the site is down", and wrong for a value that
 * hovers at its threshold - "response time above 500 ms" opens and resolves
 * an incident at every crossing - and for anything that should be seen to
 * stay healthy before it counts as recovered.
 *
 * A criteria can say when it recovers instead: its recovery filters
 * (MonitorCriteriaInstance.recoveryFilters), "response time below 300 ms
 * for 10 minutes". Once it has acted - it set the monitor's status, or an
 * incident or alert it opened is open (CriteriaInEffect) - it keeps acting
 * on every check, matched or not, until its recovery filters match. Then it
 * stops, and what it opened resolves, as when an ordinary criteria stops
 * matching. The recovery filters are filters like any other, judged on the
 * same check with everything they offer: a window ("for 10 minutes" is All
 * Values over 10 minutes), a count of checks, If No Data.
 *
 * While it acts it is a match like any other, in its place in the list: the
 * first criteria that matches still decides, so a criteria above it that
 * matches takes over, as it would from a criteria whose filters matched.
 *
 * On a monitor that judges each series on its own, it acts series by
 * series: a series it has an incident or alert open for, or that is behind
 * a status it set (SeriesBehindStatus), stays one of its matches until that
 * series meets the recovery filters, and the grouped recovery rule then
 * lets the series go (GroupedMonitorRecovery.judge, recoveredSeries).
 *
 * MonitorCriteriaEvaluator.holdUntilRecovered applies it; this holds what
 * it is built from and the words it writes in the evaluation log.
 */

// What a criteria with a recovery condition does on a check.
export interface CriteriaHold {
  /*
   * Set when the criteria acts on this check only because its recovery
   * condition is not met: its root cause.
   */
  rootCause: string | null;
  /*
   * A grouped criteria's matches: the series its filters matched, then the
   * series it still holds. Undefined for a criteria judged as a whole.
   */
  perSeriesMatches?: Array<PerSeriesCriteriaMatch> | undefined;
  // The series that met the recovery condition on this check.
  recoveredSeries: Array<string>;
}

export interface CriteriaHeldText {
  // Markdown, its findings placed as text.
  rootCause: string;
  message: string;
}

const HELD_MESSAGE: string =
  "Still in effect: its filters no longer match, but its recovery condition is not met yet.";

const RECOVERED_MESSAGE: string =
  "Its filters no longer match, and its recovery condition is met, so it no longer acts.";

export default class CriteriaRecovery {
  /*
   * The criteria as its recovery condition reads: the same criteria - its
   * id, its actions, its monitor's series - with the recovery filters as its
   * filters, so every evaluator judges them as it judges any filter.
   */
  public static toRecoveryCriteria(
    criteriaInstance: MonitorCriteriaInstance,
  ): MonitorCriteriaInstance {
    const recoveryCriteria: MonitorCriteriaInstance =
      new MonitorCriteriaInstance();

    recoveryCriteria.data = {
      ...criteriaInstance.data!,
      filters: criteriaInstance.data?.recoveryFilters || [],
      filterCondition:
        criteriaInstance.data?.recoveryFilterCondition || FilterCondition.All,
      recoveryFilters: undefined,
      recoveryFilterCondition: undefined,
    };

    return recoveryCriteria;
  }

  // A summary row for the recovery filters alone: never put in the summary.
  public static newRecoveryResult(
    criteriaInstance: MonitorCriteriaInstance,
  ): MonitorEvaluationCriteriaResult {
    return {
      criteriaId: criteriaInstance.data?.id,
      criteriaName: criteriaInstance.data?.name,
      filterCondition:
        criteriaInstance.data?.recoveryFilterCondition || FilterCondition.All,
      met: false,
      message: "",
      filters: [],
    };
  }

  // The criteria acts on, its recovery condition not met: why, with what it found.
  public static describeHeld(input: {
    recoveryResult: MonitorEvaluationCriteriaResult;
  }): CriteriaHeldText {
    const findings: Array<string> = CriteriaRecovery.getFindings(
      input.recoveryResult,
    );

    const rootCause: MarkdownText = mdText`${HELD_MESSAGE}${FeedMarkdown.join(
      findings.map((finding: string): MarkdownText => {
        return mdText`\n- Recovery condition: ${finding}`;
      }),
      "",
    )}`;

    return {
      rootCause: rootCause.toString(),
      message: [
        HELD_MESSAGE,
        ...findings.map((finding: string): string => {
          return `- Recovery condition: ${finding}`;
        }),
      ].join("\n"),
    };
  }

  // A grouped criteria that holds some series and matched none on its own.
  public static describeHeldSeries(input: {
    heldCount: number;
    recoveryResult: MonitorEvaluationCriteriaResult;
  }): string {
    const findings: Array<string> = CriteriaRecovery.getFindings(
      input.recoveryResult,
    );

    return [
      `Still in effect for ${input.heldCount === 1 ? "1 series" : `${input.heldCount} series`}: ${input.heldCount === 1 ? "it no longer meets" : "they no longer meet"} its filters, but ${input.heldCount === 1 ? "has" : "have"} not met its recovery condition yet.`,
      ...findings.map((finding: string): string => {
        return `- Recovery condition: ${finding}`;
      }),
    ].join("\n");
  }

  // The criteria stops acting: its recovery condition was met.
  public static describeRecovered(input: {
    recoveryResult: MonitorEvaluationCriteriaResult;
  }): string {
    return [
      RECOVERED_MESSAGE,
      ...CriteriaRecovery.getFindings(input.recoveryResult).map(
        (finding: string): string => {
          return `- Recovery condition: ${finding}`;
        },
      ),
    ].join("\n");
  }

  private static getFindings(
    recoveryResult: MonitorEvaluationCriteriaResult,
  ): Array<string> {
    return recoveryResult.filters
      .map((filter: MonitorEvaluationFilterResult): string => {
        return filter.message;
      })
      .filter((message: string): boolean => {
        return Boolean(message);
      });
  }
}
