import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import StateOrderGuard from "../Utils/Database/StateOrderGuard";
import ArchivableValueGuard from "../Utils/Database/ArchivableValueGuard";
import {
  ARCHIVABLE_VALUES,
  ArchivableValueType,
} from "../../Utils/ArchivableValues";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { STATE_LISTS, StateListType } from "../../Utils/StateOrder";
import Model from "../../Models/DatabaseModels/IncidentPostmortemStatus";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import getUpdatedRowCount from "../Utils/Database/UpdatedRowCount";

// How many incidents one statement of the backfill gives a status.
export const POSTMORTEM_STATUS_BACKFILL_BATCH_SIZE: number = 5000;

/*
 * One batch of the backfill for incidents from before postmortem statuses:
 * gives up to `batchSize` incidents with no status the one their postmortem
 * is in by its fields (Common/Utils/Incident/PostmortemStatus
 * .getStartingStatus) - the completed status when it is published (Publish
 * on Status Page on, and a note), the draft status when it has a note, the
 * not started status otherwise. Each built-in status is the project's first
 * from the top that carries the flag, as everywhere else. Incidents of a
 * project with no statuses yet are left for a later run, so every batch
 * gives each of its rows a status and a run ends once one writes none. A
 * note "has" something when it holds a character that is not white space -
 * the status page's own test (hasNote) trims it the same way.
 *
 * Batched so no one statement holds the locks of millions of incidents; a
 * row someone gave a status meanwhile is left as it is.
 */
export const getPostmortemStatusBackfillSql: (batchSize: number) => string = (
  batchSize: number,
): string => {
  const limit: number = Math.max(1, Math.floor(batchSize));

  return `WITH "statuses" AS (
  SELECT "projectId",
    (ARRAY_AGG("_id" ORDER BY "order" ASC NULLS LAST, "createdAt" ASC) FILTER (WHERE "isNotStartedStatus" = true))[1] AS "notStartedId",
    (ARRAY_AGG("_id" ORDER BY "order" ASC NULLS LAST, "createdAt" ASC) FILTER (WHERE "isDraftStatus" = true))[1] AS "draftId",
    (ARRAY_AGG("_id" ORDER BY "order" ASC NULLS LAST, "createdAt" ASC) FILTER (WHERE "isCompletedStatus" = true))[1] AS "completedId"
  FROM "IncidentPostmortemStatus"
  WHERE "deletedAt" IS NULL
  GROUP BY "projectId"
),
"batch" AS (
  SELECT "incident"."_id" AS "incidentId",
    CASE
      WHEN "incident"."showPostmortemOnStatusPage" = true AND COALESCE("incident"."postmortemNote", '') ~ '[^[:space:]]'
        THEN COALESCE("statuses"."completedId", "statuses"."notStartedId")
      WHEN COALESCE("incident"."postmortemNote", '') ~ '[^[:space:]]'
        THEN COALESCE("statuses"."draftId", "statuses"."notStartedId")
      ELSE "statuses"."notStartedId"
    END AS "statusId"
  FROM "Incident" AS "incident"
  INNER JOIN "statuses" ON "statuses"."projectId" = "incident"."projectId"
  WHERE "incident"."postmortemStatusId" IS NULL
    AND "statuses"."notStartedId" IS NOT NULL
  LIMIT ${limit}
)
UPDATE "Incident" SET "postmortemStatusId" = "batch"."statusId"
FROM "batch"
WHERE "Incident"."_id" = "batch"."incidentId"
  AND "Incident"."postmortemStatusId" IS NULL`;
};

/*
 * A project's postmortem statuses (IncidentPostmortemStatus): how far an
 * incident's postmortem has come. A drag-ordered list like the incident
 * states (Common/Utils/StateOrder): a new status with no place goes just
 * above the completed status, and the not started, draft and completed
 * statuses keep that order and are never deleted or archived - OneUptime
 * moves postmortems into them by itself (Common/Utils/Incident/
 * PostmortemStatus). Deleting a status incidents are in is refused by the
 * database; the settings page offers Archive for it.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await StateOrderGuard.beforeCreate({
      service: this,
      definition: STATE_LISTS[StateListType.IncidentPostmortemStatus],
      createBy: createBy,
    });

    // Never created archived if it is a built-in one. See ArchivableValueGuard.
    await ArchivableValueGuard.beforeCreate({
      service: this,
      definition:
        ARCHIVABLE_VALUES[ArchivableValueType.IncidentPostmortemStatus],
      createBy: createBy,
    });

    return {
      createBy: createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting postmortem statuses. Please try the delete with objectId",
      );
    }

    // A project always keeps a not started, a draft and a completed status.
    await StateOrderGuard.beforeDelete({
      service: this,
      definition: STATE_LISTS[StateListType.IncidentPostmortemStatus],
      deleteBy: deleteBy,
    });

    return {
      deleteBy,
      carryForward: null,
    };
  }

  /*
   * A status can be moved - dragged on the settings page, or given another
   * number through the API - as long as the not started, draft and completed
   * statuses keep their order.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await StateOrderGuard.beforeUpdate({
      service: this,
      definition: STATE_LISTS[StateListType.IncidentPostmortemStatus],
      updateBy: updateBy,
    });

    // A built-in status is never archived. See ArchivableValueGuard.
    await ArchivableValueGuard.beforeUpdate({
      service: this,
      definition:
        ARCHIVABLE_VALUES[ArchivableValueType.IncidentPostmortemStatus],
      updateBy: updateBy,
    });

    return { updateBy, carryForward: null };
  }

  /*
   * The project's statuses, top first, as OneUptime reads them: what decides
   * where a new incident's postmortem starts and where an update moves it
   * (Common/Utils/Incident/PostmortemStatus). Archived statuses are among
   * them: an incident in one keeps it, and what it counts as still follows
   * from where it sits.
   */
  @CaptureSpan()
  public async getProjectStatuses(projectId: ObjectID): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        projectId: projectId,
      },
      skip: 0,
      limit: LIMIT_MAX,
      sort: {
        order: SortOrder.Ascending,
      },
      select: {
        _id: true,
        name: true,
        order: true,
        isNotStartedStatus: true,
        isDraftStatus: true,
        isCompletedStatus: true,
        isArchived: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Once, for incidents from before postmortem statuses: each is given the
   * status its postmortem is in by its fields, a batch at a time
   * (getPostmortemStatusBackfillSql), until a batch gives none. Idempotent,
   * and safe to run twice at once. Returns how many incidents it gave a
   * status.
   */
  @CaptureSpan()
  public async backfillIncidentPostmortemStatuses(
    batchSize: number = POSTMORTEM_STATUS_BACKFILL_BATCH_SIZE,
  ): Promise<number> {
    const sql: string = getPostmortemStatusBackfillSql(batchSize);
    let total: number = 0;

    for (;;) {
      const updated: number = getUpdatedRowCount(
        await this.getRepository().manager.query(sql),
      );

      total += updated;

      if (updated === 0) {
        return total;
      }
    }
  }
}

export default new Service();
