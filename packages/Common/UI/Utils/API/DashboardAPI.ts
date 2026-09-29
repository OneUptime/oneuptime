import { APP_HOSTNAME, HTTP_PROTOCOL } from "../../Config";
import BaseAPI from "./API";
import { AppApiRoute } from "../../../ServiceRoute";
import Route from "../../../Types/API/Route";

class BackendAPI extends BaseAPI {
  public constructor() {
    super(HTTP_PROTOCOL, APP_HOSTNAME, new Route(AppApiRoute.toString()));
  }
}

export default new BackendAPI();
