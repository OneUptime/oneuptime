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
  // The flows its state may have been issued for.
  flows: Array<string>;
  // What it asks of the person the state names.
  asksAgain: string;
  // The first call of each thing it writes, or asks of the provider.
  writes: Array<string>;
}

const CALLBACKS: Array<Callback> = [
  {
    file: "GitHubAPI.ts",
    path: "/github/auth/callback",
    flows: ["WorkspaceOAuthFlow.GitHubAppInstall"],
    asksAgain: "GitHubConnectAccess.assertMayFinish(",
    writes: [
      "GitHubUtil.assertUserControlsInstallation(",
      "ProjectService.updateOneById(",
      "CodeRepositoryService.importReposFromInstallation(",
    ],
  },
  {
    file: "SlackAPI.ts",
    path: "/slack/auth/:projectId/:userId",
    flows: ["WorkspaceOAuthFlow.SlackInstall"],
    asksAgain:
      "WorkspaceOAuthCallbackAccess.assertStartedByMayManageConnection(",
    writes: [
      "API.post(",
      "WorkspaceProjectAuthTokenService.refreshAuthToken(",
      "WorkspaceUserAuthTokenService.refreshAuthToken(",
    ],
  },
  {
    file: "SlackAPI.ts",
    path: "/slack/auth/:projectId/:userId/user",
    flows: ["WorkspaceOAuthFlow.SlackUserSignIn"],
    asksAgain: "WorkspaceOAuthCallbackAccess.assertStartedByIsMember(",
    writes: ["API.post(", "WorkspaceUserAuthTokenService.refreshAuthToken("],
  },
  {
    file: "MicrosoftTeamsAPI.ts",
    path: "/microsoft-teams/auth",
    flows: ["WorkspaceOAuthFlow.MicrosoftTeamsUserSignIn"],
    asksAgain: "WorkspaceOAuthCallbackAccess.assertStartedByIsMember(",
    writes: [
      "API.post<JSONObject>(",
      "WorkspaceUserAuthTokenService.refreshAuthToken(",
      "MicrosoftTeamsUtil.refreshTeams(",
    ],
  },
  {
    file: "MicrosoftTeamsAPI.ts",
    path: "/microsoft-teams/admin-consent/callback",
    flows: [
      "WorkspaceOAuthFlow.MicrosoftTeamsAdminConsent",
      "WorkspaceOAuthFlow.MicrosoftTeamsAdminConsentSignIn",
    ],
    asksAgain:
      "WorkspaceOAuthCallbackAccess.assertStartedByMayManageConnection(",
    writes: [
      "MicrosoftTeamsAPI.continueAdminConsentWithSignIn(",
      "MicrosoftTeamsAPI.completeAdminConsent(",
    ],
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
    expect(body).toContain("stateRecord.projectId");
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
