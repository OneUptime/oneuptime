import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import RunbookService, {
  STEP_NAMES_REMOVED_CREDENTIAL_MESSAGE,
  Service as RunbookServiceType,
} from "../../../Server/Services/RunbookService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import ProjectReferenceCheck, {
  JsonReferenceColumn,
} from "../../../Server/Utils/Database/ProjectReferenceCheck";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONArray } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import UserType from "../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  readsOfRowsCallerMayWrite,
  stubRowsCallerMayWriteLikeFindBy,
} from "../TestingUtils/RowsCallerMayWrite";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A RUNBOOK'S STEPS NAME NO RUNBOOK CREDENTIAL.
 *
 * A runbook's SSH and Kubernetes steps named the runbook credential they ran
 * with until runbook variables, and runbook credentials are gone now
 * (Runbooks > Runners > AI Access): the data migrations moved every stored
 * step that named one to the secret variables its key, password or
 * kubeconfig went into. So, whoever asks - a person, OneUptime itself, a
 * workflow's step:
 *
 *   - a create whose steps name one is refused, saying what a step signs in
 *     with instead and how to turn the step into one;
 *   - an update whose steps name one some runbook it writes does not name
 *     already is refused the same way, before the project check;
 *   - an update that keeps a step a runbook holds as it is (written through
 *     the API and never moved) still saves - that step fails when it runs,
 *     saying to turn it into a script step;
 *   - a credential is no reference of the runbook any more: the project
 *     check looks none up.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000001",
);
const RUNBOOK_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000aa";
const CREDENTIAL_A: string = "0193c0de-dddd-4aaa-8bbb-0000000000c1";
const CREDENTIAL_B: string = "0193c0de-dddd-4aaa-8bbb-0000000000c2";
const RUNNER: string = "0193c0de-dddd-4aaa-8bbb-0000000000e1";

const row: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    scope: PermissionScope.All,
  };
};

const member: (
  rows: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    ...ON_HIGHEST_PLAN,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
  };
};

const RUNBOOK_ADMIN: DatabaseCommonInteractionProps = member([
  row(Permission.RunbookAdmin),
]);

const PROJECT_OWNER: DatabaseCommonInteractionProps = member([
  row(Permission.ProjectOwner),
]);

function workflowStep(): DatabaseCommonInteractionProps {
  return {
    ...WorkflowPrincipal.getPropsWithoutPlan({
      projectId: PROJECT_ID,
      workflowId: new ObjectID("0193c0de-dddd-4aaa-8bbb-0000000000ff"),
      workflowName: "Write the restart runbook",
    }),
    ...ON_HIGHEST_PLAN,
  };
}

// Everyone who may write a runbook, OneUptime and a workflow's step included.
function everyCaller(): Array<[string, DatabaseCommonInteractionProps]> {
  return [
    ["a Runbook Admin", RUNBOOK_ADMIN],
    ["a Project Owner", PROJECT_OWNER],
    ["OneUptime itself", { isRoot: true } as DatabaseCommonInteractionProps],
    [
      "a master admin",
      {
        isMasterAdmin: true,
        userId: ObjectID.generate(),
      } as DatabaseCommonInteractionProps,
    ],
    ["a workflow's step", workflowStep()],
  ];
}

const sshStep: (credentialId: unknown) => Record<string, unknown> = (
  credentialId: unknown,
): Record<string, unknown> => {
  return {
    id: ObjectID.generate().toString(),
    order: 1,
    type: RunbookStepType.SSH,
    title: "Restart",
    config: { credentialId: credentialId, command: "uptime", agentId: RUNNER },
  };
};

const kubernetesStep: (credentialId: unknown) => Record<string, unknown> = (
  credentialId: unknown,
): Record<string, unknown> => {
  return {
    id: ObjectID.generate().toString(),
    order: 2,
    type: RunbookStepType.Kubernetes,
    title: "Scale",
    config: {
      credentialId: credentialId,
      action: "ScaleWorkload",
      workloadKind: "Deployment",
      namespace: "default",
      workloadName: "api",
      replicas: 2,
      agentId: RUNNER,
    },
  };
};

