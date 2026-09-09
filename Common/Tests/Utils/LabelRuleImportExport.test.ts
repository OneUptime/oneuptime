import { describe, expect, test } from "@jest/globals";
import AlertLabelRule from "../../Models/DatabaseModels/AlertLabelRule";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentLabelRule from "../../Models/DatabaseModels/IncidentLabelRule";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorLabelRule from "../../Models/DatabaseModels/MonitorLabelRule";
import NetworkDeviceLabelRule from "../../Models/DatabaseModels/NetworkDeviceLabelRule";
import TableColumnType from "../../Types/Database/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import LabelRuleImportExport, {
  LABEL_RULE_MODELS,
  ParsedLabelRuleImport,
} from "../../Utils/LabelRuleImportExport";

const makeFile: (
  items: Array<JSONObject>,
  modelType?: DatabaseBaseModelType,
) => string = (
  items: Array<JSONObject>,
  modelType: DatabaseBaseModelType = MonitorLabelRule,
): string => {
  return JSON.stringify(
    LabelRuleImportExport.envelope({
      resourceType: new modelType().tableName!,
      items,
    }),
  );
};

const parse: (
  items: Array<JSONObject>,
  source?: DatabaseBaseModelType,
  destination?: DatabaseBaseModelType,
) => ParsedLabelRuleImport = (
  items: Array<JSONObject>,
  source: DatabaseBaseModelType = MonitorLabelRule,
  destination: DatabaseBaseModelType = source,
): ParsedLabelRuleImport => {
  return LabelRuleImportExport.parse({
    modelType: destination,
    fileText: makeFile(items, source),
  });
};

const base: JSONObject = {
  name: "Production",
  description: "Apply the production label",
  isEnabled: false,
  labelsToAdd: ["Production"],
};

const criteriaByType: Record<string, [string, string, string]> = {
  AlertEpisodeLabelRule: [
    "episodeTitlePattern",
    "episodeDescriptionPattern",
    "episodeLabels",
  ],
  AlertLabelRule: [
    "alertTitlePattern",
    "alertDescriptionPattern",
    "alertLabels",
  ],
  CephClusterLabelRule: [
    "cephClusterNamePattern",
    "cephClusterDescriptionPattern",
    "cephClusterLabels",
  ],
  CloudResourceLabelRule: [
    "nameRegexPattern",
    "descriptionRegexPattern",
    "matchLabels",
  ],
  DashboardLabelRule: [
    "dashboardNamePattern",
    "dashboardDescriptionPattern",
    "dashboardLabels",
  ],
  DockerHostLabelRule: [
    "dockerHostNamePattern",
    "dockerHostDescriptionPattern",
    "dockerHostLabels",
  ],
  DockerSwarmClusterLabelRule: [
    "dockerSwarmClusterNamePattern",
    "dockerSwarmClusterDescriptionPattern",
    "dockerSwarmClusterLabels",
  ],
  HostLabelRule: ["hostNamePattern", "hostDescriptionPattern", "hostLabels"],
  IncidentEpisodeLabelRule: [
    "episodeTitlePattern",
    "episodeDescriptionPattern",
    "episodeLabels",
  ],
  IncidentLabelRule: [
    "incidentTitlePattern",
    "incidentDescriptionPattern",
    "incidentLabels",
  ],
  IncomingCallPolicyLabelRule: [
    "incomingCallPolicyNamePattern",
    "incomingCallPolicyDescriptionPattern",
    "incomingCallPolicyLabels",
  ],
  IoTFleetLabelRule: [
    "iotFleetNamePattern",
    "iotFleetDescriptionPattern",
    "iotFleetLabels",
  ],
  KubernetesClusterLabelRule: [
    "kubernetesClusterNamePattern",
    "kubernetesClusterDescriptionPattern",
    "kubernetesClusterLabels",
  ],
  MonitorLabelRule: [
    "monitorNamePattern",
    "monitorDescriptionPattern",
    "monitorLabels",
  ],
  NetworkDeviceLabelRule: [
    "networkDeviceNamePattern",
    "networkDeviceDescriptionPattern",
    "networkDeviceLabels",
  ],
  OnCallDutyPolicyLabelRule: [
    "onCallDutyPolicyNamePattern",
    "onCallDutyPolicyDescriptionPattern",
    "onCallDutyPolicyLabels",
  ],
  OnCallDutyPolicyScheduleLabelRule: [
    "onCallDutyPolicyScheduleNamePattern",
    "onCallDutyPolicyScheduleDescriptionPattern",
    "onCallDutyPolicyScheduleLabels",
  ],
  PodmanHostLabelRule: [
    "podmanHostNamePattern",
    "podmanHostDescriptionPattern",
    "podmanHostLabels",
  ],
  ProxmoxClusterLabelRule: [
    "proxmoxClusterNamePattern",
    "proxmoxClusterDescriptionPattern",
    "proxmoxClusterLabels",
  ],
  RumApplicationLabelRule: [
    "nameRegexPattern",
    "descriptionRegexPattern",
    "matchLabels",
  ],
  RunbookLabelRule: [
    "runbookNamePattern",
    "runbookDescriptionPattern",
    "runbookLabels",
  ],
  ScheduledMaintenanceLabelRule: [
    "titlePattern",
    "descriptionPattern",
    "scheduledMaintenanceLabels",
  ],
  ServerlessFunctionLabelRule: [
    "nameRegexPattern",
    "descriptionRegexPattern",
    "matchLabels",
  ],
  ServiceLabelRule: [
    "serviceNamePattern",
    "serviceDescriptionPattern",
    "serviceLabels",
  ],
  StatusPageLabelRule: [
    "statusPageNamePattern",
    "statusPageDescriptionPattern",
    "statusPageLabels",
  ],
  WorkflowLabelRule: [
    "workflowNamePattern",
    "workflowDescriptionPattern",
    "workflowLabels",
  ],
};

