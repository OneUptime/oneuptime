import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * How the server signs in to Amazon SES (#7000): with the IAM user's access
 * key it always had, or as the IAM role AWS gives the server itself - IAM
 * roles for service accounts or EKS Pod Identity, an ECS task role, an EC2
 * instance profile - with no key stored ("GlobalConfig"
 * .amazonSesAuthenticationType). Empty on every server that has one now:
 * it signs in with its access key, as before.
 *
 * The column is nullable with no default, so it is added without
 * rewriting the table, and no index or foreign key is added.
 */
export class AddAmazonSesAuthenticationType1809123100000
  implements MigrationInterface
{
  public name: string = "AddAmazonSesAuthenticationType1809123100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "amazonSesAuthenticationType" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "amazonSesAuthenticationType"`,
    );
  }
}
