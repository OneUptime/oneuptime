import { HTTP_PROTOCOL, IDENTITY_HOSTNAME } from "../../Config";
import BaseAPI from "./API";
import { IdentityRoute } from "../../../ServiceRoute";
import Route from "../../../Types/API/Route";

class IdentityAPI extends BaseAPI {
  public constructor() {
    super(
      HTTP_PROTOCOL,
      IDENTITY_HOSTNAME,
      new Route(IdentityRoute.toString()),
    );
  }
}

export default new IdentityAPI();
