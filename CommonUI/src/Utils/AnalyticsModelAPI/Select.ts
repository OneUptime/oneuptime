import AnalyticsDataModel from 'Common/AnalyticsModels/BaseModel';
import { JSONObject } from 'Common/Types/JSON';

type Select<TBaseModel extends AnalyticsDataModel | JSONObject> = {
    [P in keyof TBaseModel]?: boolean | JSONObject;
};

export default Select;
