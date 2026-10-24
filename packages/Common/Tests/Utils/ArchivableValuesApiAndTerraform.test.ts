import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseBaseModelType } from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../Models/DatabaseModels/AlertState";
import IncidentPostmortemStatus from "../../Models/DatabaseModels/IncidentPostmortemStatus";
import IncidentRole from "../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import Label from "../../Models/DatabaseModels/Label";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCasePriority from "../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../Models/DatabaseModels/SecurityCaseStatus";
import OpenAPIUtil from "../../Server/Utils/OpenAPI";
import { JSONObject } from "../../Types/JSON";
import {
  ARCHIVABLE_VALUE_DEFINITIONS,
  ArchivableValueDefinition,
} from "../../Utils/ArchivableValues";
import { getTerraformResourceConfig } from "../../Utils/DeveloperDocs/TerraformConfig";
import {
  getTerraformAttribute,
  getTerraformTypeName,
  TerraformAttributeDescriptor,
} from "../../Utils/DeveloperDocs/TerraformSchema";
import { OpenAPIParser } from "../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import { ResourceGenerator } from "../../../../Scripts/TerraformProvider/Core/ResourceGenerator";
import {
  OpenAPISpec,
  TerraformAttribute,
  TerraformResource,
} from "../../../../Scripts/TerraformProvider/Core/Types";

/*
 * ARCHIVING IS THE SAME SWITCH WHEREVER A VALUE IS MANAGED FROM.
 *
 * A team that keeps its severities, states and labels in Terraform, a script
 * on the API or an AI agent over MCP archives one the way the dashboard
 * does: by setting isArchived. Who archived it and when are OneUptime's to
 * say (DatabaseService stamps them from the switch), so they are read-only
 * everywhere. The API reference, the Terraform provider and the dashboard's
 * Developer pages are all generated from the model's metadata; these read
 * the real spec, the real provider generator and the real configuration
 * writer, for every value that can be archived.
 */

interface ArchivableResource {
  table: string;
  modelType: DatabaseBaseModelType;
  apiPath: string;
  terraformType: string;
}

const RESOURCES: Array<ArchivableResource> = [
  {
    table: "IncidentState",
    modelType: IncidentState,
    apiPath: "/incident-state",
    terraformType: "oneuptime_incident_state",
  },
  {
    table: "IncidentSeverity",
    modelType: IncidentSeverity,
    apiPath: "/incident-severity",
    terraformType: "oneuptime_incident_severity",
  },
  {
    table: "AlertState",
    modelType: AlertState,
    apiPath: "/alert-state",
    terraformType: "oneuptime_alert_state",
  },
  {
    table: "AlertSeverity",
    modelType: AlertSeverity,
    apiPath: "/alert-severity",
    terraformType: "oneuptime_alert_severity",
  },
  {
    table: "MonitorStatus",
    modelType: MonitorStatus,
    apiPath: "/monitor-status",
    terraformType: "oneuptime_monitor_status",
  },
  {
    table: "ScheduledMaintenanceState",
    modelType: ScheduledMaintenanceState,
    apiPath: "/scheduled-maintenance-state",
    terraformType: "oneuptime_scheduled_maintenance_state",
  },
  {
    table: "Label",
    modelType: Label,
    apiPath: "/label",
    terraformType: "oneuptime_label",
  },
  {
    table: "IncidentRole",
    modelType: IncidentRole,
    apiPath: "/incident-role",
    terraformType: "oneuptime_incident_role",
  },
  {
    table: "IncidentPostmortemStatus",
    modelType: IncidentPostmortemStatus,
    apiPath: "/incident-postmortem-status",
    // Named after the model's singular name, as every resource is.
    terraformType: "oneuptime_postmortem_status",
  },
  {
    table: "SecurityCaseStatus",
    modelType: SecurityCaseStatus,
    apiPath: "/security-case-status",
    terraformType: "oneuptime_security_case_status",
  },
  {
    table: "SecurityCasePriority",
    modelType: SecurityCasePriority,
    apiPath: "/security-case-priority",
    terraformType: "oneuptime_security_case_priority",
  },
];

// Stamped by the server from the switch: read, never written.
const STAMPED_COLUMNS: Array<string> = ["archivedAt", "archivedByUserId"];
const STAMPED_ATTRIBUTES: Array<string> = [
  "archived_at",
  "archived_by_user_id",
];

const VALUE_ID: string = "6a1c0de0-0000-4000-8000-0000000000a1";
const PROJECT_ID: string = "6a1c0de0-0000-4000-8000-0000000000a2";

