import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import SavedChatMessage, {
  SavedChatMessageUtil,
} from "../../Types/Workspace/SavedChatMessage";
import PositiveNumber from "../../Types/PositiveNumber";
import CountBy from "../Types/Database/CountBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger, { LogAttributes } from "../Utils/Logger";
import ProjectReferencesService from "./ProjectReferencesService";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../Models/DatabaseModels/IncidentFeed";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import FeedWorkspaceNotificationUtil, {
  FeedWorkspaceAuthor,
  FeedWorkspaceNotification,
} from "../Utils/Feed/FeedWorkspaceNotification";
import { applyIncidentRelatedRecordPrivacyFilter } from "../Utils/Incident/IncidentPrivacyFilter";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  FeedApiKeyActor,
  UNNAMED_API_KEY_NAME,
} from "../Utils/Feed/FeedApiKeyActor";

export class Service extends ProjectReferencesService<IncidentFeed> {
  public constructor() {
    super(IncidentFeed);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  /*
   * Feed items are mostly written by OneUptime itself as things happen, naming
   * the record they are about and crediting whoever did it - someone who may
   * have left the project since, or an admin from outside it. Refusing one of
   * those would only lose the item. A feed item written by an API call or a
   * workflow is checked like any other write.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<IncidentFeed>,
  ): Promise<OnFind<IncidentFeed>> {
    findBy.query = applyIncidentRelatedRecordPrivacyFilter(
      findBy.query,
      findBy.props,
    );
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<IncidentFeed>,
  ): Promise<PositiveNumber> {
    countBy.query = applyIncidentRelatedRecordPrivacyFilter(
      countBy.query,
      countBy.props,
    );
    return super.countBy(countBy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<IncidentFeed>,
  ): Promise<OnUpdate<IncidentFeed>> {
    await super.onBeforeUpdate(updateBy);

    updateBy.query = applyIncidentRelatedRecordPrivacyFilter(
      updateBy.query,
      updateBy.props,
    );
    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<IncidentFeed>,
  ): Promise<OnDelete<IncidentFeed>> {
    deleteBy.query = applyIncidentRelatedRecordPrivacyFilter(
      deleteBy.query,
      deleteBy.props,
    );
    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  public async createIncidentFeedItem(data: {
    incidentId: ObjectID;
    feedInfoInMarkdown: string;
    incidentFeedEventType: IncidentFeedEventType;
    projectId: ObjectID;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
    userId?: ObjectID | undefined;
    postedAt?: Date | undefined;
    /*
     * A note saved from a Slack or Microsoft Teams message: who wrote it,
     * in which chat, and when (SavedChatMessage). The row's user is
     * whoever saved it.
     */
    savedFromChatMessage?: SavedChatMessage | undefined;
    aiRunId?: ObjectID | undefined;
    /*
     * The project API key that made the change, when no person did
     * (Utils/Feed/FeedApiKeyActor.fromProps of the write's props): the item
     * names it as its author. Ignored when the item has a user.
     */
    apiKeyActor?: FeedApiKeyActor | undefined;
    /*
     * Posted to Slack and Microsoft Teams too (FeedWorkspaceNotification),
     * opening with the person - or the API key - the item names.
     */
    workspaceNotification?: FeedWorkspaceNotification | undefined;
  }): Promise<void> {
    try {
      logger.debug("IncidentFeedService.createIncidentFeedItem", {
        projectId: data.projectId?.toString(),
        incidentId: data.incidentId?.toString(),
      } as LogAttributes);
      logger.debug(data, {
        projectId: data.projectId?.toString(),
        incidentId: data.incidentId?.toString(),
      } as LogAttributes);

      const incidentFeed: IncidentFeed = new IncidentFeed();

      if (!data.incidentId) {
        throw new BadDataException("Incident ID is required");
      }

      if (!data.feedInfoInMarkdown) {
        throw new BadDataException("Log in markdown is required");
      }

      if (!data.incidentFeedEventType) {
        throw new BadDataException("Incident log event is required");
      }

      if (!data.projectId) {
        throw new BadDataException("Project ID is required");
      }

      if (!data.displayColor) {
        data.displayColor = Blue500;
      }

      incidentFeed.displayColor = data.displayColor;
      incidentFeed.incidentId = data.incidentId;
      incidentFeed.feedInfoInMarkdown = data.feedInfoInMarkdown;
      incidentFeed.incidentFeedEventType = data.incidentFeedEventType;
      incidentFeed.projectId = data.projectId;

      if (data.aiRunId) {
        incidentFeed.aiRunId = data.aiRunId;
      }

      // When it happened: the time the caller gives, or now.
      incidentFeed.postedAt = data.postedAt || OneUptimeDate.getCurrentDate();

      if (data.userId) {
        incidentFeed.userId = data.userId;
      } else if (data.apiKeyActor?.apiKeyId) {
        incidentFeed.apiKeyId = data.apiKeyActor.apiKeyId;
        incidentFeed.apiKeyName =
          data.apiKeyActor.apiKeyName || UNNAMED_API_KEY_NAME;
      }

      if (data.moreInformationInMarkdown) {
        incidentFeed.moreInformationInMarkdown = data.moreInformationInMarkdown;
      }

      if (data.savedFromChatMessage) {
        incidentFeed.savedFromChatMessage = SavedChatMessageUtil.toJSON(
          data.savedFromChatMessage,
        );
      }

      const createdIncidentFeed: IncidentFeed = await this.create({
        data: incidentFeed,
        props: {
          isRoot: true,
        },
      });

      logger.debug("Incident Feed created", {
        projectId: data.projectId?.toString(),
        incidentId: data.incidentId?.toString(),
      } as LogAttributes);
      logger.debug(createdIncidentFeed, {
        projectId: data.projectId?.toString(),
        incidentId: data.incidentId?.toString(),
      } as LogAttributes);

      try {
        // send notification to slack and teams
        if (
          data.workspaceNotification &&
          data.workspaceNotification?.sendWorkspaceNotification
        ) {
          await this.sendWorkspaceNotification({
            projectId: data.projectId,
            incidentId: data.incidentId,
            feedInfoInMarkdown: data.feedInfoInMarkdown,
            workspaceNotification: {
              ...data.workspaceNotification,
              // Where a rule keeps its messages in one thread (WorkspaceRecordThreads).
              startsRecordThread:
                data.incidentFeedEventType ===
                IncidentFeedEventType.IncidentCreated,
              alsoSendToChannel:
                data.incidentFeedEventType ===
                IncidentFeedEventType.IncidentStateChanged,
            },
            author: FeedWorkspaceNotificationUtil.getAuthor({
              workspaceNotification: data.workspaceNotification,
              userId: data.userId,
              apiKeyActor: data.apiKeyActor,
              savedFromChatMessage: data.savedFromChatMessage,
            }),
          });
        }
      } catch (e) {
        logger.error("Error in sending notification to slack and teams", {
          projectId: data.projectId?.toString(),
          incidentId: data.incidentId?.toString(),
        } as LogAttributes);
        logger.error(e, {
          projectId: data.projectId?.toString(),
          incidentId: data.incidentId?.toString(),
        } as LogAttributes);

        // we dont throw this error as it is not a critical error
      }
    } catch (e) {
      logger.error("Error in creating incident feed", {
        projectId: data.projectId?.toString(),
        incidentId: data.incidentId?.toString(),
      } as LogAttributes);
      logger.error(e, {
        projectId: data.projectId?.toString(),
        incidentId: data.incidentId?.toString(),
      } as LogAttributes);

      // we dont throw this error as it is not a critical error
    }
  }

  /*
   * Posts an entry to the record's Slack and Microsoft Teams channels,
   * opening with the author the entry names (FeedWorkspaceNotification).
   */
  @CaptureSpan()
  public async sendWorkspaceNotification(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    feedInfoInMarkdown: string;
    workspaceNotification: FeedWorkspaceNotification;
    // Who the message opens with (FeedWorkspaceNotificationUtil.getAuthor).
    author?: FeedWorkspaceAuthor | undefined;
  }): Promise<void> {
    return await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
      {
        projectId: data.projectId,
        notificationFor: {
          incidentId: data.incidentId,
        },
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        notificationText: data.workspaceNotification.notificationText,
        workspaceNotification:
          FeedWorkspaceNotificationUtil.toWorkspaceNotification({
            workspaceNotification: data.workspaceNotification,
            author: data.author,
          }),
      },
    );
  }
}

export default new Service();
