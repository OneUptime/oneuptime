import {
  composedValue,
  PluralTemplate,
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
const getReachText: (translator: Translator, reach: CustomRoleReach) => string =
  (translator: Translator, reach: CustomRoleReach): string => {
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
