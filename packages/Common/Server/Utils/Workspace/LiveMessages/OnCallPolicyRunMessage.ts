import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import UserOnCallLogTimeline from "../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import WorkspaceLiveMessage from "../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import URL from "../../../../Types/API/URL";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE } from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import { getOnCallPolicyRepeatsAllowed } from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRepeat";
import {
  ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
  isOnCallPolicyRunEverybodyPassedOnMessage,
} from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import { isOnCallPagePassedOnSkipTimelineMessage } from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  isOnCallPolicyRunEndedWhileWaiting,
  isOnCallPolicyRunWaitingForWorkingHours,
} from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import UserNotificationStatus from "../../../../Types/UserNotification/UserNotificationStatus";
import WorkspaceLiveMessageKey, {
  WorkspaceLiveMessageData,
  WorkspaceLiveMessageDestinationType,
  WorkspaceLiveMessagePageRecordType,
  WorkspaceLiveMessageRunEnding,
} from "../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import DatabaseConfig from "../../../DatabaseConfig";
import AlertEpisodeService from "../../../Services/AlertEpisodeService";
import AlertService from "../../../Services/AlertService";
import IncidentEpisodeService from "../../../Services/IncidentEpisodeService";
import IncidentService from "../../../Services/IncidentService";
import OnCallDutyPolicyEscalationRuleService, {
  NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
} from "../../../Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyService from "../../../Services/OnCallDutyPolicyService";
import { NOT_A_PROJECT_MEMBER_STATUS_MESSAGE } from "../../../Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Services/UserOnCallLogTimelineService";
import WorkspaceLiveMessageService from "../../../Services/WorkspaceLiveMessageService";
import WorkspaceNotificationRuleService, {
  NotificationFor,
} from "../../../Services/WorkspaceNotificationRuleService";
import logger, { LogAttributes } from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceUtil from "../Workspace";
import { WorkspaceSendMessageResponse } from "../WorkspaceBase";
import WorkspaceMessageTime from "../WorkspaceMessageTime";
import { readAwayUntil } from "../../../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import { ALREADY_PAGED_TIMELINE_MESSAGE } from "../../../../Types/OnCallDutyPolicy/AlreadyPagedTimelineMessage";
import { isOnCallDirectPage } from "../../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import { isOnCallPersonPage } from "../../../../Types/OnCallDutyPolicy/OnCallPersonPage";
import { isOnCallPageAgainRun } from "../../../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import { isOnCallEmptyLevelMovedOnAtOnce } from "../../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
import { MarkdownText } from "../../../../Utils/Markdown/FeedMarkdown";
import OnCallPolicyRunMessageView, {
  ON_CALL_RUN_NOT_PAGED,
  OnCallDirectPageRun,
  OnCallPolicyRun,
  OnCallPolicyRunAlarm,
  OnCallPolicyRunNotPaged,
  OnCallPolicyRunOutcome,
  OnCallPolicyRunPagedPerson,
  OnCallPolicyRunRule,
} from "./OnCallPolicyRunMessageView";
import WorkspaceLiveMessages from "./WorkspaceLiveMessages";

// "Skipped because ..." at the start of a timeline message, and its full stop.
const SKIPPED_BECAUSE_PREFIX: RegExp = /^skipped because\s+/i;
const TRAILING_FULL_STOP: RegExp = /\.\s*$/;

/*
 * A responder's own opt-out reads "You have opted out of ..." in their log;
 * in a channel it is about them: "has opted out of ...".
 */
const YOU_HAVE_PREFIX: RegExp = /^you have\s+/i;

// How each notification method reads in a list, in the order it is listed.
const METHOD_LABELS: Array<{
  field: keyof UserOnCallLogTimeline;
  label: string;
}> = [
  { field: "userCallId", label: "call" },
  { field: "userSmsId", label: "SMS" },
  { field: "userWhatsAppId", label: "WhatsApp" },
  { field: "userTelegramId", label: "Telegram" },
  { field: "userPushId", label: "push" },
  { field: "userEmailId", label: "email" },
  { field: "userSlackId", label: "Slack" },
  { field: "userMicrosoftTeamsId", label: "Microsoft Teams" },
  { field: "userWebhookId", label: "webhook" },
  { field: "customNotificationChannelId", label: "custom channel" },
];

/*
 * What one escalation rule's steps came to (buildRun). "nobody next" is a
 * schedule whose next person in the rotation the rule pages, with nobody
 * next; "empty team" a team of it with no members. "moved on at once" is
 * the level's own line saying it paged nobody and the run moved on from it
 * at once (OnCallEmptyLevel); "nobody in it" the line runs wrote before
 * that, when such a level was waited out.
 */
type RuleStepKind =
  | "reached"
  | "not reached"
  | "nobody in it"
  | "moved on at once"
  | "schedule gap"
  | "nobody next"
  | "empty team";

interface RuleSteps {
  firstStep: number;
  pages: number;
  reached: number;
  nobodyInIt: boolean;
  movedOnAtOnce: boolean;
  scheduleGap: boolean;
}

// A run, read for its message.
export interface OnCallPolicyRunReading {
  projectId: ObjectID;
  notificationFor: NotificationFor;
  run: OnCallPolicyRun;
  /*
   * Whether the run has anything to show yet: an escalation rule has started,
   * or the run is over. A run that is only being set up is not posted, so a
   * run that fails in its first step (no escalation rules, an archived
   * policy) says so in ONE new message.
   */
  hasStarted: boolean;
  // The record's title: what a page from a chat is about.
  recordTitle?: string | undefined;
  /*
   * The key of the places somebody paged about the record from a chat
   * (WorkspaceLiveMessageKey.forOnCallPageRequest): an incident's or an
   * alert's. None for an episode, which nobody pages about from a chat.
   */
  pageRequestKey?: string | undefined;
}

interface RunRecord {
  notificationFor: NotificationFor;
  label: string;
  url: URL;
  title: string;
  stateName?: string | undefined;
  pageRequestKey?: string | undefined;
  isAcknowledged: () => Promise<boolean>;
}

interface RefreshInFlight {
  running: Promise<void>;
  runAgain: boolean;
}

/*
 * ONE MESSAGE PER ON-CALL POLICY RUN, IN EVERY CHANNEL A RECORD'S MESSAGES GO.
 *
 * Every change to a run - it starts, an escalation rule pages somebody or
 * nobody, a page reaches somebody by SMS, somebody acknowledges, the run
 * ends - calls refresh(). That reads the run as it stands and brings its
 * message up to date wherever the record's messages go (the channels
 * OneUptime created for the incident, alert or episode, and the channels and
 * chats its workspace rules name): posted once, edited after that
 * (WorkspaceLiveMessages), and a new message only when somebody has to act
 * (OnCallPolicyRunMessageView.getAlarms). The run's steps stay in the record's
 * feed in OneUptime, where they always were.
 *
 * refresh() never waits and never throws: paging somebody must not wait on
 * Slack or Microsoft Teams. Refreshes of one run in this process are folded
 * together - while one runs, any number of new ones become one more run
 * after it - and the work on the run's message is serialised across
 * processes (WorkspaceLiveMessages.withLock).
 *
 * A direct page - people, a team or a schedule paged with no policy behind
 * the page (Types/OnCallDutyPolicy/OnCallDirectPage) - is a run like any
 * other here: one message, edited as its pages go out and are answered,
 * naming who started the page where a policy's run names the policy.
 *
 * A PAGE FROM A CHAT (`/oneuptime page`) is shown where it was asked for
 * too. The channel or chat the command was run in is kept as a place of the
 * record it paged about (WorkspaceLiveMessageKind.OnCallPageRequest), and
 * every run of that record keeps its message there as well: the same
 * message, with what the page is about under its first line, edited as the
 * run goes, and its own alarms. Where the record's own messages go there
 * already, the run is not posted a second time.
 */
export default class OnCallPolicyRunMessage {
  private static inFlight: Map<string, RefreshInFlight> = new Map<
    string,
    RefreshInFlight
  >();

