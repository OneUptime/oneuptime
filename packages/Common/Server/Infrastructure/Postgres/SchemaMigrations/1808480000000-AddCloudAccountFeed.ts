import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 *   - "CloudAccountFeed": a cloud account's feed - its Cloud AI agent
 *     connecting or being reset, and who changed what OneUptime AI may do
 *     in the account (CloudAccountFeed). Append-only; its rows go with
 *     their account (ON DELETE CASCADE).
 *
 * The table is new and empty, so its indexes and foreign keys are built
 * here; no existing table changes.
 */
export class AddCloudAccountFeed1808480000000 implements MigrationInterface {
  public name: string = "AddCloudAccountFeed1808480000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CloudAccountFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "cloudAccountId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "cloudAccountFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_7225d296027db66e11e16c0681c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a657b7d19ee77f5102407356f" ON "CloudAccountFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a5cf6baf897801b9f421440040" ON "CloudAccountFeed" ("cloudAccountId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a262f9791ba189a9f0abc333d" ON "CloudAccountFeed" ("cloudAccountId", "postedAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccountFeed" ADD CONSTRAINT "FK_4a657b7d19ee77f5102407356f6" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccountFeed" ADD CONSTRAINT "FK_a5cf6baf897801b9f4214400403" FOREIGN KEY ("cloudAccountId") REFERENCES "CloudAccount"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccountFeed" ADD CONSTRAINT "FK_a5315df7ba1d36178d78cf8fd3e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccountFeed" ADD CONSTRAINT "FK_108cc3e22602e8d8675c039f38d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccountFeed" ADD CONSTRAINT "FK_5843a1bd734b45fb34c13f1d403" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudAccountFeed" DROP CONSTRAINT "FK_5843a1bd734b45fb34c13f1d403"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccountFeed" DROP CONSTRAINT "FK_108cc3e22602e8d8675c039f38d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccountFeed" DROP CONSTRAINT "FK_a5315df7ba1d36178d78cf8fd3e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccountFeed" DROP CONSTRAINT "FK_a5cf6baf897801b9f4214400403"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccountFeed" DROP CONSTRAINT "FK_4a657b7d19ee77f5102407356f6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a262f9791ba189a9f0abc333d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a5cf6baf897801b9f421440040"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a657b7d19ee77f5102407356f"`,
    );
    await queryRunner.query(`DROP TABLE "CloudAccountFeed"`);
  }
}
