import DatabaseService from "./DatabaseService";
import Select from "../Types/Database/Select";
import logger from "../Utils/Logger";
import Model from "../../Models/DatabaseModels/NetworkInterface";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import SnmpInterface from "../../Types/Monitor/SnmpMonitor/SnmpInterface";
import InterfaceInventoryUtil, {
  InterfaceExistingRowSnapshot,
  InterfaceInsertRow,
  InterfaceUpdateRow,
  InterfaceUpsertPlan,
} from "../../Utils/Monitor/InterfaceInventoryUtil";

/*
 * Rows written per statement. An interface row carries 13 insert parameters,
 * so a chunk peaks at 6,500 — an order of magnitude below Postgres' 65,535
 * parameter ceiling — while turning a 400-port chassis into one statement per
 * 500 ports instead of one per port.
 */
const INTERFACE_UPSERT_BATCH_SIZE: number = 500;

/*
 * Column order used by the INSERT in upsertWalkedInterfaces. Keep this and
 * the generated parameter tuples in perfect sync.
 */
const INSERT_COLUMNS: Array<string> = [
  "projectId",
  "networkDeviceId",
  "interfaceIndex",
  "name",
  "alias",
  "macAddress",
  "interfaceType",
  "isMonitored",
  "isOperationallyUp",
  "isAdministrativelyUp",
  "speedInMbps",
  "lastSeenAt",
  "version",
];

/*
 * What upsertWalkedInterfaces reads of each stored interface: the user-owned
 * isMonitored, and every column a walk writes, for
 * InterfaceInventoryUtil.needsWrite to compare with.
 */
export const INTERFACE_SNAPSHOT_SELECT: Select<Model> = {
  interfaceIndex: true,
  isMonitored: true,
  name: true,
  alias: true,
  macAddress: true,
  interfaceType: true,
  isOperationallyUp: true,
  isAdministrativelyUp: true,
  speedInMbps: true,
  inRateMbps: true,
  outRateMbps: true,
  utilizationPercent: true,
  errorsPerSecond: true,
  lastSeenAt: true,
};

