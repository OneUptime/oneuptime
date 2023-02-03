import type BaseModel from 'Common/Models/BaseModel';
import type DatabaseProperty from 'Common/Types/Database/DatabaseProperty';
import type { FindOptionsSelectProperty } from 'typeorm';

export type SelectPropertyOptions<Property> = Property extends DatabaseProperty
    ? boolean
    : FindOptionsSelectProperty<Property>;

/**
 * Select find options.
 */
export declare type SelectOptions<Entity> = {
    [P in keyof Entity]?: SelectPropertyOptions<NonNullable<Entity[P]>>;
};

type Select<TBaseModel extends BaseModel> = SelectOptions<TBaseModel>;
export default Select;
