import PageComponentProps from "../../PageComponentProps";
import EnterprisePluginPage from "../../../Enterprise/EnterprisePluginPage";
import { IDENTITY_REQUIRED_PLAN } from "../../../Enterprise/EnterpriseEligibility";
import { getDashboardPlugins } from "../../../Enterprise/Plugins";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Status page > SCIM: provisioning of private status page users, and its logs.
 *
 * The screen is part of the Enterprise Edition (ee/Dashboard/SSO). This shell
 * keeps the route and the page module where they were: it renders the
 * Enterprise screen when the project may use the feature and this build
 * includes it, and the upsell card otherwise.
 */
const SCIMPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <EnterprisePluginPage
      plugin={getDashboardPlugins().StatusPageSCIM}
      pluginProps={props}
      requiredPlan={IDENTITY_REQUIRED_PLAN}
      upsell={{
        title: "Status Page SCIM",
        description: "Automate user provisioning for this status page.",
        featureName: "Status Page SCIM Provisioning",
        featureDescription:
          "Provision and deprovision viewers of this status page directly from your identity provider — Okta, Azure AD and any SCIM 2.0 system.",
        benefits: [
          {
            icon: IconProp.User,
            title: "Automatic provisioning",
            subtitle: "Status page viewers are added when granted in your IdP.",
          },
          {
            icon: IconProp.Lock,
            title: "Automatic deprovisioning",
            subtitle:
              "Disable access in your IdP and they lose access here in sync.",
          },
          {
            icon: IconProp.ShieldCheck,
            title: "Group sync",
            subtitle:
              "Map IdP groups to status page viewers without manual upkeep.",
          },
          {
            icon: IconProp.ClipboardDocumentList,
            title: "SCIM activity logs",
            subtitle:
              "Every provisioning event is recorded for troubleshooting.",
          },
        ],
      }}
    />
  );
};

export default SCIMPage;
