import {
  FeedStatus,
  MyShiftsResponse,
  parseFeedStatus,
  parseMyShifts,
} from "./CalendarFeedTypes";
import { MY_SHIFTS_PATH } from "./CalendarFeedUtil";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The custom (non-CRUD) routes of the on-call calendar API, spec §2.2. The
 * five feed models' settings go through ModelAPI like any other model; only
 * the token lifecycle and the shift list live here.
 *
 * Every method throws on failure so callers can route the server's own
 * message into their error state through API.getFriendlyMessage. The one
 * exception is a 404 on a status read, which is returned as null: it is what
 * an older API answers during a rolling upgrade, and the surfaces hide
 * themselves for it rather than show an error.
 */
export default class CalendarFeedAPI {
  public static async getFeedStatus(path: string): Promise<FeedStatus | null> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(path),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      if (response.statusCode === 404) {
        return null;
      }

      throw response;
    }

    return parseFeedStatus(response.data);
  }

  /*
   * publish / rotate. The body is an empty JSON object on purpose: the routes
   * refuse anything that is not application/json (415), and the default
   * headers only carry that content type when there is a body to send.
   */
  public static async postFeedAction(path: string): Promise<FeedStatus> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(path),
        data: {},
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return parseFeedStatus(response.data);
  }

  public static async getMyShifts(data: {
    from: Date;
    to: Date;
  }): Promise<MyShiftsResponse> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromString(APP_API_URL.toString())
          .addRoute(MY_SHIFTS_PATH)
          .addQueryParam("from", OneUptimeDate.toString(data.from), true)
          .addQueryParam("to", OneUptimeDate.toString(data.to), true),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return parseMyShifts(response.data);
  }
}
