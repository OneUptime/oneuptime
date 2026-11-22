import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import DataSecurityAiDecision from "../../../../Models/DatabaseModels/DataSecurityAiDecision";
import DataSecurityCustomDataType from "../../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import Label from "../../../../Models/DatabaseModels/Label";
import Project from "../../../../Models/DatabaseModels/Project";
import Service from "../../../../Models/DatabaseModels/Service";
import AutoRemediationTriggerEntity from "../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import { customDataTypeId } from "../../../../Types/DataSecurity/CustomDataTypeId";
import {
  DATA_SECURITY_AI_ISSUES_PER_PROJECT_PER_DAY,
  DATA_SECURITY_AI_ISSUES_PER_STORE_PER_DAY,
  DATA_SECURITY_AI_PROPOSAL_KINDS,
  DataSecurityAiAutonomy,
  DataSecurityAiPlan,
  DataSecurityAiRuleFacts,
  DataSecurityAiSkip,
  DataSecurityAiWithoutAskingVerdict,
  DataSecurityAiWork,
  DataSecurityAiWorkDecision,
  decideDataSecurityAiWork,
  getDataSecurityAiWithoutAskingVerdict,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import {
  DataSecurityAiDecisionEntry,
  DataSecurityAiDecisionHelper,
  DataSecurityAiDecisionReason,
  DataSecurityAiIssueSkipReason,
} from "../../../../Types/DataSecurity/DataSecurityAiDecision";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import { getBuiltInDataType } from "../../../../Types/DataSecurity/DataTypeCatalog";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DataSecurityAiRuleIssue,
  doesDataSecurityAiRuleMatch,
} from "../../../../Utils/DataSecurity/DataSecurityAiRuleMatch";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import AutoRemediationRuleService from "../../../Services/AutoRemediationRuleService";
import DataSecurityAiDecisionService from "../../../Services/DataSecurityAiDecisionService";
import DataSecurityAiProposalService from "../../../Services/DataSecurityAiProposalService";
import DataSecurityCustomDataTypeService from "../../../Services/DataSecurityCustomDataTypeService";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import DataStoreService from "../../../Services/DataStoreService";
import ProjectService from "../../../Services/ProjectService";
import ServiceService from "../../../Services/ServiceService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import { RuleEvaluation } from "../../PatternWorkScope";
import logIfRuleReadWasTruncated from "../../Rules/RuleEngineRuleRead";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  DataSecurityAiAction,
  DataSecurityAiIssueContext,
  DataSecurityAiPlanOutcome,
  DataSecurityAiPlannedChange,
} from "./DataSecurityAiAction";
import DataSecurityAiActions from "./DataSecurityAiActions";
import DataSecurityAiProposals from "./DataSecurityAiProposals";
import DataSecurityIssueAnalysis, {
  DataSecurityIssueAnalysisOutcome,
} from "./DataSecurityIssueAnalysis";

/*
 * THE WORK ONEUPTIME AI DOES ON A DATA SECURITY ISSUE WHEN IT OPENS
 * (#10364): one evaluation per new or reopened issue, queued when the
 * issue opens (DataSecurityIntegrations.onIssuesOpened) and deduplicated by
 * the issue (DataSecurityJobs).
 *
 *  1. The project's two switches: Enable AI, and "Work on new Data Security
 *     issues" (Project.enableAutomaticDataSecurityAi). Off, nothing runs
 *     and nothing is written: the page says AI is off.
 *  2. The issue, still open, and its store; the project's Data Security AI
 *     rules, matched against them (Utils/DataSecurity/
 *     DataSecurityAiRuleMatch); and what each kind of work comes to
 *     (Types/DataSecurity/DataSecurityAi): the rules', or the defaults.
 *  3. The day's limits: at most DATA_SECURITY_AI_ISSUES_PER_STORE_PER_DAY
 *     issues of one store, and DATA_SECURITY_AI_ISSUES_PER_PROJECT_PER_DAY
 *     of the project, worked on in a day.
 *  4. Analyze: OneUptime AI's analysis (DataSecurityIssueAnalysis, #10369),
 *     written again only when what it is written from changed - and handed
 *     to the work planned after it.
 *  5. Contain, Fix, Judge: each action of the work plans its change; each
 *     change is proposed, or made without asking where the verdict allows
 *     - the circuit breaker counts the hour's changes made without asking
 *     (DataSecurityAiProposals.propose).
 *  6. One record of what each kind of work did, or why it did nothing
 *     (DataSecurityAiDecision): Why AI did not act.
 *
 * Read and written as OneUptime (root), with the project scoped
 * explicitly: the engine is a system actor. It never throws.
 */

