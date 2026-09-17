import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSecurityEventConnections1792700000000
  implements MigrationInterface
{
  public name: string = "AddSecurityEventConnections1792700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityEventConnection" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "provider" character varying(100) NOT NULL, "config" jsonb, "secrets" text NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "pollIntervalInMinutes" integer NOT NULL DEFAULT '5', "alertingOnly" boolean NOT NULL DEFAULT true, "lastSuccessfulPollAt" TIMESTAMP WITH TIME ZONE, "lastEventIngestedAt" TIMESTAMP WITH TIME ZONE, "lastPollResult" jsonb, "lastPolledAt" TIMESTAMP WITH TIME ZONE, "cursor" character varying(500), "lastError" text, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_0f0e1fe86bb4ce002fb97c6761f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_15f2e2db3f5815c70153c91f73" ON "SecurityEventConnection" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6d59362e6f5d25392ebf5929fa" ON "SecurityEventConnection" ("provider") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7a7edb50ab8639c78b7eafe75d" ON "SecurityEventConnection" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityEventConnectionRun" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "securityEventConnectionId" uuid NOT NULL, "requestedByUserId" uuid, "type" character varying(100) NOT NULL, "status" character varying(100) NOT NULL, "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "request" jsonb, "result" jsonb, "error" text, CONSTRAINT "PK_301dc1b8ac49703ea45746d5fcf" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b2f765ef1b178c3570d34805bb" ON "SecurityEventConnectionRun" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_42c40181bd64962779ed8ae537" ON "SecurityEventConnectionRun" ("securityEventConnectionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_137b78490b6f7b138e9aee63f2" ON "SecurityEventConnectionRun" ("requestedByUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceb2cebdcc946927dd10419bc9" ON "SecurityEventConnectionRun" ("projectId", "securityEventConnectionId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnection" ADD CONSTRAINT "FK_15f2e2db3f5815c70153c91f738" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnection" ADD CONSTRAINT "FK_a1c9e6213897547fbbfcc557180" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnection" ADD CONSTRAINT "FK_760637b50c4a45db4c77f50597b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnectionRun" ADD CONSTRAINT "FK_b2f765ef1b178c3570d34805bbe" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnectionRun" ADD CONSTRAINT "FK_42c40181bd64962779ed8ae5370" FOREIGN KEY ("securityEventConnectionId") REFERENCES "SecurityEventConnection"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnectionRun" ADD CONSTRAINT "FK_137b78490b6f7b138e9aee63f20" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnectionRun" DROP CONSTRAINT "FK_137b78490b6f7b138e9aee63f20"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnectionRun" DROP CONSTRAINT "FK_42c40181bd64962779ed8ae5370"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnectionRun" DROP CONSTRAINT "FK_b2f765ef1b178c3570d34805bbe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnection" DROP CONSTRAINT "FK_760637b50c4a45db4c77f50597b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnection" DROP CONSTRAINT "FK_a1c9e6213897547fbbfcc557180"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnection" DROP CONSTRAINT "FK_15f2e2db3f5815c70153c91f738"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceb2cebdcc946927dd10419bc9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_137b78490b6f7b138e9aee63f2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_42c40181bd64962779ed8ae537"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b2f765ef1b178c3570d34805bb"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityEventConnectionRun"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7a7edb50ab8639c78b7eafe75d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6d59362e6f5d25392ebf5929fa"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_15f2e2db3f5815c70153c91f73"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityEventConnection"`);
  }
}
