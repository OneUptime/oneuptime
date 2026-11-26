import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddDataSecurityIssueGroups1809187470370, and moved into a migration of
 * its own: every evaluation writes "DataSecurityIssue", and the inbox and
 * every issue's page read "DataSecurityAiProposal". So each index on the
 * new "dataSecurityIssueGroupId" columns is built online, and each key is
 * added NOT VALID and then validated, without blocking those reads and
 * writes meanwhile. Every existing row's column is null, so the validation
 * finds nothing to refuse. Index and key names are TypeORM's own, so the
 * schema drift check finds nothing to change.
 *
 * An issue keeps its record when its group goes (ON DELETE SET NULL): the
 * group is a way to fix the cause once, not part of the issue. A proposal
 * that fixes a group's cause goes with the group (ON DELETE CASCADE): it is
 * about nothing else. The indexes keep those deletes, and the Issues list's
 * reads by group, from reading every row.
 *
 * Safe to run again after a stop part way: an index or key that is already
 * there is left as it is.
 */
export class AddDataSecurityIssueGroupIndexesAndKeys1809187470380
  implements MigrationInterface
{
  public name: string = "AddDataSecurityIssueGroupIndexesAndKeys1809187470380";

  // CREATE INDEX CONCURRENTLY and the validations run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_7210f70c3714bc18e7956b2604" ON "DataSecurityIssue" ("dataSecurityIssueGroupId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_78d5020693791737a37431ebaf" ON "DataSecurityAiProposal" ("dataSecurityIssueGroupId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "DataSecurityIssue" ADD CONSTRAINT "FK_7210f70c3714bc18e7956b26047" FOREIGN KEY ("dataSecurityIssueGroupId") REFERENCES "DataSecurityIssueGroup"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "DataSecurityAiProposal" ADD CONSTRAINT "FK_78d5020693791737a37431ebafe" FOREIGN KEY ("dataSecurityIssueGroupId") REFERENCES "DataSecurityIssueGroup"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" DROP CONSTRAINT "FK_78d5020693791737a37431ebafe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP CONSTRAINT "FK_7210f70c3714bc18e7956b26047"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_78d5020693791737a37431ebaf"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_7210f70c3714bc18e7956b2604"`,
    );
  }
}
