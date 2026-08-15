import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorOwnerTeam from "../../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import Query from "../../../../Types/BaseDatabase/Query";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import MonitorService from "../../../Services/MonitorService";
import MonitorOwnerTeamService from "../../../Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../Services/MonitorOwnerUserService";
import MonitorStatusService from "../../../Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../Services/MonitorStatusTimelineService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the Monitor model class is fully wired up,
 * so calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedReadPermissions: Array<Permission> | null = null;
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      cachedReadPermissions = new Monitor().getReadPermissions();
    }
    return cachedReadPermissions;
  };

export const QueryMonitorsTool: ObservabilityTool = {
  name: "query_monitors",
  description:
    "List monitors in this project with their current status (name and color). To answer 'which monitors are down / not operational right now?' pass problemsOnly=true — it returns only monitors whose current status is not an operational state. To list monitors in one specific status (e.g. 'Degraded' or 'Offline'), pass monitorStatusName (case-insensitive). Returned monitors are ordered problems-first (worst status first, then name); the result reports the total match count — pass skip to page through more. Pass monitorId to get one monitor's details, its owners (teams and users) and its recent status timeline (when it went up or down).",
  inputSchema: {
    type: "object",
    properties: {
      monitorId: {
        type: "string",
        description:
          "Get one monitor by its ID, including its owners and recent status timeline.",
      },
      nameSearch: {
        type: "string",
        description: "Filter monitors whose name contains this text.",
      },
      monitorStatusName: {
        type: "string",
        description:
          "Only monitors currently in this status, matched by MonitorStatus name (case-insensitive, e.g. 'Operational', 'Degraded', 'Offline'). If nothing matches, the result lists the status names that exist in this project.",
      },
      problemsOnly: {
        type: "boolean",
        description:
          "true = only monitors whose current status is NOT an operational state (i.e. degraded/offline/any custom problem status). Use this to answer 'what is down right now?'.",
      },
      limit: {
        type: "number",
        description: "Maximum monitors to return (default 25, max 50).",
      },
      skip: {
        type: "number",
        description:
          "Rows to skip for paging through a large result (default 0, max 500).",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const monitorId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "monitorId",
    );

    if (monitorId) {
      const monitor: Monitor | null = await MonitorService.findOneById({
        id: monitorId,
        select: {
          _id: true,
          name: true,
          monitorType: true,
          currentMonitorStatus: {
            name: true,
            color: true,
          },
        },
        props: ctx.props,
      });

      /*
       * projectId is pinned to the tenant from ctx on every query keyed by
       * monitorId, because monitorId is an untrusted model argument.
       */
      const timeline: Array<MonitorStatusTimeline> =
        await MonitorStatusTimelineService.findBy({
          query: {
            monitorId: monitorId,
            projectId: ctx.projectId,
          },
          select: {
            createdAt: true,
            monitorStatus: {
              name: true,
            },
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
          limit: 20,
          skip: 0,
          props: ctx.props,
        });

      let ownerTeamNames: string = "";
      let ownerUserNames: string = "";

      if (monitor) {
        // Owners live in join tables, not on the Monitor row itself.
        const ownerTeams: Array<MonitorOwnerTeam> =
          await MonitorOwnerTeamService.findBy({
            query: {
              monitorId: monitorId,
              projectId: ctx.projectId,
            },
            select: {
              _id: true,
              team: {
                name: true,
              },
            },
            limit: 10,
            skip: 0,
            props: ctx.props,
          });

        const ownerUsers: Array<MonitorOwnerUser> =
          await MonitorOwnerUserService.findBy({
            query: {
              monitorId: monitorId,
              projectId: ctx.projectId,
            },
            select: {
              _id: true,
              user: {
                name: true,
                email: true,
              },
            },
            limit: 10,
            skip: 0,
            props: ctx.props,
          });

        ownerTeamNames = ownerTeams
          .map((ownerTeam: MonitorOwnerTeam) => {
            return ownerTeam.team?.name || "";
          })
          .filter((value: string) => {
            return value.length > 0;
          })
          .join(", ");

        ownerUserNames = ownerUsers
          .map((ownerUser: MonitorOwnerUser) => {
            return (
              ownerUser.user?.name?.toString() ||
              ownerUser.user?.email?.toString() ||
              ""
            );
          })
          .filter((value: string) => {
            return value.length > 0;
          })
          .join(", ");
      }

      const rows: Array<JSONObject> = [];

      if (monitor) {
        rows.push({
          record: "monitor",
          id: monitor.id?.toString(),
          name: monitor.name,
          type: monitor.monitorType,
          currentStatus: monitor.currentMonitorStatus?.name,
          statusColor: monitor.currentMonitorStatus?.color?.toString(),
          ownerTeams: ownerTeamNames || undefined,
          ownerUsers: ownerUserNames || undefined,
        });
      }

      for (const item of timeline) {
        rows.push({
          record: "statusChange",
          status: item.monitorStatus?.name,
          at: item.createdAt,
        });
      }

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      const cardFields: Array<{ label: string; value: string }> = [];
      if (monitor?.monitorType) {
        cardFields.push({ label: "Type", value: String(monitor.monitorType) });
      }
      if (monitor?.currentMonitorStatus?.name) {
        cardFields.push({
          label: "Status",
          value: monitor.currentMonitorStatus.name,
        });
      }
      if (ownerTeamNames) {
        cardFields.push({ label: "Owner teams", value: ownerTeamNames });
      }
      if (ownerUserNames) {
        cardFields.push({ label: "Owner users", value: ownerUserNames });
      }

      return {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `Monitor ${monitor?.name || monitorId.toString()} + status timeline`,
        citationTarget: {
          type: AIChatCitationTargetType.MonitorView,
          params: { monitorId: monitorId.toString() },
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
        widget: monitor
          ? WidgetBuilder.resourceCard({
              title: `Monitor ${monitor.name || ""}`.trim(),
              resourceType: "Monitor",
              heading: monitor.name || "Monitor",
              subheading: monitor.currentMonitorStatus?.name,
              fields: cardFields,
              link: {
                type: AIChatCitationTargetType.MonitorView,
                params: { monitorId: monitorId.toString() },
              },
            })
          : undefined,
      };
    }

    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 25,
      min: 1,
      max: 50,
    });
    const skip: number = ToolArgs.getNumber(args, "skip", {
      defaultValue: 0,
      min: 0,
      max: 500,
    });
    const nameSearch: string | undefined = ToolArgs.getString(
      args,
      "nameSearch",
    );
    const monitorStatusName: string | undefined = ToolArgs.getString(
      args,
      "monitorStatusName",
    );
    const problemsOnly: boolean =
      ToolArgs.getBoolean(args, "problemsOnly") === true;

    const query: Query<Monitor> = {};

    if (nameSearch) {
      query.name = QueryHelper.search(nameSearch);
    }

    /*
     * "Not operational" is matched through the MonitorStatus flag rather than
     * status names, so custom problem statuses ("Maintenance", "Partial
     * outage", …) are still caught.
     */
    if (problemsOnly) {
      query.currentMonitorStatus = { isOperationalState: false };
    }

    if (monitorStatusName) {
      /*
       * Status names are matched case-insensitively against this project's
       * MonitorStatus rows first, then the monitors are filtered by the
       * matched status ids — a name typo therefore fails loudly with the list
       * of real status names instead of silently returning zero monitors.
       */
      const statuses: Array<MonitorStatus> = await MonitorStatusService.findBy({
        query: {},
        select: {
          _id: true,
          name: true,
        },
        sort: {
          priority: SortOrder.Ascending,
        },
        limit: 100,
        skip: 0,
        props: ctx.props,
      });

      const wanted: string = monitorStatusName.toLowerCase();

      let matched: Array<MonitorStatus> = statuses.filter(
        (status: MonitorStatus) => {
          return (status.name || "").toLowerCase() === wanted;
        },
      );

      // Fall back to substring matching ("degrade" → "Degraded").
      if (matched.length === 0) {
        matched = statuses.filter((status: MonitorStatus) => {
          return (status.name || "").toLowerCase().includes(wanted);
        });
      }

      if (matched.length === 0) {
        const availableNames: string = statuses
          .map((status: MonitorStatus) => {
            return status.name || "";
          })
          .filter((value: string) => {
            return value.length > 0;
          })
          .join(", ");

        return {
          dataForLlm: `No monitor status matches "${monitorStatusName}". Statuses in this project: ${availableNames || "(none)"}. Retry with one of these names, or use problemsOnly=true for all non-operational monitors.`,
          rowCount: 0,
          citationLabel: `Monitors in status "${monitorStatusName}" (0 found)`,
          citationTarget: {
            type: AIChatCitationTargetType.Monitors,
          },
          redactionCount: 0,
          isTruncated: false,
        };
      }

      const matchedIds: Array<ObjectID> = [];
      for (const status of matched) {
        if (status.id) {
          matchedIds.push(status.id);
        }
      }

      query.currentMonitorStatusId = QueryHelper.any(matchedIds);
    }

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: query,
      select: {
        _id: true,
        name: true,
        monitorType: true,
        currentMonitorStatus: {
          name: true,
          color: true,
          priority: true,
          isOperationalState: true,
        },
      },
      sort: {
        name: SortOrder.Ascending,
      },
      limit: limit,
      skip: skip,
      props: ctx.props,
    });

    const totalCount: number = (
      await MonitorService.countBy({
        query: query,
        props: ctx.props,
      })
    ).toNumber();

    /*
     * Page boundaries are defined by the stable name-ascending DB sort; the
     * fetched page is then reordered problems-first (higher status priority =
     * worse, shown first) so a mixed page leads with what is broken. To scan
     * ALL problem monitors across a large project, problemsOnly=true is the
     * reliable filter — this reorder is presentation only.
     */
    const sortedMonitors: Array<Monitor> = [...monitors].sort(
      (a: Monitor, b: Monitor): number => {
        const aProblem: boolean =
          a.currentMonitorStatus?.isOperationalState === false;
        const bProblem: boolean =
          b.currentMonitorStatus?.isOperationalState === false;
        if (aProblem !== bProblem) {
          return aProblem ? -1 : 1;
        }
        const aPriority: number = a.currentMonitorStatus?.priority ?? 0;
        const bPriority: number = b.currentMonitorStatus?.priority ?? 0;
        if (aPriority !== bPriority) {
          return bPriority - aPriority;
        }
        return (a.name || "").localeCompare(b.name || "");
      },
    );

    const rows: Array<JSONObject> = sortedMonitors.map((monitor: Monitor) => {
      return {
        id: monitor.id?.toString(),
        name: monitor.name,
        type: monitor.monitorType,
        currentStatus: monitor.currentMonitorStatus?.name,
        statusColor: monitor.currentMonitorStatus?.color?.toString(),
        isOperational: monitor.currentMonitorStatus?.isOperationalState,
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    let dataForLlm: string = serialized.text;
    if (rows.length > 0 && totalCount > rows.length) {
      dataForLlm = `Showing rows ${skip + 1}–${skip + rows.length} of ${totalCount} total. Pass skip to page further.\n${serialized.text}`;
    }

    let scopeLabel: string;
    if (monitorStatusName) {
      scopeLabel = `Monitors in status "${monitorStatusName}"`;
    } else if (problemsOnly) {
      scopeLabel = "Monitors with problems";
    } else {
      scopeLabel = "Monitors";
    }

    const citationLabel: string =
      totalCount > serialized.rowCount
        ? `${scopeLabel} (${serialized.rowCount} of ${totalCount})`
        : `${scopeLabel} (${serialized.rowCount} found)`;

    return {
      dataForLlm: dataForLlm,
      rowCount: serialized.rowCount,
      citationLabel: citationLabel,
      citationTarget: {
        type: AIChatCitationTargetType.Monitors,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `${scopeLabel} (${rows.length})`,
              description: problemsOnly
                ? "Only monitors whose current status is not operational"
                : "Non-operational monitors first",
              columns: [
                { key: "name", title: "Monitor", type: "text" },
                { key: "type", title: "Type", type: "text" },
                { key: "currentStatus", title: "Status", type: "text" },
              ],
              rows: rows,
              link: { type: AIChatCitationTargetType.Monitors },
            })
          : undefined,
    };
  },
};
