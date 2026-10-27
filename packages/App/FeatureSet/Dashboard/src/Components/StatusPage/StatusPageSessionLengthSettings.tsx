import StatusPageSessionLengthCopy, {
  getSessionLengthLabel,
  SessionLengthChoice,
} from "./StatusPageSessionLengthCopy";
import EnterpriseSettingLeftoverCard from "../EnterpriseEdition/EnterpriseSettingLeftoverCard";
import {
  EnterpriseSettingLeftoverKind,
  EnterpriseSettingLeftoverReason,
} from "../EnterpriseEdition/EnterpriseSettingLeftoverCopy";
import { STATUS_PAGE_ACCESS_CONTROLS_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import EnterprisePluginPage, {
  EnterprisePluginUpsellProps,
} from "../../Enterprise/EnterprisePluginPage";
import { StatusPageSessionLengthCardProps } from "../../Enterprise/EnterprisePlugins";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import IconProp from "Common/Types/Icon/IconProp";
import { readPrivateUserSessionLength } from "Common/Types/StatusPage/PrivateUserSessionLength";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Reader Sessions card on a status page's Security > Access: how long a
 * private user stays signed in. It waits folded under the page's More
 * settings - an Enterprise control few status pages use, and none that is
 * open to anyone - telling the page the length it holds (onLengthChange),
 * so the folded header can say so.
 *
 * Setting a limit is one of a status page's Enterprise access controls
 * (ee/Dashboard/StatusPageAccessControls). The page keeps rendering this
 * component; it renders the Enterprise card when the project may use the
 * feature and this build includes it, and the upsell card otherwise. A
 * limit already set keeps signing readers out in every edition, so under
 * the upsell it is shown, with Remove: on the Community Edition, and for a
 * OneUptime Cloud project below the plan.
 */

export type ComponentProps = StatusPageSessionLengthCardProps;

export const STATUS_PAGE_SESSION_LENGTH_LEFTOVER_VALUE_TEST_ID: string =
  "status-page-session-length-leftover-value";

export const STATUS_PAGE_SESSION_LENGTH_UPSELL: EnterprisePluginUpsellProps = {
  title: "Reader Sessions",
  description: "Sign readers out of this private status page on a schedule.",
  featureName: "Reader Session Limits",
  featureDescription:
    "Choose how long a private user stays signed in to a private status page, however active they are, so they sign in again - through SSO too - as often as you need.",
  featureIcon: IconProp.Clock,
  benefits: [
    {
      icon: IconProp.Clock,
      title: "Your schedule",
      subtitle: "From one hour to a year, counted from each sign-in.",
    },
    {
      icon: IconProp.ShieldCheck,
      title: "Fresh SSO checks",
      subtitle: "Your identity provider decides again at every new sign-in.",
    },
    {
      icon: IconProp.Logout,
      title: "Applies to everyone",
      subtitle: "Readers signed in now are held to it too.",
    },
    {
      icon: IconProp.Lock,
      title: "Part of access controls",
      subtitle: "With who can subscribe, and at which email domains.",
    },
  ],
};

const StatusPageSessionLengthSettings: FunctionComponent<ComponentProps> = (
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
        kind={EnterpriseSettingLeftoverKind.SessionLength}
        reason={reason}
        requiredPlan={STATUS_PAGE_ACCESS_CONTROLS_REQUIRED_PLAN}
        modelType={StatusPage}
        modelId={props.statusPageId}
        onLoaded={(item: StatusPage | null) => {
          props.onLengthChange?.(
            item
              ? readPrivateUserSessionLength(
                  item.privateUserSessionLengthInHours,
                )
              : null,
          );
        }}
        onRemoved={() => {
          props.onLengthChange?.(null);
        }}
        renderValue={(item: StatusPage): ReactElement => {
          const hours: number | null = readPrivateUserSessionLength(
            item.privateUserSessionLengthInHours,
          );

          if (hours === null) {
            return <></>;
          }

          const length: Pick<SessionLengthChoice, "label" | "labelValues"> =
            getSessionLengthLabel(hours);

          return (
            <div
              className="px-4 pb-4 md:px-6"
              data-testid={STATUS_PAGE_SESSION_LENGTH_LEFTOVER_VALUE_TEST_ID}
            >
              <p className="text-sm font-medium text-gray-900">
                {translator.translateText(StatusPageSessionLengthCopy.label)}
              </p>
              <p className="text-sm text-gray-700">
                {length.labelValues
                  ? translator.translateTemplate(
                      length.label,
                      length.labelValues,
                    )
                  : translator.translateText(length.label)}
              </p>
            </div>
          );
        }}
      />
    );
  };

  return (
    <EnterprisePluginPage<StatusPageSessionLengthCardProps>
      plugin={getDashboardPlugins().StatusPageSessionLength}
      pluginProps={props}
      requiredPlan={STATUS_PAGE_ACCESS_CONTROLS_REQUIRED_PLAN}
      upsell={STATUS_PAGE_SESSION_LENGTH_UPSELL}
      belowPlan={getLeftover(EnterpriseSettingLeftoverReason.Plan)}
      communityLeftover={getLeftover(EnterpriseSettingLeftoverReason.Edition)}
    />
  );
};

export default StatusPageSessionLengthSettings;
