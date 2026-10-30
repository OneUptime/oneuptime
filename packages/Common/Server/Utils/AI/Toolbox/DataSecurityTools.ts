import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreAccess from "../../../../Models/DatabaseModels/DataStoreAccess";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
} from "../../../../Types/AI/AIChatTypes";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  CheckRemediation,
  DataSecurityCheckInfo,
  fillRemediationText,
  getCheckRemediation,
  getDataSecurityCheck,
} from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import DataSensitivity, {
  DATA_SENSITIVITY_RANK,
  isDataSensitivity,
} from "../../../../Types/DataSecurity/DataSensitivity";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
  getBuiltInDataType,
} from "../../../../Types/DataSecurity/DataTypeCatalog";
import {
  DataStoreKind,
  DataStoreProvider,
} from "../../../../Types/DataSecurity/DataStoreKind";
import { DataStoreExposure } from "../../../../Types/DataSecurity/DataStorePosture";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import SecuritySeverity from "../../../../Types/SecuritySeverity";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import DataStoreAccessService from "../../../Services/DataStoreAccessService";
import DataStoreFindingService from "../../../Services/DataStoreFindingService";
import DataStoreService from "../../../Services/DataStoreService";
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
 * THE DATA SECURITY TOOLS: how OneUptime AI reads what Data Security found,
 * for the questions people ask it - which stores hold card numbers, what do
 * we fix first, what could this leaked role reach.
 *
 *   query_data_stores           the data stores, riskiest first, or one
 *                               with what was found where, who can reach
 *                               it and its open issues
 *   query_data_security_issues  the issues, riskiest first, or one with its
 *                               evidence and how to fix it on its cloud
 *   query_data_store_access     who can reach a store, or every store one
 *                               principal can reach: a leaked credential's
 *                               blast radius
 *
 * Every read runs with the caller's props, so a person sees in Ask AI what
 * Data Security shows them and nothing more. What a store holds goes to the
 * model by data type, location and count - never a finding's samples, not
 * even masked ones: a model needs no value to say where card numbers are.
 *
 * Store names, principals and evidence were written in the customer's
 * clouds: data, never instructions, redacted by the serializer like any
 * other field.
 */

// The most stores, issues or access entries one list read returns.
export const MAX_DATA_SECURITY_ROWS: number = 50;
// The most rows a list read looks through before it filters.
export const DATA_SECURITY_SCAN_LIMIT: number = 500;
// The most findings and access entries one store read lists.
export const MAX_STORE_FINDINGS: number = 25;
export const MAX_STORE_ACCESS: number = 25;

const cachedPermissions: Map<string, Array<Permission>> = new Map();

// Read from the models' access control, lazily, as the other tools do.
function permissionsOf(
  key: string,
  read: () => Array<Permission>,
): Array<Permission> {
  const cached: Array<Permission> | undefined = cachedPermissions.get(key);

  if (cached) {
    return cached;
  }

  const permissions: Array<Permission> = read();
  cachedPermissions.set(key, permissions);
  return permissions;
}

function storeReadPermissions(): Array<Permission> {
  return permissionsOf("DataStore:read", (): Array<Permission> => {
    return new DataStore().getReadPermissions();
  });
}

function issueReadPermissions(): Array<Permission> {
  return permissionsOf("DataSecurityIssue:read", (): Array<Permission> => {
    return new DataSecurityIssue().getReadPermissions();
  });
}

function accessReadPermissions(): Array<Permission> {
  return permissionsOf("DataStoreAccess:read", (): Array<Permission> => {
    return new DataStoreAccess().getReadPermissions();
  });
}

function effectiveSensitivity(
  store: Pick<DataStore, "sensitivity" | "sensitivityOverride">,
): DataSensitivity {
  const level: unknown = store.sensitivityOverride || store.sensitivity;

  return isDataSensitivity(level) ? level : DataSensitivity.Public;
}

function dataTypeName(id: string): string {
  return getBuiltInDataType(id)?.name || id;
}

/*
 * A data type the model named, as Data Security keys it: a built-in type's
 * id, or its name in any case ("Credit card number"), or a custom type's id.
 */
export function resolveDataTypeId(value: string): string {
  const wanted: string = value.trim().toLowerCase();
  const byName: DataTypeInfo | undefined = DATA_TYPE_CATALOG.find(
    (info: DataTypeInfo): boolean => {
      return info.id === wanted || info.name.toLowerCase() === wanted;
    },
  );

  return byName ? byName.id : value.trim();
}

