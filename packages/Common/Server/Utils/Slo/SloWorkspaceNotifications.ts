import ObjectID from "../../../Types/ObjectID";
import SloErrorBudgetPolicyChange from "../../../Types/ServiceLevelObjective/SloErrorBudgetPolicyChange";
import { MarkdownText } from "../../../Utils/Markdown/FeedMarkdown";
import WorkspaceNotificationRuleService from "../../Services/WorkspaceNotificationRuleService";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * AN SLO'S ERROR BUDGET POLICY, IN SLACK, MICROSOFT TEAMS AND MATTERMOST.
 *
 * When the evaluation worker commits a change of an SLO's error budget
 * policy - the SLO entered a tier, recovered to a less severe one or left
 * every tier, or its deployments were frozen or allowed again - it posts the
 * change to the SLO's feed, then here: to the channels and chats of every
 * Service Level Objective rule of the project that matches the SLO as it is
 * now and what moved (WorkspaceNotificationRuleService,
 * NotificationRuleEventType.ServiceLevelObjective). Nobody is paged, and no
 * channel is opened or joined: an SLO gets no channel of its own.
 *
 * What is posted is the feed item itself, its line and then its details
 * (SloFeedMarkdown, getSloFeedChatMarkdown): the tier left and the tier
 * entered, how the deploy gate moved, the budget left, and the team's
 * agreement for the new tier as the Markdown it was written in. Every name
 * in it is placed as text, so a tier or an SLO named "<!channel>" pings
 * nobody, and the senders cut the message to what each workspace takes
 * (SlackUtil.cutMarkdown, MicrosoftTeamsMessageSize.fitMarkdownText).
 *
 * Called once per committed change, after the evaluation's state write: a
 * write that fails posts nothing, and the next evaluation meets the same
 * change again; an evaluation that holds the tier under the hysteresis
 * changed nothing and posts nothing. A post that fails is logged and goes no
 * further: the evaluation, its feed item and what its tier raises never
 * wait on a workspace's answer to fail with it.
 */
export default class SloWorkspaceNotifications {
  /*
   * Posts one change of the SLO's error budget policy - `changes` says what
   * moved, for the rules' Error Budget Policy Change condition - to every
   * matching rule's channels and chats. Never throws; says whether the
   * workspaces were asked.
   */
  @CaptureSpan()
  public static async postPolicyChange(data: {
    projectId: ObjectID;
    sloId: ObjectID;
    changes: Array<SloErrorBudgetPolicyChange>;
    markdown: MarkdownText;
  }): Promise<boolean> {
    // Nothing moved: nothing to say, and no rule is asked.
    if (data.changes.length === 0) {
      return false;
    }

    try {
      await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
        projectId: data.projectId,
        notificationFor: {
          serviceLevelObjectiveId: data.sloId,
          serviceLevelObjectivePolicyChanges: [...data.changes],
        },
        feedInfoInMarkdown: data.markdown.toString(),
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });

      return true;
    } catch (err) {
      logger.error(
        `SloWorkspaceNotifications: could not post the error budget policy change of SLO ${data.sloId.toString()} to Slack, Microsoft Teams or Mattermost: ${err}`,
        {
          projectId: data.projectId.toString(),
          sloId: data.sloId.toString(),
        } as LogAttributes,
      );

      return false;
    }
  }
}
