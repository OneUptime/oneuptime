import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { CloudCostReportContent } from "Common/Types/Cloud/CloudCostReport";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * WHAT CLOUD > SPEND > REPORTS ASKS THE SERVER (#11009).
 *
 *   POST /cloud-cost-report/:id/preview    what the report says now, as the
 *                                          person may read it
 *   POST /cloud-cost-report/:id/send-copy  a copy now, to their own address
 *   POST /cloud-cost/export                every cost of a period, as FOCUS
 *
 * Each is read as the person signed in.
 */

async function post(route: string, data: JSONObject): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(route),
      data,
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response.data as JSONObject;
}

export async function fetchCloudCostReportPreview(
  reportId: ObjectID,
): Promise<CloudCostReportContent> {
  return (await post(
    `/cloud-cost-report/${reportId.toString()}/preview`,
    {},
  )) as unknown as CloudCostReportContent;
}

// Sends the person a copy; the address it went to.
export async function sendCloudCostReportCopy(
  reportId: ObjectID,
): Promise<string> {
  const answer: JSONObject = await post(
    `/cloud-cost-report/${reportId.toString()}/send-copy`,
    {},
  );

  return String(answer["sentTo"] || "");
}

/*
 * Every cost of a period as a FOCUS 1.2 file, read as the person may read
 * them: the file's text, for the browser to save.
 */
export async function fetchCloudCostFocusExport(data: {
  startDate: Date;
  endDate: Date;
  cloudAccountIds?: Array<ObjectID> | undefined;
}): Promise<string> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        "/cloud-cost/export",
      ),
      data: {
        startDate: data.startDate.toISOString(),
        endDate: data.endDate.toISOString(),
        ...(data.cloudAccountIds && data.cloudAccountIds.length > 0
          ? {
              cloudAccountIds: data.cloudAccountIds.map(
                (id: ObjectID): string => {
                  return id.toString();
                },
              ),
            }
          : {}),
      },
      headers: { ...ModelAPI.getCommonHeaders(), Accept: "text/csv" },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  /*
   * A text answer is held as { data: <the file> } (HTTPResponse.isText):
   * the file itself, never "[object Object]".
   */
  const body: unknown = response.isText
    ? (response.data as JSONObject)["data"]
    : response.data;

  return typeof body === "string" ? body : String(body ?? "");
}
