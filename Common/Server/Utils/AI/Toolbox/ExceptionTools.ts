import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
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
 * the service import graph before the TelemetryException model class is fully
 * wired up, so calling a model method at import time throws a
 * circular-dependency TypeError. By the time a tool actually executes, every
 * module is loaded.
 */
let cachedReadPermissions: Array<Permission> | null = null;
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      cachedReadPermissions = new TelemetryException().getReadPermissions();
    }
    return cachedReadPermissions;
  };

export const TopExceptionsTool: ObservabilityTool = {
  name: "top_exceptions",
  description:
    "Get the top exceptions (grouped by fingerprint) in this project, sorted by occurrence count. Includes first/last seen timestamps so you can tell if an exception is new or recurring.",
  inputSchema: {
    type: "object",
    properties: {
      lastSeenWithinHours: {
        type: "number",
        description:
          "Only exceptions last seen within this many hours (default 168 = 7 days, max 720).",
      },
      includeResolved: {
        type: "boolean",
        description: "Include resolved exceptions (default false).",
      },
      limit: {
        type: "number",
        description: "Maximum exception groups to return (default 10, max 25).",
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
    const lastSeenWithinHours: number = ToolArgs.getNumber(
      args,
      "lastSeenWithinHours",
      { defaultValue: 168, min: 1, max: 720 },
    );
    const includeResolved: boolean =
      ToolArgs.getBoolean(args, "includeResolved") ?? false;
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 25,
    });

    const since: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.getCurrentDate(),
      -1 * lastSeenWithinHours,
    );

    const query: JSONObject = {
      lastSeenAt: QueryHelper.greaterThanEqualTo(since),
    };

    if (!includeResolved) {
      query["isResolved"] = false;
    }

    const exceptions: Array<TelemetryException> =
      await TelemetryExceptionService.findBy({
        query: query as never,
        select: {
          _id: true,
          message: true,
          exceptionType: true,
          fingerprint: true,
          occuranceCount: true,
          firstSeenAt: true,
          lastSeenAt: true,
          isResolved: true,
        },
        sort: {
          occuranceCount: SortOrder.Descending,
        },
        limit: limit,
        skip: 0,
        props: ctx.props,
      });

    const rows: Array<JSONObject> = exceptions.map(
      (exception: TelemetryException) => {
        return {
          id: exception.id?.toString(),
          type: exception.exceptionType,
          message: exception.message,
          occurrences: exception.occuranceCount,
          firstSeenAt: exception.firstSeenAt,
          lastSeenAt: exception.lastSeenAt,
          isResolved: exception.isResolved,
          fingerprint: exception.fingerprint,
        };
      },
    );

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Top exceptions, last ${lastSeenWithinHours}h (${serialized.rowCount} found)`,
      citationTarget: {
        type: AIChatCitationTargetType.Exceptions,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.exceptionList({
              title: `Top exceptions (${rows.length})`,
              description: `Last ${lastSeenWithinHours}h, by occurrence count`,
              items: rows,
              link: { type: AIChatCitationTargetType.Exceptions },
            })
          : undefined,
    };
  },
};
