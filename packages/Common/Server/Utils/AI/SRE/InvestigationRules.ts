import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import AutoRemediationTriggerEntity from "../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import ObjectID from "../../../../Types/ObjectID";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import AutoRemediationRuleService from "../../../Services/AutoRemediationRuleService";
import logger, { LogAttributes } from "../../Logger";
import IncidentAlertRuleMatcher from "../../Rules/IncidentAlertRuleMatcher";
import logIfRuleReadWasTruncated from "../../Rules/RuleEngineRuleRead";
import { RuleEvaluation } from "../../PatternWorkScope";
import { getInvestigationRuleWaitMinutes } from "../../../../Types/AI/InvestigationRuleWait";
import {
  EVERY_EXTERNAL_MCP_SERVER,
  ExternalMcpServerAllowance,
  NO_EXTERNAL_MCP_SERVER,
  getExternalMcpServerAllowance,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAllowance";
import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
  getCodeRepositoryAllowance,
} from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import {
  getLlmProviderPickingRules,
  getRuleLlmProviderId,
} from "../../../../Types/AI/LlmProviderChoice";
import AlertService from "../../../Services/AlertService";
import IncidentService from "../../../Services/IncidentService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import { AiContextRule, readAiContext } from "../../../../Types/AI/AiContext";

/*
 * Which new incidents (or alerts) OneUptime AI investigates on its own,
 * once "Investigate new incidents" is on: the project's AI rules that
 * investigate (Types/AI/AiRule) - the rules that say which incidents
 * OneUptime AI works on, and whether it fixes them too.
 *
 * No enabled rule that investigates: every one is in scope. Enabled rules
 * that investigate: only those that match at least one are. A rule that
 * only fixes (one set up as an auto remediation rule before investigation
 * and auto remediation rules merged) never decided which incidents are
 * investigated, and is not read here. Conditions are read exactly as the
 * fixing side reads them (IncidentAlertRuleMatcher).
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
 *
 * A rule also names the external MCP servers OneUptime AI may use while it
 * investigates what the rule matches (getIncidentMcpServerAllowance): with
 * no rule, or a matching rule that names none, all of the project's; with
 * matching rules that name some, those. That one fails the other way: rules
 * that cannot be read let OneUptime AI use no outside server, since a rule
 * might have kept one out.
 *
 * The code repositories it may read are named the same way
 * (getIncidentCodeRepositoryAllowance, CodeRepositoryAllowance): with no
 * rule, or a matching rule that names none, every connected repository; with
 * matching rules that name some, those - and none when the rules cannot be
 * read, for the same reason.
 *
 * A rule may pick the LLM provider OneUptime AI investigates with
 * (Types/AI/LlmProviderChoice): the first matching rule by name that picks
 * one decides (InvestigationRuleScope.llmProviderId, getLlmProviderId),
 * for the investigation the rules start and for one someone starts by
 * hand. With no rule, no matching rule that picks one, or rules that
 * cannot be read: the project's default provider, else the global one.
 *
 * A rule may also carry notes for OneUptime AI about the incidents it
 * matches - its AI context (Types/AI/AiContext) - which an investigation
 * reads after the project's own (getIncidentAiContextRules): every matching
 * rule that investigates and has one, read for those columns only. Notes
 * only add to what a run knows, so rules that cannot be read leave the run
 * with the project's AI context alone.
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
  /*
   * In scope, and a rule it matches picks an LLM provider: the pick of the
   * first such rule by name. Absent: the project's default provider, else
   * the global one.
   */
  llmProviderId?: ObjectID | undefined;
}

// What an incident is matched on (shouldInvestigateIncident reads the same).
const INCIDENT_MATCH_SELECT: {
  _id: true;
  title: true;
  description: true;
  incidentSeverityId: true;
  labels: { _id: true };
  monitors: { _id: true };
} = {
  _id: true,
  title: true,
  description: true,
  incidentSeverityId: true,
  labels: { _id: true },
  monitors: { _id: true },
};

