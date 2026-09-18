import Column from "./Column";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

type Columns<T extends BaseModel | AnalyticsBaseModel> = Array<Column<T>>;

export default Columns;
