import { PERMISSION_SCOPE_TITLES } from "../Permission/PermissionScopeChoice";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import {
  composedValue,
  PluralTemplate,
  TemplateValues,
  TranslatableTerm,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * HOW A CUSTOM ROLE READS, wherever a team's or an API key's access is
 * shown: "Incident Responder - 6 permissions" on the Roles page, a team's
 * and a key's Custom Roles card, the pickers that give a role, Create Team's
 * and Create API Key's Access cards; and who a change reaches - "Given to 3
 * teams (12 people) and 2 API keys" - on the role's page and in its Delete
 * dialog.
 *
 * Every sentence is looked up whole, in the reader's language, and counts go
 * through plural templates (Locales/README.md): no sentence is glued from
 * pieces. React-free, so tests read it without rendering a page.
 */

export const PERMISSION_COUNT_TEMPLATE: PluralTemplate = {
  one: "{{count}} permission",
  other: "{{count}} permissions",
};

export const NO_PERMISSIONS_YET: string = translationKey("No permissions yet");

export const ROLE_GIVEN_TO_NO_TEAM: string = translationKey(
  "No team has this role yet. Give it to a team below, or from a team's Permissions page.",
);

export const ROLE_DELETE_REACHES_NO_ONE: string = translationKey(
  "No team has this role right now, so no one loses access.",
);

// The same two, where API keys are counted too.
export const ROLE_GIVEN_TO_NOTHING: string = translationKey(
  "No team or API key has this role yet. Give it to one below.",
);

export const ROLE_DELETE_REACHES_NOTHING: string = translationKey(
  "No team or API key has this role right now, so nothing loses access.",
);

// A fixed sentence in the reader's language.
const text: (translator: Translator, sentence: string) => string = (
  translator: Translator,
  sentence: string,
): string => {
  return translator.translateText(sentence) || sentence;
};

export const TEAM_COUNT_TEMPLATE: PluralTemplate = {
  one: "{{count}} team",
  other: "{{count}} teams",
};

export const PEOPLE_COUNT_TEMPLATE: PluralTemplate = {
  one: "{{count}} person",
  other: "{{count}} people",
};

export const API_KEY_COUNT_TEMPLATE: PluralTemplate = {
  one: "{{count}} API key",
  other: "{{count}} API keys",
};

/*
 * Who a role reaches: the teams given it and the people in them, and the
 * API keys given it.
 */
export interface CustomRoleReach {
  teamCount: number;
  /*
   * The people on those teams who have accepted their invitation, each once.
   * Null when the reader may not read the teams' members: the sentences then
   * name the teams only.
   */
  memberCount: number | null;
  /*
   * The API keys given the role. Null (or left out) when the reader may not
   * read the project's API keys: the sentences then name the teams only, as
   * they did before keys took roles.
   */
  apiKeyCount?: number | null | undefined;
}

// How many API keys a reach names: none when they are not known.
const apiKeysOf: (reach: CustomRoleReach) => number = (
  reach: CustomRoleReach,
): number => {
  return reach.apiKeyCount && reach.apiKeyCount > 0 ? reach.apiKeyCount : 0;
};

// Whether the reader may know about the API keys given the role.
const knowsApiKeys: (reach: CustomRoleReach) => boolean = (
  reach: CustomRoleReach,
): boolean => {
  return reach.apiKeyCount !== null && reach.apiKeyCount !== undefined;
};

// Whether anything - a team or an API key - has the role.
export const isRoleGivenToAnyone: (reach: CustomRoleReach) => boolean = (
  reach: CustomRoleReach,
): boolean => {
  return reach.teamCount > 0 || apiKeysOf(reach) > 0;
};

// "6 permissions", or "No permissions yet".
export const getPermissionCountText: (
  translator: Translator,
  count: number | undefined | null,
) => string = (
  translator: Translator,
  count: number | undefined | null,
): string => {
  if (!count || count < 0) {
    return text(translator, NO_PERMISSIONS_YET);
  }

  return translator.translatePlural(PERMISSION_COUNT_TEMPLATE, count);
};

/*
 * What a role's card says under its name: how many permissions it holds,
 * then its own description when it has one - "6 permissions · Declares,
 * works and resolves incidents." Where custom roles sit among built-in
 * ones (Create Team's Access), it says first that it is one.
 */
export const getCustomRoleCardDescription: (
  translator: Translator,
  data: {
    description?: string | undefined;
    permissionCount?: number | undefined;
    saysItIsCustom?: boolean | undefined;
    /*
     * What to say of the role's permissions instead of their count, already
     * in the reader's language: an API key's picker says how many apply to
     * a key (getApiKeyRolePermissionCountText).
     */
    permissionsText?: string | undefined;
  },
) => string = (
  translator: Translator,
  data: {
    description?: string | undefined;
    permissionCount?: number | undefined;
    saysItIsCustom?: boolean | undefined;
    permissionsText?: string | undefined;
  },
): string => {
  const permissions: string =
    data.permissionsText ||
    getPermissionCountText(translator, data.permissionCount);
  const description: string = (data.description || "").trim();

  if (data.saysItIsCustom) {
    return description
      ? translator.translateTemplate(
          "Custom role · {{permissions}} · {{description}}",
          { permissions: permissions, description: description },
        )
      : translator.translateTemplate("Custom role · {{permissions}}", {
          permissions: permissions,
        });
  }

  return description
    ? translator.translateTemplate("{{permissions}} · {{description}}", {
        permissions: permissions,
        description: description,
      })
    : permissions;
};

// "3 teams (12 people)", or "3 teams" when the people are not known.
const getTeamsAndPeople: (
  translator: Translator,
  reach: CustomRoleReach,
) => string = (translator: Translator, reach: CustomRoleReach): string => {
  const teams: string = translator.translatePlural(
    TEAM_COUNT_TEMPLATE,
    reach.teamCount,
  );

  if (reach.memberCount === null) {
    return teams;
  }

  return translator.translateTemplate("{{teams}} ({{people}})", {
    teams: teams,
    people: translator.translatePlural(
      PEOPLE_COUNT_TEMPLATE,
      reach.memberCount,
    ),
  });
};

/*
 * Everything a role reaches: "3 teams (12 people) and 2 API keys", "3
 * teams (12 people)" or "2 API keys".
 */
const getReachText: (
  translator: Translator,
  reach: CustomRoleReach,
) => string = (translator: Translator, reach: CustomRoleReach): string => {
  const apiKeys: number = apiKeysOf(reach);

  if (apiKeys <= 0) {
    return getTeamsAndPeople(translator, reach);
  }

  const keys: string = translator.translatePlural(
    API_KEY_COUNT_TEMPLATE,
    apiKeys,
  );

  if (reach.teamCount <= 0) {
    return keys;
  }

  return translator.translateTemplate("{{teams}} and {{apiKeys}}", {
    teams: composedValue((sentence: Translator): string => {
      return getTeamsAndPeople(sentence, reach);
    }),
    apiKeys: composedValue((sentence: Translator): string => {
      return sentence.translatePlural(API_KEY_COUNT_TEMPLATE, apiKeys);
    }),
  });
};

/*
 * What a change to a role reaches, said on the role's page above its
 * permissions: who has it now, and that a change is theirs at once.
 */
export const getRoleReachSentence: (
  translator: Translator,
  reach: CustomRoleReach,
) => string = (translator: Translator, reach: CustomRoleReach): string => {
  if (!isRoleGivenToAnyone(reach)) {
    return text(
      translator,
      knowsApiKeys(reach) ? ROLE_GIVEN_TO_NOTHING : ROLE_GIVEN_TO_NO_TEAM,
    );
  }

  return translator.translateTemplate(
    "Given to {{reach}}. A change here changes what they can do at once.",
    {
      reach: composedValue((sentence: Translator): string => {
        return getReachText(sentence, reach);
      }),
    },
  );
};

/*
 * Who deleting a role takes access from, said in its Delete dialog after
 * what deleting any custom role does (DeleteConsequences): "It is given to
 * 2 teams (4 people) right now."
 */
export const getRoleDeleteReachSentence: (
  translator: Translator,
  reach: CustomRoleReach,
) => string = (translator: Translator, reach: CustomRoleReach): string => {
  if (!isRoleGivenToAnyone(reach)) {
    return text(
      translator,
      knowsApiKeys(reach)
        ? ROLE_DELETE_REACHES_NOTHING
        : ROLE_DELETE_REACHES_NO_ONE,
    );
  }

  return translator.translateTemplate("It is given to {{reach}} right now.", {
    reach: composedValue((sentence: Translator): string => {
      return getReachText(sentence, reach);
    }),
  });
};

/*
 * How many of a role's permissions an API key given it holds, said under
 * the role's name on the key's Custom Roles card: "6 permissions", or - when
 * some are limited to what someone owns, which gives a key nothing - "4 of
 * its 6 permissions apply to this key", or "None of its permissions apply
 * to this key".
 */
export const APPLIED_PERMISSION_COUNT_TEMPLATE: PluralTemplate = {
  one: "{{applied}} of its {{count}} permission applies to this key",
  other: "{{applied}} of its {{count}} permissions apply to this key",
};

export const NO_PERMISSION_APPLIES_TO_KEY: string = translationKey(
  "None of its permissions apply to this key",
);

export const getApiKeyRolePermissionCountText: (
  translator: Translator,
  data: {
    // Every permission of the role.
    permissionCount: number | undefined | null;
    // Those limited to what someone owns: none of them reach a key.
    ownedCount: number;
  },
) => string = (
  translator: Translator,
  data: {
    permissionCount: number | undefined | null;
    ownedCount: number;
  },
): string => {
  const count: number = Math.max(0, data.permissionCount || 0);
  const owned: number = Math.min(count, Math.max(0, data.ownedCount));

  if (owned <= 0) {
    return getPermissionCountText(translator, count);
  }

  if (owned >= count) {
    return text(translator, NO_PERMISSION_APPLIES_TO_KEY);
  }

  return translator.translatePlural(APPLIED_PERMISSION_COUNT_TEMPLATE, count, {
    applied: translator.formatNumber(count - owned),
  });
};

/*
 * WHY A KEY HOLDS LESS THAN ITS ROLE, wherever that is counted: a
 * permission scoped to what someone owns reaches nothing for a key, which
 * owns nothing. Said with the scope's own title, as a role's Scope column
 * shows it ("Only resources they own"), so the reader can find those
 * permissions on the role's page - "limited to resources someone owns"
 * named nothing they could see there.
 */
export const API_KEY_OWNED_SCOPE_REASON: string = translationKey(
  "Permissions scoped to “{{scope}}” don't apply to an API key: a key owns nothing.",
);

// The Owned scope's title, put into a sentence in that sentence's language.
const ownedScopeTitle: () => TranslatableTerm = (): TranslatableTerm => {
  return translatableTerm(PERMISSION_SCOPE_TITLES[PermissionScope.Owned]);
};

export const getApiKeyOwnedScopeReason: (translator: Translator) => string = (
  translator: Translator,
): string => {
  return translator.translateTemplate(API_KEY_OWNED_SCOPE_REASON, {
    scope: ownedScopeTitle(),
  });
};

/*
 * How much of a role an API key given it holds: all of its permissions but
 * those scoped to what someone owns.
 */
export interface ApiKeyRoleCoverage {
  permissionCount: number;
  // Of them, those scoped to what someone owns: none of them reach a key.
  ownedCount: number;
}

// The role's permissions, and how many of them a key holds.
const readCoverage: (coverage: ApiKeyRoleCoverage | null | undefined) => {
  count: number;
  owned: number;
} = (
  coverage: ApiKeyRoleCoverage | null | undefined,
): { count: number; owned: number } => {
  const count: number = Math.max(0, coverage?.permissionCount || 0);

  return {
    count: count,
    owned: Math.min(count, Math.max(0, coverage?.ownedCount || 0)),
  };
};

/*
 * Whether a key given the role misses some of it. False while the role's
 * permissions are not known: the sentences then say what they always said.
 */
export const doesApiKeyMissPartOfRole: (
  coverage: ApiKeyRoleCoverage | null | undefined,
) => boolean = (coverage: ApiKeyRoleCoverage | null | undefined): boolean => {
  return readCoverage(coverage).owned > 0;
};

/*
 * The Add Custom Role dialog on a key's page: what a role gives the key.
 * The Owned exception is said only when a role offered has such a
 * permission - in most projects none has, and the sentence only lengthened
 * the dialog. {{roles}} is the Roles page's name, drawn as a link to it:
 * the page waits in the Teams menu's folded Settings section, which nothing
 * on a key's page leads to.
 */
export const ADD_ROLE_TO_API_KEY_DESCRIPTION: string = translationKey(
  "The key gets everything the role allows. Make or change roles on the {{roles}} page.",
);

export const ADD_ROLE_TO_API_KEY_DESCRIPTION_OWNED: string = translationKey(
  "The key gets everything the role allows, except permissions scoped to “{{scope}}”: a key owns nothing. Make or change roles on the {{roles}} page.",
);

// The same dialog on a team's Permissions page.
export const ADD_ROLE_TO_TEAM_DESCRIPTION: string = translationKey(
  "The team's members get everything the role allows. Make or change roles on the {{roles}} page.",
);

/*
 * Add Custom Role, locked once the team or the key has every role there
 * is. The card's description just above the button links to the Roles
 * page; a tooltip cannot hold a link, so it says only why.
 */
export const EVERY_ROLE_GIVEN_TO_TEAM_TOOLTIP: string = translationKey(
  "This team has every custom role already.",
);

export const EVERY_ROLE_GIVEN_TO_API_KEY_TOOLTIP: string = translationKey(
  "This key has every custom role already.",
);

// A sentence for TranslatedSentence: its template, and its plain values.
export interface TemplatedSentence {
  template: string;
  values: TemplateValues;
}

export const getAddRoleToApiKeyDescription: (data: {
  isAnyOfferedRolePartlyOwned: boolean;
}) => TemplatedSentence = (data: {
  isAnyOfferedRolePartlyOwned: boolean;
}): TemplatedSentence => {
  if (!data.isAnyOfferedRolePartlyOwned) {
    return { template: ADD_ROLE_TO_API_KEY_DESCRIPTION, values: {} };
  }

  return {
    template: ADD_ROLE_TO_API_KEY_DESCRIPTION_OWNED,
    values: { scope: ownedScopeTitle() },
  };
};

/*
 * A role's API Keys card, under its title: what the keys given the role
 * can do. "Everything this role allows" only when that is so - a role with
 * a permission scoped to what someone owns gives its keys the rest, and
 * the card says how much and why.
 */
export const API_KEYS_GET_EVERYTHING: string = translationKey(
  "These API keys can do everything this role allows.",
);

export const API_KEYS_GET_PART_TEMPLATE: PluralTemplate = {
  one: "These API keys get {{applied}} of this role's {{count}} permission: those scoped to “{{scope}}” don't apply to a key.",
  other:
    "These API keys get {{applied}} of this role's {{count}} permissions: those scoped to “{{scope}}” don't apply to a key.",
};

export const API_KEYS_GET_NOTHING: string = translationKey(
  "None of this role's permissions apply to these API keys: each is scoped to “{{scope}}”.",
);

export const getRoleApiKeysCardDescription: (
  translator: Translator,
  coverage: ApiKeyRoleCoverage | null | undefined,
) => string = (
  translator: Translator,
  coverage: ApiKeyRoleCoverage | null | undefined,
): string => {
  const { count, owned } = readCoverage(coverage);

  if (owned <= 0) {
    return text(translator, API_KEYS_GET_EVERYTHING);
  }

  if (owned >= count) {
    return translator.translateTemplate(API_KEYS_GET_NOTHING, {
      scope: ownedScopeTitle(),
    });
  }

  return translator.translatePlural(API_KEYS_GET_PART_TEMPLATE, count, {
    applied: translator.formatNumber(count - owned),
    scope: ownedScopeTitle(),
  });
};

/*
 * The Give to an API Key dialog on a role's page: what the key gets from
 * now on - with the Owned exception only for a role that has such a
 * permission.
 */
export const GIVE_ROLE_TO_API_KEY_DESCRIPTION: string = translationKey(
  "From now on the key can do everything this role allows.",
);

export const GIVE_ROLE_TO_API_KEY_DESCRIPTION_OWNED: string = translationKey(
  "From now on the key can do everything this role allows, except permissions scoped to “{{scope}}”: a key owns nothing.",
);

export const getGiveRoleToApiKeyDescription: (
  translator: Translator,
  coverage: ApiKeyRoleCoverage | null | undefined,
) => string = (
  translator: Translator,
  coverage: ApiKeyRoleCoverage | null | undefined,
): string => {
  if (!doesApiKeyMissPartOfRole(coverage)) {
    return text(translator, GIVE_ROLE_TO_API_KEY_DESCRIPTION);
  }

  return translator.translateTemplate(GIVE_ROLE_TO_API_KEY_DESCRIPTION_OWNED, {
    scope: ownedScopeTitle(),
  });
};

/*
 * Why Give to an API Key is off: the project has no key yet, or every key
 * has the role already. The empty card says the first too, with a link to
 * the API Keys page - a tooltip can't be read on a phone.
 */
export const NO_API_KEY_IN_PROJECT_TOOLTIP: string = translationKey(
  "This project has no API key yet. Create one on the API Keys page.",
);

export const EVERY_API_KEY_HAS_ROLE_TOOLTIP: string = translationKey(
  "Every API key has this role already.",
);

export const NO_API_KEY_IN_PROJECT_TITLE: string = translationKey(
  "This project has no API key yet",
);

export const NO_API_KEY_IN_PROJECT_DESCRIPTION: string = translationKey(
  "Create one on the {{apiKeys}} page, then give it this role here.",
);

// What taking a role from an API key does, said in the Remove dialog.
export const getRoleRemoveFromApiKeySentence: (
  translator: Translator,
  data: { roleName: string; apiKeyName: string },
) => string = (
  translator: Translator,
  data: { roleName: string; apiKeyName: string },
): string => {
  return translator.translateTemplate(
    "{{apiKey}} loses the permissions of {{role}}. Its other roles and permissions stay.",
    {
      apiKey: data.apiKeyName,
      role: data.roleName,
    },
  );
};

// What taking a role from a team does, said in the Remove dialog.
export const getRoleRemoveFromTeamSentence: (
  translator: Translator,
  data: { roleName: string; teamName: string },
) => string = (
  translator: Translator,
  data: { roleName: string; teamName: string },
): string => {
  return translator.translateTemplate(
    "{{team}} loses the permissions of {{role}}. Its other roles and permissions stay.",
    {
      team: data.teamName,
      role: data.roleName,
    },
  );
};
