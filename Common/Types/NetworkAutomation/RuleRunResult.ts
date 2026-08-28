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
  /*
   * Active Network Device monitors a dry run predicts it would create from
   * the rule's selected Monitor Template. Always zero on a real run: real
   * work is counted by monitorsCreated / monitorsFailed instead.
   */
  monitorsWouldCreate: number;
  // Active Network Device monitors actually created and linked to a template.
  monitorsCreated: number;
  /*
   * Matched devices left alone because a Network Device monitor already
   * watches them. Existing manual monitors count too: automation must never
   * add a duplicate simply because it did not create the first one.
   */
  monitorsSkippedAlreadyExisting: number;
  /*
   * Matched hosts that can become inventory records but cannot be backed by a
   * Network Device monitor, such as a ping-only discovery result.
   */
  monitorsSkippedUnsupportedHost: number;
  // Monitor creates that failed after the device was available.
  monitorsFailed: number;
  /*
   * True when the run stopped at the device-create or monitor-create cap
   * with work left over. Running again continues from idempotent inventory
   * and provisioning keys.
   */
  isTruncated: boolean;
  /*
   * True when the project has more completed scans than one manual run
   * reads (the newest MAX_SCANS_PER_AUTO_IMPORT_RULE_RUN). Distinct from
   * isTruncated because the advice differs: re-running re-reads the same
   * newest scans, so hosts that appear ONLY in older scans stay unread.
   */
  hasMoreScans: boolean;
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

function hosts(count: number): string {
  return `${count} ${count === 1 ? "host" : "hosts"}`;
}

function activeMonitors(count: number): string {
  return `${count} active Network Device ${
    count === 1 ? "monitor" : "monitors"
  }`;
}

export class RuleRunResultUtil {
  /*
   * The sentences the auto-import report shows. A run that imported nothing is
   * the common case once a rule has been run, and "0 imported" with no reason
   * reads as a broken button — so every bucket the server counted is reported
   * only when it happened.
   *
   * It lives here rather than beside the browser modal so the App test suite,
   * which has no react in its import graph, can exercise the wording without
   * pulling in the component's react dependency.
   */
  public static describeAutoImportRun(result: AutoImportRuleRunResult): string {
    const lines: Array<string> = [];

    if (result.isDryRun) {
      /*
       * A dry run creates nothing, so devicesCreated is always zero. What a
       * real run would attempt is matched minus already-registered — the
       * server reports it exactly this way (see the engine's dry-run branch).
       */
      const wouldImport: number = Math.max(
        result.hostsMatched - result.hostsSkippedAlreadyRegistered,
        0,
      );

      if (wouldImport > 0) {
        lines.push(
          `This rule would import ${hosts(
            wouldImport,
          )} as network devices. Nothing was written — this was a dry run.`,
        );
      } else {
        lines.push(
          `This rule would import nothing. It matched ${hosts(
            result.hostsMatched,
          )} out of the ${hosts(
            result.hostsEvaluated,
          )} discovered hosts it looked at.`,
        );
      }
    } else if (result.devicesCreated > 0) {
      lines.push(
        `Imported ${hosts(result.devicesCreated)} as network devices.`,
      );
    } else {
      lines.push(
        `No devices were imported. This rule matched ${hosts(
          result.hostsMatched,
        )} out of the ${hosts(
          result.hostsEvaluated,
        )} discovered hosts it looked at.`,
      );
    }

    /*
     * Device import and active-monitor provisioning are separate outcomes. A
     * monitor can fail after its inventory record was safely created, and a
     * dry run predicts monitor work without claiming anything was written.
     */
    if (result.isDryRun && result.monitorsWouldCreate > 0) {
      lines.push(
        `It would also create ${activeMonitors(
          result.monitorsWouldCreate,
        )} from the selected Monitor Template.`,
      );
    } else if (!result.isDryRun && result.monitorsCreated > 0) {
      lines.push(
        `Created ${activeMonitors(
          result.monitorsCreated,
        )} from the selected Monitor Template.`,
      );
    }

    if (result.monitorsSkippedAlreadyExisting > 0) {
      const skippedRequestedMonitors: string = `${
        result.monitorsSkippedAlreadyExisting
      } requested active Network Device ${
        result.monitorsSkippedAlreadyExisting === 1 ? "monitor" : "monitors"
      }`;
      lines.push(
        `${skippedRequestedMonitors} ${
          result.monitorsSkippedAlreadyExisting === 1 ? "was" : "were"
        } skipped because the device already had the requested automatic monitor or a manually configured Network Device monitor.`,
      );
    }

    if (result.monitorsSkippedUnsupportedHost > 0) {
      lines.push(
        `${activeMonitors(
          result.monitorsSkippedUnsupportedHost,
        )} could not be provisioned because the discovery result was not SNMP-capable (for example, a ping-only host).`,
      );
    }

    if (result.monitorsFailed > 0) {
      lines.push(
        `${activeMonitors(
          result.monitorsFailed,
        )} could not be created. Their network devices remain imported; check the server logs for the reason.`,
      );
    }

    if (result.hostsExcluded > 0) {
      lines.push(`An exclusion rule vetoed ${hosts(result.hostsExcluded)}.`);
    }

    if (result.hostsSkippedAlreadyRegistered > 0) {
      lines.push(
        `${hosts(
          result.hostsSkippedAlreadyRegistered,
        )} already had network devices at those addresses, so no duplicate device records were imported.`,
      );
    }

    if (result.devicesFailed > 0) {
      lines.push(
        `${hosts(
          result.devicesFailed,
        )} could not be imported. Check the server logs for the reason.`,
      );
    }

    /*
     * Two different caps, two different truths. The device cap resumes:
     * re-running skips what is already imported and continues. The scan cap
     * does NOT: a re-run re-reads the same newest scans, so promising "run
     * again to continue" there would send the operator in a circle.
     */
    if (result.isTruncated && !result.isDryRun) {
      lines.push(
        "Stopped at the run cap — run again to continue; already-imported hosts are skipped.",
      );
    } else if (result.isTruncated) {
      lines.push(
        "Stopped counting at the run cap — a real run is bounded by the same device-import and active-monitor creation limits.",
      );
    }

    if (result.hasMoreScans) {
      lines.push(
        "Only the newest 100 completed scans were read — hosts that appear only in older scans were not evaluated by this run.",
      );
    }

    return lines.join(" ");
  }

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
      monitorsWouldCreate: readCount(source, "monitorsWouldCreate"),
      monitorsCreated: readCount(source, "monitorsCreated"),
      monitorsSkippedAlreadyExisting: readCount(
        source,
        "monitorsSkippedAlreadyExisting",
      ),
      monitorsSkippedUnsupportedHost: readCount(
        source,
        "monitorsSkippedUnsupportedHost",
      ),
      monitorsFailed: readCount(source, "monitorsFailed"),
      isTruncated: source["isTruncated"] === true,
      hasMoreScans: source["hasMoreScans"] === true,
      isDryRun: source["isDryRun"] === true,
      matchedIpAddressSample: sample as Array<string>,
    };
  }
}
