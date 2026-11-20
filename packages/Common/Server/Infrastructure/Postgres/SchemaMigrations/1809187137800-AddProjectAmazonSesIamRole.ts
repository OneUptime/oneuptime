import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * How a project's Amazon SES config signs in (#7378): with the IAM user's
 * access key it always had, or with an IAM role in the project's own AWS
 * account, which OneUptime signs in to with sts:AssumeRole and the
 * project's email external id - no key stored
 * ("ProjectSMTPConfig"."amazonSesAuthenticationType" and
 * "amazonSesRoleArn"). Every config there is now reads "Access Key", and
 * signs in as before.
 *
 * A NOT NULL column with a constant default is added without rewriting the
 * table (Postgres 11 and later keep the default in the catalog), and the
 * role's column is nullable with no default. No index or foreign key is
 * added.
 */
export class AddProjectAmazonSesIamRole1809187137800
  implements MigrationInterface
{
  public name: string = "AddProjectAmazonSesIamRole1809187137800";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "amazonSesAuthenticationType" character varying(100) NOT NULL DEFAULT 'Access Key'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD "amazonSesRoleArn" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "amazonSesRoleArn"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "amazonSesAuthenticationType"`,
    );
  }
}
