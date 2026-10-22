import AIPostmortemRule from "../../../../Models/DatabaseModels/AIPostmortemRule";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentPostmortemTemplate from "../../../../Models/DatabaseModels/IncidentPostmortemTemplate";
import { MAX_POSTMORTEM_RULE_TEMPLATES } from "../../../../Types/AI/PostmortemRuleTemplates";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import SubscriptionPlan, {
  PlanType,
} from "../../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../../Types/ObjectID";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import { getAllEnvVars } from "../../../EnvironmentConfig";
import AIPostmortemRuleService from "../../../Services/AIPostmortemRuleService";
import IncidentPostmortemTemplateService from "../../../Services/IncidentPostmortemTemplateService";
import ProjectService, { CurrentPlan } from "../../../Services/ProjectService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../../Logger";
import IncidentAlertRuleMatcher from "../../Rules/IncidentAlertRuleMatcher";
import logIfRuleReadWasTruncated from "../../Rules/RuleEngineRuleRead";
import { RuleEvaluation } from "../../PatternWorkScope";
import { getRuleLlmProviderId } from "../../../../Types/AI/LlmProviderChoice";

/*
 * Postmortem rules: which resolved incidents OneUptime AI drafts a
 * postmortem for, and which of the project's postmortem templates the draft
 * may follow, once "Draft a postmortem when an incident resolves" is on.
 *
 *   - No enabled rule: every resolved incident gets a draft, in OneUptime
 *     AI's standard outline - what drafting did before rules existed.
 *   - Enabled rules: they are read from the top of the list down (the order
 *     people drag them into) and the FIRST that matches the incident decides:
 *     the draft follows its templates - none named, the standard outline;
 *     one, that template; several, the one OneUptime AI picks as the best fit
 *     (PostmortemTemplatePick). An incident no rule matches gets no draft.
 *
 * A rule's conditions are read exactly as Investigation Rules and Auto
 * Remediation Rules read theirs (IncidentAlertRuleMatcher).
 *
 * The rule that decides the templates decides the LLM provider the draft is
 * written with too (PostmortemDraftPlan.llmProviderId,
 * Types/AI/LlmProviderChoice): its pick, else the project's default
 * provider, else the global one - as with no rule.
 *
 * The first match decides, rather than every match together, because a
 * rule's templates are what it is for: a narrow rule ("SEV1 database
 * incidents use Database outage") above a broad one ("everything else uses
 * the standard outline") is how a project says both, and pooling the two
 * would let the broad rule's template answer for the narrow rule's
 * incidents.
 *
 * A draft writes to the incident and posts to its Slack or Microsoft Teams
 * channel, so it keeps to what the project's rules allow: when the rules or
 * their templates cannot be read, there is no plan, and no draft (where an
 * investigation, which only reads, goes ahead - InvestigationRules). Anyone
 * who can edit the incident can still draft it with Generate with AI.
 *
 * Postmortem templates are a feature OneUptime Cloud sells on a plan (the
 * Growth plan, IncidentPostmortemTemplate's read plan): following one is
 * using it. A project below that plan - a trial that ended, a downgrade - has
 * its rules still decide which incidents get a draft, but every draft
 * follows the standard outline, as the dashboard, which offers no template
 * there, says.
 */
export interface PostmortemRuleTemplate {
  id: ObjectID;
  name: string;
  // What the template is for, as its author described it.
  description: string;
  // The outline a draft fills in: the template's postmortem note.
  outline: string;
}

export interface PostmortemDraftPlan {
  // Whether the incident gets a draft at all.
  isInScope: boolean;
  // How many enabled rules were read (0: no rule, every incident in scope).
  rulesChecked: number;
  // The rule that matched, when one did.
  rule: { id: ObjectID; name: string } | null;
  /*
   * The templates the draft may follow, by name: none for the standard
   * outline. Only templates that still exist in the project and have an
   * outline - a rule whose templates were all deleted since drafts in the
   * standard outline, rather than not at all.
   */
  templates: Array<PostmortemRuleTemplate>;
  /*
   * The LLM provider the rule that matched picks for the draft. Absent: the
   * project's default provider, else the global one.
   */
  llmProviderId?: ObjectID | undefined;
}

export const POSTMORTEM_DRAFT_PLAN_WITHOUT_RULES: PostmortemDraftPlan = {
  isInScope: true,
  rulesChecked: 0,
  rule: null,
  templates: [],
};

// What a rule is read with: its conditions, its place and its templates.
const RULE_SELECT: {
  _id: true;
  name: true;
  order: true;
  createdAt: true;
  criteria: true;
  titlePattern: true;
  descriptionPattern: true;
  monitors: { _id: true };
  incidentSeverities: { _id: true };
  labels: { _id: true };
  monitorLabels: { _id: true };
  postmortemTemplates: { _id: true };
  llmProviderId: true;
} = {
  _id: true,
  name: true,
  // Sorted on, so selected: the read with relations orders by selected columns only.
  order: true,
  createdAt: true,
  criteria: true,
  titlePattern: true,
  descriptionPattern: true,
  monitors: { _id: true },
  incidentSeverities: { _id: true },
  labels: { _id: true },
  monitorLabels: { _id: true },
  postmortemTemplates: { _id: true },
  // The LLM provider the rule picks: none when empty.
  llmProviderId: true,
};

/*
 * What matching a rule reads of the incident: the ids of its monitors,
 * severity and labels, its title and its description.
 */
export const POSTMORTEM_RULE_INCIDENT_SELECT: {
  title: true;
  description: true;
  incidentSeverityId: true;
  labels: { _id: true };
  monitors: { _id: true };
} = {
  title: true,
  description: true,
  incidentSeverityId: true,
  labels: { _id: true },
  monitors: { _id: true },
};

