import { JSONObject } from "Common/Types/JSON";

/*
 * Vercel log drain deliveries, as OpenTelemetry logs.
 *
 * Vercel posts a project's runtime, build, edge, firewall and request logs
 * to a drain as a JSON array of records, or as NDJSON - one record a line
 * (https://vercel.com/docs/drains/reference/logs). Each delivery is turned
 * into an OTLP ExportLogsServiceRequest and goes through the same pipeline
 * as OTLP logs: the drop filters, scrub rules and pipelines, the services,
 * retention and billing.
 *
 * Each Vercel project is a service: records are grouped into one resource
 * per project, environment and deployment, named after the project
 * (service.name), with the project, deployment and environment as resource
 * attributes. A record's time is its own (Vercel's timestamp, in
 * milliseconds); its level is its severity; its message is its body - or,
 * for a request with no message, the request itself ("GET /checkout 200").
 * Its other fields are attributes: the HTTP ones under OpenTelemetry's
 * names, the rest under vercel.*.
 *
 * Every value is copied as it is; nothing here runs a regular expression
 * over a message, which may be up to 256 KB.
 */

export interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string;
  boolValue?: boolean;
  doubleValue?: number;
}

export interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

// Vercel's level, as OpenTelemetry's severity.
const SEVERITY_OF_LEVEL: Record<string, { number: number; text: string }> = {
  info: { number: 9, text: "INFO" },
  warning: { number: 13, text: "WARN" },
  error: { number: 17, text: "ERROR" },
  fatal: { number: 21, text: "FATAL" },
};

// A record's string fields and the attribute each one becomes.
const STRING_FIELDS: Array<[field: string, attribute: string]> = [
  ["id", "vercel.log.id"],
  ["source", "vercel.source"],
  ["host", "vercel.host"],
  ["requestId", "vercel.request.id"],
  ["path", "vercel.path"],
  ["entrypoint", "vercel.entrypoint"],
  ["type", "vercel.type"],
  ["buildId", "vercel.build.id"],
  ["edgeType", "vercel.edge_type"],
  ["executionRegion", "vercel.execution_region"],
  ["branch", "vercel.branch"],
  ["customEnvironment", "vercel.custom_environment"],
  ["destination", "vercel.destination"],
  ["ja3Digest", "vercel.ja3_digest"],
  ["ja4Digest", "vercel.ja4_digest"],
];

// The proxy (request) fields and the attribute each one becomes.
const PROXY_STRING_FIELDS: Array<[field: string, attribute: string]> = [
  ["method", "http.request.method"],
  ["host", "server.address"],
  ["path", "url.path"],
  ["referer", "http.request.header.referer"],
  ["clientIp", "client.address"],
  ["scheme", "url.scheme"],
  ["region", "vercel.proxy.region"],
  ["cacheId", "vercel.cache.id"],
  ["pathType", "vercel.path_type"],
  ["pathTypeVariant", "vercel.path_type_variant"],
  ["vercelId", "vercel.id"],
  ["vercelCache", "vercel.cache"],
  ["lambdaRegion", "vercel.lambda_region"],
  ["wafAction", "vercel.waf.action"],
  ["wafRuleId", "vercel.waf.rule_id"],
];

const HEX_TRACE_ID_LENGTH: number = 32;
const HEX_SPAN_ID_LENGTH: number = 16;

export default class VercelLogDrain {
  /*
   * The records of a delivery: a JSON array, a single record, or NDJSON.
   * Lines that are not JSON objects are skipped; a body with none is an
   * empty delivery.
   */
  public static parseBody(body: Buffer | string): Array<JSONObject> {
    const text: string =
      typeof body === "string" ? body : body.toString("utf8");

    const start: number = VercelLogDrain.firstNonSpace(text);

    if (start === -1) {
      return [];
    }

    if (text[start] === "[") {
      try {
        const parsed: unknown = JSON.parse(text);
        return Array.isArray(parsed)
          ? parsed.filter(VercelLogDrain.isRecord)
          : [];
      } catch {
        return [];
      }
    }

    const records: Array<JSONObject> = [];
    let lineStart: number = 0;

    while (lineStart < text.length) {
      let lineEnd: number = text.indexOf("\n", lineStart);

      if (lineEnd === -1) {
        lineEnd = text.length;
      }

      const line: string = text.substring(lineStart, lineEnd).trim();

      if (line) {
        try {
          const parsed: unknown = JSON.parse(line);

          if (VercelLogDrain.isRecord(parsed)) {
            records.push(parsed);
          }
        } catch {
          // Not a record: skipped.
        }
      }

      lineStart = lineEnd + 1;
    }

    return records;
  }

