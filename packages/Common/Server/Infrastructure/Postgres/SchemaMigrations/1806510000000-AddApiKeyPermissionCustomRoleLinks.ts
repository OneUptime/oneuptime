import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddApiKeyCustomRoles1806500000000, and moved into a migration of its own:
 * the indexes and foreign keys of "ApiKeyPermission"'s custom role columns
 * are built on a table every project with an API key already has rows in,
 * and that every API key request's permissions are read from, so they go
 * through OnlineDdl - each index built CONCURRENTLY, each foreign key added
 * NOT VALID and then validated - without blocking the writes that give and
 * take away a key's permissions. Every existing row names no role, so the
 * validations find nothing to refuse. Safe to run again after a stop part
 * way.
 */
export class AddApiKeyPermissionCustomRoleLinks1806510000000
  implements MigrationInterface
{
  public name: string = "AddApiKeyPermissionCustomRoleLinks1806510000000";

  // OnlineDdl builds indexes and validates foreign keys outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_bfe203ba2874316c532e4400a1" ON "ApiKeyPermission" ("customRoleId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_23cbd9c905ab955ff1669bc26d" ON "ApiKeyPermission" ("apiKeyCustomRoleId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_b0fc4a61a5ec50d2456e168d24" ON "ApiKeyPermission" ("customRolePermissionId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "ApiKeyPermission" ADD CONSTRAINT "FK_bfe203ba2874316c532e4400a1d" FOREIGN KEY ("customRoleId") REFERENCES "CustomRole"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "ApiKeyPermission" ADD CONSTRAINT "FK_23cbd9c905ab955ff1669bc26d4" FOREIGN KEY ("apiKeyCustomRoleId") REFERENCES "ApiKeyCustomRole"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "ApiKeyPermission" ADD CONSTRAINT "FK_b0fc4a61a5ec50d2456e168d246" FOREIGN KEY ("customRolePermissionId") REFERENCES "CustomRolePermission"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" DROP CONSTRAINT "FK_b0fc4a61a5ec50d2456e168d246"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" DROP CONSTRAINT "FK_23cbd9c905ab955ff1669bc26d4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" DROP CONSTRAINT "FK_bfe203ba2874316c532e4400a1d"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_b0fc4a61a5ec50d2456e168d24"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_23cbd9c905ab955ff1669bc26d"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_bfe203ba2874316c532e4400a1"`,
    );
  }
}
