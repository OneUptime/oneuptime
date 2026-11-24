import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The Code task whose pull request fixes a Data Security issue in code
 * (#10367): "DataSecurityIssue"."codeFixTaskId", Fix with AI's or the one
 * pull request that stops a service writing all of its telemetry leaks,
 * which every issue it fixes keeps - and #10368 follows to production. A
 * nullable column of its own, with no default, so adding it rewrites no
 * row; its index is built online in the migration after this one.
 */
export class AddDataSecurityIssueCodeFixTask1809187530367
  implements MigrationInterface
{
  public name: string = "AddDataSecurityIssueCodeFixTask1809187530367";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD "codeFixTaskId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP COLUMN "codeFixTaskId"`,
    );
  }
}
