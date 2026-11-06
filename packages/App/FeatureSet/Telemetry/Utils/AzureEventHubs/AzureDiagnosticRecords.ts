import {
  connectionResourceAttributes,
  stringAttribute,
} from "Common/Server/Utils/CloudConnection/CloudMetricPayload";
import { CloudStreamSighting } from "Common/Server/Utils/CloudConnection/CloudStreamActivity";
import { AZURE_STREAMED_TIME_GRAIN } from "Common/Server/Utils/CloudConnection/CloudStreamedMetrics";
import {
  AzureStreamContext,
  AzureStreamMetricDefinition,
  AzureStreamResource,
} from "Common/Server/Utils/CloudConnection/CloudStreamReader";
import { KafkaRecord } from "Common/Server/Utils/CloudConnection/Kafka/KafkaProtocol";
import { getAzureStoredMetricName } from "Common/Types/Cloud/CloudKeyMetrics";
import { CLOUD_RESOURCE_ID_ATTRIBUTE } from "Common/Types/Cloud/CloudLogGroups";
import {
  ParsedAzureResourceId,
  parseAzureResourceId,
} from "Common/Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { getCanonicalCloudResourceType } from "Common/Types/Cloud/CloudResourceCatalog";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import { DeliveredResource } from "../AwsFirehose/FirehoseRecords";

/*
 * AZURE MONITOR'S DIAGNOSTIC RECORDS, AS OTLP METRICS AND LOGS.
 *
 * A diagnostic setting writes each event of its event hub as one JSON
 * document of records ("Stream Azure monitoring data to an event hub",
 * Azure Monitor documentation) - platform metrics and resource logs alike:
 *
 *   { "records": [
 *       { "count": 1, "total": 12.5, "minimum": 12.5, "maximum": 12.5,
 *         "average": 12.5, "resourceId": "/SUBSCRIPTIONS/<SUB>/RESOURCEGROUPS/<RG>/PROVIDERS/MICROSOFT.COMPUTE/VIRTUALMACHINES/WEB-01",
 *         "time": "2026-11-06T09:59:00.0000000Z", "metricName": "Percentage CPU",
 *         "timeGrain": "PT1M" },
 *       { "time": "...", "resourceId": "...", "category": "AuditEvent",
 *         "operationName": "VaultGet", "resultType": "Success", "level": "Informational",
 *         "location": "westeurope", "properties": { ... } } ] }
 *
 * A record with a metric name is a minute of a platform metric; any other
 * is a resource log.
 *
 * METRICS are written as the connection's read writes them, so a streamed
 * metric and a read one are one series: only the key metrics its reads
 * read each type with (AzureStreamMetricDefinition), and only those they
 * read a minute at a time - a coarser one stays the read's - each as a
 * gauge named azure_<metric>_<the read's aggregation> of that aggregation's
 * value, on the read's own datapoint attributes: the resource's ARM id as
 * the read wrote it (Azure uppercases it in diagnostic records), its name,
 * type, group, location and the time grain. A resource the connection's
 * reads do not hold yet is left to the next read, which writes it once it
 * holds it: its first datapoint decides how its charts filter its series.
 *
 * LOGS are one OTLP resource per resource and one record per log: the
 * connection's telemetry service and id, the subscription
 * (cloud.account.id), the region, and the resource's id as its Logs tab
 * filters on (cloud.resource_id) when the reads hold it. Each record keeps
 * its time, its severity from its level, a message for its body - what the
 * log says, else its operation and result - and its category, operation,
 * result, correlation and caller, and its properties' plain values.
 *
 * No regular expression reads a record; every value kept is bounded.
 */

export const AZURE_STREAM_SCOPE_NAME: string = "oneuptime-azure-event-hubs";

