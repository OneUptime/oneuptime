import Entities from "../../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../../../Types/BaseDatabase/AccessControl";
import RelationReadersUtil from "../../../../../Types/Database/RelationReadersUtil";
import Dictionary from "../../../../../Types/Dictionary";
import Permission from "../../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY COLUMN OF A LABELLED MODEL READ BY FEWER PEOPLE THAN ITS TABLE
 * (#11259, #11438).
 *
 * A column only some of a table's readers may read - a monitor's secret
 * keys, a runner's key, a device's SNMP credentials - is read only where
 * its reader's grant to read it reaches: for a grant limited to labels, on
 * the records carrying them. Every read by DatabaseService reads every
 * record the reader's grants of the table reach and leaves such a column
 * out of the others (AccessControlPermission.getColumnsKeptToLabels,
 * withholdColumnsKeptToLabels) - in one project, across projects a project
 * at a time (getColumnsKeptToLabelsByProject), and, for a column held to
 * its own read through a relation, on the related records too
 * (getRelatedColumnsKeptToLabels). A list does not offer a sort by one, nor
 * an edit form a blank save of one withheld (ColumnSortLock, ModelForm,
 * #11437).
 *
 * The lists below are every such column today, worked out from the models.
 * A new one fails this guard, naming it: look at the pages that show it,
 * then add it here.
 */

const MODELS: Array<{ new (): BaseModel }> = Entities as Array<{
  new (): BaseModel;
}>;

// Every column of a labelled model some reader of its table may not read.
const NARROWER_THAN_THEIR_TABLE: ReadonlyArray<string> = [
  "AIAgent.createdByActorId",
  "AIAgent.createdByActorType",
  "AIAgent.createdByUser",
  "AIAgent.createdByUserId",
  "AIAgent.key",
  "AIAgent.lastModifiedAt",
  "AIAgent.lastModifiedByActorId",
  "AIAgent.lastModifiedByActorType",
  "AIAgent.lastModifiedByUser",
  "AIAgent.lastModifiedByUserId",
  "CodeRepository.gitHubAppInstallationId",
  "CodeRepository.gitLabProjectId",
  "CodeRepository.mintedTokenRefusedAt",
  "Monitor.incomingEmailCustomLocalPart",
  "Monitor.incomingEmailSecretKey",
  "Monitor.incomingRequestSecretKey",
  "Monitor.serverMonitorSecretKey",
  "NetworkDevice.lastWalkLog",
  "NetworkDevice.snmpCommunityString",
  "NetworkDevice.snmpV3Auth",
  "NetworkDevice.snmpV3AuthKey",
  "NetworkDevice.snmpV3PrivKey",
  "Probe.createdByActorId",
  "Probe.createdByActorType",
  "Probe.createdByUser",
  "Probe.createdByUserId",
  "Probe.egressIpAddress",
  "Probe.interfaceIpAddresses",
  "Probe.key",
  "Probe.labels",
  "Probe.lastModifiedAt",
  "Probe.lastModifiedByActorId",
  "Probe.lastModifiedByActorType",
  "Probe.lastModifiedByUser",
  "Probe.lastModifiedByUserId",
  "Probe.majorVersionBehindNotifiedFor",
  "Probe.packetCaptureCapability",
  "Probe.probeVersion",
  "Probe.reportedVersion",
  "Probe.snmpTrapReceiver",
  "Runner.key",
  "Workflow.incomingEmailSecretKey",
  "Workflow.webhookSecretKey",
];

/*
 * Of the models read across projects (@MultiTenentQueryAllowed), the
 * labelled ones' such columns: none today. One added is withheld a project
 * at a time (ReadsWithholdPerRecordPostgres shows it on a stand-in column).
 */
const NARROWER_ON_MODELS_READ_ACROSS_PROJECTS: ReadonlyArray<string> = [];

/*
 * The columns of labelled models held to their own read through a relation
 * (RelationReaders.ColumnReaders): left out of the related records a
 * reader's grant to read them does not reach (#11438).
 */
const HELD_TO_THEIR_OWN_READ_THROUGH_RELATIONS: ReadonlyArray<string> = [
  "CloudAccount.accountId",
  "CloudAccount.cloudConnectionId",
  "CloudAccount.lastSeenAt",
  "CloudAccount.providerAccountName",
  "CloudAccount.regionCount",
  "CloudAccount.resourceCount",
  "DataStore.cloudAccountId",
  "DataStore.cloudAccountNumber",
  "DataStore.cloudConnectionId",
  "DataStore.cloudResourceId",
  "DataStore.configurationReadAt",
  "DataStore.contentScanStatus",
  "DataStore.contentScannedAt",
  "DataStore.dataSubjects",
  "DataStore.databaseServerId",
  "DataStore.description",
  "DataStore.discoveredFrom",
  "DataStore.estimatedRecords",
  "DataStore.exposure",
  "DataStore.family",
  "DataStore.findingCount",
  "DataStore.firstSeenAt",
  "DataStore.highestIssueSeverity",
  "DataStore.isAiData",
  "DataStore.isContentScanEnabled",
  "DataStore.isPublicByDesign",
  "DataStore.isTableHealthEnabled",
  "DataStore.lastActivityAt",
  "DataStore.lastSeenAt",
  "DataStore.legalBasis",
  "DataStore.nextContentScanAt",
  "DataStore.objectCount",
  "DataStore.openIssueCount",
  "DataStore.probeConnectionVariable",
  "DataStore.provider",
  "DataStore.providerResourceId",
  "DataStore.purpose",
  "DataStore.region",
  "DataStore.retention",
  "DataStore.riskScore",
  "DataStore.scanProbeId",
  "DataStore.sensitivity",
  "DataStore.sensitivityOverride",
  "DataStore.serviceId",
  "DataStore.sizeInBytes",
  "DataStore.storeKey",
  "DataStore.tableHealthAssetCount",
  "DataStore.tableHealthAttemptedAt",
  "DataStore.tableHealthCollectedAt",
  "DataStore.tableHealthStatus",
  "NetworkDevice.snmpV3ContextName",
  "Probe.snmpTrapReceiver",
];

// The labelled models' columns some readers of their table may not read.
const getNarrowerColumns: (
  isReadAcrossProjects: boolean | null,
) => Array<string> = (isReadAcrossProjects: boolean | null): Array<string> => {
  const columns: Array<string> = [];

  for (const modelType of MODELS) {
    const model: BaseModel = new modelType();

    if (!model.getAccessControlColumn()) {
      continue;
    }

    if (
      isReadAcrossProjects !== null &&
      model.canQueryMultiTenant() !== isReadAcrossProjects
    ) {
      continue;
    }

    const tableRead: Array<Permission> = model.getReadPermissions() || [];
    const access: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const column of model.getTableColumns().columns) {
      const read: Array<Permission> = access[column]?.read || [];

      if (
        read.length > 0 &&
        tableRead.some((permission: Permission): boolean => {
          return !read.includes(permission);
        })
      ) {
        columns.push(`${model.tableName}.${column}`);
      }
    }
  }

  return columns.sort();
};

describe("the columns of labelled models read by fewer people than their table", () => {
  test("are these, and no others: a new one is withheld per record - look at the pages that show it", () => {
    expect(getNarrowerColumns(null)).toEqual(
      [...NARROWER_THAN_THEIR_TABLE].sort(),
    );
  });

  test("of the models read across projects, none yet", () => {
    expect(getNarrowerColumns(true)).toEqual([
      ...NARROWER_ON_MODELS_READ_ACROSS_PROJECTS,
    ]);
  });

  test("the columns held to their own read through a relation are these", () => {
    const held: Array<string> = [];

    for (const modelType of MODELS) {
      const model: BaseModel = new modelType();

      if (!model.getAccessControlColumn()) {
        continue;
      }

      for (const column of model.getTableColumns().columns) {
        if (
          RelationReadersUtil.isHeldToItsOwnRead(
            model.getTableColumnMetadata(column),
          )
        ) {
          held.push(`${model.tableName}.${column}`);
        }
      }
    }

    expect(held.sort()).toEqual(
      [...HELD_TO_THEIR_OWN_READ_THROUGH_RELATIONS].sort(),
    );
  });
});
