import DatabaseService from "./DatabaseService";
import TableView from "Common/Models/DatabaseModels/TableView";

export class Service extends DatabaseService<TableView> {
  public constructor() {
    super(TableView);
  }
}

export default new Service();