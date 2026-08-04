import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * RunbookCredential — the access an SSH or Kubernetes step uses.
 *
 * Shaped after RunbookSecret, including its RunbookAgent join table: a
 * credential is usable only by the Runners it is explicitly assigned to.
 * Constraint names are spelled out rather than hash-generated so this reads
 * as what it is; TypeORM only requires them to be unique.
 */
export class AddRunbookCredential1785800000000 implements MigrationInterface {
  public name = "AddRunbookCredential1785800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "RunbookCredential" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "credentialType" character varying NOT NULL, "sshHostname" character varying(100), "sshPort" integer, "sshUsername" character varying(100), "sshPrivateKey" text, "sshPassphrase" text, "sshPassword" text, "kubernetesApiServerUrl" character varying(500), "kubernetesServiceAccountToken" text, "kubernetesCaCertificate" text, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_RunbookCredential" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RunbookCredential_projectId" ON "RunbookCredential" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookCredentialRunbookAgent" ("runbookCredentialId" uuid NOT NULL, "runbookAgentId" uuid NOT NULL, CONSTRAINT "PK_RunbookCredentialRunbookAgent" PRIMARY KEY ("runbookCredentialId", "runbookAgentId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RunbookCredentialRunbookAgent_credentialId" ON "RunbookCredentialRunbookAgent" ("runbookCredentialId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RunbookCredentialRunbookAgent_agentId" ON "RunbookCredentialRunbookAgent" ("runbookAgentId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" ADD CONSTRAINT "FK_RunbookCredential_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" ADD CONSTRAINT "FK_RunbookCredential_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" ADD CONSTRAINT "FK_RunbookCredential_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredentialRunbookAgent" ADD CONSTRAINT "FK_RunbookCredentialRunbookAgent_credentialId" FOREIGN KEY ("runbookCredentialId") REFERENCES "RunbookCredential"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredentialRunbookAgent" ADD CONSTRAINT "FK_RunbookCredentialRunbookAgent_agentId" FOREIGN KEY ("runbookAgentId") REFERENCES "RunbookAgent"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    /*
     * Structured instructions for step types that are not a script. Nullable
     * because every existing job is a script and has none.
     */
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" ADD "payload" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" DROP COLUMN "payload"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredentialRunbookAgent" DROP CONSTRAINT "FK_RunbookCredentialRunbookAgent_agentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredentialRunbookAgent" DROP CONSTRAINT "FK_RunbookCredentialRunbookAgent_credentialId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" DROP CONSTRAINT "FK_RunbookCredential_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" DROP CONSTRAINT "FK_RunbookCredential_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" DROP CONSTRAINT "FK_RunbookCredential_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_RunbookCredentialRunbookAgent_agentId"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_RunbookCredentialRunbookAgent_credentialId"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookCredentialRunbookAgent"`);
    await queryRunner.query(`DROP INDEX "IDX_RunbookCredential_projectId"`);
    await queryRunner.query(`DROP TABLE "RunbookCredential"`);
  }
}
