import DatabaseService from "./DatabaseService";
import IncomingCallLogItem from "../../Models/DatabaseModels/IncomingCallLogItem";

export class Service extends DatabaseService<IncomingCallLogItem> {
  public constructor() {
    super(IncomingCallLogItem);
  }
}

export default new Service();
