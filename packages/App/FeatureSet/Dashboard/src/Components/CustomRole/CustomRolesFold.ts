import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * CUSTOM ROLES, IN MORE SETTINGS.
 *
 * "Move custom roles to More settings because it is an advanced feature."
 * - the maintainer. A team's Permissions page and an API key's page used to
 * open on a Custom Roles card, above what the team or key can do itself,
 * once the project had one custom role - an Enterprise feature most
 * projects never use, first on a page people open to give access. Now each
 * page opens on its Permissions card, and Custom Roles waits in the page's
 * More settings, beside Block Permissions:
 *
 *   - folded, the header names it ("Custom Roles"), and says how many roles
 *     the team or key has ("Custom Roles: 2"), so a role in force is never
 *     hidden;
 *   - it is named only while the card is drawn: a project with no custom
 *     role, and Owners and Admin, whose permissions can't change, see the
 *     page as before - More settings holding Block Permissions alone;
 *   - a link to the card (#custom-roles) opens More settings there - the
 *     card's place is its title's, in either edition: the Enterprise card
 *     is titled Custom Roles, and the card the Community Edition draws for
 *     the roles a team or key still has is given that place;
 *   - the Permissions card, empty, does not say the team can do nothing
 *     when a custom role gives it something: it says where that is.
 *
 * React-free, so the pages, the Enterprise cards and the tests read the
 * same names and words.
 */

/*
 * What a custom roles card holds, told to the page it is drawn on (the
 * plugin contract, Enterprise/EnterprisePlugins, hands it on): whether it
 * is drawn, and how many roles the team or key has.
 */
export interface CustomRolesCardState {
  /*
   * Drawn: the project has a custom role the card can offer (the
   * Enterprise card), or the team or key still has one where roles can't
   * be given any more (the card the Community Edition draws for them).
   */
  isShown: boolean;
  // How many custom roles the team or key has, as last read.
  count: number;
}

// Told each time the card learns what it holds.
export type CustomRolesCardStateHandler = (state: CustomRolesCardState) => void;

// The card's place on the page, and its folded name's key: its title's place.
export const CUSTOM_ROLES_CARD_PLACE: string = "custom-roles";

// The card's title, as both editions draw it in More settings.
export const CUSTOM_ROLES_CARD_TITLE: string = translationKey("Custom Roles");

/*
 * Custom Roles as a folded More settings header names it: null while the
 * card is not drawn (or not known to be), so the header names only what
 * the section holds.
 */
export const getCustomRolesFoldedItem: (
  state: CustomRolesCardState | null,
) => FoldedSectionItem | null = (
  state: CustomRolesCardState | null,
): FoldedSectionItem | null => {
  if (!state || !state.isShown) {
    return null;
  }

  return foldedSectionItem(CUSTOM_ROLES_CARD_TITLE, {
    key: CUSTOM_ROLES_CARD_PLACE,
    isSet: state.count > 0,
    value: state.count > 0 ? String(state.count) : undefined,
  });
};

// How many custom roles a card last said its team or key has: 0 for none, or none known.
export const getCustomRoleCount: (
  state: CustomRolesCardState | null,
) => number = (state: CustomRolesCardState | null): number => {
  return state && state.isShown ? state.count : 0;
};

/*
 * What a page's More settings holds, under its title once open: Block
 * Permissions alone, as it always was, or Custom Roles too while that card
 * is drawn - said in a few words, as each card below explains itself.
 */
export const TEAM_MORE_SETTINGS_BLOCK_DESCRIPTION: string = translationKey(
  "Block permissions: what this team can never do, even when one of its roles or permissions allows it.",
);

export const TEAM_MORE_SETTINGS_ROLES_DESCRIPTION: string = translationKey(
  "The custom roles this team is given, and what it can never do.",
);

export const API_KEY_MORE_SETTINGS_BLOCK_DESCRIPTION: string = translationKey(
  "Block permissions: what this key can never do, even when one of its roles or permissions allows it.",
);

export const API_KEY_MORE_SETTINGS_ROLES_DESCRIPTION: string = translationKey(
  "The custom roles this key is given, and what it can never do.",
);

export const getTeamMoreSettingsDescription: (
  state: CustomRolesCardState | null,
) => string = (state: CustomRolesCardState | null): string => {
  return getCustomRolesFoldedItem(state)
    ? TEAM_MORE_SETTINGS_ROLES_DESCRIPTION
    : TEAM_MORE_SETTINGS_BLOCK_DESCRIPTION;
};

export const getApiKeyMoreSettingsDescription: (
  state: CustomRolesCardState | null,
) => string = (state: CustomRolesCardState | null): string => {
  return getCustomRolesFoldedItem(state)
    ? API_KEY_MORE_SETTINGS_ROLES_DESCRIPTION
    : API_KEY_MORE_SETTINGS_BLOCK_DESCRIPTION;
};

/*
 * The Permissions card with no row of its own. It used to say the team or
 * key could do nothing - wrong, now that the custom roles that give it
 * something are folded away: with a role, it says where its access is.
 */
export const TEAM_PERMISSIONS_EMPTY: string = translationKey(
  "This team can do nothing yet. Add a role to give it access.",
);

export const TEAM_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES: string = translationKey(
  "This team has no permissions of its own yet. Its members get what its custom roles allow, under More settings.",
);

export const API_KEY_PERMISSIONS_EMPTY: string = translationKey(
  "This key can do nothing yet. Add a role to give it access.",
);

export const API_KEY_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES: string =
  translationKey(
    "This key has no permissions of its own yet. It gets what its custom roles allow, under More settings.",
  );

export const getTeamPermissionsEmptyMessage: (
  customRoleCount: number,
) => string = (customRoleCount: number): string => {
  return customRoleCount > 0
    ? TEAM_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES
    : TEAM_PERMISSIONS_EMPTY;
};

export const getApiKeyPermissionsEmptyMessage: (
  customRoleCount: number,
) => string = (customRoleCount: number): string => {
  return customRoleCount > 0
    ? API_KEY_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES
    : API_KEY_PERMISSIONS_EMPTY;
};
