import { MigrationInterface, QueryRunner } from "typeorm";

export class AttachServiceToIncidentAndAlert1779303924241
  implements MigrationInterface
{
  public name: string = "AttachServiceToIncidentAndAlert1779303924241";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // IncidentService
    await queryRunner.query(
      `CREATE TABLE "IncidentService" ("incidentId" uuid NOT NULL, "serviceId" uuid NOT NULL, CONSTRAINT "PK_f4278c4ad966e1388f6aa832b98" PRIMARY KEY ("incidentId", "serviceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9b8061de368e0c38bf78fc1412" ON "IncidentService" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_780433e4b5ce2df00b7dc2b30b" ON "IncidentService" ("serviceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentService" ADD CONSTRAINT "FK_9b8061de368e0c38bf78fc1412d" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentService" ADD CONSTRAINT "FK_780433e4b5ce2df00b7dc2b30b6" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // AlertService
    await queryRunner.query(
      `CREATE TABLE "AlertService" ("alertId" uuid NOT NULL, "serviceId" uuid NOT NULL, CONSTRAINT "PK_eb1648d9ffb96bf6c38d90c4293" PRIMARY KEY ("alertId", "serviceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f250e1b41b406c65d007cc08a9" ON "AlertService" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c93eaf768fb41804783e246b12" ON "AlertService" ("serviceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertService" ADD CONSTRAINT "FK_f250e1b41b406c65d007cc08a9c" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertService" ADD CONSTRAINT "FK_c93eaf768fb41804783e246b129" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertService" DROP CONSTRAINT "FK_c93eaf768fb41804783e246b129"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertService" DROP CONSTRAINT "FK_f250e1b41b406c65d007cc08a9c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentService" DROP CONSTRAINT "FK_780433e4b5ce2df00b7dc2b30b6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentService" DROP CONSTRAINT "FK_9b8061de368e0c38bf78fc1412d"`,
    );
    await queryRunner.query(`DROP TABLE "AlertService"`);
    await queryRunner.query(`DROP TABLE "IncidentService"`);
  }
}
