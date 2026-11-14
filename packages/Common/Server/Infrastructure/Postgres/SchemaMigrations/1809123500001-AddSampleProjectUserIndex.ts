import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated for the models (TypeORM's migration:generate statements), and
 * numbered after AddSampleProject, which adds the column (issue #6808).
 *
 * User.sampleProjectId's index and its foreign key to Project, ON DELETE
 * CASCADE: the database deletes a sample's made-up people with it, whatever
 * deletes the sample. The index also keeps every project's delete from
 * scanning "User" for people to cascade to.
 *
 * Both on "User", a table every sign-in writes, so both are built online
 * (Docs/migrations/README.md): the index CONCURRENTLY, the key NOT VALID
 * and validated after, neither blocking a read or a write. Names and
 * definitions are the generated ones, so the drift check still matches.
 */
export class AddSampleProjectUserIndex1809123500001
  implements MigrationInterface
{
  public name: string = "AddSampleProjectUserIndex1809123500001";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_25e3ed56d0b14e81457332f204" ON "User" ("sampleProjectId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "User" ADD CONSTRAINT "FK_25e3ed56d0b14e81457332f2048" FOREIGN KEY ("sampleProjectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "FK_25e3ed56d0b14e81457332f2048"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_25e3ed56d0b14e81457332f204"`,
    );
  }
}
