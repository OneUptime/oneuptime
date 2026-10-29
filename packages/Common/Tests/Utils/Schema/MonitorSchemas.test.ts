import { describe, expect, test } from "@jest/globals";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import fs from "fs";
import path from "path";
import ts from "typescript";
import type { ZodObject, ZodType } from "zod";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  CriteriaAlertSchema,
  CriteriaFilterSchema,
  CriteriaIncidentSchema,
  IncidentGroupingConfigSchema,
  getMonitorCriteriaInstanceSchema,
  getMonitorCriteriaSchema,
  getMonitorStepSchema,
  getMonitorStepsSchema,
} from "../../../Utils/Schema/MonitorSchemas";

/*
 * The API schemas of the monitor Types - a monitor's steps and criteria -
 * which sat on the Types until they moved to Utils/Schema/MonitorSchemas, so
 * that no frontend loads zod for them (ZodOutOfBrowserGuard).
 *
 * Away from the Types, a schema can fall behind its Type: a field added to
 * MonitorStepType and not to the schema is dropped by every parse with it.
 * One had: the Exceptions monitor keeps its settings in a step's
 * exceptionMonitor, which the step schema never listed. So these read each
 * Type's interface with TypeScript's parser and hold the schema's fields to
 * it, and parse the steps and criteria a new monitor of every type starts
 * with, which must come back whole. (That found a second one: zod 4 requires
 * a key whose schema is any(), where zod 3 did not, so the criteria schema
 * refused every criteria that changes no monitor status - a Manual monitor's,
 * say - until its monitorStatusId became optional again.)
 */

const COMMON_DIRECTORY: string = path.resolve(__dirname, "..", "..", "..");

interface InterfaceSchemaPair {
  // The interface, in the file under Common that declares it.
  file: string;
  name: string;
  // The object schema that lists its fields.
  schema: () => ZodObject;
  // Fields of the interface the API never takes, with why.
  notInTheApi?: Record<string, string>;
}

// An object schema's shape, through .optional() when it is one.
function objectOf(schema: ZodType): ZodObject {
  const unwrapped: ZodType =
    "unwrap" in schema && typeof schema.unwrap === "function"
      ? (schema.unwrap as () => ZodType)()
      : schema;

  return unwrapped as unknown as ZodObject;
}

function fieldOf(schema: ZodObject, name: string): ZodObject {
  return objectOf(schema.shape[name] as ZodType);
}

// The schema of the value a { _type, value } wrapper holds.
function valueOf(schema: ZodObject): ZodObject {
  return fieldOf(schema, "value");
}

