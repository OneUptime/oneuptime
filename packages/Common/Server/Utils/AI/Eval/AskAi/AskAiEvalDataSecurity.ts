import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import { DataSecurityResponseAvailability } from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  ALL_DATA_SECURITY_RESPONSE_ACTIONS,
  DataSecurityResponseAction,
} from "../../../../../Types/DataSecurity/DataSecurityResponseAction";
import { JSONObject } from "../../../../../Types/JSON";
import DataSecurityAiProposalService from "../../../../Services/DataSecurityAiProposalService";
import DataSecurityIssueService from "../../../../Services/DataSecurityIssueService";
import DataSecuritySettingService from "../../../../Services/DataSecuritySettingService";
import DataStoreFindingService from "../../../../Services/DataStoreFindingService";
import DataStoreOwnerTeamService from "../../../../Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../../Services/DataStoreOwnerUserService";
import DataStoreService from "../../../../Services/DataStoreService";
import LabelService from "../../../../Services/LabelService";
import DataSecurityResponse from "../../../DataSecurity/DataSecurityResponse";
import * as TelemetryScrubImpact from "../../../DataSecurity/Telemetry/TelemetryScrubImpact";
import {
  AskAiEvalDataSecurityIssue,
  AskAiEvalDataStore,
  AskAiEvalDataStoreFinding,
  AskAiEvalProject,
} from "./AskAiEvalProject";
import type { AskAiEvalPatches } from "./AskAiEvalTurn";

/*
 * ASK AI'S DATA SECURITY ACTIONS IN THE EVAL (#10378).
 *
 * A project that holds customer data answers Ask AI's Data Security reads
 * from its records, by their ids - so a live model can name the very
 * finding, issue or store an action is for - and the reads its actions'
 * prepares and checks make before a card, so each request reaches its card
 * as it would in the product: the store, the issue, the finding, what a
 * scrub rule would be, and which responses its cloud can run. Nothing here
 * writes: the eval grades the card a request ends in, never runs it.
 */

function storeOf(project: AskAiEvalProject, id: unknown): DataStore | null {
  const record: AskAiEvalDataStore | undefined = (project.dataStores || []).find(
    (store: AskAiEvalDataStore): boolean => {
      return store.id === String(id);
    },
  );

  return record ? toStore(project, record) : null;
}

function toStore(project: AskAiEvalProject, record: AskAiEvalDataStore): DataStore {
  const store: DataStore = new DataStore();
  Object.assign(store as unknown as Record<string, unknown>, {
    _id: record.id,
    projectId: project.id,
    name: record.name,
    kind: record.kind,
    region: record.region,
    exposure: record.exposure,
    provider: record.kind === "Logs" ? "oneuptime" : "aws",
    sensitivity: "Confidential",
    dataCategories: record.dataCategories,
    subjectCountries: [],
    isArchived: false,
    isPublicByDesign: false,
    cloudConnectionId:
      record.kind === "Logs" ? null : "e1037800-0000-4000-8000-0000000000a1",
  });
  return store;
}

function toIssue(
  project: AskAiEvalProject,
  record: AskAiEvalDataSecurityIssue,
): DataSecurityIssue {
  const issue: DataSecurityIssue = new DataSecurityIssue();
  Object.assign(issue as unknown as Record<string, unknown>, {
    _id: record.id,
    projectId: project.id,
    title: record.title,
    checkId: record.checkId,
    severity: record.severity,
    status: record.status,
    dataStoreId: record.storeId,
    dataStore: storeOf(project, record.storeId),
  });
  return issue;
}

function toFinding(
  project: AskAiEvalProject,
  record: AskAiEvalDataStoreFinding,
): DataStoreFinding {
  const finding: DataStoreFinding = new DataStoreFinding();
  Object.assign(finding as unknown as Record<string, unknown>, {
    _id: record.id,
    projectId: project.id,
    dataStoreId: record.storeId,
    dataStore: storeOf(project, record.storeId),
    dataTypeId: record.dataTypeId,
    dataTypeName: record.dataTypeName,
    location: record.location,
    locationKind: "Attribute",
    confidence: "High",
    isScrubbed: false,
    isSuppressed: false,
    isConfirmed: false,
  });
  return finding;
}

// The id a read asks for, from its query.
function queriedId(args: unknown): string {
  const query: JSONObject =
    ((args as { query?: JSONObject } | undefined)?.query as JSONObject) || {};

  return String(query["_id"] ?? "");
}

/*
 * What Ask AI's Data Security reads answer, in a project that holds
 * customer data; null for any other read, or another project.
 */
