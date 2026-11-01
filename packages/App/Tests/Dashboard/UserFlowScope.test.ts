import { describe, expect, test } from "@jest/globals";
import { UserFlowScopeDto } from "Common/Types/Rum/UserFlow";
import {
  buildUserFlowScopeOptions,
  describeUserFlowScopePerson,
  describeUserFlowSessionOwner,
  getUserFlowScopeFilters,
  getUserFlowScopeKey,
  getUserFlowScopeOfRollup,
  getUserFlowScopeOfSessionOwner,
  isUserFlowResponseForScope,
  parseUserFlowScopeInput,
  USER_FLOW_SCOPE_MAX_OPTIONS,
  UserFlowScope,
  UserFlowScopeOption,
  UserFlowScopeOptionUser,
} from "../../FeatureSet/Dashboard/src/Components/UserFlow/UserFlowScope";
import { parseSessionReplaySearch } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplaySearchQuery";

/*
 * What the User Flows page can be narrowed to, and how: what a typed line
 * means, what goes on the wire, when an answer may be drawn, who the banner
 * names and what the filter's list offers.
 */

const KEY: string = "a".repeat(64);
const VISITOR: string = "0123456789abcdef0123456789abcdef";
const SESSION: string = "fedcba9876543210fedcba9876543210";

function user(reference: string): UserFlowScope {
  return { kind: "user", identifiedUserKey: "", identifiedUserRef: reference };
}

function applied(overrides: Partial<UserFlowScopeDto>): UserFlowScopeDto {
  return {
    kind: "user",
    identifiedUserKey: "",
    visitorId: "",
    sessionId: "",
    ...overrides,
  };
}

function rollup(
  overrides: Partial<UserFlowScopeOptionUser>,
): UserFlowScopeOptionUser {
  return {
    groupKey: `u:${KEY}`,
    kind: "identified",
    identifiedUserKey: KEY,
    visitorId: "",
    identifiedUserLabel: "jane@example.com",
    isIdentityVisible: true,
    sessionCount: 3,
    ...overrides,
  };
}

