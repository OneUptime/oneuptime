import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/OwnerNotificationDelivery";
import ObjectID from "../../Types/ObjectID";
import {
  OwnerNotificationDeliveryStatus,
  OwnerNotificationKind,
} from "../../Types/Notification/OwnerNotificationDelivery";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Which notification a row is of: its kind, the record whose notification
 * it is, and which time it goes out (OwnerNotificationDelivery).
 */
export interface OwnerNotificationEvent {
  kind: OwnerNotificationKind;
  projectId: ObjectID;
  // The incident or alert the owners are told of.
  resourceId: ObjectID;
  // The record whose notification it is.
  eventId: ObjectID;
  // A reminder's number; 1 for every other notification.
  occurrence: number;
}

// One owner of a notification, as their row stands.
export interface OwnerNotificationDeliveryRow {
  id: ObjectID;
  userId: ObjectID;
  isProjectOwner: boolean;
  status: OwnerNotificationDeliveryStatus;
  attempts: number;
  attemptedAt: Date;
}

// An owner to write a row for.
export interface OwnerToTell {
  userId: ObjectID;
  isProjectOwner: boolean;
}

// How long a row is kept: long after any run could still be telling its owner.
export const OWNER_NOTIFICATION_DELIVERY_RETENTION_IN_DAYS: number = 7;

const TABLE: string = '"OwnerNotificationDelivery"';

// The columns every read below hands back, for toRow.
const ROW_COLUMNS: string = `"_id", "userId", "isProjectOwner", "status", "attempts", "attemptedAt"`;

// The columns that say which notification a row is of.
const EVENT_COLUMNS: string = `"kind", "projectId", "resourceId", "eventId", "occurrence"`;

