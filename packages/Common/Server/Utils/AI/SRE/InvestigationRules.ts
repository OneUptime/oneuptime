import AIInvestigationRule from "../../../../Models/DatabaseModels/AIInvestigationRule";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import AIInvestigationRuleTriggerEntity from "../../../../Types/AI/AIInvestigationRuleTriggerEntity";
import ObjectID from "../../../../Types/ObjectID";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import AIInvestigationRuleService from "../../../Services/AIInvestigationRuleService";
import logger, { LogAttributes } from "../../Logger";
import IncidentAlertRuleMatcher from "../../Rules/IncidentAlertRuleMatcher";
import logIfRuleReadWasTruncated from "../../Rules/RuleEngineRuleRead";
import { RuleEvaluation } from "../../PatternWorkScope";
import { getInvestigationRuleWaitMinutes } from "../../../../Types/AI/InvestigationRuleWait";

/*
 * Investigation rules: which new incidents (or alerts) OneUptime AI
 * investigates on its own, once "Investigate new incidents" is on.
 *
 * No enabled rule: every one is in scope. Enabled rules: only those that
 * match at least one are. A rule is only conditions, read exactly as the
 * Auto Remediation Rules read theirs (IncidentAlertRuleMatcher).
 *
 * Investigating only reads, so a failure to read the rules leaves the signal
 * in scope - it is investigated rather than silently skipped.
 *
 * A rule may also make OneUptime AI wait before it investigates, and then
 * investigate only a signal still open (issue #5074,
 * onlyIfOpenAfterMinutes). Rules widen what is investigated, so the rule
 * that lets OneUptime AI start soonest decides: the shortest wait of the
 * rules a signal matches, and no wait when one of them has none. With no
 * rule, or rules that cannot be read, there is no wait.
 */
export interface InvestigationRuleScope {
  isInScope: boolean;
  // How many enabled rules were checked (0: no rule, everything in scope).
  rulesChecked: number;
  /*
   * In scope, and every rule it matches waits: the shortest wait, in
   * minutes. Absent when it starts right away (and when out of scope).
   */
  waitMinutes?: number | undefined;
}

const IN_SCOPE_WITHOUT_RULES: InvestigationRuleScope = {
  isInScope: true,
  rulesChecked: 0,
};

export default class InvestigationRules {
  @RuleEvaluation()
  public static async getIncidentScope(data: {
    projectId: ObjectID;
    incident: Incident;
  }): Promise<InvestigationRuleScope> {
    const rules: Array<AIInvestigationRule> | null = await this.readRules({
      projectId: data.projectId,
      triggerEntityType: AIInvestigationRuleTriggerEntity.Incident,
    });

    if (!rules || rules.length === 0) {
      return IN_SCOPE_WITHOUT_RULES;
    }

    return await this.getScope(rules, (rule: AIInvestigationRule) => {
      return IncidentAlertRuleMatcher.doesIncidentMatch(
        data.incident,
        rule,
        "investigation rule",
      );
    });
  }

  @RuleEvaluation()
  public static async getAlertScope(data: {
    projectId: ObjectID;
    alert: Alert;
  }): Promise<InvestigationRuleScope> {
    const rules: Array<AIInvestigationRule> | null = await this.readRules({
      projectId: data.projectId,
      triggerEntityType: AIInvestigationRuleTriggerEntity.Alert,
    });

    if (!rules || rules.length === 0) {
      return IN_SCOPE_WITHOUT_RULES;
    }

    return await this.getScope(rules, (rule: AIInvestigationRule) => {
      return IncidentAlertRuleMatcher.doesAlertMatch(
        data.alert,
        rule,
        "investigation rule",
      );
    });
  }

  /*
   * Whether the signal matches one of the rules, and the shortest wait of
   * those it matches. A rule that waits no less than the shortest wait
   * found so far cannot change the answer, so it is not matched at all, and
   * the first rule that matches with no wait ends the reading.
   */
  private static async getScope(
    rules: Array<AIInvestigationRule>,
    matches: (rule: AIInvestigationRule) => Promise<boolean>,
  ): Promise<InvestigationRuleScope> {
    let shortestWait: number | null = null;

    for (const rule of rules) {
      const wait: number = getInvestigationRuleWaitMinutes(
        rule.onlyIfOpenAfterMinutes,
      );

      if (shortestWait !== null && wait >= shortestWait) {
        continue;
      }

      if (!(await matches(rule))) {
        continue;
      }

      if (wait === 0) {
        return { isInScope: true, rulesChecked: rules.length };
      }

      shortestWait = wait;
    }

    if (shortestWait === null) {
      return { isInScope: false, rulesChecked: rules.length };
    }

    return {
      isInScope: true,
      rulesChecked: rules.length,
      waitMinutes: shortestWait,
    };
  }

  // The enabled rules of one kind of signal, or null when they cannot be read.
  private static async readRules(data: {
    projectId: ObjectID;
    triggerEntityType: AIInvestigationRuleTriggerEntity;
  }): Promise<Array<AIInvestigationRule> | null> {
    try {
      const rules: Array<AIInvestigationRule> =
        await AIInvestigationRuleService.findBy({
          query: {
            projectId: data.projectId,
            isEnabled: true,
            triggerEntityType: data.triggerEntityType,
          },
          select: {
            _id: true,
            name: true,
            criteria: true,
            titlePattern: true,
            descriptionPattern: true,
            monitors: { _id: true },
            incidentSeverities: { _id: true },
            alertSeverities: { _id: true },
            labels: { _id: true },
            monitorLabels: { _id: true },
            // How long the rule waits before investigating: none when empty.
            onlyIfOpenAfterMinutes: true,
          },
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

      logIfRuleReadWasTruncated({
        ruleKind: "AIInvestigationRule",
        projectId: data.projectId,
        rulesRead: rules.length,
      });

      return rules;
    } catch (error) {
      logger.error(
        `AI: could not read the investigation rules; investigating as if there were none: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      return null;
    }
  }
}
