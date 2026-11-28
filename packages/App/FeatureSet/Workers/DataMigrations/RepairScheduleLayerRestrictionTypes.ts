import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import OnCallDutyPolicyScheduleLayerService from "Common/Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import logger from "Common/Server/Utils/Logger";
import { OnCallShiftChangeReason } from "Common/Server/Utils/OnCall/OnCallShiftChangeListeners";
import EventInterval from "Common/Types/Events/EventInterval";
import Recurring from "Common/Types/Events/Recurring";
import { JSONObject, ObjectType } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RestrictionTimes, {
  LEGACY_RESTRICTION_TYPE_KEY,
  RestrictionType,
} from "Common/Types/OnCallDutyPolicy/RestrictionTimes";

/*
 * THE SCHEDULE LAYERS STORED IN A STATE THAT PAGED NOBODY, OR STEPPED THEIR
 * ROTATION AS DAYS, REPAIRED (#11269).
 *
 * Until #11269 a layer's restriction type was read under one key only,
 * restictionType - without the second "r" - and an API write was stored as
 * it came. A layer written with the natural restrictionType, or with its
 * type under any other key or none, was stored with no type the engine
 * read, and the engine put nobody on call in it: every page through it
 * found nobody, and nothing said why. A rotation written as "Weekly" (not
 * Week) was stepped as days, while the roster refresh, which steps
 * rotations the strict way, failed every minute for its schedule - so
 * nobody was told who was on call.
 *
 * Writes are now refused in either state (RestrictionTimes.fromWrittenJSON,
 * Recurring.fromWrittenJSON). For the layers already stored, once, as the
 * server is upgraded, each layer not deleted is read the way the engine
 * reads it now:
 *
 *   - its restriction type under restrictionType or restictionType; with
 *     neither, from the hours it holds - windows of the week Weekly, a
 *     window of the day Daily, nothing usable None, on call around the
 *     clock (RestrictionTimes.inferRestrictionType). That is what the
 *     client asked for: the engine has read it so since the upgrade, and
 *     this stores it, the type under its name alone (toDatabaseJSON), as
 *     every write is stored from now on;
 *   - a rotation interval the engine does not know as the one it names in
 *     another way - "weekly", "Weeks", "WEEK" are Week, "hourly", "daily",
 *     "monthly", "yearly" and "annually" the same - and as Day otherwise,
 *     which is what the engine has stepped it as all along.
 *
 * A layer whose restriction only changes spelling (restictionType to
 * restrictionType) pages exactly as before: it is rewritten as it is, with
 * nothing else touched. A layer whose paging changes - it put nobody on call
 * and now puts its people on call, or its rotation now hands off as it
 * says - is also given a new version and updatedAt, and each of their
 * schedules is told the change as a layer edit is: its shift config version
 * bumped and its calendar feeds dropped (propagateShiftConfigChange), and
 * who is on call worked out again (refreshCurrentUserIdAndHandoffTimeInSchedule)
 * - so the people now on call are told, as at any hand-off, rather than at
 * the schedule's next hand-off. Each such layer is logged, by its project,
 * schedule and id, with what it pages by before and after, and no name.
 *
 * Paged on the layer's id, PAGE_SIZE layers a read; each layer is written
 * only while it still holds what was read (a layer saved since keeps the
 * save). Idempotent, and safe to run twice at once: a layer repaired once
 * reads as stored the second time.
 */

// How many layers a page reads.
export const PAGE_SIZE: number = 500;

// Below every layer's id: where the first page starts.
export const FIRST_ID: string = "00000000-0000-0000-0000-000000000000";

const NAME: string = "RepairScheduleLayerRestrictionTypes";

// A page of layers ($1 the id after which it starts, $2 its size), not deleted.
export const READ_LAYERS_SQL: string = `SELECT "_id" AS "id", "projectId" AS "projectId", "onCallDutyPolicyScheduleId" AS "scheduleId", "restrictionTimes" AS "restrictionTimes", "rotation" AS "rotation" FROM "OnCallDutyPolicyScheduleLayer" WHERE "_id" > $1::uuid AND "deletedAt" IS NULL ORDER BY "_id" ASC LIMIT $2`;

/*
 * A layer ($1) stored as read again ($2 restriction, $3 rotation), while it
 * still holds what was read ($4, $5): the spelling of a restriction alone,
 * which changes nothing it pages by - no version or updatedAt.
 */
export const RESPELL_LAYER_SQL: string = `UPDATE "OnCallDutyPolicyScheduleLayer" SET "restrictionTimes" = $2::jsonb, "rotation" = $3::jsonb WHERE "_id" = $1::uuid AND "deletedAt" IS NULL AND "restrictionTimes" = $4::jsonb AND "rotation" = $5::jsonb RETURNING "_id" AS "id"`;

