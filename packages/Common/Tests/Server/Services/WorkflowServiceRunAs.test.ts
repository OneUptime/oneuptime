import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import CustomRolePermissionService from "../../../Server/Services/CustomRolePermissionService";
import CustomRoleService from "../../../Server/Services/CustomRoleService";
import WorkflowLabelRuleEngineService from "../../../Server/Services/WorkflowLabelRuleEngineService";
import WorkflowOwnerRuleEngineService from "../../../Server/Services/WorkflowOwnerRuleEngineService";
import WorkflowService, {
  Service as WorkflowServiceClass,
} from "../../../Server/Services/WorkflowService";
import WorkflowVersionService from "../../../Server/Services/WorkflowVersionService";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  WORKFLOW_RUN_AS_OWNER_REFUSED_MESSAGE,
  WORKFLOW_RUN_AS_PERSON_ONLY_MESSAGE,
  WORKFLOW_RUN_AS_UNKNOWN_MESSAGE,
  WorkflowRunAs,
} from "../../../Types/Workflow/WorkflowRunAs";
import API from "../../../Utils/API";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHO MAY GIVE A WORKFLOW ITS PERMISSIONS, AND WHO MAY CHANGE ONE THAT HAS
 * THEM (#9695), through the whole create, update and delete of a workflow -
 * its hooks and permission checks - as the people and keys who make them,
 * the way the dashboard, an import, Terraform and the API do. The table is
 * held in memory (InMemoryRepository); everything else is the real
 * WorkflowService.
 *
 *   - Anyone who may create or edit a workflow sets it to Default, as ever.
 *   - Raised permissions are given only by a person who holds them, and
 *     they are recorded as the giver; who and when is never a request's.
 *   - A raised workflow is changed, archived and deleted only by such a
 *     person, who becomes its giver when they save its steps or its Run As;
 *     anyone who may edit it may still turn it off.
 *   - A raised workflow names no global variable.
 *   - Its trigger keys are read only by who may change it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "97950000-0000-4000-8000-000000000001",
);
const DEFAULT_WORKFLOW_ID: string = "97950000-0000-4000-8000-0000000000f1";
const OWNER_WORKFLOW_ID: string = "97950000-0000-4000-8000-0000000000f2";
const ROLE_WORKFLOW_ID: string = "97950000-0000-4000-8000-0000000000f3";
const SECOND_DEFAULT_WORKFLOW_ID: string =
  "97950000-0000-4000-8000-0000000000f4";
const ROLE_ID: ObjectID = new ObjectID("97950000-0000-4000-8000-0000000000c1");
const FIRST_GIVER_ID: string = "97950000-0000-4000-8000-0000000000a1";

const GRAPH: JSONObject = {
  nodes: [
    {
      id: "card-manual",
      position: { x: 96, y: 32 },
      data: {
        id: "manual-1",
        metadataId: "manual",
        componentType: "Trigger",
        nodeType: "Node",
        arguments: {},
      },
    },
  ],
  edges: [],
};

// A graph whose step names the project's global variable TEAM_ID.
const GRAPH_WITH_GLOBAL_VARIABLE: JSONObject = {
  nodes: [
    ...(GRAPH["nodes"] as Array<JSONObject>),
    {
      id: "card-give",
      position: { x: 96, y: 200 },
      data: {
        id: "team-custom-role-create-one-1",
        metadataId: "team-custom-role-create-one",
        componentType: "Component",
        nodeType: "Node",
        arguments: {
          json: '{"teamId":"{{global.variables.TEAM_ID}}"}',
        },
      },
    },
  ],
  edges: [],
};

function rows(permissions: Array<Permission>): Array<UserPermission> {
  return permissions.map((permission: Permission): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: false,
    };
  });
}

// A person of the project holding `permissions`.
function member(
  permissions: Array<Permission>,
  userId: ObjectID = ObjectID.generate(),
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: userId,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows(permissions),
      },
    },
  };
}

// An API key of the project holding `permissions`.
function apiKey(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userType: UserType.API,
    apiKeyId: ObjectID.generate(),
    apiKeyName: "Terraform",
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows(permissions),
      },
    },
  };
}

const OWNER: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return member([Permission.ProjectOwner]);
  };

const ADMIN: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return member([Permission.ProjectAdmin]);
  };

