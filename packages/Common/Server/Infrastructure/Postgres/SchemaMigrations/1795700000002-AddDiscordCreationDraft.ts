import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDiscordCreationDraft1795700000002
  implements MigrationInterface
{
  public name: string = "AddDiscordCreationDraft1795700000002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DiscordCreationDraft" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "scopeKey" character varying(128) NOT NULL, "bindingFingerprint" character varying(128) NOT NULL, "status" character varying(128) NOT NULL, "revision" integer NOT NULL, "reviewedRevision" integer, "claimId" uuid, "content" jsonb, "outcome" jsonb, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_59a7aa4eed526165672023bae85" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1889c243bcdc87dea0957baa6c" ON "DiscordCreationDraft" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0a039362e5eccd3b290fbe9673" ON "DiscordCreationDraft" ("expiresAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0a039362e5eccd3b290fbe9673"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1889c243bcdc87dea0957baa6c"`,
    );
    await queryRunner.query(`DROP TABLE "DiscordCreationDraft"`);
  }
}
