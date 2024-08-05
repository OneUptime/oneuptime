import Column from "./Column";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

type Columns<T extends BaseModel | AnalyticsBaseModel> = Array<Column<T>>;

export default Columns;
