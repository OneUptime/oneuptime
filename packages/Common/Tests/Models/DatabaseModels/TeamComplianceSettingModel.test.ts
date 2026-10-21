import Models from "../../../Models/DatabaseModels/Index";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import TeamComplianceSetting from "../../../Models/DatabaseModels/TeamComplianceSetting";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ColumnType from "../../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import ComplianceNotificationChannel from "../../../Types/Team/ComplianceNotificationChannel";
import ComplianceRuleType from "../../../Types/Team/ComplianceRuleType";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * Schema-level guarantees of TeamComplianceSetting after rules gained
 * channels and a severity scope.
 *
 * None of this is visible to a service or server test - they pass just as
 * happily against a column the API cannot write, a scope a project viewer can
 * edit, or a rule table a lapsed licence can still change. So this pins the
 * scope columns (type, related model, nullability, who may read and write
 * them) - notificationChannels, the list of channels a member needs a rule
 * on, and notificationChannel, the deprecated single channel kept beside it
 * for older clients and builds - that nothing about the table's gating
 * changed (enterprise only, the same table permissions, no workflow
 * components), that the unique (teamId, ruleType) index is gone, and that the
 * API layer turns a posted severity list into models and keeps a posted
 * channel list a list.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = Models as Array<ModelType>;

const model: TeamComplianceSetting = new TeamComplianceSetting();

const EDITORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditProjectTeam,
];

const READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.ReadProjectTeam,
];

/*
 * The columns that together say what a rule checks. notificationChannel is
 * written with the list on every save (it holds the list's first channel), so
 * it is as much a part of the scope as the list.
 */
const SCOPE_COLUMNS: Array<string> = [
  "ruleType",
  "notificationChannels",
  "notificationChannel",
  "incidentSeverities",
  "alertSeverities",
];

const ALL_CHANNELS: Array<ComplianceNotificationChannel> = Object.values(
  ComplianceNotificationChannel,
);

type AccessControlForFunction = (
  column: string,
) => ColumnAccessControl | undefined;

const accessControlFor: AccessControlForFunction = (
  column: string,
): ColumnAccessControl | undefined => {
  return model.getColumnAccessControlForAllColumns()[column];
};

type ColumnArgsFunction = (
  propertyName: string,
) => ColumnMetadataArgs | undefined;

const columnArgs: ColumnArgsFunction = (
  propertyName: string,
): ColumnMetadataArgs | undefined => {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return (
        column.target === TeamComplianceSetting &&
        column.propertyName === propertyName
      );
    },
  );
};

type RelationArgsFunction = (
  propertyName: string,
) => RelationMetadataArgs | undefined;

const relationArgs: RelationArgsFunction = (
  propertyName: string,
): RelationMetadataArgs | undefined => {
  return getMetadataArgsStorage().relations.find(
    (relation: RelationMetadataArgs): boolean => {
      return (
        relation.target === TeamComplianceSetting &&
        relation.propertyName === propertyName
      );
    },
  );
};

