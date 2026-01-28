import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import OnCallDutyExecutionLogTimelineStatus from "../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { Blue500, Green500, Red500, Yellow500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import ObjectID from "../../Types/ObjectID";
import logger from "../Utils/Logger";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import AlertFeedService from "./AlertFeedService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import AlertEpisodeFeedService from "./AlertEpisodeFeedService";
import { AlertEpisodeFeedEventType } from "../../Models/DatabaseModels/AlertEpisodeFeed";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import AlertService from "./AlertService";
import AlertEpisodeService from "./AlertEpisodeService";
import IncidentEpisodeService from "./IncidentEpisodeService";
import IncidentService from "./IncidentService";
import UserService from "./UserService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public getColorBasedOnStatus(
    status: OnCallDutyExecutionLogTimelineStatus,
  ): Color {
    switch (status) {
      case OnCallDutyExecutionLogTimelineStatus.Started:
        return Blue500;
      case OnCallDutyExecutionLogTimelineStatus.Executing:
        return Yellow500;
      case OnCallDutyExecutionLogTimelineStatus.Error:
        return Red500;
      case OnCallDutyExecutionLogTimelineStatus.NotificationSent:
        return Green500;
      case OnCallDutyExecutionLogTimelineStatus.Skipped:
        return Red500;
      case OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged:
        return Green500;
      default:
        return Blue500;
    }
  }

  public getEmojiBasedOnStatus(
    status: OnCallDutyExecutionLogTimelineStatus,
  ): string {
    switch (status) {
      case OnCallDutyExecutionLogTimelineStatus.Started:
        return "🚀";
      case OnCallDutyExecutionLogTimelineStatus.Executing:
        return "🔄";
      case OnCallDutyExecutionLogTimelineStatus.Error:
        return "❌";
      case OnCallDutyExecutionLogTimelineStatus.NotificationSent:
        return "📧";
      case OnCallDutyExecutionLogTimelineStatus.Skipped:
        return "🚫";
      case OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged:
        return "✅";
      default:
        return "🚀";
    }
  }

  @CaptureSpan()
  public async addToIncidentOrAlertFeed(data: {
    onCallDutyPolicyExecutionLogTimelineId: ObjectID;
  }): Promise<void> {
    logger.debug(
      "OnCallDutyPolicyExecutionLogTimelineService.addToIncidentFeed",
    );

    const onCallDutyPolicyExecutionLogTimeline: Model | null =
      await this.findOneById({
        id: data.onCallDutyPolicyExecutionLogTimelineId,
        select: {
          _id: true,
          onCallDutyPolicyId: true,
          triggeredByIncidentId: true,
          triggeredByAlertId: true,
          triggeredByAlertEpisodeId: true,
          projectId: true,
          status: true,
          statusMessage: true,
          alertSentToUserId: true,
          onCallDutyPolicy: {
            name: true,
            _id: true,
          },
          alertSentToUser: {
            name: true,
            email: true,
          },
          onCallDutyPolicyEscalationRule: {
            name: true,
            _id: true,
          },
          onCallDutySchedule: {
            name: true,
            _id: true,
          },
          isAcknowledged: true,
          acknowledgedAt: true,
          userBelongsToTeam: {
            name: true,
            _id: true,
          },
          overridedByUser: {
            name: true,
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    logger.debug("OnCallDutyPolicyExecutionLogTimeline: ");
    logger.debug(onCallDutyPolicyExecutionLogTimeline);

    if (!onCallDutyPolicyExecutionLogTimeline) {
      return;
    }

    if (
      !onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentId &&
      !onCallDutyPolicyExecutionLogTimeline.triggeredByAlertId &&
      !onCallDutyPolicyExecutionLogTimeline.triggeredByAlertEpisodeId &&
      !onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentEpisodeId
    ) {
      return;
    }

    if (
      onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicy &&
      onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicy.id
    ) {
      const status: OnCallDutyExecutionLogTimelineStatus =
        onCallDutyPolicyExecutionLogTimeline.status!;

      logger.debug("Status: " + status);

      if (
        status &&
        (status === OnCallDutyExecutionLogTimelineStatus.Skipped ||
          status === OnCallDutyExecutionLogTimelineStatus.Error ||
          status ===
            OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged ||
          status === OnCallDutyExecutionLogTimelineStatus.NotificationSent)
      ) {
        const displayColor: Color = status
          ? this.getColorBasedOnStatus(status)
          : Blue500;

        let incidentOrAlertLink: string = "";

        if (onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentId) {
          const projectId: ObjectID | undefined =
            onCallDutyPolicyExecutionLogTimeline.projectId;
          const incidentId: ObjectID | undefined =
            onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentId;
          const incidentNumber: number | null =
            await IncidentService.getIncidentNumber({
              incidentId: incidentId,
            });
          incidentOrAlertLink = `[Incident ${incidentNumber}](${(await IncidentService.getIncidentLinkInDashboard(projectId!, incidentId!)).toString()})`;
        }

        if (onCallDutyPolicyExecutionLogTimeline.triggeredByAlertId) {
          const alertNumber: number | null = await AlertService.getAlertNumber({
            alertId: onCallDutyPolicyExecutionLogTimeline.triggeredByAlertId,
          });
          incidentOrAlertLink = `[Alert ${alertNumber}](${(await AlertService.getAlertLinkInDashboard(onCallDutyPolicyExecutionLogTimeline.projectId!, onCallDutyPolicyExecutionLogTimeline.triggeredByAlertId)).toString()})`;
        }

        if (onCallDutyPolicyExecutionLogTimeline.triggeredByAlertEpisodeId) {
          const episodeNumber: number | null =
            await AlertEpisodeService.getEpisodeNumber({
              episodeId:
                onCallDutyPolicyExecutionLogTimeline.triggeredByAlertEpisodeId,
            });
          incidentOrAlertLink = `[Alert Episode ${episodeNumber}](${(await AlertEpisodeService.getEpisodeLinkInDashboard(onCallDutyPolicyExecutionLogTimeline.projectId!, onCallDutyPolicyExecutionLogTimeline.triggeredByAlertEpisodeId)).toString()})`;
        }

        if (onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentEpisodeId) {
          const episodeNumber: number | null =
            await IncidentEpisodeService.getEpisodeNumber({
              episodeId:
                onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentEpisodeId,
            });
          incidentOrAlertLink = `[Incident Episode ${episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(onCallDutyPolicyExecutionLogTimeline.projectId!, onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentEpisodeId)).toString()})`;
        }

        let feedInfoInMarkdown: string = `**${this.getEmojiBasedOnStatus(status)} ${incidentOrAlertLink} On-Call Alert ${status} to ${await UserService.getUserMarkdownString(
          {
            userId: onCallDutyPolicyExecutionLogTimeline.alertSentToUserId!,
            projectId: onCallDutyPolicyExecutionLogTimeline.projectId!,
          },
        )}**

The on-call policy **[${onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicy.name}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(onCallDutyPolicyExecutionLogTimeline.projectId!, onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicy.id!)).toString()})** has been triggered. The escalation rule **${onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicyEscalationRule?.name}** ${onCallDutyPolicyExecutionLogTimeline.onCallDutySchedule?.name ? String(" and schedule **" + onCallDutyPolicyExecutionLogTimeline.onCallDutySchedule?.name + "**") : ""} were applied. ${await UserService.getUserMarkdownString(
          {
            userId: onCallDutyPolicyExecutionLogTimeline.alertSentToUserId!,
            projectId: onCallDutyPolicyExecutionLogTimeline.projectId!,
          },
        )} was alerted. The status of this alert is **${status}** with the message: \`${onCallDutyPolicyExecutionLogTimeline.statusMessage}\`. ${onCallDutyPolicyExecutionLogTimeline.userBelongsToTeam?.name ? "The alert was sent because the user belogs to the team **" + onCallDutyPolicyExecutionLogTimeline.userBelongsToTeam?.name + "** " : ""} ${onCallDutyPolicyExecutionLogTimeline.isAcknowledged ? "The alert was acknowledged at **" + onCallDutyPolicyExecutionLogTimeline.acknowledgedAt + "** " : ""}`;

        if (onCallDutyPolicyExecutionLogTimeline.overridedByUser) {
          feedInfoInMarkdown += `The alert was supposed to be sent to **${await UserService.getUserMarkdownString(
            {
              userId: onCallDutyPolicyExecutionLogTimeline.overridedByUser.id!,
              projectId: onCallDutyPolicyExecutionLogTimeline.projectId!,
            },
          )}** but was routed to **${await UserService.getUserMarkdownString({
            userId: onCallDutyPolicyExecutionLogTimeline.alertSentToUserId!,
            projectId: onCallDutyPolicyExecutionLogTimeline.projectId!,
          })}** instead, because of an override rule.`;
        }

        logger.debug("Feed Info in Markdown: " + feedInfoInMarkdown);

        if (onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentId) {
          await IncidentFeedService.createIncidentFeedItem({
            incidentId:
              onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentId,
            projectId: onCallDutyPolicyExecutionLogTimeline.projectId!,
            incidentFeedEventType: IncidentFeedEventType.OnCallPolicy,
            displayColor: displayColor,
            feedInfoInMarkdown: feedInfoInMarkdown,
            workspaceNotification: {
              sendWorkspaceNotification: true,
            },
          });
        }

        if (onCallDutyPolicyExecutionLogTimeline.triggeredByAlertId) {
          await AlertFeedService.createAlertFeedItem({
            alertId: onCallDutyPolicyExecutionLogTimeline.triggeredByAlertId,
            projectId: onCallDutyPolicyExecutionLogTimeline.projectId!,
            alertFeedEventType: AlertFeedEventType.OnCallPolicy,
            displayColor: displayColor,
            feedInfoInMarkdown: feedInfoInMarkdown,
          });
        }

        if (onCallDutyPolicyExecutionLogTimeline.triggeredByAlertEpisodeId) {
          await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
            alertEpisodeId:
              onCallDutyPolicyExecutionLogTimeline.triggeredByAlertEpisodeId,
            projectId: onCallDutyPolicyExecutionLogTimeline.projectId!,
            alertEpisodeFeedEventType:
              AlertEpisodeFeedEventType.OnCallNotification,
            displayColor: displayColor,
            feedInfoInMarkdown: feedInfoInMarkdown,
          });
        }

        if (onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentEpisodeId) {
          await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
            incidentEpisodeId:
              onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentEpisodeId,
            projectId: onCallDutyPolicyExecutionLogTimeline.projectId!,
            incidentEpisodeFeedEventType:
              IncidentEpisodeFeedEventType.OnCallNotification,
            displayColor: displayColor,
            feedInfoInMarkdown: feedInfoInMarkdown,
          });
        }

        logger.debug("Incident Feed created");
      }
    }
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    logger.debug("OnCallDutyPolicyExecutionLogTimelineService.onCreateSuccess");
    logger.debug(createdItem);

    await this.addToIncidentOrAlertFeed({
      onCallDutyPolicyExecutionLogTimelineId: createdItem.id!,
    });

    return createdItem;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (onUpdate.updateBy.query) {
      const updatedItems: Array<Model> = await this.findBy({
        query: onUpdate.updateBy.query,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

      for (const updatedItem of updatedItems) {
        await this.addToIncidentOrAlertFeed({
          onCallDutyPolicyExecutionLogTimelineId: updatedItem.id as ObjectID,
        });
      }
    }

    return onUpdate;
  }
}
export default new Service();
