import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreAccess from "../../../../Models/DatabaseModels/DataStoreAccess";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
} from "../../../../Types/AI/AIChatTypes";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Select from "../../../Types/Database/Select";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import DataSensitivity, {
  DATA_SENSITIVITY_RANK,
  isDataSensitivity,
} from "../../../../Types/DataSecurity/DataSensitivity";
import { isBuiltInDataType } from "../../../../Types/DataSecurity/DataTypeCatalog";
import { isCustomDataTypeId } from "../../../../Types/DataSecurity/CustomDataTypeId";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import ProjectDataTypeNames from "../../DataSecurity/ProjectDataTypeNames";
import { DataStoreProvider } from "../../../../Types/DataSecurity/DataStoreKind";
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
import QueryPermission from "../../../Types/Database/Permissions/QueryPermission";
import QueryHelper from "../../../Types/Database/QueryHelper";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import DataSecurityAiInput from "../DataSecurity/DataSecurityAiInput";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import { translationKey } from "../../../../Types/Translator";
import {
  aiActionSentence,
  AI_READ_CARD_NAME,
  AIActionSentence,
  aiActionList,
  aiActionTerm,
} from "../../../../Types/AI/AIActionWords";
import {
  AI_READ_RECORD_TABLE_TITLES,
  AI_TOOL_CITATIONS,
  AI_READ_DATA_SECURITY_TERMS,
  AI_READ_OPEN_STATUS_TERM,
} from "../../../../Types/AI/AIReadTableWords";
import {
  countFigure,
  citationSentence,
  ToolCitation,
  termCells,
  termsByValue,
} from "./ReadTableWords";

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

// Names the built-in types, and a project's own as one.
const BUILT_IN_NAMER: DataTypeNamer = DataTypeNamer.withoutCustomTypes();

/*
 * A data type the model named, as Data Security keys it: a built-in type's
 * id, or its name in any case ("Credit card number"), or a custom type's id.
 * A project's own type by its name is found with the project's names
 * (ToolDataTypeNames.findIds).
 */
export function resolveDataTypeId(value: string): string {
  return BUILT_IN_NAMER.findIds(value)[0] || value.trim();
}

/*
 * The data types one tool call names and finds (#10363): a built-in type by
 * the catalog's name, a project's own by the name the project gave it -
 * never by its "custom:" id. The project's types are read once for the
 * call, as the caller may read them (ProjectDataTypeNames), and only when
 * something to name or find is one of them: a reader who may not read them
 * sees each named "Custom data type", as the Dashboard names it for them.
 */
export interface ToolDataTypeNames {
  // A namer for these ids.
  namerFor: (dataTypeIds: Iterable<string>) => Promise<DataTypeNamer>;
  // The ids of the type the model named: a built-in one, or the project's own.
  findIds: (text: string) => Promise<Array<string>>;
}

export function getToolDataTypeNames(ctx: ToolContext): ToolDataTypeNames {
  let projectNames: Promise<DataTypeNamer> | null = null;

  const readProjectNames: () => Promise<DataTypeNamer> =
    (): Promise<DataTypeNamer> => {
      if (!projectNames) {
        projectNames = ProjectDataTypeNames.read({
          projectId: ctx.projectId,
          props: ctx.props,
        });
      }

      return projectNames;
    };

  return {
    namerFor: async (dataTypeIds: Iterable<string>): Promise<DataTypeNamer> => {
      for (const dataTypeId of dataTypeIds) {
        if (isCustomDataTypeId(dataTypeId)) {
          return await readProjectNames();
        }
      }

      return projectNames ? await projectNames : BUILT_IN_NAMER;
    },
    findIds: async (text: string): Promise<Array<string>> => {
      const found: Array<string> = BUILT_IN_NAMER.findIds(text);
      const first: string = found[0] || "";

      // A built-in type, or a custom one by its id: nothing to read.
      if (!first || isBuiltInDataType(first) || isCustomDataTypeId(first)) {
        return found;
      }

      return (await readProjectNames()).findIds(text);
    },
  };
}

