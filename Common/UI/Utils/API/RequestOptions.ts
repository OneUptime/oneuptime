import URL from "../../../Types/API/URL";
import type { RequestOptions as CoreRequestOptions } from "../../../Utils/API";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";

export default interface RequestOptions {
  requestHeaders?: Dictionary<string> | undefined;
  overrideRequestUrl?: URL | undefined;
  apiRequestOptions?: CoreRequestOptions | undefined;
  /*
   * Extra top-level fields merged into a list request body before the
   * canonical query/select/sort/groupBy fields. This lets callers attach
   * endpoint-specific context without being able to replace the list query.
   */
  additionalRequestBody?: JSONObject | undefined;
}
