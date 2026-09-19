import PageComponentProps from "../PageComponentProps";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { IDENTITY_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Settings > SSO: the project's SAML single sign-on providers.
 *
 * The screen is part of the Enterprise Edition (ee/Dashboard/SSO). This shell
 * keeps the route and the page module where they were: it renders the
 * Enterprise screen when the project may use the feature and this build
 * includes it, and the upsell card otherwise.
 */
const SSOPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <EnterprisePluginPage
      plugin={getDashboardPlugins().SettingsSSO}
      pluginProps={props}
      requiredPlan={IDENTITY_REQUIRED_PLAN}
      upsell={{
        title: "Single Sign On (SSO)",
        description: "Configure SAML SSO for your project.",
        featureName: "SAML Single Sign On",
        featureDescription:
          "Let team members authenticate into this project using your SAML identity provider (Okta, Azure AD, OneLogin, JumpCloud and more).",
        benefits: [
          {
            icon: IconProp.Lock,
            title: "Centralized auth",
            subtitle:
              "Federate sign-in to your IdP and revoke access from one place.",
          },
          {
            icon: IconProp.ShieldCheck,
            title: "Enforce SSO",
            subtitle:
              "Require SSO for everyone in the project — no shared passwords.",
          },
          {
            icon: IconProp.User,
            title: "Auto team assignment",
            subtitle:
              "Map signed-in users into the right teams the moment they log in.",
          },
          {
            icon: IconProp.ClipboardDocumentList,
            title: "Audit trail",
            subtitle:
              "Every SSO sign-in is recorded alongside the rest of your audit events.",
          },
        ],
      }}
    />
  );
};

export default SSOPage;
