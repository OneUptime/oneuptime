import {
  ApiKeyCustomRolesLeftover,
  drawNoCustomRolesUpsell,
} from "../CustomRole/CustomRoleLeftovers";
import { EnterpriseSettingLeftoverReason } from "../EnterpriseEdition/EnterpriseSettingLeftoverCopy";
import { CUSTOM_ROLES_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { ApiKeyCustomRolesProps } from "../../Enterprise/EnterprisePlugins";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The custom roles card on an API key's page, in its More settings beside
 * Block Permissions - as TeamCustomRolesSettings is on a team's Permissions
 * page: an advanced feature most projects never use, so it waits folded,
 * its folded header saying how many roles the key has (onRolesChange).
 *
 * Custom roles are an Enterprise feature (ee/Dashboard/CustomRoles): where
 * the project may use them and this build includes them, the Enterprise
 * card. Elsewhere there is no upsell here - the Roles page has it - but a
 * key that still has custom roles keeps their permissions, so they are
 * listed, with Remove (ApiKeyCustomRolesLeftover): on the Community
 * Edition, and for a OneUptime Cloud project known to be below the plan. A
 * project whose plan is still loading draws nothing yet.
 *
 * Drawn through the Enterprise door every shell uses (EnterprisePluginPage),
 * so whatever it draws is one whole card, a section of More settings.
 */

export type ComponentProps = ApiKeyCustomRolesProps;

const ApiKeyCustomRolesSettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <EnterprisePluginPage<ApiKeyCustomRolesProps>
      plugin={getDashboardPlugins().ApiKeyCustomRoles}
      pluginProps={{
        apiKeyId: props.apiKeyId,
        onRolesChange: props.onRolesChange,
      }}
      requiredPlan={CUSTOM_ROLES_REQUIRED_PLAN}
      renderUpsell={drawNoCustomRolesUpsell}
      belowPlan={
        <ApiKeyCustomRolesLeftover
          apiKeyId={props.apiKeyId}
          reason={EnterpriseSettingLeftoverReason.Plan}
          onRolesChange={props.onRolesChange}
        />
      }
      communityLeftover={
        <ApiKeyCustomRolesLeftover
          apiKeyId={props.apiKeyId}
          reason={EnterpriseSettingLeftoverReason.Edition}
          onRolesChange={props.onRolesChange}
        />
      }
    />
  );
};

export default ApiKeyCustomRolesSettings;