function readEnumValue<T extends string>(
  value: string | undefined,
  values: ReadonlyArray<T>,
  what: string,
): T | undefined {
  if (!value) {
    return undefined;
  }

  const found: T | undefined = values.find((candidate: T): boolean => {
    return candidate.toLowerCase() === value.trim().toLowerCase();
  });

  if (!found) {
    throw new BadDataException(`${what} must be one of: ${values.join(", ")}.`);
  }

  return found;
}

// A read the caller's role does not reach, said plainly instead of failing the tool.
async function readOrNote<T>(
  read: () => Promise<T>,
  fallback: T,
): Promise<{ value: T; isReadable: boolean }> {
  try {
    return { value: await read(), isReadable: true };
  } catch (error) {
    if (error instanceof NotAuthorizedException) {
      return { value: fallback, isReadable: false };
    }

    throw error;
  }
}

const STORE_SELECT: {
  _id: true;
  name: true;
  kind: true;
  provider: true;
  region: true;
  environment: true;
  sensitivity: true;
  sensitivityOverride: true;
  dataTypeIds: true;
  exposure: true;
  openIssueCount: true;
  highestIssueSeverity: true;
  riskScore: true;
  contentScannedAt: true;
  configurationReadAt: true;
  isPublicByDesign: true;
} = {
  _id: true,
  name: true,
  kind: true,
  provider: true,
  region: true,
  environment: true,
  sensitivity: true,
  sensitivityOverride: true,
  dataTypeIds: true,
  exposure: true,
  openIssueCount: true,
  highestIssueSeverity: true,
  riskScore: true,
  contentScannedAt: true,
  configurationReadAt: true,
  isPublicByDesign: true,
};

export function describeStoreRow(store: DataStore): JSONObject {
  return {
    dataStoreId: store.id?.toString() || "",
    name: store.name || "",
    kind: store.kind || "",
    provider: store.provider || "",
    region: store.region || "",
    environment: store.environment || "",
    sensitivity: effectiveSensitivity(store),
    dataTypes: (store.dataTypeIds || []).map(dataTypeName).join(", "),
    exposure: store.exposure || DataStoreExposure.Unknown,
    publicByDesign: Boolean(store.isPublicByDesign),
    openIssues: store.openIssueCount || 0,
    highestIssueSeverity: store.highestIssueSeverity || "",
    riskScore: store.riskScore || 0,
    contentScannedAt: store.contentScannedAt || null,
    configurationReadAt: store.configurationReadAt || null,
  };
}

/*
 * ---------------------------------------------------------------------------
 * query_data_stores
 * ---------------------------------------------------------------------------
 */
