import fs from "fs";
import path from "path";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../Server/Utils/Logger";
import { RuleApplicationResult } from "../../../Server/Utils/Rules/RuleRun/RuleApplication";
import ObjectID from "../../../Types/ObjectID";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A label rule's labels are attached by its engine as root, straight into
 * the resource's label list. The lists are checked when a rule is saved,
 * but a rule saved before that can still name another project's label - so
 * every label rule engine attaches only the project's own labels, and logs
 * the others by id.
 *
 * Every engine is found by its file name and run through its "Run now"
 * entry point (applyRulesToExistingResource) with a rule that matches the
 * resource and names one label of the project and one of another project.
 * The database is stubbed: reads return the resource, and the label list
 * write is captured.
 */

const SERVICES_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Server/Services",
);
const MODELS_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Models/DatabaseModels",
);

const PROJECT_ID: ObjectID = new ObjectID(
  "7c2a9d40-1b3e-4f5a-8c6d-9e0f1a2b3c4d",
);
const RESOURCE_ID: string = "7c2a9d40-0000-4000-8000-000000000001";
const OWN_LABEL: string = "7c2a9d40-0000-4000-8000-0000000000a1";
const FOREIGN_LABEL: string = "7c2a9d40-0000-4000-8000-0000000000f1";

const ENGINE_FILES: Array<string> = fs
  .readdirSync(SERVICES_DIRECTORY)
  .filter((name: string): boolean => {
    return name.endsWith("LabelRuleEngineService.ts");
  })
  .sort();

interface RunEngine {
  applyRulesToExistingResource: (data: {
    resource: DatabaseBaseModel;
    rules: Array<DatabaseBaseModel>;
    allowOwnerNotification: boolean;
  }) => Promise<RuleApplicationResult>;
}

type ModelType = { new (): DatabaseBaseModel };

function modelTypeOf(name: string): ModelType {
  return (
    jest.requireActual(path.join(MODELS_DIRECTORY, `${name}.ts`)) as {
      default: ModelType;
    }
  ).default;
}

function label(id: string): Label {
  const item: Label = new Label();
  item._id = id;
  return item;
}

// The resource as the engine reads it back: no labels yet, nothing linked.
function resourceOf(modelType: ModelType): DatabaseBaseModel {
  const resource: DatabaseBaseModel = new modelType();
  resource._id = RESOURCE_ID;
  resource.setColumnValue("projectId", PROJECT_ID);

  for (const column of ["name", "title", "description"]) {
    if (resource.hasColumn(column)) {
      resource.setColumnValue(column, "Payments");
    }
  }

  if (resource.hasColumn("labels")) {
    resource.setColumnValue("labels", []);
  }

  return resource;
}

let attached: Array<string>;

