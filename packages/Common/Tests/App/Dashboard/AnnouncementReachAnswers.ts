import { jest } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import AnnouncementReach, {
  AnnouncementNothingSentReason,
  AnnouncementReachResult,
} from "../../../Types/StatusPage/AnnouncementReach";
import API from "../../../UI/Utils/API/API";
import { forgetAnnouncementReachAnswers } from "../../../../App/FeatureSet/Dashboard/src/Components/Announcement/useAnnouncementReach";

/*
 * The announcement forms ask the server whether an announcement on the
 * status pages picked shows on one of them and notifies anyone (#9775):
 * POST /status-page-announcement/reach, through useAnnouncementReach. A
 * test that draws Create Announcement or the announcement's Edit stands in
 * for that answer here, and nothing leaves for the network
 * (Tests/Helpers/RealNetworkRequests).
 *
 * The hook keeps an answer for a short while, for every place the form
 * asks from; this forgets what an earlier test was answered. Every other
 * POST goes on to whatever stood in for API.post before. Call it in a
 * beforeEach: jest.restoreAllMocks() takes it away again.
 */

export interface AnnouncementReachAsk {
  // The route, from its API path: "/status-page-announcement/reach".
  route: string;
  statusPageIds: Array<string>;
  announcementId: string | null;
  headers: Record<string, string>;
}

// What the server answers: a reason, a refusal, or no answer yet.
export type AnnouncementReachAnswer =
  | AnnouncementReachResult
  | HTTPErrorResponse
  | "never";

// A page picked shows announcements and tells its subscribers.
export const ANNOUNCEMENT_NOTIFIES: AnnouncementReachResult = {
  nothingSentReason: null,
};

export function announcementNothingSent(
  reason: AnnouncementNothingSentReason,
): AnnouncementReachResult {
  return { nothingSentReason: reason };
}

interface PostOptions {
  url: { toString: () => string };
  data?: JSONObject | undefined;
  headers?: Record<string, string> | undefined;
}

export const ANNOUNCEMENT_REACH_ROUTE: string = `/status-page-announcement${AnnouncementReach.routePath}`;

export function answerAnnouncementReach(
  answer:
    | AnnouncementReachAnswer
    | ((
        ask: AnnouncementReachAsk,
      ) => AnnouncementReachAnswer) = ANNOUNCEMENT_NOTIFIES,
): Array<AnnouncementReachAsk> {
  forgetAnnouncementReachAnswers();

  const asks: Array<AnnouncementReachAsk> = [];
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

    if (route !== ANNOUNCEMENT_REACH_ROUTE) {
      return before(options);
    }

    const ask: AnnouncementReachAsk = {
      route: route,
      statusPageIds: (
        (options.data?.["statusPageIds"] as Array<unknown>) || []
      ).map((id: unknown): string => {
        return String(id);
      }),
      announcementId:
        options.data?.["announcementId"] === undefined
          ? null
          : String(options.data["announcementId"]),
      headers: { ...(options.headers || {}) },
    };

    asks.push(ask);

    const answered: AnnouncementReachAnswer =
      typeof answer === "function" ? answer(ask) : answer;

    if (answered === "never") {
      return new Promise<never>(() => {});
    }

    if (answered instanceof HTTPErrorResponse) {
      return Promise.resolve(answered);
    }

    return Promise.resolve(
      new HTTPResponse<JSONObject>(200, AnnouncementReach.toJSON(answered), {}),
    );
  }) as never);

  return asks;
}
