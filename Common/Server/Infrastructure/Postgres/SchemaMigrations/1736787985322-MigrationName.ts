import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1736787985322 implements MigrationInterface {
    public name = 'MigrationName1736787985322'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Label" ALTER COLUMN "color" TYPE character varying(10)`);
        await queryRunner.query(`ALTER TABLE "IncidentSeverity" ALTER COLUMN "color" TYPE character varying(10)`);
        await queryRunner.query(`ALTER TABLE "IncidentState" ALTER COLUMN "color" TYPE character varying(10)`);
        await queryRunner.query(`ALTER TABLE "MonitorStatus" ALTER COLUMN "color" TYPE character varying(10)`);
        await queryRunner.query(`ALTER TABLE "IncidentFeed" ALTER COLUMN "displayColor" TYPE character varying(10)`);
        await queryRunner.query(`ALTER TABLE "AlertSeverity" ALTER COLUMN "color" TYPE character varying(10)`);
        await queryRunner.query(`ALTER TABLE "AlertState" ALTER COLUMN "color" TYPE character varying(10)`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceState" ALTER COLUMN "color" TYPE character varying(10)`);
        await queryRunner.query(`ALTER TABLE "StatusPage" ALTER COLUMN "defaultBarColor" TYPE character varying(10)`);
        await queryRunner.query(`ALTER TABLE "StatusPageHistoryChartBarColorRule" ALTER COLUMN "barColor" TYPE character varying(10)`);
        await queryRunner.query(`ALTER TABLE "AlertFeed" ALTER COLUMN "displayColor" TYPE character varying(10)`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceFeed" ALTER COLUMN "displayColor" TYPE character varying(10)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Label" ALTER COLUMN "color" TYPE character varying(7)`);
        await queryRunner.query(`ALTER TABLE "IncidentSeverity" ALTER COLUMN "color" TYPE character varying(7)`);
        await queryRunner.query(`ALTER TABLE "IncidentState" ALTER COLUMN "color" TYPE character varying(7)`);
        await queryRunner.query(`ALTER TABLE "MonitorStatus" ALTER COLUMN "color" TYPE character varying(7)`);
        await queryRunner.query(`ALTER TABLE "IncidentFeed" ALTER COLUMN "displayColor" TYPE character varying(7)`);
        await queryRunner.query(`ALTER TABLE "AlertSeverity" ALTER COLUMN "color" TYPE character varying(7)`);
        await queryRunner.query(`ALTER TABLE "AlertState" ALTER COLUMN "color" TYPE character varying(7)`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceState" ALTER COLUMN "color" TYPE character varying(7)`);
        await queryRunner.query(`ALTER TABLE "StatusPage" ALTER COLUMN "defaultBarColor" TYPE character varying(7)`);
        await queryRunner.query(`ALTER TABLE "StatusPageHistoryChartBarColorRule" ALTER COLUMN "barColor" TYPE character varying(7)`);
        await queryRunner.query(`ALTER TABLE "AlertFeed" ALTER COLUMN "displayColor" TYPE character varying(7)`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceFeed" ALTER COLUMN "displayColor" TYPE character varying(7)`);
    }

}
