import { JSONObject } from "../JSON";

/*
 * What a manual "Run now" of a Network Automation rule did.
 *
 * Both rule kinds fire automatically only when a device is created (and, for
 * site assignment, when its identity changes or on the next poll of a device
 * with no site), so a rule written after an estate was imported never reaches
 * it. "Run now" closes that gap — OneUptime/oneuptime#3191 — and these are the
 * shapes it answers with.
 *
 * They live in Types, not next to the services that produce them, because the
 * dashboard renders the same counters the server computed and neither side
 * should be restating the other's field names.
 */

/*
 * One run of a site assignment rule. Every device the run looked at lands in
 * exactly one bucket, which is what lets the UI explain an assignment count of
 * zero: "nothing matched" and "everything that matched is already there" are
 * very different answers, and a single number cannot tell them apart.
 */
export interface SiteAssignmentRuleRunResult {
  // Devices in the project the run evaluated.
  devicesEvaluated: number;
  // Of those, the ones this rule's criteria matched.
  devicesMatched: number;
  // Matched devices whose site this run actually changed.
  devicesAssigned: number;
  // Matched devices already sitting in this rule's site.
  devicesAlreadyInRuleSite: number;
  /*
   * Matched devices left alone because they are already in some OTHER site
   * and the run was not asked to overwrite existing assignments.
   */
  devicesSkippedAlreadyInAnotherSite: number;
  /*
   * Matched devices a higher-priority rule also matches. Running one rule
   * never does another rule's work, so these are reported rather than moved.
   */
  devicesClaimedByHigherPriorityRule: number;
  // Matched devices whose update threw. Logged server-side, never fatal.
  devicesFailed: number;
  // True when the run stopped at its device cap with devices left over.
  isTruncated: boolean;
}

// One run of a network device label rule.
export interface LabelRuleRunResult {
  // Devices in the project the run evaluated.
  devicesEvaluated: number;
  // Of those, the ones this rule's criteria matched.
  devicesMatched: number;
  /*
   * Matched devices that gained at least one label. Lower than devicesMatched
   * whenever a device already carries everything the rule attaches —
   * re-running a rule is idempotent, not additive.
   */
  devicesLabeled: number;
  // (device, label) pairs actually inserted.
  labelsAttached: number;
  // Pairs whose insert threw. Logged server-side, never fatal.
  labelsFailed: number;
  // True when the run stopped at its device cap with devices left over.
  isTruncated: boolean;
}

/*
 * One run of a network device auto-import rule — automatic (the worker
 * processing a completed scan) or manual ("Run Now" against the project's
 * completed scans, optionally as a dry run that writes nothing).
 *
 * Every discovered host the run looked at lands in a bucket for the same
 * reason as above: "nothing matched", "everything that matched is already in
 * the inventory", and "an exclusion rule vetoed it" are very different
 * answers to "why did this import zero devices".
 */
export interface AutoImportRuleRunResult {
  // Discovered hosts the run evaluated, across every scan it read.
  hostsEvaluated: number;
  // Of those, the ones an import rule matched (exclusions already applied).
  hostsMatched: number;
  // Hosts an exclusion rule vetoed.
  hostsExcluded: number;
  /*
   * Matched hosts skipped because a device with that address already exists
   * — including one created earlier in this same run from a duplicate row or
   * an overlapping scan. Re-running a rule is idempotent, not additive.
   */
  hostsSkippedAlreadyRegistered: number;
  // Devices actually created. Always zero on a dry run.
  devicesCreated: number;
  // Matched hosts whose create threw. Logged server-side, never fatal.
  devicesFailed: number;
  // True when the run stopped at a cap with matched hosts left over.
  isTruncated: boolean;
  // True when this run was a dry run: full evaluation, no writes.
  isDryRun: boolean;
  /*
   * Up to MAX_MATCHED_IP_SAMPLE addresses the run imported (or, on a dry
   * run, would import) — the operator's "which hosts is this rule actually
   * claiming" answer, without shipping a 30k-element array.
   */
  matchedIpAddressSample: Array<string>;
}

// How many addresses matchedIpAddressSample carries at most.
export const MAX_MATCHED_IP_SAMPLE: number = 50;

/*
 * A count off the wire. An absent or non-numeric field reads as zero rather
 * than as NaN: a summary line that says "NaN devices" is worse than one that
 * under-reports a counter the server never sent.
 */
function readCount(json: JSONObject, key: string): number {
  const value: unknown = json[key];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return value;
}

export class RuleRunResultUtil {
  public static parseSiteAssignmentRuleRunResult(
    json: JSONObject | undefined | null,
  ): SiteAssignmentRuleRunResult {
    const source: JSONObject = json || {};

    return {
      devicesEvaluated: readCount(source, "devicesEvaluated"),
      devicesMatched: readCount(source, "devicesMatched"),
      devicesAssigned: readCount(source, "devicesAssigned"),
      devicesAlreadyInRuleSite: readCount(source, "devicesAlreadyInRuleSite"),
      devicesSkippedAlreadyInAnotherSite: readCount(
        source,
        "devicesSkippedAlreadyInAnotherSite",
      ),
      devicesClaimedByHigherPriorityRule: readCount(
        source,
        "devicesClaimedByHigherPriorityRule",
      ),
      devicesFailed: readCount(source, "devicesFailed"),
      isTruncated: source["isTruncated"] === true,
    };
  }

  public static parseLabelRuleRunResult(
    json: JSONObject | undefined | null,
  ): LabelRuleRunResult {
    const source: JSONObject = json || {};

    return {
      devicesEvaluated: readCount(source, "devicesEvaluated"),
      devicesMatched: readCount(source, "devicesMatched"),
      devicesLabeled: readCount(source, "devicesLabeled"),
      labelsAttached: readCount(source, "labelsAttached"),
      labelsFailed: readCount(source, "labelsFailed"),
      isTruncated: source["isTruncated"] === true,
    };
  }

  public static parseAutoImportRuleRunResult(
    json: JSONObject | undefined | null,
  ): AutoImportRuleRunResult {
    const source: JSONObject = json || {};

    const sample: Array<string> = Array.isArray(
      source["matchedIpAddressSample"],
    )
      ? (source["matchedIpAddressSample"] as Array<unknown>)
          .filter((value: unknown) => {
            return typeof value === "string";
          })
          .slice(0, MAX_MATCHED_IP_SAMPLE)
      : [];

    return {
      hostsEvaluated: readCount(source, "hostsEvaluated"),
      hostsMatched: readCount(source, "hostsMatched"),
      hostsExcluded: readCount(source, "hostsExcluded"),
      hostsSkippedAlreadyRegistered: readCount(
        source,
        "hostsSkippedAlreadyRegistered",
      ),
      devicesCreated: readCount(source, "devicesCreated"),
      devicesFailed: readCount(source, "devicesFailed"),
      isTruncated: source["isTruncated"] === true,
      isDryRun: source["isDryRun"] === true,
      matchedIpAddressSample: sample as Array<string>,
    };
  }
}
