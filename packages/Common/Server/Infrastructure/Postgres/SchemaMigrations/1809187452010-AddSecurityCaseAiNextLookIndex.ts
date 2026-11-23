import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddSecurityCaseAiResponse1809187452000, and moved into a migration of its
 * own: "SecurityCase" already exists, so the index the every-minute look of
 * OneUptime AI reads ("aiNextLookAt") is built online, without blocking the
 * table's writes. Safe to run again after a stop part way: an index that is
 * already there is left as it is.
 */
export class AddSecurityCaseAiNextLookIndex1809187452010
  implements MigrationInterface
{
  public name: string = "AddSecurityCaseAiNextLookIndex1809187452010";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_0e7427cb333706b824c7948a29" ON "SecurityCase" ("aiNextLookAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_0e7427cb333706b824c7948a29"`,
    );
  }
}
