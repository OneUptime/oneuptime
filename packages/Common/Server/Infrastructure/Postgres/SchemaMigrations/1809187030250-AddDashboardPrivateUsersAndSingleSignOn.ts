import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, and numbered after the
 * last registered migration.
 *
 * A dashboard's public link for only the people who sign in (#10250):
 * Dashboard.requireSignIn and requireSsoForLogin, and four new tables - the
 * dashboard's private users (DashboardPrivateUser), their sessions
 * (DashboardPrivateUserSession), and its SAML and OIDC single sign-on
 * providers (DashboardSSO, DashboardOIDC).
 *
 * The two Dashboard columns are booleans with a constant default: adding
 * them rewrites nothing. Every foreign key is on a table created here,
 * still empty when its key is added, so each check reads nothing and holds
 * its locks for an instant (Docs/migrations/README.md).
 */
export class AddDashboardPrivateUsersAndSingleSignOn1809187030250
  implements MigrationInterface
{
  public name: string = "AddDashboardPrivateUsersAndSingleSignOn1809187030250";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DashboardPrivateUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dashboardId" uuid NOT NULL, "email" character varying(100), "password" character varying(255), "passwordSalt" character varying(100), "hasPassword" boolean NOT NULL DEFAULT false, "resetPasswordToken" character varying(100), "resetPasswordExpires" TIMESTAMP WITH TIME ZONE, "lastActive" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, "isSsoUser" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_41f41b5bafae239a4062f9758ce" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0ada05a9fac82950e514c2d02c" ON "DashboardPrivateUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_08f43f13cdbf92c164ba314c55" ON "DashboardPrivateUser" ("dashboardId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DashboardPrivateUserSession" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dashboardId" uuid NOT NULL, "dashboardPrivateUserId" uuid NOT NULL, "refreshToken" character varying(255) NOT NULL, "refreshTokenExpiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastActiveAt" TIMESTAMP WITH TIME ZONE, "deviceName" character varying(100), "deviceType" character varying(100), "deviceOS" character varying(100), "deviceBrowser" character varying(100), "ipAddress" character varying(100), "userAgent" text, "isRevoked" boolean NOT NULL DEFAULT false, "revokedAt" TIMESTAMP WITH TIME ZONE, "revokedReason" character varying(100), "additionalInfo" jsonb, "dashboardSsoId" uuid, "dashboardOidcId" uuid, CONSTRAINT "UQ_1130eb9f1840da135a643bf8096" UNIQUE ("refreshToken"), CONSTRAINT "PK_b33d1cfa5f272dbe0c2661d6c88" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f072e42625c474d1207ca8a5cf" ON "DashboardPrivateUserSession" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_27ef25ae8dfdfcc1b1a9936b86" ON "DashboardPrivateUserSession" ("dashboardId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2734de0d40bac23a6e81a02744" ON "DashboardPrivateUserSession" ("dashboardPrivateUserId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1130eb9f1840da135a643bf809" ON "DashboardPrivateUserSession" ("refreshToken") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DashboardSSO" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dashboardId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying NOT NULL, "signatureMethod" character varying(100) NOT NULL, "digestMethod" character varying(100) NOT NULL, "signOnURL" text NOT NULL, "issuerURL" text NOT NULL, "publicCertificate" text NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isEnabled" boolean NOT NULL DEFAULT false, "isTested" boolean NOT NULL DEFAULT false, "signInsEndedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_50220031942d74936ca88163191" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6f1afa9f035f8b1c4d498f650e" ON "DashboardSSO" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e58ca9415141272eed1a6ec3d2" ON "DashboardSSO" ("dashboardId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DashboardOIDC" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dashboardId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying NOT NULL, "discoveryURL" text NOT NULL, "issuerURL" text NOT NULL, "clientId" character varying(100) NOT NULL, "clientSecret" character varying NOT NULL, "scopes" character varying(100) NOT NULL, "emailClaimName" character varying(100) NOT NULL, "nameClaimName" character varying(100), "createdByUserId" uuid, "deletedByUserId" uuid, "isEnabled" boolean NOT NULL DEFAULT false, "isTested" boolean NOT NULL DEFAULT false, "signInsEndedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_f45eb8bc5cdbaa3cc371791ff5d" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_21976d9f9bf069ddca68274505" ON "DashboardOIDC" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5b8393a99f81f1b4153463136c" ON "DashboardOIDC" ("dashboardId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "requireSignIn" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "requireSsoForLogin" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPrivateUser" ADD CONSTRAINT "FK_0ada05a9fac82950e514c2d02c2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPrivateUser" ADD CONSTRAINT "FK_08f43f13cdbf92c164ba314c551" FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPrivateUser" ADD CONSTRAINT "FK_f34d24e39213872776dbe7916ea" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPrivateUser" ADD CONSTRAINT "FK_fe2dc59a3b209044ab488643053" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPrivateUserSession" ADD CONSTRAINT "FK_f072e42625c474d1207ca8a5cfc" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPrivateUserSession" ADD CONSTRAINT "FK_27ef25ae8dfdfcc1b1a9936b862" FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPrivateUserSession" ADD CONSTRAINT "FK_2734de0d40bac23a6e81a027447" FOREIGN KEY ("dashboardPrivateUserId") REFERENCES "DashboardPrivateUser"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardSSO" ADD CONSTRAINT "FK_6f1afa9f035f8b1c4d498f650ed" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardSSO" ADD CONSTRAINT "FK_e58ca9415141272eed1a6ec3d26" FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardSSO" ADD CONSTRAINT "FK_8139301691cb8ca817f0b506b98" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardSSO" ADD CONSTRAINT "FK_0877e95c250b1d8a83f52d60541" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOIDC" ADD CONSTRAINT "FK_21976d9f9bf069ddca68274505c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOIDC" ADD CONSTRAINT "FK_5b8393a99f81f1b4153463136ce" FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOIDC" ADD CONSTRAINT "FK_f2c9adbe7a04cdb13613259b412" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOIDC" ADD CONSTRAINT "FK_97064c707d5b3d5fded0e561af1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DashboardOIDC" DROP CONSTRAINT "FK_97064c707d5b3d5fded0e561af1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOIDC" DROP CONSTRAINT "FK_f2c9adbe7a04cdb13613259b412"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOIDC" DROP CONSTRAINT "FK_5b8393a99f81f1b4153463136ce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOIDC" DROP CONSTRAINT "FK_21976d9f9bf069ddca68274505c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardSSO" DROP CONSTRAINT "FK_0877e95c250b1d8a83f52d60541"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardSSO" DROP CONSTRAINT "FK_8139301691cb8ca817f0b506b98"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardSSO" DROP CONSTRAINT "FK_e58ca9415141272eed1a6ec3d26"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardSSO" DROP CONSTRAINT "FK_6f1afa9f035f8b1c4d498f650ed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPrivateUserSession" DROP CONSTRAINT "FK_2734de0d40bac23a6e81a027447"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPrivateUserSession" DROP CONSTRAINT "FK_27ef25ae8dfdfcc1b1a9936b862"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPrivateUserSession" DROP CONSTRAINT "FK_f072e42625c474d1207ca8a5cfc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPrivateUser" DROP CONSTRAINT "FK_fe2dc59a3b209044ab488643053"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPrivateUser" DROP CONSTRAINT "FK_f34d24e39213872776dbe7916ea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPrivateUser" DROP CONSTRAINT "FK_08f43f13cdbf92c164ba314c551"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardPrivateUser" DROP CONSTRAINT "FK_0ada05a9fac82950e514c2d02c2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP COLUMN "requireSsoForLogin"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP COLUMN "requireSignIn"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5b8393a99f81f1b4153463136c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_21976d9f9bf069ddca68274505"`,
    );
    await queryRunner.query(`DROP TABLE "DashboardOIDC"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e58ca9415141272eed1a6ec3d2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6f1afa9f035f8b1c4d498f650e"`,
    );
    await queryRunner.query(`DROP TABLE "DashboardSSO"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1130eb9f1840da135a643bf809"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2734de0d40bac23a6e81a02744"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_27ef25ae8dfdfcc1b1a9936b86"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f072e42625c474d1207ca8a5cf"`,
    );
    await queryRunner.query(`DROP TABLE "DashboardPrivateUserSession"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_08f43f13cdbf92c164ba314c55"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0ada05a9fac82950e514c2d02c"`,
    );
    await queryRunner.query(`DROP TABLE "DashboardPrivateUser"`);
  }
}
