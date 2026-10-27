import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What a project still has of custom roles where they cannot be created or
 * changed: on the Community Edition, and on OneUptime Cloud below the plan
 * that sells them (CustomRoleLeftovers).
 *
 * A custom role keeps giving the teams and API keys that have it its
 * permissions there: each holds a copy of them as its own permission rows
 * (CustomRoleSync), which every edition reads. So the roles are listed,
 * with the move every edition allows - removing them, which takes their
 * permissions away at once.
 *
 * A team's and an API key's cards sit in their page's More settings,
 * which names them Custom Roles while folded, so that is their title too -
 * the Enterprise card's: the name a reader sees folded is the card they
 * find open. The project's card, on the Roles page, keeps its own.
 *
 * Kept free of React so the components and the tests read these exact
 * strings. Every sentence is wrapped in translationKey() so npm run
 * i18n:extract finds it.
 */

export const CustomRoleLeftoverCopy: {
  projectTitle: string;
  projectEditionDescription: string;
  projectPlanDescription: string;
  teamTitle: string;
  teamEditionDescription: string;
  teamPlanDescription: string;
  apiKeyTitle: string;
  apiKeyEditionDescription: string;
  apiKeyPlanDescription: string;
} = {
  projectTitle: translationKey("Custom roles still in force"),
  projectEditionDescription: translationKey(
    "These roles keep giving the teams that have them their permissions. Creating and changing custom roles needs the Enterprise Edition. You can still delete them, which takes their permissions from those teams at once.",
  ),
  projectPlanDescription: translationKey(
    "These roles keep giving the teams that have them their permissions. Creating and changing custom roles needs the {{planName}} plan. You can still delete them, which takes their permissions from those teams at once.",
  ),
  teamTitle: translationKey("Custom Roles"),
  teamEditionDescription: translationKey(
    "This team keeps the permissions of these roles. Giving custom roles to teams needs the Enterprise Edition. You can still remove them from this team.",
  ),
  teamPlanDescription: translationKey(
    "This team keeps the permissions of these roles. Giving custom roles to teams needs the {{planName}} plan. You can still remove them from this team.",
  ),
  apiKeyTitle: translationKey("Custom Roles"),
  apiKeyEditionDescription: translationKey(
    "This API key keeps the permissions of these roles. Giving custom roles to API keys needs the Enterprise Edition. You can still remove them from this key.",
  ),
  apiKeyPlanDescription: translationKey(
    "This API key keeps the permissions of these roles. Giving custom roles to API keys needs the {{planName}} plan. You can still remove them from this key.",
  ),
};

export const PROJECT_CUSTOM_ROLES_LEFTOVER_TEST_ID: string =
  "custom-roles-leftover";

export const TEAM_CUSTOM_ROLES_LEFTOVER_TEST_ID: string =
  "team-custom-roles-leftover";

export const API_KEY_CUSTOM_ROLES_LEFTOVER_TEST_ID: string =
  "api-key-custom-roles-leftover";

export default CustomRoleLeftoverCopy;