export default class PostmortemRules {
  /*
   * Whether a resolved incident gets a draft, and the templates it may
   * follow - or null when the rules could not be read, and so no draft.
   */
  @RuleEvaluation()
  public static async getIncidentDraftPlan(data: {
    projectId: ObjectID;
    incident: Incident;
  }): Promise<PostmortemDraftPlan | null> {
    const rules: Array<AIPostmortemRule> | null = await this.readRules(
      data.projectId,
    );

    if (rules === null) {
      return null;
    }

    if (rules.length === 0) {
      return POSTMORTEM_DRAFT_PLAN_WITHOUT_RULES;
    }

    for (const rule of rules) {
      if (
        await IncidentAlertRuleMatcher.doesIncidentMatch(
          data.incident,
          rule,
          "postmortem rule",
        )
      ) {
        const templates: Array<PostmortemRuleTemplate> | null =
          await this.readTemplates({
            projectId: data.projectId,
            rule: rule,
          });

        if (templates === null) {
          return null;
        }

        const llmProviderId: string = getRuleLlmProviderId(rule);

        return {
          isInScope: true,
          rulesChecked: rules.length,
          rule: { id: rule.id!, name: rule.name || "" },
          templates: templates,
          ...(llmProviderId && ObjectID.isValidUUID(llmProviderId)
            ? { llmProviderId: new ObjectID(llmProviderId) }
            : {}),
        };
      }
    }

    return {
      isInScope: false,
      rulesChecked: rules.length,
      rule: null,
      templates: [],
    };
  }

  // The project's enabled rules, top of the list first, or null when they cannot be read.
  private static async readRules(
    projectId: ObjectID,
  ): Promise<Array<AIPostmortemRule> | null> {
    try {
      const rules: Array<AIPostmortemRule> =
        await AIPostmortemRuleService.findBy({
          query: {
            projectId: projectId,
            isEnabled: true,
          },
          select: RULE_SELECT,
          // The list as people put it in order; the older first on a tie.
          sort: {
            order: SortOrder.Ascending,
            createdAt: SortOrder.Ascending,
          },
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

      logIfRuleReadWasTruncated({
        ruleKind: "AIPostmortemRule",
        projectId: projectId,
        rulesRead: rules.length,
      });

      return rules;
    } catch (error) {
      logger.error(
        `AI: could not read the postmortem rules; no postmortem is drafted until they can be: ${error}`,
        { projectId: projectId.toString() } as LogAttributes,
      );
      return null;
    }
  }

  /*
   * The templates a rule names that still exist in its project, with an
   * outline to follow, by name - or null when they cannot be read.
   */
  private static async readTemplates(data: {
    projectId: ObjectID;
    rule: AIPostmortemRule;
  }): Promise<Array<PostmortemRuleTemplate> | null> {
    const ids: Array<string> = Array.from(
      new Set(
        (data.rule.postmortemTemplates || [])
          .map((template: IncidentPostmortemTemplate): string => {
            return (template._id || template.id?.toString() || "").toString();
          })
          .filter((id: string): boolean => {
            return ObjectID.isValidUUID(id);
          }),
      ),
    );

    if (ids.length === 0) {
      return [];
    }

    try {
      if (!(await this.isTemplatePlanMet(data.projectId))) {
        logger.debug(
          `AI: postmortem rule ${data.rule.id?.toString()} names templates, but the project's plan does not include postmortem templates; the draft follows the standard outline.`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
        return [];
      }

      const templates: Array<IncidentPostmortemTemplate> =
        await IncidentPostmortemTemplateService.findBy({
          query: {
            projectId: data.projectId,
            _id: QueryHelper.any(ids),
          },
          select: {
            _id: true,
            templateName: true,
            templateDescription: true,
            postmortemNote: true,
          },
          sort: { templateName: SortOrder.Ascending },
          limit: MAX_POSTMORTEM_RULE_TEMPLATES,
          skip: 0,
          props: { isRoot: true },
        });

      return templates
        .filter((template: IncidentPostmortemTemplate): boolean => {
          return Boolean(
            template.id &&
              template.postmortemNote &&
              template.postmortemNote.trim().length > 0,
          );
        })
        .map((template: IncidentPostmortemTemplate): PostmortemRuleTemplate => {
          return {
            id: template.id!,
            name: (template.templateName || "").trim(),
            description: (template.templateDescription || "").trim(),
            outline: template.postmortemNote!,
          };
        });
    } catch (error) {
      logger.error(
        `AI: could not read the templates of postmortem rule ${data.rule.id?.toString()}; the incident gets no draft until they can be read: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      return null;
    }
  }

  /*
   * Whether the project's plan includes postmortem templates: always with
   * billing off (getCurrentPlan answers no plan), and on OneUptime Cloud
   * when its plan reaches the templates' read plan.
   */
  private static async isTemplatePlanMet(
    projectId: ObjectID,
  ): Promise<boolean> {
    const requiredPlan: PlanType | null =
      new IncidentPostmortemTemplate().getReadBillingPlan();

    if (!requiredPlan) {
      return true;
    }

    const current: CurrentPlan = await ProjectService.getCurrentPlan(projectId);

    if (!current.plan) {
      return true;
    }

    try {
      return SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
        requiredPlan,
        current.plan,
        getAllEnvVars(),
      );
    } catch {
      /*
       * A plan this install does not describe: the plan cannot be told, so
       * the rule is followed as written rather than every draft stopped.
       */
      return true;
    }
  }
}