// What the walk pipeline needs back from a walk's inventory write.
export interface InterfaceWalkUpsertResult {
  /*
   * Walked interfaces the user has muted (isMonitored === false). The caller
   * prunes these from the in-flight response so criteria and per-interface
   * metrics skip them.
   */
  unmonitoredInterfaceIndexes: Array<number>;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Applies one device walk's IF-MIB snapshot to the interface inventory.
   *
   * This used to be a per-interface loop of create() / updateOneById(), and
   * because DatabaseService._updateBy issues a SELECT before every UPDATE,
   * one walk of a 50-port switch cost 101 statements. At the fleet size this
   * product now targets (80,000 devices on a five-minute interval is 267
   * walks/sec) that is ~26,700 statements/sec of pure round-trip — more
   * database wait per second than there are seconds. The walk now costs one
   * SELECT plus one statement per 500 new ports and one per 500 ports it
   * writes again: 3 statements for a switch with a mix, and for a stable
   * one its read plus a statement for the third of its ports whose refresh
   * came due.
   *
   * The column-by-column decision is pure and lives in
   * InterfaceInventoryUtil.planWalkUpsert; this method only batches the read
   * and applies the plan. Three invariants ride on that split and are
   * asserted there as well as here:
   *
   *  - isMonitored is written on CREATE only. It is the user's per-port mute
   *    toggle; a walk that wrote it would un-mute every muted port on the
   *    next poll.
   *  - the create column set is narrower than the update column set (no rate
   *    columns), because a first sighting has no counter delta to derive a
   *    rate from.
   *  - a known interface is written only when something about it changed,
   *    a reading moved noticeably, or its refresh came due - once every
   *    INTERFACE_LAST_SEEN_REFRESH_MS, a third of a switch's ports on each
   *    five-minute poll (InterfaceInventoryUtil.needsWrite). A walk used to
   *    rewrite every interface it saw: at 3 million interfaces on
   *    five-minute polls, 10,000 row versions a second for rows that had
   *    not changed - the WAL, the dead tuples and the vacuum work of a
   *    network inventory that holds still. A stable switch now writes a
   *    third as many rows, and those as HOT updates. So the read takes
   *    every column the walk writes, to compare with.
   *
   * `now` is when OneUptime received the poll (OneUptime issue #7389), and a
   * row is written only where it was last seen before then: an older walk
   * processed after a newer one - a retried job, or one that waited longer
   * in the queue - leaves the newer walk's rows as they are, and still adds
   * the interfaces the newer walk did not report. Both statements ask it in
   * their own WHERE, so a walk written at the same moment is judged by the
   * row as that walk left it.
   *
   * A row's lastSeenAt alone no longer says which walk is newest, because a
   * newer walk that found a row unchanged leaves it unwritten. So both
   * statements also ask the device: a walk whose device records a newer
   * successful walk ("lastSnmpSeenAt", which the poll's verdict moves before
   * its interfaces are written, and never backwards) writes no known row.
   * Without that, the older walk would put its state back over the state
   * the newer walk saw and confirmed by leaving it alone.
   */
  public async upsertWalkedInterfaces(data: {
    projectId: ObjectID;
    deviceId: ObjectID;
    walkedInterfaces: Array<SnmpInterface>;
    now: Date;
  }): Promise<InterfaceWalkUpsertResult> {
    /*
     * A walk that reported no interfaces (interface collection off, or an
     * unreachable device) must read nothing and write nothing — in
     * particular it must never build an empty `VALUES ()`, which is a syntax
     * error rather than a no-op.
     */
    if (data.walkedInterfaces.length === 0) {
      return { unmonitoredInterfaceIndexes: [] };
    }

    /*
     * isMonitored, precisely because it is the column we must NOT write, and
     * every column the walk writes, so a row it would leave as it is goes
     * unwritten. They come from the heap page the device's rows are on
     * either way.
     */
    const existingRows: Array<Model> = await this.findBy({
      query: {
        networkDeviceId: data.deviceId,
      },
      select: INTERFACE_SNAPSHOT_SELECT,
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const plan: InterfaceUpsertPlan = InterfaceInventoryUtil.planWalkUpsert({
      walkedInterfaces: data.walkedInterfaces,
      existingRows: existingRows.map(
        (row: Model): InterfaceExistingRowSnapshot => {
          return {
            interfaceIndex: row.interfaceIndex,
            isMonitored: row.isMonitored,
            name: row.name,
            alias: row.alias,
            macAddress: row.macAddress,
            interfaceType: row.interfaceType,
            isOperationallyUp: row.isOperationallyUp,
            isAdministrativelyUp: row.isAdministrativelyUp,
            speedInMbps: row.speedInMbps,
            inRateMbps: row.inRateMbps,
            outRateMbps: row.outRateMbps,
            utilizationPercent: row.utilizationPercent,
            errorsPerSecond: row.errorsPerSecond,
            lastSeenAt: row.lastSeenAt,
          };
        },
      ),
      now: data.now,
    });

    await this.bulkInsertInterfaces({
      projectId: data.projectId,
      deviceId: data.deviceId,
      rows: plan.inserts,
    });

    await this.bulkUpdateInterfaces({
      deviceId: data.deviceId,
      seenAt: data.now,
      rows: plan.updates,
    });

    return {
      unmonitoredInterfaceIndexes: plan.unmonitoredInterfaceIndexes,
    };
  }

  /*
   * Interfaces this device has never reported before.
   *
   * ON CONFLICT names the partial unique index
   * IDX_network_interface_device_ifindex — ("networkDeviceId",
   * "interfaceIndex") WHERE "deletedAt" IS NULL. The predicate is REQUIRED:
   * without it Postgres cannot infer a partial index and the statement fails
   * outright with "there is no unique or exclusion constraint matching the
   * ON CONFLICT specification". It is also what keeps a soft-deleted
   * interface from colliding with a rediscovered ifIndex.
   *
   * The DO UPDATE branch only fires when the row appeared between the findBy
   * above and this INSERT — a concurrent walk of the same device, or a device
   * with more than LIMIT_MAX interfaces whose stored rows did not all fit in
   * the read. It then applies the update path's semantics so the observation
   * is not silently dropped, including its rules that a row last seen at or
   * after this walk is left alone, and so is every row of a device that
   * records a newer successful walk. It writes the row whether or not it
   * changed: it never read it. Two columns are deliberately absent from it:
   *
   *  - "isMonitored", so the race can never resurrect a muted port; and
   *  - the four rate columns, which this statement does not carry at all
   *    (see InterfaceInsertRow) — leaving them out keeps the stored reading
   *    rather than nulling it, and the next poll writes a real one.
   */
  private async bulkInsertInterfaces(data: {
    projectId: ObjectID;
    deviceId: ObjectID;
    rows: Array<InterfaceInsertRow>;
  }): Promise<void> {
    if (data.rows.length === 0) {
      return;
    }

    for (
      let i: number = 0;
      i < data.rows.length;
      i += INTERFACE_UPSERT_BATCH_SIZE
    ) {
      const chunk: Array<InterfaceInsertRow> = data.rows.slice(
        i,
        i + INTERFACE_UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [];
      let paramIndex: number = 1;

      for (const row of chunk) {
        const placeholders: Array<string> = [];
        for (let c: number = 0; c < INSERT_COLUMNS.length; c++) {
          placeholders.push(`$${paramIndex++}`);
        }
        valueFragments.push(`(${placeholders.join(", ")})`);

        params.push(
          data.projectId.toString(),
          data.deviceId.toString(),
          row.interfaceIndex,
          row.name,
          row.alias,
          row.macAddress,
          row.interfaceType,
          row.isMonitored,
          row.isOperationallyUp,
          row.isAdministrativelyUp,
          row.speedInMbps,
          row.lastSeenAt,
          /*
           * BaseModel's @VersionColumn is NOT NULL with no database default,
           * so the raw INSERT has to seed it. 1, not 0: TypeORM's save() —
           * which is what DatabaseService.create used to run for every walked
           * interface — starts the counter at 1, and a row's version should
           * mean the same thing whichever path created it.
           */
          1,
        );
      }

      const sql: string = `
        INSERT INTO "NetworkInterface" (
          "projectId", "networkDeviceId", "interfaceIndex",
          "name", "alias", "macAddress", "interfaceType",
          "isMonitored", "isOperationallyUp", "isAdministrativelyUp",
          "speedInMbps", "lastSeenAt", "version"
        )
        VALUES ${valueFragments.join(", ")}
        ON CONFLICT ("networkDeviceId", "interfaceIndex") WHERE "deletedAt" IS NULL
        DO UPDATE SET
          "name" = EXCLUDED."name",
          "alias" = EXCLUDED."alias",
          "macAddress" = EXCLUDED."macAddress",
          "interfaceType" = EXCLUDED."interfaceType",
          "isOperationallyUp" = EXCLUDED."isOperationallyUp",
          "isAdministrativelyUp" = EXCLUDED."isAdministrativelyUp",
          "speedInMbps" = EXCLUDED."speedInMbps",
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "version" = "NetworkInterface"."version" + 1,
          "updatedAt" = now()
        WHERE ("NetworkInterface"."lastSeenAt" IS NULL
            OR "NetworkInterface"."lastSeenAt" < EXCLUDED."lastSeenAt")
          AND NOT EXISTS (
            SELECT 1 FROM "NetworkDevice" AS d
            WHERE d."_id" = EXCLUDED."networkDeviceId"
              AND d."lastSnmpSeenAt" > EXCLUDED."lastSeenAt"
          )
      `;

      await this.runChunkWithRowFallback({
        sql: sql,
        params: params,
        chunk: chunk,
        deviceId: data.deviceId,
        runOne: async (row: InterfaceInsertRow): Promise<void> => {
          await this.bulkInsertInterfaces({
            projectId: data.projectId,
            deviceId: data.deviceId,
            rows: [row],
          });
        },
      });
    }
  }

  /*
   * Runs one batched statement, and — only if it fails — re-runs its rows one
   * at a time so a single malformed interface costs only itself.
   *
   * This is the one thing batching trades away, and it is worth buying back.
   * A walk carrying an out-of-range `interfaceIndex` (a nonconforming agent
   * can send an OID sub-identifier above 2^31, which is representable but not
   * a valid IF-MIB InterfaceIndex) makes Postgres reject the WHOLE statement:
   * `value "4294967295" is out of range for type integer`, rows written 0. The
   * row-at-a-time loop this replaced lost only the rows AFTER the bad one; a
   * chunk loses up to five hundred good ports with it. And because the bad row
   * is in every walk, that loss is permanent rather than one cycle — the
   * device's other interfaces would never appear at all.
   *
   * The fallback costs nothing in the steady state (it only runs after a
   * throw), and a row that fails on its own is logged with its ifIndex and
   * skipped, so the rest of the walk — and the rest of `updateFromWalk`,
   * including endpoint discovery — still happens.
   */
  private async runChunkWithRowFallback<
    TRow extends { interfaceIndex: number },
  >(data: {
    sql: string;
    params: Array<unknown>;
    chunk: Array<TRow>;
    deviceId: ObjectID;
    runOne: (row: TRow) => Promise<void>;
  }): Promise<void> {
    try {
      await this.getRepository().manager.query(data.sql, data.params);
      return;
    } catch (error) {
      if (data.chunk.length === 1) {
        // Already a single row — this one is genuinely unwritable.
        logger.error(
          `NetworkInterfaceService: dropping interface ${data.chunk[0]?.interfaceIndex} on device ${data.deviceId.toString()} — it cannot be written: ${error}`,
        );
        return;
      }

      logger.warn(
        `NetworkInterfaceService: a batched interface write failed for device ${data.deviceId.toString()}; retrying its ${data.chunk.length} rows individually so one bad interface does not cost the rest: ${error}`,
      );
    }

    for (const row of data.chunk) {
      await data.runOne(row);
    }
  }

  /*
   * Interfaces already in inventory that the plan writes. One UPDATE ...
   * FROM (VALUES ...) per chunk, joined on the same ("networkDeviceId",
   * "interfaceIndex") key the unique index covers, with "deletedAt" IS NULL
   * so a soft-deleted row is never resurrected.
   *
   * The walk's time is one parameter ($2), as every row of a walk is seen at
   * the same `now` (the plan stamps it on each row's lastSeenAt, so it is
   * the one value all of theirs hold). It is the time the rows are stamped
   * with, the per-row guard's (a row last seen at or after it is left
   * alone), and the device guard's (a device that records a newer
   * successful walk has none of its rows written). The device guard names
   * no column of the joined rows, so Postgres evaluates it once per
   * statement, not once per row.
   *
   * Nothing it writes is in an index on the table, nor in the unique
   * index's predicate, so with the room the table's fillfactor keeps on
   * each page, every one of these updates can be HOT: no index entry, and
   * the page reclaims the old row version without vacuum.
   *
   * Every placeholder carries an explicit ::type cast. Postgres types a bare
   * VALUES list from its FIRST row, so a chunk whose first interface reports
   * no alias/MAC/speed would otherwise type those columns as `text`/`unknown`
   * and fail the join or the assignment once a later row supplies a real
   * value — a bug that hides on a tidy test fixture and fires on the first
   * real chassis. Only the first tuple strictly needs the casts; casting all
   * of them costs nothing and survives a future reordering of the chunk.
   *
   * The rows are scoped by networkDeviceId alone — exactly the query the
   * findBy in upsertWalkedInterfaces used, so an inventory row is written by
   * this path if and only if the previous loop would have written it.
   *
   * "version" is bumped by hand because DatabaseService._updateBy emulates
   * the @VersionColumn bump that TypeORM's update() does not do; keeping it
   * here keeps the audit counter continuous across this change.
   */
  private async bulkUpdateInterfaces(data: {
    deviceId: ObjectID;
    // The walk's `now`: when OneUptime received the poll.
    seenAt: Date;
    rows: Array<InterfaceUpdateRow>;
  }): Promise<void> {
    if (data.rows.length === 0) {
      return;
    }

    for (
      let i: number = 0;
      i < data.rows.length;
      i += INTERFACE_UPSERT_BATCH_SIZE
    ) {
      const chunk: Array<InterfaceUpdateRow> = data.rows.slice(
        i,
        i + INTERFACE_UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [data.deviceId.toString(), data.seenAt];
      let paramIndex: number = 3;

      for (const row of chunk) {
        valueFragments.push(
          `($${paramIndex++}::integer, $${paramIndex++}::character varying, $${paramIndex++}::character varying, $${paramIndex++}::character varying, $${paramIndex++}::integer, $${paramIndex++}::boolean, $${paramIndex++}::boolean, $${paramIndex++}::numeric, $${paramIndex++}::numeric, $${paramIndex++}::numeric, $${paramIndex++}::numeric, $${paramIndex++}::numeric)`,
        );

        params.push(
          row.interfaceIndex,
          row.name,
          row.alias,
          row.macAddress,
          row.interfaceType,
          row.isOperationallyUp,
          row.isAdministrativelyUp,
          row.speedInMbps,
          row.inRateMbps,
          row.outRateMbps,
          row.utilizationPercent,
          row.errorsPerSecond,
        );
      }

      const sql: string = `
        UPDATE "NetworkInterface" AS i
        SET
          "name" = v."name",
          "alias" = v."alias",
          "macAddress" = v."macAddress",
          "interfaceType" = v."interfaceType",
          "isOperationallyUp" = v."isOperationallyUp",
          "isAdministrativelyUp" = v."isAdministrativelyUp",
          "speedInMbps" = v."speedInMbps",
          "inRateMbps" = v."inRateMbps",
          "outRateMbps" = v."outRateMbps",
          "utilizationPercent" = v."utilizationPercent",
          "errorsPerSecond" = v."errorsPerSecond",
          "lastSeenAt" = $2::timestamptz,
          "version" = i."version" + 1,
          "updatedAt" = now()
        FROM (VALUES ${valueFragments.join(", ")})
          AS v("interfaceIndex", "name", "alias", "macAddress", "interfaceType", "isOperationallyUp", "isAdministrativelyUp", "speedInMbps", "inRateMbps", "outRateMbps", "utilizationPercent", "errorsPerSecond")
        WHERE
          i."networkDeviceId" = $1
          AND i."interfaceIndex" = v."interfaceIndex"
          AND i."deletedAt" IS NULL
          AND (i."lastSeenAt" IS NULL OR i."lastSeenAt" < $2::timestamptz)
          AND NOT EXISTS (
            SELECT 1 FROM "NetworkDevice" AS d
            WHERE d."_id" = $1 AND d."lastSnmpSeenAt" > $2::timestamptz
          )
      `;

      await this.runChunkWithRowFallback({
        sql: sql,
        params: params,
        chunk: chunk,
        deviceId: data.deviceId,
        runOne: async (row: InterfaceUpdateRow): Promise<void> => {
          await this.bulkUpdateInterfaces({
            deviceId: data.deviceId,
            seenAt: data.seenAt,
            rows: [row],
          });
        },
      });
    }
  }
}

export default new Service();
