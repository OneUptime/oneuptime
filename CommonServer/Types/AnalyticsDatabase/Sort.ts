import BaseModel from 'Common/AnalyticsModels/BaseModel';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
/**
 * Order by find options.
 */
export declare type FindOrder<Entity> = {
    [P in keyof Entity]?: SortOrder;
};

type Sort<TBaseModel extends BaseModel> = FindOrder<TBaseModel>;

export default Sort;
