import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (the statements TypeORM
 * generates for the models), then renumbered after the last registered
 * migration.
 *
 * People can be paged as observers (OnCallObserverPage): kept informed while
 * somebody else responds, their answer acknowledging nothing. The alert,
 * incident and episode on-call rules each get what they page their policies
 * as (pageAs, OnCallPageAs), and an execution log whether it pages its people
 * as observers (isObserverPage).
 *
 * Nothing to backfill: pageAs starts as Responders on every rule that exists -
 * how every rule pages today - and isObserverPage as false on every run there
 * is, which all paged responders. A NOT NULL column with a constant default is
 * added without rewriting a row.
 */
export class AddOnCallObserverPages1808995300000 implements MigrationInterface {
  public name: string = "AddOnCallObserverPages1808995300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "isObserverPage" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" ADD "pageAs" character varying(100) NOT NULL DEFAULT 'Responders'`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" ADD "pageAs" character varying(100) NOT NULL DEFAULT 'Responders'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" ADD "pageAs" character varying(100) NOT NULL DEFAULT 'Responders'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" ADD "pageAs" character varying(100) NOT NULL DEFAULT 'Responders'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" DROP COLUMN "pageAs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" DROP COLUMN "pageAs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" DROP COLUMN "pageAs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" DROP COLUMN "pageAs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP COLUMN "isObserverPage"`,
    );
  }
}