beforeEach(() => {
  attached = [];

  stubProjectDirectory({
    projectId: PROJECT_ID,
    records: { Label: [OWN_LABEL] },
  });

  jest.spyOn(logger, "warn").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "error").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);

  // The label list write: relation(Model, "labels").of(id).add(ids).
  jest.spyOn(DatabaseService.prototype, "getRepository").mockReturnValue({
    createQueryBuilder: () => {
      return {
        relation: () => {
          return {
            of: () => {
              return {
                add: async (ids: unknown): Promise<void> => {
                  attached.push(
                    ...(Array.isArray(ids) ? ids : [ids]).map(
                      (id: unknown): string => {
                        return String(id);
                      },
                    ),
                  );
                },
              };
            },
          };
        },
      };
    },
  } as never);

  jest
    .spyOn(DatabaseService.prototype, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(DatabaseService.prototype, "findOneBy")
    .mockResolvedValue(null as never);
  jest
    .spyOn(DatabaseService.prototype, "create")
    .mockImplementation((async (createBy: {
      data: DatabaseBaseModel;
    }): Promise<DatabaseBaseModel> => {
      return createBy.data;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("label rule engines", () => {
  test("are all found", () => {
    // Today: one for each of 30 kinds of resource.
    expect(ENGINE_FILES.length).toBeGreaterThanOrEqual(30);
  });

  test.each(
    ENGINE_FILES.map((file: string) => {
      return [file];
    }),
  )(
    "%s attaches the project's own labels and leaves another project's out",
    async (file: string) => {
      const kind: string = file.replace(/LabelRuleEngineService\.ts$/, "");
      const resourceType: ModelType = modelTypeOf(kind);
      const ruleType: ModelType = modelTypeOf(`${kind}LabelRule`);

      jest
        .spyOn(DatabaseService.prototype, "findOneById")
        .mockImplementation((async (): Promise<DatabaseBaseModel> => {
          return resourceOf(resourceType);
        }) as never);

      const rule: DatabaseBaseModel = new ruleType();
      rule._id = "7c2a9d40-0000-4000-8000-0000000000c1";
      rule.setColumnValue("name", "Payments labels");
      rule.setColumnValue("labelsToAdd", [
        label(OWN_LABEL),
        label(FOREIGN_LABEL),
      ]);

      const engine: RunEngine = (
        jest.requireActual(path.join(SERVICES_DIRECTORY, file)) as {
          default: RunEngine;
        }
      ).default;

      await engine.applyRulesToExistingResource({
        resource: resourceOf(resourceType),
        rules: [rule],
        allowOwnerNotification: false,
      });

      expect({ file, attached }).toEqual({ file, attached: [OWN_LABEL] });
    },
  );

  test.each(
    ENGINE_FILES.map((file: string) => {
      return [file];
    }),
  )(
    "%s attaches nothing when the rule names only another project's labels",
    async (file: string) => {
      const kind: string = file.replace(/LabelRuleEngineService\.ts$/, "");
      const resourceType: ModelType = modelTypeOf(kind);
      const ruleType: ModelType = modelTypeOf(`${kind}LabelRule`);

      jest
        .spyOn(DatabaseService.prototype, "findOneById")
        .mockImplementation((async (): Promise<DatabaseBaseModel> => {
          return resourceOf(resourceType);
        }) as never);

      const rule: DatabaseBaseModel = new ruleType();
      rule._id = "7c2a9d40-0000-4000-8000-0000000000c2";
      rule.setColumnValue("name", "Foreign labels");
      rule.setColumnValue("labelsToAdd", [label(FOREIGN_LABEL)]);

      const engine: RunEngine = (
        jest.requireActual(path.join(SERVICES_DIRECTORY, file)) as {
          default: RunEngine;
        }
      ).default;

      const result: RuleApplicationResult =
        await engine.applyRulesToExistingResource({
          resource: resourceOf(resourceType),
          rules: [rule],
          allowOwnerNotification: false,
        });

      expect({ file, attached }).toEqual({ file, attached: [] });
      expect({ file, updated: result.updated }).toEqual({
        file,
        updated: false,
      });
    },
  );

  test.each(
    ENGINE_FILES.map((file: string) => {
      return [file];
    }),
  )(
    "%s attaches nothing, and says it failed, when the labels cannot be checked",
    async (file: string) => {
      const kind: string = file.replace(/LabelRuleEngineService\.ts$/, "");
      const resourceType: ModelType = modelTypeOf(kind);
      const ruleType: ModelType = modelTypeOf(`${kind}LabelRule`);

      jest
        .spyOn(DatabaseService.prototype, "findOneById")
        .mockImplementation((async (): Promise<DatabaseBaseModel> => {
          return resourceOf(resourceType);
        }) as never);

      jest
        .spyOn(ProjectScopedReferenceValidator, "findIdsInProject")
        .mockRejectedValue(new Error("database unavailable") as never);

      const rule: DatabaseBaseModel = new ruleType();
      rule._id = "7c2a9d40-0000-4000-8000-0000000000c3";
      rule.setColumnValue("name", "Payments labels");
      rule.setColumnValue("labelsToAdd", [label(OWN_LABEL)]);

      const engine: RunEngine = (
        jest.requireActual(path.join(SERVICES_DIRECTORY, file)) as {
          default: RunEngine;
        }
      ).default;

      const result: RuleApplicationResult =
        await engine.applyRulesToExistingResource({
          resource: resourceOf(resourceType),
          rules: [rule],
          allowOwnerNotification: false,
        });

      // A failed run, not "nothing to add" or "already applied".
      expect({ file, failed: result.failed }).toEqual({ file, failed: true });
      expect({ file, attached }).toEqual({ file, attached: [] });
    },
  );
});
