import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/HuntressIncidentReport";

/*
 * The Huntress incident reports a project received. Only the webhook
 * (Utils/Huntress/HuntressIncidentReportProcessor) writes them, as root, so
 * every reference a row names is one OneUptime found itself; callers can
 * only read them.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
