import UserMiddleware from "../../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import ProjectOidcService from "../../../../Server/Services/ProjectOidcService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ProjectSsoService from "../../../../Server/Services/ProjectSsoService";
import UserService from "../../../../Server/Services/UserService";
import CookieUtil from "../../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../../Server/Utils/Express";
import JSONWebToken from "../../../../Server/Utils/JsonWebToken";
import RealtimeJoinAccess, {
  RealtimeJoinDecision,
  RealtimeJoinRefusal,
} from "../../../../Server/Utils/Realtime/RealtimeJoinAccess";
import SsoAuthorizationException from "../../../../Types/Exception/SsoAuthorizationException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../../../Types/Permission";
import SsoProviderType from "../../../../Types/SSO/SsoProviderType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import CookieParser from "cookie-parser";
import fs from "fs";
import path from "path";

/*
 * THE REALTIME JOIN ASKS WHAT THE API ASKS.
 *
 * A socket joins a project's rooms only as far as an API request of the
 * same session would be let into the project. That holds because the join
 * does not decide anything itself: RealtimeJoinAccess hands the socket's
 * handshake to the checks every API request goes through. These tests keep
 * it that way:
 *
 *   - the join calls UserMiddleware.readRequestSession and
 *     getUserTenantAccessPermissionWithTenantId, and neither Realtime nor
 *     RealtimeJoinAccess reads tokens, cookies, permission caches or SSO
 *     settings on its own;
 *   - the handshake is read the way a request is: its cookies by the parser
 *     the API's server mounts, and everything those checks read off a
 *     request (headers, cookies, the decoded session) is on it;
 *   - for the same cookies and headers, the join and the API answer the
 *     same, across Require SSO, the instance-wide requirement, a pinned
 *     provider and server admins.
 */

jest.mock("../../../../Server/Utils/Logger");
jest.mock("../../../../Server/Services/AccessTokenService");
jest.mock("../../../../Server/Services/GlobalConfigService");
jest.mock("../../../../Server/Services/ProjectService");
jest.mock("../../../../Server/Services/ProjectSsoService");
jest.mock("../../../../Server/Services/ProjectOidcService");
jest.mock("../../../../Server/Services/TeamMemberService");
jest.mock("../../../../Server/Services/UserService");
// See Realtime.test.ts: nothing password-related is under test.
jest.mock("../../../../Server/Utils/PasswordHash", () => {
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

const SERVER_ROOT: string = path.resolve(__dirname, "../../../../Server");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(SERVER_ROOT, relativePath), "utf8");
}

const REALTIME: string = read("Utils/Realtime.ts");
const JOIN_ACCESS: string = read("Utils/Realtime/RealtimeJoinAccess.ts");
const USER_AUTHORIZATION: string = read("Middleware/UserAuthorization.ts");
const COOKIE: string = read("Utils/Cookie.ts");
const START_SERVER: string = read("Utils/StartServer.ts");

