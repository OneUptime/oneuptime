import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * Tests for the two pieces of MicrosoftTeamsUtil that turn "Microsoft said no"
 * into something a OneUptime admin can act on:
 *
 * - isGraphPermissionDeniedResponse: tells a REFUSAL (401/403, or one of the
 *   Graph authorization error codes returned with some other status) apart from
 *   a FAILURE (transport error, throttling, Graph outage). Only a refusal names
 *   a permission the admin can grant.
 *
 * - isAppInstalledInTeam: asks Graph whether a package carrying THIS
 *   deployment's MICROSOFT_TEAMS_APP_CLIENT_ID is installed in a team, matching
 *   on teamsApp.externalId. The customer scenario this whole diagnostic exists
 *   for is an admin staring at a tile literally named "OneUptime" that was
 *   installed from the Teams store and therefore carries OneUptime Cloud's app
 *   id, not this deployment's — that MUST come back NotInstalled, because the
 *   bot behind it will never accept posts from this deployment.
 *
 * The load-bearing invariant across the whole file: no failure mode is ever
 * reported as NotInstalled. A tenant that answers "I won't tell you" is
 * PermissionDenied (fixable in a minute by granting one permission) and
 * everything else is Unknown — never a false "the app is missing", which is
 * what sends admins round the install loop a second time.
 */

/*
 * The client id has to be a literal here: jest.mock factories run while the
 * module graph is being required, which is before any of this file's own consts
 * exist. CLIENT_ID below repeats the same value, and a test asserts the two
 * still agree so a copy-paste drift cannot quietly make every "Installed" case
 * vacuous.
 */
jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

/*
 * Same botbuilder module factory as the other MicrosoftTeams suites — the
 * repo-wide manual mock does not expose everything MicrosoftTeams.ts touches at
 * import time.
 */
jest.mock("botbuilder", () => {
  return {
    CloudAdapter: class CloudAdapter {},
    ConfigurationBotFrameworkAuthentication: class ConfigurationBotFrameworkAuthentication {},
    TeamsActivityHandler: class TeamsActivityHandler {},
    TurnContext: class TurnContext {},
    ActivityHandler: class ActivityHandler {},
    MessageFactory: {
      text: jest.fn(),
      attachment: jest.fn(),
    },
    CardFactory: { heroCard: jest.fn() },
    TeamsInfo: {
      getMembers: jest.fn(),
      getPagedMembers: jest.fn(),
    },
  };
});

