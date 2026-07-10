import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import BadDataException from "../../../../Types/Exception/BadDataException";
import EntityRelationshipType from "../../../../Types/Telemetry/EntityRelationshipType";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import TelemetryEntityRelationship from "../../../../Models/DatabaseModels/TelemetryEntityRelationship";
import TelemetryEntity from "../../../../Models/DatabaseModels/TelemetryEntity";
import TelemetryEntityRelationshipService from "../../../Services/TelemetryEntityRelationshipService";
import TelemetryEntityService from "../../../Services/TelemetryEntityService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import OneUptimeDate from "../../../../Types/Date";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * Mirrors TelemetryEntityRelationship's read ACL (defense-in-depth — the
 * tool queries permission-checked services under the user's props).
 */
const TOPOLOGY_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
  Permission.ReadTelemetryService,
];

// Raw edges fetched before name resolution / filtering.
const MAX_EDGES_FETCHED: number = 500;

export const GetServiceDependenciesTool: ObservabilityTool = {
  name: "get_service_dependencies",
  description:
    "Map the service topology: which services depend on (call) which, plus infrastructure relationships (runs-on, hosted-on, part-of…), derived automatically from trace parent/child spans and resource co-occurrence. Use it to reason about BLAST RADIUS (what is downstream of a failing service) and CAUSATION ORDER (which upstream dependency could have caused this symptom). Optionally filter to the edges touching one named entity.",
  inputSchema: {
    type: "object",
    properties: {
      entityName: {
        type: "string",
        description:
          "Only edges touching this service/entity (matched case-insensitively against the entity's name). Omit for the whole project graph.",
      },
      relationshipType: {
        type: "string",
        enum: Object.values(EntityRelationshipType),
        description:
          "Only this relationship type. 'depends-on' is the service call graph; the rest describe infrastructure placement.",
      },
      limit: {
        type: "number",
        description: "Maximum edges to return (default 50, max 200).",
      },
    },
  },
  requiredPermissions: TOPOLOGY_READ_PERMISSIONS,
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const relationshipTypeString: string | undefined = ToolArgs.getString(
      args,
      "relationshipType",
    );

    if (
      relationshipTypeString &&
      !Object.values(EntityRelationshipType).includes(
        relationshipTypeString as EntityRelationshipType,
      )
    ) {
      throw new BadDataException(
        `Invalid relationshipType: ${relationshipTypeString}. Must be one of: ${Object.values(
          EntityRelationshipType,
        ).join(", ")}`,
      );
    }

    const entityNameFilter: string | undefined = ToolArgs.getString(
      args,
      "entityName",
    );

    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 50,
      min: 1,
      max: 200,
    });

    const edges: Array<TelemetryEntityRelationship> =
      await TelemetryEntityRelationshipService.findBy({
        query: {
          projectId: ctx.projectId,
          ...(relationshipTypeString
            ? {
                relationshipType:
                  relationshipTypeString as EntityRelationshipType,
              }
            : {}),
        },
        select: {
          fromEntityKey: true,
          toEntityKey: true,
          relationshipType: true,
          lastSeenAt: true,
        },
        sort: { lastSeenAt: SortOrder.Descending },
        limit: MAX_EDGES_FETCHED,
        skip: 0,
        props: ctx.props,
      });

    if (edges.length === 0) {
      const emptyResult: SerializedResult = ToolResultSerializer.serializeRows([
        {
          note: "No topology edges exist for this project yet. The dependency graph is computed from trace parent/child spans and resource co-occurrence every 10 minutes — it needs traces flowing between instrumented services to appear.",
        },
      ]);

      return {
        dataForLlm: emptyResult.text,
        rowCount: 0,
        citationLabel: "get_service_dependencies (no edges)",
        redactionCount: emptyResult.redactionCount,
        isTruncated: emptyResult.isTruncated,
      };
    }

    // Resolve entity keys to human names for the model.
    const entityKeys: Array<string> = Array.from(
      new Set(
        edges.flatMap((edge: TelemetryEntityRelationship) => {
          return [edge.fromEntityKey, edge.toEntityKey].filter(
            Boolean,
          ) as Array<string>;
        }),
      ),
    );

    const entities: Array<TelemetryEntity> =
      await TelemetryEntityService.findBy({
        query: {
          projectId: ctx.projectId,
          entityKey: QueryHelper.any(entityKeys),
        },
        select: {
          entityKey: true,
          displayName: true,
          entityType: true,
        },
        limit: entityKeys.length,
        skip: 0,
        props: ctx.props,
      });

    const nameByKey: Map<string, string> = new Map<string, string>();
    for (const entity of entities) {
      if (entity.entityKey) {
        nameByKey.set(
          entity.entityKey,
          `${entity.displayName || entity.entityKey}${
            entity.entityType ? ` (${entity.entityType})` : ""
          }`,
        );
      }
    }

    const nameOf: (key: string | undefined) => string = (
      key: string | undefined,
    ): string => {
      if (!key) {
        return "unknown";
      }
      return nameByKey.get(key) || key;
    };

    let rows: Array<JSONObject> = edges.map(
      (edge: TelemetryEntityRelationship) => {
        return {
          from: nameOf(edge.fromEntityKey),
          relationship: edge.relationshipType,
          to: nameOf(edge.toEntityKey),
          lastSeenAt: edge.lastSeenAt
            ? OneUptimeDate.getDateAsFormattedString(edge.lastSeenAt)
            : undefined,
        };
      },
    );

    if (entityNameFilter) {
      const needle: string = entityNameFilter.toLowerCase();
      rows = rows.filter((row: JSONObject) => {
        return (
          String(row["from"]).toLowerCase().includes(needle) ||
          String(row["to"]).toLowerCase().includes(needle)
        );
      });

      if (rows.length === 0) {
        const noMatch: SerializedResult = ToolResultSerializer.serializeRows([
          {
            note: `No topology edges touch an entity named "${entityNameFilter}". The graph has ${edges.length} edge(s) for other entities — retry without entityName to see them, or discover entity names via lookup_context.`,
          },
        ]);

        return {
          dataForLlm: noMatch.text,
          rowCount: 0,
          citationLabel: `get_service_dependencies(${entityNameFilter})`,
          redactionCount: noMatch.redactionCount,
          isTruncated: noMatch.isTruncated,
        };
      }
    }

    rows = rows.slice(0, limit);

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `get_service_dependencies(${
        entityNameFilter || "all"
      }${relationshipTypeString ? `, ${relationshipTypeString}` : ""})`,
      citationTarget: { type: AIChatCitationTargetType.Metrics },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget: WidgetBuilder.table({
        title: "Service topology",
        description: entityNameFilter
          ? `Edges touching "${entityNameFilter}"`
          : "Most recently seen relationships",
        columns: [
          { key: "from", title: "From" },
          { key: "relationship", title: "Relationship" },
          { key: "to", title: "To" },
          { key: "lastSeenAt", title: "Last Seen" },
        ],
        rows: rows,
      }),
    };
  },
};
