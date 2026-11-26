import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Cost views, cost groups and custom line items (#11006): three new tables,
 * so each index and foreign key is built on a table that is still empty.
 */
export class AddCloudCostViewsGroupsAndLineItems1809187711006
  implements MigrationInterface
{
  public name: string = "AddCloudCostViewsGroupsAndLineItems1809187711006";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CloudCostView" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "grouping" character varying(100) NOT NULL DEFAULT 'Rules', "tagKey" character varying(100), "groupsMadeAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, CONSTRAINT "PK_913055e363da449b79ffc20661a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92ab44d85ebfecb3803eeb5d5c" ON "CloudCostView" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudCostGroup" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "cloudCostViewId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "rules" jsonb, "order" integer NOT NULL, "teamId" uuid, "isShared" boolean NOT NULL DEFAULT false, "sharedSplit" character varying(100) NOT NULL DEFAULT 'Proportional', "sharedPercentages" jsonb, "kubernetesClusterId" uuid, "automaticKey" character varying(100), "createdByUserId" uuid, CONSTRAINT "PK_57465201bd9bbe9b087534798dd" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2ddaeb061317d883027d64d668" ON "CloudCostGroup" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4997c60171c1555d40567ce84d" ON "CloudCostGroup" ("cloudCostViewId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fa6a99230a8256bbbe4c6d20ea" ON "CloudCostGroup" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fceb34b2eb68e6f98351e11265" ON "CloudCostGroup" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_69c9b9e70ebe86ae5ff7f323e3" ON "CloudCostGroup" ("cloudCostViewId", "order") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudCostLineItem" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "kind" character varying(100) NOT NULL DEFAULT 'Charge', "amount" numeric NOT NULL, "currency" character varying(100) NOT NULL DEFAULT 'USD', "recurrence" character varying(100) NOT NULL DEFAULT 'Monthly', "startDate" TIMESTAMP WITH TIME ZONE NOT NULL, "endDate" TIMESTAMP WITH TIME ZONE, "cloudAccountId" uuid, "cloudCostGroupId" uuid, "createdByUserId" uuid, CONSTRAINT "PK_7a6ff84da3b1f391dd688665fe0" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aeba3846a782f7abd765dded2b" ON "CloudCostLineItem" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a9a91491449e27ed3b40ec74b4" ON "CloudCostLineItem" ("cloudAccountId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7bc25dc6a54d02f830f509a312" ON "CloudCostLineItem" ("cloudCostGroupId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostView" ADD CONSTRAINT "FK_92ab44d85ebfecb3803eeb5d5c7" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostView" ADD CONSTRAINT "FK_b18cf811c23eea5f54a572fc3f6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostGroup" ADD CONSTRAINT "FK_2ddaeb061317d883027d64d668a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostGroup" ADD CONSTRAINT "FK_4997c60171c1555d40567ce84d7" FOREIGN KEY ("cloudCostViewId") REFERENCES "CloudCostView"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostGroup" ADD CONSTRAINT "FK_fa6a99230a8256bbbe4c6d20eae" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostGroup" ADD CONSTRAINT "FK_fceb34b2eb68e6f98351e112658" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostGroup" ADD CONSTRAINT "FK_147ac2f492f8ad08ef1a6626cae" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostLineItem" ADD CONSTRAINT "FK_aeba3846a782f7abd765dded2bb" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostLineItem" ADD CONSTRAINT "FK_a9a91491449e27ed3b40ec74b49" FOREIGN KEY ("cloudAccountId") REFERENCES "CloudAccount"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostLineItem" ADD CONSTRAINT "FK_7bc25dc6a54d02f830f509a3128" FOREIGN KEY ("cloudCostGroupId") REFERENCES "CloudCostGroup"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostLineItem" ADD CONSTRAINT "FK_13a8945677028685488fdcf3436" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudCostLineItem" DROP CONSTRAINT "FK_13a8945677028685488fdcf3436"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostLineItem" DROP CONSTRAINT "FK_7bc25dc6a54d02f830f509a3128"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostLineItem" DROP CONSTRAINT "FK_a9a91491449e27ed3b40ec74b49"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostLineItem" DROP CONSTRAINT "FK_aeba3846a782f7abd765dded2bb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostGroup" DROP CONSTRAINT "FK_147ac2f492f8ad08ef1a6626cae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostGroup" DROP CONSTRAINT "FK_fceb34b2eb68e6f98351e112658"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostGroup" DROP CONSTRAINT "FK_fa6a99230a8256bbbe4c6d20eae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostGroup" DROP CONSTRAINT "FK_4997c60171c1555d40567ce84d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostGroup" DROP CONSTRAINT "FK_2ddaeb061317d883027d64d668a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostView" DROP CONSTRAINT "FK_b18cf811c23eea5f54a572fc3f6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostView" DROP CONSTRAINT "FK_92ab44d85ebfecb3803eeb5d5c7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7bc25dc6a54d02f830f509a312"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a9a91491449e27ed3b40ec74b4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aeba3846a782f7abd765dded2b"`,
    );
    await queryRunner.query(`DROP TABLE "CloudCostLineItem"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_69c9b9e70ebe86ae5ff7f323e3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fceb34b2eb68e6f98351e11265"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fa6a99230a8256bbbe4c6d20ea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4997c60171c1555d40567ce84d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2ddaeb061317d883027d64d668"`,
    );
    await queryRunner.query(`DROP TABLE "CloudCostGroup"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_92ab44d85ebfecb3803eeb5d5c"`,
    );
    await queryRunner.query(`DROP TABLE "CloudCostView"`);
  }
}