const WORKFLOW_ADMIN: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return member([Permission.WorkflowAdmin]);
  };

// The project's custom role ROLE_ID, holding Incident Admin.
function givenRole(): void {
  const role: CustomRole = new CustomRole(ROLE_ID);
  role.name = "Incident Automation";
  role.projectId = PROJECT_ID;

  getJestSpyOn(CustomRoleService, "findOneBy").mockResolvedValue(role);

  const permission: CustomRolePermission = new CustomRolePermission();
  permission.permission = Permission.IncidentAdmin;
  permission.scope = PermissionScope.All;
  permission.labels = [];

  getJestSpyOn(
    CustomRolePermissionService,
    "findPermissionsOfRole",
  ).mockResolvedValue([permission]);
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }

  throw new Error("It was not refused.");
}

describe("what a workflow runs as, through its writes", () => {
  let workflows: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    stubProjectDirectory({});

    getJestSpyOn(API, "post").mockResolvedValue({});
    getJestSpyOn(
      WorkflowLabelRuleEngineService,
      "applyRulesToWorkflow",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      WorkflowOwnerRuleEngineService,
      "applyRulesToWorkflow",
    ).mockResolvedValue(undefined);
    getJestSpyOn(WorkflowService, "insertCreatorAsOwner").mockResolvedValue(
      undefined,
    );
    for (const method of [
      "recordCreated",
      "recordEarlierVersionIfNone",
      "recordGraphSave",
    ]) {
      getJestSpyOn(WorkflowVersionService, method).mockResolvedValue(undefined);
    }

    getJestSpyOn(
      WorkflowService,
      "updateColumnsByIdWithoutHooks",
    ).mockImplementation(
      async (write: { id: ObjectID; data: StoredRow }): Promise<void> => {
        Object.assign(workflows.get(write.id) || {}, write.data);
      },
    );

    const base: StoredRow = {
      projectId: PROJECT_ID.toString(),
      isEnabled: true,
      isArchived: false,
      graph: GRAPH,
      graphRevision: 1,
      webhookSecretKey: "the-webhook-key",
      version: 1,
    };

    workflows = useInMemoryTable(WorkflowService, [
      {
        ...base,
        _id: DEFAULT_WORKFLOW_ID,
        name: "Close stale incidents",
        slug: "close-stale-incidents",
        runAs: WorkflowRunAs.Default,
      },
      {
        ...base,
        _id: SECOND_DEFAULT_WORKFLOW_ID,
        name: "Post to Slack",
        slug: "post-to-slack",
        runAs: WorkflowRunAs.Default,
      },
      {
        ...base,
        _id: OWNER_WORKFLOW_ID,
        name: "Give new teams their role",
        slug: "give-new-teams-their-role",
        runAs: WorkflowRunAs.ProjectOwner,
        runAsGivenByUserId: FIRST_GIVER_ID,
        runAsGivenAt: new Date("2026-11-01T10:00:00.000Z"),
      },
      {
        ...base,
        _id: ROLE_WORKFLOW_ID,
        name: "Escalate incidents",
        slug: "escalate-incidents",
        runAs: WorkflowRunAs.CustomRole,
        runAsCustomRoleId: ROLE_ID.toString(),
        runAsGivenByUserId: FIRST_GIVER_ID,
        runAsGivenAt: new Date("2026-11-01T10:00:00.000Z"),
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stored(id: string, column: string): unknown {
    return workflows.get(id)?.[column];
  }

  async function create(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<StoredRow> {
    const workflow: Workflow = new Workflow();
    workflow.projectId = PROJECT_ID;
    workflow.name = `Imported ${ObjectID.generate().toString()}`;
    Object.assign(workflow, data);

    const created: Workflow = await WorkflowService.create({
      data: workflow,
      props: props,
    });

    const inserted: StoredRow | undefined = workflows.inserts.find(
      (row: StoredRow): boolean => {
        return String(row["_id"]) === created.id?.toString();
      },
    );

    if (!inserted) {
      throw new Error("The workflow was not inserted.");
    }

    return inserted;
  }

  async function update(
    id: string,
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    await WorkflowService.updateOneById({
      id: new ObjectID(id),
      data: data as never,
      props: props,
    });
  }

  describe("creating a workflow", () => {
    test("anyone who may create one creates it as Default, as before, naming no giver", async () => {
      for (const props of [
        member([Permission.ProjectMember]),
        member([Permission.CreateWorkflow, Permission.ReadWorkflow]),
        WORKFLOW_ADMIN(),
        apiKey([Permission.WorkflowAdmin]),
      ]) {
        const inserted: StoredRow = await create({}, props);

        expect(inserted["runAs"] ?? WorkflowRunAs.Default).toBe(
          WorkflowRunAs.Default,
        );
        expect(inserted["runAsGivenByUserId"]).toBeUndefined();
        expect(inserted["runAsGivenAt"]).toBeUndefined();
      }
    });

    test("a Project Owner creates one that runs as Project Owner, and is recorded as having given it", async () => {
      const owner: DatabaseCommonInteractionProps = OWNER();
      const inserted: StoredRow = await create(
        { runAs: WorkflowRunAs.ProjectOwner },
        owner,
      );

      expect(inserted["runAs"]).toBe(WorkflowRunAs.ProjectOwner);
      expect(String(inserted["runAsGivenByUserId"]).toLowerCase()).toBe(
        owner.userId!.toString().toLowerCase(),
      );
      expect(inserted["runAsGivenAt"]).toBeInstanceOf(Date);
    });

    test("a Project Admin, a Workflow Admin and a project member may not: the import is refused and nothing is saved", async () => {
      for (const props of [
        ADMIN(),
        WORKFLOW_ADMIN(),
        member([Permission.ProjectMember]),
      ]) {
        const error: Error = await refusal(
          create({ runAs: WorkflowRunAs.ProjectOwner }, props),
        );

        expect(error.message).toBe(WORKFLOW_RUN_AS_OWNER_REFUSED_MESSAGE);
      }

      expect(workflows.inserts).toEqual([]);
    });

    test("an API key holding Project Owner may not: only a person gives a workflow raised permissions", async () => {
      const error: Error = await refusal(
        create(
          { runAs: WorkflowRunAs.ProjectOwner },
          apiKey([Permission.ProjectOwner]),
        ),
      );

      expect(error.message).toBe(WORKFLOW_RUN_AS_PERSON_ONLY_MESSAGE);
      expect(workflows.inserts).toEqual([]);
    });

    test("who gave it is never the request's to say: another person's id is replaced, or dropped for Default", async () => {
      const owner: DatabaseCommonInteractionProps = OWNER();
      const someoneElse: string = ObjectID.generate().toString();

      const raised: StoredRow = await create(
        {
          runAs: WorkflowRunAs.ProjectOwner,
          runAsGivenByUserId: new ObjectID(someoneElse),
          runAsGivenAt: new Date("2020-01-01T00:00:00.000Z"),
        },
        owner,
      );

      expect(String(raised["runAsGivenByUserId"]).toLowerCase()).toBe(
        owner.userId!.toString().toLowerCase(),
      );
      expect((raised["runAsGivenAt"] as Date).getFullYear()).toBeGreaterThan(
        2020,
      );

      const plain: StoredRow = await create(
        {
          runAsGivenByUserId: new ObjectID(someoneElse),
          runAsGivenAt: new Date("2020-01-01T00:00:00.000Z"),
        },
        member([Permission.ProjectMember]),
      );

      expect(plain["runAsGivenByUserId"]).toBeUndefined();
      expect(plain["runAsGivenAt"]).toBeUndefined();
    });

    test("one that runs as Project Owner and names a global variable is refused, naming it", async () => {
      const error: Error = await refusal(
        create(
          {
            runAs: WorkflowRunAs.ProjectOwner,
            graph: GRAPH_WITH_GLOBAL_VARIABLE,
          },
          OWNER(),
        ),
      );

      expect(error.message).toContain("{{global.variables.TEAM_ID}}");
      expect(workflows.inserts).toEqual([]);
    });

    test("a Run As that is none of the values is refused", async () => {
      const error: Error = await refusal(
        create({ runAs: "ProjectAdmin" }, OWNER()),
      );

      expect(error.message).toBe(WORKFLOW_RUN_AS_UNKNOWN_MESSAGE);
    });

    test("a custom role is given by who holds what it gives, and a role beside any other Run As is dropped", async () => {
      givenRole();

      const holder: DatabaseCommonInteractionProps = member([
        Permission.IncidentAdmin,
        Permission.CreateWorkflow,
        Permission.ReadWorkflow,
      ]);
      const inserted: StoredRow = await create(
        { runAs: WorkflowRunAs.CustomRole, runAsCustomRoleId: ROLE_ID },
        holder,
      );

      expect(inserted["runAs"]).toBe(WorkflowRunAs.CustomRole);
      expect(String(inserted["runAsCustomRoleId"]).toLowerCase()).toBe(
        ROLE_ID.toString().toLowerCase(),
      );
      expect(String(inserted["runAsGivenByUserId"]).toLowerCase()).toBe(
        holder.userId!.toString().toLowerCase(),
      );

      const error: Error = await refusal(
        create(
          { runAs: WorkflowRunAs.CustomRole, runAsCustomRoleId: ROLE_ID },
          member([Permission.CreateWorkflow, Permission.ReadWorkflow]),
        ),
      );

      expect(error.message).toContain("the role has Incident Admin");

      const plain: StoredRow = await create(
        { runAs: WorkflowRunAs.Default, runAsCustomRoleId: ROLE_ID },
        member([Permission.ProjectMember]),
      );

      expect(plain["runAsCustomRoleId"]).toBeNull();
    });
  });

  describe("changing a workflow that runs as Default: as before", () => {
    test("its editors change its steps, name and switch, and nobody is recorded as a giver", async () => {
      await update(DEFAULT_WORKFLOW_ID, { graph: GRAPH }, WORKFLOW_ADMIN());
      await update(DEFAULT_WORKFLOW_ID, { name: "Renamed" }, WORKFLOW_ADMIN());
      await update(DEFAULT_WORKFLOW_ID, { isEnabled: false }, WORKFLOW_ADMIN());

      expect(stored(DEFAULT_WORKFLOW_ID, "name")).toBe("Renamed");
      expect(stored(DEFAULT_WORKFLOW_ID, "isEnabled")).toBe(false);
      expect(stored(DEFAULT_WORKFLOW_ID, "runAsGivenByUserId")).toBeUndefined();
    });

    test("a Project Owner raises it to Project Owner, and is recorded as the giver", async () => {
      const owner: DatabaseCommonInteractionProps = OWNER();

      await update(
        DEFAULT_WORKFLOW_ID,
        { runAs: WorkflowRunAs.ProjectOwner },
        owner,
      );

      expect(stored(DEFAULT_WORKFLOW_ID, "runAs")).toBe(
        WorkflowRunAs.ProjectOwner,
      );
      expect(
        String(stored(DEFAULT_WORKFLOW_ID, "runAsGivenByUserId")).toLowerCase(),
      ).toBe(owner.userId!.toString().toLowerCase());
    });

    test("a Project Admin or a Workflow Admin may not raise it", async () => {
      for (const props of [ADMIN(), WORKFLOW_ADMIN()]) {
        const error: Error = await refusal(
          update(
            DEFAULT_WORKFLOW_ID,
            { runAs: WorkflowRunAs.ProjectOwner },
            props,
          ),
        );

        expect(error.message).toBe(WORKFLOW_RUN_AS_OWNER_REFUSED_MESSAGE);
      }

      expect(stored(DEFAULT_WORKFLOW_ID, "runAs")).toBe(WorkflowRunAs.Default);
    });

    test("raising one whose steps name a global variable is refused", async () => {
      workflows.get(DEFAULT_WORKFLOW_ID)!["graph"] = GRAPH_WITH_GLOBAL_VARIABLE;

      const error: Error = await refusal(
        update(
          DEFAULT_WORKFLOW_ID,
          { runAs: WorkflowRunAs.ProjectOwner },
          OWNER(),
        ),
      );

      expect(error.message).toContain("{{global.variables.TEAM_ID}}");
      expect(stored(DEFAULT_WORKFLOW_ID, "runAs")).toBe(WorkflowRunAs.Default);
    });

    test("Run As is chosen one workflow at a time", async () => {
      const error: Error = await refusal(
        WorkflowService.updateBy({
          query: {
            projectId: PROJECT_ID,
            runAs: WorkflowRunAs.Default,
          },
          data: { runAs: WorkflowRunAs.ProjectOwner } as never,
          limit: 10,
          skip: 0,
          props: OWNER(),
        }),
      );

      expect(error.message).toBe(
        WorkflowServiceClass.RUN_AS_ONE_WORKFLOW_PROBLEM,
      );
    });
  });

  describe("changing a workflow that runs as Project Owner", () => {
    test("a Project Admin, a Workflow Admin and an editor may not change its steps, name, labels or Run As, nor archive it or turn it on", async () => {
      workflows.get(OWNER_WORKFLOW_ID)!["isEnabled"] = false;

      for (const props of [
        ADMIN(),
        WORKFLOW_ADMIN(),
        member([Permission.EditWorkflow, Permission.ReadWorkflow]),
      ]) {
        for (const data of [
          { graph: GRAPH_WITH_GLOBAL_VARIABLE },
          { graph: GRAPH },
          { name: "Mine now" },
          { description: "Nothing to see here" },
          { runAs: WorkflowRunAs.Default },
          { isArchived: true },
          { isEnabled: true },
        ]) {
          const error: Error = await refusal(
            update(OWNER_WORKFLOW_ID, data, props),
          );

          expect(error.message).toBe(
            "This workflow runs as Project Owner, so only Project Owners can change it. You can still turn it off.",
          );
        }
      }

      expect(stored(OWNER_WORKFLOW_ID, "name")).toBe(
        "Give new teams their role",
      );
      expect(stored(OWNER_WORKFLOW_ID, "runAs")).toBe(
        WorkflowRunAs.ProjectOwner,
      );
      expect(stored(OWNER_WORKFLOW_ID, "isArchived")).toBe(false);
      expect(stored(OWNER_WORKFLOW_ID, "isEnabled")).toBe(false);
      expect(
        String(stored(OWNER_WORKFLOW_ID, "runAsGivenByUserId")).toLowerCase(),
      ).toBe(FIRST_GIVER_ID);
    });

    test("anyone who may edit it may turn it off", async () => {
      await update(OWNER_WORKFLOW_ID, { isEnabled: false }, WORKFLOW_ADMIN());

      expect(stored(OWNER_WORKFLOW_ID, "isEnabled")).toBe(false);
      // Turning it off gives nothing: the giver stays.
      expect(
        String(stored(OWNER_WORKFLOW_ID, "runAsGivenByUserId")).toLowerCase(),
      ).toBe(FIRST_GIVER_ID);
    });

    test("an API key holding Project Owner may not change it: it is no person", async () => {
      const error: Error = await refusal(
        update(
          OWNER_WORKFLOW_ID,
          { graph: GRAPH },
          apiKey([Permission.ProjectOwner]),
        ),
      );

      expect(error.message).toContain(WORKFLOW_RUN_AS_PERSON_ONLY_MESSAGE);
    });

    test("another Project Owner who saves its steps gives it their permissions from then on", async () => {
      const secondOwner: DatabaseCommonInteractionProps = OWNER();

      await update(OWNER_WORKFLOW_ID, { graph: GRAPH }, secondOwner);

      expect(
        String(stored(OWNER_WORKFLOW_ID, "runAsGivenByUserId")).toLowerCase(),
      ).toBe(secondOwner.userId!.toString().toLowerCase());
      expect(
        (stored(OWNER_WORKFLOW_ID, "runAsGivenAt") as Date).toISOString(),
      ).not.toBe("2026-11-01T10:00:00.000Z");
    });

    test("a Project Owner who only renames it is no new giver", async () => {
      await update(OWNER_WORKFLOW_ID, { name: "Renamed" }, OWNER());

      expect(stored(OWNER_WORKFLOW_ID, "name")).toBe("Renamed");
      expect(
        String(stored(OWNER_WORKFLOW_ID, "runAsGivenByUserId")).toLowerCase(),
      ).toBe(FIRST_GIVER_ID);
    });

    test("a Project Owner sets it back to Default, and who gave it is forgotten", async () => {
      await update(
        OWNER_WORKFLOW_ID,
        { runAs: WorkflowRunAs.Default },
        OWNER(),
      );

      expect(stored(OWNER_WORKFLOW_ID, "runAs")).toBe(WorkflowRunAs.Default);
      expect(stored(OWNER_WORKFLOW_ID, "runAsGivenByUserId")).toBeNull();
      expect(stored(OWNER_WORKFLOW_ID, "runAsGivenAt")).toBeNull();
    });

    test("its steps may not name a global variable, a Project Owner's save included", async () => {
      const error: Error = await refusal(
        update(
          OWNER_WORKFLOW_ID,
          { graph: GRAPH_WITH_GLOBAL_VARIABLE },
          OWNER(),
        ),
      );

      expect(error.message).toContain(
        "A workflow that runs as Project Owner can't use the project's global variables ({{global.variables.TEAM_ID}})",
      );
    });

    test("only a Project Owner deletes it", async () => {
      const error: Error = await refusal(
        WorkflowService.deleteOneById({
          id: new ObjectID(OWNER_WORKFLOW_ID),
          props: WORKFLOW_ADMIN(),
        }),
      );

      expect(error.message).toBe(
        "This workflow runs as Project Owner, so only Project Owners can change it. You can still turn it off.",
      );
      expect(workflows.get(OWNER_WORKFLOW_ID)).toBeDefined();

      await WorkflowService.deleteOneById({
        id: new ObjectID(OWNER_WORKFLOW_ID),
        props: OWNER(),
      });

      expect(
        workflows.deletes.map((id: string): string => {
          return id.toLowerCase();
        }),
      ).toContain(OWNER_WORKFLOW_ID);
    });

    test("a workflow that runs as Default is deleted by its editors, as before", async () => {
      await WorkflowService.deleteOneById({
        id: new ObjectID(DEFAULT_WORKFLOW_ID),
        props: WORKFLOW_ADMIN(),
      });

      expect(
        workflows.deletes.map((id: string): string => {
          return id.toLowerCase();
        }),
      ).toContain(DEFAULT_WORKFLOW_ID);
    });
  });

  describe("changing a workflow that runs as a custom role", () => {
    test("someone who holds what the role gives may change it; someone who doesn't may not", async () => {
      givenRole();

      const holder: DatabaseCommonInteractionProps = member([
        Permission.IncidentAdmin,
        Permission.EditWorkflow,
        Permission.ReadWorkflow,
      ]);

      await update(ROLE_WORKFLOW_ID, { name: "Escalate faster" }, holder);
      expect(stored(ROLE_WORKFLOW_ID, "name")).toBe("Escalate faster");

      const error: Error = await refusal(
        update(ROLE_WORKFLOW_ID, { name: "Mine" }, WORKFLOW_ADMIN()),
      );

      expect(error.message).toBe(
        'This workflow runs as the custom role "Incident Automation", so only people who have every permission in "Incident Automation" can change it. You can still turn it off.',
      );
    });
  });

  describe("the keys that start a workflow", () => {
    async function readKey(
      id: string,
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> {
      const workflow: Workflow | null = await WorkflowService.findOneById({
        id: new ObjectID(id),
        select: { _id: true, webhookSecretKey: true },
        props: props,
      });

      return workflow?.webhookSecretKey;
    }

    test("of a workflow that runs as Default are read by its editors, as before", async () => {
      expect(await readKey(DEFAULT_WORKFLOW_ID, WORKFLOW_ADMIN())).toBe(
        "the-webhook-key",
      );
    });

    test("of one that runs as Project Owner, only by who may change it: the rest get the workflow without it", async () => {
      expect(await readKey(OWNER_WORKFLOW_ID, OWNER())).toBe("the-webhook-key");
      expect(
        await readKey(OWNER_WORKFLOW_ID, WORKFLOW_ADMIN()),
      ).toBeUndefined();
      expect(await readKey(OWNER_WORKFLOW_ID, ADMIN())).toBeUndefined();
    });
  });

  /*
   * Whoever could edit a workflow while it ran as Default - a Project Member
   * who builds workflows - may have copied its webhook URL or its incoming
   * email address. Hiding the keys once it is raised is not enough: the
   * copies would go on starting it, with a payload of their choosing. So the
   * write that raises it gives it new ones, which only its holders read.
   */
  describe("new keys for a workflow raised", () => {
    const EMAIL_KEY: string = "97950000-0000-4000-8000-0000000000e1";

    function keysOf(id: string): { webhook: string; email: string } {
      return {
        webhook: String(stored(id, "webhookSecretKey")),
        email: String(stored(id, "incomingEmailSecretKey")),
      };
    }

    test("raised from Default, it gets a new webhook URL and a new email address in the same write", async () => {
      workflows.get(DEFAULT_WORKFLOW_ID)!["incomingEmailSecretKey"] =
        new ObjectID(EMAIL_KEY);

      await update(
        DEFAULT_WORKFLOW_ID,
        { runAs: WorkflowRunAs.ProjectOwner },
        OWNER(),
      );

      const keys: { webhook: string; email: string } =
        keysOf(DEFAULT_WORKFLOW_ID);

      expect(stored(DEFAULT_WORKFLOW_ID, "runAs")).toBe(
        WorkflowRunAs.ProjectOwner,
      );
      expect(keys.webhook).not.toBe("the-webhook-key");
      expect(keys.webhook.length).toBeGreaterThan(10);
      expect(keys.email.toLowerCase()).not.toBe(EMAIL_KEY);
      expect(keys.email.length).toBeGreaterThan(10);
    });

    test("one with no email address gets none: its trigger gives one when it is saved", async () => {
      givenRole();

      await update(
        SECOND_DEFAULT_WORKFLOW_ID,
        {
          runAs: WorkflowRunAs.CustomRole,
          runAsCustomRoleId: ROLE_ID,
        },
        member([
          Permission.IncidentAdmin,
          Permission.EditWorkflow,
          Permission.ReadWorkflow,
        ]),
      );

      expect(stored(SECOND_DEFAULT_WORKFLOW_ID, "runAs")).toBe(
        WorkflowRunAs.CustomRole,
      );
      expect(stored(SECOND_DEFAULT_WORKFLOW_ID, "webhookSecretKey")).not.toBe(
        "the-webhook-key",
      );
      expect(
        stored(SECOND_DEFAULT_WORKFLOW_ID, "incomingEmailSecretKey"),
      ).toBeUndefined();
    });

    test("moved to another custom role, or from a role to Project Owner, it gets new keys again", async () => {
      givenRole();

      await update(
        ROLE_WORKFLOW_ID,
        {
          runAs: WorkflowRunAs.CustomRole,
          runAsCustomRoleId: new ObjectID(
            "97950000-0000-4000-8000-0000000000c2",
          ),
        },
        OWNER(),
      );

      const afterRole: string = keysOf(ROLE_WORKFLOW_ID).webhook;

      expect(afterRole).not.toBe("the-webhook-key");

      await update(
        ROLE_WORKFLOW_ID,
        { runAs: WorkflowRunAs.ProjectOwner },
        OWNER(),
      );

      expect(keysOf(ROLE_WORKFLOW_ID).webhook).not.toBe(afterRole);
    });

    test("chosen the same again - by a new giver - or set back to Default, it keeps its keys", async () => {
      const secondOwner: DatabaseCommonInteractionProps = OWNER();

      await update(
        OWNER_WORKFLOW_ID,
        { runAs: WorkflowRunAs.ProjectOwner },
        secondOwner,
      );

      expect(
        String(stored(OWNER_WORKFLOW_ID, "runAsGivenByUserId")).toLowerCase(),
      ).toBe(secondOwner.userId!.toString().toLowerCase());
      expect(stored(OWNER_WORKFLOW_ID, "webhookSecretKey")).toBe(
        "the-webhook-key",
      );

      await update(
        OWNER_WORKFLOW_ID,
        { runAs: WorkflowRunAs.Default },
        OWNER(),
      );

      expect(stored(OWNER_WORKFLOW_ID, "webhookSecretKey")).toBe(
        "the-webhook-key",
      );
    });

    test("a raise that is refused changes no key, and its steps or name saved change none", async () => {
      await refusal(
        update(
          DEFAULT_WORKFLOW_ID,
          { runAs: WorkflowRunAs.ProjectOwner },
          WORKFLOW_ADMIN(),
        ),
      );

      expect(stored(DEFAULT_WORKFLOW_ID, "webhookSecretKey")).toBe(
        "the-webhook-key",
      );

      await update(OWNER_WORKFLOW_ID, { graph: GRAPH }, OWNER());
      await update(OWNER_WORKFLOW_ID, { name: "Renamed" }, OWNER());

      expect(stored(OWNER_WORKFLOW_ID, "webhookSecretKey")).toBe(
        "the-webhook-key",
      );
    });
  });
});
