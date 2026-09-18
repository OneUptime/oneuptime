import ColumnLength from "../../Types/Database/ColumnLength";

/*
 * The optional operator-supplied name on a Network Device Discovery Scan.
 *
 * WHY IT EXISTS
 *
 * A scan used to be identified by its target alone — `10.15.128.0-255`,
 * `10.240-249.0-254.220-226`. Half a dozen rows in, nothing on the Discovery
 * Scans list says which one was the router sweep and which one was the switch
 * range for a region; the only way to find out is to open each scan and read
 * the range back against a subnet plan kept somewhere else (OneUptime issue
 * #3391). A name is that missing sentence, stored with the scan rather than in
 * a spreadsheet beside it.
 *
 * It is deliberately OPTIONAL and deliberately NOT unique: it is a label for
 * humans, not an identifier. Every scan that existed before this column did
 * has none, and every surface that shows a name therefore has to keep working
 * when it is absent — which is what getScanLabel() below is for.
 *
 * WHY IT LIVES IN Common
 *
 * The same two questions — "is this name storable?" and "what do I call this
 * scan?" — are asked by the create form (App Dashboard), the write hooks
 * (Common server service), the recurring-scan worker (App Workers) and the
 * sweep itself (Probe). Answering them in one module is what keeps the form's
 * error message identical to the server's, and the probe's log line readable
 * against the row the operator is looking at. Same reason ScanTargetUtil sits
 * next door.
 */

/*
 * The parts of a scan that answer "which scan is this?". Structural rather
 * than the model type, so a partially-selected row — the workers and the probe
 * both select two or three columns — satisfies it, and so this module stays
 * importable from the Probe without dragging a database model behind it.
 *
 * Both are nullable: `cidr` is NOT NULL in the database, but a caller that did
 * not select it hands over a row where it is simply missing.
 */
export interface DiscoveryScanIdentity {
  name?: string | null | undefined;
  cidr?: string | null | undefined;
}

export class ScanNameUtil {
  /*
   * Matches the column: NetworkDeviceDiscoveryScan.name is a ShortText, so a
   * longer value does not truncate in Postgres — it throws, failing the whole
   * INSERT. Read off ColumnLength rather than written as 100 so the two cannot
   * drift apart if the column type ever changes.
   */
  public static readonly MAX_SCAN_NAME_LENGTH: number = ColumnLength.ShortText;

  /*
   * ASCII control characters, including DEL. Written as escapes rather than as
   * a literal range so the characters this guards against cannot end up inside
   * the guard itself, and so the file stays readable in a diff.
   *
   * no-control-regex is disabled deliberately, the same way
   * MetricResourceAttributeUtil disables it: a control character inside a
   * user-typed name is precisely what this has to match in order to remove it.
   */
  // eslint-disable-next-line no-control-regex
  private static readonly CONTROL_CHARACTERS: RegExp = /[\u0000-\u001F\u007F]/g;

  /*
   * The name as it should be stored, or null when the operator supplied none.
   *
   * Three things happen here, in this order:
   *
   *   - anything that is not a string becomes null. The value arrives straight
   *     from request JSON (BaseAPI assigns ShortText columns verbatim), so a
   *     client really can hand over a number, an object or an array. Callers
   *     that want to REJECT those call getValidationError() first; this
   *     function's job is only to say what would be stored.
   *   - control characters — a newline pasted out of a spreadsheet cell, a
   *     stray tab — become spaces, and every run of whitespace collapses to a
   *     single space. A name is rendered on one line in a table cell and
   *     inlined into log messages; a multi-line one breaks both, and nothing
   *     downstream would ever repair it.
   *   - the result is trimmed, and an empty result is null rather than "".
   *     "Not named" is one state, not two: an empty string in the column would
   *     read as a name everywhere `name ?` is asked, and render as a blank
   *     first line above the scan target.
   */
  public static normalize(name: unknown): string | null {
    if (typeof name !== "string") {
      return null;
    }

    const collapsed: string = name
      .replace(ScanNameUtil.CONTROL_CHARACTERS, " ")
      .replace(/\s+/g, " ")
      .trim();

    return collapsed.length > 0 ? collapsed : null;
  }

  /*
   * The single validation entry point for a scan name, shared by the create
   * form and both write hooks. Returns null when the name is storable —
   * INCLUDING when there is no name at all, because the field is optional and
   * "" is a perfectly good way to say so.
   *
   * `name` is typed unknown for the same reason ScanTargetUtil's target is:
   * the server hook runs before the model's own type and length checks, so it
   * is the first thing to see whatever the client actually sent.
   */
  public static getValidationError(name: unknown): string | null {
    if (name === undefined || name === null) {
      return null;
    }

    if (typeof name !== "string") {
      return "A scan name must be text.";
    }

    const normalized: string | null = ScanNameUtil.normalize(name);

    if (normalized === null) {
      return null;
    }

    /*
     * Measured against the NORMALIZED value, which is what would be stored:
     * rejecting a 101-character value that is 100 characters plus a trailing
     * newline would be refusing to save something this module was about to fix
     * anyway.
     */
    if (normalized.length > ScanNameUtil.MAX_SCAN_NAME_LENGTH) {
      return (
        `A scan name cannot be longer than ${ScanNameUtil.MAX_SCAN_NAME_LENGTH} characters. ` +
        `This one is ${normalized.length}.`
      );
    }

    return null;
  }

  /*
   * The name to show for a scan, or null when it has none — so a caller can
   * render the scan target instead rather than an empty line.
   *
   * Normalized on the way out as well as on the way in, because rows written
   * before this column existed, and rows written by any writer that bypasses
   * the hooks (migrations, the probe-ingest endpoints), are not guaranteed to
   * have been through normalize().
   */
  public static getDisplayName(scan: DiscoveryScanIdentity): string | null {
    return ScanNameUtil.normalize(scan.name);
  }

  /*
   * How to refer to a scan in one line of running text — a log message, a
   * modal's description, a status note.
   *
   * A named scan carries its target along with it (`Router Discovery — Region
   * 1100 (10.15.128.0-255)`): the name says which scan, the target says what
   * it sweeps, and an operator reading a log line usually wants both. An
   * unnamed one is exactly what it was before this column existed — the target
   * alone.
   *
   * Returns "" when the row has neither, which happens only when the caller
   * selected neither column. Callers append their own fallback (the scan id)
   * rather than having one invented for them here.
   */
  public static getScanLabel(scan: DiscoveryScanIdentity): string {
    const name: string | null = ScanNameUtil.getDisplayName(scan);
    const target: string =
      typeof scan.cidr === "string" ? scan.cidr.trim() : "";

    if (name && target) {
      return `${name} (${target})`;
    }

    return name || target || "";
  }
}

export default ScanNameUtil;
