import AuditLogExporter from "../../../Server/AuditLogExport/AuditLogExporter";
import {
  AuditLogExportModelType,
  buildExportRedactedFieldsByResourceType,
  getExportRedactedFields,
  redactAuditLogExportRecord,
} from "../../../Server/AuditLogExport/AuditLogExportRedaction";
import { toNdjson } from "../../../Server/AuditLogExport/AuditLogExportFiles";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationTemplateStatusPage from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplateStatusPage";
import { getAuditLogRedactedColumns } from "Common/Types/AuditLog/AuditLogRedaction";
import {
  AuditLogExportRecord,
  toAuditLogExportRecord,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import ColumnAccessControl, {
  getColumnAccessControlForAllColumns,
} from "Common/Types/Database/AccessControl/ColumnAccessControl";
import EnableAuditLog from "Common/Types/Database/EnableAuditLog";
import TableColumn from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import TableMetadata from "Common/Types/Database/TableMetadata";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { getAuditLogResourceTypesOfModel } from "Common/Utils/AuditLog/AuditLogResourceTypes";
import { describe, expect, test } from "@jest/globals";

/*
 * EACH MODEL KEEPS ITS OWN REDACTED FIELDS, WHATEVER TYPE ITS ENTRIES CARRY
 * (#10664).
 *
 * An exported entry is redacted again by its resource type
 * (AuditLogExportRedaction): the fields its model redacts - listed,
 * encrypted and hashed columns, and the ones nobody may read - for an entry
 * recorded before a field was listed. A status page's link to a subscriber
 * notification template had the template's own name, "Subscriber
 * Notification Template", until #10664, and the redaction was keyed one
 * model at a time: the link's fields overwrote the template's, so a
 * template's entry was redacted by the link's fields alone. A type two
 * models' entries carry now redacts what either redacts, and a model's own
 * type redacts its own fields: the link's entries are "Status Page
 * Subscriber Notification Template" since, and its older ones keep the
 * template's name. An AI rule's entries from before its rename carry
 * "Auto Remediation Rule", which the redaction knew nothing of.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10664000-0000-4000-8000-000000000301",
);

const SHARED_NAME: string = "Planted Notification Template";
const RENAMED_NAME: string = "Planted Page Notification Template";

const TEMPLATE_TYPE: string = "Subscriber Notification Template";
const LINK_TYPE: string = "Status Page Subscriber Notification Template";

// What the export redacts of a model's entries, worked out as it is.
function redactedOf(model: BaseModel): Set<string> {
  const fields: Set<string> = getAuditLogRedactedColumns(model);
  const access: Record<string, { read?: Array<unknown> }> =
    getColumnAccessControlForAllColumns(model) as Record<
      string,
      { read?: Array<unknown> }
    >;

  for (const column of Object.keys(access)) {
    const read: Array<unknown> | undefined = access[column]?.read;

    if (Array.isArray(read) && read.length === 0) {
      fields.add(column);
    }
  }

  return fields;
}

function sorted(fields: Set<string> | undefined): Array<string> {
  return [...(fields || new Set<string>())].sort();
}

// An entry as the audit table answers it.
function storedRow(data: {
  resourceType: string;
  changes: Array<JSONObject>;
}): JSONObject {
  return {
    _id: ObjectID.generate().toString(),
    createdAt: "2026-11-20 08:00:00",
    projectId: PROJECT_ID.toString(),
    action: "Update",
    resourceType: data.resourceType,
    changes: JSON.stringify(data.changes),
  };
}

describe("two models of one name, as a template and its link to a status page were", () => {
  /*
   * REGRESSION: keyed one model at a time, the later model's fields
   * replaced the earlier one's under the name they shared.
   */
  test("REGRESSION: each keeps the fields it redacts under the name they share, in either order", () => {
    const orders: Array<Array<AuditLogExportModelType>> = [
      [PlantedNotificationTemplate, PlantedNotificationTemplatePage],
      [PlantedNotificationTemplatePage, PlantedNotificationTemplate],
    ];

    for (const order of orders) {
      const map: Map<
        string,
        Set<string>
      > = buildExportRedactedFieldsByResourceType(order);

      expect(sorted(map.get(SHARED_NAME))).toEqual(
        expect.arrayContaining(["signingKey", "pageSecret"]),
      );
      expect(map.get(SHARED_NAME)!.has("name")).toBe(false);
    }
  });

  test("one renamed from the other's name redacts its own fields under its own name, and both models' under the name they shared", () => {
    const map: Map<
      string,
      Set<string>
    > = buildExportRedactedFieldsByResourceType([
      PlantedNotificationTemplate,
      PlantedRenamedTemplatePage,
    ]);

    expect(sorted(map.get(RENAMED_NAME))).toEqual(
      sorted(redactedOf(new PlantedRenamedTemplatePage())),
    );
    expect(map.get(RENAMED_NAME)!.has("pageSecret")).toBe(true);
    expect(map.get(RENAMED_NAME)!.has("signingKey")).toBe(false);

    // Its older entries carry the template's name: either one's.
    expect(sorted(map.get(SHARED_NAME))).toEqual(
      expect.arrayContaining(["signingKey", "pageSecret"]),
    );
  });

  test("each type has a set of its own, so no model's fields are changed through another's", () => {
    const map: Map<
      string,
      Set<string>
    > = buildExportRedactedFieldsByResourceType([
      PlantedRenamedTemplatePage,
      PlantedNotificationTemplate,
    ]);

    expect(map.get(RENAMED_NAME)).not.toBe(map.get(SHARED_NAME));
    expect(map.get(RENAMED_NAME)!.has("signingKey")).toBe(false);
  });

  test("a model the audit log does not record gives no type", () => {
    const map: Map<
      string,
      Set<string>
    > = buildExportRedactedFieldsByResourceType([PlantedUnaudited]);

    expect(map.size).toBe(0);
  });

  test("an entry of the shared name goes out with what either model redacts", () => {
    const map: Map<
      string,
      Set<string>
    > = buildExportRedactedFieldsByResourceType([
      PlantedNotificationTemplate,
      PlantedNotificationTemplatePage,
    ]);

    expect(map.get(SHARED_NAME)!.has("signingKey")).toBe(true);
    expect(map.get(SHARED_NAME)!.has("pageSecret")).toBe(true);
  });
});

