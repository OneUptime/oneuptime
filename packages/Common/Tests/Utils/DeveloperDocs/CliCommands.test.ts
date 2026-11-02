import { describe, expect, test } from "@jest/globals";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import Models from "../../../Models/DatabaseModels/Index";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import { getTableColumns } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission from "../../../Types/Permission";
import {
  CLI_ACTIONS,
  CLI_COMMAND_NAME_OVERRIDES,
  CLI_NOTE_COLUMN,
  CLI_NOTE_TARGETS,
  CLI_OPERATIONS,
  CLI_RESERVED_FLAGS,
  CLI_STATE_MACHINES,
  CliAction,
  CliFieldFlag,
  CliOperation,
  CliValueError,
  getCliActions,
  getCliAnalyticsFields,
  getCliAnalyticsOperations,
  getCliDatabaseOperations,
  getCliFieldFlagHelp,
  getCliFieldFlags,
  getCliFieldFlagsFor,
  getCliResourceName,
  isAnalyticsColumnReadable,
  isCliFieldFlagAllowed,
  parseCliFieldValue,
  parseCliList,
  toCliCommandName,
  toCliFlag,
  toCommanderAttributeName,
} from "../../../Utils/DeveloperDocs/CliCommands";
import {
  CliResource,
  getCliDatabaseModelType,
  getCliResource,
  getCliResourceByTableName,
  getCliResources,
} from "../../../Utils/DeveloperDocs/CliResources";
import { describePersonEmail } from "../../../Utils/DeveloperDocs/PeopleByEmail";
import {
  getTerraformAttributes,
  getTerraformModelOperations,
  getTerraformTypeName,
  TerraformAttributeDescriptor,
  TerraformValueKind,
} from "../../../Utils/DeveloperDocs/TerraformSchema";

/*
 * The CLI's commands, worked out from the models by the rule the REST API
 * documents itself by and the Terraform provider is generated from: one
 * command per resource of the API, named as the provider names it, with
 * the operations the API's permissions allow, a flag per field of the
 * create and update schemas, people by email address, and the
 * dashboard's buttons as actions.
 */

// The 52 resource commands of the CLI before every resource of the API was one.
const COMMANDS_BEFORE: ReadonlyArray<string> = [
  "alert",
  "alert-internal-note",
  "alert-severity",
  "alert-state",
  "alert-state-timeline",
  "change-event",
  "check-setting",
  "custom-data-type",
  "data-flow",
  "data-security-identity",
  "data-security-issue",
  "data-security-scan",
  "data-security-setting",
  "data-store",
  "data-store-access-entry",
  "data-store-finding",
  "exception-instance",
  "incident",
  "incident-alert",
  "incident-internal-note",
  "incident-public-note",
  "incident-severity",
  "incident-state",
  "incident-state-timeline",
  "kubernetes-cost-allocation",
  "label",
  "log",
  "metric",
  "monitor",
  "monitor-log",
  "monitor-status",
  "monitor-status-event",
  "on-call-policy",
  "postmortem-status",
  "residency-rule",
  "scheduled-maintenance-event",
  "scheduled-maintenance-state",
  "scheduled-maintenance-state-timeline",
  "security-case",
  "security-case-evidence",
  "security-case-note",
  "security-case-priority",
  "security-case-status",
  "security-case-task",
  "security-detection",
  "security-event",
  "security-playbook",
  "span",
  "status-page",
  "status-page-announcement",
  "team",
  "threat-intel-indicator",
];

const KEBAB_CASE: RegExp = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UNDERSCORES: RegExp = /_/g;

function modelFor(tableName: string): DatabaseBaseModelType {
  return Models.find((modelType: DatabaseBaseModelType): boolean => {
    return new modelType().tableName === tableName;
  }) as DatabaseBaseModelType;
}

function flagFor(
  modelType: DatabaseBaseModelType,
  columnName: string,
): CliFieldFlag {
  return getCliFieldFlags(modelType).find((flag: CliFieldFlag): boolean => {
    return flag.columnName === columnName;
  }) as CliFieldFlag;
}

