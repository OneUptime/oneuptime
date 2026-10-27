import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Dashboard playlists (DashboardPlaylist, GitHub issue #5235): dashboards
 * shown one after another on a screen, each for the same time. Generated
 * with npm run generate-postgres-migration. A new table, so its index and
 * foreign keys are built on an empty table; no existing row changes.
 */
export class AddDashboardPlaylists1808070000000 implements MigrationInterface {
  public name: string = "AddDashboardPlaylists1808070000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DashboardPlaylist" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "dashboards" jsonb, "intervalInSeconds" integer NOT NULL DEFAULT '60', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_5196a18d5806e2a50ea530cf7a8" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1ca8e92828cf4117f8228007f" ON "DashboardPlaylist" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPlaylist" ADD CONSTRAINT "FK_e1ca8e92828cf4117f8228007f2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPlaylist" ADD CONSTRAINT "FK_7f81ce2894c92eae1fe146460b4" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPlaylist" ADD CONSTRAINT "FK_b71d2ee1178a987071c724bfec2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DashboardPlaylist" DROP CONSTRAINT "FK_b71d2ee1178a987071c724bfec2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPlaylist" DROP CONSTRAINT "FK_7f81ce2894c92eae1fe146460b4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPlaylist" DROP CONSTRAINT "FK_e1ca8e92828cf4117f8228007f2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e1ca8e92828cf4117f8228007f"`,
    );
    await queryRunner.query(`DROP TABLE "DashboardPlaylist"`);
  }
}
