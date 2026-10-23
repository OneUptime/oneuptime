import { TeamCustomRolesLeftover } from "../CustomRole/CustomRoleLeftovers";
import { EnterpriseSettingLeftoverReason } from "../EnterpriseEdition/EnterpriseSettingLeftoverCopy";
import {
  CUSTOM_ROLES_REQUIRED_PLAN,
  isEnterpriseFeatureEligible,
  isKnownToBeBelowPlan,
} from "../../Enterprise/EnterpriseEligibility";
import {
  EnterprisePluginComponent,
  TeamCustomRolesProps,
} from "../../Enterprise/EnterprisePlugins";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { BILLING_ENABLED } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement, Suspense } from "react";

/*
 * The custom roles card on a team's Permissions page, above what the team
 * was given directly.
 *
 * Custom roles are an Enterprise feature (ee/Dashboard/CustomRoles): where
 * the project may use them and this build includes them, the Enterprise
 * card. Elsewhere there is no upsell here - the Roles page has it - but a
 * team that still has custom roles keeps their permissions, so they are
 * listed, with Remove (TeamCustomRolesLeftover): on the Community Edition,
 * and for a OneUptime Cloud project known to be below the plan. A project
 * whose plan is still loading draws nothing yet.
 */

export type ComponentProps = TeamCustomRolesProps;

const TeamCustomRolesSettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const Plugin: EnterprisePluginComponent<TeamCustomRolesProps> | undefined =
    getDashboardPlugins().TeamCustomRoles;

  if (Plugin && isEnterpriseFeatureEligible(CUSTOM_ROLES_REQUIRED_PLAN)) {
    return (
      <Suspense fallback={<ComponentLoader />}>
        <Plugin teamId={props.teamId} />
      </Suspense>
    );
  }

  if (BILLING_ENABLED) {
    if (!isKnownToBeBelowPlan(CUSTOM_ROLES_REQUIRED_PLAN)) {
      return <></>;
    }

    return (
      <TeamCustomRolesLeftover
        teamId={props.teamId}
        reason={EnterpriseSettingLeftoverReason.Plan}
      />
    );
  }

  return (
    <TeamCustomRolesLeftover
      teamId={props.teamId}
      reason={EnterpriseSettingLeftoverReason.Edition}
    />
  );
};

export default TeamCustomRolesSettings;
