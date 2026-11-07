import { describe, expect, test } from "@jest/globals";
import { CloudStreamSighting } from "Common/Server/Utils/CloudConnection/CloudStreamActivity";
import { KafkaRecord } from "Common/Server/Utils/CloudConnection/Kafka/KafkaProtocol";
import { JSONObject } from "Common/Types/JSON";
import {
  AZURE_LOG_LEVELS,
  AzureDiagnosticDecoded,
  decodeAzureDiagnosticEvents,
  readAggregationValue,
  readAzureLogBody,
} from "../../FeatureSet/Telemetry/Utils/AzureEventHubs/AzureDiagnosticRecords";
import {
  AKS_ID,
  CONNECTION_ID,
  MINUTE_MS,
  SITE_ID,
  STORAGE_ID,
  SUBSCRIPTION,
  VAULT_ID,
  VM_ID,
  aksRecord,
  appServiceConsoleRecord,
  eventOf,
  functionAppRecord,
  metricRecord,
  streamContext,
  vaultAuditRecord,
} from "./Helpers/AzureDiagnosticEvents";

/*
 * Azure Monitor's diagnostic records, read as OTLP: a platform metric's
 * minute as the very gauge a connection's read writes - only the key
 * metrics its reads read a minute at a time, of the resources its reads
 * hold, on the read's own datapoint attributes and the ARM id in the
 * reads' casing - and a resource log as a record of the resource whose Logs
 * tab reads it, its body what it says, its level as its severity.
 */

function decode(
  events: Array<Buffer | null>,
  context: ReturnType<typeof streamContext> = streamContext(),
): AzureDiagnosticDecoded {
  return decodeAzureDiagnosticEvents({
    records: events.map((value: Buffer | null, index: number): KafkaRecord => {
      return { offset: index, timestampMs: MINUTE_MS, value };
    }),
    context,
    namespaceRegion: "eastus",
    observedAtMs: MINUTE_MS + 120_000,
  });
}

function attributes(list: unknown): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  for (const attribute of list as Array<JSONObject>) {
    const value: JSONObject = attribute["value"] as JSONObject;
    values[attribute["key"] as string] =
      value["stringValue"] ??
      value["intValue"] ??
      value["doubleValue"] ??
      value["boolValue"];
  }

  return values;
}

function metricsOf(decoded: AzureDiagnosticDecoded): Array<JSONObject> {
  return decoded.resourceMetrics.flatMap(
    (delivered: { resource: JSONObject }) => {
      return (delivered.resource["scopeMetrics"] as Array<JSONObject>)[0]![
        "metrics"
      ] as Array<JSONObject>;
    },
  );
}

function logsOf(
  decoded: AzureDiagnosticDecoded,
): Array<{ resource: Record<string, unknown>; record: JSONObject }> {
  return decoded.resourceLogs.flatMap((delivered: { resource: JSONObject }) => {
    const resource: Record<string, unknown> = attributes(
      (delivered.resource["resource"] as JSONObject)["attributes"],
    );

    return (
      (delivered.resource["scopeLogs"] as Array<JSONObject>)[0]![
        "logRecords"
      ] as Array<JSONObject>
    ).map((record: JSONObject) => {
      return { resource, record };
    });
  });
}

