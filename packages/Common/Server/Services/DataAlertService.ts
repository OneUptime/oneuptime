import ProjectReferencesService from "./ProjectReferencesService";
import DataAlert from "../../Models/DatabaseModels/DataAlert";

/*
 * What each data monitor's alert is about, and the alert it is a
 * consequence of. OneUptime writes them as the alert is created
 * (Utils/DataObservability/DataAlertCause); nobody else creates, edits or
 * deletes one.
 */
export class Service extends ProjectReferencesService<DataAlert> {
  public constructor() {
    super(DataAlert);
  }

  /*
   * Written as a monitor creates the alert, from the monitor's own project
   * and what it resolved there; checking each reference again would only
   * slow the alert down.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }
}

export default new Service();
