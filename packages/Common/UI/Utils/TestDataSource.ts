import URL from "../../Types/API/URL";
import Dictionary from "../../Types/Dictionary";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import { JSONObject } from "../../Types/JSON";
import { APP_API_URL } from "../Config";
import API from "./API/API";

export interface DataSourceTestResult {
  success: boolean;
  message: string;
}

export default class TestDataSource {
  /*
   * Tests a data source's connectivity and credentials (by id) via the
   * /data-source/test endpoint and returns a friendly success/failure
   * result. The endpoint replies 200 with { ok, message } for both
   * outcomes, so failures surface through `ok` rather than an HTTP error.
   * Callers pass the project tenant headers.
   */
  public static async test(data: {
    dataSourceId: string;
    headers?: Dictionary<string> | undefined;
  }): Promise<DataSourceTestResult> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/data-source/test",
          ),
          data: {
            dataSourceId: data.dataSourceId,
          },
          ...(data.headers ? { headers: data.headers } : {}),
        });

      if (response.isFailure()) {
        return {
          success: false,
          message: API.getFriendlyMessage(response),
        };
      }

      const responseData: JSONObject = response.data as JSONObject;
      const isOk: boolean = Boolean(responseData["ok"]);

      return {
        success: isOk,
        message:
          (responseData["message"] as string) ||
          (isOk ? "Connection successful." : "Connection failed."),
      };
    } catch (err) {
      return {
        success: false,
        message: API.getFriendlyMessage(err),
      };
    }
  }
}
