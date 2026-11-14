import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  PRODUCT_FEEDBACK_ADMIN_LIST_ROUTE,
  PRODUCT_FEEDBACK_ADMIN_SUMMARY_ROUTE,
  ProductFeedbackAdminSummary,
  ProductFeedbackKind,
  ProductFeedbackListPage,
} from "Common/Types/ProductFeedback/ProductFeedback";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";

/*
 * The Feedback page's reads (issue #6832): what people told this server,
 * from ProductFeedbackAPI's master-admin routes.
 */

const getJson: (url: URL) => Promise<JSONObject> = async (
  url: URL,
): Promise<JSONObject> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({ url: url });

  if (response instanceof HTTPErrorResponse || response.isFailure()) {
    throw response;
  }

  return response.data;
};

export const fetchFeedbackSummary: () => Promise<ProductFeedbackAdminSummary> =
  async (): Promise<ProductFeedbackAdminSummary> => {
    return (await getJson(
      URL.fromString(APP_API_URL.toString()).addRoute(
        PRODUCT_FEEDBACK_ADMIN_SUMMARY_ROUTE,
      ),
    )) as unknown as ProductFeedbackAdminSummary;
  };

export const fetchFeedbackList: (data: {
  kind: ProductFeedbackKind | null;
  skip: number;
  limit: number;
}) => Promise<ProductFeedbackListPage> = async (data: {
  kind: ProductFeedbackKind | null;
  skip: number;
  limit: number;
}): Promise<ProductFeedbackListPage> => {
  return (await getJson(
    URL.fromString(APP_API_URL.toString())
      .addRoute(PRODUCT_FEEDBACK_ADMIN_LIST_ROUTE)
      .addQueryParams({
        ...(data.kind ? { kind: data.kind } : {}),
        skip: String(data.skip),
        limit: String(data.limit),
      }),
  )) as unknown as ProductFeedbackListPage;
};
