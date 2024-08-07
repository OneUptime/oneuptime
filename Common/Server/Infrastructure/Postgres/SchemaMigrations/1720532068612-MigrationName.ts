import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1720532068612 implements MigrationInterface {
  public name = "MigrationName1720532068612";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // delete all records from CopilotAction
    await queryRunner.query(`DELETE FROM "CopilotAction"`);

    await queryRunner.query(
      `ALTER TABLE "CopilotAction" DROP CONSTRAINT "FK_d1f62129e09784b750ef9143bfe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" DROP CONSTRAINT "FK_786400c4dce05f85bbbd5244249"`,
    );
    await queryRunner.query(
      `CREATE TABLE "CopilotCodeRepository" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, "secretToken" uuid NOT NULL, "mainBranchName" character varying(100) NOT NULL DEFAULT 'master', "repositoryHostedAt" character varying(100) NOT NULL DEFAULT 'GitHub', "organizationName" character varying(100) NOT NULL, "repositoryName" character varying(100) NOT NULL, "onBeforeRepositoryCloneScript" text, "onAfterRepositoryCloneScript" text, "onAfterCommitScript" text, "onBeforeCommitScript" text, CONSTRAINT "PK_bde620517f9f70ae4e07f20794c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_41b81a046fcc36dba0499886dc" ON "CopilotCodeRepository" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_67f63dde71654d6a24478c751c" ON "CopilotCodeRepository" ("secretToken") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceCopilotCodeRepository" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "servicePathInRepository" character varying(500) NOT NULL DEFAULT '/', "limitNumberOfOpenPullRequestsCount" integer DEFAULT '3', "enablePullRequests" boolean NOT NULL DEFAULT true, "createdByUserId" uuid, "deletedByUserId" uuid, "codeRepositoryId" uuid NOT NULL, "serviceCatalogId" uuid NOT NULL, CONSTRAINT "PK_eceb5a2622fe145734960046b9f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_edf3b9544194d006658a184c6d" ON "ServiceCopilotCodeRepository" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_155453e2244e5f74243b8eaeaa" ON "ServiceCopilotCodeRepository" ("codeRepositoryId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cfe46a4b97d4e33a368c03f8f3" ON "ServiceCopilotCodeRepository" ("serviceCatalogId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CopilotCodeRepositoryLabel" ("CopilotCodeRepositoryId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_750b6ac49ba58e6b6ad7d6043e5" PRIMARY KEY ("CopilotCodeRepositoryId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_71c1427b8dfc31dbec3d65f70d" ON "CopilotCodeRepositoryLabel" ("CopilotCodeRepositoryId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d3bb0fc11b6e3b7fd3ca0464c1" ON "CopilotCodeRepositoryLabel" ("labelId") `,
    );

    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" ADD CONSTRAINT "FK_41b81a046fcc36dba0499886dc8" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" ADD CONSTRAINT "FK_ab1b484839c4c9ed25150d248ff" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" ADD CONSTRAINT "FK_681f7e53081da05fd0aefcad93f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" ADD CONSTRAINT "FK_edf3b9544194d006658a184c6d9" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" ADD CONSTRAINT "FK_c2629643d12e4b8739b8e257310" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" ADD CONSTRAINT "FK_dc1390d4eb1d065de0c760c964a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" ADD CONSTRAINT "FK_155453e2244e5f74243b8eaeaae" FOREIGN KEY ("codeRepositoryId") REFERENCES "CopilotCodeRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" ADD CONSTRAINT "FK_cfe46a4b97d4e33a368c03f8f36" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ADD CONSTRAINT "FK_d1f62129e09784b750ef9143bfe" FOREIGN KEY ("codeRepositoryId") REFERENCES "CopilotCodeRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ADD CONSTRAINT "FK_786400c4dce05f85bbbd5244249" FOREIGN KEY ("serviceRepositoryId") REFERENCES "ServiceCopilotCodeRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepositoryLabel" ADD CONSTRAINT "FK_71c1427b8dfc31dbec3d65f70d5" FOREIGN KEY ("CopilotCodeRepositoryId") REFERENCES "CopilotCodeRepository"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepositoryLabel" ADD CONSTRAINT "FK_d3bb0fc11b6e3b7fd3ca0464c15" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepositoryLabel" DROP CONSTRAINT "FK_d3bb0fc11b6e3b7fd3ca0464c15"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepositoryLabel" DROP CONSTRAINT "FK_71c1427b8dfc31dbec3d65f70d5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" DROP CONSTRAINT "FK_786400c4dce05f85bbbd5244249"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" DROP CONSTRAINT "FK_d1f62129e09784b750ef9143bfe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" DROP CONSTRAINT "FK_cfe46a4b97d4e33a368c03f8f36"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" DROP CONSTRAINT "FK_155453e2244e5f74243b8eaeaae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" DROP CONSTRAINT "FK_dc1390d4eb1d065de0c760c964a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" DROP CONSTRAINT "FK_c2629643d12e4b8739b8e257310"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" DROP CONSTRAINT "FK_edf3b9544194d006658a184c6d9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" DROP CONSTRAINT "FK_681f7e53081da05fd0aefcad93f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" DROP CONSTRAINT "FK_ab1b484839c4c9ed25150d248ff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" DROP CONSTRAINT "FK_41b81a046fcc36dba0499886dc8"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_d3bb0fc11b6e3b7fd3ca0464c1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_71c1427b8dfc31dbec3d65f70d"`,
    );
    await queryRunner.query(`DROP TABLE "CopilotCodeRepositoryLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cfe46a4b97d4e33a368c03f8f3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_155453e2244e5f74243b8eaeaa"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_edf3b9544194d006658a184c6d"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceCopilotCodeRepository"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_67f63dde71654d6a24478c751c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_41b81a046fcc36dba0499886dc"`,
    );
    await queryRunner.query(`DROP TABLE "CopilotCodeRepository"`);
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ADD CONSTRAINT "FK_786400c4dce05f85bbbd5244249" FOREIGN KEY ("serviceRepositoryId") REFERENCES "ServiceRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ADD CONSTRAINT "FK_d1f62129e09784b750ef9143bfe" FOREIGN KEY ("codeRepositoryId") REFERENCES "CodeRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
