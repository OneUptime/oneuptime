import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1759175457008 implements MigrationInterface {
    public name = 'MigrationName1759175457008'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "UserWebAuthn" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "name" character varying(100) NOT NULL, "credentialId" text NOT NULL, "publicKey" text NOT NULL, "counter" text NOT NULL, "transports" text, "isVerified" boolean NOT NULL DEFAULT false, "deletedByUserId" uuid, "userId" uuid, CONSTRAINT "UQ_ed9d287cb27cc360b9c3a4542e9" UNIQUE ("credentialId"), CONSTRAINT "PK_76a58e093d632ac5a9036bfac57" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`ALTER TABLE "UserWebAuthn" ADD CONSTRAINT "FK_e14966d27e4991f5f53ef54cad5" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserWebAuthn" ADD CONSTRAINT "FK_e7a7d2869a90899c5f76ec997c0" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "UserWebAuthn" DROP CONSTRAINT "FK_e7a7d2869a90899c5f76ec997c0"`);
        await queryRunner.query(`ALTER TABLE "UserWebAuthn" DROP CONSTRAINT "FK_e14966d27e4991f5f53ef54cad5"`);
        await queryRunner.query(`DROP TABLE "UserWebAuthn"`);
    }

}
