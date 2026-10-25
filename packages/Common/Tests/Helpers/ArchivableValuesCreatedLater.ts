import IncidentPostmortemStatus from "../../Models/DatabaseModels/IncidentPostmortemStatus";
import SecurityCasePriority from "../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../Models/DatabaseModels/SecurityCaseStatus";

/*
 * The archivable values (Common/Utils/ArchivableValues) made after the two
 * archive migrations, 1805800000000-AddArchiveToValues and
 * 1805810000000-AddArchiveToValuesUserKeys. Those two do not alter them: each
 * one's own migration creates it archivable - the three columns in its CREATE
 * TABLE, the key from who archived a value to the user beside them - as the
 * migration generator wrote it from the model.
 *
 * One list for both suites that need the split:
 * AddArchiveToValuesMigration.test.ts reads each creating migration and holds
 * this list and the altered tables to ARCHIVABLE_VALUE_TABLE_NAMES, and
 * ArchivableValuesPostgres.test.ts runs the two archive migrations on every
 * other value table. The Postgres suite only runs in the Postgres Schema Drift
 * workflow, so a value table added to one hand-kept copy and not the other
 * (#5237's case priorities and statuses) turned that workflow red unseen.
 */
export interface ArchivableValueCreatedLater {
  table: string;
  modelType: unknown;
  // Its creating migration's file and class name.
  file: string;
  migrationName: string;
}

export const ARCHIVABLE_VALUES_CREATED_LATER: Array<ArchivableValueCreatedLater> =
  [
    {
      table: "IncidentPostmortemStatus",
      modelType: IncidentPostmortemStatus,
      file: "1805900000000-AddIncidentPostmortemStatus.ts",
      migrationName: "AddIncidentPostmortemStatus1805900000000",
    },
    {
      table: "SecurityCaseStatus",
      modelType: SecurityCaseStatus,
      file: "1807200000000-AddSecurityCasePrioritiesAndStatuses.ts",
      migrationName: "AddSecurityCasePrioritiesAndStatuses1807200000000",
    },
    {
      table: "SecurityCasePriority",
      modelType: SecurityCasePriority,
      file: "1807200000000-AddSecurityCasePrioritiesAndStatuses.ts",
      migrationName: "AddSecurityCasePrioritiesAndStatuses1807200000000",
    },
  ];
