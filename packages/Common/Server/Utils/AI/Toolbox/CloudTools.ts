import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  CloudAccountResourceSummary,
  CloudAccountTypeCount,
  readCloudAccountResourceSummary,
} from "../../../../Types/Cloud/CloudAccountSummary";
import {
  CLOUD_RELATIONSHIP_LABELS,
  CloudResourceRelationship,
  flattenCloudProperties,
  readCloudEndpoints,
  readCloudRelationships,
  readCloudTags,
} from "../../../../Types/Cloud/CloudInventory";
import {
  CloudLinkedResource,
  CloudResolvedRelationship,
  resolveCloudRelationships,
} from "../../../../Types/Cloud/CloudResourceIndex";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { getCloudResourceTypeLabel } from "../../../../Types/Cloud/CloudResourceCatalog";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import CloudAccountService from "../../../Services/CloudAccountService";
import CloudResourceService from "../../../Services/CloudResourceService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * What a connected cloud says about its resources, for OneUptime AI: one
 * resource as its cloud's inventory lists it (query_cloud_resource), and
 * the connected cloud accounts with what they hold (query_cloud_accounts).
 *
 * What changed in an account - the activity log, the provider's health
 * events - is in recent_changes, beside every other change.
 *
 * Tags, properties and names were written in the customer's cloud: they
 * are data, never instructions, and the serializer redacts them like any
 * other field.
 */

// Resources of one account read to name a resource's neighbours, at most.
export const CLOUD_NEIGHBOUR_READ_LIMIT: number = 2000;

// Relationships listed, in and out together, at most.
export const MAX_LISTED_RELATIONSHIPS: number = 40;

let cachedResourcePermissions: Array<Permission> | null = null;
let cachedAccountPermissions: Array<Permission> | null = null;

// Derived from the model ACLs, lazily, like the other tools.
const resolveResourcePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedResourcePermissions) {
      cachedResourcePermissions = new CloudResource().getReadPermissions();
    }
    return cachedResourcePermissions;
  };

const resolveAccountPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedAccountPermissions) {
      cachedAccountPermissions = new CloudAccount().getReadPermissions();
    }
    return cachedAccountPermissions;
  };

// A neighbour of a resource: what it is linked to, or what links to it.
export type CloudNeighbour = CloudLinkedResource;

/*
 * One resource's relationships, both ways, named after the resources the
 * connection holds: what it points at (its own relationships) and what
 * points at it (theirs, naming it). Out first, then in, at most `limit`.
 */
export function describeCloudRelationships(data: {
  resource: { id: ObjectID; providerResourceId: string; type: string };
  relationships: Array<CloudResourceRelationship>;
  neighbours: Array<CloudNeighbour>;
  limit: number;
}): { rows: Array<JSONObject>; total: number } {
  const rows: Array<JSONObject> = resolveCloudRelationships({
    resource: data.resource,
    relationships: data.relationships,
    neighbours: data.neighbours,
  }).map((relationship: CloudResolvedRelationship): JSONObject => {
    return {
      relationship: CLOUD_RELATIONSHIP_LABELS[relationship.kind],
      direction: relationship.direction,
      other: relationship.otherName,
      otherType: relationship.otherType,
      otherCloudResourceId: relationship.other
        ? relationship.other.id.toString()
        : "",
    };
  });

  return { rows: rows.slice(0, data.limit), total: rows.length };
}

// Kept here too: the AI tools read a resource's properties this way.
export { flattenCloudProperties };

