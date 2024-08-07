import Query from "../../../Utils/BaseDatabase/Query";
import GenericObject from "Common/Types/GenericObject";

type FillterData<T extends GenericObject> = Query<T>; // this is bascially a Query object

export default FillterData;