describe("parseUserFlowScopeInput", () => {
  test("nothing yet is nothing to ask", () => {
    expect(parseUserFlowScopeInput("")).toBeNull();
    expect(parseUserFlowScopeInput("   ")).toBeNull();
  });

  test("anything without a token is a reference, however it looks", () => {
    for (const reference of [
      "jane@example.com",
      "U-1000",
      "42",
      "Jane Doe",
      "auth0|5f3a9c",
      "urn:customer:1",
      "http://not-a-url.example.com",
      "a1b2c3d4",
    ]) {
      expect(parseUserFlowScopeInput(reference)).toEqual(user(reference));
    }
  });

  test("a reference keeps its case: two cases can be two customers", () => {
    expect(parseUserFlowScopeInput("U-1000")).toEqual(user("U-1000"));
    expect(parseUserFlowScopeInput("u-1000")).toEqual(user("u-1000"));
  });

  test("surrounding space is not part of anything", () => {
    expect(parseUserFlowScopeInput("  jane@example.com  ")).toEqual(
      user("jane@example.com"),
    );
    expect(parseUserFlowScopeInput(`  ${SESSION}  `)).toEqual({
      kind: "session",
      sessionId: SESSION,
    });
  });

  test("a bare long hex string is the session id people paste", () => {
    expect(parseUserFlowScopeInput(SESSION)).toEqual({
      kind: "session",
      sessionId: SESSION,
    });
    expect(parseUserFlowScopeInput(SESSION.toUpperCase())).toEqual({
      kind: "session",
      sessionId: SESSION,
    });
  });

  test("user: reaches a reference of any shape, a hex one included", () => {
    expect(parseUserFlowScopeInput(`user:${SESSION}`)).toEqual(user(SESSION));
    expect(parseUserFlowScopeInput("user:jane@example.com")).toEqual(
      user("jane@example.com"),
    );
    expect(parseUserFlowScopeInput('user:"Jane Doe"')).toEqual(
      user("Jane Doe"),
    );
    expect(parseUserFlowScopeInput("USER:foo:bar")).toEqual(user("foo:bar"));
  });

  test("a token with nothing after it asks nothing", () => {
    expect(parseUserFlowScopeInput("user:")).toBeNull();
    expect(parseUserFlowScopeInput("id:")).toBeNull();
    expect(parseUserFlowScopeInput("visitor:")).toBeNull();
  });

  test("visitor: takes the whole id, and nothing less", () => {
    expect(parseUserFlowScopeInput(`visitor:${VISITOR}`)).toEqual({
      kind: "visitor",
      visitorId: VISITOR,
    });
    expect(parseUserFlowScopeInput(`Visitor:${VISITOR.toUpperCase()}`)).toEqual(
      { kind: "visitor", visitorId: VISITOR },
    );
    expect(parseUserFlowScopeInput("visitor:abc123")).toBeNull();
  });

  test("id: and session: take a whole session id, and nothing less", () => {
    for (const token of ["id", "session", "ID", "Session"]) {
      expect(parseUserFlowScopeInput(`${token}:${SESSION}`)).toEqual({
        kind: "session",
        sessionId: SESSION,
      });
    }

    expect(parseUserFlowScopeInput("id:a1b2c3d4")).toBeNull();
  });

  test("it reads user: and visitor: as the session list's search box does", () => {
    expect(
      parseSessionReplaySearch("user:jane@example.com").advanced
        .identifiedUserRef,
    ).toBe("jane@example.com");
    expect(parseUserFlowScopeInput("user:jane@example.com")).toEqual(
      user("jane@example.com"),
    );

    expect(
      parseSessionReplaySearch(`visitor:${VISITOR}`).advanced.visitorId,
    ).toBe(VISITOR);
    expect(parseUserFlowScopeInput(`visitor:${VISITOR}`)).toEqual({
      kind: "visitor",
      visitorId: VISITOR,
    });

    expect(parseSessionReplaySearch(`id:${SESSION}`).navigateToSessionId).toBe(
      SESSION,
    );
    expect(parseUserFlowScopeInput(`id:${SESSION}`)).toEqual({
      kind: "session",
      sessionId: SESSION,
    });
  });
});

describe("getUserFlowScopeFilters", () => {
  test("each scope asks with the endpoint's own field", () => {
    expect(getUserFlowScopeFilters(user("jane@example.com"))).toEqual({
      identifiedUserRef: "jane@example.com",
    });
    expect(
      getUserFlowScopeFilters({ kind: "visitor", visitorId: VISITOR }),
    ).toEqual({ visitorId: VISITOR });
    expect(
      getUserFlowScopeFilters({ kind: "session", sessionId: SESSION }),
    ).toEqual({ sessionId: SESSION });
  });

  test("a person with a key is asked for by the key, never the label", () => {
    const filters: unknown = getUserFlowScopeFilters({
      kind: "user",
      identifiedUserKey: KEY,
      identifiedUserRef: "jane@example.com",
    });

    expect(filters).toEqual({ identifiedUserKey: KEY });
  });
});

describe("getUserFlowScopeKey", () => {
  test("everyone is empty, and each person a key of their own", () => {
    expect(getUserFlowScopeKey(null)).toBe("");

    const keys: Array<string> = [
      user("a"),
      user("b"),
      { kind: "visitor", visitorId: VISITOR },
      { kind: "session", sessionId: SESSION },
    ].map((scope: UserFlowScope): string => {
      return getUserFlowScopeKey(scope);
    });

    expect(new Set(keys).size).toBe(4);
  });

  test("a label learned later does not ask again", () => {
    expect(
      getUserFlowScopeKey({
        kind: "user",
        identifiedUserKey: KEY,
        identifiedUserRef: "",
      }),
    ).toBe(
      getUserFlowScopeKey({
        kind: "user",
        identifiedUserKey: KEY,
        identifiedUserRef: "jane@example.com",
      }),
    );
  });
});

