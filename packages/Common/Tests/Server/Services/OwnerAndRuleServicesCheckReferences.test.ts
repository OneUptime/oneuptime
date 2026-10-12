import fs from "fs";
import path from "path";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import ProjectReferenceCheck, {
  ProjectReferenceColumn,
} from "../../../Server/Utils/Database/ProjectReferenceCheck";
import { ProjectScopedReferenceException } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
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
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";

/*
 * Every rule (label, owner, on-call, grouping, privacy, reminder and the
 * rest) and every owner row (<Resource>OwnerUser / <Resource>OwnerTeam) may
 * reference only its own project's records: the engines act on those ids as
 * root - adding owners and notifying them, paging on-call policies,
 * attaching labels - and the Owners pages list the rows. So each of their
 * services is a ProjectReferencesService, whose create and update hooks
 * check every list and relation the model's metadata declares
 * (ProjectReferenceCheck).
 *
 * This holds every such service to it, found by scanning the models - a
 * rule or owner model added later is covered without being listed here:
 *
 *   - its service extends ProjectReferencesService, and any create or update
 *     hook of its own calls the base hook;
 *   - through its real create hook, root writes included, it refuses an id
 *     of another project in every list and relation it writes, naming the
 *     field and the id only;
 *   - its own records are accepted;
 *   - through its real update hook, it refuses an id the update adds.
 *
 * The project's directory is stubbed (ProjectDirectory); nothing here needs
 * a database.
 */

const MODELS_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Models/DatabaseModels",
);
const SERVICES_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Server/Services",
);

/*
 * Owner services that keep a check of their own instead, and why. Each must
 * still refuse another project's records - their own suites hold them to
 * it.
 */
const SERVICES_WITH_THEIR_OWN_CHECK: Record<string, string> = {
  "ServiceLevelObjectiveOwnerTeamService.ts":
    "SloOwnerReferenceValidator checks the SLO and the team, pinned to the project (ServiceLevelObjectiveChildRowTenancy.test.ts)",
  "ServiceLevelObjectiveOwnerUserService.ts":
    "SloOwnerReferenceValidator checks the SLO and the user's membership (ServiceLevelObjectiveChildRowTenancy.test.ts)",
};

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);

const USER_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("05e40000-0000-4000-8000-000000000001"),
};

interface ServiceCase {
  model: string;
  file: string;
  kind: "rule" | "owner";
}

// A rule model: the class extends one of the rule base models.
const RULE_MODEL_CLASS: RegExp =
  /class \w+ extends (RuleBaseModel|RelationOnlyRuleBaseModel)\b/;

// An owner row model: <Resource>OwnerUser or <Resource>OwnerTeam.
const OWNER_MODEL_NAME: RegExp = /Owner(User|Team)$/;

// The service of a label or owner rule: <Resource>LabelRule / OwnerRule.
const LABEL_OR_OWNER_RULE_SERVICE_FILE: RegExp =
  /(Label|Owner)RuleService\.ts$/;

function findServiceCases(): Array<ServiceCase> {
  const serviceFiles: Array<string> = fs
    .readdirSync(SERVICES_DIRECTORY)
    .filter((name: string): boolean => {
      return name.endsWith(".ts");
    });

  const serviceSources: Map<string, string> = new Map<string, string>(
    serviceFiles.map((name: string): [string, string] => {
      return [
        name,
        fs.readFileSync(path.join(SERVICES_DIRECTORY, name), "utf8"),
      ];
    }),
  );

  const cases: Array<ServiceCase> = [];

  for (const name of fs.readdirSync(MODELS_DIRECTORY).sort()) {
    if (!name.endsWith(".ts")) {
      continue;
    }

    const model: string = name.replace(/\.ts$/, "");
    const source: string = fs.readFileSync(
      path.join(MODELS_DIRECTORY, name),
      "utf8",
    );

    const isRule: boolean = RULE_MODEL_CLASS.test(source);
    const isOwner: boolean = OWNER_MODEL_NAME.test(model);

    if (!isRule && !isOwner) {
      continue;
    }

    // `import Model from ".../<model>";`, named imports beside it allowed.
    const importsTheModel: RegExp = new RegExp(
      `import Model(,\\s*\\{[^}]*\\})? from "\\.\\./\\.\\./Models/DatabaseModels/${model}";`,
    );

    for (const [file, serviceSource] of serviceSources) {
      if (importsTheModel.test(serviceSource)) {
        cases.push({ model, file, kind: isRule ? "rule" : "owner" });
      }
    }
  }

  return cases;
}

const CASES: Array<ServiceCase> = findServiceCases();

const CHECKED_CASES: Array<ServiceCase> = CASES.filter(
  (serviceCase: ServiceCase): boolean => {
    return !SERVICES_WITH_THEIR_OWN_CHECK[serviceCase.file];
  },
);

