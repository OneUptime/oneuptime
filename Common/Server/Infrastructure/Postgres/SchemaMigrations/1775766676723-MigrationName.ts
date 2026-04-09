import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1775766676723 implements MigrationInterface {
    public name = 'MigrationName1775766676723'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "DockerHost" DROP CONSTRAINT "FK_docker_host_projectId"`);
        await queryRunner.query(`ALTER TABLE "DockerHost" DROP CONSTRAINT "FK_docker_host_createdByUserId"`);
        await queryRunner.query(`ALTER TABLE "DockerHost" DROP CONSTRAINT "FK_docker_host_deletedByUserId"`);
        await queryRunner.query(`ALTER TABLE "DockerHostLabel" DROP CONSTRAINT "FK_docker_host_label_dockerHostId"`);
        await queryRunner.query(`ALTER TABLE "DockerHostLabel" DROP CONSTRAINT "FK_docker_host_label_labelId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_docker_host_projectId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_docker_host_hostIdentifier"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_docker_host_slug"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_docker_host_label_dockerHostId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_docker_host_label_labelId"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_ae65515f6441c05aa0ed907ddf" ON "DockerHost" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_52de5686db690e506374cd7378" ON "DockerHost" ("hostIdentifier") `);
        await queryRunner.query(`CREATE INDEX "IDX_ac05a97602df6aab28ceac1c8d" ON "DockerHostLabel" ("dockerHostId") `);
        await queryRunner.query(`CREATE INDEX "IDX_e19382fe2b139766b7d0176882" ON "DockerHostLabel" ("labelId") `);
        await queryRunner.query(`ALTER TABLE "DockerHost" ADD CONSTRAINT "FK_ae65515f6441c05aa0ed907ddf0" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "DockerHost" ADD CONSTRAINT "FK_a9466fa226aeffe460e9134655a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "DockerHost" ADD CONSTRAINT "FK_3f59ee567503d580023fd9195be" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "DockerHostLabel" ADD CONSTRAINT "FK_ac05a97602df6aab28ceac1c8d3" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "DockerHostLabel" ADD CONSTRAINT "FK_e19382fe2b139766b7d01768824" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "DockerHostLabel" DROP CONSTRAINT "FK_e19382fe2b139766b7d01768824"`);
        await queryRunner.query(`ALTER TABLE "DockerHostLabel" DROP CONSTRAINT "FK_ac05a97602df6aab28ceac1c8d3"`);
        await queryRunner.query(`ALTER TABLE "DockerHost" DROP CONSTRAINT "FK_3f59ee567503d580023fd9195be"`);
        await queryRunner.query(`ALTER TABLE "DockerHost" DROP CONSTRAINT "FK_a9466fa226aeffe460e9134655a"`);
        await queryRunner.query(`ALTER TABLE "DockerHost" DROP CONSTRAINT "FK_ae65515f6441c05aa0ed907ddf0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e19382fe2b139766b7d0176882"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ac05a97602df6aab28ceac1c8d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_52de5686db690e506374cd7378"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ae65515f6441c05aa0ed907ddf"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_docker_host_label_labelId" ON "DockerHostLabel" ("labelId") `);
        await queryRunner.query(`CREATE INDEX "IDX_docker_host_label_dockerHostId" ON "DockerHostLabel" ("dockerHostId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_docker_host_slug" ON "DockerHost" ("slug") `);
        await queryRunner.query(`CREATE INDEX "IDX_docker_host_hostIdentifier" ON "DockerHost" ("hostIdentifier") `);
        await queryRunner.query(`CREATE INDEX "IDX_docker_host_projectId" ON "DockerHost" ("projectId") `);
        await queryRunner.query(`ALTER TABLE "DockerHostLabel" ADD CONSTRAINT "FK_docker_host_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "DockerHostLabel" ADD CONSTRAINT "FK_docker_host_label_dockerHostId" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "DockerHost" ADD CONSTRAINT "FK_docker_host_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "DockerHost" ADD CONSTRAINT "FK_docker_host_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "DockerHost" ADD CONSTRAINT "FK_docker_host_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