describe("TeamComplianceSetting - the table", () => {
  test("is registered, routed and tenant-scoped as before", () => {
    expect(MODEL_TYPES).toContain(TeamComplianceSetting);
    expect(model.tableName).toBe("TeamComplianceSetting");
    expect(model.getCrudApiPath()?.toString()).toBe("/team-compliance-setting");
    expect(model.getTenantColumn()).toBe("projectId");
  });

  test("is still an Enterprise-only table", () => {
    expect(model.requiresEnterprise).toBe(true);
  });

  test("keeps its billing plans", () => {
    expect(model.createBillingPlan).toBe(PlanType.Scale);
    expect(model.readBillingPlan).toBe(PlanType.Free);
    expect(model.updateBillingPlan).toBe(PlanType.Scale);
    expect(model.deleteBillingPlan).toBe(PlanType.Free);
  });

  test("is managed by team editors and readable by every project member", () => {
    expect(model.getCreatePermissions()).toEqual(EDITORS);
    expect(model.getUpdatePermissions()).toEqual(EDITORS);
    expect(model.getDeletePermissions()).toEqual(EDITORS);
    expect(model.getReadPermissions()).toEqual(READERS);
  });

  test("is still workflow-inert: annotated, with every trigger off", () => {
    expect(model.enableWorkflowOn).toEqual({
      create: false,
      delete: false,
      update: false,
      read: false,
    });
  });

  test("has no unique (teamId, ruleType) index any more, and keeps the plain team and project indexes", () => {
    const indexes: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return index.target === TeamComplianceSetting;
        },
      );

    expect(
      indexes.filter((index: IndexMetadataArgs): boolean => {
        return Boolean(index.unique);
      }),
    ).toEqual([]);

    const indexedColumns: Array<string> = indexes
      .map((index: IndexMetadataArgs): string => {
        return JSON.stringify(index.columns);
      })
      .sort();

    expect(indexedColumns).toEqual(
      [JSON.stringify(["projectId"]), JSON.stringify(["teamId"])].sort(),
    );
  });
});

