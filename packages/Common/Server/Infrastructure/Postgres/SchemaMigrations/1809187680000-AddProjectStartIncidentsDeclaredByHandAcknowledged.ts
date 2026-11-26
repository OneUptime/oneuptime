import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Start incidents declared by hand acknowledged (#11137): Project
 * "startIncidentsDeclaredByHandAcknowledged", the switch on Incidents >
 * Settings > Incident State that starts an incident someone declares in the
 * dashboard, Slack or Microsoft Teams in the project's acknowledged state
 * when nothing names its state and it pages no on-call policy
 * (Common/Types/Incident/IncidentDeclaredByHandStart).
 *
 * Off for every project, existing and new: an upgrade must never stop
 * paging anyone, and an incident that starts acknowledged pages nobody. The
 * column with a constant default is added without rewriting a row.
 */
export class AddProjectStartIncidentsDeclaredByHandAcknowledged1809187680000
  implements MigrationInterface
{
  public name: string =
    "AddProjectStartIncidentsDeclaredByHandAcknowledged1809187680000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "startIncidentsDeclaredByHandAcknowledged" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "startIncidentsDeclaredByHandAcknowledged"`,
    );
  }
}
