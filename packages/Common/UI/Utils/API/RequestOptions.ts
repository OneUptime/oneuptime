import URL from "../../../Types/API/URL";
import type { RequestOptions as CoreRequestOptions } from "../../../Utils/API";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import type BaseAPI from "./API";

export default interface RequestOptions {
  requestHeaders?: Dictionary<string> | undefined;
  overrideRequestUrl?: URL | undefined;
  /*
   * The client that sends THIS request instead of the model API's default
   * (the dashboard client, or a subclass's getApiClient()). Set by callers
   * that route a shared model request to another app's endpoint - a public
   * dashboard widget's /public-dashboard-api/resource-list read - so that
   * endpoint's 401/403 is handled by that app's client (its master-password
   * page), never by the dashboard's refresh-token + User.logout +
   * /accounts/login.
   */
  apiClient?: typeof BaseAPI | undefined;
  apiRequestOptions?: CoreRequestOptions | undefined;
  /*
   * Extra top-level fields merged into a list request body before the
   * canonical query/select/sort/groupBy fields. This lets callers attach
   * endpoint-specific context without being able to replace the list query.
   */
  additionalRequestBody?: JSONObject | undefined;
}
