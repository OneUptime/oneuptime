import MicrosoftTeamsMeetingsOAuthApp, {
  MICROSOFT_CONSUMER_TENANT_ID,
  MICROSOFT_ORGANIZATIONS_AUTHORITY,
  MICROSOFT_TEAMS_MEETINGS_RECORDING_SCOPES,
  MICROSOFT_TEAMS_MEETINGS_SCOPE,
} from "../../../../../Server/Utils/VideoCall/OAuth/MicrosoftTeamsMeetingsOAuthApp";
import {
  VideoCallOAuthGrant,
  VideoCallOAuthGrantProblem,
  VideoCallOAuthGrantRefusal,
  VideoCallOAuthTokens,
} from "../../../../../Server/Utils/VideoCall/OAuth/VideoCallOAuth";
import VideoCallHttpClient from "../../../../../Server/Utils/VideoCall/VideoCallHttpClient";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import {
  ScriptedFetch,
  readFormBody,
  scriptedFetch,
} from "../VideoCallTestFetch";
import { unsignedIdToken } from "./VideoCallOAuthTestHelpers";
import { describe, expect, test } from "@jest/globals";

/*
 * Microsoft Teams' one-click Connect: a work or school account signs in
 * with the delegated OnlineMeetings.ReadWrite permission - no application
 * access policy - and every refresh's new refresh token is kept.
 */

const CLIENT_ID: string = "6c1a8d3e-1111-4222-8333-944455556666";
const TENANT_ID: string = "0d3b1c0e-58f1-4bd1-8bb0-2b0f6f3f6c11";
const OBJECT_ID: string = "7b2e9f10-aaaa-4bbb-8ccc-dddddddddddd";

const REDIRECT_URI: string =
  "https://oneuptime.com/api/video-call-oauth/microsoft-teams/callback";

function tokenResponse(
  overrides?: JSONObject,
  claims?: JSONObject,
): JSONObject {
  return {
    token_type: "Bearer",
    scope: `${MICROSOFT_TEAMS_MEETINGS_SCOPE} openid profile email`,
    expires_in: 4000,
    access_token: "graph-access",
    refresh_token: "ms-refresh-1",
    id_token: unsignedIdToken({
      aud: CLIENT_ID,
      tid: TENANT_ID,
      oid: OBJECT_ID,
      preferred_username: "incidents@acme.onmicrosoft.com",
      ...(claims || {}),
    }),
    ...(overrides || {}),
  };
}

function newApp(fetcher: ScriptedFetch): MicrosoftTeamsMeetingsOAuthApp {
  return new MicrosoftTeamsMeetingsOAuthApp(
    { clientId: CLIENT_ID, clientSecret: "ms-secret" },
    new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
  );
}