// The text of a static method, from its name to the next member.
function methodBody(source: string, name: string): string {
  const start: number = source.search(
    new RegExp(
      `\\n  (?:public |private |protected )?static (?:async )?${name}\\(`,
    ),
  );

  expect([name, start >= 0]).toEqual([name, true]);

  const next: number = source
    .slice(start + 1)
    .search(/\n {2}(?:@CaptureSpan\(\)\n {2})?(?:public|private|protected) /);

  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

// Without comments, so a word in an explanation is not taken for a call.
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("the realtime join runs the API's own checks", () => {
  test("the join is decided by RealtimeJoinAccess", () => {
    const join: string = code(methodBody(REALTIME, "listenToModelEvent"));

    expect(join).toContain("RealtimeJoinAccess.decide(");
  });

  test("RealtimeJoinAccess reads the session and the project through UserMiddleware", () => {
    const decide: string = code(methodBody(JOIN_ACCESS, "decide"));

    expect(decide).toContain(".readRequestSession(");
    expect(decide).toContain(".getUserTenantAccessPermissionWithTenantId(");
    expect(JOIN_ACCESS).toContain(
      'require("../../Middleware/UserAuthorization")',
    );
  });

  test("neither Realtime nor RealtimeJoinAccess copies a part of those checks", () => {
    const copies: Array<string> = [
      "JSONWebToken.decode(",
      "CookieUtil.",
      "UserPermissionUtil.",
      "getUserTenantAccessPermissionFromCache",
      "getUserGlobalAccessPermissionFromCache",
      "getRequireSsoForLogin",
      "getRequireSsoWithSsoProviderId",
      "isSsoSatisfiedForProject",
      "doesSsoTokenForProjectExist",
      "getSsoTokens",
      "getGlobalSsoTokenData",
      "isUserBlocked",
      "requireSsoForLogin",
      "ProjectService",
      "GlobalConfigService",
    ];

    for (const [name, source] of [
      ["Realtime.ts", code(REALTIME)],
      ["RealtimeJoinAccess.ts", code(JOIN_ACCESS)],
    ] as Array<[string, string]>) {
      expect([
        name,
        copies.filter((copy: string): boolean => {
          return source.includes(copy);
        }),
      ]).toEqual([name, []]);
    }
  });

  test("the handshake's cookies are parsed by the parser the API's server mounts", () => {
    expect(START_SERVER).toMatch(/import CookieParser from "cookie-parser"/);
    expect(START_SERVER).toContain("app.use(CookieParser())");
    expect(JOIN_ACCESS).toMatch(/import CookieParser from "cookie-parser"/);
    expect(code(methodBody(JOIN_ACCESS, "getHandshakeRequest"))).toContain(
      "CookieParser()(",
    );
  });

  /*
   * The handshake request carries a request's headers and cookies, and the
   * join sets the decoded session on it as the request middleware does. A
   * check that started reading anything else off the request - its IP, its
   * body - would find nothing on a handshake, so it has to be added to the
   * handshake request first; this names it.
   */
  test("everything the API's checks read off a request is on the handshake request", () => {
    const READ_ON_THE_JOIN_PATH: Array<[string, Array<string>]> = [
      [
        USER_AUTHORIZATION,
        [
          "getAccessTokenFromExpressRequest",
          "readRequestSession",
          "getSsoTokens",
          "isSsoProviderSatisfied",
          "getGlobalSsoTokenData",
          "doesProjectScopedSsoTokenExist",
          "getStatelessValidGlobalSsoTokenData",
          "isGlobalSsoTokenAuthorizedForProject",
          "isSsoSatisfiedForProject",
          "getUserTenantAccessPermissionWithTenantId",
        ],
      ],
      [COOKIE, ["getCookieFromExpressRequest", "getAllCookies"]],
    ];

    const ON_THE_HANDSHAKE: Array<string> = [
      "headers",
      "cookies",
      "userAuthorization",
    ];

    const readOffRequests: Set<string> = new Set<string>();

    for (const [source, methods] of READ_ON_THE_JOIN_PATH) {
      for (const method of methods) {
        const body: string = code(methodBody(source, method));
        const reads: RegExp =
          /\breq(?: as (?:OneUptimeRequest|ExpressRequest|RequestLike)\))?\??\.([A-Za-z_$][\w$]*)/g;

        for (const match of body.matchAll(reads)) {
          readOffRequests.add(match[1]!);
        }
      }
    }

    // The scan sees the reads it is there for.
    expect(Array.from(readOffRequests)).toEqual(
      expect.arrayContaining(ON_THE_HANDSHAKE),
    );
    expect(
      Array.from(readOffRequests).filter((field: string): boolean => {
        return !ON_THE_HANDSHAKE.includes(field);
      }),
    ).toEqual([]);
  });
});

const PROJECT: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_PROJECT: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROVIDER: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
// The project's other SAML provider, which is on.
const OTHER_PROVIDER: string = "12121212-1212-4121-8121-121212121212";
// A project SAML provider that has been turned off.
const TURNED_OFF_PROVIDER: string = "34343434-3434-4343-8343-343434343434";

// Whether a project's own provider vouches for its sign-ins: on unless turned off.
async function providerStanding(data: {
  providerId: ObjectID;
}): Promise<{ isOn: boolean; signInsEndedAtMs: number | null }> {
  return {
    isOn: data.providerId.toString() !== TURNED_OFF_PROVIDER,
    signInsEndedAtMs: null,
  };
}

function accessToken(isMasterAdmin: boolean): string {
  return JSONWebToken.signJsonPayload(
    {
      userId: USER,
      email: "realtime-guard@oneuptime.com",
      name: "Realtime Guard",
      isMasterAdmin: isMasterAdmin,
      sessionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    },
    15 * 60,
  );
}

