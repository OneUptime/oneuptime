import EnterpriseFeatureUpgrade, {
  ComponentProps as EnterpriseFeatureUpgradeProps,
} from "../Components/EnterpriseEdition/EnterpriseFeatureUpgrade";
import { EnterprisePluginComponent } from "./EnterprisePlugins";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { IS_ENTERPRISE_EDITION } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement, Suspense } from "react";

/*
 * What a core admin shell renders in place of an enterprise screen: the ee
 * plugin when this is the Enterprise Edition AND this build includes it, the
 * upsell card otherwise.
 *
 *   const SettingsGlobalSSO: FunctionComponent = (): ReactElement => {
 *     return (
 *       <EnterprisePluginPage
 *         plugin={getAdminDashboardPlugins().GlobalSSOList}
 *         upsell={{ title: "...", description: "...", featureName: "...", benefits: [...] }}
 *       />
 *     );
 *   };
 *
 * The admin dashboard is an instance-level surface with no project or plan, so
 * the default rule is the effective edition the server writes into env.js
 * (true only when the ee code is loaded). A lapsed license does not change it:
 * the ee screens stay reachable and show their own read-only banner.
 *
 * The plugin is usually React.lazy, so it renders inside Suspense and the ee
 * chunk downloads the first time the screen opens.
 */

type UpsellProps =
  | {
      // Show the shared enterprise card with these props.
      upsell: EnterpriseFeatureUpgradeProps;
      renderUpsell?: undefined;
    }
  | {
      // Show a bespoke card instead (the Health pages have their own).
      renderUpsell: () => ReactElement;
      upsell?: undefined;
    };

export type ComponentProps = {
  // From getAdminDashboardPlugins(), read inside the shell's render.
  plugin: EnterprisePluginComponent | undefined;
  /*
   * Overrides the edition check, for a screen with its own rule (the license
   * server pages exist on OneUptime Cloud only). Leave it unset otherwise.
   */
  isEligible?: boolean | undefined;
  // Shown while a lazy plugin downloads. Defaults to the in-card loader.
  loadingElement?: ReactElement | undefined;
} & UpsellProps;

const EnterprisePluginPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isEligible: boolean =
    props.isEligible === undefined ? IS_ENTERPRISE_EDITION : props.isEligible;

  const Plugin: EnterprisePluginComponent | undefined = props.plugin;

  if (!isEligible || !Plugin) {
    if (props.renderUpsell) {
      return props.renderUpsell();
    }

    return (
      <EnterpriseFeatureUpgrade
        {...(props.upsell as EnterpriseFeatureUpgradeProps)}
      />
    );
  }

  return (
    <Suspense fallback={props.loadingElement || <ComponentLoader />}>
      <Plugin />
    </Suspense>
  );
};

export default EnterprisePluginPage;