describe("isUserFlowResponseForScope", () => {
  test("a read over everyone expects no scope", () => {
    expect(isUserFlowResponseForScope(null, null)).toBe(true);
    expect(
      isUserFlowResponseForScope(null, applied({ identifiedUserKey: KEY })),
    ).toBe(false);
  });

  /* The answer of a server older than the Dashboard: everyone's journeys. */
  test("a narrowed read answered with no scope may not be drawn", () => {
    for (const scope of [
      user("jane@example.com"),
      { kind: "visitor", visitorId: VISITOR } as UserFlowScope,
      { kind: "session", sessionId: SESSION } as UserFlowScope,
    ]) {
      expect(isUserFlowResponseForScope(scope, null)).toBe(false);
    }
  });

  test("a typed reference matches whatever key the server hashed it to", () => {
    expect(
      isUserFlowResponseForScope(
        user("jane@example.com"),
        applied({ identifiedUserKey: KEY }),
      ),
    ).toBe(true);
  });

  test("somebody else's answer may not be drawn", () => {
    expect(
      isUserFlowResponseForScope(
        { kind: "user", identifiedUserKey: KEY, identifiedUserRef: "" },
        applied({ identifiedUserKey: "b".repeat(64) }),
      ),
    ).toBe(false);
    expect(
      isUserFlowResponseForScope(
        { kind: "visitor", visitorId: VISITOR },
        applied({ kind: "visitor", visitorId: "c".repeat(32) }),
      ),
    ).toBe(false);
    expect(
      isUserFlowResponseForScope(
        { kind: "session", sessionId: SESSION },
        applied({ kind: "session", sessionId: "other" }),
      ),
    ).toBe(false);
    expect(
      isUserFlowResponseForScope(
        { kind: "session", sessionId: SESSION },
        applied({ kind: "user", identifiedUserKey: KEY }),
      ),
    ).toBe(false);
  });

  test("the right answer may", () => {
    expect(
      isUserFlowResponseForScope(
        { kind: "visitor", visitorId: VISITOR },
        applied({ kind: "visitor", visitorId: VISITOR }),
      ),
    ).toBe(true);
    expect(
      isUserFlowResponseForScope(
        { kind: "session", sessionId: SESSION },
        applied({
          kind: "session",
          sessionId: SESSION,
          identifiedUserKey: KEY,
        }),
      ),
    ).toBe(true);
  });
});

describe("getUserFlowScopeOfRollup", () => {
  test("an identified row is its key, and its label if the role may read it", () => {
    expect(getUserFlowScopeOfRollup(rollup({}))).toEqual({
      kind: "user",
      identifiedUserKey: KEY,
      identifiedUserRef: "jane@example.com",
    });
    expect(
      getUserFlowScopeOfRollup(rollup({ identifiedUserLabel: undefined })),
    ).toEqual({
      kind: "user",
      identifiedUserKey: KEY,
      identifiedUserRef: "",
    });
  });

  test("a visitor row is its browser", () => {
    expect(
      getUserFlowScopeOfRollup(
        rollup({
          kind: "visitor",
          identifiedUserKey: "",
          visitorId: VISITOR,
        }),
      ),
    ).toEqual({ kind: "visitor", visitorId: VISITOR });
  });

  test("the unlinked bucket is nobody in particular", () => {
    expect(
      getUserFlowScopeOfRollup(
        rollup({ kind: "anonymous", identifiedUserKey: "", visitorId: "" }),
      ),
    ).toBeNull();
  });
});

describe("getUserFlowScopeOfSessionOwner", () => {
  test("only a session has an owner to widen to", () => {
    expect(getUserFlowScopeOfSessionOwner(null)).toBeNull();
    expect(
      getUserFlowScopeOfSessionOwner(
        applied({ identifiedUserKey: KEY, visitorId: VISITOR }),
      ),
    ).toBeNull();
  });

  test("an identified owner wins over the browser", () => {
    expect(
      getUserFlowScopeOfSessionOwner(
        applied({
          kind: "session",
          sessionId: SESSION,
          identifiedUserKey: KEY,
          visitorId: VISITOR,
          identifiedUserLabel: "jane@example.com",
        }),
      ),
    ).toEqual({
      kind: "user",
      identifiedUserKey: KEY,
      identifiedUserRef: "jane@example.com",
    });
  });

  test("an anonymous session widens to its browser", () => {
    expect(
      getUserFlowScopeOfSessionOwner(
        applied({
          kind: "session",
          sessionId: SESSION,
          visitorId: VISITOR,
        }),
      ),
    ).toEqual({ kind: "visitor", visitorId: VISITOR });
  });

  test("a session linked to nobody has nowhere to widen to", () => {
    expect(
      getUserFlowScopeOfSessionOwner(
        applied({ kind: "session", sessionId: SESSION }),
      ),
    ).toBeNull();
  });
});