  // Brings the run's message up to date soon. Never throws, never waits.
  public static refresh(
    executionLogId: ObjectID | string | null | undefined,
  ): void {
    if (!executionLogId) {
      return;
    }

    const id: string = executionLogId.toString();
    const current: RefreshInFlight | undefined = this.inFlight.get(id);

    if (current) {
      current.runAgain = true;
      return;
    }

    const refreshInFlight: RefreshInFlight = {
      running: Promise.resolve(),
      runAgain: false,
    };

    this.inFlight.set(id, refreshInFlight);

    refreshInFlight.running = (async (): Promise<void> => {
      try {
        do {
          refreshInFlight.runAgain = false;

          try {
            await this.syncRun(new ObjectID(id));
          } catch (err) {
            logger.error(
              "Could not bring the on-call policy run's Slack / Microsoft Teams message up to date.",
              { onCallDutyPolicyExecutionLogId: id } as LogAttributes,
            );
            logger.error(err, {
              onCallDutyPolicyExecutionLogId: id,
            } as LogAttributes);
          }
        } while (refreshInFlight.runAgain);
      } finally {
        this.inFlight.delete(id);
      }
    })();
  }

  // Resolves once no refresh is running or waiting in this process.
  public static async whenIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all(
        Array.from(this.inFlight.values()).map(
          (refreshInFlight: RefreshInFlight): Promise<void> => {
            return refreshInFlight.running;
          },
        ),
      );
    }
  }

  /*
   * Reads the run and brings its message up to date in every place: posts it
   * where it has never been posted, edits it where it says something else
   * now, and posts each alarm the run calls for that no message of the run
   * has raised yet.
   */
  @CaptureSpan()
  public static async syncRun(executionLogId: ObjectID): Promise<void> {
    const messageKey: string =
      WorkspaceLiveMessageKey.forOnCallPolicyRun(executionLogId);

    /*
     * The run is read under the same hold as its message is written: two
     * workers handling two steps of one run would otherwise each read the
     * run, and the one that read it first could write that older state over
     * the newer edit - for good, if no later change came to correct it.
     */
    await WorkspaceLiveMessages.withLock(messageKey, async () => {
      const reading: OnCallPolicyRunReading | null =
        await this.readRun(executionLogId);

      if (!reading || !reading.hasStarted) {
        return;
      }

      const kept: Array<WorkspaceLiveMessage> =
        await WorkspaceLiveMessageService.findByMessageKey({
          projectId: reading.projectId,
          messageKey: messageKey,
        });

      // Where somebody paged about the record from a chat, if anywhere.
      const pageRequestPlaces: Array<WorkspaceLiveMessage> =
        reading.pageRequestKey
          ? await WorkspaceLiveMessageService.findByMessageKey({
              projectId: reading.projectId,
              messageKey: reading.pageRequestKey,
            })
          : [];

      /*
       * A run that has ended is told as its message first told it. The
       * message is brought up to date after the run ends too - a page's
       * delivery finishing late - and the record may have moved on by
       * then: "moved to Acknowledged, so the policy stopped paging" is not
       * to become "moved to Resolved" because somebody resolved it later.
       */
      const endedAs: WorkspaceLiveMessageRunEnding | undefined =
        this.keepEnding(reading.run, kept);

      const markdownBlock: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: OnCallPolicyRunMessageView.getMarkdown(reading.run),
      };

      const alarms: Array<OnCallPolicyRunAlarm> =
        OnCallPolicyRunMessageView.getAlarms(reading.run);

      /*
       * The messages where the record's messages go, and those where
       * somebody paged from a chat: each kind is posted, edited and alarmed
       * on its own.
       */
      const keptEverywhere: Array<WorkspaceLiveMessage> = kept.filter(
        (keptMessage: WorkspaceLiveMessage): boolean => {
          return !this.isAtPageRequestPlace(keptMessage);
        },
      );
      const keptAtPageRequestPlaces: Array<WorkspaceLiveMessage> = kept.filter(
        (keptMessage: WorkspaceLiveMessage): boolean => {
          return this.isAtPageRequestPlace(keptMessage);
        },
      );

      if (keptEverywhere.length === 0) {
        /*
         * The first post is a new message itself: whatever alarm the run
         * calls for now, it says already, so none is raised on top of it.
         */
        keptEverywhere.push(
          ...(await WorkspaceLiveMessages.postEverywhere({
            projectId: reading.projectId,
            messageKey: messageKey,
            notificationFor: reading.notificationFor,
            messageBlocks: [markdownBlock],
            text: OnCallPolicyRunMessageView.getPlainText(reading.run),
            messageData: {
              alarms: alarms.map((alarm: OnCallPolicyRunAlarm): string => {
                return alarm.key;
              }),
              ...(endedAs ? { endedAs: endedAs } : {}),
            },
          })),
        );
      } else {
        await this.updateEverywhere({
          reading: reading,
          keptEverywhere: keptEverywhere,
          markdownBlock: markdownBlock,
          alarms: alarms,
          endedAs: endedAs,
        });
      }

      if (pageRequestPlaces.length > 0 || keptAtPageRequestPlaces.length > 0) {
        await this.syncPageRequestPlaces({
          reading: reading,
          messageKey: messageKey,
          places: pageRequestPlaces,
          keptEverywhere: keptEverywhere,
          keptAtPlaces: keptAtPageRequestPlaces,
          alarms: alarms,
          endedAs: endedAs,
        });
      }
    });
  }

  /*
   * Brings the run's messages where the record's messages go up to date:
   * posts each alarm the run calls for that none of them has raised yet,
   * where the record's messages go, then edits each message.
   */
  private static async updateEverywhere(data: {
    reading: OnCallPolicyRunReading;
    keptEverywhere: Array<WorkspaceLiveMessage>;
    markdownBlock: WorkspacePayloadMarkdown;
    alarms: Array<OnCallPolicyRunAlarm>;
    endedAs: WorkspaceLiveMessageRunEnding | undefined;
  }): Promise<void> {
    const { reading, markdownBlock, alarms, endedAs } = data;
    const kept: Array<WorkspaceLiveMessage> = data.keptEverywhere;

    const raised: Array<string> = this.getRaisedAlarms(kept);

    const newAlarms: Array<OnCallPolicyRunAlarm> = alarms.filter(
      (alarm: OnCallPolicyRunAlarm): boolean => {
        return !raised.includes(alarm.key);
      },
    );

    for (const alarm of newAlarms) {
      try {
        await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
          {
            projectId: reading.projectId,
            notificationFor: reading.notificationFor,
            feedInfoInMarkdown: alarm.markdown,
            // An alarm is posted to be seen: its notification says what is wrong.
            notificationText: alarm.text,
            workspaceNotification: {
              sendWorkspaceNotification: true,
            },
          },
        );
      } catch (err) {
        logger.error("Could not post an on-call alarm to Slack / Teams.", {
          projectId: reading.projectId.toString(),
        } as LogAttributes);
        logger.error(err, {
          projectId: reading.projectId.toString(),
        } as LogAttributes);
      }

      raised.push(alarm.key);
    }

    for (const keptMessage of kept) {
      await WorkspaceLiveMessages.updateKept({
        keptMessage: keptMessage,
        messageBlocks: [markdownBlock],
        text: OnCallPolicyRunMessageView.getPlainText(reading.run),
        messageData: {
          ...(keptMessage.messageData || {}),
          alarms: [...raised],
          ...(endedAs ? { endedAs: endedAs } : {}),
        },
        // The alarms were posted, edit or no edit: never post them again.
        rememberIfNotEdited: true,
      });
    }
  }

  /*
   * THE RUN WHERE SOMEBODY PAGED FROM A CHAT.
   *
   * Each place somebody ran `/oneuptime page` about the run's record gets
   * the run's message too, with what the page is about under its first
   * line - unless a message of the run is in that channel already, as one
   * of the record's own places. Each message there is edited as the run
   * goes, and raises the run's alarms there once, on its own: the person
   * who paged reads "nobody has acknowledged" where they paged.
   */
  private static async syncPageRequestPlaces(data: {
    reading: OnCallPolicyRunReading;
    messageKey: string;
    places: Array<WorkspaceLiveMessage>;
    keptEverywhere: Array<WorkspaceLiveMessage>;
    keptAtPlaces: Array<WorkspaceLiveMessage>;
    alarms: Array<OnCallPolicyRunAlarm>;
    endedAs: WorkspaceLiveMessageRunEnding | undefined;
  }): Promise<void> {
    const { reading, alarms, endedAs } = data;

    const placeBlock: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: OnCallPolicyRunMessageView.getMarkdown(reading.run, {
        recordTitle: reading.recordTitle,
      }),
    };
    const placeText: string = OnCallPolicyRunMessageView.getPlainText(
      reading.run,
      { recordTitle: reading.recordTitle },
    );

    for (const keptMessage of data.keptAtPlaces) {
      const raised: Array<string> = this.getRaisedAlarms([keptMessage]);

      for (const alarm of alarms) {
        if (raised.includes(alarm.key)) {
          continue;
        }

        await this.postAlarmAtPlace({
          reading: reading,
          place: keptMessage,
          alarm: alarm,
        });

        raised.push(alarm.key);
      }

      await WorkspaceLiveMessages.updateKept({
        keptMessage: keptMessage,
        messageBlocks: [placeBlock],
        text: placeText,
        messageData: {
          ...(keptMessage.messageData || {}),
          alarms: raised,
          ...(endedAs ? { endedAs: endedAs } : {}),
        },
        // The alarms were posted, edit or no edit: never post them again.
        rememberIfNotEdited: true,
      });
    }

    const kept: Array<WorkspaceLiveMessage> = [
      ...data.keptEverywhere,
      ...data.keptAtPlaces,
    ];

    for (const place of data.places) {
      const isThere: boolean = kept.some(
        (keptMessage: WorkspaceLiveMessage): boolean => {
          return this.isSameChannel(keptMessage, place);
        },
      );

      if (isThere || !place.channelId || !place.workspaceType) {
        continue;
      }

      /*
       * Its first post is a new message itself: whatever alarm the run
       * calls for now, it says already.
       */
      const posted: WorkspaceLiveMessage | null =
        await WorkspaceLiveMessages.postAndKeep({
          projectId: reading.projectId,
          messageKey: data.messageKey,
          destination: this.getPlaceDestination(place, placeBlock, placeText),
          messageData: {
            alarms: alarms.map((alarm: OnCallPolicyRunAlarm): string => {
              return alarm.key;
            }),
            ...(endedAs ? { endedAs: endedAs } : {}),
            isPageRequestPlace: true,
          },
          notificationFor: reading.notificationFor,
        });

      if (posted) {
        kept.push(posted);
      }
    }
  }

  // Whether a kept message of a run is where somebody paged from a chat.
  public static isAtPageRequestPlace(
    keptMessage: WorkspaceLiveMessage,
  ): boolean {
    return (
      (keptMessage.messageData as WorkspaceLiveMessageData | undefined)
        ?.isPageRequestPlace === true
    );
  }

  // Whether two kept rows are in one channel or chat.
  private static isSameChannel(
    a: WorkspaceLiveMessage,
    b: WorkspaceLiveMessage,
  ): boolean {
    return (
      Boolean(a.channelId) &&
      a.workspaceType === b.workspaceType &&
      a.channelId === b.channelId
    );
  }

  // A page request place, as a destination of one message.
  private static getPlaceDestination(
    place: WorkspaceLiveMessage,
    block: WorkspacePayloadMarkdown,
    text: string,
  ): WorkspaceMessagePayload {
    const isChat: boolean =
      place.destinationType === WorkspaceLiveMessageDestinationType.Chat;

    return {
      _type: "WorkspaceMessagePayload",
      workspaceType: place.workspaceType as WorkspaceType,
      messageBlocks: [block],
      channelNames: [],
      channelIds: isChat ? [] : [place.channelId!],
      ...(isChat ? { chatIds: [place.channelId!] } : {}),
      ...(place.teamId ? { teamId: place.teamId } : {}),
      ...(text ? { text: text } : {}),
    };
  }

  /*
   * An alarm of the run, where somebody paged from a chat: a new message
   * there, logged in Notification Logs as the run's other posts are.
   * Never throws.
   */
  private static async postAlarmAtPlace(data: {
    reading: OnCallPolicyRunReading;
    place: WorkspaceLiveMessage;
    alarm: OnCallPolicyRunAlarm;
  }): Promise<void> {
    const { reading, place, alarm } = data;
    const block: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: alarm.markdown,
    };

    try {
      const responses: Array<WorkspaceSendMessageResponse> =
        await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
          projectId: reading.projectId,
          messagePayloadsByWorkspace: [
            this.getPlaceDestination(place, block, alarm.text),
          ],
        });

      await WorkspaceNotificationRuleService.logSendResponses({
        projectId: reading.projectId,
        notificationFor: reading.notificationFor,
        responses: responses,
        messageBlocksByWorkspaceTypes: [
          {
            workspaceType: place.workspaceType as WorkspaceType,
            messageBlocks: [block],
          },
        ],
      });
    } catch (err) {
      logger.error(
        "Could not post an on-call alarm where somebody paged from a chat.",
        { projectId: reading.projectId.toString() } as LogAttributes,
      );
      logger.error(err, {
        projectId: reading.projectId.toString(),
      } as LogAttributes);
    }
  }

  /*
   * The run's ending as its messages first told it, applied to `run`; or,
   * for a run that has just ended, its ending now, to be kept. Undefined
   * while the run is still paging.
   */
  private static keepEnding(
    run: OnCallPolicyRun,
    kept: Array<WorkspaceLiveMessage>,
  ): WorkspaceLiveMessageRunEnding | undefined {
    // A run that waits to page has not ended: it pages later.
    if (
      run.outcome === OnCallPolicyRunOutcome.Paging ||
      run.outcome === OnCallPolicyRunOutcome.Waiting
    ) {
      return undefined;
    }

    for (const keptMessage of kept) {
      const endedAs: unknown = keptMessage.messageData?.endedAs;

      if (
        endedAs &&
        typeof endedAs === "object" &&
        Object.values(OnCallPolicyRunOutcome).includes(
          (endedAs as WorkspaceLiveMessageRunEnding)
            .outcome as OnCallPolicyRunOutcome,
        ) &&
        (endedAs as WorkspaceLiveMessageRunEnding).outcome !==
          OnCallPolicyRunOutcome.Paging &&
        (endedAs as WorkspaceLiveMessageRunEnding).outcome !==
          OnCallPolicyRunOutcome.Waiting
      ) {
        const told: WorkspaceLiveMessageRunEnding =
          endedAs as WorkspaceLiveMessageRunEnding;

        run.outcome = told.outcome as OnCallPolicyRunOutcome;
        run.outcomeDetail =
          typeof told.detail === "string" ? told.detail : undefined;

        return told;
      }
    }

    return {
      outcome: run.outcome,
      ...(run.outcomeDetail ? { detail: run.outcomeDetail } : {}),
    };
  }

  // The alarm keys any message of the run already raised.
  private static getRaisedAlarms(
    kept: Array<WorkspaceLiveMessage>,
  ): Array<string> {
    const raised: Array<string> = [];

    for (const keptMessage of kept) {
      const alarms: unknown = keptMessage.messageData?.alarms;

      if (!Array.isArray(alarms)) {
        continue;
      }

      for (const alarm of alarms) {
        if (typeof alarm === "string" && !raised.includes(alarm)) {
          raised.push(alarm);
        }
      }
    }

    return raised;
  }

  /*
   * The run as its message tells it, or null when there is nothing to tell:
   * the run is gone, it pages for no incident, alert or episode, or the
   * project is connected to neither Slack nor Microsoft Teams.
   */
  @CaptureSpan()
  public static async readRun(
    executionLogId: ObjectID,
  ): Promise<OnCallPolicyRunReading | null> {
    const executionLog: OnCallDutyPolicyExecutionLog | null =
      await OnCallDutyPolicyExecutionLogService.findOneById({
        id: executionLogId,
        select: {
          _id: true,
          projectId: true,
          onCallDutyPolicyId: true,
          status: true,
          statusMessage: true,
          triggeredByIncidentId: true,
          triggeredByAlertId: true,
          triggeredByAlertEpisodeId: true,
          triggeredByIncidentEpisodeId: true,
          lastExecutedEscalationRuleId: true,
          lastExecutedEscalationRuleOrder: true,
          lastEscalationRuleExecutedAt: true,
          executeNextEscalationRuleInMinutes: true,
          onCallPolicyExecutionRepeatCount: true,
          // A run that waits to page: when it starts, and why it started early.
          pagingStartsAt: true,
          pagingStartedEarlyReason: true,
          // A page again: which time (OnCallAcknowledgementTimeout).
          pageAgainNumber: true,
          acknowledgedByUserId: true,
          acknowledgedByUser: {
            name: true,
            email: true,
          },
          onCallDutyPolicy: {
            _id: true,
            name: true,
            repeatPolicyIfNoOneAcknowledges: true,
            repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
          },
          // Who started a direct page.
          triggeredByWorkflowId: true,
          triggeredByWorkflowName: true,
          triggeredByUserId: true,
          triggeredByUser: {
            name: true,
            email: true,
          },
          // What the person who paged wrote (OnCallPersonPage).
          pageMessage: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!executionLog || !executionLog.projectId) {
      return null;
    }

    const projectId: ObjectID = executionLog.projectId;

    // No policy: people, a team or a schedule paged directly.
    const isDirectPage: boolean = isOnCallDirectPage(executionLog);

    const connected: Array<unknown> =
      await WorkspaceLiveMessages.getConnectedWorkspaceTypes(projectId);

    if (connected.length === 0) {
      return null;
    }

    const record: RunRecord | null = await this.readRecord(executionLog);

    if (!record) {
      return null;
    }

    /*
     * A direct page has no escalation rules - and none are read for it: with
     * no policy to match on, the read would hand back every rule of the
     * project.
     */
    const rules: Array<OnCallDutyPolicyEscalationRule> =
      isDirectPage || !executionLog.onCallDutyPolicyId
        ? []
        : await OnCallDutyPolicyEscalationRuleService.findBy({
            query: {
              projectId: projectId,
              onCallDutyPolicyId: executionLog.onCallDutyPolicyId,
            },
            select: {
              _id: true,
              name: true,
              order: true,
              escalateAfterInMinutes: true,
            },
            sort: {
              order: SortOrder.Ascending,
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: {
              isRoot: true,
            },
          });

    const timeline: Array<OnCallDutyPolicyExecutionLogTimeline> =
      await OnCallDutyPolicyExecutionLogTimelineService.findBy({
        query: {
          projectId: projectId,
          onCallDutyPolicyExecutionLogId: executionLogId,
        },
        select: {
          _id: true,
          status: true,
          statusMessage: true,
          alertSentToUserId: true,
          alertSentToUser: {
            name: true,
            email: true,
          },
          overridedByUserId: true,
          overridedByUser: {
            name: true,
            email: true,
          },
          onCallDutyPolicyEscalationRuleId: true,
          onCallDutyScheduleId: true,
          onCallDutySchedule: {
            name: true,
          },
          // Paged as the next in the schedule's rotation, or nobody was next.
          isNextInRotation: true,
          // The team a direct page named, for one with nobody in it.
          userBelongsToTeamId: true,
          userBelongsToTeam: {
            name: true,
          },
          isAcknowledged: true,
          createdAt: true,
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const deliveries: Array<UserOnCallLogTimeline> =
      await UserOnCallLogTimelineService.findBy({
        query: {
          projectId: projectId,
          onCallDutyPolicyExecutionLogId: executionLogId,
        },
        select: {
          _id: true,
          userId: true,
          status: true,
          userCallId: true,
          userSmsId: true,
          userWhatsAppId: true,
          userTelegramId: true,
          userPushId: true,
          userEmailId: true,
          userSlackId: true,
          userMicrosoftTeamsId: true,
          userWebhookId: true,
          customNotificationChannelId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    const policyUrl: URL | null =
      !isDirectPage && executionLog.onCallDutyPolicyId
        ? await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
            projectId,
            executionLog.onCallDutyPolicyId,
          )
        : null;

    const runUrl: URL = URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/on-call-duty/execution-logs/${executionLogId.toString()}`,
    );

    const run: OnCallPolicyRun = this.buildRun({
      executionLog: executionLog,
      rules: rules,
      timeline: timeline,
      deliveries: deliveries,
      policyUrl: policyUrl ? policyUrl.toString() : "",
      runUrl: runUrl.toString(),
      recordLabel: record.label,
      recordUrl: record.url.toString(),
      directPage: isDirectPage
        ? this.getDirectPage({
            executionLog: executionLog,
            dashboardUrl: dashboardUrl,
          })
        : undefined,
    });

    const outcome: {
      outcome: OnCallPolicyRunOutcome;
      detail?: string | undefined;
    } = await this.getOutcome({
      executionLog: executionLog,
      record: record,
    });

    run.outcome = outcome.outcome;
    run.outcomeDetail = outcome.detail;

    /*
     * Read from the run itself: a rule is under way (OneUptime records the
     * rule on the run before it writes the rule's first step), or the run
     * is over.
     *
     * A direct page has no rule, and pages everybody it names in one pass.
     * Its message waits for the end of that pass - the run is "executing"
     * once somebody was paged, and over at once when nobody was - so the
     * first post already says what the page came to. Posted at the pass's
     * first step instead, a page that reached nobody told the channel
     * "is paging for Incident INC-8" in one notification and "Nobody was
     * paged" in a second message a moment later.
     */
    const hasStarted: boolean =
      run.outcome !== OnCallPolicyRunOutcome.Paging ||
      Boolean(executionLog.lastExecutedEscalationRuleId) ||
      (isDirectPage &&
        executionLog.status === OnCallDutyPolicyStatus.Executing);

    return {
      projectId: projectId,
      notificationFor: record.notificationFor,
      run: run,
      hasStarted: hasStarted,
      recordTitle: record.title,
      ...(record.pageRequestKey
        ? { pageRequestKey: record.pageRequestKey }
        : {}),
    };
  }

  /*
   * Who started a direct page, for its message to name: the workflow whose
   * step did - by the name the run recorded, as a link to it in the
   * Dashboard when the run recorded which workflow it was - or the person.
   */
  private static getDirectPage(data: {
    executionLog: OnCallDutyPolicyExecutionLog;
    dashboardUrl: URL;
  }): OnCallDirectPageRun {
    const executionLog: OnCallDutyPolicyExecutionLog = data.executionLog;
    const workflowName: string = (
      executionLog.triggeredByWorkflowName || ""
    ).trim();

    if (workflowName) {
      return {
        startedByWorkflowName: workflowName,
        ...(executionLog.triggeredByWorkflowId && executionLog.projectId
          ? {
              startedByWorkflowUrl: URL.fromString(data.dashboardUrl.toString())
                .addRoute(
                  `/${executionLog.projectId.toString()}/workflows/${executionLog.triggeredByWorkflowId.toString()}/builder`,
                )
                .toString(),
            }
          : {}),
      };
    }

    if (executionLog.triggeredByUserId) {
      return {
        startedByPersonName: this.getPersonName(executionLog.triggeredByUser),
      };
    }

    return {};
  }

  /*
   * The run's message, from what its execution log and its timeline say -
   * everything but how it ended (getOutcome), which may need the record.
   */
  public static buildRun(data: {
    executionLog: OnCallDutyPolicyExecutionLog;
    rules: Array<OnCallDutyPolicyEscalationRule>;
    timeline: Array<OnCallDutyPolicyExecutionLogTimeline>;
    deliveries: Array<UserOnCallLogTimeline>;
    policyUrl: string;
    runUrl: string;
    recordLabel: string;
    recordUrl: string;
    // Set for a direct page: who started it.
    directPage?: OnCallDirectPageRun | undefined;
  }): OnCallPolicyRun {
    const executionLog: OnCallDutyPolicyExecutionLog = data.executionLog;

    const toRule: (
      rule: OnCallDutyPolicyEscalationRule | undefined,
    ) => OnCallPolicyRunRule | undefined = (
      rule: OnCallDutyPolicyEscalationRule | undefined,
    ): OnCallPolicyRunRule | undefined => {
      if (!rule || rule.order === undefined || rule.order === null) {
        return undefined;
      }

      return { order: rule.order, name: rule.name || undefined };
    };

    const ruleById: (
      ruleId: ObjectID | undefined | null,
    ) => OnCallDutyPolicyEscalationRule | undefined = (
      ruleId: ObjectID | undefined | null,
    ): OnCallDutyPolicyEscalationRule | undefined => {
      if (!ruleId) {
        return undefined;
      }

      return data.rules.find((rule: OnCallDutyPolicyEscalationRule) => {
        return rule.id?.toString() === ruleId.toString();
      });
    };

    const currentRuleModel: OnCallDutyPolicyEscalationRule | undefined =
      ruleById(executionLog.lastExecutedEscalationRuleId) ||
      data.rules.find((rule: OnCallDutyPolicyEscalationRule) => {
        return (
          executionLog.lastExecutedEscalationRuleOrder !== undefined &&
          executionLog.lastExecutedEscalationRuleOrder !== null &&
          rule.order === executionLog.lastExecutedEscalationRuleOrder
        );
      });

    const currentRule: OnCallPolicyRunRule | undefined =
      toRule(currentRuleModel);

    const nextRule: OnCallPolicyRunRule | undefined = currentRule
      ? toRule(
          data.rules.find((rule: OnCallDutyPolicyEscalationRule) => {
            return (rule.order || 0) > currentRule.order;
          }),
        )
      : undefined;

    // Everybody the run paged, in the order it first paged them.
    const pagedByUserId: Map<string, OnCallPolicyRunPagedPerson> = new Map<
      string,
      OnCallPolicyRunPagedPerson
    >();

    const notPaged: Array<OnCallPolicyRunNotPaged> = [];
    const notPagedKeys: Set<string> = new Set<string>();

    const addNotPaged: (key: string, entry: OnCallPolicyRunNotPaged) => void = (
      key: string,
      entry: OnCallPolicyRunNotPaged,
    ): void => {
      if (notPagedKeys.has(key)) {
        return;
      }

      notPagedKeys.add(key);
      notPaged.push(entry);
    };

    /*
     * Per escalation rule: why it paged fewer people, for a rule that reached
     * nobody - text, or Markdown holding a moment ("away until <time>").
     */
    const reasonsByRuleId: Map<string, Array<string | MarkdownText>> = new Map<
      string,
      Array<string | MarkdownText>
    >();

    const addRuleReason: (
      ruleId: ObjectID | undefined | null,
      reason: string | MarkdownText,
    ) => void = (
      ruleId: ObjectID | undefined | null,
      reason: string | MarkdownText,
    ): void => {
      if (!ruleId) {
        return;
      }

      const reasons: Array<string | MarkdownText> =
        reasonsByRuleId.get(ruleId.toString()) || [];

      const isSaid: boolean = reasons.some(
        (said: string | MarkdownText): boolean => {
          return said.toString() === reason.toString();
        },
      );

      if (!isSaid) {
        reasons.push(reason);
      }

      reasonsByRuleId.set(ruleId.toString(), reasons);
    };

    /*
     * Per escalation rule, as its steps tell it: where its first step is in
     * the timeline; how many people it paged, and how many of those pages
     * reached somebody; whether the engine found nobody to page in it (its
     * own line, written once every target was tried), and whether that line
     * says the run moved on from it at once (OnCallEmptyLevel); and whether
     * a schedule of it had nobody on call.
     */
    const stepsByRuleId: Map<string, RuleSteps> = new Map<string, RuleSteps>();

    const countStep: (
      ruleId: ObjectID | undefined | null,
      stepIndex: number,
      kind: RuleStepKind,
    ) => void = (
      ruleId: ObjectID | undefined | null,
      stepIndex: number,
      kind: RuleStepKind,
    ): void => {
      if (!ruleId) {
        return;
      }

      const steps: RuleSteps = stepsByRuleId.get(ruleId.toString()) || {
        firstStep: stepIndex,
        pages: 0,
        reached: 0,
        nobodyInIt: false,
        movedOnAtOnce: false,
        scheduleGap: false,
      };

      if (kind === "reached" || kind === "not reached") {
        steps.pages++;
      }

      if (kind === "reached") {
        steps.reached++;
      }

      if (kind === "nobody in it" || kind === "moved on at once") {
        steps.nobodyInIt = true;
      }

      if (kind === "moved on at once") {
        steps.movedOnAtOnce = true;
      }

      if (kind === "schedule gap") {
        steps.scheduleGap = true;
      }

      stepsByRuleId.set(ruleId.toString(), steps);
    };

    for (const [stepIndex, step] of data.timeline.entries()) {
      const status: OnCallDutyExecutionLogTimelineStatus | undefined =
        step.status;

      if (step.alertSentToUserId) {
        const userId: string = step.alertSentToUserId.toString();
        const name: string = this.getPersonName(step.alertSentToUser);

        if (status === OnCallDutyExecutionLogTimelineStatus.Skipped) {
          /*
           * Paged by this rule already, through another of its targets: the
           * same person, counted where they were first paged.
           */
          if (step.statusMessage === ALREADY_PAGED_TIMELINE_MESSAGE) {
            continue;
          }

          /*
           * Passed over by a later rule or a repeat, having escalated the
           * page: their line says they escalated it, once - and a rule whose
           * people all did reached nobody it had not asked already.
           */
          if (isOnCallPagePassedOnSkipTimelineMessage(step.statusMessage)) {
            continue;
          }

          countStep(
            step.onCallDutyPolicyEscalationRuleId,
            stepIndex,
            "not reached",
          );

          /*
           * Away with nobody named to cover (a user override that skips
           * them): until when, in each reader's own time.
           */
          const awayUntil: Date | null = readAwayUntil(step.statusMessage);

          if (awayUntil) {
            addNotPaged(`person:${userId}:away`, {
              personName: name,
              reason: "away",
              awayUntil: awayUntil,
            });
            addRuleReason(
              step.onCallDutyPolicyEscalationRuleId,
              OnCallPolicyRunMessageView.getAwayReason(name, awayUntil),
            );
            continue;
          }

          const reason: string = this.getSkipReason(step.statusMessage);

          addNotPaged(`person:${userId}:${reason}`, {
            personName: name,
            reason: reason,
          });
          addRuleReason(
            step.onCallDutyPolicyEscalationRuleId,
            `${name}: ${reason}`,
          );
          continue;
        }

        if (status === OnCallDutyExecutionLogTimelineStatus.Error) {
          countStep(
            step.onCallDutyPolicyEscalationRuleId,
            stepIndex,
            "not reached",
          );

          const reason: string = step.statusMessage?.trim()
            ? `could not be paged (${step.statusMessage.trim().replace(TRAILING_FULL_STOP, "")})`
            : "could not be paged";

          addNotPaged(`person:${userId}:${reason}`, {
            personName: name,
            reason: reason,
            failed: true,
          });
          // The alarm says why in a word; the message's list has the rest.
          addRuleReason(
            step.onCallDutyPolicyEscalationRuleId,
            `${name}: could not be paged`,
          );
          continue;
        }

        countStep(step.onCallDutyPolicyEscalationRuleId, stepIndex, "reached");

        let person: OnCallPolicyRunPagedPerson | undefined =
          pagedByUserId.get(userId);

        if (!person) {
          person = {
            name: name,
            timesPaged: 0,
            isBeingPaged: false,
            acknowledged: false,
            methods: [],
            coveringFor: [],
          };
          pagedByUserId.set(userId, person);
        }

        if (
          status === OnCallDutyExecutionLogTimelineStatus.NotificationSent ||
          status ===
            OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged ||
          status === OnCallDutyExecutionLogTimelineStatus.PassedOn
        ) {
          person.timesPaged++;
        } else {
          // Started or Executing: the page is still going out.
          person.isBeingPaged = true;
        }

        // They could not take it, and escalated it (OnCallPagePassOn).
        if (status === OnCallDutyExecutionLogTimelineStatus.PassedOn) {
          person.passedOn = true;
        }

        if (
          status ===
            OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged ||
          step.isAcknowledged
        ) {
          person.acknowledged = true;
        }

        if (step.overridedByUserId) {
          const coveredName: string = this.getPersonName(step.overridedByUser);

          if (!person.coveringFor.includes(coveredName)) {
            person.coveringFor.push(coveredName);
          }
        }

        /*
         * Paged as a member of a team the page or the rule named: the line
         * names the team, once per team.
         */
        if (step.userBelongsToTeamId) {
          const teamName: string =
            step.userBelongsToTeam?.name?.trim() || "(unnamed)";
          const teams: Array<string> = person.teams || [];

          if (!teams.includes(teamName)) {
            teams.push(teamName);
          }

          person.teams = teams;
        }

        /*
         * Paged as the next in a schedule's rotation - the backup after
         * whoever is on call: the line says so, once per schedule.
         */
        if (step.isNextInRotation && step.onCallDutyScheduleId) {
          const scheduleName: string =
            step.onCallDutySchedule?.name?.trim() || "(unnamed)";
          const nextInRotationOf: Array<string> = person.nextInRotationOf || [];

          if (!nextInRotationOf.includes(scheduleName)) {
            nextInRotationOf.push(scheduleName);
          }

          person.nextInRotationOf = nextInRotationOf;
        }

        continue;
      }

      if (status !== OnCallDutyExecutionLogTimelineStatus.Skipped) {
        continue;
      }

      /*
       * A rule that pages the next person in a schedule's rotation found
       * somebody on call there but nobody next: it pages nobody there, and
       * is not tried again - nobody on call at all is the gap below.
       */
      if (step.onCallDutyScheduleId && step.isNextInRotation) {
        countStep(
          step.onCallDutyPolicyEscalationRuleId,
          stepIndex,
          "nobody next",
        );

        const scheduleName: string =
          step.onCallDutySchedule?.name?.trim() || "(unnamed)";

        addNotPaged(`schedule-next:${step.onCallDutyScheduleId.toString()}`, {
          scheduleName: scheduleName,
          nobodyNextInRotation: true,
          reason: "nobody was next in the rotation",
        });
        addRuleReason(
          step.onCallDutyPolicyEscalationRuleId,
          OnCallPolicyRunMessageView.getNobodyNextInRotationReason(
            scheduleName,
          ),
        );
        continue;
      }

      if (step.onCallDutyScheduleId) {
        countStep(
          step.onCallDutyPolicyEscalationRuleId,
          stepIndex,
          "schedule gap",
        );

        const scheduleName: string =
          step.onCallDutySchedule?.name?.trim() || "(unnamed)";

        addNotPaged(`schedule:${step.onCallDutyScheduleId.toString()}`, {
          scheduleName: scheduleName,
          reason: "nobody was on call",
        });
        addRuleReason(
          step.onCallDutyPolicyEscalationRuleId,
          `nobody was on call in schedule ${scheduleName}`,
        );
        continue;
      }

      /*
       * A step about a team, with nobody in it: the team a direct page or
       * an escalation rule named has no members, so nobody was paged
       * through it.
       */
      if (step.userBelongsToTeamId) {
        const teamName: string =
          step.userBelongsToTeam?.name?.trim() || "(unnamed)";

        countStep(
          step.onCallDutyPolicyEscalationRuleId,
          stepIndex,
          "empty team",
        );

        addNotPaged(`team:${step.userBelongsToTeamId.toString()}`, {
          teamName: teamName,
          reason: "has no members",
        });
        addRuleReason(
          step.onCallDutyPolicyEscalationRuleId,
          `team ${teamName} has no members`,
        );
        continue;
      }

      /*
       * A step with no person, no schedule and no team: the level's own
       * line, the rule found nobody to page - and, as written since a level
       * with nobody to page is passed at once, that the run moved on.
       */
      countStep(
        step.onCallDutyPolicyEscalationRuleId,
        stepIndex,
        isOnCallEmptyLevelMovedOnAtOnce(step.statusMessage)
          ? "moved on at once"
          : "nobody in it",
      );
    }

    const isRunOver: boolean =
      executionLog.status === OnCallDutyPolicyStatus.Completed ||
      executionLog.status ===
        OnCallDutyPolicyStatus.CompletedWithNoNotifications ||
      executionLog.status === OnCallDutyPolicyStatus.Error;

    /*
     * A rule reached nobody when the engine found nobody in it, or when it
     * paged people and every page was skipped or failed - each opted out,
     * left the project, or could not be reached.
     *
     * It is said - an alarm, once per run - only once the rule is finished:
     * the run has moved on from it, or has ended. Until then the rule may
     * still reach somebody: its pages are written one target at a time, and
     * a page that is skipped is only found to be a while after it was made.
     * A rule whose own line says the run moved on from it at once is
     * finished as soon as that is written; so, in runs from before that, is
     * a rule the engine found nobody in with no schedule of it to try again.
     */
    const rulesThatReachedNobody: Array<OnCallDutyPolicyEscalationRule> = [];

    const latestStepRuleId: string | undefined =
      data.timeline[
        data.timeline.length - 1
      ]?.onCallDutyPolicyEscalationRuleId?.toString();

    for (const [ruleId, steps] of stepsByRuleId.entries()) {
      const rule: OnCallDutyPolicyEscalationRule | undefined = ruleById(
        new ObjectID(ruleId),
      );

      if (!rule) {
        continue;
      }

      /*
       * No page of it reached anybody - in any try: a rule whose first try
       * found nobody on call, and whose next try paged somebody, did reach
       * somebody.
       */
      const reachedNobody: boolean =
        steps.reached === 0 && (steps.nobodyInIt || steps.pages > 0);

      /*
       * The rule the run is on - as its log says, or as its newest step
       * says: the log is read before the steps, so a sync that read it just
       * before the run moved on sees the next rule's first steps under the
       * rule before.
       */
      const isCurrentRule: boolean =
        rule.id?.toString() === currentRuleModel?.id?.toString() ||
        rule.id?.toString() === latestStepRuleId;

      const isFinished: boolean =
        isRunOver ||
        !isCurrentRule ||
        steps.movedOnAtOnce ||
        (steps.nobodyInIt && !steps.scheduleGap);

      if (reachedNobody && isFinished) {
        rulesThatReachedNobody.push(rule);
      }
    }

    // The first rule that reached nobody is the first one the run came to.
    rulesThatReachedNobody.sort(
      (
        a: OnCallDutyPolicyEscalationRule,
        b: OnCallDutyPolicyEscalationRule,
      ): number => {
        return (
          (stepsByRuleId.get(a.id!.toString())?.firstStep ?? 0) -
          (stepsByRuleId.get(b.id!.toString())?.firstStep ?? 0)
        );
      },
    );

    /*
     * The level the run moved on to at once from a rule that reached
     * nobody: the one after it, when there is one. Said only where the
     * rule's own line says the run did not wait (OnCallEmptyLevel) - a rule
     * of a run from before that was waited out.
     */
    const getMovedOnTo: (
      rule: OnCallDutyPolicyEscalationRule,
    ) => OnCallPolicyRunRule | undefined = (
      rule: OnCallDutyPolicyEscalationRule,
    ): OnCallPolicyRunRule | undefined => {
      if (
        !stepsByRuleId.get(rule.id!.toString())?.movedOnAtOnce ||
        typeof rule.order !== "number"
      ) {
        return undefined;
      }

      const order: number = rule.order;

      return toRule(
        data.rules.find(
          (candidate: OnCallDutyPolicyEscalationRule): boolean => {
            return candidate.order === order + 1;
          },
        ),
      );
    };

    // A rule that reached nobody, with nothing else to say why: it has nobody to page.
    for (const rule of rulesThatReachedNobody) {
      const reasons: Array<string | MarkdownText> =
        reasonsByRuleId.get(rule.id!.toString()) || [];

      if (reasons.length === 0) {
        const movedOnTo: OnCallPolicyRunRule | undefined = getMovedOnTo(rule);

        addNotPaged(`rule:${rule.id!.toString()}`, {
          rule: toRule(rule),
          reason: "nobody to page",
          ...(movedOnTo ? { movedOnTo: movedOnTo } : {}),
        });
      }
    }

    /*
     * Somebody who escalated the page is not being paged by this run any
     * more, whatever a page of theirs that was still going out said.
     */
    for (const person of pagedByUserId.values()) {
      if (person.passedOn) {
        person.isBeingPaged = false;
      }
    }

    // How each person's pages reached them.
    for (const delivery of data.deliveries) {
      if (
        !delivery.userId ||
        (delivery.status !== UserNotificationStatus.Sent &&
          delivery.status !== UserNotificationStatus.Acknowledged &&
          delivery.status !== UserNotificationStatus.PassedOn)
      ) {
        continue;
      }

      const person: OnCallPolicyRunPagedPerson | undefined = pagedByUserId.get(
        delivery.userId.toString(),
      );

      if (!person) {
        continue;
      }

      for (const method of METHOD_LABELS) {
        if (delivery[method.field] && !person.methods.includes(method.label)) {
          person.methods.push(method.label);
        }
      }
    }

    for (const person of pagedByUserId.values()) {
      person.methods.sort((a: string, b: string): number => {
        return (
          METHOD_LABELS.findIndex(
            (method: { field: keyof UserOnCallLogTimeline; label: string }) => {
              return method.label === a;
            },
          ) -
          METHOD_LABELS.findIndex(
            (method: { field: keyof UserOnCallLogTimeline; label: string }) => {
              return method.label === b;
            },
          )
        );
      });
    }

    const firstRule: OnCallDutyPolicyEscalationRule | undefined =
      rulesThatReachedNobody[0];

    const firstRuleMovedOnTo: OnCallPolicyRunRule | undefined = firstRule
      ? getMovedOnTo(firstRule)
      : undefined;

    /*
     * The rule the run's log is on reached nobody, and its own line says
     * the run moves on from it at once (OnCallEmptyLevel): the run is on
     * its way to the next level that same moment, and its log names that
     * level as soon as the level is paged. A message read in between - the
     * run's first post often is - says where the run is going, with that
     * level's own wait ("Level 2 of 2: if nobody acknowledges within 30
     * minutes, paging stops."), not a wait the empty level never holds
     * ("Level 1 of 2: if nobody acknowledges by 5:19 PM, Level 2 of 2 is
     * next.").
     */
    const levelMovingOnTo: OnCallDutyPolicyEscalationRule | undefined =
      !isRunOver &&
      currentRuleModel &&
      typeof currentRuleModel.order === "number" &&
      stepsByRuleId.get(currentRuleModel.id?.toString() || "")?.movedOnAtOnce
        ? data.rules.find((rule: OnCallDutyPolicyEscalationRule): boolean => {
            return rule.order === currentRuleModel.order! + 1;
          })
        : undefined;

    const shownRule: OnCallPolicyRunRule | undefined = levelMovingOnTo
      ? toRule(levelMovingOnTo)
      : currentRule;

    const shownNextRule: OnCallPolicyRunRule | undefined = levelMovingOnTo
      ? toRule(
          data.rules.find((rule: OnCallDutyPolicyEscalationRule): boolean => {
            return (rule.order || 0) > (levelMovingOnTo.order || 0);
          }),
        )
      : nextRule;

    const escalateAfterInMinutes: number = levelMovingOnTo
      ? levelMovingOnTo.escalateAfterInMinutes || 0
      : executionLog.executeNextEscalationRuleInMinutes ??
        currentRuleModel?.escalateAfterInMinutes ??
        0;

    /*
     * When the current rule's wait is over: the next step names that moment
     * rather than the wait, which never said from when. Known once the run
     * has recorded when the rule started.
     */
    const ruleStartedAt: Date | undefined =
      executionLog.lastEscalationRuleExecutedAt
        ? new Date(executionLog.lastEscalationRuleExecutedAt)
        : undefined;

    // A level the run is moving on to has not started its wait yet.
    const nextStepAt: Date | undefined =
      !levelMovingOnTo &&
      ruleStartedAt &&
      !isNaN(ruleStartedAt.getTime()) &&
      escalateAfterInMinutes > 0
        ? WorkspaceMessageTime.endOfWait(ruleStartedAt, escalateAfterInMinutes)
        : undefined;

    /*
     * A run that waits to page (OnCallDutyPolicyRunWait): when it starts,
     * and whether it waits for working hours.
     */
    const pagingStartsAt: Date | undefined = executionLog.pagingStartsAt
      ? new Date(executionLog.pagingStartsAt)
      : undefined;

    const waiting: Partial<OnCallPolicyRun> =
      executionLog.status === OnCallDutyPolicyStatus.Waiting
        ? {
            ...(pagingStartsAt && !isNaN(pagingStartsAt.getTime())
              ? { pagingStartsAt: pagingStartsAt }
              : {}),
            isWaitingForWorkingHours: isOnCallPolicyRunWaitingForWorkingHours(
              executionLog.statusMessage,
            ),
          }
        : {};

    /*
     * A run that waited and started before its hours began, because its
     * record came to match a rule that pages right away
     * (WaitingRunsOnRecordChange): why, said for as long as the run is
     * told.
     */
    const startedEarlyReason: string =
      executionLog.status !== OnCallDutyPolicyStatus.Waiting
        ? (executionLog.pagingStartedEarlyReason || "").trim()
        : "";

    // What the person who paged wrote, quoted under the first line.
    const pageMessage: string = (executionLog.pageMessage || "").trim();

    return {
      ...waiting,
      ...(startedEarlyReason ? { startedEarlyReason: startedEarlyReason } : {}),
      ...(pageMessage ? { pageMessage: pageMessage } : {}),
      ...(isOnCallPageAgainRun(executionLog)
        ? { pageAgainNumber: Number(executionLog.pageAgainNumber) }
        : {}),
      policyName: data.directPage
        ? ""
        : executionLog.onCallDutyPolicy?.name?.trim() || "On-call policy",
      policyUrl: data.policyUrl,
      ...(data.directPage ? { directPage: data.directPage } : {}),
      runUrl: data.runUrl,
      recordLabel: data.recordLabel,
      recordUrl: data.recordUrl,
      outcome: OnCallPolicyRunOutcome.Paging,
      acknowledgedByName: executionLog.acknowledgedByUserId
        ? this.getPersonName(executionLog.acknowledgedByUser)
        : undefined,
      ruleCount: data.rules.length,
      currentRule: shownRule,
      nextRule: shownNextRule,
      escalateAfterInMinutes: escalateAfterInMinutes,
      nextStepAt: nextStepAt,
      repeatNumber: Math.max(
        (executionLog.onCallPolicyExecutionRepeatCount || 1) - 1,
        0,
      ),
      // None while the policy's "Repeat if no one acknowledges" is off.
      repeatsAllowed: getOnCallPolicyRepeatsAllowed(
        executionLog.onCallDutyPolicy,
      ),
      paged: Array.from(pagedByUserId.values()),
      notPaged: notPaged,
      firstRuleThatReachedNobody: firstRule
        ? {
            rule: toRule(firstRule)!,
            reasons: reasonsByRuleId.get(firstRule.id!.toString()) || [
              "the rule has nobody to page",
            ],
            ...(firstRuleMovedOnTo ? { movedOnTo: firstRuleMovedOnTo } : {}),
          }
        : undefined,
    };
  }

  // How the run stands: still paging, or how it ended.
  private static async getOutcome(data: {
    executionLog: OnCallDutyPolicyExecutionLog;
    record: RunRecord;
  }): Promise<{
    outcome: OnCallPolicyRunOutcome;
    detail?: string | undefined;
  }> {
    const executionLog: OnCallDutyPolicyExecutionLog = data.executionLog;

    switch (executionLog.status) {
      // Paging nobody yet: it waits for its moment (OnCallDutyPolicyRunWait).
      case OnCallDutyPolicyStatus.Waiting:
        return { outcome: OnCallPolicyRunOutcome.Waiting };
      case OnCallDutyPolicyStatus.Completed: {
        if (executionLog.acknowledgedByUserId) {
          return { outcome: OnCallPolicyRunOutcome.Acknowledged };
        }

        const statusMessage: string = executionLog.statusMessage || "";

        // Its record was handled while it waited: it paged nobody.
        if (isOnCallPolicyRunEndedWhileWaiting(statusMessage)) {
          return {
            outcome: OnCallPolicyRunOutcome.HandledWhileWaiting,
            detail: data.record.stateName,
          };
        }

        if (
          statusMessage === ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE
        ) {
          return { outcome: OnCallPolicyRunOutcome.PolicyArchived };
        }

        /*
         * Why the run ended is in the message it was given as it ended, not
         * in the record as it is now: the run's message is brought up to
         * date after it ends too (a page's delivery finishing), and a record
         * acknowledged since would rewrite "nobody acknowledged" as "the
         * record was handled" - or the other way round.
         */
        if (
          statusMessage === ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE
        ) {
          /*
           * A page a person asked for goes on whether or not somebody else
           * acknowledges the record (OnCallPersonPage). Ending with nobody
           * answering while somebody is on the record, it went unanswered:
           * nobody needs to take the record. Read once, as it ends: the
           * ending is kept as it was first told (keepEnding).
           */
          if (
            isOnCallPersonPage(executionLog) &&
            (await data.record.isAcknowledged())
          ) {
            return { outcome: OnCallPolicyRunOutcome.NobodyAnswered };
          }

          return { outcome: OnCallPolicyRunOutcome.NobodyAcknowledged };
        }

        // Nobody was left: everybody it paged escalated it.
        if (isOnCallPolicyRunEverybodyPassedOnMessage(statusMessage)) {
          return { outcome: OnCallPolicyRunOutcome.EverybodyPassedOn };
        }

        if (
          statusMessage.startsWith(
            ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START,
          )
        ) {
          return {
            outcome: OnCallPolicyRunOutcome.RecordHandled,
            detail: data.record.stateName,
          };
        }

        // A message this does not know: read from the record, as before.
        if (await data.record.isAcknowledged()) {
          return {
            outcome: OnCallPolicyRunOutcome.RecordHandled,
            detail: data.record.stateName,
          };
        }

        return { outcome: OnCallPolicyRunOutcome.NobodyAcknowledged };
      }
      case OnCallDutyPolicyStatus.CompletedWithNoNotifications:
        return { outcome: OnCallPolicyRunOutcome.NobodyReached };
      case OnCallDutyPolicyStatus.Error:
        return {
          outcome: OnCallPolicyRunOutcome.Failed,
          detail: executionLog.statusMessage?.trim() || undefined,
        };
      default:
        return { outcome: OnCallPolicyRunOutcome.Paging };
    }
  }

  // The incident, alert or episode the run pages for.
  private static async readRecord(
    executionLog: OnCallDutyPolicyExecutionLog,
  ): Promise<RunRecord | null> {
    const projectId: ObjectID = executionLog.projectId!;

    if (executionLog.triggeredByIncidentId) {
      const incidentId: ObjectID = executionLog.triggeredByIncidentId;
      const incident: Incident | null = await IncidentService.findOneById({
        id: incidentId,
        select: {
          title: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
          currentIncidentState: {
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (!incident) {
        return null;
      }

      return {
        notificationFor: { incidentId: incidentId },
        label: `Incident ${incident.incidentNumberWithPrefix || "#" + (incident.incidentNumber ?? "")}`,
        url: await IncidentService.getIncidentLinkInDashboard(
          projectId,
          incidentId,
        ),
        title: incident.title?.toString() || "",
        stateName: incident.currentIncidentState?.name || undefined,
        pageRequestKey: WorkspaceLiveMessageKey.forOnCallPageRequest(
          WorkspaceLiveMessagePageRecordType.Incident,
          incidentId,
        ),
        isAcknowledged: async (): Promise<boolean> => {
          return await IncidentService.isIncidentAcknowledged({
            incidentId: incidentId,
          });
        },
      };
    }

    if (executionLog.triggeredByAlertId) {
      const alertId: ObjectID = executionLog.triggeredByAlertId;
      const alert: Alert | null = await AlertService.findOneById({
        id: alertId,
        select: {
          title: true,
          alertNumber: true,
          alertNumberWithPrefix: true,
          currentAlertState: {
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (!alert) {
        return null;
      }

      return {
        notificationFor: { alertId: alertId },
        label: `Alert ${alert.alertNumberWithPrefix || "#" + (alert.alertNumber ?? "")}`,
        url: await AlertService.getAlertLinkInDashboard(projectId, alertId),
        title: alert.title?.toString() || "",
        stateName: alert.currentAlertState?.name || undefined,
        pageRequestKey: WorkspaceLiveMessageKey.forOnCallPageRequest(
          WorkspaceLiveMessagePageRecordType.Alert,
          alertId,
        ),
        isAcknowledged: async (): Promise<boolean> => {
          return await AlertService.isAlertAcknowledged({ alertId: alertId });
        },
      };
    }

    if (executionLog.triggeredByIncidentEpisodeId) {
      const episodeId: ObjectID = executionLog.triggeredByIncidentEpisodeId;
      const episode: IncidentEpisode | null =
        await IncidentEpisodeService.findOneById({
          id: episodeId,
          select: {
            title: true,
            episodeNumber: true,
            episodeNumberWithPrefix: true,
            currentIncidentState: {
              name: true,
            },
          },
          props: {
            isRoot: true,
          },
        });

      if (!episode) {
        return null;
      }

      return {
        notificationFor: { incidentEpisodeId: episodeId },
        label: `Incident Episode ${episode.episodeNumberWithPrefix || "#" + (episode.episodeNumber ?? "")}`,
        url: await IncidentEpisodeService.getEpisodeLinkInDashboard(
          projectId,
          episodeId,
        ),
        title: episode.title?.toString() || "",
        stateName: episode.currentIncidentState?.name || undefined,
        isAcknowledged: async (): Promise<boolean> => {
          return await IncidentEpisodeService.isEpisodeAcknowledged({
            episodeId: episodeId,
          });
        },
      };
    }

    if (executionLog.triggeredByAlertEpisodeId) {
      const episodeId: ObjectID = executionLog.triggeredByAlertEpisodeId;
      const episode: AlertEpisode | null =
        await AlertEpisodeService.findOneById({
          id: episodeId,
          select: {
            title: true,
            episodeNumber: true,
            episodeNumberWithPrefix: true,
            currentAlertState: {
              name: true,
            },
          },
          props: {
            isRoot: true,
          },
        });

      if (!episode) {
        return null;
      }

      return {
        notificationFor: { alertEpisodeId: episodeId },
        label: `Alert Episode ${episode.episodeNumberWithPrefix || "#" + (episode.episodeNumber ?? "")}`,
        url: await AlertEpisodeService.getEpisodeLinkInDashboard(
          projectId,
          episodeId,
        ),
        title: episode.title?.toString() || "",
        stateName: episode.currentAlertState?.name || undefined,
        isAcknowledged: async (): Promise<boolean> => {
          return await AlertEpisodeService.isEpisodeAcknowledged({
            episodeId: episodeId,
          });
        },
      };
    }

    return null;
  }

  private static getPersonName(
    user: { name?: unknown; email?: unknown } | undefined | null,
  ): string {
    const name: string = user?.name ? String(user.name).trim() : "";

    if (name) {
      return name;
    }

    const email: string = user?.email ? String(user.email).trim() : "";

    return email || "Someone";
  }

  // "Skipped because this user is not a member of the project." -> a phrase.
  private static getSkipReason(statusMessage: string | undefined): string {
    if (!statusMessage || !statusMessage.trim()) {
      return ON_CALL_RUN_NOT_PAGED;
    }

    /*
     * Both ways OneUptime says somebody is not in the project: the rule
     * found them gone before paging, or their page found them gone.
     */
    if (
      statusMessage === NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE ||
      statusMessage === NOT_A_PROJECT_MEMBER_STATUS_MESSAGE
    ) {
      return "not a member of this project";
    }

    const reason: string = statusMessage
      .trim()
      .replace(SKIPPED_BECAUSE_PREFIX, "")
      .replace(YOU_HAVE_PREFIX, "has ")
      .replace(TRAILING_FULL_STOP, "");

    return reason || ON_CALL_RUN_NOT_PAGED;
  }
}
