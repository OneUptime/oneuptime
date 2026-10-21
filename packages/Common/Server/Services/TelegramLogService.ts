import { IsBillingEnabled } from "../EnvironmentConfig";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/TelegramLog";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3);
    }
  }

  /*
   * Delivery logs are written by OneUptime as it sends each message, naming the
   * records it sends about, and some are written before the message goes out -
   * refusing one would stop the message. A log row written by a workflow is
   * checked like any other write.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }
}

export default new Service();
