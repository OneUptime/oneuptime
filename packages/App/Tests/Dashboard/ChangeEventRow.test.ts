import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
/*
 * Sibling-relative like the modules under test: the `Common` specifier
 * can resolve a checkout that predates this branch's files.
 */
import {
  DEFAULT_CHANGE_EVENT_TYPE,
  MAX_CHANGE_EVENT_ATTRIBUTES,
  MAX_CHANGE_EVENT_DESCRIPTION_LENGTH,
  MAX_CHANGE_EVENT_TITLE_LENGTH,
  ParsedChangeEventEntry,
  buildChangeEventDbRow,
  extractChangeEventEntries,
  parseChangeEventIngestEntry,
} from "../../../Common/Server/Utils/Telemetry/ChangeEventRow";
import ChangeEvent from "../../../Common/Models/AnalyticsModels/ChangeEvent";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";

const PROJECT_ID: ObjectID = new ObjectID(
  "5a1b6b0e-0000-4000-8000-0000000000cc",
);

function repoPath(relative: string): string {
  return path.join(__dirname, "../../..", relative);
}

function readSquashed(relative: string): string {
  return fs.readFileSync(repoPath(relative), "utf8").replace(/\s+/g, " ");
}

describe("extractChangeEventEntries", () => {
  test("accepts { events: [...] }, bare arrays, and a single bare object", () => {
    expect(
      extractChangeEventEntries({ events: [{ title: "a" }, { title: "b" }] }),
    ).toHaveLength(2);
    expect(extractChangeEventEntries([{ title: "a" }])).toHaveLength(1);
    expect(extractChangeEventEntries({ title: "solo" })).toHaveLength(1);
  });

  test("rejects garbage shapes", () => {
    expect(extractChangeEventEntries(null)).toEqual([]);
    expect(extractChangeEventEntries("deploy")).toEqual([]);
    expect(extractChangeEventEntries({ events: "not-an-array" })).toEqual([]);
    expect(extractChangeEventEntries([1, "x", null])).toEqual([]);
    expect(extractChangeEventEntries({})).toEqual([]);
  });
});

describe("parseChangeEventIngestEntry", () => {
  test("a title is the one hard requirement", () => {
    expect(parseChangeEventIngestEntry({} as JSONObject)).toBeNull();
    expect(parseChangeEventIngestEntry({ title: "   " })).toBeNull();
    expect(parseChangeEventIngestEntry({ title: 42 } as JSONObject)).toBeNull();
    // "name" is accepted as an alias.
    expect(parseChangeEventIngestEntry({ name: "Deploy" })?.title).toBe(
      "Deploy",
    );
  });

  test("repairs rather than rejects: defaults, trims, caps", () => {
    const parsed: ParsedChangeEventEntry | null = parseChangeEventIngestEntry({
      title: `  ${"x".repeat(MAX_CHANGE_EVENT_TITLE_LENGTH + 50)}  `,
      eventType: "  DEPLOYMENT  ",
      description: "y".repeat(MAX_CHANGE_EVENT_DESCRIPTION_LENGTH + 50),
    });

    expect(parsed?.title).toHaveLength(MAX_CHANGE_EVENT_TITLE_LENGTH);
    expect(parsed?.eventType).toBe("deployment");
    expect(parsed?.description).toHaveLength(
      MAX_CHANGE_EVENT_DESCRIPTION_LENGTH,
    );

    const defaulted: ParsedChangeEventEntry | null =
      parseChangeEventIngestEntry({ title: "Deploy" });
    expect(defaulted?.eventType).toBe(DEFAULT_CHANGE_EVENT_TYPE);
    expect(defaulted?.description).toBe("");
    expect(defaulted?.time).toBeNull();
  });

  test("parses ISO strings, epoch seconds, and epoch milliseconds", () => {
    const iso: ParsedChangeEventEntry | null = parseChangeEventIngestEntry({
      title: "a",
      time: "2026-08-20T10:00:00.000Z",
    });
    expect(iso?.time?.toISOString()).toBe("2026-08-20T10:00:00.000Z");

    const seconds: ParsedChangeEventEntry | null = parseChangeEventIngestEntry({
      title: "a",
      timestamp: 1_787_479_200,
    });
    expect(seconds?.time?.getTime()).toBe(1_787_479_200_000);

    const millis: ParsedChangeEventEntry | null = parseChangeEventIngestEntry({
      title: "a",
      time: 1_787_479_200_000,
    });
    expect(millis?.time?.getTime()).toBe(1_787_479_200_000);

    const garbage: ParsedChangeEventEntry | null = parseChangeEventIngestEntry({
      title: "a",
      time: "not-a-date",
    });
    expect(garbage?.time).toBeNull();
  });

  test("keeps only scalar attributes, capped", () => {
    const bigAttributes: JSONObject = {};
    for (let i: number = 0; i < MAX_CHANGE_EVENT_ATTRIBUTES + 10; i++) {
      bigAttributes[`k${i}`] = i;
    }
    const parsed: ParsedChangeEventEntry | null = parseChangeEventIngestEntry({
      title: "a",
      attributes: {
        ...bigAttributes,
        nested: { drop: "me" },
        list: ["drop"],
        ok: true,
      },
    });

    expect(Object.keys(parsed?.attributes || {}).length).toBeLessThanOrEqual(
      MAX_CHANGE_EVENT_ATTRIBUTES,
    );
    expect(parsed?.attributes["nested"]).toBeUndefined();
    expect(parsed?.attributes["list"]).toBeUndefined();
    expect(parsed?.attributes["k0"]).toBe("0");
  });
});

