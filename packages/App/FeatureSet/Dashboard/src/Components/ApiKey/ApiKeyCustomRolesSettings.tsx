import { ApiKeyCustomRolesLeftover } from "../CustomRole/CustomRoleLeftovers";
import { EnterpriseSettingLeftoverReason } from "../EnterpriseEdition/EnterpriseSettingLeftoverCopy";
import {
  CUSTOM_ROLES_REQUIRED_PLAN,
  isEnterpriseFeatureEligible,
  isKnownToBeBelowPlan,
} from "../../Enterprise/EnterpriseEligibility";
import {
  ApiKeyCustomRolesProps,
  EnterprisePluginComponent,
} from "../../Enterprise/EnterprisePlugins";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { BILLING_ENABLED } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement, Suspense } from "react";

/*
 * The custom roles card on an API key's page, above what the key was given
 * directly - as TeamCustomRolesSettings is on a team's Permissions page.
 *
 * Custom roles are an Enterprise feature (ee/Dashboard/CustomRoles): where
 * the project may use them and this build includes them, the Enterprise
 * card. Elsewhere there is no upsell here - the Roles page has it - but a
 * key that still has custom roles keeps their permissions, so they are
 * listed, with Remove (ApiKeyCustomRolesLeftover): on the Community
 * Edition, and for a OneUptime Cloud project known to be below the plan. A
 * project whose plan is still loading draws nothing yet.
 */

export type ComponentProps = ApiKeyCustomRolesProps;

const ApiKeyCustomRolesSettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const Plugin: EnterprisePluginComponent<ApiKeyCustomRolesProps> | undefined =
    getDashboardPlugins().ApiKeyCustomRoles;

  if (Plugin && isEnterpriseFeatureEligible(CUSTOM_ROLES_REQUIRED_PLAN)) {
    return (
      <Suspense fallback={<ComponentLoader />}>
        <Plugin apiKeyId={props.apiKeyId} />
      </Suspense>
    );
  }

  if (BILLING_ENABLED) {
    if (!isKnownToBeBelowPlan(CUSTOM_ROLES_REQUIRED_PLAN)) {
      return <></>;
    }

    return (
      <ApiKeyCustomRolesLeftover
        apiKeyId={props.apiKeyId}
        reason={EnterpriseSettingLeftoverReason.Plan}
      />
    );
  }

  return (
    <ApiKeyCustomRolesLeftover
      apiKeyId={props.apiKeyId}
      reason={EnterpriseSettingLeftoverReason.Edition}
    />
  );
};

export default ApiKeyCustomRolesSettings;
