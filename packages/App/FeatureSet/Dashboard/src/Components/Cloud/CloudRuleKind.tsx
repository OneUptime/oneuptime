import CloudResourceLabelRule from "Common/Models/DatabaseModels/CloudResourceLabelRule";
import CloudResourceOwnerRule from "Common/Models/DatabaseModels/CloudResourceOwnerRule";
import EqualToOrNull from "Common/Types/BaseDatabase/EqualToOrNull";
import { Gray500 } from "Common/Types/BrandColors";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import Pill from "Common/UI/Components/Pill/Pill";
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

// The rules one product's page lists: its own, and those made for both.
export function getCloudRuleListQuery(kind: CloudResourceKind): {
  cloudResourceKind: EqualToOrNull<string>;
} {
  return { cloudResourceKind: new EqualToOrNull<string>(kind) };
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

export function getAlsoAppliesInText(
  kind: CloudResourceKind,
): string {
  return kind === CloudResourceKind.Resource
    ? ALSO_IN_APP_PLATFORMS
    : ALSO_IN_CLOUD;
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
      {props.rule.cloudResourceKind ? (
        <></>
      ) : (
        <Pill
          text={getAlsoAppliesInText(props.kind)}
          color={Gray500}
          tooltip={BOTH_PRODUCTS_RULE_TOOLTIP}
        />
      )}
    </span>
  );
}
