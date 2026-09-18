import BadDataException from "../../Exception/BadDataException";
import SnmpOid from "./SnmpOid";

/*
 * The one place that decides what a network device actually polls.
 *
 * A device's health OIDs come from two places now: the OID Collection
 * Template it is linked to, and its own `snmpOids` column. Nothing is ever
 * copied between them — the two lists are merged fresh on every poll in
 * NetworkDevicePoll, which is why editing a template changes collection for
 * every linked device without a single write to NetworkDevice.
 *
 * That makes this file load-bearing in three places at once: the poll path
 * that builds the probe payload, the two service validators that reject a
 * bad list at save time, and the dashboard, which has to show an operator
 * the same effective list the probe will receive. Keep it pure so all three
 * can share it.
 */

/*
 * A numeric dotted OID: at least two arcs, digits only. Deliberately not a
 * MIB-name parser — the probe issues these verbatim to net-snmp, which
 * accepts nothing else, and a symbolic name that reaches it is a silent
 * "no such object" rather than an error.
 */
const OID_SYNTAX: RegExp = /^\d+(\.\d+)+$/;

/*
 * The three caps COMPOSE, and that is the whole point of the numbers.
 *
 * A template may hold 150 OIDs and a device may add 50 of its own, so the
 * merged list can never exceed 200. Both write paths validate their own side
 * against their own cap, and together they make the poll-time truncation
 * further down unreachable - which matters because truncation drops from the
 * END, and template entries are deliberately the stable prefix, so the
 * entries lost would always be the operator's own device-specific ones.
 * Somebody growing a shared template must never be able to silently stop a
 * device collecting an OID they never touched.
 *
 * Validating each side independently against one 200 cap would NOT compose:
 * 200 plus 200 is 400, and the operator who loses OIDs is not the operator
 * who made the edit.
 */
export const MAX_OIDS_PER_TEMPLATE: number = 150;
export const MAX_DEVICE_SPECIFIC_OIDS: number = 50;
export const MAX_EFFECTIVE_OIDS_PER_DEVICE: number =
  MAX_OIDS_PER_TEMPLATE + MAX_DEVICE_SPECIFIC_OIDS;

/*
 * A name is carried to the probe and lands on every metric row as an
 * attribute, so it is bounded here rather than left an unbounded string
 * multiplied by every device in a poll batch.
 */
export const MAX_OID_NAME_LENGTH: number = 100;

/*
 * Per-walk metric caps, previously a private const in
 * NetworkDeviceMetricUtil and a bare literal in MonitorMetricUtil. Both now
 * import these. The OID cap was 50 while nothing capped how many OIDs a
 * device could be configured with, so a long list silently charted its first
 * 50 in jsonb array order and warned to a log nobody reads.
 */
export const MAX_OID_METRIC_SERIES: number = MAX_EFFECTIVE_OIDS_PER_DEVICE;
export const MAX_INTERFACE_METRIC_SERIES: number = 200;

/*
 * The specific OIDs the poll already turns into a real, per-port metric
 * series - and ONLY those.
 *
 * Deliberately a short list of columns rather than the whole ifTable
 * subtree. The walk parses twelve ifTable columns, but most of them go
 * nowhere a user can reach: in and out errors are emitted only as a COMBINED
 * rate, discards are parsed and dropped, and speed and admin status are
 * stored on NetworkInterface without ever becoming metrics. For those,
 * typing the OID by hand is currently the only way to get a series, so
 * warning "this is already collected" would be false and would talk an
 * operator out of the only thing that works.
 *
 * What IS listed here is the set behind issue #3507: the reporter was about
 * to hand-type a hundred per-port OIDs for exactly these counters, which the
 * interface walk already emits per port, keyed by interfaceName and
 * interfaceIndex.
 */
const ALREADY_COLLECTED_OID_COLUMNS: Array<{
  prefix: string;
  collectedBy: string;
}> = [
  {
    // ifOperStatus
    prefix: "1.3.6.1.2.1.2.2.1.8.",
    collectedBy: "an up/down series for every port",
  },
  {
    // ifInOctets
    prefix: "1.3.6.1.2.1.2.2.1.10.",
    collectedBy: "an inbound bits/second series for every port",
  },
  {
    // ifOutOctets
    prefix: "1.3.6.1.2.1.2.2.1.16.",
    collectedBy: "an outbound bits/second series for every port",
  },
  {
    // ifHCInOctets
    prefix: "1.3.6.1.2.1.31.1.1.1.6.",
    collectedBy: "an inbound bits/second series for every port",
  },
  {
    // ifHCOutOctets
    prefix: "1.3.6.1.2.1.31.1.1.1.10.",
    collectedBy: "an outbound bits/second series for every port",
  },
];

export interface ValidateOidListOptions {
  max: number;
  // Names the list in every error message: "OID Collection Template", etc.
  label: string;
}

export interface ResolveEffectiveOidsData {
  deviceOids: Array<SnmpOid> | undefined;
  templateOids: Array<SnmpOid> | undefined;
}

export interface EffectiveOidResolution {
  oids: Array<SnmpOid>;
  // How many entries the cap removed. Zero on every well-formed list.
  truncatedCount: number;
}

export default class SnmpOidListUtil {
  /**
   * Canonical form of an OID string, for comparison and for storage.
   *
   * The single leading dot is the one that matters: ".1.3.6.1" and "1.3.6.1"
   * are the same object, operators type both, and net-snmp answers with the
   * dotless form. Storing the canonical form is what lets criteria compare
   * a configured OID against a walk response with ===.
   */
  public static normalizeOid(oid: string | undefined): string {
    let normalized: string = (oid || "").trim();

    if (normalized.startsWith(".")) {
      normalized = normalized.slice(1);
    }

    return normalized;
  }

