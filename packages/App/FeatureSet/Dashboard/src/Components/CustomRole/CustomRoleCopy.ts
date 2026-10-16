import {
  composedValue,
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * HOW A CUSTOM ROLE READS, wherever a team's access is shown: "Incident
 * Responder - 6 permissions" on the Roles page, a team's Custom Roles card,
 * the pickers that give a role, Create Team's Access cards; and who a change
 * reaches - "Given to 3 teams (12 people)" - on the role's page and in its
 * Delete dialog.
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

// Who a role reaches: the teams given it and the people in them.
export interface CustomRoleReach {
  teamCount: number;
  /*
   * The people on those teams who have accepted their invitation, each once.
   * Null when the reader may not read the teams' members: the sentences then
   * name the teams only.
   */
  memberCount: number | null;
}

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
  },
) => string = (
  translator: Translator,
  data: {
    description?: string | undefined;
    permissionCount?: number | undefined;
    saysItIsCustom?: boolean | undefined;
  },
): string => {
  const permissions: string = getPermissionCountText(
    translator,
    data.permissionCount,
  );
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
 * What a change to a role reaches, said on the role's page above its
 * permissions: who has it now, and that a change is theirs at once.
 */
export const getRoleReachSentence: (
  translator: Translator,
  reach: CustomRoleReach,
) => string = (translator: Translator, reach: CustomRoleReach): string => {
  if (reach.teamCount <= 0) {
    return text(translator, ROLE_GIVEN_TO_NO_TEAM);
  }

  return translator.translateTemplate(
    "Given to {{reach}}. A change here changes what they can do at once.",
    {
      reach: composedValue((sentence: Translator): string => {
        return getTeamsAndPeople(sentence, reach);
      }),
    },
  );
};

/*
 * Who deleting a role takes access from, said in its Delete dialog after
 * what deleting any custom role does (DeleteConsequences): "Right now that
 * is 2 teams (4 people)."
 */
export const getRoleDeleteReachSentence: (
  translator: Translator,
  reach: CustomRoleReach,
) => string = (translator: Translator, reach: CustomRoleReach): string => {
  if (reach.teamCount <= 0) {
    return text(translator, ROLE_DELETE_REACHES_NO_ONE);
  }

  return translator.translateTemplate("Right now that is {{reach}}.", {
    reach: composedValue((sentence: Translator): string => {
      return getTeamsAndPeople(sentence, reach);
    }),
  });
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
