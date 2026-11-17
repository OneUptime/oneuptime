import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "../../../Models/DatabaseModels/User";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Recurring from "../../../Types/Events/Recurring";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Timezone from "../../../Types/Timezone";
import logger from "../Logger";
import { ValueTransformer } from "typeorm";

/*
 * A SCHEDULE'S LAYERS AND THE PEOPLE IN THEM, READ AS ONE SNAPSHOT (#9316).
 *
 * Who is on call in a schedule is worked out from its layers, the people in
 * each in turn order, and the schedule's timezone. They used to be read in
 * three statements, one after another: the layers, their people, then the
 * schedule. Postgres reads each statement as of the moment it starts, so a
 * save of the layers (ScheduleLayersSave) that committed between two of
 * them was seen half: the layers in their new order with the people they
 * had before, a layer just deleted without its people, a person added to a
 * layer the first statement had not seen. A page sent then could go to
 * somebody who was on call in neither the layers as they were nor as they
 * were saved.
 *
 * Here one statement reads them all - the schedule, joined to its layers,
 * joined to their people - so every row of it is as of one moment: the
 * layers as they were, or as they are, never half of a save. It takes no
 * lock (a save holds the schedule's row while it writes, and nothing here
 * waits for it), and it is one round trip where there were three.
 *
 * What it reads is what the three reads read, by the same rules: rows that
 * are deleted are not read, nor is a person whose user is; the layers come
 * highest priority first (by order, then id) and each layer's people in
 * turn order (by order, then id); a layer with nobody in it is read too.
 *
 * Many schedules are read SCHEDULES_PER_STATEMENT at a time, and a
 * statement keeps at most MAX_ROWS rows (it reads one more, to know whether
 * there was more). A schedule is never split between two statements: when
 * a statement stops at its cap part way through a schedule, that schedule
 * is read again, from the start, by the next one.
 */

// A row the statement read, as the driver hands it over.
type SnapshotRow = Record<string, unknown>;

// One schedule as one snapshot read it.
export interface ScheduleLayersSnapshotEntry {
  schedule: OnCallDutyPolicySchedule;
  // Highest priority first: by order, then by id.
  layers: Array<OnCallDutyPolicyScheduleLayer>;
  // Layer by layer, as `layers` is ordered; each layer's people in turn order.
  layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>;
}

// Runs one statement and hands back its rows.
export type ScheduleLayersSnapshotQuery = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

export interface ScheduleLayersSnapshotStatement {
  sql: string;
  parameters: Array<unknown>;
}

/*
 * The statement: $1 the schedules' ids, $2 the most rows it reads. Every
 * table is read as of the moment it starts, and none is locked.
 */
const SNAPSHOT_SQL: string = [
  `SELECT`,
  `"schedule"."_id" AS "schedule_id",`,
  `"schedule"."projectId" AS "schedule_projectId",`,
  `"schedule"."name" AS "schedule_name",`,
  `"schedule"."timezone" AS "schedule_timezone",`,
  `"schedule"."shiftConfigVersion" AS "schedule_shiftConfigVersion",`,
  `"schedule"."createdAt" AS "schedule_createdAt",`,
  `"layer"."_id" AS "layer_id",`,
  `"layer"."projectId" AS "layer_projectId",`,
  `"layer"."order" AS "layer_order",`,
  `"layer"."name" AS "layer_name",`,
  `"layer"."description" AS "layer_description",`,
  `"layer"."startsAt" AS "layer_startsAt",`,
  `"layer"."handOffTime" AS "layer_handOffTime",`,
  `"layer"."rotation" AS "layer_rotation",`,
  `"layer"."restrictionTimes" AS "layer_restrictionTimes",`,
  `"layer"."updatedAt" AS "layer_updatedAt",`,
  `"layerUser"."_id" AS "layerUser_id",`,
  `"layerUser"."projectId" AS "layerUser_projectId",`,
  `"layerUser"."userId" AS "layerUser_userId",`,
  `"layerUser"."order" AS "layerUser_order",`,
  `"layerUser"."updatedAt" AS "layerUser_updatedAt",`,
  `"user"."_id" AS "user_id"`,
  `FROM "OnCallDutyPolicySchedule" AS "schedule"`,
  `LEFT JOIN "OnCallDutyPolicyScheduleLayer" AS "layer"`,
  `ON "layer"."onCallDutyPolicyScheduleId" = "schedule"."_id"`,
  `AND "layer"."deletedAt" IS NULL`,
  `LEFT JOIN "OnCallDutyPolicyScheduleLayerUser" AS "layerUser"`,
  `ON "layerUser"."onCallDutyPolicyScheduleLayerId" = "layer"."_id"`,
  `AND "layerUser"."onCallDutyPolicyScheduleId" = "schedule"."_id"`,
  `AND "layerUser"."deletedAt" IS NULL`,
  `LEFT JOIN "User" AS "user"`,
  `ON "user"."_id" = "layerUser"."userId"`,
  `AND "user"."deletedAt" IS NULL`,
  `WHERE "schedule"."_id" = ANY($1::uuid[])`,
  `AND "schedule"."deletedAt" IS NULL`,
  `ORDER BY "schedule"."_id" ASC, "layer"."order" ASC, "layer"."_id" ASC, "layerUser"."order" ASC, "layerUser"."_id" ASC`,
  `LIMIT $2`,
].join(" ");