// What a Data Security AI rule is read with: its conditions and what it decides.
const RULE_SELECT: {
  _id: true;
  name: true;
  criteria: true;
  llmProviderId: true;
  dataSecurityAnalyze: true;
  dataSecurityContain: true;
  dataSecurityFix: true;
  dataSecurityJudge: true;
  dataSecurityChecks: true;
  dataSecurityCheckGroups: true;
  dataSecuritySeverities: true;
  dataStoreSensitivities: true;
  dataStoreKinds: true;
  dataStoreProviders: true;
  dataStoreEnvironments: true;
  dataStoreLabels: { _id: true };
  dataCategories: true;
  services: { _id: true };
  serviceLabels: { _id: true };
  serviceNamePattern: true;
} = {
  _id: true,
  name: true,
  criteria: true,
  llmProviderId: true,
  dataSecurityAnalyze: true,
  dataSecurityContain: true,
  dataSecurityFix: true,
  dataSecurityJudge: true,
  dataSecurityChecks: true,
  dataSecurityCheckGroups: true,
  dataSecuritySeverities: true,
  dataStoreSensitivities: true,
  dataStoreKinds: true,
  dataStoreProviders: true,
  dataStoreEnvironments: true,
  dataStoreLabels: { _id: true },
  dataCategories: true,
  services: { _id: true },
  serviceLabels: { _id: true },
  serviceNamePattern: true,
};

export interface DataSecurityAiEvaluation {
  plan: DataSecurityAiPlan;
  entries: Array<DataSecurityAiDecisionEntry>;
  didAct: boolean;
  skipReason: DataSecurityAiIssueSkipReason | null;
}

// The kinds of work that propose changes, in the order they are planned.
const PROPOSING_WORKS: ReadonlyArray<DataSecurityAiWork> = [
  DataSecurityAiWork.Contain,
  DataSecurityAiWork.Fix,
  DataSecurityAiWork.Judge,
];

function labelIdsOf(labels: Array<Label> | undefined): Array<string> {
  return (labels || [])
    .map((label: Label): string => {
      return (label.id || label._id || "").toString().toLowerCase();
    })
    .filter((id: string): boolean => {
      return id.length > 0;
    });
}

export default class DataSecurityAiEngine {
  @CaptureSpan()
  public static async evaluateIssue(data: {
    projectId: ObjectID;
    dataSecurityIssueId: ObjectID;
    now?: Date | undefined;
  }): Promise<DataSecurityAiEvaluation | null> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    let issue: DataSecurityIssue | null = null;

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

      // Off, nothing runs and nothing is written.
      if (
        !project ||
        project.enableAi === false ||
        project.enableAutomaticDataSecurityAi !== true
      ) {
        return null;
      }

      issue = await DataSecurityIssueService.findOneBy({
        query: { _id: data.dataSecurityIssueId, projectId: data.projectId },
        select: {
          _id: true,
          projectId: true,
          checkId: true,
          checkGroup: true,
          title: true,
          evidence: true,
          severity: true,
          riskScore: true,
          status: true,
          dataTypeIds: true,
          dataStoreId: true,
          reopenCount: true,
          dataStore: {
            name: true,
            kind: true,
            region: true,
            sensitivity: true,
            providerResourceId: true,
          },
        },
        props: { isRoot: true },
      });

      // Resolved, accepted or set aside before its turn came: nothing to do.
      if (
        !issue?.id ||
        !issue.dataStoreId ||
        issue.status !== DataSecurityIssueStatus.Open
      ) {
        return null;
      }

