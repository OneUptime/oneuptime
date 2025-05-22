import { API_DOCS_HOSTNAME, HTTP_PROTOCOL } from "../../Config";
import { ApiReferenceRoute } from "../../../ServiceRoute";
import API from "../API/API";

class ApiDocsRoute extends API {
  public constructor() {
    super(HTTP_PROTOCOL, API_DOCS_HOSTNAME, ApiReferenceRoute);
  }
}

export default new ApiDocsRoute();