// What an alert is matched on (shouldInvestigateAlert reads the same).
const ALERT_MATCH_SELECT: {
  _id: true;
  title: true;
  description: true;
  alertSeverityId: true;
  monitorId: true;
  labels: { _id: true };
} = {
  _id: true,
  title: true,
  description: true,
  alertSeverityId: true,
  monitorId: true,
  labels: { _id: true },
};

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
    const rules: Array<AutoRemediationRule> | null = await this.readRules({
      projectId: data.projectId,
      triggerEntityType: AutoRemediationTriggerEntity.Incident,
    });

    if (!rules || rules.length === 0) {
      return IN_SCOPE_WITHOUT_RULES;
    }

    return await this.getScope(rules, (rule: AutoRemediationRule) => {
      return IncidentAlertRuleMatcher.doesIncidentMatch(
        data.incident,
        rule,
        "AI rule",
      );
    });
  }

  /*
   * The LLM provider the AI rules that investigate pick for this incident: the
   * pick of the first matching rule by name that picks one, or undefined -
   * the project's default provider, else the global one. For an
   * investigation the rules did not decide on (someone started it, or it
   * is checked again): what the rules pick for the incident decides its
   * provider all the same.
   */
  @RuleEvaluation()
  public static async getIncidentLlmProviderId(data: {
    projectId: ObjectID;
    incident: Incident;
  }): Promise<ObjectID | undefined> {
    const rules: Array<AutoRemediationRule> | null = await this.readRules({
      projectId: data.projectId,
      triggerEntityType: AutoRemediationTriggerEntity.Incident,
    });

    return await this.getPickedLlmProviderId(
      rules || [],
      (rule: AutoRemediationRule) => {
        return IncidentAlertRuleMatcher.doesIncidentMatch(
          data.incident,
          rule,
          "AI rule",
        );
      },
    );
  }

  // The same, for an alert.
  @RuleEvaluation()
  public static async getAlertLlmProviderId(data: {
    projectId: ObjectID;
    alert: Alert;
  }): Promise<ObjectID | undefined> {
    const rules: Array<AutoRemediationRule> | null = await this.readRules({
      projectId: data.projectId,
      triggerEntityType: AutoRemediationTriggerEntity.Alert,
    });

    return await this.getPickedLlmProviderId(
      rules || [],
      (rule: AutoRemediationRule) => {
        return IncidentAlertRuleMatcher.doesAlertMatch(
          data.alert,
          rule,
          "AI rule",
        );
      },
    );
  }

  /*
   * The same, for an incident or an alert by id - read here with what a
   * rule matches on. Undefined when it cannot be read: the project's
   * provider then, as with no rule.
   */
  public static async getSubjectLlmProviderId(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<ObjectID | undefined> {
    try {
      if (data.incidentId) {
        const incident: Incident | null = await IncidentService.findOneBy({
          query: { _id: data.incidentId.toString(), projectId: data.projectId },
          select: INCIDENT_MATCH_SELECT,
          props: { isRoot: true },
        });

        return incident
          ? await this.getIncidentLlmProviderId({
              projectId: data.projectId,
              incident,
            })
          : undefined;
      }

      if (data.alertId) {
        const alert: Alert | null = await AlertService.findOneBy({
          query: { _id: data.alertId.toString(), projectId: data.projectId },
          select: ALERT_MATCH_SELECT,
          props: { isRoot: true },
        });

        return alert
          ? await this.getAlertLlmProviderId({
              projectId: data.projectId,
              alert,
            })
          : undefined;
      }
    } catch (error) {
      logger.error(
        `AI: could not read which LLM provider the AI rules pick for an investigation; using the project's provider: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
    }

    return undefined;
  }

  /*
   * The pick of the first rule, in the order that decides
   * (getLlmProviderPickingRules), that the subject matches - only the rules
   * that pick one are matched at all.
   */
  private static async getPickedLlmProviderId(
    rules: Array<AutoRemediationRule>,
    matches: (rule: AutoRemediationRule) => Promise<boolean>,
  ): Promise<ObjectID | undefined> {
    for (const rule of getLlmProviderPickingRules(rules)) {
      if (await matches(rule)) {
        return new ObjectID(getRuleLlmProviderId(rule));
      }
    }

    return undefined;
  }

  @RuleEvaluation()
  public static async getAlertScope(data: {
    projectId: ObjectID;
    alert: Alert;
  }): Promise<InvestigationRuleScope> {
    const rules: Array<AutoRemediationRule> | null = await this.readRules({
      projectId: data.projectId,
      triggerEntityType: AutoRemediationTriggerEntity.Alert,
    });

    if (!rules || rules.length === 0) {
      return IN_SCOPE_WITHOUT_RULES;
    }

    return await this.getScope(rules, (rule: AutoRemediationRule) => {
      return IncidentAlertRuleMatcher.doesAlertMatch(
        data.alert,
        rule,
        "AI rule",
      );
    });
  }

  /*
   * Whether the signal matches one of the rules, the shortest wait of those
   * it matches, and the LLM provider they pick. A rule that waits no less
   * than the shortest wait found so far cannot change the wait, so it is not
   * matched for it, and the first rule that matches with no wait ends that
   * reading; the provider is then the pick of the first matching rule by
   * name that picks one (getPickedLlmProviderId), matched apart.
   */
  private static async getScope(
    rules: Array<AutoRemediationRule>,
    matches: (rule: AutoRemediationRule) => Promise<boolean>,
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

      shortestWait = wait;

      if (wait === 0) {
        break;
      }
    }

    if (shortestWait === null) {
      return { isInScope: false, rulesChecked: rules.length };
    }

    const llmProviderId: ObjectID | undefined =
      await this.getPickedLlmProviderId(rules, matches);

    return {
      isInScope: true,
      rulesChecked: rules.length,
      ...(shortestWait > 0 ? { waitMinutes: shortestWait } : {}),
      ...(llmProviderId ? { llmProviderId } : {}),
    };
  }

  /*
   * The external MCP servers OneUptime AI may use while it investigates this
   * incident: see ExternalMcpServerAllowance.
   */
  @RuleEvaluation()
  public static async getIncidentMcpServerAllowance(data: {
    projectId: ObjectID;
    incident: Incident;
  }): Promise<ExternalMcpServerAllowance> {
    const rules: Array<AutoRemediationRule> | null = await this.readRules({
      projectId: data.projectId,
      triggerEntityType: AutoRemediationTriggerEntity.Incident,
    });

    if (!rules) {
      return NO_EXTERNAL_MCP_SERVER;
    }

    if (rules.length === 0) {
      return EVERY_EXTERNAL_MCP_SERVER;
    }

    const matchingRules: Array<AutoRemediationRule> = [];

    for (const rule of rules) {
      if (
        await IncidentAlertRuleMatcher.doesIncidentMatch(
          data.incident,
          rule,
          "AI rule",
        )
      ) {
        matchingRules.push(rule);
      }
    }

    return getExternalMcpServerAllowance({
      rulesSetUp: true,
      matchingRules,
    });
  }

  /*
   * The code repositories OneUptime AI may read while it investigates this
   * incident: see CodeRepositoryAllowance.
   */
  @RuleEvaluation()
  public static async getIncidentCodeRepositoryAllowance(data: {
    projectId: ObjectID;
    incident: Incident;
  }): Promise<CodeRepositoryAllowance> {
    const rules: Array<AutoRemediationRule> | null = await this.readRules({
      projectId: data.projectId,
      triggerEntityType: AutoRemediationTriggerEntity.Incident,
    });

    if (!rules) {
      return NO_CODE_REPOSITORY;
    }

    if (rules.length === 0) {
      return EVERY_CODE_REPOSITORY;
    }

    const matchingRules: Array<AutoRemediationRule> = [];

    for (const rule of rules) {
      if (
        await IncidentAlertRuleMatcher.doesIncidentMatch(
          data.incident,
          rule,
          "AI rule",
        )
      ) {
        matchingRules.push(rule);
      }
    }

    return getCodeRepositoryAllowance({
      rulesSetUp: true,
      matchingRules,
    });
  }

  // The same, for an alert.
  @RuleEvaluation()
  public static async getAlertCodeRepositoryAllowance(data: {
    projectId: ObjectID;
    alert: Alert;
  }): Promise<CodeRepositoryAllowance> {
    const rules: Array<AutoRemediationRule> | null = await this.readRules({
      projectId: data.projectId,
      triggerEntityType: AutoRemediationTriggerEntity.Alert,
    });

    if (!rules) {
      return NO_CODE_REPOSITORY;
    }

    if (rules.length === 0) {
      return EVERY_CODE_REPOSITORY;
    }

    const matchingRules: Array<AutoRemediationRule> = [];

    for (const rule of rules) {
      if (
        await IncidentAlertRuleMatcher.doesAlertMatch(
          data.alert,
          rule,
          "AI rule",
        )
      ) {
        matchingRules.push(rule);
      }
    }

    return getCodeRepositoryAllowance({
      rulesSetUp: true,
      matchingRules,
    });
  }

  // The same, for an alert.
  @RuleEvaluation()
  public static async getAlertMcpServerAllowance(data: {
    projectId: ObjectID;
    alert: Alert;
  }): Promise<ExternalMcpServerAllowance> {
    const rules: Array<AutoRemediationRule> | null = await this.readRules({
      projectId: data.projectId,
      triggerEntityType: AutoRemediationTriggerEntity.Alert,
    });

    if (!rules) {
      return NO_EXTERNAL_MCP_SERVER;
    }

    if (rules.length === 0) {
      return EVERY_EXTERNAL_MCP_SERVER;
    }

    const matchingRules: Array<AutoRemediationRule> = [];

    for (const rule of rules) {
      if (
        await IncidentAlertRuleMatcher.doesAlertMatch(
          data.alert,
          rule,
          "AI rule",
        )
      ) {
        matchingRules.push(rule);
      }
    }

    return getExternalMcpServerAllowance({
      rulesSetUp: true,
      matchingRules,
    });
  }

  /*
   * The AI rules that investigate this incident and carry an AI context,
   * with it: the notes an investigation of the incident reads after the
   * project's. None when no such rule matches, or the rules cannot be read.
   */
  @RuleEvaluation()
  public static async getIncidentAiContextRules(data: {
    projectId: ObjectID;
    incident: Incident;
  }): Promise<Array<AiContextRule>> {
    const rules: Array<AutoRemediationRule> = await this.readAiContextRules({
      projectId: data.projectId,
      triggerEntityType: AutoRemediationTriggerEntity.Incident,
    });

    return await this.getMatchingAiContextRules(
      rules,
      (rule: AutoRemediationRule) => {
        return IncidentAlertRuleMatcher.doesIncidentMatch(
          data.incident,
          rule,
          "AI rule",
        );
      },
    );
  }

  // The same, for an alert.
  @RuleEvaluation()
  public static async getAlertAiContextRules(data: {
    projectId: ObjectID;
    alert: Alert;
  }): Promise<Array<AiContextRule>> {
    const rules: Array<AutoRemediationRule> = await this.readAiContextRules({
      projectId: data.projectId,
      triggerEntityType: AutoRemediationTriggerEntity.Alert,
    });

    return await this.getMatchingAiContextRules(
      rules,
      (rule: AutoRemediationRule) => {
        return IncidentAlertRuleMatcher.doesAlertMatch(
          data.alert,
          rule,
          "AI rule",
        );
      },
    );
  }

  /*
   * The ones of these rules the signal matches, as the AI context reads
   * them. Only a rule with an AI context is matched at all, so a project
   * whose rules carry none matches nothing here.
   */
  private static async getMatchingAiContextRules(
    rules: Array<AutoRemediationRule>,
    matches: (rule: AutoRemediationRule) => Promise<boolean>,
  ): Promise<Array<AiContextRule>> {
    const matching: Array<AiContextRule> = [];

    for (const rule of rules) {
      if (!readAiContext(rule.aiContext)) {
        continue;
      }

      if (!(await matches(rule))) {
        continue;
      }

      matching.push({
        ...(rule.id ? { id: rule.id.toString() } : {}),
        name: rule.name || "",
        aiContext: rule.aiContext,
      });
    }

    return matching;
  }

  /*
   * The enabled rules of one kind of signal that investigate and carry an
   * AI context, with what they match on. None when they cannot be read:
   * notes only add to what a run knows, so the run goes on with the
   * project's AI context alone.
   */
  private static async readAiContextRules(data: {
    projectId: ObjectID;
    triggerEntityType: AutoRemediationTriggerEntity;
  }): Promise<Array<AutoRemediationRule>> {
    try {
      const rules: Array<AutoRemediationRule> =
        await AutoRemediationRuleService.findBy({
          query: {
            projectId: data.projectId,
            isEnabled: true,
            triggerEntityType: data.triggerEntityType,
            investigates: true,
            aiContext: QueryHelper.notNull(),
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
            aiContext: true,
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

      return rules;
    } catch (error) {
      logger.error(
        `AI: could not read the AI context of the AI rules that investigate; investigating with the project's AI context alone: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      return [];
    }
  }

  /*
   * The enabled rules of one kind of signal that investigate, or null when
   * they cannot be read.
   */
  private static async readRules(data: {
    projectId: ObjectID;
    triggerEntityType: AutoRemediationTriggerEntity;
  }): Promise<Array<AutoRemediationRule> | null> {
    try {
      const rules: Array<AutoRemediationRule> =
        await AutoRemediationRuleService.findBy({
          query: {
            projectId: data.projectId,
            isEnabled: true,
            triggerEntityType: data.triggerEntityType,
            investigates: true,
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
            externalMcpServers: { _id: true },
            codeRepositories: { _id: true },
            // The LLM provider it picks: none when empty.
            llmProviderId: true,
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

      return rules;
    } catch (error) {
      logger.error(
        `AI: could not read the AI rules that investigate; investigating as if there were none: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      return null;
    }
  }
}
