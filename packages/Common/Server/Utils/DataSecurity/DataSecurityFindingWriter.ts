import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import DataSecurityScan from "../../../Models/DatabaseModels/DataSecurityScan";
import DataStoreFindingService from "../../Services/DataStoreFindingService";
import DataStoreService from "../../Services/DataStoreService";
import DataSecurityScanService from "../../Services/DataSecurityScanService";
import { queueDataSecurityEvaluation } from "./DataSecurityJobs";
import {
  ContentScanResult,
  LocationFindings,
  MAX_READ_LOG_ENTRIES,
} from "./DataSecurityScanTypes";
import logger from "../Logger";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import {
  DataTypeInfo,
  getBuiltInDataType,
} from "../../../Types/DataSecurity/DataTypeCatalog";
import { FieldClassification } from "../../../Utils/DataSecurity/FieldClassifier";

/*
 * TURNING A SCAN'S RESULT INTO ROWS.
 *
 * Every scanner - buckets, warehouses, databases, telemetry, a probe's -
 * returns a ContentScanResult; this writes it: one DataSecurityScan row
 * saying what was read, one DataStoreFinding per data type and location
 * (created the first time it is seen, updated after), and the store's own
 * summary - when it was scanned, how it ended, its fingerprints and the
 * next scan's starting point. Then the project's evaluation is queued, so
 * sensitivity, checks and issues follow from what was found.
 *
 * A finding a scan no longer sees is kept: a sample can miss what is still
 * there. The evaluator counts only findings seen in the last
 * FINDING_FRESHNESS_IN_DAYS days, and older ones are pruned here.
 */

// How long a finding counts toward its store after a scan last saw it.
export const FINDING_FRESHNESS_IN_DAYS: number = 30;

// How long an unseen finding is kept, for its history, before it goes.
export const FINDING_RETENTION_IN_DAYS: number = 90;

// The most findings one store keeps.
export const MAX_FINDINGS_PER_STORE: number = 2000;

export enum DataSecurityScanKind {
  Configuration = "Configuration",
  Content = "Content",
  Telemetry = "Telemetry",
}

export enum DataSecurityScanStatus {
  Running = "Running",
  Succeeded = "Succeeded",
  PartlySucceeded = "Partly succeeded",
  Failed = "Failed",
  Skipped = "Skipped",
}

// What a custom data type is, for its findings' names and sensitivity.
export interface CustomDataTypeSummary {
  name: string;
  category: DataCategory;
  sensitivity: DataSensitivity;
}

export interface RecordContentScanInput {
  projectId: ObjectID;
  dataStoreId: ObjectID;
  kind: DataSecurityScanKind;
  result: ContentScanResult;
  startedAt: Date;
  probeId?: ObjectID | undefined;
  keepMaskedSamples: boolean;
  contentScanIntervalInHours: number;
  customDataTypes?: ReadonlyMap<string, CustomDataTypeSummary> | undefined;
}

export interface RecordContentScanOutput {
  scanId: ObjectID | null;
  findingsWritten: number;
}

export function getFindingKey(dataTypeId: string, location: string): string {
  return `${dataTypeId}|${location}`.slice(0, 500);
}

export default class DataSecurityFindingWriter {
  public static async recordContentScan(
    input: RecordContentScanInput,
  ): Promise<RecordContentScanOutput> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const result: ContentScanResult = input.result;
    const status: DataSecurityScanStatus = result.isComplete
      ? DataSecurityScanStatus.Succeeded
      : DataSecurityScanStatus.PartlySucceeded;

    const findingsWritten: number = await this.writeFindings({
      projectId: input.projectId,
      dataStoreId: input.dataStoreId,
      locations: result.locations,
      keepMaskedSamples: input.keepMaskedSamples,
      customDataTypes: input.customDataTypes,
      now,
    });

    const scanId: ObjectID | null = await this.writeScan({
      projectId: input.projectId,
      dataStoreId: input.dataStoreId,
      kind: input.kind,
      status,
      startedAt: input.startedAt,
      finishedAt: now,
      probeId: input.probeId,
      result,
      findingsFound: findingsWritten,
    });

    await this.updateStore({
      dataStoreId: input.dataStoreId,
      status,
      result,
      now,
      contentScanIntervalInHours: input.contentScanIntervalInHours,
    });

    await this.pruneOldFindings(input.dataStoreId, now);
    await queueDataSecurityEvaluation(input.projectId);

