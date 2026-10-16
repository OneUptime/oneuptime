import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddCustomRoles1803100000000, and moved into a migration of its own: the indexes
 * and foreign keys of "TeamPermission"'s custom role columns are built on a
 * table every project already has rows in, so they go through OnlineDdl -
 * each index built CONCURRENTLY, each foreign key added NOT VALID and then
 * validated - without blocking the writes that give and take away
 * permissions. Every existing row names no role, so the validations find
 * nothing to refuse. Safe to run again after a stop part way.
 */
export class AddTeamPermissionCustomRoleLinks1803150000000
  implements MigrationInterface
{
  public name: string = "AddTeamPermissionCustomRoleLinks1803150000000";

  // OnlineDdl builds indexes and validates foreign keys outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_ef8b86ef10f4988f1b25822548" ON "TeamPermission" ("customRoleId")`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_c3f26927121f681aa7550f33be" ON "TeamPermission" ("teamCustomRoleId")`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_c55ae5140827542331f23d277b" ON "TeamPermission" ("customRolePermissionId")`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "TeamPermission" ADD CONSTRAINT "FK_ef8b86ef10f4988f1b258225486" FOREIGN KEY ("customRoleId") REFERENCES "CustomRole"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "TeamPermission" ADD CONSTRAINT "FK_c3f26927121f681aa7550f33bee" FOREIGN KEY ("teamCustomRoleId") REFERENCES "TeamCustomRole"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "TeamPermission" ADD CONSTRAINT "FK_c55ae5140827542331f23d277bb" FOREIGN KEY ("customRolePermissionId") REFERENCES "CustomRolePermission"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" DROP CONSTRAINT "FK_c55ae5140827542331f23d277bb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" DROP CONSTRAINT "FK_c3f26927121f681aa7550f33bee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" DROP CONSTRAINT "FK_ef8b86ef10f4988f1b258225486"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_c55ae5140827542331f23d277b"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_c3f26927121f681aa7550f33be"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_ef8b86ef10f4988f1b25822548"`,
    );
  }
}