describe("buildChangeEventDbRow", () => {
  function build(overrides: Partial<ParsedChangeEventEntry> = {}): JSONObject {
    return buildChangeEventDbRow({
      parsed: {
        time: new Date(Date.now() - 60_000),
        eventType: "deployment",
        title: "Deploy v1",
        description: "",
        attributes: { version: "1.0.0" },
        ...overrides,
      },
      projectId: PROJECT_ID,
      serviceMetadata: null,
      retentionDays: 30,
    });
  }

  test("serviceless rows omit the service columns entirely", () => {
    const row: JSONObject = build();
    expect(row["projectId"]).toBe(PROJECT_ID.toString());
    expect("primaryEntityId" in row).toBe(false);
    expect("primaryEntityType" in row).toBe(false);
    expect(row["eventType"]).toBe("deployment");
    expect(row["title"]).toBe("Deploy v1");
    expect(row["attributeKeys"]).toEqual(["version"]);
    expect(typeof row["_id"]).toBe("string");
    expect(typeof row["retentionDate"]).toBe("string");
  });

  test("stamps service attribution when metadata is present", () => {
    const serviceId: ObjectID = new ObjectID(
      "6b1b6b0e-0000-4000-8000-0000000000dd",
    );
    const row: JSONObject = buildChangeEventDbRow({
      parsed: {
        time: null,
        eventType: "deployment",
        title: "Deploy",
        description: "",
        attributes: {},
      },
      projectId: PROJECT_ID,
      serviceMetadata: {
        primaryEntityId: serviceId,
        primaryEntityType: "OpenTelemetry",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      retentionDays: 30,
    });

    expect(row["primaryEntityId"]).toBe(serviceId.toString());
    expect(row["primaryEntityType"]).toBe("OpenTelemetry");
  });

  test("clamps ancient and far-future timestamps to ingestion time, preserving the original", () => {
    for (const badTime of [
      new Date("2019-01-01T00:00:00.000Z"),
      new Date(Date.now() + 3 * 60 * 60 * 1000),
    ]) {
      const row: JSONObject = build({ time: badTime });
      const attributes: JSONObject = row["attributes"] as JSONObject;
      expect(attributes["oneuptime.original_time"]).toBe(String(badTime));
      // The clamped time is "now"-ish, not the forged one.
      expect(String(row["time"])).not.toContain("2019");
    }
  });

  test("a recent in-window timestamp is kept verbatim", () => {
    const row: JSONObject = build({
      time: new Date("2026-08-20T10:00:00.000Z"),
    });
    const attributes: JSONObject = row["attributes"] as JSONObject;
    expect(attributes["oneuptime.original_time"]).toBeUndefined();
    expect(String(row["time"])).toContain("2026-08-20");
  });
});

describe("ChangeEvent model + registries", () => {
  test("the model declares the annotation-stream table contract", () => {
    const model: ChangeEvent = new ChangeEvent();
    expect(model.tableName).toBe(AnalyticsTableName.ChangeEvent);
    expect(model.crudApiPath?.toString()).toBe("/change-events");
    expect(model.ttlExpression).toBe("retentionDate DELETE");
    expect(model.sortKeys).toEqual(["projectId", "time"]);
    const columnKeys: Array<string> = model.tableColumns.map(
      (column: { key: string }) => {
        return column.key;
      },
    );
    for (const requiredKey of [
      "projectId",
      "time",
      "eventType",
      "title",
      "attributes",
      "attributeKeys",
      "retentionDate",
    ]) {
      expect(columnKeys).toContain(requiredKey);
    }
  });

  test("both registries carry the model — table creation iterates AnalyticsServices", () => {
    expect(readSquashed("Common/Models/AnalyticsModels/Index.ts")).toContain(
      "ChangeEvent,",
    );
    /*
     * Boot-time createTables() iterates ONLY this array — a model missing
     * here is silently never created.
     */
    expect(readSquashed("Common/Server/Services/Index.ts")).toContain(
      "ChangeEventService, ];",
    );
  });

  test("the ingest route is mounted with ingestion-key auth", () => {
    const route: string = readSquashed(
      "App/FeatureSet/Telemetry/API/ChangeEventsIngest.ts",
    );
    expect(route).toContain("/change-events/v1/ingest");
    /*
     * The SURFACE is the assertion, not just "some auth middleware". A
     * change-event route registered with a browser-capable surface would
     * accept a key scraped off a public page, so the enum member is the
     * thing worth pinning in source.
     */
    expect(route).toContain(
      "TelemetryIngest.forSurface(TelemetryIngestSurface.ChangeEvents)",
    );
    expect(route).toContain("TelemetryIngestionDisabled.middleware");

    expect(readSquashed("App/FeatureSet/Telemetry/Index.ts")).toContain(
      "ChangeEventsIngestAPI",
    );
    expect(readSquashed("App/FeatureSet/BaseAPI/Index.ts")).toContain(
      "BaseAnalyticsAPI<ChangeEvent, ChangeEventServiceType>",
    );
  });

  test("the chart surfaces fetch markers through the shared hook", () => {
    const hook: string = readSquashed(
      "App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines.ts",
    );
    expect(hook).toContain("AnalyticsModelAPI.getList<ChangeEvent>");
    expect(hook).toContain("isPublicDashboard()");
    expect(hook).toContain('strokeDasharray: "4 4"');

    for (const surface of [
      "App/FeatureSet/Dashboard/src/Components/Metrics/MetricExplorer.tsx",
      "App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard.tsx",
      "App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent.tsx",
    ]) {
      expect(readSquashed(surface)).toContain("useEventTimeReferenceLines");
    }
  });
});