describe("names", () => {
  test.each([
    ["Incident", "incident"],
    ["On-Call Policy", "on-call-policy"],
    ["Status Page Announcement", "status-page-announcement"],
    ["IoT Fleet", "iot-fleet"],
    ["vCenter", "vcenter"],
    ["User's On-Call Duty Escalation Rule", "users-on-call-duty-escalation-rule"],
    ["WhatsApp Log", "whatsapp-log"],
  ])("%s is the command %s", (singularName: string, command: string) => {
    expect(toCliCommandName(singularName)).toBe(command);
  });

  test("every resource is named as the Terraform provider names its type, in kebab case", () => {
    for (const modelType of Models) {
      if (getCliDatabaseOperations(modelType).length === 0) {
        continue;
      }

      const model: DatabaseBaseModel = new modelType();

      if (CLI_COMMAND_NAME_OVERRIDES[model.tableName || ""]) {
        continue;
      }

      const typeName: string = getTerraformTypeName(modelType) as string;

      expect({ table: model.tableName, name: getCliResourceName(model) }).toEqual({
        table: model.tableName,
        name: typeName.replace("oneuptime_", "").replace(UNDERSCORES, "-"),
      });
    }
  });

  test("keeps every command the CLI had, under the same name", () => {
    const names: Array<string> = getCliResources().map(
      (resource: CliResource): string => {
        return resource.name;
      },
    );

    for (const name of COMMANDS_BEFORE) {
      expect({ name, kept: names.includes(name) }).toEqual({ name, kept: true });
    }
  });

  test("names a model by an override only where its singular name is another's too", () => {
    expect(
      getCliResourceName({
        tableName: "StatusPageSubscriberNotificationTemplateStatusPage",
        singularName: "Subscriber Notification Template",
      }),
    ).toBe("subscriber-notification-template-status-page");
    expect(
      getCliResourceName({
        tableName: "StatusPageSubscriberNotificationTemplate",
        singularName: "Subscriber Notification Template",
      }),
    ).toBe("subscriber-notification-template");
  });

  test.each([
    ["incidentSeverityId", "--incident-severity-id", "incidentSeverityId"],
    ["isEnabled", "--is-enabled", "isEnabled"],
    ["vmwareVCenters", "--vmware-v-centers", "vmwareVCenters"],
    ["isSSOEnabled", "--is-sso-enabled", "isSsoEnabled"],
    ["apiKey", "--api-key", "apiKey"],
  ])("the field %s is %s, which Commander stores as %s", (
    column: string,
    flag: string,
    attribute: string,
  ) => {
    expect(toCliFlag(column)).toBe(flag);
    expect(toCommanderAttributeName(flag)).toBe(attribute);
  });
});

describe("resources and their operations", () => {
  test("follow the API's own rule for every record: Terraform's operations, in the CLI's order", () => {
    for (const modelType of Models) {
      const model: DatabaseBaseModel = new modelType();
      const operations: Array<CliOperation> = getCliDatabaseOperations(modelType);

      if (!(model.tableName && model.enableDocumentation && model.crudApiPath)) {
        expect(operations).toEqual([]);
        continue;
      }

      const terraform: ReturnType<typeof getTerraformModelOperations> =
        getTerraformModelOperations(modelType);

      expect({ table: model.tableName, operations }).toEqual({
        table: model.tableName,
        operations: CLI_OPERATIONS.filter((operation: CliOperation): boolean => {
          switch (operation) {
            case CliOperation.Create:
              return terraform.canCreate;
            case CliOperation.Update:
              return terraform.canUpdate;
            case CliOperation.Delete:
              return terraform.canDelete;
            default:
              return terraform.canRead;
          }
        }),
      });
    }
  });

  test("give a record only its own user may read no command at all", () => {
    const user: DatabaseBaseModelType = modelFor("User");

    expect(new user().readRecordPermissions).toEqual([Permission.CurrentUser]);
    expect(getCliDatabaseOperations(user)).toEqual([]);
    expect(getCliResourceByTableName("User")).toBeNull();
  });

  test("give telemetry what its permissions allow: logs everything, audit logs reads only", () => {
    const operationsOf: (tableName: string) => Array<CliOperation> = (
      tableName: string,
    ): Array<CliOperation> => {
      const modelType: (new () => AnalyticsBaseModel) | undefined =
        AnalyticsModels.find((candidate: new () => AnalyticsBaseModel) => {
          return new candidate().tableName === tableName;
        });

      return getCliAnalyticsOperations(modelType as new () => AnalyticsBaseModel);
    };

    expect(operationsOf("LogItemV3")).toEqual(CLI_OPERATIONS);
    expect(operationsOf("AuditLogV2")).toEqual([
      CliOperation.List,
      CliOperation.Get,
      CliOperation.Count,
    ]);
  });

  test("are hundreds, records first, every name kebab case and its own", () => {
    const resources: Array<CliResource> = getCliResources();
    const names: Array<string> = resources.map((resource: CliResource) => {
      return resource.name;
    });
    const firstTelemetry: number = resources.findIndex((resource: CliResource) => {
      return resource.modelType === "analytics";
    });

    expect(resources.length).toBeGreaterThan(400);
    expect(new Set(names).size).toBe(names.length);
    expect(
      resources.slice(firstTelemetry).every((resource: CliResource) => {
        return resource.modelType === "analytics";
      }),
    ).toBe(true);

    for (const resource of resources) {
      expect(resource.name).toMatch(KEBAB_CASE);
      expect(resource.apiPath.startsWith("/")).toBe(true);
      expect(resource.operations.length).toBeGreaterThan(0);
    }
  });

  test("are found by command and by table, with their model", () => {
    const incident: CliResource | null = getCliResource("incident");

    expect(incident).toEqual(
      expect.objectContaining({
        name: "incident",
        tableName: "Incident",
        apiPath: "/incident",
        modelType: "database",
      }),
    );
    expect(getCliResourceByTableName("Incident")).toBe(incident);
    expect(getCliDatabaseModelType(incident as CliResource)).toBe(Incident);
    expect(getCliResource("incidents")).toBeNull();
  });
});

