import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import {
  CloudHealthSeverity,
  CloudResourceReading,
  CloudResourceReadings,
  CLOUD_READINGS_STALE_MS,
  getCloudHealthSeverity,
  getCloudReadingKey,
  getCloudReadingKeysForType,
} from "../../../Types/Cloud/CloudResourceHealth";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
} from "../../../Types/Cloud/CloudMonitoredResource";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CloudResourceService from "../../Services/CloudResourceService";
import logger from "../Logger";
import { OtlpAttribute, resolveCloudResourceOf } from "./CloudMetricPayload";

/*
 * A RESOURCE'S READINGS, FROM WHAT A CLOUD CONNECTION'S READ BROUGHT IN.
 *
 * A read hands the metrics ingest its metrics as OTLP/JSON
 * (CloudMetricPayload). Before it does, the read keeps - for each resource
 * the metrics are about - the newest value of each metric the resource's
 * type is judged by or its page leads with (CloudResourceHealth), on the
 * resource's record: its readings, when they were written, and the
 * severity of what the rules find in them. So the Cloud Overview's Needs
 * attention reads the few resources that need someone, and every list and
 * hero says how each one is, without a query over the metrics.
 *
 * Only the resources linked to the connection are written: two connections
 * reading one account each write their own. A resource the read brought no
 * reading for keeps the ones it had; once they are an hour old they are no
 * longer judged, and its severity is cleared.
 */

// Rows written in one statement at most.
export const CLOUD_READINGS_WRITE_BATCH_SIZE: number = 500;

export interface CollectedCloudReadings {
  provider: string;
  resourceType: string;
  readings: CloudResourceReadings;
}

export interface CloudReadingsWriteResult {
  // Resources whose readings were written.
  written: number;
  // Of those, the ones whose rules found something.
  needingAttention: number;
  // Resources whose stale severity was cleared.
  cleared: number;
}

function readAttributes(value: unknown): Array<OtlpAttribute> {
  return Array.isArray(value) ? (value as Array<OtlpAttribute>) : [];
}

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readArray(value: unknown): JSONArray {
  return Array.isArray(value) ? (value as JSONArray) : [];
}

// Whole nanoseconds, as OTLP/JSON writes a datapoint's time.
const DIGITS_ONLY: RegExp = /^\d+$/;

