import AlertVideoCall from "../../../Models/DatabaseModels/AlertVideoCall";
import IncidentVideoCall from "../../../Models/DatabaseModels/IncidentVideoCall";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import ObjectID from "../../../Types/ObjectID";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import BaseNotificationRule from "../../../Types/Workspace/NotificationRules/BaseNotificationRule";
import VideoCallNotificationRule, {
  getRequestedVideoCallSource,
  isSlackHuddleVideoCallSource,
} from "../../../Types/Workspace/NotificationRules/VideoCallNotificationRule";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import AlertVideoCallService from "../../Services/AlertVideoCallService";
import IncidentVideoCallService from "../../Services/IncidentVideoCallService";
import WorkspaceNotificationLogService from "../../Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService, {
  NotificationFor,
} from "../../Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../Services/WorkspaceProjectAuthTokenService";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { escapeMarkdownValue } from "../../../Utils/Markdown/MarkdownEscape";
import SlackUtil from "../Workspace/Slack/Slack";
import { WorkspaceChannel } from "../Workspace/WorkspaceBase";
import EventVideoCall, {
  VideoCallEvent,
  VideoCallEventType,
} from "./EventVideoCall";
import SlackHuddleLink from "./Providers/SlackHuddleLink";
import { Service as VideoCallConnectionServiceType } from "../../Services/VideoCallConnectionService";

/*
 * Starts the video calls the workspace notification rules ask for when an
 * incident or an alert is created.
 *
 * A rule fires on the same conditions as for the rest of what it does, so a
 * project that wants a bridge only for its worst incidents says so with the
 * rule's conditions (Severity is Sev1). The calls are started after the
 * rules have created the event's channels and posted "Created" in them, so
 * the call's Join button is the next message in the incident channel, and a
 * Slack huddle can be the huddle of that channel.
 *
 * One call per source per event: two rules naming the same Zoom connection
 * get one Zoom meeting, and a rule that runs again finds the call it
 * started. A rule's call that cannot be started is written to the
 * notification log and to the event's feed, and the event's other calls
 * still start: creating the incident never waits on, or fails with, a
 * meeting provider.
 */

export interface VideoCallRequest {
  // SLACK_HUDDLE_VIDEO_CALL_SOURCE, or the id of a VideoCallConnection.
  source: string;
  ruleId: ObjectID;
  ruleName: string;
  workspaceType: WorkspaceType;
  // A Slack huddle's channel, once it is known.
  slackChannel?: WorkspaceChannel | undefined;
  // Why the request cannot be met, when that is known before starting it.
  error?: string | undefined;
}

export interface ExistingVideoCall {
  provider?: VideoCallProvider | undefined;
  joinUrl?: string | undefined;
  videoCallConnectionId?: ObjectID | undefined;
}

