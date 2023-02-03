import type BaseModel from 'Common/Models/BaseModel';
import type DatabaseProperty from 'Common/Types/Database/DatabaseProperty';
import type { FindOperator, FindOptionsWhereProperty } from 'typeorm';

export declare type FindWhereProperty<Property> =
    Property extends DatabaseProperty
        ? Property | FindOperator<Property> | Array<Property>
        : FindOptionsWhereProperty<Property>;
/**
 * :
 * Used for find operations.
 */
export declare type FindWhere<Entity> = {
    [P in keyof Entity]?: FindWhereProperty<NonNullable<Entity[P]>>;
};

declare type Query<TBaseModel extends BaseModel> = FindWhere<TBaseModel>;

export declare type OrQuery<TBaseModel extends BaseModel> = Array<
    Query<TBaseModel>
>;

export default Query;
