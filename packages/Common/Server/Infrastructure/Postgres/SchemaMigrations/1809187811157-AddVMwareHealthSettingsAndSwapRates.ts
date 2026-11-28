import { MigrationInterface, QueryRunner } from "typeorm";

export class AddVMwareHealthSettingsAndSwapRates1809187811157
  implements MigrationInterface
{
  public name = "AddVMwareHealthSettingsAndSwapRates1809187811157";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "VMwareHealthSetting" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "hostCpuWarningPercent" integer DEFAULT '90', "hostMemoryWarningPercent" integer DEFAULT '90', "datastoreWarningPercent" integer DEFAULT '80', "datastoreCriticalPercent" integer DEFAULT '90', "vmSwapOutCriticalKibPerSecond" integer DEFAULT '0', "vmSwapInWarningKibPerSecond" integer DEFAULT '1024', "vmSwappedWarningMebibytes" integer DEFAULT '1024', "vmBalloonedWarningMebibytes" integer DEFAULT '0', "vmCpuReadyWarningPercent" integer DEFAULT '10', "resourcePoolSwapOutWarningKibPerSecond" integer DEFAULT '0', CONSTRAINT "PK_460de3d446db86a2e5088c81d84" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e54993173c7582f00faf308057" ON "VMwareHealthSetting" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" ADD "memorySwapOutBytesPerSecond" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" ADD "memorySwapInBytesPerSecond" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareHealthSetting" ADD CONSTRAINT "FK_e54993173c7582f00faf308057b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "VMwareHealthSetting" DROP CONSTRAINT "FK_e54993173c7582f00faf308057b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" DROP COLUMN "memorySwapInBytesPerSecond"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" DROP COLUMN "memorySwapOutBytesPerSecond"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e54993173c7582f00faf308057"`,
    );
    await queryRunner.query(`DROP TABLE "VMwareHealthSetting"`);
  }
}