// The same, for a layer whose paging it changes: a new version and updatedAt.
export const REPAIR_LAYER_SQL: string = `UPDATE "OnCallDutyPolicyScheduleLayer" SET "restrictionTimes" = $2::jsonb, "rotation" = $3::jsonb, "updatedAt" = now(), "version" = "version" + 1 WHERE "_id" = $1::uuid AND "deletedAt" IS NULL AND "restrictionTimes" = $4::jsonb AND "rotation" = $5::jsonb RETURNING "_id" AS "id"`;

// What reading a stored restriction again comes to.
export interface StoredRestrictionRead {
  // As it is stored from now on.
  stored: JSONObject;
  // What the engine read before #11269 (the older key alone), null for nothing.
  typeBefore: RestrictionType | null;
  // What it reads now.
  typeNow: RestrictionType;
}

// What reading a stored rotation again comes to.
export interface StoredRotationRead {
  stored: JSONObject;
  // The interval it names that the engine did not know.
  intervalBefore: string;
  intervalNow: EventInterval;
}

// The other ways an interval was written, as the engine's own words.
const INTERVAL_WORDS: Record<string, EventInterval> = {
  hour: EventInterval.Hour,
  hours: EventInterval.Hour,
  hourly: EventInterval.Hour,
  day: EventInterval.Day,
  days: EventInterval.Day,
  daily: EventInterval.Day,
  week: EventInterval.Week,
  weeks: EventInterval.Week,
  weekly: EventInterval.Week,
  month: EventInterval.Month,
  months: EventInterval.Month,
  monthly: EventInterval.Month,
  year: EventInterval.Year,
  years: EventInterval.Year,
  yearly: EventInterval.Year,
  annual: EventInterval.Year,
  annually: EventInterval.Year,
};

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Whether two stored values are the same JSON, keys in any order.
export function isSameStoredJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item: unknown, index: number): boolean => {
        return isSameStoredJson(item, b[index]);
      })
    );
  }

  if (isObject(a) || isObject(b)) {
    if (!isObject(a) || !isObject(b)) {
      return false;
    }

    const keys: Set<string> = new Set<string>([
      ...Object.keys(a).filter((key: string): boolean => {
        return a[key] !== undefined;
      }),
      ...Object.keys(b).filter((key: string): boolean => {
        return b[key] !== undefined;
      }),
    ]);

    for (const key of keys) {
      if (!isSameStoredJson(a[key], b[key])) {
        return false;
      }
    }

    return true;
  }

  return a === b;
}

/*
 * A stored restriction read again: null when it is not one this reads (no
 * RestrictionTimes there at all), to be left as it is.
 */
export function readStoredRestriction(
  raw: unknown,
): StoredRestrictionRead | null {
  if (!isObject(raw) || raw["_type"] !== ObjectType.RestrictionTimes) {
    return null;
  }

  let restriction: RestrictionTimes;

  try {
    restriction = RestrictionTimes.fromJSON(raw);
  } catch {
    return null;
  }

  const value: JSONObject = isObject(raw["value"]) ? raw["value"] : {};
  const spelledBefore: unknown = value[LEGACY_RESTRICTION_TYPE_KEY];

  return {
    stored: restriction.toDatabaseJSON(),
    typeBefore: RestrictionTimes.isRestrictionType(spelledBefore)
      ? spelledBefore
      : null,
    typeNow: restriction.restrictionType,
  };
}

// The interval a stored rotation names in another way, or null for none.
export function readIntervalWord(value: unknown): EventInterval | null {
  if (typeof value !== "string") {
    return null;
  }

  return INTERVAL_WORDS[value.trim().toLowerCase()] || null;
}

/*
 * A stored rotation read again: null when its interval is one the engine
 * knows, or it is no rotation this reads, to be left as it is.
 */
export function readStoredRotation(raw: unknown): StoredRotationRead | null {
  if (!isObject(raw) || raw["_type"] !== ObjectType.Recurring) {
    return null;
  }

  const value: unknown = raw["value"];

  if (!isObject(value)) {
    return null;
  }

  const interval: unknown = value["intervalType"];

  if (Recurring.isIntervalType(interval)) {
    return null;
  }

  // Left out, fromJSON has always read it as a day: nothing to repair.
  if (interval === undefined || interval === null) {
    return null;
  }

  const intervalNow: EventInterval =
    readIntervalWord(interval) || EventInterval.Day;

  return {
    stored: {
      _type: ObjectType.Recurring,
      value: {
        ...value,
        intervalType: intervalNow,
      },
    },
    intervalBefore: String(interval),
    intervalNow: intervalNow,
  };
}

// A layer of a page, as read.
interface LayerRow {
  id: string;
  projectId: string | null;
  scheduleId: string | null;
  restrictionTimes: unknown;
  rotation: unknown;
}

