import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, and numbered after the
 * last registered migration.
 *
 * A form's public link for only the people who sign in (#10249):
 * Form.requireSignIn and requireSsoForLogin, and four new tables - the
 * form's private users (FormPrivateUser), their sessions
 * (FormPrivateUserSession), and its SAML and OIDC single sign-on providers
 * (FormSSO, FormOIDC) - as a dashboard's (#10250).
 *
 * The two Form columns are booleans with a constant default: adding them
 * rewrites nothing. Every foreign key is on a table created here, still
 * empty when its key is added, so each check reads nothing and holds its
 * locks for an instant (Docs/migrations/README.md).
 */
export class AddFormPrivateUsersAndSingleSignOn1809187040120
  implements MigrationInterface
{
  public name: string = "AddFormPrivateUsersAndSingleSignOn1809187040120";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "FormPrivateUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "formId" uuid NOT NULL, "email" character varying(100), "password" character varying(255), "passwordSalt" character varying(100), "hasPassword" boolean NOT NULL DEFAULT false, "resetPasswordToken" character varying(100), "resetPasswordExpires" TIMESTAMP WITH TIME ZONE, "lastActive" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, "isSsoUser" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_8ea0c7fd6b4e85162b004e3cb39" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_affa3415eb3ec9b5b73be362a8" ON "FormPrivateUser" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_d9a1ea12ddf2048de8d564b4a4" ON "FormPrivateUser" ("formId") `);
        await queryRunner.query(`CREATE TABLE "FormPrivateUserSession" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "formId" uuid NOT NULL, "formPrivateUserId" uuid NOT NULL, "refreshToken" character varying(255) NOT NULL, "refreshTokenExpiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastActiveAt" TIMESTAMP WITH TIME ZONE, "deviceName" character varying(100), "deviceType" character varying(100), "deviceOS" character varying(100), "deviceBrowser" character varying(100), "ipAddress" character varying(100), "userAgent" text, "isRevoked" boolean NOT NULL DEFAULT false, "revokedAt" TIMESTAMP WITH TIME ZONE, "revokedReason" character varying(100), "additionalInfo" jsonb, "formSsoId" uuid, "formOidcId" uuid, CONSTRAINT "UQ_d4275b95dc55a9d348c42936cc5" UNIQUE ("refreshToken"), CONSTRAINT "PK_314051db2039c3db11590abbf6a" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8ee023ef30eba5d0fbf1610b0e" ON "FormPrivateUserSession" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_8a4c5e88b13ea37dcce4851493" ON "FormPrivateUserSession" ("formId") `);
        await queryRunner.query(`CREATE INDEX "IDX_a6b1e09aec5d1036ba7e51fe36" ON "FormPrivateUserSession" ("formPrivateUserId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d4275b95dc55a9d348c42936cc" ON "FormPrivateUserSession" ("refreshToken") `);
        await queryRunner.query(`CREATE TABLE "FormSSO" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "formId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying NOT NULL, "signatureMethod" character varying(100) NOT NULL, "digestMethod" character varying(100) NOT NULL, "signOnURL" text NOT NULL, "issuerURL" text NOT NULL, "publicCertificate" text NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isEnabled" boolean NOT NULL DEFAULT false, "isTested" boolean NOT NULL DEFAULT false, "signInsEndedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_80fe81a0a175f2b9e4c4acf6b9e" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_325fd7254e05afbfead3959906" ON "FormSSO" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_a0a454b61d529e85f3cb061142" ON "FormSSO" ("formId") `);
        await queryRunner.query(`CREATE TABLE "FormOIDC" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "formId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying NOT NULL, "discoveryURL" text NOT NULL, "issuerURL" text NOT NULL, "clientId" character varying(100) NOT NULL, "clientSecret" character varying NOT NULL, "scopes" character varying(100) NOT NULL, "emailClaimName" character varying(100) NOT NULL, "nameClaimName" character varying(100), "createdByUserId" uuid, "deletedByUserId" uuid, "isEnabled" boolean NOT NULL DEFAULT false, "isTested" boolean NOT NULL DEFAULT false, "signInsEndedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_c9b6372c53f711286f8a03fe9a1" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a6747157434ee9a4a8768bf4af" ON "FormOIDC" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_69a57ec3d3d847c5839ebd7b3c" ON "FormOIDC" ("formId") `);
        await queryRunner.query(`ALTER TABLE "Form" ADD "requireSignIn" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "Form" ADD "requireSsoForLogin" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "FormPrivateUser" ADD CONSTRAINT "FK_affa3415eb3ec9b5b73be362a81" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "FormPrivateUser" ADD CONSTRAINT "FK_d9a1ea12ddf2048de8d564b4a4d" FOREIGN KEY ("formId") REFERENCES "Form"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "FormPrivateUser" ADD CONSTRAINT "FK_634e3453555d4f94dd92fa238a5" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "FormPrivateUser" ADD CONSTRAINT "FK_a1153f1d2fe779d6968502a0e47" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "FormPrivateUserSession" ADD CONSTRAINT "FK_8ee023ef30eba5d0fbf1610b0e3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "FormPrivateUserSession" ADD CONSTRAINT "FK_8a4c5e88b13ea37dcce48514931" FOREIGN KEY ("formId") REFERENCES "Form"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "FormPrivateUserSession" ADD CONSTRAINT "FK_a6b1e09aec5d1036ba7e51fe362" FOREIGN KEY ("formPrivateUserId") REFERENCES "FormPrivateUser"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "FormSSO" ADD CONSTRAINT "FK_325fd7254e05afbfead39599062" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "FormSSO" ADD CONSTRAINT "FK_a0a454b61d529e85f3cb061142e" FOREIGN KEY ("formId") REFERENCES "Form"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "FormSSO" ADD CONSTRAINT "FK_0080e4de14815c2f651e283979c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "FormSSO" ADD CONSTRAINT "FK_7e26ed3c9def2949ee34c9ab4d8" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "FormOIDC" ADD CONSTRAINT "FK_a6747157434ee9a4a8768bf4af7" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "FormOIDC" ADD CONSTRAINT "FK_69a57ec3d3d847c5839ebd7b3c7" FOREIGN KEY ("formId") REFERENCES "Form"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "FormOIDC" ADD CONSTRAINT "FK_16a5fcd3f1c71df57314b952e42" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "FormOIDC" ADD CONSTRAINT "FK_5960b5a68a6ab3bdce70056e854" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "FormOIDC" DROP CONSTRAINT "FK_5960b5a68a6ab3bdce70056e854"`);
        await queryRunner.query(`ALTER TABLE "FormOIDC" DROP CONSTRAINT "FK_16a5fcd3f1c71df57314b952e42"`);
        await queryRunner.query(`ALTER TABLE "FormOIDC" DROP CONSTRAINT "FK_69a57ec3d3d847c5839ebd7b3c7"`);
        await queryRunner.query(`ALTER TABLE "FormOIDC" DROP CONSTRAINT "FK_a6747157434ee9a4a8768bf4af7"`);
        await queryRunner.query(`ALTER TABLE "FormSSO" DROP CONSTRAINT "FK_7e26ed3c9def2949ee34c9ab4d8"`);
        await queryRunner.query(`ALTER TABLE "FormSSO" DROP CONSTRAINT "FK_0080e4de14815c2f651e283979c"`);
        await queryRunner.query(`ALTER TABLE "FormSSO" DROP CONSTRAINT "FK_a0a454b61d529e85f3cb061142e"`);
        await queryRunner.query(`ALTER TABLE "FormSSO" DROP CONSTRAINT "FK_325fd7254e05afbfead39599062"`);
        await queryRunner.query(`ALTER TABLE "FormPrivateUserSession" DROP CONSTRAINT "FK_a6b1e09aec5d1036ba7e51fe362"`);
        await queryRunner.query(`ALTER TABLE "FormPrivateUserSession" DROP CONSTRAINT "FK_8a4c5e88b13ea37dcce48514931"`);
        await queryRunner.query(`ALTER TABLE "FormPrivateUserSession" DROP CONSTRAINT "FK_8ee023ef30eba5d0fbf1610b0e3"`);
        await queryRunner.query(`ALTER TABLE "FormPrivateUser" DROP CONSTRAINT "FK_a1153f1d2fe779d6968502a0e47"`);
        await queryRunner.query(`ALTER TABLE "FormPrivateUser" DROP CONSTRAINT "FK_634e3453555d4f94dd92fa238a5"`);
        await queryRunner.query(`ALTER TABLE "FormPrivateUser" DROP CONSTRAINT "FK_d9a1ea12ddf2048de8d564b4a4d"`);
        await queryRunner.query(`ALTER TABLE "FormPrivateUser" DROP CONSTRAINT "FK_affa3415eb3ec9b5b73be362a81"`);
        await queryRunner.query(`ALTER TABLE "Form" DROP COLUMN "requireSsoForLogin"`);
        await queryRunner.query(`ALTER TABLE "Form" DROP COLUMN "requireSignIn"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_69a57ec3d3d847c5839ebd7b3c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a6747157434ee9a4a8768bf4af"`);
        await queryRunner.query(`DROP TABLE "FormOIDC"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a0a454b61d529e85f3cb061142"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_325fd7254e05afbfead3959906"`);
        await queryRunner.query(`DROP TABLE "FormSSO"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d4275b95dc55a9d348c42936cc"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a6b1e09aec5d1036ba7e51fe36"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8a4c5e88b13ea37dcce4851493"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8ee023ef30eba5d0fbf1610b0e"`);
        await queryRunner.query(`DROP TABLE "FormPrivateUserSession"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d9a1ea12ddf2048de8d564b4a4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_affa3415eb3ec9b5b73be362a8"`);
        await queryRunner.query(`DROP TABLE "FormPrivateUser"`);
    }

}
