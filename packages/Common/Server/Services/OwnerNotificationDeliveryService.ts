import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/OwnerNotificationDelivery";
import ObjectID from "../../Types/ObjectID";
import {
  OwnerNotificationDeliveryStatus,
  OwnerNotificationFeedStatus,
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
  // The record the owners are told of: an incident, an alert, a monitor...
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
  // When a run last set out to tell this owner, or moved their row on.
  attemptedAt: Date;
  // The notification's feed item: none when it writes none (#8510).
  feedStatus: OwnerNotificationFeedStatus | null;
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
const ROW_COLUMNS: string = `"_id", "userId", "isProjectOwner", "status", "attempts", "attemptedAt", "feedStatus"`;

// The columns that say which notification a row is of.
const EVENT_COLUMNS: string = `"kind", "projectId", "resourceId", "eventId", "occurrence"`;

/*
 * The rows of each owner notification and owner (OwnerNotificationDelivery),
 * read and written only by OwnerNotificationDeliveries
 * (Utils/Notification/OwnerNotificationDeliveries). Every statement here is
 * written by hand because what it guarantees is its own to guarantee, in one
 * statement: a row per notification and owner however often it is written,
 * one run alone moving an owner from to be told to being told, and one run
 * alone taking up what a stopped run left - owners still to be told, or the
 * feed item still to write once every owner was (#8510).
 * OwnerNotificationDeliveryPostgres holds them to that on a migrated
 * Postgres.
 *
 * Every statement that moves a row on stamps it with the time it is given
 * (attemptedAt), from the clock of the runs that compare against it: so a
 * notification none of whose rows moved for a while is one no run is still
 * working on.
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
    // Whether the notification writes a feed item, which its rows then keep track of.
    writesFeedItem: boolean;
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

    /*
     * Written in one order, by owner, whoever writes them: two runs writing
     * the same owners at once in different orders would each wait on a row
     * the other had written first, and one of them would fail (a deadlock).
     */
    owners.sort((a: { userId: string }, b: { userId: string }): number => {
      return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
    });

    if (owners.length > 0) {
      await this.getRepository().manager.query(
        `INSERT INTO ${TABLE} ("projectId", "kind", "resourceId", "eventId", "occurrence", "userId", "isProjectOwner", "status", "attempts", "attemptedAt", "feedStatus", "version")
         SELECT $1::uuid, $2, $3::uuid, $4::uuid, $5::integer, owner."userId"::uuid, owner."isProjectOwner", '${OwnerNotificationDeliveryStatus.Pending}', 1, $6::timestamptz, $8::varchar, 1
         FROM jsonb_to_recordset($7::jsonb) AS owner("userId" text, "isProjectOwner" boolean)
         ORDER BY owner."userId"::uuid
         ON CONFLICT ("kind", "eventId", "occurrence", "userId") DO NOTHING`,
        [
          data.event.projectId.toString(),
          data.event.kind,
          data.event.resourceId.toString(),
          data.event.eventId.toString(),
          data.event.occurrence,
          data.at,
          JSON.stringify(owners),
          data.writesFeedItem ? OwnerNotificationFeedStatus.Pending : null,
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
  public async startTelling(id: ObjectID, at: Date): Promise<boolean> {
    return (
      (
        await this.writeWhere({
          setSql: `"status" = '${OwnerNotificationDeliveryStatus.Sending}', "attemptedAt" = $2::timestamptz`,
          whereSql: `"_id" = $1::uuid AND "status" = '${OwnerNotificationDeliveryStatus.Pending}'`,
          params: [id.toString(), at],
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
    at: Date;
  }): Promise<boolean> {
    return (
      (
        await this.writeWhere({
          setSql: `"status" = $2, "attemptedAt" = $3::timestamptz`,
          whereSql: `"_id" = $1::uuid AND "status" = '${OwnerNotificationDeliveryStatus.Sending}'`,
          params: [data.id.toString(), data.status, data.at],
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
    at: Date,
  ): Promise<Array<OwnerNotificationDeliveryRow>> {
    if (ids.length === 0) {
      return [];
    }

    return await this.writeWhere({
      setSql: `"status" = '${OwnerNotificationDeliveryStatus.Failed}', "attemptedAt" = $2::timestamptz`,
      whereSql: `"_id" = ANY($1::uuid[]) AND "status" = '${OwnerNotificationDeliveryStatus.Pending}'`,
      params: [
        ids.map((id: ObjectID): string => {
          return id.toString();
        }),
        at,
      ],
    });
  }

  /*
   * Says the notification's feed item is written, or never will be
   * (NotWritten), on every row of it whose feed item was still to write.
   * Hands back the rows it marked: none when no row was.
   */
  @CaptureSpan()
  public async settleFeedItem(data: {
    event: OwnerNotificationEvent;
    feedStatus:
      | OwnerNotificationFeedStatus.Written
      | OwnerNotificationFeedStatus.NotWritten;
    at: Date;
  }): Promise<Array<OwnerNotificationDeliveryRow>> {
    return await this.writeWhere({
      setSql: `"feedStatus" = $4, "attemptedAt" = $5::timestamptz`,
      whereSql: `"kind" = $1 AND "eventId" = $2::uuid AND "occurrence" = $3::integer AND "feedStatus" = '${OwnerNotificationFeedStatus.Pending}'`,
      params: [
        data.event.kind,
        data.event.eventId.toString(),
        data.event.occurrence,
        data.feedStatus,
        data.at,
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

    return rows.map(toEvent);
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
   * The notifications of these kinds whose feed item is still to write
   * although no owner is still to be told, none of whose rows moved since
   * `attemptedBefore` - so no run is still at it: those a run stopped after
   * its last owner and before the feed item (#8510). The longest waiting
   * first, at most `limit`.
   */
  @CaptureSpan()
  public async findFeedItemsLeftUnwritten(data: {
    kinds: Array<OwnerNotificationKind>;
    attemptedBefore: Date;
    limit: number;
  }): Promise<Array<OwnerNotificationEvent>> {
    if (data.kinds.length === 0) {
      return [];
    }

    const rows: Array<Record<string, unknown>> =
      await this.getRepository().manager.query(
        `SELECT ${EVENT_COLUMNS} FROM ${TABLE} AS "row"
         WHERE "feedStatus" = '${OwnerNotificationFeedStatus.Pending}' AND "kind" = ANY($1::varchar[]) AND "attemptedAt" <= $2::timestamptz
         AND NOT EXISTS (${stillMovingSql({ kind: `"row"."kind"`, eventId: `"row"."eventId"`, occurrence: `"row"."occurrence"`, attemptedBefore: "$2::timestamptz" })})
         GROUP BY ${EVENT_COLUMNS}
         ORDER BY MIN("attemptedAt") ASC
         LIMIT $3::integer`,
        [data.kinds, data.attemptedBefore, data.limit],
      );

    return rows.map(toEvent);
  }

  /*
   * Takes up, for one run alone, a notification whose feed item a stopped
   * run left unwritten (findFeedItemsLeftUnwritten): counts this run's
   * attempt on every row of it and hands them back. Nothing for every other
   * run - this run's attempt is newer than what theirs looks for - nor while
   * an owner is still to be told or a row moved since `attemptedBefore`.
   */
  @CaptureSpan()
  public async takeUpFeedItemLeftUnwritten(data: {
    event: OwnerNotificationEvent;
    attemptedBefore: Date;
    at: Date;
  }): Promise<Array<OwnerNotificationDeliveryRow>> {
    return await this.writeWhere({
      setSql: `"attempts" = "attempts" + 1, "attemptedAt" = $5::timestamptz`,
      whereSql: `"kind" = $1 AND "eventId" = $2::uuid AND "occurrence" = $3::integer AND "feedStatus" = '${OwnerNotificationFeedStatus.Pending}' AND "attemptedAt" <= $4::timestamptz AND NOT EXISTS (${stillMovingSql({ kind: "$1", eventId: "$2::uuid", occurrence: "$3::integer", attemptedBefore: "$4::timestamptz" })})`,
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

function toEvent(row: Record<string, unknown>): OwnerNotificationEvent {
  return {
    kind: row["kind"] as OwnerNotificationKind,
    projectId: new ObjectID(String(row["projectId"])),
    resourceId: new ObjectID(String(row["resourceId"])),
    eventId: new ObjectID(String(row["eventId"])),
    occurrence: Number(row["occurrence"]),
  };
}

/*
 * A row of the notification that says a run may still be at it: an owner
 * still to be told, or a row that moved since `attemptedBefore`. Each part
 * is SQL: a column of the outer row, or a parameter.
 */
function stillMovingSql(data: {
  kind: string;
  eventId: string;
  occurrence: string;
  attemptedBefore: string;
}): string {
  return `SELECT 1 FROM ${TABLE} AS "sibling" WHERE "sibling"."kind" = ${data.kind} AND "sibling"."eventId" = ${data.eventId} AND "sibling"."occurrence" = ${data.occurrence} AND ("sibling"."status" = '${OwnerNotificationDeliveryStatus.Pending}' OR "sibling"."attemptedAt" > ${data.attemptedBefore})`;
}

function toRow(row: Record<string, unknown>): OwnerNotificationDeliveryRow {
  return {
    id: new ObjectID(String(row["_id"])),
    userId: new ObjectID(String(row["userId"])),
    isProjectOwner: row["isProjectOwner"] === true,
    status: row["status"] as OwnerNotificationDeliveryStatus,
    attempts: Number(row["attempts"]),
    attemptedAt: new Date(row["attemptedAt"] as Date | string),
    feedStatus: row["feedStatus"]
      ? (row["feedStatus"] as OwnerNotificationFeedStatus)
      : null,
  };
}

export default new Service();
