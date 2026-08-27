import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Project half of the private-network webhook opt-in (issue #3424).
 *
 * NOT NULL DEFAULT false, so every existing project keeps today's behaviour:
 * outbound webhooks that resolve into a private range stay refused until BOTH
 * this flag and an instance-level setting
 * (ALLOW_PRIVATE_NETWORK_WEBHOOKS / PRIVATE_NETWORK_WEBHOOK_ALLOWLIST) say
 * otherwise.
 */
export class AddAllowPrivateNetworkWebhooks1789600000000
  implements MigrationInterface
{
  public name: string = "AddAllowPrivateNetworkWebhooks1789600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "allowPrivateNetworkWebhooks" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "allowPrivateNetworkWebhooks"`,
    );
  }
}
