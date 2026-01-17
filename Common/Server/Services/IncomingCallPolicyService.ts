import DatabaseService from "./DatabaseService";
import IncomingCallPolicy from "../../Models/DatabaseModels/IncomingCallPolicy";

export class Service extends DatabaseService<IncomingCallPolicy> {
  public constructor() {
    super(IncomingCallPolicy);
  }
}

export default new Service();
