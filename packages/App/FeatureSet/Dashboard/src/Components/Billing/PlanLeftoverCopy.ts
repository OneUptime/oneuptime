import {
  isPlanCutoffCredentialTable,
  PlanCutoffCredential,
} from "Common/Types/Billing/PlanCutoffCredentials";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Configuration a lower plan cannot use can still be seen, switched off and
 * removed (Common/Types/Billing/PlanGatedTable).
 *
 * A project that drops below a feature's plan - a trial ends, a downgrade -
 * keeps what it set up, and much of it keeps working: SSO providers sign
 * people in, Slack and Microsoft Teams rules post, summaries go out,
 * schedules page people. API keys and SCIM connections are kept too, but
 * API keys stop working and SCIM connections only remove people until the
 * project is back on the plan (Common/Types/Billing/PlanCutoffCredentials),
 * and their tables say so. Below the plan, the page
 * that sells the feature shows what the project still has
 * (PlanLeftoverTable), with the moves the server allows on every plan: Turn
 * off, for records that have a switch, and Delete. Adding, changing and
 * switching back on need the plan.
 *
 * Kept free of React so the components and the tests read these exact
 * strings. Every sentence is wrapped in translationKey() so npm run
 * i18n:extract finds it.
 */

export const PlanLeftoverCopy: {
  // A table's description, for records with a switch and without one.
  descriptionWithSwitch: string;
  descriptionWithoutSwitch: string;
  // For API keys, which stop below their plan, and SCIM connections, which only remove people.
  descriptionStopped: string;
  descriptionScimStopped: string;
  // An API key's own page, below the plan.
  apiKeyStoppedTitle: string;
  apiKeyStoppedDescription: string;
  enabledColumn: string;
  turnOffButton: string;
  confirmTurnOffTitle: string;
  confirmTurnOffDescription: string;
  noItems: string;
  // The note a page sold on the Growth plan shows below it.
  noteTitle: string;
  noteDescription: string;
  upgradeLink: string;
} = {
  descriptionWithSwitch: translationKey(
    "Your plan does not include these any more. The ones that are on still work: you can turn them off or delete them. Turning them on again or adding new ones needs the {{planName}} plan.",
  ),
  descriptionWithoutSwitch: translationKey(
    "Your plan does not include these any more, but they still work. You can delete them. Changing them or adding new ones needs the {{planName}} plan.",
  ),
  descriptionStopped: translationKey(
    "These stopped working: your plan does not include them. Upgrading to the {{planName}} plan turns them back on as they are. You can still delete them.",
  ),
  descriptionScimStopped: translationKey(
    "Your plan does not include these, so they only remove people: your identity provider can still deactivate and remove people here, but can no longer add or change them. Upgrading to the {{planName}} plan turns them fully back on as they are. You can still delete them.",
  ),
  apiKeyStoppedTitle: translationKey("This API key stopped working"),
  apiKeyStoppedDescription: translationKey(
    "Your plan does not include API keys, so every request made with this key is refused. Upgrading to the {{planName}} plan turns it back on as it is. You can still delete it.",
  ),
  enabledColumn: translationKey("Enabled"),
  turnOffButton: translationKey("Turn off"),
  confirmTurnOffTitle: translationKey("Turn this off?"),
  confirmTurnOffDescription: translationKey(
    "It stops working right away. Turning it on again needs the {{planName}} plan.",
  ),
  noItems: translationKey("Nothing is left here."),
  noteTitle: translationKey("Available on the {{planName}} plan"),
  noteDescription: translationKey(
    "This project's plan does not include this, so nothing new can be added here.",
  ),
  upgradeLink: translationKey("Upgrade your plan in Billing settings"),
};

// The title of each kind of table, above what a project still has.
export const PlanLeftoverTitle: {
  samlProviders: string;
  oidcProviders: string;
  scimConnections: string;
  apiKeys: string;
  onCallSchedules: string;
  notificationRules: string;
  summaries: string;
} = {
  samlProviders: translationKey("SAML providers still set up"),
  oidcProviders: translationKey("OIDC providers still set up"),
  scimConnections: translationKey("SCIM connections still set up"),
  apiKeys: translationKey("API keys still set up"),
  onCallSchedules: translationKey("On-call schedules still set up"),
  notificationRules: translationKey("Notification rules still set up"),
  summaries: translationKey("Summaries still set up"),
};

/*
 * A table's description: for API keys, that they stopped, and for SCIM
 * connections, that they only remove people - an upgrade turns both fully
 * back on; for the rest, that what is on still works, as it does.
 */
export const getPlanLeftoverDescription: (data: {
  tableName: string | null | undefined;
  hasSwitch: boolean;
}) => string = (data: {
  tableName: string | null | undefined;
  hasSwitch: boolean;
}): string => {
  if (isPlanCutoffCredentialTable(data.tableName)) {
    return data.tableName === PlanCutoffCredential.ApiKey
      ? PlanLeftoverCopy.descriptionStopped
      : PlanLeftoverCopy.descriptionScimStopped;
  }

  return data.hasSwitch
    ? PlanLeftoverCopy.descriptionWithSwitch
    : PlanLeftoverCopy.descriptionWithoutSwitch;
};

// Test ids.
export const PLAN_LEFTOVER_TABLE_TEST_ID_PREFIX: string = "plan-leftover";
export const PLAN_LEFTOVER_NOTE_TEST_ID: string = "plan-leftover-note";
export const API_KEY_STOPPED_NOTE_TEST_ID: string = "api-key-stopped-note";

export const getPlanLeftoverTableTestId: (id: string) => string = (
  id: string,
): string => {
  return `${PLAN_LEFTOVER_TABLE_TEST_ID_PREFIX}-${id}`;
};

export default PlanLeftoverCopy;
