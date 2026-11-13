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
import { Gray500 } from "../../../../Types/BrandColors";
import MonitorService from "../../../Services/MonitorService";
import MonitorOwnerTeamService from "../../../Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../Services/MonitorOwnerUserService";
import MonitorStatusService from "../../../Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../Services/MonitorStatusTimelineService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import { getMonitorCardWords } from "./ReadCardWords";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import { translationKey } from "../../../../Types/Translator";
import NotOperationalMonitorQuery from "../../../../Utils/Monitor/NotOperationalMonitorQuery";
import MonitoringOff, {
  MONITORING_OFF_SELECT,
} from "../../../../Utils/Monitor/MonitoringOff";

/*
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the Monitor model class is fully wired up,
 * so calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedReadPermissions: Array<Permission> | null = null;

/*
 * An archived monitor is not monitored, so the status it shows is the one it
 * had when it was archived. The list leaves archived monitors out (as the
 * Monitors page does), so "what is down right now?" never names one; read by
 * id, it is still returned, flagged, with this said alongside.
 */
export const ARCHIVED_MONITOR_NOTE: string =
  "This monitor is archived: it is not being monitored, so its status is the one it had when it was archived. Unarchive it to monitor it again.";

/*
 * A monitor whose monitoring is turned off is not checked either
 * (Utils/Monitor/MonitoringOff): the status it holds is only what its last
 * check saw. The list keeps it - it is still one of the project's monitors -
 * but after every monitor that is checked, its row saying monitoringOff=true,
 * and no status filter matches it; read by id, this is said alongside. So
 * the model never reports a monitor nobody checks as down, or as up.
 */
export const MONITORING_OFF_MONITOR_NOTE: string =
  "This monitor's monitoring is turned off: nothing checks it, so its status is only what its last check saw before monitoring was turned off, not a live one. Turn its monitoring on to check it again.";

export const MONITORING_OFF_LIST_NOTE: string =
  "Rows with monitoringOff=true are monitors whose monitoring is turned off: nothing checks them, so their currentStatus is only what their last check saw before monitoring was turned off. Do not report them as down or as up now; say their monitoring is off. They are listed after the monitors that are checked.";

/*
 * What the chat says for such a monitor - its table's Status, its card's
 * line under the name (AI_READ_CARD_LINES.disabled, in the reader's
 * language): the Monitors table's word. The card names the status the
 * monitor was frozen at as its last one (AI_READ_CARD_FACTS.lastStatus).
 */
export const MONITORING_OFF_STATUS_TEXT: string = "Disabled";
export const MONITORING_OFF_LAST_STATUS_LABEL: string = "Last status";

/*
 * What the chat's table of monitors says of its order, on one line under its
 * title (which says they are monitors), cut where it is too long: about 40
 * characters fit beside Open on a 360px phone.
 */
export const MONITOR_TABLE_ORDER_TEXT: string =
  "Non-operational monitors first";
