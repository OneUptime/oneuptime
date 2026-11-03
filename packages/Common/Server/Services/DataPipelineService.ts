import ProjectReferencesService from "./ProjectReferencesService";
import DataPipeline from "../../Models/DatabaseModels/DataPipeline";

/*
 * The pipelines that move data, from OpenLineage events
 * (Utils/DataObservability/OpenLineageIngest). OneUptime creates and
 * updates them; people describe or delete one.
 */
export class Service extends ProjectReferencesService<DataPipeline> {
  public constructor() {
    super(DataPipeline);
  }

  // Written from ingested events, whose project the ingestion key proved.
  protected override checksServerWrites(): boolean {
    return false;
  }
}

export default new Service();
