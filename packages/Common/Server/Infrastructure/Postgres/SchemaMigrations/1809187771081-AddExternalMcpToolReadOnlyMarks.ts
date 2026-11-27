import { MigrationInterface, QueryRunner } from "typeorm";

export class AddExternalMcpToolReadOnlyMarks1809187771081
  implements MigrationInterface
{
  public name = "AddExternalMcpToolReadOnlyMarks1809187771081";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ExternalMcpToolReadOnlyMark" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "externalMcpServerId" uuid NOT NULL, "toolName" character varying(500) NOT NULL, "toolFingerprint" character varying(100) NOT NULL, "createdByUserId" uuid, CONSTRAINT "PK_f0642e51acd9840c38ba009bc03" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f9afe050d9212c6790c1450d7d" ON "ExternalMcpToolReadOnlyMark" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e14942e718a416c4b09bf81fb9" ON "ExternalMcpToolReadOnlyMark" ("externalMcpServerId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ExternalMcpToolReadOnlyMark" ADD CONSTRAINT "FK_f9afe050d9212c6790c1450d7d3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExternalMcpToolReadOnlyMark" ADD CONSTRAINT "FK_e14942e718a416c4b09bf81fb93" FOREIGN KEY ("externalMcpServerId") REFERENCES "ExternalMcpServer"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExternalMcpToolReadOnlyMark" ADD CONSTRAINT "FK_85fa44b59bdbb597fac77c91ba9" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ExternalMcpToolReadOnlyMark" DROP CONSTRAINT "FK_85fa44b59bdbb597fac77c91ba9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExternalMcpToolReadOnlyMark" DROP CONSTRAINT "FK_e14942e718a416c4b09bf81fb93"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExternalMcpToolReadOnlyMark" DROP CONSTRAINT "FK_f9afe050d9212c6790c1450d7d3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e14942e718a416c4b09bf81fb9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f9afe050d9212c6790c1450d7d"`,
    );
    await queryRunner.query(`DROP TABLE "ExternalMcpToolReadOnlyMark"`);
  }
}
