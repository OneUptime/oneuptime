import fs from "fs";
import path from "path";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../../Server/Services/DatabaseService";
import LabelAndOwnerRuleBaseService from "../../../Server/Services/LabelAndOwnerRuleBaseService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  getRuleActionColumns,
  INHERITED_LABEL_COLUMNS,
  INHERITED_OWNER_COLUMNS,
  INHERITING_LABEL_RULE_ADDS_NOTHING_MESSAGE,
  INHERITING_OWNER_RULE_ADDS_NOTHING_MESSAGE,
  LABEL_RULE_ADDS_NOTHING_MESSAGE,
  OWNER_RULE_ADDS_NOTHING_MESSAGE,
  RuleActionColumns,
} from "../../../Utils/Rules/RuleAction";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import type { SpyInstance } from "jest-mock";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A NEW LABEL OR OWNER RULE MUST ADD SOMETHING, HOWEVER IT IS MADE.
 *
 * The Dashboard's form never saves a rule that adds nothing (Dashboard
 * Utils/Form/ResourceRuleForm), but the API, Terraform, a workflow and a
 * label rule import create through the rule's service - and used to save
 * one: no label, no person or team, no Inherit switch on. Such a rule
 * matches and does nothing.
 *
 * Every label and owner rule service now extends LabelAndOwnerRuleBaseService,
 * which refuses that create with one plain answer naming the fields to fill
 * - before anything is looked up - and still checks the project's records
 * (ProjectReferencesService). An update is not held to it: an Edit may
 * empty a working rule, and the table marks it "Adds nothing".
 *
 * Found by scanning the models, so a label or owner rule added later is
 * covered without being listed here. The project's directory is stubbed
 * (ProjectDirectory); nothing here needs a database.
 */

const MODELS_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Models/DatabaseModels",
);
const SERVICES_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Server/Services",
);

const RULE_MODEL_FILE: RegExp = /(Label|Owner)Rule\.ts$/;
const LABEL_RULE_MODEL: RegExp = /LabelRule$/;

// A model with Inherit switches: an incident's, alert's or event's rule.
const INHERIT_SWITCH_COLUMN: RegExp =
  /public inherit(Labels|Owners)From\w+\?: boolean/;

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);

const OWN_LABEL_ID: string = "a0a0a0a0-0000-4000-8000-000000000001";
const OWN_USER_ID: string = "a0a0a0a0-0000-4000-8000-000000000002";
const OWN_TEAM_ID: string = "a0a0a0a0-0000-4000-8000-000000000003";

// Somebody of the project, through the API (or Terraform, or an import).
const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("05e40000-0000-4000-8000-000000000001"),
};

// A workflow step, and OneUptime's own writes.
const ROOT_WITH_PROJECT: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
};

interface RuleCase {
  model: string;
  serviceFile: string;
  kind: "labels" | "owners";
  inherits: boolean;
}

const RULE_CASES: Array<RuleCase> = fs
  .readdirSync(MODELS_DIRECTORY)
  .filter((file: string): boolean => {
    return RULE_MODEL_FILE.test(file);
  })
  .sort()
  .map((file: string): RuleCase => {
    const model: string = file.replace(/\.ts$/, "");
    const source: string = fs.readFileSync(
      path.join(MODELS_DIRECTORY, file),
      "utf8",
    );

    return {
      model,
      serviceFile: `${model}Service.ts`,
      kind: LABEL_RULE_MODEL.test(model) ? "labels" : "owners",
      inherits: INHERIT_SWITCH_COLUMN.test(source),
    };
  });

const ruleNamesOf: (kind: "labels" | "owners") => Array<string> = (
  kind: "labels" | "owners",
): Array<string> => {
  return RULE_CASES.filter((ruleCase: RuleCase): boolean => {
    return ruleCase.kind === kind;
  }).map((ruleCase: RuleCase): string => {
    return ruleCase.model;
  });
};

