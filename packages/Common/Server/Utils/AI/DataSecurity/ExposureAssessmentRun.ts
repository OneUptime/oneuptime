import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import Project from "../../../../Models/DatabaseModels/Project";
import OneUptimeDate from "../../../../Types/Date";
import {
  DataSecurityAiAutonomy,
  DataSecurityAiPlan,
  DataSecurityAiWork,
  decideDataSecurityAiWork,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import DataSensitivity, {
  isDataSensitivity,
} from "../../../../Types/DataSecurity/DataSensitivity";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import { isAssessedOnItsOwn } from "../../../../Types/DataSecurity/ExposureAssessment";
import ObjectID from "../../../../Types/ObjectID";
import { DataSecurityAiRuleIssue } from "../../../../Utils/DataSecurity/DataSecurityAiRuleMatch";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import DataStoreService from "../../../Services/DataStoreService";
import ProjectService from "../../../Services/ProjectService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import DataSecurityAiEngine from "./DataSecurityAiEngine";
import ExposureAssessmentDrafter, {
  ExposureDraftOutcome,
} from "./ExposureAssessmentDrafter";

/*
 * WHEN AN EXPOSURE IS ASSESSED ON ITS OWN (#10377): as Data Security opens
 * a security case for a Critical exposure (DataSecurityIntegrations), one
 * queued job per case (DataSecurityJobs).
 *
 *  1. The issue that opened the case, and its store: a Critical exposure
 *     - public, or shared outside the company - of a store with Restricted
 *     or Confidential data (isAssessedOnItsOwn). Anything else is assessed
 *     only when a person asks: a bucket of website images gets none.
 *  2. Plain code's assessment is started on the case, once
 *     (ExposureAssessmentDrafter.startOnItsOwn): the window, who could read
 *     it, whose data, the secrets to rotate and the breach laws that may
 *     apply are worked out every time it is read, AI on or off.
 *  3. OneUptime AI writes it up under the project's Data Security AI rules
 *     (#10364): Enable AI and "Work on new Data Security issues" on, and
 *     the issue's Analyze work not Off by the rules that match it - an
 *     assessment changes nothing, as an analysis does not. Its call runs on
 *     the provider the rule picks and counts toward the daily budget
 *     (AUTONOMOUS_AI_FEATURES); a missing provider, credits used up or the
 *     day's limit reached write nothing, and a person can still ask.
 *
 * Read and written as OneUptime (root), with the project scoped
 * explicitly. Never throws.
 */

export enum ExposureRunSkip {
  // The issue is gone, not open, or not in the case.
  IssueGone = "issue-gone",
  // Not a Critical exposure of a store with Restricted or Confidential data.
  NotAssessedOnItsOwn = "not-assessed-on-its-own",
  // The case was assessed already: its assessment stands.
  AlreadyAssessed = "already-assessed",
}

// Why OneUptime AI did not write it up on its own.
export enum ExposureRunAiSkip {
  AiOff = "ai-off",
  RulesUnreadable = "rules-unreadable",
  NoMatchingRule = "no-matching-rule",
  AnalyzeOff = "analyze-off",
}

export interface ExposureRunOutcome {
  started: boolean;
  skipped: ExposureRunSkip | null;
  aiSkipped: ExposureRunAiSkip | null;
  drafted: ExposureDraftOutcome | null;
}

function effectiveSensitivity(store: DataStore): DataSensitivity {
  const level: unknown = store.sensitivityOverride || store.sensitivity;

  return isDataSensitivity(level) ? level : DataSensitivity.Public;
}

export default class ExposureAssessmentRun {
  @CaptureSpan()
  public static async run(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    dataSecurityIssueId: ObjectID;
    now?: Date | undefined;
  }): Promise<ExposureRunOutcome> {
    const outcome: ExposureRunOutcome = {
      started: false,
      skipped: null,
      aiSkipped: null,
      drafted: null,
    };

    try {
      const now: Date = data.now || OneUptimeDate.getCurrentDate();
      const issue: DataSecurityIssue | null =
        await DataSecurityIssueService.findOneBy({
          query: { _id: data.dataSecurityIssueId, projectId: data.projectId },
          select: {
            _id: true,
            checkId: true,
            checkGroup: true,
            severity: true,
            status: true,
            dataTypeIds: true,
            dataStoreId: true,
            securityCaseId: true,
          },
          props: { isRoot: true },
        });

      if (!issue?.id || !issue.dataStoreId) {
        return { ...outcome, skipped: ExposureRunSkip.IssueGone };
      }

      const store: DataStore | null = await DataStoreService.findOneBy({
        query: { _id: issue.dataStoreId, projectId: data.projectId },
        select: {
          _id: true,
          kind: true,
          provider: true,
          environment: true,
          sensitivity: true,
          sensitivityOverride: true,
          serviceId: true,
          isArchived: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

      if (!store?.id || store.isArchived) {
        return { ...outcome, skipped: ExposureRunSkip.IssueGone };
      }

      if (
        !isAssessedOnItsOwn({
          severity: issue.severity,
          checkId: issue.checkId,
          sensitivity: effectiveSensitivity(store),
        })
      ) {
        return { ...outcome, skipped: ExposureRunSkip.NotAssessedOnItsOwn };
      }

      const started: boolean = await ExposureAssessmentDrafter.startOnItsOwn({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        dataStoreId: store.id,
        now,
      });

      if (!started) {
        return { ...outcome, skipped: ExposureRunSkip.AlreadyAssessed };
      }

      const decided: {
        aiSkipped: ExposureRunAiSkip | null;
        llmProviderId: string;
      } = await this.decideAi({
        projectId: data.projectId,
        issue,
        store,
      });

      if (decided.aiSkipped) {
        return { ...outcome, started: true, aiSkipped: decided.aiSkipped };
      }

      return {
        ...outcome,
        started: true,
        drafted: await ExposureAssessmentDrafter.draftOnItsOwn({
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          llmProviderId: decided.llmProviderId || undefined,
          now,
        }),
      };
    } catch (error) {
      logger.error(
        `DataSecurity: could not assess the exposure of security case ${data.securityCaseId.toString()}: ${error}`,
      );
      return outcome;
    }
  }

  /*
   * Whether OneUptime AI writes the assessment up on its own, as the
   * project's switches and its Data Security AI rules decide the issue's
   * Analyze work; and the provider a rule picks.
   */
  public static async decideAi(data: {
    projectId: ObjectID;
    issue: DataSecurityIssue;
    store: DataStore;
  }): Promise<{ aiSkipped: ExposureRunAiSkip | null; llmProviderId: string }> {
    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: { _id: true, enableAi: true, enableAutomaticDataSecurityAi: true },
      props: { isRoot: true },
    });

    if (
      !project ||
      project.enableAi === false ||
      project.enableAutomaticDataSecurityAi !== true
    ) {
      return { aiSkipped: ExposureRunAiSkip.AiOff, llmProviderId: "" };
    }

    const rules: Array<AutoRemediationRule> | null =
      await DataSecurityAiEngine.readRules(data.projectId);
    const dataTypes: {
      namer: DataTypeNamer;
      categoryOf: Map<string, string>;
    } = await DataSecurityAiEngine.readDataTypes(data.projectId);
    const facts: DataSecurityAiRuleIssue =
      await DataSecurityAiEngine.readRuleIssue({
        projectId: data.projectId,
        issue: data.issue,
        store: data.store,
        categoryOf: dataTypes.categoryOf,
      });
    const plan: DataSecurityAiPlan = decideDataSecurityAiWork({
      isAiEnabled: true,
      isAutomaticOn: true,
      rules: rules
        ? {
            rulesSetUp: rules.length > 0,
            matchingRules: DataSecurityAiEngine.matchRules(rules, facts),
          }
        : null,
      issue: { severity: data.issue.severity },
    });

    if (!rules) {
      return { aiSkipped: ExposureRunAiSkip.RulesUnreadable, llmProviderId: "" };
    }

    if (plan.skip) {
      return { aiSkipped: ExposureRunAiSkip.NoMatchingRule, llmProviderId: "" };
    }

    if (
      plan.works[DataSecurityAiWork.Analyze].autonomy ===
      DataSecurityAiAutonomy.Off
    ) {
      return { aiSkipped: ExposureRunAiSkip.AnalyzeOff, llmProviderId: "" };
    }

    return { aiSkipped: null, llmProviderId: plan.llmProviderId };
  }
}
