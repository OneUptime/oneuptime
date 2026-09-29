import {
  LabelRuleRunResult,
  SiteAssignmentRuleRunResult,
} from "../../Types/NetworkAutomation/RuleRunResult";

/*
 * Turns a rule run's counters into the sentences the dashboard shows.
 *
 * Pure and dependency-free on purpose: "the rule matched 12 devices but
 * assigned none of them" is the answer people actually need from this
 * feature — a run that did nothing is the common case once a rule has been
 * run once — and phrasing that badly is a support ticket. Keeping it out of
 * the component makes every branch of it testable.
 */

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function devices(count: number): string {
  return pluralize(count, "device", "devices");
}

export class RuleRunSummary {
  /*
   * The headline sentence for a site assignment run: what changed, or the
   * most useful reason nothing did.
   */
  public static describeSiteAssignmentRun(
    result: SiteAssignmentRuleRunResult,
  ): string {
    const lines: Array<string> = [];

    if (result.devicesAssigned > 0) {
      lines.push(
        `Assigned ${devices(result.devicesAssigned)} to this rule's site.`,
      );
    } else {
      lines.push(
        `No devices were reassigned. This rule matched ${devices(
          result.devicesMatched,
        )} out of the ${devices(result.devicesEvaluated)} it looked at.`,
      );
    }

    /*
     * The three ways a matched device can be left alone. Each is reported
     * only when it happened, and each names the fix, because "12 matched, 0
     * assigned" with no explanation reads as a broken button.
     */
    if (result.devicesAlreadyInRuleSite > 0) {
      lines.push(
        `${devices(
          result.devicesAlreadyInRuleSite,
        )} already belonged to this rule's site.`,
      );
    }

    if (result.devicesSkippedAlreadyInAnotherSite > 0) {
      lines.push(
        `${devices(
          result.devicesSkippedAlreadyInAnotherSite,
        )} were left where they are because they already belong to another site. Re-run with "Move devices that are already assigned to a site" to include them.`,
      );
    }

    if (result.devicesClaimedByHigherPriorityRule > 0) {
      lines.push(
        `${devices(
          result.devicesClaimedByHigherPriorityRule,
        )} matched a higher-priority rule as well, so this rule left them to it. Run that rule to place them.`,
      );
    }

    if (result.devicesFailed > 0) {
      lines.push(
        `${devices(
          result.devicesFailed,
        )} could not be updated. Check the server logs for the reason.`,
      );
    }

    if (result.isTruncated) {
      lines.push(
        `Only the first ${devices(
          result.devicesEvaluated,
        )} were evaluated. Run the rule again to continue through the rest of the project.`,
      );
    }

    return lines.join(" ");
  }

  // The same, for a label rule run.
  public static describeLabelRun(result: LabelRuleRunResult): string {
    const lines: Array<string> = [];

    if (result.devicesLabeled > 0) {
      lines.push(
        `Labelled ${devices(result.devicesLabeled)} (${pluralize(
          result.labelsAttached,
          "label",
          "labels",
        )} attached).`,
      );
    } else {
      lines.push(
        `No labels were attached. This rule matched ${devices(
          result.devicesMatched,
        )} out of the ${devices(result.devicesEvaluated)} it looked at.`,
      );

      /*
       * Matching everything and attaching nothing is the signature of a rule
       * that has already been run — say so, rather than leaving it looking
       * like a failure.
       */
      if (result.devicesMatched > 0) {
        lines.push(
          "Every matching device already carries this rule's labels, so there was nothing to add.",
        );
      }
    }

    if (result.labelsFailed > 0) {
      lines.push(
        `${pluralize(
          result.labelsFailed,
          "label",
          "labels",
        )} could not be attached. Check the server logs for the reason.`,
      );
    }

    if (result.isTruncated) {
      lines.push(
        `Only the first ${devices(
          result.devicesEvaluated,
        )} were evaluated. Run the rule again to continue through the rest of the project.`,
      );
    }

    return lines.join(" ");
  }
}

export default RuleRunSummary;
