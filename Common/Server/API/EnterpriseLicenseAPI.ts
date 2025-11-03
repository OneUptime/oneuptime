import EnterpriseLicense from "../../Models/DatabaseModels/EnterpriseLicense";
import { JSONObject } from "../../Types/JSON";
import EnterpriseLicenseService, {
  Service as EnterpriseLicenseServiceType,
} from "../Services/EnterpriseLicenseService";
import Response from "../Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import BaseAPI from "./BaseAPI";

export default class EnterpriseLicenseAPI extends BaseAPI<
  EnterpriseLicense,
  EnterpriseLicenseServiceType
> {
  public constructor() {
    super(EnterpriseLicense, EnterpriseLicenseService);
  }
}
