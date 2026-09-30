import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. The Queues product's tables:
 *
 *   - MessageQueue: one row per message queue, topic or subscription,
 *     discovered from messaging spans and broker metrics or added by hand.
 *     IDX_message_queue_identifier makes (projectId, queueIdentifier) - the
 *     identity discovery find-or-creates by - unique among live rows, and
 *     IDX_message_queue_slug does the same for the slug; both are partial
 *     and named, so the drift check keeps them;
 *   - MessageQueueOwnerTeam / MessageQueueOwnerUser: owners, one row per
 *     (queue, owner, project), deleted with their queue;
 *   - MessageQueueLabelRule / MessageQueueOwnerRule: label and owner rules
 *     (criteria from the start, so no legacy shadow trigger), with their
 *     label, owner and label-to-add join tables, and the queue's own label
 *     join table MessageQueueLabel.
 */

export class AddMessageQueueTables1796500000000 implements MigrationInterface {
  public name: string = "AddMessageQueueTables1796500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MessageQueue" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "queueIdentifier" character varying(500) NOT NULL, "messagingSystem" character varying(100) NOT NULL, "destinationName" character varying(500) NOT NULL, "brokerScope" character varying(100), "brokerAddress" character varying(500), "discoverySource" character varying(100), "lastSeenAt" TIMESTAMP WITH TIME ZONE, "brokerMetricsLastSeenAt" TIMESTAMP WITH TIME ZONE, "autoArchivedAt" TIMESTAMP WITH TIME ZONE, "manuallyRestoredAt" TIMESTAMP WITH TIME ZONE, "automaticAssignments" jsonb, "createdByUserId" uuid, "isArchived" boolean NOT NULL DEFAULT false, "archivedAt" TIMESTAMP WITH TIME ZONE, "archivedByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_95fb578b37c9d5920ff25d9b0cd" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eff6289e3c5a0fbfe1cba7d139" ON "MessageQueue" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6fe9cd02ac9496156a21c45be9" ON "MessageQueue" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_87a7fc87ba19a8c86377955093" ON "MessageQueue" ("queueIdentifier") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_message_queue_slug" ON "MessageQueue" ("slug") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8f5949c1a3ab01c98f4b85fc7d" ON "MessageQueue" ("projectId", "messagingSystem") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9de1ebfb172b32d329e7ac2995" ON "MessageQueue" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_message_queue_identifier" ON "MessageQueue" ("projectId", "queueIdentifier") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "MessageQueueOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "messageQueueId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_929f08dbc1161c84594a1d54ce4" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_48c9ae2a18267e88e50c1e5a79" ON "MessageQueueOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c14e91c5c0c461f67b8a56834b" ON "MessageQueueOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a91e85b9a0d3a2fd0b730421a" ON "MessageQueueOwnerTeam" ("messageQueueId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_79633da96f362d201a4dcdab19" ON "MessageQueueOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_79946ce05b34eee320a76f06e2" ON "MessageQueueOwnerTeam" ("messageQueueId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MessageQueueOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "messageQueueId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_178302760051f95346d8e4914ac" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c3bf66ec8154cffee4924e65d8" ON "MessageQueueOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a7f6c4a2460ce3af96ccf0c114" ON "MessageQueueOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a327d17c8135514737bd703755" ON "MessageQueueOwnerUser" ("messageQueueId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_303db6cc4666c0cead4846a837" ON "MessageQueueOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_dbca4df62e54ddbcc373eb68d1" ON "MessageQueueOwnerUser" ("messageQueueId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MessageQueueLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "criteria" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "messageQueueNamePattern" character varying(500), "messageQueueDescriptionPattern" character varying(500), "messageQueueSystemPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c1b2db2ae4bc29afdb2fdc12a48" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b11b7b5a07eef29aae400a92c0" ON "MessageQueueLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bb7df6ccf9ad8d401f9548e745" ON "MessageQueueLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_865c54cb04af3f9f71e4f7cd32" ON "MessageQueueLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MessageQueueOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "criteria" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "messageQueueNamePattern" character varying(500), "messageQueueDescriptionPattern" character varying(500), "messageQueueSystemPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_bee4bfe9da85a4996019a4b1265" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_31fff5581283a4f0de92f7a728" ON "MessageQueueOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3d44a73a343c29f227a2e5833a" ON "MessageQueueOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f08bc38c2df218fd3691b4226d" ON "MessageQueueOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MessageQueueLabel" ("messageQueueId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_8fa11f937732c5b7a78aeac7ea0" PRIMARY KEY ("messageQueueId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e0c0888a3bd97bd57337948d35" ON "MessageQueueLabel" ("messageQueueId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bdaa318ef505b4bdb9edd66bf0" ON "MessageQueueLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MessageQueueLabelRuleMessageQueueLabel" ("messageQueueLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_1b5d24d0c7dc28f4badbf377ef1" PRIMARY KEY ("messageQueueLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b5de0b0621bca674c42407e39f" ON "MessageQueueLabelRuleMessageQueueLabel" ("messageQueueLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_66cfe08cfa1b076a51f5f78d73" ON "MessageQueueLabelRuleMessageQueueLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MessageQueueLabelRuleLabelToAdd" ("messageQueueLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_589aecd003e4cb65890d3109c76" PRIMARY KEY ("messageQueueLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4120d034c18644a01582bac339" ON "MessageQueueLabelRuleLabelToAdd" ("messageQueueLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_927ce63f94b24e467dea10d1e0" ON "MessageQueueLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MessageQueueOwnerRuleMessageQueueLabel" ("messageQueueOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_17f09f951601a59dc101315d3e9" PRIMARY KEY ("messageQueueOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_19b77e48c19c6395465892c880" ON "MessageQueueOwnerRuleMessageQueueLabel" ("messageQueueOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_07662045ecc8f6db06ec31acd1" ON "MessageQueueOwnerRuleMessageQueueLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MessageQueueOwnerRuleOwnerUser" ("messageQueueOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_421029d6b9e83c34a705f3e47e6" PRIMARY KEY ("messageQueueOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f7f06623b76a3a3d0e079f87f8" ON "MessageQueueOwnerRuleOwnerUser" ("messageQueueOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_38c4d760e665f1ffed8d5c0629" ON "MessageQueueOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MessageQueueOwnerRuleOwnerTeam" ("messageQueueOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_3ae379fd7304f5ee55c0417e9df" PRIMARY KEY ("messageQueueOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_58496c6c998cf313ce678fb8e7" ON "MessageQueueOwnerRuleOwnerTeam" ("messageQueueOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bf2b5909ba853876ec73e2df87" ON "MessageQueueOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueue" ADD CONSTRAINT "FK_eff6289e3c5a0fbfe1cba7d1390" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueue" ADD CONSTRAINT "FK_53fac546b509c2edd3c4f8e84f6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueue" ADD CONSTRAINT "FK_10b1329b3f3ae3ab72de764696e" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueue" ADD CONSTRAINT "FK_071b13be3db2998d57ec46e1879" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerTeam" ADD CONSTRAINT "FK_48c9ae2a18267e88e50c1e5a797" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerTeam" ADD CONSTRAINT "FK_c14e91c5c0c461f67b8a56834b7" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerTeam" ADD CONSTRAINT "FK_4a91e85b9a0d3a2fd0b730421a5" FOREIGN KEY ("messageQueueId") REFERENCES "MessageQueue"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerTeam" ADD CONSTRAINT "FK_12929913f87e80a79f25852bede" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerTeam" ADD CONSTRAINT "FK_bb6282db18362c85265a4ca9e0e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerUser" ADD CONSTRAINT "FK_c3bf66ec8154cffee4924e65d87" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerUser" ADD CONSTRAINT "FK_a7f6c4a2460ce3af96ccf0c114e" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerUser" ADD CONSTRAINT "FK_a327d17c8135514737bd7037550" FOREIGN KEY ("messageQueueId") REFERENCES "MessageQueue"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerUser" ADD CONSTRAINT "FK_35896080dcc9c8bc810d1769bcd" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerUser" ADD CONSTRAINT "FK_23795f3bc45331aaa14573b7318" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabelRule" ADD CONSTRAINT "FK_b11b7b5a07eef29aae400a92c02" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabelRule" ADD CONSTRAINT "FK_71b322853594a08e2e09580e2af" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabelRule" ADD CONSTRAINT "FK_0356f7c46318b6f84e72d529f99" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRule" ADD CONSTRAINT "FK_31fff5581283a4f0de92f7a7280" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRule" ADD CONSTRAINT "FK_8006bf67a49aa2e996ce5089881" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRule" ADD CONSTRAINT "FK_16a8f9a34efdfdd69cd1d3b5288" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabel" ADD CONSTRAINT "FK_e0c0888a3bd97bd57337948d351" FOREIGN KEY ("messageQueueId") REFERENCES "MessageQueue"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabel" ADD CONSTRAINT "FK_bdaa318ef505b4bdb9edd66bf0d" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabelRuleMessageQueueLabel" ADD CONSTRAINT "FK_b5de0b0621bca674c42407e39f9" FOREIGN KEY ("messageQueueLabelRuleId") REFERENCES "MessageQueueLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabelRuleMessageQueueLabel" ADD CONSTRAINT "FK_66cfe08cfa1b076a51f5f78d731" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabelRuleLabelToAdd" ADD CONSTRAINT "FK_4120d034c18644a01582bac339d" FOREIGN KEY ("messageQueueLabelRuleId") REFERENCES "MessageQueueLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabelRuleLabelToAdd" ADD CONSTRAINT "FK_927ce63f94b24e467dea10d1e02" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRuleMessageQueueLabel" ADD CONSTRAINT "FK_19b77e48c19c6395465892c8806" FOREIGN KEY ("messageQueueOwnerRuleId") REFERENCES "MessageQueueOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRuleMessageQueueLabel" ADD CONSTRAINT "FK_07662045ecc8f6db06ec31acd18" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRuleOwnerUser" ADD CONSTRAINT "FK_f7f06623b76a3a3d0e079f87f86" FOREIGN KEY ("messageQueueOwnerRuleId") REFERENCES "MessageQueueOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRuleOwnerUser" ADD CONSTRAINT "FK_38c4d760e665f1ffed8d5c06299" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_58496c6c998cf313ce678fb8e78" FOREIGN KEY ("messageQueueOwnerRuleId") REFERENCES "MessageQueueOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_bf2b5909ba853876ec73e2df876" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_bf2b5909ba853876ec73e2df876"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_58496c6c998cf313ce678fb8e78"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRuleOwnerUser" DROP CONSTRAINT "FK_38c4d760e665f1ffed8d5c06299"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRuleOwnerUser" DROP CONSTRAINT "FK_f7f06623b76a3a3d0e079f87f86"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRuleMessageQueueLabel" DROP CONSTRAINT "FK_07662045ecc8f6db06ec31acd18"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRuleMessageQueueLabel" DROP CONSTRAINT "FK_19b77e48c19c6395465892c8806"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabelRuleLabelToAdd" DROP CONSTRAINT "FK_927ce63f94b24e467dea10d1e02"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabelRuleLabelToAdd" DROP CONSTRAINT "FK_4120d034c18644a01582bac339d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabelRuleMessageQueueLabel" DROP CONSTRAINT "FK_66cfe08cfa1b076a51f5f78d731"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabelRuleMessageQueueLabel" DROP CONSTRAINT "FK_b5de0b0621bca674c42407e39f9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabel" DROP CONSTRAINT "FK_bdaa318ef505b4bdb9edd66bf0d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabel" DROP CONSTRAINT "FK_e0c0888a3bd97bd57337948d351"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRule" DROP CONSTRAINT "FK_16a8f9a34efdfdd69cd1d3b5288"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRule" DROP CONSTRAINT "FK_8006bf67a49aa2e996ce5089881"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerRule" DROP CONSTRAINT "FK_31fff5581283a4f0de92f7a7280"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabelRule" DROP CONSTRAINT "FK_0356f7c46318b6f84e72d529f99"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabelRule" DROP CONSTRAINT "FK_71b322853594a08e2e09580e2af"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueLabelRule" DROP CONSTRAINT "FK_b11b7b5a07eef29aae400a92c02"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerUser" DROP CONSTRAINT "FK_23795f3bc45331aaa14573b7318"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerUser" DROP CONSTRAINT "FK_35896080dcc9c8bc810d1769bcd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerUser" DROP CONSTRAINT "FK_a327d17c8135514737bd7037550"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerUser" DROP CONSTRAINT "FK_a7f6c4a2460ce3af96ccf0c114e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerUser" DROP CONSTRAINT "FK_c3bf66ec8154cffee4924e65d87"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerTeam" DROP CONSTRAINT "FK_bb6282db18362c85265a4ca9e0e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerTeam" DROP CONSTRAINT "FK_12929913f87e80a79f25852bede"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerTeam" DROP CONSTRAINT "FK_4a91e85b9a0d3a2fd0b730421a5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerTeam" DROP CONSTRAINT "FK_c14e91c5c0c461f67b8a56834b7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueueOwnerTeam" DROP CONSTRAINT "FK_48c9ae2a18267e88e50c1e5a797"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueue" DROP CONSTRAINT "FK_071b13be3db2998d57ec46e1879"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueue" DROP CONSTRAINT "FK_10b1329b3f3ae3ab72de764696e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueue" DROP CONSTRAINT "FK_53fac546b509c2edd3c4f8e84f6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MessageQueue" DROP CONSTRAINT "FK_eff6289e3c5a0fbfe1cba7d1390"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bf2b5909ba853876ec73e2df87"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_58496c6c998cf313ce678fb8e7"`,
    );
    await queryRunner.query(`DROP TABLE "MessageQueueOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_38c4d760e665f1ffed8d5c0629"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f7f06623b76a3a3d0e079f87f8"`,
    );
    await queryRunner.query(`DROP TABLE "MessageQueueOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_07662045ecc8f6db06ec31acd1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_19b77e48c19c6395465892c880"`,
    );
    await queryRunner.query(
      `DROP TABLE "MessageQueueOwnerRuleMessageQueueLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_927ce63f94b24e467dea10d1e0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4120d034c18644a01582bac339"`,
    );
    await queryRunner.query(`DROP TABLE "MessageQueueLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_66cfe08cfa1b076a51f5f78d73"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b5de0b0621bca674c42407e39f"`,
    );
    await queryRunner.query(
      `DROP TABLE "MessageQueueLabelRuleMessageQueueLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bdaa318ef505b4bdb9edd66bf0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e0c0888a3bd97bd57337948d35"`,
    );
    await queryRunner.query(`DROP TABLE "MessageQueueLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f08bc38c2df218fd3691b4226d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3d44a73a343c29f227a2e5833a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_31fff5581283a4f0de92f7a728"`,
    );
    await queryRunner.query(`DROP TABLE "MessageQueueOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_865c54cb04af3f9f71e4f7cd32"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bb7df6ccf9ad8d401f9548e745"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b11b7b5a07eef29aae400a92c0"`,
    );
    await queryRunner.query(`DROP TABLE "MessageQueueLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dbca4df62e54ddbcc373eb68d1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_303db6cc4666c0cead4846a837"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a327d17c8135514737bd703755"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a7f6c4a2460ce3af96ccf0c114"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c3bf66ec8154cffee4924e65d8"`,
    );
    await queryRunner.query(`DROP TABLE "MessageQueueOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_79946ce05b34eee320a76f06e2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_79633da96f362d201a4dcdab19"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a91e85b9a0d3a2fd0b730421a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c14e91c5c0c461f67b8a56834b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_48c9ae2a18267e88e50c1e5a79"`,
    );
    await queryRunner.query(`DROP TABLE "MessageQueueOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_message_queue_identifier"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9de1ebfb172b32d329e7ac2995"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8f5949c1a3ab01c98f4b85fc7d"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_message_queue_slug"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_87a7fc87ba19a8c86377955093"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6fe9cd02ac9496156a21c45be9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eff6289e3c5a0fbfe1cba7d139"`,
    );
    await queryRunner.query(`DROP TABLE "MessageQueue"`);
  }
}
