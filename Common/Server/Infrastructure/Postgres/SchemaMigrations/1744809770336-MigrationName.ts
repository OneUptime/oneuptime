import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1744809770336 implements MigrationInterface {
  public name = "MigrationName1744809770336";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_5e3c9794d226535f20b03bd2854" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cbfdf265361e75736dc2220fe7" ON "OnCallDutyPolicyOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bc8fc87c56e5fcbc191274bf6a" ON "OnCallDutyPolicyOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5517a8f733ab84dbccf2365db1" ON "OnCallDutyPolicyOwnerTeam" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2288828246c2a6151768f152a0" ON "OnCallDutyPolicyOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_bd784c472219847bbf9e9b6173c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f1403509cc87e41a15a68798d8" ON "OnCallDutyPolicyOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_710bd5d20bc0dc33448fb321d7" ON "OnCallDutyPolicyOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e0c45b9ba88d7f61cf3dbb527e" ON "OnCallDutyPolicyOwnerUser" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d9f6f32ce626cc4184b349f049" ON "OnCallDutyPolicyOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "onCallDutyPolicyFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_c0588104fd2df2d10527832c802" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ff7561fb2f3ce39b1e77e65bc5" ON "OnCallDutyPolicyFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cb7f7b652d475b3f278cce41ac" ON "OnCallDutyPolicyFeed" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerTeam" ADD CONSTRAINT "FK_cbfdf265361e75736dc2220fe7d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerTeam" ADD CONSTRAINT "FK_bc8fc87c56e5fcbc191274bf6aa" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerTeam" ADD CONSTRAINT "FK_5517a8f733ab84dbccf2365db1c" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerTeam" ADD CONSTRAINT "FK_6dce1c2951ff6e979d2af68a4c9" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerTeam" ADD CONSTRAINT "FK_4779fb1eee2979cb5f43b3d0596" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerUser" ADD CONSTRAINT "FK_f1403509cc87e41a15a68798d83" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerUser" ADD CONSTRAINT "FK_710bd5d20bc0dc33448fb321d71" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerUser" ADD CONSTRAINT "FK_e0c45b9ba88d7f61cf3dbb527ed" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerUser" ADD CONSTRAINT "FK_6525fe960624274ae771860c088" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerUser" ADD CONSTRAINT "FK_18918751784b7f55ad605f2310b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyFeed" ADD CONSTRAINT "FK_ff7561fb2f3ce39b1e77e65bc52" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyFeed" ADD CONSTRAINT "FK_cb7f7b652d475b3f278cce41acb" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyFeed" ADD CONSTRAINT "FK_d737aa24ece081e02eaaf743ab7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyFeed" ADD CONSTRAINT "FK_daaf8acf8317e6f8b7beb07b520" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyFeed" ADD CONSTRAINT "FK_3f6e3942931ca67e6fdc8c77cba" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyFeed" DROP CONSTRAINT "FK_3f6e3942931ca67e6fdc8c77cba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyFeed" DROP CONSTRAINT "FK_daaf8acf8317e6f8b7beb07b520"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyFeed" DROP CONSTRAINT "FK_d737aa24ece081e02eaaf743ab7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyFeed" DROP CONSTRAINT "FK_cb7f7b652d475b3f278cce41acb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyFeed" DROP CONSTRAINT "FK_ff7561fb2f3ce39b1e77e65bc52"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerUser" DROP CONSTRAINT "FK_18918751784b7f55ad605f2310b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerUser" DROP CONSTRAINT "FK_6525fe960624274ae771860c088"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerUser" DROP CONSTRAINT "FK_e0c45b9ba88d7f61cf3dbb527ed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerUser" DROP CONSTRAINT "FK_710bd5d20bc0dc33448fb321d71"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerUser" DROP CONSTRAINT "FK_f1403509cc87e41a15a68798d83"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerTeam" DROP CONSTRAINT "FK_4779fb1eee2979cb5f43b3d0596"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerTeam" DROP CONSTRAINT "FK_6dce1c2951ff6e979d2af68a4c9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerTeam" DROP CONSTRAINT "FK_5517a8f733ab84dbccf2365db1c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerTeam" DROP CONSTRAINT "FK_bc8fc87c56e5fcbc191274bf6aa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerTeam" DROP CONSTRAINT "FK_cbfdf265361e75736dc2220fe7d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cb7f7b652d475b3f278cce41ac"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ff7561fb2f3ce39b1e77e65bc5"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallDutyPolicyFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d9f6f32ce626cc4184b349f049"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e0c45b9ba88d7f61cf3dbb527e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_710bd5d20bc0dc33448fb321d7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f1403509cc87e41a15a68798d8"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallDutyPolicyOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2288828246c2a6151768f152a0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5517a8f733ab84dbccf2365db1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bc8fc87c56e5fcbc191274bf6a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cbfdf265361e75736dc2220fe7"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallDutyPolicyOwnerTeam"`);
  }
}