// A project SAML sign-in by `providerId`; null leaves the provider out.
function projectSsoToken(
  projectId: string,
  providerId: string | null = OTHER_PROVIDER,
): string {
  return JSONWebToken.signJsonPayload(
    {
      userId: USER,
      projectId: projectId,
      email: "realtime-guard@oneuptime.com",
      name: "Realtime Guard",
      isMasterAdmin: false,
      ...(providerId
        ? {
            ssoProviderId: providerId,
            ssoProviderType: SsoProviderType.ProjectSSO,
          }
        : {}),
    },
    30 * 60,
  );
}

interface HandshakeCase {
  name: string;
  isMasterAdmin: boolean;
  cookies: Array<string>;
  headers?: Record<string, string>;
}

interface RequirementCase {
  name: string;
  projectRequiresSso: boolean;
  instanceRequiresSso: boolean;
  pinnedProvider: string | null;
}

const HANDSHAKES: Array<HandshakeCase> = [
  { name: "no SSO sign-in", isMasterAdmin: false, cookies: [] },
  {
    name: "the project's SSO sign-in",
    isMasterAdmin: false,
    cookies: [
      `${CookieUtil.getUserSSOKey(new ObjectID(PROJECT))}=${projectSsoToken(PROJECT)}`,
    ],
  },
  {
    name: "the pinned provider's SSO sign-in",
    isMasterAdmin: false,
    cookies: [
      `${CookieUtil.getUserSSOKey(new ObjectID(PROJECT))}=${projectSsoToken(PROJECT, PROVIDER)}`,
    ],
  },
  {
    name: "another project's SSO sign-in",
    isMasterAdmin: false,
    cookies: [
      `${CookieUtil.getUserSSOKey(new ObjectID(OTHER_PROJECT))}=${projectSsoToken(OTHER_PROJECT)}`,
    ],
  },
  {
    name: "the SSO sign-in of a provider that has been turned off",
    isMasterAdmin: false,
    cookies: [
      `${CookieUtil.getUserSSOKey(new ObjectID(PROJECT))}=${projectSsoToken(PROJECT, TURNED_OFF_PROVIDER)}`,
    ],
  },
  {
    name: "an SSO sign-in that names no provider",
    isMasterAdmin: false,
    cookies: [
      `${CookieUtil.getUserSSOKey(new ObjectID(PROJECT))}=${projectSsoToken(PROJECT, null)}`,
    ],
  },
  {
    name: "an SSO sign-in in the mobile header",
    isMasterAdmin: false,
    cookies: [],
    headers: {
      "x-sso-tokens": JSON.stringify({ [PROJECT]: projectSsoToken(PROJECT) }),
    },
  },
  { name: "a server admin, no SSO sign-in", isMasterAdmin: true, cookies: [] },
  {
    name: "a server admin with the project's SSO sign-in",
    isMasterAdmin: true,
    cookies: [
      `${CookieUtil.getUserSSOKey(new ObjectID(PROJECT))}=${projectSsoToken(PROJECT)}`,
    ],
  },
];

const REQUIREMENTS: Array<RequirementCase> = [
  {
    name: "nothing required",
    projectRequiresSso: false,
    instanceRequiresSso: false,
    pinnedProvider: null,
  },
  {
    name: "the project requires SSO",
    projectRequiresSso: true,
    instanceRequiresSso: false,
    pinnedProvider: null,
  },
  {
    name: "the project requires its pinned provider",
    projectRequiresSso: true,
    instanceRequiresSso: false,
    pinnedProvider: PROVIDER,
  },
  {
    name: "the instance requires SSO",
    projectRequiresSso: false,
    instanceRequiresSso: true,
    pinnedProvider: null,
  },
];

const tenantPermission: UserTenantAccessPermission = {
  projectId: new ObjectID(PROJECT),
  permissions: [],
  _type: "UserTenantAccessPermission",
} as unknown as UserTenantAccessPermission;

// The cookie header and headers of one handshake, as a browser sends them.
function headersOf(handshake: HandshakeCase): Record<string, string> {
  return {
    cookie: [
      `${CookieUtil.getUserTokenKey()}=${accessToken(handshake.isMasterAdmin)}`,
      ...handshake.cookies,
    ].join("; "),
    ...(handshake.headers || {}),
  };
}

