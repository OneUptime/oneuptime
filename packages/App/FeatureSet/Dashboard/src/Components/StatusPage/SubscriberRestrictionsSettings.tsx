import { SubscriberRestrictionsCopy } from "./SubscriberRestrictionsCopy";
import EnterpriseSettingLeftoverCard from "../EnterpriseEdition/EnterpriseSettingLeftoverCard";
import {
  EnterpriseSettingLeftoverKind,
  EnterpriseSettingLeftoverReason,
} from "../EnterpriseEdition/EnterpriseSettingLeftoverCopy";
import { STATUS_PAGE_ACCESS_CONTROLS_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import EnterprisePluginPage, {
  EnterprisePluginUpsellProps,
} from "../../Enterprise/EnterprisePluginPage";
import { StatusPageSettingCardProps } from "../../Enterprise/EnterprisePlugins";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import IconProp from "Common/Types/Icon/IconProp";
import { getAllowedEmailDomainEntries } from "Common/Types/StatusPage/SubscriberRestrictions";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Who Can Subscribe, on a status page's Subscribers > Settings: only private
 * users can subscribe, and the email domains subscribers may use.
 *
 * Both are among a status page's Enterprise access controls
 * (ee/Dashboard/StatusPageAccessControls). The page keeps rendering this
 * component; it renders the Enterprise card when the project may use the
 * feature and this build includes it, and the upsell card otherwise. What
 * is already set keeps applying to subscribers in every edition, so under
 * the upsell it is shown, with Remove: on the Community Edition, and for a
 * OneUptime Cloud project below the plan.
 */

export type ComponentProps = StatusPageSettingCardProps;

export const SUBSCRIBER_RESTRICTIONS_LEFTOVER_VALUE_TEST_ID: string =
  "status-page-subscriber-restrictions-leftover-value";

export const SUBSCRIBER_RESTRICTIONS_UPSELL: EnterprisePluginUpsellProps = {
  title: "Who Can Subscribe",
  description: "Limit subscriptions to the people this status page is for.",
  featureName: "Subscriber Restrictions",
  featureDescription:
    "Keep a status page's notifications to its own audience: only the people who can sign in to it, or only email addresses at your domains.",
  featureIcon: IconProp.UserGroup,
  benefits: [
    {
      icon: IconProp.User,
      title: "Only private users",
      subtitle:
        "Subscribers are the page's own readers, by the address they sign in with.",
    },
    {
      icon: IconProp.Email,
      title: "Your email domains",
      subtitle:
        "Sign-ups at any other domain are refused, subdomains included.",
    },
    {
      icon: IconProp.ShieldCheck,
      title: "Kept up to date",
      subtitle: "Someone removed since is sent nothing, by SCIM or by hand.",
    },
    {
      icon: IconProp.Lock,
      title: "Part of access controls",
      subtitle: "With how long readers stay signed in.",
    },
  ],
};

const SubscriberRestrictionsSettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const getLeftover: (
    reason: EnterpriseSettingLeftoverReason,
  ) => ReactElement = (
    reason: EnterpriseSettingLeftoverReason,
  ): ReactElement => {
    return (
      <EnterpriseSettingLeftoverCard<StatusPage>
        kind={EnterpriseSettingLeftoverKind.SubscriberRestrictions}
        reason={reason}
        requiredPlan={STATUS_PAGE_ACCESS_CONTROLS_REQUIRED_PLAN}
        modelType={StatusPage}
        modelId={props.statusPageId}
        renderValue={(item: StatusPage): ReactElement => {
          const domains: Array<string> = getAllowedEmailDomainEntries(
            item.allowedSubscriberEmailDomains,
          );

          return (
            <div
              className="space-y-3 px-4 pb-4 md:px-6"
              data-testid={SUBSCRIBER_RESTRICTIONS_LEFTOVER_VALUE_TEST_ID}
            >
              {item.limitSubscribersToPrivateUsers ? (
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {translator.translateText(
                      SubscriberRestrictionsCopy.privateUsersOnlyTitle,
                    )}
                  </p>
                  <p className="text-sm text-gray-700">
                    {translator.translateText(
                      SubscriberRestrictionsCopy.privateUsersOnlyOnDescription,
                    )}
                  </p>
                </div>
              ) : (
                <></>
              )}
              {domains.length > 0 ? (
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {translator.translateText(
                      SubscriberRestrictionsCopy.allowedDomainsLabel,
                    )}
                  </p>
                  <ul className="space-y-1 text-sm text-gray-700">
                    {domains.map((domain: string) => {
                      return (
                        <li key={domain} className="font-mono">
                          {domain}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <></>
              )}
            </div>
          );
        }}
      />
    );
  };

  return (
    <EnterprisePluginPage<StatusPageSettingCardProps>
      plugin={getDashboardPlugins().StatusPageSubscriberRestrictions}
      pluginProps={props}
      requiredPlan={STATUS_PAGE_ACCESS_CONTROLS_REQUIRED_PLAN}
      upsell={SUBSCRIBER_RESTRICTIONS_UPSELL}
      belowPlan={getLeftover(EnterpriseSettingLeftoverReason.Plan)}
      communityLeftover={getLeftover(EnterpriseSettingLeftoverReason.Edition)}
    />
  );
};

export default SubscriberRestrictionsSettings;
