import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The AI context (OneUptime issue #5198): what a project's team writes for
 * OneUptime AI about its own systems - how they fit together, who owns
 * which symptom, where the logs are, the words the team uses.
 *
 *   - "Project"."aiContext": the project's own, read first by everything
 *     OneUptime AI does for the team;
 *   - "AutoRemediationRule"."aiContext": an AI rule's, read after the
 *     project's by the investigations and fixes the rule starts.
 *
 * Both are nullable text columns with no default: adding one rewrites no
 * row and takes no lock beyond the moment the column is added, and every
 * existing project and rule reads as having no AI context - exactly what
 * every run read before.
 *
 * Generated with `typeorm migration:generate` against a fully migrated
 * throwaway database; only the file/class name, this comment and the
 * formatting are hand-written.
 */
export class AddAiContext1807100000000 implements MigrationInterface {
  public name: string = "AddAiContext1807100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Project" ADD "aiContext" text`);
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "aiContext" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "aiContext"`,
    );
    await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "aiContext"`);
  }
}
