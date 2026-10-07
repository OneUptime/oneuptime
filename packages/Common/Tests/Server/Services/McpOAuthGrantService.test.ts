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

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import McpOAuthGrantService, {
  McpOAuthGrantSsoEvidence,
  Service as McpOAuthGrantServiceClass,
} from "../../../Server/Services/McpOAuthGrantService";
import McpOAuthGrant from "../../../Models/DatabaseModels/McpOAuthGrant";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import McpOAuthScope from "../../../Types/Mcp/McpOAuthScope";
import ObjectID from "../../../Types/ObjectID";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { FindOperator } from "typeorm";

/*
 * A grant is "this member let this client act for them in this project". The
 * service is the only writer of that row, and what is pinned here is what
 * each write means:
 *
 *   - a grant is created PENDING (no activatedAt) and names the member who
 *     approved it, so the audit trail does not say "System";
 *   - activating and extending are single hook-free column writes that leave
 *     updatedAt alone, because they happen on every code exchange and refresh;
 *   - revoking is a DELETE of the one grant (its tokens go by cascade), and
 *     the props decide who the audit trail says did it;
 *   - replacing a client's earlier grants deletes exactly that member's grants
 *     for that client in that project, and never the one just made;
 *   - `lastUsedAt` is throttled and can never fail the request it rides on.
 *
 * No database: every DatabaseService method underneath is spied.
 */

type SpyInstance = ReturnType<typeof getJestSpyOn>;
type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const GRANT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const SSO_PROVIDER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const CLIENT_ID: string = "https://claude.ai/oauth/mcp-client-metadata";
const CLIENT_NAME: string = "Claude";
const RESOURCE: string = "https://oneuptime.example.com/mcp";

const NOW: Date = new Date("2026-10-01T12:00:00.000Z");
const CODE_EXPIRY: Date = new Date(NOW.getTime() + 5 * 60 * 1000);
const REFRESH_EXPIRY: Date = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
const SSO_EXPIRY: Date = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);

const FIVE_MINUTES_MS: number = 5 * 60 * 1000;

const loggerWarnMock: MockedFn = logger.warn as unknown as MockedFn;

interface CreateCall {
  data: McpOAuthGrant;
  props: DatabaseCommonInteractionProps;
}

interface UpdateColumnsCall {
  id: ObjectID;
  data: Record<string, unknown>;
  expectedData?: Record<string, unknown>;
  skipUpdateDateColumn?: boolean;
}

interface DeleteOneByCall {
  query: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
}

interface DeleteByCall {
  query: Record<string, unknown>;
  limit: unknown;
  skip: unknown;
  props: DatabaseCommonInteractionProps;
}

interface FindOneByIdCall {
  id: ObjectID;
  select: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
}

interface PendingGrantInput {
  projectId: ObjectID;
  userId: ObjectID;
  clientId: string;
  clientName: string;
  scopes: Array<McpOAuthScope>;
  resource: string;
  expiresAt: Date;
  ssoEvidence: McpOAuthGrantSsoEvidence | null;
}

const pendingGrantInput: (
  overrides?: Partial<PendingGrantInput>,
) => PendingGrantInput = (
  overrides: Partial<PendingGrantInput> = {},
): PendingGrantInput => {
  return {
    projectId: PROJECT_ID,
    userId: USER_ID,
    clientId: CLIENT_ID,
    clientName: CLIENT_NAME,
    scopes: [McpOAuthScope.Read, McpOAuthScope.Write],
    resource: RESOURCE,
    expiresAt: CODE_EXPIRY,
    ssoEvidence: null,
    ...overrides,
  };
};

const grantWith: (fields: {
  id?: ObjectID | undefined;
  lastUsedAt?: Date | undefined;
}) => McpOAuthGrant = (fields: {
  id?: ObjectID | undefined;
  lastUsedAt?: Date | undefined;
}): McpOAuthGrant => {
  const grant: McpOAuthGrant = new McpOAuthGrant();

  if (fields.id) {
    grant._id = fields.id.toString();
  }

  if (fields.lastUsedAt) {
    grant.lastUsedAt = fields.lastUsedAt;
  }

  return grant;
};

