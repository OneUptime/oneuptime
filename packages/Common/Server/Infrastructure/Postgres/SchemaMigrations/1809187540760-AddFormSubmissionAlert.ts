import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Forms create alerts (#10760): a submission through a form whose target is
 * Alert links the alert it created, in "FormSubmission"."alertId", as
 * "incidentId" and "scheduledMaintenanceId" link what the other targets
 * create. One nullable column, so no row is rewritten: every submission so
 * far created an incident or a maintenance event, and keeps null here.
 *
 * Generated with npm run generate-postgres-migration. Its index and its key
 * to "Alert" are built online, in AddFormSubmissionAlertIndexAndKey
 * 1809187540770: monitors open and change alerts all the time, and a key
 * added in a transaction would hold "Alert" while it checked every
 * submission.
 */
export class AddFormSubmissionAlert1809187540760 implements MigrationInterface {
  public name: string = "AddFormSubmissionAlert1809187540760";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "FormSubmission" ADD "alertId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "FormSubmission" DROP COLUMN "alertId"`,
    );
  }
}
