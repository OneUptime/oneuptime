import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertOwnerTeam from "../../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../../Models/DatabaseModels/AlertOwnerUser";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import Query from "../../../../Types/BaseDatabase/Query";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import AlertService from "../../../Services/AlertService";
import AlertOwnerTeamService from "../../../Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../Services/AlertOwnerUserService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import OneUptimeDate from "../../../../Types/Date";
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
 * the service import graph before the Alert model class is fully wired up, so
 * calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedReadPermissions: Array<Permission> | null = null;
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      cachedReadPermissions = new Alert().getReadPermissions();
    }
    return cachedReadPermissions;
  };

type AlertStateFilter = "active" | "resolved" | "any";

export const QueryAlertsTool: ObservabilityTool = {
  name: "query_alerts",
  description:
    "Query alerts in this project with their current state and severity. To answer 'which alerts are active/firing right now?' pass state='active' — it returns every unresolved alert regardless of age (no time window unless createdWithinHours is passed explicitly). state='resolved' returns only resolved alerts; the default 'any' returns both, limited to the createdWithinHours window. Results are newest-first; the result reports the total match count — pass skip to page through more. Pass alertId to get full details of one alert, including its description and its owners (teams and users).",
  inputSchema: {
    type: "object",
    properties: {
      alertId: {
        type: "string",
        description:
          "Get one alert by its ID (includes description and owners).",
      },
      state: {
        type: "string",
        enum: ["active", "resolved", "any"],
        description:
          "Filter by current alert state: 'active' = not yet resolved (any age), 'resolved' = resolved only, 'any' = both (default).",
      },
      createdWithinHours: {
        type: "number",
        description:
          "Only alerts created within this many hours (default 24, max 720). Ignored for state='active' unless passed explicitly, so long-running active alerts are never hidden.",
      },
      limit: {
        type: "number",
        description: "Maximum alerts to return (default 10, max 25).",
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
    const alertId: ObjectID | undefined = ToolArgs.getObjectID(args, "alertId");

    if (alertId) {
      const alert: Alert | null = await AlertService.findOneById({
        id: alertId,
        select: {
          _id: true,
          title: true,
          description: true,
          alertNumber: true,
          createdAt: true,
          currentAlertState: {
            name: true,
          },
          alertSeverity: {
            name: true,
          },
        },
        props: ctx.props,
      });

      let ownerTeamNames: string = "";
      let ownerUserNames: string = "";

      if (alert) {
        /*
         * Owners live in join tables, not on the Alert row itself. projectId
         * is pinned to the tenant from ctx because alertId is an untrusted
         * model argument.
         */
        const ownerTeams: Array<AlertOwnerTeam> =
          await AlertOwnerTeamService.findBy({
            query: {
              alertId: alertId,
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

        const ownerUsers: Array<AlertOwnerUser> =
          await AlertOwnerUserService.findBy({
            query: {
              alertId: alertId,
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
          .map((ownerTeam: AlertOwnerTeam) => {
            return ownerTeam.team?.name || "";
          })
          .filter((value: string) => {
            return value.length > 0;
          })
          .join(", ");

        ownerUserNames = ownerUsers
          .map((ownerUser: AlertOwnerUser) => {
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

      const rows: Array<JSONObject> = alert
        ? [
            {
              id: alert.id?.toString(),
              alertNumber: alert.alertNumber,
              title: alert.title,
              description: alert.description,
              state: alert.currentAlertState?.name,
              severity: alert.alertSeverity?.name,
              createdAt: alert.createdAt,
              ownerTeams: ownerTeamNames || undefined,
              ownerUsers: ownerUserNames || undefined,
            },
          ]
        : [];

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      return {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `Alert ${alert?.alertNumber ? `#${alert.alertNumber}` : alertId.toString()}`,
        citationTarget: {
          type: AIChatCitationTargetType.AlertView,
          params: { alertId: alertId.toString() },
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
        widget:
          rows.length > 0
            ? WidgetBuilder.alertList({
                title: `Alert #${alert?.alertNumber ?? ""}`.trim(),
                items: rows,
                link: {
                  type: AIChatCitationTargetType.AlertView,
                  params: { alertId: alertId.toString() },
                },
              })
            : undefined,
      };
    }

    const stateArg: string | undefined = ToolArgs.getString(args, "state");
    const state: AlertStateFilter =
      stateArg?.toLowerCase() === "active"
        ? "active"
        : stateArg?.toLowerCase() === "resolved"
          ? "resolved"
          : "any";

    const createdWithinHours: number = ToolArgs.getNumber(
      args,
      "createdWithinHours",
      { defaultValue: 24, min: 1, max: 720 },
    );
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 25,
    });
    const skip: number = ToolArgs.getNumber(args, "skip", {
      defaultValue: 0,
      min: 0,
      max: 500,
    });

    const query: Query<Alert> = {};

    /*
     * State is matched through the AlertState flags rather than the state
     * name, so custom state names ("Firing", "Triaged", …) still classify
     * correctly: anything not flagged resolved counts as active.
     */
    if (state === "active") {
      query.currentAlertState = { isResolvedState: false };
    } else if (state === "resolved") {
      query.currentAlertState = { isResolvedState: true };
    }

    /*
     * "active" answers "what is firing right now?" — an alert that opened a
     * week ago and is still unresolved must show up, so the createdAt window
     * only applies when the model asked for one explicitly. "Explicitly"
     * mirrors ToolArgs.getNumber parsing (same rule as IncidentTools): only
     * a usable number counts — junk like "all" would otherwise re-impose
     * the 24h default and hide exactly the long-running alerts this filter
     * exists to surface.
     */
    const rawWindow: unknown = args["createdWithinHours"];
    const hasExplicitWindow: boolean =
      (typeof rawWindow === "number" && Number.isFinite(rawWindow)) ||
      (typeof rawWindow === "string" &&
        rawWindow.trim().length > 0 &&
        Number.isFinite(Number(rawWindow)));

    if (state !== "active" || hasExplicitWindow) {
      const endTime: Date = OneUptimeDate.getCurrentDate();
      const startTime: Date = OneUptimeDate.addRemoveHours(
        endTime,
        -1 * createdWithinHours,
      );
      query.createdAt = QueryHelper.inBetween(startTime, endTime);
    }

    const alerts: Array<Alert> = await AlertService.findBy({
      query: query,
      select: {
        _id: true,
        title: true,
        alertNumber: true,
        createdAt: true,
        currentAlertState: {
          name: true,
        },
        alertSeverity: {
          name: true,
        },
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      limit: limit,
      skip: skip,
      props: ctx.props,
    });

    const totalCount: number = (
      await AlertService.countBy({
        query: query,
        props: ctx.props,
      })
    ).toNumber();

    const rows: Array<JSONObject> = alerts.map((alert: Alert) => {
      return {
        id: alert.id?.toString(),
        alertNumber: alert.alertNumber,
        title: alert.title,
        state: alert.currentAlertState?.name,
        severity: alert.alertSeverity?.name,
        createdAt: alert.createdAt,
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    let dataForLlm: string = serialized.text;
    if (rows.length > 0 && totalCount > rows.length) {
      dataForLlm = `Showing rows ${skip + 1}–${skip + rows.length} of ${totalCount} total. Pass skip to page further.\n${serialized.text}`;
    }

    let scopeLabel: string;
    if (state === "active") {
      scopeLabel = hasExplicitWindow
        ? `Active alerts, last ${createdWithinHours}h`
        : "Active alerts";
    } else if (state === "resolved") {
      scopeLabel = `Resolved alerts, last ${createdWithinHours}h`;
    } else {
      scopeLabel = `Alerts, last ${createdWithinHours}h`;
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
        type: AIChatCitationTargetType.Alerts,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.alertList({
              title: `Alerts (${rows.length})`,
              description:
                state === "active" && !hasExplicitWindow
                  ? "Currently unresolved alerts"
                  : `Created in the last ${createdWithinHours}h`,
              items: rows,
              link: { type: AIChatCitationTargetType.Alerts },
            })
          : undefined,
    };
  },
};