export const QueryDataStoresTool: ObservabilityTool = {
  name: "query_data_stores",
  description:
    'Data Security\'s data stores - the buckets, databases, warehouses and telemetry streams OneUptime watches - with how sensitive each is (Restricted, Confidential, Internal, Public), the kinds of sensitive data found in it, how exposed it is and its open issues, riskiest first. Pass dataStoreId for one store with what was found where (each data type by column, field, object pattern or attribute, with counts and confidence - never a value), who can reach it and its open issues. Without it, list stores: filter by sensitivity (that level or above), dataType (a data type\'s id or name, such as credit-card-number or Email address), exposure (Public, Other accounts, Internet reachable, Private, Unknown), provider (aws, azure, gcp, self-managed, oneuptime) or name (part of a store\'s name). Answers "which stores hold card numbers", "what is public" and "what do we have in eu-west-1".',
  inputSchema: {
    type: "object",
    properties: {
      dataStoreId: {
        type: "string",
        description:
          "One store's ID, for what was found in it, who can reach it and its open issues.",
      },
      sensitivity: {
        type: "string",
        enum: Object.values(DataSensitivity),
        description: "Only stores at least this sensitive.",
      },
      dataType: {
        type: "string",
        description: "Only stores holding this data type: its id or its name.",
      },
      exposure: {
        type: "string",
        enum: Object.values(DataStoreExposure),
        description: "Only stores this exposed.",
      },
      provider: {
        type: "string",
        enum: Object.values(DataStoreProvider),
        description: "Only stores of this provider.",
      },
      name: {
        type: "string",
        description: "Only stores whose name contains this.",
      },
      limit: {
        type: "number",
        description: `Maximum stores to list (default 15, max ${MAX_DATA_SECURITY_ROWS}).`,
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return storeReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const dataStoreId: string | undefined = ToolArgs.getString(
      args,
      "dataStoreId",
    );

    if (dataStoreId) {
      if (!ObjectID.isValidUUID(dataStoreId)) {
        throw new BadDataException(
          "dataStoreId must be a data store's ID: list stores with query_data_stores first.",
        );
      }

      return await readOneStore(new ObjectID(dataStoreId), ctx);
    }

    const sensitivity: DataSensitivity | undefined = readEnumValue(
      ToolArgs.getString(args, "sensitivity"),
      Object.values(DataSensitivity),
      "sensitivity",
    );
    const exposure: DataStoreExposure | undefined = readEnumValue(
      ToolArgs.getString(args, "exposure"),
      Object.values(DataStoreExposure),
      "exposure",
    );
    const provider: DataStoreProvider | undefined = readEnumValue(
      ToolArgs.getString(args, "provider"),
      Object.values(DataStoreProvider),
      "provider",
    );
    const dataTypeText: string | undefined = ToolArgs.getString(
      args,
      "dataType",
    );
    const dataTypeId: string | undefined = dataTypeText
      ? resolveDataTypeId(dataTypeText)
      : undefined;
    const name: string | undefined = ToolArgs.getString(args, "name")?.trim();
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 15,
      min: 1,
      max: MAX_DATA_SECURITY_ROWS,
    });

    const query: JSONObject = { projectId: ctx.projectId, isArchived: false };

    if (exposure) {
      query["exposure"] = exposure;
    }

    if (provider) {
      query["provider"] = provider;
    }

    if (name) {
      query["name"] = QueryHelper.searchAllWords([name]) as never;
    }

    const read: Array<DataStore> = await DataStoreService.findBy({
      query: query as never,
      select: STORE_SELECT,
      sort: { riskScore: SortOrder.Descending },
      skip: 0,
      limit: DATA_SECURITY_SCAN_LIMIT,
      props: ctx.props,
    });

    const stores: Array<DataStore> = read.filter(
      (store: DataStore): boolean => {
        if (
          sensitivity &&
          DATA_SENSITIVITY_RANK[effectiveSensitivity(store)] <
            DATA_SENSITIVITY_RANK[sensitivity]
        ) {
          return false;
        }

        return !dataTypeId || (store.dataTypeIds || []).includes(dataTypeId);
      },
    );

    const rows: Array<JSONObject> = stores
      .slice(0, limit)
      .map(describeStoreRow);
    const serialized: SerializedResult = ToolResultSerializer.serializeRows(
      rows,
      stores.length,
    );
    const target: AIChatCitationTarget = {
      type: AIChatCitationTargetType.DataStores,
    };
    const filters: Array<string> = [
      sensitivity ? `${sensitivity} or above` : "",
      dataTypeId ? `holding ${dataTypeName(dataTypeId)}` : "",
      exposure ? exposure : "",
      provider ? provider : "",
      name ? `named like "${name}"` : "",
    ].filter((part: string): boolean => {
      return part.length > 0;
    });

    return {
      dataForLlm: serialized.text,
      rowCount: stores.length,
      citationLabel: `Data stores${filters.length > 0 ? ` (${filters.join(", ")})` : ""} - ${stores.length} found`,
      citationTarget: target,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated || stores.length > rows.length,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Data stores (${rows.length})`,
              columns: [
                { key: "name", title: "Store", type: "text" },
                { key: "kind", title: "Kind", type: "text" },
                { key: "sensitivity", title: "Sensitivity", type: "text" },
                { key: "exposure", title: "Exposure", type: "text" },
                { key: "openIssues", title: "Open issues", type: "number" },
                { key: "riskScore", title: "Risk", type: "number" },
              ],
              rows,
              link: target,
            })
          : undefined,
    };
  },
};

async function readOneStore(
  dataStoreId: ObjectID,
  ctx: ToolContext,
): Promise<ToolExecutionResult> {
  // projectId pinned to the tenant: the id is an untrusted model argument.
  const store: DataStore | null = await DataStoreService.findOneBy({
    query: { _id: dataStoreId, projectId: ctx.projectId },
    select: STORE_SELECT,
    props: ctx.props,
  });

  if (!store?.id) {
    throw new BadDataException(
      "Data store not found, or you do not have access to it.",
    );
  }

  const findings: { value: Array<DataStoreFinding>; isReadable: boolean } =
    await readOrNote(async (): Promise<Array<DataStoreFinding>> => {
      return await DataStoreFindingService.findBy({
        query: {
          projectId: ctx.projectId,
          dataStoreId: store.id!,
          isSuppressed: false,
        },
        // Never maskedSamples: a model needs no value to say where data is.
        select: {
          dataTypeId: true,
          dataTypeName: true,
          location: true,
          locationKind: true,
          confidence: true,
          matchCount: true,
          valueCount: true,
          distinctValues: true,
          isScrubbed: true,
          lastSeenAt: true,
        },
        sort: { matchCount: SortOrder.Descending },
        skip: 0,
        limit: MAX_STORE_FINDINGS,
        props: ctx.props,
      });
    }, []);

  const access: { value: Array<DataStoreAccess>; isReadable: boolean } =
    await readOrNote(async (): Promise<Array<DataStoreAccess>> => {
      return await DataStoreAccessService.findBy({
        query: { projectId: ctx.projectId, dataStoreId: store.id! },
        select: {
          principal: true,
          principalName: true,
          principalType: true,
          accessLevel: true,
          grantedVia: true,
          isExternal: true,
          isPublic: true,
          isSeenInTraces: true,
          lastUsedAt: true,
        },
        skip: 0,
        limit: MAX_STORE_ACCESS,
        props: ctx.props,
      });
    }, []);

  const issues: { value: Array<DataSecurityIssue>; isReadable: boolean } =
    await readOrNote(async (): Promise<Array<DataSecurityIssue>> => {
      return await DataSecurityIssueService.findBy({
        query: {
          projectId: ctx.projectId,
          dataStoreId: store.id!,
          status: DataSecurityIssueStatus.Open,
        },
        select: {
          _id: true,
          title: true,
          checkId: true,
          severity: true,
          riskScore: true,
        },
        sort: { riskScore: SortOrder.Descending },
        skip: 0,
        limit: MAX_DATA_SECURITY_ROWS,
        props: ctx.props,
      });
    }, []);

  // Each part redacted as its own rows; the headings are OneUptime's words.
  const parts: Array<SerializedResult> = [];
  const serialize: (rows: Array<JSONObject>) => string = (
    rows: Array<JSONObject>,
  ): string => {
    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    parts.push(serialized);
    return serialized.text;
  };

  const lines: Array<string> = [
    serialize([describeStoreRow(store)]),
    "",
    findings.isReadable
      ? `What was found (${findings.value.length}):`
      : "What was found: not readable with your permissions.",
    findings.isReadable
      ? serialize(
          findings.value.map((finding: DataStoreFinding): JSONObject => {
            return {
              dataType:
                finding.dataTypeName || dataTypeName(finding.dataTypeId || ""),
              location: finding.location || "",
              locationKind: finding.locationKind || "",
              confidence: finding.confidence || "",
              matches: finding.matchCount || 0,
              ofValuesSampled: finding.valueCount || 0,
              distinctValues: finding.distinctValues || 0,
              scrubbedAtIngest: Boolean(finding.isScrubbed),
              lastSeenAt: finding.lastSeenAt || null,
            };
          }),
        )
      : "",
    "",
    access.isReadable
      ? `Who can reach it (${access.value.length}):`
      : "Who can reach it: not readable with your permissions.",
    access.isReadable
      ? serialize(sortAccess(access.value).map(describeAccessRow))
      : "",
    "",
    issues.isReadable
      ? `Open issues (${issues.value.length}):`
      : "Open issues: not readable with your permissions.",
    issues.isReadable
      ? serialize(
          issues.value.map((issue: DataSecurityIssue): JSONObject => {
            return {
              dataSecurityIssueId: issue.id?.toString() || "",
              title: issue.title || "",
              checkId: issue.checkId || "",
              severity: issue.severity || "",
              riskScore: issue.riskScore || 0,
            };
          }),
        )
      : "",
  ];

  const text: string = lines.join("\n");

  return {
    dataForLlm: text,
    rowCount: 1,
    citationLabel: `Data store ${store.name || store.id.toString()}`,
    citationTarget: {
      type: AIChatCitationTargetType.DataStoreView,
      params: { dataStoreId: store.id.toString() },
    },
    redactionCount: parts.reduce(
      (sum: number, part: SerializedResult): number => {
        return sum + part.redactionCount;
      },
      0,
    ),
    isTruncated: parts.some((part: SerializedResult): boolean => {
      return part.isTruncated;
    }),
  };
}

// Public first, then from outside the project's accounts, then admin before read.
const ACCESS_LEVEL_RANK: Readonly<Record<string, number>> = {
  Admin: 0,
  Write: 1,
  Read: 2,
};

export function sortAccess(
  rows: Array<DataStoreAccess>,
): Array<DataStoreAccess> {
  return [...rows].sort((a: DataStoreAccess, b: DataStoreAccess): number => {
    if (Boolean(a.isPublic) !== Boolean(b.isPublic)) {
      return a.isPublic ? -1 : 1;
    }

    if (Boolean(a.isExternal) !== Boolean(b.isExternal)) {
      return a.isExternal ? -1 : 1;
    }

    return (
      (ACCESS_LEVEL_RANK[a.accessLevel || ""] ?? 3) -
      (ACCESS_LEVEL_RANK[b.accessLevel || ""] ?? 3)
    );
  });
}

export function describeAccessRow(entry: DataStoreAccess): JSONObject {
  return {
    principal: entry.principalName || entry.principal || "",
    principalId: entry.principal || "",
    type: entry.principalType || "",
    level: entry.accessLevel || "",
    grantedVia: entry.grantedVia || "",
    public: Boolean(entry.isPublic),
    outsideYourAccounts: Boolean(entry.isExternal),
    seenInTraces: Boolean(entry.isSeenInTraces),
    lastUsedAt: entry.lastUsedAt || null,
  };
}

/*
 * ---------------------------------------------------------------------------
 * query_data_security_issues
 * ---------------------------------------------------------------------------
 */
const STATUS_FILTERS: Readonly<
  Record<string, Array<DataSecurityIssueStatus> | null>
> = {
  open: [DataSecurityIssueStatus.Open],
  accepted: [DataSecurityIssueStatus.Accepted],
  resolved: [DataSecurityIssueStatus.Resolved],
  "not-an-issue": [DataSecurityIssueStatus.NotAnIssue],
  all: null,
};

export const QueryDataSecurityIssuesTool: ObservabilityTool = {
  name: "query_data_security_issues",
  description:
    'Data Security issues: what is wrong with how a data store keeps its data - a public bucket, a database open to the internet, no encryption or backups, secrets or plaintext passwords in a store, sensitive data in logs, data outside its allowed regions - each with a severity and a risk score from 0 to 100. Pass dataSecurityIssueId for one issue with its evidence, why it matters and how to fix it on the store\'s cloud (console steps, the CLI command and Terraform). Without it, list issues riskiest first: status (open by default, accepted, resolved, not-an-issue or all), severity (Critical, High, Medium, Low), dataStoreId or checkId. Answers "what should we fix first".',
  inputSchema: {
    type: "object",
    properties: {
      dataSecurityIssueId: {
        type: "string",
        description: "One issue's ID, for its evidence and how to fix it.",
      },
      status: {
        type: "string",
        enum: Object.keys(STATUS_FILTERS),
        description: 'Which issues to list (default "open").',
      },
      severity: {
        type: "string",
        enum: Object.values(SecuritySeverity),
        description: "Only issues of this severity.",
      },
      dataStoreId: {
        type: "string",
        description: "Only the issues of this store.",
      },
      checkId: {
        type: "string",
        description:
          "Only the issues of this check, such as public-read or not-encrypted-at-rest.",
      },
      limit: {
        type: "number",
        description: `Maximum issues to list (default 15, max ${MAX_DATA_SECURITY_ROWS}).`,
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return issueReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const issueId: string | undefined = ToolArgs.getString(
      args,
      "dataSecurityIssueId",
    );

    if (issueId) {
      if (!ObjectID.isValidUUID(issueId)) {
        throw new BadDataException(
          "dataSecurityIssueId must be an issue's ID: list issues with query_data_security_issues first.",
        );
      }

      return await readOneIssue(new ObjectID(issueId), ctx);
    }

    const statusText: string = (
      ToolArgs.getString(args, "status") || "open"
    ).toLowerCase();

    if (!Object.prototype.hasOwnProperty.call(STATUS_FILTERS, statusText)) {
      throw new BadDataException(
        `status must be one of: ${Object.keys(STATUS_FILTERS).join(", ")}.`,
      );
    }

    const statuses: Array<DataSecurityIssueStatus> | null =
      STATUS_FILTERS[statusText] || null;
    const severity: SecuritySeverity | undefined = readEnumValue(
      ToolArgs.getString(args, "severity"),
      Object.values(SecuritySeverity),
      "severity",
    );
    const dataStoreId: string | undefined = ToolArgs.getString(
      args,
      "dataStoreId",
    );
    const checkId: string | undefined = ToolArgs.getString(args, "checkId");
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 15,
      min: 1,
      max: MAX_DATA_SECURITY_ROWS,
    });

    if (dataStoreId && !ObjectID.isValidUUID(dataStoreId)) {
      throw new BadDataException(
        "dataStoreId must be a data store's ID: list stores with query_data_stores first.",
      );
    }

    const query: JSONObject = { projectId: ctx.projectId };

    if (statuses) {
      query["status"] = new Includes(statuses) as never;
    }

    if (severity) {
      query["severity"] = severity;
    }

    if (dataStoreId) {
      query["dataStoreId"] = new ObjectID(dataStoreId) as never;
    }

    if (checkId) {
      query["checkId"] = checkId.trim();
    }

    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: query as never,
        select: {
          _id: true,
          title: true,
          checkId: true,
          severity: true,
          riskScore: true,
          status: true,
          firstDetectedAt: true,
          dataStoreId: true,
          dataStore: { name: true, kind: true },
        },
        sort: { riskScore: SortOrder.Descending },
        skip: 0,
        limit,
        props: ctx.props,
      });

    const rows: Array<JSONObject> = issues.map(
      (issue: DataSecurityIssue): JSONObject => {
        return {
          dataSecurityIssueId: issue.id?.toString() || "",
          title: issue.title || "",
          store: issue.dataStore?.name || "",
          storeKind: issue.dataStore?.kind || "",
          dataStoreId: issue.dataStoreId?.toString() || "",
          checkId: issue.checkId || "",
          severity: issue.severity || "",
          riskScore: issue.riskScore || 0,
          status: issue.status || "",
          firstDetectedAt: issue.firstDetectedAt || null,
        };
      },
    );
    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);
    const target: AIChatCitationTarget = {
      type: AIChatCitationTargetType.DataSecurityIssues,
    };

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Data security issues (${statusText}${severity ? `, ${severity}` : ""}) - ${serialized.rowCount} found`,
      citationTarget: target,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Data security issues (${rows.length})`,
              columns: [
                { key: "title", title: "Issue", type: "text" },
                { key: "store", title: "Store", type: "text" },
                { key: "severity", title: "Severity", type: "text" },
                { key: "riskScore", title: "Risk", type: "number" },
                { key: "status", title: "Status", type: "text" },
              ],
              rows,
              link: target,
            })
          : undefined,
    };
  },
};

async function readOneIssue(
  issueId: ObjectID,
  ctx: ToolContext,
): Promise<ToolExecutionResult> {
  const issue: DataSecurityIssue | null =
    await DataSecurityIssueService.findOneBy({
      query: { _id: issueId, projectId: ctx.projectId },
      select: {
        _id: true,
        title: true,
        checkId: true,
        checkGroup: true,
        evidence: true,
        severity: true,
        riskScore: true,
        status: true,
        dataTypeIds: true,
        firstDetectedAt: true,
        lastDetectedAt: true,
        resolvedAt: true,
        acceptedUntil: true,
        securityCaseId: true,
        alertId: true,
        incidentId: true,
        dataStoreId: true,
        dataStore: {
          name: true,
          kind: true,
          region: true,
          sensitivity: true,
          sensitivityOverride: true,
          exposure: true,
        },
      },
      props: ctx.props,
    });

  if (!issue?.id) {
    throw new BadDataException(
      "Data security issue not found, or you do not have access to it.",
    );
  }

  const check: DataSecurityCheckInfo | undefined = getDataSecurityCheck(
    issue.checkId || "",
  );
  const kind: DataStoreKind | undefined = issue.dataStore?.kind as
    | DataStoreKind
    | undefined;
  const remediation: CheckRemediation | undefined =
    check && kind ? getCheckRemediation(check, kind) : undefined;
  const values: { name: string; region?: string | undefined } = {
    name: issue.dataStore?.name || "<store>",
    region: issue.dataStore?.region,
  };

  const row: JSONObject = {
    dataSecurityIssueId: issue.id.toString(),
    title: issue.title || check?.title || "",
    checkId: issue.checkId || "",
    group: issue.checkGroup || check?.group || "",
    severity: issue.severity || "",
    riskScore: issue.riskScore || 0,
    status: issue.status || "",
    store: issue.dataStore?.name || "",
    storeKind: kind || "",
    region: issue.dataStore?.region || "",
    dataStoreId: issue.dataStoreId?.toString() || "",
    storeSensitivity: issue.dataStore
      ? effectiveSensitivity(issue.dataStore)
      : "",
    exposure: issue.dataStore?.exposure || "",
    dataTypes: (issue.dataTypeIds || []).map(dataTypeName).join(", "),
    evidence: issue.evidence || "",
    whatIsWrong: check?.description || "",
    whyItMatters: check?.whyItMatters || "",
    fixSteps: remediation
      ? remediation.steps
          .map((step: string, index: number): string => {
            return `${index + 1}. ${fillRemediationText(step, values)}`;
          })
          .join(" ")
      : "",
    fixCli: remediation?.cli
      ? fillRemediationText(remediation.cli, values)
      : "",
    fixTerraform: remediation?.terraform
      ? fillRemediationText(remediation.terraform, values)
      : "",
    firstDetectedAt: issue.firstDetectedAt || null,
    lastDetectedAt: issue.lastDetectedAt || null,
    resolvedAt: issue.resolvedAt || null,
    acceptedUntil: issue.acceptedUntil || null,
    securityCaseId: issue.securityCaseId?.toString() || "",
    alertId: issue.alertId?.toString() || "",
    incidentId: issue.incidentId?.toString() || "",
  };
  const serialized: SerializedResult = ToolResultSerializer.serializeRows([
    row,
  ]);

  return {
    dataForLlm: serialized.text,
    rowCount: 1,
    citationLabel: `Data security issue: ${issue.title || issue.checkId || issue.id.toString()}`,
    citationTarget: {
      type: AIChatCitationTargetType.DataSecurityIssueView,
      params: { dataSecurityIssueId: issue.id.toString() },
    },
    redactionCount: serialized.redactionCount,
    isTruncated: serialized.isTruncated,
  };
}

/*
 * ---------------------------------------------------------------------------
 * query_data_store_access
 * ---------------------------------------------------------------------------
 */
export const QueryDataStoreAccessTool: ObservabilityTool = {
  name: "query_data_store_access",
  description:
    "Who and what can reach Data Security's data stores, from each cloud's own access settings (bucket policies and ACLs, role assignments, IAM bindings, snapshot shares) and from traces: the internet, other accounts, roles, users, groups, service principals, service accounts and services. Pass dataStoreId for everyone who can reach one store, public and outside access first. Pass principal - part of a role's ARN, a user, group or service account, or a service's name - for every store it can reach, most sensitive first: the blast radius of a leaked credential or a breached host. externalOnly=true keeps only access from outside the project's connected accounts. Exactly one of dataStoreId and principal.",
  inputSchema: {
    type: "object",
    properties: {
      dataStoreId: {
        type: "string",
        description: "One store's ID: who can reach it.",
      },
      principal: {
        type: "string",
        description: "Part of a principal's id or name: what it can reach.",
      },
      externalOnly: {
        type: "boolean",
        description:
          "Only access from outside the project's connected accounts.",
      },
      limit: {
        type: "number",
        description: `Maximum entries to list (default 25, max ${MAX_DATA_SECURITY_ROWS}).`,
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return accessReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const dataStoreId: string | undefined = ToolArgs.getString(
      args,
      "dataStoreId",
    );
    const principal: string | undefined = ToolArgs.getString(
      args,
      "principal",
    )?.trim();
    const externalOnly: boolean =
      ToolArgs.getBoolean(args, "externalOnly") === true;
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 25,
      min: 1,
      max: MAX_DATA_SECURITY_ROWS,
    });

    if (Boolean(dataStoreId) === Boolean(principal)) {
      throw new BadDataException(
        "Pass exactly one of dataStoreId (who can reach a store) and principal (what one principal can reach).",
      );
    }

    if (dataStoreId && !ObjectID.isValidUUID(dataStoreId)) {
      throw new BadDataException(
        "dataStoreId must be a data store's ID: list stores with query_data_stores first.",
      );
    }

    const query: JSONObject = { projectId: ctx.projectId };

    if (externalOnly) {
      query["isExternal"] = true;
    }

    const select: {
      dataStoreId: true;
      principal: true;
      principalName: true;
      principalType: true;
      accessLevel: true;
      grantedVia: true;
      isExternal: true;
      isPublic: true;
      isSeenInTraces: true;
      lastUsedAt: true;
    } = {
      dataStoreId: true,
      principal: true,
      principalName: true,
      principalType: true,
      accessLevel: true,
      grantedVia: true,
      isExternal: true,
      isPublic: true,
      isSeenInTraces: true,
      lastUsedAt: true,
    };

    if (dataStoreId) {
      const rows: Array<DataStoreAccess> = await DataStoreAccessService.findBy({
        query: { ...query, dataStoreId: new ObjectID(dataStoreId) } as never,
        select,
        skip: 0,
        limit: DATA_SECURITY_SCAN_LIMIT,
        props: ctx.props,
      });
      const sorted: Array<DataStoreAccess> = sortAccess(rows);
      const listed: Array<JSONObject> = sorted
        .slice(0, limit)
        .map(describeAccessRow);
      const serialized: SerializedResult = ToolResultSerializer.serializeRows(
        listed,
        sorted.length,
      );

      return {
        dataForLlm: serialized.text,
        rowCount: sorted.length,
        citationLabel: `Who can reach the data store - ${sorted.length} found`,
        citationTarget: {
          type: AIChatCitationTargetType.DataStoreView,
          params: { dataStoreId: dataStoreId },
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated || sorted.length > listed.length,
      };
    }

    // The principal's entries, by its id or its name.
    const byId: Array<DataStoreAccess> = await DataStoreAccessService.findBy({
      query: {
        ...query,
        principal: QueryHelper.searchAllWords([principal!]),
      } as never,
      select,
      skip: 0,
      limit: DATA_SECURITY_SCAN_LIMIT,
      props: ctx.props,
    });
    const byName: Array<DataStoreAccess> = await DataStoreAccessService.findBy({
      query: {
        ...query,
        principalName: QueryHelper.searchAllWords([principal!]),
      } as never,
      select,
      skip: 0,
      limit: DATA_SECURITY_SCAN_LIMIT,
      props: ctx.props,
    });
    const entries: Array<DataStoreAccess> = [];
    const seen: Set<string> = new Set();

    for (const entry of [...byId, ...byName]) {
      const key: string = `${entry.dataStoreId?.toString() || ""}|${entry.principal || ""}|${entry.accessLevel || ""}|${entry.grantedVia || ""}`;

      if (!seen.has(key)) {
        seen.add(key);
        entries.push(entry);
      }
    }

    const storeIds: Array<ObjectID> = [
      ...new Set(
        entries
          .map((entry: DataStoreAccess): string => {
            return entry.dataStoreId?.toString() || "";
          })
          .filter((id: string): boolean => {
            return id.length > 0;
          }),
      ),
    ].map((id: string): ObjectID => {
      return new ObjectID(id);
    });

    // The stores, as the caller may read them: a store they may not see is left out.
    const stores: Array<DataStore> =
      storeIds.length > 0
        ? await DataStoreService.findBy({
            query: {
              projectId: ctx.projectId,
              _id: new Includes(storeIds),
              isArchived: false,
            },
            select: STORE_SELECT,
            skip: 0,
            limit: storeIds.length,
            props: ctx.props,
          })
        : [];
    const storesById: Map<string, DataStore> = new Map(
      stores.map((store: DataStore): [string, DataStore] => {
        return [store.id!.toString(), store];
      }),
    );

    const reachable: Array<JSONObject> = entries
      .filter((entry: DataStoreAccess): boolean => {
        return storesById.has(entry.dataStoreId?.toString() || "");
      })
      .map((entry: DataStoreAccess): JSONObject => {
        const store: DataStore = storesById.get(entry.dataStoreId!.toString())!;

        return {
          ...describeAccessRow(entry),
          store: store.name || "",
          dataStoreId: store.id!.toString(),
          storeKind: store.kind || "",
          sensitivity: effectiveSensitivity(store),
          dataTypes: (store.dataTypeIds || []).map(dataTypeName).join(", "),
          riskScore: store.riskScore || 0,
        };
      })
      .sort((a: JSONObject, b: JSONObject): number => {
        const rank: number =
          DATA_SENSITIVITY_RANK[b["sensitivity"] as DataSensitivity] -
          DATA_SENSITIVITY_RANK[a["sensitivity"] as DataSensitivity];

        return rank !== 0
          ? rank
          : (b["riskScore"] as number) - (a["riskScore"] as number);
      });

    const listed: Array<JSONObject> = reachable.slice(0, limit);
    const serialized: SerializedResult = ToolResultSerializer.serializeRows(
      listed,
      reachable.length,
    );
    const target: AIChatCitationTarget = {
      type: AIChatCitationTargetType.DataSecurityAccess,
    };

    return {
      dataForLlm: serialized.text,
      rowCount: reachable.length,
      citationLabel: `Data stores "${principal}" can reach - ${reachable.length} found`,
      citationTarget: target,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated || reachable.length > listed.length,
      widget:
        listed.length > 0
          ? WidgetBuilder.table({
              title: `What "${principal}" can reach (${listed.length})`,
              columns: [
                { key: "store", title: "Store", type: "text" },
                { key: "sensitivity", title: "Sensitivity", type: "text" },
                { key: "level", title: "Access", type: "text" },
                { key: "grantedVia", title: "Granted via", type: "text" },
                { key: "principal", title: "Principal", type: "text" },
              ],
              rows: listed,
              link: target,
            })
          : undefined,
    };
  },
};
