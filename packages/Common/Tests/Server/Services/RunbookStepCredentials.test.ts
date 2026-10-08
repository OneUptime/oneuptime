import RunbookService, {
  Service as RunbookServiceType,
} from "../../../Server/Services/RunbookService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck, {
  JsonReferenceColumn,
} from "../../../Server/Utils/Database/ProjectReferenceCheck";
import { UnreadableReferenceException } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
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

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * THE CREDENTIALS A RUNBOOK RUNS WITH ARE ONES ITS AUTHOR MAY READ.
 *
 * A runbook's SSH and Kubernetes steps name the credential they run with in
 * its steps. A create or an update names one only when its caller may read
 * credentials (Project Owner, Project Admin or Read Runbook Credential, and
 * no block with no labels taking that away); an update asks only about the
 * credentials the runbook's steps do not name already; each credential
 * named is held to the project with every other reference the runbook
 * names (the steps are a JSON reference column of the project check).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000001",
);
const RUNBOOK_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000aa";
const CREDENTIAL_A: string = "0193c0de-dddd-4aaa-8bbb-0000000000c1";
const CREDENTIAL_B: string = "0193c0de-dddd-4aaa-8bbb-0000000000c2";
const RUNNER: string = "0193c0de-dddd-4aaa-8bbb-0000000000e1";

const row: (permission: Permission, isBlock?: boolean) => UserPermission = (
  permission: Permission,
  isBlock?: boolean,
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: Boolean(isBlock),
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

// Runbook Admins write runbooks, and read no credentials.
const RUNBOOK_ADMIN: DatabaseCommonInteractionProps = member([
  row(Permission.RunbookAdmin),
]);

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

  test("a step whose picker is still empty names none", () => {
    expect(
      RunbookServiceType.getStepCredentialIds([
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

  test("are held to the project with every other reference the runbook names", () => {
    const columns: Array<JsonReferenceColumn> =
      internals.getJsonReferenceColumns.call(RunbookService);

    expect(
      columns.map((column: JsonReferenceColumn): string => {
        return column.column;
      }),
    ).toEqual(["steps"]);

    const references: ReturnType<JsonReferenceColumn["getReferences"]> =
      columns[0]!.getReferences([
        sshStep(CREDENTIAL_A),
        kubernetesStep(CREDENTIAL_B),
      ]);

    expect(
      references.map((reference: { id: unknown }) => {
        return reference.id;
      }),
    ).toEqual([CREDENTIAL_A, CREDENTIAL_B]);
    expect(references[0]!.modelName).toBe("Credential");
    expect(references[0]!.service.modelType).toBe(RunbookCredential);
  });
});

describe("creating a runbook", () => {
  test("whose steps name a credential is refused to a caller who may not read credentials", async () => {
    const refusal: unknown = await createRunbook(
      [sshStep(CREDENTIAL_A)],
      RUNBOOK_ADMIN,
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect((refusal as Error).message).toContain(
      `This runbook references records that are not in this project: Credential "${CREDENTIAL_A}"`,
    );
  });

  test("names every credential refused", async () => {
    const refusal: unknown = await createRunbook(
      [sshStep(CREDENTIAL_A), kubernetesStep(CREDENTIAL_B)],
      RUNBOOK_ADMIN,
    );

    expect((refusal as Error).message).toContain(
      `Credential "${CREDENTIAL_A}", Credential "${CREDENTIAL_B}"`,
    );
  });

  test("is refused to a reader whose team blocks reading credentials", async () => {
    expect(
      await createRunbook(
        [kubernetesStep(CREDENTIAL_A)],
        member([
          row(Permission.ProjectAdmin),
          row(Permission.ReadRunbookCredential, true),
        ]),
      ),
    ).toBeInstanceOf(UnreadableReferenceException);
  });

  test("is allowed to a caller who may read credentials", async () => {
    for (const props of [
      member([row(Permission.ProjectOwner)]),
      member([row(Permission.ProjectAdmin)]),
      member([
        row(Permission.RunbookAdmin),
        row(Permission.ReadRunbookCredential),
      ]),
    ]) {
      expect(
        await createRunbook([sshStep(CREDENTIAL_A)], props),
      ).toBeUndefined();
    }
  });

  test("whose steps name no credential is allowed to anyone who may create runbooks", async () => {
    expect(
      await createRunbook([bashStep(), sshStep("")], RUNBOOK_ADMIN),
    ).toBeUndefined();
  });

  test("is not asked of OneUptime or a master admin", async () => {
    for (const props of [
      { isRoot: true },
      { isMasterAdmin: true, userId: ObjectID.generate() },
    ] as Array<DatabaseCommonInteractionProps>) {
      expect(
        await createRunbook([sshStep(CREDENTIAL_A)], props),
      ).toBeUndefined();
    }
  });

  test("asks the project check first", async () => {
    const order: Array<string> = [];

    getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockImplementation(
      (async () => {
        order.push("project");
      }) as never,
    );

    const refusal: unknown = await createRunbook(
      [sshStep(CREDENTIAL_A)],
      RUNBOOK_ADMIN,
    );

    expect(order).toEqual(["project"]);
    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
  });
});

describe("changing a runbook's steps", () => {
  test("that keep the credentials it names asks nothing of the caller", async () => {
    storedSteps = [sshStep(CREDENTIAL_A)];

    expect(
      await updateRunbook([sshStep(CREDENTIAL_A), bashStep()], RUNBOOK_ADMIN),
    ).toBeUndefined();
  });

  test("to a credential it does not name is refused to a caller who may not read credentials", async () => {
    storedSteps = [sshStep(CREDENTIAL_A)];

    const refusal: unknown = await updateRunbook(
      [sshStep(CREDENTIAL_A), kubernetesStep(CREDENTIAL_B)],
      RUNBOOK_ADMIN,
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect((refusal as Error).message).toContain(
      `Credential "${CREDENTIAL_B}"`,
    );
    expect((refusal as Error).message).not.toContain(
      `Credential "${CREDENTIAL_A}"`,
    );
  });

  test("to a new credential is allowed to a caller who may read credentials, without reading the runbook", async () => {
    storedSteps = [sshStep(CREDENTIAL_A)];

    expect(
      await updateRunbook(
        [kubernetesStep(CREDENTIAL_B)],
        member([row(Permission.ProjectAdmin)]),
      ),
    ).toBeUndefined();
    expect(RunbookService.findBy).not.toHaveBeenCalled();
  });

  test("that remove every credential asks nothing", async () => {
    storedSteps = [sshStep(CREDENTIAL_A)];

    expect(await updateRunbook([bashStep()], RUNBOOK_ADMIN)).toBeUndefined();
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

  test("reads the runbooks the update writes as OneUptime, by the update's own query in the caller's project", async () => {
    storedSteps = [];

    await updateRunbook([sshStep(CREDENTIAL_A)], RUNBOOK_ADMIN);

    expect(RunbookService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: RUNBOOK_ID, projectId: PROJECT_ID },
        props: { isRoot: true },
      }),
    );
  });
});
