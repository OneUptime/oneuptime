import IncidentPostmortemTemplate from "Common/Models/DatabaseModels/IncidentPostmortemTemplate";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import type FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { translateTemplate } from "Common/UI/Utils/TranslateTemplate";
import { isKnownToBeBelowPlan } from "../../Enterprise/EnterpriseEligibility";
import {
  RULE_NAME_MAX_LENGTH,
  RuleNameFollowFunction,
  followPicksWithRuleName,
  getRuleNameFromPicks,
} from "../../Utils/Form/ResourceRuleForm";
import {
  POSTMORTEM_RULE_NAME_WORDING,
  POSTMORTEM_RULE_STANDARD_OUTLINE_NAME,
} from "./PostmortemRulesCopy";

/*
 * What the postmortem rule form fills in for the person (the table is
 * AIPostmortemRulesTable; the words are PostmortemRulesCopy).
 *
 * A rule is named after the templates it drafts with - "Draft with Database
 * outage", "Draft with Database outage, Security incident and 2 more" - and
 * one that names none after the standard outline, "Draft with the standard
 * outline". The name follows the picks while it is still the form's own,
 * as every other rule form's does (Utils/Form/ResourceRuleForm).
 */

// "Draft with Database outage": the name a rule's templates give it, or "".
export const getPostmortemRuleName: (templateNames: Array<string>) => string = (
  templateNames: Array<string>,
): string => {
  return getRuleNameFromPicks(POSTMORTEM_RULE_NAME_WORDING, templateNames);
};

// The name of a rule that names no template, in the reader's language.
export const getPostmortemRuleStandardOutlineName: () => string =
  (): string => {
    return translateTemplate(POSTMORTEM_RULE_STANDARD_OUTLINE_NAME).slice(
      0,
      RULE_NAME_MAX_LENGTH,
    );
  };

/*
 * A new rule names no template yet: it is named after the standard outline,
 * and the first template picked names it after itself.
 */
export const getNewPostmortemRuleValues: <TEntity>() => FormValues<TEntity> = <
  TEntity,
>(): FormValues<TEntity> => {
  return {
    name: getPostmortemRuleStandardOutlineName(),
  } as unknown as FormValues<TEntity>;
};

// The templates picker's onChange: the name follows the templates picked.
export const followTemplatesWithRuleName: <
  TEntity,
>() => RuleNameFollowFunction<TEntity> = <
  TEntity,
>(): RuleNameFollowFunction<TEntity> => {
  return followPicksWithRuleName<TEntity>(
    getPostmortemRuleName,
    getPostmortemRuleStandardOutlineName,
  );
};

/*
 * Whether the form offers templates to pick: not on OneUptime Cloud for a
 * project known to be on a plan below the one postmortem templates need
 * (the Growth plan), which cannot read them - there, a rule only says which
 * incidents get a draft, and every draft follows the standard outline, as
 * the server does (PostmortemRules). Self-hosted, and while the plan is not
 * known, they are offered.
 */
export const canPickPostmortemTemplates: () => boolean = (): boolean => {
  const plan: PlanType | null =
    new IncidentPostmortemTemplate().getReadBillingPlan();

  if (!plan) {
    return true;
  }

  return !isKnownToBeBelowPlan(plan);
};

// The names of the templates a rule names, as the table reads them.
export const getPostmortemRuleTemplateNames: (
  templates: Array<{ templateName?: string | undefined }> | undefined,
) => Array<string> = (
  templates: Array<{ templateName?: string | undefined }> | undefined,
): Array<string> => {
  return (templates || [])
    .map((template: { templateName?: string | undefined }): string => {
      return (template.templateName || "").trim();
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    })
    .sort((first: string, second: string): number => {
      return first.localeCompare(second);
    });
};
