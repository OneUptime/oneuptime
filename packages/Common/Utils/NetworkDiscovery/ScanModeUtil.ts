/*
 * What a Network Device Discovery Scan actually probes each address with.
 *
 * WHY IT EXISTS
 *
 * A discovery scan used to be an SNMP scan, full stop: the sweep pinged every
 * address as a cheap reachability gate and then asked each live one for its
 * SNMP system group. That is the right sweep for a subnet of managed gear, and
 * the wrong one for the case operators kept hitting — "I just want to know what
 * is alive in 10.20.30.0/24". The wizard had no way to say so, and because
 * SNMP Version was a required field on its own step, an ICMP-only scan could
 * not even be submitted: "SNMP Version is required" blocked Next regardless of
 * intent (OneUptime issue #3445).
 *
 * `isSnmpEnabled` on the scan is that missing sentence, and this module is the
 * one place that reads it.
 *
 * WHY THE READ IS `!== false` AND NOT `Boolean(...)`
 *
 * Three writers can hand a scan row to this predicate, and only one of them is
 * guaranteed to have the column:
 *
 *   - The database, where the column is NOT NULL DEFAULT true, so every scan
 *     that predates it reads as SNMP-enabled — which is what those scans were.
 *   - The probe-ingest payload, where the column only appears if the SERVER is
 *     new enough to select it. A new probe polling an older server would
 *     otherwise see `undefined`, read it as "SNMP is off", and quietly stop
 *     doing SNMP discovery on every scan in the project.
 *   - A direct API call, which may simply omit it.
 *
 * So absence means "SNMP", exactly as it did before the column existed, and
 * only an EXPLICIT false turns it off. Same defensive shape as
 * `snmpReachable === false` in DiscoveryImportEligibility, and for the same
 * reason: the legacy value of a new optional flag has to keep meaning what the
 * rows already on disk meant.
 *
 * WHY IT LIVES IN Common
 *
 * The question "does this scan do SNMP?" is asked by the create/edit form (App
 * Dashboard), the probe-ingest endpoints (App Telemetry), the sweep itself
 * (Probe) and the results dialog. One copy is what stops the wizard hiding the
 * SNMP fields for a scan the probe then SNMP-probes anyway. Same reason
 * ScanNameUtil and ScanTargetUtil sit next door.
 */

/*
 * The part of a scan that answers "what does this sweep probe with?".
 * Structural rather than the model type, so a partially-selected row — the
 * probe selects a dozen columns, the ingest endpoint fewer — satisfies it, and
 * so this module stays importable from the Probe without dragging a database
 * model behind it.
 */
export interface DiscoveryScanMode {
  isSnmpEnabled?: boolean | null | undefined;
}

/*
 * How a scan describes itself in one short phrase — for a table cell, a badge,
 * or a log line. Deliberately names ICMP the way the wizard does ("Ping only")
 * rather than by protocol, because that is the word the operator chose.
 */
export enum ScanMethodLabel {
  PingAndSnmp = "Ping + SNMP",
  PingOnly = "Ping only",
}

export class ScanModeUtil {
  /**
   * True when this scan should probe SNMP after the ICMP sweep.
   *
   * Absence reads as TRUE — see the module comment. Callers must ask through
   * this rather than reading the column, so that "the wizard hid the SNMP
   * fields" and "the probe skipped SNMP" can never disagree.
   */
  public static isSnmpEnabled(
    scan: DiscoveryScanMode | null | undefined,
  ): boolean {
    return scan?.isSnmpEnabled !== false;
  }

  /**
   * True when this scan is an ICMP ping sweep and nothing else.
   *
   * The exact negation of isSnmpEnabled, spelled out because most callers read
   * better asking the positive question about the case they are handling — a
   * `showIf` that hides the SNMP step, a status message that must not mention
   * SNMP — and a bare `!` in front of a predicate is easy to lose in a diff.
   */
  public static isIcmpOnly(
    scan: DiscoveryScanMode | null | undefined,
  ): boolean {
    return !ScanModeUtil.isSnmpEnabled(scan);
  }

  /** The scan's method as a short phrase for a badge or a log line. */
  public static getMethodLabel(
    scan: DiscoveryScanMode | null | undefined,
  ): ScanMethodLabel {
    return ScanModeUtil.isSnmpEnabled(scan)
      ? ScanMethodLabel.PingAndSnmp
      : ScanMethodLabel.PingOnly;
  }
}

export default ScanModeUtil;