export const MONITOR_TABLE_ORDER_WITH_MONITORING_OFF_TEXT: string =
  "Non-operational first, Disabled last";

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
    "List monitors in this project with their current status (name and color). Archived monitors are left out of the list - they are not monitored; pass monitorId to read one. A monitor whose monitoring is turned off is listed with monitoringOff=true: nothing checks it, so its status is stale (only what its last check saw before monitoring was turned off) - never report it as down or as up now. To answer 'which monitors are down / not operational right now?' pass problemsOnly=true — it returns only monitors whose current status is not an operational state, leaving out monitors whose monitoring is turned off. To list monitors in one specific status (e.g. 'Degraded' or 'Offline'), pass monitorStatusName (case-insensitive); it matches only monitors whose monitoring is on, too. Returned monitors are ordered problems-first (worst status first, then name), with monitors whose monitoring is turned off last; the result reports the total match count — pass skip to page through more. Pass monitorId to get one monitor's details, whether its monitoring is off, its owners (teams and users) and its recent status timeline (when it went up or down).",
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
          "Only monitors currently in this status, matched by MonitorStatus name (case-insensitive, e.g. 'Operational', 'Degraded', 'Offline'), among those whose monitoring is on. If nothing matches, the result lists the status names that exist in this project.",
      },
      problemsOnly: {
        type: "boolean",
        description:
          "true = only monitors whose current status is NOT an operational state (i.e. degraded/offline/any custom problem status), among those whose monitoring is on. Use this to answer 'what is down right now?'.",
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
          isArchived: true,
          ...MONITORING_OFF_SELECT,
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
      const isMonitoringOff: boolean = MonitoringOff.isOff(monitor);

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
          archived: monitor.isArchived === true ? true : undefined,
          monitoringOff: isMonitoringOff ? true : undefined,
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

      // What the status it shows is worth, said before it.
      const notes: Array<string> = [];
      if (monitor?.isArchived === true) {
        notes.push(ARCHIVED_MONITOR_NOTE);
      }
      if (isMonitoringOff) {
        notes.push(MONITORING_OFF_MONITOR_NOTE);
      }

      return {
        dataForLlm: [...notes, serialized.text].join("\n"),
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
              heading: monitor.name || "Monitor",
              /*
               * In the reader's language (issue #7175): its type by the
               * type picker's name for it, and under its name what the
               * Monitors table says of it - Disabled when its monitoring
               * is off, not the status it was frozen at, which the card
               * names as its last one.
               */
              words: getMonitorCardWords({
                monitorType: monitor.monitorType
                  ? String(monitor.monitorType)
                  : undefined,
                statusName: monitor.currentMonitorStatus?.name || undefined,
                isMonitoringOff,
                isArchived: monitor.isArchived === true,
                ownerTeamNames: ownerTeamNames || undefined,
                ownerUserNames: ownerUserNames || undefined,
              }),
              /*
               * And in its colour, as that table draws it (issue #6968):
               * gray when the status is not live - monitoring off, or
               * archived - never the green of the status it was frozen at.
               */
              statusColor:
                isMonitoringOff || monitor.isArchived === true
                  ? Gray500.toString()
                  : monitor.currentMonitorStatus?.color?.toString(),
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

    // Archived monitors are not monitored: their status is stale.
    const query: Query<Monitor> = { isArchived: false };

    if (nameSearch) {
      query.name = QueryHelper.search(nameSearch);
    }

    /*
     * "Not operational" is matched through the MonitorStatus flag rather than
     * status names, so custom problem statuses ("Maintenance", "Partial
     * outage", …) are still caught. A monitor with monitoring turned off is
     * left out, as on the Not Operational list: nothing checks it, so its
     * status is stale too (NotOperationalMonitorQuery).
     */
    if (problemsOnly) {
      Object.assign(query, NotOperationalMonitorQuery.getQuery());
    }

    if (monitorStatusName) {
      /*
       * Status names are matched case-insensitively against this project's
       * MonitorStatus rows first, then the monitors are filtered by the
       * matched status ids — a name typo therefore fails loudly with the list
       * of real status names instead of silently returning zero monitors.
       *
       * Only among the monitors that are checked, as for problemsOnly: one
       * whose monitoring is off holds the status its last check saw, so
       * "which monitors are Offline?" must not name it (MonitoringOff).
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

      Object.assign(query, MonitoringOff.getMonitoredQuery());
      query.currentMonitorStatusId = QueryHelper.any(matchedIds);
    }

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: query,
      select: {
        _id: true,
        name: true,
        monitorType: true,
        ...MONITORING_OFF_SELECT,
        currentMonitorStatus: {
          name: true,
          color: true,
          priority: true,
          isOperationalState: true,
        },
      },
      /*
       * The monitors that are checked before the ones whose monitoring is
       * off (false sorts before true; the column is NOT NULL), each by name:
       * a page never trades a checked monitor for one nobody checks.
       */
      sort: {
        disableActiveMonitoring: SortOrder.Ascending,
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
     * Page boundaries are defined by the stable DB sort above; the fetched
     * page is then reordered problems-first (higher status priority = worse,
     * shown first) so a mixed page leads with what is broken. A monitor
     * whose monitoring is off is no problem whatever status it was frozen
     * at: it comes after every monitor that is checked, by name. To scan ALL
     * problem monitors across a large project, problemsOnly=true is the
     * reliable filter — this reorder is presentation only.
     */
    const sortedMonitors: Array<Monitor> = [...monitors].sort(
      (a: Monitor, b: Monitor): number => {
        const aOff: boolean = MonitoringOff.isOff(a);
        const bOff: boolean = MonitoringOff.isOff(b);
        if (aOff !== bOff) {
          return aOff ? 1 : -1;
        }
        if (aOff && bOff) {
          return (a.name || "").localeCompare(b.name || "");
        }
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
        monitoringOff: MonitoringOff.isOff(monitor) ? true : undefined,
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    const hasMonitoringOffRow: boolean = sortedMonitors.some(
      (monitor: Monitor): boolean => {
        return MonitoringOff.isOff(monitor);
      },
    );

    const lines: Array<string> = [];
    if (rows.length > 0 && totalCount > rows.length) {
      lines.push(
        `Showing rows ${skip + 1}–${skip + rows.length} of ${totalCount} total. Pass skip to page further.`,
      );
    }
    if (hasMonitoringOffRow) {
      lines.push(MONITORING_OFF_LIST_NOTE);
    }
    lines.push(serialized.text);
    const dataForLlm: string = lines.join("\n");

    /*
     * The chat's table says Disabled for a monitor whose monitoring is off,
     * as the Monitors table does, rather than the status it was frozen at.
     */
    const widgetRows: Array<JSONObject> = rows.map(
      (row: JSONObject): JSONObject => {
        return row["monitoringOff"] === true
          ? { ...row, currentStatus: MONITORING_OFF_STATUS_TEXT }
          : row;
      },
    );

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
              // Disabled ones are said to come last only when one is there.
              description: problemsOnly
                ? "Only monitors whose current status is not operational"
                : hasMonitoringOffRow
                  ? MONITOR_TABLE_ORDER_WITH_MONITORING_OFF_TEXT
                  : MONITOR_TABLE_ORDER_TEXT,
              columns: [
                { key: "name", title: translationKey("Monitor"), type: "text" },
                { key: "type", title: translationKey("Type"), type: "text" },
                {
                  key: "currentStatus",
                  title: translationKey("Status"),
                  type: "text",
                },
              ],
              rows: widgetRows,
              link: { type: AIChatCitationTargetType.Monitors },
            })
          : undefined,
    };
  },
};