describe("a subscriber notification template and its link to a status page", () => {
  test("the link's entries are redacted by its own fields under its own name", () => {
    expect(sorted(getExportRedactedFields(LINK_TYPE))).toEqual(
      sorted(
        redactedOf(new StatusPageSubscriberNotificationTemplateStatusPage()),
      ),
    );
  });

  test("the entries under the template's name are redacted by everything either redacts", () => {
    const redacted: Set<string> = getExportRedactedFields(TEMPLATE_TYPE);

    for (const model of [
      new StatusPageSubscriberNotificationTemplate(),
      new StatusPageSubscriberNotificationTemplateStatusPage(),
    ]) {
      const missing: Array<string> = sorted(redactedOf(model)).filter(
        (field: string): boolean => {
          return !redacted.has(field);
        },
      );

      expect({ table: model.tableName, missing }).toEqual({
        table: model.tableName,
        missing: [],
      });
    }
  });

  test("an old link entry and a new one go out without what the link redacts", () => {
    const deletedBy: string = ObjectID.generate().toString();

    expect(
      redactAuditLogExportRecord(
        toAuditLogExportRecord(
          storedRow({
            resourceType: LINK_TYPE,
            changes: [{ field: "deletedByUserId", newValue: deletedBy }],
          }),
        )!,
      ).changes,
    ).toEqual([{ field: "deletedByUserId", newValue: "[REDACTED]" }]);

    const batch: Array<AuditLogExportRecord> = AuditLogExporter.toBatch({
      rows: [
        storedRow({
          resourceType: TEMPLATE_TYPE,
          changes: [
            {
              field: "statusPageId",
              newValue: ObjectID.generate().toString(),
            },
            { field: "deletedByUserId", newValue: deletedBy },
          ],
        }),
      ],
      maxBytes: 1024 * 1024,
    });

    expect(batch[0]!.changes[1]).toEqual({
      field: "deletedByUserId",
      newValue: "[REDACTED]",
    });
    expect(toNdjson(batch)).not.toContain(deletedBy);
  });
});

