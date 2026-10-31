import { describe, expect, jest, test } from "@jest/globals";

/*
 * THIS SERVER'S TEAMS MEETINGS APP, SINGLE-TENANT OR NOT
 * (Server/Utils/VideoCall/OAuth/VideoCallOAuthApps).
 *
 * The one-click Connect of Microsoft Teams signs people in with this
 * server's own Entra app. MICROSOFT_TEAMS_MEETINGS_APP_TENANT_ID names the
 * tenant an app registered for one organization lives in: its sign-in goes
 * there, as Microsoft takes it from such an app. Without it, the app signs
 * in as a multitenant one, as before. No other provider has a tenant.
 */

const environment: Record<string, string | null> = {
  MicrosoftTeamsMeetingsAppClientId: "6c1a8d3e-1111-4222-8333-944455556666",
  MicrosoftTeamsMeetingsAppClientSecret: "ms-secret",
  MicrosoftTeamsMeetingsAppTenantId: null,
  ZoomAppClientId: "zoom-client-id",
  ZoomAppClientSecret: "zoom-client-secret",
  GoogleMeetAppClientId: "google-client-id",
  GoogleMeetAppClientSecret: "google-client-secret",
};

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return new Proxy(actual, {
    get: (target: Record<string, unknown>, key: string | symbol): unknown => {
      if (typeof key === "string" && key in environment) {
        return environment[key];
      }

      return target[key as string];
    },
  });
});

import VideoCallOAuthApps from "../../../../../Server/Utils/VideoCall/OAuth/VideoCallOAuthApps";
import MicrosoftTeamsMeetingsOAuthApp, {
  MICROSOFT_ORGANIZATIONS_AUTHORITY,
} from "../../../../../Server/Utils/VideoCall/OAuth/MicrosoftTeamsMeetingsOAuthApp";
import VideoCallProvider from "../../../../../Types/VideoCall/VideoCallProvider";

const TENANT_ID: string = "4a1f9e60-1b2c-4d3e-8f40-a1b2c3d4e5f6";

describe("VideoCallOAuthApps - the Teams meetings app's tenant", () => {
  test("a multitenant app: no tenant, a sign-in at organizations", () => {
    environment["MicrosoftTeamsMeetingsAppTenantId"] = null;

    expect(
      VideoCallOAuthApps.getCredentials(VideoCallProvider.MicrosoftTeams),
    ).toEqual({
      clientId: "6c1a8d3e-1111-4222-8333-944455556666",
      clientSecret: "ms-secret",
    });
    expect(
      (
        VideoCallOAuthApps.get(
          VideoCallProvider.MicrosoftTeams,
        ) as MicrosoftTeamsMeetingsOAuthApp
      ).getSignInAuthority(),
    ).toBe(MICROSOFT_ORGANIZATIONS_AUTHORITY);
  });

  test("a single-tenant app: its tenant, trimmed, and every sign-in there", () => {
    environment["MicrosoftTeamsMeetingsAppTenantId"] = `  ${TENANT_ID}  `;

    expect(
      VideoCallOAuthApps.getCredentials(VideoCallProvider.MicrosoftTeams),
    ).toEqual({
      clientId: "6c1a8d3e-1111-4222-8333-944455556666",
      clientSecret: "ms-secret",
      tenantId: TENANT_ID,
    });

    const app: MicrosoftTeamsMeetingsOAuthApp = VideoCallOAuthApps.get(
      VideoCallProvider.MicrosoftTeams,
    ) as MicrosoftTeamsMeetingsOAuthApp;

    expect(app.getSignInAuthority()).toBe(
      `https://login.microsoftonline.com/${TENANT_ID}`,
    );
  });

  test("a tenant alone is no app: without the id and the secret, nothing to sign in with", () => {
    environment["MicrosoftTeamsMeetingsAppTenantId"] = TENANT_ID;
    environment["MicrosoftTeamsMeetingsAppClientSecret"] = null;

    try {
      expect(
        VideoCallOAuthApps.getCredentials(VideoCallProvider.MicrosoftTeams),
      ).toBeNull();
      expect(
        VideoCallOAuthApps.isConfigured(VideoCallProvider.MicrosoftTeams),
      ).toBe(false);
    } finally {
      environment["MicrosoftTeamsMeetingsAppClientSecret"] = "ms-secret";
    }
  });

  test("no other provider is handed a tenant", () => {
    environment["MicrosoftTeamsMeetingsAppTenantId"] = TENANT_ID;

    expect(VideoCallOAuthApps.getCredentials(VideoCallProvider.Zoom)).toEqual({
      clientId: "zoom-client-id",
      clientSecret: "zoom-client-secret",
    });
    expect(
      VideoCallOAuthApps.getCredentials(VideoCallProvider.GoogleMeet),
    ).toEqual({
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
    });
  });
});
