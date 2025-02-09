import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PositiveNumber from "Common/Types/PositiveNumber";

export default interface SearchResult<TBaseModel extends BaseModel> {
  items: Array<TBaseModel>;
  count: PositiveNumber;
}
