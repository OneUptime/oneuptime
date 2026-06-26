import Dashboard from "../../Models/DatabaseModels/Dashboard";
import Monitor from "../../Models/DatabaseModels/Monitor";
import ScheduledMaintenanceTemplate from "../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import EventInterval from "../../Types/Events/EventInterval";
import Recurring from "../../Types/Events/Recurring";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import ModelImportExport, {
  MODEL_EXPORT_FILE_TYPE,
  MODEL_EXPORT_SCHEMA_VERSION,
} from "../../Utils/ModelImportExport";
import { describe, expect, test } from "@jest/globals";

describe("ModelImportExport", () => {
  describe("getImportExportableColumnNames", () => {
    test("should include user-editable configuration columns for Dashboard", () => {
      const columns: Array<string> =
        ModelImportExport.getImportExportableColumnNames(Dashboard);

      expect(columns).toContain("name");
      expect(columns).toContain("description");
      expect(columns).toContain("dashboardViewConfig");
    });

    test("should exclude server-controlled and system columns", () => {
      const columns: Array<string> =
        ModelImportExport.getImportExportableColumnNames(Dashboard);

      expect(columns).not.toContain("_id");
      expect(columns).not.toContain("createdAt");
      expect(columns).not.toContain("updatedAt");
      expect(columns).not.toContain("deletedAt");
      expect(columns).not.toContain("version");
      expect(columns).not.toContain("slug");
    });

    test("should exclude the tenant column", () => {
      const columns: Array<string> =
        ModelImportExport.getImportExportableColumnNames(Dashboard);

      expect(columns).not.toContain("projectId");
    });

    test("should exclude entity relations and their foreign key columns", () => {
      const columns: Array<string> =
        ModelImportExport.getImportExportableColumnNames(Dashboard);

      expect(columns).not.toContain("labels");
      expect(columns).not.toContain("createdByUser");
      expect(columns).not.toContain("createdByUserId");
      expect(columns).not.toContain("deletedByUser");
      expect(columns).not.toContain("deletedByUserId");
      expect(columns).not.toContain("logoFile");
      expect(columns).not.toContain("logoFileId");
    });

    test("should include monitor configuration columns", () => {
      const columns: Array<string> =
        ModelImportExport.getImportExportableColumnNames(Monitor);

      expect(columns).toContain("name");
      expect(columns).toContain("monitorType");
      expect(columns).toContain("monitorSteps");
      expect(columns).not.toContain("currentMonitorStatusId");
      expect(columns).not.toContain("projectId");
      expect(columns).not.toContain("slug");
    });

    test("should exclude status page foreign keys and relations", () => {
      const columns: Array<string> =
        ModelImportExport.getImportExportableColumnNames(StatusPage);

      expect(columns).toContain("name");
      expect(columns).not.toContain("projectId");
      expect(columns).not.toContain("labels");
      expect(columns).not.toContain("faviconFileId");
    });

    test("should exclude plain-text credentials via the per-table exclusion list", () => {
      const columns: Array<string> =
        ModelImportExport.getImportExportableColumnNames(StatusPage);

      expect(columns).not.toContain("embeddedOverallStatusToken");
    });

    test("should exclude monitor runtime-state columns", () => {
      const columns: Array<string> =
        ModelImportExport.getImportExportableColumnNames(Monitor);

      expect(columns).not.toContain("incomingMonitorRequest");
      expect(columns).not.toContain("serverMonitorResponse");
      expect(columns).not.toContain("incomingRequestMonitorHeartbeatCheckedAt");
      expect(columns).not.toContain("serverMonitorRequestReceivedAt");
      expect(columns).not.toContain("telemetryMonitorNextMonitorAt");
      expect(columns).not.toContain("telemetryMonitorLastMonitorAt");
    });
  });

  describe("getImportExportSelect", () => {
    test("should build a select object from exportable columns", () => {
      const select: JSONObject = ModelImportExport.getImportExportSelect(
        Dashboard,
      ) as JSONObject;

      expect(select["name"]).toBe(true);
      expect(select["dashboardViewConfig"]).toBe(true);
      expect(select["_id"]).toBeUndefined();
      expect(select["projectId"]).toBeUndefined();
    });
  });

  describe("buildExportEnvelope and toExportJSON", () => {
    test("should build a valid envelope and strip non-exportable columns", () => {
      const dashboard: Dashboard = new Dashboard();
      dashboard.name = "My Dashboard";
      dashboard.description = "My Description";
      dashboard._id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      dashboard.projectId = new ObjectID(
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      );

      const envelope: JSONObject = ModelImportExport.buildExportEnvelope({
        modelType: Dashboard,
        items: [dashboard],
        exportedAt: new Date("2026-06-11T00:00:00.000Z"),
      });

      expect(envelope["fileType"]).toBe(MODEL_EXPORT_FILE_TYPE);
      expect(envelope["schemaVersion"]).toBe(MODEL_EXPORT_SCHEMA_VERSION);
      expect(envelope["resourceType"]).toBe(new Dashboard().tableName);
      expect(envelope["exportedAt"]).toBe("2026-06-11T00:00:00.000Z");

      const items: Array<JSONObject> = envelope["items"] as Array<JSONObject>;
      expect(items).toHaveLength(1);
      expect(items[0]!["name"]).toBe("My Dashboard");
      expect(items[0]!["description"]).toBe("My Description");
      expect(items[0]!["_id"]).toBeUndefined();
      expect(items[0]!["projectId"]).toBeUndefined();
    });
  });

  describe("parseImportPayload", () => {
    test("should accept a valid envelope", () => {
      const items: Array<JSONObject> = ModelImportExport.parseImportPayload({
        modelType: Dashboard,
        payload: {
          fileType: MODEL_EXPORT_FILE_TYPE,
          schemaVersion: MODEL_EXPORT_SCHEMA_VERSION,
          resourceType: new Dashboard().tableName!,
          items: [{ name: "Imported Dashboard" }],
        },
      });

      expect(items).toHaveLength(1);
      expect(items[0]!["name"]).toBe("Imported Dashboard");
    });

    test("should accept a plain array of items", () => {
      const items: Array<JSONObject> = ModelImportExport.parseImportPayload({
        modelType: Dashboard,
        payload: [{ name: "One" }, { name: "Two" }],
      });

      expect(items).toHaveLength(2);
    });

    test("should accept a single bare item object", () => {
      const items: Array<JSONObject> = ModelImportExport.parseImportPayload({
        modelType: Dashboard,
        payload: { name: "Only One" },
      });

      expect(items).toHaveLength(1);
    });

    test("should reject an envelope for a different resource type", () => {
      expect(() => {
        ModelImportExport.parseImportPayload({
          modelType: Dashboard,
          payload: {
            fileType: MODEL_EXPORT_FILE_TYPE,
            resourceType: new Monitor().tableName!,
            items: [{ name: "A Monitor" }],
          },
        });
      }).toThrow(BadDataException);
    });

    test("should reject an envelope with no items", () => {
      expect(() => {
        ModelImportExport.parseImportPayload({
          modelType: Dashboard,
          payload: {
            fileType: MODEL_EXPORT_FILE_TYPE,
            resourceType: new Dashboard().tableName!,
            items: [],
          },
        });
      }).toThrow(BadDataException);
    });

    test("should reject items that are not objects", () => {
      expect(() => {
        ModelImportExport.parseImportPayload({
          modelType: Dashboard,
          payload: ["not-an-object"] as any,
        });
      }).toThrow(BadDataException);
    });
  });

  describe("fromImportJSON", () => {
    test("should build a model with only importable columns", () => {
      const item: Dashboard = ModelImportExport.fromImportJSON({
        json: {
          _id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          slug: "my-dashboard",
          projectId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          createdAt: "2026-01-01T00:00:00.000Z",
          name: "My Dashboard",
          description: "My Description",
          dashboardViewConfig: { components: [], heightInDashboardUnits: 60 },
          unknownColumn: "should be dropped",
        },
        modelType: Dashboard,
      });

      expect(item.name).toBe("My Dashboard");
      expect(item.description).toBe("My Description");
      expect(item.dashboardViewConfig).toBeDefined();
      expect(item._id).toBeUndefined();
      expect(item.projectId).toBeUndefined();
      expect(item.slug).toBeUndefined();
      expect(item.createdAt).toBeUndefined();
      expect((item as any)["unknownColumn"]).toBeUndefined();
    });

    test("should round-trip an exported dashboard back into a creatable model", () => {
      const original: Dashboard = new Dashboard();
      original.name = "Round Trip";
      original.description = "Round trip description";

      const envelope: JSONObject = ModelImportExport.buildExportEnvelope({
        modelType: Dashboard,
        items: [original],
        exportedAt: new Date(),
      });

      const itemJsons: Array<JSONObject> = ModelImportExport.parseImportPayload(
        {
          modelType: Dashboard,
          payload: envelope,
        },
      );

      const imported: Dashboard = ModelImportExport.fromImportJSON({
        json: itemJsons[0]!,
        modelType: Dashboard,
      });

      expect(imported.name).toBe("Round Trip");
      expect(imported.description).toBe("Round trip description");
      expect(imported._id).toBeUndefined();
    });

    test("should advance past recurring dates for scheduled maintenance templates", () => {
      const dayInMs: number = 24 * 60 * 60 * 1000;

      const template: ScheduledMaintenanceTemplate =
        new ScheduledMaintenanceTemplate();
      template.templateName = "Weekly Maintenance";
      template.isRecurringEvent = true;

      const recurring: Recurring = new Recurring();
      recurring.intervalType = EventInterval.Week;
      recurring.intervalCount = new PositiveNumber(1);
      template.recurringInterval = recurring;

      const pastScheduledAt: Date = new Date(Date.now() - 30 * dayInMs);
      const pastStartsAt: Date = new Date(Date.now() - 29 * dayInMs);
      const pastEndsAt: Date = new Date(
        pastStartsAt.getTime() + 2 * 60 * 60 * 1000,
      );

      template.firstEventScheduledAt = pastScheduledAt;
      template.firstEventStartsAt = pastStartsAt;
      template.firstEventEndsAt = pastEndsAt;

      const envelope: JSONObject = ModelImportExport.buildExportEnvelope({
        modelType: ScheduledMaintenanceTemplate,
        items: [template],
        exportedAt: new Date(),
      });

      const itemJsons: Array<JSONObject> = ModelImportExport.parseImportPayload(
        {
          modelType: ScheduledMaintenanceTemplate,
          payload: envelope,
        },
      );

      const imported: ScheduledMaintenanceTemplate =
        ModelImportExport.fromImportJSON({
          json: itemJsons[0]!,
          modelType: ScheduledMaintenanceTemplate,
        });

      expect(imported.firstEventScheduledAt!.getTime()).toBeGreaterThan(
        Date.now(),
      );
      expect(imported.firstEventStartsAt!.getTime()).toBeGreaterThan(
        Date.now(),
      );
      expect(imported.firstEventEndsAt!.getTime()).toBeGreaterThan(Date.now());

      // offsets between the dates are preserved.
      expect(
        imported.firstEventStartsAt!.getTime() -
          imported.firstEventScheduledAt!.getTime(),
      ).toBe(pastStartsAt.getTime() - pastScheduledAt.getTime());
      expect(
        imported.firstEventEndsAt!.getTime() -
          imported.firstEventStartsAt!.getTime(),
      ).toBe(pastEndsAt.getTime() - pastStartsAt.getTime());
    });

    test("should leave future recurring dates unchanged", () => {
      const dayInMs: number = 24 * 60 * 60 * 1000;

      const template: ScheduledMaintenanceTemplate =
        new ScheduledMaintenanceTemplate();
      template.templateName = "Future Maintenance";
      template.isRecurringEvent = true;

      const recurring: Recurring = new Recurring();
      recurring.intervalType = EventInterval.Day;
      recurring.intervalCount = new PositiveNumber(1);
      template.recurringInterval = recurring;

      const futureScheduledAt: Date = new Date(Date.now() + 10 * dayInMs);
      template.firstEventScheduledAt = futureScheduledAt;
      template.firstEventStartsAt = new Date(Date.now() + 11 * dayInMs);
      template.firstEventEndsAt = new Date(Date.now() + 12 * dayInMs);

      const envelope: JSONObject = ModelImportExport.buildExportEnvelope({
        modelType: ScheduledMaintenanceTemplate,
        items: [template],
        exportedAt: new Date(),
      });

      const imported: ScheduledMaintenanceTemplate =
        ModelImportExport.fromImportJSON({
          json: (envelope["items"] as Array<JSONObject>)[0]!,
          modelType: ScheduledMaintenanceTemplate,
        });

      expect(imported.firstEventScheduledAt!.getTime()).toBe(
        futureScheduledAt.getTime(),
      );
    });
  });
});