// The columns' own transformers, as a read through the model applies them.
const ROTATION: ValueTransformer = Recurring.getDatabaseTransformer();
const RESTRICTION_TIMES: ValueTransformer =
  RestrictionTimes.getDatabaseTransformer();

const isMissing: (value: unknown) => boolean = (value: unknown): boolean => {
  return value === null || value === undefined;
};

const readText: (row: SnapshotRow, column: string) => string = (
  row: SnapshotRow,
  column: string,
): string => {
  const value: unknown = row[column];
  return isMissing(value) ? "" : String(value);
};

const readObjectID: (
  row: SnapshotRow,
  column: string,
) => ObjectID | undefined = (
  row: SnapshotRow,
  column: string,
): ObjectID | undefined => {
  const value: string = readText(row, column);
  return value ? new ObjectID(value) : undefined;
};

const readNumber: (row: SnapshotRow, column: string) => number | undefined = (
  row: SnapshotRow,
  column: string,
): number | undefined => {
  const value: unknown = row[column];

  if (isMissing(value)) {
    return undefined;
  }

  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const readDate: (row: SnapshotRow, column: string) => Date | undefined = (
  row: SnapshotRow,
  column: string,
): Date | undefined => {
  const value: unknown = row[column];

  if (isMissing(value)) {
    return undefined;
  }

  const date: Date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
};

// A key a schedule is known by here, whatever the case of the id it was asked by.
const keyOf: (id: string) => string = (id: string): string => {
  return id.toLowerCase();
};

export default class ScheduleLayersSnapshot {
  /*
   * The most rows one statement reads: what the two reads it replaces read
   * at most between them - LIMIT_PER_PROJECT layers and LIMIT_PER_PROJECT
   * people - so it never stops short where they did not.
   */
  public static readonly MAX_ROWS: number = 2 * LIMIT_PER_PROJECT;

  // The most schedules one statement reads.
  public static readonly SCHEDULES_PER_STATEMENT: number = 200;

  // The statement for these schedules, reading at most `limit` rows.
  public static getStatement(data: {
    scheduleIds: Array<string>;
    limit: number;
  }): ScheduleLayersSnapshotStatement {
    return {
      sql: SNAPSHOT_SQL,
      parameters: [data.scheduleIds, data.limit],
    };
  }

  /*
   * The schedules the rows are of, by id (lower case), each with its layers
   * and their people in the order the statement read them.
   */
  public static fromRows(
    rows: Array<SnapshotRow>,
  ): Map<string, ScheduleLayersSnapshotEntry> {
    const entries: Map<string, ScheduleLayersSnapshotEntry> = new Map<
      string,
      ScheduleLayersSnapshotEntry
    >();
    const layersRead: Set<string> = new Set<string>();

    for (const row of rows) {
      const scheduleId: string = readText(row, "schedule_id");

      if (!scheduleId) {
        continue;
      }

      let entry: ScheduleLayersSnapshotEntry | undefined = entries.get(
        keyOf(scheduleId),
      );

      if (!entry) {
        entry = {
          schedule: ScheduleLayersSnapshot.toSchedule(row, scheduleId),
          layers: [],
          layerUsers: [],
        };
        entries.set(keyOf(scheduleId), entry);
      }

      const layerId: string = readText(row, "layer_id");

      // A schedule with no layers: one row, of the schedule alone.
      if (!layerId) {
        continue;
      }

      // A layer comes on a row of each of its people: kept once.
      const layerKey: string = `${keyOf(scheduleId)}:${keyOf(layerId)}`;

      if (!layersRead.has(layerKey)) {
        layersRead.add(layerKey);
        entry.layers.push(
          ScheduleLayersSnapshot.toLayer(row, scheduleId, layerId),
        );
      }

      const layerUserId: string = readText(row, "layerUser_id");

      // A layer with nobody in it: one row, of the layer alone.
      if (!layerUserId) {
        continue;
      }

      entry.layerUsers.push(
        ScheduleLayersSnapshot.toLayerUser(row, {
          scheduleId: scheduleId,
          layerId: layerId,
          layerUserId: layerUserId,
        }),
      );
    }

    return entries;
  }

  /*
   * The schedules asked for that exist, by id (lower case), each read whole
   * by one statement. A schedule that does not exist, or is deleted, is not
   * in it.
   */
  public static async read(data: {
    scheduleIds: Array<ObjectID>;
    query: ScheduleLayersSnapshotQuery;
    maxRows?: number | undefined;
    schedulesPerStatement?: number | undefined;
  }): Promise<Map<string, ScheduleLayersSnapshotEntry>> {
    const maxRows: number = Math.max(
      1,
      data.maxRows ?? ScheduleLayersSnapshot.MAX_ROWS,
    );
    const schedulesPerStatement: number = Math.max(
      1,
      data.schedulesPerStatement ??
        ScheduleLayersSnapshot.SCHEDULES_PER_STATEMENT,
    );

    const read: Map<string, ScheduleLayersSnapshotEntry> = new Map<
      string,
      ScheduleLayersSnapshotEntry
    >();

    // Each schedule asked for once, however many times it was named.
    let waiting: Array<string> = Array.from(
      new Set<string>(
        data.scheduleIds
          .map((scheduleId: ObjectID): string => {
            return keyOf(scheduleId.toString());
          })
          .filter(Boolean),
      ),
    );

    while (waiting.length > 0) {
      const asked: Array<string> = waiting.slice(0, schedulesPerStatement);

      // One row past the cap: whether there was more to read than it holds.
      const statement: ScheduleLayersSnapshotStatement =
        ScheduleLayersSnapshot.getStatement({
          scheduleIds: asked,
          limit: maxRows + 1,
        });

      const result: unknown = await data.query(
        statement.sql,
        statement.parameters,
      );
      const rows: Array<SnapshotRow> = Array.isArray(result)
        ? (result as Array<SnapshotRow>)
        : [];
      const kept: Array<SnapshotRow> = rows.slice(0, maxRows);
      const entries: Map<string, ScheduleLayersSnapshotEntry> =
        ScheduleLayersSnapshot.fromRows(kept);

      if (rows.length <= maxRows || entries.size === 0) {
        // Read to its end: every schedule asked for that exists, whole.
        for (const [scheduleId, entry] of entries) {
          read.set(scheduleId, entry);
        }

        waiting = waiting.filter((scheduleId: string): boolean => {
          return !asked.includes(scheduleId);
        });
        continue;
      }

      /*
       * More than the cap: the schedule of the last row kept is cut short
       * when the row past the cap is its too, and the schedules after it
       * were not reached. Every schedule before it was read whole.
       */
      const lastKeptId: string = keyOf(
        readText(kept[kept.length - 1]!, "schedule_id"),
      );
      const isCut: boolean =
        keyOf(readText(rows[maxRows]!, "schedule_id")) === lastKeptId;

      for (const [scheduleId, entry] of entries) {
        if (!isCut || scheduleId !== lastKeptId) {
          read.set(scheduleId, entry);
        }
      }

      if (isCut && entries.size === 1 && entries.has(lastKeptId)) {
        /*
         * One schedule is more than the cap on its own: no statement reads
         * all of it. It is worked out from the rows the cap holds, as it
         * was when its layers and their people were each read up to a cap
         * of their own.
         */
        logger.error(
          `The layers of on-call schedule ${lastKeptId} and the people in them are more than ${maxRows} rows; who is on call in it is worked out from the first ${maxRows}.`,
        );

        read.set(lastKeptId, entries.get(lastKeptId)!);
      }

      // The rest - the one cut short first - read again by the next statement.
      waiting = waiting.filter((scheduleId: string): boolean => {
        return !read.has(scheduleId);
      });
    }

    return read;
  }

  private static toSchedule(
    row: SnapshotRow,
    scheduleId: string,
  ): OnCallDutyPolicySchedule {
    const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule(
      new ObjectID(scheduleId),
    );

    const projectId: ObjectID | undefined = readObjectID(
      row,
      "schedule_projectId",
    );
    if (projectId) {
      schedule.projectId = projectId;
    }

    if (!isMissing(row["schedule_name"])) {
      schedule.name = readText(row, "schedule_name");
    }

    const timezone: string = readText(row, "schedule_timezone");
    if (timezone) {
      schedule.timezone = timezone as Timezone;
    }

    const shiftConfigVersion: number | undefined = readNumber(
      row,
      "schedule_shiftConfigVersion",
    );
    if (shiftConfigVersion !== undefined) {
      schedule.shiftConfigVersion = shiftConfigVersion;
    }

    const createdAt: Date | undefined = readDate(row, "schedule_createdAt");
    if (createdAt) {
      schedule.createdAt = createdAt;
    }

    return schedule;
  }

  private static toLayer(
    row: SnapshotRow,
    scheduleId: string,
    layerId: string,
  ): OnCallDutyPolicyScheduleLayer {
    const layer: OnCallDutyPolicyScheduleLayer =
      new OnCallDutyPolicyScheduleLayer(new ObjectID(layerId));

    layer.onCallDutyPolicyScheduleId = new ObjectID(scheduleId);

    const projectId: ObjectID | undefined = readObjectID(
      row,
      "layer_projectId",
    );
    if (projectId) {
      layer.projectId = projectId;
    }

    const order: number | undefined = readNumber(row, "layer_order");
    if (order !== undefined) {
      layer.order = order;
    }

    if (!isMissing(row["layer_name"])) {
      layer.name = readText(row, "layer_name");
    }

    if (!isMissing(row["layer_description"])) {
      layer.description = readText(row, "layer_description");
    }

    const startsAt: Date | undefined = readDate(row, "layer_startsAt");
    if (startsAt) {
      layer.startsAt = startsAt;
    }

    const handOffTime: Date | undefined = readDate(row, "layer_handOffTime");
    if (handOffTime) {
      layer.handOffTime = handOffTime;
    }

    const rotation: Recurring | null = ROTATION.from(row["layer_rotation"]);
    if (rotation) {
      layer.rotation = rotation;
    }

    const restrictionTimes: RestrictionTimes | null = RESTRICTION_TIMES.from(
      row["layer_restrictionTimes"],
    );
    if (restrictionTimes) {
      layer.restrictionTimes = restrictionTimes;
    }

    const updatedAt: Date | undefined = readDate(row, "layer_updatedAt");
    if (updatedAt) {
      layer.updatedAt = updatedAt;
    }

    return layer;
  }

  private static toLayerUser(
    row: SnapshotRow,
    ids: { scheduleId: string; layerId: string; layerUserId: string },
  ): OnCallDutyPolicyScheduleLayerUser {
    const layerUser: OnCallDutyPolicyScheduleLayerUser =
      new OnCallDutyPolicyScheduleLayerUser(new ObjectID(ids.layerUserId));

    layerUser.onCallDutyPolicyScheduleId = new ObjectID(ids.scheduleId);
    layerUser.onCallDutyPolicyScheduleLayerId = new ObjectID(ids.layerId);

    const projectId: ObjectID | undefined = readObjectID(
      row,
      "layerUser_projectId",
    );
    if (projectId) {
      layerUser.projectId = projectId;
    }

    const userId: ObjectID | undefined = readObjectID(row, "layerUser_userId");
    if (userId) {
      layerUser.userId = userId;
    }

    const order: number | undefined = readNumber(row, "layerUser_order");
    if (order !== undefined) {
      layerUser.order = order;
    }

    const updatedAt: Date | undefined = readDate(row, "layerUser_updatedAt");
    if (updatedAt) {
      layerUser.updatedAt = updatedAt;
    }

    /*
     * The person, when their user is there to page: one whose user is
     * deleted takes no turn, as when the user was read with the row.
     */
    const user: ObjectID | undefined = readObjectID(row, "user_id");
    if (user) {
      layerUser.user = new User(user);
    }

    return layerUser;
  }
}
