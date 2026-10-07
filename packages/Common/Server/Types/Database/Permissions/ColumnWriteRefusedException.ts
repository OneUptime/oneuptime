import BadDataException from "../../../../Types/Exception/BadDataException";

/*
 * A create or update that writes a column the caller may not write
 * (ColumnPermissions, and the analytics ModelPermission's column check).
 *
 * To every API caller it is the BadDataException it always was - the same
 * status, the same words. It has its own type so that what reports a refusal
 * in plain words - a workflow step's run log (LogComponentError) - can tell
 * a refused column from any other bad data without reading the message, and
 * which column it was (a step that sent createdIncidentTemplateId is pointed
 * at its Incident Template setting).
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
  }) {
    super(
      `User is not allowed to ${data.requestType} on ${data.columnName} column of ${data.modelName}`,
    );

    this.columnName = data.columnName;
  }
}
