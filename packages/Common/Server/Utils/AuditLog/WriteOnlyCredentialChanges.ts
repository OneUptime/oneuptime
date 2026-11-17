import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import UpdateBy from "../../Types/Database/UpdateBy";

/*
 * A WRITE-ONLY CREDENTIAL CHANGED IS STILL IN THE AUDIT LOG, AS CHANGED.
 *
 * A column nobody may read through the API (read: []) is left out of every
 * audit log entry, so its value never reaches roles that may read the log
 * but not the column. A write-only credential is such a column: an update
 * that changes only it - a project's SMTP password rotated, a repository's
 * webhook secret replaced - would leave no entry at all, and nobody could
 * tell who changed it, or when.
 *
 * Naming the credentials an update writes in its auditLogIncludeColumns
 * records each as changed - by whom, when - and never with its value, the
 * one it had or the one it has (AuditLogService.recordUpdate). Called from
 * a service's onBeforeUpdate, before the write is encrypted; a credential
 * the update does not write is not named, and one written as it was makes
 * no entry, as any column written back unchanged makes none.
 */
export default class WriteOnlyCredentialChanges {
  public static recordInAuditLog<TBaseModel extends BaseModel>(
    updateBy: UpdateBy<TBaseModel>,
    credentialColumns: ReadonlyArray<string>,
  ): void {
    const data: Record<string, unknown> = (updateBy.data || {}) as Record<
      string,
      unknown
    >;

    // Set, or cleared with null: a model's own unset columns hold undefined.
    const written: Array<string> = credentialColumns.filter(
      (column: string): boolean => {
        return data[column] !== undefined;
      },
    );

    if (written.length === 0) {
      return;
    }

    updateBy.auditLogIncludeColumns = Array.from(
      new Set<string>([...(updateBy.auditLogIncludeColumns || []), ...written]),
    );
  }
}
