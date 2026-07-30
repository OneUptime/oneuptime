import { MigrationInterface, QueryRunner } from "typeorm";

export class AddParentGroupToStatusPageGroup1785329453269
  implements MigrationInterface
{
  public name: string = "AddParentGroupToStatusPageGroup1785329453269";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" ADD "parentStatusPageGroupId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9cf6ff1530c361e890856e80d7" ON "StatusPageGroup" ("parentStatusPageGroupId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" ADD CONSTRAINT "FK_9cf6ff1530c361e890856e80d79" FOREIGN KEY ("parentStatusPageGroupId") REFERENCES "StatusPageGroup"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" DROP CONSTRAINT "FK_9cf6ff1530c361e890856e80d79"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9cf6ff1530c361e890856e80d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" DROP COLUMN "parentStatusPageGroupId"`,
    );
  }
}
