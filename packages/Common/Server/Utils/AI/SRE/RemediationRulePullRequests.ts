import Alert from "../../../../Models/DatabaseModels/Alert";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import Incident from "../../../../Models/DatabaseModels/Incident";
import AutoRemediationTriggerEntity from "../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import {
  AutomaticFixPullRequestRules,
  REMEDIATION_RULE_PULL_REQUEST_SELECT,
  getAutomaticFixSignal,
} from "../../../../Types/AI/AutomaticFixPullRequests";
import ObjectID from "../../../../Types/ObjectID";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import AlertService from "../../../Services/AlertService";
import AutoRemediationRuleService from "../../../Services/AutoRemediationRuleService";
import IncidentService from "../../../Services/IncidentService";
import logger, { LogAttributes } from "../../Logger";
import { RuleEvaluation } from "../../PatternWorkScope";
import IncidentAlertRuleMatcher from "../../Rules/IncidentAlertRuleMatcher";
import logIfRuleReadWasTruncated from "../../Rules/RuleEngineRuleRead";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { getFixingAiRules } from "../../../../Types/AI/AiRule";

/*
 * THE AI RULES BEHIND A PULL REQUEST OneUptime AI OPENS ON ITS OWN.
 *
 * The two pull requests an investigation can lead to - a fix, and the
 * telemetry it lacked - are set per AI rule that fixes
 * (Types/AI/AutomaticFixPullRequests). When an investigation ends, its
 * trigger asks here which of the project's enabled rules of the signal's
 * kind match the incident (or alert) and fix it, read the way the rule
 * engine reads them (IncidentAlertRuleMatcher, with the columns
 * AutoRemediationRuleEngine selects), together with each rule's pull
 * request switches and the code repositories it names. A pull request is
 * one of the ways OneUptime AI fixes, so a rule that only investigates
 * opens none: with rules, an incident only such rules match is not fixed,
 * and gets no pull request either (Types/AI/AiRule).
 *
 * Null when they cannot be read: a pull request is a fix, and a fix that
 * cannot be checked against the rules that may keep it out is not made.
 */

// What a rule is matched on, as the rule engine reads it - and whether it fixes.
const RULE_MATCH_SELECT: {
  _id: true;
  name: true;
  fixes: true;
  criteria: true;
  titlePattern: true;
  descriptionPattern: true;
  monitors: { _id: true };
  incidentSeverities: { _id: true };
  alertSeverities: { _id: true };
  labels: { _id: true };
  monitorLabels: { _id: true };
} = {
  _id: true,
  name: true,
  fixes: true,
  criteria: true,
  titlePattern: true,
  descriptionPattern: true,
  monitors: { _id: true },
  incidentSeverities: { _id: true },
  alertSeverities: { _id: true },
  labels: { _id: true },
  monitorLabels: { _id: true },
};

// What an incident is matched on (AutoRemediationRuleEngine.applyRulesToIncidentById).
const INCIDENT_MATCH_SELECT: {
  _id: true;
  projectId: true;
  title: true;
  description: true;
  incidentSeverityId: true;
  monitors: { _id: true };
  labels: { _id: true };
} = {
  _id: true,
  projectId: true,
  title: true,
  description: true,
  incidentSeverityId: true,
  monitors: { _id: true },
  labels: { _id: true },
};

// What an alert is matched on (AutoRemediationRuleEngine.applyRulesToAlertById).
const ALERT_MATCH_SELECT: {
  _id: true;
  projectId: true;
  title: true;
  description: true;
  alertSeverityId: true;
  monitorId: true;
  labels: { _id: true };
} = {
  _id: true,
  projectId: true,
  title: true,
  description: true,
  alertSeverityId: true,
  monitorId: true,
  labels: { _id: true },
};

export default class RemediationRulePullRequests {
  /*
   * The project's enabled AI rules for the signal's kind - whether it has
   * any, and the ones that match the incident (or alert) and fix it - or
   * null when they cannot be read. Exactly one of incidentId and alertId.
   */
  @CaptureSpan()
  @RuleEvaluation()
  public static async getRulesForSignal(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<AutomaticFixPullRequestRules | null> {
    const signal: AutoRemediationTriggerEntity | null = getAutomaticFixSignal({
      incidentId: data.incidentId,
      alertId: data.alertId,
    });

    if (!signal) {
      return null;
    }

    try {
      const rules: Array<AutoRemediationRule> =
        await AutoRemediationRuleService.findBy({
          query: {
            projectId: data.projectId,
            isEnabled: true,
            triggerEntityType: signal,
          },
          select: {
            ...RULE_MATCH_SELECT,
            ...REMEDIATION_RULE_PULL_REQUEST_SELECT,
          },
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

      logIfRuleReadWasTruncated({
        ruleKind: "AutoRemediationRule",
        projectId: data.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return { rulesSetUp: false, matchingRules: [] };
      }

      const matchingRules: Array<AutoRemediationRule> = [];

      if (data.incidentId) {
        const incident: Incident | null = await IncidentService.findOneById({
          id: data.incidentId,
          select: INCIDENT_MATCH_SELECT,
          props: { isRoot: true },
        });

        if (!incident) {
          return null;
        }

        for (const rule of getFixingAiRules(rules)) {
          if (
            await IncidentAlertRuleMatcher.doesIncidentMatch(
              incident,
              rule,
              "AI rule",
            )
          ) {
            matchingRules.push(rule);
          }
        }
      } else {
        const alert: Alert | null = await AlertService.findOneById({
          id: data.alertId!,
          select: ALERT_MATCH_SELECT,
          props: { isRoot: true },
        });

        if (!alert) {
          return null;
        }

        for (const rule of getFixingAiRules(rules)) {
          if (
            await IncidentAlertRuleMatcher.doesAlertMatch(
              alert,
              rule,
              "AI rule",
            )
          ) {
            matchingRules.push(rule);
          }
        }
      }

      return { rulesSetUp: true, matchingRules };
    } catch (error) {
      logger.error(
        `AI: could not read the AI rules for a pull request; none opens: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );

      return null;
    }
  }
}
