import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data Security issues one mistake made (#10370): a group of issues of the
 * same check whose stores share what made them - the code that declares
 * them, the CloudFormation stack, a tag that names their module, the
 * identity that created them, a name pattern - so the cause is fixed once,
 * with one pull request or one approval ("DataSecurityIssueGroup").
 *
 * The new table, its unique key and its foreign keys, and the two columns
 * that name a group: an issue's ("DataSecurityIssue"), and the proposal that
 * fixes a group's cause ("DataSecurityAiProposal"). The columns are nullable
 * with no default, so no row is rewritten and every issue starts in no
 * group. Their indexes and foreign keys are built online, in
 * AddDataSecurityIssueGroupIndexesAndKeys1809187470380: every evaluation
 * writes issues, and the inbox reads proposals.
 */
export class AddDataSecurityIssueGroups1809187470370
  implements MigrationInterface
{
  public name: string = "AddDataSecurityIssueGroups1809187470370";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataSecurityIssueGroup" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "groupKey" character varying(500) NOT NULL, "checkId" character varying(100) NOT NULL, "cause" character varying(100) NOT NULL, "facts" jsonb, "name" character varying(500), "nameFactsHash" character varying(100), "nameLanguage" character varying(100), "namedAt" TIMESTAMP WITH TIME ZONE, "issueCount" integer NOT NULL DEFAULT '0', "openIssueCount" integer NOT NULL DEFAULT '0', "fixedAt" TIMESTAMP WITH TIME ZONE, "groupedAt" TIMESTAMP WITH TIME ZONE, "codeTaskId" uuid, "fixRequestedAt" TIMESTAMP WITH TIME ZONE, "fixRequestedByUserId" uuid, CONSTRAINT "PK_fedfcb6bdee14069c48556f0f89" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b41f11c7de0b1a354644986f43" ON "DataSecurityIssueGroup" ("projectId", "groupKey") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD "dataSecurityIssueGroupId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" ADD "dataSecurityIssueGroupId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssueGroup" ADD CONSTRAINT "FK_aa825cadb5a86e3addfe84f7cef" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssueGroup" ADD CONSTRAINT "FK_fa3e09a2df285253a9c5a11bedf" FOREIGN KEY ("fixRequestedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssueGroup" DROP CONSTRAINT "FK_fa3e09a2df285253a9c5a11bedf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssueGroup" DROP CONSTRAINT "FK_aa825cadb5a86e3addfe84f7cef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" DROP COLUMN "dataSecurityIssueGroupId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP COLUMN "dataSecurityIssueGroupId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b41f11c7de0b1a354644986f43"`,
    );
    await queryRunner.query(`DROP TABLE "DataSecurityIssueGroup"`);
  }
}