// Every data type id of these rows, for a namer that names them all.
function dataTypeIdsOf(
  rows: ReadonlyArray<{ dataTypeIds?: Array<string> | undefined } | undefined>,
): Array<string> {
  return rows.flatMap(
    (
      row: { dataTypeIds?: Array<string> | undefined } | undefined,
    ): Array<string> => {
      return row?.dataTypeIds || [];
    },
  );
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

// A store as the tools list it: the allow-list's row (DataSecurityAiInput).
export function describeStoreRow(
  store: DataStore,
  dataTypeNamer: DataTypeNamer = BUILT_IN_NAMER,
): JSONObject {
  return DataSecurityAiInput.storeRow(store, dataTypeNamer);
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
    const dataTypeNames: ToolDataTypeNames = getToolDataTypeNames(ctx);
    // A project's own type by its name too: "which stores hold employee IDs".
    const dataTypeIds: Array<string> = dataTypeText
      ? await dataTypeNames.findIds(dataTypeText)
      : [];
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

        return (
          dataTypeIds.length === 0 ||
          (store.dataTypeIds || []).some((id: string): boolean => {
            return dataTypeIds.includes(id);
          })
        );
      },
    );

    const listed: Array<DataStore> = stores.slice(0, limit);
    const namer: DataTypeNamer = await dataTypeNames.namerFor([
      ...dataTypeIdsOf(listed),
      ...dataTypeIds,
    ]);
    const rows: Array<JSONObject> = listed.map(
      (store: DataStore): JSONObject => {
        return describeStoreRow(store, namer);
      },
    );
    const serialized: SerializedResult = ToolResultSerializer.serializeRows(
      rows,
      stores.length,
    );
    const target: AIChatCitationTarget = {
      type: AIChatCitationTargetType.DataStores,
    };
    /*
     * What the stores were filtered by, in the reader's language (issue
     * #8311): a sensitivity and an exposure are words, a data type's name,
     * a provider and a name are data.
     */
    const filters: Array<AIActionSentence> = [
      ...(sensitivity
        ? [
            aiActionSentence(AI_TOOL_CITATIONS.dataStoreSensitivityOrAbove, {
              sensitivity: aiActionTerm(sensitivity),
            }),
          ]
        : []),
      ...(dataTypeIds[0]
        ? [
            aiActionSentence(AI_TOOL_CITATIONS.dataStoreHolding, {
              dataType: namer.nameOf(dataTypeIds[0]),
            }),
          ]
        : []),
      ...(exposure
        ? [
            aiActionSentence(AI_READ_CARD_NAME, {
              name: aiActionTerm(exposure),
            }),
          ]
        : []),
      ...(provider
        ? [aiActionSentence(AI_READ_CARD_NAME, { name: provider })]
        : []),
      ...(name
        ? [aiActionSentence(AI_TOOL_CITATIONS.dataStoreNamedLike, { name })]
        : []),
    ];

    return {
      dataForLlm: serialized.text,
      rowCount: stores.length,
      ...(filters.length > 0
        ? citationSentence(AI_TOOL_CITATIONS.dataStoresFiltered, {
            filters: aiActionList(filters),
            count: countFigure(stores.length),
          })
        : citationSentence(AI_TOOL_CITATIONS.dataStores, {
            count: countFigure(stores.length),
          })),
      citationTarget: target,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated || stores.length > rows.length,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              // In the reader's language (issue #7977).
              words: {
                title: aiActionSentence(
                  AI_READ_RECORD_TABLE_TITLES.dataStores,
                  {
                    count: countFigure(rows.length),
                  },
                ),
                // As Data Security's pills say them (issue #8313).
                cells: termCells(rows, {
                  kind: DATA_SECURITY_WORDS,
                  sensitivity: DATA_SECURITY_WORDS,
                  exposure: DATA_SECURITY_WORDS,
                }),
              },
              columns: [
                { key: "name", title: translationKey("Store"), type: "text" },
                { key: "kind", title: translationKey("Kind"), type: "text" },
                {
                  key: "sensitivity",
                  title: translationKey("Sensitivity"),
                  type: "text",
                },
                {
                  key: "exposure",
                  title: translationKey("Exposure"),
                  type: "text",
                },
                {
                  key: "openIssues",
                  title: translationKey("Open issues"),
                  type: "number",
                },
                {
                  key: "riskScore",
                  title: translationKey("Risk"),
                  type: "number",
                },
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
          isAiSuggested: true,
          isConfirmed: true,
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

  // The store's and its findings' data types, named by one read.
  const namer: DataTypeNamer = await getToolDataTypeNames(ctx).namerFor([
    ...(store.dataTypeIds || []),
    ...findings.value.map((finding: DataStoreFinding): string => {
      return finding.dataTypeId || "";
    }),
  ]);

  const lines: Array<string> = [
    serialize([describeStoreRow(store, namer)]),
    "",
    findings.isReadable
      ? `What was found (${findings.value.length}):`
      : "What was found: not readable with your permissions.",
    findings.isReadable
      ? serialize(
          findings.value.map((finding: DataStoreFinding): JSONObject => {
            return DataSecurityAiInput.findingRow(finding, namer);
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
            return DataSecurityAiInput.storeIssueRow(issue);
          }),
        )
      : "",
  ];

  const text: string = lines.join("\n");

  return {
    dataForLlm: text,
    rowCount: 1,
    // In the reader's language (issue #8311).
    ...citationSentence(AI_TOOL_CITATIONS.dataStore, {
      name: store.name || store.id.toString(),
    }),
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

// An access entry as the tools list it: the allow-list's row (DataSecurityAiInput).
export function describeAccessRow(entry: DataStoreAccess): JSONObject {
  return DataSecurityAiInput.accessRow(entry);
}

/*
 * ---------------------------------------------------------------------------
 * query_data_security_issues
 * ---------------------------------------------------------------------------
 */
/*
 * What a list of issues names under Sources, in the reader's language
 * (issue #8311): which status it lists, and the severity it narrows to.
 */
const ISSUES_CITATIONS: Readonly<
  Record<string, { any: string; ofSeverity: string }>
> = {
  open: {
    any: AI_TOOL_CITATIONS.openDataSecurityIssues,
    ofSeverity: AI_TOOL_CITATIONS.openDataSecurityIssuesOfSeverity,
  },
  accepted: {
    any: AI_TOOL_CITATIONS.acceptedDataSecurityIssues,
    ofSeverity: AI_TOOL_CITATIONS.acceptedDataSecurityIssuesOfSeverity,
  },
  resolved: {
    any: AI_TOOL_CITATIONS.resolvedDataSecurityIssues,
    ofSeverity: AI_TOOL_CITATIONS.resolvedDataSecurityIssuesOfSeverity,
  },
  "not-an-issue": {
    any: AI_TOOL_CITATIONS.notAnIssueDataSecurityIssues,
    ofSeverity: AI_TOOL_CITATIONS.notAnIssueDataSecurityIssuesOfSeverity,
  },
  all: {
    any: AI_TOOL_CITATIONS.allDataSecurityIssues,
    ofSeverity: AI_TOOL_CITATIONS.allDataSecurityIssuesOfSeverity,
  },
};

export function getDataSecurityIssuesCitation(data: {
  status: string;
  severity?: SecuritySeverity | undefined;
  count: number;
}): ToolCitation {
  const templates: { any: string; ofSeverity: string } =
    ISSUES_CITATIONS[data.status] || ISSUES_CITATIONS["open"]!;

  return data.severity
    ? citationSentence(templates.ofSeverity, {
        severity: aiActionTerm(data.severity),
        count: countFigure(data.count),
      })
    : citationSentence(templates.any, { count: countFigure(data.count) });
}

/*
 * The words of Data Security's tables that are OneUptime's (issue #8313):
 * a sensitivity, an exposure, a severity, an issue's status but Open, an
 * access level and a kind of store that is OneUptime's own telemetry. A
 * cloud's kind of store is a product's name: data.
 */
const DATA_SECURITY_WORDS: Readonly<Record<string, string>> = termsByValue(
  AI_READ_DATA_SECURITY_TERMS,
);

/*
 * An issue's status, as the issues list's pill says it: "Open" by its
 * meaning key, "Open (status)", since "Open" alone is every Open button's
 * verb in every language (#8512). Its English, stored, is "Open".
 */
export const ISSUE_STATUS_WORDS: Readonly<Record<string, string>> = {
  ...DATA_SECURITY_WORDS,
  [DataSecurityIssueStatus.Open]: AI_READ_OPEN_STATUS_TERM,
};

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
        return DataSecurityAiInput.issueListRow(issue);
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
      // In the reader's language (issue #8311).
      ...getDataSecurityIssuesCitation({
        status: statusText,
        severity,
        count: serialized.rowCount,
      }),
      citationTarget: target,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              words: {
                title: aiActionSentence(
                  AI_READ_RECORD_TABLE_TITLES.dataSecurityIssues,
                  { count: countFigure(rows.length) },
                ),
                cells: termCells(rows, {
                  severity: DATA_SECURITY_WORDS,
                  status: ISSUE_STATUS_WORDS,
                }),
              },
              columns: [
                { key: "title", title: translationKey("Issue"), type: "text" },
                { key: "store", title: translationKey("Store"), type: "text" },
                {
                  key: "severity",
                  title: translationKey("Severity"),
                  type: "text",
                },
                {
                  key: "riskScore",
                  title: translationKey("Risk"),
                  type: "number",
                },
                {
                  key: "status",
                  title: translationKey("Status"),
                  type: "text",
                },
              ],
              rows,
              link: target,
            })
          : undefined,
    };
  },
};

