import PageComponentProps from "../PageComponentProps";
import BuiltInRolesCard from "../../Components/CustomRole/BuiltInRolesCard";
import { ProjectCustomRolesLeftover } from "../../Components/CustomRole/CustomRoleLeftovers";
import { EnterpriseSettingLeftoverReason } from "../../Components/EnterpriseEdition/EnterpriseSettingLeftoverCopy";
import { CUSTOM_ROLES_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import EnterprisePluginPage, {
  EnterprisePluginUpsellProps,
} from "../../Enterprise/EnterprisePluginPage";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import IconProp from "Common/Types/Icon/IconProp";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * TEAMS > SETTINGS > ROLES: THE PROJECT'S CUSTOM ROLES, AND THE BUILT-IN
 * ONES.
 *
 * Custom roles are an Enterprise feature (ee/Dashboard/CustomRoles). This
 * shell keeps the route and the page module where they were: it renders the
 * Enterprise page when the project may use the feature and this build
 * includes it, and the upsell card otherwise. A custom role keeps giving the
 * teams that have it its permissions in every edition, so under the upsell
 * the project's roles are listed, with Delete (ProjectCustomRolesLeftover):
 * on the Community Edition, and for a OneUptime Cloud project below the plan.
 *
 * Under them, folded, are the roles every project has, read-only
 * (BuiltInRolesCard) - in every edition.
 */

export const CUSTOM_ROLES_UPSELL: EnterprisePluginUpsellProps = {
  title: "Custom Roles",
  description:
    "A set of permissions you name once, such as Incident Responder, and give to teams.",
  featureName: "Custom Roles",
  featureDescription:
    "Bundle permissions into roles of your own, give them to teams, and change every team that has a role in one place.",
  featureIcon: IconProp.Identification,
  benefits: [
    {
      icon: IconProp.Identification,
      title: "Roles in your own words",
      subtitle: "Incident Responder, Team Lead - named once, used everywhere.",
    },
    {
      icon: IconProp.Team,
      title: "Given to teams",
      subtitle: "A team gets everything a role allows in one step.",
    },
    {
      icon: IconProp.Edit,
      title: "Changed in one place",
      subtitle: "A change to a role changes every team that has it.",
    },
    {
      icon: IconProp.Label,
      title: "Scoped like any permission",
      subtitle: "With the same scope and labels a team's own permission takes.",
    },
  ],
};

const TeamRoles: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <EnterprisePluginPage
        plugin={getDashboardPlugins().TeamRoles}
        pluginProps={props}
        requiredPlan={CUSTOM_ROLES_REQUIRED_PLAN}
        upsell={CUSTOM_ROLES_UPSELL}
        belowPlan={
          <ProjectCustomRolesLeftover
            reason={EnterpriseSettingLeftoverReason.Plan}
          />
        }
        communityLeftover={
          <ProjectCustomRolesLeftover
            reason={EnterpriseSettingLeftoverReason.Edition}
          />
        }
      />

      <BuiltInRolesCard />
    </Fragment>
  );
};

export default TeamRoles;
