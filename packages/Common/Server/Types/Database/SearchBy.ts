import Select from "./Select";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PositiveNumber from "../../../Types/PositiveNumber";

export default interface SearchBy<TBaseModel extends BaseModel> {
  text: string;
  column: keyof TBaseModel;
  limit: PositiveNumber;
  skip: PositiveNumber;
  select: Select<TBaseModel>;
  props: DatabaseCommonInteractionProps;
}
