import ProjectReferencesService from "./ProjectReferencesService";
import DataPipelineRun from "../../Models/DatabaseModels/DataPipelineRun";
import { IsBillingEnabled } from "../EnvironmentConfig";

/*
 * Each run of a pipeline, from OpenLineage events. OneUptime writes them;
 * on OneUptime's cloud, runs older than 90 days are deleted.
 */
export class Service extends ProjectReferencesService<DataPipelineRun> {
  public constructor() {
    super(DataPipelineRun);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 90);
    }
  }

  // Written from ingested events, whose project the ingestion key proved.
  protected override checksServerWrites(): boolean {
    return false;
  }
}

export default new Service();
