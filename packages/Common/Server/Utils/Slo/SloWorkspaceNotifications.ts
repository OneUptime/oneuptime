import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SloErrorBudgetPolicyChange from "../../../Types/ServiceLevelObjective/SloErrorBudgetPolicyChange";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import { MarkdownText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  SloStatusPost,
  SloStatusPostDecision,
  decideSloStatusPost,
} from "../../../Utils/Slo/SloStatusPosts";
import GlobalCache from "../../Infrastructure/GlobalCache";
import WorkspaceNotificationRuleService from "../../Services/WorkspaceNotificationRuleService";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * AN SLO'S CHANGES, IN SLACK, MICROSOFT TEAMS AND MATTERMOST.
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
 * And the changes of its status (#6596) - it became At Risk, its budget is
 * exhausted, it is healthy again - to the rules that pick them with their
 * SLO Status Change condition (SloRuleChanges): a rule that does not pick
 * them, every rule saved before them among them, posts none. At most once an
 * interval per SLO, and always where the SLO is now (SloStatusPosts): what
 * the channels last heard is remembered here, in the cache, so a flapping
 * SLO cannot flood a channel.
 *
 * What is posted is the feed item itself, its line and then its details
 * (SloFeedMarkdown, getSloFeedChatMarkdown). Every name in it is placed as
 * text, so a tier or an SLO named "<!channel>" pings nobody, and the senders
 * cut the message to what each workspace takes (SlackUtil.cutMarkdown,
 * MicrosoftTeamsMessageSize.fitMarkdownText).
 *
 * Called after the evaluation's state write: a write that fails posts
 * nothing. A post that fails is logged and goes no further: the evaluation,
 * its feed item and what its tier raises never wait on a workspace's answer
 * to fail with it.
 */

// Where what the channels last heard of each SLO's status is kept.
export const SLO_STATUS_POSTS_CACHE_NAMESPACE: string = "slo-status-posts";

/*
 * How long it is kept: long past any interval, so an SLO that sits Paused
 * for weeks still says "Healthy again" when it is measured healthy after
 * the channels last heard "At Risk".
 */
export const SLO_STATUS_POSTS_CACHE_SECONDS: number =
  OneUptimeDate.getSecondsInDays(30);

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

  /*
   * After an evaluation that measured the SLO: posts its status change to
   * the rules that pick status changes, when there is one to say now
   * (decideSloStatusPost) - this evaluation's transition, or one an earlier
   * evaluation held back for the interval - in the words `buildMarkdown`
   * gives for the status it is said against. Never throws; says which
   * change was posted, or null.
   */
  @CaptureSpan()
  public static async postStatusChange(data: {
    projectId: ObjectID;
    sloId: ObjectID;
    // The status before this evaluation, and after it.
    previousStatus: SloStatus | null | undefined;
    newStatus: SloStatus;
    now: Date;
    // The message, said against `from`: the status the channels last heard.
    buildMarkdown: (from: SloStatus | null) => Promise<MarkdownText | null>;
  }): Promise<SloStatusPostDecision | null> {
    try {
      const decision: SloStatusPostDecision | null = decideSloStatusPost({
        lastPost: await this.readLastStatusPost(data),
        previousStatus: data.previousStatus,
        newStatus: data.newStatus,
        now: data.now,
      });

      if (!decision) {
        return null;
      }

      const markdown: MarkdownText | null = await data.buildMarkdown(
        decision.from,
      );

      if (!markdown) {
        return null;
      }

      await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
        projectId: data.projectId,
        notificationFor: {
          serviceLevelObjectiveId: data.sloId,
          serviceLevelObjectiveStatusChange: decision.change,
        },
        feedInfoInMarkdown: markdown.toString(),
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });

      await this.rememberStatusPost({
        projectId: data.projectId,
        sloId: data.sloId,
        post: { status: data.newStatus, postedAt: data.now },
      });

      return decision;
    } catch (err) {
      logger.error(
        `SloWorkspaceNotifications: could not post the status change of SLO ${data.sloId.toString()} to Slack, Microsoft Teams or Mattermost: ${err}`,
        {
          projectId: data.projectId.toString(),
          sloId: data.sloId.toString(),
        } as LogAttributes,
      );

      return null;
    }
  }

  /*
   * What the channels last heard of the SLO's status, or null when nothing
   * is remembered - never posted, or a cache that cannot be read, which
   * then lets the evaluation's own transition stand in for it.
   */
  private static async readLastStatusPost(data: {
    projectId: ObjectID;
    sloId: ObjectID;
  }): Promise<SloStatusPost | null> {
    try {
      const stored: JSONObject | null = await GlobalCache.getJSONObject(
        SLO_STATUS_POSTS_CACHE_NAMESPACE,
        data.sloId.toString(),
      );

      return readSloStatusPost(stored);
    } catch (err) {
      logger.error(
        `SloWorkspaceNotifications: could not read which status of SLO ${data.sloId.toString()} the channels last heard; going by its last evaluation: ${err}`,
        {
          projectId: data.projectId.toString(),
          sloId: data.sloId.toString(),
        } as LogAttributes,
      );

      return null;
    }
  }

  private static async rememberStatusPost(data: {
    projectId: ObjectID;
    sloId: ObjectID;
    post: SloStatusPost;
  }): Promise<void> {
    try {
      await GlobalCache.setJSON(
        SLO_STATUS_POSTS_CACHE_NAMESPACE,
        data.sloId.toString(),
        {
          status: data.post.status,
          postedAt: data.post.postedAt.toISOString(),
        },
        { expiresInSeconds: SLO_STATUS_POSTS_CACHE_SECONDS },
      );
    } catch (err) {
      logger.error(
        `SloWorkspaceNotifications: could not remember the status of SLO ${data.sloId.toString()} the channels were told: ${err}`,
        {
          projectId: data.projectId.toString(),
          sloId: data.sloId.toString(),
        } as LogAttributes,
      );
    }
  }
}

/*
 * A remembered post, read defensively: anything that is not a status and a
 * time reads as nothing remembered.
 */
export function readSloStatusPost(
  stored: JSONObject | null | undefined,
): SloStatusPost | null {
  if (!stored) {
    return null;
  }

  const status: unknown = stored["status"];
  const postedAt: unknown = stored["postedAt"];

  if (
    typeof status !== "string" ||
    !(Object.values(SloStatus) as Array<string>).includes(status) ||
    typeof postedAt !== "string"
  ) {
    return null;
  }

  const date: Date = new Date(postedAt);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  return { status: status as SloStatus, postedAt: date };
}
