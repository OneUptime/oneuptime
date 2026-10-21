import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService - the base class
 * of the service below - imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import McpOAuthClientService, {
  RegisteredMcpOAuthClient,
  Service as McpOAuthClientServiceClass,
} from "../../../Server/Services/McpOAuthClientService";
import McpOAuthClient from "../../../Models/DatabaseModels/McpOAuthClient";
import McpOAuthClientAuthMethod from "../../../Types/Mcp/McpOAuthClientAuthMethod";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { createHash } from "crypto";

/*
 * Clients that registered themselves through Dynamic Client Registration.
 * Registration is open to anyone who can reach the endpoint, so what this
 * service keeps - and how it lets go of it - is the whole of what makes that
 * safe:
 *
 *   - a client that asked for a secret gets one ONCE, in the response; the
 *     row keeps its SHA-256 and nothing that can be turned back into it;
 *   - a public client (what nearly every MCP client is) is issued no secret
 *     at all;
 *   - a client id that is not a UUID is not a row here, and is refused before
 *     it reaches a uuid column;
 *   - `lastUsedAt` is what bounds the table: it is set at registration,
 *     refreshed at most daily, and a registration unused for 90 days is swept.
 *
 * No database: every DatabaseService method underneath is spied.
 */

type SpyInstance = ReturnType<typeof getJestSpyOn>;

const CLIENT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const REDIRECT_URIS: Array<string> = [
  "http://127.0.0.1/callback",
  "https://client.example.com/oauth/callback",
];

const ONE_DAY_MS: number = 24 * 60 * 60 * 1000;

const CLIENT_SECRET_PATTERN: RegExp = /^oumcp_cs_[A-Za-z0-9_-]{43}$/;
const SHA256_HEX_PATTERN: RegExp = /^[0-9a-f]{64}$/;

// An independent oracle: not McpOAuthSecret.hash, which is the code under test.
const sha256Hex: (value: string) => string = (value: string): string => {
  return createHash("sha256").update(value, "utf8").digest("hex");
};

interface CreateCall {
  data: McpOAuthClient;
  props: Record<string, unknown>;
}

interface FindOneByIdCall {
  id: ObjectID;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
}

interface UpdateColumnsCall {
  id: ObjectID;
  data: Record<string, unknown>;
  skipUpdateDateColumn?: boolean;
}

interface RegistrationInput {
  clientName: string;
  clientUri?: string | undefined;
  redirectUris: Array<string>;
  tokenEndpointAuthMethod: McpOAuthClientAuthMethod;
}

const registration: (
  overrides?: Partial<RegistrationInput>,
) => RegistrationInput = (
  overrides: Partial<RegistrationInput> = {},
): RegistrationInput => {
  return {
    clientName: "Claude Code",
    redirectUris: REDIRECT_URIS,
    tokenEndpointAuthMethod: McpOAuthClientAuthMethod.None,
    ...overrides,
  };
};

/*
 * Every string reachable from a value, so "the secret is nowhere in what was
 * written" is asserted about the whole row.
 */
const collectStrings: (value: unknown, seen?: Set<unknown>) => Array<string> = (
  value: unknown,
  seen: Set<unknown> = new Set<unknown>(),
): Array<string> => {
  if (typeof value === "string") {
    return [value];
  }

  if (!value || typeof value !== "object" || seen.has(value)) {
    return [];
  }

  seen.add(value);

  if (value instanceof Date) {
    return [value.toISOString()];
  }

  const strings: Array<string> = [];

  for (const key of Object.keys(value as Record<string, unknown>)) {
    strings.push(key);
    strings.push(
      ...collectStrings((value as Record<string, unknown>)[key], seen),
    );
  }

  return strings;
};

const clientWith: (fields: {
  id?: ObjectID | undefined;
  lastUsedAt?: Date | undefined;
}) => McpOAuthClient = (fields: {
  id?: ObjectID | undefined;
  lastUsedAt?: Date | undefined;
}): McpOAuthClient => {
  const client: McpOAuthClient = new McpOAuthClient();

  if (fields.id) {
    client._id = fields.id.toString();
  }

  if (fields.lastUsedAt) {
    client.lastUsedAt = fields.lastUsedAt;
  }

  return client;
};

