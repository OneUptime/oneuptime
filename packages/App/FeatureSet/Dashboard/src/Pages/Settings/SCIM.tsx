import PageComponentProps from "../PageComponentProps";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { IDENTITY_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Settings > SCIM: user provisioning for the project, and its logs.
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
      plugin={getDashboardPlugins().SettingsSCIM}
      pluginProps={props}
      requiredPlan={IDENTITY_REQUIRED_PLAN}
      upsell={{
        title: "SCIM User Provisioning",
        description: "Automate user provisioning via SCIM.",
        featureName: "SCIM User Provisioning",
        featureDescription:
          "Provision and deprovision users automatically from your identity provider — Okta, Azure AD, OneLogin and any other SCIM 2.0 system.",
        benefits: [
          {
            icon: IconProp.User,
            title: "Automatic provisioning",
            subtitle:
              "Users created in your IdP are added to OneUptime without manual invites.",
          },
          {
            icon: IconProp.Lock,
            title: "Automatic deprovisioning",
            subtitle:
              "Disable a user in your IdP and access here is removed at the same time.",
          },
          {
            icon: IconProp.ShieldCheck,
            title: "Group sync",
            subtitle:
              "Map IdP groups to teams to keep on-call rosters and permissions accurate.",
          },
          {
            icon: IconProp.ClipboardDocumentList,
            title: "SCIM activity logs",
            subtitle:
              "See every provisioning event so you can debug sync issues quickly.",
          },
        ],
      }}
    />
  );
};

export default SCIMPage;
