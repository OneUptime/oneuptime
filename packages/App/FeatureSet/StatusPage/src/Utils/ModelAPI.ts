import API from "./API";
import Dictionary from "Common/Types/Dictionary";
import BaseAPI from "Common/UI/Utils/API/API";
import ModelAPI, { RequestOptions } from "Common/UI/Utils/ModelAPI/ModelAPI";

/**
 * ModelAPI adapter for the public Status Page application.
 *
 * Shared forms and resource pickers normally use the dashboard API client.
 * That client's 401/405 handler performs a global account logout. Status Page
 * requests must instead use the page-scoped client so an unrelated dashboard
 * session can never be cleared by a public subscription request.
 */
export default class StatusPageModelAPI extends ModelAPI {
  protected static override getApiClient(): typeof BaseAPI {
    return API;
  }

  public static override getCommonHeaders(
    requestOptions?: RequestOptions,
  ): Dictionary<string> {
    return {
      ...API.getDefaultHeaders(),
      ...(requestOptions?.requestHeaders || {}),
    };
  }
}