let spec: JSONObject;
let providerResources: Array<TerraformResource>;

function schemaOf(schemaName: string): JSONObject {
  const schemas: JSONObject = (spec["components"] as JSONObject)[
    "schemas"
  ] as JSONObject;
  const schema: JSONObject | undefined = schemas[schemaName] as
    | JSONObject
    | undefined;

  expect(schema).toBeDefined();

  return schema as JSONObject;
}

function propertiesOf(schemaName: string): JSONObject {
  return (schemaOf(schemaName)["properties"] || {}) as JSONObject;
}

function requiredOf(schemaName: string): Array<string> {
  return (schemaOf(schemaName)["required"] || []) as Array<string>;
}

function providerResource(terraformType: string): TerraformResource {
  const found: TerraformResource | undefined = providerResources.find(
    (resource: TerraformResource): boolean => {
      return `oneuptime_${resource.name}` === terraformType;
    },
  );

  expect(found).toBeDefined();

  return found as TerraformResource;
}

beforeAll(() => {
  spec = OpenAPIUtil.generateOpenAPISpec();

  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(spec as never);
  providerResources = parser.getResources();
});

describe("every value that can be archived is covered here", () => {
  test("the resources above are the registry's values", () => {
    expect(
      RESOURCES.map((resource: ArchivableResource): string => {
        return resource.table;
      }).sort(),
    ).toEqual(
      ARCHIVABLE_VALUE_DEFINITIONS.map(
        (definition: ArchivableValueDefinition): string => {
          return definition.tableName;
        },
      ).sort(),
    );
  });
});

describe.each(RESOURCES)(
  "$table in the API reference",
  (resource: ArchivableResource) => {
    test("is archived and unarchived by an update that sets isArchived", () => {
      const property: JSONObject | undefined = propertiesOf(
        `${resource.table}UpdateSchema`,
      )["isArchived"] as JSONObject | undefined;

      expect(property).toBeDefined();
      expect(property!["type"]).toBe("boolean");
      expect(requiredOf(`${resource.table}UpdateSchema`)).not.toContain(
        "isArchived",
      );
    });

    test("is created live unless the request says otherwise", () => {
      const property: JSONObject | undefined = propertiesOf(
        `${resource.table}CreateSchema`,
      )["isArchived"] as JSONObject | undefined;

      expect(property).toBeDefined();
      expect(property!["default"]).toBe(false);
      expect(requiredOf(`${resource.table}CreateSchema`)).not.toContain(
        "isArchived",
      );
    });

    test("says what archiving does", () => {
      const description: string = String(
        (
          propertiesOf(`${resource.table}UpdateSchema`)[
            "isArchived"
          ] as JSONObject
        )["description"] || "",
      );

      // "Archived severities stay on the incidents ... but can't be picked again."
      expect(description.startsWith("Archived ")).toBe(true);
      expect(description).toContain(" stay on ");
      expect(description).toContain(" again.");
    });

    test("reads back whether it is archived, when and by whom", () => {
      const read: JSONObject = propertiesOf(`${resource.table}ReadSchema`);

      expect(read["isArchived"]).toBeDefined();
      expect(read["archivedAt"]).toBeDefined();
      expect(read["archivedByUserId"]).toBeDefined();
    });

    test("never takes when or by whom from a request", () => {
      for (const schemaName of [
        `${resource.table}CreateSchema`,
        `${resource.table}UpdateSchema`,
      ]) {
        const writable: Array<string> = Object.keys(propertiesOf(schemaName));

        for (const column of [...STAMPED_COLUMNS, "archivedByUser"]) {
          expect(writable).not.toContain(column);
        }
      }
    });

    test("is served at the path the reference documents", () => {
      const paths: Array<string> = Object.keys(spec["paths"] as JSONObject);

      expect(paths).toContain(`${resource.apiPath}/{id}`);
    });
  },
);

describe.each(RESOURCES)(
  "$table in the Terraform provider",
  (resource: ArchivableResource) => {
    test("has is_archived: a switch changed in place, live when left out", () => {
      const attribute: TerraformAttribute | undefined = providerResource(
        resource.terraformType,
      ).schema["is_archived"];

      expect(attribute).toBeDefined();
      expect(attribute?.type).toBe("bool");
      expect(attribute?.required).toBe(false);
      expect(attribute?.optional).toBe(true);
      expect(attribute?.default).toBe(false);
      // Archiving keeps the value's id: records keep pointing at it.
      expect(attribute?.forceNew).toBe(false);
    });

    test("reads when and by whom, and never writes them", () => {
      const schema: Record<string, TerraformAttribute> = providerResource(
        resource.terraformType,
      ).schema;

      for (const name of STAMPED_ATTRIBUTES) {
        expect(schema[name]).toBeDefined();
        expect(schema[name]?.computed).toBe(true);
        expect(schema[name]?.optional).toBe(false);
        expect(schema[name]?.required).toBe(false);
      }
    });
  },
);