      const store: DataStore | null = await DataStoreService.findOneById({
        id: issue.dataStoreId,
        select: {
          _id: true,
          name: true,
          kind: true,
          provider: true,
          environment: true,
          sensitivity: true,
          serviceId: true,
          isArchived: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

      if (!store?.id || store.isArchived) {
        return null;
      }

      const dataTypes: {
        namer: DataTypeNamer;
        categoryOf: Map<string, string>;
      } = await DataSecurityAiEngine.readDataTypes(data.projectId);
      const facts: DataSecurityAiRuleIssue =
        await DataSecurityAiEngine.readRuleIssue({
          projectId: data.projectId,
          issue,
          store,
          categoryOf: dataTypes.categoryOf,
        });
      const rules: Array<AutoRemediationRule> | null =
        await DataSecurityAiEngine.readRules(data.projectId);
      const plan: DataSecurityAiPlan = decideDataSecurityAiWork({
        isAiEnabled: true,
        isAutomaticOn: true,
        rules: rules
          ? {
              rulesSetUp: rules.length > 0,
              matchingRules: DataSecurityAiEngine.matchRules(rules, facts),
            }
          : null,
        issue: { severity: issue.severity },
      });

      if (plan.skip === DataSecurityAiSkip.RulesUnreadable) {
        return await DataSecurityAiEngine.record({
          projectId: data.projectId,
          issue,
          plan,
          entries: [],
          skipReason: DataSecurityAiIssueSkipReason.RulesUnreadable,
        });
      }

      if (plan.skip === DataSecurityAiSkip.NoMatchingRule) {
        return await DataSecurityAiEngine.record({
          projectId: data.projectId,
          issue,
          plan,
          entries: [],
          skipReason: DataSecurityAiIssueSkipReason.NoRuleMatched,
        });
      }

      const limit: DataSecurityAiIssueSkipReason | null =
        await DataSecurityAiEngine.getDailyLimitReached({
          projectId: data.projectId,
          dataStoreId: store.id,
          now,
        });

      if (limit) {
        return await DataSecurityAiEngine.record({
          projectId: data.projectId,
          issue,
          plan,
          entries: [],
          skipReason: limit,
        });
      }

      const context: DataSecurityAiIssueContext = {
        projectId: data.projectId,
        issue,
        store,
        dataTypeNamer: dataTypes.namer,
        now,
        llmProviderId: plan.llmProviderId,
      };
      const entries: Array<DataSecurityAiDecisionEntry> = [];

      entries.push(
        await DataSecurityAiEngine.analyze({
          context,
          work: plan.works[DataSecurityAiWork.Analyze],
          llmProviderId: plan.llmProviderId,
        }),
      );

      for (const work of PROPOSING_WORKS) {
        entries.push(
          ...(await DataSecurityAiEngine.propose({
            context,
            work,
            decision: plan.works[work],
            requireTwoApprovalsForRiskierChanges:
              project.requireTwoApprovalsForRiskierFixes === true,
          })),
        );
      }

      return await DataSecurityAiEngine.record({
        projectId: data.projectId,
        issue,
        plan,
        entries,
        skipReason: null,
      });
    } catch (error) {
      logger.error(
        `DataSecurity AI: could not work on issue ${data.dataSecurityIssueId.toString()} of project ${data.projectId.toString()}: ${error}`,
      );

      if (issue?.id && issue.dataStoreId) {
        try {
          await DataSecurityAiEngine.record({
            projectId: data.projectId,
            issue,
            plan: null,
            entries: [],
            skipReason: DataSecurityAiIssueSkipReason.EvaluationFailed,
          });
        } catch (recordError) {
          logger.error(
            `DataSecurity AI: could not record why issue ${data.dataSecurityIssueId.toString()} was not worked on: ${recordError}`,
          );
        }
      }

      return null;
    }
  }

  /*
   * The project's own data types, by name and category: what the issue's
   * types are called, and what a rule's data categories match.
   */
  public static async readDataTypes(projectId: ObjectID): Promise<{
    namer: DataTypeNamer;
    categoryOf: Map<string, string>;
  }> {
    const rows: Array<DataSecurityCustomDataType> =
      await DataSecurityCustomDataTypeService.findBy({
        query: { projectId },
        select: { _id: true, name: true, category: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });
    const names: Map<string, string> = new Map();
    const categoryOf: Map<string, string> = new Map();

    for (const row of rows) {
      if (!row.id) {
        continue;
      }

      const id: string = customDataTypeId(row.id.toString());

      names.set(id, row.name || "");

      if (row.category) {
        categoryOf.set(id, row.category);
      }
    }

    return { namer: new DataTypeNamer(names), categoryOf };
  }

  // The issue as a rule reads it: its check, its store, its data, its service.
  public static async readRuleIssue(data: {
    projectId: ObjectID;
    issue: DataSecurityIssue;
    store: DataStore;
    categoryOf: Map<string, string>;
  }): Promise<DataSecurityAiRuleIssue> {
    const categories: Set<string> = new Set();

    for (const dataTypeId of data.issue.dataTypeIds || []) {
      const category: string | undefined =
        getBuiltInDataType(dataTypeId)?.category ||
        data.categoryOf.get(dataTypeId);

      if (category) {
        categories.add(category);
      }
    }

    let service: Service | null = null;

    if (data.store.serviceId) {
      service = await ServiceService.findOneBy({
        query: { _id: data.store.serviceId, projectId: data.projectId },
        select: { _id: true, name: true, labels: { _id: true } },
        props: { isRoot: true },
      });
    }

    return {
      checkId: data.issue.checkId || "",
      checkGroup: data.issue.checkGroup || "",
      severity: data.issue.severity || "",
      sensitivity: data.store.sensitivity || "",
      kind: data.store.kind || "",
      provider: data.store.provider || "",
      environment: data.store.environment || "",
      labelIds: labelIdsOf(data.store.labels),
      dataCategories: Array.from(categories),
      serviceId: service?.id?.toString() || "",
      serviceName: service?.name || "",
      serviceLabelIds: labelIdsOf(service?.labels),
    };
  }

  // The project's enabled Data Security AI rules, by name; null when unreadable.
  public static async readRules(
    projectId: ObjectID,
  ): Promise<Array<AutoRemediationRule> | null> {
    try {
      const rules: Array<AutoRemediationRule> =
        await AutoRemediationRuleService.findBy({
          query: {
            projectId,
            isEnabled: true,
            triggerEntityType: AutoRemediationTriggerEntity.DataSecurityIssue,
          },
          select: RULE_SELECT,
          sort: { name: SortOrder.Ascending },
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

      logIfRuleReadWasTruncated({
        ruleKind: "AutoRemediationRule",
        projectId,
        rulesRead: rules.length,
      });

      return rules;
    } catch (error) {
      logger.error(
        `DataSecurity AI: could not read the Data Security AI rules of project ${projectId.toString()}; OneUptime AI does nothing they may have kept out: ${error}`,
      );
      return null;
    }
  }

  // The rules that match the issue, as the decision reads them.
  @RuleEvaluation()
  public static matchRules(
    rules: ReadonlyArray<AutoRemediationRule>,
    issue: DataSecurityAiRuleIssue,
  ): Array<DataSecurityAiRuleFacts> {
    return rules
      .filter((rule: AutoRemediationRule): boolean => {
        return doesDataSecurityAiRuleMatch(rule, issue);
      })
      .map((rule: AutoRemediationRule): DataSecurityAiRuleFacts => {
        return {
          _id: rule.id?.toString() || rule._id,
          name: rule.name,
          llmProviderId: rule.llmProviderId?.toString(),
          dataSecurityAnalyze: rule.dataSecurityAnalyze,
          dataSecurityContain: rule.dataSecurityContain,
          dataSecurityFix: rule.dataSecurityFix,
          dataSecurityJudge: rule.dataSecurityJudge,
        };
      });
  }

  /*
   * Whether OneUptime AI already worked on as many of the store's - or the
   * project's - issues as it may in a day: counted from its own records of
   * the evaluations it acted in, over the last 24 hours.
   */
  public static async getDailyLimitReached(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    now: Date;
  }): Promise<DataSecurityAiIssueSkipReason | null> {
    const since: Date = OneUptimeDate.addRemoveHours(data.now, -24);
    const ofStore: number = (
      await DataSecurityAiDecisionService.countBy({
        query: {
          projectId: data.projectId,
          dataStoreId: data.dataStoreId,
          didAct: true,
          createdAt: QueryHelper.greaterThanEqualTo(since),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (ofStore >= DATA_SECURITY_AI_ISSUES_PER_STORE_PER_DAY) {
      return DataSecurityAiIssueSkipReason.StoreDailyLimitReached;
    }

    const ofProject: number = (
      await DataSecurityAiDecisionService.countBy({
        query: {
          projectId: data.projectId,
          didAct: true,
          createdAt: QueryHelper.greaterThanEqualTo(since),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    return ofProject >= DATA_SECURITY_AI_ISSUES_PER_PROJECT_PER_DAY
      ? DataSecurityAiIssueSkipReason.ProjectDailyLimitReached
      : null;
  }

  // The changes OneUptime AI made without asking in the project in the last hour.
  public static async countChangesWithoutAskingThisHour(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<number> {
    return (
      await DataSecurityAiProposalService.countBy({
        query: {
          projectId: data.projectId,
          appliedAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.addRemoveHours(data.now, -1),
          ),
          approvedByUserId: QueryHelper.isNull(),
        },
        props: { isRoot: true },
      })
    ).toNumber();
  }

  /*
   * Analyze (#10369): only where the work is on, and only when what the
   * analysis is written from changed since the issue's analysis was - the
   * analyst hashes it, so an issue opening again with nothing changed makes
   * no model call. Whatever comes of it, the issue's analysis is handed to
   * the work planned after it (DataSecurityAiIssueContext.analysis).
   */
  private static async analyze(data: {
    context: DataSecurityAiIssueContext;
    work: DataSecurityAiWorkDecision;
    llmProviderId: string;
  }): Promise<DataSecurityAiDecisionEntry> {
    const entry: (
      reason: DataSecurityAiDecisionReason,
    ) => DataSecurityAiDecisionEntry = (
      reason: DataSecurityAiDecisionReason,
    ): DataSecurityAiDecisionEntry => {
      return {
        work: DataSecurityAiWork.Analyze,
        reason,
        ruleId: data.work.ruleId,
        ruleName: data.work.ruleName,
      };
    };

    if (data.work.autonomy === DataSecurityAiAutonomy.Off) {
      // One a person asked for still says what the issue is.
      data.context.analysis =
        (
          await DataSecurityIssueAnalysis.readStored({
            projectId: data.context.projectId,
            issueId: data.context.issue.id!,
          })
        )?.record || null;

      return entry(DataSecurityAiDecisionReason.WorkOff);
    }

    const outcome: DataSecurityIssueAnalysisOutcome =
      await DataSecurityIssueAnalysis.analyze({
        projectId: data.context.projectId,
        issue: data.context.issue,
        dataTypeNamer: data.context.dataTypeNamer,
        llmProviderId: ObjectID.isValidUUID(data.llmProviderId)
          ? new ObjectID(data.llmProviderId)
          : undefined,
        now: data.context.now,
      });

    data.context.analysis = outcome.analysis?.record || null;

    return outcome.analyzed
      ? entry(DataSecurityAiDecisionReason.Analyzed)
      : entry(outcome.reason);
  }

  /*
   * One kind of work that proposes changes: each of its actions that can
   * change anything for the issue's check plans, and each change it plans
   * is proposed - or made, where the verdict lets it run without asking.
   */
  private static async propose(data: {
    context: DataSecurityAiIssueContext;
    work: DataSecurityAiWork;
    decision: DataSecurityAiWorkDecision;
    requireTwoApprovalsForRiskierChanges: boolean;
  }): Promise<Array<DataSecurityAiDecisionEntry>> {
    const base: DataSecurityAiDecisionEntry = {
      work: data.work,
      reason: DataSecurityAiDecisionReason.WorkOff,
      ruleId: data.decision.ruleId,
      ruleName: data.decision.ruleName,
    };

    if (data.decision.autonomy === DataSecurityAiAutonomy.Off) {
      return [base];
    }

    const actions: Array<DataSecurityAiAction> = DataSecurityAiActions.forWork(
      data.work,
    ).filter((action: DataSecurityAiAction): boolean => {
      return action.appliesToCheck(data.context.issue.checkId);
    });

    if (actions.length === 0) {
      return [
        { ...base, reason: DataSecurityAiDecisionReason.NoActionForIssue },
      ];
    }

    const entries: Array<DataSecurityAiDecisionEntry> = [];

    for (const action of actions) {
      let outcome: DataSecurityAiPlanOutcome;

      try {
        outcome = await action.plan(data.context);
      } catch (error) {
        logger.error(
          `DataSecurity AI: ${action.kind} could not plan a change for issue ${data.context.issue.id?.toString()}: ${error}`,
        );
        entries.push({
          ...base,
          kind: action.kind,
          reason: DataSecurityAiDecisionReason.NothingToPropose,
          detail: "could-not-plan",
        });
        continue;
      }

      if (outcome.kind === "nothing") {
        entries.push({
          ...base,
          kind: action.kind,
          reason: DataSecurityAiDecisionReason.NothingToPropose,
          detail: outcome.detail,
        });
        continue;
      }

      for (const change of outcome.changes) {
        entries.push(
          await DataSecurityAiEngine.proposeChange({
            context: data.context,
            action,
            change,
            decision: data.decision,
            requireTwoApprovalsForRiskierChanges:
              data.requireTwoApprovalsForRiskierChanges,
          }),
        );
      }
    }

    return entries;
  }

  private static async proposeChange(data: {
    context: DataSecurityAiIssueContext;
    action: DataSecurityAiAction;
    change: DataSecurityAiPlannedChange;
    decision: DataSecurityAiWorkDecision;
    requireTwoApprovalsForRiskierChanges: boolean;
  }): Promise<DataSecurityAiDecisionEntry> {
    const verdict: DataSecurityAiWithoutAskingVerdict =
      getDataSecurityAiWithoutAskingVerdict({
        work: data.decision,
        safety:
          data.change.safety ||
          DATA_SECURITY_AI_PROPOSAL_KINDS[data.action.kind].safety,
        meetsDefaultConditions: data.change.meetsDefaultConditions,
        isNamedByRule: data.change.isNamedByRule === true,
        requireTwoApprovalsForRiskierChanges:
          data.requireTwoApprovalsForRiskierChanges,
        changesWithoutAskingThisHour:
          data.decision.autonomy === DataSecurityAiAutonomy.WithoutAsking
            ? await DataSecurityAiEngine.countChangesWithoutAskingThisHour({
                projectId: data.context.projectId,
                now: data.context.now,
              })
            : 0,
      });

    return await DataSecurityAiProposals.propose({
      projectId: data.context.projectId,
      issue: data.context.issue,
      store: data.context.store,
      action: data.action,
      change: data.change,
      work: data.decision,
      verdict,
      now: data.context.now,
    });
  }

  // The record of this evaluation: Why AI did not act, and the day's ledger.
  private static async record(data: {
    projectId: ObjectID;
    issue: DataSecurityIssue;
    plan: DataSecurityAiPlan | null;
    entries: Array<DataSecurityAiDecisionEntry>;
    skipReason: DataSecurityAiIssueSkipReason | null;
  }): Promise<DataSecurityAiEvaluation> {
    const didAct: boolean = DataSecurityAiDecisionHelper.didAct(data.entries);
    const skipReason: DataSecurityAiIssueSkipReason | null =
      data.skipReason ||
      (didAct ? null : DataSecurityAiIssueSkipReason.NothingToDo);
    const decision: DataSecurityAiDecision = new DataSecurityAiDecision();

    decision.projectId = data.projectId;
    decision.dataSecurityIssueId = data.issue.id!;
    decision.dataStoreId = data.issue.dataStoreId!;
    decision.didAct = didAct;
    decision.didAnalyze = data.entries.some(
      (entry: DataSecurityAiDecisionEntry): boolean => {
        return entry.reason === DataSecurityAiDecisionReason.Analyzed;
      },
    );
    decision.issueReopenCount = data.issue.reopenCount || 0;
    decision.entries = data.entries.map(
      (entry: DataSecurityAiDecisionEntry): JSONObject => {
        return DataSecurityAiDecisionHelper.toJSON(entry);
      },
    );

    if (skipReason) {
      decision.skipReason = skipReason;
    }

    await DataSecurityAiDecisionService.create({
      data: decision,
      props: { isRoot: true },
    });

    return {
      plan:
        data.plan ||
        decideDataSecurityAiWork({
          isAiEnabled: true,
          isAutomaticOn: true,
          rules: null,
          issue: {},
        }),
      entries: data.entries,
      didAct,
      skipReason,
    };
  }
}