const PAIRS: Array<InterfaceSchemaPair> = [
  {
    file: "Types/Monitor/MonitorSteps.ts",
    name: "MonitorStepsType",
    schema: (): ZodObject => {
      return valueOf(getMonitorStepsSchema());
    },
  },
  {
    file: "Types/Monitor/MonitorStep.ts",
    name: "MonitorStepType",
    schema: (): ZodObject => {
      return valueOf(getMonitorStepSchema());
    },
  },
  {
    file: "Types/Monitor/MonitorCriteria.ts",
    name: "MonitorCriteriaType",
    schema: (): ZodObject => {
      return valueOf(getMonitorCriteriaSchema());
    },
  },
  {
    file: "Types/Monitor/MonitorCriteriaInstance.ts",
    name: "MonitorCriteriaInstanceType",
    schema: (): ZodObject => {
      return valueOf(getMonitorCriteriaInstanceSchema());
    },
  },
  {
    file: "Types/Monitor/CriteriaFilter.ts",
    name: "CriteriaFilter",
    schema: (): ZodObject => {
      return CriteriaFilterSchema;
    },
    notInTheApi: {
      metricCriteriaContext:
        "filled in while a metric monitor's criteria are evaluated, for the root cause; never stored",
    },
  },
  {
    file: "Types/Monitor/CriteriaFilter.ts",
    name: "ServerMonitorOptions",
    schema: (): ZodObject => {
      return fieldOf(CriteriaFilterSchema, "serverMonitorOptions");
    },
  },
  {
    file: "Types/Monitor/CriteriaFilter.ts",
    name: "MetricMonitorOptions",
    schema: (): ZodObject => {
      return fieldOf(CriteriaFilterSchema, "metricMonitorOptions");
    },
  },
  {
    file: "Types/Monitor/CriteriaFilter.ts",
    name: "MetricAnomalyDetectionOptions",
    schema: (): ZodObject => {
      return fieldOf(
        fieldOf(CriteriaFilterSchema, "metricMonitorOptions"),
        "anomalyDetection",
      );
    },
  },
  {
    file: "Types/Monitor/CriteriaFilter.ts",
    name: "SnmpMonitorOptions",
    schema: (): ZodObject => {
      return fieldOf(CriteriaFilterSchema, "snmpMonitorOptions");
    },
  },
  {
    file: "Types/Monitor/CriteriaFilter.ts",
    name: "DatabaseMonitorOptions",
    schema: (): ZodObject => {
      return fieldOf(CriteriaFilterSchema, "databaseMonitorOptions");
    },
  },
  {
    file: "Types/Monitor/CriteriaFilter.ts",
    name: "CustomCodeMonitorOptions",
    schema: (): ZodObject => {
      return fieldOf(CriteriaFilterSchema, "customCodeMonitorOptions");
    },
  },
  {
    file: "Types/Monitor/CriteriaFilter.ts",
    name: "EvaluateOverTimeOptions",
    schema: (): ZodObject => {
      return fieldOf(CriteriaFilterSchema, "evaluateOverTimeOptions");
    },
  },
  {
    file: "Types/Monitor/CriteriaIncident.ts",
    name: "CriteriaIncident",
    schema: (): ZodObject => {
      return CriteriaIncidentSchema;
    },
  },
  {
    file: "Types/Monitor/CriteriaIncident.ts",
    name: "IncidentMemberRoleAssignment",
    schema: (): ZodObject => {
      const roles: ZodType = objectOf(
        CriteriaIncidentSchema.shape["incidentMemberRoles"] as ZodType,
      ) as unknown as ZodType;

      return (roles as unknown as { element: ZodObject }).element;
    },
  },
  {
    file: "Types/Monitor/CriteriaAlert.ts",
    name: "CriteriaAlert",
    schema: (): ZodObject => {
      return CriteriaAlertSchema;
    },
  },
  {
    file: "Types/Monitor/IncomingMonitor/IncidentGroupingConfig.ts",
    name: "IncidentGroupingConfig",
    schema: (): ZodObject => {
      return IncidentGroupingConfigSchema;
    },
  },
];

// The fields an interface declares, read from its source with TypeScript's parser.
function interfaceFields(file: string, name: string): Array<string> {
  const fileName: string = path.join(COMMON_DIRECTORY, file);
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    fs.readFileSync(fileName, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let fields: Array<string> | null = null;

  sourceFile.forEachChild((node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
      fields = node.members.map((member: ts.TypeElement): string => {
        if (!ts.isPropertySignature(member) || !member.name) {
          throw new Error(
            `${name} in ${file} has a member that is not a plain field: ${member.getText(sourceFile)}`,
          );
        }

        return member.name.getText(sourceFile);
      });
    }
  });

  if (fields === null) {
    throw new Error(`There is no interface ${name} in ${file}`);
  }

  return fields;
}

