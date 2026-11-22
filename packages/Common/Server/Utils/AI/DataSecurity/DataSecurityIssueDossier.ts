import DataSecurityAiProposal from "../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityFlow from "../../../../Models/DatabaseModels/DataSecurityFlow";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreAccess from "../../../../Models/DatabaseModels/DataStoreAccess";
import DataStoreOwnerTeam from "../../../../Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "../../../../Models/DatabaseModels/DataStoreOwnerUser";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import {
  DataSecurityResponseActionAvailability,
  DataSecurityResponseAvailability,
} from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import { DATA_SECURITY_RESPONSE_ACTION_CHECKS } from "../../../../Types/DataSecurity/DataSecurityResponseAction";
import { isTelemetryFindingCheck } from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DECLARED_CODE_KIND_NAMES,
  DeclaredCode,
  readDeclaredCode,
} from "../../../../Utils/AiRemediation/DeclaredCodeChange";
import DataSecurityAiProposalService from "../../../Services/DataSecurityAiProposalService";
import DataSecurityFlowService from "../../../Services/DataSecurityFlowService";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import DataStoreAccessService from "../../../Services/DataStoreAccessService";
import DataStoreOwnerTeamService from "../../../Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../Services/DataStoreOwnerUserService";
import DataStoreService from "../../../Services/DataStoreService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import DataSecurityResponse from "../../DataSecurity/DataSecurityResponse";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import DeclaredCodeOwner, {
  DeclaredCodeOwnerCandidate,
  getRepositoryFullName,
} from "../Remediation/DeclaredCodeOwner";
import CloudAiTargets from "../ResourceAccess/CloudAiTargets";
import {
  AiAccessRecord,
  AiCopyRecord,
  AiDeclaredCodeRecord,
  AiFindingRecord,
  AiIssueDossier,
  AiIssueRecord,
  AiOwnersRecord,
  AiProposalRecord,
  AiResponseRecord,
  AiStoreRecord,
  MAX_ANALYSIS_CASES,
  MAX_ANALYSIS_CODE_PATHS,
  MAX_ANALYSIS_COPIES,
  MAX_ANALYSIS_OWNER_NAMES,
  MAX_ANALYSIS_PROPOSALS,
} from "./DataSecurityAiInput";
import DataSecurityAiReads from "./DataSecurityAiReads";

/*
 * WHAT ONEUPTIME KNOWS ABOUT A DATA SECURITY ISSUE, READ FOR ITS ANALYSIS
 * (#10369).
 *
 * Deterministic first: the analysis is written from what Data Security's
 * own records say, read here as OneUptime - the issue, its store's
 * configuration and what it holds, every grant on it with when it was last
 * used and the services the service map shows using it
 * (DataSecurityTracedAccess), copies of its data in other stores
 * (DataSecurityFlows' Copy flows), the security cases its issues opened,
 * the response action that fixes the issue's check and whether the store's
 * connection allows it (DataSecurityResponse), what OneUptime AI proposed
 * for it (#10364), the repository and files that declare it as code
 * (DeclaredCodeOwner), and its owners.
 *
 * Each read selects the columns the input builder may send and nothing
 * more (DataSecurityAiInput's allow-list): names, counts, kinds and dates -
 * never a finding's samples or records, never a connection string, never a
 * person's email. The facts are made of them by DataSecurityAiInput
 * (analysisFacts), which keeps with each fact the records it came from, so
 * the route that shows the analysis shows each reader only what they may
 * read.
 *
 * A read that fails leaves its facts out rather than failing the analysis:
 * the analysis says what OneUptime could see.
 */

// The flows that are copies of a store's data (DataSecurityFlows.COPY).
export const COPY_FLOW_KIND: string = "Copy";

// The most access entries of a store read for one analysis.
export const MAX_DOSSIER_ACCESS_ENTRIES: number = 200;

// The most issues of the store read for the security cases they opened.
const MAX_CASE_ISSUES: number = 50;

// The longest OneUptime waits for the code that declares a store to be found.
export const DECLARED_CODE_TIMEOUT_IN_MS: number = 20 * 1000;

