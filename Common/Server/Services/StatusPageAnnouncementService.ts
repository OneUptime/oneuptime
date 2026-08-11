import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/StatusPageAnnouncement";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import ObjectID from "../../Types/ObjectID";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { syncIsPublicForMarkdownImages } from "../Utils/InlineImageAccessTokenSync";

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

  /*
   * An announcement is always rendered on the status pages it is attached
   * to, so any inline image the markdown editor uploaded as private must
   * flip to public for anonymous status page viewers to render it.
   */
  @CaptureSpan()
  public override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    await syncIsPublicForMarkdownImages(
      createdItem.description,
      true,
      `status page announcement ${createdItem.id?.toString()}`,
    );

    return createdItem;
  }

  @CaptureSpan()
  public override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (onUpdate.updateBy.data.description) {
      const updatedItems: Array<Model> = await this.findBy({
        query: onUpdate.updateBy.query,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
        select: {
          description: true,
        },
      });

      for (const updatedItem of updatedItems) {
        await syncIsPublicForMarkdownImages(
          updatedItem.description,
          true,
          `status page announcement ${updatedItem.id?.toString()}`,
        );
      }
    }

    return onUpdate;
  }
}

export default new Service();
