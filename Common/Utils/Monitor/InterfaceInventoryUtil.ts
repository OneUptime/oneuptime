import ColumnLength from "../../Types/Database/ColumnLength";
import SnmpInterface from "../../Types/Monitor/SnmpMonitor/SnmpInterface";

/*
 * Pure helpers that turn ONE device's IF-MIB walk into the exact rows the
 * NetworkInterface inventory should insert and update, plus the set of
 * interface indexes the user has muted. Everything here is deterministic and
 * side-effect free so the column-by-column contract can be tested without a
 * database; the batched SQL that applies it lives in NetworkInterfaceService.
 *
 * This mirrors EndpointAttachmentUtil.decideUpsert / NetworkEndpointService:
 * the decision is pure, the persistence is one statement per chunk.
 */

/*
 * The stored row, as far as planning cares. Only these two columns are read
 * back from the database: the walk is authoritative for every other column,
 * and isMonitored is the one column it must never touch.
 */
export interface InterfaceExistingRowSnapshot {
  /*
   * Optional to mirror the model, where every column is optional. A stored
   * row without one cannot be matched to a walked interface and is skipped.
   */
  interfaceIndex?: number | undefined;
  isMonitored?: boolean | undefined;
}

/*
 * A NetworkInterface row that does not exist yet.
 *
 * Deliberately NARROWER than InterfaceUpdateRow: the create path has never
 * written inRateMbps / outRateMbps / utilizationPercent / errorsPerSecond,
 * and it must not start. Those four are computed server-side from the delta
 * against the PREVIOUS walk, so on the walk that first discovers an interface
 * they carry whatever the rate util managed to derive with no baseline —
 * writing them here would publish a rate nobody can reproduce. The absence of
 * those fields on this type is the guardrail.
 *
 * isMonitored is `true` rather than `boolean` for the same reason in the
 * opposite direction: new ports are monitored by default, and typing it as a
 * literal keeps a future edit from routing a user-owned value through here.
 */
export interface InterfaceInsertRow {
  interfaceIndex: number;
  name: string;
  alias: string | null;
  macAddress: string | null;
  interfaceType: number | null;
  isMonitored: true;
  isOperationallyUp: boolean;
  isAdministrativelyUp: boolean;
  speedInMbps: number | null;
  lastSeenAt: Date;
}

/*
 * A NetworkInterface row the walk re-observed.
 *
 * There is NO isMonitored member here, and that omission is load-bearing:
 * isMonitored is user-owned (the per-interface mute toggle in the dashboard).
 * A walk that wrote it would silently un-mute every port a user muted on the
 * very next poll, and the mute would appear to "not stick" with nothing in
 * the logs. Keeping the field off the type makes that a compile error.
 *
 * Every other column is written unconditionally, `null` included: the walk is
 * the authority on interface state, so an interface that stops reporting an
 * alias / MAC / speed has genuinely lost it and the stored value must clear.
 */
export interface InterfaceUpdateRow {
  interfaceIndex: number;
  name: string;
  alias: string | null;
  macAddress: string | null;
  interfaceType: number | null;
  isOperationallyUp: boolean;
  isAdministrativelyUp: boolean;
  speedInMbps: number | null;
  inRateMbps: number | null;
  outRateMbps: number | null;
  utilizationPercent: number | null;
  errorsPerSecond: number | null;
  lastSeenAt: Date;
}

export interface InterfaceUpsertPlan {
  inserts: Array<InterfaceInsertRow>;
  updates: Array<InterfaceUpdateRow>;
  /*
   * Walked interfaces whose stored row has isMonitored === false. The caller
   * prunes these out of the in-flight walk response so criteria and
   * per-interface metrics ignore them — while the inventory rows above still
   * record every walked port.
   */
  unmonitoredInterfaceIndexes: Array<number>;
}

// Bits/sec on the wire; Mbps in the inventory.
const BITS_PER_MEGABIT: number = 1000000;

/*
 * Rate columns are stored rounded to three decimals (kbps resolution). The
 * rounding is part of the stored value, not presentation: it keeps a rate
 * that wobbles in the ninth decimal from writing a new row version every poll.
 */
const RATE_DECIMAL_SCALE: number = 1000;

/*
 * ShortText columns are varchar(100). Truncating HERE rather than at write
 * time matters: the raw batched INSERT/UPDATE has no model validation in
 * front of it (DatabaseService.create throws on an over-length value instead
 * of truncating), so one 300-character ifAlias from a chatty agent would
 * abort the whole chunk it rides in and lose every other interface with it.
 */
function truncateShortText(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return value.length > ColumnLength.ShortText
    ? value.substring(0, ColumnLength.ShortText)
    : value;
}