export function readDataSecurityProject(
  project: AskAiEvalProject,
  toolName: string,
): string | null {
  if (!project.dataStores) {
    return null;
  }

  switch (toolName) {
    case "query_data_stores":
      return JSON.stringify({
        dataStores: project.dataStores.map(
          (store: AskAiEvalDataStore): JSONObject => {
            return {
              dataStoreId: store.id,
              name: store.name,
              kind: store.kind,
              region: store.region,
              exposure: store.exposure,
              findings: (project.dataStoreFindings || [])
                .filter((finding: AskAiEvalDataStoreFinding): boolean => {
                  return finding.storeId === store.id;
                })
                .map((finding: AskAiEvalDataStoreFinding): JSONObject => {
                  return {
                    dataStoreFindingId: finding.id,
                    dataType: finding.dataTypeName,
                    location: finding.location,
                  };
                }),
            };
          },
        ),
      });
    case "query_data_security_issues":
      return JSON.stringify({
        issues: (project.dataSecurityIssues || []).map(
          (issue: AskAiEvalDataSecurityIssue): JSONObject => {
            return {
              dataSecurityIssueId: issue.id,
              title: issue.title,
              severity: issue.severity,
              status: issue.status,
              dataStoreId: issue.storeId,
              store: storeOf(project, issue.storeId)?.name || "",
            };
          },
        ),
      });
    case "query_data_store_access":
      return JSON.stringify({ access: [] });
    case "query_data_security_proposals":
      return JSON.stringify({ proposals: [] });
    case "draft_data_security_rule":
      return [
        'Draft (pass it to save_data_security_rule unchanged): {"kind":"residency","name":"EU personal data stays in the EU","description":"Personal data is kept only in EU regions.","dataCategories":[],"subjectCountries":[],"allowedRegions":["eu-*","europe-*"]}',
        "Why: the sentence keeps personal data in the EU.",
        "It matches 4 store(s) the person may see today, and 3 break it.",
      ].join("\n");
    default:
      return null;
  }
}

// What Data Security's actions read before their cards, from the project.
export function answerDataSecurityFromProject(
  patches: AskAiEvalPatches,
  project: AskAiEvalProject,
): void {
  if (!project.dataStores) {
    return;
  }

  const stores: Array<DataStore> = project.dataStores.map(
    (record: AskAiEvalDataStore): DataStore => {
      return toStore(project, record);
    },
  );
  const issues: Array<DataSecurityIssue> = (
    project.dataSecurityIssues || []
  ).map((record: AskAiEvalDataSecurityIssue): DataSecurityIssue => {
    return toIssue(project, record);
  });
  const findings: Array<DataStoreFinding> = (
    project.dataStoreFindings || []
  ).map((record: AskAiEvalDataStoreFinding): DataStoreFinding => {
    return toFinding(project, record);
  });
  const byId: <T extends { id?: unknown }>(
    rows: Array<T>,
  ) => (args: unknown) => Promise<T | null> = <T extends { id?: unknown }>(
    rows: Array<T>,
  ): ((args: unknown) => Promise<T | null>) => {
    return async (args: unknown): Promise<T | null> => {
      const id: string = queriedId(args);

      return (
        rows.find((row: T): boolean => {
          return String(row.id) === id;
        }) || null
      );
    };
  };

  patches.set(DataStoreService, "findOneBy", byId(stores));
  patches.set(DataStoreService, "findBy", async (): Promise<Array<DataStore>> => {
    return stores;
  });
  patches.set(DataSecurityIssueService, "findOneBy", byId(issues));
  patches.set(DataSecurityIssueService, "findBy", async () => {
    return issues;
  });
  patches.set(DataStoreFindingService, "findOneBy", byId(findings));
  patches.set(DataStoreFindingService, "findBy", async () => {
    return [];
  });
  patches.set(DataSecuritySettingService, "findOneBy", async () => {
    return null;
  });
  patches.set(DataStoreOwnerUserService, "findBy", async () => {
    return [];
  });
  patches.set(DataStoreOwnerTeamService, "findBy", async () => {
    return [];
  });
  patches.set(LabelService, "findBy", async () => {
    return [];
  });
  patches.set(DataSecurityAiProposalService, "findOneBy", async () => {
    return null;
  });

  // Scrub It's rule for the finding: nothing reads the attribute.
  patches.set(TelemetryScrubImpact, "getScrubItImpact", async () => {
    return {
      isAvailable: true,
      rule: {
        signal: "log",
        name: "Data Security: Email address in attributes.user.email",
        scrubAction: "mask",
        patternType: "Email",
        fieldsToScrub: "attributes",
        dataTypeName: "Email address",
      },
    };
  });

  // Every response its connection allows.
  patches.set(
    DataSecurityResponse,
    "getAvailability",
    async (): Promise<DataSecurityResponseAvailability> => {
      return {
        actions: ALL_DATA_SECURITY_RESPONSE_ACTIONS.map(
          (action: DataSecurityResponseAction) => {
            return { action, isAvailable: true };
          },
        ),
      } as unknown as DataSecurityResponseAvailability;
    },
  );
}
