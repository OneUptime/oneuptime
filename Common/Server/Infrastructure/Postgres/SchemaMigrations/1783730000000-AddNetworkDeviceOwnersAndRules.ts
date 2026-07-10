import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNetworkDeviceOwnersAndRules1783730000000
  implements MigrationInterface
{
  public name = "AddNetworkDeviceOwnersAndRules1783730000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- NetworkDeviceOwnerTeam ---
    await queryRunner.query(
      `CREATE TABLE "NetworkDeviceOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "networkDeviceId" uuid NOT NULL, "isOwnerNotified" boolean NOT NULL DEFAULT false, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_network_device_owner_team_id" PRIMARY KEY ("_id"))`,
    );
    for (const column of [
      "projectId",
      "teamId",
      "networkDeviceId",
      "isOwnerNotified",
    ]) {
      await queryRunner.query(
        `CREATE INDEX "IDX_network_device_owner_team_${column}" ON "NetworkDeviceOwnerTeam" ("${column}")`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" ADD CONSTRAINT "FK_nd_owner_team_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" ADD CONSTRAINT "FK_nd_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" ADD CONSTRAINT "FK_nd_owner_team_networkDeviceId" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" ADD CONSTRAINT "FK_nd_owner_team_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" ADD CONSTRAINT "FK_nd_owner_team_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // --- NetworkDeviceOwnerUser ---
    await queryRunner.query(
      `CREATE TABLE "NetworkDeviceOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "networkDeviceId" uuid NOT NULL, "isOwnerNotified" boolean NOT NULL DEFAULT false, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_network_device_owner_user_id" PRIMARY KEY ("_id"))`,
    );
    for (const column of [
      "projectId",
      "userId",
      "networkDeviceId",
      "isOwnerNotified",
    ]) {
      await queryRunner.query(
        `CREATE INDEX "IDX_network_device_owner_user_${column}" ON "NetworkDeviceOwnerUser" ("${column}")`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" ADD CONSTRAINT "FK_nd_owner_user_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" ADD CONSTRAINT "FK_nd_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" ADD CONSTRAINT "FK_nd_owner_user_networkDeviceId" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" ADD CONSTRAINT "FK_nd_owner_user_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" ADD CONSTRAINT "FK_nd_owner_user_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // --- NetworkDeviceOwnerRule ---
    await queryRunner.query(
      `CREATE TABLE "NetworkDeviceOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "networkDeviceNamePattern" character varying(500), "networkDeviceDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_network_device_owner_rule_id" PRIMARY KEY ("_id"))`,
    );
    for (const column of ["projectId", "name", "isEnabled"]) {
      await queryRunner.query(
        `CREATE INDEX "IDX_network_device_owner_rule_${column}" ON "NetworkDeviceOwnerRule" ("${column}")`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" ADD CONSTRAINT "FK_nd_owner_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" ADD CONSTRAINT "FK_nd_owner_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" ADD CONSTRAINT "FK_nd_owner_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // OwnerRule join tables
    const ownerRuleJoins: Array<{
      table: string;
      column: string;
      refTable: string;
    }> = [
      {
        table: "NetworkDeviceOwnerRuleNetworkDeviceLabel",
        column: "labelId",
        refTable: "Label",
      },
      {
        table: "NetworkDeviceOwnerRuleOwnerUser",
        column: "userId",
        refTable: "User",
      },
      {
        table: "NetworkDeviceOwnerRuleOwnerTeam",
        column: "teamId",
        refTable: "Team",
      },
    ];

    for (const join of ownerRuleJoins) {
      await queryRunner.query(
        `CREATE TABLE "${join.table}" ("networkDeviceOwnerRuleId" uuid NOT NULL, "${join.column}" uuid NOT NULL, CONSTRAINT "PK_${join.table}" PRIMARY KEY ("networkDeviceOwnerRuleId", "${join.column}"))`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_${join.table}_ruleId" ON "${join.table}" ("networkDeviceOwnerRuleId")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_${join.table}_${join.column}" ON "${join.table}" ("${join.column}")`,
      );
      await queryRunner.query(
        `ALTER TABLE "${join.table}" ADD CONSTRAINT "FK_${join.table}_ruleId" FOREIGN KEY ("networkDeviceOwnerRuleId") REFERENCES "NetworkDeviceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
      );
      await queryRunner.query(
        `ALTER TABLE "${join.table}" ADD CONSTRAINT "FK_${join.table}_${join.column}" FOREIGN KEY ("${join.column}") REFERENCES "${join.refTable}"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
      );
    }

    // --- NetworkDeviceLabelRule ---
    await queryRunner.query(
      `CREATE TABLE "NetworkDeviceLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "networkDeviceNamePattern" character varying(500), "networkDeviceDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_network_device_label_rule_id" PRIMARY KEY ("_id"))`,
    );
    for (const column of ["projectId", "name", "isEnabled"]) {
      await queryRunner.query(
        `CREATE INDEX "IDX_network_device_label_rule_${column}" ON "NetworkDeviceLabelRule" ("${column}")`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" ADD CONSTRAINT "FK_nd_label_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" ADD CONSTRAINT "FK_nd_label_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" ADD CONSTRAINT "FK_nd_label_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // LabelRule join tables
    for (const table of [
      "NetworkDeviceLabelRuleNetworkDeviceLabel",
      "NetworkDeviceLabelRuleLabelToAdd",
    ]) {
      await queryRunner.query(
        `CREATE TABLE "${table}" ("networkDeviceLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_${table}" PRIMARY KEY ("networkDeviceLabelRuleId", "labelId"))`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_${table}_ruleId" ON "${table}" ("networkDeviceLabelRuleId")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_${table}_labelId" ON "${table}" ("labelId")`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_ruleId" FOREIGN KEY ("networkDeviceLabelRuleId") REFERENCES "NetworkDeviceLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "NetworkDeviceLabelRuleLabelToAdd"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "NetworkDeviceLabelRuleNetworkDeviceLabel"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "NetworkDeviceLabelRule"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "NetworkDeviceOwnerRuleOwnerTeam"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "NetworkDeviceOwnerRuleOwnerUser"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "NetworkDeviceOwnerRuleNetworkDeviceLabel"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "NetworkDeviceOwnerRule"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "NetworkDeviceOwnerUser"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "NetworkDeviceOwnerTeam"`);
  }
}