// What a step signs in with now: a script and a secret variable.
const sshScriptStep: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  return {
    id: ObjectID.generate().toString(),
    order: 1,
    type: RunbookStepType.SSH,
    title: "Restart",
    config: {
      host: "10.0.4.21",
      username: "deploy",
      signIn: "{{global.variables.prod_hosts-ssh-key}}",
      script: "uptime",
      agentId: RUNNER,
    },
  };
};

const bashStep: () => Record<string, unknown> = (): Record<string, unknown> => {
  return {
    id: ObjectID.generate().toString(),
    order: 3,
    type: RunbookStepType.Bash,
    title: "Script",
    config: { script: "echo hi", agentId: RUNNER, credentialId: CREDENTIAL_B },
  };
};

type RunbookInternals = {
  onBeforeCreate: (createBy: CreateBy<Runbook>) => Promise<OnCreate<Runbook>>;
  onBeforeUpdate: (updateBy: UpdateBy<Runbook>) => Promise<OnUpdate<Runbook>>;
  getJsonReferenceColumns: () => Array<JsonReferenceColumn>;
};

const internals: RunbookInternals =
  RunbookService as unknown as RunbookInternals;

const createRunbook: (
  steps: Array<Record<string, unknown>>,
  props: DatabaseCommonInteractionProps,
) => Promise<unknown> = async (
  steps: Array<Record<string, unknown>>,
  props: DatabaseCommonInteractionProps,
): Promise<unknown> => {
  const runbook: Runbook = new Runbook();
  runbook.name = "Restart the API";
  runbook.projectId = PROJECT_ID;
  runbook.steps = steps as unknown as JSONArray;

  try {
    await internals.onBeforeCreate({ data: runbook, props: props });
  } catch (error) {
    return error;
  }

  return undefined;
};

