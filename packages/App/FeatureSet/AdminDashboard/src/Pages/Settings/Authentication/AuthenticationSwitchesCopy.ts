import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";

/*
 * What Settings > Authentication's switches are called, kept free of React
 * so App/Tests can read them (see Index.tsx for the switches themselves).
 *
 * The Sign Up, Sign-In Links, Project Creation and Invite Suggestions cards
 * read the page's own locale keys, pages.settings.authentication.*. Require
 * SSO to Sign In lives on Settings > Single Sign-On now, beside the
 * providers it depends on (../SSO/SsoSettingsCopy).
 */

// The switches' data-testids.
export const SIGN_UP_SWITCH_TEST_ID: string = "admin-sign-up-switch";
export const PROJECT_CREATION_SWITCH_TEST_ID: string =
  "admin-project-creation-switch";
export const MAGIC_LINK_SWITCH_TEST_ID: string = "admin-magic-link-switch";
// The line under Sign Up while the server requires SSO.
export const SIGN_UP_SSO_REQUIRED_TEST_ID: string =
  "admin-sign-up-sso-required";
// The line under Sign-In Links while the server requires SSO.
export const MAGIC_LINK_SSO_REQUIRED_TEST_ID: string =
  "admin-magic-link-sso-required";
export const INVITE_SUGGESTIONS_SWITCH_TEST_ID: string =
  "admin-invite-suggestions-switch";

/*
 * Asked before Suggest Every Account When Inviting is turned on (#9744,
 * GlobalConfig.suggestServerAccountsWhenInviting): what it shows, and to
 * whom, is the whole of the decision, so it is said once more, with who it
 * suits. Turning it off asks nothing.
 */
export const TURN_ON_INVITE_SUGGESTIONS_CONFIRMATION: ModelSwitchConfirmation =
  {
    title: "Suggest every account on this server?",
    description:
      "Anyone who may invite people sees every account's name and email as they type. Turn this on only if every account here belongs to one organization.",
    submitButtonText: "Suggest Every Account",
  };

// The confirmation for a move of the switch: only when it turns on.
export const getInviteSuggestionsSwitchConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  return isTurningOn ? TURN_ON_INVITE_SUGGESTIONS_CONFIRMATION : undefined;
};
