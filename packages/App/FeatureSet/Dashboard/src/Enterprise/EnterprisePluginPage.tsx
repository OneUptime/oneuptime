import EnterpriseFeatureUpgrade, {
  ComponentProps as EnterpriseFeatureUpgradeProps,
  EnterpriseUpgradeReason,
  getDefaultUpgradeReason,
} from "../Components/EnterpriseEdition/EnterpriseFeatureUpgrade";
import {
  EnterpriseRequiredPlan,
  isEnterpriseFeatureEligible,
} from "./EnterpriseEligibility";
import { EnterprisePluginComponent } from "./EnterprisePlugins";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import React, { ReactElement, Suspense } from "react";

/*
 * What a core shell renders in place of an enterprise screen: the ee plugin
 * when this project may use the feature AND this build includes it, the
 * upsell card otherwise.
 *
 *   const SSOPage: FunctionComponent<PageComponentProps> = (
 *     props: PageComponentProps,
 *   ): ReactElement => {
 *     return (
 *       <EnterprisePluginPage
 *         plugin={getDashboardPlugins().SettingsSSO}
 *         pluginProps={props}
 *         requiredPlan={IDENTITY_REQUIRED_PLAN}
 *         upsell={{ title: "...", description: "...", featureName: "...", benefits: [...] }}
 *       />
 *     );
 *   };
 *
 * The plugin is usually React.lazy, so it renders inside Suspense and the ee
 * chunk downloads the first time the screen opens.
 */

// The upsell card's own props; its plan always comes from `requiredPlan`.
export type EnterprisePluginUpsellProps = Omit<
  EnterpriseFeatureUpgradeProps,
  "requiredPlan" | "reason"
>;

type UpsellProps =
  | {
      // Show the shared enterprise card with these props.
      upsell: EnterprisePluginUpsellProps;
      renderUpsell?: undefined;
    }
  | {
      /*
       * Show a bespoke card instead (audit logs have their own). Receives the
       * reason, so a Cloud project on a sufficient plan is never told to
       * upgrade when the build merely lacks the Enterprise screens.
       */
      renderUpsell: (reason: EnterpriseUpgradeReason) => ReactElement;
      upsell?: undefined;
    };

export type ComponentProps<TPluginProps> = {
  // From getDashboardPlugins(), read inside the shell's render.
  plugin: EnterprisePluginComponent<TPluginProps> | undefined;
  pluginProps: TPluginProps;
  // The Cloud plan the feature is sold at (see EnterpriseEligibility).
  requiredPlan: EnterpriseRequiredPlan;
  /*
   * Overrides the plan/edition check, for a screen with its own rule. Leave
   * it unset unless the screen really has one.
   */
  isEligible?: boolean | undefined;
  // Shown while a lazy plugin downloads. Defaults to the in-card loader.
  loadingElement?: ReactElement | undefined;
} & UpsellProps;

export const getUpgradeReason: (
  isEligible: boolean,
) => EnterpriseUpgradeReason = (
  isEligible: boolean,
): EnterpriseUpgradeReason => {
  /*
   * Eligible but still here means the plan (or edition) is fine and only the
   * Enterprise screens are missing from this bundle - point at the edition,
   * never at a plan upgrade the project does not need.
   */
  if (isEligible) {
    return EnterpriseUpgradeReason.Edition;
  }

  return getDefaultUpgradeReason();
};

const EnterprisePluginPage: <TPluginProps>(
  props: ComponentProps<TPluginProps>,
) => ReactElement = <TPluginProps,>(
  props: ComponentProps<TPluginProps>,
): ReactElement => {
  const isEligible: boolean =
    props.isEligible === undefined
      ? isEnterpriseFeatureEligible(props.requiredPlan)
      : props.isEligible;

  const Plugin: EnterprisePluginComponent<TPluginProps> | undefined =
    props.plugin;

  if (!isEligible || !Plugin) {
    const reason: EnterpriseUpgradeReason = getUpgradeReason(isEligible);

    if (props.renderUpsell) {
      return props.renderUpsell(reason);
    }

    return (
      <EnterpriseFeatureUpgrade
        {...(props.upsell as EnterprisePluginUpsellProps)}
        requiredPlan={props.requiredPlan}
        reason={reason}
      />
    );
  }

  /*
   * TPluginProps is unconstrained, so the compiler cannot see that it already
   * satisfies JSX's IntrinsicAttributes (every props object does).
   */
  const pluginProps: TPluginProps & React.JSX.IntrinsicAttributes =
    props.pluginProps as TPluginProps & React.JSX.IntrinsicAttributes;

  return (
    <Suspense fallback={props.loadingElement || <ComponentLoader />}>
      <Plugin {...pluginProps} />
    </Suspense>
  );
};

export default EnterprisePluginPage;