export default class VideoCallRuleExecutor {
  @CaptureSpan()
  public static async startCallsForIncident(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
  }): Promise<void> {
    await VideoCallRuleExecutor.startCalls({
      eventType: VideoCallEventType.Incident,
      eventId: data.incidentId,
      projectId: data.projectId,
      notificationRuleEventType: NotificationRuleEventType.Incident,
      notificationFor: { incidentId: data.incidentId },
    });
  }

  @CaptureSpan()
  public static async startCallsForAlert(data: {
    projectId: ObjectID;
    alertId: ObjectID;
  }): Promise<void> {
    await VideoCallRuleExecutor.startCalls({
      eventType: VideoCallEventType.Alert,
      eventId: data.alertId,
      projectId: data.projectId,
      notificationRuleEventType: NotificationRuleEventType.Alert,
      notificationFor: { alertId: data.alertId },
    });
  }

  // Never throws: a call is never a reason for the event's creation to fail.
  private static async startCalls(data: {
    eventType: VideoCallEventType;
    eventId: ObjectID;
    projectId: ObjectID;
    notificationRuleEventType: NotificationRuleEventType;
    notificationFor: NotificationFor;
  }): Promise<void> {
    try {
      const event: VideoCallEvent = await EventVideoCall.getEvent({
        type: data.eventType,
        id: data.eventId,
      });

      const requests: Array<VideoCallRequest> =
        await VideoCallRuleExecutor.getCallRequests({
          projectId: data.projectId,
          notificationRuleEventType: data.notificationRuleEventType,
          notificationFor: data.notificationFor,
          event: event,
        });

      if (requests.length === 0) {
        return;
      }

      const existingCalls: Array<ExistingVideoCall> =
        data.eventType === VideoCallEventType.Incident
          ? await IncidentVideoCallService.getCallsForIncident(data.eventId)
          : await AlertVideoCallService.getCallsForAlert(data.eventId);

      for (const request of VideoCallRuleExecutor.dedupe(requests)) {
        await VideoCallRuleExecutor.startCall({
          event,
          request,
          existingCalls,
        });
      }
    } catch (error) {
      logger.error(
        `Starting video calls for workspace rules failed: ${error}`,
        {
          projectId: data.projectId.toString(),
          [data.eventType === VideoCallEventType.Incident
            ? "incidentId"
            : "alertId"]: data.eventId.toString(),
        } as LogAttributes,
      );
    }
  }

  /*
   * What the matching rules ask for, in rule order, Slack's rules first.
   * A Slack huddle is held in the channel the rule created for the event,
   * or else in the first existing channel the rule posts to.
   */
  @CaptureSpan()
  public static async getCallRequests(data: {
    projectId: ObjectID;
    notificationRuleEventType: NotificationRuleEventType;
    notificationFor: NotificationFor;
    event: VideoCallEvent;
  }): Promise<Array<VideoCallRequest>> {
    const requests: Array<VideoCallRequest> = [];

    for (const workspaceType of [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
    ]) {
      const rules: Array<WorkspaceNotificationRule> =
        await WorkspaceNotificationRuleService.getMatchingNotificationRules({
          projectId: data.projectId,
          workspaceType: workspaceType,
          notificationRuleEventType: data.notificationRuleEventType,
          notificationFor: data.notificationFor,
        });

      for (const rule of rules) {
        const source: string | null = getRequestedVideoCallSource(
          rule.notificationRule as VideoCallNotificationRule | undefined,
        );

        if (!source || !rule.id) {
          continue;
        }

        const request: VideoCallRequest = {
          source: source,
          ruleId: rule.id,
          ruleName: rule.name || "",
          workspaceType: workspaceType,
        };

        if (isSlackHuddleVideoCallSource(source)) {
          if (workspaceType !== WorkspaceType.Slack) {
            request.error =
              "A Slack huddle can only be started by a Slack notification rule.";
          } else {
            request.slackChannel =
              await VideoCallRuleExecutor.getSlackChannelForHuddle({
                projectId: data.projectId,
                rule: rule,
                event: data.event,
              });

            if (!request.slackChannel) {
              request.error =
                "The rule neither created a Slack channel for this event nor posts to an existing Slack channel OneUptime can find, so there is no channel to hold the huddle in.";
            }
          }
        }

        requests.push(request);
      }
    }

    return requests;
  }

  /*
   * The channel a rule's huddle is held in: the one it created for the
   * event, so the call sits with the responders the rule invited; failing
   * that, the first existing channel it posts to.
   */
  public static async getSlackChannelForHuddle(data: {
    projectId: ObjectID;
    rule: WorkspaceNotificationRule;
    event: VideoCallEvent;
  }): Promise<WorkspaceChannel | undefined> {
    const ruleId: string = data.rule.id?.toString() || "";

    const createdChannel: WorkspaceChannel | undefined =
      data.event.workspaceChannels.find(
        (channel: WorkspaceChannel & { notificationRuleId?: string }) => {
          return (
            channel.workspaceType === WorkspaceType.Slack &&
            channel.notificationRuleId === ruleId &&
            Boolean(channel.id)
          );
        },
      );

    if (createdChannel) {
      return createdChannel;
    }

    const existingChannels: Array<WorkspaceChannel> =
      WorkspaceNotificationRuleService.getExistingChannelNamesFromNotificationRules(
        {
          notificationRules: [
            data.rule.notificationRule as BaseNotificationRule,
          ],
          workspaceType: WorkspaceType.Slack,
        },
      );

    if (existingChannels.length === 0) {
      return undefined;
    }

    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.Slack,
      });

    if (!projectAuth?.authToken) {
      return undefined;
    }

    for (const existingChannel of existingChannels) {
      const channelName: string = existingChannel.name.trim();

      if (!channelName) {
        continue;
      }

      try {
        const channel: WorkspaceChannel | null =
          await SlackUtil.getWorkspaceChannelByName({
            authToken: projectAuth.authToken,
            channelName: channelName,
            projectId: data.projectId,
          });

        if (channel?.id && SlackHuddleLink.isSlackId(channel.id)) {
          return channel;
        }
      } catch (error) {
        logger.debug(
          `Could not find Slack channel ${channelName} for a huddle: ${error}`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
      }
    }

    return undefined;
  }

  /*
   * One call per source: the first rule to ask for a connection's call, or
   * for a channel's huddle, starts it. A request that already failed is
   * kept, so its failure is reported.
   */
  public static dedupe(
    requests: Array<VideoCallRequest>,
  ): Array<VideoCallRequest> {
    const seen: Set<string> = new Set<string>();
    const result: Array<VideoCallRequest> = [];

    for (const request of requests) {
      const key: string | null = request.error
        ? null
        : isSlackHuddleVideoCallSource(request.source)
          ? `huddle:${request.slackChannel?.id || ""}`
          : `connection:${request.source}`;

      if (key !== null) {
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
      }

      result.push(request);
    }

    return result;
  }

  // Whether the event already has the call a request asks for.
  public static hasCallFor(data: {
    request: VideoCallRequest;
    existingCalls: Array<ExistingVideoCall>;
    huddleJoinUrl?: string | undefined;
  }): boolean {
    return data.existingCalls.some((call: ExistingVideoCall): boolean => {
      if (isSlackHuddleVideoCallSource(data.request.source)) {
        return (
          call.provider === VideoCallProvider.SlackHuddle &&
          Boolean(data.huddleJoinUrl) &&
          call.joinUrl === data.huddleJoinUrl
        );
      }

      return (
        Boolean(call.videoCallConnectionId) &&
        call.videoCallConnectionId?.toString() === data.request.source
      );
    });
  }

  private static async startCall(data: {
    event: VideoCallEvent;
    request: VideoCallRequest;
    existingCalls: Array<ExistingVideoCall>;
  }): Promise<void> {
    const { event, request } = data;

    try {
      if (request.error) {
        throw new Error(request.error);
      }

      let huddleJoinUrl: string | undefined = undefined;

      if (isSlackHuddleVideoCallSource(request.source)) {
        const teamId: string | null = await EventVideoCall.getSlackTeamId(
          event.projectId,
        );

        if (!teamId) {
          throw new Error("Slack is not connected to this project.");
        }

        huddleJoinUrl = SlackHuddleLink.getHuddleUrl({
          teamId: teamId,
          channelId: request.slackChannel?.id || "",
        });
      } else if (!VideoCallRuleExecutor.isConnectionId(request.source)) {
        throw new Error(
          "The rule names a video call connection that does not exist. Edit the rule and pick another one.",
        );
      }

      if (
        VideoCallRuleExecutor.hasCallFor({
          request,
          existingCalls: data.existingCalls,
          huddleJoinUrl,
        })
      ) {
        return;
      }

      const created: IncidentVideoCall | AlertVideoCall =
        await VideoCallRuleExecutor.createCall({
          event,
          request,
          huddleJoinUrl,
        });

      data.existingCalls.push({
        provider: created.provider,
        joinUrl: created.joinUrl,
        videoCallConnectionId: created.videoCallConnectionId,
      });

      await VideoCallRuleExecutor.log({
        event,
        request,
        status: WorkspaceNotificationStatus.Success,
        statusMessage: `Video call started: ${created.joinUrl || ""}`,
      });
    } catch (error) {
      const message: string =
        VideoCallConnectionServiceType.getErrorMessage(error);

      logger.error(
        `Could not start the video call of workspace rule ${request.ruleId.toString()}: ${message}`,
        { projectId: event.projectId.toString() } as LogAttributes,
      );

      await VideoCallRuleExecutor.log({
        event,
        request,
        status: WorkspaceNotificationStatus.Error,
        statusMessage: message,
      });

      await EventVideoCall.announceFailure({
        eventType: event.type,
        eventId: event.id,
        projectId: event.projectId,
        ruleName: request.ruleName,
        error: message,
      });
    }
  }

  private static isConnectionId(source: string): boolean {
    return ObjectID.isValidUUID(source);
  }

  /*
   * Where the call comes from: the channel's huddle, whose link was built
   * from the channel the rule posted to, or the connection the rule names.
   */
  private static fillSource(
    call: IncidentVideoCall | AlertVideoCall,
    data: {
      request: VideoCallRequest;
      huddleJoinUrl?: string | undefined;
    },
  ): void {
    if (isSlackHuddleVideoCallSource(data.request.source)) {
      call.provider = VideoCallProvider.SlackHuddle;

      if (data.huddleJoinUrl) {
        call.joinUrl = data.huddleJoinUrl;
      }

      if (data.request.slackChannel?.id) {
        call.externalMeetingId = data.request.slackChannel.id;
      }

      return;
    }

    call.videoCallConnectionId = new ObjectID(data.request.source);
  }

  private static async createCall(data: {
    event: VideoCallEvent;
    request: VideoCallRequest;
    huddleJoinUrl?: string | undefined;
  }): Promise<IncidentVideoCall | AlertVideoCall> {
    if (data.event.type === VideoCallEventType.Incident) {
      const call: IncidentVideoCall = new IncidentVideoCall();
      call.projectId = data.event.projectId;
      call.incidentId = data.event.id;
      call.workspaceNotificationRuleId = data.request.ruleId;

      VideoCallRuleExecutor.fillSource(call, data);

      return await IncidentVideoCallService.create({
        data: call,
        props: { isRoot: true },
      });
    }

    const call: AlertVideoCall = new AlertVideoCall();
    call.projectId = data.event.projectId;
    call.alertId = data.event.id;
    call.workspaceNotificationRuleId = data.request.ruleId;

    VideoCallRuleExecutor.fillSource(call, data);

    return await AlertVideoCallService.create({
      data: call,
      props: { isRoot: true },
    });
  }

  // Never throws: the log is a record of what happened, not part of it.
  private static async log(data: {
    event: VideoCallEvent;
    request: VideoCallRequest;
    status: WorkspaceNotificationStatus;
    statusMessage: string;
  }): Promise<void> {
    try {
      await WorkspaceNotificationLogService.createWorkspaceLog(
        {
          projectId: data.event.projectId,
          workspaceType: data.request.workspaceType,
          channelId: data.request.slackChannel?.id,
          channelName: data.request.slackChannel?.name,
          actionType: WorkspaceNotificationActionType.StartVideoCall,
          status: data.status,
          statusMessage: data.statusMessage.substring(0, 500),
          message: `Video call for the **${escapeMarkdownValue(data.request.ruleName)}** workspace notification rule`,
          ...(data.event.type === VideoCallEventType.Incident
            ? { incidentId: data.event.id }
            : { alertId: data.event.id }),
        },
        { isRoot: true },
      );
    } catch (error) {
      logger.error(`Could not log a video call: ${error}`, {
        projectId: data.event.projectId.toString(),
      } as LogAttributes);
    }
  }
}
