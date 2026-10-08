import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every redirect that finishes connecting something to a project - a GitHub
 * App installation, a Slack workspace, a Microsoft 365 tenant, a person's
 * Slack or Microsoft account - lands on a callback that carries no session
 * and writes as OneUptime. Two rules keep those callbacks honest:
 *
 *  1. The project and the person come only from a one-use state the start
 *     route recorded, after asking the signed-in caller its question
 *     (WorkspaceOAuthState). No callback reads them from the redirect, and
 *     none signs a state of its own.
 *  2. Before anything is written, the callback asks the start's question
 *     again, of the person the state names, as they are now
 *     (WorkspaceOAuthCallbackAccess, GitHubConnectAccess).
 *  3. Every way it can end is answered, on the page the connection started
 *     from, with a code - never left without an answer, never a bare error
 *     page, never what a provider said: the callback is registered through
 *     ConnectCallback.route, the one outer catch, and answers nothing itself.
 *
 * This reads the route files and holds every start and callback to those
 * rules, and every route that spends a state to this list, so a new connect
 * callback has to be added here, with its question, to pass.
 */

const API_DIR: string = path.resolve(__dirname, "../../../Server/API");

// Comments are stripped so an explanation can never satisfy an assertion.
function readCode(file: string): string {
  return fs
    .readFileSync(path.join(API_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

const ROUTE_REGISTRATION: RegExp =
  /router\.(get|post|put|delete|all)\(\s*"([^"]+)"/g;

interface RegisteredRoute {
  path: string;
  // The registration and its handler, up to the next registration.
  body: string;
}

function routesOf(code: string): Array<RegisteredRoute> {
  const matches: Array<RegExpMatchArray> = Array.from(
    code.matchAll(ROUTE_REGISTRATION),
  );

  return matches.map((match: RegExpMatchArray, index: number) => {
    const start: number = match.index!;
    const next: RegExpMatchArray | undefined = matches[index + 1];
    const end: number = next ? next.index! : code.length;

    return { path: match[2]!, body: code.slice(start, end) };
  });
}

function routeOf(file: string, routePath: string): RegisteredRoute {
  const route: RegisteredRoute | undefined = routesOf(readCode(file)).find(
    (candidate: RegisteredRoute) => {
      return candidate.path === routePath;
    },
  );

  expect([file, routePath, Boolean(route)]).toEqual([file, routePath, true]);

  return route!;
}

// Where `needle` first appears in `body`, failing when it does not.
function positionOf(body: string, needle: string): number {
  const position: number = body.indexOf(needle);

  expect([needle, position >= 0]).toEqual([needle, true]);

  return position;
}

function expectBefore(body: string, first: string, later: Array<string>): void {
  const firstPosition: number = positionOf(body, first);

  for (const needle of later) {
    expect([first, needle, firstPosition < positionOf(body, needle)]).toEqual([
      first,
      needle,
      true,
    ]);
  }
}

// How a route spends a state: directly, or through Slack's own wrapper.
const SPENDS_A_STATE: RegExp =
  /WorkspaceOAuthState\.consume\(|SlackAPI\.consumeStateForCallback\(/;

interface Callback {
  file: string;
  path: string;
  // The page it answers on (ConnectProvider).
  provider: string;
  // The flows its state may have been issued for.
  flows: Array<string>;
  // What it asks of the person the state names.
  asksAgain: string;
  // What a refusal of that question tells the page.
  refusedAs: string;
  // The first call of each thing it writes, or asks of the provider.
  writes: Array<string>;
  // The helpers it hands its finishing to, which must not answer either.
  helpers?: Array<string> | undefined;
}

const CALLBACKS: Array<Callback> = [
  {
    file: "GitHubAPI.ts",
    path: "/github/auth/callback",
    provider: "ConnectProvider.GitHub",
    flows: ["WorkspaceOAuthFlow.GitHubAppInstall"],
    asksAgain: "GitHubConnectAccess.assertMayFinish(",
    refusedAs: "ConnectCallbackError.NoPermission",
    writes: [
      "GitHubUtil.assertUserControlsInstallation(",
      "ProjectService.updateOneById(",
      "CodeRepositoryService.importReposFromInstallation(",
    ],
  },
  {
    file: "SlackAPI.ts",
    path: "/slack/auth/:projectId/:userId",
    provider: "ConnectProvider.Slack",
    flows: ["WorkspaceOAuthFlow.SlackInstall"],
    asksAgain:
      "WorkspaceOAuthCallbackAccess.assertStartedByMayManageConnection(",
    refusedAs: "ConnectCallbackError.NoPermission",
    writes: [
      "API.post(",
      "WorkspaceProjectAuthTokenService.refreshAuthToken(",
      "WorkspaceUserAuthTokenService.refreshAuthToken(",
    ],
  },
  {
    file: "SlackAPI.ts",
    path: "/slack/auth/:projectId/:userId/user",
    provider: "ConnectProvider.Slack",
    flows: ["WorkspaceOAuthFlow.SlackUserSignIn"],
    asksAgain: "WorkspaceOAuthCallbackAccess.assertStartedByIsMember(",
    refusedAs: "ConnectCallbackError.NotAMember",
    writes: ["API.post(", "WorkspaceUserAuthTokenService.refreshAuthToken("],
  },
  {
    file: "MicrosoftTeamsAPI.ts",
    path: "/microsoft-teams/auth",
    provider: "ConnectProvider.MicrosoftTeams",
    flows: ["WorkspaceOAuthFlow.MicrosoftTeamsUserSignIn"],
    asksAgain: "WorkspaceOAuthCallbackAccess.assertStartedByIsMember(",
    refusedAs: "ConnectCallbackError.NotAMember",
    writes: [
      "API.post<JSONObject>(",
      "WorkspaceUserAuthTokenService.refreshAuthToken(",
      "MicrosoftTeamsUtil.refreshTeams(",
    ],
  },
  {
    file: "MicrosoftTeamsAPI.ts",
    path: "/microsoft-teams/admin-consent/callback",
    provider: "ConnectProvider.MicrosoftTeams",
    flows: [
      "WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent",
      "WorkspaceOAuthFlow.MicrosoftTeamsAdminConsentSignIn",
    ],
    asksAgain:
      "WorkspaceOAuthCallbackAccess.assertStartedByMayManageConnection(",
    refusedAs: "ConnectCallbackError.NoPermission",
    writes: [
      "MicrosoftTeamsAPI.continueAdminConsentWithSignIn(",
      "MicrosoftTeamsAPI.completeAdminConsent(",
    ],
    helpers: ["continueAdminConsentWithSignIn", "completeAdminConsent"],
  },
];

interface Start {
  file: string;
  path: string;
  flow: string;
  // What it asks of the signed-in caller before it records a state.
  asks: string;
}

const STARTS: Array<Start> = [
  {
    file: "GitHubAPI.ts",
    path: "/github/install-url",
    flow: "WorkspaceOAuthFlow.GitHubAppInstall",
    asks: "GitHubConnectAccess.assertMayStart(",
  },
  {
    file: "SlackAPI.ts",
    path: "/slack/install-url",
    flow: "WorkspaceOAuthFlow.SlackInstall",
    asks: "CommonAPI.assertPermittedInProject(",
  },
  {
    file: "SlackAPI.ts",
    path: "/slack/sign-in-url",
    flow: "WorkspaceOAuthFlow.SlackUserSignIn",
    asks: "CommonAPI.assertAuthenticatedProjectMember(",
  },
  {
    file: "MicrosoftTeamsAPI.ts",
    path: "/microsoft-teams/sign-in-url",
    flow: "WorkspaceOAuthFlow.MicrosoftTeamsUserSignIn",
    asks: "CommonAPI.assertAuthenticatedProjectMember(",
  },
  {
    file: "MicrosoftTeamsAPI.ts",
    path: "/microsoft-teams/admin-consent",
    flow: "WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent",
    asks: "CommonAPI.assertPermittedInProject(",
  },
];

describe("connect callbacks", () => {
  test.each(CALLBACKS)(
    "$path spends a one-use state for its own flow before anything else",
    (callback: Callback) => {
      const body: string = routeOf(callback.file, callback.path).body;

      expect(body).toMatch(SPENDS_A_STATE);

      for (const flow of callback.flows) {
        expect(
          body.includes(flow) || readCode(callback.file).includes(flow),
        ).toBe(true);
      }

      const spentAt: number = body.search(SPENDS_A_STATE);

      expect(spentAt).toBeLessThan(positionOf(body, callback.asksAgain));
    },
  );

  test.each(CALLBACKS)(
    "$path asks the start's question again before it writes or asks the provider",
    (callback: Callback) => {
      expectBefore(
        routeOf(callback.file, callback.path).body,
        callback.asksAgain,
        callback.writes,
      );
    },
  );

  test("every route that spends a state is one of the listed callbacks", () => {
    const spending: Array<string> = [];

    for (const file of fs.readdirSync(API_DIR)) {
      if (!file.endsWith(".ts")) {
        continue;
      }

      for (const route of routesOf(readCode(file))) {
        if (SPENDS_A_STATE.test(route.body)) {
          spending.push(`${file} ${route.path}`);
        }
      }
    }

    expect(spending.sort()).toEqual(
      CALLBACKS.map((callback: Callback) => {
        return `${callback.file} ${callback.path}`;
      }).sort(),
    );
  });
});

describe("connect starts", () => {
  test.each(STARTS)(
    "$path asks the signed-in caller before it records a state",
    (start: Start) => {
      const body: string = routeOf(start.file, start.path).body;

      expect(body).toContain("UserMiddleware.getUserMiddleware");
      expect(body).toContain(start.flow);
      expectBefore(body, start.asks, ["WorkspaceOAuthState.create("]);
    },
  );

  /*
   * Microsoft Teams admin consent records a second state for its sign-in leg,
   * in the helper its callback calls after asking again - never in a route.
   */
  test("every route that records a state is one of the listed starts", () => {
    const recording: Array<string> = [];

    for (const file of fs.readdirSync(API_DIR)) {
      if (!file.endsWith(".ts")) {
        continue;
      }

      for (const route of routesOf(readCode(file))) {
        if (route.body.includes("WorkspaceOAuthState.create(")) {
          recording.push(`${file} ${route.path}`);
        }
      }
    }

    expect(recording.sort()).toEqual(
      STARTS.map((start: Start) => {
        return `${start.file} ${start.path}`;
      }).sort(),
    );
  });
});

describe("the GitHub App installation", () => {
  test("no longer signs a state of its own: the callback trusts only WorkspaceOAuthState", () => {
    const code: string = readCode("GitHubAPI.ts");

    expect(code).not.toContain("JsonWebToken");
    expect(code).not.toContain("JSONWebToken");
    expect(code).not.toContain("decodeJsonPayload");
    expect(code).not.toContain("signJsonPayload");
  });

  test("the callback reads no project or person from the redirect", () => {
    const body: string = routeOf("GitHubAPI.ts", "/github/auth/callback").body;

    expect(body).not.toMatch(/req\.query\[\s*"projectId"\s*\]/);
    expect(body).not.toMatch(/req\.query\[\s*"userId"\s*\]/);
    expect(body).not.toMatch(/req\.params\[/);
    expect(body).toContain("record.projectId");
  });

  test("the old navigation route that started it is gone", () => {
    const paths: Array<string> = routesOf(readCode("GitHubAPI.ts")).map(
      (route: RegisteredRoute) => {
        return route.path;
      },
    );

    expect(paths).not.toContain("/github/auth/install");
    expect(paths).toContain("/github/install-url");
  });
});

/*
 * The body of a static helper of `file` - from its declaration to the next
 * member - for checking what a callback hands its finishing to.
 */
function helperBody(file: string, name: string): string {
  const code: string = readCode(file);
  const start: number = code.search(
    new RegExp(`private static async ${name}\\(|public static async ${name}\\(`),
  );

  expect([file, name, start >= 0]).toEqual([file, name, true]);

  const rest: string = code.slice(start + 1);
  const next: number = rest.search(/\n  (private|public|protected) /);

  return rest.slice(0, next >= 0 ? next : rest.length);
}

// Writing something into the page's ?error= by hand.
const ERROR_PARAM_WRITE: RegExp = /addQueryParam\(\s*"error"/;

// What only ConnectCallback may do: answer with an error, or put a word of a provider's on the page.
const ANSWERS_ITSELF: Array<RegExp> = [
  /Response\.sendErrorResponse\(/,
  ERROR_PARAM_WRITE,
  /req\.query\[\s*"error"\s*\]/,
  /req\.query\[\s*"error_description"\s*\]/,
  /res\.status\(/,
];

describe("every connect callback answers through the one outer catch", () => {
  test.each(CALLBACKS)(
    "$path is registered through ConnectCallback.route, for its own page",
    (callback: Callback) => {
      const body: string = routeOf(callback.file, callback.path).body;

      // The handler IS ConnectCallback.route: nothing runs outside its catch.
      const pathLiteral: string = `"${callback.path}",`;
      const afterPath: string = body
        .slice(body.indexOf(pathLiteral) + pathLiteral.length)
        .trimStart();

      expect(body.startsWith("router.get(")).toBe(true);
      expect(afterPath.startsWith("ConnectCallback.route({")).toBe(true);
      expect(body).toContain(`provider: ${callback.provider},`);
      expect(body).toContain(`refusedAs: ${callback.refusedAs},`);
    },
  );

  test.each(CALLBACKS)(
    "$path spends its state, asks again and finishes, in that order, inside the route",
    (callback: Callback) => {
      expectBefore(routeOf(callback.file, callback.path).body, "spendState:", [
        "askAgain:",
        "finish:",
      ]);
      expectBefore(routeOf(callback.file, callback.path).body, "askAgain:", [
        "finish:",
      ]);
    },
  );

  test.each(CALLBACKS)(
    "$path answers nothing itself: no error page, no provider's words on the page",
    (callback: Callback) => {
      const bodies: Array<string> = [
        routeOf(callback.file, callback.path).body,
        ...(callback.helpers || []).map((helper: string) => {
          return helperBody(callback.file, helper);
        }),
      ];

      for (const body of bodies) {
        for (const pattern of ANSWERS_ITSELF) {
          expect([callback.path, pattern.source, pattern.test(body)]).toEqual([
            callback.path,
            pattern.source,
            false,
          ]);
        }
      }
    },
  );

  test("no file of a connect callback puts anything but a code in ?error=", () => {
    for (const file of ["SlackAPI.ts", "MicrosoftTeamsAPI.ts", "GitHubAPI.ts"]) {
      expect([file, ERROR_PARAM_WRITE.test(readCode(file))]).toEqual([
        file,
        false,
      ]);
    }
  });

  test("a provider's own error is read in one place, and only as a code", () => {
    const connectCallback: string = readCode("ConnectCallback.ts");

    expect(connectCallback).toContain('req.query["error"]');
    expect(connectCallback).toContain('"access_denied"');

    for (const callback of CALLBACKS) {
      expect(routeOf(callback.file, callback.path).body).toContain(
        "ConnectCallback.refusalOfProviderError(",
      );
    }
  });
});
