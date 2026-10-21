import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import SubscriberNotificationPreview, {
  SubscriberNotificationPreviewRequest,
  SubscriberNotificationPreviewResult,
  SubscriberNotificationSendTestResult,
} from "Common/Types/StatusPage/SubscriberNotificationPreview";
import { NOTIFICATION_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The two calls behind "Preview notification" (see
 * Common/Types/StatusPage/SubscriberNotificationPreview). They are custom
 * routes of the notification API, reached like /smtp-config/test: at
 * NOTIFICATION_URL, with a raw API.post - and so with the tenant header added
 * here, because only ModelAPI adds it on its own and the server refuses a
 * request that names no project.
 *
 * The routes are written out rather than read from
 * SubscriberNotificationPreview so the tenant-header sweep
 * (App/Tests/Dashboard/DashboardRequestsNameTheirProject.test.ts) sees them;
 * a test pins the two together.
 */

export const fetchSubscriberNotificationPreview: (
  request: SubscriberNotificationPreviewRequest,
) => Promise<SubscriberNotificationPreviewResult> = async (
  request: SubscriberNotificationPreviewRequest,
): Promise<SubscriberNotificationPreviewResult> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(NOTIFICATION_URL.toString()).addRoute(
        "/subscriber-notification-preview/preview",
      ),
      data: SubscriberNotificationPreview.requestToJSON(request),
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return SubscriberNotificationPreview.fromJSON(response.data || {});
};

/*
 * Sends one status page's email to the signed-in user's own account email.
 * The request carries no address: the server only ever sends it to the
 * caller.
 */
export const sendSubscriberNotificationTest: (
  request: SubscriberNotificationPreviewRequest,
  statusPageId: string,
) => Promise<SubscriberNotificationSendTestResult> = async (
  request: SubscriberNotificationPreviewRequest,
  statusPageId: string,
): Promise<SubscriberNotificationSendTestResult> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(NOTIFICATION_URL.toString()).addRoute(
        "/subscriber-notification-preview/send-test",
      ),
      data: SubscriberNotificationPreview.requestToJSON({
        ...request,
        statusPageId: statusPageId,
      }),
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return {
    sentTo: String((response.data || {})["sentTo"] || ""),
  };
};
