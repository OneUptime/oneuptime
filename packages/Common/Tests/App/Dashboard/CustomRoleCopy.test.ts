import { describe, expect, test } from "@jest/globals";
import {
  getCustomRoleCardDescription,
  getPermissionCountText,
  getRoleDeleteReachSentence,
  getRoleReachSentence,
  getRoleRemoveFromTeamSentence,
  NO_PERMISSIONS_YET,
  PEOPLE_COUNT_TEMPLATE,
  PERMISSION_COUNT_TEMPLATE,
  ROLE_DELETE_REACHES_NO_ONE,
  ROLE_GIVEN_TO_NO_TEAM,
  TEAM_COUNT_TEMPLATE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomRole/CustomRoleCopy";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

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
