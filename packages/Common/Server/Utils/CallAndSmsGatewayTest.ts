import { AppApiHostname } from "../EnvironmentConfig";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import API from "../../Utils/API";

// How a test of the server's SMS and call gateway went.
export interface CallAndSmsGatewayTestResult {
  ok: boolean;
  // The HTTP status the gateway answered with, when it answered.
  statusCode?: number | undefined;
  message: string;
}

// Where the Notification service takes a test of the gateway, inside the cluster.
export const CALL_AND_SMS_GATEWAY_TEST_ROUTE: string =
  "/api/notification/call-and-sms-gateway/test";

/*
 * SEND TEST, FOR THE SERVER'S SMS AND CALL GATEWAY.
 *
 * A master admin tries the gateway as saved (Admin Dashboard > Settings >
 * Call and SMS, GlobalConfigAPI): the Notification service, which sends
 * every SMS and call, posts one request to it, to nobody
 * (CallAndSmsGatewayPayload), and answers how it went - delivered or not -
 * in words fit for the admin.
 */
export default class CallAndSmsGatewayTest {
  public static async send(): Promise<CallAndSmsGatewayTestResult> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: new URL(
          Protocol.HTTP,
          AppApiHostname,
          new Route(CALL_AND_SMS_GATEWAY_TEST_ROUTE),
        ),
        data: {},
        headers: {
          ...ClusterKeyAuthorization.getClusterKeyHeaders(),
        },
        options: {
          sameServerRedirectsOnly: true,
        },
      });

    if (response instanceof HTTPErrorResponse) {
      return {
        ok: false,
        message:
          response.message ||
          "Could not reach the Notification service to send this.",
      };
    }

    const result: JSONObject = (response.data || {}) as JSONObject;

    return {
      ok: Boolean(result["ok"]),
      statusCode:
        typeof result["statusCode"] === "number"
          ? (result["statusCode"] as number)
          : undefined,
      message:
        typeof result["message"] === "string"
          ? (result["message"] as string)
          : "",
    };
  }
}
