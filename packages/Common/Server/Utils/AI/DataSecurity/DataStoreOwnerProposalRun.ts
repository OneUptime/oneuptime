import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import DataSecurityAiProposal from "../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import Project from "../../../../Models/DatabaseModels/Project";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import {
  DataSecurityAiChangeSafety,
  DataSecurityAiPlan,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  DataSecurityAiWithoutAskingVerdict,
  DataSecurityAiWork,
  DataSecurityAiWorkDecision,
  DataSecurityAiAutonomy,
  decideDataSecurityAiWork,
  getDataSecurityAiWithoutAskingVerdict,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import { NO_OWNER_CHECK_ID } from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import ObjectID from "../../../../Types/ObjectID";
import { DataSecurityAiRuleIssue } from "../../../../Utils/DataSecurity/DataSecurityAiRuleMatch";
import { DataStoreOwnerDirectory } from "../../../../Utils/DataSecurity/DataStoreOwnerEvidence";
import DataSecurityAiProposalService from "../../../Services/DataSecurityAiProposalService";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import DataStoreOwnerRuleEngineService from "../../../Services/DataStoreOwnerRuleEngineService";
import DataStoreService from "../../../Services/DataStoreService";
import ProjectService from "../../../Services/ProjectService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import {
  queueDataSecurityAiEvaluation,
  queueDataStoreOwnerRuleProposals,
} from "../../DataSecurity/DataSecurityJobs";
import DataStoreOwnerEvidenceReader, {
  CodeOwnersFileCache,
} from "../../DataSecurity/Owners/DataStoreOwnerEvidenceReader";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import SetStoreOwnersAction from "./Actions/SetStoreOwnersAction";
import { DataSecurityAiPlanOutcome } from "./DataSecurityAiAction";
import DataSecurityAiEngine from "./DataSecurityAiEngine";
import DataSecurityAiProposals from "./DataSecurityAiProposals";
import DataStoreOwnerPlanner, {
  DATA_STORE_FOR_OWNER_PLAN_SELECT,
  DataStoreForOwnerPlan,
} from "./DataStoreOwnerPlanner";

/*
 * WHEN ONEUPTIME AI PROPOSES OWNERS ON ITS OWN (#10374): once a day for the
 * stores that are new, and when a cloud connection is first read - under
 * the project's Data Security AI rules, as all its work is.
 *
 *  1. The project's two switches: Enable AI, and "Work on new Data
 *     Security issues". Off, nothing runs and nothing is written.
 *  2. Sensitive stores go first. Each one's "Nobody owns this sensitive
 *     store" issue that OneUptime AI has not worked on for owners yet is
 *     handed to the engine (DataSecurityAiEngine, through its queue), which
 *     matches the project's AI rules, keeps to the day's limits, and
 *     proposes the owners for the issue (SetStoreOwnersAction): the issue's
 *     own check proves them.
 *  3. Then the stores that are not sensitive (#10374's decision: a store
 *     becomes sensitive the day a scan finds something in it), newest
 *     first, at most STORE_OWNERS_WITHOUT_ISSUE_PER_DAY a day: each matched
 *     against the AI rules as a store with no issue - a rule that names a
 *     check or a severity matches none - and proposed for the store alone.
 *  4. Then, a few minutes on, the owner rules the proposals share
 *     (DataStoreOwnerRuleProposals).
 *
 * An owner is told, so every proposal waits for a person, whatever a rule
 * says (ChangesWhoIsTold). Read and written as OneUptime (root), with the
 * project scoped explicitly. Never throws.
 */

// How far back a daily run looks for new stores: a day, and the run's own drift.
export const NEW_STORE_WINDOW_IN_HOURS: number = 26;

// The most issues one run hands the engine.
export const OWNER_ISSUES_PER_RUN: number = 200;

// The most stores with no issue OneUptime AI proposes owners for in a day.
export const STORE_OWNERS_WITHOUT_ISSUE_PER_DAY: number = 100;

// The most stores one run reads.
const MAX_STORES_READ: number = 2000;

export interface DataStoreOwnerRunOutcome {
  // Nothing ran: the project's switches are off, or its rules unreadable.
  skipped: "ai-off" | "rules-unreadable" | null;
  // Issues handed to the engine.
  issuesQueued: number;
  // Stores with no issue whose owners were proposed.
  storesProposed: number;
}

function idOf(row: { id?: ObjectID | null; _id?: unknown } | null): string {
  return (row?.id?.toString() || String(row?._id || "")).toLowerCase();
}

export default class DataStoreOwnerProposalRun {
  @CaptureSpan()
  public static async run(data: {
    projectId: ObjectID;
    // A connection read for the first time: its stores, whatever their age.
    cloudConnectionId?: ObjectID | undefined;
    now?: Date | undefined;
  }): Promise<DataStoreOwnerRunOutcome> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const outcome: DataStoreOwnerRunOutcome = {
      skipped: null,
      issuesQueued: 0,
      storesProposed: 0,
    };

