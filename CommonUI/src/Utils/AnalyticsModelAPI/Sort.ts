import AnalyticsDataModel from 'Common/AnalyticsModels/BaseModel';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import { JSONObject } from 'Common/Types/JSON';

type Sort<TBaseModel extends AnalyticsDataModel | JSONObject> = {
    [P in keyof TBaseModel]?: SortOrder;
};

export default Sort;
