import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGlobalSsoAndOidc1782000000000 implements MigrationInterface {
  public name = "AddGlobalSsoAndOidc1782000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // GlobalSSO (instance-level SAML provider).
    await queryRunner.query(
      `CREATE TABLE "GlobalSSO" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "name" character varying(100) NOT NULL, "description" character varying NOT NULL, "signatureMethod" character varying(100) NOT NULL, "digestMethod" character varying(100) NOT NULL, "signOnURL" text NOT NULL, "issuerURL" text NOT NULL, "publicCertificate" text NOT NULL, "disableSignUpWithSso" boolean NOT NULL DEFAULT false, "isEnabled" boolean NOT NULL DEFAULT false, "isTested" boolean NOT NULL DEFAULT false, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_GlobalSSO" PRIMARY KEY ("_id"))`,
    );

    // GlobalOIDC (instance-level OIDC provider).
    await queryRunner.query(
      `CREATE TABLE "GlobalOIDC" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "name" character varying(100) NOT NULL, "description" character varying NOT NULL, "discoveryURL" text NOT NULL, "issuerURL" text NOT NULL, "clientId" character varying(100) NOT NULL, "clientSecret" character varying NOT NULL, "scopes" character varying(100) NOT NULL, "emailClaimName" character varying(100) NOT NULL, "nameClaimName" character varying(100) NOT NULL, "disableSignUpWithSso" boolean NOT NULL DEFAULT false, "isEnabled" boolean NOT NULL DEFAULT false, "isTested" boolean NOT NULL DEFAULT false, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_GlobalOIDC" PRIMARY KEY ("_id"))`,
    );

    // GlobalSSOProject (attaches a GlobalSSO to a project).
    await queryRunner.query(
      `CREATE TABLE "GlobalSSOProject" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "globalSsoId" uuid NOT NULL, "projectId" uuid NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_GlobalSSOProject" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_GlobalSSOProject_globalSsoId" ON "GlobalSSOProject" ("globalSsoId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_GlobalSSOProject_projectId" ON "GlobalSSOProject" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_GlobalSSOProject_globalSsoId_projectId" ON "GlobalSSOProject" ("globalSsoId", "projectId") `,
    );

    // GlobalOIDCProject (attaches a GlobalOIDC to a project).
    await queryRunner.query(
      `CREATE TABLE "GlobalOIDCProject" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "globalOidcId" uuid NOT NULL, "projectId" uuid NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_GlobalOIDCProject" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_GlobalOIDCProject_globalOidcId" ON "GlobalOIDCProject" ("globalOidcId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_GlobalOIDCProject_projectId" ON "GlobalOIDCProject" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_GlobalOIDCProject_globalOidcId_projectId" ON "GlobalOIDCProject" ("globalOidcId", "projectId") `,
    );

    // Join tables for default teams.
    await queryRunner.query(
      `CREATE TABLE "GlobalSSOProjectTeam" ("globalSsoProjectId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_GlobalSSOProjectTeam" PRIMARY KEY ("globalSsoProjectId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_GlobalSSOProjectTeam_globalSsoProjectId" ON "GlobalSSOProjectTeam" ("globalSsoProjectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_GlobalSSOProjectTeam_teamId" ON "GlobalSSOProjectTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "GlobalOIDCProjectTeam" ("globalOidcProjectId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_GlobalOIDCProjectTeam" PRIMARY KEY ("globalOidcProjectId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_GlobalOIDCProjectTeam_globalOidcProjectId" ON "GlobalOIDCProjectTeam" ("globalOidcProjectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_GlobalOIDCProjectTeam_teamId" ON "GlobalOIDCProjectTeam" ("teamId") `,
    );

    // Specific-IdP enforcement discriminator on Project.
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "requireSsoWithSsoProviderId" uuid`,
    );

    // Foreign keys: GlobalSSO -> User.
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" ADD CONSTRAINT "FK_GlobalSSO_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" ADD CONSTRAINT "FK_GlobalSSO_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys: GlobalOIDC -> User.
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" ADD CONSTRAINT "FK_GlobalOIDC_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" ADD CONSTRAINT "FK_GlobalOIDC_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys: GlobalSSOProject.
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" ADD CONSTRAINT "FK_GlobalSSOProject_globalSsoId" FOREIGN KEY ("globalSsoId") REFERENCES "GlobalSSO"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" ADD CONSTRAINT "FK_GlobalSSOProject_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" ADD CONSTRAINT "FK_GlobalSSOProject_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys: GlobalOIDCProject.
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" ADD CONSTRAINT "FK_GlobalOIDCProject_globalOidcId" FOREIGN KEY ("globalOidcId") REFERENCES "GlobalOIDC"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" ADD CONSTRAINT "FK_GlobalOIDCProject_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" ADD CONSTRAINT "FK_GlobalOIDCProject_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys: join tables.
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProjectTeam" ADD CONSTRAINT "FK_GlobalSSOProjectTeam_globalSsoProjectId" FOREIGN KEY ("globalSsoProjectId") REFERENCES "GlobalSSOProject"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProjectTeam" ADD CONSTRAINT "FK_GlobalSSOProjectTeam_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProjectTeam" ADD CONSTRAINT "FK_GlobalOIDCProjectTeam_globalOidcProjectId" FOREIGN KEY ("globalOidcProjectId") REFERENCES "GlobalOIDCProject"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProjectTeam" ADD CONSTRAINT "FK_GlobalOIDCProjectTeam_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProjectTeam" DROP CONSTRAINT "FK_GlobalOIDCProjectTeam_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProjectTeam" DROP CONSTRAINT "FK_GlobalOIDCProjectTeam_globalOidcProjectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProjectTeam" DROP CONSTRAINT "FK_GlobalSSOProjectTeam_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProjectTeam" DROP CONSTRAINT "FK_GlobalSSOProjectTeam_globalSsoProjectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" DROP CONSTRAINT "FK_GlobalOIDCProject_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" DROP CONSTRAINT "FK_GlobalOIDCProject_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDCProject" DROP CONSTRAINT "FK_GlobalOIDCProject_globalOidcId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" DROP CONSTRAINT "FK_GlobalSSOProject_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" DROP CONSTRAINT "FK_GlobalSSOProject_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSOProject" DROP CONSTRAINT "FK_GlobalSSOProject_globalSsoId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" DROP CONSTRAINT "FK_GlobalOIDC_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" DROP CONSTRAINT "FK_GlobalOIDC_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" DROP CONSTRAINT "FK_GlobalSSO_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" DROP CONSTRAINT "FK_GlobalSSO_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "requireSsoWithSsoProviderId"`,
    );
    await queryRunner.query(`DROP TABLE "GlobalOIDCProjectTeam"`);
    await queryRunner.query(`DROP TABLE "GlobalSSOProjectTeam"`);
    await queryRunner.query(`DROP TABLE "GlobalOIDCProject"`);
    await queryRunner.query(`DROP TABLE "GlobalSSOProject"`);
    await queryRunner.query(`DROP TABLE "GlobalOIDC"`);
    await queryRunner.query(`DROP TABLE "GlobalSSO"`);
  }
}