export const AZURE_CATEGORY_ATTRIBUTE: string = "azure.category";
export const AZURE_OPERATION_ATTRIBUTE: string = "azure.operation.name";
export const AZURE_RESULT_TYPE_ATTRIBUTE: string = "azure.result.type";
export const AZURE_RESULT_SIGNATURE_ATTRIBUTE: string = "azure.result.signature";
export const AZURE_CORRELATION_ATTRIBUTE: string = "azure.correlation.id";
export const AZURE_DURATION_ATTRIBUTE: string = "azure.duration_ms";
export const AZURE_RESOURCE_ID_ATTRIBUTE: string = "azure.resource.id";
export const AZURE_PROPERTIES_PREFIX: string = "azure.properties.";

const MAX_VALUE_LENGTH: number = 1024;
const MAX_BODY_LENGTH: number = 64 * 1024;
const MAX_PROPERTIES: number = 50;
// The most records one event's document is read for.
const MAX_RECORDS_PER_EVENT: number = 10_000;
// The time grain a stream writes: a coarser one is the read's to write.
export const STREAMED_TIME_GRAIN: string = AZURE_STREAMED_TIME_GRAIN;

interface OtlpAttribute {
  key: string;
  value: JSONObject;
}

function readObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

function readText(value: unknown, maxLength: number = MAX_VALUE_LENGTH): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed: number = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

// A record's field by its name in any case: Azure writes "level" and "Level", "category" and "Category".
function field(record: JSONObject, name: string): JSONValue | undefined {
  if (record[name] !== undefined) {
    return record[name];
  }

  const lower: string = name.toLowerCase();

  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === lower) {
      return record[key];
    }
  }

  return undefined;
}

// An ISO time as milliseconds, or null.
function readTimeMs(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 64) {
    return null;
  }

  const time: number = Date.parse(value);

  return Number.isFinite(time) && time > 0 ? time : null;
}

function toUnixNano(milliseconds: number): string {
  return `${Math.trunc(milliseconds)}000000`;
}

/*
 * A metric record's value for the aggregation the read reads it with - or
 * null when the minute holds none.
 */
export function readAggregationValue(
  record: JSONObject,
  aggregation: string,
): number | null {
  const count: number | null = readNumber(field(record, "count"));

  switch (aggregation.toLowerCase()) {
    case "average": {
      const average: number | null = readNumber(field(record, "average"));
      const total: number | null = readNumber(field(record, "total"));

      if (average !== null) {
        return average;
      }

      return total !== null && count !== null && count > 0 ? total / count : null;
    }
    case "total":
      return readNumber(field(record, "total"));
    case "count":
      return count;
    case "maximum":
      return readNumber(field(record, "maximum"));
    case "minimum":
      return readNumber(field(record, "minimum"));
  }

  return null;
}

// What a log's level says, in OpenTelemetry's numbers and OneUptime's words.
export const AZURE_LOG_LEVELS: ReadonlyMap<string, { number: number; text: string }> =
  new Map<string, { number: number; text: string }>([
    ["verbose", { number: 5, text: "DEBUG" }],
    ["debug", { number: 5, text: "DEBUG" }],
    ["informational", { number: 9, text: "INFO" }],
    ["information", { number: 9, text: "INFO" }],
    ["info", { number: 9, text: "INFO" }],
    ["warning", { number: 13, text: "WARN" }],
    ["warn", { number: 13, text: "WARN" }],
    ["error", { number: 17, text: "ERROR" }],
    ["critical", { number: 21, text: "FATAL" }],
  ]);

// The fields a log states its message in, tried in order.
const MESSAGE_FIELDS: ReadonlyArray<string> = [
  "message",
  "msg",
  "log",
  "resultDescription",
  "description",
];

/*
 * What a log says, for its body: the message it states, in its properties
 * or on itself - else its operation and how it went, else its properties
 * whole.
 */
