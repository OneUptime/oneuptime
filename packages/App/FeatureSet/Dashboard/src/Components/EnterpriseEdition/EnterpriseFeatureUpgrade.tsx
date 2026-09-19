import {
  EnterpriseRequiredPlan,
  IDENTITY_REQUIRED_PLAN,
  isEnterpriseFeatureEligible,
} from "../../Enterprise/EnterpriseEligibility";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon, { SizeProp, ThickProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { BILLING_ENABLED } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Kept here under its original name: every enterprise page imports it from
 * this file. The tier-aware logic itself lives in Enterprise/EnterpriseEligibility.
 */
export { isEnterpriseFeatureEligible };

const PRICING_URL: string = "https://oneuptime.com/pricing";
const ENTERPRISE_OVERVIEW_URL: string =
  "https://oneuptime.com/enterprise/overview";
const ENTERPRISE_DOCS_URL: string =
  "https://oneuptime.com/docs/self-hosted/enterprise";

/*
 * Why the card is showing:
 *   - Plan: OneUptime Cloud, and the project's plan is below the feature's
 *     tier. The card sells the plan.
 *   - Edition: a self-hosted Community Edition, or a build that does not
 *     include the Enterprise screens. The card points at the Enterprise
 *     Edition. Selling a plan upgrade here would be wrong - on the Cloud this
 *     only happens when the plan is already sufficient.
 */
export enum EnterpriseUpgradeReason {
  Plan = "plan",
  Edition = "edition",
}

export interface Benefit {
  icon: IconProp;
  title: string;
  subtitle: string;
}

export interface ComponentProps {
  title: string;
  description: string;
  featureName: string;
  featureDescription?: string | undefined;
  benefits: Array<Benefit>;
  /*
   * The Cloud plan the feature is sold at. Defaults to Scale, the tier of
   * every SSO / OIDC / SCIM / compliance model; audit logs pass Enterprise.
   */
  requiredPlan?: EnterpriseRequiredPlan | undefined;
  // Defaults to Plan on the Cloud and Edition when self-hosted.
  reason?: EnterpriseUpgradeReason | undefined;
  // Icon in the feature tile. Defaults to a shield.
  featureIcon?: IconProp | undefined;
  /*
   * Replace the generated sentence under the feature name, for a feature
   * whose name does not read well in "<name> is available on ...".
   */
  planPitchLine?: string | undefined;
  editionPitchLine?: string | undefined;
}

export interface EnterpriseUpgradeCopy {
  ctaTitle: string;
  ctaIcon: IconProp;
  ctaUrl: string;
  badge: string;
  pitchLine: string;
  secondaryTitle: string;
  secondaryIcon: IconProp;
  secondaryUrl: string;
}

export interface EnterpriseUpgradeCopyInput {
  featureName: string;
  requiredPlan: EnterpriseRequiredPlan;
  reason: EnterpriseUpgradeReason;
  planPitchLine?: string | undefined;
  editionPitchLine?: string | undefined;
}

export const getDefaultUpgradeReason: () => EnterpriseUpgradeReason =
  (): EnterpriseUpgradeReason => {
    return BILLING_ENABLED
      ? EnterpriseUpgradeReason.Plan
      : EnterpriseUpgradeReason.Edition;
  };

/*
 * Every string the card shows, as a pure function of why it is showing and
 * which plan the feature needs - so the wording can be tested without a DOM.
 */
export const getEnterpriseUpgradeCopy: (
  input: EnterpriseUpgradeCopyInput,
) => EnterpriseUpgradeCopy = (
  input: EnterpriseUpgradeCopyInput,
): EnterpriseUpgradeCopy => {
  if (input.reason === EnterpriseUpgradeReason.Plan) {
    /*
     * Enterprise is the top plan; for any lower tier the feature is also
     * included in every plan above it.
     */
    const planScope: string =
      input.requiredPlan === PlanType.Enterprise
        ? `the ${input.requiredPlan} plan`
        : `the ${input.requiredPlan} plan and above`;

    return {
      ctaTitle: `Upgrade to ${input.requiredPlan}`,
      ctaIcon: IconProp.Billing,
      ctaUrl: PRICING_URL,
      badge: input.requiredPlan,
      pitchLine:
        input.planPitchLine ||
        `${input.featureName} is available on ${planScope}. Upgrade to enable it for this project.`,
      secondaryTitle: "Compare plans",
      secondaryIcon: IconProp.List,
      secondaryUrl: PRICING_URL,
    };
  }

  return {
    ctaTitle: "Learn about Enterprise Edition",
    ctaIcon: IconProp.Info,
    ctaUrl: ENTERPRISE_OVERVIEW_URL,
    badge: "Enterprise",
    pitchLine:
      input.editionPitchLine ||
      `${input.featureName} is a OneUptime Enterprise Edition feature. Switch to the Enterprise Edition build to enable it.`,
    secondaryTitle: "Read docs",
    secondaryIcon: IconProp.Book,
    secondaryUrl: ENTERPRISE_DOCS_URL,
  };
};

const EnterpriseFeatureUpgrade: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const copy: EnterpriseUpgradeCopy = getEnterpriseUpgradeCopy({
    featureName: props.featureName,
    requiredPlan: props.requiredPlan || IDENTITY_REQUIRED_PLAN,
    reason: props.reason || getDefaultUpgradeReason(),
    planPitchLine: props.planPitchLine,
    editionPitchLine: props.editionPitchLine,
  });

  return (
    <Card
      title={props.title}
      description={props.description}
      rightElement={
        <Button
          title={copy.ctaTitle}
          buttonStyle={ButtonStyleType.PRIMARY}
          icon={copy.ctaIcon}
          onClick={() => {
            window.open(copy.ctaUrl, "_blank");
          }}
        />
      }
    >
      <div className="px-4 pb-6 pt-2">
        <div className="flex flex-col items-start gap-4 rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Icon
                icon={props.featureIcon || IconProp.ShieldCheck}
                size={SizeProp.Large}
                thick={ThickProp.Thick}
                className="h-6 w-6"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-gray-900">
                  {props.featureName}
                </h3>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                  <Icon
                    icon={IconProp.Star}
                    size={SizeProp.Small}
                    thick={ThickProp.Thick}
                    className="h-2.5 w-2.5"
                  />
                  {copy.badge}
                </span>
              </div>
              {props.featureDescription ? (
                <p className="text-xs text-gray-500 mt-0.5">
                  {props.featureDescription}
                </p>
              ) : null}
            </div>
          </div>

          <p className="text-sm text-gray-700">{copy.pitchLine}</p>

          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
            {props.benefits.map((benefit: Benefit) => {
              return (
                <div
                  key={benefit.title}
                  className="flex items-start gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2.5 shadow-sm"
                >
                  <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                    <Icon
                      icon={benefit.icon}
                      size={SizeProp.Small}
                      thick={ThickProp.Thick}
                      className="h-4 w-4"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-gray-900">
                      {benefit.title}
                    </div>
                    <div className="text-[11px] leading-snug text-gray-500 mt-0.5">
                      {benefit.subtitle}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              title={copy.ctaTitle}
              buttonStyle={ButtonStyleType.PRIMARY}
              icon={copy.ctaIcon}
              onClick={() => {
                window.open(copy.ctaUrl, "_blank");
              }}
            />
            <Button
              title={copy.secondaryTitle}
              buttonStyle={ButtonStyleType.OUTLINE}
              icon={copy.secondaryIcon}
              onClick={() => {
                window.open(copy.secondaryUrl, "_blank");
              }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
};

export default EnterpriseFeatureUpgrade;
