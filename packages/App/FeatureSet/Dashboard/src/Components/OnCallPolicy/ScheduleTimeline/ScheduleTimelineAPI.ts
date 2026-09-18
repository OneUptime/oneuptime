import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ScheduleTimelineUtil, {
  SCHEDULE_TIMELINE_ROUTE,
  ScheduleTimelineResponse,
} from "Common/Types/OnCallDutyPolicy/ScheduleTimeline";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The one call behind the schedule timeline.
 *
 * The server answers 503 + Retry-After when every render slot it is willing
 * to give a dashboard is busy (see OnCallScheduleTimelineAPI). That is a
 * "come back in a moment", not a failure, so it is retried here a couple of
 * times before the page is told; anything else throws straight away so the
 * page can show the server's own message.
 */

export const TIMELINE_MAX_ATTEMPTS: number = 3;
export const TIMELINE_DEFAULT_RETRY_MS: number = 2000;
const TIMELINE_MAX_RETRY_MS: number = 10000;

export type SleepFunction = (milliseconds: number) => Promise<void>;

const defaultSleep: SleepFunction = (milliseconds: number): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, milliseconds);
  });
};

export function getRetryDelayMilliseconds(response: HTTPErrorResponse): number {
  const headers: Record<string, string | undefined> =
    (response.headers as Record<string, string | undefined>) || {};

  const raw: string | undefined =
    headers["retry-after"] || headers["Retry-After"];

  const seconds: number = raw !== undefined ? Number(raw) : Number.NaN;

  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(TIMELINE_MAX_RETRY_MS, seconds * 1000);
  }

  return TIMELINE_DEFAULT_RETRY_MS;
}

export default class ScheduleTimelineAPI {
  public static buildUrl(data: {
    from: Date;
    to: Date;
    teamId?: ObjectID | undefined;
  }): URL {
    let url: URL = URL.fromString(APP_API_URL.toString())
      .addRoute(SCHEDULE_TIMELINE_ROUTE)
      .addQueryParam("from", OneUptimeDate.toString(data.from), true)
      .addQueryParam("to", OneUptimeDate.toString(data.to), true);

    if (data.teamId) {
      url = url.addQueryParam("teamId", data.teamId.toString(), true);
    }

    return url;
  }

  public static async getTimeline(data: {
    from: Date;
    to: Date;
    teamId?: ObjectID | undefined;
    sleep?: SleepFunction | undefined;
    /*
     * True once the caller no longer wants the answer (the reader moved to
     * another range, or left). Checked before every retry, so a request for a
     * week nobody is looking at stops adding load to a server that has just
     * said it is busy.
     */
    isCancelled?: (() => boolean) | undefined;
  }): Promise<ScheduleTimelineResponse> {
    const sleep: SleepFunction = data.sleep || defaultSleep;

    for (let attempt: number = 1; ; attempt++) {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: ScheduleTimelineAPI.buildUrl(data),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (!(response instanceof HTTPErrorResponse)) {
        return ScheduleTimelineUtil.parseResponse(response.data);
      }

      if (response.statusCode === 503 && attempt < TIMELINE_MAX_ATTEMPTS) {
        await sleep(getRetryDelayMilliseconds(response));

        if (data.isCancelled && data.isCancelled()) {
          throw response;
        }

        continue;
      }

      throw response;
    }
  }
}