describe("the dashboard's buttons as actions", () => {
  test.each([
    ["Incident", [CliAction.Acknowledge, CliAction.Resolve, CliAction.AddNote]],
    ["Alert", [CliAction.Acknowledge, CliAction.Resolve, CliAction.AddNote]],
    ["IncidentEpisode", [CliAction.Acknowledge, CliAction.Resolve, CliAction.AddNote]],
    ["AlertEpisode", [CliAction.Acknowledge, CliAction.Resolve, CliAction.AddNote]],
    ["ScheduledMaintenance", [CliAction.Start, CliAction.End, CliAction.AddNote]],
    ["Monitor", []],
  ])("%s has %j", (tableName: string, actions: Array<CliAction>) => {
    expect(getCliActions(tableName)).toEqual(actions);
  });

  test("come in one order", () => {
    expect(CLI_ACTIONS).toEqual([
      CliAction.Acknowledge,
      CliAction.Resolve,
      CliAction.Start,
      CliAction.End,
      CliAction.AddNote,
    ]);
  });

  test.each(
    CLI_STATE_MACHINES.map((machine) => {
      return [machine.tableName, machine];
    }),
  )("%s's states are where the action says: the columns and flags exist", (
    _tableName: string,
    machine: (typeof CLI_STATE_MACHINES)[number],
  ) => {
    const timeline: Record<string, unknown> = getTableColumns(
      new machine.timelineModelType(),
    );
    const record: Record<string, { type: TableColumnType }> = getTableColumns(
      new (modelFor(machine.tableName))(),
    ) as Record<string, { type: TableColumnType }>;
    const state: Record<string, unknown> = getTableColumns(
      new machine.stateModelType(),
    );

    expect(timeline[machine.recordColumn]).toBeDefined();
    expect(timeline[machine.stateColumn]).toBeDefined();
    expect(record[machine.currentStateRelation]?.type).toBe(TableColumnType.Entity);

    for (const change of machine.changes) {
      expect({ flag: change.stateFlag, exists: Boolean(state[change.stateFlag]) }).toEqual({
        flag: change.stateFlag,
        exists: true,
      });
    }
  });

  test.each(
    CLI_NOTE_TARGETS.map((target) => {
      return [target.tableName, target];
    }),
  )("%s's notes name it and hold their text", (
    _tableName: string,
    target: (typeof CLI_NOTE_TARGETS)[number],
  ) => {
    for (const modelType of [
      target.internalNoteModelType,
      ...(target.publicNoteModelType ? [target.publicNoteModelType] : []),
    ]) {
      const columns: Record<string, unknown> = getTableColumns(new modelType());

      expect(columns[target.recordColumn]).toBeDefined();
      expect(columns[CLI_NOTE_COLUMN]).toBeDefined();
    }
  });
});