describe("portable label rule files", () => {
  test.each(
    LABEL_RULE_MODELS.map(
      (modelType: DatabaseBaseModelType): [string, DatabaseBaseModelType] => {
        return [new modelType().tableName!, modelType];
      },
    ),
  )(
    "round trips %s including its criteria and labels",
    (tableName: string, modelType: DatabaseBaseModelType) => {
      const [namePattern, descriptionPattern, matchLabels] =
        criteriaByType[tableName]!;
      const model: BaseModel = new modelType();
      for (const column of LabelRuleImportExport.getColumns(modelType)) {
        if (
          model.getTableColumnMetadata(column)?.type ===
          TableColumnType.EntityArray
        ) {
          model.setValue(column, []);
        }
      }
      const label: Label = new Label();
      label._id = "11111111-1111-1111-1111-111111111111";
      label.name = "Production";
      model.setValue("name", "Production");
      model.setValue("isEnabled", false);
      model.setValue("description", "Keep this configuration");
      model.setValue(namePattern, "^prod-");
      model.setValue(descriptionPattern, "critical$");
      model.setValue(matchLabels, [label]);
      model.setValue("labelsToAdd", [label]);
      model._id = "22222222-2222-2222-2222-222222222222";
      model.setValue(
        "projectId",
        new ObjectID("33333333-3333-3333-3333-333333333333"),
      );
      const envelope: JSONObject = LabelRuleImportExport.buildExportEnvelope({
        modelType,
        items: [model],
        exportedAt: new Date("2026-09-09T00:00:00.000Z"),
      });
      expect(envelope).toMatchObject({
        fileType: "oneuptime-label-rules",
        schemaVersion: 1,
        resourceType: tableName,
        exportedAt: "2026-09-09T00:00:00.000Z",
      });
      expect(JSON.stringify(envelope)).not.toContain("11111111-");
      expect(JSON.stringify(envelope)).not.toContain("22222222-");
      expect(JSON.stringify(envelope)).not.toContain("33333333-");
      const output: ParsedLabelRuleImport = LabelRuleImportExport.parse({
        modelType,
        fileText: JSON.stringify(envelope),
      });
      expect(output.items[0]!.json).toMatchObject({
        name: "Production",
        isEnabled: false,
        [namePattern]: "^prod-",
        [descriptionPattern]: "critical$",
        [matchLabels]: ["Production"],
        labelsToAdd: ["Production"],
      });
      expect(model.getValue("labelsToAdd")).toEqual([label]);
    },
  );

  test.each(
    LABEL_RULE_MODELS.map(
      (modelType: DatabaseBaseModelType): [string, DatabaseBaseModelType] => {
        return [new modelType().tableName!, modelType];
      },
    ),
  )(
    "maps primary criteria and prerequisite labels from %s to monitors",
    (tableName: string, modelType: DatabaseBaseModelType) => {
      const [namePattern, descriptionPattern, matchLabels] =
        criteriaByType[tableName]!;
      const output: ParsedLabelRuleImport = parse(
        [
          {
            ...base,
            [namePattern]: "^prod-",
            [descriptionPattern]: "critical$",
            [matchLabels]: ["Existing"],
          },
        ],
        modelType,
        MonitorLabelRule,
      );
      expect(output.items[0]!.json).toMatchObject({
        name: "Production",
        isEnabled: false,
        monitorNamePattern: "^prod-",
        monitorDescriptionPattern: "critical$",
        monitorLabels: ["Existing"],
        labelsToAdd: ["Production"],
      });
    },
  );

  test("the export selection includes relation names and excludes server metadata", () => {
    expect(
      LabelRuleImportExport.getExportSelect(IncidentLabelRule),
    ).toMatchObject({
      labelsToAdd: { name: true },
      monitors: { name: true },
      incidentSeverities: { name: true },
      incidentLabels: { name: true },
      monitorLabels: { name: true },
      isEnabled: true,
    });
    const columns: Array<string> =
      LabelRuleImportExport.getColumns(IncidentLabelRule);
    for (const column of [
      "_id",
      "projectId",
      "project",
      "createdByUser",
      "createdByUserId",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "deletedByUserId",
    ]) {
      expect(columns).not.toContain(column);
    }
  });

  test("cannot silently export unreadable relations", () => {
    const model: MonitorLabelRule = new MonitorLabelRule();
    model.name = "Production";
    expect(() => {
      LabelRuleImportExport.buildExportEnvelope({
        modelType: MonitorLabelRule,
        items: [model],
      });
    }).toThrow("could not be read");
    model.monitorLabels = [];
    model.labelsToAdd = [new Label()];
    expect(() => {
      LabelRuleImportExport.buildExportEnvelope({
        modelType: MonitorLabelRule,
        items: [model],
      });
    }).toThrow("without a readable name");
  });

  test("maps incident severity names to alert severity names and preserves shared related criteria", () => {
    const output: ParsedLabelRuleImport = parse(
      [
        {
          ...base,
          incidentTitlePattern: "^database",
          incidentLabels: ["Existing"],
          incidentSeverities: ["Critical"],
          monitors: ["Production API"],
          monitorLabels: ["Service"],
          monitorNamePattern: "api",
          inheritLabelsFromMonitors: true,
        },
      ],
      IncidentLabelRule,
      AlertLabelRule,
    );
    expect(output.items[0]!.json).toMatchObject({
      alertTitlePattern: "^database",
      alertLabels: ["Existing"],
      alertSeverities: ["Critical"],
      monitors: ["Production API"],
      monitorLabels: ["Service"],
      monitorNamePattern: "api",
      inheritLabelsFromMonitors: true,
    });
    expect(output.mappings).toContain(
      "Incident Title Pattern → Alert Title Pattern",
    );
  });

  test.each([
    "monitorNamePattern",
    "monitorDescriptionPattern",
    "monitorLabels",
    "monitors",
    "incidentSeverities",
    "inheritLabelsFromMonitors",
  ])(
    "blocks unsupported configured %s instead of broadening a rule",
    (column: string) => {
      const value: string | boolean | Array<string> = column.endsWith("Pattern")
        ? "api"
        : column.startsWith("inherit")
          ? true
          : ["API"];
      expect(() => {
        parse(
          [{ ...base, [column]: value }],
          IncidentLabelRule,
          MonitorLabelRule,
        );
      }).toThrow("not supported");
    },
  );

  test("allows empty unsupported criteria without carrying them to the target", () => {
    const output: JSONObject = parse(
      [
        {
          ...base,
          monitors: [],
          monitorNamePattern: "",
          incidentSeverities: [],
          inheritLabelsFromMonitors: false,
        },
      ],
      IncidentLabelRule,
      MonitorLabelRule,
    ).items[0]!.json;
    expect(output["monitors"]).toBeUndefined();
    expect(output["incidentSeverities"]).toBeUndefined();
    expect(output["inheritLabelsFromMonitors"]).toBeUndefined();
  });

  test.each(["*router*", "router.*", " router ", "   "])(
    "rejects cross-resource network pattern semantic changes for %s",
    (pattern: string) => {
      expect(() => {
        parse(
          [{ ...base, networkDeviceNamePattern: pattern }],
          NetworkDeviceLabelRule,
          MonitorLabelRule,
        );
      }).toThrow("without changing its meaning");
    },
  );

  test.each(["router.*", " router ", "   "])(
    "rejects importing regex %s into the broader network matcher",
    (pattern: string) => {
      expect(() => {
        parse(
          [{ ...base, monitorNamePattern: pattern }],
          MonitorLabelRule,
          NetworkDeviceLabelRule,
        );
      }).toThrow("without changing its meaning");
    },
  );

  test("preserves wildcard network patterns when importing network rules", () => {
    expect(
      parse(
        [{ ...base, networkDeviceNamePattern: "*router*" }],
        NetworkDeviceLabelRule,
      ).items[0]!.json["networkDeviceNamePattern"],
    ).toBe("*router*");
  });

  test.each([
    [{ ...base, name: "" }, "cannot be empty"],
    [{ ...base, name: "   " }, "cannot be empty"],
    [{ ...base, name: "n".repeat(101) }, "at most 100"],
    [{ ...base, name: 123 }, "must be text"],
    [{ ...base, description: {} }, "must be text"],
    [{ ...base, description: "d".repeat(501) }, "at most 500"],
    [{ ...base, isEnabled: "true" }, "must be true or false"],
    [{ ...base, isEnabled: null }, "must be true or false"],
    [
      { ...base, monitorNamePattern: "[broken" },
      "not a valid regular expression",
    ],
    [
      { ...base, monitorNamePattern: "*router*" },
      "not a valid regular expression",
    ],
    [{ ...base, monitorLabels: "Production" }, "array of resource names"],
    [{ ...base, monitorLabels: [{}] }, "array of resource names"],
    [
      { ...base, labelsToAdd: [{ _id: "source-id", name: "Production" }] },
      "array of resource names",
    ],
    [{ ...base, labelsToAdd: [" "] }, "array of resource names"],
    [
      { ...base, labelsToAdd: ["Production", "Production"] },
      "duplicate resource names",
    ],
    [{ ...base, projectId: "source-project" }, "protected field"],
    [{ ...base, _id: "source-id" }, "protected field"],
    [{ ...base, createdByUserId: "source-user" }, "protected field"],
    [{ ...base, unexpectedCriteria: "foo" }, "Unknown or protected field"],
  ] as Array<[JSONObject, string]>)(
    "validates malformed row %#",
    (row: JSONObject, message: string) => {
      expect(() => {
        parse([row]);
      }).toThrow(message);
    },
  );

  test.each(["name", "isEnabled"])(
    "requires %s explicitly",
    (column: string) => {
      const row: JSONObject = { ...base };
      delete row[column];
      expect(() => {
        parse([row]);
      }).toThrow("required");
    },
  );

  test("uses explicit empty optional relations and boolean defaults", () => {
    const output: JSONObject = parse(
      [{ name: "Rule", isEnabled: true, description: null }],
      IncidentLabelRule,
    ).items[0]!.json;
    expect(output).toMatchObject({
      labelsToAdd: [],
      incidentLabels: [],
      monitors: [],
      incidentSeverities: [],
      inheritLabelsFromMonitors: false,
    });
    expect(output["description"]).toBeUndefined();
  });

  test.each(["null", "[]", "1", '"file"', "not json"])(
    "rejects invalid file shape %s",
    (fileText: string) => {
      expect(() => {
        LabelRuleImportExport.parse({ modelType: MonitorLabelRule, fileText });
      }).toThrow();
    },
  );

  test.each([
    { fileType: "other" },
    { schemaVersion: 2 },
    { schemaVersion: "1" },
    { resourceType: "Monitor" },
    { resourceType: "UnknownLabelRule" },
    { items: [] },
    { items: {} },
    { items: [null] },
    { items: [1] },
    { items: [[]] },
  ])("rejects malformed envelope %#", (overrides: JSONObject) => {
    const envelope: JSONObject = {
      ...JSON.parse(makeFile([base])),
      ...overrides,
    };
    expect(() => {
      LabelRuleImportExport.parse({
        modelType: MonitorLabelRule,
        fileText: JSON.stringify(envelope),
      });
    }).toThrow();
  });

  test("reports invalid late rows before returning any prepared batch", () => {
    const items: Array<JSONObject> = Array.from(
      { length: 1600 },
      (): JSONObject => {
        return base;
      },
    );
    items[1599] = { ...base, monitorNamePattern: "[broken" };
    expect(() => {
      parse(items);
    }).toThrow("Rule 1600");
  });

  test("rejects protected prototype fields from hand-edited files", () => {
    const fileText: string = makeFile([base]).replace(
      '"name":"Production"',
      '"__proto__":{"polluted":true},"name":"Production"',
    );
    expect(() => {
      LabelRuleImportExport.parse({ modelType: MonitorLabelRule, fileText });
    }).toThrow("protected field");
    expect(({} as JSONObject)["polluted"]).toBeUndefined();
  });

  test("does not expose generic resource models through the registry", () => {
    expect(LabelRuleImportExport.isLabelRuleModel(Monitor)).toBe(false);
    expect(() => {
      LabelRuleImportExport.getColumns(Monitor);
    }).toThrow("supported label rule");
  });

  test("applies the upload size limit to pasted JSON before parsing", () => {
    expect(() => {
      LabelRuleImportExport.parse({
        modelType: MonitorLabelRule,
        fileText: " ".repeat(10 * 1024 * 1024 + 1),
      });
    }).toThrow("10 MB or smaller");
  });
});
