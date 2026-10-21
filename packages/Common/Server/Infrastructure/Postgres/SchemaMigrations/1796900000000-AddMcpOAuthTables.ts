import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * OAuth sign-in for the MCP server. Three tables, all new, nothing altered:
 *
 *   McpOAuthClient  MCP clients that registered themselves (RFC 7591).
 *   McpOAuthGrant   "this member let this client act for them in this
 *                   project" - one row per approval on the consent screen.
 *   McpOAuthToken   digests of the authorization codes, access tokens and
 *                   refresh tokens issued under a grant.
 *
 * The two foreign keys that matter are the cascades: a grant goes when its
 * project or its user does, and a token goes when its grant does. Revoking a
 * client is deleting its grant, and that is what takes its tokens with it.
 * See the models for everything else.
 */
export class AddMcpOAuthTables1796900000000 implements MigrationInterface {
  public name: string = "AddMcpOAuthTables1796900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "McpOAuthClient" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "clientName" character varying(100) NOT NULL, "clientUri" character varying(500), "redirectUris" jsonb NOT NULL, "tokenEndpointAuthMethod" character varying(100) NOT NULL, "clientSecretHash" character varying(100), "lastUsedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_94ef13eabb737f0b5c86a690322" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6aacc7ba7ea7c286faf92e9040" ON "McpOAuthClient" ("lastUsedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "McpOAuthGrant" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "name" character varying(100) NOT NULL, "clientId" character varying(500) NOT NULL, "scope" character varying(100) NOT NULL, "resource" character varying(500) NOT NULL, "activatedAt" TIMESTAMP WITH TIME ZONE, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastUsedAt" TIMESTAMP WITH TIME ZONE, "ssoProviderType" character varying(100), "ssoProviderId" uuid, "ssoExpiresAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a7a6b978533323bb55d20641683" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_67758231559e66bd2ff39175d9" ON "McpOAuthGrant" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_365e6fce03846cfc6d37bda9d4" ON "McpOAuthGrant" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3fd8b786511034c33fdaed67dd" ON "McpOAuthGrant" ("clientId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_707535aed42e89fc694d8098ce" ON "McpOAuthGrant" ("expiresAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "McpOAuthToken" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "mcpOAuthGrantId" uuid NOT NULL, "tokenType" character varying(100) NOT NULL, "tokenHash" character varying(100) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "consumedAt" TIMESTAMP WITH TIME ZONE, "codeChallenge" character varying(100), "redirectUri" text, CONSTRAINT "UQ_91d0df23a6cd24877fdc020e354" UNIQUE ("tokenHash"), CONSTRAINT "PK_3203512e6e24cc83543a133b8cf" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a848b7f49a863d67799a117b82" ON "McpOAuthToken" ("mcpOAuthGrantId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_af198aa32ac12d8dc1a2bbf586" ON "McpOAuthToken" ("expiresAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "McpOAuthGrant" ADD CONSTRAINT "FK_67758231559e66bd2ff39175d9e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "McpOAuthGrant" ADD CONSTRAINT "FK_365e6fce03846cfc6d37bda9d4f" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "McpOAuthToken" ADD CONSTRAINT "FK_a848b7f49a863d67799a117b82f" FOREIGN KEY ("mcpOAuthGrantId") REFERENCES "McpOAuthGrant"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "McpOAuthToken" DROP CONSTRAINT "FK_a848b7f49a863d67799a117b82f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "McpOAuthGrant" DROP CONSTRAINT "FK_365e6fce03846cfc6d37bda9d4f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "McpOAuthGrant" DROP CONSTRAINT "FK_67758231559e66bd2ff39175d9e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_af198aa32ac12d8dc1a2bbf586"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a848b7f49a863d67799a117b82"`,
    );
    await queryRunner.query(`DROP TABLE "McpOAuthToken"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_707535aed42e89fc694d8098ce"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3fd8b786511034c33fdaed67dd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_365e6fce03846cfc6d37bda9d4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_67758231559e66bd2ff39175d9"`,
    );
    await queryRunner.query(`DROP TABLE "McpOAuthGrant"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6aacc7ba7ea7c286faf92e9040"`,
    );
    await queryRunner.query(`DROP TABLE "McpOAuthClient"`);
  }
}
