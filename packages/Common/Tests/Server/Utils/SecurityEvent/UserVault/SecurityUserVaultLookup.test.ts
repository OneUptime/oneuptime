import SecurityUserVaultService from "../../../../../Server/Services/SecurityUserVaultService";
import SecurityUserVaultLookup, {
  nameHashedUser,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserVaultLookup";
import ScrubHashToken from "../../../../../Server/Utils/Telemetry/ScrubHashToken";
import {
  SecurityEntity,
  SecurityEntityType,
  canActOnSecurityEntity,
  mergeSecurityEntities,
} from "../../../../../Types/SecurityCase/SecurityEntity";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../../Types/SecurityEvent/OcsfSeverity";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityTelemetrySignal,
  SecurityTelemetrySourceKind,
} from "../../../../../Types/SecurityEvent/SecurityTelemetrySource";
import {
  HASHED_USER_ATTRIBUTES,
  SCRUBBED_USER_ATTRIBUTES,
  ScrubbedUserRole,
  readHiddenEventUser,
} from "../../../../../Utils/SecurityEvent/ScrubbedUser";
import { buildTelemetrySecurityEvent } from "../../../../../Utils/SecurityEvent/TelemetryScan/TelemetrySecurityEvent";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/*
 * SECURITY EVENTS' HALF OF THE USER VAULT (#10632): a page's user tokens
 * looked up in one query, and each event whose token the vault holds
 * named by the user behind it - as if the record had held them - with the
 * marker that said a rule hid them cleared and what the rule left kept.
 * A token the vault does not hold, or a lookup that fails, leaves the
 * event as it was: its user is the token, which no playbook acts on.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10632000-0000-4000-8000-0000000000c1",
);

function tokenOf(value: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value });
}

const MALLORY: string = "mallory@acme.com";
const EVE: string = "eve@acme.com";

// A failed sign-in a span recorded, its users as the rules left them.
function signIn(data: {
  principalUser?: string;
  targetUser?: string;
}): NormalizedSecurityEvent {
  return buildTelemetrySecurityEvent({
    kind: SecurityTelemetrySourceKind.Traces,
    signal: SecurityTelemetrySignal.WebAttack,
    time: new Date("2026-11-24T10:00:00.000Z"),
    eventUid: `trace:${Math.random()}`,
    classUid: 3002,
    activityName: "Logon",
    statusName: "Failure",
    severity: OcsfSeverity.Medium,
    message: `Failed sign-in for ${data.principalUser || "nobody"}`,
    principalUser: data.principalUser,
    targetUser: data.targetUser,
    principalIp: "203.0.113.7",
    attributes: data.principalUser ? { "enduser.id": data.principalUser } : {},
  });
}

let vault: Record<string, string> = {};
let lookups: Array<ReadonlyArray<string>> = [];

beforeEach(() => {
  vault = {};
  lookups = [];

  jest
    .spyOn(SecurityUserVaultService, "findUsersOfTokens")
    .mockImplementation(
      async (data: {
        tokens: ReadonlyArray<string>;
      }): Promise<Map<string, string>> => {
        lookups.push(data.tokens);

        const found: Map<string, string> = new Map<string, string>();

        for (const token of data.tokens) {
          if (vault[token]) {
            found.set(token, vault[token]!);
          }
        }

        return found;
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("naming a user behind its tokens", () => {
  test("a whole token, or a token inside a user id", () => {
    const users: Map<string, string> = new Map([
      [tokenOf(MALLORY), MALLORY],
      [tokenOf("5f7c8ec7c33c"), "5f7c8ec7c33c"],
    ]);

    expect(nameHashedUser(tokenOf(MALLORY), users)).toBe(MALLORY);
    expect(nameHashedUser(`auth0|${tokenOf("5f7c8ec7c33c")}`, users)).toBe(
      "auth0|5f7c8ec7c33c",
    );
  });

  test("only when the vault holds every token in it", () => {
    const users: Map<string, string> = new Map([[tokenOf(MALLORY), MALLORY]]);

    expect(
      nameHashedUser(`${tokenOf(MALLORY)},${tokenOf(EVE)}`, users),
    ).toBeNull();
    expect(nameHashedUser(tokenOf(EVE), users)).toBeNull();
    // No token of today: nothing to name.
    expect(nameHashedUser("[HASHED:8c87b489]", users)).toBeNull();
    expect(nameHashedUser(MALLORY, users)).toBeNull();
  });
});

describe("a page of events", () => {
  test("a failed sign-in whose user a Hash rule hid is named once the vault knows the token", async () => {
    vault = { [tokenOf(MALLORY)]: MALLORY };

    const event: NormalizedSecurityEvent = signIn({
      principalUser: tokenOf(MALLORY),
    });

    // As the scan made it: the token is the user, and the event says a rule hid it.
    expect(event.principalUser).toBe(tokenOf(MALLORY));
    expect(
      readHiddenEventUser(event, ScrubbedUserRole.Principal),
    ).not.toBeNull();

    expect(
      await SecurityUserVaultLookup.nameHashedUsers({
        projectId: PROJECT_ID,
        events: [event],
      }),
    ).toBe(1);

    expect(event.principalUser).toBe(MALLORY);
    expect(event.observables).toContain(MALLORY);
    expect(event.observables).not.toContain(tokenOf(MALLORY));
    // The request's user, as the span named it.
    expect(event.attributes["enduser.id"]).toBe(MALLORY);
    // Nothing says a rule hid them; what the rule left is kept to search with.
    expect(readHiddenEventUser(event, ScrubbedUserRole.Principal)).toBeNull();
    for (const key of Object.values(
      SCRUBBED_USER_ATTRIBUTES[ScrubbedUserRole.Principal],
    )) {
      expect(event.attributes[key]).toBeUndefined();
    }
    expect(
      event.attributes[HASHED_USER_ATTRIBUTES[ScrubbedUserRole.Principal]],
    ).toBe(tokenOf(MALLORY));
    // Its message keeps what the record said.
    expect(event.message).toBe(`Failed sign-in for ${tokenOf(MALLORY)}`);
  });

  test("the named user is an account a playbook can act on, as any other user", async () => {
    vault = { [tokenOf(MALLORY)]: MALLORY };

    const event: NormalizedSecurityEvent = signIn({
      principalUser: tokenOf(MALLORY),
    });

    await SecurityUserVaultLookup.nameHashedUsers({
      projectId: PROJECT_ID,
      events: [event],
    });

    const entities: Array<SecurityEntity> = mergeSecurityEntities([
      { type: SecurityEntityType.User, value: event.principalUser! },
    ]);

    expect(entities).toEqual([
      { type: SecurityEntityType.User, value: MALLORY },
    ]);
    expect(canActOnSecurityEntity(entities[0]!)).toBe(true);
  });

  test("a token the vault does not know stays hidden, and is never a playbook target", async () => {
    vault = { [tokenOf(MALLORY)]: MALLORY };

    const event: NormalizedSecurityEvent = signIn({
      principalUser: tokenOf(EVE),
    });

    expect(
      await SecurityUserVaultLookup.nameHashedUsers({
        projectId: PROJECT_ID,
        events: [event],
      }),
    ).toBe(0);

    expect(event.principalUser).toBe(tokenOf(EVE));
    expect(
      readHiddenEventUser(event, ScrubbedUserRole.Principal),
    ).not.toBeNull();
    expect(
      event.attributes[HASHED_USER_ATTRIBUTES[ScrubbedUserRole.Principal]],
    ).toBeUndefined();

    const entities: Array<SecurityEntity> = mergeSecurityEntities([
      { type: SecurityEntityType.User, value: event.principalUser! },
    ]);

    expect(entities).toEqual([
      { type: SecurityEntityType.Other, value: tokenOf(EVE) },
    ]);
    expect(
      canActOnSecurityEntity({
        type: SecurityEntityType.User,
        value: tokenOf(EVE),
      }),
    ).toBe(false);
  });

  test("who acted and who was acted on, each by its own token, in one lookup a page", async () => {
    vault = { [tokenOf(MALLORY)]: MALLORY, [tokenOf(EVE)]: EVE };

    const events: Array<NormalizedSecurityEvent> = [
      signIn({ principalUser: tokenOf(MALLORY), targetUser: tokenOf(EVE) }),
      signIn({ principalUser: tokenOf(EVE) }),
      signIn({ principalUser: "jane@acme.com" }),
      signIn({}),
    ];

    expect(
      await SecurityUserVaultLookup.nameHashedUsers({
        projectId: PROJECT_ID,
        events,
      }),
    ).toBe(3);

    expect(lookups).toHaveLength(1);
    expect([...lookups[0]!].sort()).toEqual(
      [tokenOf(MALLORY), tokenOf(EVE), tokenOf(EVE)].sort(),
    );
    expect(
      events.map((event: NormalizedSecurityEvent): Array<string> => {
        return [event.principalUser || "", event.targetUser || ""];
      }),
    ).toEqual([
      [MALLORY, EVE],
      [EVE, ""],
      ["jane@acme.com", ""],
      ["", ""],
    ]);
    expect(
      events[0]!.attributes[HASHED_USER_ATTRIBUTES[ScrubbedUserRole.Target]],
    ).toBe(tokenOf(EVE));
  });

  test("a user id with a token inside it is named with the token's user in its place", async () => {
    vault = { [tokenOf("5f7c8ec7c33c")]: "5f7c8ec7c33c" };

    const event: NormalizedSecurityEvent = signIn({
      principalUser: `auth0|${tokenOf("5f7c8ec7c33c")}`,
    });

    await SecurityUserVaultLookup.nameHashedUsers({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(event.principalUser).toBe("auth0|5f7c8ec7c33c");
  });

  test("a page with no token asks nothing, nor one with only tokens of the form before keys", async () => {
    expect(
      await SecurityUserVaultLookup.nameHashedUsers({
        projectId: PROJECT_ID,
        events: [
          signIn({ principalUser: "jane@acme.com" }),
          signIn({ principalUser: "[HASHED:8c87b489]" }),
          signIn({}),
        ],
      }),
    ).toBe(0);

    expect(lookups).toHaveLength(0);
  });

  test("a lookup that fails leaves every event as it was, and never throws", async () => {
    jest
      .spyOn(SecurityUserVaultService, "findUsersOfTokens")
      .mockRejectedValue(new Error("ClickHouse is down") as never);

    const event: NormalizedSecurityEvent = signIn({
      principalUser: tokenOf(MALLORY),
    });

    await expect(
      SecurityUserVaultLookup.nameHashedUsers({
        projectId: PROJECT_ID,
        events: [event],
      }),
    ).resolves.toBe(0);

    expect(event.principalUser).toBe(tokenOf(MALLORY));
  });

  test("the request's user is named only when it was the token", async () => {
    vault = { [tokenOf(MALLORY)]: MALLORY };

    const event: NormalizedSecurityEvent = signIn({
      principalUser: tokenOf(MALLORY),
    });
    event.attributes["enduser.id"] = "someone-else";

    await SecurityUserVaultLookup.nameHashedUsers({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(event.principalUser).toBe(MALLORY);
    expect(event.attributes["enduser.id"]).toBe("someone-else");
  });
});
