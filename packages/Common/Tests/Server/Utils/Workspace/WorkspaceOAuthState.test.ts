import crypto from "crypto";
import WorkspaceOAuthState, {
  CreatedWorkspaceOAuthState,
  WorkspaceOAuthFlow,
  WorkspaceOAuthStateRecord,
} from "../../../../Server/Utils/Workspace/WorkspaceOAuthState";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WorkspaceOAuthState is what the Slack and Microsoft Teams connect callbacks
 * trust to decide which project and user a workspace binding is written for.
 * These tests pin the properties that make it trustworthy: opaque, single-use,
 * short-lived, flow-specific and bound to the browser that started the flow.
 */

type MockCacheEntry = { value: string; expiresAt: number };

// An in-memory stand-in for Redis that honours TTLs against Date.now().
const mockCacheStore: Map<string, MockCacheEntry> = new Map();

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      setString: jest.fn(
        async (
          namespace: string,
          key: string,
          value: string,
          options?: { expiresInSeconds: number },
        ): Promise<void> => {
          mockCacheStore.set(`${namespace}-${key}`, {
            value,
            expiresAt:
              Date.now() + (options?.expiresInSeconds ?? 2592000) * 1000,
          });
        },
      ),
      getAndDeleteString: jest.fn(
        async (namespace: string, key: string): Promise<string | null> => {
          const cacheKey: string = `${namespace}-${key}`;
          const entry: MockCacheEntry | undefined =
            mockCacheStore.get(cacheKey);
          mockCacheStore.delete(cacheKey);

          if (!entry || entry.expiresAt <= Date.now()) {
            return null;
          }

          return entry.value;
        },
      ),
    },
  };
});

const COOKIE_NAME: string = WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME;

type FakeResponse = ExpressResponse & { cookie: jest.Mock };

function makeRequest(cookies: Record<string, string> = {}): ExpressRequest {
  return { cookies, query: {}, params: {}, headers: {} } as ExpressRequest;
}

function makeResponse(): FakeResponse {
  return { cookie: jest.fn() } as unknown as FakeResponse;
}

