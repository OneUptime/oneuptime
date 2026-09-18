import logger from "../Utils/Logger";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Model from "../../Models/DatabaseModels/AlertSeverity";
import Queue, { QueueName } from "../Infrastructure/Queue";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Must stay identical to the RunCron job name in
 * App/FeatureSet/Workers/Jobs/OnCallDutyPolicy/BackfillNotificationRulesForNewSeverities.ts.
 * Common cannot import from App, so the string is duplicated deliberately; the
 * job file carries a matching comment naming its two enqueue sites.
 */
const BACKFILL_NOTIFICATION_RULES_JOB_NAME: string =
  "OnCallDutyPolicy:BackfillNotificationRulesForNewSeverities";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.order) {
      throw new BadDataException("Alert severity order is required");
    }

    if (!createBy.data.projectId) {
      throw new BadDataException("Alert severity projectId is required");
    }

    await this.rearrangeOrder(
      createBy.data.order,
      createBy.data.projectId,
      true,
    );

    return {
      createBy: createBy,
      carryForward: null,
    };
  }

  /**
   * A severity created today is a severity every existing responder has no
   * notification rule for. See the twin hook on IncidentSeverityService for the
   * full reasoning; the short version is that default rules are only ever
   * written when a responder joins or verifies a method, and both iterate the
   * severities that exist AT THAT MOMENT, so a severity added later pages
   * nobody until something backfills it.
   *
   * Queued rather than inline because a project can hold thousands of
   * responders and this hook runs inside the request that created the severity.
   * Best-effort because the severity must be created either way - the backfill
   * job also sweeps recently-created severities on its own schedule, so a
   * dropped enqueue costs latency, not coverage.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    try {
      await Queue.addJob(
        QueueName.Worker,
        `${BACKFILL_NOTIFICATION_RULES_JOB_NAME}-${createdItem.id?.toString()}`,
        BACKFILL_NOTIFICATION_RULES_JOB_NAME,
        {
          /*
           * The Worker queue dispatches purely on job NAME and hands the job
           * function no payload, so the job re-derives which severities need
           * backfilling for itself. These ride along for the queue inspector and
           * the failure log.
           */
          projectId: createdItem.projectId?.toString() || "",
          alertSeverityId: createdItem.id?.toString() || "",
        },
        {
          // One active, one queued, latest payload wins - never N overlapping scans.
          deduplication: {
            id: BACKFILL_NOTIFICATION_RULES_JOB_NAME,
            keepLastIfActive: true,
          },
        },
      );
    } catch (err) {
      logger.error(
        "Could not enqueue the on-call notification rule backfill for a newly created alert severity. The scheduled sweep will still pick it up.",
      );
      logger.error(err);
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting alert states. Please try the delete with objectId",
      );
    }

    let alertSeverity: Model | null = null;

    if (!deleteBy.props.isRoot) {
      alertSeverity = await this.findOneBy({
        query: deleteBy.query,
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          projectId: true,
        },
      });
    }

    return {
      deleteBy,
      carryForward: alertSeverity,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
    const alertSeverity: Model | null = onDelete.carryForward;

    if (!deleteBy.props.isRoot && alertSeverity) {
      if (alertSeverity && alertSeverity.order && alertSeverity.projectId) {
        await this.rearrangeOrder(
          alertSeverity.order,
          alertSeverity.projectId,
          false,
        );
      }
    }

    return {
      deleteBy: deleteBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.data.order && !updateBy.props.isRoot) {
      throw new BadDataException(
        "Alert Severity order should not be updated. Delete this alert state and create a new state with the right order.",
      );
    }

    return { updateBy, carryForward: null };
  }

  private async rearrangeOrder(
    currentOrder: number,
    projectId: ObjectID,
    increaseOrder: boolean = true,
  ): Promise<void> {
    // get alert with this order.
    const alertSeverities: Array<Model> = await this.findBy({
      query: {
        order: QueryHelper.greaterThanEqualTo(currentOrder),
        projectId: projectId,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        order: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
    });

    let newOrder: number = currentOrder;

    for (const alertSeverity of alertSeverities) {
      if (increaseOrder) {
        newOrder = alertSeverity.order! + 1;
      } else {
        newOrder = alertSeverity.order! - 1;
      }

      /*
       * Concurrent deletes (e.g. Terraform destroying several items in
       * parallel) can soft-delete a row between the findBy above and
       * this update; save() would then INSERT with a null projectId and
       * fail the whole delete with a 500. A row that vanished
       * mid-rearrange needs no repositioning - skip it.
       */
      try {
        await this.updateOneBy({
          query: {
            _id: alertSeverity._id!,
          },
          data: {
            order: newOrder,
          },
          props: {
            isRoot: true,
          },
        });
      } catch (err) {
        logger.warn(
          `rearrange: skipping row (likely deleted concurrently): ${err}`,
        );
      }
    }
  }
}
export default new Service();
