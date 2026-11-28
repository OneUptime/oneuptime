import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A form's follow-ups (Common/Types/Form/FormFollowUp):
 *
 *   - "FormSubmissionFollower": the people following a form submission, each
 *     with the secret of their link (encrypted, never readable through the
 *     API), one row per submission and address. A new, empty table, so its
 *     indexes and keys are built as generated.
 *   - "FormSubmissionMessage": the conversation of a form submission, new
 *     and empty too.
 *   - "Form"."enableFollowUps": whether the form's submitters can follow
 *     what they sent. Added as false, so every form made before follow-ups
 *     existed keeps telling its submitters nothing - its submitters were
 *     told nothing would be sent to them - and only then given its default
 *     of true, for every form made after. A constant default rewrites
 *     nothing.
 *   - "FormSubmission"."title": the title the submission's record was
 *     created with. Nullable, no default: adding it rewrites nothing.
 */
export class AddFormFollowUps1809188000000 implements MigrationInterface {
  public name = "AddFormFollowUps1809188000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "FormSubmissionFollower" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "formId" uuid NOT NULL, "formSubmissionId" uuid NOT NULL, "email" character varying(100) NOT NULL, "name" character varying(100), "isSubmitter" boolean NOT NULL DEFAULT false, "accessToken" text, CONSTRAINT "PK_2f4186d33137e2c44c2290431d9" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_457b09f9e07c67a423de220e26" ON "FormSubmissionFollower" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ae5cffcdf706a63acd7154e022" ON "FormSubmissionFollower" ("formId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_77a31f9315d4bc8b9d3b47f7ff" ON "FormSubmissionFollower" ("formSubmissionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_67c93dec00fc861ed6a8c14ac3" ON "FormSubmissionFollower" ("email") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_50831f4c3997461da82ae24d85" ON "FormSubmissionFollower" ("formSubmissionId", "email") `,
    );
    await queryRunner.query(
      `CREATE TABLE "FormSubmissionMessage" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "formId" uuid NOT NULL, "formSubmissionId" uuid NOT NULL, "author" character varying(100) NOT NULL, "formSubmissionFollowerId" uuid, "createdByUserId" uuid, "authorName" character varying(100), "authorEmail" character varying(100), "message" text, "files" jsonb, CONSTRAINT "PK_8ec7c89e6243453638dbb4d3ef6" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3aa5bcd5d50e15f0c398013bad" ON "FormSubmissionMessage" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4c08ff9007bcc876ec645025d7" ON "FormSubmissionMessage" ("formId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_623c7daa692134c601105665df" ON "FormSubmissionMessage" ("formSubmissionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2d660e66a07e5dd6571a0ed52c" ON "FormSubmissionMessage" ("formSubmissionFollowerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_31db9fd244bd7a38204bc51238" ON "FormSubmissionMessage" ("formSubmissionId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Form" ADD "enableFollowUps" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Form" ALTER COLUMN "enableFollowUps" SET DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmission" ADD "title" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmissionFollower" ADD CONSTRAINT "FK_457b09f9e07c67a423de220e261" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmissionFollower" ADD CONSTRAINT "FK_ae5cffcdf706a63acd7154e0228" FOREIGN KEY ("formId") REFERENCES "Form"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmissionFollower" ADD CONSTRAINT "FK_77a31f9315d4bc8b9d3b47f7ffe" FOREIGN KEY ("formSubmissionId") REFERENCES "FormSubmission"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmissionMessage" ADD CONSTRAINT "FK_3aa5bcd5d50e15f0c398013bad3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmissionMessage" ADD CONSTRAINT "FK_4c08ff9007bcc876ec645025d71" FOREIGN KEY ("formId") REFERENCES "Form"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmissionMessage" ADD CONSTRAINT "FK_623c7daa692134c601105665df2" FOREIGN KEY ("formSubmissionId") REFERENCES "FormSubmission"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmissionMessage" ADD CONSTRAINT "FK_2d660e66a07e5dd6571a0ed52cd" FOREIGN KEY ("formSubmissionFollowerId") REFERENCES "FormSubmissionFollower"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmissionMessage" ADD CONSTRAINT "FK_127c05136e36524ff9a6a6802cc" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "FormSubmissionMessage" DROP CONSTRAINT "FK_127c05136e36524ff9a6a6802cc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmissionMessage" DROP CONSTRAINT "FK_2d660e66a07e5dd6571a0ed52cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmissionMessage" DROP CONSTRAINT "FK_623c7daa692134c601105665df2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmissionMessage" DROP CONSTRAINT "FK_4c08ff9007bcc876ec645025d71"`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmissionMessage" DROP CONSTRAINT "FK_3aa5bcd5d50e15f0c398013bad3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmissionFollower" DROP CONSTRAINT "FK_77a31f9315d4bc8b9d3b47f7ffe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmissionFollower" DROP CONSTRAINT "FK_ae5cffcdf706a63acd7154e0228"`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmissionFollower" DROP CONSTRAINT "FK_457b09f9e07c67a423de220e261"`,
    );
    await queryRunner.query(`ALTER TABLE "FormSubmission" DROP COLUMN "title"`);
    await queryRunner.query(`ALTER TABLE "Form" DROP COLUMN "enableFollowUps"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_31db9fd244bd7a38204bc51238"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2d660e66a07e5dd6571a0ed52c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_623c7daa692134c601105665df"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4c08ff9007bcc876ec645025d7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3aa5bcd5d50e15f0c398013bad"`,
    );
    await queryRunner.query(`DROP TABLE "FormSubmissionMessage"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_50831f4c3997461da82ae24d85"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_67c93dec00fc861ed6a8c14ac3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_77a31f9315d4bc8b9d3b47f7ff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ae5cffcdf706a63acd7154e022"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_457b09f9e07c67a423de220e26"`,
    );
    await queryRunner.query(`DROP TABLE "FormSubmissionFollower"`);
  }
}