// What the tool reads of one issue, and of the store it is on.
export const ONE_ISSUE_SELECT: Select<DataSecurityIssue> = {
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
};

export async function readOneIssue(
  issueId: ObjectID,
  ctx: ToolContext,
): Promise<ToolExecutionResult> {
  const issue: DataSecurityIssue | null =
    await DataSecurityIssueService.findOneBy({
      query: { _id: issueId, projectId: ctx.projectId },
      /*
       * Of its store, what the caller may read through the issue: a store's
       * region, sensitivity and exposure only by who may read the store
       * (#10281). A custom role that reads issues and not stores is told
       * the issue and its store's name and kind, not refused the issue.
       */
      select: QueryPermission.getSelectReadableThroughRelations({
        modelType: DataSecurityIssue,
        select: ONE_ISSUE_SELECT,
        props: ctx.props,
      }),
      props: ctx.props,
    });

  if (!issue?.id) {
    throw new BadDataException(
      "Data security issue not found, or you do not have access to it.",
    );
  }

  // What its check saw, its store, and the fix: the allow-list's row.
  const row: JSONObject = DataSecurityAiInput.issueRow(
    issue,
    await getToolDataTypeNames(ctx).namerFor(issue.dataTypeIds || []),
  );
  const serialized: SerializedResult = ToolResultSerializer.serializeRows([
    row,
  ]);

  return {
    dataForLlm: serialized.text,
    rowCount: 1,
    ...citationSentence(AI_TOOL_CITATIONS.dataSecurityIssue, {
      title: issue.title || issue.checkId || issue.id.toString(),
    }),
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
        ...citationSentence(AI_TOOL_CITATIONS.whoCanReachDataStore, {
          count: countFigure(sorted.length),
        }),
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
    const namer: DataTypeNamer = await getToolDataTypeNames(ctx).namerFor(
      dataTypeIdsOf(stores),
    );

    const reachable: Array<JSONObject> = entries
      .filter((entry: DataStoreAccess): boolean => {
        return storesById.has(entry.dataStoreId?.toString() || "");
      })
      .map((entry: DataStoreAccess): JSONObject => {
        const store: DataStore = storesById.get(entry.dataStoreId!.toString())!;

        return DataSecurityAiInput.reachableStoreRow(entry, store, namer);
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
      ...citationSentence(AI_TOOL_CITATIONS.dataStoresPrincipalCanReach, {
        principal: principal || "",
        count: countFigure(reachable.length),
      }),
      citationTarget: target,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated || reachable.length > listed.length,
      widget:
        listed.length > 0
          ? WidgetBuilder.table({
              words: {
                title: aiActionSentence(
                  AI_READ_RECORD_TABLE_TITLES.principalCanReach,
                  {
                    principal: principal || "",
                    count: countFigure(listed.length),
                  },
                ),
                cells: termCells(listed, {
                  sensitivity: DATA_SECURITY_WORDS,
                  level: DATA_SECURITY_WORDS,
                }),
              },
              columns: [
                { key: "store", title: translationKey("Store"), type: "text" },
                {
                  key: "sensitivity",
                  title: translationKey("Sensitivity"),
                  type: "text",
                },
                { key: "level", title: translationKey("Access"), type: "text" },
                {
                  key: "grantedVia",
                  title: translationKey("Granted via"),
                  type: "text",
                },
                {
                  key: "principal",
                  title: translationKey("Principal"),
                  type: "text",
                },
              ],
              rows: listed,
              link: target,
            })
          : undefined,
    };
  },
};
