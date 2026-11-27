import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * OneUptime AI access to an XCP-ng pool (#10998): the settings every
 * resource AI agent's resource keeps (investigation on, fixes Disabled until
 * someone turns them on), and the columns the server alone writes. Adding a
 * column with a constant default rewrites nothing, so existing pools take
 * the defaults at once.
 */
export class AddXcpNgPoolAiAccess1809187772000 implements MigrationInterface {
  public name: string = "AddXcpNgPoolAiAccess1809187772000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT 'Disabled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "aiCommandAllowlist" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "aiAccessLastVerifiedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "aiAccessLastError" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "aiAccessConfiguredAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "aiAgentResetAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "aiAgentResetAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "aiAccessConfiguredAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "aiAccessLastError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "aiAccessLastVerifiedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "aiCommandAllowlist"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "aiRemediationMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "isAiInvestigationEnabled"`,
    );
  }
}
