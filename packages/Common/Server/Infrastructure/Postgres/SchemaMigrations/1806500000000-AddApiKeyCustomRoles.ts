import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration.
 *
 * Custom roles for API keys: a key is given a project's custom roles as a
 * team is.
 *
 *   - "ApiKeyCustomRole": the roles given to API keys, once per key;
 *   - "ApiKeyPermission"."customRoleId" / "apiKeyCustomRoleId" /
 *     "customRolePermissionId": a key's copy of a role's permission names
 *     the role, the role given to the key and the role's own row it copies
 *     (Server/Utils/CustomRole/CustomRoleSync). Every existing row is a
 *     permission given to a key directly, so the three start null and every
 *     key's permissions stay exactly as they are.
 *
 * The new table is empty, so its indexes and foreign keys are built here.
 * The three columns are nullable with no default, which Postgres adds
 * without rewriting or scanning "ApiKeyPermission"; their indexes and
 * foreign keys are built online in
 * AddApiKeyPermissionCustomRoleLinks1806510000000.
 */
export class AddApiKeyCustomRoles1806500000000 implements MigrationInterface {
  public name: string = "AddApiKeyCustomRoles1806500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ApiKeyCustomRole" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "apiKeyId" uuid NOT NULL, "customRoleId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_4d88e004e75c9303d401114bad3" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5b9170e8070b069b603d978d37" ON "ApiKeyCustomRole" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3b7a4758f708f63c79362e1ff7" ON "ApiKeyCustomRole" ("apiKeyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_557c76fc3fc05033f6ab0c5ad9" ON "ApiKeyCustomRole" ("customRoleId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9d798a2701c234facdff38eae5" ON "ApiKeyCustomRole" ("apiKeyId", "customRoleId", "projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" ADD "customRoleId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" ADD "apiKeyCustomRoleId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" ADD "customRolePermissionId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyCustomRole" ADD CONSTRAINT "FK_5b9170e8070b069b603d978d37c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyCustomRole" ADD CONSTRAINT "FK_3b7a4758f708f63c79362e1ff73" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyCustomRole" ADD CONSTRAINT "FK_557c76fc3fc05033f6ab0c5ad90" FOREIGN KEY ("customRoleId") REFERENCES "CustomRole"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyCustomRole" ADD CONSTRAINT "FK_77f30d9e6c034c578bfe2dbd3c3" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyCustomRole" ADD CONSTRAINT "FK_c349d6488a55807c4399b296037" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ApiKeyCustomRole" DROP CONSTRAINT "FK_c349d6488a55807c4399b296037"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyCustomRole" DROP CONSTRAINT "FK_77f30d9e6c034c578bfe2dbd3c3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyCustomRole" DROP CONSTRAINT "FK_557c76fc3fc05033f6ab0c5ad90"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyCustomRole" DROP CONSTRAINT "FK_3b7a4758f708f63c79362e1ff73"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyCustomRole" DROP CONSTRAINT "FK_5b9170e8070b069b603d978d37c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" DROP COLUMN "customRolePermissionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" DROP COLUMN "apiKeyCustomRoleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" DROP COLUMN "customRoleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9d798a2701c234facdff38eae5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_557c76fc3fc05033f6ab0c5ad9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3b7a4758f708f63c79362e1ff7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5b9170e8070b069b603d978d37"`,
    );
    await queryRunner.query(`DROP TABLE "ApiKeyCustomRole"`);
  }
}