    try {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: {
          _id: true,
          enableAi: true,
          enableAutomaticDataSecurityAi: true,
          requireTwoApprovalsForRiskierFixes: true,
        },
        props: { isRoot: true },
      });

      if (
        !project ||
        project.enableAi === false ||
        project.enableAutomaticDataSecurityAi !== true
      ) {
        return { ...outcome, skipped: "ai-off" };
      }

      const proposedStoreIds: Set<string> =
        await DataStoreOwnerProposalRun.readStoresWithOwnerProposals(
          data.projectId,
        );

      // 2. Sensitive stores: their issues, to the engine.
      const issues: Array<DataSecurityIssue> =
        await DataSecurityIssueService.findBy({
          query: {
            projectId: data.projectId,
            checkId: NO_OWNER_CHECK_ID,
            status: DataSecurityIssueStatus.Open,
          },
          select: { _id: true, dataStoreId: true },
          sort: { riskScore: SortOrder.Descending },
          skip: 0,
          limit: MAX_STORES_READ,
          props: { isRoot: true },
        });
      const sensitiveStoreIds: Set<string> = new Set();

      for (const issue of issues) {
        const storeId: string = issue.dataStoreId?.toString().toLowerCase() || "";

        if (!issue.id || !storeId) {
          continue;
        }

        sensitiveStoreIds.add(storeId);

        if (
          proposedStoreIds.has(storeId) ||
          outcome.issuesQueued >= OWNER_ISSUES_PER_RUN
        ) {
          continue;
        }

        await queueDataSecurityAiEvaluation({
          projectId: data.projectId,
          dataSecurityIssueId: issue.id,
        });
        outcome.issuesQueued++;
      }

      // 3. The stores that are not sensitive: new, or the connection's.
      const budget: number =
        STORE_OWNERS_WITHOUT_ISSUE_PER_DAY -
        (await DataStoreOwnerProposalRun.countProposedWithoutIssueToday({
          projectId: data.projectId,
          now,
        }));

      if (budget > 0) {
        const rules: Array<AutoRemediationRule> | null =
          await DataSecurityAiEngine.readRules(data.projectId);

        if (!rules) {
          return { ...outcome, skipped: "rules-unreadable" };
        }

        outcome.storesProposed = await DataStoreOwnerProposalRun.proposeForStores(
          {
            projectId: data.projectId,
            cloudConnectionId: data.cloudConnectionId,
            now,
            budget,
            rules,
            skipStoreIds: new Set([...sensitiveStoreIds, ...proposedStoreIds]),
            requireTwoApprovalsForRiskierChanges:
              project.requireTwoApprovalsForRiskierFixes === true,
          },
        );
      }

      // 4. The rules the proposals share, a few minutes on.
      if (outcome.storesProposed > 0) {
        await queueDataStoreOwnerRuleProposals(data.projectId);
      }

      return outcome;
    } catch (error) {
      logger.error(
        `DataSecurity owners: could not propose owners for project ${data.projectId.toString()}: ${error}`,
      );
      return outcome;
    }
  }

  /*
   * The stores OneUptime AI proposed owners for already - waiting, made,
   * dismissed, undone or failed: one that expired is no longer needed and
   * may be proposed for again.
   */
  public static async readStoresWithOwnerProposals(
    projectId: ObjectID,
  ): Promise<Set<string>> {
    const proposals: Array<DataSecurityAiProposal> =
      await DataSecurityAiProposalService.findBy({
        query: {
          projectId,
          kind: DataSecurityAiProposalKind.SetStoreOwners,
          status: QueryHelper.notEquals(DataSecurityAiProposalStatus.Expired),
        },
        select: { _id: true, dataStoreId: true },
        skip: 0,
        limit: MAX_STORES_READ * 5,
        props: { isRoot: true },
      });

    return new Set(
      proposals
        .map((proposal: DataSecurityAiProposal): string => {
          return proposal.dataStoreId?.toString().toLowerCase() || "";
        })
        .filter((id: string): boolean => {
          return id.length > 0;
        }),
    );
  }

  // Owners proposed for stores with no issue in the last day.
  public static async countProposedWithoutIssueToday(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<number> {
    return (
      await DataSecurityAiProposalService.countBy({
        query: {
          projectId: data.projectId,
          kind: DataSecurityAiProposalKind.SetStoreOwners,
          dataSecurityIssueId: QueryHelper.isNull(),
          createdAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.addRemoveHours(data.now, -24),
          ),
        },
        props: { isRoot: true },
      })
    ).toNumber();
  }

  /*
   * What the project's AI rules say of judging a store that has no issue:
   * each rule matched against the store alone, so one that names a check or
   * a severity matches none.
   */
  public static async decideForStore(data: {
    projectId: ObjectID;
    store: DataStoreForOwnerPlan;
    rules: ReadonlyArray<AutoRemediationRule>;
    categoryOf: Map<string, string>;
  }): Promise<{
    judge: DataSecurityAiWorkDecision;
    llmProviderId: string;
  } | null> {
    const asIssue: DataSecurityIssue = new DataSecurityIssue();

    asIssue.dataTypeIds = data.store.dataTypeIds || [];

    const facts: DataSecurityAiRuleIssue =
      await DataSecurityAiEngine.readRuleIssue({
        projectId: data.projectId,
        issue: asIssue,
        store: data.store as DataStore,
        categoryOf: data.categoryOf,
      });
    const plan: DataSecurityAiPlan = decideDataSecurityAiWork({
      isAiEnabled: true,
      isAutomaticOn: true,
      rules: {
        rulesSetUp: data.rules.length > 0,
        matchingRules: DataSecurityAiEngine.matchRules(data.rules, facts),
      },
      issue: {},
    });

    if (plan.skip !== null) {
      return null;
    }

    const judge: DataSecurityAiWorkDecision =
      plan.works[DataSecurityAiWork.Judge];

    return judge.autonomy === DataSecurityAiAutonomy.Off
      ? null
      : { judge, llmProviderId: plan.llmProviderId };
  }

  // Owners for the stores that are not sensitive, newest first, up to the budget.
  private static async proposeForStores(data: {
    projectId: ObjectID;
    cloudConnectionId?: ObjectID | undefined;
    now: Date;
    budget: number;
    rules: ReadonlyArray<AutoRemediationRule>;
    skipStoreIds: Set<string>;
    requireTwoApprovalsForRiskierChanges: boolean;
  }): Promise<number> {
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId: data.projectId,
        isArchived: false,
        ...(data.cloudConnectionId
          ? { cloudConnectionId: data.cloudConnectionId }
          : {
              firstSeenAt: QueryHelper.greaterThanEqualTo(
                OneUptimeDate.addRemoveHours(
                  data.now,
                  -NEW_STORE_WINDOW_IN_HOURS,
                ),
              ),
            }),
      },
      select: DATA_STORE_FOR_OWNER_PLAN_SELECT,
      sort: { firstSeenAt: SortOrder.Descending },
      skip: 0,
      limit: MAX_STORES_READ,
      props: { isRoot: true },
    });
    const candidates: Array<DataStore> = stores.filter(
      (store: DataStore): boolean => {
        return Boolean(idOf(store)) && !data.skipStoreIds.has(idOf(store));
      },
    );

    if (candidates.length === 0) {
      return 0;
    }

    const owned: Set<string> = await DataStoreOwnerRuleEngineService.getOwnedStoreIds(
      {
        projectId: data.projectId,
        dataStoreIds: candidates.map((store: DataStore): ObjectID => {
          return new ObjectID(idOf(store));
        }),
      },
    );
    const directory: DataStoreOwnerDirectory =
      await DataStoreOwnerEvidenceReader.readDirectory(data.projectId);
    const dataTypes: {
      namer: DataTypeNamer;
      categoryOf: Map<string, string>;
    } = await DataSecurityAiEngine.readDataTypes(data.projectId);
    const codeOwnersCache: CodeOwnersFileCache = new Map();
    let proposed: number = 0;

    for (const store of candidates) {
      if (proposed >= data.budget) {
        break;
      }

      if (owned.has(idOf(store))) {
        continue;
      }

      const decided: {
        judge: DataSecurityAiWorkDecision;
        llmProviderId: string;
      } | null = await DataStoreOwnerProposalRun.decideForStore({
        projectId: data.projectId,
        store,
        rules: data.rules,
        categoryOf: dataTypes.categoryOf,
      });

      if (!decided) {
        continue;
      }

      const outcome: DataSecurityAiPlanOutcome =
        await DataStoreOwnerPlanner.plan({
          projectId: data.projectId,
          store,
          isSensitive: false,
          directory,
          dataTypeNamer: dataTypes.namer,
          llmProviderId: decided.llmProviderId,
          codeOwnersCache,
        });

      if (outcome.kind === "nothing") {
        continue;
      }

      const verdict: DataSecurityAiWithoutAskingVerdict =
        getDataSecurityAiWithoutAskingVerdict({
          work: decided.judge,
          safety: DataSecurityAiChangeSafety.ChangesWhoIsTold,
          meetsDefaultConditions: false,
          isNamedByRule: false,
          requireTwoApprovalsForRiskierChanges:
            data.requireTwoApprovalsForRiskierChanges,
          changesWithoutAskingThisHour: 0,
        });

      for (const change of outcome.changes) {
        await DataSecurityAiProposals.propose({
          projectId: data.projectId,
          issue: null,
          store,
          action: SetStoreOwnersAction,
          change,
          work: decided.judge,
          verdict,
          // Not sensitive: listed after every store that is.
          riskScore: 0,
          now: data.now,
        });
        proposed++;
      }
    }

    return proposed;
  }
}
