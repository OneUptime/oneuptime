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
import Incident from "../../Models/DatabaseModels/Incident";
import Alert from "../../Models/DatabaseModels/Alert";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import IncidentStateTimeline from "../../Models/DatabaseModels/IncidentStateTimeline";
import AlertStateTimeline from "../../Models/DatabaseModels/AlertStateTimeline";
import Label from "../../Models/DatabaseModels/Label";
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

export class Service extends DatabaseService<WorkspaceNotificationSummary> {
  public constructor() {
    super(WorkspaceNotificationSummary);
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

    await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
      projectId: summary.projectId,
      messagePayloadsByWorkspace: [messagePayload],
    });

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

  private static formatDate(date: Date): string {
    return OneUptimeDate.getDateAsLocalFormattedString(date, true);
  }

  private static has(
    items: Array<WorkspaceNotificationSummaryItem>,
    item: WorkspaceNotificationSummaryItem,
  ): boolean {
    return items.includes(item);
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
        incident.monitors?.map((m: Incident) => {
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

    const fromDateStr: string = Service.formatDate(fromDate);
    const toDateStr: string = Service.formatDate(
      OneUptimeDate.getCurrentDate(),
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
          isResolvedState: true,
          isAcknowledgedState: true,
        },
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

    // Overview stats
    if (Service.has(items, WorkspaceNotificationSummaryItem.TotalCount)) {
      const resolved: number = incidents.filter((i: Incident) => {
        return i.currentIncidentState?.isResolvedState;
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
          parts.push(`${sev}: ${Service.bold(String(count))}`);
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
          parts.push(`${state}: ${Service.bold(String(count))}`);
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
            incidentState: {
              isAcknowledgedState: true,
              isResolvedState: true,
            },
            createdByUser: { name: true, email: true },
            createdAt: true,
          },
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

        if (tl.incidentState?.isAcknowledgedState && !td.ackAt) {
          td.ackBy = userName;
          td.ackAt = tl.createdAt;
        }
        if (tl.incidentState?.isResolvedState && !td.resolvedAt) {
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
      const names: Set<string> = new Set();
      for (const inc of incidents) {
        if (inc.monitors) {
          for (const m of inc.monitors) {
            if (m.name) {
              names.add(m.name);
            }
          }
        }
      }
      if (names.size > 0) {
        blocks.push(
          Service.md(
            `${Service.bold(`Resources Affected (${names.size}):`)}  ${Array.from(names).join(", ")}`,
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

        // Title line with link
        let text: string = `${Service.bold(Service.link(linkUrl, `${display} — ${inc.title || "Untitled"}`))}`;

        // Meta line
        const meta: Array<string> = [];
        if (inc.incidentSeverity?.name) {
          meta.push(`Severity: ${Service.bold(inc.incidentSeverity.name)}`);
        }
        if (inc.currentIncidentState?.name) {
          meta.push(`State: ${Service.bold(inc.currentIncidentState.name)}`);
        }
        if (inc.declaredAt) {
          meta.push(`Declared: ${Service.formatDate(inc.declaredAt)}`);
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
              `Ack: ${Service.bold(td.ackBy)} in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || inc.createdAt!, td.ackAt))}`,
            );
          } else {
            ackResolve.push(`_Not yet acknowledged_`);
          }
        }
        if (Service.has(items, WorkspaceNotificationSummaryItem.WhoResolved)) {
          if (td?.resolvedBy && td?.resolvedAt) {
            ackResolve.push(
              `Resolved: ${Service.bold(td.resolvedBy)} in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || inc.createdAt!, td.resolvedAt))}`,
            );
          } else if (!inc.currentIncidentState?.isResolvedState) {
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
  }): Promise<void> {
    const { blocks, items, fromDate, projectId } = data;

    const episodes: Array<IncidentEpisode> =
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
            isResolvedState: true,
          },
          createdAt: true,
          resolvedAt: true,
        },
        props: { isRoot: true },
      });

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    if (Service.has(items, WorkspaceNotificationSummaryItem.TotalCount)) {
      const resolved: number = episodes.filter((e: IncidentEpisode) => {
        return e.currentIncidentState?.isResolvedState;
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
          parts.push(`${sev}: ${Service.bold(String(c))}`);
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
          parts.push(`${state}: ${Service.bold(String(c))}`);
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

        let text: string = `${Service.bold(Service.link(linkUrl, ep.title || "Untitled Episode"))}`;
        const meta: Array<string> = [];
        if (ep.incidentSeverity?.name) {
          meta.push(`Severity: ${Service.bold(ep.incidentSeverity.name)}`);
        }
        if (ep.currentIncidentState?.name) {
          meta.push(`State: ${Service.bold(ep.currentIncidentState.name)}`);
        }
        if (ep.createdAt) {
          meta.push(`Created: ${Service.formatDate(ep.createdAt)}`);
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
          isResolvedState: true,
          isAcknowledgedState: true,
        },
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

    if (Service.has(items, WorkspaceNotificationSummaryItem.TotalCount)) {
      const resolved: number = alerts.filter((a: Alert) => {
        return a.currentAlertState?.isResolvedState;
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
          parts.push(`${sev}: ${Service.bold(String(c))}`);
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
          parts.push(`${state}: ${Service.bold(String(c))}`);
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
            alertState: {
              isAcknowledgedState: true,
              isResolvedState: true,
            },
            createdByUser: { name: true, email: true },
            createdAt: true,
          },
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

        if (tl.alertState?.isAcknowledgedState && !td.ackAt) {
          td.ackBy = userName;
          td.ackAt = tl.createdAt;
        }
        if (tl.alertState?.isResolvedState && !td.resolvedAt) {
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
      const names: Set<string> = new Set();
      for (const a of alerts) {
        if (a.monitor?.name) {
          names.add(a.monitor.name);
        }
      }
      if (names.size > 0) {
        blocks.push(
          Service.md(
            `${Service.bold(`Resources Affected (${names.size}):`)}  ${Array.from(names).join(", ")}`,
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

        let text: string = `${Service.bold(Service.link(linkUrl, `${display} — ${a.title || "Untitled"}`))}`;

        const meta: Array<string> = [];
        if (a.alertSeverity?.name) {
          meta.push(`Severity: ${Service.bold(a.alertSeverity.name)}`);
        }
        if (a.currentAlertState?.name) {
          meta.push(`State: ${Service.bold(a.currentAlertState.name)}`);
        }
        if (a.createdAt) {
          meta.push(`Created: ${Service.formatDate(a.createdAt)}`);
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
              `Ack: ${Service.bold(td.ackBy)} in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || a.createdAt!, td.ackAt))}`,
            );
          } else {
            ackResolve.push(`_Not yet acknowledged_`);
          }
        }
        if (Service.has(items, WorkspaceNotificationSummaryItem.WhoResolved)) {
          if (td?.resolvedBy && td?.resolvedAt) {
            ackResolve.push(
              `Resolved: ${Service.bold(td.resolvedBy)} in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || a.createdAt!, td.resolvedAt))}`,
            );
          } else if (!a.currentAlertState?.isResolvedState) {
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
  }): Promise<void> {
    const { blocks, items, fromDate, projectId } = data;

    const episodes: Array<AlertEpisode> = await AlertEpisodeService.findAllBy({
      query: {
        projectId,
        createdAt: QueryHelper.greaterThanEqualTo(fromDate),
      },
      select: {
        _id: true,
        title: true,
        description: true,
        alertSeverity: { name: true, _id: true },
        currentAlertState: { name: true, _id: true, isResolvedState: true },
        createdAt: true,
        resolvedAt: true,
      },
      props: { isRoot: true },
    });

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    if (Service.has(items, WorkspaceNotificationSummaryItem.TotalCount)) {
      const resolved: number = episodes.filter((e: AlertEpisode) => {
        return e.currentAlertState?.isResolvedState;
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
          parts.push(`${sev}: ${Service.bold(String(c))}`);
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
          parts.push(`${state}: ${Service.bold(String(c))}`);
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

        let text: string = `${Service.bold(Service.link(linkUrl, ep.title || "Untitled Episode"))}`;
        const meta: Array<string> = [];
        if (ep.alertSeverity?.name) {
          meta.push(`Severity: ${Service.bold(ep.alertSeverity.name)}`);
        }
        if (ep.currentAlertState?.name) {
          meta.push(`State: ${Service.bold(ep.currentAlertState.name)}`);
        }
        if (ep.createdAt) {
          meta.push(`Created: ${Service.formatDate(ep.createdAt)}`);
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
      const eventTime: Date | undefined =
        kind === "ack" ? td.ackAt : td.resolvedAt;
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
