import ObjectID from "../../../Types/ObjectID";
import BaseModel from "./DatabaseBaseModel";

export default class TenantModel extends BaseModel {
  public constructor(id?: ObjectID) {
    super(id);
  }

  public override isTenantModel(): boolean {
    return true;
  }
}
