import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Project.isSampleProject and User.sampleProjectId stay until a later
 * release drops them (expand, then contract).
 *
 * The pods of the release before keep serving while a release's migrations
 * run and its own pods start, and they read both columns: every probe's
 * claim of its monitors filters on Project.isSampleProject, and every
 * insert into "User" and "Project" names both. RemoveSampleProject dropped
 * them in 15.0.0, and from that moment until the last of those pods was gone
 * no probe check ran and nobody could sign up. It deletes the samples only
 * now, and the models keep the columns, hidden and read or written by
 * nobody.
 *
 * Where 15.0.0's RemoveSampleProject already dropped them, they come back
 * here, as AddSampleProject and AddSampleProjectUserIndex made them: empty -
 * every project not a sample, nobody a sample person - so this release's
 * inserts, which name them, work. Where they never went, nothing changes:
 * each step is skipped when what it makes is there.
 *
 * Adding a nullable column, or one with a constant default, rewrites no
 * row. The index and the foreign key are built online (OnlineDdl), so the
 * migration runs outside a transaction; "User" is a table every sign-in
 * writes.
 */
export class KeepSampleProjectColumns1809183200000
  implements MigrationInterface
{
  public name: string = "KeepSampleProjectColumns1809183200000";

  // CREATE INDEX CONCURRENTLY and VALIDATE CONSTRAINT run outside one.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "isSampleProject" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sampleProjectId" uuid`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_25e3ed56d0b14e81457332f204" ON "User" ("sampleProjectId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "User" ADD CONSTRAINT "FK_25e3ed56d0b14e81457332f2048" FOREIGN KEY ("sampleProjectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  /*
   * Nothing to undo: where the columns were never dropped they were there
   * before this ran, and where they were, they are what the models expect.
   */
  public async down(_queryRunner: QueryRunner): Promise<void> {
    return;
  }
}
