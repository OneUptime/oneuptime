import PageComponentProps from "../../PageComponentProps";
import EnterprisePluginPage from "../../../Enterprise/EnterprisePluginPage";
import { IDENTITY_REQUIRED_PLAN } from "../../../Enterprise/EnterpriseEligibility";
import { getDashboardPlugins } from "../../../Enterprise/Plugins";
import { StatusPageScimConnectionsLeftover } from "../../../Components/Billing/IdentityPlanLeftovers";
import StatusPagePrivateOnlySettings from "../../../Components/StatusPage/StatusPagePrivateOnlySettings";
import { StatusPagePrivateOnlyPage } from "../../../Components/StatusPage/StatusPagePrivateOnlyCopy";
import useStatusPageAccess, {
  StatusPageAccessRead,
} from "../../../Components/StatusPage/useStatusPageAccess";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Status page > SCIM: provisioning of private status page users, and its logs.
 *
 * The screen is part of the Enterprise Edition (ee/Dashboard/Identity). This
 * shell keeps the route and the page module where they were: it renders the
 * Enterprise screen when the project may use the feature and this build
 * includes it, and the upsell card otherwise - on OneUptime Cloud below
 * Scale, with the SCIM connections the status page still has under it:
 * they only remove people - deactivate, delete - and can be deleted
 * (StatusPageScimConnectionsLeftover).
 *
 * SCIM adds and removes private users, who do nothing while the status page
 * is public, so the page says so then and folds the screen under the notice
 * (StatusPagePrivateOnlySettings).
 */
const SCIMPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const statusPageId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const accessRead: StatusPageAccessRead = useStatusPageAccess(statusPageId);

  return (
    <StatusPagePrivateOnlySettings
      statusPageId={statusPageId}
      access={accessRead.access}
      page={StatusPagePrivateOnlyPage.Scim}
    >
      <EnterprisePluginPage
        plugin={getDashboardPlugins().StatusPageSCIM}
        pluginProps={props}
        requiredPlan={IDENTITY_REQUIRED_PLAN}
        belowPlan={<StatusPageScimConnectionsLeftover />}
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
              subtitle:
                "Status page viewers are added when granted in your IdP.",
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
    </StatusPagePrivateOnlySettings>
  );
};

export default SCIMPage;