describe("describeUserFlowScopePerson", () => {
  test("the name someone typed shows at once, before the server answers", () => {
    expect(
      describeUserFlowScopePerson(user("jane@example.com"), null),
    ).toMatchObject({ kind: "identified", text: "jane@example.com" });
  });

  test("a link holds only the key: the server's label names them", () => {
    expect(
      describeUserFlowScopePerson(
        { kind: "user", identifiedUserKey: KEY, identifiedUserRef: "" },
        applied({
          identifiedUserKey: KEY,
          identifiedUserLabel: "jane@example.com",
        }),
      ),
    ).toMatchObject({ kind: "identified", text: "jane@example.com" });
  });

  test("a role that may not read the label sees Hidden, not Anonymous", () => {
    expect(
      describeUserFlowScopePerson(
        { kind: "user", identifiedUserKey: KEY, identifiedUserRef: "" },
        applied({ identifiedUserKey: KEY }),
      ),
    ).toMatchObject({ kind: "hidden", text: "Hidden" });
  });

  test("while nobody knows yet the text is empty, for the page to word", () => {
    const pending: ReturnType<typeof describeUserFlowScopePerson> =
      describeUserFlowScopePerson(
        { kind: "user", identifiedUserKey: KEY, identifiedUserRef: "" },
        null,
      );

    expect(pending?.text).toBe("");
    /* One person, one colour, already. */
    expect(pending?.hue).not.toBeNull();
  });

  test("a role that may read it, with no session to say, is not called Hidden", () => {
    const person: ReturnType<typeof describeUserFlowScopePerson> =
      describeUserFlowScopePerson(
        { kind: "user", identifiedUserKey: KEY, identifiedUserRef: "" },
        applied({ identifiedUserKey: KEY, identifiedUserLabel: "" }),
      );

    expect(person?.kind).toBe("identified");
    expect(person?.text).toBe("");
  });

  test("a visitor reads as the Users page reads them", () => {
    expect(
      describeUserFlowScopePerson(
        { kind: "visitor", visitorId: VISITOR },
        null,
      ),
    ).toMatchObject({ kind: "visitor", text: "Visitor 012345" });
  });

  test("a session is not a person", () => {
    expect(
      describeUserFlowScopePerson(
        { kind: "session", sessionId: SESSION },
        null,
      ),
    ).toBeNull();
  });
});

describe("describeUserFlowSessionOwner", () => {
  test("names the owner by the same ranking", () => {
    expect(
      describeUserFlowSessionOwner(
        applied({
          kind: "session",
          sessionId: SESSION,
          identifiedUserKey: KEY,
          identifiedUserLabel: "jane@example.com",
        }),
      ),
    ).toMatchObject({ kind: "identified", text: "jane@example.com" });

    expect(
      describeUserFlowSessionOwner(
        applied({
          kind: "session",
          sessionId: SESSION,
          identifiedUserKey: KEY,
        }),
      ),
    ).toMatchObject({ kind: "hidden" });

    expect(
      describeUserFlowSessionOwner(
        applied({ kind: "session", sessionId: SESSION, visitorId: VISITOR }),
      ),
    ).toMatchObject({ kind: "visitor", text: "Visitor 012345" });
  });

  test("a session of nobody, or no session, has no owner", () => {
    expect(describeUserFlowSessionOwner(null)).toBeNull();
    expect(
      describeUserFlowSessionOwner(
        applied({ kind: "session", sessionId: SESSION }),
      ),
    ).toBeNull();
  });
});