function sourceOf(file: string): string {
  return fs.readFileSync(path.join(SERVICES_DIRECTORY, file), "utf8");
}

// The body of a method, from its signature to the matching closing brace.
function methodBody(source: string, method: string): string | null {
  const start: number = source.indexOf(`protected override async ${method}(`);

  if (start === -1) {
    return null;
  }

  const open: number = source.indexOf("{", source.indexOf(")", start));
  let depth: number = 0;

  for (let index: number = open; index < source.length; index++) {
    if (source[index] === "{") {
      depth++;
    } else if (source[index] === "}") {
      depth--;

      if (depth === 0) {
        return source.slice(open, index + 1);
      }
    }
  }

  return null;
}

function loadService(file: string): DatabaseService<DatabaseBaseModel> {
  return (
    jest.requireActual(path.join(SERVICES_DIRECTORY, file)) as {
      default: DatabaseService<DatabaseBaseModel>;
    }
  ).default;
}

type HookFunction = (input: unknown) => Promise<unknown>;

function callHook(
  service: DatabaseService<DatabaseBaseModel>,
  hook: "onBeforeCreate" | "onBeforeUpdate",
  input: unknown,
): Promise<unknown> {
  return (service as unknown as Record<string, HookFunction>)[hook]!.call(
    service,
    input,
  );
}

function relationsCheckedBy(
  service: DatabaseService<DatabaseBaseModel>,
): Array<string> {
  const ownRelations: (() => Array<string>) | undefined = (
    service as unknown as { getRelationsCheckedByService?: () => Array<string> }
  ).getRelationsCheckedByService;

  return ownRelations ? ownRelations.call(service) : [];
}

function checkedColumnsOf(
  service: DatabaseService<DatabaseBaseModel>,
): Array<ProjectReferenceColumn> {
  return ProjectReferenceCheck.getCheckedColumns(
    service.getModel(),
    relationsCheckedBy(service),
  );
}

