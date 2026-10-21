import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/SecurityDetection";

/*
 * Detections are written by OneUptime alone - the detection ingest
 * (SecurityCaseIngest) - and read by the Security tiers. The project check
 * still holds every rule, feed, connection and case a detection names to its
 * project.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
