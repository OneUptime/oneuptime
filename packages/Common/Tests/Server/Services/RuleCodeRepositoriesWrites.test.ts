import AutoRemediationRuleService from "../../../Server/Services/AutoRemediationRuleService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectReferenceCheck, {
  ProjectReferenceColumn,
} from "../../../Server/Utils/Database/ProjectReferenceCheck";
import { ProjectScopedReferenceException } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  MAX_CODE_REPOSITORIES_PER_RULE,
  RULE_TOO_MANY_CODE_REPOSITORIES_MESSAGE,
} from "../../../Types/CodeRepository/CodeRepositoryAllowance";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  ProjectDirectoryStub,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The code repositories an AI rule names (investigation rules and auto
 * remediation rules are one AI rule now): only the project's own - another
 * project's is refused with the same words as an id that matches nothing,
 * through the rule service's real hooks - and at most
 * MAX_CODE_REPOSITORIES_PER_RULE, refused before any repository is looked
 * up (more than that means all of them: leave the list empty). An edit that
 * leaves the list alone is not judged on it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);
const OWN_REPOSITORY: string = "c1111111-1111-4111-8111-111111111111";
const FOREIGN_REPOSITORY: string = "f2222222-2222-4222-8222-222222222222";

type HookFunction = (input: unknown) => Promise<unknown>;

const SERVICES: Array<[string, DatabaseService<DatabaseBaseModel>]> = [
  [
    "AutoRemediationRuleService",
    AutoRemediationRuleService as unknown as DatabaseService<DatabaseBaseModel>,
  ],
];

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

function ruleWith(
  service: DatabaseService<DatabaseBaseModel>,
  codeRepositories: Array<string>,
): DatabaseBaseModel {
  const rule: DatabaseBaseModel = new service.modelType();
  rule.setColumnValue("projectId", PROJECT_ID);
  Object.assign(rule, {
    name: "Checkout",
    triggerEntityType: AutoRemediationTriggerEntity.Incident,
    codeRepositories: codeRepositories.map((id: string) => {
      return { _id: id };
    }),
  });
  return rule;
}

// Ids no project has: only their number matters to the limit.
function manyRepositories(count: number): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `c0c0c0c0-0000-4000-8000-${index.toString().padStart(12, "0")}`;
  });
}

function stubDirectory(): ProjectDirectoryStub {
  return stubProjectDirectory({
    projectId: PROJECT_ID,
    records: { CodeRepository: [OWN_REPOSITORY] },
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(SERVICES)(
  "%s and the code repositories a rule names",
  (_name: string, service: DatabaseService<DatabaseBaseModel>) => {
    test("the list is one the project check covers, by its own title", () => {
      const column: ProjectReferenceColumn | undefined =
        ProjectReferenceCheck.getCheckedColumns(service.getModel(), []).find(
          (candidate: ProjectReferenceColumn): boolean => {
            return candidate.column === "codeRepositories";
          },
        );

      expect(column?.isList).toBe(true);
      expect(column?.service.getModel().tableName).toBe("CodeRepository");
    });

    test("another project's repository is refused, named only by its id", async () => {
      stubDirectory();
      let thrown: unknown = null;

      try {
        await callHook(service, "onBeforeCreate", {
          data: ruleWith(service, [OWN_REPOSITORY, FOREIGN_REPOSITORY]),
          props: { isRoot: true },
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ProjectScopedReferenceException);
      expect((thrown as Error).message).toContain(FOREIGN_REPOSITORY);
      expect((thrown as Error).message).not.toContain(OWN_REPOSITORY);
    });

    test("the project's own repositories are accepted", async () => {
      stubDirectory();

      await expect(
        ProjectReferenceCheck.validateCreate({
          service: service,
          createBy: {
            data: ruleWith(service, [OWN_REPOSITORY]),
            props: {
              tenantId: PROJECT_ID,
              userId: new ObjectID("05e40000-0000-4000-8000-000000000001"),
            },
          },
          relationsCheckedByService: [],
        }),
      ).resolves.toBeUndefined();
    });

    test(`more than ${MAX_CODE_REPOSITORIES_PER_RULE} is refused before any repository is looked up`, async () => {
      const directory: ProjectDirectoryStub = stubDirectory();

      await expect(
        callHook(service, "onBeforeCreate", {
          data: ruleWith(
            service,
            manyRepositories(MAX_CODE_REPOSITORIES_PER_RULE + 1),
          ),
          props: { isRoot: true },
        }),
      ).rejects.toThrow(
        new BadDataException(RULE_TOO_MANY_CODE_REPOSITORIES_MESSAGE),
      );
      expect(directory.recordLookups).toEqual([]);
      expect(RULE_TOO_MANY_CODE_REPOSITORIES_MESSAGE).toBe(
        "A rule can name at most 100 code repositories. Leave the list empty to let OneUptime AI use all of them.",
      );
    });

    test("an edit that names too many is refused the same way; one that leaves the list alone is not judged on it", async () => {
      stubDirectory();
      jest.spyOn(service, "findBy").mockResolvedValue([] as never);
      stubRowsCallerMayWriteLikeFindBy(service, jest.spyOn(service, "findBy"));

      await expect(
        callHook(service, "onBeforeUpdate", {
          query: { _id: "0c1d2e3f-0000-4000-8000-0000000000a1" },
          data: {
            codeRepositories: manyRepositories(
              MAX_CODE_REPOSITORIES_PER_RULE + 1,
            ).map((id: string) => {
              return { _id: id };
            }),
          },
          props: { isRoot: true },
          limit: 1,
          skip: 0,
        }),
      ).rejects.toThrow(RULE_TOO_MANY_CODE_REPOSITORIES_MESSAGE);

      await expect(
        callHook(service, "onBeforeUpdate", {
          query: { _id: "0c1d2e3f-0000-4000-8000-0000000000a1" },
          data: { name: "Renamed" },
          props: { isRoot: true },
          limit: 1,
          skip: 0,
        }),
      ).resolves.toBeDefined();
    });
  },
);
