import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { JSONObject, ObjectType } from "../../Types/JSON";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";

/*
 * JSON reading (JSONFunctions) builds a value back from the type its JSON
 * names, through SerializableObjectDictionary, and every frontend reads
 * JSON. The dictionary imported a monitor's steps and criteria, and with
 * them every monitor type: some 147 KB (before gzip) of the sign-in pages',
 * a status page's and a public dashboard's first load, none of which ever
 * reads a monitor (issue #8821).
 *
 * Those four now join the dictionary from their own module
 * (Types/JoinedSerializableObjects): a program reads them once it has loaded
 * them - the server through the models, the Dashboard from its entry
 * (Types/Monitor/MonitorJsonTypes) - and until
 * then JSON naming one reads as the plain object it was sent as.
 *
 * Each "fresh" test loads the modules it names into a module registry of its
 * own (jest.isolateModules), as a page that loads nothing else would.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");

const MONITOR_JSON_TYPES: ReadonlyArray<ObjectType> = [
  ObjectType.MonitorSteps,
  ObjectType.MonitorStep,
  ObjectType.MonitorCriteria,
  ObjectType.MonitorCriteriaInstance,
];

// A monitor's steps as the API sends them: one step, its criteria and theirs.
const STEPS_JSON: JSONObject = MonitorSteps.getDefaultMonitorSteps({
  defaultMonitorStatusId: new ObjectID("100000000000000000000001"),
  monitorType: MonitorType.Manual,
  monitorName: "Checkout",
  onlineMonitorStatusId: new ObjectID("100000000000000000000002"),
  offlineMonitorStatusId: new ObjectID("100000000000000000000003"),
  defaultIncidentSeverityId: new ObjectID("100000000000000000000004"),
  defaultAlertSeverityId: new ObjectID("100000000000000000000005"),
}).toJSON();

// The JSON of the first step, of its criteria and of their first criterion.
const STEP_JSON: JSONObject = (
  (STEPS_JSON["value"] as JSONObject)[
    "monitorStepsInstanceArray"
  ] as Array<JSONObject>
)[0]!;
const CRITERIA_JSON: JSONObject = (STEP_JSON["value"] as JSONObject)[
  "monitorCriteria"
] as JSONObject;
const CRITERION_JSON: JSONObject = (
  (CRITERIA_JSON["value"] as JSONObject)[
    "monitorCriteriaInstanceArray"
  ] as Array<JSONObject>
)[0]!;

type Dictionary = Record<string, unknown>;

interface Fresh {
  dictionary: Dictionary;
  deserializeValue: (value: unknown) => unknown;
  load: <T>(module: string) => T;
}

// The dictionary and JSON reading in a registry of their own, and a loader for it.
const inFreshRegistry: (run: (fresh: Fresh) => void) => void = (
  run: (fresh: Fresh) => void,
): void => {
  jest.isolateModules(() => {
    const load: <T>(module: string) => T = <T>(module: string): T => {
      return (
        jest.requireActual(path.join(COMMON_ROOT, module)) as { default: T }
      ).default;
    };

    const jsonFunctions: { deserializeValue: (value: unknown) => unknown } =
      load("Types/JSONFunctions");

    run({
      dictionary: load<Dictionary>("Types/SerializableObjectDictionary"),
      deserializeValue: (value: unknown): unknown => {
        return jsonFunctions.deserializeValue(value as never);
      },
      load,
    });
  });
};

const source: (file: string) => string = (file: string): string => {
  return fs.readFileSync(path.join(COMMON_ROOT, file), "utf8");
};

const isPlainObject: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
};

describe("JSON reading before a program has loaded a monitor type", () => {
  test("still names each of them, with no type behind it yet", () => {
    inFreshRegistry((fresh: Fresh) => {
      for (const type of MONITOR_JSON_TYPES) {
        expect({
          type,
          named: Object.keys(fresh.dictionary).includes(type),
        }).toEqual({ type, named: true });
        expect({ type, joined: fresh.dictionary[type] }).toEqual({
          type,
          joined: undefined,
        });
      }
    });
  });

  test("reads a monitor's steps as the plain object they were sent as, step and criteria too", () => {
    inFreshRegistry((fresh: Fresh) => {
      const read: JSONObject = fresh.deserializeValue(STEPS_JSON) as JSONObject;

      expect(isPlainObject(read)).toBe(true);
      expect(read["_type"]).toBe(ObjectType.MonitorSteps);

      const step: JSONObject = (
        (read["value"] as JSONObject)[
          "monitorStepsInstanceArray"
        ] as Array<JSONObject>
      )[0]!;

      expect(isPlainObject(step)).toBe(true);
      expect(step["_type"]).toBe(ObjectType.MonitorStep);
    });
  });

  test("reads every other type as before", () => {
    inFreshRegistry((fresh: Fresh) => {
      const FreshObjectID: typeof ObjectID = fresh.load("Types/ObjectID");
      const id: ObjectID = new ObjectID("550e8400-e29b-41d4-a716-446655440001");
      const read: unknown = fresh.deserializeValue(id.toJSON());

      expect(read).toBeInstanceOf(FreshObjectID);
      expect(String(read)).toBe(id.toString());
    });
  });

  test("the dictionary imports none of them, and their registry imports nothing it runs", () => {
    expect(source("Types/SerializableObjectDictionary.ts")).not.toMatch(
      /from "\.\/Monitor\//,
    );

    // Only `import type`: never part of an import cycle, whatever loads first.
    const imports: Array<string> =
      source("Types/JoinedSerializableObjects.ts").match(/^import .*$/gm) || [];

    expect(imports.length).toBeGreaterThan(0);

    for (const line of imports) {
      expect(line).toMatch(/^import type /);
    }
  });
});

describe("a monitor type, once its module has loaded", () => {
  test("a criterion joins as its module loads, and only it", () => {
    inFreshRegistry((fresh: Fresh) => {
      const FreshCriterion: new () => unknown = fresh.load(
        "Types/Monitor/MonitorCriteriaInstance",
      );

      expect(fresh.dictionary[ObjectType.MonitorCriteriaInstance]).toBe(
        FreshCriterion,
      );
      expect(fresh.deserializeValue(CRITERION_JSON)).toBeInstanceOf(
        FreshCriterion,
      );
      expect(fresh.dictionary[ObjectType.MonitorStep]).toBeUndefined();
      expect(fresh.dictionary[ObjectType.MonitorSteps]).toBeUndefined();
    });
  });

  test("a monitor's steps bring every type in them, and read back whole", () => {
    inFreshRegistry((fresh: Fresh) => {
      const FreshSteps: typeof MonitorSteps = fresh.load(
        "Types/Monitor/MonitorSteps",
      );
      const FreshStep: new () => unknown = fresh.load(
        "Types/Monitor/MonitorStep",
      );
      const FreshCriteria: new () => unknown = fresh.load(
        "Types/Monitor/MonitorCriteria",
      );
      const FreshCriterion: new () => unknown = fresh.load(
        "Types/Monitor/MonitorCriteriaInstance",
      );

      expect([
        fresh.dictionary[ObjectType.MonitorSteps],
        fresh.dictionary[ObjectType.MonitorStep],
        fresh.dictionary[ObjectType.MonitorCriteria],
        fresh.dictionary[ObjectType.MonitorCriteriaInstance],
      ]).toEqual([FreshSteps, FreshStep, FreshCriteria, FreshCriterion]);

      const read: MonitorSteps = fresh.deserializeValue(
        STEPS_JSON,
      ) as MonitorSteps;

      expect(read).toBeInstanceOf(FreshSteps);
      expect(read.data!.monitorStepsInstanceArray[0]).toBeInstanceOf(FreshStep);
      expect(
        read.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria,
      ).toBeInstanceOf(FreshCriteria);
      expect(
        read.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria.data!
          .monitorCriteriaInstanceArray[0],
      ).toBeInstanceOf(FreshCriterion);
      expect(read.toJSON()).toEqual(STEPS_JSON);
    });
  });

  test("MonitorJsonTypes, which the Dashboard loads first, joins all four", () => {
    inFreshRegistry((fresh: Fresh) => {
      const types: ReadonlyArray<unknown> = fresh.load(
        "Types/Monitor/MonitorJsonTypes",
      );

      expect(types).toEqual(
        MONITOR_JSON_TYPES.map((type: ObjectType): unknown => {
          return fresh.dictionary[type];
        }),
      );

      for (const type of MONITOR_JSON_TYPES) {
        expect({ type, joined: typeof fresh.dictionary[type] }).toEqual({
          type,
          joined: "function",
        });
      }
    });
  });

  test.each([["Monitor"], ["MonitorTemplate"], ["MonitorTest"]])(
    "on the server, the %s model brings them: its steps read back from the API's JSON",
    (model: string) => {
      inFreshRegistry((fresh: Fresh) => {
        const FreshModel: new () => unknown = fresh.load(
          `Models/DatabaseModels/${model}`,
        );
        const BaseModel: {
          fromJSON: (json: JSONObject, type: new () => unknown) => unknown;
        } = fresh.load(
          "Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel",
        );
        const FreshSteps: typeof MonitorSteps = fresh.load(
          "Types/Monitor/MonitorSteps",
        );

        for (const type of MONITOR_JSON_TYPES) {
          expect({ type, joined: typeof fresh.dictionary[type] }).toEqual({
            type,
            joined: "function",
          });
        }

        const read: { monitorSteps?: unknown } = BaseModel.fromJSON(
          { monitorSteps: STEPS_JSON },
          FreshModel,
        ) as { monitorSteps?: unknown };

        expect(read.monitorSteps).toBeInstanceOf(FreshSteps);
      });
    },
  );
});

describe("the steps column's database transformer", () => {
  const NODE_TRANSFORMER: string =
    "Types/Monitor/MonitorStepsColumnTransformer.ts";
  const BROWSER_TRANSFORMER: string =
    "Types/Monitor/MonitorStepsColumnTransformer.browser.ts";

  test("in Node, writes a monitor's steps as their JSON and reads them back", () => {
    inFreshRegistry((fresh: Fresh) => {
      const transformer: ValueTransformer = fresh.load(
        "Types/Monitor/MonitorStepsColumnTransformer",
      );
      const FreshSteps: typeof MonitorSteps = fresh.load(
        "Types/Monitor/MonitorSteps",
      );

      const steps: MonitorSteps = FreshSteps.fromJSON(STEPS_JSON);
      const written: unknown = transformer.to(steps);

      expect(written).toEqual(STEPS_JSON);

      const readBack: unknown = transformer.from(written);

      expect(readBack).toBeInstanceOf(FreshSteps);
      expect((readBack as MonitorSteps).toJSON()).toEqual(STEPS_JSON);

      // A column the caller did not set stays unset, for its default.
      expect(transformer.to(undefined)).toBeUndefined();
    });
  });

  test("a browser build's says the database is the server's, and brings no monitor type", () => {
    inFreshRegistry((fresh: Fresh) => {
      const transformer: ValueTransformer = fresh.load(
        "Types/Monitor/MonitorStepsColumnTransformer.browser",
      );

      expect(() => {
        return transformer.to(STEPS_JSON);
      }).toThrow(
        "A monitor's steps are written to and read from the database on the server only.",
      );
      expect(() => {
        return transformer.from(STEPS_JSON);
      }).toThrow(
        "A monitor's steps are written to and read from the database on the server only.",
      );

      for (const type of MONITOR_JSON_TYPES) {
        expect(fresh.dictionary[type]).toBeUndefined();
      }
    });

    for (const line of source(BROWSER_TRANSFORMER).match(/^import .*$/gm) ||
      []) {
      expect(line).toMatch(/^import type /);
    }
  });

  test("a browser build takes the browser one in its place (package.json's browser field)", () => {
    const manifest: { browser?: Record<string, string> } = JSON.parse(
      source("package.json"),
    );

    expect(manifest.browser).toEqual(
      expect.objectContaining({
        [`./${NODE_TRANSFORMER}`]: `./${BROWSER_TRANSFORMER}`,
      }),
    );
    expect(fs.existsSync(path.join(COMMON_ROOT, NODE_TRANSFORMER))).toBe(true);
    expect(fs.existsSync(path.join(COMMON_ROOT, BROWSER_TRANSFORMER))).toBe(
      true,
    );
  });

  test.each([["Monitor"], ["MonitorTemplate"], ["MonitorTest"]])(
    "the %s model's steps column declares it, not MonitorSteps' own",
    (model: string) => {
      const file: string = source(`Models/DatabaseModels/${model}.ts`);

      expect(file).toContain(
        'import MonitorStepsColumnTransformer from "../../Types/Monitor/MonitorStepsColumnTransformer";',
      );
      expect(file).toContain("transformer: MonitorStepsColumnTransformer,");
      expect(file).not.toContain("MonitorSteps.getDatabaseTransformer()");
    },
  );
});

describe("the programs that read monitors load them first", () => {
  const entryOf: (frontend: string) => string = (frontend: string): string => {
    return fs.readFileSync(
      path.join(
        COMMON_ROOT,
        "..",
        "App",
        "FeatureSet",
        frontend,
        "src",
        "Index.tsx",
      ),
      "utf8",
    );
  };

  test("the Dashboard's entry imports MonitorJsonTypes, before any page reads one", () => {
    expect(entryOf("Dashboard")).toMatch(
      /^import "Common\/Types\/Monitor\/MonitorJsonTypes";$/m,
    );
  });

  test.each([
    ["Accounts"],
    ["StatusPage"],
    ["PublicDashboard"],
    ["AdminDashboard"],
  ])("%s, which never reads a monitor, does not", (frontend: string) => {
    expect(entryOf(frontend)).not.toContain("MonitorJsonTypes");
  });
});