// Plain JSON, as a request or a column carries it: no undefined fields.
function asStored(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const SEED: {
  defaultMonitorStatusId: ObjectID;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
} = {
  defaultMonitorStatusId: new ObjectID("8a1c0e9e-4d3b-4f43-9f1e-2a8c3d1f5b01"),
  onlineMonitorStatusId: new ObjectID("8a1c0e9e-4d3b-4f43-9f1e-2a8c3d1f5b01"),
  offlineMonitorStatusId: new ObjectID("8a1c0e9e-4d3b-4f43-9f1e-2a8c3d1f5b02"),
  defaultIncidentSeverityId: new ObjectID(
    "8a1c0e9e-4d3b-4f43-9f1e-2a8c3d1f5b03",
  ),
  defaultAlertSeverityId: new ObjectID("8a1c0e9e-4d3b-4f43-9f1e-2a8c3d1f5b04"),
};

// The steps a new monitor of this type starts with.
function defaultSteps(monitorType: MonitorType): MonitorSteps {
  return MonitorSteps.getDefaultMonitorSteps({
    ...SEED,
    monitorType: monitorType,
    monitorName: `A ${monitorType} monitor`,
  });
}

const MONITOR_TYPES: Array<MonitorType> = Object.values(MonitorType);

describe("each monitor schema lists the fields of its Type", () => {
  test.each(PAIRS)("$name ($file)", (pair: InterfaceSchemaPair) => {
    const notInTheApi: Record<string, string> = pair.notInTheApi || {};
    const expected: Array<string> = interfaceFields(pair.file, pair.name)
      .filter((field: string): boolean => {
        return !(field in notInTheApi);
      })
      .sort();

    expect(Object.keys(pair.schema().shape).sort()).toEqual(expected);
  });

  test("a field left out of the API is still a field of its Type, with why", () => {
    for (const pair of PAIRS) {
      for (const [field, why] of Object.entries(pair.notInTheApi || {})) {
        expect({
          name: pair.name,
          field,
          declared: interfaceFields(pair.file, pair.name).includes(field),
        }).toEqual({ name: pair.name, field, declared: true });
        expect(why.length).toBeGreaterThan(20);
      }
    }
  });

  test("the reader fails on an interface it cannot find, rather than finding no fields", () => {
    expect(() => {
      return interfaceFields("Types/Monitor/MonitorStep.ts", "NoSuchType");
    }).toThrow("There is no interface NoSuchType");
  });
});

describe("what monitors store parses whole", () => {
  test.each(MONITOR_TYPES)(
    "a new %s monitor's steps parse, and nothing of them is dropped",
    (monitorType: MonitorType) => {
      const stored: unknown = asStored(defaultSteps(monitorType).toJSON());
      const parsed: { success: boolean; data?: unknown } =
        getMonitorStepsSchema().safeParse(stored);

      expect(parsed.success).toBe(true);
      expect(asStored(parsed.data)).toEqual(stored);
    },
  );

  test.each(MONITOR_TYPES)(
    "a new %s monitor's criteria parse, and nothing of them is dropped",
    (monitorType: MonitorType) => {
      const step: MonitorStep = defaultSteps(monitorType).data!
        .monitorStepsInstanceArray[0] as MonitorStep;
      const criteria: MonitorCriteria = step.data!.monitorCriteria;
      const stored: unknown = asStored(criteria.toJSON());
      const parsed: { success: boolean; data?: unknown } =
        getMonitorCriteriaSchema().safeParse(stored);

      expect(parsed.success).toBe(true);
      expect(asStored(parsed.data)).toEqual(stored);
    },
  );

  test("an Exceptions monitor keeps its settings: the step schema lists exceptionMonitor", () => {
    const stored: JSONObject = asStored(
      (
        defaultSteps(MonitorType.Exceptions).data!
          .monitorStepsInstanceArray[0] as MonitorStep
      ).toJSON(),
    ) as JSONObject;
    const settings: unknown = (stored["value"] as JSONObject)[
      "exceptionMonitor"
    ];

    expect(settings).toBeDefined();

    const parsed: JSONObject = getMonitorStepSchema().parse(
      stored,
    ) as JSONObject;

    expect((parsed["value"] as JSONObject)["exceptionMonitor"]).toEqual(
      settings,
    );
  });
});

describe("the steps schema in the OpenAPI document", () => {
  test("is an object with its example, marked for the Terraform provider, as when MonitorSteps built it", () => {
    const registry: OpenAPIRegistry = new OpenAPIRegistry();

    registry.register("MonitorSteps", getMonitorStepsSchema());

    const document: JSONObject = new OpenApiGeneratorV3(
      registry.definitions,
    ).generateComponents() as unknown as JSONObject;

    expect(
      ((document["components"] as JSONObject)["schemas"] as JSONObject)[
        "MonitorSteps"
      ],
    ).toEqual({
      type: "object",
      description: "MonitorSteps object",
      "x-oneuptime-type": ObjectType.MonitorSteps,
      example: {
        _type: ObjectType.MonitorSteps,
        value: { monitorStepsInstanceArray: [] },
      },
    });
  });

  test("each call builds a schema of its own, as the Types' getSchema() did", () => {
    for (const build of [
      getMonitorStepsSchema,
      getMonitorStepSchema,
      getMonitorCriteriaSchema,
      getMonitorCriteriaInstanceSchema,
    ]) {
      expect(build() === build()).toBe(false);
    }
  });

  test("the monitor Types build no schema themselves any more", () => {
    for (const type of [MonitorSteps, MonitorStep, MonitorCriteria]) {
      expect({ type: type.name, getSchema: "getSchema" in type }).toEqual({
        type: type.name,
        getSchema: false,
      });
    }
  });
});
