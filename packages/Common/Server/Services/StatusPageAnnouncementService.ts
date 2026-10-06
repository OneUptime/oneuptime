import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/StatusPageAnnouncement";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "../../Types/StatusPage/SubscriberUpdateNotification";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

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
    await super.onBeforeUpdate(updateBy);

    /*
     * Notifying subscribers about the announcement
     * (shouldStatusPageSubscribersBeNotified) is decided when it is created.
     * An update that writes it - only root and master admins can - leaves
     * that message alone: re-sending the value the announcement holds used
     * to send it to every subscriber again, and turning it on does not send
     * a message the announcement was created without. Turned off, a message
     * still queued is skipped by the job that would send it, which reads the
     * flag.
     */

    /*
     * An edit tells subscribers nothing unless the editor asked for it on this
     * edit (see SubscriberUpdateNotification). When they did, queue the update
     * notification; the Announcement worker job sends it.
     */
    if (SubscriberUpdateNotification.isRequested(updateBy.miscDataProps)) {
      updateBy.data.subscriberNotificationStatusOnAnnouncementUpdated =
        StatusPageSubscriberNotificationStatus.Pending;
      updateBy.data.subscriberNotificationStatusMessageOnAnnouncementUpdated =
        SubscriberUpdateNotification.queuedMessage;
    }

    return {
      updateBy,
      carryForward: null,
    };
  }
}

export default new Service();
