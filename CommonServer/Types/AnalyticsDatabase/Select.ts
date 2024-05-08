import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import Dictionary from 'Common/Types/Dictionary';

export type SelectPropertyOptions = true | Dictionary<true>;

/**
 * Select find options.
 */

export declare type SelectOptions<Entity> = {
    [P in keyof Entity]?: SelectPropertyOptions;
};

type Select<TBaseModel extends AnalyticsBaseModel> = SelectOptions<TBaseModel>;
export default Select;
