import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Phase 0 (capture dropped OTel attributes): add first-class columns to
 * Service and Host for resource attributes that ingest previously dropped
 * (they only lived as resource.* attributes on telemetry rows). These are
 * auto-populated from OpenTelemetry resource attributes at ingest time and
 * are system-managed (not user-editable).
 */
export class AddTelemetryResourceMetadataColumns1780931863719
  implements MigrationInterface
{
  public name = "AddTelemetryResourceMetadataColumns1780931863719";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Service
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "serviceVersion" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "deploymentEnvironment" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "serviceNamespace" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "runtimeName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "runtimeVersion" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "cloudProvider" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "cloudPlatform" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "cloudRegion" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "cloudAccountId" character varying(100)`,
    );

    // Host
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "deploymentEnvironment" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "runtimeName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "runtimeVersion" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "cloudProvider" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "cloudPlatform" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "cloudRegion" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "cloudAccountId" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Host
    await queryRunner.query(`ALTER TABLE "Host" DROP COLUMN "cloudAccountId"`);
    await queryRunner.query(`ALTER TABLE "Host" DROP COLUMN "cloudRegion"`);
    await queryRunner.query(`ALTER TABLE "Host" DROP COLUMN "cloudPlatform"`);
    await queryRunner.query(`ALTER TABLE "Host" DROP COLUMN "cloudProvider"`);
    await queryRunner.query(`ALTER TABLE "Host" DROP COLUMN "runtimeVersion"`);
    await queryRunner.query(`ALTER TABLE "Host" DROP COLUMN "runtimeName"`);
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "deploymentEnvironment"`,
    );

    // Service
    await queryRunner.query(
      `ALTER TABLE "Service" DROP COLUMN "cloudAccountId"`,
    );
    await queryRunner.query(`ALTER TABLE "Service" DROP COLUMN "cloudRegion"`);
    await queryRunner.query(
      `ALTER TABLE "Service" DROP COLUMN "cloudPlatform"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" DROP COLUMN "cloudProvider"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" DROP COLUMN "runtimeVersion"`,
    );
    await queryRunner.query(`ALTER TABLE "Service" DROP COLUMN "runtimeName"`);
    await queryRunner.query(
      `ALTER TABLE "Service" DROP COLUMN "serviceNamespace"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" DROP COLUMN "deploymentEnvironment"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" DROP COLUMN "serviceVersion"`,
    );
  }
}
