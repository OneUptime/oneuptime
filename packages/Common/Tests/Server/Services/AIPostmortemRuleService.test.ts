import AIPostmortemRuleService from "../../../Server/Services/AIPostmortemRuleService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import AIPostmortemRule from "../../../Models/DatabaseModels/AIPostmortemRule";
import IncidentPostmortemTemplate from "../../../Models/DatabaseModels/IncidentPostmortemTemplate";
import {
  MAX_POSTMORTEM_RULE_TEMPLATES,
  POSTMORTEM_RULE_TOO_MANY_TEMPLATES_MESSAGE,
} from "../../../Types/AI/PostmortemRuleTemplates";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import {
  ProjectDirectoryStub,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";

/*
 * AIPostmortemRuleService: a postmortem rule names at most
 * MAX_POSTMORTEM_RULE_TEMPLATES templates - a draft whose rule names several
 * lists them all for OneUptime AI to pick from - and every template,
 * monitor, severity and label it names must be its project's own. The
 * count needs no lookup, so it is refused before any reference is read; an
 * edit that leaves the templates alone is not judged on them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const templateIds: (count: number) => Array<string> = (
  count: number,
): Array<string> => {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `80000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  });
};

const templates: (ids: Array<string>) => Array<IncidentPostmortemTemplate> = (
  ids: Array<string>,
): Array<IncidentPostmortemTemplate> => {
  return ids.map((id: string): IncidentPostmortemTemplate => {
    const template: IncidentPostmortemTemplate =
      new IncidentPostmortemTemplate();
    template._id = id;
    return template;
  });
};

interface RuleHookAccess {
  onBeforeCreate(
    createBy: CreateBy<AIPostmortemRule>,
  ): Promise<OnCreate<AIPostmortemRule>>;
  onBeforeUpdate(
    updateBy: UpdateBy<AIPostmortemRule>,
  ): Promise<OnUpdate<AIPostmortemRule>>;
}

const hooks: RuleHookAccess =
  AIPostmortemRuleService as unknown as RuleHookAccess;

async function createError(
  values: Partial<AIPostmortemRule>,
): Promise<unknown> {
  try {
    await hooks.onBeforeCreate({
      data: Object.assign(new AIPostmortemRule(), {
        name: "Draft with Database outage",
        projectId: PROJECT_ID,
        ...values,
      }),
      props: { tenantId: PROJECT_ID },
    } as unknown as CreateBy<AIPostmortemRule>);
    return null;
  } catch (error) {
    return error;
  }
}

async function updateError(data: Record<string, unknown>): Promise<unknown> {
  const rule: AIPostmortemRule = Object.assign(new AIPostmortemRule(), {
    _id: ObjectID.generate().toString(),
    projectId: PROJECT_ID,
  });

  jest.spyOn(AIPostmortemRuleService, "findBy").mockResolvedValue([rule]);

  try {
    await hooks.onBeforeUpdate({
      query: { _id: rule._id },
      data,
      props: { tenantId: PROJECT_ID },
    } as unknown as UpdateBy<AIPostmortemRule>);
    return null;
  } catch (error) {
    return error;
  }
}

let directory: ProjectDirectoryStub;

beforeEach(() => {
  stubRowsCallerMayWriteLikeFindBy(
    AIPostmortemRuleService,
    jest.spyOn(AIPostmortemRuleService, "findBy"),
  );
  directory = stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AIPostmortemRuleService", () => {
  it("checks every record it writes against the project", () => {
    expect(AIPostmortemRuleService).toBeInstanceOf(ProjectReferencesService);
  });

  describe("on create", () => {
    it("accepts a rule with no template: it drafts in the standard outline", async () => {
      expect(await createError({})).toBeNull();
    });

    it.each([1, 2, MAX_POSTMORTEM_RULE_TEMPLATES])(
      "accepts a rule naming %i templates",
      async (count: number) => {
        expect(
          await createError({
            postmortemTemplates: templates(templateIds(count)),
          }),
        ).toBeNull();
      },
    );

    it("checks the templates it names against the project", async () => {
      await createError({ postmortemTemplates: templates(templateIds(2)) });

      const lookup: ProjectDirectoryStub["recordLookups"][number] | undefined =
        directory.recordLookups.find(
          (entry: ProjectDirectoryStub["recordLookups"][number]): boolean => {
            return entry.model === "IncidentPostmortemTemplate";
          },
        );

      expect(lookup?.projectId).toBe(PROJECT_ID.toString());
      expect([...(lookup?.ids || [])].sort()).toEqual(templateIds(2).sort());
    });

    it("refuses a template of another project, as one that does not exist", async () => {
      jest.restoreAllMocks();
      stubRowsCallerMayWriteLikeFindBy(
        AIPostmortemRuleService,
        jest.spyOn(AIPostmortemRuleService, "findBy"),
      );
      stubProjectDirectory({
        projectId: PROJECT_ID,
        records: { IncidentPostmortemTemplate: templateIds(1) },
      });

      const foreign: string = "99999999-9999-4999-8999-999999999999";
      const error: unknown = await createError({
        postmortemTemplates: templates([...templateIds(1), foreign]),
      });

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(foreign);
    });

    it(`refuses a rule naming more than ${MAX_POSTMORTEM_RULE_TEMPLATES} templates, before anything is looked up`, async () => {
      const error: unknown = await createError({
        postmortemTemplates: templates(
          templateIds(MAX_POSTMORTEM_RULE_TEMPLATES + 1),
        ),
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe(
        POSTMORTEM_RULE_TOO_MANY_TEMPLATES_MESSAGE,
      );
      expect(directory.recordLookups).toEqual([]);
    });

    it("counts a template named twice once", async () => {
      const ids: Array<string> = templateIds(MAX_POSTMORTEM_RULE_TEMPLATES);

      expect(
        await createError({
          postmortemTemplates: templates([...ids, ...ids]),
        }),
      ).toBeNull();
    });

    it("refuses whoever writes it - root and the API alike", async () => {
      let error: unknown = null;

      try {
        await hooks.onBeforeCreate({
          data: Object.assign(new AIPostmortemRule(), {
            name: "Too many",
            projectId: PROJECT_ID,
            postmortemTemplates: templates(
              templateIds(MAX_POSTMORTEM_RULE_TEMPLATES + 1),
            ),
          }),
          props: { isRoot: true },
        } as unknown as CreateBy<AIPostmortemRule>);
      } catch (caught) {
        error = caught;
      }

      expect((error as Error).message).toBe(
        POSTMORTEM_RULE_TOO_MANY_TEMPLATES_MESSAGE,
      );
    });
  });

  describe("on update", () => {
    it("does not judge an edit that leaves the templates alone", async () => {
      expect(
        await updateError({ name: "Renamed", isEnabled: false, order: 2 }),
      ).toBeNull();
    });

    it("accepts new templates up to the most", async () => {
      expect(
        await updateError({
          postmortemTemplates: templateIds(MAX_POSTMORTEM_RULE_TEMPLATES).map(
            (id: string) => {
              return { _id: id };
            },
          ),
        }),
      ).toBeNull();
    });

    it("accepts emptying them: the rule drafts in the standard outline again", async () => {
      expect(await updateError({ postmortemTemplates: [] })).toBeNull();
    });

    it("refuses one more than the most", async () => {
      const error: unknown = await updateError({
        postmortemTemplates: templateIds(MAX_POSTMORTEM_RULE_TEMPLATES + 1),
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe(
        POSTMORTEM_RULE_TOO_MANY_TEMPLATES_MESSAGE,
      );
    });
  });
});
