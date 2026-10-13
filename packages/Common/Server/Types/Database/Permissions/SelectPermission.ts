import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Select from "../Select";
import ColumnPermissions from "./ColumnPermission";
import ColumnRefusalMessage from "./ColumnRefusalMessage";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Columns from "../../../../Types/Database/Columns";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export default class SelectPermission {
  @CaptureSpan()
  public static checkSelectPermission<TBaseModel extends BaseModel>(
    modelType: DatabaseBaseModelType,
    select: Select<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): void {
    const model: BaseModel = new modelType();

    const canReadOnTheseColumns: Columns =
      ColumnPermissions.getModelColumnsByPermissions(
        modelType,
        ColumnPermissions.getColumnCheckRows(props),
        DatabaseRequestType.Read,
      );

    const tableColumns: Array<string> = model.getTableColumns().columns;

    const excludedColumnNames: Array<string> =
      ColumnPermissions.getExcludedColumnNames();

    for (const key in select) {
      if (excludedColumnNames.includes(key)) {
        continue;
      }

      if (!canReadOnTheseColumns.columns.includes(key)) {
        if (!tableColumns.includes(key)) {
          throw new BadDataException(
            `Invalid select clause. Cannot select on "${key}". This column does not exist on ${
              model.singularName
            }. Here are the columns you can select on instead: ${tableColumns.join(
              ", ",
            )}`,
          );
        }

        // Who may read it, or that nobody may (ColumnRefusalMessage).
        throw new NotAuthorizedException(
          ColumnRefusalMessage.getSelectRefusal({
            column: key,
            permissions: model.getColumnAccessControlFor(key)?.read || [],
          }),
        );
      }
    }
  }
}