describe("a platform metric's minute", () => {
  test("is the gauge the connection's read writes: its name, unit, value and datapoint attributes, the ARM id in the reads' casing", () => {
    const decoded: AzureDiagnosticDecoded = decode([
      eventOf([
        metricRecord({
          resourceId: VM_ID,
          metricName: "Percentage CPU",
          total: 50,
          count: 4,
          minimum: 10,
          maximum: 20,
        }),
      ]),
    ]);

    expect(decoded.datapoints).toBe(1);
    expect(decoded.resourceMetrics).toHaveLength(1);

    const resource: Record<string, unknown> = attributes(
      (decoded.resourceMetrics[0]!.resource["resource"] as JSONObject)[
        "attributes"
      ],
    );
    expect(resource).toEqual({
      "service.name": "Production Azure",
      "cloud.provider": "azure",
      "oneuptime.cloud.connection.id": CONNECTION_ID.toString(),
      "azuremonitor.subscription_id": SUBSCRIPTION,
    });

    const metric: JSONObject = metricsOf(decoded)[0]!;
    expect(metric["name"]).toBe("azure_percentage_cpu_average");
    expect(metric["unit"]).toBe("Percent");

    const point: JSONObject = (
      (metric["gauge"] as JSONObject)["dataPoints"] as Array<JSONObject>
    )[0]!;
    expect(point["asDouble"]).toBe(12.5);
    expect(point["timeUnixNano"]).toBe(`${MINUTE_MS}000000`);
    expect(point["startTimeUnixNano"]).toBe(`${MINUTE_MS}000000`);
    expect(attributes(point["attributes"])).toEqual({
      // Azure wrote it in capitals; the series is the read's.
      "azuremonitor.resource_id": VM_ID,
      name: "web-01",
      type: "Microsoft.Compute/virtualMachines",
      resource_group: "rg-Prod",
      location: "eastus",
      timegrain: "PT1M",
    });
  });

  test("each aggregation is the read's: Total the total, Count the count, Average the average", () => {
    const decoded: AzureDiagnosticDecoded = decode([
      eventOf([
        metricRecord({
          resourceId: SITE_ID,
          metricName: "Requests",
          total: 1200,
          count: 60,
          minimum: 0,
          maximum: 70,
        }),
        metricRecord({
          resourceId: SITE_ID,
          metricName: "Http5xx",
          total: 3,
          count: 60,
          minimum: 0,
          maximum: 2,
        }),
        metricRecord({
          resourceId: SITE_ID,
          metricName: "HttpResponseTime",
          total: 6,
          count: 60,
          minimum: 0.01,
          maximum: 0.9,
        }),
        metricRecord({
          resourceId: VAULT_ID,
          metricName: "ServiceApiHit",
          total: 9,
          count: 9,
          minimum: 1,
          maximum: 1,
        }),
      ]),
    ]);

    const byName: Record<string, number> = {};

    for (const metric of metricsOf(decoded)) {
      byName[metric["name"] as string] = (
        (metric["gauge"] as JSONObject)["dataPoints"] as Array<JSONObject>
      )[0]!["asDouble"] as number;
    }

    expect(byName).toEqual({
      azure_requests_total: 1200,
      azure_http5xx_total: 3,
      azure_httpresponsetime_average: 0.1,
      azure_serviceapihit_count: 9,
    });
  });

  test("an average Azure leaves out is the total over the count; a minute without one writes nothing", () => {
    expect(readAggregationValue({ total: 30, count: 3 }, "Average")).toBe(10);
    expect(readAggregationValue({ total: 30, count: 0 }, "Average")).toBeNull();
    expect(readAggregationValue({ maximum: 9, minimum: 1 }, "Maximum")).toBe(9);
    expect(readAggregationValue({ maximum: 9, minimum: 1 }, "Minimum")).toBe(1);
    expect(readAggregationValue({ total: "41.5" }, "Total")).toBe(41.5);
    expect(readAggregationValue({ total: 1 }, "Percentile")).toBeNull();
  });

  test("is left to the read when it is no key metric, is read at a coarser grain, or is of a resource the reads do not hold", () => {
    const stranger: string = VM_ID.replace("web-01", "web-99");
    const decoded: AzureDiagnosticDecoded = decode([
      eventOf([
        metricRecord({
          resourceId: VM_ID,
          metricName: "Disk Read Operations/Sec",
          total: 1,
          count: 1,
          minimum: 1,
          maximum: 1,
        }),
        metricRecord({
          resourceId: STORAGE_ID,
          metricName: "UsedCapacity",
          total: 5e9,
          count: 1,
          minimum: 5e9,
          maximum: 5e9,
        }),
        metricRecord({
          resourceId: VM_ID,
          metricName: "Percentage CPU",
          total: 1,
          count: 1,
          minimum: 1,
          maximum: 1,
          timeGrain: "PT1H",
        }),
        metricRecord({
          resourceId: stranger,
          metricName: "Percentage CPU",
          total: 1,
          count: 1,
          minimum: 1,
          maximum: 1,
        }),
        metricRecord({
          resourceId: STORAGE_ID,
          metricName: "Transactions",
          total: 12,
          count: 12,
          minimum: 1,
          maximum: 1,
        }),
      ]),
    ]);

    expect(decoded.leftToRead).toBe(4);
    expect(
      metricsOf(decoded).map((metric: JSONObject) => {
        return metric["name"];
      }),
    ).toEqual(["azure_transactions_total"]);
  });

  test("its sighting is the subscription, the resource's own region and its type: what the read leaves to the stream", () => {
    const decoded: AzureDiagnosticDecoded = decode([
      eventOf([
        metricRecord({
          resourceId: VM_ID,
          metricName: "Percentage CPU",
          total: 1,
          count: 1,
          minimum: 1,
          maximum: 1,
        }),
        metricRecord({
          resourceId: VAULT_ID,
          metricName: "ServiceApiHit",
          total: 1,
          count: 1,
          minimum: 1,
          maximum: 1,
        }),
      ]),
    ]);

    expect(
      decoded.sightings.map((sighting: CloudStreamSighting) => {
        return [sighting.accountId, sighting.region, sighting.namespaces];
      }),
    ).toEqual([
      [SUBSCRIPTION, "eastus", ["Microsoft.Compute/virtualMachines"]],
      [SUBSCRIPTION, "westeurope", ["Microsoft.KeyVault/vaults"]],
    ]);
  });
});