describe("MicrosoftTeamsMeetingsOAuthApp", () => {
  test("signs in work and school accounts only, asking for the delegated meeting permission and offline access", () => {
    const url: URL = new URL(
      newApp(scriptedFetch([])).getAuthorizationUrl({
        state: "s",
        redirectUri: REDIRECT_URI,
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(
      `${MICROSOFT_ORGANIZATIONS_AUTHORITY}/oauth2/v2.0/authorize`,
    );
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("response_mode")).toBe("query");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("scope")!.split(" ")).toEqual([
      "openid",
      "profile",
      "email",
      "offline_access",
      MICROSOFT_TEAMS_MEETINGS_SCOPE,
    ]);
  });

  test("exchanges the code and reads the tenant and the account from the ID token", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: tokenResponse() },
    ]);

    const grant: VideoCallOAuthGrant = await newApp(fetcher).exchangeCode({
      code: "code",
      redirectUri: REDIRECT_URI,
    });

    expect(fetcher.requests[0]!.url).toBe(
      `${MICROSOFT_ORGANIZATIONS_AUTHORITY}/oauth2/v2.0/token`,
    );
    const body: URLSearchParams = readFormBody(fetcher.requests[0]!);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_secret")).toBe("ms-secret");
    expect(body.get("redirect_uri")).toBe(REDIRECT_URI);

    expect(grant.account).toEqual({
      label: "incidents@acme.onmicrosoft.com",
      externalUserId: OBJECT_ID,
      externalAccountId: TENANT_ID,
    });
  });

  test("refuses a personal Microsoft account, which cannot create Teams meetings", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 200,
        body: tokenResponse(undefined, { tid: MICROSOFT_CONSUMER_TENANT_ID }),
      },
    ]);

    const error: unknown = await newApp(fetcher)
      .exchangeCode({ code: "c", redirectUri: REDIRECT_URI })
      .catch((err: unknown) => {
        return err;
      });

    expect(error).toBeInstanceOf(VideoCallOAuthGrantRefusal);
    expect((error as VideoCallOAuthGrantRefusal).problem).toBe(
      VideoCallOAuthGrantProblem.WorkAccountRequired,
    );
  });

  test("refuses a sign-in without the meeting permission", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: tokenResponse({ scope: "openid profile email" }) },
    ]);

    const error: unknown = await newApp(fetcher)
      .exchangeCode({ code: "c", redirectUri: REDIRECT_URI })
      .catch((err: unknown) => {
        return err;
      });

    expect((error as VideoCallOAuthGrantRefusal).problem).toBe(
      VideoCallOAuthGrantProblem.PermissionNotGranted,
    );
  });

  test("accepts the permission however Microsoft lists it", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 200,
        body: tokenResponse({ scope: "OnlineMeetings.ReadWrite openid" }),
      },
    ]);

    await expect(
      newApp(fetcher).exchangeCode({ code: "c", redirectUri: REDIRECT_URI }),
    ).resolves.toBeDefined();
  });

  test("refreshes against the account's own tenant and keeps the new refresh token", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 200,
        body: tokenResponse({
          access_token: "graph-access-2",
          refresh_token: "ms-refresh-2",
        }),
      },
    ]);

    const tokens: VideoCallOAuthTokens = await newApp(fetcher).refresh({
      secrets: { refreshToken: "ms-refresh-1", externalAccountId: TENANT_ID },
      accountLabel: "incidents@acme.onmicrosoft.com",
    });

    expect(fetcher.requests[0]!.url).toBe(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    );
    const body: URLSearchParams = readFormBody(fetcher.requests[0]!);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("ms-refresh-1");
    expect(body.get("scope")).toBe(
      `offline_access ${MICROSOFT_TEAMS_MEETINGS_SCOPE}`,
    );
    expect(tokens.refreshToken).toBe("ms-refresh-2");
  });

  test("a sign-in a tenant policy ended says to reconnect", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 400,
        body: {
          error: "interaction_required",
          error_description:
            "AADSTS50076: Due to a configuration change made by your administrator, you must use multi-factor authentication.",
        },
      },
    ]);

    const error: unknown = await newApp(fetcher)
      .refresh({
        secrets: { refreshToken: "r", externalAccountId: TENANT_ID },
        accountLabel: "incidents@acme.onmicrosoft.com",
      })
      .catch((err: unknown) => {
        return err;
      });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toContain(
      "Reconnect Microsoft Teams in Project Settings > Workspace > Video Calls",
    );
  });
});

/*
 * An app registered for one organization only - which an organization
 * that allows no multitenant apps registers - is refused at
 * "organizations" with AADSTS50194, as the Teams bot's user sign-in was in
 * issue #5202. MICROSOFT_TEAMS_MEETINGS_APP_TENANT_ID names its tenant, and
 * every sign-in goes there.
 */
