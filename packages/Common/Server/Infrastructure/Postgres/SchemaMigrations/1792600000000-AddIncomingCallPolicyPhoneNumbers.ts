import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIncomingCallPolicyPhoneNumbers1792600000000
  implements MigrationInterface
{
  public readonly name: string =
    "AddIncomingCallPolicyPhoneNumbers1792600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncomingCallPolicyPhoneNumber" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "incomingCallPolicyId" uuid NOT NULL, "projectCallSMSConfigId" uuid NOT NULL, "phoneNumber" character varying(30) NOT NULL, "callProviderPhoneNumberId" character varying(100) NOT NULL, "countryCode" character varying(100), "areaCode" character varying(100), "phoneNumberPurchasedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_46893187d82b3d39788b04be920" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1e34c7280fa570f4fc9082ecd6" ON "IncomingCallPolicyPhoneNumber" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d8c4476e7f18b58ae724bc43c7" ON "IncomingCallPolicyPhoneNumber" ("incomingCallPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_908415bd52e7502b68e1dc2aa7" ON "IncomingCallPolicyPhoneNumber" ("projectCallSMSConfigId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b3c04dcef639a36641dd3a3ed4" ON "IncomingCallPolicyPhoneNumber" ("incomingCallPolicyId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_INCOMING_CALL_POLICY_PROVIDER_PHONE_NUMBER_UNIQUE" ON "IncomingCallPolicyPhoneNumber" ("projectCallSMSConfigId", "callProviderPhoneNumberId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_INCOMING_CALL_POLICY_PHONE_NUMBER_UNIQUE" ON "IncomingCallPolicyPhoneNumber" ("phoneNumber") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyPhoneNumber" ADD CONSTRAINT "FK_1e34c7280fa570f4fc9082ecd6f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyPhoneNumber" ADD CONSTRAINT "FK_d8c4476e7f18b58ae724bc43c74" FOREIGN KEY ("incomingCallPolicyId") REFERENCES "IncomingCallPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyPhoneNumber" ADD CONSTRAINT "FK_908415bd52e7502b68e1dc2aa7d" FOREIGN KEY ("projectCallSMSConfigId") REFERENCES "ProjectCallSMSConfig"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyPhoneNumber" DROP CONSTRAINT "FK_908415bd52e7502b68e1dc2aa7d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyPhoneNumber" DROP CONSTRAINT "FK_d8c4476e7f18b58ae724bc43c74"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyPhoneNumber" DROP CONSTRAINT "FK_1e34c7280fa570f4fc9082ecd6f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_INCOMING_CALL_POLICY_PHONE_NUMBER_UNIQUE"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_INCOMING_CALL_POLICY_PROVIDER_PHONE_NUMBER_UNIQUE"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b3c04dcef639a36641dd3a3ed4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_908415bd52e7502b68e1dc2aa7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d8c4476e7f18b58ae724bc43c7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1e34c7280fa570f4fc9082ecd6"`,
    );
    await queryRunner.query(`DROP TABLE "IncomingCallPolicyPhoneNumber"`);
  }
}
