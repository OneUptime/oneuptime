import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import VideoCallProvider, {
  isVideoCallProvider,
} from "Common/Types/VideoCall/VideoCallProvider";
import {
  VideoCallOAuthDefinition,
  getVideoCallOAuthDefinition,
} from "Common/Types/VideoCall/VideoCallProviderCatalog";
import {
  APP_API_URL,
  DOCS_URL,
  GoogleMeetAppClientId,
  MicrosoftTeamsMeetingsAppClientId,
  ZoomAppClientId,
} from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";

export const VIDEO_CALL_CONNECTION_TEST_ROUTE: string =
  "/video-call-connection/test";

// The one-click Connect's start routes: /video-call-oauth/<slug>/authorize-url.
export const VIDEO_CALL_OAUTH_ROUTE_PREFIX: string = "/video-call-oauth";

// The docs section on connecting by signing in.
export const VIDEO_CALL_ONE_CLICK_DOCS_PATH: string =
  "/docs/workspace-connections/video-calls#connect-in-one-click";

/*
 * Whether this server connects `provider` by signing in: it has the
 * provider's own app set up, whose public client id env.js carries. On
 * OneUptime Cloud it has; a self-hosted server without one connects the
 * project's own app with the connection form instead.
 */
export function isVideoCallOAuthAvailable(
  provider: VideoCallProvider | string | undefined,
): boolean {
  if (!getVideoCallOAuthDefinition(provider)) {
    return false;
  }

  switch (provider) {
    case VideoCallProvider.Zoom:
      return Boolean(ZoomAppClientId);
    case VideoCallProvider.GoogleMeet:
      return Boolean(GoogleMeetAppClientId);
    case VideoCallProvider.MicrosoftTeams:
      return Boolean(MicrosoftTeamsMeetingsAppClientId);
    default:
      return false;
  }
}

/*
 * Sends the browser to the provider's sign-in. The server records a one-use
 * state for this person and project - and the connection to sign in again,
 * when there is one - and answers with the provider's sign-in URL. The
 * provider sends the browser back to the Video Calls page.
 */
export async function startVideoCallSignIn(data: {
  provider: VideoCallProvider;
  // Reconnect: the connection to sign in again.
  connectionId?: string | undefined;
}): Promise<void> {
  const definition: VideoCallOAuthDefinition | undefined =
    getVideoCallOAuthDefinition(data.provider);

  if (!definition) {
    throw new Error("This provider cannot be connected by signing in.");
  }

  let url: URL = URL.fromURL(APP_API_URL).addRoute(
    `${VIDEO_CALL_OAUTH_ROUTE_PREFIX}/${definition.slug}/authorize-url`,
  );

  if (data.connectionId) {
    url = url.addQueryParam("connectionId", data.connectionId);
  }

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url,
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const authorizationUrl: JSONValue | undefined =
    response.data?.["authorizationUrl"];

  if (typeof authorizationUrl !== "string" || !authorizationUrl) {
    throw new Error("OneUptime could not start the sign-in. Please try again.");
  }

  Navigation.navigate(URL.fromString(authorizationUrl));
}

// A catalog docs path ("/docs/workspace-connections/video-calls#zoom") on the docs site.
export function videoCallDocsUrl(docsPath: string): URL {
  const relativePath: string = docsPath.replace(/^\/docs/, "");
  return URL.fromString(`${DOCS_URL.toString()}${relativePath}`);
}

export interface VideoCallTestResult {
  provider: VideoCallProvider;
  joinUrl: string;
}

/*
 * Starts a test meeting with a connection's settings and returns its join
 * link. The body is { connectionId } for a saved connection - optionally
 * with the edit form's unsaved config and secrets - or { provider, config,
 * secrets } for settings that were never saved. Credentials travel in the
 * body over TLS, never in the URL. A non-2xx answer is thrown, so the caller
 * shows it as a friendly message.
 */
export async function runVideoCallConnectionTest(
  body: JSONObject,
): Promise<VideoCallTestResult> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(VIDEO_CALL_CONNECTION_TEST_ROUTE),
      headers: ModelAPI.getCommonHeaders(),
      data: body,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const provider: JSONValue | undefined = response.data?.["provider"];
  const joinUrl: JSONValue | undefined = response.data?.["joinUrl"];

  if (!isVideoCallProvider(provider) || typeof joinUrl !== "string") {
    throw new Error(
      "The server did not return a test meeting. Check the API logs and try again.",
    );
  }

  return { provider, joinUrl };
}
