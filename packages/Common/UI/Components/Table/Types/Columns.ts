import Column from "./Column";
import GenericObject from "../../../../Types/GenericObject";

type Columns<T extends GenericObject> = Array<Column<T>>;

export default Columns;
