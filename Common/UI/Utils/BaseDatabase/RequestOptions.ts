import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";

export default interface RequestOptions {
  requestHeaders?: Dictionary<string> | undefined;
  overrideRequestUrl?: URL | undefined;
}