const updateRunbook: (
  steps: Array<Record<string, unknown>>,
  props: DatabaseCommonInteractionProps,
) => Promise<unknown> = async (
  steps: Array<Record<string, unknown>>,
  props: DatabaseCommonInteractionProps,
): Promise<unknown> => {
  try {
    await internals.onBeforeUpdate({
      query: { _id: RUNBOOK_ID },
      data: { steps: steps } as never,
      props: props,
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<Runbook>);
  } catch (error) {
    return error;
  }

  return undefined;
};

let storedSteps: Array<Record<string, unknown>> = [];

beforeEach(() => {
  storedSteps = [];

  // The project check is ProjectReferenceCheck's own; asked, never refusing here.
  getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue(
    undefined as never,
  );

  getJestSpyOn(RunbookService, "findBy").mockImplementation((async () => {
    const runbook: Runbook = new Runbook();
    runbook._id = RUNBOOK_ID;
    runbook.steps = storedSteps as unknown as JSONArray;
    return [runbook];
  }) as never);

  /*
   * The rows the caller may update: the update's query, in its project, as
   * the read above answers it.
   */
  stubRowsCallerMayWriteLikeFindBy(
    RunbookService,
    jest.spyOn(RunbookService, "findBy"),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the credentials a runbook's steps name", () => {
  test("are the credentialId of each SSH and Kubernetes step, each once, as written", () => {
    expect(
      RunbookServiceType.getStepCredentialIds([
        sshStep(CREDENTIAL_A),
        kubernetesStep(CREDENTIAL_B),
        sshStep(CREDENTIAL_A.toUpperCase()),
        sshStep(` ${CREDENTIAL_B} `),
      ]),
    ).toEqual([CREDENTIAL_A, CREDENTIAL_B]);
  });

  test("a step of another type names none, even with a credentialId", () => {
    expect(RunbookServiceType.getStepCredentialIds([bashStep()])).toEqual([]);
  });

  test("a step that signs in with a variable, or whose picker is empty, names none", () => {
    expect(
      RunbookServiceType.getStepCredentialIds([
        sshScriptStep(),
        sshStep(""),
        sshStep("   "),
        sshStep(undefined),
        sshStep(null),
        kubernetesStep(12),
      ]),
    ).toEqual([]);
  });

  test("an ObjectID is read as its id", () => {
    expect(
      RunbookServiceType.getStepCredentialIds([
        sshStep(new ObjectID(CREDENTIAL_A)),
      ]),
    ).toEqual([CREDENTIAL_A]);
  });

  test("anything but a list of steps names none", () => {
    for (const steps of [undefined, null, "steps", {}, 42, [null, "x", 7]]) {
      expect(RunbookServiceType.getStepCredentialIds(steps)).toEqual([]);
    }
  });

  // There is no credential to look up: the project check asks for none.
  test("are no reference of the runbook: the project check looks none up", () => {
    expect(internals.getJsonReferenceColumns.call(RunbookService)).toEqual([]);
  });
});

describe("creating a runbook", () => {
  test.each(everyCaller())(
    "whose steps name a credential is refused to %s, saying what a step signs in with instead",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      const refusal: unknown = await createRunbook(
        [bashStep(), sshStep(CREDENTIAL_A)],
        props,
      );

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(
        `The step "Restart" ${STEP_NAMES_REMOVED_CREDENTIAL_MESSAGE}`,
      );
    },
  );

  test("a Kubernetes step that names one is refused the same way", async () => {
    expect(
      (
        (await createRunbook(
          [kubernetesStep(CREDENTIAL_B)],
          PROJECT_OWNER,
        )) as Error
      ).message,
    ).toBe(`The step "Scale" ${STEP_NAMES_REMOVED_CREDENTIAL_MESSAGE}`);
  });

  test("the refusal says how a step signs in now, and where to turn one into it", () => {
    expect(STEP_NAMES_REMOVED_CREDENTIAL_MESSAGE).toContain(
      "runbook credentials were removed",
    );
    expect(STEP_NAMES_REMOVED_CREDENTIAL_MESSAGE).toContain(
      "secret runbook variable",
    );
    expect(STEP_NAMES_REMOVED_CREDENTIAL_MESSAGE).toContain(
      "Turn into a script step",
    );
  });

  test("whose steps sign in with variables, or name no credential, is allowed", async () => {
    for (const [, props] of everyCaller()) {
      expect(
        await createRunbook([sshScriptStep(), bashStep(), sshStep("")], props),
      ).toBeUndefined();
    }
  });

  test("is refused before the project check", async () => {
    await createRunbook([sshStep(CREDENTIAL_A)], PROJECT_OWNER);

    expect(ProjectReferenceCheck.validateCreate).not.toHaveBeenCalled();
  });

  test("hands on what the hook it extends returns", async () => {
    const runbook: Runbook = new Runbook();
    runbook.projectId = PROJECT_ID;
    runbook.steps = [sshScriptStep()] as unknown as JSONArray;

    const handedOn: OnCreate<Runbook> = {
      createBy: { data: runbook, props: RUNBOOK_ADMIN },
      carryForward: { from: "the hook it extends" },
    };

    getJestSpyOn(
      ProjectReferencesService.prototype as unknown as RunbookInternals,
      "onBeforeCreate",
    ).mockResolvedValue(handedOn as never);

    expect(
      await internals.onBeforeCreate({
        data: runbook,
        props: PROJECT_OWNER,
      }),
    ).toBe(handedOn);
  });
});

describe("changing a runbook's steps", () => {
  /*
   * A step written through the API and never moved: kept as it is, it
   * still saves (it fails when it runs, saying to turn it into a script
   * step), so an edit of the rest of the runbook is never held up by it.
   */
  test("that keep a step naming a credential the runbook holds already saves", async () => {
    storedSteps = [sshStep(CREDENTIAL_A)];

    for (const [, props] of everyCaller()) {
      expect(
        await updateRunbook([sshStep(CREDENTIAL_A), bashStep()], props),
      ).toBeUndefined();
    }
  });

  test.each(everyCaller())(
    "to a credential the runbook does not hold is refused to %s",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      storedSteps = [sshStep(CREDENTIAL_A)];

      const refusal: unknown = await updateRunbook(
        [sshStep(CREDENTIAL_A), kubernetesStep(CREDENTIAL_B)],
        props,
      );

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(
        `The step "Scale" ${STEP_NAMES_REMOVED_CREDENTIAL_MESSAGE}`,
      );
    },
  );

  test("that move every step to variables asks nothing and reads nothing", async () => {
    storedSteps = [sshStep(CREDENTIAL_A)];

    expect(
      await updateRunbook([sshScriptStep(), bashStep()], RUNBOOK_ADMIN),
    ).toBeUndefined();
    expect(RunbookService.findBy).not.toHaveBeenCalled();
  });

  test("an update that leaves the steps alone asks nothing", async () => {
    let refusal: unknown = undefined;

    try {
      await internals.onBeforeUpdate({
        query: { _id: RUNBOOK_ID },
        data: { name: "Renamed" } as never,
        props: RUNBOOK_ADMIN,
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<Runbook>);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeUndefined();
    expect(RunbookService.findBy).not.toHaveBeenCalled();
  });

  test("reads, as OneUptime, only the runbooks the caller may update, as the update itself is narrowed", async () => {
    storedSteps = [sshStep(CREDENTIAL_A)];

    await updateRunbook([sshStep(CREDENTIAL_A)], RUNBOOK_ADMIN);

    expect(ModelPermission.getUpdatableQuery).toHaveBeenCalledWith(
      Runbook,
      { _id: RUNBOOK_ID },
      RUNBOOK_ADMIN,
      { steps: [expect.objectContaining({ type: RunbookStepType.SSH })] },
    );
    expect(readsOfRowsCallerMayWrite(RunbookService)[0]!.query).toEqual({
      _id: RUNBOOK_ID,
      projectId: PROJECT_ID,
    });
    expect(RunbookService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: RUNBOOK_ID },
        props: { isRoot: true, ignoreHooks: true },
      }),
    );
  });

  /*
   * Held to every runbook it writes: a credential one of them does not
   * hold is refused even when another holds it.
   */
  test("over several runbooks, keeps a credential only when every one of them holds it", () => {
    expect(
      RunbookServiceType.getRemovedCredentialRefusal({
        steps: [sshStep(CREDENTIAL_A)],
        heldIds: [new Set([CREDENTIAL_A]), new Set([CREDENTIAL_A])],
      }),
    ).toBeNull();
    expect(
      RunbookServiceType.getRemovedCredentialRefusal({
        steps: [sshStep(CREDENTIAL_A)],
        heldIds: [new Set([CREDENTIAL_A]), new Set<string>()],
      }),
    ).toBe(`The step "Restart" ${STEP_NAMES_REMOVED_CREDENTIAL_MESSAGE}`);
    // A create holds nothing yet.
    expect(
      RunbookServiceType.getRemovedCredentialRefusal({
        steps: [sshStep(CREDENTIAL_A)],
        heldIds: [],
      }),
    ).not.toBeNull();
  });

  test("is refused before the project check", async () => {
    storedSteps = [sshStep(CREDENTIAL_A)];

    const refusal: unknown = await updateRunbook(
      [kubernetesStep(CREDENTIAL_B)],
      RUNBOOK_ADMIN,
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(ProjectReferenceCheck.validateUpdate).not.toHaveBeenCalled();
  });

  test("hands on what the hook it extends returns", async () => {
    storedSteps = [sshStep(CREDENTIAL_A)];

    const updateBy: UpdateBy<Runbook> = {
      query: { _id: RUNBOOK_ID },
      data: { steps: [sshStep(CREDENTIAL_A)] } as never,
      props: RUNBOOK_ADMIN,
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<Runbook>;

    const handedOn: OnUpdate<Runbook> = {
      updateBy: { ...updateBy },
      carryForward: { from: "the hook it extends" },
    };

    getJestSpyOn(
      ProjectReferencesService.prototype as unknown as RunbookInternals,
      "onBeforeUpdate",
    ).mockResolvedValue(handedOn as never);

    expect(await internals.onBeforeUpdate(updateBy)).toBe(handedOn);
  });
});
