import { APP_HOSTNAME, HTTP_PROTOCOL } from "../../Config";
import BaseAPI from "./API";
import { AppApiRoute } from "Common/ServiceRoute";

class BackendAPI extends BaseAPI {
  public constructor() {
    super(HTTP_PROTOCOL, APP_HOSTNAME, AppApiRoute);
  }
}

export default new BackendAPI();