describe("TeamComplianceSetting - the scope columns", () => {
  test("notificationChannels is an optional JSON list, with no default: empty or null means any channel", () => {
    const metadata: TableColumnMetadata = model.getTableColumnMetadata(
      "notificationChannels",
    );

    expect(metadata.type).toBe(TableColumnType.JSON);
    expect(metadata.required).toBe(false);
    expect(metadata.title).toBe("Notification Channels");
    expect(metadata.defaultValue).toBeUndefined();
    expect(metadata.isDefaultValueColumn).toBeFalsy();
    expect(columnArgs("notificationChannels")?.options).toMatchObject({
      type: ColumnType.JSON,
      nullable: true,
    });
    // Rows from before the column are backfilled by a migration, not a default.
    expect(columnArgs("notificationChannels")?.options.default).toBeUndefined();
    expect(ColumnType.JSON).toBe("jsonb");
  });

  test("notificationChannels is a column on the rule row, not a relation", () => {
    expect(columnArgs("notificationChannels")).toBeDefined();
    expect(relationArgs("notificationChannels")).toBeUndefined();
    expect(
      model.getTableColumnMetadata("notificationChannels").modelType,
    ).toBeUndefined();
  });

  test("notificationChannels' API description names every channel it accepts, and says a member needs every one", () => {
    const description: string =
      model.getTableColumnMetadata("notificationChannels").description || "";

    for (const channel of ALL_CHANNELS) {
      expect(description).toContain(channel);
    }

    expect(description).toMatch(/On-call rules only/);
    expect(description).toMatch(/\beach member needs a rule on every one\b/);
    expect(description).toMatch(/Leave empty to accept any channel\.$/);
  });

  test("notificationChannel stays optional short text, and says it is deprecated in favour of the list", () => {
    const metadata: TableColumnMetadata = model.getTableColumnMetadata(
      "notificationChannel",
    );

    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(metadata.required).toBe(false);
    expect(metadata.title).toBe("Notification Channel");
    expect(metadata.description).toMatch(
      /^Deprecated: use notificationChannels\./,
    );
    // What a client that only knows this field needs to hear.
    expect(metadata.description).toContain(
      "first of the rule's notification channels",
    );
    expect(metadata.description).toContain(
      "Sending this field without notificationChannels sets the rule to that one channel",
    );
    expect(columnArgs("notificationChannel")?.options).toMatchObject({
      type: ColumnType.ShortText,
      length: ColumnLength.ShortText,
      nullable: true,
    });
    expect(columnArgs("notificationChannel")?.options.default).toBeUndefined();
  });

  test("notificationChannel's API description still names every channel it accepts", () => {
    const description: string =
      model.getTableColumnMetadata("notificationChannel").description || "";

    for (const channel of ALL_CHANNELS) {
      expect(description).toContain(channel);
    }
  });

  test("both channel columns are documented for the API: a client of either finds its field", () => {
    for (const column of ["notificationChannels", "notificationChannel"]) {
      expect({
        column,
        hidden: Boolean(
          model.getTableColumnMetadata(column).hideColumnInDocumentation,
        ),
        computed: Boolean(model.getTableColumnMetadata(column).computed),
      }).toEqual({ column, hidden: false, computed: false });
    }
  });

  test("the two channel columns have exactly the same access control, so writing one never refuses the other", () => {
    /*
     * The settings service writes BOTH columns whenever a payload sends
     * either (the list, and its first channel beside it), under the caller's
     * permissions.
     */
    expect(accessControlFor("notificationChannels")).toEqual(
      accessControlFor("notificationChannel"),
    );
  });

  test.each([
    [
      "incidentSeverities",
      "IncidentSeverity",
      IncidentSeverity,
      "Incident Severities",
    ],
    ["alertSeverities", "AlertSeverity", AlertSeverity, "Alert Severities"],
  ])(
    "%s is an optional list of %s, stored as a many-to-many relation",
    (
      column: string,
      _relatedName: string,
      relatedModel: ModelType,
      title: string,
    ) => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column);

      expect(metadata.type).toBe(TableColumnType.EntityArray);
      expect(metadata.modelType).toBe(relatedModel);
      expect(metadata.required).toBe(false);
      expect(metadata.title).toBe(title);
      expect(metadata.description).toMatch(/Leave empty to require every/);

      const relation: RelationMetadataArgs | undefined = relationArgs(column);

      expect(relation?.relationType).toBe("many-to-many");
      expect((relation?.type as () => unknown)()).toBe(relatedModel);
      // Never loaded by accident with every rule read.
      expect(relation?.options.eager).toBe(false);
    },
  );

  test("the severity lists are relations, not columns on the rule row", () => {
    expect(columnArgs("incidentSeverities")).toBeUndefined();
    expect(columnArgs("alertSeverities")).toBeUndefined();
  });

  test.each(SCOPE_COLUMNS)(
    "%s is written by team editors and read by every project member",
    (column: string) => {
      const accessControl: ColumnAccessControl | undefined =
        accessControlFor(column);

      expect(accessControl?.create).toEqual(EDITORS);
      expect(accessControl?.update).toEqual(EDITORS);
      expect(accessControl?.read).toEqual(READERS);
    },
  );

  test("whoever may edit any part of a rule may edit all of it", () => {
    /*
     * The settings service writes both channel columns and the severity
     * columns when a rule type changes (clearing what the new type does not
     * use), and both channel columns whenever either is sent, under the
     * caller's permissions - so they must be exactly as editable as ruleType.
     */
    const ruleTypeAccess: ColumnAccessControl | undefined =
      accessControlFor("ruleType");

    for (const column of SCOPE_COLUMNS) {
      expect(accessControlFor(column)).toEqual(ruleTypeAccess);
    }
  });

  test("a rule cannot be moved to another team or project", () => {
    for (const column of ["teamId", "team", "projectId", "project"]) {
      expect({ column, update: accessControlFor(column)?.update }).toEqual({
        column,
        update: [],
      });
    }
  });

  test("ruleType is still required, and a rule is created switched off unless told otherwise", () => {
    expect(model.getTableColumnMetadata("ruleType").required).toBe(true);
    expect(columnArgs("ruleType")?.options.nullable).toBe(false);

    expect(model.getTableColumnMetadata("enabled").defaultValue).toBe(false);
    expect(columnArgs("enabled")?.options.default).toBe(false);
  });
});