    return { scanId, findingsWritten };
  }

  // A scan that could not run at all: recorded, so the store says why.
  public static async recordFailedScan(data: {
    projectId: ObjectID;
    dataStoreId?: ObjectID | undefined;
    cloudConnectionId?: ObjectID | undefined;
    probeId?: ObjectID | undefined;
    kind: DataSecurityScanKind;
    startedAt: Date;
    errorMessage: string;
    status?: DataSecurityScanStatus | undefined;
  }): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const scan: DataSecurityScan = new DataSecurityScan();
    scan.projectId = data.projectId;

    if (data.dataStoreId) {
      scan.dataStoreId = data.dataStoreId;
    }

    if (data.cloudConnectionId) {
      scan.cloudConnectionId = data.cloudConnectionId;
    }

    if (data.probeId) {
      scan.probeId = data.probeId;
    }

    scan.kind = data.kind;
    scan.status = data.status || DataSecurityScanStatus.Failed;
    scan.startedAt = data.startedAt;
    scan.finishedAt = now;
    scan.durationInMs = Math.max(0, now.getTime() - data.startedAt.getTime());
    scan.errorMessage = data.errorMessage.slice(0, 500);

    try {
      await DataSecurityScanService.create({
        data: scan,
        props: { isRoot: true },
      });

      if (data.dataStoreId) {
        await DataStoreService.updateColumnsByIdWithoutHooks({
          id: data.dataStoreId,
          data: {
            contentScanStatus: scan.status,
          },
        });
      }
    } catch (error) {
      logger.error("DataSecurity: could not record a failed scan:");
      logger.error(error);
    }
  }

  private static describe(
    dataTypeId: string,
    customDataTypes: ReadonlyMap<string, CustomDataTypeSummary> | undefined,
  ): {
    name: string;
    category: DataCategory | undefined;
    sensitivity: DataSensitivity | undefined;
  } {
    const info: DataTypeInfo | undefined = getBuiltInDataType(dataTypeId);

    if (info) {
      return {
        name: info.name,
        category: info.category,
        sensitivity: info.sensitivity,
      };
    }

    const custom: CustomDataTypeSummary | undefined =
      customDataTypes?.get(dataTypeId);

    return {
      name: custom?.name || dataTypeId,
      category: custom?.category,
      sensitivity: custom?.sensitivity,
    };
  }

  private static async writeFindings(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    locations: Array<LocationFindings>;
    keepMaskedSamples: boolean;
    customDataTypes?: ReadonlyMap<string, CustomDataTypeSummary> | undefined;
    now: Date;
  }): Promise<number> {
    const wanted: Map<
      string,
      { location: LocationFindings; classification: FieldClassification }
    > = new Map();

    for (const location of data.locations) {
      for (const classification of location.classifications) {
        if (wanted.size >= MAX_FINDINGS_PER_STORE) {
          break;
        }

        wanted.set(
          getFindingKey(classification.dataTypeId, location.location),
          { location, classification },
        );
      }
    }

    if (wanted.size === 0) {
      return 0;
    }

    const keys: Array<string> = [...wanted.keys()];
    const existing: Map<string, DataStoreFinding> = new Map();

    for (let start: number = 0; start < keys.length; start += 500) {
      const rows: Array<DataStoreFinding> =
        await DataStoreFindingService.findBy({
          query: {
            dataStoreId: data.dataStoreId,
            findingKey: new Includes(keys.slice(start, start + 500)),
          },
          select: { _id: true, findingKey: true },
          skip: 0,
          limit: 500,
          props: { isRoot: true },
        });

      for (const row of rows) {
        if (row.findingKey) {
          existing.set(row.findingKey, row);
        }
      }
    }

    let written: number = 0;

    for (const [key, { location, classification }] of wanted) {
      const description: {
        name: string;
        category: DataCategory | undefined;
        sensitivity: DataSensitivity | undefined;
      } = this.describe(classification.dataTypeId, data.customDataTypes);

      const columns: JSONObject = {
        dataTypeName: description.name.slice(0, 100),
        confidence: classification.confidence,
        matchCount: classification.matchCount,
        valueCount: classification.valueCount,
        matchPercent: Math.round(classification.matchRatio * 100),
        distinctValues: classification.distinctValues,
        testValueCount: classification.testValueCount,
        maskedSamples: data.keepMaskedSamples
          ? classification.maskedSamples
          : [],
        isFreeText: classification.isFreeText,
        isNameHinted: classification.nameHinted,
        isFoundByName: classification.foundByName,
        locationKind: location.locationKind,
        lastSeenAt: data.now,
      };

      if (description.category) {
        columns["dataCategory"] = description.category;
      }

      if (description.sensitivity) {
        columns["sensitivity"] = description.sensitivity;
      }

      try {
        const row: DataStoreFinding | undefined = existing.get(key);

        if (row?.id) {
          await DataStoreFindingService.updateColumnsByIdWithoutHooks({
            id: row.id,
            data: columns as never,
          });
        } else {
          const finding: DataStoreFinding = new DataStoreFinding();
          finding.projectId = data.projectId;
          finding.dataStoreId = data.dataStoreId;
          finding.findingKey = key;
          finding.dataTypeId = classification.dataTypeId.slice(0, 100);
          finding.location = location.location.slice(0, 500);
          finding.firstSeenAt = data.now;

          for (const [column, value] of Object.entries(columns)) {
            finding.setColumnValue(column, value);
          }

          await DataStoreFindingService.create({
            data: finding,
            props: { isRoot: true },
          });
        }

        written++;
      } catch (error) {
        logger.error(
          `DataSecurity: could not write finding ${key} of store ${data.dataStoreId.toString()}:`,
        );
        logger.error(error);
      }
    }

    return written;
  }

  private static async writeScan(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    kind: DataSecurityScanKind;
    status: DataSecurityScanStatus;
    startedAt: Date;
    finishedAt: Date;
    probeId?: ObjectID | undefined;
    result: ContentScanResult;
    findingsFound: number;
  }): Promise<ObjectID | null> {
    const scan: DataSecurityScan = new DataSecurityScan();
    scan.projectId = data.projectId;
    scan.dataStoreId = data.dataStoreId;

    if (data.probeId) {
      scan.probeId = data.probeId;
    }

    scan.kind = data.kind;
    scan.status = data.status;
    scan.startedAt = data.startedAt;
    scan.finishedAt = data.finishedAt;
    scan.durationInMs = Math.max(
      0,
      data.finishedAt.getTime() - data.startedAt.getTime(),
    );
    scan.objectsRead = data.result.objectsRead;
    scan.rowsRead = data.result.rowsRead;
    scan.bytesRead = data.result.bytesRead;
    scan.findingsFound = data.findingsFound;
    scan.readLog = data.result.readLog
      .slice(0, MAX_READ_LOG_ENTRIES)
      .map((entry: string) => {
        return entry.slice(0, 300);
      });
    scan.warnings = data.result.warnings.slice(0, 50).map((entry: string) => {
      return entry.slice(0, 500);
    });

    try {
      const created: DataSecurityScan = await DataSecurityScanService.create({
        data: scan,
        props: { isRoot: true },
      });

      return created.id || null;
    } catch (error) {
      logger.error("DataSecurity: could not record a scan:");
      logger.error(error);
      return null;
    }
  }

  private static async updateStore(data: {
    dataStoreId: ObjectID;
    status: DataSecurityScanStatus;
    result: ContentScanResult;
    now: Date;
    contentScanIntervalInHours: number;
  }): Promise<void> {
    const store: DataStore | null = await DataStoreService.findOneById({
      id: data.dataStoreId,
      select: { _id: true, fingerprints: true },
      props: { isRoot: true },
    });

    if (!store) {
      return;
    }

    const fingerprints: JSONObject = {
      ...((store.fingerprints as JSONObject | undefined) || {}),
      ...(data.result.fingerprints as unknown as JSONObject),
    };

    const state: JSONObject = {
      ...((data.result.nextState as JSONObject | undefined) || {}),
      plaintextPasswordFields: data.result.plaintextPasswordFields.slice(0, 50),
    };

    const columns: JSONObject = {
      contentScannedAt: data.now,
      contentScanStatus: data.status,
      nextContentScanAt: OneUptimeDate.addRemoveHours(
        data.now,
        data.contentScanIntervalInHours,
      ),
      contentScanState: state,
      fingerprints,
    };

    if (typeof data.result.estimatedRecords === "number") {
      columns["estimatedRecords"] = Math.round(data.result.estimatedRecords);
    }

    await DataStoreService.updateColumnsByIdWithoutHooks({
      id: data.dataStoreId,
      data: columns as never,
    });
  }

  private static async pruneOldFindings(
    dataStoreId: ObjectID,
    now: Date,
  ): Promise<void> {
    try {
      const cutoff: Date = OneUptimeDate.addRemoveDays(
        now,
        -FINDING_RETENTION_IN_DAYS,
      );
      const old: Array<DataStoreFinding> = await DataStoreFindingService.findBy(
        {
          query: { dataStoreId },
          select: { _id: true, lastSeenAt: true },
          skip: 0,
          limit: MAX_FINDINGS_PER_STORE,
          props: { isRoot: true },
        },
      );

      for (const finding of old) {
        if (
          finding.id &&
          finding.lastSeenAt &&
          finding.lastSeenAt.getTime() < cutoff.getTime()
        ) {
          await DataStoreFindingService.deleteOneById({
            id: finding.id,
            props: { isRoot: true },
          });
        }
      }
    } catch (error) {
      logger.error("DataSecurity: could not prune old findings:");
      logger.error(error);
    }
  }
}
