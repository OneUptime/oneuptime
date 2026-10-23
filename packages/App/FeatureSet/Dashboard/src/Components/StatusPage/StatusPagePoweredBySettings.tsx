import StatusPagePoweredByCopy from "./StatusPagePoweredByCopy";
import EnterpriseSettingLeftoverCard from "../EnterpriseEdition/EnterpriseSettingLeftoverCard";
import {
  EnterpriseSettingLeftoverKind,
  EnterpriseSettingLeftoverReason,
} from "../EnterpriseEdition/EnterpriseSettingLeftoverCopy";
import { STATUS_PAGE_BRANDING_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import EnterprisePluginPage, {
  EnterprisePluginUpsellProps,
} from "../../Enterprise/EnterprisePluginPage";
import { StatusPageSettingCardProps } from "../../Enterprise/EnterprisePlugins";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The "Powered by OneUptime" card on a status page's Advanced Settings,
 * under "What your status page shows".
 *
 * Hiding the line is an Enterprise feature (ee/Dashboard/StatusPageBranding).
 * The page keeps rendering this component; it renders the Enterprise card
 * when the project may use the feature and this build includes it, and the
 * upsell card otherwise. On the Community Edition the server shows the line
 * on every page whatever the switch says, so there is nothing to remove
 * there; a OneUptime Cloud project below the plan still hides it until it
 * is shown again, so that one is drawn under the upsell, with a button that
 * shows it.
 */

export type ComponentProps = StatusPageSettingCardProps;

export const STATUS_PAGE_POWERED_BY_UPSELL: EnterprisePluginUpsellProps = {
  title: StatusPagePoweredByCopy.cardTitle,
  description: StatusPagePoweredByCopy.cardDescription,
  featureName: "Remove Powered by OneUptime",
  featureDescription:
    "Present a status page as your own: hide the Powered by OneUptime line from its footer.",
  featureIcon: IconProp.Swatch,
  benefits: [
    {
      icon: IconProp.Swatch,
      title: "Only your brand",
      subtitle: "The footer shows your own links and nothing else.",
    },
    {
      icon: IconProp.Window,
      title: "Every visitor",
      subtitle: "Public and private status pages alike.",
    },
    {
      icon: IconProp.Check,
      title: "One switch",
      subtitle: "Show the line again at any time.",
    },
    {
      icon: IconProp.Settings,
      title: "Per status page",
      subtitle: "Choose for each page on its own.",
    },
  ],
};

const StatusPagePoweredBySettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <EnterprisePluginPage<StatusPageSettingCardProps>
      plugin={getDashboardPlugins().StatusPagePoweredBy}
      pluginProps={props}
      requiredPlan={STATUS_PAGE_BRANDING_REQUIRED_PLAN}
      upsell={STATUS_PAGE_POWERED_BY_UPSELL}
      belowPlan={
        <EnterpriseSettingLeftoverCard<StatusPage>
          kind={EnterpriseSettingLeftoverKind.PoweredBy}
          reason={EnterpriseSettingLeftoverReason.Plan}
          requiredPlan={STATUS_PAGE_BRANDING_REQUIRED_PLAN}
          modelType={StatusPage}
          modelId={props.statusPageId}
          renderValue={(): ReactElement => {
            return <></>;
          }}
        />
      }
    />
  );
};

export default StatusPagePoweredBySettings;
