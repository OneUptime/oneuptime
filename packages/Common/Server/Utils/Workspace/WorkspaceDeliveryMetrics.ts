import NotificationDeliveryMetrics, {
  NotificationDeliveryChannel,
  NotificationDeliveryOutcome,
  NotificationDeliveryProvider,
  NotificationDestination,
  NotificationDispatch,
  NotificationDispatchStart,
  NotificationProviderConfig,
} from "../Telemetry/NotificationDeliveryMetrics";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import WorkspaceMessagePayload from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

/*
 * SLACK, MICROSOFT TEAMS AND MATTERMOST MESSAGES, AS THE PLATFORM'S DELIVERY
 * METRICS COUNT THEM (issues #6600 and #6645).
 *
 * A workspace is sent three kinds of message, each recorded where its
 * request to the workspace is made - so each is counted once, whoever asked
 * for it - in notification.send.count and .duration, with where it went
 * (notification.destination):
 *
 *  - direct_message: to one person, the notification methods' own - an
 *    on-call page's among them (WorkspaceUserNotificationService).
 *  - channel: a post into each channel - or Microsoft Teams group chat - a
 *    message names, as the project's bot: workspace notification rules, a
 *    rule's test message, live run messages, a reposted live message (each
 *    workspace's sendMessage, through WorkspaceChannelPosts). One post a
 *    channel, however many messages Slack's block limit or Teams' card size
 *    splits it into. A channel that could not be found or read is a
 *    failure; a blocked project's message, not sent, once for each channel
 *    it names (WorkspaceUtil). Editing a message already posted is no post.
 *  - incoming_webhook: a post to an incoming webhook somebody made - a
 *    status page subscriber's Slack or Microsoft Teams webhook (each
 *    workspace's sendMessageToChannelViaIncomingWebhook). A workflow's
 *    "Send Message" step is the workflow's own request, not a notification,
 *    and is not counted.
 *
 * Every one goes through a workspace connection or a webhook a project set
 * up - notification.provider.config "project" - but for the installation's
 * own notices to its operator (OperatorSlackNotice, "global"). Posts are
 * never on-call pages: an on-call page reaches a person in a direct message.
 */

/*
 * A workspace as the delivery metrics name its channel; null for a
 * workspace they do not know, which sends nothing.
 */
export function getDeliveryChannelOfWorkspace(
  workspaceType: WorkspaceType,
): NotificationDeliveryChannel | null {
  switch (workspaceType) {
    case WorkspaceType.Slack:
      return NotificationDeliveryChannel.Slack;
    case WorkspaceType.MicrosoftTeams:
      return NotificationDeliveryChannel.MicrosoftTeams;
    case WorkspaceType.Mattermost:
      return NotificationDeliveryChannel.Mattermost;
    default:
      return null;
  }
}

export function getDeliveryProviderOfWorkspace(
  workspaceType: WorkspaceType,
): NotificationDeliveryProvider {
  switch (workspaceType) {
    case WorkspaceType.Slack:
      return NotificationDeliveryProvider.Slack;
    case WorkspaceType.MicrosoftTeams:
      return NotificationDeliveryProvider.MicrosoftTeams;
    case WorkspaceType.Mattermost:
      return NotificationDeliveryProvider.Mattermost;
    default:
      return NotificationDeliveryProvider.None;
  }
}

// One post into one channel, as its workspace's sendMessage makes it.
export interface WorkspaceChannelPost {
  // The workspace took it.
  succeeded(): void;
  // The workspace refused it, or it could not be made. Nothing, once it succeeded.
  failed(): void;
}

/*
 * The posts of one message into the channels it names: each is recorded
 * once - started as its request is made, ended as it settles - and so is
 * each channel it names that could not be posted in.
 */
export class WorkspaceChannelPosts {
  private readonly start: NotificationDispatchStart | null;
  private readonly destinationCount: number;
  private recordedCount: number = 0;

  public constructor(data: {
    workspaceType: WorkspaceType;
    payload: WorkspaceMessagePayload;
  }) {
    this.start = WorkspaceDeliveryMetrics.getChannelPostStart(
      data.workspaceType,
    );
    this.destinationCount = WorkspaceDeliveryMetrics.countDestinations(
      data.payload,
      data.workspaceType,
    );
  }

  // A post into a channel, its request about to be made.
  public startPost(): WorkspaceChannelPost {
    const dispatch: NotificationDispatch | null = this.start
      ? NotificationDeliveryMetrics.startDispatch(this.start)
      : null;

    if (dispatch) {
      this.recordedCount++;
    }

    return {
      succeeded: (): void => {
        dispatch?.end(NotificationDeliveryOutcome.Success);
      },
      failed: (): void => {
        dispatch?.end(NotificationDeliveryOutcome.Failure);
      },
    };
  }

