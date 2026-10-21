import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Read now on Calendar Settings, besides the calendars' CRUD: reads a
 * calendar at once (ScheduledMaintenanceExternalCalendarAPI) and answers when
 * the read is over, so the list shows how it went the moment it reloads.
 * Refused while the calendar is off or was read moments ago, with a sentence
 * saying so; an error answer is thrown for the caller to show.
 */

export const EXTERNAL_CALENDAR_API_PATH: string =
  "/scheduled-maintenance-external-calendar";

export function getReadNowPath(calendarId: ObjectID | string): string {
  return `${EXTERNAL_CALENDAR_API_PATH}/${calendarId.toString()}/read-now`;
}

export async function readExternalCalendarNow(
  calendarId: ObjectID | string,
): Promise<void> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(getReadNowPath(calendarId)),
      headers: ModelAPI.getCommonHeaders(),
      data: {},
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }
}
