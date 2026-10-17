import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  CallSummaryStatus,
  RootCauseSuggestionStatus,
  isCallSummaryStatus,
} from "Common/Types/VideoCall/CallSummary";
import {
  VideoCallTranscriptUnavailable,
  VideoCallTranscriptUnavailableReason,
} from "Common/Types/VideoCall/VideoCallTranscript";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The routes of an incident call's transcript (IncidentVideoCallAPI), as
 * the Video Call card and the AI Investigation card reach them. Every
 * request carries the project's tenant header (ModelAPI.getCommonHeaders):
 * the routes read the call with the caller's own permissions. A refusal is
 * thrown as the HTTPErrorResponse, for API.getFriendlyErrorMessage.
 *
 * React-free on purpose: App's tests read it.
 */

export const INCIDENT_VIDEO_CALL_ROUTE: string = "/incident-video-call";

// What adding a transcript, or reading it from the provider, answers with.
export interface CallTranscriptSaved {
  callSummaryStatus: CallSummaryStatus | null;
  // Why it was not read: AI is off for the project.
  callSummaryStatusMessage?: string | undefined;
}

export type CallTranscriptFromProvider =
  | ({ added: true } & CallTranscriptSaved)
  | ({ added: false } & VideoCallTranscriptUnavailable);

function routeFor(callId: ObjectID | string, path: string): URL {
  return URL.fromURL(APP_API_URL).addRoute(
    `${INCIDENT_VIDEO_CALL_ROUTE}/${callId.toString()}/${path}`,
  );
}

function readSaved(data: JSONObject | undefined): CallTranscriptSaved {
  const status: JSONValue | undefined = data?.["callSummaryStatus"];
  const message: JSONValue | undefined = data?.["callSummaryStatusMessage"];

  return {
    callSummaryStatus: isCallSummaryStatus(status) ? status : null,
    callSummaryStatusMessage: typeof message === "string" ? message : undefined,
  };
}

// Adds a transcript a person uploaded or pasted, replacing the call's.
export async function addCallTranscript(data: {
  callId: ObjectID | string;
  text: string;
  fileName?: string | undefined;
}): Promise<CallTranscriptSaved> {
  const body: JSONObject = { text: data.text };

  if (data.fileName) {
    body["fileName"] = data.fileName;
  }

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: routeFor(data.callId, "transcript"),
      headers: ModelAPI.getCommonHeaders(),
      data: body,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readSaved(response.data as JSONObject);
}

/*
 * Reads the call's transcript from Zoom or Google Meet. "Not there yet" is
 * an answer (added: false, with why), not an error.
 */
export async function getCallTranscriptFromProvider(data: {
  callId: ObjectID | string;
}): Promise<CallTranscriptFromProvider> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: routeFor(data.callId, "transcript/from-provider"),
      headers: ModelAPI.getCommonHeaders(),
      data: {},
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const json: JSONObject = (response.data as JSONObject) || {};

  if (json["added"] === true) {
    return { added: true, ...readSaved(json) };
  }

  const reason: JSONValue | undefined = json["reason"];
  const message: JSONValue | undefined = json["message"];

  return {
    added: false,
    reason: (Object.values(VideoCallTranscriptUnavailableReason) as Array<string>).includes(
      String(reason),
    )
      ? (reason as VideoCallTranscriptUnavailableReason)
      : VideoCallTranscriptUnavailableReason.NotSupported,
    message: typeof message === "string" ? message : "",
  };
}

export async function removeCallTranscript(data: {
  callId: ObjectID | string;
}): Promise<void> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.delete<JSONObject>({
      url: routeFor(data.callId, "transcript"),
      headers: ModelAPI.getCommonHeaders(),
      data: {},
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }
}

// Has OneUptime AI read the call's transcript again.
export async function readCallTranscriptAgain(data: {
  callId: ObjectID | string;
}): Promise<CallTranscriptSaved> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: routeFor(data.callId, "call-summary"),
      headers: ModelAPI.getCommonHeaders(),
      data: {},
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readSaved(response.data as JSONObject);
}

/*
 * What a person decided about the root cause OneUptime AI suggested from
 * the call: Accepted with the root cause they saved, Dismissed, or
 * Suggested again (undoing a dismissal).
 */
export async function reviewCallRootCauseSuggestion(data: {
  callId: ObjectID | string;
  decision: RootCauseSuggestionStatus;
  rootCause?: string | undefined;
}): Promise<void> {
  const body: JSONObject = { decision: data.decision };

  if (data.rootCause !== undefined) {
    body["rootCause"] = data.rootCause;
  }

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: routeFor(data.callId, "root-cause-suggestion"),
      headers: ModelAPI.getCommonHeaders(),
      data: body,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }
}
