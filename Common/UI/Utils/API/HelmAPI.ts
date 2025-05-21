import { HELM_HOSTNAME, HTTP_PROTOCOL } from "../../Config";
import API from "../../Utils/API";

class HelmAPI extends API {
  public constructor() {
    super(HTTP_PROTOCOL, HELM_HOSTNAME);
  }
}

export default new HelmAPI();
