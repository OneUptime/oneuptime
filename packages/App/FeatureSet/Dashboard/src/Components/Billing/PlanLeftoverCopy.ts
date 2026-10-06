import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Configuration a lower plan cannot use can still be seen, switched off and
 * removed (Common/Types/Billing/PlanGatedTable).
 *
 * A project that drops below a feature's plan - a trial ends, a downgrade -
 * keeps what it set up, and much of it keeps working: SSO providers sign
 * people in, SCIM connections provision them, Slack and Microsoft Teams
 * rules post, summaries go out, API keys authenticate, schedules page
 * people. Below the plan, the page that sells the feature shows what the
 * project still has (PlanLeftoverTable), with the moves the server allows
 * on every plan: Turn off, for records that have a switch, and Delete.
 * Adding, changing and switching back on need the plan.
 *
 * Kept free of React so the components and the tests read these exact
 * strings. Every sentence is wrapped in translationKey() so npm run
 * i18n:extract finds it.
 */

export const PlanLeftoverCopy: {
  // A table's description, for records with a switch and without one.
  descriptionWithSwitch: string;
  descriptionWithoutSwitch: string;
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

// Test ids.
export const PLAN_LEFTOVER_TABLE_TEST_ID_PREFIX: string = "plan-leftover";
export const PLAN_LEFTOVER_NOTE_TEST_ID: string = "plan-leftover-note";

export const getPlanLeftoverTableTestId: (id: string) => string = (
  id: string,
): string => {
  return `${PLAN_LEFTOVER_TABLE_TEST_ID_PREFIX}-${id}`;
};

export default PlanLeftoverCopy;