// A datapoint's time in milliseconds, from its OTLP nanoseconds.
export function readDatapointTimeMs(value: unknown): number | null {
  const text: string =
    typeof value === "number" ? String(Math.floor(value)) : String(value || "");

  if (!DIGITS_ONLY.test(text)) {
    return null;
  }

  // Nanoseconds: drop the last six digits, which no time read here uses.
  const ms: number =
    text.length > 6 ? Number(text.slice(0, text.length - 6)) : 0;

  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function readDatapointValue(point: JSONObject): number | null {
  const raw: unknown =
    point["asDouble"] !== undefined ? point["asDouble"] : point["asInt"];

  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  const value: number = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/*
 * The readings of every resource the payloads are about, by the resource's
 * identifier (CloudResource.resourceIdentifier, lower case): for each metric
 * its type keeps, the value of its newest datapoint. A datapoint whose
 * resource cannot be told is left out, as the ingest leaves its resource.
 */
export function collectCloudResourceReadings(
  payloads: Array<JSONObject>,
): Map<string, CollectedCloudReadings> {
  const collected: Map<string, CollectedCloudReadings> = new Map();
  /*
   * One datapoint set shares its attributes: each set's resource is told
   * once per metric, not once per point.
   */
  const resolved: WeakMap<
    object,
    Map<string, { resource: CloudMonitoredResource; identifier: string } | null>
  > = new WeakMap();

  const resolve: (
    metricName: string,
    resourceAttributes: Array<OtlpAttribute>,
    datapointAttributes: Array<OtlpAttribute>,
  ) => { resource: CloudMonitoredResource; identifier: string } | null = (
    metricName: string,
    resourceAttributes: Array<OtlpAttribute>,
    datapointAttributes: Array<OtlpAttribute>,
  ): { resource: CloudMonitoredResource; identifier: string } | null => {
    let byMetric:
      | Map<
          string,
          { resource: CloudMonitoredResource; identifier: string } | null
        >
      | undefined = resolved.get(datapointAttributes);

    if (!byMetric) {
      byMetric = new Map();
      resolved.set(datapointAttributes, byMetric);
    }

    if (byMetric.has(metricName)) {
      return byMetric.get(metricName) || null;
    }

    let answer: {
      resource: CloudMonitoredResource;
      identifier: string;
    } | null = null;

    try {
      const resource: CloudMonitoredResource | null = resolveCloudResourceOf({
        metricName,
        resourceAttributes,
        datapointAttributes,
      });

      if (resource) {
        answer = {
          resource,
          identifier:
            buildCloudMonitoredResourceIdentifier(resource).toLowerCase(),
        };
      }
    } catch {
      answer = null;
    }

    byMetric.set(metricName, answer);
    return answer;
  };

  for (const payload of payloads) {
    for (const rawResourceMetrics of readArray(payload["resourceMetrics"])) {
      const resourceMetrics: JSONObject = readObject(rawResourceMetrics);
      const resourceAttributes: Array<OtlpAttribute> = readAttributes(
        readObject(resourceMetrics["resource"])["attributes"],
      );

      for (const rawScope of readArray(resourceMetrics["scopeMetrics"])) {
        for (const rawMetric of readArray(readObject(rawScope)["metrics"])) {
          const metric: JSONObject = readObject(rawMetric);
          const metricName: string =
            typeof metric["name"] === "string" ? metric["name"] : "";

          if (!metricName) {
            continue;
          }

          const points: JSONArray = readArray(
            readObject(metric["gauge"] || metric["sum"])["dataPoints"],
          );

          for (const rawPoint of points) {
            const point: JSONObject = readObject(rawPoint);
            const timeMs: number | null = readDatapointTimeMs(
              point["timeUnixNano"],
            );
            const value: number | null = readDatapointValue(point);

            if (timeMs === null || value === null) {
              continue;
            }

            const target: {
              resource: CloudMonitoredResource;
              identifier: string;
            } | null = resolve(
              metricName,
              resourceAttributes,
              readAttributes(point["attributes"]),
            );

            if (!target) {
              continue;
            }

            const provider: string = target.resource.provider;
            const key: string | null = getCloudReadingKey(provider, metricName);

            if (
              !key ||
              !getCloudReadingKeysForType(
                provider,
                target.resource.resourceType,
              ).has(key)
            ) {
              continue;
            }

            let entry: CollectedCloudReadings | undefined = collected.get(
              target.identifier,
            );

            if (!entry) {
              entry = {
                provider,
                resourceType: target.resource.resourceType,
                readings: {},
              };
              collected.set(target.identifier, entry);
            }

            const existing: CloudResourceReading | undefined =
              entry.readings[key];

            // The newest datapoint wins; of two at one time, the first read.
            if (!existing || Date.parse(existing.time) < timeMs) {
              entry.readings[key] = {
                value,
                time: new Date(timeMs).toISOString(),
              };
            }
          }
        }
      }
    }
  }

  return collected;
}

function countReturnedRows(rows: unknown): number {
  if (!Array.isArray(rows)) {
    return 0;
  }

  // UPDATE ... RETURNING answers [rows, count] through TypeORM's query().
  if (
    rows.length === 2 &&
    Array.isArray(rows[0]) &&
    typeof rows[1] === "number"
  ) {
    return rows[1];
  }

  return rows.length;
}

interface PendingReadingsWrite {
  id: string;
  readings: string;
  severity: CloudHealthSeverity | null;
}

export default class CloudResourceReadingsWriter {
  /*
   * What a read's payloads say of each resource, written: the read's own
   * step, between its lanes and its bookkeeping. Never throws.
   */
  public static async writeFromPayloads(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    payloads: Array<JSONObject>;
    writtenAt: Date;
  }): Promise<CloudReadingsWriteResult> {
    let collected: Map<string, CollectedCloudReadings>;

    try {
      collected = collectCloudResourceReadings(data.payloads);
    } catch (error) {
      logger.error(
        `Cloud connection ${data.connectionId.toString()}: its resources' readings could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      collected = new Map();
    }

    return await CloudResourceReadingsWriter.write({
      projectId: data.projectId,
      connectionId: data.connectionId,
      collected,
      writtenAt: data.writtenAt,
    });
  }

  /*
   * Writes what a read collected onto the connection's resources, and
   * clears the severity of the ones whose readings went stale. Never
   * throws: a resource whose readings cannot be written keeps the old ones,
   * which go stale, and the failure is logged once.
   */
  public static async write(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    collected: Map<string, CollectedCloudReadings>;
    writtenAt: Date;
  }): Promise<CloudReadingsWriteResult> {
    const result: CloudReadingsWriteResult = {
      written: 0,
      needingAttention: 0,
      cleared: 0,
    };

    try {
      if (data.collected.size > 0) {
        const rows: Array<CloudResource> = await CloudResourceService.findBy({
          query: {
            projectId: data.projectId,
            cloudConnectionId: data.connectionId,
            cloudResourceKind: CloudResourceKind.Resource,
          },
          select: {
            _id: true,
            resourceIdentifier: true,
            cloudProvider: true,
            cloudResourceType: true,
            cloudProperties: true,
          },
          skip: 0,
          limit: LIMIT_MAX,
          props: { isRoot: true },
        });

        const pending: Array<PendingReadingsWrite> = [];

        for (const row of rows) {
          const entry: CollectedCloudReadings | undefined = data.collected.get(
            (row.resourceIdentifier || "").toLowerCase(),
          );

          if (!row.id || !entry) {
            continue;
          }

          const severity: CloudHealthSeverity | null = getCloudHealthSeverity(
            {
              provider: row.cloudProvider || entry.provider,
              type: row.cloudResourceType || entry.resourceType,
              readings: entry.readings,
              properties: row.cloudProperties,
            },
          );

          pending.push({
            id: row.id.toString(),
            readings: JSON.stringify(entry.readings),
            severity,
          });

          if (severity) {
            result.needingAttention++;
          }
        }

        for (
          let start: number = 0;
          start < pending.length;
          start += CLOUD_READINGS_WRITE_BATCH_SIZE
        ) {
          const batch: Array<PendingReadingsWrite> = pending.slice(
            start,
            start + CLOUD_READINGS_WRITE_BATCH_SIZE,
          );

          const written: unknown =
            await CloudResourceService.getRepository().manager.query(
              `UPDATE "CloudResource" AS resource
              SET "cloudReadings" = reading."readings"::jsonb,
                "cloudReadingsAt" = $2,
                "healthSeverity" = reading."severity"
              FROM unnest($3::uuid[], $4::text[], $5::text[])
                AS reading("id", "readings", "severity")
              WHERE resource."_id" = reading."id"
                AND resource."projectId" = $1
                AND resource."deletedAt" IS NULL
              RETURNING resource."_id"`,
              [
                data.projectId.toString(),
                data.writtenAt,
                batch.map((entry: PendingReadingsWrite): string => {
                  return entry.id;
                }),
                batch.map((entry: PendingReadingsWrite): string => {
                  return entry.readings;
                }),
                batch.map((entry: PendingReadingsWrite): string | null => {
                  return entry.severity;
                }),
              ],
            );

          result.written += countReturnedRows(written);
        }
      }

      const cleared: unknown =
        await CloudResourceService.getRepository().manager.query(
          `UPDATE "CloudResource"
          SET "healthSeverity" = NULL
          WHERE "projectId" = $1
            AND "cloudConnectionId" = $2
            AND "healthSeverity" IS NOT NULL
            AND ("cloudReadingsAt" IS NULL OR "cloudReadingsAt" < $3)
            AND "deletedAt" IS NULL
          RETURNING "_id"`,
          [
            data.projectId.toString(),
            data.connectionId.toString(),
            new Date(data.writtenAt.getTime() - CLOUD_READINGS_STALE_MS),
          ],
        );

      result.cleared = countReturnedRows(cleared);
    } catch (error) {
      logger.error(
        `Cloud connection ${data.connectionId.toString()}: its resources' readings could not be written: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return result;
  }
}
