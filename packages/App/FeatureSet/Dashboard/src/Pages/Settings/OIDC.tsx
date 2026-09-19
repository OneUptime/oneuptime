import PageComponentProps from "../PageComponentProps";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { IDENTITY_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Settings > OIDC: the project's OpenID Connect sign-on providers.
 *
 * The screen is part of the Enterprise Edition (ee/Dashboard/SSO). This shell
 * keeps the route and the page module where they were: it renders the
 * Enterprise screen when the project may use the feature and this build
 * includes it, and the upsell card otherwise.
 */
const OIDCPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <EnterprisePluginPage
      plugin={getDashboardPlugins().SettingsOIDC}
      pluginProps={props}
      requiredPlan={IDENTITY_REQUIRED_PLAN}
      upsell={{
        title: "OpenID Connect (OIDC)",
        description: "Configure OIDC sign-on for your project.",
        featureName: "OIDC Single Sign On",
        featureDescription:
          "Authenticate team members through any OIDC provider — Google Workspace, Auth0, Keycloak, Microsoft Entra ID and more.",
        benefits: [
          {
            icon: IconProp.Lock,
            title: "Modern OAuth2 flow",
            subtitle:
              "Use any OIDC-compliant identity provider to manage who can sign in.",
          },
          {
            icon: IconProp.ShieldCheck,
            title: "Enforce SSO",
            subtitle:
              "Require OIDC login for everyone in the project — no shared passwords.",
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
              "Every OIDC sign-in is recorded alongside the rest of your audit events.",
          },
        ],
      }}
    />
  );
};

export default OIDCPage;