type LoadServiceFunction = (
  ruleCase: RuleCase,
) => DatabaseService<DatabaseBaseModel>;

const loadService: LoadServiceFunction = (
  ruleCase: RuleCase,
): DatabaseService<DatabaseBaseModel> => {
  return (
    jest.requireActual(path.join(SERVICES_DIRECTORY, ruleCase.serviceFile)) as {
      default: DatabaseService<DatabaseBaseModel>;
    }
  ).default;
};

type SwitchesFunction = (ruleCase: RuleCase) => ReadonlyArray<string>;

// The rule's Inherit switches: six on an event's rule, none on any other.
const switchesOf: SwitchesFunction = (
  ruleCase: RuleCase,
): ReadonlyArray<string> => {
  if (!ruleCase.inherits) {
    return [];
  }

  return ruleCase.kind === "labels"
    ? INHERITED_LABEL_COLUMNS
    : INHERITED_OWNER_COLUMNS;
};

type MessageFunction = (ruleCase: RuleCase) => string;

// The one answer to a rule that adds nothing, in the words of its fields.
const messageFor: MessageFunction = (ruleCase: RuleCase): string => {
  if (ruleCase.kind === "labels") {
    return ruleCase.inherits
      ? INHERITING_LABEL_RULE_ADDS_NOTHING_MESSAGE
      : LABEL_RULE_ADDS_NOTHING_MESSAGE;
  }

  return ruleCase.inherits
    ? INHERITING_OWNER_RULE_ADDS_NOTHING_MESSAGE
    : OWNER_RULE_ADDS_NOTHING_MESSAGE;
};

type NewRuleFunction = (
  service: DatabaseService<DatabaseBaseModel>,
  values?: Record<string, unknown>,
) => DatabaseBaseModel;

// A new rule as the API builds it from a request: named, in the project.
const newRule: NewRuleFunction = (
  service: DatabaseService<DatabaseBaseModel>,
  values: Record<string, unknown> = {},
): DatabaseBaseModel => {
  const rule: DatabaseBaseModel = new service.modelType();
  rule.setColumnValue("projectId", PROJECT_ID);
  rule.setColumnValue("name", "Production rule");
  Object.assign(rule, values);
  return rule;
};

type HookFunction = (input: unknown) => Promise<unknown>;

const createHook: (
  service: DatabaseService<DatabaseBaseModel>,
  data: DatabaseBaseModel,
  props?: DatabaseCommonInteractionProps,
) => Promise<unknown> = (
  service: DatabaseService<DatabaseBaseModel>,
  data: DatabaseBaseModel,
  props: DatabaseCommonInteractionProps = CALLER,
): Promise<unknown> => {
  return (service as unknown as Record<string, HookFunction>)[
    "onBeforeCreate"
  ]!.call(service, { data, props });
};

type CaughtFunction = (promise: Promise<unknown>) => Promise<unknown>;

const caught: CaughtFunction = async (
  promise: Promise<unknown>,
): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return null;
};

type WhatItAddsFunction = (ruleCase: RuleCase) => Record<string, unknown>;

// One of the project's labels, or one of its people: what a rule adds.
const oneThingItAdds: WhatItAddsFunction = (
  ruleCase: RuleCase,
): Record<string, unknown> => {
  return ruleCase.kind === "labels"
    ? { labelsToAdd: [{ _id: OWN_LABEL_ID }] }
    : { ownerUsers: [{ _id: OWN_USER_ID }] };
};

