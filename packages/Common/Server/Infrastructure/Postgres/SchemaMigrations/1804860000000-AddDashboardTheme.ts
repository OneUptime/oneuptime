import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A dashboard's theme: how its public link looks to visitors - Light, Dark
 * or System (light or dark, as each visitor's device is set). See
 * Types/Dashboard/DashboardTheme.
 *
 * ADD COLUMN ... DEFAULT 'Light' gives every dashboard that exists today
 * Light in the same statement - Postgres keeps the default as the value of
 * the rows it adds the column to, without rewriting the table - so each
 * public dashboard keeps looking exactly as it does now. Dashboards made
 * from now on start with System, which DashboardService.onBeforeCreate sets
 * when a create names no theme; the column's default stays Light, which is
 * also the default the Terraform provider sends.
 */
export class AddDashboardTheme1804860000000 implements MigrationInterface {
  public name: string = "AddDashboardTheme1804860000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "theme" character varying(100) DEFAULT 'Light'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Dashboard" DROP COLUMN "theme"`);
  }
}
