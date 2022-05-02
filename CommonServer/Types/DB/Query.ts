import BaseModel from 'Common/Models/BaseModel';
import DatabaseProperty from 'Common/Types/DatabaseProperty';
import { FindOperator, FindOptionsWhereProperty } from 'typeorm';

export declare type FindWhereProperty<Property> = Property extends DatabaseProperty ? Property | FindOperator<Property> : FindOptionsWhereProperty<Property>;
/** :
 * Used for find operations.
 */
export declare type FindWhere<Entity> = {
    [P in keyof Entity]?: FindWhereProperty<NonNullable<Entity[P]>>;
};


declare type Query<TBaseModel extends BaseModel> = FindWhere<TBaseModel>;

export default Query;