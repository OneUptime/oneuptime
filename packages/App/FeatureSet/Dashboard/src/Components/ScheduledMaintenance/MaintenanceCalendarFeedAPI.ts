import {
  FeedStatus,
  parseFeedStatus,
} from "../OnCallPolicy/CalendarFeed/CalendarFeedTypes";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The team's maintenance calendar link, as the Subscribe dialog reads it.
 *
 * The link's status has the on-call links' shape (CalendarFeedTypes, read
 * with the same defensive parser) and one more field: `refusedReason`, the
 * sentence the server answers a reader who does not read every event of the
 * project with (ScheduledMaintenanceCalendarAPI). It is a 200, not a 403:
 * the Dashboard answers any 403 by leaving for its Forbidden page.
 *
 * A 404 is an older API that has no such route (a rolling upgrade): the
 * dialog says the server does not offer the link yet. Anything else that
 * fails throws, for the dialog's error state. Publishing and regenerating
 * answer the plain status, as the on-call routes do (CalendarFeedAPI).
 */
export interface MaintenanceCalendarFeedRead {
  status: FeedStatus | null;
  refusedReason: string | null;
  isUnsupported: boolean;
}

export default class MaintenanceCalendarFeedAPI {
  public static async getStatus(
    path: string,
  ): Promise<MaintenanceCalendarFeedRead> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(path),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      if (response.statusCode === 404) {
        return { status: null, refusedReason: null, isUnsupported: true };
      }

      throw response;
    }

    return MaintenanceCalendarFeedAPI.parse(response.data);
  }

  public static parse(value: unknown): MaintenanceCalendarFeedRead {
    const json: JSONObject =
      value && typeof value === "object" ? (value as JSONObject) : {};

    const refusedReason: unknown = json["refusedReason"];

    if (typeof refusedReason === "string" && refusedReason.trim()) {
      return {
        status: null,
        refusedReason: refusedReason,
        isUnsupported: false,
      };
    }

    return {
      status: parseFeedStatus(json),
      refusedReason: null,
      isUnsupported: false,
    };
  }
}
