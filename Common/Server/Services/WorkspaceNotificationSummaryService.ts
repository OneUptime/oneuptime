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

interface TimelineData {
  ackBy?: string;
  resolvedBy?: string;
  ackAt?: Date;
  resolvedAt?: Date;
  declaredAt?: Date;
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
    const summary: WorkspaceNotificationSummary | null =
      await this.findOneById({
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
      });

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

    // ── Title header ──
    blocks.push(Service.header(`${type} Summary`));

    // ── Period info ──
    blocks.push(
      Service.md(
        `_${fromDateStr}  →  ${toDateStr}  (${days} day${days !== 1 ? "s" : ""})_`,
      ),
    );

    blocks.push(Service.divider());

    // ── Build type-specific content ──
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
      });
    } else {
      await this.buildAlertBlocks({
        blocks,
        items,
        type,
        fromDate,
        projectId: summary.projectId!,
      });
    }

    // ── Footer ──
    blocks.push(Service.divider());
    blocks.push(
      Service.md(
        `_Sent by OneUptime  •  Summary: ${summary.name || "Untitled"}_`,
      ),
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
  }): Promise<void> {
    if (data.type === WorkspaceNotificationSummaryType.IncidentEpisode) {
      await this.buildIncidentEpisodeBlocks(data);
      return;
    }

    const { blocks, items, fromDate, projectId } = data;

    const incidents: Array<Incident> = await IncidentService.findAllBy({
      query: {
        projectId,
        createdAt: QueryHelper.greaterThanEqualTo(fromDate),
      },
      select: {
        _id: true,
        title: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        incidentSeverity: { name: true },
        currentIncidentState: {
          name: true,
          isResolvedState: true,
          isAcknowledgedState: true,
        },
        monitors: { name: true, _id: true },
        createdAt: true,
        declaredAt: true,
      },
      props: { isRoot: true },
    });

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    // ── Overview stats ──
    if (Service.has(items, WorkspaceNotificationSummaryItem.TotalCount)) {
      const resolved: number = incidents.filter((i: Incident) => {
        return i.currentIncidentState?.isResolvedState;
      }).length;
      const open: number = incidents.length - resolved;

      blocks.push(
        Service.md(
          `*Total:* ${incidents.length} incident${incidents.length !== 1 ? "s" : ""}    |    ` +
            `*Open:* ${open}    |    *Resolved:* ${resolved}`,
        ),
      );
    }

    // ── Severity breakdown ──
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
          parts.push(`${sev}: *${count}*`);
        }
        blocks.push(Service.md(`*By Severity:*  ${parts.join("  |  ")}`));
      }
    }

    // ── State breakdown ──
    if (Service.has(items, WorkspaceNotificationSummaryItem.StateBreakdown)) {
      const map: Map<string, number> = new Map();
      for (const i of incidents) {
        const s: string = i.currentIncidentState?.name || "Unknown";
        map.set(s, (map.get(s) || 0) + 1);
      }
      if (map.size > 0) {
        const parts: Array<string> = [];
        for (const [state, count] of map) {
          parts.push(`${state}: *${count}*`);
        }
        blocks.push(Service.md(`*By State:*  ${parts.join("  |  ")}`));
      }
    }

    // ── Timeline data for MTTA/MTTR/who ──
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
          return i._id!;
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

    // ── MTTA / MTTR ──
    if (Service.has(items, WorkspaceNotificationSummaryItem.TimeToAcknowledge)) {
      const { avg, count } = this.computeAvg(tlMap, "ack");
      blocks.push(
        Service.md(
          count > 0
            ? `*Mean Time to Acknowledge (MTTA):*  ${Service.formatDuration(avg)}  _(${count} acknowledged)_`
            : `*Mean Time to Acknowledge (MTTA):*  _No incidents acknowledged in this period_`,
        ),
      );
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.TimeToResolve)) {
      const { avg, count } = this.computeAvg(tlMap, "resolve");
      blocks.push(
        Service.md(
          count > 0
            ? `*Mean Time to Resolve (MTTR):*  ${Service.formatDuration(avg)}  _(${count} resolved)_`
            : `*Mean Time to Resolve (MTTR):*  _No incidents resolved in this period_`,
        ),
      );
    }

    // ── Resources affected ──
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
            `*Resources Affected (${names.size}):*  ${Array.from(names).join(", ")}`,
          ),
        );
      }
    }

    // ── Detailed list ──
    if (Service.has(items, WorkspaceNotificationSummaryItem.ListWithLinks)) {
      blocks.push(Service.divider());
      blocks.push(Service.md(`*Incident Details*`));

      if (incidents.length === 0) {
        blocks.push(
          Service.md(`_No incidents reported in this period._`),
        );
      }

      for (const inc of incidents) {
        const id: string = inc._id?.toString() || "";
        const display: string =
          inc.incidentNumberWithPrefix || `#${inc.incidentNumber || ""}`;
        const link: string = URL.fromString(dashboardUrl.toString())
          .addRoute(`/${projectId.toString()}/incidents/${id}`)
          .toString();
        const td: TimelineData | undefined = tlMap.get(id);

        // Line 1: title with link
        let text: string = `*<${link}|${display} — ${inc.title || "Untitled"}>*\n`;

        // Line 2: meta info
        const meta: Array<string> = [];
        if (inc.incidentSeverity?.name) {
          meta.push(`Severity: *${inc.incidentSeverity.name}*`);
        }
        if (inc.currentIncidentState?.name) {
          meta.push(`State: *${inc.currentIncidentState.name}*`);
        }
        if (inc.declaredAt) {
          meta.push(`Declared: ${Service.formatDate(inc.declaredAt)}`);
        }
        if (meta.length > 0) {
          text += meta.join("  |  ");
        }

        // Line 3: ack & resolve
        const ackResolve: Array<string> = [];
        if (
          Service.has(
            items,
            WorkspaceNotificationSummaryItem.WhoAcknowledged,
          )
        ) {
          if (td?.ackBy && td?.ackAt) {
            ackResolve.push(
              `Acknowledged by *${td.ackBy}* (${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || inc.createdAt!, td.ackAt))})`,
            );
          } else {
            ackResolve.push(`_Not yet acknowledged_`);
          }
        }
        if (
          Service.has(items, WorkspaceNotificationSummaryItem.WhoResolved)
        ) {
          if (td?.resolvedBy && td?.resolvedAt) {
            ackResolve.push(
              `Resolved by *${td.resolvedBy}* (${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || inc.createdAt!, td.resolvedAt))})`,
            );
          } else if (!inc.currentIncidentState?.isResolvedState) {
            ackResolve.push(`_Not yet resolved_`);
          }
        }
        if (ackResolve.length > 0) {
          text += `\n${ackResolve.join("  |  ")}`;
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
          incidentSeverity: { name: true },
          incidentState: { name: true, isResolvedState: true },
          createdAt: true,
          resolvedAt: true,
        },
        props: { isRoot: true },
      });

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    if (Service.has(items, WorkspaceNotificationSummaryItem.TotalCount)) {
      const resolved: number = episodes.filter((e: IncidentEpisode) => {
        return e.incidentState?.isResolvedState;
      }).length;
      blocks.push(
        Service.md(
          `*Total:* ${episodes.length} episode${episodes.length !== 1 ? "s" : ""}    |    ` +
            `*Open:* ${episodes.length - resolved}    |    *Resolved:* ${resolved}`,
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
          parts.push(`${sev}: *${c}*`);
        }
        blocks.push(Service.md(`*By Severity:*  ${parts.join("  |  ")}`));
      }
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.StateBreakdown)) {
      const map: Map<string, number> = new Map();
      for (const e of episodes) {
        const s: string = e.incidentState?.name || "Unknown";
        map.set(s, (map.get(s) || 0) + 1);
      }
      if (map.size > 0) {
        const parts: Array<string> = [];
        for (const [state, c] of map) {
          parts.push(`${state}: *${c}*`);
        }
        blocks.push(Service.md(`*By State:*  ${parts.join("  |  ")}`));
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
            ? `*Mean Time to Resolve (MTTR):*  ${Service.formatDuration(Math.round(total / count))}  _(${count} resolved)_`
            : `*Mean Time to Resolve (MTTR):*  _No episodes resolved in this period_`,
        ),
      );
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.ListWithLinks)) {
      blocks.push(Service.divider());
      blocks.push(Service.md(`*Episode Details*`));

      if (episodes.length === 0) {
        blocks.push(
          Service.md(`_No incident episodes in this period._`),
        );
      }

      for (const ep of episodes) {
        const id: string = ep._id?.toString() || "";
        const link: string = URL.fromString(dashboardUrl.toString())
          .addRoute(`/${projectId.toString()}/incidents/episodes/${id}`)
          .toString();

        let text: string = `*<${link}|${ep.title || "Untitled Episode"}>*\n`;
        const meta: Array<string> = [];
        if (ep.incidentSeverity?.name) {
          meta.push(`Severity: *${ep.incidentSeverity.name}*`);
        }
        if (ep.incidentState?.name) {
          meta.push(`State: *${ep.incidentState.name}*`);
        }
        if (ep.createdAt) {
          meta.push(`Created: ${Service.formatDate(ep.createdAt)}`);
        }
        if (ep.resolvedAt) {
          meta.push(
            `Resolved in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(ep.createdAt!, ep.resolvedAt))}`,
          );
        }
        text += meta.join("  |  ");
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
  }): Promise<void> {
    if (data.type === WorkspaceNotificationSummaryType.AlertEpisode) {
      await this.buildAlertEpisodeBlocks(data);
      return;
    }

    const { blocks, items, fromDate, projectId } = data;

    const alerts: Array<Alert> = await AlertService.findAllBy({
      query: {
        projectId,
        createdAt: QueryHelper.greaterThanEqualTo(fromDate),
      },
      select: {
        _id: true,
        title: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        alertSeverity: { name: true },
        currentAlertState: {
          name: true,
          isResolvedState: true,
          isAcknowledgedState: true,
        },
        monitors: { name: true, _id: true },
        createdAt: true,
      },
      props: { isRoot: true },
    });

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    if (Service.has(items, WorkspaceNotificationSummaryItem.TotalCount)) {
      const resolved: number = alerts.filter((a: Alert) => {
        return a.currentAlertState?.isResolvedState;
      }).length;
      blocks.push(
        Service.md(
          `*Total:* ${alerts.length} alert${alerts.length !== 1 ? "s" : ""}    |    ` +
            `*Open:* ${alerts.length - resolved}    |    *Resolved:* ${resolved}`,
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
          parts.push(`${sev}: *${c}*`);
        }
        blocks.push(Service.md(`*By Severity:*  ${parts.join("  |  ")}`));
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
          parts.push(`${state}: *${c}*`);
        }
        blocks.push(Service.md(`*By State:*  ${parts.join("  |  ")}`));
      }
    }

    // ── Timeline data ──
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
          return a._id!;
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

    if (Service.has(items, WorkspaceNotificationSummaryItem.TimeToAcknowledge)) {
      const { avg, count } = this.computeAvg(tlMap, "ack");
      blocks.push(
        Service.md(
          count > 0
            ? `*Mean Time to Acknowledge (MTTA):*  ${Service.formatDuration(avg)}  _(${count} acknowledged)_`
            : `*Mean Time to Acknowledge (MTTA):*  _No alerts acknowledged in this period_`,
        ),
      );
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.TimeToResolve)) {
      const { avg, count } = this.computeAvg(tlMap, "resolve");
      blocks.push(
        Service.md(
          count > 0
            ? `*Mean Time to Resolve (MTTR):*  ${Service.formatDuration(avg)}  _(${count} resolved)_`
            : `*Mean Time to Resolve (MTTR):*  _No alerts resolved in this period_`,
        ),
      );
    }

    if (
      Service.has(items, WorkspaceNotificationSummaryItem.ResourcesAffected)
    ) {
      const names: Set<string> = new Set();
      for (const a of alerts) {
        if (a.monitors) {
          for (const m of a.monitors) {
            if (m.name) {
              names.add(m.name);
            }
          }
        }
      }
      if (names.size > 0) {
        blocks.push(
          Service.md(
            `*Resources Affected (${names.size}):*  ${Array.from(names).join(", ")}`,
          ),
        );
      }
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.ListWithLinks)) {
      blocks.push(Service.divider());
      blocks.push(Service.md(`*Alert Details*`));

      if (alerts.length === 0) {
        blocks.push(Service.md(`_No alerts reported in this period._`));
      }

      for (const a of alerts) {
        const id: string = a._id?.toString() || "";
        const display: string =
          a.alertNumberWithPrefix || `#${a.alertNumber || ""}`;
        const link: string = URL.fromString(dashboardUrl.toString())
          .addRoute(`/${projectId.toString()}/alerts/${id}`)
          .toString();
        const td: TimelineData | undefined = tlMap.get(id);

        let text: string = `*<${link}|${display} — ${a.title || "Untitled"}>*\n`;

        const meta: Array<string> = [];
        if (a.alertSeverity?.name) {
          meta.push(`Severity: *${a.alertSeverity.name}*`);
        }
        if (a.currentAlertState?.name) {
          meta.push(`State: *${a.currentAlertState.name}*`);
        }
        if (a.createdAt) {
          meta.push(`Created: ${Service.formatDate(a.createdAt)}`);
        }
        if (meta.length > 0) {
          text += meta.join("  |  ");
        }

        const ackResolve: Array<string> = [];
        if (
          Service.has(items, WorkspaceNotificationSummaryItem.WhoAcknowledged)
        ) {
          if (td?.ackBy && td?.ackAt) {
            ackResolve.push(
              `Acknowledged by *${td.ackBy}* (${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || a.createdAt!, td.ackAt))})`,
            );
          } else {
            ackResolve.push(`_Not yet acknowledged_`);
          }
        }
        if (Service.has(items, WorkspaceNotificationSummaryItem.WhoResolved)) {
          if (td?.resolvedBy && td?.resolvedAt) {
            ackResolve.push(
              `Resolved by *${td.resolvedBy}* (${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(td.declaredAt || a.createdAt!, td.resolvedAt))})`,
            );
          } else if (!a.currentAlertState?.isResolvedState) {
            ackResolve.push(`_Not yet resolved_`);
          }
        }
        if (ackResolve.length > 0) {
          text += `\n${ackResolve.join("  |  ")}`;
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
  }): Promise<void> {
    const { blocks, items, fromDate, projectId } = data;

    const episodes: Array<AlertEpisode> =
      await AlertEpisodeService.findAllBy({
        query: {
          projectId,
          createdAt: QueryHelper.greaterThanEqualTo(fromDate),
        },
        select: {
          _id: true,
          title: true,
          alertSeverity: { name: true },
          alertState: { name: true, isResolvedState: true },
          createdAt: true,
          resolvedAt: true,
        },
        props: { isRoot: true },
      });

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    if (Service.has(items, WorkspaceNotificationSummaryItem.TotalCount)) {
      const resolved: number = episodes.filter((e: AlertEpisode) => {
        return e.alertState?.isResolvedState;
      }).length;
      blocks.push(
        Service.md(
          `*Total:* ${episodes.length} episode${episodes.length !== 1 ? "s" : ""}    |    ` +
            `*Open:* ${episodes.length - resolved}    |    *Resolved:* ${resolved}`,
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
          parts.push(`${sev}: *${c}*`);
        }
        blocks.push(Service.md(`*By Severity:*  ${parts.join("  |  ")}`));
      }
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.StateBreakdown)) {
      const map: Map<string, number> = new Map();
      for (const e of episodes) {
        const s: string = e.alertState?.name || "Unknown";
        map.set(s, (map.get(s) || 0) + 1);
      }
      if (map.size > 0) {
        const parts: Array<string> = [];
        for (const [state, c] of map) {
          parts.push(`${state}: *${c}*`);
        }
        blocks.push(Service.md(`*By State:*  ${parts.join("  |  ")}`));
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
            ? `*Mean Time to Resolve (MTTR):*  ${Service.formatDuration(Math.round(total / count))}  _(${count} resolved)_`
            : `*Mean Time to Resolve (MTTR):*  _No episodes resolved in this period_`,
        ),
      );
    }

    if (Service.has(items, WorkspaceNotificationSummaryItem.ListWithLinks)) {
      blocks.push(Service.divider());
      blocks.push(Service.md(`*Episode Details*`));

      if (episodes.length === 0) {
        blocks.push(
          Service.md(`_No alert episodes in this period._`),
        );
      }

      for (const ep of episodes) {
        const id: string = ep._id?.toString() || "";
        const link: string = URL.fromString(dashboardUrl.toString())
          .addRoute(`/${projectId.toString()}/alerts/episodes/${id}`)
          .toString();

        let text: string = `*<${link}|${ep.title || "Untitled Episode"}>*\n`;
        const meta: Array<string> = [];
        if (ep.alertSeverity?.name) {
          meta.push(`Severity: *${ep.alertSeverity.name}*`);
        }
        if (ep.alertState?.name) {
          meta.push(`State: *${ep.alertState.name}*`);
        }
        if (ep.createdAt) {
          meta.push(`Created: ${Service.formatDate(ep.createdAt)}`);
        }
        if (ep.resolvedAt) {
          meta.push(
            `Resolved in ${Service.formatDuration(OneUptimeDate.getMinutesBetweenTwoDates(ep.createdAt!, ep.resolvedAt))}`,
          );
        }
        text += meta.join("  |  ");
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
    for (const [_id, td] of tlMap) {
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
