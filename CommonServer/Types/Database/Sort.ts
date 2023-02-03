import type BaseModel from 'Common/Models/BaseModel';
import type DatabaseProperty from 'Common/Types/Database/DatabaseProperty';
import type { FindOptionsOrderProperty, FindOptionsOrderValue } from 'typeorm';
import type SortOrder from 'Common/Types/Database/SortOrder';

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
