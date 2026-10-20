import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * External MCP servers (ExternalMcpServer): MCP servers outside OneUptime
 * whose tools OneUptime AI may use while it investigates and fixes, set up
 * under Settings → AI → External MCP Servers. One new table, so every index
 * is built and every foreign key checked on an empty table.
 *
 * AIInvestigationRuleExternalMcpServer and
 * AutoRemediationRuleExternalMcpServer: the MCP servers an investigation
 * rule or an auto remediation rule lets OneUptime AI use (none named: all of
 * the project's). Two new join tables, empty too; their keys point at the
 * existing rule tables without scanning them.
 *
 * AutoRemediationSuggestion.mcpToolCallPlan: the tool calls a fix made, or
 * proposes, through the project's external MCP servers. A nullable column
 * with no default, added without rewriting the table.
 */
export class AddExternalMcpServers1804950000000 implements MigrationInterface {
  public name: string = "AddExternalMcpServers1804950000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ExternalMcpServer" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "url" text NOT NULL, "authType" character varying(100) NOT NULL DEFAULT 'None', "bearerToken" text, "headers" jsonb, "oauthTokenUrl" text, "oauthClientId" character varying(500), "oauthClientSecret" text, "oauthScope" character varying(500), "oauthAudience" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "transport" character varying(100), "serverName" character varying(500), "serverVersion" character varying(100), "protocolVersion" character varying(100), "tools" jsonb, "lastCheckedAt" TIMESTAMP WITH TIME ZONE, "lastConnectedAt" TIMESTAMP WITH TIME ZONE, "lastError" text, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_82fac7f0522e7474858c82b775a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f420038a5033cce81993363f64" ON "ExternalMcpServer" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f718387ef4879a36881f0293cf" ON "ExternalMcpServer" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AutoRemediationRuleExternalMcpServer" ("autoRemediationRuleId" uuid NOT NULL, "externalMcpServerId" uuid NOT NULL, CONSTRAINT "PK_680614e74379c7e3cce2f1ba082" PRIMARY KEY ("autoRemediationRuleId", "externalMcpServerId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_392a1e5f0dcf0fed9f2995c71f" ON "AutoRemediationRuleExternalMcpServer" ("autoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e9a74805bf73f651588f878e6" ON "AutoRemediationRuleExternalMcpServer" ("externalMcpServerId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AIInvestigationRuleExternalMcpServer" ("aiInvestigationRuleId" uuid NOT NULL, "externalMcpServerId" uuid NOT NULL, CONSTRAINT "PK_38fa1d7d6adc2e1f083b38233bd" PRIMARY KEY ("aiInvestigationRuleId", "externalMcpServerId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fc6ab7e1992276460b4f1fea97" ON "AIInvestigationRuleExternalMcpServer" ("aiInvestigationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2dce01acb82e68cb23dd40cd8f" ON "AIInvestigationRuleExternalMcpServer" ("externalMcpServerId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "mcpToolCallPlan" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExternalMcpServer" ADD CONSTRAINT "FK_f420038a5033cce81993363f648" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExternalMcpServer" ADD CONSTRAINT "FK_3dc281ea60d292b4d5d4c0ad260" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExternalMcpServer" ADD CONSTRAINT "FK_637751daf77fe2127e9b92f824b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleExternalMcpServer" ADD CONSTRAINT "FK_392a1e5f0dcf0fed9f2995c71fb" FOREIGN KEY ("autoRemediationRuleId") REFERENCES "AutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleExternalMcpServer" ADD CONSTRAINT "FK_8e9a74805bf73f651588f878e6d" FOREIGN KEY ("externalMcpServerId") REFERENCES "ExternalMcpServer"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleExternalMcpServer" ADD CONSTRAINT "FK_fc6ab7e1992276460b4f1fea976" FOREIGN KEY ("aiInvestigationRuleId") REFERENCES "AIInvestigationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleExternalMcpServer" ADD CONSTRAINT "FK_2dce01acb82e68cb23dd40cd8f4" FOREIGN KEY ("externalMcpServerId") REFERENCES "ExternalMcpServer"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleExternalMcpServer" DROP CONSTRAINT "FK_2dce01acb82e68cb23dd40cd8f4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleExternalMcpServer" DROP CONSTRAINT "FK_fc6ab7e1992276460b4f1fea976"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleExternalMcpServer" DROP CONSTRAINT "FK_8e9a74805bf73f651588f878e6d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleExternalMcpServer" DROP CONSTRAINT "FK_392a1e5f0dcf0fed9f2995c71fb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExternalMcpServer" DROP CONSTRAINT "FK_637751daf77fe2127e9b92f824b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExternalMcpServer" DROP CONSTRAINT "FK_3dc281ea60d292b4d5d4c0ad260"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExternalMcpServer" DROP CONSTRAINT "FK_f420038a5033cce81993363f648"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "mcpToolCallPlan"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2dce01acb82e68cb23dd40cd8f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fc6ab7e1992276460b4f1fea97"`,
    );
    await queryRunner.query(
      `DROP TABLE "AIInvestigationRuleExternalMcpServer"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e9a74805bf73f651588f878e6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_392a1e5f0dcf0fed9f2995c71f"`,
    );
    await queryRunner.query(
      `DROP TABLE "AutoRemediationRuleExternalMcpServer"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f718387ef4879a36881f0293cf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f420038a5033cce81993363f64"`,
    );
    await queryRunner.query(`DROP TABLE "ExternalMcpServer"`);
  }
}
