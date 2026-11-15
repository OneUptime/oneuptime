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
 * the decision is pure, the persistence is one statement per chunk - and, as
 * there, a row the walk would leave as it is costs no write at all.
 */

/*
 * How long a stored interface may go unwritten before a walk that found
 * nothing new about it writes it anyway, to move its lastSeenAt.
 *
 * A walk used to rewrite every interface it saw, on every poll: 3 million
 * interfaces on five-minute polls is 10,000 new row versions a second, each
 * one WAL, a dead tuple and vacuum work, for rows that had not changed.
 * Now an interface whose inventory and state are as stored, and whose rates
 * have not moved noticeably (ratesMoved), is written once per this window:
 * once in every three polls at the default five minutes.
 *
 * Nothing in the product reads an interface's lastSeenAt: the device list,
 * the Interfaces tab, the topology and the alerting all read the device's
 * own lastSeenAt / lastSnmpSeenAt, and the interface's state. So an
 * interface's lastSeenAt is accurate to this window (and one poll), and the
 * API says so.
 */
export const INTERFACE_LAST_SEEN_REFRESH_MS: number = 15 * 60 * 1000;

/*
 * The refresh is spread across the window, not taken all at once: each
 * interface counts its window on a clock of its own, offset by its ifIndex
 * in steps of a fifteenth of the window (refreshSlot). A switch's ports then
 * come due a few at a time - a third of them on each five-minute poll -
 * rather than all of them on every third poll.
 *
 * That is what lets the refresh be a HOT update. A walk writes a device's
 * ports in one statement, and its rows sit together on a page or two. A
 * page takes a HOT update only into room it has free while the statement
 * runs, because the rows it replaces are not dead until the statement
 * commits: rewriting every port on a page at once needed half the page
 * free, so most of each refresh left the page, wrote an entry into every
 * index, and left dead ones for vacuum. A third of the ports needs a
 * quarter of the page, which is about the room the table keeps (fillfactor,
 * SetNetworkInterfaceFillfactor1809164000000).
 */
export const INTERFACE_REFRESH_GROUPS: number = 15;

/*
 * When a walk writes an interface's readings again (ratesMoved). The stored
 * readings are what the Interfaces tab, the device's interface preview and
 * the topology's links show; their history is in the interface metrics,
 * written on every poll. A reading is written again when it moves by at
 * least a tenth of the larger of the two readings AND by more than noise:
 *
 *   in / out rate     1% of the link's speed, 1 Mbps when it reports none
 *   utilization       one percentage point
 *   errors / second   0.01, the resolution it is stored at
 *
 * and always when it crosses a line a reader draws: utilization reaching or
 * leaving INTERFACE_SATURATION_THRESHOLD_PERCENT (a saturated link on the
 * map, a highlighted row in the preview), errors starting or stopping (the
 * preview's attention order), and a reading appearing or going away (a dash
 * in the table).
 */
export const INTERFACE_READING_RELATIVE_CHANGE: number = 0.1;
export const INTERFACE_RATE_FLOOR_SHARE_OF_SPEED: number = 0.01;
export const INTERFACE_RATE_FLOOR_MBPS_WITHOUT_SPEED: number = 1;
export const INTERFACE_UTILIZATION_FLOOR_PERCENT: number = 1;
export const INTERFACE_ERRORS_FLOOR_PER_SECOND: number = 0.01;

/*
 * Utilization at or above this reads as saturated: the topology's link state
 * (LINK_SATURATION_THRESHOLD_PERCENT in the dashboard) and the interface
 * preview's highlight both draw the line here.
 */
export const INTERFACE_SATURATION_THRESHOLD_PERCENT: number = 80;

/*
 * The stored row, as far as planning cares: the user-owned isMonitored, and
 * every column the walk writes, so a row the walk would leave as it is can
 * be left unwritten (InterfaceInventoryUtil.needsWrite).
 *
 * Every column is optional, as in the model, and a column that is null in
 * the database may come back as null or undefined: both read as "nothing
 * stored".
 */