export default class InterfaceInventoryUtil {
  /*
   * (walked interfaces, stored rows, walk timestamp) -> (rows to insert,
   * rows to update, muted indexes).
   *
   * lastSeenAt is stamped from the caller's single `now` for every row, so a
   * 400-port chassis does not end up with 400 slightly different timestamps
   * that make "which ports answered on this walk" unanswerable.
   */
  public static planWalkUpsert(data: {
    walkedInterfaces: Array<SnmpInterface>;
    existingRows: Array<InterfaceExistingRowSnapshot>;
    now: Date;
  }): InterfaceUpsertPlan {
    const plan: InterfaceUpsertPlan = {
      inserts: [],
      updates: [],
      unmonitoredInterfaceIndexes: [],
    };

    /*
     * De-duplicate by ifIndex before anything else.
     *
     * ON CONFLICT DO UPDATE cannot touch the same row twice in one statement
     * — Postgres raises "ON CONFLICT DO UPDATE command cannot affect row a
     * second time" and aborts the statement, which here would abort the whole
     * walk. Agents do send duplicate ifIndex rows (a bridge that reports the
     * same port under two ifTable entries, a proxy agent merging two
     * sub-agents). Map.set keeps the FIRST occurrence's position and the LAST
     * occurrence's data, which is what the previous row-at-a-time loop
     * converged on: it applied both writes in order, so the last one won.
     */
    const walkedByIndex: Map<number, SnmpInterface> = new Map();
    for (const walked of data.walkedInterfaces) {
      walkedByIndex.set(walked.interfaceIndex, walked);
    }

    const existingByIndex: Map<number, InterfaceExistingRowSnapshot> =
      new Map();
    for (const existing of data.existingRows) {
      if (existing.interfaceIndex !== undefined) {
        existingByIndex.set(existing.interfaceIndex, existing);
      }
    }

    for (const walked of walkedByIndex.values()) {
      const existing: InterfaceExistingRowSnapshot | undefined =
        existingByIndex.get(walked.interfaceIndex);

      /*
       * Only a walked interface can be pruned from the walk response, so the
       * muted set is built from the walk, not from the whole stored table.
       */
      if (existing && existing.isMonitored === false) {
        plan.unmonitoredInterfaceIndexes.push(walked.interfaceIndex);
      }

      if (existing) {
        plan.updates.push({
          interfaceIndex: walked.interfaceIndex,
          name: InterfaceInventoryUtil.interfaceName(walked),
          alias: truncateShortText(walked.alias),
          macAddress: truncateShortText(walked.macAddress),
          interfaceType: walked.interfaceType ?? null,
          isOperationallyUp: walked.isOperationallyUp,
          isAdministrativelyUp: walked.isAdministrativelyUp,
          speedInMbps: InterfaceInventoryUtil.toMbps(
            walked.speedInBitsPerSecond,
          ),
          inRateMbps: InterfaceInventoryUtil.toRoundedMbps(
            walked.inBitsPerSecond,
          ),
          outRateMbps: InterfaceInventoryUtil.toRoundedMbps(
            walked.outBitsPerSecond,
          ),
          utilizationPercent: walked.utilizationPercent ?? null,
          errorsPerSecond: walked.errorsPerSecond ?? null,
          lastSeenAt: data.now,
        });
      } else {
        plan.inserts.push({
          interfaceIndex: walked.interfaceIndex,
          name: InterfaceInventoryUtil.interfaceName(walked),
          alias: truncateShortText(walked.alias),
          macAddress: truncateShortText(walked.macAddress),
          interfaceType: walked.interfaceType ?? null,
          isMonitored: true,
          isOperationallyUp: walked.isOperationallyUp,
          isAdministrativelyUp: walked.isAdministrativelyUp,
          speedInMbps: InterfaceInventoryUtil.toMbps(
            walked.speedInBitsPerSecond,
          ),
          lastSeenAt: data.now,
        });
      }
    }

    return plan;
  }

  /*
   * `name` is NOT NULL in the schema, and some agents return an empty
   * ifDescr for tunnel/loopback pseudo-interfaces — hence the empty-string
   * floor rather than a null.
   */
  private static interfaceName(walked: SnmpInterface): string {
    return (walked.name || "").substring(0, ColumnLength.ShortText);
  }

  // ifSpeed/ifHighSpeed are bits per second; speedInMbps is megabits.
  private static toMbps(bitsPerSecond: number | undefined): number | null {
    return bitsPerSecond !== undefined
      ? bitsPerSecond / BITS_PER_MEGABIT
      : null;
  }

  private static toRoundedMbps(
    bitsPerSecond: number | undefined,
  ): number | null {
    if (bitsPerSecond === undefined) {
      return null;
    }
    return (
      Math.round((bitsPerSecond / BITS_PER_MEGABIT) * RATE_DECIMAL_SCALE) /
      RATE_DECIMAL_SCALE
    );
  }
}
