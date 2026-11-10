import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The owners of a team (#6561): the people (TeamOwnerUser) and the teams
 * (TeamOwnerTeam) who look after it - who is in it and what it may do - with
 * a team permission scoped to Owned. Two new tables, like every other kind's
 * owner tables; the owned team is named by ownedTeamId, as teamId is the
 * owning team's column in every owner table. Nothing existing is changed:
 * every team starts with no owners, and a grant scoped to Owned on a team
 * permission (offered from this release on) reaches only teams with owners.
 */

export class AddTeamOwners1809086561000 implements MigrationInterface {
  public name = "AddTeamOwners1809086561000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "TeamOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "ownedTeamId" uuid NOT NULL, "teamId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_b843ae45463b8d1dabdba836f9f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e2ae2b07bacbc5b3d286058370" ON "TeamOwnerTeam" ("ownedTeamId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "TeamOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "ownedTeamId" uuid NOT NULL, "userId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_a1de4d724453d1f30cae1fa4933" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9c07b22d6d01d1960ef67959c1" ON "TeamOwnerUser" ("ownedTeamId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerTeam" ADD CONSTRAINT "FK_add22326c6dd1f9896cc0e6cf08" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerTeam" ADD CONSTRAINT "FK_fd17284969285e2d83eb8f2c2d1" FOREIGN KEY ("ownedTeamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerTeam" ADD CONSTRAINT "FK_f1eb510186e2316de2746128d2e" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerTeam" ADD CONSTRAINT "FK_e3ce8763f263f9cf6dc3d928b03" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerTeam" ADD CONSTRAINT "FK_61309b4736f744d844842b27c35" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerUser" ADD CONSTRAINT "FK_67d6b6f78da2ef815ba4ed5ef9b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerUser" ADD CONSTRAINT "FK_bc86ce5eb0d3fb95a7c33833e1a" FOREIGN KEY ("ownedTeamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerUser" ADD CONSTRAINT "FK_eedf75f4b2ae940c36f996b2bb9" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerUser" ADD CONSTRAINT "FK_272f014c85c63f490caaed38b69" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerUser" ADD CONSTRAINT "FK_93653d4ff0b783c9ff374d6bcef" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerUser" DROP CONSTRAINT "FK_93653d4ff0b783c9ff374d6bcef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerUser" DROP CONSTRAINT "FK_272f014c85c63f490caaed38b69"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerUser" DROP CONSTRAINT "FK_eedf75f4b2ae940c36f996b2bb9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerUser" DROP CONSTRAINT "FK_bc86ce5eb0d3fb95a7c33833e1a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerUser" DROP CONSTRAINT "FK_67d6b6f78da2ef815ba4ed5ef9b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerTeam" DROP CONSTRAINT "FK_61309b4736f744d844842b27c35"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerTeam" DROP CONSTRAINT "FK_e3ce8763f263f9cf6dc3d928b03"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerTeam" DROP CONSTRAINT "FK_f1eb510186e2316de2746128d2e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerTeam" DROP CONSTRAINT "FK_fd17284969285e2d83eb8f2c2d1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamOwnerTeam" DROP CONSTRAINT "FK_add22326c6dd1f9896cc0e6cf08"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9c07b22d6d01d1960ef67959c1"`,
    );
    await queryRunner.query(`DROP TABLE "TeamOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e2ae2b07bacbc5b3d286058370"`,
    );
    await queryRunner.query(`DROP TABLE "TeamOwnerTeam"`);
  }
}
