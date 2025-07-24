import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1753377161288 implements MigrationInterface {
  public name = "MigrationName1753377161288";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_16db786b562f1db40c93d463c7" ON "IncidentStateTimeline" ("incidentId", "projectId", "startsAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_410cf30b966f88c287d368aa48" ON "IncidentStateTimeline" ("incidentId", "startsAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ac648c5f1961bc1d5ec1ba21bd" ON "MonitorProbe" ("monitorId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bde10e600047b06718db90a636" ON "MonitorProbe" ("monitorId", "probeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_570f164ca5b3559eb8555eb1b1" ON "MonitorStatusTimeline" ("monitorId", "startsAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_466d392af405ccf2e8b552eb0e" ON "MonitorStatusTimeline" ("monitorId", "projectId", "startsAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_466d392af405ccf2e8b552eb0e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_570f164ca5b3559eb8555eb1b1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bde10e600047b06718db90a636"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ac648c5f1961bc1d5ec1ba21bd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_410cf30b966f88c287d368aa48"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_16db786b562f1db40c93d463c7"`,
    );
  }
}
