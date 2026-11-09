import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with TypeORM's migration:generate (the statements it generates
 * for the models), then renumbered after the last registered migration.
 *
 * SLO error budget policies (issue #5825): the ServiceLevelObjectiveError
 * BudgetPolicyTier table, with a unique index on (SLO, threshold) and the
 * eight join tables of its alert and incident outputs, and the SLO's three
 * worker-written current-tier columns. Every index and foreign key is on a
 * table this migration creates; the SLO's columns are nullable with no
 * default, so Postgres adds them without rewriting or scanning the table.
 */
export class AddSloErrorBudgetPolicyTiers1808996325825
  implements MigrationInterface
{
  public name: string = "AddSloErrorBudgetPolicyTiers1808996325825";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveErrorBudgetPolicyTier" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "serviceLevelObjectiveId" uuid NOT NULL, "name" character varying(100) NOT NULL, "thresholdPercentage" numeric NOT NULL, "whatWeDo" text NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "shouldCreateAlert" boolean NOT NULL DEFAULT false, "shouldCreateIncident" boolean NOT NULL DEFAULT false, "alertSeverityId" uuid, "alertTitleTemplate" character varying(500), "alertDescriptionTemplate" text, "alertRemediationNotes" text, "isAlertPrivate" boolean NOT NULL DEFAULT false, "autoResolveAlert" boolean NOT NULL DEFAULT true, "incidentSeverityId" uuid, "incidentTitleTemplate" character varying(500), "incidentDescriptionTemplate" text, "incidentRemediationNotes" text, "isIncidentPrivate" boolean NOT NULL DEFAULT false, "autoResolveIncident" boolean NOT NULL DEFAULT true, "addSloOwnersAsOwners" boolean NOT NULL DEFAULT false, "lastAlertCreatedAt" TIMESTAMP WITH TIME ZONE, "lastAlertResolvedAt" TIMESTAMP WITH TIME ZONE, "lastIncidentCreatedAt" TIMESTAMP WITH TIME ZONE, "lastIncidentResolvedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_b6d69bb2cec6608a6f66b247fa5" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2c75bab2927c1cbb35b7c2c891" ON "ServiceLevelObjectiveErrorBudgetPolicyTier" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1c9ef53c1d22b58d602fa32b81" ON "ServiceLevelObjectiveErrorBudgetPolicyTier" ("serviceLevelObjectiveId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_613a1ed5794dfc60d6eeec529e" ON "ServiceLevelObjectiveErrorBudgetPolicyTier" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_25e302bf105bc7c7b8597d369a" ON "ServiceLevelObjectiveErrorBudgetPolicyTier" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aad1a4d092a64007d02d5188f7" ON "ServiceLevelObjectiveErrorBudgetPolicyTier" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c59bd72a057a578fb3612e93d8" ON "ServiceLevelObjectiveErrorBudgetPolicyTier" ("serviceLevelObjectiveId", "thresholdPercentage") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SloErrorBudgetPolicyTierAlertOnCallDutyPolicy" ("serviceLevelObjectiveErrorBudgetPolicyTierId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_6a667e8e8a3371ba0eb6bca1258" PRIMARY KEY ("serviceLevelObjectiveErrorBudgetPolicyTierId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_64235237eee2922cc63d0f061a" ON "SloErrorBudgetPolicyTierAlertOnCallDutyPolicy" ("serviceLevelObjectiveErrorBudgetPolicyTierId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e15af48fdc1aa30298582b94e3" ON "SloErrorBudgetPolicyTierAlertOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SloErrorBudgetPolicyTierAlertLabel" ("serviceLevelObjectiveErrorBudgetPolicyTierId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_9b8de700e193b462de5bcf5dd5b" PRIMARY KEY ("serviceLevelObjectiveErrorBudgetPolicyTierId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7b8f2769656f1c1822bb5a6818" ON "SloErrorBudgetPolicyTierAlertLabel" ("serviceLevelObjectiveErrorBudgetPolicyTierId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a984248334360034639e04a73e" ON "SloErrorBudgetPolicyTierAlertLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SloErrorBudgetPolicyTierAlertOwnerTeam" ("serviceLevelObjectiveErrorBudgetPolicyTierId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_e7bd0491c6b931308f7484979e5" PRIMARY KEY ("serviceLevelObjectiveErrorBudgetPolicyTierId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92a91b5c84294317d0b0b72330" ON "SloErrorBudgetPolicyTierAlertOwnerTeam" ("serviceLevelObjectiveErrorBudgetPolicyTierId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d184ffd42be95adc229c299733" ON "SloErrorBudgetPolicyTierAlertOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SloErrorBudgetPolicyTierAlertOwnerUser" ("serviceLevelObjectiveErrorBudgetPolicyTierId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_b5255130624a59c362d146e66cb" PRIMARY KEY ("serviceLevelObjectiveErrorBudgetPolicyTierId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b04a4a3781a5e0cadaf75aace8" ON "SloErrorBudgetPolicyTierAlertOwnerUser" ("serviceLevelObjectiveErrorBudgetPolicyTierId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fd8531a56140c8c89453f5e408" ON "SloErrorBudgetPolicyTierAlertOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SloErrorBudgetPolicyTierIncidentOnCallDutyPolicy" ("serviceLevelObjectiveErrorBudgetPolicyTierId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_95c39e709df76593466cf6f8747" PRIMARY KEY ("serviceLevelObjectiveErrorBudgetPolicyTierId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fd7922496e430b99c1c5dd811e" ON "SloErrorBudgetPolicyTierIncidentOnCallDutyPolicy" ("serviceLevelObjectiveErrorBudgetPolicyTierId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ac8c74e145b8567fc9f7d27e54" ON "SloErrorBudgetPolicyTierIncidentOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SloErrorBudgetPolicyTierIncidentLabel" ("serviceLevelObjectiveErrorBudgetPolicyTierId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_ad2fcaa973a446fe0573c3765b3" PRIMARY KEY ("serviceLevelObjectiveErrorBudgetPolicyTierId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6b708c0bb7066da9a6cd80e74c" ON "SloErrorBudgetPolicyTierIncidentLabel" ("serviceLevelObjectiveErrorBudgetPolicyTierId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_31fa01713bd0acdf226274bdec" ON "SloErrorBudgetPolicyTierIncidentLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SloErrorBudgetPolicyTierIncidentOwnerTeam" ("serviceLevelObjectiveErrorBudgetPolicyTierId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_3d518e2ce9ca7ffe7fadfd60ebc" PRIMARY KEY ("serviceLevelObjectiveErrorBudgetPolicyTierId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9fc509826add53dfae25de8137" ON "SloErrorBudgetPolicyTierIncidentOwnerTeam" ("serviceLevelObjectiveErrorBudgetPolicyTierId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_789d3bf5483ff1e2a01fe635d6" ON "SloErrorBudgetPolicyTierIncidentOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SloErrorBudgetPolicyTierIncidentOwnerUser" ("serviceLevelObjectiveErrorBudgetPolicyTierId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_b8110c798dec358b80b41ee5342" PRIMARY KEY ("serviceLevelObjectiveErrorBudgetPolicyTierId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0023c2a4c3178637b5e7c4ea30" ON "SloErrorBudgetPolicyTierIncidentOwnerUser" ("serviceLevelObjectiveErrorBudgetPolicyTierId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_35f01d0c47c324bed21763f63a" ON "SloErrorBudgetPolicyTierIncidentOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD "currentErrorBudgetPolicyTierId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD "currentErrorBudgetPolicyTierName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD "currentErrorBudgetPolicyTierEnteredAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveErrorBudgetPolicyTier" ADD CONSTRAINT "FK_2c75bab2927c1cbb35b7c2c891a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveErrorBudgetPolicyTier" ADD CONSTRAINT "FK_1c9ef53c1d22b58d602fa32b819" FOREIGN KEY ("serviceLevelObjectiveId") REFERENCES "ServiceLevelObjective"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveErrorBudgetPolicyTier" ADD CONSTRAINT "FK_25e302bf105bc7c7b8597d369a1" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveErrorBudgetPolicyTier" ADD CONSTRAINT "FK_aad1a4d092a64007d02d5188f7e" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveErrorBudgetPolicyTier" ADD CONSTRAINT "FK_50b19cb0d4bf28fdcc4770bb303" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveErrorBudgetPolicyTier" ADD CONSTRAINT "FK_112949fd350183e74779ee9619c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierAlertOnCallDutyPolicy" ADD CONSTRAINT "FK_64235237eee2922cc63d0f061a6" FOREIGN KEY ("serviceLevelObjectiveErrorBudgetPolicyTierId") REFERENCES "ServiceLevelObjectiveErrorBudgetPolicyTier"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierAlertOnCallDutyPolicy" ADD CONSTRAINT "FK_e15af48fdc1aa30298582b94e37" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierAlertLabel" ADD CONSTRAINT "FK_7b8f2769656f1c1822bb5a68181" FOREIGN KEY ("serviceLevelObjectiveErrorBudgetPolicyTierId") REFERENCES "ServiceLevelObjectiveErrorBudgetPolicyTier"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierAlertLabel" ADD CONSTRAINT "FK_a984248334360034639e04a73e0" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierAlertOwnerTeam" ADD CONSTRAINT "FK_92a91b5c84294317d0b0b723308" FOREIGN KEY ("serviceLevelObjectiveErrorBudgetPolicyTierId") REFERENCES "ServiceLevelObjectiveErrorBudgetPolicyTier"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierAlertOwnerTeam" ADD CONSTRAINT "FK_d184ffd42be95adc229c2997330" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierAlertOwnerUser" ADD CONSTRAINT "FK_b04a4a3781a5e0cadaf75aace8d" FOREIGN KEY ("serviceLevelObjectiveErrorBudgetPolicyTierId") REFERENCES "ServiceLevelObjectiveErrorBudgetPolicyTier"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierAlertOwnerUser" ADD CONSTRAINT "FK_fd8531a56140c8c89453f5e408f" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierIncidentOnCallDutyPolicy" ADD CONSTRAINT "FK_fd7922496e430b99c1c5dd811e7" FOREIGN KEY ("serviceLevelObjectiveErrorBudgetPolicyTierId") REFERENCES "ServiceLevelObjectiveErrorBudgetPolicyTier"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierIncidentOnCallDutyPolicy" ADD CONSTRAINT "FK_ac8c74e145b8567fc9f7d27e543" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierIncidentLabel" ADD CONSTRAINT "FK_6b708c0bb7066da9a6cd80e74cb" FOREIGN KEY ("serviceLevelObjectiveErrorBudgetPolicyTierId") REFERENCES "ServiceLevelObjectiveErrorBudgetPolicyTier"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierIncidentLabel" ADD CONSTRAINT "FK_31fa01713bd0acdf226274bdec6" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierIncidentOwnerTeam" ADD CONSTRAINT "FK_9fc509826add53dfae25de81373" FOREIGN KEY ("serviceLevelObjectiveErrorBudgetPolicyTierId") REFERENCES "ServiceLevelObjectiveErrorBudgetPolicyTier"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierIncidentOwnerTeam" ADD CONSTRAINT "FK_789d3bf5483ff1e2a01fe635d65" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierIncidentOwnerUser" ADD CONSTRAINT "FK_0023c2a4c3178637b5e7c4ea303" FOREIGN KEY ("serviceLevelObjectiveErrorBudgetPolicyTierId") REFERENCES "ServiceLevelObjectiveErrorBudgetPolicyTier"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierIncidentOwnerUser" ADD CONSTRAINT "FK_35f01d0c47c324bed21763f63a1" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierIncidentOwnerUser" DROP CONSTRAINT "FK_35f01d0c47c324bed21763f63a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierIncidentOwnerUser" DROP CONSTRAINT "FK_0023c2a4c3178637b5e7c4ea303"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierIncidentOwnerTeam" DROP CONSTRAINT "FK_789d3bf5483ff1e2a01fe635d65"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierIncidentOwnerTeam" DROP CONSTRAINT "FK_9fc509826add53dfae25de81373"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierIncidentLabel" DROP CONSTRAINT "FK_31fa01713bd0acdf226274bdec6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierIncidentLabel" DROP CONSTRAINT "FK_6b708c0bb7066da9a6cd80e74cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierIncidentOnCallDutyPolicy" DROP CONSTRAINT "FK_ac8c74e145b8567fc9f7d27e543"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierIncidentOnCallDutyPolicy" DROP CONSTRAINT "FK_fd7922496e430b99c1c5dd811e7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierAlertOwnerUser" DROP CONSTRAINT "FK_fd8531a56140c8c89453f5e408f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierAlertOwnerUser" DROP CONSTRAINT "FK_b04a4a3781a5e0cadaf75aace8d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierAlertOwnerTeam" DROP CONSTRAINT "FK_d184ffd42be95adc229c2997330"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierAlertOwnerTeam" DROP CONSTRAINT "FK_92a91b5c84294317d0b0b723308"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierAlertLabel" DROP CONSTRAINT "FK_a984248334360034639e04a73e0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierAlertLabel" DROP CONSTRAINT "FK_7b8f2769656f1c1822bb5a68181"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierAlertOnCallDutyPolicy" DROP CONSTRAINT "FK_e15af48fdc1aa30298582b94e37"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SloErrorBudgetPolicyTierAlertOnCallDutyPolicy" DROP CONSTRAINT "FK_64235237eee2922cc63d0f061a6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveErrorBudgetPolicyTier" DROP CONSTRAINT "FK_112949fd350183e74779ee9619c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveErrorBudgetPolicyTier" DROP CONSTRAINT "FK_50b19cb0d4bf28fdcc4770bb303"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveErrorBudgetPolicyTier" DROP CONSTRAINT "FK_aad1a4d092a64007d02d5188f7e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveErrorBudgetPolicyTier" DROP CONSTRAINT "FK_25e302bf105bc7c7b8597d369a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveErrorBudgetPolicyTier" DROP CONSTRAINT "FK_1c9ef53c1d22b58d602fa32b819"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveErrorBudgetPolicyTier" DROP CONSTRAINT "FK_2c75bab2927c1cbb35b7c2c891a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP COLUMN "currentErrorBudgetPolicyTierEnteredAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP COLUMN "currentErrorBudgetPolicyTierName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP COLUMN "currentErrorBudgetPolicyTierId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_35f01d0c47c324bed21763f63a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0023c2a4c3178637b5e7c4ea30"`,
    );
    await queryRunner.query(
      `DROP TABLE "SloErrorBudgetPolicyTierIncidentOwnerUser"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_789d3bf5483ff1e2a01fe635d6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9fc509826add53dfae25de8137"`,
    );
    await queryRunner.query(
      `DROP TABLE "SloErrorBudgetPolicyTierIncidentOwnerTeam"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_31fa01713bd0acdf226274bdec"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6b708c0bb7066da9a6cd80e74c"`,
    );
    await queryRunner.query(
      `DROP TABLE "SloErrorBudgetPolicyTierIncidentLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ac8c74e145b8567fc9f7d27e54"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fd7922496e430b99c1c5dd811e"`,
    );
    await queryRunner.query(
      `DROP TABLE "SloErrorBudgetPolicyTierIncidentOnCallDutyPolicy"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fd8531a56140c8c89453f5e408"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b04a4a3781a5e0cadaf75aace8"`,
    );
    await queryRunner.query(
      `DROP TABLE "SloErrorBudgetPolicyTierAlertOwnerUser"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d184ffd42be95adc229c299733"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_92a91b5c84294317d0b0b72330"`,
    );
    await queryRunner.query(
      `DROP TABLE "SloErrorBudgetPolicyTierAlertOwnerTeam"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a984248334360034639e04a73e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7b8f2769656f1c1822bb5a6818"`,
    );
    await queryRunner.query(`DROP TABLE "SloErrorBudgetPolicyTierAlertLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e15af48fdc1aa30298582b94e3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_64235237eee2922cc63d0f061a"`,
    );
    await queryRunner.query(
      `DROP TABLE "SloErrorBudgetPolicyTierAlertOnCallDutyPolicy"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c59bd72a057a578fb3612e93d8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aad1a4d092a64007d02d5188f7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_25e302bf105bc7c7b8597d369a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_613a1ed5794dfc60d6eeec529e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1c9ef53c1d22b58d602fa32b81"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2c75bab2927c1cbb35b7c2c891"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveErrorBudgetPolicyTier"`,
    );
  }
}
