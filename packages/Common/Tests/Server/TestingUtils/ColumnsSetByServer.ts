import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";

/*
 * The server-set (computed) columns `record` holds a value in, as the
 * columns a create's own steps wrote into it: what DatabaseService hands the
 * check of the record as written (ModelPermission.checkCreatePermissions'
 * columnsSetByServer) when the caller sent none of them. For a test that
 * asks that check of a record as a create's hooks leave it.
 */
export function columnsTheCreateWrote(record: BaseModel): Array<string> {
  const modelType: { new (): BaseModel } = record.constructor as {
    new (): BaseModel;
  };

  return ColumnPermissions.getComputedColumnsWithValue(
    new modelType(),
    record,
  );
}
