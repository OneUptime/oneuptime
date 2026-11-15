import AuditLogExporter from "../../../Server/AuditLogExport/AuditLogExporter";
import {
  getExportRedactedFields,
  redactAuditLogExportRecord,
} from "../../../Server/AuditLogExport/AuditLogExportRedaction";
import { toNdjson } from "../../../Server/AuditLogExport/AuditLogExportFiles";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import { getAuditLogRedactedColumns } from "Common/Types/AuditLog/AuditLogRedaction";
import { getColumnAccessControlForAllColumns } from "Common/Types/Database/AccessControl/ColumnAccessControl";
import {
  AuditLogExportRecord,
  toAuditLogExportRecord,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A RENAMED MODEL'S ENTRIES ARE REDACTED ON THEIR WAY OUT TOO (#7580).
 *
 * An exported entry is redacted again by its resource type
 * (AuditLogExportRedaction): the model's listed, encrypted and hashed
 * columns and the columns nobody may read, for an entry recorded before a
 * field was listed. The redaction was keyed by each model's name on
 * screen, and #6817 renamed fifteen models on screen while their entries
 * kept being stored under the old names: an Ingestion Key's entries are
 * stored as "Telemetry Ingestion Key", which the redaction no longer knew,
 * so they went out as they were stored - its secret key included.
 *
 * It is keyed by the name entries are stored under, and by the name on
 * screen too, as the audit log reads a type by either.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "75800000-0000-4000-8000-000000000201",
);

const INGESTION_KEY_SECRET: string = "75800000-aaaa-4bbb-8ccc-000000000202";

interface RenamedModel {
  table: string;
  kept: string;
  screen: string;
  model: BaseModel;
}

const RENAMED: Array<RenamedModel> = DatabaseModels.map(
  (modelType: DatabaseBaseModelType): BaseModel => {
    return new modelType();
  },
)
  .filter((model: BaseModel): boolean => {
    return Boolean(model.apiSingularName) && Boolean(model.enableAuditLogOn);
  })
  .map((model: BaseModel): RenamedModel => {
    return {
      table: model.tableName!,
      kept: model.apiSingularName!,
      screen: model.singularName!,
      model: model,
    };
  });

// An entry as the audit table answers it, recorded before its secret was listed.
function storedRow(data: {
  resourceType: string;
  changes: Array<JSONObject>;
}): JSONObject {
  return {
    _id: ObjectID.generate().toString(),
    createdAt: "2026-11-01 08:00:00",
    projectId: PROJECT_ID.toString(),
    action: "Create",
    resourceType: data.resourceType,
    resourceName: "Production collector",
    changes: JSON.stringify(data.changes),
  };
}

describe("an exported entry about a renamed model", () => {
  test("the renamed models audited are the ones the redaction must know", () => {
    expect(
      RENAMED.map((renamed: RenamedModel): string => {
        return renamed.table;
      }),
    ).toContain("TelemetryIngestionKey");
    expect(RENAMED.length).toBeGreaterThanOrEqual(10);
  });

  test("an Ingestion Key's secret key is a field the export redacts", () => {
    expect(
      getAuditLogRedactedColumns(new TelemetryIngestionKey()).has("secretKey"),
    ).toBe(true);
  });

  /*
   * REGRESSION: keyed by "Ingestion Key", the redaction knew nothing of
   * "Telemetry Ingestion Key", the type every such entry is stored under.
   */
  test("REGRESSION: an Ingestion Key's entry, stored under the name it kept, goes out without its secret", () => {
    const batch: Array<AuditLogExportRecord> = AuditLogExporter.toBatch({
      rows: [
        storedRow({
          resourceType: "Telemetry Ingestion Key",
          changes: [
            { field: "name", newValue: "Production collector" },
            { field: "secretKey", newValue: INGESTION_KEY_SECRET },
          ],
        }),
      ],
      maxBytes: 1024 * 1024,
    });

    expect(batch[0]!.changes).toEqual([
      { field: "name", newValue: "Production collector" },
      { field: "secretKey", newValue: "[REDACTED]" },
    ]);
    expect(toNdjson(batch)).not.toContain(INGESTION_KEY_SECRET);
  });

  test("an Ingestion Key's entry stored under its name today goes out without its secret too", () => {
    const record: AuditLogExportRecord = toAuditLogExportRecord(
      storedRow({
        resourceType: "Ingestion Key",
        changes: [
          {
            field: "secretKey",
            oldValue: INGESTION_KEY_SECRET,
            newValue: null,
          },
        ],
      }),
    )!;

    expect(redactAuditLogExportRecord(record).changes).toEqual([
      { field: "secretKey", oldValue: "[REDACTED]", newValue: null },
    ]);
  });

  test.each(RENAMED)(
    "$screen's entries are redacted by the name they are stored under, $kept, and by today's",
    (renamed: RenamedModel) => {
      // The listed, encrypted and hashed columns, and those nobody may read.
      const expected: Set<string> = getAuditLogRedactedColumns(renamed.model);
      const access: Record<string, { read?: Array<unknown> }> =
        getColumnAccessControlForAllColumns(renamed.model) as Record<
          string,
          { read?: Array<unknown> }
        >;

      for (const column of Object.keys(access)) {
        const read: Array<unknown> | undefined = access[column]?.read;

        if (Array.isArray(read) && read.length === 0) {
          expected.add(column);
        }
      }

      expect({
        table: renamed.table,
        redacted: [...getExportRedactedFields(renamed.kept)].sort(),
      }).toEqual({ table: renamed.table, redacted: [...expected].sort() });
      expect({
        table: renamed.table,
        redacted: [...getExportRedactedFields(renamed.screen)].sort(),
      }).toEqual({ table: renamed.table, redacted: [...expected].sort() });
    },
  );

  test("a model never renamed is redacted by its one name, as it was", () => {
    expect(getExportRedactedFields("API Key").has("apiKey")).toBe(true);
    expect(getExportRedactedFields("Monitor").has("name")).toBe(false);
    expect(getExportRedactedFields("Something Else").size).toBe(0);
  });
});
