import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import ProjectReferencesService from "./ProjectReferencesService";
import ScheduledMaintenanceTemplateOwnerTeamService from "./ScheduledMaintenanceTemplateOwnerTeamService";
import ScheduledMaintenanceTemplateOwnerUserService from "./ScheduledMaintenanceTemplateOwnerUserService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import Model from "../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import LabelService from "./LabelService";
import MonitorService from "./MonitorService";
import MonitorStatusService from "./MonitorStatusService";
import StatusPageService from "./StatusPageService";
import Dictionary from "../../Types/Dictionary";
import ProjectScopedReferenceValidator, {
  getWrittenRelationReferences,
  HeldRelationIds,
  ProjectScopedReference,
  ProjectScopedRelation,
  resolveReferenceIds,
} from "../Utils/Database/ProjectScopedReferenceValidator";
import {
  getAffectedResourceColumns,
  getAffectedResourceRelations,
} from "../Utils/Database/AffectedResourceRelations";
import CreateBy from "../Types/Database/CreateBy";
import OneUptimeDate from "../../Types/Date";
import Recurring from "../../Types/Events/Recurring";
import UpdateBy from "../Types/Database/UpdateBy";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import BadDataException from "../../Types/Exception/BadDataException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OwnerRuleAssignment from "../Utils/Rules/OwnerRuleAssignment";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The monitor status to switch to and every list a template carries are
   * checked by this service's own hooks below, with
   * ProjectScopedReferenceValidator and its own words.
   */
  protected override getRelationsCheckedByService(): Array<string> {
    return ["changeMonitorStatusTo"];
  }

  protected override getListsCheckedByService(): Array<string> {
    return [
      "monitors",
      "labels",
      "statusPages",
      ...getAffectedResourceColumns(this.getModel()),
    ];
  }

  public validateEventTemplate(template: Model): void {
    // if recurring then start, end, scheduled time should not be null and all of them should be in the future.
    if (template.isRecurringEvent) {
      const startDate: Date | undefined = template.firstEventStartsAt;
      const endDate: Date | undefined = template.firstEventEndsAt;
      const scheduledTime: Date | undefined = template.firstEventScheduledAt;

      if (!startDate) {
        throw new BadDataException(
          "Start date is required for recurring events.",
        );
      }

      if (!endDate) {
        throw new BadDataException(
          "End date is required for recurring events.",
        );
      }

      if (!scheduledTime) {
        throw new BadDataException(
          "Scheduled time is required for recurring events.",
        );
      }

      // check if all dates are in the future.

      if (OneUptimeDate.isInTheFuture(startDate) === false) {
        throw new BadDataException("Start date should be in the future.");
      }

      if (OneUptimeDate.isInTheFuture(endDate) === false) {
        throw new BadDataException("End date should be in the future.");
      }

      if (OneUptimeDate.isInTheFuture(scheduledTime) === false) {
        throw new BadDataException("Scheduled time should be in the future.");
      }

      // make sure scheduedDate is < start date
      if (!OneUptimeDate.isBefore(scheduledTime, startDate)) {
        throw new BadDataException(
          "Scheduled time should be less than start date.",
        );
      }

      // make sure scheduledDate is < end date

      if (!OneUptimeDate.isBefore(scheduledTime, endDate)) {
        throw new BadDataException(
          "Scheduled time should be less than end date.",
        );
      }

      // make sure start date is < end date

      if (!OneUptimeDate.isBefore(startDate, endDate)) {
        throw new BadDataException("Start date should be less than end date.");
      }

      // check recurring internval

      if (template.recurringInterval === undefined) {
        throw new BadDataException(
          "Recurring interval is required for recurring events.",
        );
      }
    }
  }

  public getNextEventTime(data: {
    dateAndTime: Date;
    recurringInterval: Recurring;
  }): Date {
    // check if firstScheduledAt is in the future, and if yes return that.

    if (OneUptimeDate.isInTheFuture(data.dateAndTime)) {
      return data.dateAndTime;
    }

    // if not then calculate the next event time.

    return Recurring.getNextDate(data.dateAndTime, data.recurringInterval);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    // The owners picked in the form are asked about now, before anything is saved.
    await OwnerRuleAssignment.checkOwnersPickedOnCreate({
      ownerUserService: ScheduledMaintenanceTemplateOwnerUserService,
      ownerTeamService: ScheduledMaintenanceTemplateOwnerTeamService,
      resourceIdColumn: "scheduledMaintenanceTemplateId",
      resourceModelType: Model,
      resource: createBy.data,
      miscDataProps: createBy.miscDataProps,
      props: createBy.props,
    });

    this.validateEventTemplate(createBy.data);

    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: createBy.props.tenantId || createBy.data.projectId,
      subject: "scheduled maintenance template",
      references: [
        ...this.getProjectScopedReferences(createBy.data),
        ...ProjectScopedReferenceValidator.getRelationReferences({
          payload: createBy.data,
          relations: this.getProjectScopedRelations(),
        }),
      ],
    });

    if (createBy.data.isRecurringEvent) {
      // if all is good then the next scheduled at time should be set.
      createBy.data.scheduleNextEventAt = this.getNextEventTime({
        dateAndTime: createBy.data.firstEventScheduledAt!,
        recurringInterval: createBy.data.recurringInterval!,
      });
    }

    return {
      createBy: createBy,
      carryForward: false,
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const newTemplate: QueryDeepPartialEntity<Model> = updateBy.data;

    const existingTemplates: Array<Model> =
      await this.findRowsAndHoldUpdateToThem(updateBy, {
        _id: true,
        isRecurringEvent: true,
        firstEventScheduledAt: true,
        recurringInterval: true,
        firstEventEndsAt: true,
        firstEventStartsAt: true,
      });

    for (const template of existingTemplates) {
      let isRecurring: boolean = Boolean(template.isRecurringEvent);

      if (Object.keys(newTemplate).includes("isRecurringEvent")) {
        isRecurring = newTemplate.isRecurringEvent as boolean;
      }

      let firstEventScheduledAt: Date | undefined =
        template.firstEventScheduledAt;

      if (Object.keys(newTemplate).includes("firstEventScheduledAt")) {
        firstEventScheduledAt = newTemplate.firstEventScheduledAt as Date;
      }

      let recurringInterval: Recurring | undefined = template.recurringInterval;

      if (Object.keys(newTemplate).includes("recurringInterval")) {
        recurringInterval = newTemplate.recurringInterval as Recurring;
      }

      let firstEventEndsAt: Date | undefined = template.firstEventEndsAt;

      if (Object.keys(newTemplate).includes("firstEventEndsAt")) {
        firstEventEndsAt = newTemplate.firstEventEndsAt as Date;
      }

      let firstEventStartsAt: Date | undefined = template.firstEventStartsAt;

      if (Object.keys(newTemplate).includes("firstEventStartsAt")) {
        firstEventStartsAt = newTemplate.firstEventStartsAt as Date;
      }

      if (isRecurring) {
        // make sure all are not null.

        if (!firstEventScheduledAt) {
          throw new BadDataException(
            "First event scheduled at is required for recurring events.",
          );
        }

        if (!recurringInterval) {
          throw new BadDataException(
            "Recurring interval is required for recurring events.",
          );
        }

        if (!firstEventEndsAt) {
          throw new BadDataException(
            "First event ends at is required for recurring events.",
          );
        }

        if (!firstEventStartsAt) {
          throw new BadDataException(
            "First event starts at is required for recurring events.",
          );
        }

        // make sure scheduedDate is < start date
        if (
          !OneUptimeDate.isBefore(firstEventScheduledAt, firstEventStartsAt)
        ) {
          throw new BadDataException(
            "Scheduled time should be less than start date.",
          );
        }

        // make sure scheduledDate is < end date

        if (!OneUptimeDate.isBefore(firstEventScheduledAt, firstEventEndsAt)) {
          throw new BadDataException(
            "Scheduled time should be less than end date.",
          );
        }

        // make sure start date is < end date

        if (!OneUptimeDate.isBefore(firstEventStartsAt, firstEventEndsAt)) {
          throw new BadDataException(
            "Start date should be less than end date.",
          );
        }

        // check if firstEventScheduledAt is in the future, and if yes return that.
        if (OneUptimeDate.isInTheFuture(firstEventScheduledAt)) {
          // if it is in the future, then we do not need to change the next scheduled time.
          newTemplate.scheduleNextEventAt = firstEventScheduledAt;
        } else {
          // if it is not in the future, then we need to calculate the next scheduled time.

          // now get next interval time.

          newTemplate.scheduleNextEventAt = this.getNextEventTime({
            dateAndTime: firstEventScheduledAt,
            recurringInterval: recurringInterval,
          });
        }
      }
    }

    updateBy.data = newTemplate;

    await this.validateProjectScopedReferences(updateBy);

    return {
      updateBy: updateBy,
      carryForward: false,
    };
  }

  /*
   * A template is copied onto every event created from it, so an id belonging
   * to another project here becomes a cross-project reference on each of those
   * events — and the referenced project can then no longer be deleted.
   *
   * The same goes for the monitors, labels, status pages and affected-resource
   * lists. ScheduledMaintenanceService checks those lists, so a foreign id
   * saved here made every event created from this template fail.
   */
  private async validateProjectScopedReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const references: Array<ProjectScopedReference> =
      this.getProjectScopedReferences(updateBy.data);

    // An empty list only removes rows and needs no check.
    const relations: Array<ProjectScopedRelation> =
      this.getProjectScopedRelations().filter(
        (relation: ProjectScopedRelation) => {
          return (
            resolveReferenceIds(
              (updateBy.data as Dictionary<unknown>)[relation.column],
            ).length > 0
          );
        },
      );

    if (
      references.every((reference: ProjectScopedReference) => {
        return !reference.id;
      }) &&
      relations.length === 0
    ) {
      return;
    }

    /*
     * The project of every template the update writes: the request's
     * project for a teammate, whose update is kept to it, and each
     * template's own project for OneUptime and a master admin
     * (findProjectsToCheckUpdateIn).
     */
    const projectIds: Array<ObjectID> =
      await this.findProjectsToCheckUpdateIn(updateBy);

    // See ProjectScopedReferenceValidator.getRelationReferences.
    const heldIds: HeldRelationIds | undefined =
      relations.length > 0
        ? await ProjectScopedReferenceValidator.getHeldRelationIds({
            service: this,
            updateBy: updateBy,
            columns: relations.map((relation: ProjectScopedRelation) => {
              return relation.column;
            }),
          })
        : undefined;

    for (const projectId of projectIds) {
      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: projectId,
        subject: "scheduled maintenance template",
        references: [
          ...references,
          ...ProjectScopedReferenceValidator.getRelationReferences({
            payload: updateBy.data,
            relations: relations,
            projectId: projectId,
            heldIds: heldIds,
          }),
        ],
      });
    }
  }

  /*
   * The many-to-many lists whose ids must belong to the template's project.
   * Built per call rather than at module load: these services sit in an
   * import graph that loops back to this one, and a module-level table would
   * capture whichever of them had not finished loading yet as undefined.
   */
  private getProjectScopedRelations(): Array<ProjectScopedRelation> {
    return [
      {
        column: "monitors",
        modelName: "Monitor",
        service: MonitorService,
      },
      {
        column: "labels",
        modelName: "Label",
        service: LabelService,
      },
      {
        column: "statusPages",
        modelName: "Status Page",
        service: StatusPageService,
      },
      ...getAffectedResourceRelations(this.getModel()),
    ];
  }

  /*
   * By both of the relation's names: the API takes the ID column and the
   * relation alike, and the template's cards write the relation. A write
   * may carry both; each is checked, and the two must agree.
   */
  private getProjectScopedReferences(
    data: Model | QueryDeepPartialEntity<Model>,
  ): Array<ProjectScopedReference> {
    return getWrittenRelationReferences({
      payload: data,
      idColumn: "changeMonitorStatusToId",
      relation: "changeMonitorStatusTo",
      modelName: "Monitor Status",
      service: MonitorStatusService,
    });
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // add owners.

    if (
      createdItem.projectId &&
      createdItem.id &&
      onCreate.createBy.miscDataProps &&
      (onCreate.createBy.miscDataProps["ownerTeams"] ||
        onCreate.createBy.miscDataProps["ownerUsers"])
    ) {
      await this.addOwners(
        createdItem.projectId,
        createdItem.id,
        (onCreate.createBy.miscDataProps["ownerUsers"] as Array<ObjectID>) ||
          [],
        (onCreate.createBy.miscDataProps["ownerTeams"] as Array<ObjectID>) ||
          [],
        onCreate.createBy.props,
        true,
      );
    }

    return createdItem;
  }

  @CaptureSpan()
  public async addOwners(
    projectId: ObjectID,
    scheduledMaintenanceTemplateId: ObjectID,
    userIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    props: DatabaseCommonInteractionProps,
    /*
     * True for the owners picked in the form that created the resource:
     * written for its creator when their own permissions do not reach the
     * new resource (OwnerRuleAssignment.createOwner).
     */
    onCreatorsBehalf: boolean = false,
  ): Promise<void> {
    // Owners already on the template are skipped, not added a second time.
    await OwnerRuleAssignment.addOwners({
      ownerUserService: ScheduledMaintenanceTemplateOwnerUserService,
      ownerTeamService: ScheduledMaintenanceTemplateOwnerTeamService,
      resourceIdColumn: "scheduledMaintenanceTemplateId",
      resourceId: scheduledMaintenanceTemplateId,
      projectId: projectId,
      userIds: userIds,
      teamIds: teamIds,
      props: props,
      onCreatorsBehalf: onCreatorsBehalf,
    });
  }
}
export default new Service();