// What the analysis reads of an issue: the input builder's allow-list.
const DOSSIER_ISSUE_SELECT: {
  _id: true;
  title: true;
  checkId: true;
  checkGroup: true;
  severity: true;
  evidence: true;
  riskScore: true;
  status: true;
  dataTypeIds: true;
  dataStoreId: true;
  securityCaseId: true;
} = {
  _id: true,
  title: true,
  checkId: true,
  checkGroup: true,
  severity: true,
  evidence: true,
  riskScore: true,
  status: true,
  dataTypeIds: true,
  dataStoreId: true,
  securityCaseId: true,
};

// What it reads of the store.
const DOSSIER_STORE_SELECT: {
  _id: true;
  name: true;
  kind: true;
  provider: true;
  region: true;
  environment: true;
  sensitivity: true;
  sensitivityOverride: true;
  providerResourceId: true;
  dataTypeIds: true;
  dataCategories: true;
  exposure: true;
  isPublicByDesign: true;
  cloudTags: true;
  posture: true;
  estimatedRecords: true;
  objectCount: true;
} = {
  _id: true,
  name: true,
  kind: true,
  provider: true,
  region: true,
  environment: true,
  sensitivity: true,
  sensitivityOverride: true,
  providerResourceId: true,
  dataTypeIds: true,
  dataCategories: true,
  exposure: true,
  isPublicByDesign: true,
  cloudTags: true,
  posture: true,
  estimatedRecords: true,
  objectCount: true,
};

// What it reads of who can reach the store: AiAccessRecord's columns.
const DOSSIER_ACCESS_SELECT: {
  _id: true;
  principal: true;
  principalName: true;
  principalType: true;
  accessLevel: true;
  grantedVia: true;
  isExternal: true;
  isPublic: true;
  isSeenInTraces: true;
  isUnused: true;
  lastUsedAt: true;
} = {
  _id: true,
  principal: true,
  principalName: true,
  principalType: true,
  accessLevel: true,
  grantedVia: true,
  isExternal: true,
  isPublic: true,
  isSeenInTraces: true,
  isUnused: true,
  lastUsedAt: true,
};

// What it reads of another store a copy is in.
const OTHER_STORE_SELECT: {
  _id: true;
  name: true;
  kind: true;
  environment: true;
} = {
  _id: true,
  name: true,
  kind: true,
  environment: true,
};

// Waits for the work, or gives up on it after the time: null then.
async function withinTime<T>(
  work: Promise<T>,
  timeoutInMs: number,
): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;

  const timeout: Promise<null> = new Promise<null>(
    (resolve: (value: null) => void) => {
      timer = setTimeout(() => {
        resolve(null);
      }, timeoutInMs);
    },
  );

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

// A read that fails leaves its facts out: logged, never thrown.
async function orNothing<T>(
  what: string,
  read: () => Promise<T>,
  nothing: T,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    logger.error(
      `DataSecurity AI: could not read ${what} for an issue's analysis: ${error}`,
    );
    return nothing;
  }
}

function idOf(record: { _id?: unknown; id?: unknown }): string {
  const id: unknown = record.id || record._id;

  return id ? String(id) : "";
}

// A store's cloud tags as a dictionary of text, for the code that declares it.
function readTags(value: unknown): Dictionary<string> {
  const tags: Dictionary<string> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return tags;
  }

  for (const [key, tag] of Object.entries(value as JSONObject)) {
    if (typeof tag === "string") {
      tags[key] = tag;
    }
  }

  return tags;
}

