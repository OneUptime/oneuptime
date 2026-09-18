import { HELM_HOSTNAME, HTTP_PROTOCOL } from "../../Config";
import API from "../API/API";

class HelmAPI extends API {
  public constructor() {
    super(HTTP_PROTOCOL, HELM_HOSTNAME);
  }
}

export default new HelmAPI();
