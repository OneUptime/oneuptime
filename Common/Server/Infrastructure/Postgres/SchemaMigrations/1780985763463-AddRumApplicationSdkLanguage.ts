import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Adds RumApplication.sdkLanguage (the telemetry.sdk.language resource
 * attribute, e.g. webjs / swift / android). Used to scope a RUM
 * application's client-side telemetry apart from a same-named backend
 * service that shares the same service.name.
 */
export class AddRumApplicationSdkLanguage1780985763463
  implements MigrationInterface
{
  public name = "AddRumApplicationSdkLanguage1780985763463";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sdkLanguage" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sdkLanguage"`,
    );
  }
}