// The binding cookie value create() handed to the browser.
function issuedBinding(res: FakeResponse): string {
  const call: Array<unknown> | undefined = res.cookie.mock.calls.find(
    (args: Array<unknown>) => {
      return args[0] === COOKIE_NAME;
    },
  );

  expect(call).toBeDefined();
  return call![1] as string;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

describe("WorkspaceOAuthState", () => {
  let projectId: ObjectID;
  let userId: ObjectID;

  beforeEach(() => {
    mockCacheStore.clear();
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    userId = ObjectID.generate();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Starts a flow in a fresh browser and returns the state plus that browser's cookies.
  async function start(
    flow: WorkspaceOAuthFlow = WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent,
    extra: { tenantId?: string; includeOidcNonce?: boolean } = {},
  ): Promise<{
    created: CreatedWorkspaceOAuthState;
    cookies: Record<string, string>;
  }> {
    const res: FakeResponse = makeResponse();

    const created: CreatedWorkspaceOAuthState =
      await WorkspaceOAuthState.create({
        req: makeRequest(),
        res,
        flow,
        projectId,
        userId,
        ...extra,
      });

    return { created, cookies: { [COOKIE_NAME]: issuedBinding(res) } };
  }

  describe("create", () => {
    test("issues an opaque 256-bit state that does not carry the project or user", async () => {
      const { created } = await start();

      expect(created.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(created.state).not.toContain(projectId.toString());
      expect(created.state).not.toContain(userId.toString());
      expect(created.state).not.toContain(":");
    });

    test("issues a different state every time", async () => {
      const states: Set<string> = new Set();

      for (let i: number = 0; i < 20; i++) {
        states.add((await start()).created.state);
      }

      expect(states.size).toBe(20);
    });

    test("stores the record under a hash of the state, never the state itself", async () => {
      const { created, cookies } = await start();

      const keys: Array<string> = Array.from(mockCacheStore.keys());
      expect(keys).toEqual([`workspace-oauth-state-${sha256(created.state)}`]);

      const stored: string = mockCacheStore.get(keys[0]!)!.value;
      expect(stored).not.toContain(created.state);

      // Only a hash of the browser binding is stored, never the cookie value.
      expect(stored).not.toContain(cookies[COOKIE_NAME]!);
      expect(JSON.parse(stored)).toMatchObject({
        flow: WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent,
        projectId: projectId.toString(),
        userId: userId.toString(),
        browserBindingHash: sha256(cookies[COOKIE_NAME]!),
      });
    });

    test("expires the record after fifteen minutes", async () => {
      await start();

      expect(WorkspaceOAuthState.EXPIRES_IN_SECONDS).toBe(900);
      expect(GlobalCache.setString).toHaveBeenCalledWith(
        "workspace-oauth-state",
        expect.any(String),
        expect.any(String),
        { expiresInSeconds: 900 },
      );
    });

    test("sets the browser binding as an httpOnly cookie that lives as long as the state", async () => {
      const res: FakeResponse = makeResponse();

      await WorkspaceOAuthState.create({
        req: makeRequest(),
        res,
        flow: WorkspaceOAuthFlow.SlackInstall,
        projectId,
        userId,
      });

      expect(res.cookie).toHaveBeenCalledWith(
        COOKIE_NAME,
        expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        expect.objectContaining({
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: 900 * 1000,
        }),
      );
    });

    test("reuses the browser's existing binding so flows in two tabs do not cancel each other", async () => {
      const first: { cookies: Record<string, string>; created: any } =
        await start();

      const res: FakeResponse = makeResponse();
      const second: CreatedWorkspaceOAuthState =
        await WorkspaceOAuthState.create({
          req: makeRequest(first.cookies),
          res,
          flow: WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent,
          projectId,
          userId,
        });

      expect(issuedBinding(res)).toBe(first.cookies[COOKIE_NAME]);

      const req: ExpressRequest = makeRequest(first.cookies);
      const flows: Array<WorkspaceOAuthFlow> = [
        WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent,
      ];

      expect(
        await WorkspaceOAuthState.consume({
          req,
          state: first.created.state,
          flows,
        }),
      ).not.toBeNull();
      expect(
        await WorkspaceOAuthState.consume({
          req,
          state: second.state,
          flows,
        }),
      ).not.toBeNull();
    });

    test("replaces a malformed binding cookie instead of trusting it", async () => {
      const res: FakeResponse = makeResponse();

      await WorkspaceOAuthState.create({
        req: makeRequest({ [COOKIE_NAME]: "not-a-binding" }),
        res,
        flow: WorkspaceOAuthFlow.SlackInstall,
        projectId,
        userId,
      });

      expect(issuedBinding(res)).not.toBe("not-a-binding");
      expect(issuedBinding(res)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    test("only issues an OpenID Connect nonce when asked to", async () => {
      expect((await start()).created.oidcNonce).toBeUndefined();

      const withNonce: CreatedWorkspaceOAuthState = (
        await start(WorkspaceOAuthFlow.MicrosoftTeamsAdminConsentSignIn, {
          includeOidcNonce: true,
        })
      ).created;

      expect(withNonce.oidcNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(withNonce.oidcNonce).not.toBe(withNonce.state);
    });
  });

  describe("consume", () => {
    test("returns the project, user and flow the state was issued for", async () => {
      const { created, cookies } = await start(
        WorkspaceOAuthFlow.MicrosoftTeamsAdminConsentSignIn,
        {
          tenantId: "0d3b1c0e-58f1-4bd1-8bb0-2b0f6f3f6c11",
          includeOidcNonce: true,
        },
      );

      const record: WorkspaceOAuthStateRecord | null =
        await WorkspaceOAuthState.consume({
          req: makeRequest(cookies),
          state: created.state,
          flows: [WorkspaceOAuthFlow.MicrosoftTeamsAdminConsentSignIn],
        });

      expect(record).not.toBeNull();
      expect(record!.flow).toBe(
        WorkspaceOAuthFlow.MicrosoftTeamsAdminConsentSignIn,
      );
      expect(record!.projectId.toString()).toBe(projectId.toString());
      expect(record!.userId.toString()).toBe(userId.toString());
      expect(record!.tenantId).toBe("0d3b1c0e-58f1-4bd1-8bb0-2b0f6f3f6c11");
      expect(record!.oidcNonce).toBe(created.oidcNonce);
    });

    test("accepts any of the flows the caller lists", async () => {
      const { created, cookies } = await start(
        WorkspaceOAuthFlow.MicrosoftTeamsAdminConsentSignIn,
      );

      const record: WorkspaceOAuthStateRecord | null =
        await WorkspaceOAuthState.consume({
          req: makeRequest(cookies),
          state: created.state,
          flows: [
            WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent,
            WorkspaceOAuthFlow.MicrosoftTeamsAdminConsentSignIn,
          ],
        });

      expect(record?.flow).toBe(
        WorkspaceOAuthFlow.MicrosoftTeamsAdminConsentSignIn,
      );
    });

    test("is single-use: a replayed state is refused", async () => {
      const { created, cookies } = await start();
      const flows: Array<WorkspaceOAuthFlow> = [
        WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent,
      ];

      expect(
        await WorkspaceOAuthState.consume({
          req: makeRequest(cookies),
          state: created.state,
          flows,
        }),
      ).not.toBeNull();

      expect(
        await WorkspaceOAuthState.consume({
          req: makeRequest(cookies),
          state: created.state,
          flows,
        }),
      ).toBeNull();
    });

    test("honours exactly one of two concurrent presentations of the same state", async () => {
      const { created, cookies } = await start();
      const flows: Array<WorkspaceOAuthFlow> = [
        WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent,
      ];

      const results: Array<WorkspaceOAuthStateRecord | null> =
        await Promise.all([
          WorkspaceOAuthState.consume({
            req: makeRequest(cookies),
            state: created.state,
            flows,
          }),
          WorkspaceOAuthState.consume({
            req: makeRequest(cookies),
            state: created.state,
            flows,
          }),
        ]);

      expect(
        results.filter((result: WorkspaceOAuthStateRecord | null) => {
          return result !== null;
        }),
      ).toHaveLength(1);
    });

    test("uses an atomic read-and-delete rather than a read followed by a delete", async () => {
      const { created, cookies } = await start();

      await WorkspaceOAuthState.consume({
        req: makeRequest(cookies),
        state: created.state,
        flows: [WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent],
      });

      expect(GlobalCache.getAndDeleteString).toHaveBeenCalledWith(
        "workspace-oauth-state",
        sha256(created.state),
      );
    });

    test("refuses a state after it has expired", async () => {
      const { created, cookies } = await start();
      const realNow: number = Date.now();

      jest.spyOn(Date, "now").mockReturnValue(realNow + 901 * 1000);

      expect(
        await WorkspaceOAuthState.consume({
          req: makeRequest(cookies),
          state: created.state,
          flows: [WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent],
        }),
      ).toBeNull();
    });

    test("enforces expiry itself even if the cache kept the record past its TTL", async () => {
      const { created, cookies } = await start();

      for (const entry of mockCacheStore.values()) {
        entry.expiresAt = Number.MAX_SAFE_INTEGER;
      }

      const realNow: number = Date.now();
      jest.spyOn(Date, "now").mockReturnValue(realNow + 901 * 1000);

      expect(
        await WorkspaceOAuthState.consume({
          req: makeRequest(cookies),
          state: created.state,
          flows: [WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent],
        }),
      ).toBeNull();
    });

    test("still accepts a state just inside its lifetime", async () => {
      const { created, cookies } = await start();
      const realNow: number = Date.now();

      jest.spyOn(Date, "now").mockReturnValue(realNow + 890 * 1000);

      expect(
        await WorkspaceOAuthState.consume({
          req: makeRequest(cookies),
          state: created.state,
          flows: [WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent],
        }),
      ).not.toBeNull();
    });

    test("refuses a state issued for a different flow, and burns it", async () => {
      const { created, cookies } = await start(
        WorkspaceOAuthFlow.MicrosoftTeamsUserSignIn,
      );

      expect(
        await WorkspaceOAuthState.consume({
          req: makeRequest(cookies),
          state: created.state,
          flows: [
            WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent,
            WorkspaceOAuthFlow.MicrosoftTeamsAdminConsentSignIn,
          ],
        }),
      ).toBeNull();

      expect(
        await WorkspaceOAuthState.consume({
          req: makeRequest(cookies),
          state: created.state,
          flows: [WorkspaceOAuthFlow.MicrosoftTeamsUserSignIn],
        }),
      ).toBeNull();
    });

    test("refuses a state completed in a browser without the binding cookie, and burns it", async () => {
      const { created, cookies } = await start();
      const flows: Array<WorkspaceOAuthFlow> = [
        WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent,
      ];

      expect(
        await WorkspaceOAuthState.consume({
          req: makeRequest(),
          state: created.state,
          flows,
        }),
      ).toBeNull();

      // A failed attempt cannot be retried with the right cookie.
      expect(
        await WorkspaceOAuthState.consume({
          req: makeRequest(cookies),
          state: created.state,
          flows,
        }),
      ).toBeNull();
    });

    test("refuses a state completed in a browser holding someone else's binding", async () => {
      const { created } = await start();
      const other: { cookies: Record<string, string>; created: any } =
        await start();

      expect(
        await WorkspaceOAuthState.consume({
          req: makeRequest(other.cookies),
          state: created.state,
          flows: [WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent],
        }),
      ).toBeNull();
    });

    test.each([
      ["a missing state", undefined],
      ["an empty state", ""],
      ["a <projectId>:<userId> state", "legacy"],
      ["a state that is too short", "A".repeat(42)],
      ["a state that is too long", "A".repeat(44)],
      ["a state that is not base64url", "!".repeat(43)],
    ])(
      "refuses %s without touching the cache",
      async (_label: string, state: string | undefined) => {
        const legacyState: string = `${projectId.toString()}:${userId.toString()}`;

        expect(
          await WorkspaceOAuthState.consume({
            req: makeRequest(),
            state: state === "legacy" ? legacyState : state,
            flows: [WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent],
          }),
        ).toBeNull();

        expect(GlobalCache.getAndDeleteString).not.toHaveBeenCalled();
      },
    );

    test("refuses a well-formed state that was never issued", async () => {
      const { cookies } = await start();

      expect(
        await WorkspaceOAuthState.consume({
          req: makeRequest(cookies),
          state: crypto.randomBytes(32).toString("base64url"),
          flows: [WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent],
        }),
      ).toBeNull();
    });
  });

  test("lets project owners, admins and members manage connections, and nobody read-only", () => {
    expect(WorkspaceOAuthState.MANAGE_CONNECTION_PERMISSIONS).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ]);
    expect(WorkspaceOAuthState.MANAGE_CONNECTION_PERMISSIONS).not.toContain(
      Permission.Viewer,
    );
  });
});
