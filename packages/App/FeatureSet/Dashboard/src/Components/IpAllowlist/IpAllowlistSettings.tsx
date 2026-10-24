import { getIpAllowlistEntries } from "./IpAllowlistCopy";
import EnterpriseSettingLeftoverCard from "../EnterpriseEdition/EnterpriseSettingLeftoverCard";
import {
  EnterpriseSettingLeftoverKind,
  EnterpriseSettingLeftoverReason,
} from "../EnterpriseEdition/EnterpriseSettingLeftoverCopy";
import { IP_ALLOWLIST_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import EnterprisePluginPage, {
  EnterprisePluginUpsellProps,
} from "../../Enterprise/EnterprisePluginPage";
import {
  IpAllowlistCardProps,
  IpAllowlistModel,
} from "../../Enterprise/EnterprisePlugins";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import IconProp from "Common/Types/Icon/IconProp";
import React, { ReactElement } from "react";

/*
 * The IP allowlist card of a private status page (Security > Access), a
 * public dashboard (Sharing) and a form (Share): who may open it, by address.
 *
 * Setting and changing an allowlist is an Enterprise feature
 * (ee/Dashboard/IpAllowlists). Every page keeps rendering this component; it
 * renders the Enterprise card when the project may use the feature and this
 * build includes it, and the upsell card otherwise. An allowlist already set
 * keeps being enforced in every edition - dropping it would open what its
 * owners restricted - so under the upsell it is shown, with Remove: on the
 * Community Edition, and for a OneUptime Cloud project below the plan.
 */

export type ComponentProps = IpAllowlistCardProps;

export const IP_ALLOWLIST_UPSELL: EnterprisePluginUpsellProps = {
  title: "IP Allowlist",
  description: "Let only the networks you trust open this.",
  featureName: "IP Allowlists",
  featureDescription:
    "Limit who can open a private status page, a public dashboard or a form to the addresses and ranges you list.",
  featureIcon: IconProp.Lock,
  benefits: [
    {
      icon: IconProp.ShieldCheck,
      title: "Only your networks",
      subtitle: "Keep a page to your office, your VPN or a partner's range.",
    },
    {
      icon: IconProp.Globe,
      title: "Addresses and ranges",
      subtitle: "List IPv4 and IPv6 addresses, and IPv4 ranges.",
    },
    {
      icon: IconProp.Lock,
      title: "On top of sign-in",
      subtitle: "Applies whoever the page is open to, signed in or not.",
    },
    {
      icon: IconProp.Layers,
      title: "Everything you share",
      subtitle: "Status pages, public dashboards and forms alike.",
    },
  ],
};

const IpAllowlistSettings: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const getLeftover: (
    reason: EnterpriseSettingLeftoverReason,
  ) => ReactElement = (
    reason: EnterpriseSettingLeftoverReason,
  ): ReactElement => {
    return (
      <EnterpriseSettingLeftoverCard<IpAllowlistModel>
        kind={EnterpriseSettingLeftoverKind.IpAllowlist}
        reason={reason}
        requiredPlan={IP_ALLOWLIST_REQUIRED_PLAN}
        modelType={props.modelType}
        modelId={props.modelId}
        onLoaded={(item: IpAllowlistModel | null) => {
          if (item) {
            props.onLoaded?.(item.ipWhitelist || "");
          }
        }}
        onRemoved={() => {
          props.onLoaded?.("");
        }}
        renderValue={(item: IpAllowlistModel): ReactElement => {
          return (
            <ul
              className="space-y-1 px-4 pb-4 text-sm text-gray-900 md:px-6"
              data-testid={props.entriesTestId}
            >
              {getIpAllowlistEntries(item.ipWhitelist).map(
                (entry: string, index: number) => {
                  return (
                    <li key={`${entry}-${index}`} className="font-mono">
                      {entry}
                    </li>
                  );
                },
              )}
            </ul>
          );
        }}
      />
    );
  };

  return (
    <EnterprisePluginPage<IpAllowlistCardProps>
      plugin={getDashboardPlugins().IpAllowlistCard}
      pluginProps={props}
      requiredPlan={IP_ALLOWLIST_REQUIRED_PLAN}
      upsell={IP_ALLOWLIST_UPSELL}
      belowPlan={getLeftover(EnterpriseSettingLeftoverReason.Plan)}
      communityLeftover={getLeftover(EnterpriseSettingLeftoverReason.Edition)}
    />
  );
};

export default IpAllowlistSettings;
