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
  WorkspacePayloadMarkdown,
} from "../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceUtil from "../Utils/Workspace/Workspace";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import URL from "../../Types/API/URL";
import DatabaseConfig from "../DatabaseConfig";

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
      await this.buildSummaryMessageBlocks({
        summary,
      });

    // Send message to all configured channels
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

    // Update lastSentAt
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

  @CaptureSpan()
  private async buildSummaryMessageBlocks(data: {
    summary: WorkspaceNotificationSummary;
  }): Promise<Array<WorkspaceMessageBlock>> {
    const { summary } = data;
    const blocks: Array<WorkspaceMessageBlock> = [];
    const summaryItems: Array<WorkspaceNotificationSummaryItem> =
      summary.summaryItems!;
    const numberOfDays: number = summary.numberOfDaysOfData || 7;
    const summaryType: WorkspaceNotificationSummaryType = summary.summaryType!;

    const fromDate: Date = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      -numberOfDays,
    );

    // Header
    const headerBlock: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: `📊 *${summaryType} Summary — Last ${numberOfDays} Day${numberOfDays !== 1 ? "s" : ""}*`,
    };
    blocks.push(headerBlock);

    const divider: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };
    blocks.push(divider);

    if (
      summaryType === WorkspaceNotificationSummaryType.Incident ||
      summaryType === WorkspaceNotificationSummaryType.IncidentEpisode
    ) {
      await this.buildIncidentSummaryBlocks({
        blocks,
        summaryItems,
        summaryType,
        fromDate,
        projectId: summary.projectId!,
      });
    } else {
      await this.buildAlertSummaryBlocks({
        blocks,
        summaryItems,
        summaryType,
        fromDate,
        projectId: summary.projectId!,
      });
    }

    return blocks;
  }

  @CaptureSpan()
  private async buildIncidentSummaryBlocks(data: {
    blocks: Array<WorkspaceMessageBlock>;
    summaryItems: Array<WorkspaceNotificationSummaryItem>;
    summaryType: WorkspaceNotificationSummaryType;
    fromDate: Date;
    projectId: ObjectID;
  }): Promise<void> {
    const { blocks, summaryItems, summaryType, fromDate, projectId } = data;

    if (summaryType === WorkspaceNotificationSummaryType.IncidentEpisode) {
      await this.buildIncidentEpisodeSummaryBlocks({
        blocks,
        summaryItems,
        fromDate,
        projectId,
      });
      return;
    }

    // Query incidents
    const incidents: Array<Incident> = await IncidentService.findAllBy({
      query: {
        projectId: projectId,
        createdAt: QueryHelper.greaterThanEqualTo(fromDate),
      },
      select: {
        _id: true,
        title: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        incidentSeverity: {
          name: true,
          color: true,
        },
        currentIncidentState: {
          name: true,
          color: true,
          isResolvedState: true,
          isAcknowledgedState: true,
        },
        monitors: {
          name: true,
          _id: true,
        },
        createdAt: true,
        declaredAt: true,
      },
      props: {
        isRoot: true,
      },
    });

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    // Total Count
    if (summaryItems.includes(WorkspaceNotificationSummaryItem.TotalCount)) {
      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text: `*Total Incidents:* ${incidents.length}`,
      } as WorkspacePayloadMarkdown);
    }

    // Severity Breakdown
    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.SeverityBreakdown)
    ) {
      const severityMap: Map<string, number> = new Map();
      for (const incident of incidents) {
        const severityName: string =
          incident.incidentSeverity?.name || "Unknown";
        severityMap.set(
          severityName,
          (severityMap.get(severityName) || 0) + 1,
        );
      }
      let severityText: string = "*Severity Breakdown:*\n";
      for (const [severity, count] of severityMap) {
        severityText += `  • ${severity}: ${count}\n`;
      }
      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text: severityText,
      } as WorkspacePayloadMarkdown);
    }

    // State Breakdown
    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.StateBreakdown)
    ) {
      const stateMap: Map<string, number> = new Map();
      for (const incident of incidents) {
        const stateName: string =
          incident.currentIncidentState?.name || "Unknown";
        stateMap.set(stateName, (stateMap.get(stateName) || 0) + 1);
      }
      let stateText: string = "*State Breakdown:*\n";
      for (const [state, count] of stateMap) {
        stateText += `  • ${state}: ${count}\n`;
      }
      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text: stateText,
      } as WorkspacePayloadMarkdown);
    }

    // Ack/Resolve times and who acked/resolved - query timelines
    const needsTimelineData: boolean =
      summaryItems.includes(
        WorkspaceNotificationSummaryItem.WhoAcknowledged,
      ) ||
      summaryItems.includes(WorkspaceNotificationSummaryItem.WhoResolved) ||
      summaryItems.includes(
        WorkspaceNotificationSummaryItem.TimeToAcknowledge,
      ) ||
      summaryItems.includes(WorkspaceNotificationSummaryItem.TimeToResolve);

    interface IncidentTimelineData {
      ackBy?: string;
      resolvedBy?: string;
      ackAt?: Date;
      resolvedAt?: Date;
      declaredAt?: Date;
    }

    const timelineDataMap: Map<string, IncidentTimelineData> = new Map();

    if (needsTimelineData && incidents.length > 0) {
      const incidentIds: Array<ObjectID> = incidents
        .filter((i: Incident) => {
          return i._id;
        })
        .map((i: Incident) => {
          return i._id!;
        });

      const timelines: Array<IncidentStateTimeline> =
        await IncidentStateTimelineService.findAllBy({
          query: {
            projectId: projectId,
            incidentId: QueryHelper.any(incidentIds),
          },
          select: {
            incidentId: true,
            incidentState: {
              isAcknowledgedState: true,
              isResolvedState: true,
            },
            createdByUser: {
              name: true,
              email: true,
            },
            createdAt: true,
          },
          props: {
            isRoot: true,
          },
        });

      for (const timeline of timelines) {
        const incidentId: string = timeline.incidentId?.toString() || "";
        if (!timelineDataMap.has(incidentId)) {
          timelineDataMap.set(incidentId, {});
        }
        const td: IncidentTimelineData = timelineDataMap.get(incidentId)!;

        if (timeline.incidentState?.isAcknowledgedState && !td.ackAt) {
          td.ackBy =
            timeline.createdByUser?.name?.toString() ||
            timeline.createdByUser?.email?.toString() ||
            "System";
          td.ackAt = timeline.createdAt;
        }
        if (timeline.incidentState?.isResolvedState && !td.resolvedAt) {
          td.resolvedBy =
            timeline.createdByUser?.name?.toString() ||
            timeline.createdByUser?.email?.toString() ||
            "System";
          td.resolvedAt = timeline.createdAt;
        }
      }

      // Set declaredAt from incidents
      for (const incident of incidents) {
        const id: string = incident._id?.toString() || "";
        if (!timelineDataMap.has(id)) {
          timelineDataMap.set(id, {});
        }
        timelineDataMap.get(id)!.declaredAt =
          incident.declaredAt || incident.createdAt;
      }
    }

    // Time to Acknowledge stats
    if (
      summaryItems.includes(
        WorkspaceNotificationSummaryItem.TimeToAcknowledge,
      )
    ) {
      let totalAckMinutes: number = 0;
      let ackCount: number = 0;
      for (const [_id, td] of timelineDataMap) {
        if (td.ackAt && td.declaredAt) {
          totalAckMinutes += OneUptimeDate.getMinutesBetweenTwoDates(
            td.declaredAt,
            td.ackAt,
          );
          ackCount++;
        }
      }
      if (ackCount > 0) {
        const avgMinutes: number = Math.round(totalAckMinutes / ackCount);
        const hours: number = Math.floor(avgMinutes / 60);
        const minutes: number = avgMinutes % 60;
        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: `*Average Time to Acknowledge:* ${hours}h ${minutes}m (${ackCount} incidents acknowledged)`,
        } as WorkspacePayloadMarkdown);
      } else {
        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: `*Average Time to Acknowledge:* N/A (no incidents acknowledged)`,
        } as WorkspacePayloadMarkdown);
      }
    }

    // Time to Resolve stats
    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.TimeToResolve)
    ) {
      let totalResolveMinutes: number = 0;
      let resolveCount: number = 0;
      for (const [_id, td] of timelineDataMap) {
        if (td.resolvedAt && td.declaredAt) {
          totalResolveMinutes += OneUptimeDate.getMinutesBetweenTwoDates(
            td.declaredAt,
            td.resolvedAt,
          );
          resolveCount++;
        }
      }
      if (resolveCount > 0) {
        const avgMinutes: number = Math.round(
          totalResolveMinutes / resolveCount,
        );
        const hours: number = Math.floor(avgMinutes / 60);
        const minutes: number = avgMinutes % 60;
        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: `*Average Time to Resolve:* ${hours}h ${minutes}m (${resolveCount} incidents resolved)`,
        } as WorkspacePayloadMarkdown);
      } else {
        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: `*Average Time to Resolve:* N/A (no incidents resolved)`,
        } as WorkspacePayloadMarkdown);
      }
    }

    // Resources Affected
    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.ResourcesAffected)
    ) {
      const monitorNames: Set<string> = new Set();
      for (const incident of incidents) {
        if (incident.monitors) {
          for (const monitor of incident.monitors) {
            if (monitor.name) {
              monitorNames.add(monitor.name);
            }
          }
        }
      }
      if (monitorNames.size > 0) {
        let resourceText: string = `*Resources Affected (${monitorNames.size}):*\n`;
        for (const name of monitorNames) {
          resourceText += `  • ${name}\n`;
        }
        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: resourceText,
        } as WorkspacePayloadMarkdown);
      }
    }

    // List with Links (and per-incident details)
    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.ListWithLinks)
    ) {
      blocks.push({
        _type: "WorkspacePayloadDivider",
      } as WorkspacePayloadDivider);

      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text: "*Incident List:*",
      } as WorkspacePayloadMarkdown);

      for (const incident of incidents) {
        const incidentId: string = incident._id?.toString() || "";
        const incidentDisplay: string =
          incident.incidentNumberWithPrefix ||
          `#${incident.incidentNumber || ""}`;
        const link: string = URL.fromString(dashboardUrl.toString())
          .addRoute(
            `/${projectId.toString()}/incidents/${incidentId}`,
          )
          .toString();

        let itemText: string = `• *<${link}|${incidentDisplay}>* — ${incident.title || "Untitled"}`;

        if (incident.incidentSeverity?.name) {
          itemText += ` | Severity: ${incident.incidentSeverity.name}`;
        }
        if (incident.currentIncidentState?.name) {
          itemText += ` | State: ${incident.currentIncidentState.name}`;
        }

        const td: IncidentTimelineData | undefined =
          timelineDataMap.get(incidentId);

        if (
          summaryItems.includes(
            WorkspaceNotificationSummaryItem.WhoAcknowledged,
          ) &&
          td?.ackBy
        ) {
          itemText += ` | Acked by: ${td.ackBy}`;
        }

        if (
          summaryItems.includes(
            WorkspaceNotificationSummaryItem.WhoResolved,
          ) &&
          td?.resolvedBy
        ) {
          itemText += ` | Resolved by: ${td.resolvedBy}`;
        }

        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: itemText,
        } as WorkspacePayloadMarkdown);
      }

      if (incidents.length === 0) {
        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: "_No incidents in this period._",
        } as WorkspacePayloadMarkdown);
      }
    }

    return;
  }

  @CaptureSpan()
  private async buildIncidentEpisodeSummaryBlocks(data: {
    blocks: Array<WorkspaceMessageBlock>;
    summaryItems: Array<WorkspaceNotificationSummaryItem>;
    fromDate: Date;
    projectId: ObjectID;
  }): Promise<void> {
    const { blocks, summaryItems, fromDate, projectId } = data;

    const episodes: Array<IncidentEpisode> =
      await IncidentEpisodeService.findAllBy({
        query: {
          projectId: projectId,
          createdAt: QueryHelper.greaterThanEqualTo(fromDate),
        },
        select: {
          _id: true,
          title: true,
          incidentSeverity: {
            name: true,
          },
          incidentState: {
            name: true,
            isResolvedState: true,
          },
          createdAt: true,
          resolvedAt: true,
        },
        props: {
          isRoot: true,
        },
      });

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    if (summaryItems.includes(WorkspaceNotificationSummaryItem.TotalCount)) {
      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text: `*Total Incident Episodes:* ${episodes.length}`,
      } as WorkspacePayloadMarkdown);
    }

    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.SeverityBreakdown)
    ) {
      const severityMap: Map<string, number> = new Map();
      for (const episode of episodes) {
        const name: string = episode.incidentSeverity?.name || "Unknown";
        severityMap.set(name, (severityMap.get(name) || 0) + 1);
      }
      let text: string = "*Severity Breakdown:*\n";
      for (const [severity, count] of severityMap) {
        text += `  • ${severity}: ${count}\n`;
      }
      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text,
      } as WorkspacePayloadMarkdown);
    }

    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.StateBreakdown)
    ) {
      const stateMap: Map<string, number> = new Map();
      for (const episode of episodes) {
        const name: string = episode.incidentState?.name || "Unknown";
        stateMap.set(name, (stateMap.get(name) || 0) + 1);
      }
      let text: string = "*State Breakdown:*\n";
      for (const [state, count] of stateMap) {
        text += `  • ${state}: ${count}\n`;
      }
      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text,
      } as WorkspacePayloadMarkdown);
    }

    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.TimeToResolve)
    ) {
      let totalMinutes: number = 0;
      let count: number = 0;
      for (const episode of episodes) {
        if (episode.resolvedAt && episode.createdAt) {
          totalMinutes += OneUptimeDate.getMinutesBetweenTwoDates(
            episode.createdAt,
            episode.resolvedAt,
          );
          count++;
        }
      }
      if (count > 0) {
        const avg: number = Math.round(totalMinutes / count);
        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: `*Average Time to Resolve:* ${Math.floor(avg / 60)}h ${avg % 60}m (${count} episodes resolved)`,
        } as WorkspacePayloadMarkdown);
      }
    }

    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.ListWithLinks)
    ) {
      blocks.push({
        _type: "WorkspacePayloadDivider",
      } as WorkspacePayloadDivider);

      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text: "*Incident Episode List:*",
      } as WorkspacePayloadMarkdown);

      for (const episode of episodes) {
        const episodeId: string = episode._id?.toString() || "";
        const link: string = URL.fromString(dashboardUrl.toString())
          .addRoute(
            `/${projectId.toString()}/incidents/episodes/${episodeId}`,
          )
          .toString();

        let itemText: string = `• *<${link}|${episode.title || "Untitled Episode"}>*`;
        if (episode.incidentSeverity?.name) {
          itemText += ` | Severity: ${episode.incidentSeverity.name}`;
        }
        if (episode.incidentState?.name) {
          itemText += ` | State: ${episode.incidentState.name}`;
        }

        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: itemText,
        } as WorkspacePayloadMarkdown);
      }

      if (episodes.length === 0) {
        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: "_No incident episodes in this period._",
        } as WorkspacePayloadMarkdown);
      }
    }
  }

  @CaptureSpan()
  private async buildAlertSummaryBlocks(data: {
    blocks: Array<WorkspaceMessageBlock>;
    summaryItems: Array<WorkspaceNotificationSummaryItem>;
    summaryType: WorkspaceNotificationSummaryType;
    fromDate: Date;
    projectId: ObjectID;
  }): Promise<void> {
    const { blocks, summaryItems, summaryType, fromDate, projectId } = data;

    if (summaryType === WorkspaceNotificationSummaryType.AlertEpisode) {
      await this.buildAlertEpisodeSummaryBlocks({
        blocks,
        summaryItems,
        fromDate,
        projectId,
      });
      return;
    }

    const alerts: Array<Alert> = await AlertService.findAllBy({
      query: {
        projectId: projectId,
        createdAt: QueryHelper.greaterThanEqualTo(fromDate),
      },
      select: {
        _id: true,
        title: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        alertSeverity: {
          name: true,
        },
        currentAlertState: {
          name: true,
          isResolvedState: true,
          isAcknowledgedState: true,
        },
        monitors: {
          name: true,
          _id: true,
        },
        createdAt: true,
      },
      props: {
        isRoot: true,
      },
    });

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    if (summaryItems.includes(WorkspaceNotificationSummaryItem.TotalCount)) {
      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text: `*Total Alerts:* ${alerts.length}`,
      } as WorkspacePayloadMarkdown);
    }

    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.SeverityBreakdown)
    ) {
      const severityMap: Map<string, number> = new Map();
      for (const alert of alerts) {
        const name: string = alert.alertSeverity?.name || "Unknown";
        severityMap.set(name, (severityMap.get(name) || 0) + 1);
      }
      let text: string = "*Severity Breakdown:*\n";
      for (const [severity, count] of severityMap) {
        text += `  • ${severity}: ${count}\n`;
      }
      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text,
      } as WorkspacePayloadMarkdown);
    }

    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.StateBreakdown)
    ) {
      const stateMap: Map<string, number> = new Map();
      for (const alert of alerts) {
        const name: string = alert.currentAlertState?.name || "Unknown";
        stateMap.set(name, (stateMap.get(name) || 0) + 1);
      }
      let text: string = "*State Breakdown:*\n";
      for (const [state, count] of stateMap) {
        text += `  • ${state}: ${count}\n`;
      }
      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text,
      } as WorkspacePayloadMarkdown);
    }

    // Ack/Resolve timeline data for alerts
    const needsTimelineData: boolean =
      summaryItems.includes(
        WorkspaceNotificationSummaryItem.WhoAcknowledged,
      ) ||
      summaryItems.includes(WorkspaceNotificationSummaryItem.WhoResolved) ||
      summaryItems.includes(
        WorkspaceNotificationSummaryItem.TimeToAcknowledge,
      ) ||
      summaryItems.includes(WorkspaceNotificationSummaryItem.TimeToResolve);

    interface AlertTimelineData {
      ackBy?: string;
      resolvedBy?: string;
      ackAt?: Date;
      resolvedAt?: Date;
      createdAt?: Date;
    }

    const timelineDataMap: Map<string, AlertTimelineData> = new Map();

    if (needsTimelineData && alerts.length > 0) {
      const alertIds: Array<ObjectID> = alerts
        .filter((a: Alert) => {
          return a._id;
        })
        .map((a: Alert) => {
          return a._id!;
        });

      const timelines: Array<AlertStateTimeline> =
        await AlertStateTimelineService.findAllBy({
          query: {
            projectId: projectId,
            alertId: QueryHelper.any(alertIds),
          },
          select: {
            alertId: true,
            alertState: {
              isAcknowledgedState: true,
              isResolvedState: true,
            },
            createdByUser: {
              name: true,
              email: true,
            },
            createdAt: true,
          },
          props: {
            isRoot: true,
          },
        });

      for (const timeline of timelines) {
        const alertId: string = timeline.alertId?.toString() || "";
        if (!timelineDataMap.has(alertId)) {
          timelineDataMap.set(alertId, {});
        }
        const td: AlertTimelineData = timelineDataMap.get(alertId)!;

        if (timeline.alertState?.isAcknowledgedState && !td.ackAt) {
          td.ackBy =
            timeline.createdByUser?.name?.toString() ||
            timeline.createdByUser?.email?.toString() ||
            "System";
          td.ackAt = timeline.createdAt;
        }
        if (timeline.alertState?.isResolvedState && !td.resolvedAt) {
          td.resolvedBy =
            timeline.createdByUser?.name?.toString() ||
            timeline.createdByUser?.email?.toString() ||
            "System";
          td.resolvedAt = timeline.createdAt;
        }
      }

      for (const alert of alerts) {
        const id: string = alert._id?.toString() || "";
        if (!timelineDataMap.has(id)) {
          timelineDataMap.set(id, {});
        }
        timelineDataMap.get(id)!.createdAt = alert.createdAt;
      }
    }

    if (
      summaryItems.includes(
        WorkspaceNotificationSummaryItem.TimeToAcknowledge,
      )
    ) {
      let totalMinutes: number = 0;
      let count: number = 0;
      for (const [_id, td] of timelineDataMap) {
        if (td.ackAt && td.createdAt) {
          totalMinutes += OneUptimeDate.getMinutesBetweenTwoDates(
            td.createdAt,
            td.ackAt,
          );
          count++;
        }
      }
      if (count > 0) {
        const avg: number = Math.round(totalMinutes / count);
        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: `*Average Time to Acknowledge:* ${Math.floor(avg / 60)}h ${avg % 60}m (${count} alerts acknowledged)`,
        } as WorkspacePayloadMarkdown);
      } else {
        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: `*Average Time to Acknowledge:* N/A (no alerts acknowledged)`,
        } as WorkspacePayloadMarkdown);
      }
    }

    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.TimeToResolve)
    ) {
      let totalMinutes: number = 0;
      let count: number = 0;
      for (const [_id, td] of timelineDataMap) {
        if (td.resolvedAt && td.createdAt) {
          totalMinutes += OneUptimeDate.getMinutesBetweenTwoDates(
            td.createdAt,
            td.resolvedAt,
          );
          count++;
        }
      }
      if (count > 0) {
        const avg: number = Math.round(totalMinutes / count);
        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: `*Average Time to Resolve:* ${Math.floor(avg / 60)}h ${avg % 60}m (${count} alerts resolved)`,
        } as WorkspacePayloadMarkdown);
      } else {
        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: `*Average Time to Resolve:* N/A (no alerts resolved)`,
        } as WorkspacePayloadMarkdown);
      }
    }

    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.ResourcesAffected)
    ) {
      const monitorNames: Set<string> = new Set();
      for (const alert of alerts) {
        if (alert.monitors) {
          for (const monitor of alert.monitors) {
            if (monitor.name) {
              monitorNames.add(monitor.name);
            }
          }
        }
      }
      if (monitorNames.size > 0) {
        let text: string = `*Resources Affected (${monitorNames.size}):*\n`;
        for (const name of monitorNames) {
          text += `  • ${name}\n`;
        }
        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text,
        } as WorkspacePayloadMarkdown);
      }
    }

    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.ListWithLinks)
    ) {
      blocks.push({
        _type: "WorkspacePayloadDivider",
      } as WorkspacePayloadDivider);

      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text: "*Alert List:*",
      } as WorkspacePayloadMarkdown);

      for (const alert of alerts) {
        const alertId: string = alert._id?.toString() || "";
        const alertDisplay: string =
          alert.alertNumberWithPrefix || `#${alert.alertNumber || ""}`;
        const link: string = URL.fromString(dashboardUrl.toString())
          .addRoute(`/${projectId.toString()}/alerts/${alertId}`)
          .toString();

        let itemText: string = `• *<${link}|${alertDisplay}>* — ${alert.title || "Untitled"}`;
        if (alert.alertSeverity?.name) {
          itemText += ` | Severity: ${alert.alertSeverity.name}`;
        }
        if (alert.currentAlertState?.name) {
          itemText += ` | State: ${alert.currentAlertState.name}`;
        }

        const td: AlertTimelineData | undefined =
          timelineDataMap.get(alertId);

        if (
          summaryItems.includes(
            WorkspaceNotificationSummaryItem.WhoAcknowledged,
          ) &&
          td?.ackBy
        ) {
          itemText += ` | Acked by: ${td.ackBy}`;
        }

        if (
          summaryItems.includes(
            WorkspaceNotificationSummaryItem.WhoResolved,
          ) &&
          td?.resolvedBy
        ) {
          itemText += ` | Resolved by: ${td.resolvedBy}`;
        }

        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: itemText,
        } as WorkspacePayloadMarkdown);
      }

      if (alerts.length === 0) {
        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: "_No alerts in this period._",
        } as WorkspacePayloadMarkdown);
      }
    }
  }

  @CaptureSpan()
  private async buildAlertEpisodeSummaryBlocks(data: {
    blocks: Array<WorkspaceMessageBlock>;
    summaryItems: Array<WorkspaceNotificationSummaryItem>;
    fromDate: Date;
    projectId: ObjectID;
  }): Promise<void> {
    const { blocks, summaryItems, fromDate, projectId } = data;

    const episodes: Array<AlertEpisode> =
      await AlertEpisodeService.findAllBy({
        query: {
          projectId: projectId,
          createdAt: QueryHelper.greaterThanEqualTo(fromDate),
        },
        select: {
          _id: true,
          title: true,
          alertSeverity: {
            name: true,
          },
          alertState: {
            name: true,
            isResolvedState: true,
          },
          createdAt: true,
          resolvedAt: true,
        },
        props: {
          isRoot: true,
        },
      });

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    if (summaryItems.includes(WorkspaceNotificationSummaryItem.TotalCount)) {
      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text: `*Total Alert Episodes:* ${episodes.length}`,
      } as WorkspacePayloadMarkdown);
    }

    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.SeverityBreakdown)
    ) {
      const severityMap: Map<string, number> = new Map();
      for (const episode of episodes) {
        const name: string = episode.alertSeverity?.name || "Unknown";
        severityMap.set(name, (severityMap.get(name) || 0) + 1);
      }
      let text: string = "*Severity Breakdown:*\n";
      for (const [severity, count] of severityMap) {
        text += `  • ${severity}: ${count}\n`;
      }
      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text,
      } as WorkspacePayloadMarkdown);
    }

    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.StateBreakdown)
    ) {
      const stateMap: Map<string, number> = new Map();
      for (const episode of episodes) {
        const name: string = episode.alertState?.name || "Unknown";
        stateMap.set(name, (stateMap.get(name) || 0) + 1);
      }
      let text: string = "*State Breakdown:*\n";
      for (const [state, count] of stateMap) {
        text += `  • ${state}: ${count}\n`;
      }
      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text,
      } as WorkspacePayloadMarkdown);
    }

    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.TimeToResolve)
    ) {
      let totalMinutes: number = 0;
      let count: number = 0;
      for (const episode of episodes) {
        if (episode.resolvedAt && episode.createdAt) {
          totalMinutes += OneUptimeDate.getMinutesBetweenTwoDates(
            episode.createdAt,
            episode.resolvedAt,
          );
          count++;
        }
      }
      if (count > 0) {
        const avg: number = Math.round(totalMinutes / count);
        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: `*Average Time to Resolve:* ${Math.floor(avg / 60)}h ${avg % 60}m (${count} episodes resolved)`,
        } as WorkspacePayloadMarkdown);
      }
    }

    if (
      summaryItems.includes(WorkspaceNotificationSummaryItem.ListWithLinks)
    ) {
      blocks.push({
        _type: "WorkspacePayloadDivider",
      } as WorkspacePayloadDivider);

      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text: "*Alert Episode List:*",
      } as WorkspacePayloadMarkdown);

      for (const episode of episodes) {
        const episodeId: string = episode._id?.toString() || "";
        const link: string = URL.fromString(dashboardUrl.toString())
          .addRoute(
            `/${projectId.toString()}/alerts/episodes/${episodeId}`,
          )
          .toString();

        let itemText: string = `• *<${link}|${episode.title || "Untitled Episode"}>*`;
        if (episode.alertSeverity?.name) {
          itemText += ` | Severity: ${episode.alertSeverity.name}`;
        }
        if (episode.alertState?.name) {
          itemText += ` | State: ${episode.alertState.name}`;
        }

        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: itemText,
        } as WorkspacePayloadMarkdown);
      }

      if (episodes.length === 0) {
        blocks.push({
          _type: "WorkspacePayloadMarkdown",
          text: "_No alert episodes in this period._",
        } as WorkspacePayloadMarkdown);
      }
    }
  }
}

export default new Service();
