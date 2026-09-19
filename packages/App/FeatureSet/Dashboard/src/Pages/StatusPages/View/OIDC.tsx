import PageComponentProps from "../../PageComponentProps";
import EnterprisePluginPage from "../../../Enterprise/EnterprisePluginPage";
import { IDENTITY_REQUIRED_PLAN } from "../../../Enterprise/EnterpriseEligibility";
import { getDashboardPlugins } from "../../../Enterprise/Plugins";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Status page > OIDC: OpenID Connect sign-on for private status page users.
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
      plugin={getDashboardPlugins().StatusPageOIDC}
      pluginProps={props}
      requiredPlan={IDENTITY_REQUIRED_PLAN}
      upsell={{
        title: "Status Page OIDC",
        description: "Configure OIDC sign-on for this private status page.",
        featureName: "Status Page OIDC SSO",
        featureDescription:
          "Restrict access to this status page using any OIDC provider — Google Workspace, Auth0, Keycloak and more.",
        benefits: [
          {
            icon: IconProp.Lock,
            title: "Private status pages",
            subtitle:
              "Only OIDC-authenticated users can view this status page.",
          },
          {
            icon: IconProp.ShieldCheck,
            title: "Centralized control",
            subtitle:
              "Revoke a user in your IdP and they lose access immediately.",
          },
          {
            icon: IconProp.User,
            title: "Per-status-page identity",
            subtitle:
              "Run distinct IdPs for different audiences (internal vs partner).",
          },
          {
            icon: IconProp.ClipboardDocumentList,
            title: "Audit trail",
            subtitle: "See who signed in to your status page and when.",
          },
        ],
      }}
    />
  );
};

export default OIDCPage;