describe("TeamComplianceSetting - a rule as the API reads and writes it", () => {
  test("a posted severity list becomes models, and survives the way back", () => {
    const json: JSONObject = {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Call,
      enabled: true,
      incidentSeverities: [
        { _id: "c1c1c1c1-0000-4000-8000-000000000001" },
        { _id: "c1c1c1c1-0000-4000-8000-000000000002" },
      ],
      alertSeverities: [],
    };

    const setting: TeamComplianceSetting = BaseModel.fromJSONObject(
      json,
      TeamComplianceSetting,
    );

    expect(setting.ruleType).toBe(ComplianceRuleType.HasIncidentOnCallRules);
    expect(setting.notificationChannel).toBe(
      ComplianceNotificationChannel.Call,
    );
    expect(setting.incidentSeverities).toHaveLength(2);
    for (const severity of setting.incidentSeverities || []) {
      expect(severity).toBeInstanceOf(IncidentSeverity);
    }
    expect(
      (setting.incidentSeverities || []).map(
        (severity: IncidentSeverity): string | undefined => {
          return severity._id;
        },
      ),
    ).toEqual([
      "c1c1c1c1-0000-4000-8000-000000000001",
      "c1c1c1c1-0000-4000-8000-000000000002",
    ]);
    expect(setting.alertSeverities).toEqual([]);

    const back: JSONObject = BaseModel.toJSONObject(
      setting,
      TeamComplianceSetting,
    );

    expect(back["notificationChannel"]).toBe(
      ComplianceNotificationChannel.Call,
    );
    expect(
      (back["incidentSeverities"] as Array<JSONObject>).map(
        (severity: JSONObject): unknown => {
          return severity["_id"];
        },
      ),
    ).toEqual([
      "c1c1c1c1-0000-4000-8000-000000000001",
      "c1c1c1c1-0000-4000-8000-000000000002",
    ]);
  });

  test("a cleared channel is sent as null, and stays null", () => {
    const setting: TeamComplianceSetting = BaseModel.fromJSONObject(
      {
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        notificationChannel: null,
      },
      TeamComplianceSetting,
    );

    expect(setting.notificationChannel).toBeNull();
  });

  test("a posted channel list stays a list of the channels posted, both ways", () => {
    const json: JSONObject = {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ],
      notificationChannel: ComplianceNotificationChannel.Call,
    };

    const setting: TeamComplianceSetting = BaseModel.fromJSONObject(
      json,
      TeamComplianceSetting,
    );

    /*
     * A JSON column, not an entity list: the channels are not turned into
     * models the way a severity list is.
     */
    expect(setting.notificationChannels).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ]);
    expect(setting.notificationChannel).toBe(
      ComplianceNotificationChannel.Call,
    );

    const back: JSONObject = BaseModel.toJSONObject(
      setting,
      TeamComplianceSetting,
    );

    expect(back["notificationChannels"]).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ]);
    expect(back["notificationChannel"]).toBe(
      ComplianceNotificationChannel.Call,
    );
    // And over the wire, as the API sends it.
    expect(JSON.parse(JSON.stringify(back))["notificationChannels"]).toEqual([
      "Call",
      "Push",
    ]);
  });

  test("every channel survives the trip in a list", () => {
    const setting: TeamComplianceSetting = BaseModel.fromJSONObject(
      {
        ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
        notificationChannels: ALL_CHANNELS,
      },
      TeamComplianceSetting,
    );

    expect(
      BaseModel.toJSONObject(setting, TeamComplianceSetting)[
        "notificationChannels"
      ],
    ).toEqual(ALL_CHANNELS);
  });

  test.each<[string, JSONValue]>([
    ["an empty list", []],
    ["null", null],
  ])(
    "a channel list cleared to %s arrives as it was sent - 'any channel'",
    (_label: string, value: JSONValue) => {
      const setting: TeamComplianceSetting = BaseModel.fromJSONObject(
        {
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          notificationChannels: value,
        },
        TeamComplianceSetting,
      );

      expect(setting.notificationChannels).toEqual(value);
    },
  );

  test("a rule posted with neither channel field has neither set", () => {
    const setting: TeamComplianceSetting = BaseModel.fromJSONObject(
      { ruleType: ComplianceRuleType.HasAlertOnCallRules },
      TeamComplianceSetting,
    );

    expect(setting.notificationChannels).toBeUndefined();
    expect(setting.notificationChannel).toBeUndefined();
  });
});
