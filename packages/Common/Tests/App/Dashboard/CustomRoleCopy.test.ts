import { describe, expect, test } from "@jest/globals";
import {
  ADD_ROLE_TO_API_KEY_DESCRIPTION,
  ADD_ROLE_TO_API_KEY_DESCRIPTION_OWNED,
  API_KEY_COUNT_TEMPLATE,
  API_KEY_OWNED_SCOPE_REASON,
  API_KEYS_GET_EVERYTHING,
  API_KEYS_GET_NOTHING,
  API_KEYS_GET_PART_TEMPLATE,
  APPLIED_PERMISSION_COUNT_TEMPLATE,
  doesApiKeyMissPartOfRole,
  EVERY_API_KEY_HAS_ROLE_TOOLTIP,
  getAddRoleToApiKeyDescription,
  getApiKeyOwnedScopeReason,
  getApiKeyRolePermissionCountText,
  getCustomRoleCardDescription,
  getGiveRoleToApiKeyDescription,
  getRoleApiKeysCardDescription,
  GIVE_ROLE_TO_API_KEY_DESCRIPTION,
  GIVE_ROLE_TO_API_KEY_DESCRIPTION_OWNED,
  NO_API_KEY_IN_PROJECT_DESCRIPTION,
  NO_API_KEY_IN_PROJECT_TITLE,
  NO_API_KEY_IN_PROJECT_TOOLTIP,
  getPermissionCountText,
  getRoleDeleteReachSentence,
  getRoleReachSentence,
  getRoleRemoveFromApiKeySentence,
  getRoleRemoveFromTeamSentence,
  isRoleGivenToAnyone,
  NO_PERMISSION_APPLIES_TO_KEY,
  NO_PERMISSIONS_YET,
  PEOPLE_COUNT_TEMPLATE,
  PERMISSION_COUNT_TEMPLATE,
  ROLE_DELETE_REACHES_NO_ONE,
  ROLE_DELETE_REACHES_NOTHING,
  ROLE_GIVEN_TO_NO_TEAM,
  ROLE_GIVEN_TO_NOTHING,
  TEAM_COUNT_TEMPLATE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomRole/CustomRoleCopy";
import { PERMISSION_SCOPE_TITLES } from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/PermissionScopeChoice";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import fs from "fs";
import path from "path";

/*
 * HOW A CUSTOM ROLE READS. The customer asked to name a set of permissions
 * once - "Incident Responder", "Team Lead" - and give it to teams, so the
 * name and how much it holds are what a role says wherever a team's access
 * is shown ("Incident Responder - 6 permissions"), and a change or a delete
 * says first who it reaches ("Given to 2 teams (4 people).").
 *
 * Every sentence is looked up whole in the reader's language: the German
 * below holds them as the locale files do, so a sentence glued from pieces
 * would come out half English.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const GERMAN_WORDS: Record<string, string> = {
  "{{count}} permissions": "{{count}} Berechtigungen",
  "{{count}} permissions_one": "{{count}} Berechtigung",
  "No permissions yet": "Noch keine Berechtigungen",
  "{{count}} teams": "{{count}} Teams",
  "{{count}} teams_one": "{{count}} Team",
  "{{count}} people": "{{count}} Personen",
  "{{count}} people_one": "{{count}} Person",
  "{{teams}} ({{people}})": "{{teams}} ({{people}})",
  "Given to {{reach}}. A change here changes what they can do at once.":
    "Vergeben an {{reach}}. Eine Änderung hier ändert sofort, was sie tun können.",
  "It is given to {{reach}} right now.":
    "Sie ist gerade an {{reach}} vergeben.",
  "Custom role · {{permissions}} · {{description}}":
    "Benutzerdefinierte Rolle · {{permissions}} · {{description}}",
  "{{team}} loses the permissions of {{role}}. Its other roles and permissions stay.":
    "{{team}} verliert die Berechtigungen von {{role}}. Ihre anderen Rollen und Berechtigungen bleiben.",
  "No team has this role right now, so no one loses access.":
    "Kein Team hat diese Rolle gerade, also verliert niemand Zugriff.",
  "{{count}} API keys": "{{count}} API-Schlüssel",
  "{{count}} API keys_one": "{{count}} API-Schlüssel",
  "{{teams}} and {{apiKeys}}": "{{teams}} und {{apiKeys}}",
  "No team or API key has this role right now, so nothing loses access.":
    "Gerade hat kein Team und kein API-Schlüssel diese Rolle, also verliert niemand Zugriff.",
  "{{applied}} of its {{count}} permissions apply to this key":
    "{{applied}} ihrer {{count}} Berechtigungen gelten für diesen Schlüssel",
  "None of its permissions apply to this key":
    "Keine ihrer Berechtigungen gilt für diesen Schlüssel",
  "{{apiKey}} loses the permissions of {{role}}. Its other roles and permissions stay.":
    "{{apiKey}} verliert die Berechtigungen von {{role}}. Seine anderen Rollen und Berechtigungen bleiben.",
  "Only resources they own": "Nur Ressourcen, die ihnen gehören",
  "Permissions scoped to “{{scope}}” don't apply to an API key: a key owns nothing.":
    "Berechtigungen mit dem Geltungsbereich „{{scope}}“ gelten nicht für einen API-Schlüssel: Ein Schlüssel besitzt nichts.",
  "These API keys get {{applied}} of this role's {{count}} permissions: those scoped to “{{scope}}” don't apply to a key.":
    "Diese API-Schlüssel erhalten {{applied}} der {{count}} Berechtigungen dieser Rolle: Die mit dem Geltungsbereich „{{scope}}“ gelten nicht für einen Schlüssel.",
};

const GERMAN: Translator = createTranslator(
  (key: string): string | undefined => {
    return GERMAN_WORDS[key];
  },
  "de",
);

describe("how many permissions a role holds", () => {
  test("is said by plural sentences the locale files hold", () => {
    expect(PERMISSION_COUNT_TEMPLATE).toEqual({
      one: "{{count}} permission",
      other: "{{count}} permissions",
    });
    expect(TEAM_COUNT_TEMPLATE).toEqual({
      one: "{{count}} team",
      other: "{{count}} teams",
    });
    expect(PEOPLE_COUNT_TEMPLATE).toEqual({
      one: "{{count}} person",
      other: "{{count}} people",
    });
  });

  test.each([
    [1, "1 permission"],
    [6, "6 permissions"],
    [40, "40 permissions"],
  ])("%s reads %s", (count: number, expected: string) => {
    expect(getPermissionCountText(ENGLISH, count)).toBe(expected);
  });

  test.each([0, undefined, null, -1])(
    "a role holding nothing says so, rather than a count (%s)",
    (count: number | undefined | null) => {
      expect(getPermissionCountText(ENGLISH, count)).toBe(NO_PERMISSIONS_YET);
      expect(NO_PERMISSIONS_YET).toBe("No permissions yet");
    },
  );

  test("is said in the reader's language", () => {
    expect(getPermissionCountText(GERMAN, 1)).toBe("1 Berechtigung");
    expect(getPermissionCountText(GERMAN, 6)).toBe("6 Berechtigungen");
    expect(getPermissionCountText(GERMAN, 0)).toBe("Noch keine Berechtigungen");
  });
});

describe("a role's card", () => {
  test("says how many permissions it holds, then its own description", () => {
    expect(
      getCustomRoleCardDescription(ENGLISH, {
        description: "Declares, works and resolves incidents.",
        permissionCount: 6,
      }),
    ).toBe("6 permissions · Declares, works and resolves incidents.");
  });

  test("is the count alone without a description, a blank one included", () => {
    for (const description of [undefined, "", "   "]) {
      expect(
        getCustomRoleCardDescription(ENGLISH, {
          description: description,
          permissionCount: 3,
        }),
      ).toBe("3 permissions");
    }
  });

  test("among the built-in roles, says first that it is a custom one", () => {
    expect(
      getCustomRoleCardDescription(ENGLISH, {
        description: "Runs a team.",
        permissionCount: 1,
        saysItIsCustom: true,
      }),
    ).toBe("Custom role · 1 permission · Runs a team.");
    expect(
      getCustomRoleCardDescription(ENGLISH, {
        permissionCount: 2,
        saysItIsCustom: true,
      }),
    ).toBe("Custom role · 2 permissions");
  });

  test("an empty role's card says it holds nothing yet", () => {
    expect(
      getCustomRoleCardDescription(ENGLISH, {
        description: "Reads the audit log.",
        permissionCount: 0,
      }),
    ).toBe("No permissions yet · Reads the audit log.");
  });

  test("is one sentence in the reader's language; the role's own description is kept as written", () => {
    expect(
      getCustomRoleCardDescription(GERMAN, {
        description: "Declares, works and resolves incidents.",
        permissionCount: 6,
        saysItIsCustom: true,
      }),
    ).toBe(
      "Benutzerdefinierte Rolle · 6 Berechtigungen · Declares, works and resolves incidents.",
    );
  });
});

describe("who a change to a role reaches", () => {
  test("names the teams and the people on them", () => {
    expect(
      getRoleReachSentence(ENGLISH, { teamCount: 2, memberCount: 4 }),
    ).toBe(
      "Given to 2 teams (4 people). A change here changes what they can do at once.",
    );
    expect(
      getRoleReachSentence(ENGLISH, { teamCount: 1, memberCount: 1 }),
    ).toBe(
      "Given to 1 team (1 person). A change here changes what they can do at once.",
    );
    expect(
      getRoleReachSentence(ENGLISH, { teamCount: 1, memberCount: 0 }),
    ).toBe(
      "Given to 1 team (0 people). A change here changes what they can do at once.",
    );
  });

  test("names the teams only, when the reader may not read who is on them", () => {
    expect(
      getRoleReachSentence(ENGLISH, { teamCount: 3, memberCount: null }),
    ).toBe("Given to 3 teams. A change here changes what they can do at once.");
  });

  test("a role no team has says where to give it", () => {
    expect(
      getRoleReachSentence(ENGLISH, { teamCount: 0, memberCount: 0 }),
    ).toBe(ROLE_GIVEN_TO_NO_TEAM);
    expect(ROLE_GIVEN_TO_NO_TEAM).toBe(
      "No team has this role yet. Give it to a team below, or from a team's Permissions page.",
    );
  });

  test("is one sentence in the reader's language, the counts in it too", () => {
    expect(getRoleReachSentence(GERMAN, { teamCount: 2, memberCount: 1 })).toBe(
      "Vergeben an 2 Teams (1 Person). Eine Änderung hier ändert sofort, was sie tun können.",
    );
  });
});

describe("who deleting a role takes access from", () => {
  test("names the teams and people that have it right now", () => {
    expect(
      getRoleDeleteReachSentence(ENGLISH, { teamCount: 2, memberCount: 4 }),
    ).toBe("It is given to 2 teams (4 people) right now.");
    expect(
      getRoleDeleteReachSentence(ENGLISH, { teamCount: 2, memberCount: null }),
    ).toBe("It is given to 2 teams right now.");
  });

  test("a role no team has takes access from no one, and says so", () => {
    expect(
      getRoleDeleteReachSentence(ENGLISH, { teamCount: 0, memberCount: 0 }),
    ).toBe(ROLE_DELETE_REACHES_NO_ONE);
    expect(ROLE_DELETE_REACHES_NO_ONE).toBe(
      "No team has this role right now, so no one loses access.",
    );
    expect(
      getRoleDeleteReachSentence(GERMAN, { teamCount: 0, memberCount: 0 }),
    ).toBe("Kein Team hat diese Rolle gerade, also verliert niemand Zugriff.");
  });

  test("is one sentence in the reader's language", () => {
    expect(
      getRoleDeleteReachSentence(GERMAN, { teamCount: 1, memberCount: 3 }),
    ).toBe("Sie ist gerade an 1 Team (3 Personen) vergeben.");
  });
});

describe("who a role reaches, API keys counted", () => {
  test("names the teams, the people on them and the API keys", () => {
    expect(
      getRoleReachSentence(ENGLISH, {
        teamCount: 2,
        memberCount: 5,
        apiKeyCount: 3,
      }),
    ).toBe(
      "Given to 2 teams (5 people) and 3 API keys. A change here changes what they can do at once.",
    );
    expect(
      getRoleDeleteReachSentence(ENGLISH, {
        teamCount: 1,
        memberCount: 1,
        apiKeyCount: 1,
      }),
    ).toBe("It is given to 1 team (1 person) and 1 API key right now.");
  });

  test("names the keys alone when no team has the role", () => {
    expect(
      getRoleReachSentence(ENGLISH, {
        teamCount: 0,
        memberCount: 0,
        apiKeyCount: 2,
      }),
    ).toBe(
      "Given to 2 API keys. A change here changes what they can do at once.",
    );
    expect(
      getRoleDeleteReachSentence(ENGLISH, {
        teamCount: 0,
        memberCount: 0,
        apiKeyCount: 1,
      }),
    ).toBe("It is given to 1 API key right now.");
  });

  test("names the teams only when no key has it, or the reader may not read the keys", () => {
    for (const apiKeyCount of [0, null, undefined]) {
      expect(
        getRoleReachSentence(ENGLISH, {
          teamCount: 2,
          memberCount: 5,
          apiKeyCount: apiKeyCount,
        }),
      ).toBe(
        "Given to 2 teams (5 people). A change here changes what they can do at once.",
      );
    }
  });

  test("a role nothing has says so - naming keys only for a reader who may read them", () => {
    expect(
      getRoleReachSentence(ENGLISH, {
        teamCount: 0,
        memberCount: 0,
        apiKeyCount: 0,
      }),
    ).toBe(ROLE_GIVEN_TO_NOTHING);
    expect(ROLE_GIVEN_TO_NOTHING).toBe(
      "No team or API key has this role yet. Give it to one below.",
    );
    expect(
      getRoleDeleteReachSentence(ENGLISH, {
        teamCount: 0,
        memberCount: 0,
        apiKeyCount: 0,
      }),
    ).toBe(ROLE_DELETE_REACHES_NOTHING);

    // The keys are not the reader's to know about: the team sentences, as before.
    expect(
      getRoleReachSentence(ENGLISH, {
        teamCount: 0,
        memberCount: 0,
        apiKeyCount: null,
      }),
    ).toBe(ROLE_GIVEN_TO_NO_TEAM);
    expect(
      getRoleDeleteReachSentence(ENGLISH, {
        teamCount: 0,
        memberCount: 0,
      }),
    ).toBe(ROLE_DELETE_REACHES_NO_ONE);
  });

  test("whether anything has the role: a team or a key", () => {
    expect(
      isRoleGivenToAnyone({ teamCount: 0, memberCount: 0, apiKeyCount: 1 }),
    ).toBe(true);
    expect(
      isRoleGivenToAnyone({ teamCount: 1, memberCount: 0, apiKeyCount: null }),
    ).toBe(true);
    expect(
      isRoleGivenToAnyone({ teamCount: 0, memberCount: 0, apiKeyCount: 0 }),
    ).toBe(false);
    expect(isRoleGivenToAnyone({ teamCount: 0, memberCount: null })).toBe(
      false,
    );
  });

  test("is one sentence in the reader's language, the key count in it too", () => {
    expect(API_KEY_COUNT_TEMPLATE).toEqual({
      one: "{{count}} API key",
      other: "{{count}} API keys",
    });
    expect(
      getRoleReachSentence(GERMAN, {
        teamCount: 2,
        memberCount: 5,
        apiKeyCount: 3,
      }),
    ).toBe(
      "Vergeben an 2 Teams (5 Personen) und 3 API-Schlüssel. Eine Änderung hier ändert sofort, was sie tun können.",
    );
    expect(
      getRoleDeleteReachSentence(GERMAN, {
        teamCount: 0,
        memberCount: 0,
        apiKeyCount: 0,
      }),
    ).toBe(
      "Gerade hat kein Team und kein API-Schlüssel diese Rolle, also verliert niemand Zugriff.",
    );
  });
});

describe("how much of a role an API key holds", () => {
  test("every permission: the role's count, as everywhere else", () => {
    expect(
      getApiKeyRolePermissionCountText(ENGLISH, {
        permissionCount: 6,
        ownedCount: 0,
      }),
    ).toBe("6 permissions");
    expect(
      getApiKeyRolePermissionCountText(ENGLISH, {
        permissionCount: 0,
        ownedCount: 0,
      }),
    ).toBe(NO_PERMISSIONS_YET);
    expect(
      getApiKeyRolePermissionCountText(ENGLISH, {
        permissionCount: undefined,
        ownedCount: 0,
      }),
    ).toBe(NO_PERMISSIONS_YET);
  });

  test("some limited to what someone owns: how many of them apply to the key", () => {
    expect(APPLIED_PERMISSION_COUNT_TEMPLATE.other).toBe(
      "{{applied}} of its {{count}} permissions apply to this key",
    );
    expect(
      getApiKeyRolePermissionCountText(ENGLISH, {
        permissionCount: 6,
        ownedCount: 2,
      }),
    ).toBe("4 of its 6 permissions apply to this key");
    expect(
      getApiKeyRolePermissionCountText(GERMAN, {
        permissionCount: 6,
        ownedCount: 2,
      }),
    ).toBe("4 ihrer 6 Berechtigungen gelten für diesen Schlüssel");
  });

  test("all of them limited to what someone owns: none applies", () => {
    expect(
      getApiKeyRolePermissionCountText(ENGLISH, {
        permissionCount: 2,
        ownedCount: 2,
      }),
    ).toBe(NO_PERMISSION_APPLIES_TO_KEY);
    expect(
      getApiKeyRolePermissionCountText(GERMAN, {
        permissionCount: 2,
        ownedCount: 2,
      }),
    ).toBe("Keine ihrer Berechtigungen gilt für diesen Schlüssel");
  });

  test("a count of owned permissions out of range is held to the role's own", () => {
    // More owned than held (a count read a moment apart): none applies.
    expect(
      getApiKeyRolePermissionCountText(ENGLISH, {
        permissionCount: 2,
        ownedCount: 5,
      }),
    ).toBe(NO_PERMISSION_APPLIES_TO_KEY);
    // A negative count is none.
    expect(
      getApiKeyRolePermissionCountText(ENGLISH, {
        permissionCount: 3,
        ownedCount: -1,
      }),
    ).toBe("3 permissions");
  });

  test("a role's card on a key's picker takes the key's words for its permissions", () => {
    expect(
      getCustomRoleCardDescription(ENGLISH, {
        description: "Works incidents.",
        permissionCount: 6,
        permissionsText: "4 of its 6 permissions apply to this key",
      }),
    ).toBe("4 of its 6 permissions apply to this key · Works incidents.");
    expect(
      getCustomRoleCardDescription(ENGLISH, {
        permissionCount: 6,
        permissionsText: "",
      }),
    ).toBe("6 permissions");
  });
});

describe("what an API key gets of a role, and why not the rest", () => {
  const OWNED_TITLE: string = PERMISSION_SCOPE_TITLES[PermissionScope.Owned];

  test("why: in the words the role's Scope column uses for what someone owns", () => {
    expect(OWNED_TITLE).toBe("Only resources they own");
    expect(getApiKeyOwnedScopeReason(ENGLISH)).toBe(
      "Permissions scoped to “Only resources they own” don't apply to an API key: a key owns nothing.",
    );
  });

  test("why is one sentence in the reader's language, the scope's title in it too", () => {
    expect(getApiKeyOwnedScopeReason(GERMAN)).toBe(
      "Berechtigungen mit dem Geltungsbereich „Nur Ressourcen, die ihnen gehören“ gelten nicht für einen API-Schlüssel: Ein Schlüssel besitzt nichts.",
    );
  });

  test("a key misses part of a role only when the role holds a permission scoped to what someone owns", () => {
    expect(doesApiKeyMissPartOfRole(null)).toBe(false);
    expect(doesApiKeyMissPartOfRole(undefined)).toBe(false);
    expect(
      doesApiKeyMissPartOfRole({ permissionCount: 3, ownedCount: 0 }),
    ).toBe(false);
    expect(
      doesApiKeyMissPartOfRole({ permissionCount: 3, ownedCount: 1 }),
    ).toBe(true);
    // A count held to the role's own: nothing to miss in an empty role.
    expect(
      doesApiKeyMissPartOfRole({ permissionCount: 0, ownedCount: 2 }),
    ).toBe(false);
  });

  test("the role's API Keys card: everything only when that is so", () => {
    for (const coverage of [
      null,
      undefined,
      { permissionCount: 0, ownedCount: 0 },
      { permissionCount: 4, ownedCount: 0 },
    ]) {
      expect(getRoleApiKeysCardDescription(ENGLISH, coverage)).toBe(
        "These API keys can do everything this role allows.",
      );
    }

    expect(
      getRoleApiKeysCardDescription(ENGLISH, {
        permissionCount: 3,
        ownedCount: 1,
      }),
    ).toBe(
      "These API keys get 2 of this role's 3 permissions: those scoped to “Only resources they own” don't apply to a key.",
    );

    for (const ownedCount of [2, 5]) {
      expect(
        getRoleApiKeysCardDescription(ENGLISH, {
          permissionCount: 2,
          ownedCount: ownedCount,
        }),
      ).toBe(
        "None of this role's permissions apply to these API keys: each is scoped to “Only resources they own”.",
      );
    }
  });

  test("the role's API Keys card is one sentence in the reader's language", () => {
    expect(
      getRoleApiKeysCardDescription(GERMAN, {
        permissionCount: 3,
        ownedCount: 1,
      }),
    ).toBe(
      "Diese API-Schlüssel erhalten 2 der 3 Berechtigungen dieser Rolle: Die mit dem Geltungsbereich „Nur Ressourcen, die ihnen gehören“ gelten nicht für einen Schlüssel.",
    );
  });

  test("Give to an API Key: the Owned exception only for a role that has such a permission", () => {
    expect(getGiveRoleToApiKeyDescription(ENGLISH, null)).toBe(
      "From now on the key can do everything this role allows.",
    );
    expect(
      getGiveRoleToApiKeyDescription(ENGLISH, {
        permissionCount: 2,
        ownedCount: 0,
      }),
    ).toBe("From now on the key can do everything this role allows.");
    expect(
      getGiveRoleToApiKeyDescription(ENGLISH, {
        permissionCount: 2,
        ownedCount: 1,
      }),
    ).toBe(
      "From now on the key can do everything this role allows, except permissions scoped to “Only resources they own”: a key owns nothing.",
    );
  });

  test("a key's Add Custom Role: the Owned exception only when a role on offer has such a permission", () => {
    expect(
      getAddRoleToApiKeyDescription(ENGLISH, {
        isAnyOfferedRolePartlyOwned: false,
      }),
    ).toBe(
      "The key gets everything the role allows. Make or change roles on the Roles page.",
    );
    expect(
      getAddRoleToApiKeyDescription(ENGLISH, {
        isAnyOfferedRolePartlyOwned: true,
      }),
    ).toBe(
      "The key gets everything the role allows, except permissions scoped to “Only resources they own”: a key owns nothing. Make or change roles on the Roles page.",
    );
  });

  test("every sentence is in the Dashboard's locale files, so each language words it", () => {
    const english: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Locales/en.json",
        ),
        "utf-8",
      ),
    ) as Record<string, string>;

    for (const sentence of [
      API_KEY_OWNED_SCOPE_REASON,
      API_KEYS_GET_EVERYTHING,
      API_KEYS_GET_NOTHING,
      API_KEYS_GET_PART_TEMPLATE.other,
      ADD_ROLE_TO_API_KEY_DESCRIPTION,
      ADD_ROLE_TO_API_KEY_DESCRIPTION_OWNED,
      GIVE_ROLE_TO_API_KEY_DESCRIPTION,
      GIVE_ROLE_TO_API_KEY_DESCRIPTION_OWNED,
      NO_API_KEY_IN_PROJECT_TOOLTIP,
      EVERY_API_KEY_HAS_ROLE_TOOLTIP,
      NO_API_KEY_IN_PROJECT_TITLE,
      NO_API_KEY_IN_PROJECT_DESCRIPTION,
      OWNED_TITLE,
    ]) {
      expect(english[sentence]).toBe(sentence);
    }

    expect(english[`${API_KEYS_GET_PART_TEMPLATE.other}_one`]).toBe(
      API_KEYS_GET_PART_TEMPLATE.one,
    );
  });
});

describe("taking a role from an API key", () => {
  test("says the key loses the role's permissions and keeps the rest", () => {
    expect(
      getRoleRemoveFromApiKeySentence(ENGLISH, {
        roleName: "Incident Responder",
        apiKeyName: "Deploy bot",
      }),
    ).toBe(
      "Deploy bot loses the permissions of Incident Responder. Its other roles and permissions stay.",
    );
    expect(
      getRoleRemoveFromApiKeySentence(GERMAN, {
        roleName: "Incident Responder",
        apiKeyName: "Deploy bot",
      }),
    ).toBe(
      "Deploy bot verliert die Berechtigungen von Incident Responder. Seine anderen Rollen und Berechtigungen bleiben.",
    );
  });
});

describe("taking a role from a team", () => {
  test("says the team loses the role's permissions and keeps the rest", () => {
    expect(
      getRoleRemoveFromTeamSentence(ENGLISH, {
        roleName: "Incident Responder",
        teamName: "Support",
      }),
    ).toBe(
      "Support loses the permissions of Incident Responder. Its other roles and permissions stay.",
    );
    expect(
      getRoleRemoveFromTeamSentence(GERMAN, {
        roleName: "Incident Responder",
        teamName: "Support",
      }),
    ).toBe(
      "Support verliert die Berechtigungen von Incident Responder. Ihre anderen Rollen und Berechtigungen bleiben.",
    );
  });
});