describe("McpOAuthGrantService", () => {
  let createSpy: SpyInstance;
  let findOneByIdSpy: SpyInstance;
  let updateColumnsSpy: SpyInstance;
  let deleteOneBySpy: SpyInstance;
  let deleteBySpy: SpyInstance;

  const createdRow: () => McpOAuthGrant = (): McpOAuthGrant => {
    expect(createSpy).toHaveBeenCalledTimes(1);

    return (createSpy.mock.calls[0]![0] as CreateCall).data;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    createSpy = getJestSpyOn(McpOAuthGrantService, "create").mockImplementation(
      async (createBy: CreateCall): Promise<McpOAuthGrant> => {
        return createBy.data;
      },
    );
    findOneByIdSpy = getJestSpyOn(
      McpOAuthGrantService,
      "findOneById",
    ).mockResolvedValue(null);
    updateColumnsSpy = getJestSpyOn(
      McpOAuthGrantService,
      "updateColumnsByIdWithoutHooks",
    ).mockResolvedValue(undefined);
    deleteOneBySpy = getJestSpyOn(
      McpOAuthGrantService,
      "deleteOneBy",
    ).mockResolvedValue(1);
    deleteBySpy = getJestSpyOn(
      McpOAuthGrantService,
      "deleteBy",
    ).mockResolvedValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("createPendingGrant", () => {
    test("records who approved, in which project, for which client and resource", async () => {
      await McpOAuthGrantService.createPendingGrant(pendingGrantInput());

      const row: McpOAuthGrant = createdRow();

      expect(row).toBeInstanceOf(McpOAuthGrant);
      expect(row.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(row.userId?.toString()).toBe(USER_ID.toString());
      expect(row.clientId).toBe(CLIENT_ID);
      expect(row.resource).toBe(RESOURCE);
      expect(row.expiresAt).toEqual(CODE_EXPIRY);
    });

    test("is named after the client, so an audit entry reads as the client's name", async () => {
      await McpOAuthGrantService.createPendingGrant(
        pendingGrantInput({ clientName: "Cursor" }),
      );

      expect(createdRow().name).toBe("Cursor");
    });

    test("is PENDING: activatedAt and lastUsedAt are not set until the client collects its tokens", async () => {
      await McpOAuthGrantService.createPendingGrant(pendingGrantInput());

      const row: McpOAuthGrant = createdRow();

      expect(row.activatedAt).toBeUndefined();
      expect(row.lastUsedAt).toBeUndefined();
    });

    const scopeCases: Array<[string, Array<McpOAuthScope>, string]> = [
      ["read only", [McpOAuthScope.Read], "mcp:read"],
      [
        "read and write",
        [McpOAuthScope.Read, McpOAuthScope.Write],
        "mcp:read mcp:write",
      ],
      [
        "write alone is spelled out as read and write",
        [McpOAuthScope.Write],
        "mcp:read mcp:write",
      ],
      [
        "whatever order they arrive in, they are stored in the canonical one",
        [McpOAuthScope.OfflineAccess, McpOAuthScope.Write, McpOAuthScope.Read],
        "mcp:read mcp:write offline_access",
      ],
      [
        "read with offline_access",
        [McpOAuthScope.Read, McpOAuthScope.OfflineAccess],
        "mcp:read offline_access",
      ],
      [
        "a repeated scope is stored once",
        [McpOAuthScope.Read, McpOAuthScope.Read],
        "mcp:read",
      ],
    ];

    test.each(scopeCases)(
      "scope - %s",
      async (
        _label: string,
        scopes: Array<McpOAuthScope>,
        expected: string,
      ) => {
        await McpOAuthGrantService.createPendingGrant(
          pendingGrantInput({ scopes }),
        );

        expect(createdRow().scope).toBe(expected);
      },
    );

    test("a read-only approval never stores write", async () => {
      await McpOAuthGrantService.createPendingGrant(
        pendingGrantInput({
          scopes: [McpOAuthScope.Read, McpOAuthScope.OfflineAccess],
        }),
      );

      expect(createdRow().scope).not.toContain(McpOAuthScope.Write);
    });

    test("does not mutate the caller's scope array", async () => {
      const scopes: Array<McpOAuthScope> = [McpOAuthScope.Write];

      await McpOAuthGrantService.createPendingGrant(
        pendingGrantInput({ scopes }),
      );

      expect(scopes).toEqual([McpOAuthScope.Write]);
    });

    test("with no SSO evidence, none of the three SSO columns is written", async () => {
      await McpOAuthGrantService.createPendingGrant(
        pendingGrantInput({ ssoEvidence: null }),
      );

      const row: McpOAuthGrant = createdRow();

      expect(row.ssoProviderType).toBeUndefined();
      expect(row.ssoProviderId).toBeUndefined();
      expect(row.ssoExpiresAt).toBeUndefined();
    });

    test("SSO evidence is copied onto the grant: provider type, provider and when the sign-in lapses", async () => {
      await McpOAuthGrantService.createPendingGrant(
        pendingGrantInput({
          ssoEvidence: {
            ssoProviderType: SsoProviderType.GlobalOIDC,
            ssoProviderId: SSO_PROVIDER_ID,
            expiresAt: SSO_EXPIRY,
          },
        }),
      );

      const row: McpOAuthGrant = createdRow();

      expect(row.ssoProviderType).toBe(SsoProviderType.GlobalOIDC);
      expect(row.ssoProviderId?.toString()).toBe(SSO_PROVIDER_ID.toString());
      expect(row.ssoExpiresAt).toEqual(SSO_EXPIRY);
    });

    test("evidence from a token with no provider id stores the type and the expiry, and no provider", async () => {
      await McpOAuthGrantService.createPendingGrant(
        pendingGrantInput({
          ssoEvidence: {
            ssoProviderType: SsoProviderType.ProjectSSO,
            ssoProviderId: null,
            expiresAt: SSO_EXPIRY,
          },
        }),
      );

      const row: McpOAuthGrant = createdRow();

      expect(row.ssoProviderType).toBe(SsoProviderType.ProjectSSO);
      expect(row.ssoExpiresAt).toEqual(SSO_EXPIRY);
      expect(row.ssoProviderId).toBeUndefined();
    });

    test("the SSO expiry and the grant's own expiry are separate columns", async () => {
      await McpOAuthGrantService.createPendingGrant(
        pendingGrantInput({
          ssoEvidence: {
            ssoProviderType: SsoProviderType.ProjectSSO,
            ssoProviderId: SSO_PROVIDER_ID,
            expiresAt: SSO_EXPIRY,
          },
        }),
      );

      const row: McpOAuthGrant = createdRow();

      expect(row.expiresAt).toEqual(CODE_EXPIRY);
      expect(row.ssoExpiresAt).toEqual(SSO_EXPIRY);
    });

    test("is written as root, but the props NAME the member, so the audit trail attributes the grant to them", async () => {
      await McpOAuthGrantService.createPendingGrant(pendingGrantInput());

      const props: DatabaseCommonInteractionProps = (
        createSpy.mock.calls[0]![0] as CreateCall
      ).props;

      expect(props.isRoot).toBe(true);
      expect(props.userId?.toString()).toBe(USER_ID.toString());
      expect(props.userType).toBe(UserType.User);
      expect(props.tenantId?.toString()).toBe(PROJECT_ID.toString());
      // Never a master admin, whoever approved.
      expect(props.isMasterAdmin).toBeUndefined();
      expect(Object.keys(props).sort()).toEqual([
        "isRoot",
        "tenantId",
        "userId",
        "userType",
      ]);
    });

    test("returns the row the database created", async () => {
      const created: McpOAuthGrant = grantWith({ id: GRANT_ID });

      createSpy.mockResolvedValue(created);

      await expect(
        McpOAuthGrantService.createPendingGrant(pendingGrantInput()),
      ).resolves.toBe(created);
    });

    test("a failed write is the caller's error: no grant, no code", async () => {
      createSpy.mockRejectedValue(new Error("database unavailable"));

      await expect(
        McpOAuthGrantService.createPendingGrant(pendingGrantInput()),
      ).rejects.toThrow("database unavailable");
    });
  });

  describe("findGrant", () => {
    test("reads, in one query, everything a use of the grant is judged on", async () => {
      await McpOAuthGrantService.findGrant(GRANT_ID);

      expect(findOneByIdSpy).toHaveBeenCalledTimes(1);

      const call: FindOneByIdCall = findOneByIdSpy.mock
        .calls[0]![0] as FindOneByIdCall;

      expect(call.id.toString()).toBe(GRANT_ID.toString());
      expect(call.select).toEqual({
        _id: true,
        projectId: true,
        userId: true,
        clientId: true,
        name: true,
        scope: true,
        resource: true,
        activatedAt: true,
        expiresAt: true,
        lastUsedAt: true,
        // When the SSO sign-in behind the grant was given (#4530): a provider turned off since ends it.
        createdAt: true,
        ssoProviderType: true,
        ssoProviderId: true,
        ssoExpiresAt: true,
      });
      expect(call.props).toEqual({ isRoot: true });
    });

    test("a grant that no longer exists - a revoked one - is null", async () => {
      await expect(
        McpOAuthGrantService.findGrant(GRANT_ID),
      ).resolves.toBeNull();
    });

    test("hands back the row it found", async () => {
      const grant: McpOAuthGrant = grantWith({ id: GRANT_ID });

      findOneByIdSpy.mockResolvedValue(grant);

      await expect(McpOAuthGrantService.findGrant(GRANT_ID)).resolves.toBe(
        grant,
      );
    });
  });

  describe("activate", () => {
    test("stamps activatedAt and moves the expiry out to the refresh token's, in one hook-free write", async () => {
      await McpOAuthGrantService.activate({
        grantId: GRANT_ID,
        expiresAt: REFRESH_EXPIRY,
        now: NOW,
      });

      expect(updateColumnsSpy).toHaveBeenCalledTimes(1);

      const call: UpdateColumnsCall = updateColumnsSpy.mock
        .calls[0]![0] as UpdateColumnsCall;

      expect(call.id.toString()).toBe(GRANT_ID.toString());
      expect(call.data).toEqual({
        activatedAt: NOW,
        expiresAt: REFRESH_EXPIRY,
      });
    });

    test("leaves updatedAt alone", async () => {
      await McpOAuthGrantService.activate({
        grantId: GRANT_ID,
        expiresAt: REFRESH_EXPIRY,
        now: NOW,
      });

      const call: UpdateColumnsCall = updateColumnsSpy.mock
        .calls[0]![0] as UpdateColumnsCall;

      expect(call.skipUpdateDateColumn).toBe(true);
    });

    test("goes through neither the hooked update path nor a delete", async () => {
      const updateOneByIdSpy: SpyInstance = getJestSpyOn(
        McpOAuthGrantService,
        "updateOneById",
      ).mockResolvedValue(undefined);
      const updateOneBySpy: SpyInstance = getJestSpyOn(
        McpOAuthGrantService,
        "updateOneBy",
      ).mockResolvedValue(0);

      await McpOAuthGrantService.activate({
        grantId: GRANT_ID,
        expiresAt: REFRESH_EXPIRY,
        now: NOW,
      });

      expect(updateOneByIdSpy).not.toHaveBeenCalled();
      expect(updateOneBySpy).not.toHaveBeenCalled();
      expect(deleteOneBySpy).not.toHaveBeenCalled();
    });

    test("without `now`, activatedAt is the current time", async () => {
      const before: number = Date.now();

      await McpOAuthGrantService.activate({
        grantId: GRANT_ID,
        expiresAt: REFRESH_EXPIRY,
      });

      const after: number = Date.now();
      const call: UpdateColumnsCall = updateColumnsSpy.mock
        .calls[0]![0] as UpdateColumnsCall;
      const activatedAt: number = (call.data["activatedAt"] as Date).getTime();

      expect(activatedAt).toBeGreaterThanOrEqual(before);
      expect(activatedAt).toBeLessThanOrEqual(after);
    });

    test("a failed write is an error: a client must not be handed tokens for a grant that was never activated", async () => {
      updateColumnsSpy.mockRejectedValue(new Error("database unavailable"));

      await expect(
        McpOAuthGrantService.activate({
          grantId: GRANT_ID,
          expiresAt: REFRESH_EXPIRY,
          now: NOW,
        }),
      ).rejects.toThrow("database unavailable");
    });
  });

  describe("extend", () => {
    test("slides the expiry, and only the expiry", async () => {
      await McpOAuthGrantService.extend({
        grantId: GRANT_ID,
        expiresAt: REFRESH_EXPIRY,
      });

      expect(updateColumnsSpy).toHaveBeenCalledTimes(1);

      const call: UpdateColumnsCall = updateColumnsSpy.mock
        .calls[0]![0] as UpdateColumnsCall;

      expect(call.id.toString()).toBe(GRANT_ID.toString());
      expect(call.data).toEqual({ expiresAt: REFRESH_EXPIRY });
      // A refresh must never re-stamp when the grant was first activated.
      expect(call.data).not.toHaveProperty("activatedAt");
      expect(call.skipUpdateDateColumn).toBe(true);
    });
  });

  describe("revoke", () => {
    test("deletes that one grant, by id", async () => {
      await McpOAuthGrantService.revoke({
        grantId: GRANT_ID,
        props: { isRoot: true },
      });

      expect(deleteOneBySpy).toHaveBeenCalledTimes(1);

      const call: DeleteOneByCall = deleteOneBySpy.mock
        .calls[0]![0] as DeleteOneByCall;

      expect(Object.keys(call.query)).toEqual(["_id"]);
      expect((call.query["_id"] as ObjectID).toString()).toBe(
        GRANT_ID.toString(),
      );
    });

    test("passes the caller's props through untouched: they decide who the audit trail names", async () => {
      const props: DatabaseCommonInteractionProps = {
        isRoot: true,
        userId: USER_ID,
        userType: UserType.User,
        tenantId: PROJECT_ID,
        mcpOAuthGrantId: GRANT_ID,
        mcpClientName: CLIENT_NAME,
      };

      await McpOAuthGrantService.revoke({ grantId: GRANT_ID, props });

      const call: DeleteOneByCall = deleteOneBySpy.mock
        .calls[0]![0] as DeleteOneByCall;

      expect(call.props).toBe(props);
    });

    test("is a delete, not a soft flag: nothing is updated", async () => {
      await McpOAuthGrantService.revoke({
        grantId: GRANT_ID,
        props: { isRoot: true },
      });

      expect(updateColumnsSpy).not.toHaveBeenCalled();
      expect(deleteBySpy).not.toHaveBeenCalled();
    });

    test("a failed delete is an error: a revocation must never be reported as done when it was not", async () => {
      deleteOneBySpy.mockRejectedValue(new Error("database unavailable"));

      await expect(
        McpOAuthGrantService.revoke({
          grantId: GRANT_ID,
          props: { isRoot: true },
        }),
      ).rejects.toThrow("database unavailable");
    });
  });

  describe("revokeBecauseCredentialWasReplayed", () => {
    test("deletes the grant as the server itself - root props that name nobody", async () => {
      await McpOAuthGrantService.revokeBecauseCredentialWasReplayed({
        grantId: GRANT_ID,
        credential: "refresh token",
      });

      expect(deleteOneBySpy).toHaveBeenCalledTimes(1);

      const call: DeleteOneByCall = deleteOneBySpy.mock
        .calls[0]![0] as DeleteOneByCall;

      expect((call.query["_id"] as ObjectID).toString()).toBe(
        GRANT_ID.toString(),
      );
      expect(call.props).toEqual({ isRoot: true });
    });

    test("says so in the log, naming the grant and which kind of credential came back", async () => {
      await McpOAuthGrantService.revokeBecauseCredentialWasReplayed({
        grantId: GRANT_ID,
        credential: "authorization code",
      });

      expect(loggerWarnMock).toHaveBeenCalledTimes(1);

      const message: string = String(loggerWarnMock.mock.calls[0]![0]);

      expect(message).toContain(GRANT_ID.toString());
      expect(message).toContain("authorization code");
    });

    test("logs before it deletes, so a failed delete still leaves the trace", async () => {
      deleteOneBySpy.mockRejectedValue(new Error("database unavailable"));

      await expect(
        McpOAuthGrantService.revokeBecauseCredentialWasReplayed({
          grantId: GRANT_ID,
          credential: "refresh token",
        }),
      ).rejects.toThrow("database unavailable");

      expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("revokeEarlierGrantsOfClient", () => {
    const OTHER_GRANT_ID: ObjectID = new ObjectID(
      "55555555-5555-4555-8555-555555555555",
    );

    const run: () => Promise<DeleteByCall> =
      async (): Promise<DeleteByCall> => {
        await McpOAuthGrantService.revokeEarlierGrantsOfClient({
          userId: USER_ID,
          projectId: PROJECT_ID,
          clientId: CLIENT_ID,
          exceptGrantId: GRANT_ID,
        });

        expect(deleteBySpy).toHaveBeenCalledTimes(1);

        return deleteBySpy.mock.calls[0]![0] as DeleteByCall;
      };

    test("is scoped to this member, this project and this client - all three", async () => {
      const call: DeleteByCall = await run();

      expect(Object.keys(call.query).sort()).toEqual([
        "_id",
        "clientId",
        "projectId",
        "userId",
      ]);
      expect((call.query["userId"] as ObjectID).toString()).toBe(
        USER_ID.toString(),
      );
      expect((call.query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(call.query["clientId"]).toBe(CLIENT_ID);
    });

    test("spares the grant that was just made: the id is matched with NOT EQUAL", async () => {
      const call: DeleteByCall = await run();
      const idFilter: unknown = call.query["_id"];

      expect(idFilter).toBeInstanceOf(FindOperator);

      const operator: FindOperator<unknown> = idFilter as FindOperator<unknown>;

      expect(operator.type).toBe("raw");

      // The one bound parameter is the new grant's id...
      const parameters: Record<string, unknown> =
        operator.objectLiteralParameters as Record<string, unknown>;

      expect(Object.values(parameters)).toEqual([GRANT_ID.toString()]);

      // ...and the comparison is an inequality on the column.
      const parameterName: string = Object.keys(parameters)[0]!;

      expect(operator.getSql!("grant_id")).toBe(
        `(grant_id != :${parameterName})`,
      );

      // Not some other grant's id.
      expect(Object.values(parameters)).not.toContain(
        OTHER_GRANT_ID.toString(),
      );
    });

    test("removes every earlier grant, however many there are", async () => {
      const call: DeleteByCall = await run();

      expect(call.limit).toBe(LIMIT_MAX);
      expect(call.skip).toBe(0);
    });

    test("is the server's own doing: root props that name nobody", async () => {
      const call: DeleteByCall = await run();

      expect(call.props).toEqual({ isRoot: true });
    });

    test("does not touch the single-grant delete path", async () => {
      await run();

      expect(deleteOneBySpy).not.toHaveBeenCalled();
    });
  });

  describe("touchLastUsed", () => {
    test("writes lastUsedAt the first time a grant is used", async () => {
      await McpOAuthGrantService.touchLastUsed(
        grantWith({ id: GRANT_ID }),
        NOW,
      );

      expect(updateColumnsSpy).toHaveBeenCalledTimes(1);

      const call: UpdateColumnsCall = updateColumnsSpy.mock
        .calls[0]![0] as UpdateColumnsCall;

      expect(call.id.toString()).toBe(GRANT_ID.toString());
      expect(call.data).toEqual({ lastUsedAt: NOW });
      expect(call.skipUpdateDateColumn).toBe(true);
    });

    test("a grant used less than five minutes ago is not written again", async () => {
      await McpOAuthGrantService.touchLastUsed(
        grantWith({
          id: GRANT_ID,
          lastUsedAt: new Date(NOW.getTime() - (FIVE_MINUTES_MS - 1)),
        }),
        NOW,
      );

      expect(updateColumnsSpy).not.toHaveBeenCalled();
    });

    test("a grant used a moment ago is not written again", async () => {
      await McpOAuthGrantService.touchLastUsed(
        grantWith({ id: GRANT_ID, lastUsedAt: NOW }),
        NOW,
      );

      expect(updateColumnsSpy).not.toHaveBeenCalled();
    });

    test("at exactly five minutes it is written again", async () => {
      await McpOAuthGrantService.touchLastUsed(
        grantWith({
          id: GRANT_ID,
          lastUsedAt: new Date(NOW.getTime() - FIVE_MINUTES_MS),
        }),
        NOW,
      );

      expect(updateColumnsSpy).toHaveBeenCalledTimes(1);
    });

    test("a grant last used long ago is written again", async () => {
      await McpOAuthGrantService.touchLastUsed(
        grantWith({
          id: GRANT_ID,
          lastUsedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
        }),
        NOW,
      );

      expect(updateColumnsSpy).toHaveBeenCalledTimes(1);
    });

    test("a lastUsedAt that came back from the database as a string is read as a date", async () => {
      const grant: McpOAuthGrant = grantWith({ id: GRANT_ID });

      (grant as unknown as { lastUsedAt: string }).lastUsedAt = new Date(
        NOW.getTime() - 60 * 1000,
      ).toISOString();

      await McpOAuthGrantService.touchLastUsed(grant, NOW);

      expect(updateColumnsSpy).not.toHaveBeenCalled();
    });

    test("a grant with no id is ignored", async () => {
      await McpOAuthGrantService.touchLastUsed(grantWith({}), NOW);

      expect(updateColumnsSpy).not.toHaveBeenCalled();
    });

    test("a failing write is swallowed: it must never fail the request it rides along with", async () => {
      updateColumnsSpy.mockRejectedValue(new Error("database unavailable"));

      await expect(
        McpOAuthGrantService.touchLastUsed(grantWith({ id: GRANT_ID }), NOW),
      ).resolves.toBeUndefined();
    });

    test("a swallowed failure is still logged", async () => {
      const failure: Error = new Error("database unavailable");

      updateColumnsSpy.mockRejectedValue(failure);

      await McpOAuthGrantService.touchLastUsed(
        grantWith({ id: GRANT_ID }),
        NOW,
      );

      expect(loggerWarnMock).toHaveBeenCalledWith(failure);
    });

    test("without `now`, lastUsedAt is the current time", async () => {
      const before: number = Date.now();

      await McpOAuthGrantService.touchLastUsed(grantWith({ id: GRANT_ID }));

      const after: number = Date.now();
      const call: UpdateColumnsCall = updateColumnsSpy.mock
        .calls[0]![0] as UpdateColumnsCall;
      const lastUsedAt: number = (call.data["lastUsedAt"] as Date).getTime();

      expect(lastUsedAt).toBeGreaterThanOrEqual(before);
      expect(lastUsedAt).toBeLessThanOrEqual(after);
    });

    test("never touches the expiry or the activation: using a grant does not extend it", async () => {
      await McpOAuthGrantService.touchLastUsed(
        grantWith({ id: GRANT_ID }),
        NOW,
      );

      const call: UpdateColumnsCall = updateColumnsSpy.mock
        .calls[0]![0] as UpdateColumnsCall;

      expect(Object.keys(call.data)).toEqual(["lastUsedAt"]);
    });
  });

  describe("retention", () => {
    test("grants are swept by their expiry, a day after it passes", () => {
      expect(McpOAuthGrantService.hardDeleteItemByColumnName).toBe("expiresAt");
      expect(McpOAuthGrantService.hardDeleteItemsOlderThanDays).toBe(1);
      expect(McpOAuthGrantServiceClass.EXPIRED_GRANT_RETENTION_IN_DAYS).toBe(1);
    });

    test("the service is bound to the McpOAuthGrant model", () => {
      expect(McpOAuthGrantService.modelType).toBe(McpOAuthGrant);
    });
  });
});
