import ColumnRefusalMessage from "./ColumnRefusalMessage";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Permission from "../../../../Types/Permission";

/*
 * A create or update that writes a column the caller may not write
 * (ColumnPermissions, and the analytics ModelPermission's column check).
 *
 * To every API caller it is the BadDataException it always was - the same
 * status, the same first sentence - followed by who may write the column,
 * or that no permission allows it (ColumnRefusalMessage). It has its own type
 * so that what reports a refusal in plain words - a workflow step's run log
 * (LogComponentError) - can tell a refused column from any other bad data
 * without reading the message, and which column it was (a step that sent
 * createdIncidentTemplateId is pointed at its Incident Template setting).
 */
export default class ColumnWriteRefusedException extends BadDataException {
  // The column refused, as the model names it.
  public readonly columnName: string;

  public constructor(data: {
    // The operation refused: "create" or "update".
    requestType: string;
    columnName: string;
    // The model's singular name, as the refusal always named it.
    modelName: string | null;
    /*
     * The column's own list for the operation: the refusal says who may
     * write it, or that nobody may. Left out for a refusal that is not about
     * permissions, which keeps to its first sentence.
     */
    permissions?: Array<Permission> | undefined;
  }) {
    super(
      ColumnRefusalMessage.getWriteRefusal({
        requestType: data.requestType,
        column: data.columnName,
        modelName: data.modelName,
        permissions: data.permissions,
      }),
    );

    this.columnName = data.columnName;
  }
}
