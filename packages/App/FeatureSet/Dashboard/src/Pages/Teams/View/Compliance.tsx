import PageComponentProps from "../../PageComponentProps";
import { IDENTITY_REQUIRED_PLAN } from "../../../Enterprise/EnterpriseEligibility";
import EnterprisePluginPage, {
  EnterprisePluginUpsellProps,
} from "../../../Enterprise/EnterprisePluginPage";
import { getDashboardPlugins } from "../../../Enterprise/Plugins";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Teams > View > Compliance: the team's compliance rules and the member
 * status table.
 *
 * The page is Enterprise code (ee/Dashboard/TeamCompliance/Compliance); this
 * shell stays at its route's path and renders it through the Dashboard plugin
 * when the project may use team compliance (the Scale plan on the Cloud, the
 * Enterprise Edition self-hosted) and the build includes the Enterprise
 * screens, and this upsell card otherwise.
 */
export const TEAM_COMPLIANCE_UPSELL: EnterprisePluginUpsellProps = {
  title: "Compliance Settings",
  description: "Enforce compliance rules on this team.",
  featureName: "Team Compliance Rules",
  featureDescription:
    "Require team members to have the notification methods and on-call configurations needed for SOC 2, ISO 27001, HIPAA and internal reviews.",
  benefits: [
    {
      icon: IconProp.ShieldCheck,
      title: "Notification method rules",
      subtitle:
        "Require members to keep email, SMS, push or voice methods configured.",
    },
    {
      icon: IconProp.Bell,
      title: "On-call coverage",
      subtitle:
        "Make sure every team has on-call policies and schedules in place.",
    },
    {
      icon: IconProp.ClipboardDocumentList,
      title: "Compliance dashboard",
      subtitle: "See which members satisfy each rule and which need attention.",
    },
    {
      icon: IconProp.Settings,
      title: "Configurable per team",
      subtitle:
        "Apply stricter rules to oncall teams and lighter rules elsewhere.",
    },
  ],
};

const TeamViewCompliance: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <EnterprisePluginPage<PageComponentProps>
      plugin={getDashboardPlugins().TeamCompliance}
      pluginProps={props}
      requiredPlan={IDENTITY_REQUIRED_PLAN}
      upsell={TEAM_COMPLIANCE_UPSELL}
    />
  );
};

export default TeamViewCompliance;