describe("field flags", () => {
  test("are a flag per writable field, never one the CLI uses itself, each its own, in every model", () => {
    for (const modelType of Models) {
      const flags: Array<string> = getCliFieldFlags(modelType).flatMap(
        (flag: CliFieldFlag): Array<string> => {
          return [flag.flag, ...(flag.person ? [flag.person.flag] : [])];
        },
      );

      expect(new Set(flags).size).toBe(flags.length);

      for (const flag of flags) {
        expect(isCliFieldFlagAllowed(flag)).toBe(true);
        expect(CLI_RESERVED_FLAGS).not.toContain(flag);
      }
    }
  });

  test("name a person by email address beside their ID, as the Terraform provider's attribute does", () => {
    let people: number = 0;

    for (const modelType of Models) {
      const attributes: Map<string, TerraformAttributeDescriptor> = new Map(
        getTerraformAttributes(modelType).map((attribute) => {
          return [attribute.columnName, attribute];
        }),
      );

      for (const flag of getCliFieldFlags(modelType)) {
        const attribute: TerraformAttributeDescriptor | undefined = attributes.get(
          flag.columnName,
        );

        if (!flag.person) {
          continue;
        }

        people++;
        expect(flag.person.flag).toBe(
          `--${(attribute?.personEmail?.attributeName || "").replace(UNDERSCORES, "-")}`,
        );
        expect(flag.person.description).toBe(
          describePersonEmail({
            idName: flag.flag,
            isList: flag.person.isList,
            invitesByEmail: flag.person.invitesByEmail,
          }),
        );
      }
    }

    // Terraform's 114 companions, each a CLI flag.
    expect(people).toBeGreaterThan(100);
  });

  test("leave the project, who created and who deleted to the server", () => {
    const columns: Array<string> = getCliFieldFlags(Incident).map((flag) => {
      return flag.columnName;
    });

    expect(columns).not.toContain("projectId");
    expect(columns).not.toContain("createdByUserId");
    expect(columns).not.toContain("deletedByUserId");
  });

  test("take what each field holds: text, an ID of a resource, IDs, a switch, a date, JSON", () => {
    expect(flagFor(Incident, "title")).toEqual(
      expect.objectContaining({ flag: "--title", valueName: "<text>", isRequired: true }),
    );
    expect(flagFor(Incident, "incidentSeverityId")).toEqual(
      expect.objectContaining({
        valueName: "<id>",
        relatedResource: "incident-severity",
        isRequired: true,
      }),
    );
    expect(flagFor(Incident, "monitors")).toEqual(
      expect.objectContaining({
        valueName: "<ids>",
        kind: TerraformValueKind.IdSet,
        relatedResource: "monitor",
      }),
    );
    expect(flagFor(Incident, "isVisibleOnStatusPage").valueName).toBe("[true|false]");
    expect(flagFor(Incident, "declaredAt").valueName).toBe("<date>");
    expect(flagFor(Incident, "customFields").valueName).toBe("<json>");
    expect(flagFor(Monitor, "monitorSteps").valueName).toBe("<json>");
    expect(flagFor(Label, "color").valueName).toBe("<color>");
  });

  test("are given to a create or an update as its schema takes them", () => {
    const createFlags: Array<string> = getCliFieldFlagsFor(Monitor, CliOperation.Create).map(
      (flag: CliFieldFlag): string => {
        return flag.flag;
      },
    );
    const updateFlags: Array<string> = getCliFieldFlagsFor(Monitor, CliOperation.Update).map(
      (flag: CliFieldFlag): string => {
        return flag.flag;
      },
    );

    // A monitor's type is set when it is made, never changed.
    expect(createFlags).toContain("--monitor-type");
    expect(updateFlags).not.toContain("--monitor-type");
    expect(updateFlags).toContain("--name");
  });

  test("say in their help what they take", () => {
    const create: CliOperation.Create = CliOperation.Create;

    expect(getCliFieldFlagHelp(flagFor(Incident, "title"), create)).toBe(
      "Required. Title of this incident.",
    );
    expect(getCliFieldFlagHelp(flagFor(Incident, "incidentSeverityId"), create)).toBe(
      "Required. Incident Severity ID. An ID from `oneuptime incident-severity list`.",
    );
    expect(getCliFieldFlagHelp(flagFor(Incident, "monitors"), create)).toContain(
      "IDs separated by commas, from `oneuptime monitor list`.",
    );
    expect(getCliFieldFlagHelp(flagFor(TeamMember, "userId"), create)).toBe(
      "Required, or --user-email. ID of the person in the team.",
    );
    // An update requires nothing.
    expect(getCliFieldFlagHelp(flagFor(Incident, "title"), CliOperation.Update)).toBe(
      "Title of this incident.",
    );
  });
});

