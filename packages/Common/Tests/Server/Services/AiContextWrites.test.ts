import AutoRemediationRuleService, {
  Service as AutoRemediationRuleServiceClass,
} from "../../../Server/Services/AutoRemediationRuleService";
import ProjectService from "../../../Server/Services/ProjectService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import {
  AI_CONTEXT_COLUMN,
  AI_RULE_AI_CONTEXT_MAX_CHARACTERS,
  PROJECT_AI_CONTEXT_MAX_CHARACTERS,
} from "../../../Types/AI/AiContext";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";

/*
 * WHO MAY WRITE THE AI CONTEXT, AND HOW MUCH (issue #5198): "Admin-only to
 * edit, with a size limit". A project's is a Project Owner's or a Project
 * Admin's to write - as the project's other AI settings are - and readable
 * by those who can see the project's settings, never by everyone with a
 * place in the project; an AI rule's is whoever may edit the rule's. Each
 * is held to its limit on every write, refused - never cut - with the
 * count, by the API, Terraform and the Dashboard alike.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function permissionRow(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission: false,
  };
}

function propsWith(...permissions: Array<Permission>): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map(permissionRow),
  };

  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  } as DatabaseCommonInteractionProps;
}

// Whether a caller holding these may write the column on this model.
function mayWrite(
  modelType: { new (): BaseModel },
  data: Record<string, unknown>,
  requestType: DatabaseRequestType,
  ...permissions: Array<Permission>
): boolean {
  const props: DatabaseCommonInteractionProps = propsWith(...permissions);

  try {
    TablePermission.checkTableLevelPermissions(modelType, props, requestType);
    ColumnPermissions.checkDataColumnPermissions(
      modelType,
      data as unknown as BaseModel,
      props,
      requestType,
    );
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Project.aiContext: the column", () => {
  const project: Project = new Project();

  it("is Markdown, optional, titled for the API reference", () => {
    const metadata: { type: TableColumnType; required?: boolean; title?: string; description?: string } =
      project.getTableColumnMetadata(AI_CONTEXT_COLUMN) as unknown as {
        type: TableColumnType;
        required?: boolean;
        title?: string;
        description?: string;
      };

    expect(metadata.type).toBe(TableColumnType.Markdown);
    expect(metadata.required).toBe(false);
    expect(metadata.title).toBe("AI Context");
    expect(metadata.description!.length).toBeLessThanOrEqual(150);
    expect(metadata.description).toContain("20,000 characters");
  });

  it("a Project Owner or Project Admin writes it, and no one else", () => {
    expect(project.getColumnAccessControlFor(AI_CONTEXT_COLUMN)?.update).toEqual(
      [Permission.ProjectOwner, Permission.ProjectAdmin],
    );
    // Nobody names it on a new project: it is written in settings.
    expect(project.getColumnAccessControlFor(AI_CONTEXT_COLUMN)?.create).toEqual(
      [],
    );
  });

  it("those who see the project's settings read it - not everyone with a place in the project", () => {
    const read: Array<Permission> =
      project.getColumnAccessControlFor(AI_CONTEXT_COLUMN)?.read || [];

    expect(read).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
    ]);

    for (const notAllowed of [
      Permission.ProjectUser,
      Permission.UnAuthorizedSsoUser,
      Permission.BillingAdmin,
      Permission.BillingMember,
      Permission.BillingViewer,
    ]) {
      expect(read).not.toContain(notAllowed);
    }
  });

  it.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "the column layer lets %s write it",
    (permission: Permission) => {
      expect(
        mayWrite(
          Project,
          { aiContext: "## Services" },
          DatabaseRequestType.Update,
          permission,
        ),
      ).toBe(true);
    },
  );

  it.each([
    Permission.ProjectMember,
    Permission.EditProject,
    Permission.ManageProjectBilling,
    Permission.BillingAdmin,
    Permission.Viewer,
  ])("and refuses %s", (permission: Permission) => {
    expect(
      mayWrite(
        Project,
        { aiContext: "## Services" },
        DatabaseRequestType.Update,
        permission,
      ),
    ).toBe(false);
  });
});

describe("AutoRemediationRule.aiContext: the column", () => {
  const rule: AutoRemediationRule = new AutoRemediationRule();

  it("is Markdown, optional, titled for the API reference", () => {
    const metadata: { type: TableColumnType; required?: boolean; title?: string; description?: string } =
      rule.getTableColumnMetadata(AI_CONTEXT_COLUMN) as unknown as {
        type: TableColumnType;
        required?: boolean;
        title?: string;
        description?: string;
      };

    expect(metadata.type).toBe(TableColumnType.Markdown);
    expect(metadata.required).toBe(false);
    expect(metadata.title).toBe("AI Context");
    expect(metadata.description!.length).toBeLessThanOrEqual(150);
    expect(metadata.description).toContain("5,000 characters");
  });

  it("whoever may write the rule's LLM provider may write its notes: the rule's own permissions", () => {
    expect(rule.getColumnAccessControlFor(AI_CONTEXT_COLUMN)).toEqual(
      rule.getColumnAccessControlFor("llmProviderId"),
    );
    expect(rule.getColumnAccessControlFor(AI_CONTEXT_COLUMN)?.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ]);
  });

  it("a custom role that may edit AI rules writes it; a member who may not, does not", () => {
    expect(
      mayWrite(
        AutoRemediationRule,
        { aiContext: "Checkout notes" },
        DatabaseRequestType.Update,
        Permission.EditAutoRemediationRule,
      ),
    ).toBe(true);
    expect(
      mayWrite(
        AutoRemediationRule,
        { aiContext: "Checkout notes" },
        DatabaseRequestType.Update,
        Permission.ProjectMember,
      ),
    ).toBe(false);
  });
});

describe("ProjectService.applyAiContextRules: how much a project may write", () => {
  it("up to 20,000 characters is saved as written", () => {
    const data: { aiContext?: unknown } = {
      aiContext: "a".repeat(PROJECT_AI_CONTEXT_MAX_CHARACTERS),
    };

    ProjectService.applyAiContextRules(data);

    expect(data.aiContext).toBe("a".repeat(PROJECT_AI_CONTEXT_MAX_CHARACTERS));
  });

  it("one more is refused, with the count", () => {
    expect(() => {
      ProjectService.applyAiContextRules({
        aiContext: "a".repeat(PROJECT_AI_CONTEXT_MAX_CHARACTERS + 1),
      });
    }).toThrow(
      new BadDataException(
        "The project's AI context can hold at most 20,000 characters. This one has 20,001.",
      ),
    );
  });

  it("a blank one is stored as none: clearing the field clears the notes", () => {
    const data: { aiContext?: unknown } = { aiContext: "  \n  " };

    ProjectService.applyAiContextRules(data);

    expect(data.aiContext).toBeNull();
  });

  it("a write that leaves it alone is not judged on it", () => {
    const data: { aiContext?: unknown } = {};

    expect(() => {
      ProjectService.applyAiContextRules(data);
    }).not.toThrow();
    expect(data).toEqual({});
  });

  it("anything but text is refused", () => {
    expect(() => {
      ProjectService.applyAiContextRules({ aiContext: { text: "x" } });
    }).toThrow("The AI context must be text.");
  });

  it("runs on every update of the project, before anything is read", async () => {
    const hooks: {
      onBeforeUpdate(updateBy: UpdateBy<Project>): Promise<OnUpdate<Project>>;
    } = ProjectService as unknown as {
      onBeforeUpdate(updateBy: UpdateBy<Project>): Promise<OnUpdate<Project>>;
    };
    const find: SpyInstance<typeof ProjectService.findBy> = jest.spyOn(
      ProjectService,
      "findBy",
    );

    await expect(
      hooks.onBeforeUpdate({
        query: { _id: PROJECT_ID.toString() },
        data: {
          aiContext: "a".repeat(PROJECT_AI_CONTEXT_MAX_CHARACTERS + 1),
        },
        props: { isRoot: true },
      } as unknown as UpdateBy<Project>),
    ).rejects.toThrow("can hold at most 20,000 characters");
    expect(find).not.toHaveBeenCalled();
  });
});

describe("AutoRemediationRuleService: how much an AI rule may hold", () => {
  interface RuleHookAccess {
    onBeforeCreate(
      createBy: CreateBy<AutoRemediationRule>,
    ): Promise<OnCreate<AutoRemediationRule>>;
    onBeforeUpdate(
      updateBy: UpdateBy<AutoRemediationRule>,
    ): Promise<OnUpdate<AutoRemediationRule>>;
  }

  const hooks: RuleHookAccess =
    AutoRemediationRuleService as unknown as RuleHookAccess;

  let findBy: SpyInstance<typeof AutoRemediationRuleService.findBy>;

  beforeEach(() => {
    findBy = jest.spyOn(AutoRemediationRuleService, "findBy");
    stubRowsCallerMayWriteLikeFindBy(AutoRemediationRuleService, findBy);
    findBy.mockResolvedValue([]);
    stubProjectDirectory({});
  });

  async function createError(aiContext: unknown): Promise<unknown> {
    try {
      await hooks.onBeforeCreate({
        data: Object.assign(new AutoRemediationRule(), {
          name: "Checkout",
          projectId: PROJECT_ID,
          triggerEntityType: AutoRemediationTriggerEntity.Incident,
          investigates: true,
          fixes: false,
          aiContext,
        }),
        props: { tenantId: PROJECT_ID },
      } as unknown as CreateBy<AutoRemediationRule>);
      return null;
    } catch (error) {
      return error;
    }
  }

  async function updateError(aiContext: unknown): Promise<unknown> {
    try {
      await hooks.onBeforeUpdate({
        query: { _id: ObjectID.generate().toString() },
        data: { aiContext },
        props: { tenantId: PROJECT_ID },
      } as unknown as UpdateBy<AutoRemediationRule>);
      return null;
    } catch (error) {
      return error;
    }
  }

  it("a new rule with up to 5,000 characters of notes is saved", async () => {
    expect(
      await createError("a".repeat(AI_RULE_AI_CONTEXT_MAX_CHARACTERS)),
    ).toBeNull();
    expect(await createError(undefined)).toBeNull();
  });

  it("a new rule with one more is refused, with the count", async () => {
    const error: unknown = await createError(
      "a".repeat(AI_RULE_AI_CONTEXT_MAX_CHARACTERS + 1),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "An AI rule's AI context can hold at most 5,000 characters. This one has 5,001.",
    );
  });

  it("an edit of the notes is held to the same limit", async () => {
    expect(
      ((await updateError(
        "a".repeat(AI_RULE_AI_CONTEXT_MAX_CHARACTERS + 1),
      )) as Error).message,
    ).toContain("can hold at most 5,000 characters");
    expect(await updateError("Checkout runs on k8s.")).toBeNull();
    expect(await updateError(null)).toBeNull();
  });

  it("anything but text is refused", async () => {
    expect(((await updateError(42)) as Error).message).toBe(
      "The AI context must be text.",
    );
  });

  it("assertNewRuleFits holds the notes too: every path that creates a rule", () => {
    expect(() => {
      AutoRemediationRuleServiceClass.assertNewRuleFits(
        Object.assign(new AutoRemediationRule(), {
          triggerEntityType: AutoRemediationTriggerEntity.Alert,
          investigates: true,
          aiContext: "a".repeat(AI_RULE_AI_CONTEXT_MAX_CHARACTERS + 1),
        }),
      );
    }).toThrow("can hold at most 5,000 characters");
  });
});