type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

export default class RepairScheduleLayerRestrictionTypes extends DataMigrationBase {
  public constructor() {
    super(NAME);
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository = (
      OnCallDutyPolicyScheduleLayerService as unknown as DatabaseService<BaseModel>
    ).getRepository();

    // The schedules whose paging changed, by id, with their project.
    const changedSchedules: Map<string, string | null> = new Map<
      string,
      string | null
    >();

    let respelled: number = 0;
    let repaired: number = 0;
    let after: string = FIRST_ID;

    for (;;) {
      const rows: Array<LayerRow> = (await repository.manager.query(
        READ_LAYERS_SQL,
        [after, PAGE_SIZE],
      )) as Array<LayerRow>;

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const restriction: StoredRestrictionRead | null =
          readStoredRestriction(row.restrictionTimes);
        const rotation: StoredRotationRead | null = readStoredRotation(
          row.rotation,
        );

        const restrictionStored: unknown = restriction
          ? restriction.stored
          : row.restrictionTimes;
        const rotationStored: unknown = rotation
          ? rotation.stored
          : row.rotation;

        if (
          isSameStoredJson(restrictionStored, row.restrictionTimes) &&
          isSameStoredJson(rotationStored, row.rotation)
        ) {
          continue;
        }

        const restrictionPagesOtherwise: boolean = Boolean(
          restriction && restriction.typeBefore !== restriction.typeNow,
        );
        const rotationPagesOtherwise: boolean = Boolean(
          rotation && rotation.intervalNow !== EventInterval.Day,
        );
        /*
         * A rotation the roster refresh could not step: paging is the same
         * (as days), but who is on call was never worked out - tell it.
         */
        const isToldAgain: boolean =
          restrictionPagesOtherwise || Boolean(rotation);

        const written: Array<{ id: string }> = (await repository.manager.query(
          restrictionPagesOtherwise || rotationPagesOtherwise
            ? REPAIR_LAYER_SQL
            : RESPELL_LAYER_SQL,
          [
            row.id,
            JSON.stringify(restrictionStored),
            JSON.stringify(rotationStored),
            JSON.stringify(row.restrictionTimes),
            JSON.stringify(row.rotation),
          ],
        )) as Array<{ id: string }>;

        // Saved since it was read: the save stands.
        if (written.length === 0) {
          continue;
        }

        if (!isToldAgain) {
          respelled++;
          continue;
        }

        repaired++;

        logger.info(
          `${NAME}: repaired on-call schedule layer ${row.id} (schedule ${row.scheduleId}, project ${row.projectId}): restriction ${
            restriction
              ? `${restriction.typeBefore || "(none read: nobody on call)"} -> ${restriction.typeNow}`
              : "unchanged"
          }, rotation ${
            rotation
              ? `${rotation.intervalBefore} -> ${rotation.intervalNow}`
              : "unchanged"
          }.`,
          {
            service: "workers",
            projectId: row.projectId || undefined,
            onCallDutyPolicyScheduleId: row.scheduleId || undefined,
          },
        );

        if (row.scheduleId) {
          changedSchedules.set(row.scheduleId, row.projectId);
        }
      }

      after = rows[rows.length - 1]!.id;

      if (rows.length < PAGE_SIZE) {
        break;
      }
    }

    for (const [scheduleId, projectId] of changedSchedules) {
      await RepairScheduleLayerRestrictionTypes.tellScheduleChanged({
        scheduleId: new ObjectID(scheduleId),
        projectId: projectId ? new ObjectID(projectId) : null,
      });
    }

    logger.info(
      `${NAME}: ${repaired} layer(s) repaired across ${changedSchedules.size} schedule(s); ${respelled} layer(s) stored with the restriction type under its name, paging as before.`,
      { service: "workers" },
    );
  }

  /*
   * A repaired schedule is told as a layer edit is (the layer service's
   * tellLayerChange): who is on call worked out again and told, then the
   * change propagated. Best effort: a schedule that cannot be refreshed now
   * is refreshed by the next minute's RefreshHandoffTime.
   */
  private static async tellScheduleChanged(data: {
    scheduleId: ObjectID;
    projectId: ObjectID | null;
  }): Promise<void> {
    try {
      await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
        data.scheduleId,
      );
    } catch (err) {
      logger.error(
        `${NAME}: could not work out who is on call in schedule ${data.scheduleId.toString()}; its next refresh will.`,
        { service: "workers" },
      );
      logger.error(err, { service: "workers" });
    }

    await OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
      scheduleIds: [data.scheduleId],
      projectId: data.projectId,
      reason: OnCallShiftChangeReason.LayerChanged,
    });
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: rolled back, these layers would again page nobody,
     * or hand off on another rotation than they say.
     */
    return;
  }
}
