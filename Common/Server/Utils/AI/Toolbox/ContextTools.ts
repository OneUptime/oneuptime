import MetricType from "../../../../Models/DatabaseModels/MetricType";
import Service from "../../../../Models/DatabaseModels/Service";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import TelemetryType from "../../../../Types/Telemetry/TelemetryType";
import MetricTypeService from "../../../Services/MetricTypeService";
import ServiceService from "../../../Services/ServiceService";
import TelemetryAttributeService from "../../../Services/TelemetryAttributeService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

const CONTEXT_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
];

export const LookupContextTool: ObservabilityTool = {
  name: "lookup_context",
  description:
    "Discover what exists in this project so other tools can be called with exact identifiers: telemetry services (name → ID), metric names, and attribute keys for logs/traces/metrics. ALWAYS resolve a service name to its ID here before filtering other tools by service.",
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["services", "metricNames", "attributeKeys"],
        description: "What to look up (required).",
      },
      nameSearch: {
        type: "string",
        description: "Filter results whose name contains this text.",
      },
      telemetryType: {
        type: "string",
        enum: ["Log", "Trace", "Metric", "Exception"],
        description:
          "For attributeKeys lookups: which signal's attribute keys to list.",
      },
    },
    required: ["type"],
  },
  requiredPermissions: CONTEXT_READ_PERMISSIONS,
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const lookupType: string | undefined = ToolArgs.getString(args, "type");
    const nameSearch: string | undefined = ToolArgs.getString(
      args,
      "nameSearch",
    );

    if (lookupType === "services") {
      const services: Array<Service> = await ServiceService.findBy({
        query: nameSearch
          ? {
              name: QueryHelper.search(nameSearch),
            }
          : {},
        select: {
          _id: true,
          name: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
        limit: 100,
        skip: 0,
        props: ctx.props,
      });

      const rows: Array<JSONObject> = services.map((service: Service) => {
        return {
          id: service.id?.toString(),
          name: service.name,
        };
      });

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      return {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `Telemetry services (${serialized.rowCount} found)`,
        citationTarget: undefined,
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
      };
    }

    if (lookupType === "metricNames") {
      const metricTypes: Array<MetricType> = await MetricTypeService.findBy({
        query: nameSearch
          ? {
              name: QueryHelper.search(nameSearch),
            }
          : {},
        select: {
          name: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
        limit: 200,
        skip: 0,
        props: ctx.props,
      });

      const rows: Array<JSONObject> = metricTypes.map(
        (metricType: MetricType) => {
          return {
            name: metricType.name,
          };
        },
      );

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      return {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `Metric names (${serialized.rowCount} found)`,
        citationTarget: undefined,
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
      };
    }

    if (lookupType === "attributeKeys") {
      const telemetryTypeString: string =
        ToolArgs.getString(args, "telemetryType") || "Log";

      if (
        !Object.values(TelemetryType).includes(
          telemetryTypeString as TelemetryType,
        )
      ) {
        throw new BadDataException(
          `Invalid telemetryType: ${telemetryTypeString}`,
        );
      }

      const attributes: Array<string> =
        await TelemetryAttributeService.fetchAttributes({
          projectId: ctx.projectId,
          telemetryType: telemetryTypeString as TelemetryType,
        });

      const filtered: Array<string> = nameSearch
        ? attributes.filter((attribute: string) => {
            return attribute.toLowerCase().includes(nameSearch.toLowerCase());
          })
        : attributes;

      const serialized: SerializedResult = ToolResultSerializer.serializeText(
        filtered.slice(0, 200).join("\n"),
        filtered.length,
      );

      return {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `${telemetryTypeString} attribute keys (${filtered.length} found)`,
        citationTarget: undefined,
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
      };
    }

    throw new BadDataException(
      `Invalid lookup type: ${lookupType}. Use one of: services, metricNames, attributeKeys.`,
    );
  },
};
