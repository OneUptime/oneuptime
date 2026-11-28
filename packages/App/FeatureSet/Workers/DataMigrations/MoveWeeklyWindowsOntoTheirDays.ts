import DataMigrationBase from "./DataMigrationBase";
import { countWrittenRows } from "./RepairScheduleLayerRestrictionTypes";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import OnCallDutyPolicyScheduleLayerService from "Common/Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import logger from "Common/Server/Utils/Logger";
import { OnCallShiftChangeReason } from "Common/Server/Utils/OnCall/OnCallShiftChangeListeners";
import { JSONObject, ObjectType } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
} from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
import WeeklyWindowDays, {
  StoredWindowRepair,
  StoredWindowState,
  StoredWindowsRepair,
} from "Common/Types/OnCallDutyPolicy/WeeklyWindowDays";

/*
 * THE WEEKLY WINDOWS STORED ON OTHER DAYS THAN THEY NAME, PUT ON THEIR DAYS
 * WHERE THAT IS CLEARLY WHAT WAS MEANT (#11455).
 *
 * A weekly window of a layer's active hours is on call on the weekdays its
 * startTime and endTime fall on, in its schedule's time zone; startDay and
 * endDay were never read. Writes are now held to them
 * (WeeklyWindowDays.checkWrittenWindows). For the windows already stored,
 * once, as the server is upgraded, each layer not deleted is read in its
 * schedule's zone (the server's for a schedule without one) by the rule
 * the Dashboard reads them by too (WeeklyWindowDays.getStoredWindowRepair):
 *
 *   - a day left out, or written another way (" monday"), is filled in from
 *     its time. It pages exactly as before, so the layer is stored with no
 *     new version and nobody is told.
 *
 *   - a time on another day than its window names, and on that day in no
 *     time zone - a Monday dated on a Wednesday - was dated wrong: an API or
 *     Terraform write that took the date for a placeholder, as the API
 *     reference's "startDay ... and startTime" said nothing against, or a
 *     Dashboard default whose day was kept and whose time was never touched
 *     (until July 2026 that time was dated on the day the window was
 *     added). The day it names is what a person chose and what every form
 *     has shown, so it is moved onto that day, at the same time of day. It
 *     pages on its days from now on: the layer gets a new version and
 *     updatedAt, and its schedule is told as a layer edit is - who is on
 *     call worked out again and told, its calendar feeds dropped.
 *
 *   - a time on another day than its window names here, but on that day in
 *     another time zone, could have been dated there: before July 2026 the
 *     Dashboard dated times in the editor's own zone, and a schedule's zone
 *     set or changed later kept the moments, so a Monday 01:00 window set
 *     in Warsaw reads as Sunday 19:00 in New York. Whether its person meant
 *     the day or the moment cannot be told, and moving it onto its day at
 *     the time it reads now would land on hours nobody picked. It is left
 *     as it pages, and logged; the schedule's Layers page marks it to be
 *     checked, with the days it names and the days it is on call, and the
 *     layer's Save Layer keeps it where it pages until its person picks
 *     other days.
 *
 * Each layer is written only while it still holds what was read (a layer
 * saved since keeps the save). Paged on the layer's id, PAGE_SIZE layers a
 * read. Safe to run again, and two at once: a second run finds nothing to
 * move or fill in, and logs the windows to check again.
 */

// How many layers a page reads.
export const PAGE_SIZE: number = 500;

// Below every layer's id: where the first page starts.
export const FIRST_ID: string = "00000000-0000-0000-0000-000000000000";

const NAME: string = "MoveWeeklyWindowsOntoTheirDays";

/*
 * A page of layers ($1 the id after which it starts, $2 its size), not
 * deleted, each with its schedule's time zone.
 */
export const READ_LAYERS_SQL: string = `SELECT "layer"."_id" AS "id", "layer"."projectId" AS "projectId", "layer"."onCallDutyPolicyScheduleId" AS "scheduleId", "layer"."restrictionTimes" AS "restrictionTimes", "schedule"."timezone" AS "timezone" FROM "OnCallDutyPolicyScheduleLayer" "layer" LEFT JOIN "OnCallDutyPolicySchedule" "schedule" ON "schedule"."_id" = "layer"."onCallDutyPolicyScheduleId" WHERE "layer"."_id" > $1::uuid AND "layer"."deletedAt" IS NULL ORDER BY "layer"."_id" ASC LIMIT $2`;

/*
 * A layer ($1) stored with its days filled in ($2), while it still holds
 * what was read ($3): it pages as before - no version or updatedAt.
 */
export const FILL_IN_DAYS_SQL: string = `UPDATE "OnCallDutyPolicyScheduleLayer" SET "restrictionTimes" = $2::jsonb WHERE "_id" = $1::uuid AND "deletedAt" IS NULL AND "restrictionTimes" = $3::jsonb RETURNING "_id" AS "id"`;

// The same, for a layer whose windows move onto their days: a new version and updatedAt.
export const MOVE_ONTO_DAYS_SQL: string = `UPDATE "OnCallDutyPolicyScheduleLayer" SET "restrictionTimes" = $2::jsonb, "updatedAt" = now(), "version" = "version" + 1 WHERE "_id" = $1::uuid AND "deletedAt" IS NULL AND "restrictionTimes" = $3::jsonb RETURNING "_id" AS "id"`;

