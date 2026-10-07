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
import {
  escapeMarkdownInline,
  escapeMarkdownValue,
} from "../../Utils/Markdown/MarkdownEscape";
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
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import URL from "../../Types/API/URL";
import DatabaseConfig from "../DatabaseConfig";
import NotificationRuleCondition, {
  NotificationRuleConditionCheckOn,
} from "../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import FilterCondition from "../../Types/Filter/FilterCondition";
import { WorkspaceNotificationRuleUtil } from "../../Types/Workspace/NotificationRules/NotificationRuleUtil";
import IncidentNotificationRule from "../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import PartialEntity from "../../Types/Database/PartialEntity";
import WorkspaceSummaryScheduleUtil, {
  WorkspaceSummaryScheduleColumns,
  WorkspaceSummaryScheduleWrite,
} from "../../Utils/Workspace/WorkspaceSummarySchedule";
import Timezone from "../../Types/Timezone";
import User from "../../Models/DatabaseModels/User";
import UserService from "./UserService";

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

    const summaries: Array<WorkspaceNotificationSummary> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        recurringInterval: true,
        sendFirstReportAt: true,
        nextSendAt: true,
        isEnabled: true,
        timezone: true,
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
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

  @CaptureSpan()
  public async testSummary(data: {
    summaryId: ObjectID;
    projectId: ObjectID;
    testByUserId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    await this.sendSummary({ summaryId: data.summaryId, isTest: true });
  }

  @CaptureSpan()
  public async sendSummary(data: {
    summaryId: ObjectID;
    isTest?: boolean;
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

    if (!summary.projectId) {
      throw new BadDataException("Summary project ID not found");
    }

    if (!summary.channelNames || summary.channelNames.length === 0) {
      throw new BadDataException("No channel names configured for summary");
    }

    if (!summary.summaryItems || summary.summaryItems.length === 0) {
      throw new BadDataException("No summary items selected");
    }

    const messageBlocks: Array<WorkspaceMessageBlock> =
      await this.buildSummaryMessageBlocks({ summary });

    const messagePayload: WorkspaceMessagePayload = {
      _type: "WorkspaceMessagePayload",
      channelNames: summary.channelNames,
      channelIds: [],
      messageBlocks: messageBlocks,
      workspaceType: summary.workspaceType!,
      teamId: summary.teamName || undefined,
    };

    try {
      await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
        projectId: summary.projectId,
        messagePayloadsByWorkspace: [messagePayload],
      });

      // Log successful send
      for (const channelName of summary.channelNames) {
        await WorkspaceNotificationLogService.createWorkspaceLog(
          {
            projectId: summary.projectId!,
            workspaceType: summary.workspaceType!,
            channelName: channelName,
            actionType: WorkspaceNotificationActionType.SendMessage,
            status: WorkspaceNotificationStatus.Success,
            statusMessage: data.isTest
              ? "Test summary sent successfully"
              : "Summary sent successfully",
            message: `${summary.summaryType || ""} summary "${summary.name || "Untitled"}" sent to channel "${channelName}"`,
          },
          { isRoot: true },
        );
      }
    } catch (err) {
      // Log failed send
      for (const channelName of summary.channelNames) {
        await WorkspaceNotificationLogService.createWorkspaceLog(
          {
            projectId: summary.projectId!,
            workspaceType: summary.workspaceType!,
            channelName: channelName,
            actionType: WorkspaceNotificationActionType.SendMessage,
            status: WorkspaceNotificationStatus.Error,
            statusMessage: err instanceof Error ? err.message : "Unknown error",
            message: `Failed to send ${summary.summaryType || ""} summary "${summary.name || "Untitled"}" to channel "${channelName}"`,
          },
          { isRoot: true },
        ).catch((logErr: unknown) => {
          logger.error(
            "Failed to create workspace notification log for summary send failure",
          );
          logger.error(logErr);
        });
      }

      throw err; // Re-throw so caller knows it failed
    }

    if (!data.isTest) {
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
  }

  // ───────────────────────── helpers ─────────────────────────

  private static divider(): WorkspacePayloadDivider {
    return { _type: "WorkspacePayloadDivider" };
  }

  private static header(text: string): WorkspacePayloadHeader {
    return { _type: "WorkspacePayloadHeader", text };
  }

  private static md(text: string): WorkspacePayloadMarkdown {
    return { _type: "WorkspacePayloadMarkdown", text };
  }

  private static bold(text: string): string {
    return `**${text}**`;
  }

  private static link(url: string, text: string): string {
    return `[${text}](${url})`;
  }

  /*
   * Resource names are escaped: a host or cluster name can come from an
   * agent rather than from someone typing it, and this text is markdown.
   */
  private static joinNames(names: Array<string>): string {
    return names
      .map((name: string): string => {
        return escapeMarkdownInline(name);
      })
      .join(", ");
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

  // Build values map for an incident
  private static buildIncidentValues(incident: Incident): {
    [key in NotificationRuleConditionCheckOn]:
      | string
      | Array<string>
      | undefined;
  } {
    return {
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
      // unused for incidents
      [NotificationRuleConditionCheckOn.MonitorName]: undefined,
      [NotificationRuleConditionCheckOn.MonitorType]: undefined,
      [NotificationRuleConditionCheckOn.MonitorStatus]: undefined,
      [NotificationRuleConditionCheckOn.AlertTitle]: undefined,
      [NotificationRuleConditionCheckOn.AlertDescription]: undefined,
      [NotificationRuleConditionCheckOn.AlertSeverity]: undefined,
      [NotificationRuleConditionCheckOn.AlertState]: undefined,
      [NotificationRuleConditionCheckOn.AlertLabels]: undefined,
      [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
      [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]:
        undefined,
      [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
      [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]: undefined,
      [NotificationRuleConditionCheckOn.MonitorLabels]: undefined,
      [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: undefined,
      [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]: undefined,
      [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: undefined,
      [NotificationRuleConditionCheckOn.AlertEpisodeTitle]: undefined,
      [NotificationRuleConditionCheckOn.AlertEpisodeDescription]: undefined,
      [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]: undefined,
      [NotificationRuleConditionCheckOn.AlertEpisodeState]: undefined,
      [NotificationRuleConditionCheckOn.AlertEpisodeLabels]: undefined,
      [NotificationRuleConditionCheckOn.IncidentEpisodeTitle]: undefined,
      [NotificationRuleConditionCheckOn.IncidentEpisodeDescription]: undefined,
      [NotificationRuleConditionCheckOn.IncidentEpisodeSeverity]: undefined,
      [NotificationRuleConditionCheckOn.IncidentEpisodeState]: undefined,
      [NotificationRuleConditionCheckOn.IncidentEpisodeLabels]: undefined,
    };
  }

  // Build values map for an alert
  private static buildAlertValues(alert: Alert): {
    [key in NotificationRuleConditionCheckOn]:
      | string
      | Array<string>
      | undefined;
  } {
    return {
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
      // unused for alerts
      [NotificationRuleConditionCheckOn.MonitorName]: undefined,
      [NotificationRuleConditionCheckOn.MonitorType]: undefined,
      [NotificationRuleConditionCheckOn.MonitorStatus]: undefined,
      [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
      [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
      [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
      [NotificationRuleConditionCheckOn.IncidentState]: undefined,
      [NotificationRuleConditionCheckOn.IncidentLabels]: undefined,
      [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
      [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]:
        undefined,
      [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
      [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]: undefined,
      [NotificationRuleConditionCheckOn.MonitorLabels]: undefined,
      [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: undefined,
      [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]: undefined,
      [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: undefined,
      [NotificationRuleConditionCheckOn.AlertEpisodeTitle]: undefined,
      [NotificationRuleConditionCheckOn.AlertEpisodeDescription]: undefined,
      [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]: undefined,
      [NotificationRuleConditionCheckOn.AlertEpisodeState]: undefined,
      [NotificationRuleConditionCheckOn.AlertEpisodeLabels]: undefined,
      [NotificationRuleConditionCheckOn.IncidentEpisodeTitle]: undefined,
      [NotificationRuleConditionCheckOn.IncidentEpisodeDescription]: undefined,
      [NotificationRuleConditionCheckOn.IncidentEpisodeSeverity]: undefined,
      [NotificationRuleConditionCheckOn.IncidentEpisodeState]: undefined,
      [NotificationRuleConditionCheckOn.IncidentEpisodeLabels]: undefined,
    };
  }

  // Build values map for an incident episode
  private static buildIncidentEpisodeValues(episode: IncidentEpisode): {
    [key in NotificationRuleConditionCheckOn]:
      | string
      | Array<string>
      | undefined;
  } {
    return {
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
      // unused for incident episodes
      [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
      [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
      [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
      [NotificationRuleConditionCheckOn.IncidentState]: undefined,
      [NotificationRuleConditionCheckOn.IncidentLabels]: undefined,
      [NotificationRuleConditionCheckOn.AlertTitle]: undefined,
      [NotificationRuleConditionCheckOn.AlertDescription]: undefined,
      [NotificationRuleConditionCheckOn.AlertSeverity]: undefined,
      [NotificationRuleConditionCheckOn.AlertState]: undefined,
      [NotificationRuleConditionCheckOn.AlertLabels]: undefined,
      [NotificationRuleConditionCheckOn.AlertEpisodeTitle]: undefined,
      [NotificationRuleConditionCheckOn.AlertEpisodeDescription]: undefined,
      [NotificationRuleConditionCheckOn.AlertEpisodeSeverity]: undefined,
      [NotificationRuleConditionCheckOn.AlertEpisodeState]: undefined,
      [NotificationRuleConditionCheckOn.AlertEpisodeLabels]: undefined,
      [NotificationRuleConditionCheckOn.Monitors]: undefined,
      [NotificationRuleConditionCheckOn.MonitorName]: undefined,
      [NotificationRuleConditionCheckOn.MonitorType]: undefined,
      [NotificationRuleConditionCheckOn.MonitorStatus]: undefined,
      [NotificationRuleConditionCheckOn.MonitorLabels]: undefined,
      [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
      [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]:
        undefined,
      [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
      [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]: undefined,
      [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: undefined,
      [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]: undefined,
      [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: undefined,
    };
  }

  // Build values map for an alert episode
  private static buildAlertEpisodeValues(episode: AlertEpisode): {
    [key in NotificationRuleConditionCheckOn]:
      | string
      | Array<string>
      | undefined;
  } {
    return {
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
      // unused for alert episodes
      [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
      [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
      [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
      [NotificationRuleConditionCheckOn.IncidentState]: undefined,
      [NotificationRuleConditionCheckOn.IncidentLabels]: undefined,
      [NotificationRuleConditionCheckOn.IncidentEpisodeTitle]: undefined,
      [NotificationRuleConditionCheckOn.IncidentEpisodeDescription]: undefined,
      [NotificationRuleConditionCheckOn.IncidentEpisodeSeverity]: undefined,
      [NotificationRuleConditionCheckOn.IncidentEpisodeState]: undefined,
      [NotificationRuleConditionCheckOn.IncidentEpisodeLabels]: undefined,
      [NotificationRuleConditionCheckOn.AlertTitle]: undefined,
      [NotificationRuleConditionCheckOn.AlertDescription]: undefined,
      [NotificationRuleConditionCheckOn.AlertSeverity]: undefined,
      [NotificationRuleConditionCheckOn.AlertState]: undefined,
      [NotificationRuleConditionCheckOn.AlertLabels]: undefined,
      [NotificationRuleConditionCheckOn.Monitors]: undefined,
      [NotificationRuleConditionCheckOn.MonitorName]: undefined,
      [NotificationRuleConditionCheckOn.MonitorType]: undefined,
      [NotificationRuleConditionCheckOn.MonitorStatus]: undefined,
      [NotificationRuleConditionCheckOn.MonitorLabels]: undefined,
      [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
      [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]:
        undefined,
      [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
      [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]: undefined,
      [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: undefined,
      [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]: undefined,
      [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: undefined,
    };
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
    const days: number = summary.numberOfDaysOfData || 7;
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
        `_Reporting period: ${Service.bold(String(days))} day${days !== 1 ? "s" : ""}_`,
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
      Service.md(`_Sent by OneUptime  •  ${summary.name || "Untitled"}_`),
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
    if (data.filters && data.filters.length > 0) {
      incidents = incidents.filter((inc: Incident) => {
        return Service.matchesFilters({
          filters: data.filters,
          filterCondition: data.filterCondition,
          values: Service.buildIncidentValues(inc),
        });
      });
    }

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
          `${Service.bold("Total:")} ${incidents.length} incident${incidents.length !== 1 ? "s" : ""}  ·  ` +
            `${Service.bold("Open:")} ${open}  ·  ${Service.bold("Resolved:")} ${resolved}`,
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
        const parts: Array<string> = [];
        for (const [sev, count] of map) {
          parts.push(
            `${escapeMarkdownValue(sev)}: ${Service.bold(String(count))}`,
          );
        }
        blocks.push(
          Service.md(`${Service.bold("By Severity:")}  ${parts.join("  ·  ")}`),
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
        const parts: Array<string> = [];
        for (const [state, count] of map) {
          parts.push(
            `${escapeMarkdownValue(state)}: ${Service.bold(String(count))}`,
          );
        }
        blocks.push(
          Service.md(`${Service.bold("By State:")}  ${parts.join("  ·  ")}`),
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
            ? `${Service.bold("MTTA (Mean Time to Acknowledge):")}  ${Service.bold(Service.formatDuration(avg))}  _(${count} acknowledged)_`
            : `${Service.bold("MTTA (Mean Time to Acknowledge):")}  _No incidents acknowledged_`,
        ),
      );
    }

    // MTTR
    if (Service.has(items, WorkspaceNotificationSummaryItem.TimeToResolve)) {
      const { avg, count } = this.computeAvg(tlMap, "resolve");
      blocks.push(
        Service.md(
          count > 0
            ? `${Service.bold("MTTR (Mean Time to Resolve):")}  ${Service.bold(Service.formatDuration(avg))}  _(${count} resolved)_`
            : `${Service.bold("MTTR (Mean Time to Resolve):")}  _No incidents resolved_`,
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
            `${Service.bold(`Resources Affected (${names.length}):`)}  ${Service.joinNames(names)}`,
          ),
        );
      }
    }

    // Detailed list
    if (Service.has(items, WorkspaceNotificationSummaryItem.ListWithLinks)) {
      blocks.push(Service.divider());

      if (incidents.length === 0) {
        blocks.push(Service.md(`_No incidents reported in this period._`));
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
        let text: string = `${Service.bold(Service.link(linkUrl, `${display} — ${escapeMarkdownInline(inc.title || "Untitled")}`))}`;

        // Meta line
        const meta: Array<string> = [];
        if (inc.incidentSeverity?.name) {
          meta.push(
            `Severity: ${Service.bold(escapeMarkdownValue(inc.incidentSeverity.name))}`,
          );
        }
        if (inc.currentIncidentState?.name) {
          meta.push(
            `State: ${Service.bold(escapeMarkdownValue(inc.currentIncidentState.name))}`,
          );
        }
        if (inc.declaredAt) {
          meta.push(
            `Declared: ${Service.formatDate(inc.declaredAt, data.timezone)}`,
          );
        }
        if (meta.length > 0) {
          text += `\n${meta.join("  ·  ")}`;
        }

        // Ack & resolve line
        const ackResolve: Array<string> = [];
        if (
          Service.has(items, WorkspaceNotificationSummaryItem.WhoAcknowledged)
        ) {
          if (td?.ackBy && td?.ackAt) {
            ackResolve.push(
              `Ack: ${Service.bold(escapeMarkdownValue(td.ackBy))} in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || inc.createdAt!, td.ackAt))}`,
            );
          } else if (td?.resolvedBy && td?.resolvedAt) {
            // If not explicitly acknowledged but resolved, ack time = resolve time
            ackResolve.push(
              `Ack: ${Service.bold(escapeMarkdownValue(td.resolvedBy))} in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || inc.createdAt!, td.resolvedAt))}`,
            );
          } else {
            ackResolve.push(`_Not yet acknowledged_`);
          }
        }
        if (Service.has(items, WorkspaceNotificationSummaryItem.WhoResolved)) {
          if (td?.resolvedBy && td?.resolvedAt) {
            ackResolve.push(
              `Resolved: ${Service.bold(escapeMarkdownValue(td.resolvedBy))} in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || inc.createdAt!, td.resolvedAt))}`,
            );
          } else if (!isResolvedIncidentState(inc.currentIncidentStateId)) {
            ackResolve.push(`_Not yet resolved_`);
          }
        }
        if (ackResolve.length > 0) {
          text += `\n${ackResolve.join("  ·  ")}`;
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
    if (data.filters && data.filters.length > 0) {
      episodes = episodes.filter((ep: IncidentEpisode) => {
        return Service.matchesFilters({
          filters: data.filters,
          filterCondition: data.filterCondition,
          values: Service.buildIncidentEpisodeValues(ep),
        });
      });
    }

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
          `${Service.bold("Total:")} ${episodes.length} episode${episodes.length !== 1 ? "s" : ""}  ·  ` +
            `${Service.bold("Open:")} ${episodes.length - resolved}  ·  ${Service.bold("Resolved:")} ${resolved}`,
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
        const parts: Array<string> = [];
        for (const [sev, c] of map) {
          parts.push(`${escapeMarkdownValue(sev)}: ${Service.bold(String(c))}`);
        }
        blocks.push(
          Service.md(`${Service.bold("By Severity:")}  ${parts.join("  ·  ")}`),
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
        const parts: Array<string> = [];
        for (const [state, c] of map) {
          parts.push(
            `${escapeMarkdownValue(state)}: ${Service.bold(String(c))}`,
          );
        }
        blocks.push(
          Service.md(`${Service.bold("By State:")}  ${parts.join("  ·  ")}`),
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
            ? `${Service.bold("MTTR (Mean Time to Resolve):")}  ${Service.bold(Service.formatDuration(Math.round(total / count)))}  _(${count} resolved)_`
            : `${Service.bold("MTTR (Mean Time to Resolve):")}  _No episodes resolved_`,
        ),
      );
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.ListWithLinks)) {
      blocks.push(Service.divider());

      if (episodes.length === 0) {
        blocks.push(Service.md(`_No incident episodes in this period._`));
        return;
      }

      for (const ep of episodes) {
        const id: string = ep._id?.toString() || "";
        const linkUrl: string = URL.fromString(dashboardUrl.toString())
          .addRoute(`/${projectId.toString()}/incidents/episodes/${id}`)
          .toString();

        // The title inside the link's text, escaped as an incident's is.
        let text: string = `${Service.bold(Service.link(linkUrl, escapeMarkdownInline(ep.title || "Untitled Episode")))}`;
        const meta: Array<string> = [];
        if (ep.incidentSeverity?.name) {
          meta.push(
            `Severity: ${Service.bold(escapeMarkdownValue(ep.incidentSeverity.name))}`,
          );
        }
        if (ep.currentIncidentState?.name) {
          meta.push(
            `State: ${Service.bold(escapeMarkdownValue(ep.currentIncidentState.name))}`,
          );
        }
        if (ep.createdAt) {
          meta.push(
            `Created: ${Service.formatDate(ep.createdAt, data.timezone)}`,
          );
        }
        if (ep.resolvedAt && ep.createdAt) {
          meta.push(
            `Resolved in ${Service.bold(Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(ep.createdAt, ep.resolvedAt)))}`,
          );
        }
        if (meta.length > 0) {
          text += `\n${meta.join("  ·  ")}`;
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
    if (data.filters && data.filters.length > 0) {
      alerts = alerts.filter((alert: Alert) => {
        return Service.matchesFilters({
          filters: data.filters,
          filterCondition: data.filterCondition,
          values: Service.buildAlertValues(alert),
        });
      });
    }

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
          `${Service.bold("Total:")} ${alerts.length} alert${alerts.length !== 1 ? "s" : ""}  ·  ` +
            `${Service.bold("Open:")} ${alerts.length - resolved}  ·  ${Service.bold("Resolved:")} ${resolved}`,
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
        const parts: Array<string> = [];
        for (const [sev, c] of map) {
          parts.push(`${escapeMarkdownValue(sev)}: ${Service.bold(String(c))}`);
        }
        blocks.push(
          Service.md(`${Service.bold("By Severity:")}  ${parts.join("  ·  ")}`),
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
        const parts: Array<string> = [];
        for (const [state, c] of map) {
          parts.push(
            `${escapeMarkdownValue(state)}: ${Service.bold(String(c))}`,
          );
        }
        blocks.push(
          Service.md(`${Service.bold("By State:")}  ${parts.join("  ·  ")}`),
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
            ? `${Service.bold("MTTA (Mean Time to Acknowledge):")}  ${Service.bold(Service.formatDuration(avg))}  _(${count} acknowledged)_`
            : `${Service.bold("MTTA (Mean Time to Acknowledge):")}  _No alerts acknowledged_`,
        ),
      );
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.TimeToResolve)) {
      const { avg, count } = this.computeAvg(tlMap, "resolve");
      blocks.push(
        Service.md(
          count > 0
            ? `${Service.bold("MTTR (Mean Time to Resolve):")}  ${Service.bold(Service.formatDuration(avg))}  _(${count} resolved)_`
            : `${Service.bold("MTTR (Mean Time to Resolve):")}  _No alerts resolved_`,
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
            `${Service.bold(`Resources Affected (${names.length}):`)}  ${Service.joinNames(names)}`,
          ),
        );
      }
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.ListWithLinks)) {
      blocks.push(Service.divider());

      if (alerts.length === 0) {
        blocks.push(Service.md(`_No alerts reported in this period._`));
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
        let text: string = `${Service.bold(Service.link(linkUrl, `${display} — ${escapeMarkdownInline(a.title || "Untitled")}`))}`;

        const meta: Array<string> = [];
        if (a.alertSeverity?.name) {
          meta.push(
            `Severity: ${Service.bold(escapeMarkdownValue(a.alertSeverity.name))}`,
          );
        }
        if (a.currentAlertState?.name) {
          meta.push(
            `State: ${Service.bold(escapeMarkdownValue(a.currentAlertState.name))}`,
          );
        }
        if (a.createdAt) {
          meta.push(
            `Created: ${Service.formatDate(a.createdAt, data.timezone)}`,
          );
        }
        if (meta.length > 0) {
          text += `\n${meta.join("  ·  ")}`;
        }

        const ackResolve: Array<string> = [];
        if (
          Service.has(items, WorkspaceNotificationSummaryItem.WhoAcknowledged)
        ) {
          if (td?.ackBy && td?.ackAt) {
            ackResolve.push(
              `Ack: ${Service.bold(escapeMarkdownValue(td.ackBy))} in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || a.createdAt!, td.ackAt))}`,
            );
          } else if (td?.resolvedBy && td?.resolvedAt) {
            // If not explicitly acknowledged but resolved, ack time = resolve time
            ackResolve.push(
              `Ack: ${Service.bold(escapeMarkdownValue(td.resolvedBy))} in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || a.createdAt!, td.resolvedAt))}`,
            );
          } else {
            ackResolve.push(`_Not yet acknowledged_`);
          }
        }
        if (Service.has(items, WorkspaceNotificationSummaryItem.WhoResolved)) {
          if (td?.resolvedBy && td?.resolvedAt) {
            ackResolve.push(
              `Resolved: ${Service.bold(escapeMarkdownValue(td.resolvedBy))} in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || a.createdAt!, td.resolvedAt))}`,
            );
          } else if (!isResolvedAlertState(a.currentAlertStateId)) {
            ackResolve.push(`_Not yet resolved_`);
          }
        }
        if (ackResolve.length > 0) {
          text += `\n${ackResolve.join("  ·  ")}`;
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
    if (data.filters && data.filters.length > 0) {
      episodes = episodes.filter((ep: AlertEpisode) => {
        return Service.matchesFilters({
          filters: data.filters,
          filterCondition: data.filterCondition,
          values: Service.buildAlertEpisodeValues(ep),
        });
      });
    }

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
          `${Service.bold("Total:")} ${episodes.length} episode${episodes.length !== 1 ? "s" : ""}  ·  ` +
            `${Service.bold("Open:")} ${episodes.length - resolved}  ·  ${Service.bold("Resolved:")} ${resolved}`,
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
        const parts: Array<string> = [];
        for (const [sev, c] of map) {
          parts.push(`${escapeMarkdownValue(sev)}: ${Service.bold(String(c))}`);
        }
        blocks.push(
          Service.md(`${Service.bold("By Severity:")}  ${parts.join("  ·  ")}`),
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
        const parts: Array<string> = [];
        for (const [state, c] of map) {
          parts.push(
            `${escapeMarkdownValue(state)}: ${Service.bold(String(c))}`,
          );
        }
        blocks.push(
          Service.md(`${Service.bold("By State:")}  ${parts.join("  ·  ")}`),
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
            ? `${Service.bold("MTTR (Mean Time to Resolve):")}  ${Service.bold(Service.formatDuration(Math.round(total / count)))}  _(${count} resolved)_`
            : `${Service.bold("MTTR (Mean Time to Resolve):")}  _No episodes resolved_`,
        ),
      );
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.ListWithLinks)) {
      blocks.push(Service.divider());

      if (episodes.length === 0) {
        blocks.push(Service.md(`_No alert episodes in this period._`));
        return;
      }

      for (const ep of episodes) {
        const id: string = ep._id?.toString() || "";
        const linkUrl: string = URL.fromString(dashboardUrl.toString())
          .addRoute(`/${projectId.toString()}/alerts/episodes/${id}`)
          .toString();

        // The title inside the link's text, escaped as an incident episode's is.
        let text: string = `${Service.bold(Service.link(linkUrl, escapeMarkdownInline(ep.title || "Untitled Episode")))}`;
        const meta: Array<string> = [];
        if (ep.alertSeverity?.name) {
          meta.push(
            `Severity: ${Service.bold(escapeMarkdownValue(ep.alertSeverity.name))}`,
          );
        }
        if (ep.currentAlertState?.name) {
          meta.push(
            `State: ${Service.bold(escapeMarkdownValue(ep.currentAlertState.name))}`,
          );
        }
        if (ep.createdAt) {
          meta.push(
            `Created: ${Service.formatDate(ep.createdAt, data.timezone)}`,
          );
        }
        if (ep.resolvedAt && ep.createdAt) {
          meta.push(
            `Resolved in ${Service.bold(Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(ep.createdAt, ep.resolvedAt)))}`,
          );
        }
        if (meta.length > 0) {
          text += `\n${meta.join("  ·  ")}`;
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
