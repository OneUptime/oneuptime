import DatabaseRequestType from "../../../Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../../../Types/Database/Permissions/TablePermission";
import AuditLogReadAccess from "../../AuditLog/AuditLogReadAccess";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import { DatabaseBaseModelType } from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Permission from "../../../../Types/Permission";
import {
  AuditRecordNameReaders as AuditRecordNameReadersOfEvents,
  isAuditRecordNameReadByEveryEventReader,
} from "../../../../Utils/SecurityEvent/TelemetryScan/AuditLogSignals";

/*
 * WHO READS A RECORD'S NAME IN A SECURITY EVENT ABOUT IT (#10663), as the
 * models say it: the permissions that read security events (SecurityEvent's
 * read list), and those that read a record's table, found by the type its
 * audit log entries are stored under (AuditLogReadAccess.getModelTypesOf)
 * and asked of the table's read list (TablePermission.getTablePermission).
 * A type two models share is read by the permissions both tables name: the
 * record is in one of them, and which is not known.
 *
 * The audit log's security scan writes each event once, for all of them,
 * so an event names its record only when every permission that reads
 * security events reads the record's table
 * (Utils/SecurityEvent/TelemetryScan/AuditLogSignals). The read lists are
 * the models' own, so a change to one is the one decision:
 * AuditRecordNamesGuard pins what each type's events say.
 */
export default class AuditRecordNameReaders {
  private static readers: AuditRecordNameReadersOfEvents | null = null;

  // The readers of security events and of each record type's table, worked out once.
  public static get(): AuditRecordNameReadersOfEvents {
    if (!AuditRecordNameReaders.readers) {
      const recordReaders: Map<string, ReadonlyArray<Permission>> = new Map();

      AuditRecordNameReaders.readers = {
        eventReaders: AuditRecordNameReaders.getEventReaders(),
        getRecordReaders: (resourceType: string): ReadonlyArray<Permission> => {
          let readers: ReadonlyArray<Permission> | undefined =
            recordReaders.get(resourceType);

          if (!readers) {
            readers = AuditRecordNameReaders.getRecordReaders(resourceType);
            recordReaders.set(resourceType, readers);
          }

          return readers;
        },
      };
    }

    return AuditRecordNameReaders.readers;
  }

  // The permissions that read security events.
  public static getEventReaders(): Array<Permission> {
    return [...new SecurityEvent().getReadPermissions()];
  }

  /*
   * The permissions that read the records of a type's table: none for a
   * type no model has (any longer), or one of the audit log's own.
   */
  public static getRecordReaders(resourceType: string): Array<Permission> {
    const modelTypes: Array<DatabaseBaseModelType> =
      AuditLogReadAccess.getModelTypesOf(resourceType);

    if (modelTypes.length === 0) {
      return [];
    }

    const tableReaders: Array<Array<Permission>> = modelTypes.map(
      (modelType: DatabaseBaseModelType): Array<Permission> => {
        return TablePermission.getTablePermission(
          modelType,
          DatabaseRequestType.Read,
        );
      },
    );

    return (tableReaders[0] || []).filter((permission: Permission): boolean => {
      return tableReaders.every((readers: Array<Permission>): boolean => {
        return readers.includes(permission);
      });
    });
  }

  // Whether events about records of this type may name them.
  public static isNameWritten(resourceType: string): boolean {
    return isAuditRecordNameReadByEveryEventReader({
      resourceType,
      readers: AuditRecordNameReaders.get(),
    });
  }
}
