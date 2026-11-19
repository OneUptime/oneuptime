import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then numbered after
 * the last registered migration.
 *
 * Owner rules for data pipelines (#9527): DataPipelineOwnerRule, a rule that
 * names a pipeline's owners by its name and namespace, with the people and
 * teams it adds (DataPipelineOwnerRuleUser, DataPipelineOwnerRuleTeam). The
 * three tables are new and empty, so their indexes and keys are made here,
 * and a server of the release before ignores them.
 */
export class AddDataPipelineOwnerRules1809184860000
  implements MigrationInterface
{
  public name: string = "AddDataPipelineOwnerRules1809184860000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataPipelineOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "criteria" jsonb, "emptiedLimits" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "nameRegexPattern" character varying(500), "namespaceRegexPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_0057fcb6cf103a45142b084a37f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8ea349851c09f7c91fdd53f1ba" ON "DataPipelineOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1690d87fb27727cf41fa66a39a" ON "DataPipelineOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_803ec2439d4f11695fb44a253f" ON "DataPipelineOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataPipelineOwnerRuleUser" ("dataPipelineOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_e90023292a02b84b9fafa24abe9" PRIMARY KEY ("dataPipelineOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6ecf74754734df78b0f07ed821" ON "DataPipelineOwnerRuleUser" ("dataPipelineOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9cfd9e0362c51029d89f695d60" ON "DataPipelineOwnerRuleUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataPipelineOwnerRuleTeam" ("dataPipelineOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_c1e91a92703692ba7adecbdbf93" PRIMARY KEY ("dataPipelineOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4314429d411299a5f9180b10d7" ON "DataPipelineOwnerRuleTeam" ("dataPipelineOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_76dd54c2656d58f36bd1f2a109" ON "DataPipelineOwnerRuleTeam" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerRule" ADD CONSTRAINT "FK_8ea349851c09f7c91fdd53f1bab" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerRule" ADD CONSTRAINT "FK_056cb2f58126de03c450ff4cc00" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerRule" ADD CONSTRAINT "FK_db78a8ffd37825e7a00c0234a44" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerRuleUser" ADD CONSTRAINT "FK_6ecf74754734df78b0f07ed8210" FOREIGN KEY ("dataPipelineOwnerRuleId") REFERENCES "DataPipelineOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerRuleUser" ADD CONSTRAINT "FK_9cfd9e0362c51029d89f695d606" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerRuleTeam" ADD CONSTRAINT "FK_4314429d411299a5f9180b10d72" FOREIGN KEY ("dataPipelineOwnerRuleId") REFERENCES "DataPipelineOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerRuleTeam" ADD CONSTRAINT "FK_76dd54c2656d58f36bd1f2a109d" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerRuleTeam" DROP CONSTRAINT "FK_76dd54c2656d58f36bd1f2a109d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerRuleTeam" DROP CONSTRAINT "FK_4314429d411299a5f9180b10d72"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerRuleUser" DROP CONSTRAINT "FK_9cfd9e0362c51029d89f695d606"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerRuleUser" DROP CONSTRAINT "FK_6ecf74754734df78b0f07ed8210"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerRule" DROP CONSTRAINT "FK_db78a8ffd37825e7a00c0234a44"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerRule" DROP CONSTRAINT "FK_056cb2f58126de03c450ff4cc00"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataPipelineOwnerRule" DROP CONSTRAINT "FK_8ea349851c09f7c91fdd53f1bab"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_76dd54c2656d58f36bd1f2a109"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4314429d411299a5f9180b10d7"`,
    );
    await queryRunner.query(`DROP TABLE "DataPipelineOwnerRuleTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9cfd9e0362c51029d89f695d60"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6ecf74754734df78b0f07ed821"`,
    );
    await queryRunner.query(`DROP TABLE "DataPipelineOwnerRuleUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_803ec2439d4f11695fb44a253f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1690d87fb27727cf41fa66a39a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8ea349851c09f7c91fdd53f1ba"`,
    );
    await queryRunner.query(`DROP TABLE "DataPipelineOwnerRule"`);
  }
}
