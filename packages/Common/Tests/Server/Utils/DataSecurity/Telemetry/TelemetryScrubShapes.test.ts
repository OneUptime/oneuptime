import { describe, expect, test } from "@jest/globals";
import { ContentScanOptions } from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import { getScrubTarget } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import { ScrubPlanFindingRecord } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubPlan";
import { describeScrubPlace } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubShapes";
import DataCategory from "../../../../../Types/DataSecurity/DataCategory";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { ScrubRuleWriterPlace } from "../../../../../Types/DataSecurity/ScrubRuleWriterPlace";
import { ScrubTarget } from "../../../../../Types/DataSecurity/TelemetryScrubTarget";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * A FINDING'S PLACE AS ONEUPTIME AI IS TOLD IT (#10366): the records it
 * was seen in, read by plain code into the shapes of their values and the
 * names beside them - and nothing of the values themselves.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000001036d0",
);
const CHECKOUT: string = "0192f1a0-0000-7000-8000-0000001036d1";

const OPTIONS: ContentScanOptions = {
  limits: {
    maxObjects: 2000,
    maxBytesPerObject: 65536,
    maxBytesTotal: 52428800,
    maxRowsPerTable: 1000,
    maxTables: 200,
    deadline: new Date("2026-11-22T11:00:00.000Z"),
  },
  customDetectors: [],
  extraHints: [],
  disabledDataTypeIds: new Set<string>(),
  allowedValues: new Set<string>(),
  exclusions: [],
  fingerprintKey: "shapes-test",
};

function finding(location: string): ScrubPlanFindingRecord {
  return {
    findingId: "0192f1a0-0000-7000-8000-0000001036df",
    kind: DataStoreKind.TelemetryLogs,
    dataTypeId: "person-name",
    dataCategory: DataCategory.ContactAndIdentity,
    location,
    target: getScrubTarget(
      DataStoreKind.TelemetryLogs,
      location,
    ) as ScrubTarget & {
      signal: "log";
    },
    sampleRecords: [
      {
        time: "2026-11-22T09:30:00.000Z",
        logId: ObjectID.generate().toString(),
      },
    ],
    lastSeenAt: new Date("2026-11-22T09:30:00.000Z"),
  };
}

function row(key: string, value: string): JSONObject {
  return {
    ownerId: CHECKOUT,
    recordTime: 1795000000000 + Math.floor(Math.random() * 1000),
    readLogId: ObjectID.generate().toString(),
    readAttributes: [[key, value]],
  };
}

describe("a place, as OneUptime AI is told it", () => {
  test("its type, where it sits, the names beside it and the shapes of its values - never a value", async () => {
    const values: Array<string> = ["Jane Doe", "Robert Johnson", "Ann Lee"];
    const place: ScrubRuleWriterPlace | null = await describeScrubPlace({
      projectId: PROJECT_ID,
      ref: "P1",
      finding: finding("attributes.customer_name"),
      dataTypeName: "Person name",
      serviceId: CHECKOUT,
      options: OPTIONS,
      now: new Date("2026-11-22T10:00:00.000Z"),
      readRows: async (): Promise<Array<JSONObject>> => {
        return values.map((value: string): JSONObject => {
          return row("customer_name", value);
        });
      },
      readNeighbours: async (): Promise<Array<string>> => {
        return ["customer_id", "plan"];
      },
    });

    expect(place).toEqual(
      expect.objectContaining({
        ref: "P1",
        dataTypeId: "person-name",
        dataTypeName: "Person name",
        category: DataCategory.ContactAndIdentity,
        foundBy: "name",
        signal: "log",
        location: "attributes.customer_name",
        attributeKey: "customer_name",
        locationKind: "Attribute",
        neighbours: ["customer_id", "plan"],
      }),
    );
    expect(
      place!.shapes.map((shape: { shape: string }): string => {
        return shape.shape;
      }),
    ).toEqual(
      expect.arrayContaining(["Aaaa Aaa", "Aaaaaa Aaaaaaa", "Aaa Aaa"]),
    );

    const told: string = JSON.stringify(place);

    for (const value of values) {
      expect(told).not.toContain(value);
    }
  });

  test("nothing to tell when no value could be read there", async () => {
    expect(
      await describeScrubPlace({
        projectId: PROJECT_ID,
        ref: "P1",
        finding: finding("attributes.customer_name"),
        dataTypeName: "Person name",
        serviceId: CHECKOUT,
        options: OPTIONS,
        readRows: async (): Promise<Array<JSONObject>> => {
          throw new Error("ClickHouse is down");
        },
        readNeighbours: async (): Promise<Array<string>> => {
          return [];
        },
      }),
    ).toBeNull();
  });
});