export interface InterfaceExistingRowSnapshot {
  /*
   * A stored row without one cannot be matched to a walked interface and is
   * skipped.
   */
  interfaceIndex?: number | undefined;
  isMonitored?: boolean | undefined;
  name?: string | null | undefined;
  alias?: string | null | undefined;
  macAddress?: string | null | undefined;
  interfaceType?: number | null | undefined;
  isOperationallyUp?: boolean | null | undefined;
  isAdministrativelyUp?: boolean | null | undefined;
  speedInMbps?: number | null | undefined;
  inRateMbps?: number | null | undefined;
  outRateMbps?: number | null | undefined;
  utilizationPercent?: number | null | undefined;
  errorsPerSecond?: number | null | undefined;
  lastSeenAt?: Date | string | null | undefined;
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
 * A row that is written gets every other column, `null` included: the walk is
 * the authority on interface state, so an interface that stops reporting an
 * alias / MAC / speed has genuinely lost it and the stored value must clear.
 * Whether a row is written at all is needsWrite's call.
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
   * Walked interfaces whose stored row is left as it is: nothing about them
   * changed and their refresh is not due (needsWrite), or a newer walk
   * already wrote them.
   */
  unchangedInterfaceIndexes: Array<number>;
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
 * rounding is part of the stored value, not presentation. Whether a moved
 * rate is written at all is ratesMoved's call.
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
   * rows to update, rows left as they are, muted indexes).
   *
   * lastSeenAt is stamped from the caller's single `now` for every row, so a
   * 400-port chassis does not end up with 400 slightly different timestamps
   * that make "which ports answered on this walk" unanswerable.
   *
   * A known interface is updated only when needsWrite says so; otherwise it
   * is listed as unchanged and costs nothing. `refreshMs` is for tests.
   */
  public static planWalkUpsert(data: {
    walkedInterfaces: Array<SnmpInterface>;
    existingRows: Array<InterfaceExistingRowSnapshot>;
    now: Date;
    refreshMs?: number | undefined;
  }): InterfaceUpsertPlan {
    const plan: InterfaceUpsertPlan = {
      inserts: [],
      updates: [],
      unchangedInterfaceIndexes: [],
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
        const update: InterfaceUpdateRow = {
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
        };

        if (
          InterfaceInventoryUtil.needsWrite({
            stored: existing,
            update: update,
            now: data.now,
            refreshMs: data.refreshMs,
          })
        ) {
          plan.updates.push(update);
        } else {
          plan.unchangedInterfaceIndexes.push(walked.interfaceIndex);
        }
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
   * Whether a walk writes a stored interface again, given the row the walk
   * would write. In order:
   *
   *  1. Never when the row was last seen at or after this walk. A newer walk
   *     wrote it, and the UPDATE's own WHERE would refuse it anyway (an older
   *     poll processed after a newer one, OneUptime issue #7389).
   *  2. Always when the row has no lastSeenAt, or was last written in an
   *     earlier refresh slot of its own (refreshSlot: a window of
   *     INTERFACE_LAST_SEEN_REFRESH_MS, offset by its ifIndex): its
   *     lastSeenAt moves, and so does any reading that moved too little to
   *     be written on its own. So an answering interface's lastSeenAt is
   *     never more than one window and one poll old.
   *  3. Always when anything the walk reads about the port changed: its
   *     name, alias, MAC, type, speed, or its operational or administrative
   *     state. Compared exactly, after the same truncation and unit
   *     conversion the write applies.
   *  4. When a reading moved noticeably (ratesMoved).
   *
   * Otherwise the row is left as it is. isMonitored plays no part: the walk
   * never writes it.
   */
  public static needsWrite(data: {
    stored: InterfaceExistingRowSnapshot;
    update: InterfaceUpdateRow;
    now: Date;
    refreshMs?: number | undefined;
  }): boolean {
    const stored: InterfaceExistingRowSnapshot = data.stored;
    const update: InterfaceUpdateRow = data.update;
    const lastSeenAt: number | null = InterfaceInventoryUtil.toTime(
      stored.lastSeenAt,
    );

    if (lastSeenAt !== null && lastSeenAt >= data.now.getTime()) {
      return false;
    }

    if (lastSeenAt === null) {
      return true;
    }

    const refreshMs: number = data.refreshMs ?? INTERFACE_LAST_SEEN_REFRESH_MS;

    if (
      InterfaceInventoryUtil.refreshSlot({
        time: data.now.getTime(),
        interfaceIndex: update.interfaceIndex,
        refreshMs: refreshMs,
      }) >
      InterfaceInventoryUtil.refreshSlot({
        time: lastSeenAt,
        interfaceIndex: update.interfaceIndex,
        refreshMs: refreshMs,
      })
    ) {
      return true;
    }

    if (
      !InterfaceInventoryUtil.isSame(stored.name, update.name) ||
      !InterfaceInventoryUtil.isSame(stored.alias, update.alias) ||
      !InterfaceInventoryUtil.isSame(stored.macAddress, update.macAddress) ||
      !InterfaceInventoryUtil.isSame(
        stored.interfaceType,
        update.interfaceType,
      ) ||
      !InterfaceInventoryUtil.isSame(
        stored.isOperationallyUp,
        update.isOperationallyUp,
      ) ||
      !InterfaceInventoryUtil.isSame(
        stored.isAdministrativelyUp,
        update.isAdministrativelyUp,
      ) ||
      !InterfaceInventoryUtil.isSame(stored.speedInMbps, update.speedInMbps)
    ) {
      return true;
    }

    return InterfaceInventoryUtil.ratesMoved({ stored, update });
  }

  /*
   * Which refresh window of its own a time falls in, for one interface:
   * windows of `refreshMs`, offset by the interface's ifIndex in steps of
   * 1/INTERFACE_REFRESH_GROUPS of a window. Interfaces whose ifIndex differs
   * by one come due a fifteenth of a window apart, so a device's ports are
   * spread evenly across it (see INTERFACE_REFRESH_GROUPS for why).
   */
  public static refreshSlot(data: {
    time: number;
    interfaceIndex: number;
    refreshMs: number;
  }): number {
    const group: number =
      ((Math.trunc(data.interfaceIndex) % INTERFACE_REFRESH_GROUPS) +
        INTERFACE_REFRESH_GROUPS) %
      INTERFACE_REFRESH_GROUPS;

    return Math.floor(
      (data.time + (group * data.refreshMs) / INTERFACE_REFRESH_GROUPS) /
        data.refreshMs,
    );
  }

  /*
   * Whether any of the four readings moved enough to be written on its own
   * (see INTERFACE_READING_RELATIVE_CHANGE for the rule and why).
   */
  public static ratesMoved(data: {
    stored: InterfaceExistingRowSnapshot;
    update: InterfaceUpdateRow;
  }): boolean {
    const stored: InterfaceExistingRowSnapshot = data.stored;
    const update: InterfaceUpdateRow = data.update;

    const rateFloorMbps: number =
      update.speedInMbps !== null && update.speedInMbps > 0
        ? update.speedInMbps * INTERFACE_RATE_FLOOR_SHARE_OF_SPEED
        : INTERFACE_RATE_FLOOR_MBPS_WITHOUT_SPEED;

    const isSaturated: (utilization: number | null | undefined) => boolean = (
      utilization: number | null | undefined,
    ): boolean => {
      return (utilization ?? 0) >= INTERFACE_SATURATION_THRESHOLD_PERCENT;
    };

    const hasErrors: (errorsPerSecond: number | null | undefined) => boolean = (
      errorsPerSecond: number | null | undefined,
    ): boolean => {
      return (errorsPerSecond ?? 0) > 0;
    };

    return (
      InterfaceInventoryUtil.readingMoved(
        stored.inRateMbps,
        update.inRateMbps,
        rateFloorMbps,
      ) ||
      InterfaceInventoryUtil.readingMoved(
        stored.outRateMbps,
        update.outRateMbps,
        rateFloorMbps,
      ) ||
      InterfaceInventoryUtil.readingMoved(
        stored.utilizationPercent,
        update.utilizationPercent,
        INTERFACE_UTILIZATION_FLOOR_PERCENT,
      ) ||
      isSaturated(stored.utilizationPercent) !==
        isSaturated(update.utilizationPercent) ||
      InterfaceInventoryUtil.readingMoved(
        stored.errorsPerSecond,
        update.errorsPerSecond,
        INTERFACE_ERRORS_FLOOR_PER_SECOND,
      ) ||
      hasErrors(stored.errorsPerSecond) !== hasErrors(update.errorsPerSecond)
    );
  }

  /*
   * A reading that appeared or went away moved; two readings moved when
   * they are at least `floor` apart and at least a tenth of the larger one.
   */
  private static readingMoved(
    stored: number | null | undefined,
    current: number | null,
    floor: number,
  ): boolean {
    const before: number | null = stored ?? null;

    if (before === null || current === null) {
      return before !== current;
    }

    const change: number = Math.abs(current - before);

    return (
      change >= floor &&
      change >=
        INTERFACE_READING_RELATIVE_CHANGE *
          Math.max(Math.abs(before), Math.abs(current))
    );
  }

  // Null and undefined are both "nothing stored".
  private static isSame(
    stored: string | number | boolean | null | undefined,
    current: string | number | boolean | null,
  ): boolean {
    return (stored ?? null) === current;
  }

  private static toTime(
    value: Date | string | null | undefined,
  ): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    const time: number = new Date(value).getTime();

    return isNaN(time) ? null : time;
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