// What reading a stored layer's restriction again comes to.
export interface StoredLayerRead {
  // As it is to be stored, or null when it is to be left as it is.
  stored: JSONObject | null;
  // Whether a window moves onto its days: it pages otherwise from now on.
  pagesOtherwise: boolean;
  repair: StoredWindowsRepair;
}

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/*
 * A stored restriction read again, in its schedule's zone: null for one
 * that is not Weekly or is no RestrictionTimes this reads.
 */
export function readStoredLayer(
  raw: unknown,
  timezone: string | null | undefined,
): StoredLayerRead | null {
  if (!isObject(raw) || raw["_type"] !== ObjectType.RestrictionTimes) {
    return null;
  }

  let restriction: RestrictionTimes;

  try {
    restriction = RestrictionTimes.fromJSON(raw);
  } catch {
    return null;
  }

  if (restriction.restrictionType !== RestrictionType.Weekly) {
    return null;
  }

  const repair: StoredWindowsRepair = WeeklyWindowDays.getStoredWindowsRepair(
    restriction,
    timezone,
  );

  if (!repair.isChanged) {
    return { stored: null, pagesOtherwise: false, repair: repair };
  }

  const repaired: RestrictionTimes = new RestrictionTimes();
  repaired.restrictionType = restriction.restrictionType;
  repaired.dayRestrictionTimes = restriction.dayRestrictionTimes;
  repaired.weeklyRestrictionTimes = repair.windows;

  return {
    stored: repaired.toDatabaseJSON(),
    pagesOtherwise: repair.pagesOtherwise,
    repair: repair,
  };
}

// The windows of a read in a state, by their place: "#0 Monday->Wednesday".
export function describeWindows(
  repair: StoredWindowsRepair,
  state: StoredWindowState,
): string {
  return repair.repairs
    .map((window: StoredWindowRepair, index: number): string | null => {
      if (window.state !== state) {
        return null;
      }

      return `#${index} names ${window.start.dayAsRead || "(none)"}-${
        window.end.dayAsRead || "(none)"
      }, its times fall on ${window.start.fallsOn}-${window.end.fallsOn}`;
    })
    .filter((line: string | null): line is string => {
      return Boolean(line);
    })
    .join("; ");
}

// A layer of a page, as read.
interface LayerRow {
  id: string;
  projectId: string | null;
  scheduleId: string | null;
  restrictionTimes: unknown;
  timezone: string | null;
}

type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

export default class MoveWeeklyWindowsOntoTheirDays extends DataMigrationBase {
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

    let moved: number = 0;
    let filledIn: number = 0;
    let toCheck: number = 0;
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
        const read: StoredLayerRead | null = readStoredLayer(
          row.restrictionTimes,
          row.timezone,
        );

        if (!read) {
          continue;
        }

        const windowsToCheck: string = describeWindows(
          read.repair,
          StoredWindowState.ToCheck,
        );

        if (windowsToCheck) {
          toCheck++;

          logger.info(
            `${NAME}: on-call schedule layer ${row.id} (schedule ${row.scheduleId}, project ${row.projectId}) keeps weekly windows whose times fall on other days than they name in ${
              row.timezone || "the server's time zone"
            }, but on those days in another zone: left as they page, and marked on the schedule's Layers page to be checked: ${windowsToCheck}.`,
            {
              service: "workers",
              projectId: row.projectId || undefined,
              onCallDutyPolicyScheduleId: row.scheduleId || undefined,
            },
          );
        }

        if (!read.stored) {
          continue;
        }

        const written: number = countWrittenRows(
          await repository.manager.query(
            read.pagesOtherwise ? MOVE_ONTO_DAYS_SQL : FILL_IN_DAYS_SQL,
            [
              row.id,
              JSON.stringify(read.stored),
              JSON.stringify(row.restrictionTimes),
            ],
          ),
        );

        // Saved since it was read: the save stands, and was told as saved.
        if (written === 0) {
          continue;
        }

        if (!read.pagesOtherwise) {
          filledIn++;
          continue;
        }

        moved++;

        logger.info(
          `${NAME}: moved the weekly windows of on-call schedule layer ${row.id} (schedule ${row.scheduleId}, project ${row.projectId}) onto the days they name, in ${
            row.timezone || "the server's time zone"
          }: ${describeWindows(read.repair, StoredWindowState.MovedOntoItsDays)}.`,
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
      await MoveWeeklyWindowsOntoTheirDays.tellScheduleChanged({
        scheduleId: new ObjectID(scheduleId),
        projectId: projectId ? new ObjectID(projectId) : null,
      });
    }

    logger.info(
      `${NAME}: ${moved} layer(s) moved onto the days their weekly windows name, across ${changedSchedules.size} schedule(s); ${filledIn} layer(s) had their windows' days filled in, paging as before; ${toCheck} layer(s) have windows to check, left as they page.`,
      { service: "workers" },
    );
  }

  /*
   * A changed schedule is told as a layer edit is: who is on call worked
   * out again and told, then the change propagated. Best effort: a schedule
   * that cannot be refreshed now is refreshed by the next minute's
   * RefreshHandoffTime.
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
     * Nothing to undo: rolled back, these windows would again be on call
     * on other days than they name.
     */
    return;
  }
}
