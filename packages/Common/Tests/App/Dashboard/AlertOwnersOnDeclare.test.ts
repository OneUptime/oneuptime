import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ALERT_OWNERS_ADDED_ONE_ALERT,
  ALERT_OWNERS_ADDED_SEVERAL_ALERTS,
  ALERT_OWNERS_IN_FIELD_ONE_ALERT,
  ALERT_OWNERS_IN_FIELD_SEVERAL_ALERTS,
  AlertOwnersOnDeclare,
  AlertOwnersOnDeclareMode,
  NO_ALERT_OWNERS_ON_DECLARE,
  PRIVATE_INCIDENT_FROM_ALERTS,
  getAlertOwnersOnDeclare,
  getAlertOwnersOnDeclareSentence,
  isOwnersFieldTheAlertOwnersSource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/AlertOwnersOnDeclare";
import { AlertOwnerIds } from "../../../Utils/Incident/IncidentFromAlerts";

/*
 * What the declare page does with the owners of the alerts an incident is
 * declared from (#10867), decided before anything is drawn:
 *
 *   - owners it could read, and the declarer may add owners of every kind
 *     the alerts have: they start in the editable Owners field, and the
 *     banner says to change them there - the page then tells the server not
 *     to add them again (carryOverAlertOwners false);
 *   - owners it could read, but the declarer may not add one of their kinds,
 *     or owners it could not read at all: the field is left alone, the
 *     server adds them as it declares, and the banner says so;
 *   - alerts with no owners: nothing to say, nothing to add.
 *
 * The banner's sentences are Dashboard translation keys, worded in every
 * language the Dashboard speaks.
 */

const USER_A: string = "a0000000-0000-4000-8000-000000000001";
const USER_B: string = "a0000000-0000-4000-8000-000000000002";
const TEAM_A: string = "b0000000-0000-4000-8000-000000000001";

const USERS_AND_TEAMS: AlertOwnerIds = {
  userIds: [USER_A, USER_B],
  teamIds: [TEAM_A],
};
const USERS_ONLY: AlertOwnerIds = { userIds: [USER_A], teamIds: [] };
const TEAMS_ONLY: AlertOwnerIds = { userIds: [], teamIds: [TEAM_A] };
const NONE: AlertOwnerIds = { userIds: [], teamIds: [] };

const SENTENCES: Array<string> = [
  ALERT_OWNERS_IN_FIELD_ONE_ALERT,
  ALERT_OWNERS_IN_FIELD_SEVERAL_ALERTS,
  ALERT_OWNERS_ADDED_ONE_ALERT,
  ALERT_OWNERS_ADDED_SEVERAL_ALERTS,
  PRIVATE_INCIDENT_FROM_ALERTS,
];

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

// The Dashboard's languages besides English.
const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  })
  .sort();