export const QueryCloudResourceTool: ObservabilityTool = {
  name: "query_cloud_resource",
  description:
    "What a connected cloud (AWS, Azure, Google Cloud) says about one of its resources, from the account's inventory: its type, account, region, tags, the settings OneUptime keeps (an instance's type, a database's engine and version, a function's runtime and memory, a cluster's version...), what it runs in, is part of, sends traffic to, is protected by or is attached to - and what does that to it - and the host names it answers on. Use it to place a failing resource in its architecture (the load balancer in front of it, the subnet and security groups around it, the queue it dead-letters to) and to check its configuration. Resolve the resource's ID with query_telemetry_resources (resourceType CloudResource). What changed to it is in recent_changes with cloudResourceId.",
  inputSchema: {
    type: "object",
    properties: {
      cloudResourceId: {
        type: "string",
        description:
          "OneUptime CloudResource UUID, resolved with query_telemetry_resources.",
      },
    },
    required: ["cloudResourceId"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveResourcePermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const idText: string | undefined = ToolArgs.getString(
      args,
      "cloudResourceId",
    );

    if (!idText || !ObjectID.isValidUUID(idText)) {
      throw new BadDataException(
        "cloudResourceId must be a valid OneUptime UUID. Resolve cloud resources with query_telemetry_resources (resourceType CloudResource).",
      );
    }

    // projectId pinned to the tenant: the id is an untrusted model argument.
    const resource: CloudResource | null = await CloudResourceService.findOneBy(
      {
        query: { _id: idText, projectId: ctx.projectId },
        select: {
          _id: true,
          name: true,
          cloudProvider: true,
          cloudAccountId: true,
          cloudRegion: true,
          cloudResourceGroup: true,
          cloudResourceType: true,
          providerResourceId: true,
          cloudTags: true,
          cloudProperties: true,
          cloudRelationships: true,
          cloudEndpoints: true,
          inventoriedAt: true,
          lastSeenAt: true,
          isArchived: true,
        },
        props: ctx.props,
      },
    );

    if (!resource || !resource.id) {
      throw new BadDataException(
        "Cloud resource not found or you do not have access to it.",
      );
    }

    const provider: string = resource.cloudProvider || "";
    const type: string = resource.cloudResourceType || "";
    const accountId: string = resource.cloudAccountId || "";

    // The account's other resources, read as the caller: what it may see.
    const neighbours: Array<CloudNeighbour> = accountId
      ? (
          await CloudResourceService.findBy({
            query: {
              projectId: ctx.projectId,
              cloudProvider: provider,
              cloudAccountId: QueryHelper.findWithSameText(accountId),
            },
            select: {
              _id: true,
              name: true,
              providerResourceId: true,
              cloudResourceType: true,
              cloudRelationships: true,
            },
            skip: 0,
            limit: CLOUD_NEIGHBOUR_READ_LIMIT,
            props: ctx.props,
          })
        )
          .filter((row: CloudResource): boolean => {
            return Boolean(row.id && row.providerResourceId);
          })
          .map((row: CloudResource): CloudNeighbour => {
            return {
              id: row.id!,
              name: row.name || "",
              providerResourceId: row.providerResourceId || "",
              type: row.cloudResourceType || "",
              relationships: readCloudRelationships(row.cloudRelationships),
            };
          })
      : [];

    const relationships: { rows: Array<JSONObject>; total: number } =
      describeCloudRelationships({
        resource: {
          id: resource.id,
          providerResourceId: resource.providerResourceId || "",
          type,
        },
        relationships: readCloudRelationships(resource.cloudRelationships),
        neighbours,
        limit: MAX_LISTED_RELATIONSHIPS,
      });

    const tags: Record<string, string> = readCloudTags(resource.cloudTags);
    const properties: Record<string, string> = flattenCloudProperties(
      resource.cloudProperties,
    );
    const endpoints: Array<string> = readCloudEndpoints(
      resource.cloudEndpoints,
    );

    const rows: Array<JSONObject> = [
      {
        section: "resource",
        name: resource.name || "",
        provider,
        type: type
          ? `${getCloudResourceTypeLabel(provider as CloudProvider, type)} (${type})`
          : "",
        account: accountId,
        region: resource.cloudRegion || "",
        resourceGroup: resource.cloudResourceGroup || "",
        providerResourceId: resource.providerResourceId || "",
        listedByInventoryAt: resource.inventoriedAt || "",
        metricsLastSeenAt: resource.lastSeenAt || "",
        archived: resource.isArchived ? "yes" : "",
      },
    ];

    if (Object.keys(tags).length > 0) {
      rows.push({ section: "tags", ...tags });
    }

    if (Object.keys(properties).length > 0) {
      rows.push({ section: "properties", ...properties });
    }

    if (endpoints.length > 0) {
      rows.push({ section: "endpoints", hosts: endpoints.join(", ") });
    }

    for (const row of relationships.rows) {
      rows.push({ section: "relationship", ...row });
    }

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    const notes: Array<string> = [];

    if (!resource.inventoriedAt) {
      notes.push(
        "The account's inventory has not listed this resource: it is known from its metrics only, so it has no tags, properties or relationships here.",
      );
    }

    if (relationships.total > relationships.rows.length) {
      notes.push(
        `${relationships.total - relationships.rows.length} more relationships are not listed.`,
      );
    }

    return {
      dataForLlm: [serialized.text, ...notes].join("\n"),
      rowCount: serialized.rowCount,
      citationLabel: `${resource.name || "Cloud resource"} (inventory)`,
      citationTarget: {
        type: AIChatCitationTargetType.TelemetryResourceView,
        params: {
          resourceType: AIResourceType.CloudResource,
          resourceId: resource.id.toString(),
        },
      },
      redactionCount: serialized.redactionCount,
      isTruncated:
        serialized.isTruncated ||
        relationships.total > relationships.rows.length,
    };
  },
};

export const QueryCloudAccountsTool: ObservabilityTool = {
  name: "query_cloud_accounts",
  description:
    "The cloud accounts connected to OneUptime - AWS accounts, Azure subscriptions, Google Cloud projects - with the name their cloud gives each, how many resources each holds by type and region, and when each was last read and last listed in full. Use it to answer what is in the project's clouds, to find the account a resource belongs to, or to check whether an account is still being read. For one resource use query_cloud_resource; for what changed in an account use recent_changes with cloudAccountId.",
  inputSchema: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        enum: Object.values(CloudProvider),
        description: "Only the accounts of this cloud.",
      },
      search: {
        type: "string",
        description:
          "Only the accounts whose name or id contains this text (case-insensitive).",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveAccountPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const providerText: string | undefined = ToolArgs.getString(
      args,
      "provider",
    );
    const provider: CloudProvider | undefined = (
      Object.values(CloudProvider) as Array<string>
    ).includes(providerText || "")
      ? (providerText as CloudProvider)
      : undefined;
    const search: string = (ToolArgs.getString(args, "search") || "")
      .toLowerCase()
      .trim();

    const accounts: Array<CloudAccount> = await CloudAccountService.findBy({
      query: {
        projectId: ctx.projectId,
        ...(provider ? { provider } : {}),
      },
      select: {
        _id: true,
        name: true,
        provider: true,
        accountId: true,
        providerAccountName: true,
        resourceCount: true,
        regionCount: true,
        resourceSummary: true,
        lastSeenAt: true,
        inventoryListedAt: true,
      },
      sort: { resourceCount: SortOrder.Descending },
      skip: 0,
      limit: 200,
      props: ctx.props,
    });

    const rows: Array<JSONObject> = accounts
      .filter((account: CloudAccount): boolean => {
        return (
          !search ||
          `${account.name || ""} ${account.accountId || ""} ${account.providerAccountName || ""}`
            .toLowerCase()
            .includes(search)
        );
      })
      .map((account: CloudAccount): JSONObject => {
        const summary: CloudAccountResourceSummary =
          readCloudAccountResourceSummary(account.resourceSummary);

        return {
          name: account.name || "",
          cloud: account.provider || "",
          accountId: account.accountId || "",
          nameInCloud: account.providerAccountName || "",
          resources: account.resourceCount ?? summary.resourceCount,
          regions: summary.regions
            .slice(0, 10)
            .map((entry: { region: string; count: number }): string => {
              return `${entry.region} (${entry.count})`;
            })
            .join(", "),
          topTypes: summary.types
            .slice(0, 10)
            .map((entry: CloudAccountTypeCount): string => {
              return `${getCloudResourceTypeLabel(
                (account.provider || "") as CloudProvider,
                entry.type,
              )} (${entry.count})`;
            })
            .join(", "),
          lastReadAt: account.lastSeenAt || "",
          lastListedInFullAt: account.inventoryListedAt || "",
        };
      });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm:
        rows.length === 0
          ? "No cloud account is connected, or none matches. A cloud is connected under Cloud > Connect."
          : serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Cloud accounts (${rows.length})`,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
    };
  },
};