export default class DataSecurityIssueDossier {
  /*
   * Everything the analysis of an issue is written from, read as OneUptime
   * with the project scoped. An issue of another project, or with no store,
   * is not found.
   */
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    issueId: ObjectID;
    now?: Date | undefined;
  }): Promise<AiIssueDossier> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const issue: DataSecurityIssue | null =
      await DataSecurityIssueService.findOneBy({
        query: { _id: data.issueId, projectId: data.projectId },
        select: DOSSIER_ISSUE_SELECT,
        props: { isRoot: true },
      });

    if (!issue?.id || !issue.dataStoreId) {
      throw new BadDataException("Issue not found.");
    }

    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: issue.dataStoreId, projectId: data.projectId },
      select: DOSSIER_STORE_SELECT,
      props: { isRoot: true },
    });

    if (!store?.id) {
      throw new BadDataException("Data store not found.");
    }

    const issueRecord: AiIssueRecord = { ...issue, dataStore: store };

    const [
      places,
      access,
      copies,
      securityCaseIds,
      responses,
      proposals,
      declaredCode,
      owners,
    ]: [
      Array<AiFindingRecord>,
      Array<AiAccessRecord>,
      Array<AiCopyRecord>,
      Array<string>,
      Array<AiResponseRecord>,
      Array<AiProposalRecord>,
      AiDeclaredCodeRecord | null,
      AiOwnersRecord,
    ] = await Promise.all([
      orNothing(
        "where its data sits",
        () => {
          return DataSecurityAiReads.readPlaces({
            projectId: data.projectId,
            issue: issueRecord,
          });
        },
        [],
      ),
      orNothing(
        "who can reach the store",
        () => {
          return this.readAccess(data.projectId, store.id!);
        },
        [],
      ),
      orNothing(
        "copies of its data",
        () => {
          return this.readCopies(data.projectId, store.id!);
        },
        [],
      ),
      orNothing(
        "its security cases",
        () => {
          return this.readSecurityCaseIds(data.projectId, issue);
        },
        [],
      ),
      orNothing(
        "the response actions",
        () => {
          return this.readResponses(data.projectId, issue, store);
        },
        [],
      ),
      orNothing(
        "OneUptime AI's proposals",
        () => {
          return this.readProposals(data.projectId, issue.id!);
        },
        [],
      ),
      orNothing(
        "the code that declares the store",
        () => {
          return this.readDeclaredCode(data.projectId, issue, store);
        },
        null,
      ),
      orNothing(
        "the store's owners",
        () => {
          return this.readOwners(data.projectId, store.id!);
        },
        { recordIds: [], names: [], count: 0 },
      ),
    ]);

    return {
      issue: issueRecord,
      store: store as AiStoreRecord,
      places,
      access,
      copies,
      securityCaseIds,
      responses,
      proposals,
      declaredCode,
      owners,
      now,
    };
  }

  // Every grant on the store, the services seen in traces among them.
  public static async readAccess(
    projectId: ObjectID,
    dataStoreId: ObjectID,
  ): Promise<Array<AiAccessRecord>> {
    const rows: Array<DataStoreAccess> = await DataStoreAccessService.findBy({
      query: { projectId, dataStoreId },
      select: DOSSIER_ACCESS_SELECT,
      sort: { lastUsedAt: SortOrder.Descending },
      skip: 0,
      limit: MAX_DOSSIER_ACCESS_ENTRIES,
      props: { isRoot: true },
    });

    return rows;
  }

  // Copies of the store's data, either way, with the other store's name.
  public static async readCopies(
    projectId: ObjectID,
    dataStoreId: ObjectID,
  ): Promise<Array<AiCopyRecord>> {
    const select: {
      _id: true;
      sourceDataStoreId: true;
      destinationDataStoreId: true;
      overlapPercent: true;
    } = {
      _id: true,
      sourceDataStoreId: true,
      destinationDataStoreId: true,
      overlapPercent: true,
    };
    const [outward, inward]: [
      Array<DataSecurityFlow>,
      Array<DataSecurityFlow>,
    ] = await Promise.all([
      DataSecurityFlowService.findBy({
        query: {
          projectId,
          kind: COPY_FLOW_KIND,
          sourceDataStoreId: dataStoreId,
        },
        select,
        sort: { overlapPercent: SortOrder.Descending },
        skip: 0,
        limit: MAX_ANALYSIS_COPIES,
        props: { isRoot: true },
      }),
      DataSecurityFlowService.findBy({
        query: {
          projectId,
          kind: COPY_FLOW_KIND,
          destinationDataStoreId: dataStoreId,
        },
        select,
        sort: { overlapPercent: SortOrder.Descending },
        skip: 0,
        limit: MAX_ANALYSIS_COPIES,
        props: { isRoot: true },
      }),
    ]);

    const copies: Array<{
      flow: DataSecurityFlow;
      otherStoreId: ObjectID;
      isCopyOfThisStore: boolean;
    }> = [];

    for (const flow of outward) {
      if (flow.id && flow.destinationDataStoreId) {
        copies.push({
          flow,
          otherStoreId: flow.destinationDataStoreId,
          isCopyOfThisStore: true,
        });
      }
    }

    for (const flow of inward) {
      if (flow.id && flow.sourceDataStoreId) {
        copies.push({
          flow,
          otherStoreId: flow.sourceDataStoreId,
          isCopyOfThisStore: false,
        });
      }
    }

    if (copies.length === 0) {
      return [];
    }

    const others: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId,
        _id: new Includes(
          copies.map((copy: { otherStoreId: ObjectID }): ObjectID => {
            return copy.otherStoreId;
          }),
        ),
      },
      select: OTHER_STORE_SELECT,
      skip: 0,
      limit: MAX_ANALYSIS_COPIES * 2,
      props: { isRoot: true },
    });
    const byId: Map<string, DataStore> = new Map(
      others.map((other: DataStore): [string, DataStore] => {
        return [idOf(other), other];
      }),
    );

    return copies
      .filter((copy: { otherStoreId: ObjectID }): boolean => {
        return byId.has(copy.otherStoreId.toString());
      })
      .sort(
        (
          a: { flow: DataSecurityFlow },
          b: { flow: DataSecurityFlow },
        ): number => {
          return (b.flow.overlapPercent || 0) - (a.flow.overlapPercent || 0);
        },
      )
      .slice(0, MAX_ANALYSIS_COPIES)
      .map(
        (copy: {
          flow: DataSecurityFlow;
          otherStoreId: ObjectID;
          isCopyOfThisStore: boolean;
        }): AiCopyRecord => {
          return {
            flowId: idOf(copy.flow),
            otherStore: byId.get(copy.otherStoreId.toString()) as AiStoreRecord,
            isCopyOfThisStore: copy.isCopyOfThisStore,
            overlapPercent: copy.flow.overlapPercent ?? undefined,
          };
        },
      );
  }

  /*
   * The security cases about the store: the one the issue opened or joined,
   * and the ones the store's other issues did - Data Security opens one case
   * per store.
   */
  public static async readSecurityCaseIds(
    projectId: ObjectID,
    issue: DataSecurityIssue,
  ): Promise<Array<string>> {
    const ids: Array<string> = [];
    const add: (id: ObjectID | undefined) => void = (
      id: ObjectID | undefined,
    ): void => {
      const value: string = id?.toString() || "";

      if (value && !ids.includes(value)) {
        ids.push(value);
      }
    };

    add(issue.securityCaseId);

    const others: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId,
          dataStoreId: issue.dataStoreId!,
          securityCaseId: QueryHelper.notNull(),
        },
        select: { _id: true, securityCaseId: true },
        sort: { riskScore: SortOrder.Descending },
        skip: 0,
        limit: MAX_CASE_ISSUES,
        props: { isRoot: true },
      });

    for (const other of others) {
      add(other.securityCaseId);
    }

    return ids.slice(0, MAX_ANALYSIS_CASES);
  }

  /*
   * The response actions that fix the issue's check on its store, and
   * whether each can run now: what the issue's page offers first.
   */
  public static async readResponses(
    projectId: ObjectID,
    issue: DataSecurityIssue,
    store: DataStore,
  ): Promise<Array<AiResponseRecord>> {
    const checkId: string = issue.checkId || "";
    const availability: DataSecurityResponseAvailability =
      await DataSecurityResponse.getAvailability({
        projectId,
        dataStoreId: store.id!,
      });

    return availability.actions
      .filter((entry: DataSecurityResponseActionAvailability): boolean => {
        return DATA_SECURITY_RESPONSE_ACTION_CHECKS[entry.action].includes(
          checkId,
        );
      })
      .map(
        (entry: DataSecurityResponseActionAvailability): AiResponseRecord => {
          return {
            action: entry.action,
            isAvailable: entry.isAvailable,
            unavailableReason: entry.unavailableReason,
          };
        },
      );
  }

  // What OneUptime AI proposed for the issue (#10364), the newest first.
  public static async readProposals(
    projectId: ObjectID,
    issueId: ObjectID,
  ): Promise<Array<AiProposalRecord>> {
    const proposals: Array<DataSecurityAiProposal> =
      await DataSecurityAiProposalService.findBy({
        query: { projectId, dataSecurityIssueId: issueId },
        select: { _id: true, kind: true, status: true },
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: MAX_ANALYSIS_PROPOSALS,
        props: { isRoot: true },
      });

    return proposals
      .filter((proposal: DataSecurityAiProposal): boolean => {
        return Boolean(proposal.id && proposal.kind && proposal.status);
      })
      .map((proposal: DataSecurityAiProposal): AiProposalRecord => {
        return {
          proposalId: idOf(proposal),
          kind: proposal.kind as string,
          status: proposal.status as string,
        };
      });
  }

  /*
   * The repository, and its files, that declare a cloud store as code: only
   * for a store whose tags say it is managed as code (Terraform, a
   * CloudFormation stack, ...), from the repositories AI can work in
   * (DeclaredCodeOwner), and never one nothing points to. A telemetry
   * issue's cause is in the service's own code, which the code location
   * (#10367) will name.
   */
  public static async readDeclaredCode(
    projectId: ObjectID,
    issue: DataSecurityIssue,
    store: DataStore,
  ): Promise<AiDeclaredCodeRecord | null> {
    if (isTelemetryFindingCheck(issue.checkId)) {
      return null;
    }

    const tags: Dictionary<string> = readTags(store.cloudTags);
    const declaredCode: DeclaredCode | null = readDeclaredCode(
      CloudAiTargets.getManagedAsCode(tags),
    );

    if (!declaredCode) {
      return null;
    }

    const candidates: Array<DeclaredCodeOwnerCandidate> | null =
      await withinTime(
        DeclaredCodeOwner.findCandidates({
          projectId,
          declaredCode,
          resource: { name: store.name || "", tags },
        }),
        DECLARED_CODE_TIMEOUT_IN_MS,
      );
    const best: DeclaredCodeOwnerCandidate | null = candidates
      ? DeclaredCodeOwner.getBest(candidates)
      : null;

    if (!best) {
      return null;
    }

    return {
      repositoryId: best.repository.id,
      repositoryName: getRepositoryFullName(best.repository),
      paths: best.matchedPaths.slice(0, MAX_ANALYSIS_CODE_PATHS),
      codeKind: DECLARED_CODE_KIND_NAMES[declaredCode.kind],
      reason: best.reason,
    };
  }

  /*
   * The store's owners: the people and teams, by name for the card, and the
   * rows they were read from. A person's email is never read.
   */
  public static async readOwners(
    projectId: ObjectID,
    dataStoreId: ObjectID,
  ): Promise<AiOwnersRecord> {
    const [users, teams]: [
      Array<DataStoreOwnerUser>,
      Array<DataStoreOwnerTeam>,
    ] = await Promise.all([
      DataStoreOwnerUserService.findBy({
        query: { projectId, dataStoreId },
        select: { _id: true, user: { name: true } },
        skip: 0,
        limit: MAX_ANALYSIS_OWNER_NAMES * 4,
        props: { isRoot: true },
      }),
      DataStoreOwnerTeamService.findBy({
        query: { projectId, dataStoreId },
        select: { _id: true, team: { name: true } },
        skip: 0,
        limit: MAX_ANALYSIS_OWNER_NAMES * 4,
        props: { isRoot: true },
      }),
    ]);
    const names: Array<string> = [];

    for (const owner of users) {
      const name: string = owner.user?.name?.toString().trim() || "";

      if (name && !names.includes(name)) {
        names.push(name);
      }
    }

    for (const owner of teams) {
      const name: string = owner.team?.name?.trim() || "";

      if (name && !names.includes(name)) {
        names.push(name);
      }
    }

    return {
      recordIds: [...users, ...teams]
        .map((owner: DataStoreOwnerUser | DataStoreOwnerTeam): string => {
          return idOf(owner);
        })
        .filter(Boolean),
      names: names.slice(0, MAX_ANALYSIS_OWNER_NAMES),
      count: users.length + teams.length,
    };
  }
}