/*
 * The rows of each owner notification and owner (OwnerNotificationDelivery),
 * read and written only by OwnerNotificationDeliveries
 * (Utils/Notification/OwnerNotificationDeliveries). Every statement here is
 * written by hand because what it guarantees is its own to guarantee, in one
 * statement: a row per notification and owner however often it is written,
 * one run alone moving an owner from to be told to being told, and one run
 * alone taking up what a stopped run left. OwnerNotificationDeliveryPostgres
 * holds them to that on a migrated Postgres.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays(
      "createdAt",
      OWNER_NOTIFICATION_DELIVERY_RETENTION_IN_DAYS,
    );
  }

  /*
   * Writes a row, to be told, for each owner the notification has none for
   * yet - each once, however often this is called - and hands back every
   * row the notification has: the ones written now, and any an earlier run
   * wrote.
   */
  @CaptureSpan()
  public async writeOwnersToTell(data: {
    event: OwnerNotificationEvent;
    owners: Array<OwnerToTell>;
    at: Date;
  }): Promise<Array<OwnerNotificationDeliveryRow>> {
    const seen: Set<string> = new Set<string>();
    const owners: Array<{ userId: string; isProjectOwner: boolean }> = [];

    for (const owner of data.owners) {
      const userId: string = owner.userId.toString();

      if (seen.has(userId)) {
        continue;
      }

      seen.add(userId);
      owners.push({ userId: userId, isProjectOwner: owner.isProjectOwner });
    }

    if (owners.length > 0) {
      await this.getRepository().manager.query(
        `INSERT INTO ${TABLE} ("projectId", "kind", "resourceId", "eventId", "occurrence", "userId", "isProjectOwner", "status", "attempts", "attemptedAt", "version")
         SELECT $1::uuid, $2, $3::uuid, $4::uuid, $5::integer, owner."userId"::uuid, owner."isProjectOwner", '${OwnerNotificationDeliveryStatus.Pending}', 1, $6::timestamptz, 1
         FROM jsonb_to_recordset($7::jsonb) AS owner("userId" text, "isProjectOwner" boolean)
         ON CONFLICT ("kind", "eventId", "occurrence", "userId") DO NOTHING`,
        [
          data.event.projectId.toString(),
          data.event.kind,
          data.event.resourceId.toString(),
          data.event.eventId.toString(),
          data.event.occurrence,
          data.at,
          JSON.stringify(owners),
        ],
      );
    }

    return await this.findRowsOf(data.event);
  }

  // Every row of a notification, the oldest first.
  @CaptureSpan()
  public async findRowsOf(
    event: OwnerNotificationEvent,
  ): Promise<Array<OwnerNotificationDeliveryRow>> {
    const rows: Array<Record<string, unknown>> =
      await this.getRepository().manager.query(
        `SELECT ${ROW_COLUMNS} FROM ${TABLE}
         WHERE "kind" = $1 AND "eventId" = $2::uuid AND "occurrence" = $3::integer
         ORDER BY "createdAt" ASC, "_id" ASC`,
        [event.kind, event.eventId.toString(), event.occurrence],
      );

    return rows.map(toRow);
  }

  /*
   * Moves an owner from to be told to being told, for one run alone: true
   * for the run that did, false for every other (the owner was told, is
   * being told, or their row is gone).
   */
  @CaptureSpan()
  public async startTelling(id: ObjectID): Promise<boolean> {
    return (
      (
        await this.writeWhere({
          setSql: `"status" = '${OwnerNotificationDeliveryStatus.Sending}'`,
          whereSql: `"_id" = $1::uuid AND "status" = '${OwnerNotificationDeliveryStatus.Pending}'`,
          params: [id.toString()],
        })
      ).length === 1
    );
  }

  // Says how telling an owner this run started ended: told, or not.
  @CaptureSpan()
  public async finishTelling(data: {
    id: ObjectID;
    status:
      | OwnerNotificationDeliveryStatus.Sent
      | OwnerNotificationDeliveryStatus.Failed;
  }): Promise<boolean> {
    return (
      (
        await this.writeWhere({
          setSql: `"status" = $2`,
          whereSql: `"_id" = $1::uuid AND "status" = '${OwnerNotificationDeliveryStatus.Sending}'`,
          params: [data.id.toString(), data.status],
        })
      ).length === 1
    );
  }

  /*
   * Marks owners still to be told as not told - their notification can no
   * longer reach them - and hands back the ones it marked.
   */
  @CaptureSpan()
  public async giveUpTelling(
    ids: Array<ObjectID>,
  ): Promise<Array<OwnerNotificationDeliveryRow>> {
    if (ids.length === 0) {
      return [];
    }

    return await this.writeWhere({
      setSql: `"status" = '${OwnerNotificationDeliveryStatus.Failed}'`,
      whereSql: `"_id" = ANY($1::uuid[]) AND "status" = '${OwnerNotificationDeliveryStatus.Pending}'`,
      params: [
        ids.map((id: ObjectID): string => {
          return id.toString();
        }),
      ],
    });
  }

  /*
   * The notifications of these kinds with owners still to be told whom no
   * run set out to tell since `attemptedBefore`: those a run stopped part
   * way through. The longest waiting first, at most `limit`.
   */
  @CaptureSpan()
  public async findLeftPartWay(data: {
    kinds: Array<OwnerNotificationKind>;
    attemptedBefore: Date;
    limit: number;
  }): Promise<Array<OwnerNotificationEvent>> {
    if (data.kinds.length === 0) {
      return [];
    }

    const rows: Array<Record<string, unknown>> =
      await this.getRepository().manager.query(
        `SELECT ${EVENT_COLUMNS} FROM ${TABLE}
         WHERE "status" = '${OwnerNotificationDeliveryStatus.Pending}' AND "kind" = ANY($1::varchar[]) AND "attemptedAt" <= $2::timestamptz
         GROUP BY ${EVENT_COLUMNS}
         ORDER BY MIN("attemptedAt") ASC
         LIMIT $3::integer`,
        [data.kinds, data.attemptedBefore, data.limit],
      );

    return rows.map((row: Record<string, unknown>): OwnerNotificationEvent => {
      return {
        kind: row["kind"] as OwnerNotificationKind,
        projectId: new ObjectID(String(row["projectId"])),
        resourceId: new ObjectID(String(row["resourceId"])),
        eventId: new ObjectID(String(row["eventId"])),
        occurrence: Number(row["occurrence"]),
      };
    });
  }

  /*
   * Takes up, for one run alone, the owners of a notification still to be
   * told whom no run set out to tell since `attemptedBefore`: counts this
   * run's attempt on each and hands them back. Nothing for every other run
   * - this run's attempt is newer than what theirs looks for.
   */
  @CaptureSpan()
  public async takeUpLeftPartWay(data: {
    event: OwnerNotificationEvent;
    attemptedBefore: Date;
    at: Date;
  }): Promise<Array<OwnerNotificationDeliveryRow>> {
    return await this.writeWhere({
      setSql: `"attempts" = "attempts" + 1, "attemptedAt" = $5::timestamptz`,
      whereSql: `"kind" = $1 AND "eventId" = $2::uuid AND "occurrence" = $3::integer AND "status" = '${OwnerNotificationDeliveryStatus.Pending}' AND "attemptedAt" <= $4::timestamptz`,
      params: [
        data.event.kind,
        data.event.eventId.toString(),
        data.event.occurrence,
        data.attemptedBefore,
        data.at,
      ],
    });
  }

  /*
   * One UPDATE of the rows `whereSql` matches, handing back the rows it
   * wrote. In a CTE, so the statement is a SELECT of them: through this
   * driver a bare UPDATE ... RETURNING answers [rows, count].
   */
  private async writeWhere(data: {
    setSql: string;
    whereSql: string;
    params: Array<unknown>;
  }): Promise<Array<OwnerNotificationDeliveryRow>> {
    const rows: Array<Record<string, unknown>> =
      await this.getRepository().manager.query(
        `WITH "written" AS (UPDATE ${TABLE} SET ${data.setSql}, "updatedAt" = now() WHERE ${data.whereSql} RETURNING ${ROW_COLUMNS}) SELECT ${ROW_COLUMNS} FROM "written"`,
        data.params,
      );

    return rows.map(toRow);
  }
}

function toRow(row: Record<string, unknown>): OwnerNotificationDeliveryRow {
  return {
    id: new ObjectID(String(row["_id"])),
    userId: new ObjectID(String(row["userId"])),
    isProjectOwner: row["isProjectOwner"] === true,
    status: row["status"] as OwnerNotificationDeliveryStatus,
    attempts: Number(row["attempts"]),
    attemptedAt: new Date(row["attemptedAt"] as Date | string),
  };
}

export default new Service();