describe("the provider's Go code", () => {
  test("archives a label in place, and reads when and by whom", async () => {
    const outputDir: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "archivable-values-provider-"),
    );

    try {
      const paths: JSONObject = spec["paths"] as JSONObject;
      const onlyLabels: JSONObject = {
        ...spec,
        paths: Object.fromEntries(
          Object.entries(paths).filter(([route]: [string, unknown]) => {
            return route === "/label" || route.startsWith("/label/");
          }),
        ),
      };

      await new ResourceGenerator(
        {
          outputDir,
          providerName: "oneuptime",
          providerVersion: "14.0.0",
          goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
        },
        onlyLabels as unknown as OpenAPISpec,
      ).generateResources();

      const go: string = fs.readFileSync(
        path.join(outputDir, "internal/provider/resource_label.go"),
        "utf-8",
      );

      // `"name": schema.XAttribute{ ... }`, through its matching brace.
      const attributeOf: (name: string) => string = (name: string): string => {
        const start: number = go.indexOf(`"${name}":`);
        expect(start).toBeGreaterThan(-1);

        const open: number = go.indexOf("{", start);
        let depth: number = 0;

        for (let index: number = open; index < go.length; index++) {
          if (go[index] === "{") {
            depth++;
          } else if (go[index] === "}") {
            depth--;

            if (depth === 0) {
              return go.slice(start, index + 1);
            }
          }
        }

        throw new Error(`The attribute ${name} never closes.`);
      };

      const isArchived: string = attributeOf("is_archived");
      expect(isArchived).toContain("schema.BoolAttribute");
      expect(isArchived).toContain("Optional: true");
      expect(isArchived).toContain("booldefault.StaticBool(false)");
      expect(isArchived).not.toContain("RequiresReplace");

      for (const name of STAMPED_ATTRIBUTES) {
        const stamped: string = attributeOf(name);
        expect(stamped).toContain("Computed: true");
        expect(stamped).not.toContain("Optional: true");
        expect(stamped).not.toContain("Required: true");
      }
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe.each(RESOURCES)(
  "$table on the dashboard's Developer pages",
  (resource: ArchivableResource) => {
    test("know is_archived and its default", () => {
      const descriptor: TerraformAttributeDescriptor | undefined =
        getTerraformAttribute(resource.modelType, "isArchived");

      expect(getTerraformTypeName(resource.modelType)).toBe(
        resource.terraformType,
      );
      expect(descriptor?.attributeName).toBe("is_archived");
      expect(descriptor?.defaultValue).toBe(false);
      expect(descriptor?.inUpdateSchema).toBe(true);
      // A person sets it, so a configuration written from the value keeps it.
      expect(descriptor?.isServerManaged).toBe(false);
    });

    test("have no attribute for when or by whom", () => {
      for (const column of STAMPED_COLUMNS) {
        expect(
          getTerraformAttribute(resource.modelType, column),
        ).toBeUndefined();
      }
    });
  },
);

describe("the configuration the Developer pages write", () => {
  const hclFor: (isArchived: boolean) => string = (
    isArchived: boolean,
  ): string => {
    return getTerraformResourceConfig({
      modelType: Label,
      json: {
        _id: VALUE_ID,
        projectId: PROJECT_ID,
        name: "Legacy",
        color: "#6b7280",
        isArchived: isArchived,
        archivedAt: "2026-10-14T09:15:00.000Z",
        archivedByUserId: "6a1c0de0-0000-4000-8000-0000000000a3",
      },
    })!.resourceHcl;
  };

  test("keeps an archived value archived: applying it doesn't unarchive it", () => {
    expect(hclFor(true)).toMatch(/is_archived\s*=\s*true/);
  });

  test("leaves a live value's switch to the default", () => {
    expect(hclFor(false)).not.toContain("is_archived");
  });

  test("never writes when or by whom", () => {
    for (const hcl of [hclFor(true), hclFor(false)]) {
      for (const name of STAMPED_ATTRIBUTES) {
        expect(hcl).not.toContain(name);
      }
    }
  });
});