  /*
   * A channel the message names that it could not be posted in before any
   * request to post: not found - renamed, deleted, private to the bot - or
   * not read.
   */
  public recordChannelNotFound(): void {
    if (!this.start) {
      return;
    }

    this.recordedCount++;
    NotificationDeliveryMetrics.recordFailedBeforeSend(this.start);
  }

  /*
   * The message failed as a whole - its workspace could not be asked where
   * to post it, a Teams message named no team - before every channel it
   * names was tried: each of those not recorded yet is a failure.
   */
  public recordRestAsFailed(): void {
    if (!this.start) {
      return;
    }

    while (this.recordedCount < this.destinationCount) {
      this.recordedCount++;
      NotificationDeliveryMetrics.recordFailedBeforeSend(this.start);
    }
  }
}

export default class WorkspaceDeliveryMetrics {
  // What every post into a channel of this workspace is recorded with.
  public static getChannelPostStart(
    workspaceType: WorkspaceType,
  ): NotificationDispatchStart | null {
    const channel: NotificationDeliveryChannel | null =
      getDeliveryChannelOfWorkspace(workspaceType);

    if (!channel) {
      return null;
    }

    return {
      channel: channel,
      provider: getDeliveryProviderOfWorkspace(workspaceType),
      // Posted as the project's own bot, through its workspace connection.
      providerConfig: NotificationProviderConfig.Project,
      isOnCallPage: false,
      destination: NotificationDestination.Channel,
    };
  }

  /*
   * The channels a message names, as its workspace's sendMessage tries
   * them: each name, each id but those it is not for (exceptChannelIds),
   * and - on Microsoft Teams, the one workspace that posts in chats - each
   * chat.
   */
  public static countDestinations(
    payload: WorkspaceMessagePayload,
    workspaceType: WorkspaceType,
  ): number {
    const exceptChannelIds: Array<string> = payload.exceptChannelIds || [];

    const channelIds: Array<string> = (payload.channelIds || []).filter(
      (channelId: string): boolean => {
        return !exceptChannelIds.includes(channelId);
      },
    );

    const chatIds: Array<string> =
      workspaceType === WorkspaceType.MicrosoftTeams
        ? payload.chatIds || []
        : [];

    return (
      (payload.channelNames || []).length + channelIds.length + chatIds.length
    );
  }

  /*
   * A blocked project's message (BlockedProjectNotifications) is posted in
   * none of the channels it names: each is not sent.
   */
  public static recordChannelPostsNotSent(data: {
    workspaceType: WorkspaceType;
    payload: WorkspaceMessagePayload;
  }): void {
    const start: NotificationDispatchStart | null = this.getChannelPostStart(
      data.workspaceType,
    );

    if (!start) {
      return;
    }

    const count: number = this.countDestinations(
      data.payload,
      data.workspaceType,
    );

    for (let index: number = 0; index < count; index++) {
      NotificationDeliveryMetrics.recordNotSent(start);
    }
  }

  /*
   * One post to an incoming webhook, recorded as it settles: a success when
   * the workspace took it, a failure when it answered with an error, the
   * post threw, or the webhook's address was refused before it. A post that
   * is no notification (`isNotification: false`, a workflow's step) is made
   * without being recorded.
   */
  public static async measureIncomingWebhookPost<T>(
    data: {
      workspaceType: WorkspaceType;
      // Whose webhook it is: a project's, unless said otherwise.
      providerConfig?: NotificationProviderConfig | undefined;
      isNotification?: boolean | undefined;
    },
    post: () => Promise<T>,
  ): Promise<T> {
    const channel: NotificationDeliveryChannel | null =
      getDeliveryChannelOfWorkspace(data.workspaceType);

    if (!channel || data.isNotification === false) {
      return await post();
    }

    return await NotificationDeliveryMetrics.measureDispatch(
      {
        channel: channel,
        provider: getDeliveryProviderOfWorkspace(data.workspaceType),
        providerConfig:
          data.providerConfig || NotificationProviderConfig.Project,
        isOnCallPage: false,
        destination: NotificationDestination.IncomingWebhook,
      },
      async (dispatch: NotificationDispatch): Promise<T> => {
        const response: T = await post();

        if (!response || response instanceof HTTPErrorResponse) {
          dispatch.markFailed();
        }

        return response;
      },
    );
  }
}
