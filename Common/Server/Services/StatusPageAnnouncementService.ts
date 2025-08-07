import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/StatusPageAnnouncement";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // Set notification status based on shouldStatusPageSubscribersBeNotified
    if (createBy.data.shouldStatusPageSubscribersBeNotified === false) {
      createBy.data.subscriberNotificationStatus =
        StatusPageSubscriberNotificationStatus.Skipped;
      createBy.data.subscriberNotificationStatusMessage =
        "Notifications skipped as subscribers are not to be notified for this announcement.";
    } else if (createBy.data.shouldStatusPageSubscribersBeNotified === true) {
      createBy.data.subscriberNotificationStatus =
        StatusPageSubscriberNotificationStatus.Pending;
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // Set notification status based on shouldStatusPageSubscribersBeNotified if it's being updated
    if (updateBy.data.shouldStatusPageSubscribersBeNotified !== undefined) {
      if (updateBy.data.shouldStatusPageSubscribersBeNotified === false) {
        updateBy.data.subscriberNotificationStatus =
          StatusPageSubscriberNotificationStatus.Skipped;
        updateBy.data.subscriberNotificationStatusMessage =
          "Notifications skipped as subscribers are not to be notified for this announcement.";
      } else if (updateBy.data.shouldStatusPageSubscribersBeNotified === true) {
        updateBy.data.subscriberNotificationStatus =
          StatusPageSubscriberNotificationStatus.Pending;
      }
    }

    return {
      updateBy,
      carryForward: null,
    };
  }
}

export default new Service();
