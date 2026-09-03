import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Ping-first network device polling.
 *
 *   - NetworkSnmpCredentialProfile: reusable SNMP credentials, resolved for a
 *     device as device columns -> device profile -> site profile -> ping only.
 *   - NetworkAlertPolicy: a scope (all / sites / roles / labels) plus a
 *     Network Device monitor template; the engine keeps one monitor per
 *     covered device (Monitor.networkAlertPolicyId) so alerting is a policy,
 *     not something configured device by device.
 *   - NetworkSite.probeId / snmpCredentialProfileId: the site's monitoring
 *     defaults, copied onto devices at write time.
 *   - NetworkDevice.isSnmpReachable / lastSnmpSeenAt: the SNMP walk's own
 *     result, separate from reachability (which ping now decides).
 *   - NetworkDevice.monitoringMethod defaults to 'Probe' (formerly 'SNMP');
 *     the NormalizeNetworkDeviceMonitoringMethod data migration rewrites the
 *     stored values.
 */
export class AddNetworkSnmpCredentialProfilesAndAlertPolicies1791200000000
  implements MigrationInterface
{
  public name: string =
    "AddNetworkSnmpCredentialProfilesAndAlertPolicies1791200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "NetworkAlertPolicy" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "monitorTemplateId" uuid, "scope" jsonb NOT NULL DEFAULT '{}', "lastSyncAt" TIMESTAMP WITH TIME ZONE, "lastSyncError" character varying(500), "coveredDeviceCount" integer DEFAULT '0', "templateSyncedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_a6fa7156f8fafda3d045689f33b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_784e9f96c6229aadb1f3ff1f4f" ON "NetworkAlertPolicy" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_248ef6126744a645d084cb2431" ON "NetworkAlertPolicy" ("monitorTemplateId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_network_alert_policy_project_template_unique" ON "NetworkAlertPolicy" ("projectId", "monitorTemplateId") WHERE "deletedAt" IS NULL AND "monitorTemplateId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "NetworkSnmpCredentialProfile" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "snmpVersion" character varying(100) DEFAULT 'V2c', "snmpCommunityString" text, "snmpPort" integer DEFAULT '161', "snmpV3SecurityLevel" character varying(100), "snmpV3Username" character varying(100), "snmpV3AuthProtocol" character varying(100), "snmpV3AuthKey" text, "snmpV3PrivProtocol" character varying(100), "snmpV3PrivKey" text, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_7bac722bd8323e891d3a1c5292f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3114361b9ddb6a70d7c538c28d" ON "NetworkSnmpCredentialProfile" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "networkAlertPolicyId" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "NetworkSite" ADD "probeId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD "snmpCredentialProfileId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "snmpCredentialProfileId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "isSnmpReachable" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "lastSnmpSeenAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ALTER COLUMN "monitoringMethod" SET DEFAULT 'Probe'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_51cac50b63aac2d24983010b47" ON "Monitor" ("networkAlertPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b54c966057aa58e360a4f2e532" ON "NetworkSite" ("probeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_79c8d9b3f4f3b3c93bddcbd713" ON "NetworkSite" ("snmpCredentialProfileId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_293e5f4308dec96413427b6739" ON "NetworkDevice" ("projectId", "snmpCredentialProfileId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkAlertPolicy" ADD CONSTRAINT "FK_784e9f96c6229aadb1f3ff1f4f6" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkAlertPolicy" ADD CONSTRAINT "FK_248ef6126744a645d084cb24314" FOREIGN KEY ("monitorTemplateId") REFERENCES "MonitorTemplate"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkAlertPolicy" ADD CONSTRAINT "FK_10debf45ebcfe435a30185a6c0c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkAlertPolicy" ADD CONSTRAINT "FK_e7cc6526ed2f1f23a2f24560c65" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD CONSTRAINT "FK_51cac50b63aac2d24983010b475" FOREIGN KEY ("networkAlertPolicyId") REFERENCES "NetworkAlertPolicy"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSnmpCredentialProfile" ADD CONSTRAINT "FK_3114361b9ddb6a70d7c538c28da" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSnmpCredentialProfile" ADD CONSTRAINT "FK_0c011dba595b5a41a90a899728c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSnmpCredentialProfile" ADD CONSTRAINT "FK_66f88d052fc53906511384c1f65" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD CONSTRAINT "FK_b54c966057aa58e360a4f2e532a" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD CONSTRAINT "FK_79c8d9b3f4f3b3c93bddcbd7135" FOREIGN KEY ("snmpCredentialProfileId") REFERENCES "NetworkSnmpCredentialProfile"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_7a42f6f231d1f0db76ab884b22d" FOREIGN KEY ("snmpCredentialProfileId") REFERENCES "NetworkSnmpCredentialProfile"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP CONSTRAINT "FK_7a42f6f231d1f0db76ab884b22d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP CONSTRAINT "FK_79c8d9b3f4f3b3c93bddcbd7135"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP CONSTRAINT "FK_b54c966057aa58e360a4f2e532a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSnmpCredentialProfile" DROP CONSTRAINT "FK_66f88d052fc53906511384c1f65"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSnmpCredentialProfile" DROP CONSTRAINT "FK_0c011dba595b5a41a90a899728c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSnmpCredentialProfile" DROP CONSTRAINT "FK_3114361b9ddb6a70d7c538c28da"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP CONSTRAINT "FK_51cac50b63aac2d24983010b475"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkAlertPolicy" DROP CONSTRAINT "FK_e7cc6526ed2f1f23a2f24560c65"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkAlertPolicy" DROP CONSTRAINT "FK_10debf45ebcfe435a30185a6c0c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkAlertPolicy" DROP CONSTRAINT "FK_248ef6126744a645d084cb24314"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkAlertPolicy" DROP CONSTRAINT "FK_784e9f96c6229aadb1f3ff1f4f6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_293e5f4308dec96413427b6739"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_79c8d9b3f4f3b3c93bddcbd713"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b54c966057aa58e360a4f2e532"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_51cac50b63aac2d24983010b47"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ALTER COLUMN "monitoringMethod" SET DEFAULT 'SNMP'`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "lastSnmpSeenAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "isSnmpReachable"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "snmpCredentialProfileId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP COLUMN "snmpCredentialProfileId"`,
    );
    await queryRunner.query(`ALTER TABLE "NetworkSite" DROP COLUMN "probeId"`);
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "networkAlertPolicyId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3114361b9ddb6a70d7c538c28d"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkSnmpCredentialProfile"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_alert_policy_project_template_unique"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_248ef6126744a645d084cb2431"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_784e9f96c6229aadb1f3ff1f4f"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkAlertPolicy"`);
  }
}
