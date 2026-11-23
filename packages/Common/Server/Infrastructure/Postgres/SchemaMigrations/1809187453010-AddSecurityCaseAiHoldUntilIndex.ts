import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddSecurityCaseAiRespondsFirst1809187453000, and moved into a migration of
 * its own: "SecurityCase" already exists, so the index the every-minute
 * review of the cases OneUptime AI responds first to reads ("aiHoldUntil")
 * is built online, without blocking the table's writes. Safe to run again
 * after a stop part way: an index that is already there is left as it is.
 */
export class AddSecurityCaseAiHoldUntilIndex1809187453010
  implements MigrationInterface
{
  public name: string = "AddSecurityCaseAiHoldUntilIndex1809187453010";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_44563c58a2520ba11e7a4fb634" ON "SecurityCase" ("aiHoldUntil") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_44563c58a2520ba11e7a4fb634"`,
    );
  }
}
