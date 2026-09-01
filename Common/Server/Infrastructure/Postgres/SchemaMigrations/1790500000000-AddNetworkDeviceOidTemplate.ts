import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNetworkDeviceOidTemplate1790500000000 implements MigrationInterface {
    name = 'AddNetworkDeviceOidTemplate1790500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "NetworkDeviceOidTemplate" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "oids" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_ec94e3734230b1ed5d6ae2a125d" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6bd61393f6b4438538eedbfad9" ON "NetworkDeviceOidTemplate" ("projectId") `);
        await queryRunner.query(`ALTER TABLE "NetworkDevice" ADD "oidTemplateId" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_3e408227ae81663555e1583ac8" ON "NetworkDevice" ("projectId", "oidTemplateId") `);
        await queryRunner.query(`ALTER TABLE "NetworkDeviceOidTemplate" ADD CONSTRAINT "FK_6bd61393f6b4438538eedbfad9c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "NetworkDeviceOidTemplate" ADD CONSTRAINT "FK_9d0cb53f1ee2e900434772c19a8" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "NetworkDeviceOidTemplate" ADD CONSTRAINT "FK_f74ffbb8d3cb49a27055c53697e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_c7891e3a7597717e1b7ed86581e" FOREIGN KEY ("oidTemplateId") REFERENCES "NetworkDeviceOidTemplate"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "NetworkDevice" DROP CONSTRAINT "FK_c7891e3a7597717e1b7ed86581e"`);
        await queryRunner.query(`ALTER TABLE "NetworkDeviceOidTemplate" DROP CONSTRAINT "FK_f74ffbb8d3cb49a27055c53697e"`);
        await queryRunner.query(`ALTER TABLE "NetworkDeviceOidTemplate" DROP CONSTRAINT "FK_9d0cb53f1ee2e900434772c19a8"`);
        await queryRunner.query(`ALTER TABLE "NetworkDeviceOidTemplate" DROP CONSTRAINT "FK_6bd61393f6b4438538eedbfad9c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3e408227ae81663555e1583ac8"`);
        await queryRunner.query(`ALTER TABLE "NetworkDevice" DROP COLUMN "oidTemplateId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6bd61393f6b4438538eedbfad9"`);
        await queryRunner.query(`DROP TABLE "NetworkDeviceOidTemplate"`);
    }

}