// A distinct id per column, so each column is shown to be checked on its own.
function idFor(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function foreignIdFor(index: number): string {
  return idFor("f0f0f0f0", index);
}

function ownIdFor(index: number): string {
  return idFor("a0a0a0a0", index);
}

// The payload, as an API create or update sends it, with `id` in every column.
function payloadWith(
  columns: Array<ProjectReferenceColumn>,
  idOf: (index: number) => string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  columns.forEach((column: ProjectReferenceColumn, index: number) => {
    if (column.isList) {
      payload[column.column] = [{ _id: idOf(index) }];
    } else {
      payload[column.idColumn || column.column] = new ObjectID(idOf(index));
    }
  });

  return payload;
}

function recordWith(
  service: DatabaseService<DatabaseBaseModel>,
  values: Record<string, unknown>,
): DatabaseBaseModel {
  const record: DatabaseBaseModel = new service.modelType();
  record.setColumnValue("projectId", PROJECT_ID);
  Object.assign(record, values);
  return record;
}

beforeEach(() => {
  /*
   * The project has the "own" ids, by the table each column points at, and
   * the users among them as members. No "foreign" id is anywhere in it.
   */
  const records: Record<string, Array<string>> = {};
  const members: Array<string> = [];

  for (const serviceCase of CHECKED_CASES) {
    const service: DatabaseService<DatabaseBaseModel> = loadService(
      serviceCase.file,
    );

    checkedColumnsOf(service).forEach(
      (column: ProjectReferenceColumn, index: number) => {
        const table: string = column.service.getModel().tableName || "";
        records[table] = [...(records[table] || []), ownIdFor(index)];

        if (table === "User") {
          members.push(ownIdFor(index));
        }
      },
    );
  }

  stubProjectDirectory({
    projectId: PROJECT_ID,
    records: records,
    members: members,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("rule and owner services", () => {
  test("are found by scanning the models", () => {
    const rules: number = CASES.filter((serviceCase: ServiceCase) => {
      return serviceCase.kind === "rule";
    }).length;
    const owners: number = CASES.filter((serviceCase: ServiceCase) => {
      return serviceCase.kind === "owner";
    }).length;

    // Today: 80 rule services and 72 owner row services.
    expect(rules).toBeGreaterThanOrEqual(80);
    expect(owners).toBeGreaterThanOrEqual(72);
  });

  test("every service kept on a check of its own still exists", () => {
    for (const file of Object.keys(SERVICES_WITH_THEIR_OWN_CHECK)) {
      expect(
        CASES.some((serviceCase: ServiceCase): boolean => {
          return serviceCase.file === file;
        }),
      ).toBe(true);
    }
  });

  test.each(
    CHECKED_CASES.map((serviceCase: ServiceCase) => {
      return [serviceCase.file];
    }),
  )(
    "%s extends ProjectReferencesService and calls its hooks",
    (file: string) => {
      const source: string = sourceOf(file);

      /*
       * A label or owner rule's service extends it through
       * LabelAndOwnerRuleBaseService, which also refuses a new rule that
       * adds nothing (LabelAndOwnerRuleServicesRefuseEmptyRules).
       */
      expect(source).toContain(
        LABEL_OR_OWNER_RULE_SERVICE_FILE.test(file)
          ? "export class Service extends LabelAndOwnerRuleBaseService<Model>"
          : "export class Service extends ProjectReferencesService<Model>",
      );

      for (const hook of ["onBeforeCreate", "onBeforeUpdate"]) {
        const body: string | null = methodBody(source, hook);

        if (body !== null) {
          expect({
            file,
            hook,
            callsBase: body.includes(`super.${hook}(`),
          }).toEqual({ file, hook, callsBase: true });
        }
      }

      expect(loadService(file)).toBeInstanceOf(ProjectReferencesService);
    },
  );

  test.each(
    CHECKED_CASES.map((serviceCase: ServiceCase) => {
      return [serviceCase.file];
    }),
  )(
    "%s leaves no list to a check of its own, and checks OneUptime's own writes too",
    (file: string) => {
      const service: DatabaseService<DatabaseBaseModel> = loadService(file);

      const lists: (() => Array<string>) | undefined = (
        service as unknown as { getListsCheckedByService?: () => Array<string> }
      ).getListsCheckedByService;

      expect(lists ? lists.call(service) : []).toEqual([]);

      /*
       * The engines add owners, page policies and attach labels as root, so
       * those writes are checked too (see OwnerRuleAssignment.createOwner).
       */
      const checksServerWrites: (() => boolean) | undefined = (
        service as unknown as { checksServerWrites?: () => boolean }
      ).checksServerWrites;

      expect(checksServerWrites ? checksServerWrites.call(service) : true).toBe(
        true,
      );
    },
  );

  test.each(
    CHECKED_CASES.map((serviceCase: ServiceCase) => {
      return [serviceCase.file];
    }),
  )(
    "%s refuses another project's record in every list and relation it writes, root writes included",
    async (file: string) => {
      const service: DatabaseService<DatabaseBaseModel> = loadService(file);
      const columns: Array<ProjectReferenceColumn> = checkedColumnsOf(service);

      if (columns.length === 0) {
        // Every relation it has is one it checks itself (see the service).
        expect(relationsCheckedBy(service).length).toBeGreaterThan(0);
        return;
      }

      let thrown: unknown = null;

      try {
        await callHook(service, "onBeforeCreate", {
          data: recordWith(service, payloadWith(columns, foreignIdFor)),
          props: { isRoot: true },
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ProjectScopedReferenceException);

      const message: string = (thrown as Error).message;

      expect(message).toContain(
        "references records that are not in this project",
      );

      columns.forEach((column: ProjectReferenceColumn, index: number) => {
        expect(message).toContain(
          `${column.modelName} "${foreignIdFor(index)}"`,
        );
      });
    },
  );

  test.each(
    CHECKED_CASES.map((serviceCase: ServiceCase) => {
      return [serviceCase.file];
    }),
  )("%s accepts its project's own records", async (file: string) => {
    const service: DatabaseService<DatabaseBaseModel> = loadService(file);
    const columns: Array<ProjectReferenceColumn> = checkedColumnsOf(service);

    await expect(
      ProjectReferenceCheck.validateCreate({
        service: service,
        createBy: {
          data: recordWith(service, payloadWith(columns, ownIdFor)),
          props: USER_PROPS,
        },
        relationsCheckedByService: relationsCheckedBy(service),
      }),
    ).resolves.toBeUndefined();
  });

  test.each(
    CHECKED_CASES.map((serviceCase: ServiceCase) => {
      return [serviceCase.file];
    }),
  )(
    "%s refuses another project's record an update adds",
    async (file: string) => {
      const service: DatabaseService<DatabaseBaseModel> = loadService(file);
      const columns: Array<ProjectReferenceColumn> = checkedColumnsOf(service);

      if (columns.length === 0) {
        return;
      }

      // The record holds nothing yet.
      jest.spyOn(service, "findBy").mockResolvedValue([] as never);

      /*
       * The read of the rows the caller's update may write, which the update
       * path makes before the hooks: what the read above answers.
       */
      stubRowsCallerMayWriteLikeFindBy(service, jest.spyOn(service, "findBy"));

      await expect(
        callHook(service, "onBeforeUpdate", {
          query: { _id: "0c1d2e3f-0000-4000-8000-0000000000a1" },
          data: payloadWith(columns, foreignIdFor),
          props: USER_PROPS,
          limit: 1,
          skip: 0,
        }),
      ).rejects.toBeInstanceOf(ProjectScopedReferenceException);
    },
  );
});