export function readAzureLogBody(record: JSONObject): string {
  const properties: JSONObject | null = readObject(field(record, "properties"));

  for (const name of MESSAGE_FIELDS) {
    for (const holder of [properties, record]) {
      const value: JSONValue | undefined = holder ? field(holder, name) : undefined;

      if (typeof value === "string" && value.trim()) {
        return value.slice(0, MAX_BODY_LENGTH);
      }
    }
  }

  const operation: string = readText(field(record, "operationName"));
  const result: string = readText(field(record, "resultType"));
  const signature: string = readText(field(record, "resultSignature"));

  if (operation) {
    return `${operation}${result ? `: ${result}` : ""}${signature ? ` (${signature})` : ""}`;
  }

  if (properties) {
    try {
      return JSON.stringify(properties).slice(0, MAX_BODY_LENGTH);
    } catch {
      return "";
    }
  }

  return "";
}

function scalarAttribute(key: string, value: unknown): OtlpAttribute | null {
  if (typeof value === "string" && value.length > 0) {
    return stringAttribute(key, value.slice(0, MAX_VALUE_LENGTH));
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } };
  }

  if (typeof value === "boolean") {
    return { key, value: { boolValue: value } };
  }

  return null;
}

// A location as Resource Manager writes it: "West Europe" -> westeurope.
function readRegion(value: unknown): string {
  return readText(value, 64).toLowerCase().split(" ").join("");
}

export interface AzureDiagnosticDecoded {
  resourceMetrics: Array<DeliveredResource>;
  resourceLogs: Array<DeliveredResource>;
  datapoints: number;
  logRecords: number;
  // Events that held no document of records, or records of neither kind.
  unrecognized: number;
  // Metric minutes left to the connection's read.
  leftToRead: number;
  sightings: Array<CloudStreamSighting>;
}

interface Place {
  subscriptionId: string;
  region: string;
}

/*
 * One fetch's events as OTLP, and where they came from. A record that is
 * neither kind, or names no resource, is counted and left out.
 */
