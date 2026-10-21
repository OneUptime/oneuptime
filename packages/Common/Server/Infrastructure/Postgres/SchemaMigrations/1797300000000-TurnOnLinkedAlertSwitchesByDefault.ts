import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * The two linked alert switches on Project - acknowledge linked alerts when
 * the incident is acknowledged, resolve them when it is resolved - are now on
 * by default, so a new project's linked alerts follow their incident.
 *
 * Only the column default changes. Existing projects keep the value they
 * have: a project that never touched the switches and one that turned them
 * off on purpose both hold false, and nothing tells them apart, so switching
 * either on would change how alerts are acknowledged and paged in a project
 * that did not ask for it. SET DEFAULT is a catalog change; it rewrites no
 * rows.
 */
export class TurnOnLinkedAlertSwitchesByDefault1797300000000
  implements MigrationInterface
{
  public name: string = "TurnOnLinkedAlertSwitchesByDefault1797300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ALTER COLUMN "acknowledgeLinkedAlertsWhenIncidentAcknowledged" SET DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ALTER COLUMN "resolveLinkedAlertsWhenIncidentResolved" SET DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ALTER COLUMN "resolveLinkedAlertsWhenIncidentResolved" SET DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ALTER COLUMN "acknowledgeLinkedAlertsWhenIncidentAcknowledged" SET DEFAULT false`,
    );
  }
}
