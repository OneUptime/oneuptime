import logger from "../Utils/Logger";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import StateOrderGuard from "../Utils/Database/StateOrderGuard";
import TeamComplianceSettingService from "./TeamComplianceSettingService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { STATE_LISTS, StateListType } from "../../Utils/StateOrder";
import { ComplianceSeverityKind } from "../../Types/Team/ComplianceRule";
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

// What a delete carries from onBeforeDelete to onDeleteSuccess.
interface SeverityDeleteCarryForward {
  // Team compliance rules scoped only to severities this delete removes.
  complianceSettingIds: Array<string>;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A severity created without a place goes to the end of the list - the
   * least severe - and one created with a number takes that place, the ones
   * in the way stepping down: DatabaseService keeps the order
   * (@ListOrderColumn), for the dashboard, the API and Terraform alike.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await StateOrderGuard.beforeCreate({
      service: this,
      definition: STATE_LISTS[StateListType.AlertSeverity],
      createBy: createBy,
    });

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
        "_id should be present when deleting alert severities. Please try the delete with objectId",
      );
    }

    /*
     * The severities this delete is about to remove, read while the team
     * compliance rules scoped to them still say so: the join rows cascade
     * away with the severity. See TeamComplianceSettingService.
     */
    const severities: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: {
        _id: true,
        projectId: true,
      },
      limit: deleteBy.limit,
      skip: deleteBy.skip,
      props: {
        isRoot: true,
      },
    });

    const carryForward: SeverityDeleteCarryForward = {
      complianceSettingIds:
        await TeamComplianceSettingService.getRulesScopedToAnyOf({
          severityKind: ComplianceSeverityKind.Alert,
          severities: severities,
        }),
    };

    return {
      deleteBy,
      carryForward: carryForward,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
    const carryForward: SeverityDeleteCarryForward | null =
      (onDelete.carryForward as SeverityDeleteCarryForward | null) || null;

    /*
     * The severity is gone, so a compliance rule that was scoped only to it
     * (and to severities other deletes have already removed) now reads as a
     * rule for every alert severity. Pause and mark it instead; a rule with
     * another severity left is left alone. The delete has already happened,
     * so a failure here is logged rather than reported as a failed delete.
     */
    const complianceSettingIds: Array<string> =
      carryForward?.complianceSettingIds || [];

    if (complianceSettingIds.length > 0) {
      try {
        await TeamComplianceSettingService.pauseRulesLeftWithoutSeverities({
          severityKind: ComplianceSeverityKind.Alert,
          settingIds: complianceSettingIds,
        });
      } catch (err) {
        logger.error(
          "Could not pause the team compliance rules left without a severity by an alert severity delete. They now check every alert severity until they are edited.",
        );
        logger.error(err);
      }
    }

    return {
      deleteBy: deleteBy,
      carryForward: null,
    };
  }
}
export default new Service();
