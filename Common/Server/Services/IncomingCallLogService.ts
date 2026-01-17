import DatabaseService from "./DatabaseService";
import IncomingCallLog from "../../Models/DatabaseModels/IncomingCallLog";

export class Service extends DatabaseService<IncomingCallLog> {
  public constructor() {
    super(IncomingCallLog);
  }
}

export default new Service();
