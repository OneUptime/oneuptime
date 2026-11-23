import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  CLEAR_LOCAL_SIGN_IN_ACTION,
  CLEAR_MASTER_ADMIN_SIGN_IN_NOT_CONFIRMED_MESSAGE,
  CLEAR_OWN_SIGN_IN_MESSAGE,
  CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE,
  CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE,
  CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE,
  getProjectClearPersonSavedSignInSettingsRoute,
  getProjectSavedSignInSettingsOfPeopleRoute,
  hasLocalSignInSettings,
  LocalSignInSettings,
  MAX_PEOPLE_PER_SAVED_SIGN_IN_SETTINGS_ASK,
  NO_LOCAL_SIGN_IN_SETTINGS,
  PersonSavedSignInSettings,
  PROJECT_CLEAR_PERSON_SAVED_SIGN_IN_SETTINGS_ACTION,
  PROJECT_SAVED_SIGN_IN_SETTINGS_OF_PEOPLE_ACTION,
  readClearLocalSignInAnswer,
  readClearSavedSignInSettingsAnswer,
  readLocalSignInSettings,
  readSavedSignInSettingsAnswer,
  readSavedSignInSettingsOfPeopleAnswer,
  readSavedSignInSettingsOfPeopleRequest,
  SAVED_SIGN_IN_SETTINGS_OF_PEOPLE_BAD_REQUEST_MESSAGE,
  SAVED_SIGN_IN_SETTINGS_OF_PEOPLE_TOO_MANY_MESSAGE,
  SAVED_SIGN_IN_SETTINGS_ROUTE,
  toSavedSignInSettingsOfPeopleAnswerJSON,
  toSavedSignInSettingsOfPeopleRequestJSON,
} from "../../../Types/SSO/LocalSignInClearing";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * CLEARING THE SIGN-IN SETTINGS PEOPLE SAVED IN ONEUPTIME (issue #9762), as
 * the Admin Dashboard reads it: the routes it asks, whether a person has
 * anything to clear, and the answers - which a broken or forged reply must
 * never turn into a count, or a "cleared", that did not happen.
 */

const EVERYTHING: LocalSignInSettings = {
  hasPassword: true,
  hasPasswordResetLink: true,
  isTwoFactorAuthEnabled: true,
  authenticatorAppCount: 2,
  passkeyAndSecurityKeyCount: 1,
  backupCodeCount: 10,
};

describe("the routes", () => {
  test("are the ones the Admin Dashboard asks, under the API", () => {
    expect(CLEAR_LOCAL_SIGN_IN_ACTION).toBe("clear-local-sign-in");
    expect(SAVED_SIGN_IN_SETTINGS_ROUTE).toBe(
      "/global-config/saved-sign-in-settings",
    );
    expect(CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE).toBe(
      "/global-config/saved-sign-in-settings/clear",
    );
  });
});

describe("hasLocalSignInSettings", () => {
  test("nothing saved is nothing to clear", () => {
    expect(hasLocalSignInSettings(NO_LOCAL_SIGN_IN_SETTINGS)).toBe(false);
  });

  test.each([
    ["a password", { hasPassword: true }],
    // #9992: the Require SSO card counts it, so a clear removes it and says so.
    ["a password reset link that still works", { hasPasswordResetLink: true }],
    ["two-factor authentication on", { isTwoFactorAuthEnabled: true }],
    ["an authenticator app", { authenticatorAppCount: 1 }],
    ["a passkey or a security key", { passkeyAndSecurityKeyCount: 1 }],
    ["a backup code", { backupCodeCount: 1 }],
  ])(
    "%s alone is something to clear",
    (_label: string, part: Partial<LocalSignInSettings>) => {
      expect(
        hasLocalSignInSettings({ ...NO_LOCAL_SIGN_IN_SETTINGS, ...part }),
      ).toBe(true);
    },
  );
});

describe("readLocalSignInSettings", () => {
  test("reads what a person had", () => {
    expect(readLocalSignInSettings({ ...EVERYTHING })).toEqual(EVERYTHING);
    expect(readLocalSignInSettings({ ...NO_LOCAL_SIGN_IN_SETTINGS })).toEqual(
      NO_LOCAL_SIGN_IN_SETTINGS,
    );
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", [EVERYTHING]],
    ["a string", "everything"],
    ["a flag that is a string", { ...EVERYTHING, hasPassword: "true" }],
    ["a count that is negative", { ...EVERYTHING, backupCodeCount: -1 }],
    [
      "a count that is not whole",
      { ...EVERYTHING, authenticatorAppCount: 1.5 },
    ],
    [
      "a count that is a string",
      { ...EVERYTHING, passkeyAndSecurityKeyCount: "1" },
    ],
    ["a missing switch", { ...EVERYTHING, isTwoFactorAuthEnabled: undefined }],
    [
      "a reset link that is a string",
      { ...EVERYTHING, hasPasswordResetLink: "true" },
    ],
    [
      "a reset link that is null",
      { ...EVERYTHING, hasPasswordResetLink: null },
    ],
  ])("%s is no answer", (_label: string, value: unknown) => {
    expect(readLocalSignInSettings(value)).toBeNull();
  });

  test("reads a reset link when it is there (#9992)", () => {
    expect(
      readLocalSignInSettings({
        ...NO_LOCAL_SIGN_IN_SETTINGS,
        hasPasswordResetLink: true,
      }),
    ).toEqual({ ...NO_LOCAL_SIGN_IN_SETTINGS, hasPasswordResetLink: true });
  });

  test("an answer from a server before #9992, naming no reset link, reads as none", () => {
    const older: Record<string, unknown> = { ...EVERYTHING };
    delete older["hasPasswordResetLink"];

    expect(readLocalSignInSettings(older)).toEqual({
      ...EVERYTHING,
      hasPasswordResetLink: false,
    });
  });
});

describe("readClearLocalSignInAnswer", () => {
  test("reads what a clear removed and how many sessions it ended", () => {
    expect(
      readClearLocalSignInAnswer({ cleared: EVERYTHING, sessionsEnded: 3 }),
    ).toEqual({ cleared: EVERYTHING, sessionsEnded: 3 });
  });

  test.each([
    ["nothing", null],
    ["no settings", { sessionsEnded: 3 }],
    ["broken settings", { cleared: { hasPassword: true }, sessionsEnded: 0 }],
    ["no session count", { cleared: EVERYTHING }],
    [
      "a session count that is a string",
      { cleared: EVERYTHING, sessionsEnded: "3" },
    ],
    ["a list", [{ cleared: EVERYTHING, sessionsEnded: 3 }]],
  ])("%s is no answer", (_label: string, value: unknown) => {
    expect(readClearLocalSignInAnswer(value)).toBeNull();
  });
});

describe("the Require SSO card's answers", () => {
  test("its count is read when it is a whole number of people", () => {
    expect(readSavedSignInSettingsAnswer({ peopleCount: 0 })).toEqual({
      peopleCount: 0,
    });
    expect(readSavedSignInSettingsAnswer({ peopleCount: 41 })).toEqual({
      peopleCount: 41,
    });
  });

  test("its clear is read when it is a whole number of people", () => {
    expect(readClearSavedSignInSettingsAnswer({ peopleCleared: 7 })).toEqual({
      peopleCleared: 7,
    });
  });

  test.each([
    [null],
    [[]],
    [{}],
    [{ peopleCount: "3" }],
    [{ peopleCount: -1 }],
    [{ peopleCount: 2.5 }],
  ])("anything else is no count: %j", (answer: unknown) => {
    expect(readSavedSignInSettingsAnswer(answer)).toBeNull();
  });

  test.each([
    [null],
    [{}],
    [{ peopleCleared: "7" }],
    [{ peopleCleared: -2 }],
    [{ peopleCount: 7 }],
  ])("anything else is no clear: %j", (answer: unknown) => {
    expect(readClearSavedSignInSettingsAnswer(answer)).toBeNull();
  });
});

describe("the refusals", () => {
  test.each([
    CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE,
    CLEAR_MASTER_ADMIN_SIGN_IN_NOT_CONFIRMED_MESSAGE,
    CLEAR_OWN_SIGN_IN_MESSAGE,
  ])("each is a sentence that says what to do: %s", (message: string) => {
    expect(message).toMatch(/^[A-Z].*\.$/);
    expect(message.length).toBeLessThanOrEqual(200);
  });

  test("each is its own", () => {
    expect(
      new Set([
        CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE,
        CLEAR_MASTER_ADMIN_SIGN_IN_NOT_CONFIRMED_MESSAGE,
        CLEAR_OWN_SIGN_IN_MESSAGE,
      ]).size,
    ).toBe(3);
  });

  test("clearing while SSO is not required names the switch that must be on first", () => {
    expect(CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE).toContain(
      "Require SSO to Sign In",
    );
  });

  test("clearing your own says where your own settings are", () => {
    expect(CLEAR_OWN_SIGN_IN_MESSAGE).toContain("User Profile");
  });
});

/*
 * ONE MEMBER AT A TIME, FROM THE USERS LIST (#9993): the two routes, the
 * ask the Dashboard sends, and the answer it reads. The answer names a
 * person across the owner's projects, so the page must never read anybody
 * out of it it did not ask about, nor a row that says nothing is saved.
 */
describe("one member at a time: the routes", () => {
  const projectId: string = "11111111-1111-4111-8111-111111111111";
  const userId: string = "22222222-2222-4222-8222-222222222222";

  test("are under the project, beside the count and the clear of everyone", () => {
    expect(PROJECT_SAVED_SIGN_IN_SETTINGS_OF_PEOPLE_ACTION).toBe(
      "saved-sign-in-settings/people",
    );
    expect(PROJECT_CLEAR_PERSON_SAVED_SIGN_IN_SETTINGS_ACTION).toBe(
      "saved-sign-in-settings/people/:userId/clear",
    );
    expect(getProjectSavedSignInSettingsOfPeopleRoute(projectId)).toBe(
      `/project/${projectId}/saved-sign-in-settings/people`,
    );
    expect(
      getProjectClearPersonSavedSignInSettingsRoute(projectId, userId),
    ).toBe(
      `/project/${projectId}/saved-sign-in-settings/people/${userId}/clear`,
    );
  });

  test("its refusal says the rule, never which part of it a person failed", () => {
    expect(CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE).toMatch(
      /^[A-Z].*\.$/,
    );
    expect(CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE).not.toMatch(
      /master admin|another organization|invited/i,
    );
  });
});

describe("one member at a time: the ask", () => {
  const ids: Array<string> = [
    "aa000000-0000-4000-8000-00000000000a",
    "bb000000-0000-4000-8000-00000000000b",
  ];

  test("reads each person once, lower-cased", () => {
    const read: Array<ObjectID> = readSavedSignInSettingsOfPeopleRequest({
      userIds: [ids[0], ids[0]!.toUpperCase(), ids[1]],
    });

    expect(
      read.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual(ids);
  });

  test.each([
    ["no body", undefined],
    ["a list for a body", [ids[0]]],
    ["no ids", {}],
    ["ids that are not a list", { userIds: ids[0] }],
    ["an id that is not one", { userIds: [ids[0], "everyone"] }],
    ["an id that is a number", { userIds: [42] }],
  ])("%s is refused, never guessed at", (_label: string, body: unknown) => {
    expect(() => {
      readSavedSignInSettingsOfPeopleRequest(body);
    }).toThrow(
      new BadDataException(
        SAVED_SIGN_IN_SETTINGS_OF_PEOPLE_BAD_REQUEST_MESSAGE,
      ),
    );
  });

  // A page's ids, `count` people, each written in any case and any number of times.
  const pageOfIds: (
    random: SeededRandom,
    count: number,
  ) => { sent: Array<string>; people: Array<string> } = (
    random: SeededRandom,
    count: number,
  ): { sent: Array<string>; people: Array<string> } => {
    const people: Array<string> = [];
    const sent: Array<string> = [];

    for (let index: number = 0; index < count; index++) {
      const id: string = ObjectID.generate().toString().toLowerCase();
      people.push(id);

      for (let copy: number = 0; copy <= random(3); copy++) {
        sent.push(random(2) === 0 ? id : id.toUpperCase());
      }
    }

    return { sent, people };
  };

  test("a page at most: every person once, however often or in whatever case they are named", () => {
    const random: SeededRandom = seededRandom(9993);

    for (let round: number = 0; round < 50; round++) {
      const count: number =
        1 + random(MAX_PEOPLE_PER_SAVED_SIGN_IN_SETTINGS_ASK);
      const page: { sent: Array<string>; people: Array<string> } = pageOfIds(
        random,
        count,
      );

      expect(
        readSavedSignInSettingsOfPeopleRequest({ userIds: page.sent }).map(
          (id: ObjectID): string => {
            return id.toString();
          },
        ),
      ).toEqual(page.people);
    }
  });

  test("more people than a page is refused, before anything is read", () => {
    const random: SeededRandom = seededRandom(19993);
    const page: { sent: Array<string>; people: Array<string> } = pageOfIds(
      random,
      MAX_PEOPLE_PER_SAVED_SIGN_IN_SETTINGS_ASK + 1,
    );

    expect(() => {
      readSavedSignInSettingsOfPeopleRequest({ userIds: page.sent });
    }).toThrow(
      new BadDataException(SAVED_SIGN_IN_SETTINGS_OF_PEOPLE_TOO_MANY_MESSAGE),
    );
  });

  test("the Dashboard's ask is what the server reads", () => {
    const sent: unknown = toSavedSignInSettingsOfPeopleRequestJSON([
      ` ${ids[0]!.toUpperCase()} `,
      ids[0]!,
      "",
      ids[1]!,
    ]);

    expect(sent).toEqual({ userIds: ids });
    expect(
      readSavedSignInSettingsOfPeopleRequest(sent).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual(ids);
  });
});

describe("one member at a time: the answer", () => {
  const alice: PersonSavedSignInSettings = {
    userId: "aa000000-0000-4000-8000-00000000000a",
    settings: { ...NO_LOCAL_SIGN_IN_SETTINGS, hasPassword: true },
  };
  const bob: PersonSavedSignInSettings = {
    userId: "bb000000-0000-4000-8000-00000000000b",
    settings: { ...NO_LOCAL_SIGN_IN_SETTINGS, hasPasswordResetLink: true },
  };

  test("reads each person the route sent, with what they have", () => {
    expect(
      readSavedSignInSettingsOfPeopleAnswer(
        toSavedSignInSettingsOfPeopleAnswerJSON([alice, bob]),
      ),
    ).toEqual([alice, bob]);
  });

  test("an empty list is nobody", () => {
    expect(readSavedSignInSettingsOfPeopleAnswer({ people: [] })).toEqual([]);
  });

  test.each([[null], [[]], [{}], [{ people: "everyone" }]])(
    "anything that is no list is no answer: %j",
    (answer: unknown) => {
      expect(readSavedSignInSettingsOfPeopleAnswer(answer)).toBeNull();
    },
  );

  test("a row with no id, a bad id, broken settings or nothing saved is dropped; a person once", () => {
    expect(
      readSavedSignInSettingsOfPeopleAnswer({
        people: [
          { settings: alice.settings },
          { userId: "everyone", settings: alice.settings },
          { userId: alice.userId, settings: { hasPassword: "yes" } },
          { userId: bob.userId, settings: NO_LOCAL_SIGN_IN_SETTINGS },
          { userId: alice.userId.toUpperCase(), settings: alice.settings },
          { userId: alice.userId, settings: EVERYTHING },
          "alice",
        ],
      }),
    ).toEqual([alice]);
  });
});
