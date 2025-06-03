import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ScheduledMaintenanceTemplateOwnerTeamService from "./ScheduledMaintenanceTemplateOwnerTeamService";
import ScheduledMaintenanceTemplateOwnerUserService from "./ScheduledMaintenanceTemplateOwnerUserService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import Typeof from "../../Types/Typeof";
import Model from "../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import ScheduledMaintenanceTemplateOwnerTeam from "../../Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerTeam";
import ScheduledMaintenanceTemplateOwnerUser from "../../Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerUser";
import CreateBy from "../Types/Database/CreateBy";
import OneUptimeDate from "../../Types/Date";
import Recurring from "../../Types/Events/Recurring";
import UpdateBy from "../Types/Database/UpdateBy";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
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
    this.validateEventTemplate(createBy.data);

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
    const newTemplate: QueryDeepPartialEntity<Model> = updateBy.data;

    const existingTemplates: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        isRecurringEvent: true,
        firstEventScheduledAt: true,
        recurringInterval: true,
        firstEventEndsAt: true,
        firstEventStartsAt: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
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

    return {
      updateBy: updateBy,
      carryForward: false,
    };
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
  ): Promise<void> {
    for (let teamId of teamIds) {
      if (typeof teamId === Typeof.String) {
        teamId = new ObjectID(teamId.toString());
      }

      const teamOwner: ScheduledMaintenanceTemplateOwnerTeam =
        new ScheduledMaintenanceTemplateOwnerTeam();
      teamOwner.scheduledMaintenanceTemplateId = scheduledMaintenanceTemplateId;
      teamOwner.projectId = projectId;
      teamOwner.teamId = teamId;

      await ScheduledMaintenanceTemplateOwnerTeamService.create({
        data: teamOwner,
        props: props,
      });
    }

    for (let userId of userIds) {
      if (typeof userId === Typeof.String) {
        userId = new ObjectID(userId.toString());
      }
      const teamOwner: ScheduledMaintenanceTemplateOwnerUser =
        new ScheduledMaintenanceTemplateOwnerUser();
      teamOwner.scheduledMaintenanceTemplateId = scheduledMaintenanceTemplateId;
      teamOwner.projectId = projectId;
      teamOwner.userId = userId;
      await ScheduledMaintenanceTemplateOwnerUserService.create({
        data: teamOwner,
        props: props,
      });
    }
  }
}
export default new Service();
