import CloudResourceLabelRule from "Common/Models/DatabaseModels/CloudResourceLabelRule";
import CloudResourceOwnerRule from "Common/Models/DatabaseModels/CloudResourceOwnerRule";
import EqualToOrNull from "Common/Types/BaseDatabase/EqualToOrNull";
import { Gray500 } from "Common/Types/BrandColors";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import { RuleRunResourceNouns } from "Common/Types/Rules/RuleRun";
import RuleCriteriaSubject from "Common/Types/Rules/RuleCriteriaSubject";
import Pill from "Common/UI/Components/Pill/Pill";
import { RuleWording } from "Common/UI/Components/RuleRun/RuleView";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { ReactElement } from "react";

/*
 * Owner and label rules for the CloudResource table, as each product's
 * Settings pages show them.
 *
 * One table of rules serves both products, and each rule names the kind of
 * row it is for (CloudResourceOwnerRule / CloudResourceLabelRule
 * `cloudResourceKind`): App Platforms' rules pages write and list
 * environment rules, Cloud's resource rules, so a rule made in one product
 * never changes the other's rows. A rule written before the two products
 * split names neither kind and still applies to both - both lists show it,
 * with a pill that says so.
 */

export type CloudRule = CloudResourceOwnerRule | CloudResourceLabelRule;

/*
 * The kind one product's rules page lists its rules by - its own, and those
 * made for both - as the page's query reads it: query={{ cloudResourceKind:
 * cloudResourceKind }} (ResourceDetailsOnePlaceGuard's SPLIT_MODELS holds
 * each page to reading by the column).
 */
export function getCloudRuleListKind(
  kind: CloudResourceKind,
): EqualToOrNull<string> {
  return new EqualToOrNull<string>(kind);
}

// A rule a product's page creates is that product's.
export function withCloudRuleKind<TRule extends CloudRule>(
  kind: CloudResourceKind,
): (item: TRule) => Promise<TRule> {
  return (item: TRule): Promise<TRule> => {
    item.cloudResourceKind = kind;
    return Promise.resolve(item);
  };
}

/*
 * The pill a rule made for both products wears on each product's list: the
 * product it also applies in.
 */
export const ALSO_IN_APP_PLATFORMS: string = translationKey(
  "Also in App Platforms",
);
export const ALSO_IN_CLOUD: string = translationKey("Also in Cloud");
export const BOTH_PRODUCTS_RULE_TOOLTIP: string = translationKey(
  "Made before Cloud and App Platforms were split, this rule applies to the cloud resources in Cloud and to the environments in App Platforms.",
);

export function getAlsoAppliesInText(kind: CloudResourceKind): string {
  return kind === CloudResourceKind.Resource
    ? ALSO_IN_APP_PLATFORMS
    : ALSO_IN_CLOUD;
}

/*
 * The pill a rule made for both products wears: the product it also
 * applies in, and why in its tooltip. Nothing for a rule of one product.
 */
export function CloudRuleKindPill(props: {
  rule: CloudRule;
  kind: CloudResourceKind;
}): ReactElement {
  if (props.rule.cloudResourceKind) {
    return <></>;
  }

  return (
    <span data-testid="cloud-rule-also-applies-in">
      <Pill
        text={getAlsoAppliesInText(props.kind)}
        color={Gray500}
        tooltip={BOTH_PRODUCTS_RULE_TOOLTIP}
      />
    </span>
  );
}

/*
 * A rule's name on a product's list, with the pill when the rule is for
 * both products. A rule the product made itself shows its name alone.
 */
export function CloudRuleName(props: {
  rule: CloudRule;
  kind: CloudResourceKind;
}): ReactElement {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
      <span>{props.rule.name || ""}</span>
      <CloudRuleKindPill rule={props.rule} kind={props.kind} />
    </span>
  );
}

/*
 * App Platforms' rules are about environments, which the rule models call
 * cloud resources: their conditions, their edit form and Run Now say
 * environments (RuleCriteriaSubject.CloudEnvironments).
 */
export const CLOUD_ENVIRONMENT_RULE_CRITERIA_SUBJECT: RuleCriteriaSubject =
  RuleCriteriaSubject.CloudEnvironments;

export const CLOUD_ENVIRONMENT_RULE_RUN_NOUNS: RuleRunResourceNouns = {
  resourceSingular: "cloud environment",
  resourcePlural: "cloud environments",
};

export const CLOUD_RESOURCE_RULE_RUN_NOUNS: RuleRunResourceNouns = {
  resourceSingular: "cloud resource",
  resourcePlural: "cloud resources",
};

// A rule made before the split runs over the rows of both products.
export const BOTH_PRODUCTS_RULE_RUN_NOUNS: RuleRunResourceNouns = {
  resourceSingular: "cloud resource or environment",
  resourcePlural: "cloud resources and environments",
};

// What Run Now calls the rows a rule runs over: the rows of its own kind.
export function getCloudRuleRunNouns(rule: CloudRule): RuleRunResourceNouns {
  if (rule.cloudResourceKind === CloudResourceKind.Environment) {
    return CLOUD_ENVIRONMENT_RULE_RUN_NOUNS;
  }

  if (rule.cloudResourceKind === CloudResourceKind.Resource) {
    return CLOUD_RESOURCE_RULE_RUN_NOUNS;
  }

  return BOTH_PRODUCTS_RULE_RUN_NOUNS;
}

/*
 * What a product's rules pages say about each rule (RuleWording), from its
 * kind: a rule made for both products wears its pill beside the Edit
 * button on its own page too - where it is read and changed, not only in
 * the list - and its Run Now says it runs over the rows of both. The lists
 * select cloudResourceKind themselves, for their pill.
 */
export function getCloudRuleWording<TRule extends CloudRule>(
  kind: CloudResourceKind,
): RuleWording<TRule> {
  return {
    select: { cloudResourceKind: true } as RuleWording<TRule>["select"],
    getBadge: (rule: TRule): ReactElement | null => {
      return rule.cloudResourceKind ? null : (
        <CloudRuleKindPill rule={rule} kind={kind} />
      );
    },
    getRunNouns: getCloudRuleRunNouns,
  };
}
