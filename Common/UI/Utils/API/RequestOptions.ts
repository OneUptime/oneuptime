import URL from "../../../Types/API/URL";
import type { RequestOptions as CoreRequestOptions } from "../../../Utils/API";
import Dictionary from "../../../Types/Dictionary";

export default interface RequestOptions {
  requestHeaders?: Dictionary<string> | undefined;
  overrideRequestUrl?: URL | undefined;
  apiRequestOptions?: CoreRequestOptions | undefined;
}
