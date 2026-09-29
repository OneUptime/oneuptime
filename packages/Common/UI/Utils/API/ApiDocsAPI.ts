import { API_DOCS_HOSTNAME, HTTP_PROTOCOL } from "../../Config";
import { ApiReferenceRoute } from "../../../ServiceRoute";
import Route from "../../../Types/API/Route";
import API from "../API/API";

class ApiDocsRoute extends API {
  public constructor() {
    super(
      HTTP_PROTOCOL,
      API_DOCS_HOSTNAME,
      new Route(ApiReferenceRoute.toString()),
    );
  }
}

export default new ApiDocsRoute();