import MicrosoftTeamsUtil, {
  MicrosoftTeamsAppInstallState,
  MICROSOFT_TEAMS_INSTALL_READ_PERMISSION,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import API from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import URL from "../../../../Types/API/URL";
import Headers from "../../../../Types/API/Headers";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { MessageFactory, CardFactory, TeamsInfo } from "botbuilder";

const CLIENT_ID: string = "11111111-2222-3333-4444-555555555555";
const GRAPH_TOKEN: string = "graph-token";
const AUTH_TOKEN: string = "stored-auth-token";
const TEAM_ID: string = "team-42";

// Mirrors MICROSOFT_TEAMS_MAX_PAGES in MicrosoftTeams.ts, which is not exported.
const MAX_PAGES: number = 500;

const FIRST_PAGE_URL: string = `https://graph.microsoft.com/v1.0/teams/${TEAM_ID}/installedApps?$expand=teamsApp`;
const SECOND_PAGE_URL: string = `https://graph.microsoft.com/v1.0/teams/${TEAM_ID}/installedApps?$expand=teamsApp&$skiptoken=page-2`;

interface CapturedGetCall {
  url: URL;
  headers: Headers;
}

/*
 * MicrosoftTeams.ts reads MicrosoftTeamsAppClientId off the module object on
 * every call, so overwriting the property on the mocked module is enough to
 * make the deployment look unconfigured for one test. afterEach puts it back.
 */
/*
 * require(), not a top-level `import * as`, and deliberately so: an ES
 * namespace import gives getter-only properties, and assigning to one throws
 * "Cannot set property ... which has only a getter". The raw CommonJS module
 * object is writable, which is the whole point — this flips the deployment to
 * "unconfigured" for a single test and puts it back afterwards.
 */
function mutableEnvironmentConfig(): Record<string, unknown> {
  /* eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  return require("../../../../Server/EnvironmentConfig") as Record<
    string,
    unknown
  >;
}

function setConfiguredClientId(clientId: string | null): void {
  mutableEnvironmentConfig()["MicrosoftTeamsAppClientId"] = clientId;
}

function getConfiguredClientId(): unknown {
  return mutableEnvironmentConfig()["MicrosoftTeamsAppClientId"];
}

function errorResponse(
  statusCode: number,
  body: JSONObject,
): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, body, {});
}

function mockAccessToken(): jest.SpyInstance {
  return jest
    .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
    .mockResolvedValue(GRAPH_TOKEN);
}

/*
 * Queues one Graph result per page, in order. Each entry is either a raw JSON
 * body (wrapped in a 200) or an already-built HTTPErrorResponse.
 */
function mockGraphPages(
  pages: Array<JSONObject | HTTPErrorResponse>,
): jest.SpyInstance {
  const getSpy: jest.SpyInstance = jest.spyOn(API, "get");

  for (const page of pages) {
    if (page instanceof HTTPErrorResponse) {
      getSpy.mockResolvedValueOnce(page);
    } else {
      getSpy.mockResolvedValueOnce(new HTTPResponse<JSONObject>(200, page, {}));
    }
  }

  return getSpy;
}

function installedAppJson(teamsApp: JSONObject | null): JSONObject {
  const installedApp: JSONObject = {
    id: `install-${JSON.stringify(teamsApp)}`,
  };
  if (teamsApp !== null) {
    installedApp["teamsApp"] = teamsApp;
  }
  return installedApp;
}

async function callIsAppInstalledInTeam(data?: {
  teamId?: string | undefined;
}): Promise<MicrosoftTeamsAppInstallState> {
  return MicrosoftTeamsUtil.isAppInstalledInTeam({
    authToken: AUTH_TOKEN,
    projectId: ObjectID.generate(),
    teamId: data?.teamId || TEAM_ID,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
  setConfiguredClientId(CLIENT_ID);
});

/*
 * The botbuilder module mock's jest.fn()s are shared across test files in this
 * suite run — jest.spyOn on an existing mock returns the same function, so call
 * history and mockResolvedValueOnce queues leak between tests unless reset.
 */
beforeEach(() => {
  (MessageFactory.text as jest.Mock).mockReset();
  (MessageFactory.attachment as jest.Mock).mockReset();
  (CardFactory.heroCard as jest.Mock).mockReset();
  (TeamsInfo.getMembers as jest.Mock).mockReset();
  (TeamsInfo.getPagedMembers as jest.Mock).mockReset();
});

describe("MicrosoftTeamsUtil.isGraphPermissionDeniedResponse", () => {
  describe("status codes", () => {
    test("returns FALSE for a 401 expired token — that is a credential problem, not a missing grant", () => {
      /*
       * Graph answers a missing application permission with 403 and reserves 401
       * for a token it will not accept. getValidAccessToken can hand back a
       * cached app token without revalidating it when miscData carries no
       * expiry, so this 401 is reachable in practice — and answering it with
       * "grant TeamsAppInstallation.ReadForTeam.All" would be exactly the
       * confidently-wrong diagnosis this whole change exists to stop producing.
       */
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(401, { message: "Access token has expired." }),
        ),
      ).toBe(false);
    });

    test("returns true for 403, regardless of body", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(403, { message: "Forbidden." }),
        ),
      ).toBe(true);
    });

    test("returns false for a bare 401 with no message", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(401, {}),
        ),
      ).toBe(false);
    });

    test("returns true for a 401 that DOES carry an authorization error code", () => {
      /*
       * Status alone is not the whole signal. If Graph names an authorization
       * refusal, honour it whatever status it arrived on.
       */
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(401, {
            error: { code: "Authorization_RequestDenied" },
          }),
        ),
      ).toBe(true);
    });

    test("returns true for 403 even when the body carries no message at all", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(403, {}),
        ),
      ).toBe(true);
    });

    test("returns false for 500 with an unrelated message", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(500, {
            message: "An internal server error occurred. Please try again.",
          }),
        ),
      ).toBe(false);
    });

    test("returns false for 404 with an unrelated message", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(404, {
            message: "No team found with the specified id.",
          }),
        ),
      ).toBe(false);
    });

    test("returns false for 429 with an unrelated message (throttling is a failure, not a refusal)", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(429, {
            message: "Too many requests. Retry after 30 seconds.",
          }),
        ),
      ).toBe(false);
    });

    test("returns false when the body yields an empty message", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(500, {}),
        ),
      ).toBe(false);
    });

    test("returns false when the body has only unrelated keys, so message resolves empty", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(503, { requestId: "abc-123", date: "2026-01-01" }),
        ),
      ).toBe(false);
    });
  });

  describe("message fragments on a non-401/403 status", () => {
    /*
     * Graph is not consistent about the status it returns with these codes, so
     * each has to be recognised on its own. 400 is used here precisely because
     * the status alone would not trip the check.
     */
    const fragmentCases: Array<{ name: string; message: string }> = [
      {
        name: "Authorization_RequestDenied (as written by Graph)",
        message:
          "Authorization_RequestDenied: Insufficient privileges to complete the operation.",
      },
      {
        name: "accessDenied (as written by Graph)",
        message: "accessDenied: Failed to execute Skype backend request.",
      },
      {
        name: "Insufficient privileges (as written by Graph)",
        message: "Insufficient privileges to complete the operation.",
      },
    ];

    for (const fragmentCase of fragmentCases) {
      test(`returns true for a 400 whose message contains ${fragmentCase.name}`, () => {
        expect(
          MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
            errorResponse(400, { message: fragmentCase.message }),
          ),
        ).toBe(true);
      });

      test(`matches ${fragmentCase.name} case-insensitively (all upper case)`, () => {
        expect(
          MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
            errorResponse(400, {
              message: fragmentCase.message.toUpperCase(),
            }),
          ),
        ).toBe(true);
      });

      test(`matches ${fragmentCase.name} case-insensitively (all lower case)`, () => {
        expect(
          MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
            errorResponse(400, {
              message: fragmentCase.message.toLowerCase(),
            }),
          ),
        ).toBe(true);
      });
    }

    test("matches a fragment embedded mid-sentence, not just at the start", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(400, {
            message:
              'Graph replied with code "Authorization_RequestDenied" while reading installedApps.',
          }),
        ),
      ).toBe(true);
    });
  });

  describe("nested body shapes (HTTPErrorResponse.message coercion)", () => {
    test("finds the fragment in { error: { code, message } }, Graph's real error envelope", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(400, {
            error: {
              code: "Authorization_RequestDenied",
              message: "Insufficient privileges to complete the operation.",
            },
          }),
        ),
      ).toBe(true);
    });

    test("finds the fragment in { error: { error: '...' } }, the nested-error shape", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(400, {
            error: { error: "accessDenied while expanding teamsApp" },
          }),
        ),
      ).toBe(true);
    });

    test("finds the fragment in { data: { message } }, since data is checked first", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(400, {
            data: { message: "Authorization_RequestDenied" },
          }),
        ),
      ).toBe(true);
    });

    test("finds the fragment via the JSON.stringify fallback when the object has neither message nor error", () => {
      /*
       * coerceToMessage falls back to JSON.stringify for an object it cannot
       * read a message out of, so the code survives inside the serialised blob.
       */
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(400, {
            error: {
              code: "Authorization_RequestDenied",
              innerError: { requestId: "abc" },
            },
          }),
        ),
      ).toBe(true);
    });

    test("returns false for a nested body whose message is unrelated", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(500, {
            error: {
              code: "InternalServerError",
              message: "An unexpected error occurred.",
            },
          }),
        ),
      ).toBe(false);
    });
  });

  describe("near-misses (documenting the REAL matching behaviour)", () => {
    /*
     * The check is a plain substring test against three exact fragments, so
     * English prose that MEANS the same thing does not match. These tests pin
     * the real behaviour rather than the intended one: if someone later swaps
     * the substring list for a looser regex, these will fail and force the
     * change to be a deliberate one.
     */
    test("returns FALSE for 'access is denied for this user' on a 500 — the fragment is 'accessdenied' with no words between", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(500, {
            message: "Access is denied for this user.",
          }),
        ),
      ).toBe(false);
    });

    test("returns FALSE for 'Access denied' (with a space) on a 500 — only the run-together Graph code matches", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(500, { message: "Access denied." }),
        ),
      ).toBe(false);
    });

    test("returns FALSE for 'insufficient permissions' on a 500 — the fragment is 'insufficient privileges'", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(500, {
            message: "Insufficient permissions to complete the operation.",
          }),
        ),
      ).toBe(false);
    });

    test("returns FALSE for 'unauthorized' on a 500 — a word the check deliberately does not carry", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(500, { message: "Unauthorized." }),
        ),
      ).toBe(false);
    });

    test("returns TRUE for the bare code 'accessDenied' on a 500 — the run-together form is what matches", () => {
      expect(
        MicrosoftTeamsUtil.isGraphPermissionDeniedResponse(
          errorResponse(500, { message: "accessDenied" }),
        ),
      ).toBe(true);
    });
  });
});

