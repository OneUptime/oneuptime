import GenericObject from "../GenericObject";
import SortOrder from "./SortOrder";

/**
 * Order by find options.
 */
export declare type FindOrder<Entity extends GenericObject> = {
  [P in keyof Entity]?: SortOrder;
};

type Sort<TBaseModel extends GenericObject> = FindOrder<TBaseModel>;

export default Sort;
