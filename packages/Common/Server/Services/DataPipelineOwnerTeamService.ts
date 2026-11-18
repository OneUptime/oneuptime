import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DataPipelineOwnerTeam";

/*
 * The teams who own a data pipeline (#6551): named beside a failed or late
 * run in Needs Attention and Issues, and told of its alerts, which take
 * their owners from the pipeline (DataAlertCause). A pipeline keeps no
 * timeline of its own, so adding or removing one is written to the audit
 * log, as every change through the API is.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
