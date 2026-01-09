import { MigrationInterface, QueryRunner } from "typeorm";

export class RenameServiceCatalogToService1767966850199
  implements MigrationInterface
{
  public name = "RenameServiceCatalogToService1767966850199";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Step 1: Rename columns in dependent tables first (before renaming the main table)
     * This is done first because foreign key constraints reference the column names
     */

    // Rename serviceCatalogId to serviceId in ServiceCatalogMonitor
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" RENAME COLUMN "serviceCatalogId" TO "serviceId"`,
    );

    // Rename serviceCatalogId to serviceId in ServiceCatalogTelemetryService
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" RENAME COLUMN "serviceCatalogId" TO "serviceId"`,
    );

    // Rename columns in ServiceCatlogDependency (note the typo in original table name)
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" RENAME COLUMN "serviceCatalogId" TO "serviceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" RENAME COLUMN "dependencyServiceCatalogId" TO "dependencyServiceId"`,
    );

    // Rename serviceCatalogId to serviceId in ServiceCatalogCodeRepository
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" RENAME COLUMN "serviceCatalogId" TO "serviceId"`,
    );

    // Rename serviceCatalogId to serviceId in ServiceCatalogOwnerTeam
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerTeam" RENAME COLUMN "serviceCatalogId" TO "serviceId"`,
    );

    // Rename serviceCatalogId to serviceId in ServiceCatalogOwnerUser
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerUser" RENAME COLUMN "serviceCatalogId" TO "serviceId"`,
    );

    // Rename serviceCatalogId to serviceId in ServiceCatalogLabel join table
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogLabel" RENAME COLUMN "serviceCatalogId" TO "serviceId"`,
    );

    /*
     * Step 2: Rename tables
     * Rename main ServiceCatalog table to Service
     */
    await queryRunner.query(`ALTER TABLE "ServiceCatalog" RENAME TO "Service"`);

    // Rename ServiceCatalogMonitor to ServiceMonitor
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" RENAME TO "ServiceMonitor"`,
    );

    // Rename ServiceCatalogTelemetryService to ServiceTelemetryService
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" RENAME TO "ServiceTelemetryService"`,
    );

    // Rename ServiceCatlogDependency to ServiceDependency (fixing the typo too)
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" RENAME TO "ServiceDependency"`,
    );

    // Rename ServiceCatalogCodeRepository to ServiceCodeRepository
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" RENAME TO "ServiceCodeRepository"`,
    );

    // Rename ServiceCatalogOwnerTeam to ServiceOwnerTeam
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerTeam" RENAME TO "ServiceOwnerTeam"`,
    );

    // Rename ServiceCatalogOwnerUser to ServiceOwnerUser
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerUser" RENAME TO "ServiceOwnerUser"`,
    );

    // Rename ServiceCatalogLabel to ServiceLabel
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogLabel" RENAME TO "ServiceLabel"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Rename tables back to original names
    await queryRunner.query(
      `ALTER TABLE "ServiceLabel" RENAME TO "ServiceCatalogLabel"`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerUser" RENAME TO "ServiceCatalogOwnerUser"`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerTeam" RENAME TO "ServiceCatalogOwnerTeam"`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceCodeRepository" RENAME TO "ServiceCatalogCodeRepository"`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceDependency" RENAME TO "ServiceCatlogDependency"`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceTelemetryService" RENAME TO "ServiceCatalogTelemetryService"`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceMonitor" RENAME TO "ServiceCatalogMonitor"`,
    );

    await queryRunner.query(`ALTER TABLE "Service" RENAME TO "ServiceCatalog"`);

    // Step 2: Rename columns back to original names
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogLabel" RENAME COLUMN "serviceId" TO "serviceCatalogId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerUser" RENAME COLUMN "serviceId" TO "serviceCatalogId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerTeam" RENAME COLUMN "serviceId" TO "serviceCatalogId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" RENAME COLUMN "serviceId" TO "serviceCatalogId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" RENAME COLUMN "dependencyServiceId" TO "dependencyServiceCatalogId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" RENAME COLUMN "serviceId" TO "serviceCatalogId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" RENAME COLUMN "serviceId" TO "serviceCatalogId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" RENAME COLUMN "serviceId" TO "serviceCatalogId"`,
    );
  }
}
