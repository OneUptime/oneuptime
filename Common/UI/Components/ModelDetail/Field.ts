import { FieldBase } from "../Detail/Field";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Select from "../../../Types/BaseDatabase/Select";

export default interface Field<TBaseModel extends BaseModel>
  extends FieldBase<TBaseModel> {
  field?: Select<TBaseModel> | undefined;
}
