import {
  drawNoCustomRolesUpsell,
  TeamCustomRolesLeftover,
} from "../CustomRole/CustomRoleLeftovers";
import { EnterpriseSettingLeftoverReason } from "../EnterpriseEdition/EnterpriseSettingLeftoverCopy";
import { CUSTOM_ROLES_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { TeamCustomRolesProps } from "../../Enterprise/EnterprisePlugins";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The custom roles card on a team's Permissions page, in its More settings
 * beside Block Permissions (Pages/Teams/View/Permissions): an advanced
 * feature most projects never use, so it waits folded, its folded header
 * saying how many roles the team has (onRolesChange).
 *
 * Custom roles are an Enterprise feature (ee/Dashboard/CustomRoles): where
 * the project may use them and this build includes them, the Enterprise
 * card. Elsewhere there is no upsell here - the Roles page has it - but a
 * team that still has custom roles keeps their permissions, so they are
 * listed, with Remove (TeamCustomRolesLeftover): on the Community Edition,
 * and for a OneUptime Cloud project known to be below the plan. A project
 * whose plan is still loading draws nothing yet.
 *
 * Drawn through the Enterprise door every shell uses (EnterprisePluginPage),
 * so whatever it draws is one whole card, a section of More settings.
 */

export type ComponentProps = TeamCustomRolesProps;

const TeamCustomRolesSettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <EnterprisePluginPage<TeamCustomRolesProps>
      plugin={getDashboardPlugins().TeamCustomRoles}
      pluginProps={{
        teamId: props.teamId,
        onRolesChange: props.onRolesChange,
      }}
      requiredPlan={CUSTOM_ROLES_REQUIRED_PLAN}
      renderUpsell={drawNoCustomRolesUpsell}
      belowPlan={
        <TeamCustomRolesLeftover
          teamId={props.teamId}
          reason={EnterpriseSettingLeftoverReason.Plan}
          onRolesChange={props.onRolesChange}
        />
      }
      communityLeftover={
        <TeamCustomRolesLeftover
          teamId={props.teamId}
          reason={EnterpriseSettingLeftoverReason.Edition}
          onRolesChange={props.onRolesChange}
        />
      }
    />
  );
};

export default TeamCustomRolesSettings;