describe("a model renamed", () => {
  /*
   * REGRESSION: an AI rule's entries recorded before it was renamed carry
   * "Auto Remediation Rule", which no model had, so they went out as they
   * were stored.
   */
  test("REGRESSION: an AI rule's entries from before its rename are redacted as an AI rule's", () => {
    const expected: Array<string> = sorted(
      redactedOf(new AutoRemediationRule()),
    );

    expect(expected.length).toBeGreaterThan(0);
    expect(sorted(getExportRedactedFields("Auto Remediation Rule"))).toEqual(
      expected,
    );
    expect(sorted(getExportRedactedFields("AI Rule"))).toEqual(expected);
  });

  test("every audited model's fields are redacted under every type its entries can carry", () => {
    const missing: Array<string> = [];

    for (const modelType of DatabaseModels as Array<DatabaseBaseModelType>) {
      const model: BaseModel = new modelType();

      if (!model.enableAuditLogOn) {
        continue;
      }

      const own: Set<string> = redactedOf(model);

      for (const resourceType of getAuditLogResourceTypesOfModel(model)) {
        const redacted: Set<string> = getExportRedactedFields(resourceType);

        for (const field of own) {
          if (!redacted.has(field)) {
            missing.push(`${model.tableName} (${resourceType}): ${field}`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

/*
 * The models planted here: a template whose signing key is redacted, its
 * link to a page of the template's own name, whose page secret nobody may
 * read, the same link renamed away from that name, and a model the audit
 * log does not record.
 */
@EnableAuditLog({
  create: true,
  update: true,
  delete: true,
  redactColumns: ["signingKey"],
})
@TableMetadata({
  tableName: "PlantedNotificationTemplate",
  singularName: SHARED_NAME,
  pluralName: "Planted Notification Templates",
  icon: IconProp.Email,
  tableDescription: "A template whose signing key no export carries.",
})
class PlantedNotificationTemplate extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [Permission.ProjectOwner],
    update: [],
  })
  @TableColumn({ type: TableColumnType.ShortText, title: "Name" })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.ProjectOwner],
    update: [],
  })
  @TableColumn({ type: TableColumnType.ShortText, title: "Signing Key" })
  public signingKey?: string = undefined;
}

@EnableAuditLog({ create: true, update: true, delete: true })
@TableMetadata({
  tableName: "PlantedNotificationTemplatePage",
  singularName: SHARED_NAME,
  pluralName: "Planted Notification Templates",
  icon: IconProp.Link,
  tableDescription: "A template's link to a page, of the template's name.",
})
class PlantedNotificationTemplatePage extends BaseModel {
  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.ShortText, title: "Page Secret" })
  public pageSecret?: string = undefined;
}

@EnableAuditLog({ create: true, update: true, delete: true })
@TableMetadata({
  tableName: "PlantedRenamedTemplatePage",
  singularName: RENAMED_NAME,
  pluralName: "Planted Page Notification Templates",
  formerSingularName: SHARED_NAME,
  icon: IconProp.Link,
  tableDescription: "The same link, renamed away from the template's name.",
})
class PlantedRenamedTemplatePage extends BaseModel {
  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.ShortText, title: "Page Secret" })
  public pageSecret?: string = undefined;
}

@TableMetadata({
  tableName: "PlantedUnaudited",
  singularName: "Planted Unaudited",
  pluralName: "Planted Unaudited",
  icon: IconProp.Lock,
  tableDescription: "No project's record: the audit log does not record it.",
})
class PlantedUnaudited extends BaseModel {
  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.ShortText, title: "Secret" })
  public secret?: string = undefined;
}