describe("MicrosoftTeamsUtil.isAppInstalledInTeam", () => {
  test("test fixture guard: the mocked deployment really is configured with CLIENT_ID", () => {
    /*
     * Every Installed assertion below is only meaningful if the client id the
     * fixtures hand to Graph is the client id the code compares against. If
     * these ever drift apart, the Installed cases would silently become
     * NotInstalled cases and stop testing anything.
     */
    expect(getConfiguredClientId()).toBe(CLIENT_ID);
  });

  describe("Installed", () => {
    test("Installed when a teamsApp externalId equals this deployment's client id", async () => {
      mockAccessToken();
      mockGraphPages([
        {
          value: [
            installedAppJson({
              id: "graph-generated-id",
              displayName: "OneUptime",
              externalId: CLIENT_ID,
            }),
          ],
        },
      ]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.Installed,
      );
    });

    test("Installed when the match is on the SECOND page (@odata.nextLink pagination)", async () => {
      mockAccessToken();
      const getSpy: jest.SpyInstance = mockGraphPages([
        {
          value: [
            installedAppJson({
              displayName: "Planner",
              externalId: "some-other-app-id",
            }),
          ],
          "@odata.nextLink": SECOND_PAGE_URL,
        },
        {
          value: [
            installedAppJson({
              displayName: "OneUptime",
              externalId: CLIENT_ID,
            }),
          ],
        },
      ]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.Installed,
      );

      expect(getSpy).toHaveBeenCalledTimes(2);

      const firstCall: CapturedGetCall = getSpy.mock
        .calls[0]?.[0] as CapturedGetCall;
      const secondCall: CapturedGetCall = getSpy.mock
        .calls[1]?.[0] as CapturedGetCall;

      expect(firstCall.url.toString()).toBe(FIRST_PAGE_URL);
      expect(secondCall.url.toString()).toBe(SECOND_PAGE_URL);
      expect(firstCall.headers["Authorization"]).toBe(`Bearer ${GRAPH_TOKEN}`);
      expect(secondCall.headers["Authorization"]).toBe(`Bearer ${GRAPH_TOKEN}`);
    });

    test("stops paginating as soon as it finds the match", async () => {
      mockAccessToken();
      const getSpy: jest.SpyInstance = mockGraphPages([
        {
          value: [
            installedAppJson({
              displayName: "OneUptime",
              externalId: CLIENT_ID,
            }),
          ],
          "@odata.nextLink": SECOND_PAGE_URL,
        },
      ]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.Installed,
      );
      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    test("matches on externalId, not on displayName — a renamed package still counts as installed", async () => {
      mockAccessToken();
      mockGraphPages([
        {
          value: [
            installedAppJson({
              displayName: "Acme Status (self-hosted)",
              externalId: CLIENT_ID,
            }),
          ],
        },
      ]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.Installed,
      );
    });
  });

  describe("NotInstalled", () => {
    test("NotInstalled when a single page has no matching externalId", async () => {
      mockAccessToken();
      mockGraphPages([
        {
          value: [
            installedAppJson({
              displayName: "Planner",
              externalId: "planner-app-id",
            }),
            installedAppJson({
              displayName: "Approvals",
              externalId: "approvals-app-id",
            }),
          ],
        },
      ]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.NotInstalled,
      );
    });

    test("NotInstalled when the team has no installed apps at all", async () => {
      mockAccessToken();
      mockGraphPages([{ value: [] }]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.NotInstalled,
      );
    });

    test("NotInstalled when the response omits value entirely", async () => {
      mockAccessToken();
      mockGraphPages([{}]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.NotInstalled,
      );
    });

    test("NotInstalled when every page is exhausted with no matching externalId", async () => {
      mockAccessToken();
      const getSpy: jest.SpyInstance = mockGraphPages([
        {
          value: [
            installedAppJson({ displayName: "Planner", externalId: "a" }),
          ],
          "@odata.nextLink": SECOND_PAGE_URL,
        },
        {
          value: [installedAppJson({ displayName: "Forms", externalId: "b" })],
        },
      ]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.NotInstalled,
      );
      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    /*
     * THE customer scenario. An admin installs "OneUptime" from the Teams
     * store, sees the tile in Manage team > Apps, and reasonably concludes the
     * integration is set up. That package carries OneUptime Cloud's app id, so
     * its bot is a different bot and will never accept a proactive post from
     * this deployment. Answering "Installed" here — matching on the name, or on
     * anything other than this deployment's client id — would turn the whole
     * diagnostic into a lie and send the admin looking at the Azure Bot
     * resource for a problem that is really the wrong package.
     */
    test("NotInstalled for a DIFFERENT app that is also called OneUptime (the Teams-store package)", async () => {
      mockAccessToken();
      mockGraphPages([
        {
          value: [
            installedAppJson({
              id: "store-catalog-id",
              displayName: "OneUptime",
              distributionMethod: "store",
              externalId: "99999999-8888-7777-6666-555555555555",
            }),
          ],
        },
      ]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.NotInstalled,
      );
    });

    test("NotInstalled when an installed app carries no teamsApp expansion", async () => {
      mockAccessToken();
      mockGraphPages([{ value: [installedAppJson(null)] }]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.NotInstalled,
      );
    });

    test("NotInstalled when a teamsApp has no externalId at all", async () => {
      mockAccessToken();
      mockGraphPages([
        { value: [installedAppJson({ displayName: "OneUptime" })] },
      ]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.NotInstalled,
      );
    });
  });

  describe("PermissionDenied", () => {
    test("PermissionDenied when Graph answers 403", async () => {
      mockAccessToken();
      mockGraphPages([
        errorResponse(403, {
          error: {
            code: "Authorization_RequestDenied",
            message: "Insufficient privileges to complete the operation.",
          },
        }),
      ]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.PermissionDenied,
      );
    });

    test("Unknown — not PermissionDenied — when Graph answers 401 with a bad token", async () => {
      /*
       * An expired or empty token is a credential problem. Reporting it as
       * PermissionDenied would put "grant this Graph permission" in front of an
       * admin whose permission was never the issue.
       */
      mockAccessToken();
      mockGraphPages([
        errorResponse(401, {
          error: {
            code: "InvalidAuthenticationToken",
            message: "Access token is empty.",
          },
        }),
      ]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.Unknown,
      );
    });

    test("PermissionDenied on a non-401/403 status carrying an authorization code", async () => {
      mockAccessToken();
      mockGraphPages([
        errorResponse(400, {
          error: {
            code: "Authorization_RequestDenied",
            message: "Insufficient privileges to complete the operation.",
          },
        }),
      ]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.PermissionDenied,
      );
    });

    test("PermissionDenied when the refusal arrives on the SECOND page, not the first", async () => {
      mockAccessToken();
      mockGraphPages([
        {
          value: [
            installedAppJson({ displayName: "Planner", externalId: "a" }),
          ],
          "@odata.nextLink": SECOND_PAGE_URL,
        },
        errorResponse(403, { message: "Forbidden." }),
      ]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.PermissionDenied,
      );
    });

    test("a refusal is never reported as NotInstalled", async () => {
      mockAccessToken();
      mockGraphPages([errorResponse(403, { message: "Forbidden." })]);

      const state: MicrosoftTeamsAppInstallState =
        await callIsAppInstalledInTeam();

      expect(state).not.toBe(MicrosoftTeamsAppInstallState.NotInstalled);
      expect(state).not.toBe(MicrosoftTeamsAppInstallState.Installed);
    });

    test("names the grant that fixes it in the roster rejection message", () => {
      const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
        channelName: "Ops",
        installState: MicrosoftTeamsAppInstallState.PermissionDenied,
      });

      expect(message).toContain(MICROSOFT_TEAMS_INSTALL_READ_PERMISSION);
      expect(MICROSOFT_TEAMS_INSTALL_READ_PERMISSION).toBe(
        "TeamsAppInstallation.ReadForTeam.All",
      );
    });
  });

  describe("Unknown", () => {
    test("Unknown when Graph answers 500 with an unrelated message", async () => {
      mockAccessToken();
      mockGraphPages([
        errorResponse(500, {
          error: {
            code: "InternalServerError",
            message: "An unexpected error occurred.",
          },
        }),
      ]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.Unknown,
      );
    });

    test("Unknown when Graph answers 429 (throttling is a failure, not a refusal)", async () => {
      mockAccessToken();
      mockGraphPages([errorResponse(429, { message: "Too many requests." })]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.Unknown,
      );
    });

    test("Unknown when Graph answers 404 for the team", async () => {
      mockAccessToken();
      mockGraphPages([
        errorResponse(404, { message: "No team found with the specified id." }),
      ]);

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.Unknown,
      );
    });

    test("Unknown when getValidAccessToken throws", async () => {
      jest
        .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
        .mockRejectedValue(new Error("Refresh token expired"));
      const getSpy: jest.SpyInstance = jest.spyOn(API, "get");

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.Unknown,
      );
      expect(getSpy).not.toHaveBeenCalled();
    });

    test("Unknown when API.get itself rejects (transport failure)", async () => {
      mockAccessToken();
      jest
        .spyOn(API, "get")
        .mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.Unknown,
      );
    });

    test("Unknown when the client id is not configured, without calling Graph", async () => {
      setConfiguredClientId(null);
      const tokenSpy: jest.SpyInstance = mockAccessToken();
      /*
       * A rejecting implementation rather than a bare spy, so that a
       * regression which does reach Graph fails loudly here instead of
       * attempting a real network call.
       */
      const getSpy: jest.SpyInstance = jest
        .spyOn(API, "get")
        .mockRejectedValue(new Error("Graph must not be called"));

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.Unknown,
      );
      expect(tokenSpy).not.toHaveBeenCalled();
      expect(getSpy).not.toHaveBeenCalled();
    });

    test("Unknown when the client id is configured as an empty string", async () => {
      setConfiguredClientId("");
      const getSpy: jest.SpyInstance = jest
        .spyOn(API, "get")
        .mockRejectedValue(new Error("Graph must not be called"));

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.Unknown,
      );
      expect(getSpy).not.toHaveBeenCalled();
    });

    test(`Unknown when pagination exceeds the ${MAX_PAGES}-page cap, and it stops after exactly ${MAX_PAGES} requests`, async () => {
      mockAccessToken();

      /*
       * A Graph response that always points at another page. Without the cap
       * this is an infinite loop, so the assertion on the call count is the
       * one that matters: the guard must fire, and it must fire before the
       * request that would have been page 501.
       */
      const getSpy: jest.SpyInstance = jest.spyOn(API, "get").mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          {
            value: [
              installedAppJson({
                displayName: "Planner",
                externalId: "not-this-deployment",
              }),
            ],
            "@odata.nextLink": SECOND_PAGE_URL,
          },
          {},
        ),
      );

      await expect(callIsAppInstalledInTeam()).resolves.toBe(
        MicrosoftTeamsAppInstallState.Unknown,
      );
      expect(getSpy).toHaveBeenCalledTimes(MAX_PAGES);
    });
  });
});
