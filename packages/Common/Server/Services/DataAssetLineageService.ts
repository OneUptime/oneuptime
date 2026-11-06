import ProjectReferencesService from "./ProjectReferencesService";
import DataAssetLineage from "../../Models/DatabaseModels/DataAssetLineage";

/*
 * Tables feeding tables, from the pipelines that read one and write the
 * other. OneUptime writes them.
 */
export class Service extends ProjectReferencesService<DataAssetLineage> {
  public constructor() {
    super(DataAssetLineage);
  }

  // Written from ingested events, whose project the ingestion key proved.
  protected override checksServerWrites(): boolean {
    return false;
  }
}

export default new Service();
