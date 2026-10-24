import PageComponentProps from "../PageComponentProps";
import { CUSTOM_ROLES_UPSELL } from "./Roles";
import { CUSTOM_ROLES_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A CUSTOM ROLE'S PAGE: what it is called, what it gives, who has it, and
 * deleting it.
 *
 * Custom roles are an Enterprise feature (ee/Dashboard/CustomRoles). This
 * shell keeps the route: it renders the Enterprise page when the project may
 * use the feature and this build includes it, and the upsell card otherwise.
 * Where custom roles cannot be changed, the project's roles - and Delete -
 * are on Teams > Settings > Roles.
 */
const TeamRoleView: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <EnterprisePluginPage
      plugin={getDashboardPlugins().TeamRoleView}
      pluginProps={props}
      requiredPlan={CUSTOM_ROLES_REQUIRED_PLAN}
      upsell={CUSTOM_ROLES_UPSELL}
    />
  );
};

export default TeamRoleView;
