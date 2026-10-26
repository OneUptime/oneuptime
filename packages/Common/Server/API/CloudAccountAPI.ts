import CloudAccount from "../../Models/DatabaseModels/CloudAccount";
import CloudAccountService, {
  Service as CloudAccountServiceClass,
} from "../Services/CloudAccountService";
import BaseAPI from "./BaseAPI";

/*
 * Cloud accounts: the CRUD routes. Accounts are created by the reads of
 * cloud connections (CloudAccountService.recordAccountsSeen); people name,
 * describe and label them.
 */
export default class CloudAccountAPI extends BaseAPI<
  CloudAccount,
  CloudAccountServiceClass
> {
  public constructor() {
    super(CloudAccount, CloudAccountService);
  }
}
