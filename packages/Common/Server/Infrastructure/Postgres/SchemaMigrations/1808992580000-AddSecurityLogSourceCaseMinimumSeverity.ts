import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * "SecurityLogSource" (Your logs) gains "caseMinimumSeverity": the least
 * severity at which a threat a security product wrote in the logs - a
 * firewall's or an IDS's CEF, LEEF or own syslog - opens a security case,
 * as a connection's "Open Cases From Severity" does
 * (Server/Utils/SecurityCase/SecurityLogCases.ts). High for every project,
 * as it was for every connection when cases came; empty opens none.
 *
 * A constant default adds the column without rewriting the table, and no
 * index or foreign key is added, so nothing scans or locks it.
 */
export class AddSecurityLogSourceCaseMinimumSeverity1808992580000
  implements MigrationInterface
{
  public name: string = "AddSecurityLogSourceCaseMinimumSeverity1808992580000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityLogSource" ADD "caseMinimumSeverity" character varying(100) DEFAULT 'High'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityLogSource" DROP COLUMN "caseMinimumSeverity"`,
    );
  }
}
