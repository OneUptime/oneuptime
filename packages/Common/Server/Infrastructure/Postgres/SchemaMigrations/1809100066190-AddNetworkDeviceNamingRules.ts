import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Naming rules for network devices (OneUptime issue #6619):
 *
 *  - NetworkDeviceNamingRule: which devices a rule names (its conditions,
 *    the sites it is for in NetworkDeviceNamingRuleSite) and what it calls
 *    them (its name pattern and lookup table), in the order the rules are
 *    tried (priority).
 *  - NetworkSite.code: a site's short code, which {site.code} puts in names.
 *  - NetworkDevice.ruleAssignedName: the name a naming rule gave a device,
 *    so the rules can tell their own names from a person's.
 *
 * The indexes and foreign keys are on the new tables, which are empty; the
 * two columns are nullable with no default, which Postgres adds without
 * rewriting a row.
 */
export class AddNetworkDeviceNamingRules1809100066190
  implements MigrationInterface
{
  public name: string = "AddNetworkDeviceNamingRules1809100066190";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "NetworkDeviceNamingRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "criteria" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "priority" integer NOT NULL DEFAULT '0', "ipMatchTarget" character varying(100), "discoveredNamePattern" character varying(500), "macAddressPattern" character varying(500), "vendorPattern" character varying(500), "namePattern" character varying(500) NOT NULL, "lookupKey" character varying(100), "lookupEntries" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_afdff3f563a56979511eca38cc8" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a6ef16abe5adcb39c3edaa9ca1" ON "NetworkDeviceNamingRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_152b7f2d1f0826872841ce6941" ON "NetworkDeviceNamingRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "NetworkDeviceNamingRuleSite" ("networkDeviceNamingRuleId" uuid NOT NULL, "networkSiteId" uuid NOT NULL, CONSTRAINT "PK_f0cdce3c3bbcce204879dd766fc" PRIMARY KEY ("networkDeviceNamingRuleId", "networkSiteId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b4e7eb1cb28de9e3fcb4b62dfb" ON "NetworkDeviceNamingRuleSite" ("networkDeviceNamingRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3e8e313675276ace5bf40124a6" ON "NetworkDeviceNamingRuleSite" ("networkSiteId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD "code" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "ruleAssignedName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceNamingRule" ADD CONSTRAINT "FK_a6ef16abe5adcb39c3edaa9ca19" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceNamingRule" ADD CONSTRAINT "FK_e344d0e2c8383c2d3de45a3c892" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceNamingRule" ADD CONSTRAINT "FK_410b2992e27211111f01b61363b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceNamingRuleSite" ADD CONSTRAINT "FK_b4e7eb1cb28de9e3fcb4b62dfbf" FOREIGN KEY ("networkDeviceNamingRuleId") REFERENCES "NetworkDeviceNamingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceNamingRuleSite" ADD CONSTRAINT "FK_3e8e313675276ace5bf40124a6d" FOREIGN KEY ("networkSiteId") REFERENCES "NetworkSite"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceNamingRuleSite" DROP CONSTRAINT "FK_3e8e313675276ace5bf40124a6d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceNamingRuleSite" DROP CONSTRAINT "FK_b4e7eb1cb28de9e3fcb4b62dfbf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceNamingRule" DROP CONSTRAINT "FK_410b2992e27211111f01b61363b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceNamingRule" DROP CONSTRAINT "FK_e344d0e2c8383c2d3de45a3c892"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceNamingRule" DROP CONSTRAINT "FK_a6ef16abe5adcb39c3edaa9ca19"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "ruleAssignedName"`,
    );
    await queryRunner.query(`ALTER TABLE "NetworkSite" DROP COLUMN "code"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3e8e313675276ace5bf40124a6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b4e7eb1cb28de9e3fcb4b62dfb"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkDeviceNamingRuleSite"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_152b7f2d1f0826872841ce6941"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a6ef16abe5adcb39c3edaa9ca1"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkDeviceNamingRule"`);
  }
}
