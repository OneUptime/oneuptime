import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Security Events' erasure requests (#10908): erasing one person from the
 * user vault (Models/DatabaseModels/SecurityUserErasureRequest). A new
 * table, exactly as `npm run generate-postgres-migration` wrote it: it is
 * empty, so its indexes and keys need nothing of OnlineDdl.
 */
export class AddSecurityUserErasureRequest1809187580908
  implements MigrationInterface
{
  public name: string = "AddSecurityUserErasureRequest1809187580908";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityUserErasureRequest" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "userToErase" text, "tokens" jsonb NOT NULL, "reference" character varying(100), "status" character varying(100) NOT NULL DEFAULT 'Pending', "requestedByUserId" uuid, "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "completedAt" TIMESTAMP WITH TIME ZONE, "attempts" integer NOT NULL DEFAULT '0', "failureReason" character varying(500), "vaultEntriesDeleted" integer NOT NULL DEFAULT '0', "eventsUnnamed" integer NOT NULL DEFAULT '0', "casesUnnamed" integer NOT NULL DEFAULT '0', "proposalsWithdrawn" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, CONSTRAINT "PK_c78ca3d676f9634a12e540d5211" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_88551e4286492ab169737af89a" ON "SecurityUserErasureRequest" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_448294b4c2c1173c4d8f4ed1b4" ON "SecurityUserErasureRequest" ("projectId", "requestedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8a672442fcdde9f0f48a2da335" ON "SecurityUserErasureRequest" ("status", "requestedAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityUserErasureRequest" ADD CONSTRAINT "FK_88551e4286492ab169737af89a9" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityUserErasureRequest" ADD CONSTRAINT "FK_bef18e1519065cf5f8a561e20d2" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityUserErasureRequest" DROP CONSTRAINT "FK_bef18e1519065cf5f8a561e20d2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityUserErasureRequest" DROP CONSTRAINT "FK_88551e4286492ab169737af89a9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8a672442fcdde9f0f48a2da335"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_448294b4c2c1173c4d8f4ed1b4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_88551e4286492ab169737af89a"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityUserErasureRequest"`);
  }
}
