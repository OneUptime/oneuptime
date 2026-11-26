import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDataSecurityIssuePullRequest1809187660831
  implements MigrationInterface
{
  public name: string = "AddDataSecurityIssuePullRequest1809187660831";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataSecurityIssuePullRequest" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "dataSecurityIssueId" uuid NOT NULL, "pullRequestUrl" text NOT NULL, "codeRepositoryId" uuid, "pullRequestNumber" integer, "repoOrganizationName" text, "repoName" character varying(100), "pullRequestState" character varying(100), "mergeCommitSha" character varying(100), "mergedAt" TIMESTAMP WITH TIME ZONE, "followedAt" TIMESTAMP WITH TIME ZONE, "productionCheck" character varying(100), "productionStatus" character varying(100), "productionStatusAt" TIMESTAMP WITH TIME ZONE, "productionSummary" character varying(500), "productionBaseline" jsonb, "deployedAt" TIMESTAMP WITH TIME ZONE, "deployedVersion" character varying(100), "deployedCommitSha" character varying(100), "createdByUserId" uuid, CONSTRAINT "PK_97a158d017375007098b1a1a103" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_be169f7c1a245d41c476b53c48" ON "DataSecurityIssuePullRequest" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_08c74ffb60882b70370e62c8b9" ON "DataSecurityIssuePullRequest" ("dataSecurityIssueId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ffd87873fe8c91ad9dfdd63244" ON "DataSecurityIssuePullRequest" ("codeRepositoryId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_624c05a3a18d5b7b9f9c79c5b6" ON "DataSecurityIssuePullRequest" ("pullRequestState") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_18b5233cd89cd6415f8372d49f" ON "DataSecurityIssuePullRequest" ("followedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e48a1afee2ad2a97aa84ce9c41" ON "DataSecurityIssuePullRequest" ("productionStatus") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_98d918bfe5cc6bcbc832d6297f" ON "DataSecurityIssuePullRequest" ("dataSecurityIssueId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssuePullRequest" ADD CONSTRAINT "FK_be169f7c1a245d41c476b53c486" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssuePullRequest" ADD CONSTRAINT "FK_08c74ffb60882b70370e62c8b9f" FOREIGN KEY ("dataSecurityIssueId") REFERENCES "DataSecurityIssue"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssuePullRequest" ADD CONSTRAINT "FK_ffd87873fe8c91ad9dfdd63244e" FOREIGN KEY ("codeRepositoryId") REFERENCES "CodeRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssuePullRequest" ADD CONSTRAINT "FK_e57a01b2accfe92e586c03bf402" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssuePullRequest" DROP CONSTRAINT "FK_e57a01b2accfe92e586c03bf402"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssuePullRequest" DROP CONSTRAINT "FK_ffd87873fe8c91ad9dfdd63244e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssuePullRequest" DROP CONSTRAINT "FK_08c74ffb60882b70370e62c8b9f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssuePullRequest" DROP CONSTRAINT "FK_be169f7c1a245d41c476b53c486"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_98d918bfe5cc6bcbc832d6297f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e48a1afee2ad2a97aa84ce9c41"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_18b5233cd89cd6415f8372d49f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_624c05a3a18d5b7b9f9c79c5b6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ffd87873fe8c91ad9dfdd63244"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_08c74ffb60882b70370e62c8b9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_be169f7c1a245d41c476b53c48"`,
    );
    await queryRunner.query(`DROP TABLE "DataSecurityIssuePullRequest"`);
  }
}