function localeOf(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function state(
  owners: AlertOwnerIds | null,
  mayAddOwnerUsers: boolean = true,
  mayAddOwnerTeams: boolean = true,
): AlertOwnersOnDeclare {
  return getAlertOwnersOnDeclare({
    owners,
    mayAddOwnerUsers,
    mayAddOwnerTeams,
  });
}

describe("getAlertOwnersOnDeclare: where the alerts' owners go", () => {
  test("owners the declarer may add start in the Owners field", () => {
    expect(state(USERS_AND_TEAMS)).toEqual({
      mode: AlertOwnersOnDeclareMode.InOwnersField,
      owners: USERS_AND_TEAMS,
      areOwnersKnown: true,
    });
  });

  test("only the kinds the alerts have are asked of the declarer", () => {
    // Users only: a declarer who may not add teams can still have them.
    expect(state(USERS_ONLY, true, false).mode).toBe(
      AlertOwnersOnDeclareMode.InOwnersField,
    );
    // Teams only: likewise for one who may not add users.
    expect(state(TEAMS_ONLY, false, true).mode).toBe(
      AlertOwnersOnDeclareMode.InOwnersField,
    );
  });

  test.each([
    ["users", false, true],
    ["teams", true, false],
    ["anybody", false, false],
  ])(
    "a declarer who may not add %s gets them added by OneUptime as it declares",
    (_kind: string, mayAddOwnerUsers: boolean, mayAddOwnerTeams: boolean) => {
      expect(
        state(USERS_AND_TEAMS, mayAddOwnerUsers, mayAddOwnerTeams),
      ).toEqual({
        mode: AlertOwnersOnDeclareMode.AddedOnDeclare,
        owners: USERS_AND_TEAMS,
        areOwnersKnown: true,
      });
    },
  );

  test("owners that could not be read are added by OneUptime, unnamed", () => {
    expect(state(null)).toEqual({
      mode: AlertOwnersOnDeclareMode.AddedOnDeclare,
      owners: { userIds: [], teamIds: [] },
      areOwnersKnown: false,
    });
    // Whatever the declarer may do: nothing is known to put in the field.
    expect(state(null, false, false).mode).toBe(
      AlertOwnersOnDeclareMode.AddedOnDeclare,
    );
  });

  test("alerts with no owners add nobody", () => {
    expect(state(NONE)).toBe(NO_ALERT_OWNERS_ON_DECLARE);
    expect(state(NONE, false, false)).toBe(NO_ALERT_OWNERS_ON_DECLARE);
    expect(NO_ALERT_OWNERS_ON_DECLARE).toEqual({
      mode: AlertOwnersOnDeclareMode.None,
      owners: { userIds: [], teamIds: [] },
      areOwnersKnown: true,
    });
  });
});

describe("isOwnersFieldTheAlertOwnersSource: whether the page tells the server not to add them again", () => {
  test("only when they start in the Owners field", () => {
    expect(isOwnersFieldTheAlertOwnersSource(state(USERS_AND_TEAMS))).toBe(
      true,
    );
    expect(
      isOwnersFieldTheAlertOwnersSource(state(USERS_AND_TEAMS, false, false)),
    ).toBe(false);
    expect(isOwnersFieldTheAlertOwnersSource(state(null))).toBe(false);
    expect(isOwnersFieldTheAlertOwnersSource(NO_ALERT_OWNERS_ON_DECLARE)).toBe(
      false,
    );
  });
});

describe("getAlertOwnersOnDeclareSentence: what the banner says", () => {
  test("in the field: change them under More fields, for one alert and for several", () => {
    expect(getAlertOwnersOnDeclareSentence(state(USERS_ONLY), 1)).toBe(
      "The alert's owners own the incident too. Change them under More fields before you declare.",
    );
    expect(getAlertOwnersOnDeclareSentence(state(USERS_ONLY), 3)).toBe(
      "The owners of these alerts own the incident too. Change them under More fields before you declare.",
    );
  });

  test("added on declare: they own it once it is declared, for one alert and for several", () => {
    expect(
      getAlertOwnersOnDeclareSentence(state(USERS_ONLY, false, false), 1),
    ).toBe("The alert's owners own the incident too, once it is declared.");
    expect(getAlertOwnersOnDeclareSentence(state(null), 2)).toBe(
      "The owners of these alerts own the incident too, once it is declared.",
    );
  });

  test("says nothing when the alerts have no owners", () => {
    expect(
      getAlertOwnersOnDeclareSentence(NO_ALERT_OWNERS_ON_DECLARE, 1),
    ).toBeNull();
    expect(
      getAlertOwnersOnDeclareSentence(NO_ALERT_OWNERS_ON_DECLARE, 5),
    ).toBeNull();
  });

  test("the private incident note no longer says the owners are copied on their own", () => {
    expect(PRIVATE_INCIDENT_FROM_ALERTS).toBe(
      "At least one of these alerts is private, so Private Incident starts switched on. While it stays on, only the incident's owners, Project Owners and Project Admins can see it.",
    );
  });
});

describe("the banner's sentences, in every Dashboard language", () => {
  test("are English keys of the Dashboard's own locale", () => {
    const english: Record<string, string> = localeOf("en");

    for (const sentence of SENTENCES) {
      expect({ sentence, value: english[sentence] }).toEqual({
        sentence,
        value: sentence,
      });
    }
  });

  test.each(LANGUAGES)("are worded in %s", (language: string) => {
    const locale: Record<string, string> = localeOf(language);

    for (const sentence of SENTENCES) {
      const value: string | undefined = locale[sentence];

      expect({ language, sentence, translated: Boolean(value) }).toEqual({
        language,
        sentence,
        translated: true,
      });
      expect({ language, sentence, same: value === sentence }).toEqual({
        language,
        sentence,
        same: false,
      });
    }
  });
});