describe("a flag's value", () => {
  const title: CliFieldFlag = flagFor(Incident, "title");
  const severity: CliFieldFlag = flagFor(Incident, "incidentSeverityId");
  const monitors: CliFieldFlag = flagFor(Incident, "monitors");
  const visible: CliFieldFlag = flagFor(Incident, "isVisibleOnStatusPage");
  const declared: CliFieldFlag = flagFor(Incident, "declaredAt");
  const custom: CliFieldFlag = flagFor(Incident, "customFields");
  const interval: CliFieldFlag = flagFor(Monitor, "minimumProbeAgreement");
  const id: string = "6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11";
  const other: string = "1d7b0c3e-2a4f-4b6c-8d9e-0f1a2b3c4d5e";

  test("is text as given", () => {
    expect(parseCliFieldValue(title, "Checkout is down")).toBe("Checkout is down");
  });

  test("is an ID, checked", () => {
    expect(parseCliFieldValue(severity, ` ${id} `)).toBe(id);
    expect(() => {
      return parseCliFieldValue(severity, "critical");
    }).toThrow(CliValueError);
  });

  test("is records of a list relation, from IDs separated by commas or a JSON array", () => {
    expect(parseCliFieldValue(monitors, `${id}, ${other}`)).toEqual([
      { _id: id },
      { _id: other },
    ]);
    expect(parseCliFieldValue(monitors, JSON.stringify([id]))).toEqual([{ _id: id }]);
    expect(parseCliFieldValue(monitors, "")).toEqual([]);
  });

  test.each([
    [true, true],
    ["true", true],
    ["yes", true],
    ["1", true],
    ["false", false],
    ["No", false],
    ["off", false],
  ])("is a switch: %j is %s", (raw: string | boolean, value: boolean) => {
    expect(parseCliFieldValue(visible, raw)).toBe(value);
  });

  test("is a number", () => {
    expect(parseCliFieldValue(interval, "2")).toBe(2);
    expect(() => {
      return parseCliFieldValue(interval, "two");
    }).toThrow("--minimum-probe-agreement takes a number");
  });

  test("is a date as ISO 8601", () => {
    expect(parseCliFieldValue(declared, "2026-11-01T10:00:00Z")).toBe(
      "2026-11-01T10:00:00.000Z",
    );
    expect(() => {
      return parseCliFieldValue(declared, "tomorrow");
    }).toThrow(CliValueError);
  });

  test("is JSON parsed", () => {
    expect(parseCliFieldValue(custom, '{"region":"eu"}')).toEqual({ region: "eu" });
    expect(() => {
      return parseCliFieldValue(custom, "{region}");
    }).toThrow("In Bash and zsh, wrap it in single quotes.");
  });

  test("needs a value, unless it is a switch", () => {
    expect(() => {
      return parseCliFieldValue(title, true);
    }).toThrow("--title needs a value: <text>.");
  });

  test("lists split on commas, or come as a JSON array of strings", () => {
    expect(parseCliList("--x", "a, b ,c,,")).toEqual(["a", "b", "c"]);
    expect(parseCliList("--x", '["a,b","c"]')).toEqual(["a,b", "c"]);
    expect(() => {
      return parseCliList("--x", "[1,2]");
    }).toThrow("--x takes a JSON array of strings");
  });
});

describe("telemetry's fields", () => {
  test("are its columns, readable by the select's rule", () => {
    const log: new () => AnalyticsBaseModel = AnalyticsModels.find(
      (candidate: new () => AnalyticsBaseModel) => {
        return new candidate().tableName === "LogItemV3";
      },
    ) as new () => AnalyticsBaseModel;
    const fields: Array<ReturnType<typeof getCliAnalyticsFields>[number]> =
      getCliAnalyticsFields(log);
    const body: (typeof fields)[number] | undefined = fields.find((field) => {
      return field.columnName === "body";
    });

    expect(body).toEqual(expect.objectContaining({ isReadable: true, inCreate: true }));
  });

  test("with no read rule, only the ones every select may name", () => {
    expect(isAnalyticsColumnReadable("_id", undefined)).toBe(true);
    expect(isAnalyticsColumnReadable("attributes", undefined)).toBe(false);
    expect(isAnalyticsColumnReadable("body", [Permission.CurrentUser])).toBe(false);
    expect(isAnalyticsColumnReadable("body", [Permission.ProjectMember])).toBe(true);
  });
});