describe("MicrosoftTeamsMeetingsOAuthApp - an app registered for one organization", () => {
  const APP_TENANT_ID: string = "4a1f9e60-1b2c-4d3e-8f40-a1b2c3d4e5f6";

  const singleTenantApp: (
    fetcher: ScriptedFetch,
    tenantId: string | undefined,
  ) => MicrosoftTeamsMeetingsOAuthApp = (
    fetcher: ScriptedFetch,
    tenantId: string | undefined,
  ): MicrosoftTeamsMeetingsOAuthApp => {
    return new MicrosoftTeamsMeetingsOAuthApp(
      tenantId === undefined
        ? { clientId: CLIENT_ID, clientSecret: "ms-secret" }
        : { clientId: CLIENT_ID, clientSecret: "ms-secret", tenantId },
      new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
    );
  };

  test("signs in at the app's tenant, never at organizations", () => {
    const url: URL = new URL(
      singleTenantApp(scriptedFetch([]), APP_TENANT_ID).getAuthorizationUrl({
        state: "s",
        redirectUri: REDIRECT_URI,
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(
      `https://login.microsoftonline.com/${APP_TENANT_ID}/oauth2/v2.0/authorize`,
    );
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.pathname).not.toContain("organizations");
  });

  test("exchanges the code at the authority that issued it, and reads who signed in", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: tokenResponse(undefined, { tid: APP_TENANT_ID }) },
    ]);

    const grant: VideoCallOAuthGrant = await singleTenantApp(
      fetcher,
      APP_TENANT_ID,
    ).exchangeCode({ code: "code", redirectUri: REDIRECT_URI });

    expect(fetcher.requests).toHaveLength(1);
    expect(fetcher.requests[0]!.url).toBe(
      `https://login.microsoftonline.com/${APP_TENANT_ID}/oauth2/v2.0/token`,
    );
    expect(grant.account.externalAccountId).toBe(APP_TENANT_ID);
  });

  test("refreshes a sign-in stored with its tenant at that tenant, and one stored without at the app's", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: tokenResponse() },
      { status: 200, body: tokenResponse() },
    ]);
    const app: MicrosoftTeamsMeetingsOAuthApp = singleTenantApp(
      fetcher,
      APP_TENANT_ID,
    );

    await app.refresh({
      secrets: { refreshToken: "r", externalAccountId: TENANT_ID },
      accountLabel: "incidents@acme.onmicrosoft.com",
    });
    await app.refresh({
      secrets: { refreshToken: "r" },
      accountLabel: "incidents@acme.onmicrosoft.com",
    });

    expect(
      fetcher.requests.map((request: { url: string }): string => {
        return request.url;
      }),
    ).toEqual([
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      `https://login.microsoftonline.com/${APP_TENANT_ID}/oauth2/v2.0/token`,
    ]);
  });

  test("a tenant named by one of its domains signs in there too, in lower case", () => {
    expect(
      singleTenantApp(
        scriptedFetch([]),
        "  Contoso.OnMicrosoft.com ",
      ).getSignInAuthority(),
    ).toBe("https://login.microsoftonline.com/contoso.onmicrosoft.com");
  });

  test.each([
    ["no tenant", undefined],
    ["an empty tenant", ""],
    ["common, which a single-tenant app is refused at", "common"],
    ["organizations", "organizations"],
    ["consumers", "consumers"],
    ["text that is no tenant", "my tenant"],
    ["a path", "../common"],
  ])(
    "%s: a multitenant app's sign-in, at organizations",
    (_label: string, tenantId: string | undefined) => {
      const app: MicrosoftTeamsMeetingsOAuthApp = singleTenantApp(
        scriptedFetch([]),
        tenantId,
      );

      expect(app.getSignInAuthority()).toBe(MICROSOFT_ORGANIZATIONS_AUTHORITY);
      expect(
        app.getAuthorizationUrl({ state: "s", redirectUri: REDIRECT_URI }),
      ).toContain(`${MICROSOFT_ORGANIZATIONS_AUTHORITY}/oauth2/v2.0/authorize?`);
    },
  );
});