describe("a resource log", () => {
  test("is a record of its resource: what its Logs tab filters on, its subscription and region", () => {
    const decoded: AzureDiagnosticDecoded = decode([
      eventOf([vaultAuditRecord()]),
    ]);
    const logs: Array<{
      resource: Record<string, unknown>;
      record: JSONObject;
    }> = logsOf(decoded);

    expect(logs).toHaveLength(1);
    expect(logs[0]!.resource).toEqual({
      "service.name": "Production Azure",
      "cloud.provider": "azure",
      "oneuptime.cloud.connection.id": CONNECTION_ID.toString(),
      "cloud.account.id": SUBSCRIPTION,
      "cloud.region": "westeurope",
      "azure.resource.id": VAULT_ID,
      "cloud.resource_id": VAULT_ID,
    });
    // No platform: no app is made up from the connection's service.
    expect(logs[0]!.resource["cloud.platform"]).toBeUndefined();
  });

  test("says what it says: an audit event's operation and result, its fields beside it, never its caller's claims", () => {
    const { record } = logsOf(decode([eventOf([vaultAuditRecord()])]))[0]!;
    const fields: Record<string, unknown> = attributes(record["attributes"]);

    expect((record["body"] as JSONObject)["stringValue"]).toBe(
      "SecretGet: Success (OK)",
    );
    expect(record["severityText"]).toBe("INFO");
    expect(record["timeUnixNano"]).toBe(
      `${Date.UTC(2026, 10, 6, 9, 59, 12, 123)}000000`,
    );
    expect(fields).toMatchObject({
      "azure.category": "AuditEvent",
      "azure.operation.name": "SecretGet",
      "azure.result.type": "Success",
      "azure.result.signature": "OK",
      "azure.correlation.id": "6e8a5a4b-3d2c-4b1a-9f8e-7d6c5b4a3f2e",
      "client.address": "203.0.113.24",
      "azure.duration_ms": "43",
      "azure.properties.httpStatusCode": "200",
      "azure.properties.isAccessPolicyMatch": true,
    });
    expect(JSON.stringify(record)).not.toContain("alice@acme.com");
  });

  test("an App Service line's message is its body; a function's log takes its own level", () => {
    const logs: Array<{
      resource: Record<string, unknown>;
      record: JSONObject;
    }> = logsOf(
      decode([eventOf([appServiceConsoleRecord(), functionAppRecord()])]),
    );

    expect(logs).toHaveLength(2);
    expect((logs[0]!.record["body"] as JSONObject)["stringValue"]).toContain(
      "connect ECONNREFUSED 10.0.0.5:5432",
    );
    expect(logs[0]!.record["severityText"]).toBe("ERROR");
    expect((logs[1]!.record["body"] as JSONObject)["stringValue"]).toBe(
      "Executed 'Functions.ChargeCard' (Failed, Id=3f9a, Duration=1022ms)",
    );
    expect(logs[1]!.record["severityText"]).toBe("ERROR");
    // Both are the site's.
    expect(logs[0]!.resource["cloud.resource_id"]).toBe(SITE_ID);
  });

  test("a resource the reads do not hold streams unfiled, under its own id and the location it states", () => {
    const logs: Array<{
      resource: Record<string, unknown>;
      record: JSONObject;
    }> = logsOf(decode([eventOf([aksRecord({ location: "West Europe" })])]));

    expect(logs[0]!.resource["cloud.resource_id"]).toBeUndefined();
    expect(logs[0]!.resource["azure.resource.id"]).toBe(AKS_ID.toUpperCase());
    expect(logs[0]!.resource["cloud.region"]).toBe("westeurope");
    expect((logs[0]!.record["body"] as JSONObject)["stringValue"]).toContain(
      "apiserver received an error",
    );
  });

  test("its sighting is the subscription, the region and its category", () => {
    const decoded: AzureDiagnosticDecoded = decode([
      eventOf([
        vaultAuditRecord(),
        vaultAuditRecord({ category: "AzurePolicyEvaluationDetails" }),
      ]),
    ]);

    expect(decoded.sightings).toEqual([
      {
        accountId: SUBSCRIPTION,
        region: "westeurope",
        logGroups: ["AuditEvent", "AzurePolicyEvaluationDetails"],
      },
    ]);
  });

  test("levels are said as OneUptime says them", () => {
    expect(AZURE_LOG_LEVELS.get("informational")).toEqual({
      number: 9,
      text: "INFO",
    });
    expect(AZURE_LOG_LEVELS.get("warning")).toEqual({
      number: 13,
      text: "WARN",
    });
    expect(AZURE_LOG_LEVELS.get("critical")).toEqual({
      number: 21,
      text: "FATAL",
    });
    expect(AZURE_LOG_LEVELS.get("verbose")).toEqual({
      number: 5,
      text: "DEBUG",
    });
  });

  test("a log that states no message is its operation and result, else its properties whole", () => {
    expect(
      readAzureLogBody({ operationName: "VaultGet", resultType: "Success" }),
    ).toBe("VaultGet: Success");
    expect(readAzureLogBody({ properties: { a: 1 } })).toBe('{"a":1}');
    expect(readAzureLogBody({ Properties: { Message: "capitals" } })).toBe(
      "capitals",
    );
    expect(readAzureLogBody({})).toBe("");
  });
});

