import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data Security (DSPM), generated with npm run generate-postgres-migration:
 *
 *   - "DataStore": every bucket, database, warehouse and telemetry stream
 *     Data Security watches (unique per project and store key), with its
 *     labels ("DataStoreLabel"), owners ("DataStoreOwnerUser",
 *     "DataStoreOwnerTeam"), owner and label rules and their join tables,
 *     and its feed ("DataStoreFeed");
 *   - "DataStoreFinding" and "DataStoreAccess": what was found in each
 *     store, and who can reach it;
 *   - "DataSecurityFlow", "DataSecurityIssue" with "DataSecurityIssueFeed",
 *     and "DataSecurityScan": where data goes, what is wrong, and what each
 *     scan read;
 *   - "DataSecurityCustomDataType", "DataSecurityCheckSetting",
 *     "DataSecurityResidencyRule" and "DataSecuritySetting": what a project
 *     tunes.
 *
 * Every table is new, so its indexes and foreign keys are built here, in
 * the migration's transaction.
 */

export class AddDataSecurity1808400000000 implements MigrationInterface {
  public name: string = "AddDataSecurity1808400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataStore" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(500) NOT NULL, "description" character varying(500), "storeKey" character varying(500) NOT NULL, "kind" character varying(100) NOT NULL, "provider" character varying(100), "family" character varying(100), "discoveredFrom" character varying(100), "cloudAccountId" uuid, "cloudResourceId" uuid, "cloudConnectionId" uuid, "databaseServerId" uuid, "serviceId" uuid, "providerResourceId" character varying(500), "cloudAccountNumber" character varying(100), "region" character varying(100), "environment" character varying(100) NOT NULL DEFAULT 'Unknown', "sensitivity" character varying(100) NOT NULL DEFAULT 'Public', "sensitivityOverride" character varying(100), "dataTypeIds" jsonb, "dataCategories" jsonb, "subjectCountries" jsonb, "exposure" character varying(100) NOT NULL DEFAULT 'Unknown', "posture" jsonb, "fingerprints" jsonb, "cloudTags" jsonb, "sizeInBytes" bigint, "objectCount" bigint, "estimatedRecords" bigint, "lastActivityAt" TIMESTAMP WITH TIME ZONE, "isPublicByDesign" boolean NOT NULL DEFAULT false, "isAiData" boolean NOT NULL DEFAULT false, "isContentScanEnabled" boolean NOT NULL DEFAULT true, "scanProbeId" uuid, "probeConnectionVariable" character varying(100), "connectionString" text, "scanExclusions" jsonb, "purpose" character varying(500), "retention" character varying(100), "configurationReadAt" TIMESTAMP WITH TIME ZONE, "contentScannedAt" TIMESTAMP WITH TIME ZONE, "contentScanStatus" character varying(100), "nextContentScanAt" TIMESTAMP WITH TIME ZONE, "contentScanState" jsonb, "findingCount" integer NOT NULL DEFAULT '0', "openIssueCount" integer NOT NULL DEFAULT '0', "highestIssueSeverity" character varying(100), "riskScore" integer NOT NULL DEFAULT '0', "isArchived" boolean NOT NULL DEFAULT false, "firstSeenAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_8700f0e61458c76587839e266ce" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aa63a88400669a8862180c81d6" ON "DataStore" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_45459983d69d8de2dc679eb673" ON "DataStore" ("cloudAccountId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bd21cd0f465d5ad76b9cab4b8e" ON "DataStore" ("cloudResourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_72846e5c5b31d0b7396389e660" ON "DataStore" ("cloudConnectionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1a1f987bd8b704ced4ce37f85b" ON "DataStore" ("databaseServerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9afc591919e5c7ae715777dc57" ON "DataStore" ("serviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a7cca3198dddafded2adfdc85b" ON "DataStore" ("scanProbeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1b5b3e965f456a9fd1f1a94a4d" ON "DataStore" ("nextContentScanAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_089b4dd9a7d0b5d85456e9c9d1" ON "DataStore" ("riskScore") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_881fd8377edf3303b49ad06906" ON "DataStore" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_97a7dd37fb8e0f4d6ec0c1e0c7" ON "DataStore" ("projectId", "kind") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_04318c306a040953f53bfd79bb" ON "DataStore" ("projectId", "sensitivity") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_bc7cb382e4ad89bbfb4b2a2147" ON "DataStore" ("projectId", "storeKey") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataSecurityScan" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dataStoreId" uuid, "cloudConnectionId" uuid, "probeId" uuid, "kind" character varying(100) NOT NULL, "status" character varying(100) NOT NULL, "startedAt" TIMESTAMP WITH TIME ZONE, "finishedAt" TIMESTAMP WITH TIME ZONE, "durationInMs" integer NOT NULL DEFAULT '0', "storesRead" integer NOT NULL DEFAULT '0', "objectsRead" bigint, "rowsRead" bigint, "bytesRead" bigint, "findingsFound" integer NOT NULL DEFAULT '0', "readLog" jsonb, "warnings" jsonb, "errorMessage" character varying(500), CONSTRAINT "PK_3428dcdf6ea2e579c67e05e4f23" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fa8e481d65cefd8a92ce04a576" ON "DataSecurityScan" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_658112b6de186062f4d191faee" ON "DataSecurityScan" ("dataStoreId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_759a81382c7c5d61b2e25c254b" ON "DataSecurityScan" ("cloudConnectionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a808d7ca7f80f20a6a05a5b7b5" ON "DataSecurityScan" ("probeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ab3871fb44791b7f1433e7f83b" ON "DataSecurityScan" ("dataStoreId", "startedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d5cbbd8d97d82a96578ab714f7" ON "DataSecurityScan" ("projectId", "startedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataStoreFinding" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dataStoreId" uuid NOT NULL, "findingKey" character varying(500) NOT NULL, "dataTypeId" character varying(100) NOT NULL, "dataTypeName" character varying(100), "dataCategory" character varying(100), "sensitivity" character varying(100), "location" character varying(500) NOT NULL, "locationKind" character varying(100), "confidence" character varying(100) NOT NULL DEFAULT 'Low', "matchCount" integer NOT NULL DEFAULT '0', "valueCount" integer NOT NULL DEFAULT '0', "matchPercent" integer NOT NULL DEFAULT '0', "distinctValues" integer NOT NULL DEFAULT '0', "testValueCount" integer NOT NULL DEFAULT '0', "maskedSamples" jsonb, "isFreeText" boolean NOT NULL DEFAULT false, "isNameHinted" boolean NOT NULL DEFAULT false, "isFoundByName" boolean NOT NULL DEFAULT false, "isScrubbed" boolean NOT NULL DEFAULT false, "isSuppressed" boolean NOT NULL DEFAULT false, "suppressedReason" character varying(500), "lastScanId" uuid, "firstSeenAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_9724b79bc5e5416c019fb200b6e" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_629dc8071197ba50e4f8742ea6" ON "DataStoreFinding" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_893a91b9d9cabd31e405359aef" ON "DataStoreFinding" ("dataStoreId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f12c6165266900e82a35175b6c" ON "DataStoreFinding" ("lastScanId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6dd7bc9d76f44dc3d5eba047b6" ON "DataStoreFinding" ("lastSeenAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a6dbb60ba17a6cbfd73e8702a" ON "DataStoreFinding" ("projectId", "sensitivity") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7a5b994bb36cc4fa7093d02d2b" ON "DataStoreFinding" ("projectId", "dataTypeId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_33ea233e71b8a03e83209fff8c" ON "DataStoreFinding" ("dataStoreId", "findingKey") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataStoreAccess" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dataStoreId" uuid NOT NULL, "accessKey" character varying(500) NOT NULL, "principal" character varying(500) NOT NULL, "principalName" character varying(500), "principalType" character varying(100), "accessLevel" character varying(100), "grantedVia" character varying(500), "isExternal" boolean NOT NULL DEFAULT false, "isPublic" boolean NOT NULL DEFAULT false, "isSeenInTraces" boolean NOT NULL DEFAULT false, "lastUsedAt" TIMESTAMP WITH TIME ZONE, "firstSeenAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ffcd75b7effd24dd11fc5e88943" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0987180e2095390dd8733ba9a9" ON "DataStoreAccess" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5016e0f279409add622d2d481b" ON "DataStoreAccess" ("dataStoreId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8fa37281fbcb7a1ce63dc418ab" ON "DataStoreAccess" ("lastSeenAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d21cb560934b11b402eb2ee948" ON "DataStoreAccess" ("projectId", "principal") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_cc40a7a8db82d255c8d99fea51" ON "DataStoreAccess" ("dataStoreId", "accessKey") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataStoreFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dataStoreId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "dataStoreFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_11615d98a5a75137788d9b4bc01" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a0618fbe4c5d608596676cf78" ON "DataStoreFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_33ba947dcb717fb63951954e12" ON "DataStoreFeed" ("dataStoreId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1d965e5aeb0eb5cfeda8e18dda" ON "DataStoreFeed" ("dataStoreId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataStoreOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "dataStoreId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_075bf75e9d4ad6024d6e6d53c33" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3b800a35833110ccd7459d574d" ON "DataStoreOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ed84d8a1a9e6047cfa3b60e324" ON "DataStoreOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5ded479a4e1d523c0a0373a3fd" ON "DataStoreOwnerUser" ("dataStoreId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a144874033c1cfc343a75c60a8" ON "DataStoreOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a09f7bd99a40da8aed3d43a4b9" ON "DataStoreOwnerUser" ("dataStoreId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataStoreOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "dataStoreId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_a97c49b8c56f86540200edcf9e7" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f15e4380dd60c79fb9341d87e0" ON "DataStoreOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a9125653254bd7d688c19932df" ON "DataStoreOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_729bbd1df03a802af9d3136bf9" ON "DataStoreOwnerTeam" ("dataStoreId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bd90846d35faf462c7ac25ba61" ON "DataStoreOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7a3e0aaa7eb7118473856753af" ON "DataStoreOwnerTeam" ("dataStoreId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataStoreOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "criteria" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "nameRegexPattern" character varying(500), "cloudTagPattern" character varying(500), "descriptionRegexPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_e491d2233e4136d6528776e7673" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6f859fa96aa5e5504e8d5c112f" ON "DataStoreOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c7bbbee2298fa48dda50e9c297" ON "DataStoreOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3c65913135664ce61c4a408323" ON "DataStoreOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataStoreLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "criteria" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "nameRegexPattern" character varying(500), "cloudTagPattern" character varying(500), "descriptionRegexPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_65dd59b11af1f3b0a27ae7a4549" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_43ac69d249410e3df0503ca24c" ON "DataStoreLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_15550c60dc2dbe319066eccd2e" ON "DataStoreLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_094fe58d491e5ea331c5b94bd1" ON "DataStoreLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataSecurityFlow" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "flowKey" character varying(500) NOT NULL, "kind" character varying(100) NOT NULL, "sourceDataStoreId" uuid, "serviceId" uuid, "destinationDataStoreId" uuid, "destination" character varying(500), "dataTypeIds" jsonb, "sensitivity" character varying(100) NOT NULL DEFAULT 'Public', "isConfirmed" boolean NOT NULL DEFAULT false, "overlapPercent" integer NOT NULL DEFAULT '0', "callCount" integer NOT NULL DEFAULT '0', "firstSeenAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_824c2a626d70a8d9defc260c872" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d76fe1fcf854d9f0de25203b32" ON "DataSecurityFlow" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0862435eda7a6da0f5870e917e" ON "DataSecurityFlow" ("sourceDataStoreId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7cece5df5ecb53f69d4c6d84c3" ON "DataSecurityFlow" ("serviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_48582d949e1eac50ab236ff484" ON "DataSecurityFlow" ("destinationDataStoreId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7c2aa8ed0737f3e1c5a18220c6" ON "DataSecurityFlow" ("lastSeenAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f0d96938ef44379a7d91b93375" ON "DataSecurityFlow" ("projectId", "sourceDataStoreId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_80e8b3f8c0b7efc32eda30bdf3" ON "DataSecurityFlow" ("projectId", "flowKey") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataSecurityIssue" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dataStoreId" uuid NOT NULL, "issueKey" character varying(500) NOT NULL, "checkId" character varying(100) NOT NULL, "checkGroup" character varying(100), "title" character varying(500) NOT NULL, "evidence" character varying(500), "severity" character varying(100) NOT NULL, "riskScore" integer NOT NULL DEFAULT '0', "riskFactors" jsonb, "status" character varying(100) NOT NULL DEFAULT 'Open', "dataTypeIds" jsonb, "frameworks" jsonb, "acceptedReason" character varying(500), "acceptedUntil" TIMESTAMP WITH TIME ZONE, "acceptedByUserId" uuid, "assignedToUserId" uuid, "assignedToTeamId" uuid, "securityCaseId" uuid, "alertId" uuid, "firstDetectedAt" TIMESTAMP WITH TIME ZONE, "lastDetectedAt" TIMESTAMP WITH TIME ZONE, "resolvedAt" TIMESTAMP WITH TIME ZONE, "reopenCount" integer NOT NULL DEFAULT '0', "recheckRequestedAt" TIMESTAMP WITH TIME ZONE, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_b5405275312212088f18cd95040" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_53677404a91008b1c31f9761e4" ON "DataSecurityIssue" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b697f3bdbb56641893e3c924a5" ON "DataSecurityIssue" ("dataStoreId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12cb92ec20d32fc8a75dd516a2" ON "DataSecurityIssue" ("severity") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a415a89896a54f2751f25e0d1" ON "DataSecurityIssue" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_050ca7360f898a939c1de2b4ae" ON "DataSecurityIssue" ("acceptedByUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b0e36a923ee6163cf68149a384" ON "DataSecurityIssue" ("assignedToUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1e8005f1126b4748b7c1b3d04d" ON "DataSecurityIssue" ("assignedToTeamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0ef86fd03b0659c069e432e8b7" ON "DataSecurityIssue" ("securityCaseId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d9238e6b34871a474b4edffad6" ON "DataSecurityIssue" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b7c5156798400575b443f4ad89" ON "DataSecurityIssue" ("lastDetectedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0e855374c7aaa59a1fea945d15" ON "DataSecurityIssue" ("projectId", "riskScore") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_287040c2cc7047ef9683e07af5" ON "DataSecurityIssue" ("projectId", "status", "severity") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a2dd817c178671888965b23edd" ON "DataSecurityIssue" ("projectId", "issueKey") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataSecurityIssueFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dataSecurityIssueId" uuid NOT NULL, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "dataSecurityIssueFeedEventType" character varying(100) NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_b29fc1b50ab09e956aa3a744b92" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8b43e35dba0e14480e772c549b" ON "DataSecurityIssueFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_baf2d307e8233b40a9d8022ab8" ON "DataSecurityIssueFeed" ("dataSecurityIssueId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_84fb8a1980ded5b4a693ecfd6a" ON "DataSecurityIssueFeed" ("dataSecurityIssueId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataSecurityCustomDataType" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "category" character varying(100) NOT NULL, "sensitivity" character varying(100) NOT NULL, "pattern" character varying(500), "ignoreCase" boolean NOT NULL DEFAULT false, "keywords" jsonb, "requiresKeyword" boolean NOT NULL DEFAULT false, "nameHints" jsonb, "validator" character varying(100) NOT NULL DEFAULT 'None', "isEnabled" boolean NOT NULL DEFAULT true, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_ac2aa7cfad63a490a4ab9281f79" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_adfbda40ca0bd3cf0ec2901626" ON "DataSecurityCustomDataType" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4fc79a3f3869c3b7f6f0c5a45c" ON "DataSecurityCustomDataType" ("projectId", "name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataSecurityCheckSetting" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "checkId" character varying(100) NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "severityOverride" character varying(100), "note" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_1b9f7cecf8de29ceae958bcfcac" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_895894a59da020039789524600" ON "DataSecurityCheckSetting" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c661b586630cffb688cd9106e2" ON "DataSecurityCheckSetting" ("projectId", "checkId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataSecurityResidencyRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "dataCategories" jsonb, "subjectCountries" jsonb, "allowedRegions" jsonb NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_6172e2ae7471c6258ed041abe31" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_085717f1cebeca81bd6591e6b9" ON "DataSecurityResidencyRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_58f577578de1f7b5f915065ae1" ON "DataSecurityResidencyRule" ("projectId", "name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataSecuritySetting" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "isConfigurationScanEnabled" boolean NOT NULL DEFAULT true, "isContentScanEnabled" boolean NOT NULL DEFAULT true, "isTelemetryScanEnabled" boolean NOT NULL DEFAULT true, "keepMaskedSamples" boolean NOT NULL DEFAULT true, "openCasesForCriticalIssues" boolean NOT NULL DEFAULT true, "raiseAlertsForCriticalIssues" boolean NOT NULL DEFAULT false, "alertSeverityId" uuid, "notifyOwners" boolean NOT NULL DEFAULT true, "maxObjectsPerScan" integer NOT NULL DEFAULT '2000', "maxBytesPerObject" integer NOT NULL DEFAULT '65536', "maxBytesPerScan" integer NOT NULL DEFAULT '52428800', "maxRowsPerTable" integer NOT NULL DEFAULT '1000', "maxTablesPerScan" integer NOT NULL DEFAULT '200', "telemetrySampleSize" integer NOT NULL DEFAULT '500', "contentScanIntervalInHours" integer NOT NULL DEFAULT '24', "allowedValues" jsonb, "disabledDataTypeIds" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_019f7d41e8de2d25fde8ded34eb" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_00931318804914c67e4112a7e1" ON "DataSecuritySetting" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_cec723790db5e45f093276c4e8" ON "DataSecuritySetting" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataStoreLabel" ("dataStoreId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_fe3653bf13ab0a7ab7ea4ecb6fc" PRIMARY KEY ("dataStoreId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a8991dad9d40cf0604b214de63" ON "DataStoreLabel" ("dataStoreId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7a3df30cf439dfd8cff2c81030" ON "DataStoreLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataStoreOwnerRuleMatchLabel" ("dataStoreOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_1f78b29c27e2ccb441ff228d46c" PRIMARY KEY ("dataStoreOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_550465bf89a95b19c785c76169" ON "DataStoreOwnerRuleMatchLabel" ("dataStoreOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0e9d77821dd832a4c87f93195b" ON "DataStoreOwnerRuleMatchLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataStoreOwnerRuleUser" ("dataStoreOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_bdd0f59a14532e173f40b75b5f0" PRIMARY KEY ("dataStoreOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e10b7abd39b26f627ab9595943" ON "DataStoreOwnerRuleUser" ("dataStoreOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7f5fa8c31750e423389ddc11d8" ON "DataStoreOwnerRuleUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataStoreOwnerRuleTeam" ("dataStoreOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_fd4448c2cad9900f0b78673aaa4" PRIMARY KEY ("dataStoreOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8271d3415f70cc14fa7f5aab42" ON "DataStoreOwnerRuleTeam" ("dataStoreOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e8df1f03cb7cd0e7e576b8173a" ON "DataStoreOwnerRuleTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataStoreLabelRuleMatchLabel" ("dataStoreLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_9828355353e36d8428dc8e6ec90" PRIMARY KEY ("dataStoreLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_394207950a706724774708d260" ON "DataStoreLabelRuleMatchLabel" ("dataStoreLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_99f7279a2e743efd005236d644" ON "DataStoreLabelRuleMatchLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataStoreLabelRuleAddLabel" ("dataStoreLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_e59f75202d0cc09e2ccb79b439b" PRIMARY KEY ("dataStoreLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9eee7e713e6b7fa88b9428721e" ON "DataStoreLabelRuleAddLabel" ("dataStoreLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3dcb7fbd18c4606a46b45e3e2e" ON "DataStoreLabelRuleAddLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD CONSTRAINT "FK_aa63a88400669a8862180c81d65" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD CONSTRAINT "FK_45459983d69d8de2dc679eb673d" FOREIGN KEY ("cloudAccountId") REFERENCES "CloudAccount"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD CONSTRAINT "FK_bd21cd0f465d5ad76b9cab4b8e4" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD CONSTRAINT "FK_72846e5c5b31d0b7396389e6607" FOREIGN KEY ("cloudConnectionId") REFERENCES "CloudConnection"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD CONSTRAINT "FK_1a1f987bd8b704ced4ce37f85b2" FOREIGN KEY ("databaseServerId") REFERENCES "DatabaseServer"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD CONSTRAINT "FK_9afc591919e5c7ae715777dc570" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD CONSTRAINT "FK_a7cca3198dddafded2adfdc85bc" FOREIGN KEY ("scanProbeId") REFERENCES "Probe"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD CONSTRAINT "FK_468df3ec3887a1e227728bbd186" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD CONSTRAINT "FK_83129fdd882360c24ad81d61dfa" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityScan" ADD CONSTRAINT "FK_fa8e481d65cefd8a92ce04a576e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityScan" ADD CONSTRAINT "FK_658112b6de186062f4d191faee3" FOREIGN KEY ("dataStoreId") REFERENCES "DataStore"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityScan" ADD CONSTRAINT "FK_759a81382c7c5d61b2e25c254bb" FOREIGN KEY ("cloudConnectionId") REFERENCES "CloudConnection"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityScan" ADD CONSTRAINT "FK_a808d7ca7f80f20a6a05a5b7b56" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD CONSTRAINT "FK_629dc8071197ba50e4f8742ea68" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD CONSTRAINT "FK_893a91b9d9cabd31e405359aef0" FOREIGN KEY ("dataStoreId") REFERENCES "DataStore"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD CONSTRAINT "FK_f12c6165266900e82a35175b6cb" FOREIGN KEY ("lastScanId") REFERENCES "DataSecurityScan"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreAccess" ADD CONSTRAINT "FK_0987180e2095390dd8733ba9a99" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreAccess" ADD CONSTRAINT "FK_5016e0f279409add622d2d481b8" FOREIGN KEY ("dataStoreId") REFERENCES "DataStore"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFeed" ADD CONSTRAINT "FK_4a0618fbe4c5d608596676cf78a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFeed" ADD CONSTRAINT "FK_33ba947dcb717fb63951954e12b" FOREIGN KEY ("dataStoreId") REFERENCES "DataStore"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFeed" ADD CONSTRAINT "FK_c0d7df6d0e52ebbe7e0f4113862" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFeed" ADD CONSTRAINT "FK_8c145fde71dbd387fb5c3abfdfc" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFeed" ADD CONSTRAINT "FK_98aa54e732a07025069988bdf3a" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerUser" ADD CONSTRAINT "FK_3b800a35833110ccd7459d574d9" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerUser" ADD CONSTRAINT "FK_ed84d8a1a9e6047cfa3b60e3240" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerUser" ADD CONSTRAINT "FK_5ded479a4e1d523c0a0373a3fd2" FOREIGN KEY ("dataStoreId") REFERENCES "DataStore"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerUser" ADD CONSTRAINT "FK_a46aab7814032fdf1aa68e5b414" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerUser" ADD CONSTRAINT "FK_761feae8872872ef1bfc67505cb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerTeam" ADD CONSTRAINT "FK_f15e4380dd60c79fb9341d87e0c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerTeam" ADD CONSTRAINT "FK_a9125653254bd7d688c19932df1" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerTeam" ADD CONSTRAINT "FK_729bbd1df03a802af9d3136bf9f" FOREIGN KEY ("dataStoreId") REFERENCES "DataStore"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerTeam" ADD CONSTRAINT "FK_0d8439788c23a8e6a690d1b7d0a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerTeam" ADD CONSTRAINT "FK_efa181757c04914f20808d4a008" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRule" ADD CONSTRAINT "FK_6f859fa96aa5e5504e8d5c112fd" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRule" ADD CONSTRAINT "FK_d4841c015aede1f30b35cb6954a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRule" ADD CONSTRAINT "FK_da350656c17bacd22ca50688a25" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabelRule" ADD CONSTRAINT "FK_43ac69d249410e3df0503ca24ca" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabelRule" ADD CONSTRAINT "FK_3410db59cd4bced80d461fc347e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabelRule" ADD CONSTRAINT "FK_71ccb165f56df859f92c7b62dff" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityFlow" ADD CONSTRAINT "FK_d76fe1fcf854d9f0de25203b328" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityFlow" ADD CONSTRAINT "FK_0862435eda7a6da0f5870e917ea" FOREIGN KEY ("sourceDataStoreId") REFERENCES "DataStore"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityFlow" ADD CONSTRAINT "FK_7cece5df5ecb53f69d4c6d84c3d" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityFlow" ADD CONSTRAINT "FK_48582d949e1eac50ab236ff4842" FOREIGN KEY ("destinationDataStoreId") REFERENCES "DataStore"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD CONSTRAINT "FK_53677404a91008b1c31f9761e4f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD CONSTRAINT "FK_b697f3bdbb56641893e3c924a5b" FOREIGN KEY ("dataStoreId") REFERENCES "DataStore"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD CONSTRAINT "FK_050ca7360f898a939c1de2b4aec" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD CONSTRAINT "FK_b0e36a923ee6163cf68149a3849" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD CONSTRAINT "FK_1e8005f1126b4748b7c1b3d04d0" FOREIGN KEY ("assignedToTeamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD CONSTRAINT "FK_0ef86fd03b0659c069e432e8b79" FOREIGN KEY ("securityCaseId") REFERENCES "SecurityCase"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" ADD CONSTRAINT "FK_d9238e6b34871a474b4edffad68" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssueFeed" ADD CONSTRAINT "FK_8b43e35dba0e14480e772c549b9" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssueFeed" ADD CONSTRAINT "FK_baf2d307e8233b40a9d8022ab8d" FOREIGN KEY ("dataSecurityIssueId") REFERENCES "DataSecurityIssue"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssueFeed" ADD CONSTRAINT "FK_bb51cbbb9a54117f794ea04609d" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssueFeed" ADD CONSTRAINT "FK_32e7fc2da5cc4b44a9cb3c35ae4" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssueFeed" ADD CONSTRAINT "FK_eef71eaa25762dda92eae4343ad" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityCustomDataType" ADD CONSTRAINT "FK_adfbda40ca0bd3cf0ec2901626b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityCustomDataType" ADD CONSTRAINT "FK_c9e64029168229d6741667b3f2f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityCustomDataType" ADD CONSTRAINT "FK_c33758b3945db42ed687d3e903d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityCheckSetting" ADD CONSTRAINT "FK_895894a59da0200397895246002" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityCheckSetting" ADD CONSTRAINT "FK_545d6963f7c6c7e729c4098fd9e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityCheckSetting" ADD CONSTRAINT "FK_7fdff1303a278b1a526d1558490" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityResidencyRule" ADD CONSTRAINT "FK_085717f1cebeca81bd6591e6b9d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityResidencyRule" ADD CONSTRAINT "FK_95b0f991206a622cd5d0cd30e70" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityResidencyRule" ADD CONSTRAINT "FK_12b3f828842cb27c38e0c3042be" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecuritySetting" ADD CONSTRAINT "FK_cec723790db5e45f093276c4e89" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecuritySetting" ADD CONSTRAINT "FK_00931318804914c67e4112a7e1b" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecuritySetting" ADD CONSTRAINT "FK_d68864559a848aef0985ed89537" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecuritySetting" ADD CONSTRAINT "FK_311ebfded9ddb579f14a1b43cdb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabel" ADD CONSTRAINT "FK_a8991dad9d40cf0604b214de637" FOREIGN KEY ("dataStoreId") REFERENCES "DataStore"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabel" ADD CONSTRAINT "FK_7a3df30cf439dfd8cff2c81030d" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRuleMatchLabel" ADD CONSTRAINT "FK_550465bf89a95b19c785c76169e" FOREIGN KEY ("dataStoreOwnerRuleId") REFERENCES "DataStoreOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRuleMatchLabel" ADD CONSTRAINT "FK_0e9d77821dd832a4c87f93195be" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRuleUser" ADD CONSTRAINT "FK_e10b7abd39b26f627ab95959434" FOREIGN KEY ("dataStoreOwnerRuleId") REFERENCES "DataStoreOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRuleUser" ADD CONSTRAINT "FK_7f5fa8c31750e423389ddc11d86" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRuleTeam" ADD CONSTRAINT "FK_8271d3415f70cc14fa7f5aab42e" FOREIGN KEY ("dataStoreOwnerRuleId") REFERENCES "DataStoreOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRuleTeam" ADD CONSTRAINT "FK_e8df1f03cb7cd0e7e576b8173aa" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabelRuleMatchLabel" ADD CONSTRAINT "FK_394207950a706724774708d260b" FOREIGN KEY ("dataStoreLabelRuleId") REFERENCES "DataStoreLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabelRuleMatchLabel" ADD CONSTRAINT "FK_99f7279a2e743efd005236d644d" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabelRuleAddLabel" ADD CONSTRAINT "FK_9eee7e713e6b7fa88b9428721e1" FOREIGN KEY ("dataStoreLabelRuleId") REFERENCES "DataStoreLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabelRuleAddLabel" ADD CONSTRAINT "FK_3dcb7fbd18c4606a46b45e3e2e3" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabelRuleAddLabel" DROP CONSTRAINT "FK_3dcb7fbd18c4606a46b45e3e2e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabelRuleAddLabel" DROP CONSTRAINT "FK_9eee7e713e6b7fa88b9428721e1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabelRuleMatchLabel" DROP CONSTRAINT "FK_99f7279a2e743efd005236d644d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabelRuleMatchLabel" DROP CONSTRAINT "FK_394207950a706724774708d260b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRuleTeam" DROP CONSTRAINT "FK_e8df1f03cb7cd0e7e576b8173aa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRuleTeam" DROP CONSTRAINT "FK_8271d3415f70cc14fa7f5aab42e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRuleUser" DROP CONSTRAINT "FK_7f5fa8c31750e423389ddc11d86"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRuleUser" DROP CONSTRAINT "FK_e10b7abd39b26f627ab95959434"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRuleMatchLabel" DROP CONSTRAINT "FK_0e9d77821dd832a4c87f93195be"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRuleMatchLabel" DROP CONSTRAINT "FK_550465bf89a95b19c785c76169e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabel" DROP CONSTRAINT "FK_7a3df30cf439dfd8cff2c81030d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabel" DROP CONSTRAINT "FK_a8991dad9d40cf0604b214de637"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecuritySetting" DROP CONSTRAINT "FK_311ebfded9ddb579f14a1b43cdb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecuritySetting" DROP CONSTRAINT "FK_d68864559a848aef0985ed89537"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecuritySetting" DROP CONSTRAINT "FK_00931318804914c67e4112a7e1b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecuritySetting" DROP CONSTRAINT "FK_cec723790db5e45f093276c4e89"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityResidencyRule" DROP CONSTRAINT "FK_12b3f828842cb27c38e0c3042be"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityResidencyRule" DROP CONSTRAINT "FK_95b0f991206a622cd5d0cd30e70"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityResidencyRule" DROP CONSTRAINT "FK_085717f1cebeca81bd6591e6b9d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityCheckSetting" DROP CONSTRAINT "FK_7fdff1303a278b1a526d1558490"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityCheckSetting" DROP CONSTRAINT "FK_545d6963f7c6c7e729c4098fd9e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityCheckSetting" DROP CONSTRAINT "FK_895894a59da0200397895246002"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityCustomDataType" DROP CONSTRAINT "FK_c33758b3945db42ed687d3e903d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityCustomDataType" DROP CONSTRAINT "FK_c9e64029168229d6741667b3f2f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityCustomDataType" DROP CONSTRAINT "FK_adfbda40ca0bd3cf0ec2901626b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssueFeed" DROP CONSTRAINT "FK_eef71eaa25762dda92eae4343ad"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssueFeed" DROP CONSTRAINT "FK_32e7fc2da5cc4b44a9cb3c35ae4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssueFeed" DROP CONSTRAINT "FK_bb51cbbb9a54117f794ea04609d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssueFeed" DROP CONSTRAINT "FK_baf2d307e8233b40a9d8022ab8d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssueFeed" DROP CONSTRAINT "FK_8b43e35dba0e14480e772c549b9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP CONSTRAINT "FK_d9238e6b34871a474b4edffad68"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP CONSTRAINT "FK_0ef86fd03b0659c069e432e8b79"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP CONSTRAINT "FK_1e8005f1126b4748b7c1b3d04d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP CONSTRAINT "FK_b0e36a923ee6163cf68149a3849"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP CONSTRAINT "FK_050ca7360f898a939c1de2b4aec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP CONSTRAINT "FK_b697f3bdbb56641893e3c924a5b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssue" DROP CONSTRAINT "FK_53677404a91008b1c31f9761e4f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityFlow" DROP CONSTRAINT "FK_48582d949e1eac50ab236ff4842"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityFlow" DROP CONSTRAINT "FK_7cece5df5ecb53f69d4c6d84c3d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityFlow" DROP CONSTRAINT "FK_0862435eda7a6da0f5870e917ea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityFlow" DROP CONSTRAINT "FK_d76fe1fcf854d9f0de25203b328"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabelRule" DROP CONSTRAINT "FK_71ccb165f56df859f92c7b62dff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabelRule" DROP CONSTRAINT "FK_3410db59cd4bced80d461fc347e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreLabelRule" DROP CONSTRAINT "FK_43ac69d249410e3df0503ca24ca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRule" DROP CONSTRAINT "FK_da350656c17bacd22ca50688a25"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRule" DROP CONSTRAINT "FK_d4841c015aede1f30b35cb6954a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerRule" DROP CONSTRAINT "FK_6f859fa96aa5e5504e8d5c112fd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerTeam" DROP CONSTRAINT "FK_efa181757c04914f20808d4a008"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerTeam" DROP CONSTRAINT "FK_0d8439788c23a8e6a690d1b7d0a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerTeam" DROP CONSTRAINT "FK_729bbd1df03a802af9d3136bf9f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerTeam" DROP CONSTRAINT "FK_a9125653254bd7d688c19932df1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerTeam" DROP CONSTRAINT "FK_f15e4380dd60c79fb9341d87e0c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerUser" DROP CONSTRAINT "FK_761feae8872872ef1bfc67505cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerUser" DROP CONSTRAINT "FK_a46aab7814032fdf1aa68e5b414"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerUser" DROP CONSTRAINT "FK_5ded479a4e1d523c0a0373a3fd2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerUser" DROP CONSTRAINT "FK_ed84d8a1a9e6047cfa3b60e3240"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreOwnerUser" DROP CONSTRAINT "FK_3b800a35833110ccd7459d574d9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFeed" DROP CONSTRAINT "FK_98aa54e732a07025069988bdf3a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFeed" DROP CONSTRAINT "FK_8c145fde71dbd387fb5c3abfdfc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFeed" DROP CONSTRAINT "FK_c0d7df6d0e52ebbe7e0f4113862"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFeed" DROP CONSTRAINT "FK_33ba947dcb717fb63951954e12b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFeed" DROP CONSTRAINT "FK_4a0618fbe4c5d608596676cf78a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreAccess" DROP CONSTRAINT "FK_5016e0f279409add622d2d481b8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreAccess" DROP CONSTRAINT "FK_0987180e2095390dd8733ba9a99"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP CONSTRAINT "FK_f12c6165266900e82a35175b6cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP CONSTRAINT "FK_893a91b9d9cabd31e405359aef0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP CONSTRAINT "FK_629dc8071197ba50e4f8742ea68"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityScan" DROP CONSTRAINT "FK_a808d7ca7f80f20a6a05a5b7b56"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityScan" DROP CONSTRAINT "FK_759a81382c7c5d61b2e25c254bb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityScan" DROP CONSTRAINT "FK_658112b6de186062f4d191faee3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityScan" DROP CONSTRAINT "FK_fa8e481d65cefd8a92ce04a576e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP CONSTRAINT "FK_83129fdd882360c24ad81d61dfa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP CONSTRAINT "FK_468df3ec3887a1e227728bbd186"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP CONSTRAINT "FK_a7cca3198dddafded2adfdc85bc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP CONSTRAINT "FK_9afc591919e5c7ae715777dc570"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP CONSTRAINT "FK_1a1f987bd8b704ced4ce37f85b2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP CONSTRAINT "FK_72846e5c5b31d0b7396389e6607"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP CONSTRAINT "FK_bd21cd0f465d5ad76b9cab4b8e4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP CONSTRAINT "FK_45459983d69d8de2dc679eb673d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP CONSTRAINT "FK_aa63a88400669a8862180c81d65"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3dcb7fbd18c4606a46b45e3e2e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9eee7e713e6b7fa88b9428721e"`,
    );
    await queryRunner.query(`DROP TABLE "DataStoreLabelRuleAddLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_99f7279a2e743efd005236d644"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_394207950a706724774708d260"`,
    );
    await queryRunner.query(`DROP TABLE "DataStoreLabelRuleMatchLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e8df1f03cb7cd0e7e576b8173a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8271d3415f70cc14fa7f5aab42"`,
    );
    await queryRunner.query(`DROP TABLE "DataStoreOwnerRuleTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7f5fa8c31750e423389ddc11d8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e10b7abd39b26f627ab9595943"`,
    );
    await queryRunner.query(`DROP TABLE "DataStoreOwnerRuleUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0e9d77821dd832a4c87f93195b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_550465bf89a95b19c785c76169"`,
    );
    await queryRunner.query(`DROP TABLE "DataStoreOwnerRuleMatchLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7a3df30cf439dfd8cff2c81030"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a8991dad9d40cf0604b214de63"`,
    );
    await queryRunner.query(`DROP TABLE "DataStoreLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_00931318804914c67e4112a7e1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cec723790db5e45f093276c4e8"`,
    );
    await queryRunner.query(`DROP TABLE "DataSecuritySetting"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_58f577578de1f7b5f915065ae1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_085717f1cebeca81bd6591e6b9"`,
    );
    await queryRunner.query(`DROP TABLE "DataSecurityResidencyRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c661b586630cffb688cd9106e2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_895894a59da020039789524600"`,
    );
    await queryRunner.query(`DROP TABLE "DataSecurityCheckSetting"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4fc79a3f3869c3b7f6f0c5a45c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_adfbda40ca0bd3cf0ec2901626"`,
    );
    await queryRunner.query(`DROP TABLE "DataSecurityCustomDataType"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_84fb8a1980ded5b4a693ecfd6a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_baf2d307e8233b40a9d8022ab8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b43e35dba0e14480e772c549b"`,
    );
    await queryRunner.query(`DROP TABLE "DataSecurityIssueFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a2dd817c178671888965b23edd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_287040c2cc7047ef9683e07af5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0e855374c7aaa59a1fea945d15"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b7c5156798400575b443f4ad89"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d9238e6b34871a474b4edffad6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0ef86fd03b0659c069e432e8b7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1e8005f1126b4748b7c1b3d04d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b0e36a923ee6163cf68149a384"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_050ca7360f898a939c1de2b4ae"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a415a89896a54f2751f25e0d1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12cb92ec20d32fc8a75dd516a2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b697f3bdbb56641893e3c924a5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_53677404a91008b1c31f9761e4"`,
    );
    await queryRunner.query(`DROP TABLE "DataSecurityIssue"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_80e8b3f8c0b7efc32eda30bdf3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f0d96938ef44379a7d91b93375"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7c2aa8ed0737f3e1c5a18220c6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_48582d949e1eac50ab236ff484"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7cece5df5ecb53f69d4c6d84c3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0862435eda7a6da0f5870e917e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d76fe1fcf854d9f0de25203b32"`,
    );
    await queryRunner.query(`DROP TABLE "DataSecurityFlow"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_094fe58d491e5ea331c5b94bd1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_15550c60dc2dbe319066eccd2e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_43ac69d249410e3df0503ca24c"`,
    );
    await queryRunner.query(`DROP TABLE "DataStoreLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3c65913135664ce61c4a408323"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c7bbbee2298fa48dda50e9c297"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6f859fa96aa5e5504e8d5c112f"`,
    );
    await queryRunner.query(`DROP TABLE "DataStoreOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7a3e0aaa7eb7118473856753af"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bd90846d35faf462c7ac25ba61"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_729bbd1df03a802af9d3136bf9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a9125653254bd7d688c19932df"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f15e4380dd60c79fb9341d87e0"`,
    );
    await queryRunner.query(`DROP TABLE "DataStoreOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a09f7bd99a40da8aed3d43a4b9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a144874033c1cfc343a75c60a8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5ded479a4e1d523c0a0373a3fd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ed84d8a1a9e6047cfa3b60e324"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3b800a35833110ccd7459d574d"`,
    );
    await queryRunner.query(`DROP TABLE "DataStoreOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1d965e5aeb0eb5cfeda8e18dda"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_33ba947dcb717fb63951954e12"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a0618fbe4c5d608596676cf78"`,
    );
    await queryRunner.query(`DROP TABLE "DataStoreFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cc40a7a8db82d255c8d99fea51"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d21cb560934b11b402eb2ee948"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8fa37281fbcb7a1ce63dc418ab"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5016e0f279409add622d2d481b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0987180e2095390dd8733ba9a9"`,
    );
    await queryRunner.query(`DROP TABLE "DataStoreAccess"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_33ea233e71b8a03e83209fff8c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7a5b994bb36cc4fa7093d02d2b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a6dbb60ba17a6cbfd73e8702a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6dd7bc9d76f44dc3d5eba047b6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f12c6165266900e82a35175b6c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_893a91b9d9cabd31e405359aef"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_629dc8071197ba50e4f8742ea6"`,
    );
    await queryRunner.query(`DROP TABLE "DataStoreFinding"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5cbbd8d97d82a96578ab714f7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ab3871fb44791b7f1433e7f83b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a808d7ca7f80f20a6a05a5b7b5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_759a81382c7c5d61b2e25c254b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_658112b6de186062f4d191faee"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fa8e481d65cefd8a92ce04a576"`,
    );
    await queryRunner.query(`DROP TABLE "DataSecurityScan"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bc7cb382e4ad89bbfb4b2a2147"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_04318c306a040953f53bfd79bb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97a7dd37fb8e0f4d6ec0c1e0c7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_881fd8377edf3303b49ad06906"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_089b4dd9a7d0b5d85456e9c9d1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1b5b3e965f456a9fd1f1a94a4d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a7cca3198dddafded2adfdc85b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9afc591919e5c7ae715777dc57"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1a1f987bd8b704ced4ce37f85b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_72846e5c5b31d0b7396389e660"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bd21cd0f465d5ad76b9cab4b8e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_45459983d69d8de2dc679eb673"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aa63a88400669a8862180c81d6"`,
    );
    await queryRunner.query(`DROP TABLE "DataStore"`);
  }
}
