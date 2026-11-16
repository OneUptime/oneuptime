import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Whether an Incoming Request monitor's senders send one of the project's
 * incoming request secrets (issue #8498): when a request with one last came,
 * when one without came, and why that one had none
 * (IncomingRequestSecretActivity).
 *
 * Three nullable columns with no default and no index: "Monitor" only gains
 * them in its catalog, no row is rewritten, and its writes are not held up
 * beyond the moment each ALTER takes. With no index on them, the stamps that
 * fill them stay HOT updates.
 */
export class AddIncomingRequestSecretActivity1809179500000
  implements MigrationInterface
{
  public name: string = "AddIncomingRequestSecretActivity1809179500000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "incomingRequestWithSecretAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "incomingRequestWithoutSecretAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "incomingRequestWithoutSecretReason" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "incomingRequestWithoutSecretReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "incomingRequestWithoutSecretAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "incomingRequestWithSecretAt"`,
    );
  }
}