describe("McpOAuthClientService", () => {
  let createSpy: SpyInstance;
  let findOneByIdSpy: SpyInstance;
  let updateColumnsSpy: SpyInstance;

  const createdRow: () => McpOAuthClient = (): McpOAuthClient => {
    expect(createSpy).toHaveBeenCalledTimes(1);

    return (createSpy.mock.calls[0]![0] as CreateCall).data;
  };

  beforeEach(() => {
    createSpy = getJestSpyOn(
      McpOAuthClientService,
      "create",
    ).mockImplementation(
      async (createBy: CreateCall): Promise<McpOAuthClient> => {
        return createBy.data;
      },
    );
    findOneByIdSpy = getJestSpyOn(
      McpOAuthClientService,
      "findOneById",
    ).mockResolvedValue(null);
    updateColumnsSpy = getJestSpyOn(
      McpOAuthClientService,
      "updateColumnsByIdWithoutHooks",
    ).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("registerClient", () => {
    describe("a public client (token_endpoint_auth_method none)", () => {
      test("is issued no secret", async () => {
        const registered: RegisteredMcpOAuthClient =
          await McpOAuthClientService.registerClient(registration());

        expect(registered.clientSecret).toBeNull();
      });

      test("stores no secret digest", async () => {
        await McpOAuthClientService.registerClient(registration());

        expect(createdRow().clientSecretHash).toBeUndefined();
      });

      test("stores the method it registered with", async () => {
        await McpOAuthClientService.registerClient(registration());

        expect(createdRow().tokenEndpointAuthMethod).toBe(
          McpOAuthClientAuthMethod.None,
        );
      });
    });

    const confidentialMethods: Array<McpOAuthClientAuthMethod> = [
      McpOAuthClientAuthMethod.ClientSecretPost,
      McpOAuthClientAuthMethod.ClientSecretBasic,
    ];

    describe.each(confidentialMethods)(
      "a confidential client (%s)",
      (tokenEndpointAuthMethod: McpOAuthClientAuthMethod) => {
        test("is issued a secret of the documented shape", async () => {
          const registered: RegisteredMcpOAuthClient =
            await McpOAuthClientService.registerClient(
              registration({ tokenEndpointAuthMethod }),
            );

          expect(registered.clientSecret).toMatch(CLIENT_SECRET_PATTERN);
        });

        test("stores the secret's SHA-256, and the plaintext exists only in the return value", async () => {
          const registered: RegisteredMcpOAuthClient =
            await McpOAuthClientService.registerClient(
              registration({ tokenEndpointAuthMethod }),
            );

          const secret: string = registered.clientSecret!;
          const row: McpOAuthClient = createdRow();

          expect(row.clientSecretHash).toBe(sha256Hex(secret));
          expect(row.clientSecretHash).toMatch(SHA256_HEX_PATTERN);

          const secretBody: string = secret.slice("oumcp_cs_".length);

          for (const value of collectStrings(createSpy.mock.calls)) {
            expect(value).not.toContain(secret);
            expect(value).not.toContain(secretBody);
          }
        });

        test("stores the method it registered with", async () => {
          await McpOAuthClientService.registerClient(
            registration({ tokenEndpointAuthMethod }),
          );

          expect(createdRow().tokenEndpointAuthMethod).toBe(
            tokenEndpointAuthMethod,
          );
        });

        test("every registration gets its own secret", async () => {
          const first: RegisteredMcpOAuthClient =
            await McpOAuthClientService.registerClient(
              registration({ tokenEndpointAuthMethod }),
            );
          const second: RegisteredMcpOAuthClient =
            await McpOAuthClientService.registerClient(
              registration({ tokenEndpointAuthMethod }),
            );

          expect(first.clientSecret).not.toBe(second.clientSecret);
        });
      },
    );

    test("stores the name and the redirect URIs it was given", async () => {
      await McpOAuthClientService.registerClient(
        registration({ clientName: "Cursor" }),
      );

      const row: McpOAuthClient = createdRow();

      expect(row).toBeInstanceOf(McpOAuthClient);
      expect(row.clientName).toBe("Cursor");
      expect(row.redirectUris).toEqual(REDIRECT_URIS);
    });

    test("stores the client's home page when it gave one", async () => {
      await McpOAuthClientService.registerClient(
        registration({ clientUri: "https://client.example.com/" }),
      );

      expect(createdRow().clientUri).toBe("https://client.example.com/");
    });

    test("leaves the home page unset when it gave none", async () => {
      await McpOAuthClientService.registerClient(registration());

      expect(createdRow().clientUri).toBeUndefined();
    });

    test("an explicitly undefined home page is the same as none", async () => {
      await McpOAuthClientService.registerClient(
        registration({ clientUri: undefined }),
      );

      expect(createdRow().clientUri).toBeUndefined();
    });

    test("starts the unused-registration clock at registration", async () => {
      const before: number = Date.now();

      await McpOAuthClientService.registerClient(registration());

      const after: number = Date.now();
      const lastUsedAt: number = createdRow().lastUsedAt!.getTime();

      expect(lastUsedAt).toBeGreaterThanOrEqual(before);
      expect(lastUsedAt).toBeLessThanOrEqual(after);
    });

    test("is written as root - a registration belongs to no project and no user", async () => {
      await McpOAuthClientService.registerClient(registration());

      expect((createSpy.mock.calls[0]![0] as CreateCall).props).toEqual({
        isRoot: true,
      });
    });

    test("returns the row the database created, whose id is the client id", async () => {
      const created: McpOAuthClient = clientWith({ id: CLIENT_ID });

      createSpy.mockResolvedValue(created);

      const registered: RegisteredMcpOAuthClient =
        await McpOAuthClientService.registerClient(registration());

      expect(registered.client).toBe(created);
      expect(registered.client.id?.toString()).toBe(CLIENT_ID.toString());
    });

    test("a failed write registers nothing and issues no secret", async () => {
      createSpy.mockRejectedValue(new Error("database unavailable"));

      await expect(
        McpOAuthClientService.registerClient(
          registration({
            tokenEndpointAuthMethod: McpOAuthClientAuthMethod.ClientSecretBasic,
          }),
        ),
      ).rejects.toThrow("database unavailable");
    });
  });

  describe("findRegisteredClient", () => {
    const notUuids: Array<[string, string]> = [
      ["an empty string", ""],
      ["a word", "claude"],
      [
        "a metadata document URL",
        "https://claude.ai/oauth/mcp-client-metadata",
      ],
      [
        "a UUID with a character missing",
        "11111111-1111-4111-8111-11111111111",
      ],
      ["a UUID with a trailing space", "11111111-1111-4111-8111-111111111111 "],
      [
        "SQL where a UUID should be",
        "11111111-1111-4111-8111-111111111111' OR '1'='1",
      ],
    ];

    test.each(notUuids)(
      "%s is not a registration, and never reaches the uuid column",
      async (_label: string, clientId: string) => {
        await expect(
          McpOAuthClientService.findRegisteredClient(clientId),
        ).resolves.toBeNull();

        expect(findOneByIdSpy).not.toHaveBeenCalled();
      },
    );

    test("a UUID is looked up by id, reading what authentication and matching need", async () => {
      await McpOAuthClientService.findRegisteredClient(CLIENT_ID.toString());

      expect(findOneByIdSpy).toHaveBeenCalledTimes(1);

      const call: FindOneByIdCall = findOneByIdSpy.mock
        .calls[0]![0] as FindOneByIdCall;

      expect(call.id).toBeInstanceOf(ObjectID);
      expect(call.id.toString()).toBe(CLIENT_ID.toString());
      expect(call.select).toEqual({
        _id: true,
        clientName: true,
        clientUri: true,
        redirectUris: true,
        tokenEndpointAuthMethod: true,
        clientSecretHash: true,
        lastUsedAt: true,
      });
      expect(call.props).toEqual({ isRoot: true });
    });

    test("an unknown UUID is null", async () => {
      await expect(
        McpOAuthClientService.findRegisteredClient(CLIENT_ID.toString()),
      ).resolves.toBeNull();
    });

    test("hands back the registration it found", async () => {
      const client: McpOAuthClient = clientWith({ id: CLIENT_ID });

      findOneByIdSpy.mockResolvedValue(client);

      await expect(
        McpOAuthClientService.findRegisteredClient(CLIENT_ID.toString()),
      ).resolves.toBe(client);
    });
  });

  describe("touchLastUsed", () => {
    const NOW_MS: number = new Date("2026-10-01T12:00:00.000Z").getTime();

    // The method takes no clock, so the clock itself is pinned.
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(NOW_MS);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test("a client last used under a day ago is not written again", async () => {
      await McpOAuthClientService.touchLastUsed(
        clientWith({
          id: CLIENT_ID,
          lastUsedAt: new Date(NOW_MS - (ONE_DAY_MS - 1)),
        }),
      );

      expect(updateColumnsSpy).not.toHaveBeenCalled();
    });

    test("a client that refreshes hourly costs no write an hour", async () => {
      await McpOAuthClientService.touchLastUsed(
        clientWith({
          id: CLIENT_ID,
          lastUsedAt: new Date(NOW_MS - 60 * 60 * 1000),
        }),
      );

      expect(updateColumnsSpy).not.toHaveBeenCalled();
    });

    test("at exactly a day it is written again, with the current time", async () => {
      await McpOAuthClientService.touchLastUsed(
        clientWith({
          id: CLIENT_ID,
          lastUsedAt: new Date(NOW_MS - ONE_DAY_MS),
        }),
      );

      expect(updateColumnsSpy).toHaveBeenCalledTimes(1);

      const call: UpdateColumnsCall = updateColumnsSpy.mock
        .calls[0]![0] as UpdateColumnsCall;

      expect(call.id.toString()).toBe(CLIENT_ID.toString());
      expect(Object.keys(call.data)).toEqual(["lastUsedAt"]);
      expect((call.data["lastUsedAt"] as Date).getTime()).toBe(NOW_MS);
    });

    test("a client with no recorded use is written", async () => {
      await McpOAuthClientService.touchLastUsed(clientWith({ id: CLIENT_ID }));

      expect(updateColumnsSpy).toHaveBeenCalledTimes(1);
    });

    test("is a hook-free column write that leaves updatedAt alone", async () => {
      await McpOAuthClientService.touchLastUsed(clientWith({ id: CLIENT_ID }));

      const call: UpdateColumnsCall = updateColumnsSpy.mock
        .calls[0]![0] as UpdateColumnsCall;

      expect(call.skipUpdateDateColumn).toBe(true);
    });

    test("a client with no id is ignored", async () => {
      await McpOAuthClientService.touchLastUsed(clientWith({}));

      expect(updateColumnsSpy).not.toHaveBeenCalled();
    });

    test("a lastUsedAt that came back from the database as a string is read as a date", async () => {
      const client: McpOAuthClient = clientWith({ id: CLIENT_ID });

      (client as unknown as { lastUsedAt: string }).lastUsedAt = new Date(
        NOW_MS - 60 * 1000,
      ).toISOString();

      await McpOAuthClientService.touchLastUsed(client);

      expect(updateColumnsSpy).not.toHaveBeenCalled();
    });

    test("a failing write is swallowed: it must never fail the token exchange it rides along with", async () => {
      /*
       * Like the grant's touchLastUsed. The column only feeds a 90-day sweep;
       * losing one write costs nothing, and a rejection here would turn a
       * successful token exchange into a server error.
       */
      updateColumnsSpy.mockRejectedValue(new Error("database unavailable"));

      await expect(
        McpOAuthClientService.touchLastUsed(clientWith({ id: CLIENT_ID })),
      ).resolves.toBeUndefined();

      expect(updateColumnsSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("retention", () => {
    test("a registration is swept by lastUsedAt, after ninety days unused", () => {
      expect(McpOAuthClientService.hardDeleteItemByColumnName).toBe(
        "lastUsedAt",
      );
      expect(McpOAuthClientService.hardDeleteItemsOlderThanDays).toBe(90);
      expect(McpOAuthClientServiceClass.UNUSED_CLIENT_RETENTION_IN_DAYS).toBe(
        90,
      );
    });

    test("the sweep cannot strand a connected client: it is longer than a refresh token lasts, and far longer than the write throttle", () => {
      const refreshTokenLifetimeInDays: number = 30;
      const lastUsedThrottleInDays: number = 1;

      expect(
        McpOAuthClientService.hardDeleteItemsOlderThanDays,
      ).toBeGreaterThan(refreshTokenLifetimeInDays + lastUsedThrottleInDays);
    });

    test("the service is bound to the McpOAuthClient model", () => {
      expect(McpOAuthClientService.modelType).toBe(McpOAuthClient);
    });
  });
});