// What the API answers a request with those headers, as its middleware asks it.
async function apiAnswer(
  headers: Record<string, string>,
): Promise<"allowed" | "sso-required" | "not-allowed"> {
  const request: ExpressRequest = { headers: { ...headers } } as ExpressRequest;

  CookieParser()(request, {} as never, (): void => {});

  const session: JSONObject | null =
    await (async (): Promise<JSONObject | null> => {
      const read: Awaited<
        ReturnType<typeof UserMiddleware.readRequestSession>
      > = await UserMiddleware.readRequestSession(request);

      return read.kind === "user" ? (read.session as JSONObject) : null;
    })();

  if (!session) {
    return "not-allowed";
  }

  (request as unknown as JSONObject)["userAuthorization"] = session;

  try {
    const permission: UserTenantAccessPermission | null =
      await UserMiddleware.getUserTenantAccessPermissionWithTenantId({
        req: request,
        tenantId: new ObjectID(PROJECT),
        userId: new ObjectID(USER),
      });

    return permission || session["isMasterAdmin"] ? "allowed" : "not-allowed";
  } catch (err) {
    if (err instanceof SsoAuthorizationException) {
      return "sso-required";
    }

    throw err;
  }
}

async function joinAnswer(
  headers: Record<string, string>,
): Promise<"allowed" | "sso-required" | "not-allowed"> {
  const decision: RealtimeJoinDecision = await RealtimeJoinAccess.decide(
    { handshake: { headers: headers } },
    PROJECT,
  );

  if (decision.allowed) {
    return "allowed";
  }

  return decision.refusal === RealtimeJoinRefusal.SsoRequired
    ? "sso-required"
    : "not-allowed";
}

describe("for the same handshake, the join answers as the API does", () => {
  beforeEach(() => {
    (UserService.isUserBlocked as unknown as jest.Mock).mockResolvedValue(
      false,
    );
    (
      AccessTokenService.getUserTenantAccessPermission as unknown as jest.Mock
    ).mockResolvedValue(tenantPermission);
    (
      AccessTokenService.getUserGlobalAccessPermission as unknown as jest.Mock
    ).mockResolvedValue(null);
    (
      ProjectSsoService.getSignInStanding as unknown as jest.Mock
    ).mockImplementation(providerStanding);
    (
      ProjectOidcService.getSignInStanding as unknown as jest.Mock
    ).mockImplementation(providerStanding);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  for (const requirement of REQUIREMENTS) {
    describe(requirement.name, () => {
      beforeEach(() => {
        (
          ProjectService.getRequireSsoForLogin as unknown as jest.Mock
        ).mockResolvedValue(requirement.projectRequiresSso);
        (
          ProjectService.getRequireSsoWithSsoProviderId as unknown as jest.Mock
        ).mockResolvedValue(
          requirement.pinnedProvider
            ? new ObjectID(requirement.pinnedProvider)
            : null,
        );
        (
          GlobalConfigService.getRequireSsoForLogin as unknown as jest.Mock
        ).mockResolvedValue(requirement.instanceRequiresSso);
      });

      test.each(
        HANDSHAKES.map((handshake: HandshakeCase): [string, HandshakeCase] => {
          return [handshake.name, handshake];
        }),
      )("%s", async (_name: string, handshake: HandshakeCase) => {
        const headers: Record<string, string> = headersOf(handshake);

        await expect(joinAnswer(headers)).resolves.toBe(
          await apiAnswer(headers),
        );
      });
    });
  }

  test("the matrix has both answers in it", async () => {
    (
      ProjectService.getRequireSsoForLogin as unknown as jest.Mock
    ).mockResolvedValue(true);
    (
      ProjectService.getRequireSsoWithSsoProviderId as unknown as jest.Mock
    ).mockResolvedValue(null);
    (
      GlobalConfigService.getRequireSsoForLogin as unknown as jest.Mock
    ).mockResolvedValue(false);

    await expect(joinAnswer(headersOf(HANDSHAKES[0]!))).resolves.toBe(
      "sso-required",
    );
    await expect(joinAnswer(headersOf(HANDSHAKES[1]!))).resolves.toBe(
      "allowed",
    );

    // A provider turned off no longer lets its sign-ins in, on either side.
    const turnedOff: HandshakeCase = HANDSHAKES.find(
      (handshake: HandshakeCase): boolean => {
        return handshake.name.includes("turned off");
      },
    )!;

    await expect(joinAnswer(headersOf(turnedOff))).resolves.toBe(
      "sso-required",
    );
    await expect(apiAnswer(headersOf(turnedOff))).resolves.toBe("sso-required");
  });
});
