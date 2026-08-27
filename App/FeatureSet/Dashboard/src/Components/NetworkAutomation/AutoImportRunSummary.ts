import { AutoImportRuleRunResult } from "Common/Types/NetworkAutomation/RuleRunResult";

/*
 * The run report's prose, kept out of RunAutoImportRuleModal.tsx so it can
 * be tested in Node.
 *
 * It is a pure string function, but living in a .tsx put React in its
 * import graph, and react is a Dashboard dependency that App's own install
 * never provides — so App/Tests/Dashboard/RunAutoImportRuleModal.test.ts
 * could not resolve it in CI and the whole suite failed to run. Same reason
 * App/Tests/Dashboard reads .tsx sources as text rather than importing
 * them.
 */
function hosts(count: number): string {
  return `${count} ${count === 1 ? "host" : "hosts"}`;
}

function activeMonitors(count: number): string {
  return `${count} active Network Device ${
    count === 1 ? "monitor" : "monitors"
  }`;
}

/*
 * The sentences the report shows, in the style of RuleRunSummary: a run
 * that imported nothing is the common case once a rule has been run, and
 * "0 imported" with no reason reads as a broken button. Every bucket the
 * server counted is reported only when it happened.
 */
export function describeAutoImportRun(result: AutoImportRuleRunResult): string {
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
    lines.push(`Imported ${hosts(result.devicesCreated)} as network devices.`);
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
   * monitor can fail after its inventory record was safely created, and a dry
   * run predicts monitor work without claiming anything was written.
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
