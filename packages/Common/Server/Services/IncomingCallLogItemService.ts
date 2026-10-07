import ProjectReferencesService from "./ProjectReferencesService";
import IncomingCallLogItem from "../../Models/DatabaseModels/IncomingCallLogItem";

export class Service extends ProjectReferencesService<IncomingCallLogItem> {
  public constructor() {
    super(IncomingCallLogItem);
  }

  /*
   * Call log items are written by OneUptime while it routes an incoming call,
   * for the escalation rule and the person it is ringing - who may have left
   * the project since. Refusing one would break the call. A call log item
   * written by an API call is checked like any other write.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }
}

export default new Service();
