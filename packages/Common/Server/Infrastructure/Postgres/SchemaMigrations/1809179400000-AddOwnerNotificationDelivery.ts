import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renamed and
 * renumbered after the last registered migration.
 *
 * Who each owner notification of an incident or an alert is to tell, and
 * whether it told them (OwnerNotificationDelivery, issue #8199): one row per
 * notification and owner, written before the owner notification job takes
 * the record it tells of, so a worker stopped part way leaves the owners it
 * had not told yet to be told by a later run, and nobody is told twice.
 *
 *   - the unique index on ("kind", "eventId", "occurrence", "userId") is
 *     what makes each owner's row the only one of its notification;
 *   - the partial index on ("kind", "attemptedAt") WHERE "status" =
 *     'Pending' holds only the owners still to be told - the few being told
 *     at any moment - for the read of those a stopped run left.
 *
 * A new table, so its indexes and keys are built on an empty table and need
 * no online DDL. Nothing is backfilled: the notifications sent before this
 * have nobody left to tell.
 */
export class AddOwnerNotificationDelivery1809179400000
  implements MigrationInterface
{
  public name: string = "AddOwnerNotificationDelivery1809179400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "OwnerNotificationDelivery" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "resourceId" uuid NOT NULL, "eventId" uuid NOT NULL, "occurrence" integer NOT NULL, "userId" uuid NOT NULL, "isProjectOwner" boolean NOT NULL, "status" character varying(100) NOT NULL, "attempts" integer NOT NULL, "attemptedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_88663c55b0a6cc3b2e4664a6a53" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_30a13c173c92a9eb2197633224" ON "OwnerNotificationDelivery" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c6fc94bd02d2d6f0ff34a83084" ON "OwnerNotificationDelivery" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1514ee5805e69ae6d85393e663" ON "OwnerNotificationDelivery" ("kind", "attemptedAt") WHERE "status" = 'Pending'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_fc2435512c0d7c017b9743cdeb" ON "OwnerNotificationDelivery" ("kind", "eventId", "occurrence", "userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OwnerNotificationDelivery" ADD CONSTRAINT "FK_30a13c173c92a9eb21976332241" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OwnerNotificationDelivery" ADD CONSTRAINT "FK_c6fc94bd02d2d6f0ff34a830845" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OwnerNotificationDelivery" DROP CONSTRAINT "FK_c6fc94bd02d2d6f0ff34a830845"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OwnerNotificationDelivery" DROP CONSTRAINT "FK_30a13c173c92a9eb21976332241"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fc2435512c0d7c017b9743cdeb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1514ee5805e69ae6d85393e663"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c6fc94bd02d2d6f0ff34a83084"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_30a13c173c92a9eb2197633224"`,
    );
    await queryRunner.query(`DROP TABLE "OwnerNotificationDelivery"`);
  }
}
