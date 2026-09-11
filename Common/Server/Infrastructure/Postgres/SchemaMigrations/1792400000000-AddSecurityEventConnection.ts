import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSecurityEventConnection1792400000000
  implements MigrationInterface
{
  public name: string = "AddSecurityEventConnection1792400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityEventConnection" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "provider" character varying(100) NOT NULL, "configuration" jsonb NOT NULL, "credentialJson" text NOT NULL, "sourceFingerprint" character varying(100) NOT NULL, "sourceGeneration" integer NOT NULL DEFAULT '1', "isEnabled" boolean NOT NULL DEFAULT true, "pollIntervalInMinutes" integer NOT NULL DEFAULT '5', "lastSuccessfulPollAt" TIMESTAMP WITH TIME ZONE, "lastEventIngestedAt" TIMESTAMP WITH TIME ZONE, "lastPollResult" jsonb, "lastPolledAt" TIMESTAMP WITH TIME ZONE, "cursor" text, "lastError" text, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_0f0e1fe86bb4ce002fb97c6761f" PRIMARY KEY ("_id"))`,
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
      `ALTER TABLE "SecurityEventConnection" ADD CONSTRAINT "FK_15f2e2db3f5815c70153c91f738" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnection" ADD CONSTRAINT "FK_a1c9e6213897547fbbfcc557180" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnection" ADD CONSTRAINT "FK_760637b50c4a45db4c77f50597b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