describe("what is neither", () => {
  test("an event that is no document of records, or a record that names no resource, is counted and left out", () => {
    const decoded: AzureDiagnosticDecoded = decode([
      Buffer.from("not json"),
      Buffer.from(JSON.stringify({ hello: "world" })),
      eventOf([
        { metricName: "Percentage CPU" },
        { resourceId: "not-an-arm-id", category: "x" },
      ]),
    ]);

    expect(decoded.unrecognized).toBe(4);
    expect(decoded.resourceMetrics).toEqual([]);
    expect(decoded.resourceLogs).toEqual([]);
  });

  test("one event is read for at most 10,000 records", () => {
    const decoded: AzureDiagnosticDecoded = decode([
      eventOf(
        Array.from({ length: 10_050 }, () => {
          return vaultAuditRecord();
        }),
      ),
    ]);

    expect(decoded.logRecords).toBe(10_000);
  });

  test("a body and the fields kept are bounded, however much a log holds", () => {
    const properties: JSONObject = {};

    for (let index: number = 0; index < 80; index++) {
      properties[`field${index}`] = "v".repeat(5000);
    }

    const { record } = logsOf(
      decode([
        eventOf([
          vaultAuditRecord({
            properties: { ...properties, message: "m".repeat(200_000) },
          }),
        ]),
      ]),
    )[0]!;
    const fields: Record<string, unknown> = attributes(record["attributes"]);

    expect(
      ((record["body"] as JSONObject)["stringValue"] as string).length,
    ).toBe(64 * 1024);
    expect(
      Object.keys(fields).filter((key: string) => {
        return key.startsWith("azure.properties.");
      }).length,
    ).toBeLessThanOrEqual(50);
    expect(String(fields["azure.properties.field0"]).length).toBe(1024);
  });
});
