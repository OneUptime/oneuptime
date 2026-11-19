import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * ServiceOwnerUser.isOwnerNotified and ServiceOwnerTeam.isOwnerNotified
 * (#9700): whether the people a service's owner row made owners were told,
 * as every other record's owner rows say. A service owner rule's Notify
 * Owners sorted the owners it added, then wrote both sets the same way, and
 * no job could tell anyone; the Workers' ServiceOwners job reads this.
 *
 * Generated with npm run generate-postgres-migration. A column with a
 * constant default: adding it rewrites nothing. Every row it finds reads not
 * told, so MarkOwnersAddedBeforeNotificationsAsTold1809185010000 marks them
 * told before any worker reads them, and their indexes are built online,
 * apart, in AddServiceOwnerIsOwnerNotifiedIndexes1809185020000
 * (Docs/migrations/README.md).
 */
export class AddServiceOwnerIsOwnerNotified1809185000000
  implements MigrationInterface
{
  public name: string = "AddServiceOwnerIsOwnerNotified1809185000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerTeam" ADD "isOwnerNotified" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerUser" ADD "isOwnerNotified" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerUser" DROP COLUMN "isOwnerNotified"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerTeam" DROP COLUMN "isOwnerNotified"`,
    );
  }
}