describe("buildUserFlowScopeOptions", () => {
  const VISITOR_ROW: UserFlowScopeOptionUser = rollup({
    groupKey: `v:${VISITOR}`,
    kind: "visitor",
    identifiedUserKey: "",
    visitorId: VISITOR,
    identifiedUserLabel: undefined,
    isIdentityVisible: false,
    sessionCount: 1,
  });

  function kinds(options: Array<UserFlowScopeOption>): Array<string> {
    return options.map((option: UserFlowScopeOption): string => {
      return option.kind;
    });
  }

  test("an empty box offers the people in the range", () => {
    expect(
      kinds(buildUserFlowScopeOptions("", [rollup({}), VISITOR_ROW])),
    ).toEqual(["person", "person"]);
  });

  test("the unlinked bucket is never offered: nothing selects it", () => {
    expect(
      buildUserFlowScopeOptions("", [
        rollup({
          groupKey: "",
          kind: "anonymous",
          identifiedUserKey: "",
          identifiedUserLabel: undefined,
        }),
      ]),
    ).toEqual([]);
  });

  test("typing narrows the people, and always offers to look it up", () => {
    const options: Array<UserFlowScopeOption> = buildUserFlowScopeOptions(
      "JANE",
      [
        rollup({}),
        rollup({ groupKey: "u:b", identifiedUserLabel: "bob@x.io" }),
      ],
    );

    expect(kinds(options)).toEqual(["typed", "person"]);
    expect(options[0]?.scope).toEqual(user("JANE"));
    expect(options[1]?.id).toBe(`u:${KEY}`);
  });

  test("someone nobody listed can still be looked up", () => {
    const options: Array<UserFlowScopeOption> = buildUserFlowScopeOptions(
      "carol@example.com",
      [rollup({})],
    );

    expect(kinds(options)).toEqual(["typed"]);
  });

  test("a name listed exactly is offered once, with its session count", () => {
    expect(
      kinds(buildUserFlowScopeOptions("jane@example.com", [rollup({})])),
    ).toEqual(["person"]);
  });

  test("a visitor is found by their visitor id", () => {
    const options: Array<UserFlowScopeOption> = buildUserFlowScopeOptions(
      "012345",
      [VISITOR_ROW],
    );

    expect(kinds(options)).toEqual(["typed", "person"]);
    expect(options[1]?.scope).toEqual({ kind: "visitor", visitorId: VISITOR });
  });

  test("a label a role may not read is never searched", () => {
    const options: Array<UserFlowScopeOption> = buildUserFlowScopeOptions(
      "jane",
      [
        rollup({
          identifiedUserLabel: undefined,
          isIdentityVisible: false,
        }),
      ],
    );

    expect(kinds(options)).toEqual(["typed"]);
  });

  test("a hidden person is still offered, by key, for a role with no label", () => {
    const options: Array<UserFlowScopeOption> = buildUserFlowScopeOptions("", [
      rollup({ identifiedUserLabel: undefined, isIdentityVisible: false }),
    ]);

    expect(options[0]?.scope).toEqual({
      kind: "user",
      identifiedUserKey: KEY,
      identifiedUserRef: "",
    });
  });

  test("a session id is offered as a session", () => {
    expect(buildUserFlowScopeOptions(SESSION, [])[0]?.scope).toEqual({
      kind: "session",
      sessionId: SESSION,
    });
  });

  test("text that can ask nothing, and matches nobody, offers nothing", () => {
    expect(buildUserFlowScopeOptions("visitor:abc", [rollup({})])).toEqual([]);
  });

  test("the list stops at a size the eye can scan", () => {
    const users: Array<UserFlowScopeOptionUser> = Array.from(
      { length: 30 },
      (_value: unknown, index: number): UserFlowScopeOptionUser => {
        return rollup({
          groupKey: `u:${index}`,
          identifiedUserLabel: `person-${index}@example.com`,
        });
      },
    );

    expect(buildUserFlowScopeOptions("person", users)).toHaveLength(
      USER_FLOW_SCOPE_MAX_OPTIONS,
    );
    /* The typed row is first, so a long list never hides it. */
    expect(buildUserFlowScopeOptions("person", users)[0]?.kind).toBe("typed");
  });
});
