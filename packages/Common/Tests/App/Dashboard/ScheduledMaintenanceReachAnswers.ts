import { jest } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import PickedStatusPagesReach, {
  PickedStatusPagesReachResult,
} from "../../../Types/StatusPage/PickedStatusPagesReach";
import { StatusPagesNothingSentReason } from "../../../Types/StatusPage/PublicNoteReach";
import API from "../../../UI/Utils/API/API";
import { forgetScheduledMaintenanceReachAnswers } from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/useScheduledMaintenanceReach";

/*
 * Schedule Maintenance Event and a maintenance template's forms ask the
 * server what the status pages picked on them do (#9920): POST
 * /scheduled-maintenance/reach and /scheduled-maintenance-template/reach,
 * through useScheduledMaintenanceReach. A test that draws those forms
 * stands in for that answer here, and nothing leaves for the network
 * (Tests/Helpers/RealNetworkRequests).
 *
 * The hook keeps an answer for a short while, for every place the form
 * asks from; this forgets what an earlier test was answered. Every other
 * POST goes on to whatever stood in for API.post before. Call it in a
 * beforeEach: jest.restoreAllMocks() takes it away again.
 */

export interface ScheduledMaintenanceReachAsk {
  // The route, from its API path: "/scheduled-maintenance/reach".
  route: string;
  statusPageIds: Array<string>;
  // The event or template an Edit edits, under its own key.
  recordId: string | null;
  headers: Record<string, string>;
}

// What the server answers: a reason, a refusal, or no answer yet.
export type ScheduledMaintenanceReachAnswer =
  | PickedStatusPagesReachResult
  | HTTPErrorResponse
  | "never";

// A page picked shows maintenance events and tells its subscribers.
export const MAINTENANCE_NOTIFIES: PickedStatusPagesReachResult = {
  nothingSentReason: null,
};

export function maintenanceNothingSent(
  reason: StatusPagesNothingSentReason,
): PickedStatusPagesReachResult {
  return { nothingSentReason: reason };
}

interface PostOptions {
  url: { toString: () => string };
  data?: JSONObject | undefined;
  headers?: Record<string, string> | undefined;
}

export const SCHEDULED_MAINTENANCE_REACH_ROUTE: string = `/scheduled-maintenance${PickedStatusPagesReach.routePath}`;

export const SCHEDULED_MAINTENANCE_TEMPLATE_REACH_ROUTE: string = `/scheduled-maintenance-template${PickedStatusPagesReach.routePath}`;

export function answerScheduledMaintenanceReach(
  answer:
    | ScheduledMaintenanceReachAnswer
    | ((
        ask: ScheduledMaintenanceReachAsk,
      ) => ScheduledMaintenanceReachAnswer) = MAINTENANCE_NOTIFIES,
): Array<ScheduledMaintenanceReachAsk> {
  forgetScheduledMaintenanceReachAnswers();

  const asks: Array<ScheduledMaintenanceReachAsk> = [];
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

    if (
      route !== SCHEDULED_MAINTENANCE_REACH_ROUTE &&
      route !== SCHEDULED_MAINTENANCE_TEMPLATE_REACH_ROUTE
    ) {
      return before(options);
    }

    const recordKey: string =
      route === SCHEDULED_MAINTENANCE_REACH_ROUTE
        ? "scheduledMaintenanceId"
        : "scheduledMaintenanceTemplateId";

    const ask: ScheduledMaintenanceReachAsk = {
      route: route,
      statusPageIds: (
        (options.data?.["statusPageIds"] as Array<unknown>) || []
      ).map((id: unknown): string => {
        return String(id);
      }),
      recordId:
        options.data?.[recordKey] === undefined
          ? null
          : String(options.data[recordKey]),
      headers: { ...(options.headers || {}) },
    };

    asks.push(ask);

    const answered: ScheduledMaintenanceReachAnswer =
      typeof answer === "function" ? answer(ask) : answer;

    if (answered === "never") {
      return new Promise<never>(() => {});
    }

    if (answered instanceof HTTPErrorResponse) {
      return Promise.resolve(answered);
    }

    return Promise.resolve(
      new HTTPResponse<JSONObject>(
        200,
        PickedStatusPagesReach.toJSON(answered),
        {},
      ),
    );
  }) as never);

  return asks;
}