export function decodeAzureDiagnosticEvents(data: {
  records: Array<KafkaRecord>;
  context: AzureStreamContext;
  namespaceRegion: string;
  observedAtMs: number;
}): AzureDiagnosticDecoded {
  const decoded: AzureDiagnosticDecoded = {
    resourceMetrics: [],
    resourceLogs: [],
    datapoints: 0,
    logRecords: 0,
    unrecognized: 0,
    leftToRead: 0,
    sightings: [],
  };
  // Subscription -> metric name -> its datapoints, as the read groups them.
  const metricGroups: Map<
    string,
    Map<string, { unit: string; dataPoints: Array<JSONObject> }>
  > = new Map();
  // Resource id -> its log resource.
  const logGroups: Map<
    string,
    { attributes: Array<OtlpAttribute>; records: Array<JSONObject> }
  > = new Map();
  const metricPlaces: Map<string, { place: Place; types: Set<string> }> = new Map();
  const logPlaces: Map<string, { place: Place; categories: Set<string> }> = new Map();
  const observed: string = toUnixNano(data.observedAtMs);

  for (const kafkaRecord of data.records) {
    let document: JSONObject | null = null;

    try {
      document = readObject(JSON.parse(kafkaRecord.value!.toString("utf8")));
    } catch {
      document = null;
    }

    const records: JSONValue | undefined = document?.["records"];

    if (!Array.isArray(records)) {
      decoded.unrecognized++;
      continue;
    }

    for (const raw of records.slice(0, MAX_RECORDS_PER_EVENT)) {
      const record: JSONObject | null = readObject(raw);
      const resourceId: string = record ? readText(field(record, "resourceId")) : "";
      const parsed: ParsedAzureResourceId | null = resourceId
        ? parseAzureResourceId(resourceId)
        : null;

      if (!record || !parsed) {
        decoded.unrecognized++;
        continue;
      }

      const known: AzureStreamResource | undefined = data.context.resources.get(
        resourceId.toLowerCase(),
      );
      const type: string = known?.type ||
        getCanonicalCloudResourceType(CloudProvider.Azure, parsed.type);
      const subscriptionId: string = (
        known?.subscriptionId || parsed.subscriptionId
      ).toLowerCase();
      const metricName: string = readText(field(record, "metricName"));

      if (metricName) {
        const definition: AzureStreamMetricDefinition | undefined = data.context.definitions
          .get(type.toLowerCase())
          ?.get(metricName.toLowerCase());
        const timeMs: number | null = readTimeMs(field(record, "time"));
        const grain: string = readText(field(record, "timeGrain")).toUpperCase();

        // Not a key metric, not read a minute at a time, or a resource the reads do not hold yet.
        if (
          !definition ||
          definition.grain !== STREAMED_TIME_GRAIN ||
          (grain && grain !== STREAMED_TIME_GRAIN) ||
          !known ||
          timeMs === null
        ) {
          decoded.leftToRead++;
          continue;
        }

        const value: number | null = readAggregationValue(record, definition.aggregation);

        if (value === null) {
          continue;
        }

        const name: string = getAzureStoredMetricName(
          definition.name,
          definition.aggregation,
        );
        let byName: Map<string, { unit: string; dataPoints: Array<JSONObject> }> | undefined =
          metricGroups.get(subscriptionId);

        if (!byName) {
          byName = new Map();
          metricGroups.set(subscriptionId, byName);
        }

        let metric: { unit: string; dataPoints: Array<JSONObject> } | undefined =
          byName.get(name);

        if (!metric) {
          metric = { unit: definition.unit, dataPoints: [] };
          byName.set(name, metric);
        }

        metric.dataPoints.push({
          startTimeUnixNano: toUnixNano(timeMs),
          timeUnixNano: toUnixNano(timeMs),
          asDouble: value,
          attributes: [
            stringAttribute("azuremonitor.resource_id", known.resourceId),
            stringAttribute("name", known.name),
            stringAttribute("type", known.type || type),
            stringAttribute("resource_group", known.resourceGroup || parsed.resourceGroup),
            ...(known.region ? [stringAttribute("location", known.region)] : []),
            stringAttribute("timegrain", STREAMED_TIME_GRAIN),
          ] as unknown as JSONArray,
        });
        decoded.datapoints++;

        // The resource's own region, as the read writes it on each datapoint: the key the read leaves to the stream.
        const region: string = known.region;
        const placeKey: string = `${subscriptionId}|${region}`;
        const place: { place: Place; types: Set<string> } = metricPlaces.get(placeKey) || {
          place: { subscriptionId, region },
          types: new Set<string>(),
        };
        place.types.add(known.type || type);
        metricPlaces.set(placeKey, place);
        continue;
      }

      // A resource log.
      const category: string = readText(field(record, "category"), 256);
      const timeMs: number | null =
        readTimeMs(field(record, "time")) ||
        readTimeMs(field(record, "timeStamp")) ||
        readTimeMs(field(record, "TimeGenerated"));
      const region: string =
        known?.region || readRegion(field(record, "location")) || data.namespaceRegion;
      const groupKey: string = resourceId.toLowerCase();
      let group: { attributes: Array<OtlpAttribute>; records: Array<JSONObject> } | undefined =
        logGroups.get(groupKey);

      if (!group) {
        group = {
          attributes: [
            ...connectionResourceAttributes({
              serviceName: data.context.serviceName,
              connectionId: data.context.connectionId.toString(),
              cloudProvider: CloudProvider.Azure,
            }),
            stringAttribute("cloud.account.id", subscriptionId),
            ...(region ? [stringAttribute("cloud.region", region)] : []),
            stringAttribute(AZURE_RESOURCE_ID_ATTRIBUTE, known?.resourceId || resourceId),
            ...(known
              ? [stringAttribute(CLOUD_RESOURCE_ID_ATTRIBUTE, known.providerResourceId)]
              : []),
          ],
          records: [],
        };
        logGroups.set(groupKey, group);
      }

      const level: string = readText(field(record, "level"), 32).toLowerCase();
      const properties: JSONObject | null = readObject(field(record, "properties"));
      const propertyLevel: string = properties
        ? readText(field(properties, "level"), 32).toLowerCase()
        : "";
      // The log's own level, where its properties say it (a function's), else the record's.
      const severity: { number: number; text: string } | undefined =
        AZURE_LOG_LEVELS.get(propertyLevel) || AZURE_LOG_LEVELS.get(level);
      const attributes: Array<OtlpAttribute> = [];
      const add: (key: string, value: unknown) => void = (
        key: string,
        value: unknown,
      ): void => {
        const attribute: OtlpAttribute | null = scalarAttribute(key, value);

        if (attribute) {
          attributes.push(attribute);
        }
      };

      add(AZURE_CATEGORY_ATTRIBUTE, category);
      add(AZURE_OPERATION_ATTRIBUTE, field(record, "operationName"));
      add(AZURE_RESULT_TYPE_ATTRIBUTE, field(record, "resultType"));
      add(AZURE_RESULT_SIGNATURE_ATTRIBUTE, field(record, "resultSignature"));
      add(AZURE_CORRELATION_ATTRIBUTE, field(record, "correlationId"));
      add("client.address", field(record, "callerIpAddress"));
      add(AZURE_DURATION_ATTRIBUTE, readNumber(field(record, "durationMs")));

      if (properties) {
        for (const key of Object.keys(properties).slice(0, MAX_PROPERTIES)) {
          if (key !== "__proto__") {
            add(`${AZURE_PROPERTIES_PREFIX}${key}`, properties[key]);
          }
        }
      }

      group.records.push({
        timeUnixNano: timeMs !== null ? toUnixNano(timeMs) : observed,
        observedTimeUnixNano: observed,
        severityNumber: severity ? severity.number : 0,
        severityText: severity ? severity.text : "",
        body: { stringValue: readAzureLogBody(record) },
        attributes: attributes as unknown as JSONArray,
      });
      decoded.logRecords++;

      const placeKey: string = `${subscriptionId}|${region}`;
      const place: { place: Place; categories: Set<string> } = logPlaces.get(placeKey) || {
        place: { subscriptionId, region },
        categories: new Set<string>(),
      };

      if (category) {
        place.categories.add(category);
      }

      logPlaces.set(placeKey, place);
    }
  }

  for (const [subscriptionId, byName] of metricGroups) {
    let count: number = 0;
    const metrics: Array<JSONObject> = [];

    for (const [name, metric] of byName) {
      metrics.push({
        name,
        unit: metric.unit,
        gauge: { dataPoints: metric.dataPoints as unknown as JSONArray },
      });
      count += metric.dataPoints.length;
    }

    decoded.resourceMetrics.push({
      resource: {
        resource: {
          attributes: [
            ...connectionResourceAttributes({
              serviceName: data.context.serviceName,
              connectionId: data.context.connectionId.toString(),
              cloudProvider: CloudProvider.Azure,
            }),
            stringAttribute("azuremonitor.subscription_id", subscriptionId),
          ] as unknown as JSONArray,
        },
        scopeMetrics: [
          {
            scope: { name: AZURE_STREAM_SCOPE_NAME },
            metrics: metrics as unknown as JSONArray,
          },
        ] as unknown as JSONArray,
      },
      count,
    });
  }

  for (const group of logGroups.values()) {
    decoded.resourceLogs.push({
      resource: {
        resource: { attributes: group.attributes as unknown as JSONArray },
        scopeLogs: [
          {
            scope: { name: AZURE_STREAM_SCOPE_NAME },
            logRecords: group.records as unknown as JSONArray,
          },
        ] as unknown as JSONArray,
      },
      count: group.records.length,
    });
  }

  const sightings: Map<string, CloudStreamSighting> = new Map();

  for (const [key, entry] of metricPlaces) {
    sightings.set(key, {
      accountId: entry.place.subscriptionId,
      region: entry.place.region,
      namespaces: Array.from(entry.types),
    });
  }

  for (const [key, entry] of logPlaces) {
    const existing: CloudStreamSighting | undefined = sightings.get(key);

    sightings.set(key, {
      accountId: entry.place.subscriptionId,
      region: entry.place.region,
      ...(existing?.namespaces ? { namespaces: existing.namespaces } : {}),
      logGroups: Array.from(entry.categories),
    });
  }

  decoded.sightings = Array.from(sightings.values());

  return decoded;
}