beforeEach(() => {
  // Every label, person and team named below is the project's own.
  stubProjectDirectory({ projectId: PROJECT_ID });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every label and owner rule service", () => {
  /*
   * A broken scan must not pass by finding nothing: 31 label rule models
   * and 31 owner rule models today, six of them an incident's, an alert's
   * or a scheduled maintenance event's, which can inherit.
   */
  test("is found by scanning the models", () => {
    expect(RULE_CASES.length).toBeGreaterThanOrEqual(62);
    expect(ruleNamesOf("labels").length).toBeGreaterThanOrEqual(31);
    expect(ruleNamesOf("owners").length).toBeGreaterThanOrEqual(31);
    expect(
      RULE_CASES.filter((ruleCase: RuleCase): boolean => {
        return ruleCase.inherits;
      })
        .map((ruleCase: RuleCase): string => {
          return ruleCase.model;
        })
        .sort(),
    ).toEqual([
      "AlertLabelRule",
      "AlertOwnerRule",
      "IncidentLabelRule",
      "IncidentOwnerRule",
      "ScheduledMaintenanceLabelRule",
      "ScheduledMaintenanceOwnerRule",
    ]);
  });

  test.each(
    RULE_CASES.map((ruleCase: RuleCase) => {
      return [ruleCase.serviceFile, ruleCase];
    }),
  )(
    "%s is a LabelAndOwnerRuleBaseService, and still a ProjectReferencesService",
    (_file: string, ruleCase: RuleCase) => {
      const service: DatabaseService<DatabaseBaseModel> = loadService(ruleCase);

      expect(service).toBeInstanceOf(LabelAndOwnerRuleBaseService);
      expect(service).toBeInstanceOf(ProjectReferencesService);
      expect(service.getModel().tableName).toBe(ruleCase.model);

      // What the service knows its rule adds is what the model has.
      const action: RuleActionColumns | null = getRuleActionColumns(
        service.getModel(),
      );

      expect(action).toEqual({
        listColumns:
          ruleCase.kind === "labels"
            ? ["labelsToAdd"]
            : ["ownerUsers", "ownerTeams"],
        switchColumns: [...switchesOf(ruleCase)],
      });
    },
  );

  test.each(
    RULE_CASES.map((ruleCase: RuleCase) => {
      return [ruleCase.serviceFile, ruleCase];
    }),
  )(
    "%s refuses a new rule that adds nothing, with one plain answer",
    async (_file: string, ruleCase: RuleCase) => {
      const service: DatabaseService<DatabaseBaseModel> = loadService(ruleCase);

      // Nothing sent at all: the lists start empty, the switches off.
      const error: unknown = await caught(
        createHook(service, newRule(service)),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe(messageFor(ruleCase));
    },
  );

  test.each(
    RULE_CASES.map((ruleCase: RuleCase) => {
      return [ruleCase.serviceFile, ruleCase];
    }),
  )(
    "%s refuses empty lists, entries that name nothing, and switches that are off",
    async (_file: string, ruleCase: RuleCase) => {
      const service: DatabaseService<DatabaseBaseModel> = loadService(ruleCase);
      const switchesOff: Record<string, unknown> = Object.fromEntries(
        switchesOf(ruleCase).map((column: string): [string, unknown] => {
          return [column, false];
        }),
      );

      const payloads: Array<Record<string, unknown>> =
        ruleCase.kind === "labels"
          ? [
              { labelsToAdd: [] },
              { labelsToAdd: null },
              { labelsToAdd: [{}] },
              { labelsToAdd: [{ _id: "" }, "  "] },
              { labelsToAdd: [], ...switchesOff },
            ]
          : [
              { ownerUsers: [], ownerTeams: [] },
              { ownerUsers: null, ownerTeams: null },
              { ownerUsers: [{}], ownerTeams: [{ _id: " " }] },
              { ownerUsers: [], ownerTeams: [], ...switchesOff },
            ];

      for (const payload of payloads) {
        await expect(
          createHook(service, newRule(service, payload)),
        ).rejects.toThrow(new BadDataException(messageFor(ruleCase)));
      }
    },
  );

  test.each(
    RULE_CASES.map((ruleCase: RuleCase) => {
      return [ruleCase.serviceFile, ruleCase];
    }),
  )(
    "%s refuses it from OneUptime's own writes and workflows too",
    async (_file: string, ruleCase: RuleCase) => {
      const service: DatabaseService<DatabaseBaseModel> = loadService(ruleCase);

      for (const props of [
        ROOT_WITH_PROJECT,
        { isRoot: true } as DatabaseCommonInteractionProps,
        { ...CALLER, isMasterAdmin: true },
      ]) {
        await expect(
          createHook(service, newRule(service), props),
        ).rejects.toThrow(new BadDataException(messageFor(ruleCase)));
      }
    },
  );

  /*
   * The check reads nothing, so a rule that adds nothing is refused before
   * the project's records are looked up.
   */
  test.each(
    RULE_CASES.map((ruleCase: RuleCase) => {
      return [ruleCase.serviceFile, ruleCase];
    }),
  )(
    "%s refuses it before anything is looked up",
    async (_file: string, ruleCase: RuleCase) => {
      const service: DatabaseService<DatabaseBaseModel> = loadService(ruleCase);
      const referenceCheck: SpyInstance<
        typeof ProjectReferenceCheck.validateCreate
      > = jest.spyOn(ProjectReferenceCheck, "validateCreate");

      await expect(createHook(service, newRule(service))).rejects.toThrow(
        BadDataException,
      );
      expect(referenceCheck).not.toHaveBeenCalled();
    },
  );

  test.each(
    RULE_CASES.map((ruleCase: RuleCase) => {
      return [ruleCase.serviceFile, ruleCase];
    }),
  )(
    "%s creates a rule that adds something, and still checks the project's records",
    async (_file: string, ruleCase: RuleCase) => {
      const service: DatabaseService<DatabaseBaseModel> = loadService(ruleCase);
      const referenceCheck: SpyInstance<
        typeof ProjectReferenceCheck.validateCreate
      > = jest.spyOn(ProjectReferenceCheck, "validateCreate");

      const payloads: Array<Record<string, unknown>> =
        ruleCase.kind === "labels"
          ? [
              oneThingItAdds(ruleCase),
              // As a bare id, as an API update sends one.
              { labelsToAdd: [OWN_LABEL_ID] },
              // As an ObjectID.
              { labelsToAdd: [new ObjectID(OWN_LABEL_ID)] },
            ]
          : [
              oneThingItAdds(ruleCase),
              // A team alone is enough, and a person alone.
              { ownerUsers: [], ownerTeams: [{ _id: OWN_TEAM_ID }] },
              { ownerUsers: [OWN_USER_ID] },
            ];

      for (const payload of payloads) {
        const rule: DatabaseBaseModel = newRule(service, payload);

        await expect(createHook(service, rule)).resolves.toEqual(
          expect.objectContaining({
            createBy: expect.objectContaining({ data: rule }),
          }),
        );
      }

      expect(referenceCheck).toHaveBeenCalledTimes(payloads.length);
    },
  );
});

/*
 * An incident's, alert's or scheduled maintenance event's rule may add
 * nothing by name: each Inherit switch on its own is something it adds.
 */
const INHERITING_CASES: Array<RuleCase> = RULE_CASES.filter(
  (ruleCase: RuleCase): boolean => {
    return ruleCase.inherits;
  },
);

describe.each(
  INHERITING_CASES.map((ruleCase: RuleCase) => {
    return [ruleCase.model, ruleCase];
  }),
)("a new %s", (_model: string, ruleCase: RuleCase) => {
  test("may only inherit: any one switch on is enough", async () => {
    const service: DatabaseService<DatabaseBaseModel> = loadService(ruleCase);

    for (const column of switchesOf(ruleCase)) {
      await expect(
        createHook(service, newRule(service, { [column]: true })),
      ).resolves.toBeDefined();
    }
  });

  test("names the switches in its answer, as the form names them", async () => {
    const service: DatabaseService<DatabaseBaseModel> = loadService(ruleCase);

    await expect(createHook(service, newRule(service))).rejects.toThrow(
      ruleCase.kind === "labels"
        ? "or turn on an Inherit Labels switch."
        : "or turn on an Inherit Owners switch.",
    );
  });

  /*
   * Only the JSON boolean true is on, as the table's "Adds nothing" marker
   * reads a switch: the API documents the switches as booleans.
   */
  test("does not count a switch sent as text", async () => {
    const service: DatabaseService<DatabaseBaseModel> = loadService(ruleCase);
    const firstSwitch: string = switchesOf(ruleCase)[0]!;

    for (const value of ["true", 1, "on"]) {
      await expect(
        createHook(service, newRule(service, { [firstSwitch]: value })),
      ).rejects.toThrow(BadDataException);
    }
  });

  test("does not count the other kind's switches", async () => {
    const service: DatabaseService<DatabaseBaseModel> = loadService(ruleCase);
    const otherKind: ReadonlyArray<string> =
      ruleCase.kind === "labels"
        ? INHERITED_OWNER_COLUMNS
        : INHERITED_LABEL_COLUMNS;

    await expect(
      createHook(
        service,
        newRule(
          service,
          Object.fromEntries(
            otherKind.map((column: string): [string, boolean] => {
              return [column, true];
            }),
          ),
        ),
      ),
    ).rejects.toThrow(new BadDataException(messageFor(ruleCase)));
  });
});

/*
 * Decision (#4416, kept): an Edit may empty a working rule. Its table marks
 * it "Adds nothing", and it can still be renamed, switched off or deleted.
 */
describe("an update", () => {
  test.each(
    RULE_CASES.map((ruleCase: RuleCase) => {
      return [ruleCase.serviceFile, ruleCase];
    }),
  )(
    "%s may still empty what a rule adds",
    async (_file: string, ruleCase: RuleCase) => {
      const service: DatabaseService<DatabaseBaseModel> = loadService(ruleCase);

      // The rule holds nothing the update would keep.
      jest.spyOn(service, "findBy").mockResolvedValue([] as never);

      const emptied: Record<string, unknown> =
        ruleCase.kind === "labels"
          ? { labelsToAdd: [] }
          : { ownerUsers: [], ownerTeams: [] };

      for (const column of switchesOf(ruleCase)) {
        emptied[column] = false;
      }

      await expect(
        (service as unknown as Record<string, HookFunction>)[
          "onBeforeUpdate"
        ]!.call(service, {
          query: { _id: "0c1d2e3f-0000-4000-8000-0000000000a1" },
          data: emptied,
          props: CALLER,
          limit: 1,
          skip: 0,
        }),
      ).resolves.toBeDefined();
    },
  );
});

/*
 * The real create the API calls (DatabaseService.create, which BaseAPI's
 * create route, Terraform, workflows and the label rule import all reach):
 * refused before anything is saved.
 */
describe("creating a rule that adds nothing, through the service's create", () => {
  test.each(
    RULE_CASES.map((ruleCase: RuleCase) => {
      return [ruleCase.serviceFile, ruleCase];
    }),
  )(
    "%s saves nothing and answers with the plain message",
    async (_file: string, ruleCase: RuleCase) => {
      const service: DatabaseService<DatabaseBaseModel> = loadService(ruleCase);
      const repository: SpyInstance<typeof service.getRepository> = jest.spyOn(
        service,
        "getRepository",
      );

      await expect(
        service.create({
          data: newRule(service),
          props: ROOT_WITH_PROJECT,
        }),
      ).rejects.toThrow(new BadDataException(messageFor(ruleCase)));

      expect(repository).not.toHaveBeenCalled();
    },
  );
});

describe("the base service", () => {
  test("serves label and owner rules only", () => {
    class NotARule extends DatabaseBaseModel {}

    expect(() => {
      return new LabelAndOwnerRuleBaseService(NotARule);
    }).toThrow(/is not a label or owner rule/);
  });
});
