import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  APP_SERVICE_SITE_ACTIVITY_API_PATH,
  AppServiceSiteActivity,
  readAppServiceSiteActivity,
} from "Common/Types/Cloud/AppServiceSiteActivity";
import { STORED_CLOUD_RESOURCE_ID_ATTRIBUTE } from "Common/Types/Cloud/CloudLogGroups";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Log from "Common/Models/AnalyticsModels/Log";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * The two reads an App Service app's page makes of its site besides the
 * site's own row (CloudAppAzureLink), #10294:
 *
 *   - what Azure says of its instances and deployments now, asked of
 *     Resource Manager through the site's cloud connection
 *     (CloudConnectionAPI's app-service-site route, AppServiceSiteActivity);
 *   - when the latest log its diagnostic settings streamed arrived: the
 *     stream files a site's logs under its ARM id as cloud.resource_id
 *     (AzureDiagnosticRecords), the attribute its Logs tab filters on.
 */

// How far back the latest streamed log is looked for.
export const DIAGNOSTIC_LOGS_LOOK_BACK_MS: number = 24 * 60 * 60 * 1000;

export async function fetchAppServiceSiteActivity(
  cloudResourceId: ObjectID,
): Promise<AppServiceSiteActivity> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(
        `${APP_SERVICE_SITE_ACTIVITY_API_PATH}/${cloudResourceId.toString()}/activity`,
      ),
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const activity: AppServiceSiteActivity | null = readAppServiceSiteActivity(
    response.data,
  );

  if (!activity) {
    throw new Error(
      "The server did not answer with the App Service app's instances and deployments. Try again.",
    );
  }

  return activity;
}

// The logs of a site, by its ARM id - the query its Logs tab makes.
export function getSiteDiagnosticLogAttributes(
  providerResourceId: string,
): Record<string, string> {
  return { [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]: providerResourceId };
}

/*
 * When the latest log of the site that Azure's diagnostic settings streamed
 * arrived, in the last day; null when none did.
 */
export async function fetchSiteDiagnosticLogsLastReceivedAt(data: {
  providerResourceId: string;
  now: Date;
}): Promise<Date | null> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId || !data.providerResourceId) {
    return null;
  }

  /*
   * `any`-typed, as the pages' own reads: the attributes filter with the
   * generic select is a TS2589 deep instantiation otherwise.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const request: any = {
    modelType: Log,
    query: {
      projectId: projectId.toString(),
      time: new InBetween<Date>(
        new Date(data.now.getTime() - DIAGNOSTIC_LOGS_LOOK_BACK_MS),
        data.now,
      ),
      attributes: getSiteDiagnosticLogAttributes(data.providerResourceId),
    },
    limit: 1,
    skip: 0,
    select: { time: true },
    sort: { time: SortOrder.Descending },
    requestOptions: {},
  };

  const result: ListResult<Log> = await AnalyticsModelAPI.getList<Log>(request);
  const latest: unknown = result.data[0]?.time;

  if (!latest) {
    return null;
  }

  const time: Date = latest instanceof Date ? latest : new Date(String(latest));

  return Number.isNaN(time.getTime()) ? null : time;
}
