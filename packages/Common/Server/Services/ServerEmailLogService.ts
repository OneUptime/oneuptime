import { IsBillingEnabled } from "../EnvironmentConfig";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ServerEmailLog";
import { getServerEmailLogRetentionInDays } from "../../Types/Email/ServerEmailLog";

/*
 * The server's own email log (#6878): written by MailService as root, read
 * by master admins through GET /global-config/email-log, and nobody's to
 * read or write through an API. A row is deleted for good once it is older
 * than the log keeps it - 30 days on a self-hosted server, 3 on OneUptime
 * Cloud - by the daily HardDelete job (OlderRowsPurge).
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays(
      "createdAt",
      getServerEmailLogRetentionInDays(IsBillingEnabled),
    );
  }
}

export default new Service();
