import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then numbered after
 * the last registered migration. The index on DataCheck."monitorId" it
 * generated with these is built online in AddDataCheckMonitorIdIndex
 * 1809184560000.
 *
 * What makes Data Observability's lists and counts read on the server
 * (#6550, #6552, #6554), and owners on a data pipeline (#6551):
 *
 *   - DataAsset."lateAt": when a table is late if it has not changed by
 *     then (getDataAssetLateAt), so Tables asks for the late tables and
 *     sorts by how overdue they are, and the menu counts them;
 *   - DataPipeline."lateAt": the same for a pipeline's next run
 *     (getDataPipelineLateAt);
 *   - DataCheck."health" and "healthRank": how a check stands now, kept as
 *     it runs and as its alert opens and resolves (DataCheckHealthSync),
 *     so Checks lists failing checks first and filters by health;
 *   - DataPipelineOwnerUser and DataPipelineOwnerTeam: a pipeline's owners,
 *     as a table's are kept.
 *
 * Four nullable columns on existing tables, with no default: adding them
 * rewrites nothing and blocks nothing. The two tables are new and empty, so
 * their indexes and keys are made here. A server of the release before
 * ignores all of it. The rows that exist get their values from
 * BackfillDataObservabilityAttentionColumns, a data migration, a page at a
 * time; until then a list reads a row without them as it always did.
 */
export class AddDataObservabilityAttentionColumnsAndPipelineOwners1809184550000
  implements MigrationInterface
{
  public name: string =
    "AddDataObservabilityAttentionColumnsAndPipelineOwners1809184550000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataPipelineOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "dataPipelineId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_e9b4798c612509b063685de13bd" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1143e77dbaa6dbdc88b688bbba" ON "DataPipelineOwnerUser" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7e63e4e712a186812dd78e54e7" ON "DataPipelineOwnerUser" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3a886ce7cfd86035a09cf93719" ON "DataPipelineOwnerUser" ("dataPipelineId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_838df3335478d2dfd288b2c6a1" ON "DataPipelineOwnerUser" ("isOwnerNotified")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_272943964b30e6ac0ceb04a311" ON "DataPipelineOwnerUser" ("dataPipelineId", "userId", "projectId")`,
    );
    await queryRunner.query(
      `CREATE TABLE "DataPipelineOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "dataPipelineId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_d2db81ed3b7c527b88a7487a8c1" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3b1d9caf76ebef8ddde2f54d30" ON "DataPipelineOwnerTeam" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ce9551fc37e117e0ba8f03ba49" ON "DataPipelineOwnerTeam" ("teamId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f757dffa1b5d554189af385c9f" ON "DataPipelineOwnerTeam" ("dataPipelineId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ab36e535f2331d0ec50ed36720" ON "DataPipelineOwnerTeam" ("isOwnerNotified")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d5fa532084de69a6b7607c67f3" ON "DataPipelineOwnerTeam" ("dataPipelineId", "teamId", "projectId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAsset" ADD "lateAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataCheck" ADD "health" character varying(100)`,
    );
    await queryRunner.query(`ALTER TABLE "DataCheck" ADD "healthRank" integer`);
    await queryRunner.query(
      `ALTER TABLE "DataPipeline" ADD "lateAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerUser" ADD CONSTRAINT "FK_1143e77dbaa6dbdc88b688bbbac" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerUser" ADD CONSTRAINT "FK_7e63e4e712a186812dd78e54e78" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerUser" ADD CONSTRAINT "FK_3a886ce7cfd86035a09cf93719d" FOREIGN KEY ("dataPipelineId") REFERENCES "DataPipeline"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerUser" ADD CONSTRAINT "FK_af80b0d5cbaa1d29890effd9e0c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerUser" ADD CONSTRAINT "FK_338e3cbc64e03cc597fc00ffa21" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerTeam" ADD CONSTRAINT "FK_3b1d9caf76ebef8ddde2f54d30f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerTeam" ADD CONSTRAINT "FK_ce9551fc37e117e0ba8f03ba49d" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerTeam" ADD CONSTRAINT "FK_f757dffa1b5d554189af385c9fe" FOREIGN KEY ("dataPipelineId") REFERENCES "DataPipeline"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerTeam" ADD CONSTRAINT "FK_f056303eb1d2dce3b72a0a3b16b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerTeam" ADD CONSTRAINT "FK_4bd997eca67f5cf145c71f5c541" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerTeam" DROP CONSTRAINT "FK_4bd997eca67f5cf145c71f5c541"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerTeam" DROP CONSTRAINT "FK_f056303eb1d2dce3b72a0a3b16b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerTeam" DROP CONSTRAINT "FK_f757dffa1b5d554189af385c9fe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerTeam" DROP CONSTRAINT "FK_ce9551fc37e117e0ba8f03ba49d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerTeam" DROP CONSTRAINT "FK_3b1d9caf76ebef8ddde2f54d30f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerUser" DROP CONSTRAINT "FK_338e3cbc64e03cc597fc00ffa21"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerUser" DROP CONSTRAINT "FK_af80b0d5cbaa1d29890effd9e0c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerUser" DROP CONSTRAINT "FK_3a886ce7cfd86035a09cf93719d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerUser" DROP CONSTRAINT "FK_7e63e4e712a186812dd78e54e78"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerUser" DROP CONSTRAINT "FK_1143e77dbaa6dbdc88b688bbbac"`,
    );
    await queryRunner.query(`ALTER TABLE "DataPipeline" DROP COLUMN "lateAt"`);
    await queryRunner.query(`ALTER TABLE "DataCheck" DROP COLUMN "healthRank"`);
    await queryRunner.query(`ALTER TABLE "DataCheck" DROP COLUMN "health"`);
    await queryRunner.query(`ALTER TABLE "DataAsset" DROP COLUMN "lateAt"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5fa532084de69a6b7607c67f3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ab36e535f2331d0ec50ed36720"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f757dffa1b5d554189af385c9f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ce9551fc37e117e0ba8f03ba49"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3b1d9caf76ebef8ddde2f54d30"`,
    );
    await queryRunner.query(`DROP TABLE "DataPipelineOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_272943964b30e6ac0ceb04a311"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_838df3335478d2dfd288b2c6a1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3a886ce7cfd86035a09cf93719"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7e63e4e712a186812dd78e54e7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1143e77dbaa6dbdc88b688bbba"`,
    );
    await queryRunner.query(`DROP TABLE "DataPipelineOwnerUser"`);
  }
}
