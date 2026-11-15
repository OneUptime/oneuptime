import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import WorkspaceNotificationSummary from "../../Models/DatabaseModels/WorkspaceNotificationSummary";
import WorkspaceNotificationSummaryType from "../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import WorkspaceNotificationSummaryItem from "../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryItem";
import BadDataException from "../../Types/Exception/BadDataException";
import IncidentService from "./IncidentService";
import AlertService from "./AlertService";
import IncidentEpisodeService from "./IncidentEpisodeService";
import AlertEpisodeService from "./AlertEpisodeService";
import IncidentStateTimelineService from "./IncidentStateTimelineService";
import AlertStateTimelineService from "./AlertStateTimelineService";
import IncidentStateService from "./IncidentStateService";
import AlertStateService from "./AlertStateService";
import ResolvedStateUtil from "../../Utils/ResolvedState";
import AcknowledgedStateUtil from "../../Utils/AcknowledgedState";
import { StateListType } from "../../Utils/StateOrder";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import Incident from "../../Models/DatabaseModels/Incident";
import Alert from "../../Models/DatabaseModels/Alert";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import IncidentStateTimeline from "../../Models/DatabaseModels/IncidentStateTimeline";
import AlertStateTimeline from "../../Models/DatabaseModels/AlertStateTimeline";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import LinkedAffectedResources from "../Utils/AffectedResources/LinkedAffectedResources";
import WorkspaceNotificationLogService from "./WorkspaceNotificationLogService";
import WorkspaceNotificationStatus from "../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceNotificationActionType from "../../Types/Workspace/WorkspaceNotificationActionType";
import logger from "../Utils/Logger";
import OneUptimeDate from "../../Types/Date";
import QueryHelper from "../Types/Database/QueryHelper";
import WorkspaceMessagePayload, {
  WorkspaceMessageBlock,
  WorkspacePayloadDivider,
  WorkspacePayloadHeader,
  WorkspacePayloadMarkdown,
} from "../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceUtil from "../Utils/Workspace/Workspace";
import MicrosoftTeamsUtil from "../Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import BlockedProjectNotifications from "../Utils/Notification/BlockedProjectNotifications";
import WorkspaceProjectAuthTokenService from "./WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsMiscData,
  MicrosoftTeamsTeam,
} from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceBase, {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../Utils/Workspace/WorkspaceBase";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../Types/Workspace/WorkspaceType";
import ColumnLength from "../../Types/Database/ColumnLength";
import WorkspaceChannelNotFound from "../Utils/Workspace/WorkspaceChannelNotFound";
import { WorkspaceSummaryTestChannel } from "../../Types/Workspace/NotificationSummary/WorkspaceSummaryTestChannel";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import URL from "../../Types/API/URL";
import DatabaseConfig from "../DatabaseConfig";
import NotificationRuleCondition, {
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
  NotificationRuleConditionValues,
} from "../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorService from "./MonitorService";
import WorkspaceRecordOwners, {
  OwnedRecordKey,
} from "../Utils/Workspace/WorkspaceRecordOwners";
import NotificationRuleConditionIds from "../Utils/Workspace/NotificationRuleConditionIds";
import FilterCondition from "../../Types/Filter/FilterCondition";
import { WorkspaceNotificationRuleUtil } from "../../Types/Workspace/NotificationRules/NotificationRuleUtil";
import IncidentNotificationRule from "../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import PartialEntity from "../../Types/Database/PartialEntity";
import WorkspaceSummaryScheduleUtil, {
  WorkspaceSummaryScheduleColumns,
  WorkspaceSummaryScheduleWrite,
} from "../../Utils/Workspace/WorkspaceSummarySchedule";
import WorkspaceSummarySetup, {
  DEFAULT_LOOKBACK_DAYS,
  LOOKBACK_DAYS_COLUMN,
  WorkspaceSummaryNotSendableException,
} from "../../Utils/Workspace/WorkspaceSummarySetup";
import Timezone from "../../Types/Timezone";
import User from "../../Models/DatabaseModels/User";
import UserService from "./UserService";
import FeedMarkdown, {
  mdText,
  MarkdownText,
  MarkdownValue,
} from "../../Utils/Markdown/FeedMarkdown";

/*
 * NOTE ON FORMATTING:
 * WorkspacePayloadMarkdown text goes through SlackifyMarkdown which converts
 * standard markdown to Slack mrkdwn. So we must use:
 *   **bold**  (NOT *bold*)
 *   _italic_  (same in both)
 *   [text](url)  (NOT <url|text>)
 */

interface TimelineData {
  ackBy?: string | undefined;
  resolvedBy?: string | undefined;
  ackAt?: Date | undefined;
  resolvedAt?: Date | undefined;
  declaredAt?: Date | undefined;
}

/*
 * Whether a state of the project counts as resolved and as acknowledged, by
 * the two rules every part of OneUptime reads (Common/Utils/ResolvedState,
 * Common/Utils/AcknowledgedState).
 */
interface SummaryStateRules {
  isResolved: (stateId: ObjectID | undefined) => boolean;
  isAcknowledged: (stateId: ObjectID | undefined) => boolean;
}

// The schedule columns a write or a stored summary holds.
const getScheduleColumns: (
  source: Record<string, unknown>,
) => WorkspaceSummaryScheduleColumns = (
  source: Record<string, unknown>,
): WorkspaceSummaryScheduleColumns => {
  return {
    recurringInterval: source[
      "recurringInterval"
    ] as WorkspaceSummaryScheduleColumns["recurringInterval"],
    sendFirstReportAt: source[
      "sendFirstReportAt"
    ] as WorkspaceSummaryScheduleColumns["sendFirstReportAt"],
    nextSendAt: source[
      "nextSendAt"
    ] as WorkspaceSummaryScheduleColumns["nextSendAt"],
    isEnabled: source[
      "isEnabled"
    ] as WorkspaceSummaryScheduleColumns["isEnabled"],
    timezone: source["timezone"] as WorkspaceSummaryScheduleColumns["timezone"],
  };
};

// Writes the columns a schedule rule added into a write's data.
const applyScheduleWrite: (
  data: Record<string, unknown>,
  write: WorkspaceSummaryScheduleWrite,
) => void = (
  data: Record<string, unknown>,
  write: WorkspaceSummaryScheduleWrite,
): void => {
  if (write.recurringInterval) {
    data["recurringInterval"] = write.recurringInterval;
  }

  if (write.sendFirstReportAt) {
    data["sendFirstReportAt"] = write.sendFirstReportAt;
  }

  if (write.nextSendAt) {
    data["nextSendAt"] = write.nextSendAt;
  }

  if (write.timezone) {
    data["timezone"] = write.timezone;
  }
};

// One summary's next send, for an update that matched several needing different ones.
interface SummaryNextSendWrite {
  summaryId: ObjectID;
  nextSendAt: Date;
}

interface SummaryUpdateCarryForward {
  nextSendWrites: Array<SummaryNextSendWrite>;
}

// What giving the summaries made before they had a time zone one did.
export interface WorkspaceSummaryTimezoneBackfillResult {
  // Summaries that took their creator's time zone.
  fromCreator: number;
  // Summaries with no creator, or a creator with no time zone: UTC, as before.
  utc: number;
}

// How many summaries one pass of the backfill reads.
const TIMEZONE_BACKFILL_BATCH_SIZE: number = 100;

// How many monitors a summary reads the labels of in one query.
const SUMMARY_READ_BATCH_SIZE: number = 500;

/*
 * What became of a summary in one of the channels it names (sendSummary):
 * posted, with the message the workspace gave back, or not, with why in the
 * workspace's own words.
 */
export interface WorkspaceSummaryChannelResult {
  // The channel as the summary names it.
  channelName: string;
  isPosted: boolean;
  // The channel's id in the workspace, once the workspace found it.
  channelId?: string | undefined;
  // The message posted in it.
  threadId?: string | undefined;
  // Why nothing was posted in it.
  reason?: string | undefined;
}

// A failure the workspace gave no words for.
const SEND_FAILED_REASON: string = "Failed to send message";

// The end of a sentence, for reasons said one after another.
const SENTENCE_END: RegExp = /[.!?]$/;

// The # a Slack channel's name may be written with (SlackUtil.sendMessage).
const SLACK_CHANNEL_PREFIX: RegExp = /^#/;

// The # or ~ a Mattermost channel's name may be written with (findChannelByName).
const MATTERMOST_CHANNEL_PREFIX: RegExp = /^[#~]/;

// A Microsoft Teams team's id, as Microsoft Graph writes it: a GUID.
const MICROSOFT_TEAMS_TEAM_ID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Send Test Now's refusal when a channel did not get the test summary
 * (testSummary). A BadDataException, so its message - each channel not
 * posted in and why, in English - is what the API answers as before; the
 * test route also answers `channels`, what became of the test in each
 * channel, which the Dashboard lists in the reader's language
 * (WorkspaceNotificationSummaryAPI).
 */
export class WorkspaceSummaryTestNotPostedException extends BadDataException {
  public readonly channels: Array<WorkspaceSummaryTestChannel>;

  public constructor(data: {
    message: string;
    channels: Array<WorkspaceSummaryTestChannel>;
  }) {
    super(data.message);
    this.channels = data.channels;
  }
}

/*
 * The Microsoft Teams team a summary's channels are in, as Microsoft Graph
 * knows it - or why there is none to post in.
 */
export interface MicrosoftTeamsTeamOfSummary {
  // The team's id: what Microsoft Teams finds the channels by.
  teamId?: string | undefined;
  // Why no channel is posted in: no team named, or none of the name.
  notPostedReason?: string | undefined;
}

export class Service extends DatabaseService<WorkspaceNotificationSummary> {
  public constructor() {
    super(WorkspaceNotificationSummary);
  }

  /*
   * A new summary gets the schedule it leaves out (WorkspaceSummaryScheduleUtil):
   * the time zone of the person creating it (the dashboard sends the one it
   * shows; through the API, the time zone in the creator's profile, and UTC
   * when no person creates it - an API key, a workflow), every week, the
   * first one at 09:00 there on the next Monday, and its next send worked
   * out from them. Without a next send the report worker never sent a
   * summary created through the API at all; the dashboard used to work it
   * out itself, and for a first summary dated in the past it set one in the
   * past, which the worker then caught up on with a summary a minute.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<WorkspaceNotificationSummary>,
  ): Promise<OnCreate<WorkspaceNotificationSummary>> {
    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    /*
     * A summary with no channel to post in, or nothing to include, could
     * never be sent: refused, as the report worker would only skip it
     * (WorkspaceSummarySetup). Channel names typed as one text are saved
     * as the list they name. A Lookback Period that is not 1 to 365 whole
     * days is refused in the field's words; text spelling one is saved as
     * the number.
     */
    const setupProblem: string | null =
      WorkspaceSummarySetup.normalizeWrite(data);

    if (setupProblem) {
      throw new BadDataException(setupProblem);
    }

    /*
     * The people and teams its owners condition names are the project's
     * own, as a notification rule's are (NotificationRuleConditionIds).
     */
    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;

    if (!createBy.props.isRoot && projectId) {
      await NotificationRuleConditionIds.checkFilters({
        projectId: projectId,
        filters: data["filters"],
      });
    }

    /*
     * A summary created without a Lookback Period - through the API; the
     * dashboard's form starts on 7 - covers the last 7 days, as the column
     * defaults to and as a weekly summary does. It was refused as
     * "numberOfDaysOfData is required".
     */
    if (data[LOOKBACK_DAYS_COLUMN] === undefined) {
      data[LOOKBACK_DAYS_COLUMN] = DEFAULT_LOOKBACK_DAYS;
    }

    const write: WorkspaceSummaryScheduleColumns = getScheduleColumns(data);

    const problem: string | null =
      WorkspaceSummaryScheduleUtil.getWriteProblem(write);

    if (problem) {
      throw new BadDataException(problem);
    }

    const creatorTimezone: Timezone | undefined =
      WorkspaceSummaryScheduleUtil.toTimezone(write.timezone)
        ? undefined
        : await this.getCreatorTimezone(createBy.props);

    applyScheduleWrite(
      data,
      WorkspaceSummaryScheduleUtil.getCreateWrite({
        write: write,
        timezone: creatorTimezone,
      }),
    );

    return { createBy: createBy, carryForward: null };
  }

  /*
   * The time zone in the profile of the person a write comes from, under
   * the name the dashboard offers for it - or nothing: an API key or a
   * workflow is no person, and a person may have none.
   */
  private async getCreatorTimezone(
    props: DatabaseCommonInteractionProps,
  ): Promise<Timezone | undefined> {
    if (!props.userId) {
      return undefined;
    }

    const user: User | null = await UserService.findOneById({
      id: props.userId,
      select: {
        timezone: true,
      },
      props: {
        isRoot: true,
      },
    });

    return WorkspaceSummaryScheduleUtil.toCurrentTimezone(user?.timezone);
  }

  /*
   * A summary rescheduled - how often, the first summary's date or the time
   * zone really changed - or switched back on gets its next send worked out
   * again, on its time zone's clock (the dashboard's edit form sends the
   * schedule and the time zone back unchanged on every save, and that
   * changes nothing). It used to keep the next send it had: a new first
   * summary date did nothing, a new interval waited for the old one's send,
   * and a summary switched back on after a month sent at once for the month
   * it was off.
   *
   * An update of one summary - every update from the dashboard or the API
   * by id - carries its next send in the same write. One that matched
   * several summaries needing different ones writes each one's after the
   * update (onUpdateSuccess), as one write cannot hold them all.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<WorkspaceNotificationSummary>,
  ): Promise<OnUpdate<WorkspaceNotificationSummary>> {
    const data: Record<string, unknown> = updateBy.data as Record<
      string,
      unknown
    >;

    /*
     * As on create: channels and items it writes are never left empty, and
     * a Lookback Period it writes is 1 to 365 whole days.
     */
    const setupProblem: string | null =
      WorkspaceSummarySetup.normalizeWrite(data);

    if (setupProblem) {
      throw new BadDataException(setupProblem);
    }

    /*
     * Conditions written again: the people and teams they name now are the
     * project's own, but for those each summary named already
     * (NotificationRuleConditionIds).
     */
    if (
      !updateBy.props.isRoot &&
      NotificationRuleConditionIds.namesCheckedIds(data["filters"])
    ) {
      const summariesWritten: Array<WorkspaceNotificationSummary> =
        await this.findRowsAndHoldUpdateToThem(updateBy, {
          projectId: true,
          filters: true,
        });

      for (const summary of summariesWritten) {
        if (!summary.projectId) {
          continue;
        }

        await NotificationRuleConditionIds.checkFilters({
          projectId: summary.projectId,
          filters: data["filters"],
          keptIds: NotificationRuleConditionIds.getIdsNamed(summary.filters),
        });
      }
    }

    const write: WorkspaceSummaryScheduleColumns = getScheduleColumns(data);

    if (!WorkspaceSummaryScheduleUtil.isRescheduleWrite(write)) {
      return { updateBy: updateBy, carryForward: null };
    }

    const problem: string | null =
      WorkspaceSummaryScheduleUtil.getWriteProblem(write);

    if (problem) {
      throw new BadDataException(problem);
    }

    if (write.nextSendAt !== undefined) {
      return { updateBy: updateBy, carryForward: null };
    }

    const summaries: Array<WorkspaceNotificationSummary> =
      await this.findRowsAndHoldUpdateToThem(updateBy, {
        _id: true,
        recurringInterval: true,
        sendFirstReportAt: true,
        nextSendAt: true,
        isEnabled: true,
        timezone: true,
      });

    const now: Date = OneUptimeDate.getCurrentDate();

    const nextSendWrites: Array<SummaryNextSendWrite> = [];

    for (const summary of summaries) {
      const scheduleWrite: WorkspaceSummaryScheduleWrite =
        WorkspaceSummaryScheduleUtil.getUpdateWrite({
          write: write,
          stored: getScheduleColumns(
            summary as unknown as Record<string, unknown>,
          ),
          now: now,
        });

      if (scheduleWrite.nextSendAt && summary.id) {
        nextSendWrites.push({
          summaryId: summary.id,
          nextSendAt: scheduleWrite.nextSendAt,
        });
      }
    }

    const first: SummaryNextSendWrite | undefined = nextSendWrites[0];

    if (!first) {
      return { updateBy: updateBy, carryForward: null };
    }

    const isSameForEverySummary: boolean =
      nextSendWrites.length === summaries.length &&
      nextSendWrites.every((entry: SummaryNextSendWrite): boolean => {
        return entry.nextSendAt.getTime() === first.nextSendAt.getTime();
      });

    if (isSameForEverySummary) {
      data["nextSendAt"] = first.nextSendAt;
      return { updateBy: updateBy, carryForward: null };
    }

    const carryForward: SummaryUpdateCarryForward = {
      nextSendWrites: nextSendWrites,
    };

    return { updateBy: updateBy, carryForward: carryForward };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<WorkspaceNotificationSummary>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<WorkspaceNotificationSummary>> {
    const carryForward: SummaryUpdateCarryForward | null =
      onUpdate.carryForward as SummaryUpdateCarryForward | null;

    if (!carryForward?.nextSendWrites?.length) {
      return onUpdate;
    }

    const updatedIds: Set<string> = new Set<string>(
      updatedItemIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    /*
     * Each summary's own next send, for an update that matched several
     * needing different ones. Only for the summaries the update wrote, and
     * without the hooks: the values are worked out already.
     */
    for (const entry of carryForward.nextSendWrites) {
      if (!updatedIds.has(entry.summaryId.toString())) {
        continue;
      }

      await this.updateOneById({
        id: entry.summaryId,
        data: {
          nextSendAt: entry.nextSendAt,
        } as PartialEntity<WorkspaceNotificationSummary>,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    }

    return onUpdate;
  }

  /*
   * Gives every summary made before summaries had a time zone one: its
   * creator's, as the dashboard read the time its creator picked on that
   * clock - so a summary set for 09:00 in Berlin goes out at 09:00 there
   * after the clocks change, as it was meant to. A summary with no creator
   * (an API key or a workflow made it), or whose creator has no time zone,
   * gets UTC: what it has been read in all along.
   *
   * Only the time zone is written, and without the update hooks: no next
   * send moves, so no summary goes out early, late or twice because of it.
   * The report worker counts each one's sends on its new clock from its
   * next send on (WorkspaceSummaryScheduleUtil.getNextSendAfterDue).
   *
   * Safe to run twice at once, as the data migration runner requires: a
   * summary is only written while it still has no time zone, so a time zone
   * someone picked in the meantime is kept.
   */
  @CaptureSpan()
  public async fillTimezonesFromCreators(): Promise<WorkspaceSummaryTimezoneBackfillResult> {
    const result: WorkspaceSummaryTimezoneBackfillResult = {
      fromCreator: 0,
      utc: 0,
    };

    const seenSummaryIds: Set<string> = new Set<string>();

    for (;;) {
      const summaries: Array<WorkspaceNotificationSummary> = await this.findBy({
        query: {
          timezone: QueryHelper.isNull(),
        },
        select: {
          _id: true,
          createdByUserId: true,
        },
        skip: 0,
        limit: TIMEZONE_BACKFILL_BATCH_SIZE,
        props: {
          isRoot: true,
        },
      });

      const unseen: Array<WorkspaceNotificationSummary> = summaries.filter(
        (summary: WorkspaceNotificationSummary): boolean => {
          return (
            Boolean(summary.id) && !seenSummaryIds.has(summary.id!.toString())
          );
        },
      );

      // Nothing left - or nothing this pass could write: never loop on it.
      if (unseen.length === 0) {
        break;
      }

      const creatorTimezones: Map<string, Timezone> =
        await this.getTimezonesOfUsers(
          unseen
            .map((summary: WorkspaceNotificationSummary): string => {
              return summary.createdByUserId?.toString() || "";
            })
            .filter((userId: string): boolean => {
              return Boolean(userId);
            }),
        );

      for (const summary of unseen) {
        seenSummaryIds.add(summary.id!.toString());

        const creatorTimezone: Timezone | undefined = creatorTimezones.get(
          summary.createdByUserId?.toString() || "",
        );

        const updated: number = await this.updateOneBy({
          query: {
            _id: summary.id!.toString(),
            timezone: QueryHelper.isNull(),
          },
          data: {
            timezone:
              creatorTimezone || WorkspaceSummaryScheduleUtil.DEFAULT_TIMEZONE,
          } as PartialEntity<WorkspaceNotificationSummary>,
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });

        if (updated <= 0) {
          continue;
        }

        if (creatorTimezone) {
          result.fromCreator++;
        } else {
          result.utc++;
        }
      }
    }

    return result;
  }

  // Each user's time zone, under the name the dashboard offers for it, by user id.
  private async getTimezonesOfUsers(
    userIds: Array<string>,
  ): Promise<Map<string, Timezone>> {
    const timezones: Map<string, Timezone> = new Map<string, Timezone>();
    const uniqueUserIds: Array<string> = Array.from(new Set(userIds));

    if (uniqueUserIds.length === 0) {
      return timezones;
    }

    const users: Array<User> = await UserService.findBy({
      query: {
        _id: QueryHelper.any(uniqueUserIds),
      },
      select: {
        _id: true,
        timezone: true,
      },
      skip: 0,
      limit: uniqueUserIds.length,
      props: {
        isRoot: true,
      },
    });

    for (const user of users) {
      const timezone: Timezone | undefined =
        WorkspaceSummaryScheduleUtil.toCurrentTimezone(user.timezone);

      if (user.id && timezone) {
        timezones.set(user.id.toString(), timezone);
      }
    }

    return timezones;
  }

  /*
   * Send Test Now: the summary, posted in its channels right away. It
   * fails when a channel did not get it, saying which and why
   * (getTestNotPostedMessage), so the dialog never says a summary was sent
   * that a channel never got. Its Notification Logs name who sent it.
   */
  @CaptureSpan()
  public async testSummary(data: {
    summaryId: ObjectID;
    projectId: ObjectID;
    testByUserId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    await this.sendSummary({
      summaryId: data.summaryId,
      isTest: true,
      testByUserId: data.testByUserId,
    });
  }

  /*
   * Posts a summary in each channel it names, and writes one Notification
   * Log per channel by what happened to it there: Success, or Error with
   * the workspace's own words - a channel not found, a private one the bot
   * is not in, a team the bot left, a project not connected.
   *
   * Each channel is posted in on its own (postSummaryInChannel), so what
   * the workspace answers is that channel's: a channel is not matched to
   * an answer by its name, which each workspace writes its own way (Slack
   * without its #, Mattermost by its handle, Microsoft Teams as its team
   * shows it), and a failure of a whole message - which names only its
   * first channel (WorkspaceUtil.describePayloadDestination) - is the one
   * channel's it was.
   *
   * A test (Send Test Now) fails when any channel did not get it. A
   * scheduled send does not: see the end.
   */
  @CaptureSpan()
  public async sendSummary(data: {
    summaryId: ObjectID;
    isTest?: boolean;
    // Who sent a test, for its Notification Logs.
    testByUserId?: ObjectID | undefined;
  }): Promise<void> {
    const summary: WorkspaceNotificationSummary | null = await this.findOneById(
      {
        id: data.summaryId,
        select: {
          projectId: true,
          name: true,
          workspaceType: true,
          summaryType: true,
          recurringInterval: true,
          numberOfDaysOfData: true,
          channelNames: true,
          teamName: true,
          summaryItems: true,
          filters: true,
          filterCondition: true,
          timezone: true,
        },
        props: {
          isRoot: true,
        },
      },
    );

    if (!summary) {
      throw new BadDataException("Summary not found");
    }

    /*
     * Its channels as a list, however they were stored: the text the
     * dashboard's edit form once saved them as was posted in letter by
     * letter.
     */
    const channelNames: Array<string> = Service.getChannelNamesToPostIn({
      workspaceType: summary.workspaceType,
      channelNames: WorkspaceSummarySetup.readChannelNames(
        summary.channelNames,
      ),
    });

    /*
     * A summary that cannot be sent as it is set up - no project, no
     * channel, nothing to include - is not sent, and is said to be so: a
     * scheduled send leaves an Error row in its Notification Logs, and
     * the report worker, seeing this exception, leaves its next send moved
     * on rather than trying it again every minute (#7116).
     */
    const setupProblem: string | null = WorkspaceSummarySetup.getSendProblem({
      hasProject: Boolean(summary.projectId),
      channelNames: channelNames,
      summaryItems: WorkspaceSummarySetup.readSummaryItems(
        summary.summaryItems,
      ),
    });

    if (setupProblem) {
      if (!data.isTest) {
        await this.logSummaryNotSendable({
          summaryId: data.summaryId,
          summary: summary,
          reason: setupProblem,
        });
      }

      throw new WorkspaceSummaryNotSendableException(setupProblem);
    }

    const messageBlocks: Array<WorkspaceMessageBlock> =
      await this.buildSummaryMessageBlocks({ summary });

    const results: Array<WorkspaceSummaryChannelResult> = [];

    /*
     * What was thrown while a channel was posted in: not the workspace,
     * whose failures it answers, but what is read before it is asked (the
     * project's connection, whether the project is blocked) - the
     * database. That channel's failure, said in its Notification Log; the
     * channels after it are still posted in.
     */
    const thrownErrors: Array<unknown> = [];

    /*
     * The team its channels are in: a Mattermost team's id, as the form
     * saves it, or the id of the Microsoft Teams team its Team Name names
     * (getMicrosoftTeamsTeamOfSummary) - looked up once for all of its
     * channels. A lookup that threw (the database) is each channel's
     * failure, as a channel's send that threw is.
     */
    let teamOfChannels: MicrosoftTeamsTeamOfSummary = {
      teamId: summary.teamName || undefined,
    };

    if (summary.workspaceType === WorkspaceType.MicrosoftTeams) {
      try {
        teamOfChannels = await this.getMicrosoftTeamsTeamOfSummary(summary);
      } catch (err) {
        logger.error(
          `Could not find the Microsoft Teams team of the workspace summary ${data.summaryId.toString()}.`,
        );
        logger.error(err);

        thrownErrors.push(err);

        teamOfChannels = {
          notPostedReason: WorkspaceBase.getSendErrorMessage(err),
        };
      }
    }

    for (const channelName of channelNames) {
      if (teamOfChannels.notPostedReason) {
        results.push({
          channelName: channelName,
          isPosted: false,
          reason: teamOfChannels.notPostedReason,
        });

        continue;
      }

      try {
        results.push(
          await this.postSummaryInChannel({
            summary: summary,
            channelName: channelName,
            messageBlocks: messageBlocks,
            teamId: teamOfChannels.teamId,
          }),
        );
      } catch (err) {
        logger.error(
          `Could not post a workspace summary in the channel ${channelName}.`,
        );
        logger.error(err);

        thrownErrors.push(err);

        results.push({
          channelName: channelName,
          isPosted: false,
          reason: WorkspaceBase.getSendErrorMessage(err),
        });
      }
    }

    for (const result of results) {
      await this.logSummaryInChannel({
        summary: summary,
        result: result,
        isTest: Boolean(data.isTest),
        testByUserId: data.testByUserId,
      });
    }

    const isPostedSomewhere: boolean = results.some(
      (result: WorkspaceSummaryChannelResult): boolean => {
        return result.isPosted;
      },
    );

    if (data.isTest) {
      if (
        results.some((result: WorkspaceSummaryChannelResult): boolean => {
          return !result.isPosted;
        })
      ) {
        throw new WorkspaceSummaryTestNotPostedException({
          message: Service.getTestNotPostedMessage(results),
          channels: Service.getTestChannels(results),
        });
      }

      return;
    }

    /*
     * A scheduled send that a channel did not get does not fail: the
     * report worker moved its next send on before it sent it, and a send
     * that throws is put back to be sent again a minute later - which
     * would post the summary again in every channel that did get it, each
     * minute, until the broken one is fixed. The channel's Notification
     * Log says what went wrong, and the summary is posted again at its
     * next time.
     *
     * lastSentAt ("Last Sent") is when the summary last reached a channel:
     * it moves when at least one channel got it, and stays as it was when
     * none did, so the summaries list never says a summary went out that
     * no one got.
     *
     * A send that reached no channel because something threw - the
     * database, for a moment - throws, as every send that threw did: the
     * worker sends it again a minute later, and no channel gets it twice.
     */
    if (!isPostedSomewhere) {
      if (thrownErrors.length > 0) {
        throw thrownErrors[0];
      }

      return;
    }

    await this.updateOneById({
      id: data.summaryId,
      data: {
        lastSentAt: OneUptimeDate.getCurrentDate(),
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Posts the summary in one of its channels, as the project's bot, and
   * says what became of it there. Throws what is thrown before the
   * workspace is asked (sendSummary says it as that channel's failure).
   */
  private async postSummaryInChannel(data: {
    summary: WorkspaceNotificationSummary;
    channelName: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
    /*
     * The team its channels are in: a Microsoft Teams team's id, or a
     * Mattermost team's id. Mattermost looks for the channels only in
     * the team named, and for none in the default team first, then in
     * the bot's other teams; a team that is not a Mattermost id names
     * none (MattermostUtil.findChannelByName).
     */
    teamId: string | undefined;
  }): Promise<WorkspaceSummaryChannelResult> {
    const messagePayload: WorkspaceMessagePayload = {
      _type: "WorkspaceMessagePayload",
      channelNames: [data.channelName],
      channelIds: [],
      messageBlocks: data.messageBlocks,
      workspaceType: data.summary.workspaceType!,
      teamId: data.teamId,
    };

    const responses: Array<WorkspaceSendMessageResponse> =
      await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
        projectId: data.summary.projectId!,
        messagePayloadsByWorkspace: [messagePayload],
      });

    return Service.getChannelResult({
      channelName: data.channelName,
      workspaceType: data.summary.workspaceType!,
      responses: responses,
    });
  }

  /*
   * The Microsoft Teams team a summary's channels are in. Its Team Name is
   * typed as the form asks for it - the team's name, "Engineering Team" -
   * while Microsoft Graph finds a team's channels by the team's id: the
   * name is looked up among the teams of the project's connection
   * (availableTeams, getMicrosoftTeamsTeamsNamed), whatever its case, and,
   * when none is named so, among the teams read again from Graph - a team
   * made since they were read. An id is taken as it is. Left empty, the
   * team is the one the connection was saved with, if any, or its only
   * team.
   *
   * Not looked up for a project that is blocked, not connected, or whose
   * connection cannot post: each channel then says so, as WorkspaceUtil
   * says it, and Graph is not asked.
   */
  private async getMicrosoftTeamsTeamOfSummary(
    summary: WorkspaceNotificationSummary,
  ): Promise<MicrosoftTeamsTeamOfSummary> {
    const teamName: string = (summary.teamName || "").trim();
    const projectId: ObjectID = summary.projectId!;

    // Nor for a sample project (issue #6808), which posts nothing.
    if (
      await BlockedProjectNotifications.getSilencedReason({
        channel: "Workspace message",
        projectId: projectId,
      })
    ) {
      return { teamId: teamName || undefined };
    }

    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    if (!projectAuth || !projectAuth.authToken) {
      return { teamId: teamName || undefined };
    }

    const miscData: MicrosoftTeamsMiscData = (projectAuth.miscData ||
      {}) as MicrosoftTeamsMiscData;

    let teams: Array<MicrosoftTeamsTeam> = Object.values(
      miscData.availableTeams || {},
    );

    if (!teamName) {
      const connectionTeamId: string =
        typeof miscData.teamId === "string" ? miscData.teamId.trim() : "";

      if (connectionTeamId) {
        return { teamId: connectionTeamId };
      }

      const onlyTeam: MicrosoftTeamsTeam | undefined =
        teams.length === 1 ? teams[0] : undefined;

      if (onlyTeam?.id) {
        return { teamId: onlyTeam.id };
      }

      return {
        notPostedReason:
          "This summary does not name the Microsoft Teams team its channels are in. Please enter the team's name in the summary's Team Name.",
      };
    }

    let named: Array<MicrosoftTeamsTeam> = Service.getMicrosoftTeamsTeamsNamed({
      teamName: teamName,
      teams: teams,
    });

    if (named.length === 0) {
      try {
        teams = Object.values(
          await MicrosoftTeamsUtil.refreshTeams({ projectId: projectId }),
        );
      } catch (err) {
        logger.error(
          `Could not read the Microsoft Teams teams of project ${projectId.toString()} to find the team of a workspace summary.`,
        );
        logger.error(err);

        if (MICROSOFT_TEAMS_TEAM_ID.test(teamName)) {
          return { teamId: teamName };
        }

        return {
          notPostedReason: `The teams of this project's Microsoft Teams connection could not be read to find the team "${teamName}". ${Service.asSentences([WorkspaceBase.getSendErrorMessage(err)])}`,
        };
      }

      named = Service.getMicrosoftTeamsTeamsNamed({
        teamName: teamName,
        teams: teams,
      });
    }

    if (named.length === 1) {
      return { teamId: named[0]!.id };
    }

    if (named.length > 1) {
      return {
        notPostedReason: `${named.length} Microsoft Teams teams are named "${teamName}". Please enter the id of the one to post in as the summary's Team Name: the groupId in the link to the team.`,
      };
    }

    /*
     * An id Graph did not list - its list ends at the last page read
     * (MICROSOFT_TEAMS_MAX_PAGES): Graph answers for it.
     */
    if (MICROSOFT_TEAMS_TEAM_ID.test(teamName)) {
      return { teamId: teamName };
    }

    return {
      notPostedReason: `The Microsoft Teams team "${teamName}" was not found. Please enter the team's name, as Microsoft Teams shows it, in the summary's Team Name.`,
    };
  }

  /*
   * The teams a summary's Team Name names, among a connection's: the team
   * of that id, or else each of that name - whatever its case, and the
   * spaces around it. Two or more when Microsoft Teams teams share it.
   */
  public static getMicrosoftTeamsTeamsNamed(data: {
    teamName: string;
    teams: Array<MicrosoftTeamsTeam>;
  }): Array<MicrosoftTeamsTeam> {
    const typed: string = (data.teamName || "").trim().toLowerCase();

    if (!typed) {
      return [];
    }

    const teams: Array<MicrosoftTeamsTeam> = (data.teams || []).filter(
      (team: MicrosoftTeamsTeam): boolean => {
        return Boolean(team && typeof team.id === "string" && team.id);
      },
    );

    const ofId: MicrosoftTeamsTeam | undefined = teams.find(
      (team: MicrosoftTeamsTeam): boolean => {
        return team.id.toLowerCase() === typed;
      },
    );

    if (ofId) {
      return [ofId];
    }

    return teams.filter((team: MicrosoftTeamsTeam): boolean => {
      return (
        typeof team.name === "string" &&
        team.name.trim().toLowerCase() === typed
      );
    });
  }

  /*
   * The Notification Log of the summary in one of its channels. Written
   * best-effort: a log that cannot be written never turns a summary that
   * was posted into one that failed.
   */
  private async logSummaryInChannel(data: {
    summary: WorkspaceNotificationSummary;
    result: WorkspaceSummaryChannelResult;
    isTest: boolean;
    testByUserId?: ObjectID | undefined;
  }): Promise<void> {
    const summaryLabel: string = `${data.summary.summaryType || ""} summary "${data.summary.name || "Untitled"}"`;
    const channelName: string = data.result.channelName;

    try {
      await WorkspaceNotificationLogService.createWorkspaceLog(
        {
          projectId: data.summary.projectId!,
          workspaceType: data.summary.workspaceType!,
          // Column limits: an over-long value fails the whole insert.
          channelName: channelName.substring(0, ColumnLength.ShortText),
          channelId: data.result.channelId?.substring(
            0,
            ColumnLength.ShortText,
          ),
          threadId: data.result.threadId?.substring(0, ColumnLength.ShortText),
          actionType: WorkspaceNotificationActionType.SendMessage,
          status: data.result.isPosted
            ? WorkspaceNotificationStatus.Success
            : WorkspaceNotificationStatus.Error,
          statusMessage: data.result.isPosted
            ? data.isTest
              ? "Test summary sent successfully"
              : "Summary sent successfully"
            : (data.result.reason || SEND_FAILED_REASON).substring(
                0,
                ColumnLength.LongText,
              ),
          message: data.result.isPosted
            ? `${summaryLabel} sent to channel "${channelName}"`
            : `Failed to send ${summaryLabel} to channel "${channelName}"`,
          userId: data.isTest ? data.testByUserId : undefined,
        },
        { isRoot: true },
      );
    } catch (err) {
      logger.error(
        `Could not write the Notification Log of a workspace summary in the channel ${channelName}.`,
      );
      logger.error(err);
    }
  }

  /*
   * The Notification Log of a scheduled send of a summary that cannot be
   * sent as it is set up: one Error row, in no channel, saying why. The
   * project sees why its summary never arrives; the send itself still
   * fails (sendSummary). A summary with no project has nowhere to log.
   *
   * Its message is the one a channel's failure has, without the channel
   * (logSummaryInChannel): "Failed to send Incident summary "Weekly"", and
   * why is its status message, as a channel's reason is.
   */
  private async logSummaryNotSendable(data: {
    summaryId: ObjectID;
    summary: WorkspaceNotificationSummary;
    reason: string;
  }): Promise<void> {
    if (!data.summary.projectId) {
      return;
    }

    const summaryLabel: string = `${data.summary.summaryType || ""} summary "${data.summary.name || "Untitled"}"`;

    try {
      await WorkspaceNotificationLogService.createWorkspaceLog(
        {
          projectId: data.summary.projectId,
          workspaceType: data.summary.workspaceType!,
          actionType: WorkspaceNotificationActionType.SendMessage,
          status: WorkspaceNotificationStatus.Error,
          statusMessage: data.reason.substring(0, ColumnLength.LongText),
          message: `Failed to send ${summaryLabel}`,
        },
        { isRoot: true },
      );
    } catch (err) {
      logger.error(
        `Could not write the Notification Log of the workspace summary ${data.summaryId.toString()}, which cannot be sent as it is set up.`,
      );
      logger.error(err);
    }
  }

  /*
   * The channels a summary is posted in: each it names, once, in its
   * order, and none left empty. Two names the workspace reads as one
   * channel - "#ops" and "ops" in Slack, "~ops" and "ops" in Mattermost,
   * "Ops" and "ops" in any of them, as each looks a channel up whatever
   * its case - are one channel, posted in once, as the first is written.
   */
  public static getChannelNamesToPostIn(data: {
    workspaceType: WorkspaceType | undefined;
    channelNames: Array<string>;
  }): Array<string> {
    const keys: Set<string> = new Set<string>();
    const channelNames: Array<string> = [];

    for (const channelName of data.channelNames) {
      const name: string =
        typeof channelName === "string" ? channelName.trim() : "";

      if (!name) {
        continue;
      }

      let key: string = name;

      if (data.workspaceType === WorkspaceType.Slack) {
        key = key.replace(SLACK_CHANNEL_PREFIX, "");
      }

      if (data.workspaceType === WorkspaceType.Mattermost) {
        key = key.replace(MATTERMOST_CHANNEL_PREFIX, "");
      }

      key = key.toLowerCase();

      if (keys.has(key)) {
        continue;
      }

      keys.add(key);
      channelNames.push(name);
    }

    return channelNames;
  }

  /*
   * What became of the summary in a channel, from what the workspace
   * answered for that channel alone: its errors, when it gave any - in its
   * own words; the message it posted, when it gave one back; else why
   * nothing was sent (notSentReason: a project not connected, or blocked),
   * or, when it said nothing at all, the channel not found.
   */
  public static getChannelResult(data: {
    channelName: string;
    workspaceType: WorkspaceType;
    responses: Array<WorkspaceSendMessageResponse>;
  }): WorkspaceSummaryChannelResult {
    const errors: Array<{ channel: WorkspaceChannel; error: string }> = [];
    const threads: Array<WorkspaceThread> = [];
    let notSentReason: string | undefined = undefined;

    for (const response of data.responses) {
      errors.push(...(response.errors || []));
      threads.push(...(response.threads || []));
      notSentReason = notSentReason || response.notSentReason || undefined;
    }

    if (errors.length > 0) {
      const channelId: string | undefined = errors
        .map((error: { channel: WorkspaceChannel; error: string }) => {
          return error.channel?.id || "";
        })
        .find((id: string): boolean => {
          return Boolean(id);
        });

      const reasons: Array<string> = errors.map(
        (error: { channel: WorkspaceChannel; error: string }): string => {
          return (error.error || "").trim() || SEND_FAILED_REASON;
        },
      );

      return {
        channelName: data.channelName,
        isPosted: false,
        channelId: channelId,
        // One reason as the workspace wrote it; several, a sentence each.
        reason:
          reasons.length === 1 ? reasons[0]! : Service.asSentences(reasons),
      };
    }

    const thread: WorkspaceThread | undefined = threads[0];

    if (thread) {
      return {
        channelName: data.channelName,
        isPosted: true,
        channelId: thread.channel?.id || undefined,
        threadId: thread.threadId || undefined,
      };
    }

    return {
      channelName: data.channelName,
      isPosted: false,
      reason:
        notSentReason ||
        Service.getChannelNotPostedReason({
          workspaceType: data.workspaceType,
          channelName: data.channelName,
        }),
    };
  }

  /*
   * Why the summary was not posted in a channel its workspace said nothing
   * of. Each workspace now says when it cannot find a channel - Slack too,
   * in the words this gives back (WorkspaceChannelNotFound, #7115), which
   * the summary then reports once, as the channel's own reason - so a Slack
   * channel that drew no answer at all is still taken for one Slack could
   * not find.
   */
  public static getChannelNotPostedReason(data: {
    workspaceType: WorkspaceType;
    channelName: string;
  }): string {
    if (data.workspaceType === WorkspaceType.Slack) {
      return WorkspaceChannelNotFound.getReason({
        workspaceType: WorkspaceType.Slack,
        channelName: data.channelName,
      });
    }

    const workspace: string = getWorkspaceTypeDisplayName(data.workspaceType);

    return `Nothing was posted in the ${workspace} channel ${data.channelName}, and ${workspace} did not say why.`;
  }

  /*
   * What Send Test Now answers when a channel did not get the test
   * summary: how many did not, and each with why - or, when every channel
   * failed for one reason (a project not connected), that reason once.
   */
  public static getTestNotPostedMessage(
    results: Array<WorkspaceSummaryChannelResult>,
  ): string {
    const notPosted: Array<WorkspaceSummaryChannelResult> = results.filter(
      (result: WorkspaceSummaryChannelResult): boolean => {
        return !result.isPosted;
      },
    );

    const reasonOf: (result: WorkspaceSummaryChannelResult) => string = (
      result: WorkspaceSummaryChannelResult,
    ): string => {
      return Service.asSentences([result.reason || SEND_FAILED_REASON]);
    };

    if (results.length === 1 && notPosted.length === 1) {
      return `The test summary was not posted in ${notPosted[0]!.channelName}. ${reasonOf(notPosted[0]!)}`;
    }

    const lead: string =
      notPosted.length === results.length
        ? `The test summary was not posted in any of its ${results.length} channels.`
        : `The test summary was not posted in ${notPosted.length} of its ${results.length} channels.`;

    const reasons: Array<string> = notPosted.map(reasonOf);

    const isOneReason: boolean =
      notPosted.length === results.length &&
      reasons.every((reason: string): boolean => {
        return reason === reasons[0];
      });

    if (isOneReason) {
      return `${lead} ${reasons[0]}`;
    }

    return `${lead} ${notPosted
      .map((result: WorkspaceSummaryChannelResult, index: number): string => {
        return `${result.channelName}: ${reasons[index]}`;
      })
      .join(" ")}`;
  }

  /*
   * What became of a test in each of its channels, in the summary's order,
   * as the test route answers it: posted, or not with why - never the
   * channel's or the message's id, which say nothing to the person testing.
   */
  public static getTestChannels(
    results: Array<WorkspaceSummaryChannelResult>,
  ): Array<WorkspaceSummaryTestChannel> {
    return results.map(
      (result: WorkspaceSummaryChannelResult): WorkspaceSummaryTestChannel => {
        if (result.isPosted) {
          return { channelName: result.channelName, isPosted: true };
        }

        return {
          channelName: result.channelName,
          isPosted: false,
          reason: (result.reason || "").trim() || SEND_FAILED_REASON,
        };
      },
    );
  }

  // Texts as sentences, one after another: each ends as a sentence does.
  private static asSentences(texts: Array<string>): string {
    return texts
      .map((text: string): string => {
        const trimmed: string = (text || "").trim() || SEND_FAILED_REASON;

        return SENTENCE_END.test(trimmed) ? trimmed : `${trimmed}.`;
      })
      .join(" ");
  }

  // ───────────────────────── helpers ─────────────────────────

  private static divider(): WorkspacePayloadDivider {
    return { _type: "WorkspacePayloadDivider" };
  }

  private static header(text: string): WorkspacePayloadHeader {
    return { _type: "WorkspacePayloadHeader", text };
  }

  private static md(text: MarkdownText): WorkspacePayloadMarkdown {
    return { _type: "WorkspacePayloadMarkdown", text: text.toString() };
  }

  // Bold: text placed as text, a MarkdownText as it is.
  private static bold(text: MarkdownValue): MarkdownText {
    return mdText`**${text}**`;
  }

  // A link whose words are text: a "]" in them cannot end them early.
  private static link(url: string, text: string): MarkdownText {
    return mdText`[${text}](${url})`;
  }

  /*
   * Resource names are text: a host or cluster name can come from an agent
   * rather than from someone typing it, and this text is markdown.
   */
  private static joinNames(names: Array<string>): MarkdownText {
    return FeedMarkdown.join(names);
  }

  private static formatDuration(totalMinutes: number): string {
    if (totalMinutes < 1) {
      return "< 1m";
    }
    const days: number = Math.floor(totalMinutes / 1440);
    const hours: number = Math.floor((totalMinutes % 1440) / 60);
    const mins: number = Math.round(totalMinutes % 60);

    const parts: Array<string> = [];
    if (days > 0) {
      parts.push(`${days}d`);
    }
    if (hours > 0) {
      parts.push(`${hours}h`);
    }
    if (mins > 0 || parts.length === 0) {
      parts.push(`${mins}m`);
    }
    return parts.join(" ");
  }

  /*
   * A day of the reporting period, as the summary's time zone reads it: a
   * summary that goes out at 09:00 on Monday in Sydney - Sunday in UTC -
   * covers the week up to Monday.
   */
  private static formatDate(
    date: Date,
    timezone?: Timezone | undefined,
  ): string {
    return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
      date: date,
      format: "MMM DD, YYYY",
      timezone: timezone || WorkspaceSummaryScheduleUtil.DEFAULT_TIMEZONE,
    });
  }

  private static has(
    items: Array<WorkspaceNotificationSummaryItem>,
    item: WorkspaceNotificationSummaryItem,
  ): boolean {
    if (items.includes(WorkspaceNotificationSummaryItem.All)) {
      return true;
    }
    return items.includes(item);
  }

  /*
   * Whether an incident (or incident episode) in a state of the project is
   * resolved - by the one rule (Common/Utils/ResolvedState): the project's
   * resolved state, or a state placed after it - and whether it is
   * acknowledged - by the one rule (Common/Utils/AcknowledgedState): the
   * project's acknowledged state, a state placed after it ("Investigating"),
   * or a resolved one. One read of its states.
   */
  private static async getIncidentStateRules(
    projectId: ObjectID,
  ): Promise<SummaryStateRules> {
    const states: Array<unknown> =
      await IncidentStateService.getAllIncidentStates({
        projectId: projectId,
        props: { isRoot: true },
      });

    return Service.toStateRules(StateListType.IncidentState, states);
  }

  // The same for an alert (or alert episode), by the project's alert states.
  private static async getAlertStateRules(
    projectId: ObjectID,
  ): Promise<SummaryStateRules> {
    const states: Array<unknown> = await AlertStateService.getAllAlertStates({
      projectId: projectId,
      props: { isRoot: true },
    });

    return Service.toStateRules(StateListType.AlertState, states);
  }

  private static toStateRules(
    list: StateListType.IncidentState | StateListType.AlertState,
    states: Array<unknown>,
  ): SummaryStateRules {
    return {
      isResolved: (stateId: ObjectID | undefined): boolean => {
        return ResolvedStateUtil.isResolved({
          list: list,
          states: states,
          stateId: stateId,
        });
      },
      isAcknowledged: (stateId: ObjectID | undefined): boolean => {
        return AcknowledgedStateUtil.isAcknowledged({
          list: list,
          states: states,
          stateId: stateId,
        });
      },
    };
  }

  private static async getIncidentResolvedRule(
    projectId: ObjectID,
  ): Promise<(stateId: ObjectID | undefined) => boolean> {
    return (await Service.getIncidentStateRules(projectId)).isResolved;
  }

  private static async getAlertResolvedRule(
    projectId: ObjectID,
  ): Promise<(stateId: ObjectID | undefined) => boolean> {
    return (await Service.getAlertStateRules(projectId)).isResolved;
  }

  // Check if an item matches the summary's filter conditions
  private static matchesFilters(data: {
    filters: Array<NotificationRuleCondition> | undefined;
    filterCondition: FilterCondition | undefined;
    values: {
      [key in NotificationRuleConditionCheckOn]:
        | string
        | Array<string>
        | undefined;
    };
  }): boolean {
    if (!data.filters || data.filters.length === 0) {
      return true; // no filters = include everything
    }

    const rule: IncidentNotificationRule = {
      filters: data.filters,
      filterCondition: data.filterCondition || FilterCondition.Any,
    } as IncidentNotificationRule;

    return WorkspaceNotificationRuleUtil.isRuleMatching({
      notificationRule: rule,
      values: data.values,
    });
  }

  /*
   * The values an item's conditions are matched against: the item's own
   * fields, then `read` - what a summary's conditions check that was read
   * of the item elsewhere (filterItems). Every other field is undefined, so
   * a condition on another kind of item never matches it.
   */
  private static buildIncidentValues(
    incident: Incident,
    read?: Partial<NotificationRuleConditionValues>,
  ): NotificationRuleConditionValues {
    return NotificationRuleConditionUtil.getValues({
      [NotificationRuleConditionCheckOn.IncidentTitle]: incident.title || "",
      [NotificationRuleConditionCheckOn.IncidentDescription]:
        incident.description || "",
      [NotificationRuleConditionCheckOn.IncidentSeverity]:
        incident.incidentSeverity?._id?.toString() || "",
      [NotificationRuleConditionCheckOn.IncidentState]:
        incident.currentIncidentState?._id?.toString() || "",
      [NotificationRuleConditionCheckOn.IncidentLabels]:
        incident.labels?.map((l: Label) => {
          return l._id?.toString() || "";
        }) || [],
      [NotificationRuleConditionCheckOn.Monitors]:
        incident.monitors?.map((m: Monitor) => {
          return m._id?.toString() || "";
        }) || [],
      ...read,
    });
  }

  private static buildAlertValues(
    alert: Alert,
    read?: Partial<NotificationRuleConditionValues>,
  ): NotificationRuleConditionValues {
    return NotificationRuleConditionUtil.getValues({
      [NotificationRuleConditionCheckOn.AlertTitle]: alert.title || "",
      [NotificationRuleConditionCheckOn.AlertDescription]:
        alert.description || "",
      [NotificationRuleConditionCheckOn.AlertSeverity]:
        alert.alertSeverity?._id?.toString() || "",
      [NotificationRuleConditionCheckOn.AlertState]:
        alert.currentAlertState?._id?.toString() || "",
      [NotificationRuleConditionCheckOn.AlertLabels]:
        alert.labels?.map((l: Label) => {
          return l._id?.toString() || "";
        }) || [],
      [NotificationRuleConditionCheckOn.Monitors]: alert.monitor?._id
        ? [alert.monitor._id.toString()]
        : [],
      ...read,
    });
  }

  private static buildIncidentEpisodeValues(
    episode: IncidentEpisode,
    read?: Partial<NotificationRuleConditionValues>,
  ): NotificationRuleConditionValues {
    return NotificationRuleConditionUtil.getValues({
      [NotificationRuleConditionCheckOn.IncidentEpisodeTitle]:
        episode.title || "",
      [NotificationRuleConditionCheckOn.IncidentEpisodeDescription]:
        episode.description || "",
      [NotificationRuleConditionCheckOn.IncidentEpisodeSeverity]:
        episode.incidentSeverity?._id?.toString() || "",
      [NotificationRuleConditionCheckOn.IncidentEpisodeState]:
        episode.currentIncidentState?._id?.toString() || "",
      [NotificationRuleConditionCheckOn.IncidentEpisodeLabels]:
        episode.labels?.map((l: Label) => {
          return l._id?.toString() || "";
        }) || [],
      ...read,
    });
  }

  private static buildAlertEpisodeValues(
    episode: AlertEpisode,
    read?: Partial<NotificationRuleConditionValues>,
  ): NotificationRuleConditionValues {
    return NotificationRuleConditionUtil.getValues({
      [NotificationRuleConditionCheckOn.AlertEpisodeTitle]: episode.title || "",
      [NotificationRuleConditionCheckOn.AlertEpisodeDescription]:
        episode.description || "",
      [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]:
        episode.alertSeverity?._id?.toString() || "",
      [NotificationRuleConditionCheckOn.AlertEpisodeState]:
        episode.currentAlertState?._id?.toString() || "",
      [NotificationRuleConditionCheckOn.AlertEpisodeLabels]:
        episode.labels?.map((l: Label) => {
          return l._id?.toString() || "";
        }) || [],
      ...read,
    });
  }

  /*
   * The items a summary's conditions keep. What a condition checks beyond
   * an item's own fields is read only when one checks it, for all the items
   * at once, a few hundred a query:
   *
   * - the labels of the monitors an incident or alert is about (Monitor
   *   Labels). A summary offered the condition but never read them, so a
   *   summary with it listed nothing, or everything;
   * - who owns each item - its owner users and owner teams, as recorded
   *   (an owners condition, WorkspaceRecordOwners).
   */
  private static async filterItems<TItem extends BaseModel>(data: {
    items: Array<TItem>;
    filters: Array<NotificationRuleCondition> | undefined;
    filterCondition: FilterCondition | undefined;
    projectId: ObjectID;
    recordKey: OwnedRecordKey;
    ownerCheckOn: NotificationRuleConditionCheckOn;
    getMonitorIds?: ((item: TItem) => Array<string>) | undefined;
    buildValues: (
      item: TItem,
      read: Partial<NotificationRuleConditionValues>,
    ) => NotificationRuleConditionValues;
  }): Promise<Array<TItem>> {
    if (!data.filters || data.filters.length === 0) {
      return data.items;
    }

    const used: Set<NotificationRuleConditionCheckOn> =
      NotificationRuleConditionUtil.getCheckOnsUsed(data.filters);

    const owners: Map<string, Array<string>> | null = used.has(
      data.ownerCheckOn,
    )
      ? await WorkspaceRecordOwners.getOwnerIdsByRecord({
          recordKey: data.recordKey,
          recordIds: data.items
            .filter((item: TItem): boolean => {
              return Boolean(item._id);
            })
            .map((item: TItem): ObjectID => {
              return new ObjectID(item._id!.toString());
            }),
        })
      : null;

    const getMonitorIds: ((item: TItem) => Array<string>) | undefined =
      data.getMonitorIds;

    const monitorLabelIds: Map<string, Array<string>> | null =
      getMonitorIds && used.has(NotificationRuleConditionCheckOn.MonitorLabels)
        ? await Service.getLabelIdsOfMonitors({
            projectId: data.projectId,
            monitorIds: data.items.flatMap(getMonitorIds),
          })
        : null;

    return data.items.filter((item: TItem): boolean => {
      const read: Partial<NotificationRuleConditionValues> = {};

      if (owners) {
        read[data.ownerCheckOn] =
          owners.get(item._id?.toString().toLowerCase() || "") || [];
      }

      if (monitorLabelIds && getMonitorIds) {
        const labelIds: Set<string> = new Set();

        for (const monitorId of getMonitorIds(item)) {
          for (const labelId of monitorLabelIds.get(monitorId.toLowerCase()) ||
            []) {
            labelIds.add(labelId);
          }
        }

        read[NotificationRuleConditionCheckOn.MonitorLabels] =
          Array.from(labelIds);
      }

      return Service.matchesFilters({
        filters: data.filters,
        filterCondition: data.filterCondition,
        values: data.buildValues(item, read),
      });
    });
  }

  // The ids of each monitor's labels, by the monitor's id (lower case).
  private static async getLabelIdsOfMonitors(data: {
    projectId: ObjectID;
    monitorIds: Array<string>;
  }): Promise<Map<string, Array<string>>> {
    const labelIds: Map<string, Array<string>> = new Map();
    const monitorIds: Array<string> = Array.from(
      new Set(
        data.monitorIds
          .filter((monitorId: string): boolean => {
            return Boolean(monitorId);
          })
          .map((monitorId: string): string => {
            return monitorId.toLowerCase();
          }),
      ),
    );

    for (
      let start: number = 0;
      start < monitorIds.length;
      start += SUMMARY_READ_BATCH_SIZE
    ) {
      const monitors: Array<Monitor> = await MonitorService.findAllBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(
            monitorIds.slice(start, start + SUMMARY_READ_BATCH_SIZE),
          ),
        },
        select: {
          _id: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

      for (const monitor of monitors) {
        if (!monitor._id) {
          continue;
        }

        labelIds.set(
          monitor._id.toString().toLowerCase(),
          (monitor.labels || [])
            .map((label: Label): string => {
              return label._id?.toString() || "";
            })
            .filter((labelId: string): boolean => {
              return Boolean(labelId);
            }),
        );
      }
    }

    return labelIds;
  }

  // ───────────────────────── main builder ─────────────────────────

  @CaptureSpan()
  private async buildSummaryMessageBlocks(data: {
    summary: WorkspaceNotificationSummary;
  }): Promise<Array<WorkspaceMessageBlock>> {
    const { summary } = data;
    const blocks: Array<WorkspaceMessageBlock> = [];
    const items: Array<WorkspaceNotificationSummaryItem> =
      summary.summaryItems!;
    /*
     * The days it covers: a summary stored with less than a day - before
     * writes were checked - covers 7, never a window in the future.
     */
    const days: number = WorkspaceSummarySetup.getLookbackDays(
      summary.numberOfDaysOfData,
    );
    const type: WorkspaceNotificationSummaryType = summary.summaryType!;

    const fromDate: Date = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      -days,
    );

    const timezone: Timezone = WorkspaceSummaryScheduleUtil.getTimezone(
      summary.timezone,
    );

    const fromDateStr: string = Service.formatDate(fromDate, timezone);
    const toDateStr: string = Service.formatDate(
      OneUptimeDate.getCurrentDate(),
      timezone,
    );

    // Title
    blocks.push(
      Service.header(`${type} Summary — ${fromDateStr} to ${toDateStr}`),
    );

    blocks.push(
      Service.md(
        mdText`_Reporting period: ${Service.bold(String(days))} day${days !== 1 ? "s" : ""}_`,
      ),
    );

    blocks.push(Service.divider());

    // Build type-specific content
    if (
      type === WorkspaceNotificationSummaryType.Incident ||
      type === WorkspaceNotificationSummaryType.IncidentEpisode
    ) {
      await this.buildIncidentBlocks({
        blocks,
        items,
        type,
        fromDate,
        projectId: summary.projectId!,
        filters: summary.filters || undefined,
        filterCondition: summary.filterCondition || undefined,
        timezone: timezone,
      });
    } else {
      await this.buildAlertBlocks({
        blocks,
        items,
        type,
        fromDate,
        projectId: summary.projectId!,
        filters: summary.filters || undefined,
        filterCondition: summary.filterCondition || undefined,
        timezone: timezone,
      });
    }

    // Footer
    blocks.push(Service.divider());
    blocks.push(
      Service.md(mdText`_Sent by OneUptime  •  ${summary.name || "Untitled"}_`),
    );

    return blocks;
  }

  // ───────────────────────── Incidents ─────────────────────────

  @CaptureSpan()
  private async buildIncidentBlocks(data: {
    blocks: Array<WorkspaceMessageBlock>;
    items: Array<WorkspaceNotificationSummaryItem>;
    type: WorkspaceNotificationSummaryType;
    fromDate: Date;
    projectId: ObjectID;
    filters?: Array<NotificationRuleCondition> | undefined;
    filterCondition?: FilterCondition | undefined;
    // The summary's time zone: the dates in its list are read in it.
    timezone?: Timezone | undefined;
  }): Promise<void> {
    if (data.type === WorkspaceNotificationSummaryType.IncidentEpisode) {
      await this.buildIncidentEpisodeBlocks(data);
      return;
    }

    const { blocks, items, fromDate, projectId } = data;

    let incidents: Array<Incident> = await IncidentService.findAllBy({
      query: {
        projectId,
        createdAt: QueryHelper.greaterThanEqualTo(fromDate),
      },
      select: {
        _id: true,
        title: true,
        description: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        incidentSeverity: { name: true, _id: true },
        currentIncidentState: {
          name: true,
          _id: true,
        },
        currentIncidentStateId: true,
        labels: { _id: true, name: true },
        monitors: { name: true, _id: true },
        createdAt: true,
        declaredAt: true,
      },
      props: { isRoot: true },
    });

    // Apply filters
    incidents = await Service.filterItems({
      items: incidents,
      filters: data.filters,
      filterCondition: data.filterCondition,
      projectId: projectId,
      recordKey: "incidentId",
      ownerCheckOn: NotificationRuleConditionCheckOn.IncidentOwners,
      getMonitorIds: (incident: Incident): Array<string> => {
        return (incident.monitors || []).map((monitor: Monitor): string => {
          return monitor._id?.toString() || "";
        });
      },
      buildValues: Service.buildIncidentValues,
    });

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    /*
     * Resolved or open, by the one rule (Common/Utils/ResolvedState), and
     * acknowledged or not (Common/Utils/AcknowledgedState).
     */
    const incidentStateRules: SummaryStateRules =
      await Service.getIncidentStateRules(projectId);
    const isResolvedIncidentState: (stateId: ObjectID | undefined) => boolean =
      incidentStateRules.isResolved;

    // Overview stats
    if (Service.has(items, WorkspaceNotificationSummaryItem.TotalCount)) {
      const resolved: number = incidents.filter((i: Incident) => {
        return isResolvedIncidentState(i.currentIncidentStateId);
      }).length;
      const open: number = incidents.length - resolved;

      blocks.push(
        Service.md(
          mdText`${Service.bold("Total:")} ${incidents.length} incident${incidents.length !== 1 ? "s" : ""}  ·  ${Service.bold("Open:")} ${open}  ·  ${Service.bold("Resolved:")} ${resolved}`,
        ),
      );
    }

    // Severity breakdown
    if (
      Service.has(items, WorkspaceNotificationSummaryItem.SeverityBreakdown)
    ) {
      const map: Map<string, number> = new Map();
      for (const i of incidents) {
        const s: string = i.incidentSeverity?.name || "Unknown";
        map.set(s, (map.get(s) || 0) + 1);
      }
      if (map.size > 0) {
        const parts: Array<MarkdownText> = [];
        for (const [sev, count] of map) {
          parts.push(mdText`${sev}: ${Service.bold(String(count))}`);
        }
        blocks.push(
          Service.md(
            mdText`${Service.bold("By Severity:")}  ${FeedMarkdown.join(parts, "  ·  ")}`,
          ),
        );
      }
    }

    // State breakdown
    if (Service.has(items, WorkspaceNotificationSummaryItem.StateBreakdown)) {
      const map: Map<string, number> = new Map();
      for (const i of incidents) {
        const s: string = i.currentIncidentState?.name || "Unknown";
        map.set(s, (map.get(s) || 0) + 1);
      }
      if (map.size > 0) {
        const parts: Array<MarkdownText> = [];
        for (const [state, count] of map) {
          parts.push(mdText`${state}: ${Service.bold(String(count))}`);
        }
        blocks.push(
          Service.md(
            mdText`${Service.bold("By State:")}  ${FeedMarkdown.join(parts, "  ·  ")}`,
          ),
        );
      }
    }

    // Timeline data for MTTA/MTTR/who
    const needTimeline: boolean =
      Service.has(items, WorkspaceNotificationSummaryItem.WhoAcknowledged) ||
      Service.has(items, WorkspaceNotificationSummaryItem.WhoResolved) ||
      Service.has(items, WorkspaceNotificationSummaryItem.TimeToAcknowledge) ||
      Service.has(items, WorkspaceNotificationSummaryItem.TimeToResolve);

    const tlMap: Map<string, TimelineData> = new Map();

    if (needTimeline && incidents.length > 0) {
      const ids: Array<ObjectID> = incidents
        .filter((i: Incident) => {
          return i._id;
        })
        .map((i: Incident) => {
          return new ObjectID(i._id!.toString());
        });

      const timelines: Array<IncidentStateTimeline> =
        await IncidentStateTimelineService.findAllBy({
          query: {
            projectId,
            incidentId: QueryHelper.any(ids),
          },
          select: {
            incidentId: true,
            incidentStateId: true,
            createdByUser: { name: true, email: true },
            createdAt: true,
          },
          // The first resolve and acknowledgement come first.
          sort: { createdAt: SortOrder.Ascending },
          props: { isRoot: true },
        });

      for (const tl of timelines) {
        const id: string = tl.incidentId?.toString() || "";
        if (!tlMap.has(id)) {
          tlMap.set(id, {});
        }
        const td: TimelineData = tlMap.get(id)!;
        const userName: string =
          tl.createdByUser?.name?.toString() ||
          tl.createdByUser?.email?.toString() ||
          "System";

        /*
         * The first move into a state that counts as acknowledged - the
         * acknowledged state, one placed after it, or a resolved one - is
         * the acknowledgement, as on the incident's overview.
         */
        if (
          incidentStateRules.isAcknowledged(tl.incidentStateId) &&
          !td.ackAt
        ) {
          td.ackBy = userName;
          td.ackAt = tl.createdAt;
        }
        if (isResolvedIncidentState(tl.incidentStateId) && !td.resolvedAt) {
          td.resolvedBy = userName;
          td.resolvedAt = tl.createdAt;
        }
      }

      for (const inc of incidents) {
        const id: string = inc._id?.toString() || "";
        if (!tlMap.has(id)) {
          tlMap.set(id, {});
        }
        tlMap.get(id)!.declaredAt = inc.declaredAt || inc.createdAt;
      }
    }

    // MTTA
    if (
      Service.has(items, WorkspaceNotificationSummaryItem.TimeToAcknowledge)
    ) {
      const { avg, count } = this.computeAvg(tlMap, "ack");
      blocks.push(
        Service.md(
          count > 0
            ? mdText`${Service.bold("MTTA (Mean Time to Acknowledge):")}  ${Service.bold(Service.formatDuration(avg))}  _(${count} acknowledged)_`
            : mdText`${Service.bold("MTTA (Mean Time to Acknowledge):")}  _No incidents acknowledged_`,
        ),
      );
    }

    // MTTR
    if (Service.has(items, WorkspaceNotificationSummaryItem.TimeToResolve)) {
      const { avg, count } = this.computeAvg(tlMap, "resolve");
      blocks.push(
        Service.md(
          count > 0
            ? mdText`${Service.bold("MTTR (Mean Time to Resolve):")}  ${Service.bold(Service.formatDuration(avg))}  _(${count} resolved)_`
            : mdText`${Service.bold("MTTR (Mean Time to Resolve):")}  _No incidents resolved_`,
        ),
      );
    }

    // Resources affected
    if (
      Service.has(items, WorkspaceNotificationSummaryItem.ResourcesAffected)
    ) {
      // Every resource the period's incidents are linked to, not only monitors.
      const names: Array<string> = LinkedAffectedResources.getNames({
        resources: await LinkedAffectedResources.readForIncidents({
          service: IncidentService,
          projectId,
          incidentIds: incidents.map((inc: Incident): ObjectID => {
            return inc.id!;
          }),
        }),
      });
      if (names.length > 0) {
        blocks.push(
          Service.md(
            mdText`${Service.bold(`Resources Affected (${names.length}):`)}  ${Service.joinNames(names)}`,
          ),
        );
      }
    }

    // Detailed list
    if (Service.has(items, WorkspaceNotificationSummaryItem.ListWithLinks)) {
      blocks.push(Service.divider());

      if (incidents.length === 0) {
        blocks.push(
          Service.md(mdText`_No incidents reported in this period._`),
        );
        return;
      }

      for (const inc of incidents) {
        const id: string = inc._id?.toString() || "";
        const display: string =
          inc.incidentNumberWithPrefix || `#${inc.incidentNumber || ""}`;
        const linkUrl: string = URL.fromString(dashboardUrl.toString())
          .addRoute(`/${projectId.toString()}/incidents/${id}`)
          .toString();
        const td: TimelineData | undefined = tlMap.get(id);

        /*
         * Title line with link. The title - plain text, which anyone
         * holding an incident form's link may have typed - sits inside the
         * link's text, so it is escaped like the names in these summaries:
         * a "]" cannot end that text early and point the rest somewhere
         * else, and "![...](...)" is no image. (Escaping brackets alone is
         * not enough inside a link's text: marked, for one, undoes "\[" and
         * "\]" there before reading it.)
         */
        let text: MarkdownText = mdText`${Service.bold(Service.link(linkUrl, `${display} — ${inc.title || "Untitled"}`))}`;

        // Meta line
        const meta: Array<MarkdownText> = [];
        if (inc.incidentSeverity?.name) {
          meta.push(
            mdText`Severity: ${Service.bold(inc.incidentSeverity.name)}`,
          );
        }
        if (inc.currentIncidentState?.name) {
          meta.push(
            mdText`State: ${Service.bold(inc.currentIncidentState.name)}`,
          );
        }
        if (inc.declaredAt) {
          meta.push(
            mdText`Declared: ${Service.formatDate(inc.declaredAt, data.timezone)}`,
          );
        }
        if (meta.length > 0) {
          text = mdText`${text}\n${FeedMarkdown.join(meta, "  ·  ")}`;
        }

        // Ack & resolve line
        const ackResolve: Array<MarkdownText> = [];
        if (
          Service.has(items, WorkspaceNotificationSummaryItem.WhoAcknowledged)
        ) {
          if (td?.ackBy && td?.ackAt) {
            ackResolve.push(
              mdText`Ack: ${Service.bold(td.ackBy)} in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || inc.createdAt!, td.ackAt))}`,
            );
          } else if (td?.resolvedBy && td?.resolvedAt) {
            // If not explicitly acknowledged but resolved, ack time = resolve time
            ackResolve.push(
              mdText`Ack: ${Service.bold(td.resolvedBy)} in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || inc.createdAt!, td.resolvedAt))}`,
            );
          } else {
            ackResolve.push(mdText`_Not yet acknowledged_`);
          }
        }
        if (Service.has(items, WorkspaceNotificationSummaryItem.WhoResolved)) {
          if (td?.resolvedBy && td?.resolvedAt) {
            ackResolve.push(
              mdText`Resolved: ${Service.bold(td.resolvedBy)} in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || inc.createdAt!, td.resolvedAt))}`,
            );
          } else if (!isResolvedIncidentState(inc.currentIncidentStateId)) {
            ackResolve.push(mdText`_Not yet resolved_`);
          }
        }
        if (ackResolve.length > 0) {
          text = mdText`${text}\n${FeedMarkdown.join(ackResolve, "  ·  ")}`;
        }

        blocks.push(Service.md(text));
      }
    }
  }

  // ───────────────────────── Incident Episodes ─────────────────────────

  @CaptureSpan()
  private async buildIncidentEpisodeBlocks(data: {
    blocks: Array<WorkspaceMessageBlock>;
    items: Array<WorkspaceNotificationSummaryItem>;
    fromDate: Date;
    projectId: ObjectID;
    filters?: Array<NotificationRuleCondition> | undefined;
    filterCondition?: FilterCondition | undefined;
    // The summary's time zone: the dates in its list are read in it.
    timezone?: Timezone | undefined;
  }): Promise<void> {
    const { blocks, items, fromDate, projectId } = data;

    let episodes: Array<IncidentEpisode> =
      await IncidentEpisodeService.findAllBy({
        query: {
          projectId,
          createdAt: QueryHelper.greaterThanEqualTo(fromDate),
        },
        select: {
          _id: true,
          title: true,
          description: true,
          incidentSeverity: { name: true, _id: true },
          currentIncidentState: {
            name: true,
            _id: true,
          },
          currentIncidentStateId: true,
          labels: { _id: true, name: true },
          createdAt: true,
          resolvedAt: true,
        },
        props: { isRoot: true },
      });

    // Apply filters
    episodes = await Service.filterItems({
      items: episodes,
      filters: data.filters,
      filterCondition: data.filterCondition,
      projectId: projectId,
      recordKey: "incidentEpisodeId",
      ownerCheckOn: NotificationRuleConditionCheckOn.IncidentEpisodeOwners,
      buildValues: Service.buildIncidentEpisodeValues,
    });

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    if (Service.has(items, WorkspaceNotificationSummaryItem.TotalCount)) {
      // Resolved or open, by the one rule (Common/Utils/ResolvedState).
      const isResolvedIncidentState: (
        stateId: ObjectID | undefined,
      ) => boolean = await Service.getIncidentResolvedRule(projectId);

      const resolved: number = episodes.filter((e: IncidentEpisode) => {
        return isResolvedIncidentState(e.currentIncidentStateId);
      }).length;
      blocks.push(
        Service.md(
          mdText`${Service.bold("Total:")} ${episodes.length} episode${episodes.length !== 1 ? "s" : ""}  ·  ${Service.bold("Open:")} ${episodes.length - resolved}  ·  ${Service.bold("Resolved:")} ${resolved}`,
        ),
      );
    }

    if (
      Service.has(items, WorkspaceNotificationSummaryItem.SeverityBreakdown)
    ) {
      const map: Map<string, number> = new Map();
      for (const e of episodes) {
        const s: string = e.incidentSeverity?.name || "Unknown";
        map.set(s, (map.get(s) || 0) + 1);
      }
      if (map.size > 0) {
        const parts: Array<MarkdownText> = [];
        for (const [sev, c] of map) {
          parts.push(mdText`${sev}: ${Service.bold(String(c))}`);
        }
        blocks.push(
          Service.md(
            mdText`${Service.bold("By Severity:")}  ${FeedMarkdown.join(parts, "  ·  ")}`,
          ),
        );
      }
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.StateBreakdown)) {
      const map: Map<string, number> = new Map();
      for (const e of episodes) {
        const s: string = e.currentIncidentState?.name || "Unknown";
        map.set(s, (map.get(s) || 0) + 1);
      }
      if (map.size > 0) {
        const parts: Array<MarkdownText> = [];
        for (const [state, c] of map) {
          parts.push(mdText`${state}: ${Service.bold(String(c))}`);
        }
        blocks.push(
          Service.md(
            mdText`${Service.bold("By State:")}  ${FeedMarkdown.join(parts, "  ·  ")}`,
          ),
        );
      }
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.TimeToResolve)) {
      let total: number = 0;
      let count: number = 0;
      for (const e of episodes) {
        if (e.resolvedAt && e.createdAt) {
          total += OneUptimeDate.getMinutesBetweenTwoDates(
            e.createdAt,
            e.resolvedAt,
          );
          count++;
        }
      }
      blocks.push(
        Service.md(
          count > 0
            ? mdText`${Service.bold("MTTR (Mean Time to Resolve):")}  ${Service.bold(Service.formatDuration(Math.round(total / count)))}  _(${count} resolved)_`
            : mdText`${Service.bold("MTTR (Mean Time to Resolve):")}  _No episodes resolved_`,
        ),
      );
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.ListWithLinks)) {
      blocks.push(Service.divider());

      if (episodes.length === 0) {
        blocks.push(Service.md(mdText`_No incident episodes in this period._`));
        return;
      }

      for (const ep of episodes) {
        const id: string = ep._id?.toString() || "";
        const linkUrl: string = URL.fromString(dashboardUrl.toString())
          .addRoute(`/${projectId.toString()}/incidents/episodes/${id}`)
          .toString();

        // The title inside the link's text, escaped as an incident's is.
        let text: MarkdownText = mdText`${Service.bold(Service.link(linkUrl, ep.title || "Untitled Episode"))}`;
        const meta: Array<MarkdownText> = [];
        if (ep.incidentSeverity?.name) {
          meta.push(
            mdText`Severity: ${Service.bold(ep.incidentSeverity.name)}`,
          );
        }
        if (ep.currentIncidentState?.name) {
          meta.push(
            mdText`State: ${Service.bold(ep.currentIncidentState.name)}`,
          );
        }
        if (ep.createdAt) {
          meta.push(
            mdText`Created: ${Service.formatDate(ep.createdAt, data.timezone)}`,
          );
        }
        if (ep.resolvedAt && ep.createdAt) {
          meta.push(
            mdText`Resolved in ${Service.bold(Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(ep.createdAt, ep.resolvedAt)))}`,
          );
        }
        if (meta.length > 0) {
          text = mdText`${text}\n${FeedMarkdown.join(meta, "  ·  ")}`;
        }
        blocks.push(Service.md(text));
      }
    }
  }

  // ───────────────────────── Alerts ─────────────────────────

  @CaptureSpan()
  private async buildAlertBlocks(data: {
    blocks: Array<WorkspaceMessageBlock>;
    items: Array<WorkspaceNotificationSummaryItem>;
    type: WorkspaceNotificationSummaryType;
    fromDate: Date;
    projectId: ObjectID;
    filters?: Array<NotificationRuleCondition> | undefined;
    filterCondition?: FilterCondition | undefined;
    // The summary's time zone: the dates in its list are read in it.
    timezone?: Timezone | undefined;
  }): Promise<void> {
    if (data.type === WorkspaceNotificationSummaryType.AlertEpisode) {
      await this.buildAlertEpisodeBlocks(data);
      return;
    }

    const { blocks, items, fromDate, projectId } = data;

    let alerts: Array<Alert> = await AlertService.findAllBy({
      query: {
        projectId,
        createdAt: QueryHelper.greaterThanEqualTo(fromDate),
      },
      select: {
        _id: true,
        title: true,
        description: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        alertSeverity: { name: true, _id: true },
        currentAlertState: {
          name: true,
          _id: true,
        },
        currentAlertStateId: true,
        labels: { _id: true, name: true },
        monitor: { name: true, _id: true },
        createdAt: true,
      },
      props: { isRoot: true },
    });

    // Apply filters
    alerts = await Service.filterItems({
      items: alerts,
      filters: data.filters,
      filterCondition: data.filterCondition,
      projectId: projectId,
      recordKey: "alertId",
      ownerCheckOn: NotificationRuleConditionCheckOn.AlertOwners,
      getMonitorIds: (alert: Alert): Array<string> => {
        return alert.monitor?._id ? [alert.monitor._id.toString()] : [];
      },
      buildValues: Service.buildAlertValues,
    });

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    /*
     * Resolved or open, by the one rule (Common/Utils/ResolvedState), and
     * acknowledged or not (Common/Utils/AcknowledgedState).
     */
    const alertStateRules: SummaryStateRules =
      await Service.getAlertStateRules(projectId);
    const isResolvedAlertState: (stateId: ObjectID | undefined) => boolean =
      alertStateRules.isResolved;

    if (Service.has(items, WorkspaceNotificationSummaryItem.TotalCount)) {
      const resolved: number = alerts.filter((a: Alert) => {
        return isResolvedAlertState(a.currentAlertStateId);
      }).length;
      blocks.push(
        Service.md(
          mdText`${Service.bold("Total:")} ${alerts.length} alert${alerts.length !== 1 ? "s" : ""}  ·  ${Service.bold("Open:")} ${alerts.length - resolved}  ·  ${Service.bold("Resolved:")} ${resolved}`,
        ),
      );
    }

    if (
      Service.has(items, WorkspaceNotificationSummaryItem.SeverityBreakdown)
    ) {
      const map: Map<string, number> = new Map();
      for (const a of alerts) {
        const s: string = a.alertSeverity?.name || "Unknown";
        map.set(s, (map.get(s) || 0) + 1);
      }
      if (map.size > 0) {
        const parts: Array<MarkdownText> = [];
        for (const [sev, c] of map) {
          parts.push(mdText`${sev}: ${Service.bold(String(c))}`);
        }
        blocks.push(
          Service.md(
            mdText`${Service.bold("By Severity:")}  ${FeedMarkdown.join(parts, "  ·  ")}`,
          ),
        );
      }
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.StateBreakdown)) {
      const map: Map<string, number> = new Map();
      for (const a of alerts) {
        const s: string = a.currentAlertState?.name || "Unknown";
        map.set(s, (map.get(s) || 0) + 1);
      }
      if (map.size > 0) {
        const parts: Array<MarkdownText> = [];
        for (const [state, c] of map) {
          parts.push(mdText`${state}: ${Service.bold(String(c))}`);
        }
        blocks.push(
          Service.md(
            mdText`${Service.bold("By State:")}  ${FeedMarkdown.join(parts, "  ·  ")}`,
          ),
        );
      }
    }

    // Timeline data
    const needTimeline: boolean =
      Service.has(items, WorkspaceNotificationSummaryItem.WhoAcknowledged) ||
      Service.has(items, WorkspaceNotificationSummaryItem.WhoResolved) ||
      Service.has(items, WorkspaceNotificationSummaryItem.TimeToAcknowledge) ||
      Service.has(items, WorkspaceNotificationSummaryItem.TimeToResolve);

    const tlMap: Map<string, TimelineData> = new Map();

    if (needTimeline && alerts.length > 0) {
      const ids: Array<ObjectID> = alerts
        .filter((a: Alert) => {
          return a._id;
        })
        .map((a: Alert) => {
          return new ObjectID(a._id!.toString());
        });

      const timelines: Array<AlertStateTimeline> =
        await AlertStateTimelineService.findAllBy({
          query: { projectId, alertId: QueryHelper.any(ids) },
          select: {
            alertId: true,
            alertStateId: true,
            createdByUser: { name: true, email: true },
            createdAt: true,
          },
          // The first resolve and acknowledgement come first.
          sort: { createdAt: SortOrder.Ascending },
          props: { isRoot: true },
        });

      for (const tl of timelines) {
        const id: string = tl.alertId?.toString() || "";
        if (!tlMap.has(id)) {
          tlMap.set(id, {});
        }
        const td: TimelineData = tlMap.get(id)!;
        const userName: string =
          tl.createdByUser?.name?.toString() ||
          tl.createdByUser?.email?.toString() ||
          "System";

        /*
         * The first move into a state that counts as acknowledged - the
         * acknowledged state, one placed after it, or a resolved one - is
         * the acknowledgement, as on the alert's overview.
         */
        if (alertStateRules.isAcknowledged(tl.alertStateId) && !td.ackAt) {
          td.ackBy = userName;
          td.ackAt = tl.createdAt;
        }
        if (isResolvedAlertState(tl.alertStateId) && !td.resolvedAt) {
          td.resolvedBy = userName;
          td.resolvedAt = tl.createdAt;
        }
      }

      for (const a of alerts) {
        const id: string = a._id?.toString() || "";
        if (!tlMap.has(id)) {
          tlMap.set(id, {});
        }
        tlMap.get(id)!.declaredAt = a.createdAt;
      }
    }

    if (
      Service.has(items, WorkspaceNotificationSummaryItem.TimeToAcknowledge)
    ) {
      const { avg, count } = this.computeAvg(tlMap, "ack");
      blocks.push(
        Service.md(
          count > 0
            ? mdText`${Service.bold("MTTA (Mean Time to Acknowledge):")}  ${Service.bold(Service.formatDuration(avg))}  _(${count} acknowledged)_`
            : mdText`${Service.bold("MTTA (Mean Time to Acknowledge):")}  _No alerts acknowledged_`,
        ),
      );
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.TimeToResolve)) {
      const { avg, count } = this.computeAvg(tlMap, "resolve");
      blocks.push(
        Service.md(
          count > 0
            ? mdText`${Service.bold("MTTR (Mean Time to Resolve):")}  ${Service.bold(Service.formatDuration(avg))}  _(${count} resolved)_`
            : mdText`${Service.bold("MTTR (Mean Time to Resolve):")}  _No alerts resolved_`,
        ),
      );
    }

    if (
      Service.has(items, WorkspaceNotificationSummaryItem.ResourcesAffected)
    ) {
      // Every resource the period's alerts are linked to, not only monitors.
      const names: Array<string> = LinkedAffectedResources.getNames({
        resources: await LinkedAffectedResources.readForAlerts({
          service: AlertService,
          projectId,
          alertIds: alerts.map((a: Alert): ObjectID => {
            return a.id!;
          }),
        }),
      });
      if (names.length > 0) {
        blocks.push(
          Service.md(
            mdText`${Service.bold(`Resources Affected (${names.length}):`)}  ${Service.joinNames(names)}`,
          ),
        );
      }
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.ListWithLinks)) {
      blocks.push(Service.divider());

      if (alerts.length === 0) {
        blocks.push(Service.md(mdText`_No alerts reported in this period._`));
        return;
      }

      for (const a of alerts) {
        const id: string = a._id?.toString() || "";
        const display: string =
          a.alertNumberWithPrefix || `#${a.alertNumber || ""}`;
        const linkUrl: string = URL.fromString(dashboardUrl.toString())
          .addRoute(`/${projectId.toString()}/alerts/${id}`)
          .toString();
        const td: TimelineData | undefined = tlMap.get(id);

        // The title inside the link's text, escaped as an incident's is.
        let text: MarkdownText = mdText`${Service.bold(Service.link(linkUrl, `${display} — ${a.title || "Untitled"}`))}`;

        const meta: Array<MarkdownText> = [];
        if (a.alertSeverity?.name) {
          meta.push(mdText`Severity: ${Service.bold(a.alertSeverity.name)}`);
        }
        if (a.currentAlertState?.name) {
          meta.push(mdText`State: ${Service.bold(a.currentAlertState.name)}`);
        }
        if (a.createdAt) {
          meta.push(
            mdText`Created: ${Service.formatDate(a.createdAt, data.timezone)}`,
          );
        }
        if (meta.length > 0) {
          text = mdText`${text}\n${FeedMarkdown.join(meta, "  ·  ")}`;
        }

        const ackResolve: Array<MarkdownText> = [];
        if (
          Service.has(items, WorkspaceNotificationSummaryItem.WhoAcknowledged)
        ) {
          if (td?.ackBy && td?.ackAt) {
            ackResolve.push(
              mdText`Ack: ${Service.bold(td.ackBy)} in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || a.createdAt!, td.ackAt))}`,
            );
          } else if (td?.resolvedBy && td?.resolvedAt) {
            // If not explicitly acknowledged but resolved, ack time = resolve time
            ackResolve.push(
              mdText`Ack: ${Service.bold(td.resolvedBy)} in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || a.createdAt!, td.resolvedAt))}`,
            );
          } else {
            ackResolve.push(mdText`_Not yet acknowledged_`);
          }
        }
        if (Service.has(items, WorkspaceNotificationSummaryItem.WhoResolved)) {
          if (td?.resolvedBy && td?.resolvedAt) {
            ackResolve.push(
              mdText`Resolved: ${Service.bold(td.resolvedBy)} in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || a.createdAt!, td.resolvedAt))}`,
            );
          } else if (!isResolvedAlertState(a.currentAlertStateId)) {
            ackResolve.push(mdText`_Not yet resolved_`);
          }
        }
        if (ackResolve.length > 0) {
          text = mdText`${text}\n${FeedMarkdown.join(ackResolve, "  ·  ")}`;
        }

        blocks.push(Service.md(text));
      }
    }
  }

  // ───────────────────────── Alert Episodes ─────────────────────────

  @CaptureSpan()
  private async buildAlertEpisodeBlocks(data: {
    blocks: Array<WorkspaceMessageBlock>;
    items: Array<WorkspaceNotificationSummaryItem>;
    fromDate: Date;
    projectId: ObjectID;
    filters?: Array<NotificationRuleCondition> | undefined;
    filterCondition?: FilterCondition | undefined;
    // The summary's time zone: the dates in its list are read in it.
    timezone?: Timezone | undefined;
  }): Promise<void> {
    const { blocks, items, fromDate, projectId } = data;

    let episodes: Array<AlertEpisode> = await AlertEpisodeService.findAllBy({
      query: {
        projectId,
        createdAt: QueryHelper.greaterThanEqualTo(fromDate),
      },
      select: {
        _id: true,
        title: true,
        description: true,
        alertSeverity: { name: true, _id: true },
        currentAlertState: { name: true, _id: true },
        currentAlertStateId: true,
        labels: { _id: true, name: true },
        createdAt: true,
        resolvedAt: true,
      },
      props: { isRoot: true },
    });

    // Apply filters
    episodes = await Service.filterItems({
      items: episodes,
      filters: data.filters,
      filterCondition: data.filterCondition,
      projectId: projectId,
      recordKey: "alertEpisodeId",
      ownerCheckOn: NotificationRuleConditionCheckOn.AlertEpisodeOwners,
      buildValues: Service.buildAlertEpisodeValues,
    });

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    if (Service.has(items, WorkspaceNotificationSummaryItem.TotalCount)) {
      // Resolved or open, by the one rule (Common/Utils/ResolvedState).
      const isResolvedAlertState: (stateId: ObjectID | undefined) => boolean =
        await Service.getAlertResolvedRule(projectId);

      const resolved: number = episodes.filter((e: AlertEpisode) => {
        return isResolvedAlertState(e.currentAlertStateId);
      }).length;
      blocks.push(
        Service.md(
          mdText`${Service.bold("Total:")} ${episodes.length} episode${episodes.length !== 1 ? "s" : ""}  ·  ${Service.bold("Open:")} ${episodes.length - resolved}  ·  ${Service.bold("Resolved:")} ${resolved}`,
        ),
      );
    }

    if (
      Service.has(items, WorkspaceNotificationSummaryItem.SeverityBreakdown)
    ) {
      const map: Map<string, number> = new Map();
      for (const e of episodes) {
        const s: string = e.alertSeverity?.name || "Unknown";
        map.set(s, (map.get(s) || 0) + 1);
      }
      if (map.size > 0) {
        const parts: Array<MarkdownText> = [];
        for (const [sev, c] of map) {
          parts.push(mdText`${sev}: ${Service.bold(String(c))}`);
        }
        blocks.push(
          Service.md(
            mdText`${Service.bold("By Severity:")}  ${FeedMarkdown.join(parts, "  ·  ")}`,
          ),
        );
      }
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.StateBreakdown)) {
      const map: Map<string, number> = new Map();
      for (const e of episodes) {
        const s: string = e.currentAlertState?.name || "Unknown";
        map.set(s, (map.get(s) || 0) + 1);
      }
      if (map.size > 0) {
        const parts: Array<MarkdownText> = [];
        for (const [state, c] of map) {
          parts.push(mdText`${state}: ${Service.bold(String(c))}`);
        }
        blocks.push(
          Service.md(
            mdText`${Service.bold("By State:")}  ${FeedMarkdown.join(parts, "  ·  ")}`,
          ),
        );
      }
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.TimeToResolve)) {
      let total: number = 0;
      let count: number = 0;
      for (const e of episodes) {
        if (e.resolvedAt && e.createdAt) {
          total += OneUptimeDate.getMinutesBetweenTwoDates(
            e.createdAt,
            e.resolvedAt,
          );
          count++;
        }
      }
      blocks.push(
        Service.md(
          count > 0
            ? mdText`${Service.bold("MTTR (Mean Time to Resolve):")}  ${Service.bold(Service.formatDuration(Math.round(total / count)))}  _(${count} resolved)_`
            : mdText`${Service.bold("MTTR (Mean Time to Resolve):")}  _No episodes resolved_`,
        ),
      );
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.ListWithLinks)) {
      blocks.push(Service.divider());

      if (episodes.length === 0) {
        blocks.push(Service.md(mdText`_No alert episodes in this period._`));
        return;
      }

      for (const ep of episodes) {
        const id: string = ep._id?.toString() || "";
        const linkUrl: string = URL.fromString(dashboardUrl.toString())
          .addRoute(`/${projectId.toString()}/alerts/episodes/${id}`)
          .toString();

        // The title inside the link's text, escaped as an incident episode's is.
        let text: MarkdownText = mdText`${Service.bold(Service.link(linkUrl, ep.title || "Untitled Episode"))}`;
        const meta: Array<MarkdownText> = [];
        if (ep.alertSeverity?.name) {
          meta.push(mdText`Severity: ${Service.bold(ep.alertSeverity.name)}`);
        }
        if (ep.currentAlertState?.name) {
          meta.push(mdText`State: ${Service.bold(ep.currentAlertState.name)}`);
        }
        if (ep.createdAt) {
          meta.push(
            mdText`Created: ${Service.formatDate(ep.createdAt, data.timezone)}`,
          );
        }
        if (ep.resolvedAt && ep.createdAt) {
          meta.push(
            mdText`Resolved in ${Service.bold(Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(ep.createdAt, ep.resolvedAt)))}`,
          );
        }
        if (meta.length > 0) {
          text = mdText`${text}\n${FeedMarkdown.join(meta, "  ·  ")}`;
        }
        blocks.push(Service.md(text));
      }
    }
  }

  // ───────────────────────── Utilities ─────────────────────────

  private computeAvg(
    tlMap: Map<string, TimelineData>,
    kind: "ack" | "resolve",
  ): { avg: number; count: number } {
    let total: number = 0;
    let count: number = 0;
    for (const [, td] of tlMap) {
      // For ack: if not explicitly acknowledged but resolved, use resolve time as ack time
      const eventTime: Date | undefined =
        kind === "ack" ? td.ackAt || td.resolvedAt : td.resolvedAt;
      if (eventTime && td.declaredAt) {
        total += OneUptimeDate.getMinutesBetweenTwoDates(
          td.declaredAt,
          eventTime,
        );
        count++;
      }
    }
    return { avg: count > 0 ? Math.round(total / count) : 0, count };
  }
}

export default new Service();