  public static toOtlpLogs(
    records: Array<JSONObject>,
    options?: { observedAtInMs?: number | undefined },
  ): JSONObject {
    const observedTimeUnixNano: string = VercelLogDrain.toUnixNano(
      options?.observedAtInMs ?? Date.now(),
    );

    const resources: Map<
      string,
      { attributes: Array<OtlpKeyValue>; logRecords: Array<JSONObject> }
    > = new Map();

    for (const record of records) {
      const projectId: string = VercelLogDrain.readString(record["projectId"]);
      const projectName: string = VercelLogDrain.readString(
        record["projectName"],
      );
      const environment: string = VercelLogDrain.readString(
        record["environment"],
      );
      const deploymentId: string = VercelLogDrain.readString(
        record["deploymentId"],
      );

      const key: string = JSON.stringify([
        projectId,
        projectName,
        environment,
        deploymentId,
      ]);

      let resource:
        | { attributes: Array<OtlpKeyValue>; logRecords: Array<JSONObject> }
        | undefined = resources.get(key);

      if (!resource) {
        const attributes: Array<OtlpKeyValue> = [
          {
            key: "service.name",
            value: { stringValue: projectName || projectId || "vercel" },
          },
          { key: "cloud.provider", value: { stringValue: "vercel" } },
        ];

        if (projectId) {
          attributes.push({
            key: "vercel.project.id",
            value: { stringValue: projectId },
          });
        }

        if (projectName) {
          attributes.push({
            key: "vercel.project.name",
            value: { stringValue: projectName },
          });
        }

        if (environment) {
          attributes.push({
            key: "deployment.environment.name",
            value: { stringValue: environment },
          });
        }

        if (deploymentId) {
          attributes.push({
            key: "vercel.deployment.id",
            value: { stringValue: deploymentId },
          });
        }

        resource = { attributes: attributes, logRecords: [] };
        resources.set(key, resource);
      }

      resource.logRecords.push(
        VercelLogDrain.toLogRecord(record, observedTimeUnixNano),
      );
    }

    return {
      resourceLogs: Array.from(resources.values()).map(
        (resource: {
          attributes: Array<OtlpKeyValue>;
          logRecords: Array<JSONObject>;
        }): JSONObject => {
          return {
            resource: { attributes: resource.attributes },
            scopeLogs: [
              {
                scope: { name: "vercel-log-drain" },
                logRecords: resource.logRecords,
              },
            ],
          } as unknown as JSONObject;
        },
      ),
    } as unknown as JSONObject;
  }

