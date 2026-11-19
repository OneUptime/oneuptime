import { jest } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import PublicNoteReach, {
  PublicNoteNothingSentReason,
  PublicNoteReachResult,
} from "../../../Types/StatusPage/PublicNoteReach";
import API from "../../../UI/Utils/API/API";

/*
 * The note composer asks the server whether a public note posted now is on
 * a status page and notifies anyone (#9735): POST
 * /<event>/public-note-reach, through usePublicNoteReach. A test that draws
 * a public note's composer - a Notes page, a feed's Add Public Note - stands
 * in for that answer here, and nothing leaves for the network
 * (Tests/Helpers/RealNetworkRequests).
 *
 * Every other POST goes on to whatever stood in for API.post before, so a
 * suite that answers routes of its own keeps answering them. Call it in a
 * beforeEach: jest.restoreAllMocks() takes it away again.
 */

export interface PublicNoteReachAsk {
  // The route, from its API path: "/incident/public-note-reach".
  route: string;
  eventId: string;
  headers: Record<string, string>;
}

// What the server answers: a reason, a refusal, or no answer yet.
export type PublicNoteReachAnswer =
  | PublicNoteReachResult
  | HTTPErrorResponse
  | "never";

export const NOTE_NOTIFIES: PublicNoteReachResult = {
  nothingSentReason: null,
};

export function nothingSent(
  reason: PublicNoteNothingSentReason,
): PublicNoteReachResult {
  return { nothingSentReason: reason };
}

interface PostOptions {
  url: { toString: () => string };
  data?: JSONObject | undefined;
  headers?: Record<string, string> | undefined;
}

export function answerPublicNoteReach(
  answer:
    | PublicNoteReachAnswer
    | ((ask: PublicNoteReachAsk) => PublicNoteReachAnswer) = NOTE_NOTIFIES,
): Array<PublicNoteReachAsk> {
  const asks: Array<PublicNoteReachAsk> = [];
  /*
   * What answered a POST before: a suite's own stand-in - its
   * implementation, not the spy, which would be this one again - or the
   * real API, which the network rule refuses.
   */
  const current: unknown = API.post;
  const before: (options: PostOptions) => Promise<unknown> =
    jest.isMockFunction(current)
      ? ((current.getMockImplementation() ||
          ((): Promise<unknown> => {
            return Promise.resolve(undefined);
          })) as unknown as (options: PostOptions) => Promise<unknown>)
      : (API.post.bind(API) as unknown as (
          options: PostOptions,
        ) => Promise<unknown>);

  jest.spyOn(API, "post").mockImplementation(((
    options: PostOptions,
  ): Promise<unknown> => {
    const url: string = options.url.toString();
    const routeAt: number = url.indexOf("/api/");
    const route: string =
      routeAt >= 0 ? url.slice(routeAt + "/api".length) : url;

    if (!route.endsWith(PublicNoteReach.routePath)) {
      return before(options);
    }

    const ask: PublicNoteReachAsk = {
      route: route,
      eventId: String(options.data?.["eventId"] ?? ""),
      headers: { ...(options.headers || {}) },
    };

    asks.push(ask);

    const answered: PublicNoteReachAnswer =
      typeof answer === "function" ? answer(ask) : answer;

    if (answered === "never") {
      return new Promise<never>(() => {});
    }

    if (answered instanceof HTTPErrorResponse) {
      return Promise.resolve(answered);
    }

    return Promise.resolve(
      new HTTPResponse<JSONObject>(200, PublicNoteReach.toJSON(answered), {}),
    );
  }) as never);

  return asks;
}