describe("MicrosoftTeamsMeetingsOAuthApp - a project that records and transcribes its calls", () => {
  const CALENDAR_SCOPE: string =
    "https://graph.microsoft.com/Calendars.ReadWrite";
  const TRANSCRIPT_SCOPE: string =
    "https://graph.microsoft.com/OnlineMeetingTranscript.Read.All";

  const BASE_SIGN_IN_SCOPES: Array<string> = [
    "openid",
    "profile",
    "email",
    "offline_access",
    MICROSOFT_TEAMS_MEETINGS_SCOPE,
  ];

  test("its sign-in also asks to use the account's calendar and read meeting transcripts", () => {
    const url: URL = new URL(
      newApp(scriptedFetch([])).getAuthorizationUrl({
        state: "s",
        redirectUri: REDIRECT_URI,
        recordAndTranscribe: true,
      }),
    );

    expect(url.searchParams.get("scope")!.split(" ")).toEqual([
      ...BASE_SIGN_IN_SCOPES,
      CALENDAR_SCOPE,
      TRANSCRIPT_SCOPE,
    ]);
    expect(MICROSOFT_TEAMS_MEETINGS_RECORDING_SCOPES).toEqual([
      CALENDAR_SCOPE,
      TRANSCRIPT_SCOPE,
    ]);
  });

  test("any other project's sign-in asks for nothing more, so anyone with a Teams license can connect", () => {
    for (const recordAndTranscribe of [false, undefined]) {
      const url: URL = new URL(
        newApp(scriptedFetch([])).getAuthorizationUrl({
          state: "s",
          redirectUri: REDIRECT_URI,
          recordAndTranscribe,
        }),
      );

      expect(url.searchParams.get("scope")!.split(" ")).toEqual(
        BASE_SIGN_IN_SCOPES,
      );
    }
  });

  test("the code is exchanged for what the sign-in asked", async () => {
    const recording: ScriptedFetch = scriptedFetch([
      { status: 200, body: tokenResponse() },
    ]);
    await newApp(recording).exchangeCode({
      code: "c",
      redirectUri: REDIRECT_URI,
      recordAndTranscribe: true,
    });
    expect(
      readFormBody(recording.requests[0]!).get("scope")!.split(" "),
    ).toEqual([...BASE_SIGN_IN_SCOPES, CALENDAR_SCOPE, TRANSCRIPT_SCOPE]);

    const plain: ScriptedFetch = scriptedFetch([
      { status: 200, body: tokenResponse() },
    ]);
    await newApp(plain).exchangeCode({ code: "c", redirectUri: REDIRECT_URI });
    expect(readFormBody(plain.requests[0]!).get("scope")!.split(" ")).toEqual(
      BASE_SIGN_IN_SCOPES,
    );
  });

  test("a sign-in granted the meeting permission alone still connects: its calls start, unrecorded", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 200,
        body: tokenResponse({ scope: "OnlineMeetings.ReadWrite openid" }),
      },
    ]);

    const grant: VideoCallOAuthGrant = await newApp(fetcher).exchangeCode({
      code: "c",
      redirectUri: REDIRECT_URI,
      recordAndTranscribe: true,
    });

    expect(grant.tokens.scope).toBe("OnlineMeetings.ReadWrite openid");
  });

  test("a refresh asks again for the recording permissions the sign-in was granted, and never for more", async () => {
    const cases: Array<[string | undefined, Array<string>]> = [
      [undefined, []],
      [`${MICROSOFT_TEAMS_MEETINGS_SCOPE} openid profile email`, []],
      [
        "Calendars.ReadWrite OnlineMeetingTranscript.Read.All OnlineMeetings.ReadWrite",
        [CALENDAR_SCOPE, TRANSCRIPT_SCOPE],
      ],
      [
        `${CALENDAR_SCOPE.toLowerCase()} ${MICROSOFT_TEAMS_MEETINGS_SCOPE}`,
        [CALENDAR_SCOPE],
      ],
    ];

    for (const [scope, recordingScopes] of cases) {
      const fetcher: ScriptedFetch = scriptedFetch([
        { status: 200, body: tokenResponse() },
      ]);

      await newApp(fetcher).refresh({
        secrets: {
          refreshToken: "ms-refresh-1",
          externalAccountId: TENANT_ID,
          ...(scope ? { scope } : {}),
        },
        accountLabel: "incidents@acme.onmicrosoft.com",
      });

      expect(
        readFormBody(fetcher.requests[0]!).get("scope")!.split(" "),
      ).toEqual([
        "offline_access",
        MICROSOFT_TEAMS_MEETINGS_SCOPE,
        ...recordingScopes,
      ]);
    }
  });

  test("reads a permission in a granted scope list bare or as its Graph scope, in any case, and never a longer one", () => {
    expect(
      MicrosoftTeamsMeetingsOAuthApp.grants(
        "openid Calendars.ReadWrite",
        "Calendars.ReadWrite",
      ),
    ).toBe(true);
    expect(
      MicrosoftTeamsMeetingsOAuthApp.grants(
        "https://graph.microsoft.com/onlinemeetingtranscript.read.all",
        "OnlineMeetingTranscript.Read.All",
      ),
    ).toBe(true);
    expect(
      MicrosoftTeamsMeetingsOAuthApp.grants(
        "Calendars.ReadWrite.Shared OnlineMeetingTranscript.Read.Chat",
        "Calendars.ReadWrite",
      ),
    ).toBe(false);
    expect(
      MicrosoftTeamsMeetingsOAuthApp.grants(
        "Calendars.ReadWrite.Shared OnlineMeetingTranscript.Read.Chat",
        "OnlineMeetingTranscript.Read.All",
      ),
    ).toBe(false);
    expect(
      MicrosoftTeamsMeetingsOAuthApp.grants(undefined, "Calendars.ReadWrite"),
    ).toBe(false);
  });
});