  public static toLogRecord(
    record: JSONObject,
    observedTimeUnixNano: string,
  ): JSONObject {
    const timestamp: unknown = record["timestamp"];
    const level: string = VercelLogDrain.readString(
      record["level"],
    ).toLowerCase();
    const severity: { number: number; text: string } | undefined =
      SEVERITY_OF_LEVEL[level];

    const proxy: JSONObject =
      record["proxy"] &&
      typeof record["proxy"] === "object" &&
      !Array.isArray(record["proxy"])
        ? (record["proxy"] as JSONObject)
        : {};

    const attributes: Array<OtlpKeyValue> = [];

    for (const [field, attribute] of STRING_FIELDS) {
      const value: string = VercelLogDrain.readString(record[field]);

      if (value) {
        attributes.push({ key: attribute, value: { stringValue: value } });
      }
    }

    const statusCode: number | null = VercelLogDrain.readInteger(
      record["statusCode"],
    );

    if (statusCode !== null) {
      // -1: the function crashed before it answered.
      attributes.push({
        key: "http.response.status_code",
        value: { intValue: String(statusCode) },
      });
    }

    for (const [field, attribute] of PROXY_STRING_FIELDS) {
      const value: string = VercelLogDrain.readString(proxy[field]);

      if (value) {
        attributes.push({ key: attribute, value: { stringValue: value } });
      }
    }

    const userAgent: unknown = proxy["userAgent"];
    const userAgentText: string = Array.isArray(userAgent)
      ? userAgent
          .filter((part: unknown): part is string => {
            return typeof part === "string";
          })
          .join(" ")
      : VercelLogDrain.readString(userAgent);

    if (userAgentText) {
      attributes.push({
        key: "user_agent.original",
        value: { stringValue: userAgentText },
      });
    }

    const proxyStatusCode: number | null = VercelLogDrain.readInteger(
      proxy["statusCode"],
    );

    if (proxyStatusCode !== null) {
      attributes.push({
        key: "vercel.proxy.status_code",
        value: { intValue: String(proxyStatusCode) },
      });
    }

    const responseByteSize: number | null = VercelLogDrain.readInteger(
      proxy["responseByteSize"],
    );

    if (responseByteSize !== null) {
      attributes.push({
        key: "http.response.body.size",
        value: { intValue: String(responseByteSize) },
      });
    }

    const logRecord: JSONObject = {
      timeUnixNano:
        typeof timestamp === "number" && Number.isFinite(timestamp)
          ? VercelLogDrain.toUnixNano(timestamp)
          : observedTimeUnixNano,
      observedTimeUnixNano: observedTimeUnixNano,
      severityNumber: severity ? severity.number : 0,
      severityText: severity ? severity.text : level.toUpperCase(),
      body: { stringValue: VercelLogDrain.getBody(record, proxy) },
      attributes: attributes as unknown as JSONObject[],
    } as unknown as JSONObject;

    const traceId: string = VercelLogDrain.readHexId(
      record["traceId"] ?? record["trace.id"],
      HEX_TRACE_ID_LENGTH,
    );
    const spanId: string = VercelLogDrain.readHexId(
      record["spanId"] ?? record["span.id"],
      HEX_SPAN_ID_LENGTH,
    );

    if (traceId) {
      logRecord["traceId"] = traceId;
    }

    if (spanId) {
      logRecord["spanId"] = spanId;
    }

    return logRecord;
  }

  // The message, or - for a request logged without one - the request.
  private static getBody(record: JSONObject, proxy: JSONObject): string {
    const message: unknown = record["message"];

    if (typeof message === "string" && message) {
      return message;
    }

    const method: string = VercelLogDrain.readString(proxy["method"]);
    const path: string = VercelLogDrain.readString(proxy["path"]);

    if (method || path) {
      const status: number | null =
        VercelLogDrain.readInteger(proxy["statusCode"]) ??
        VercelLogDrain.readInteger(record["statusCode"]);

      return [method, path, status !== null ? String(status) : ""]
        .filter((part: string): boolean => {
          return Boolean(part);
        })
        .join(" ");
    }

    return "";
  }

  // Milliseconds since the epoch, as the nanoseconds OTLP counts in.
  public static toUnixNano(milliseconds: number): string {
    return `${Math.trunc(milliseconds)}000000`;
  }

  private static readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private static readInteger(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) ? value : null;
  }

  // A trace or span ID in hex, as OTLP JSON writes it; anything else is dropped.
  private static readHexId(value: unknown, length: number): string {
    if (typeof value !== "string" || value.length !== length) {
      return "";
    }

    for (let index: number = 0; index < value.length; index++) {
      const code: number = value.charCodeAt(index);
      const isHex: boolean =
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 70) ||
        (code >= 97 && code <= 102);

      if (!isHex) {
        return "";
      }
    }

    return value.toLowerCase();
  }

  private static isRecord(value: unknown): value is JSONObject {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  private static firstNonSpace(text: string): number {
    for (let index: number = 0; index < text.length; index++) {
      const char: string = text[index]!;

      if (char !== " " && char !== "\n" && char !== "\r" && char !== "\t") {
        return index;
      }
    }

    return -1;
  }
}