  public static isValidOid(oid: string | undefined): boolean {
    return OID_SYNTAX.test(SnmpOidListUtil.normalizeOid(oid));
  }

  /**
   * What the poll already collects this OID as, or undefined. Advisory only:
   * the editor warns, it never blocks, because an operator may still want an
   * undimensioned scalar series for one specific port.
   */
  public static getAlreadyCollectedBy(
    oid: string | undefined,
  ): string | undefined {
    const normalized: string = SnmpOidListUtil.normalizeOid(oid);

    for (const entry of ALREADY_COLLECTED_OID_COLUMNS) {
      if (normalized.startsWith(entry.prefix)) {
        return entry.collectedBy;
      }
    }

    return undefined;
  }

  /**
   * Sanitize an OID list at save time, refusing what an operator has to fix
   * by hand and quietly dropping what is only an editor artifact.
   *
   * Both write paths use this: the template service and the device service.
   * Nothing validated snmpOids before, which was survivable when one bad row
   * broke one device; with a template it would break every device linked to
   * it.
   *
   * The split between dropping and throwing is deliberate, and it is about
   * NOT locking anyone out of a settings card they need. Blank rows are what
   * SnmpOidEditor's "Add OID" button leaves behind when a user clicks it and
   * changes their mind, and duplicates can already exist in data written
   * before any of this validation did - both are dropped silently, because
   * refusing them would mean a device carrying one legacy artifact could
   * never be linked to a template until somebody hunted the row down. A
   * genuinely malformed OID does throw: it has never collected anything, the
   * message names it, and the editor that reports the error is on the same
   * card.
   */
  public static validateOidList(
    oids: Array<SnmpOid> | undefined,
    options: ValidateOidListOptions,
  ): Array<SnmpOid> {
    const list: Array<SnmpOid> = oids || [];

    const seen: Set<string> = new Set();
    const sanitized: Array<SnmpOid> = [];

    for (const entry of list) {
      const normalized: string = SnmpOidListUtil.normalizeOid(entry.oid);

      // Editor artifact, not user intent.
      if (!normalized) {
        continue;
      }

      if (!OID_SYNTAX.test(normalized)) {
        throw new BadDataException(
          `${options.label}: "${entry.oid}" is not a numeric OID. Use dotted numbers, for example 1.3.6.1.2.1.1.3.0.`,
        );
      }

      // Keep the first spelling of a duplicate, drop the rest.
      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);

      const name: string | undefined = entry.name?.trim()
        ? entry.name.trim().substring(0, MAX_OID_NAME_LENGTH)
        : undefined;

      sanitized.push({
        ...entry,
        oid: normalized,
        ...(name === undefined ? {} : { name: name }),
      });
    }

    /*
     * Counted AFTER sanitizing, so blank rows and duplicates cannot push a
     * legitimate list over the limit.
     */
    if (sanitized.length > options.max) {
      throw new BadDataException(
        `${options.label}: ${sanitized.length} OIDs is more than the limit of ${options.max}. Remove some, or move them to another template.`,
      );
    }

    return sanitized;
  }

  /**
   * Merge a template's OIDs with a device's own into the list the probe
   * receives.
   *
   * Template entries come FIRST, in template order, and that ordering is
   * load-bearing rather than cosmetic: the effective cap truncates from the
   * end, so the shared items a whole device type depends on have to be the
   * stable prefix. If device additions came first, adding one local OID
   * could silently push a template OID off the end of every device that has
   * one.
   *
   * A duplicate resolves to the DEVICE's entry — it keeps whatever name and
   * description the operator gave it — but it stays at the TEMPLATE's
   * position, for the same reason.
   *
   * Malformed rows are dropped rather than thrown on, because this runs on
   * the poll path against data that was already persisted. The validators
   * above are where a bad row is refused; here, one bad row must not stop a
   * device polling the other ninety-nine.
   */
  public static mergeOidLists(
    templateOids: Array<SnmpOid> | undefined,
    deviceOids: Array<SnmpOid> | undefined,
  ): Array<SnmpOid> {
    const merged: Array<SnmpOid> = [];
    const indexByOid: Map<string, number> = new Map();

    const all: Array<SnmpOid> = [
      ...(templateOids || []),
      ...(deviceOids || []),
    ];

    for (const entry of all) {
      const normalized: string = SnmpOidListUtil.normalizeOid(entry.oid);

      if (!normalized || !OID_SYNTAX.test(normalized)) {
        continue;
      }

      const normalizedEntry: SnmpOid = {
        ...entry,
        oid: normalized,
      };

      const existingIndex: number | undefined = indexByOid.get(normalized);

      if (existingIndex === undefined) {
        indexByOid.set(normalized, merged.length);
        merged.push(normalizedEntry);
        continue;
      }

      // Device entry wins on content, template keeps the position.
      merged[existingIndex] = normalizedEntry;
    }

    return merged;
  }

  /**
   * What this device polls, capped. The cap should be unreachable — both
   * write paths reject an over-cap list with an error the operator can see —
   * so this is the backstop for a template that grew after devices linked to
   * it.
   */
  public static resolveEffectiveOids(
    data: ResolveEffectiveOidsData,
  ): EffectiveOidResolution {
    const merged: Array<SnmpOid> = SnmpOidListUtil.mergeOidLists(
      data.templateOids,
      data.deviceOids,
    );

    if (merged.length <= MAX_EFFECTIVE_OIDS_PER_DEVICE) {
      return {
        oids: merged,
        truncatedCount: 0,
      };
    }

    return {
      oids: merged.slice(0, MAX_EFFECTIVE_OIDS_PER_DEVICE),
      truncatedCount: merged.length - MAX_EFFECTIVE_OIDS_PER_DEVICE,
    };
  }
}
