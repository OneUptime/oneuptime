import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import VideoCallProvider, {
  isVideoCallProvider,
} from "Common/Types/VideoCall/VideoCallProvider";
import { APP_API_URL, DOCS_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

export const VIDEO_CALL_CONNECTION_TEST_ROUTE: string =
  "/video-call-connection/test";

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
