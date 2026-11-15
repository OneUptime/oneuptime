import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Whether "Notify Status Page Subscribers" starts ticked when someone
 * declares an incident (issue #7606):
 * Project.notifyStatusPageSubscribersOfNewIncidentsByDefault, the switch on
 * Incidents -> Settings -> Subscriber Notifications. It defaults to true, so
 * every project that exists now gets it on and keeps the box ticked, as it
 * always started; only an owner or admin turning it off changes anything. A
 * column with a constant default is added without rewriting the table.
 */
export class AddNotifySubscribersOfNewIncidentsByDefault1809150300000
  implements MigrationInterface
{
  public name = "AddNotifySubscribersOfNewIncidentsByDefault1809150300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "notifyStatusPageSubscribersOfNewIncidentsByDefault" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "notifyStatusPageSubscribersOfNewIncidentsByDefault"`,
    );
  }
}
