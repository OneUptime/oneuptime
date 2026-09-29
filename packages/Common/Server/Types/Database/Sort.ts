import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DatabaseProperty from "../../../Types/Database/DatabaseProperty";
import { FindOptionsOrderProperty, FindOptionsOrderValue } from "typeorm";

export declare type FindOrderProperty<Property> =
  Property extends DatabaseProperty
    ? SortOrder
    : FindOptionsOrderProperty<Property> extends FindOptionsOrderValue
      ? SortOrder
      : never;
/**
 * Order by find options.
 */
export declare type FindOrder<Entity> = {
  [P in keyof Entity]?: SortOrder;
};

type Sort<TBaseModel extends BaseModel> = FindOrder<TBaseModel>;

export default Sort;
