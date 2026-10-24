import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration.
 *
 * Code connects repositories beyond GitHub: GitLab, Forgejo and Gitea
 * servers with an access token, and any Git repository with a username and
 * a password or token.
 *
 *   - "CodeRepositoryConnection": how a project reaches such a server - its
 *     address, the account its token acts as, and the credentials,
 *     encrypted (Models/DatabaseModels/CodeRepositoryConnection);
 *   - "CodeRepository"."codeRepositoryConnectionId": the connection a
 *     repository is reached with. Every existing repository is a GitHub
 *     one, reached through the GitHub App, so it starts null and every
 *     repository stays exactly as it is.
 *
 * The new table is empty, so its index and foreign keys are built here. The
 * column is nullable with no default, which Postgres adds without
 * rewriting or scanning "CodeRepository"; its index and foreign key are
 * built online in AddCodeRepositoryConnectionIndexAndKey1807010000000.
 */
export class AddCodeRepositoryConnections1807000000000
  implements MigrationInterface
{
  public name: string = "AddCodeRepositoryConnections1807000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CodeRepositoryConnection" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "provider" character varying(100) NOT NULL, "hostUrl" character varying(500) NOT NULL, "hostProduct" character varying(100), "accountLogin" character varying(100), "credentials" text, "credentialHint" character varying(100), "refusedAt" TIMESTAMP WITH TIME ZONE, "isReachableFromServer" boolean NOT NULL DEFAULT true, "createdByUserId" uuid, CONSTRAINT "PK_aa778888bc1233a56a5030501cb" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_873f200f0be451470cd1e93a15" ON "CodeRepositoryConnection" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepositoryConnection" ADD CONSTRAINT "FK_873f200f0be451470cd1e93a157" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepositoryConnection" ADD CONSTRAINT "FK_5b6e8f9e1e9d7ba135521a61982" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "codeRepositoryConnectionId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "codeRepositoryConnectionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepositoryConnection" DROP CONSTRAINT "FK_5b6e8f9e1e9d7ba135521a61982"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepositoryConnection" DROP CONSTRAINT "FK_873f200f0be451470cd1e93a157"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_873f200f0be451470cd1e93a15"`,
    );
    await queryRunner.query(`DROP TABLE "CodeRepositoryConnection"`);
  }
}
