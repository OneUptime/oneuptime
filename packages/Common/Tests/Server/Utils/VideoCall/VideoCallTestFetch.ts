import {
  VideoCallFetch,
  VideoCallFetchInit,
  VideoCallFetchResponse,
} from "../../../../Server/Utils/VideoCall/VideoCallHttpClient";
import { JSONObject } from "../../../../Types/JSON";

/*
 * A fetch that answers from a script, in order, and records every request
 * it was asked for, so a test can assert on the exact URL, headers and body
 * a provider client builds. Running past the script fails the test rather
 * than hanging it.
 */

export interface RecordedRequest {
  url: string;
  init: VideoCallFetchInit;
}

export interface ScriptedResponse {
  status: number;
  body: string | JSONObject;
}

export interface ScriptedFetch {
  fetch: VideoCallFetch;
  requests: Array<RecordedRequest>;
}

export function scriptedFetch(
  responses: Array<ScriptedResponse>,
): ScriptedFetch {
  const requests: Array<RecordedRequest> = [];
  const queue: Array<ScriptedResponse> = [...responses];

  const fetchImplementation: VideoCallFetch = async (
    url: string,
    init: VideoCallFetchInit,
  ): Promise<VideoCallFetchResponse> => {
    requests.push({ url, init });

    const next: ScriptedResponse | undefined = queue.shift();

    if (!next) {
      throw new Error(`Unexpected request to ${url}: the script has ended.`);
    }

    const bodyText: string =
      typeof next.body === "string" ? next.body : JSON.stringify(next.body);

    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async (): Promise<string> => {
        return bodyText;
      },
    };
  };

  return { fetch: fetchImplementation, requests };
}

export function readFormBody(request: RecordedRequest): URLSearchParams {
  return new URLSearchParams(request.init.body || "");
}

export function readJsonBody(request: RecordedRequest): JSONObject {
  return JSON.parse(request.init.body || "{}") as JSONObject;
}
