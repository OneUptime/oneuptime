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
 */
export interface InvestigationRuleScope {
  isInScope: boolean;
  // How many enabled rules were checked (0: no rule, everything in scope).
  rulesChecked: number;
}

const IN_SCOPE_WITHOUT_RULES: InvestigationRuleScope = {
  isInScope: true,
  rulesChecked: 0,
};

export default class InvestigationRules {
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

    for (const rule of rules) {
      if (
        await IncidentAlertRuleMatcher.doesIncidentMatch(
          data.incident,
          rule,
          "investigation rule",
        )
      ) {
        return { isInScope: true, rulesChecked: rules.length };
      }
    }

    return { isInScope: false, rulesChecked: rules.length };
  }

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

    for (const rule of rules) {
      if (
        await IncidentAlertRuleMatcher.doesAlertMatch(
          data.alert,
          rule,
          "investigation rule",
        )
      ) {
        return { isInScope: true, rulesChecked: rules.length };
      }
    }

    return { isInScope: false, rulesChecked: rules.length };
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
