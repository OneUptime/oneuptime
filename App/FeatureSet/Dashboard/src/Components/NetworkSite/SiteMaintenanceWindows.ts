import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { SiteMaintenanceWindow } from "Common/Utils/NetworkSite/SiteUptimeUtil";
import API from "Common/UI/Utils/API/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The scheduled maintenance windows that cover one network site, for the
 * pages that show its uptime.
 *
 * Fetched from /network-site/maintenance-windows rather than by querying
 * ScheduledMaintenance from the browser, and that is the whole point of this
 * module. A direct model read made uptime depend on the VIEWER: a user
 * without ScheduledMaintenance read — or with a label-scoped grant, which
 * narrows the query silently instead of erroring — got the un-discounted
 * number here while the hierarchy card beside it, computed on the server,
 * showed the discounted one. Two numbers for the same site, differing by who
 * was looking.
 *
 * The server resolves coverage with SiteMaintenanceUtil (a window on a
 * Region covers its Units) and returns only the intervals, so there is one
 * definition of "covered" and one permission gate: can you read the site.
 */
export interface FetchSiteMaintenanceWindowsInput {
  siteId: ObjectID;
  windowStart: Date;
  windowEnd: Date;
}

export type FetchSiteMaintenanceWindowsFunction = (
  input: FetchSiteMaintenanceWindowsInput,
) => Promise<Array<SiteMaintenanceWindow>>;

export const fetchSiteMaintenanceWindows: FetchSiteMaintenanceWindowsFunction =
  async (
    input: FetchSiteMaintenanceWindowsInput,
  ): Promise<Array<SiteMaintenanceWindow>> => {
    const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
      "/network-site/maintenance-windows",
    );

    /*
     * The server measures back from "now", so it needs the span in days
     * rather than the two timestamps. Rounded UP so a caller asking for a
     * partial day still gets every window that can touch it.
     */
    const windowInDays: number = Math.max(
      1,
      Math.ceil(
        (input.windowEnd.getTime() - input.windowStart.getTime()) /
          (24 * 60 * 60 * 1000),
      ),
    );

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: url,
        data: {
          siteId: input.siteId.toString(),
          windowInDays: windowInDays,
        },
        // Project scoping rides on the tenantid header.
        headers: { ...ModelAPI.getCommonHeaders() },
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    const rows: JSONArray = (response.data?.["windows"] as JSONArray) || [];
    const windows: Array<SiteMaintenanceWindow> = [];

    for (const row of rows) {
      const startsAt: unknown = (row as JSONObject)["startsAt"];
      const endsAt: unknown = (row as JSONObject)["endsAt"];

      if (typeof startsAt !== "string" && !(startsAt instanceof Date)) {
        continue;
      }

      windows.push({
        startsAt: OneUptimeDate.fromString(startsAt as string | Date),
        endsAt:
          typeof endsAt === "string" || endsAt instanceof Date
            ? OneUptimeDate.fromString(endsAt as string | Date)
            : null,
      });
    }

    return windows;
  };

export default fetchSiteMaintenanceWindows;
