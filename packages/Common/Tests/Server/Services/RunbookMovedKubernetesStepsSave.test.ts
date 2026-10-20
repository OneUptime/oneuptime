import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import RunbookService, {
  Service as RunbookServiceClass,
} from "../../../Server/Services/RunbookService";
import RunbookLabelRuleEngineService from "../../../Server/Services/RunbookLabelRuleEngineService";
import RunbookOwnerRuleEngineService from "../../../Server/Services/RunbookOwnerRuleEngineService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  LEGACY_KUBERNETES_STEP_FIELDS,
  getKubectlScriptForLegacyKubernetesStep,
} from "../../../Types/Runbook/RunbookLegacySteps";
import {
  KubernetesAction,
  KubernetesWorkloadKind,
} from "../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { customDomainCaller } from "../API/CustomDomainCallers";
import { mockRouter } from "../API/Helpers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
  };
});

/*
 * A MOVED KUBERNETES STEP KEEPS ITS ACTION ONLY WHILE IT IS THE MOVED STEP.
 *
 * The data migration moved each Kubernetes step to the kubectl script its
 * action became, and kept its credential and action beside the script, so
 * a Runner older than kubectl scripts is still handed the step as it was
 * written (RunbookLegacySteps). A save keeps them only on a step that is
 * still the one the runbook holds - the same script, kubeconfig and legacy
 * fields - so a changed step never quietly runs the old action on an older
 * Runner: it loses them, and such a Runner fails it, saying to update.
 *
 * Through the whole write - the real permission checks and hooks, against
 * an in-memory Runbook table - as the members who edit runbooks, and
 * through the REST API (which Terraform and the CLI use) as well:
 *
 *   - a step saved as it is, or with only its title, Runner or timeouts
 *     changed, keeps them - for a runbook admin too, who may not read
 *     credentials, since the step names the credential it named already;
 *   - a step whose script or kubeconfig changed loses them, and so does one
 *     whose credential or action was changed, even with its script made to
 *     match;
 *   - a step no runbook holds yet - a new runbook's, a copy under a new id -
 *     keeps none;
 *   - a step written with a credential and no script is left as it is.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111cc",
);
const RUNBOOK_ID: string = "22222222-2222-4222-8222-2222222222dd";
const CREDENTIAL_ID: string = "33333333-3333-4333-8333-3333333333ee";
const OTHER_CREDENTIAL_ID: string = "33333333-3333-4333-8333-3333333333ff";
const RUNNER_ID: string = "44444444-4444-4444-8444-444444444401";
const OTHER_RUNNER_ID: string = "44444444-4444-4444-8444-444444444402";
const KUBECONFIG: string = "{{global.variables.prod_cluster-kubeconfig}}";

const MOVED_STEP_ID: string = "step-moved";

const LEGACY: JSONObject = {
  credentialId: CREDENTIAL_ID,
  action: KubernetesAction.ScaleWorkload,
  workloadKind: KubernetesWorkloadKind.Deployment,
  namespace: "web",
  workloadName: "api",
  replicas: 3,
};

const SCRIPT: string = getKubectlScriptForLegacyKubernetesStep(LEGACY as never);

// The step as the data migration left it.
function movedStep(config: JSONObject = {}, step: JSONObject = {}): JSONObject {
  return {
    id: MOVED_STEP_ID,
    order: 0,
    type: RunbookStepType.Kubernetes,
    title: "Scale the API",
    config: {
      kubeconfig: KUBECONFIG,
      script: SCRIPT,
      agentId: RUNNER_ID,
      ...LEGACY,
      ...config,
    },
    ...step,
  };
}

function bashStep(): JSONObject {
  return {
    id: "step-bash",
    order: 1,
    type: RunbookStepType.Bash,
    title: "Tell the team",
    config: { script: "echo scaled", agentId: RUNNER_ID },
  };
}

const RUNBOOK_ADMIN: Array<Permission> = [Permission.RunbookAdmin];
const PROJECT_OWNER: Array<Permission> = [Permission.ProjectOwner];
const EDIT_ONLY: Array<Permission> = [
  Permission.EditRunbook,
  Permission.ReadRunbook,
];

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

let table: InMemoryTable;

function storedSteps(): Array<JSONObject> {
  return (table.get(RUNBOOK_ID)?.["steps"] || []) as Array<JSONObject>;
}

function storedStep(id: string): JSONObject {
  const step: JSONObject | undefined = storedSteps().find(
    (candidate: JSONObject): boolean => {
      return candidate["id"] === id;
    },
  );

  if (!step) {
    throw new Error(`No stored step ${id}.`);
  }

  return step;
}

function storedConfig(id: string = MOVED_STEP_ID): JSONObject {
  return storedStep(id)["config"] as JSONObject;
}

function legacyFieldsOf(config: JSONObject): Array<string> {
  return LEGACY_KUBERNETES_STEP_FIELDS.filter((field: string): boolean => {
    return field in config;
  });
}

// Each write its own copy, as each request's: the hooks write into it.
async function save(
  steps: Array<JSONObject>,
  props: DatabaseCommonInteractionProps,
): Promise<void> {
  await RunbookService.updateOneById({
    id: new ObjectID(RUNBOOK_ID),
    data: { steps: JSON.parse(JSON.stringify(steps)) } as never,
    props: props,
  });
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  stubProjectDirectory({});
  getJestSpyOn(
    RunbookLabelRuleEngineService,
    "applyRulesToRunbook",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    RunbookOwnerRuleEngineService,
    "applyRulesToRunbook",
  ).mockResolvedValue(undefined);

  table = useInMemoryTable(RunbookService, [
    {
      _id: RUNBOOK_ID,
      projectId: PROJECT_ID.toString(),
      name: "Scale the API up",
      slug: "scale-the-api-up",
      isEnabled: true,
      steps: [movedStep(), bashStep()],
      isScheduleEnabled: false,
      isWebhookEnabled: false,
      version: 1,
    },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the rule a save keeps them by", () => {
  test("only steps that hold a moved Kubernetes step make a save read the runbook", () => {
    expect(RunbookServiceClass.hasMovedKubernetesSteps([movedStep()])).toBe(
      true,
    );
    expect(
      RunbookServiceClass.hasMovedKubernetesSteps([
        bashStep(),
        // Written with a credential: no script, so nothing to judge.
        {
          type: RunbookStepType.Kubernetes,
          config: { ...LEGACY, agentId: RUNNER_ID },
        },
        // Written as a script.
        {
          type: RunbookStepType.Kubernetes,
          config: { kubeconfig: KUBECONFIG, script: "kubectl get pods" },
        },
        // Another type that happens to carry such fields.
        {
          type: RunbookStepType.Bash,
          config: { script: "ls", ...LEGACY },
        },
      ]),
    ).toBe(false);
    expect(RunbookServiceClass.hasMovedKubernetesSteps(undefined)).toBe(false);
    expect(RunbookServiceClass.hasMovedKubernetesSteps("steps")).toBe(false);
  });

  test("a step every runbook the write writes holds as it is keeps them; nothing changes", () => {
    expect(
      RunbookServiceClass.getStepsWithoutChangedLegacyKubernetesFields({
        steps: [movedStep({ timeoutInMs: 1000 }), bashStep()],
        heldStepsOfEachRunbook: [
          [movedStep(), bashStep()],
          [bashStep(), movedStep()],
        ],
      }),
    ).toBeNull();
  });

  test("one runbook that holds it otherwise is enough to drop them, and only from that step", () => {
    const steps: Array<unknown> | null =
      RunbookServiceClass.getStepsWithoutChangedLegacyKubernetesFields({
        steps: [movedStep(), bashStep()],
        heldStepsOfEachRunbook: [
          [movedStep()],
          [movedStep({ kubeconfig: "{{global.variables.staging}}" })],
        ],
      });

    expect(steps).toEqual([
      {
        id: MOVED_STEP_ID,
        order: 0,
        type: RunbookStepType.Kubernetes,
        title: "Scale the API",
        config: { kubeconfig: KUBECONFIG, script: SCRIPT, agentId: RUNNER_ID },
      },
      bashStep(),
    ]);
  });

  test.each([
    ["no runbook holds it yet", []],
    ["the runbook holds no step of its id", [[bashStep()]]],
    [
      "the runbook holds it under its id as another type",
      [[movedStep({}, { type: RunbookStepType.Bash })]],
    ],
    ["the runbook's steps are not a list", ["steps"]],
  ])(
    "a step keeps none when %s",
    (_label: string, heldStepsOfEachRunbook: Array<unknown>) => {
      const steps: Array<unknown> | null =
        RunbookServiceClass.getStepsWithoutChangedLegacyKubernetesFields({
          steps: [movedStep()],
          heldStepsOfEachRunbook,
        });

      expect(
        legacyFieldsOf((steps![0] as JSONObject)["config"] as JSONObject),
      ).toEqual([]);
    },
  );

  test("a step with no id is held by no runbook", () => {
    const steps: Array<unknown> | null =
      RunbookServiceClass.getStepsWithoutChangedLegacyKubernetesFields({
        steps: [movedStep({}, { id: undefined })],
        heldStepsOfEachRunbook: [[movedStep({}, { id: undefined })]],
      });

    expect(
      legacyFieldsOf((steps![0] as JSONObject)["config"] as JSONObject),
    ).toEqual([]);
  });

  test("what is not a list of steps is left alone", () => {
    for (const steps of [undefined, null, "steps", { id: "x" }]) {
      expect(
        RunbookServiceClass.getStepsWithoutChangedLegacyKubernetesFields({
          steps,
          heldStepsOfEachRunbook: [],
        }),
      ).toBeNull();
    }

    expect(
      RunbookServiceClass.getStepsWithoutChangedLegacyKubernetesFields({
        steps: [null, 3, "x"],
        heldStepsOfEachRunbook: [],
      }),
    ).toBeNull();
  });
});

describe("saving a runbook's steps, through the whole write", () => {
  test.each([
    ["a runbook admin, who may not read credentials", RUNBOOK_ADMIN],
    ["someone who may only edit runbooks", EDIT_ONLY],
    ["a project owner", PROJECT_OWNER],
  ])(
    "%s saves the moved step as it is: it keeps its credential and action",
    async (_who: string, permissions: Array<Permission>) => {
      await save([movedStep(), bashStep()], member(permissions));

      expect(storedConfig()).toEqual(movedStep()["config"]);
    },
  );

  test("its title, its Runner, its timeouts and the other steps change nothing it does: kept", async () => {
    await save(
      [
        {
          ...bashStep(),
          order: 0,
          config: { script: "echo scaling", agentId: RUNNER_ID },
        },
        movedStep(
          {
            agentId: OTHER_RUNNER_ID,
            timeoutInMs: 120_000,
            claimTimeoutInMs: 30_000,
          },
          { order: 1, title: "Scale the API to three", requireApproval: true },
        ),
      ],
      member(RUNBOOK_ADMIN),
    );

    expect(storedStep(MOVED_STEP_ID)["title"]).toBe("Scale the API to three");
    expect(storedConfig()).toEqual({
      kubeconfig: KUBECONFIG,
      script: SCRIPT,
      agentId: OTHER_RUNNER_ID,
      timeoutInMs: 120_000,
      claimTimeoutInMs: 30_000,
      ...LEGACY,
    });
  });

  test("its script edited: it loses them, and keeps everything else as saved", async () => {
    const edited: string = `${SCRIPT}kubectl rollout status deployment/api --namespace web\n`;

    await save(
      [movedStep({ script: edited }), bashStep()],
      member(RUNBOOK_ADMIN),
    );

    expect(storedConfig()).toEqual({
      kubeconfig: KUBECONFIG,
      script: edited,
      agentId: RUNNER_ID,
    });
    // The other step is as it was.
    expect(storedStep("step-bash")).toEqual(bashStep());
  });

  test.each([
    ["another variable", "{{global.variables.staging-kubeconfig}}"],
    ["the Runner's own access", ""],
    ["a runbook's own variable", "{{local.variables.prod_cluster-kubeconfig}}"],
  ])(
    "its kubeconfig changed to %s: it loses them",
    async (_label: string, kubeconfig: string) => {
      await save(
        [movedStep({ kubeconfig }), bashStep()],
        member(RUNBOOK_ADMIN),
      );

      expect(storedConfig()).toEqual({
        kubeconfig,
        script: SCRIPT,
        agentId: RUNNER_ID,
      });
    },
  );

  test.each([
    ["names another credential", { credentialId: OTHER_CREDENTIAL_ID }],
    [
      "scales to another count, with its script made to match",
      {
        replicas: 5,
        script: getKubectlScriptForLegacyKubernetesStep({
          ...LEGACY,
          replicas: 5,
        } as never),
      },
    ],
    [
      "acts in another namespace, with its script made to match",
      {
        namespace: "staging",
        script: getKubectlScriptForLegacyKubernetesStep({
          ...LEGACY,
          namespace: "staging",
        } as never),
      },
    ],
    [
      "restarts instead, with its script made to match",
      {
        action: KubernetesAction.RestartWorkload,
        replicas: undefined,
        script: getKubectlScriptForLegacyKubernetesStep({
          ...LEGACY,
          action: KubernetesAction.RestartWorkload,
        } as never),
      },
    ],
  ])(
    "a project owner's save that %s: it loses them",
    async (_label: string, change: JSONObject) => {
      await save([movedStep(change), bashStep()], member(PROJECT_OWNER));

      expect(legacyFieldsOf(storedConfig())).toEqual([]);
      expect(storedConfig()["kubeconfig"]).toBe(KUBECONFIG);
    },
  );

  test("a copy of the step under a new id keeps none; the step itself keeps them", async () => {
    await save(
      [movedStep(), movedStep({}, { id: "step-copy", order: 1 }), bashStep()],
      member(RUNBOOK_ADMIN),
    );

    expect(storedConfig()).toEqual(movedStep()["config"]);
    expect(storedConfig("step-copy")).toEqual({
      kubeconfig: KUBECONFIG,
      script: SCRIPT,
      agentId: RUNNER_ID,
    });
  });

  test("once it lost them, saving it back as the migration wrote it does not bring them back", async () => {
    await save(
      [movedStep({ kubeconfig: "" }), bashStep()],
      member(PROJECT_OWNER),
    );
    await save([movedStep(), bashStep()], member(PROJECT_OWNER));

    expect(legacyFieldsOf(storedConfig())).toEqual([]);
  });

  test("a step written with a credential and no script is left as it is", async () => {
    const written: JSONObject = {
      id: "step-written",
      order: 0,
      type: RunbookStepType.Kubernetes,
      title: "Restart the API",
      config: { ...LEGACY, agentId: RUNNER_ID },
    };
    table.get(RUNBOOK_ID)!["steps"] = [written];

    await save([written], member(RUNBOOK_ADMIN));

    expect(storedStep("step-written")).toEqual(written);
  });

  test("a save that writes no moved step reads no runbook for it", async () => {
    const reads: { mock: { calls: Array<Array<unknown>> } } = getJestSpyOn(
      RunbookService,
      "findRowsAndHoldUpdateToThem",
    );

    await RunbookService.updateOneById({
      id: new ObjectID(RUNBOOK_ID),
      data: { name: "Scale the API" } as never,
      props: member(RUNBOOK_ADMIN),
    });
    await save([bashStep()], member(PROJECT_OWNER));

    const readSteps: Array<unknown> = reads.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return Boolean(
          (call[1] as Record<string, unknown> | undefined)?.["steps"],
        );
      },
    );

    expect(readSteps).toEqual([]);
    expect(table.get(RUNBOOK_ID)!["name"]).toBe("Scale the API");
  });

  test("the step's legacy fields are judged before its credential is: a runbook admin who edits the script is not refused", async () => {
    // A runbook admin may not read credentials, so may not name a new one.
    await save(
      [
        movedStep({
          credentialId: OTHER_CREDENTIAL_ID,
          script: "kubectl get pods --namespace web",
        }),
        bashStep(),
      ],
      member(RUNBOOK_ADMIN),
    );

    expect(storedConfig()).toEqual({
      kubeconfig: KUBECONFIG,
      script: "kubectl get pods --namespace web",
      agentId: RUNNER_ID,
    });
  });

  test("a runbook created with a moved step - a copy of a runbook - keeps none", async () => {
    const runbook: Runbook = new Runbook();

    Object.assign(runbook, {
      projectId: PROJECT_ID,
      name: "Scale the API up (copy)",
      steps: JSON.parse(JSON.stringify([movedStep(), bashStep()])),
    });

    await RunbookService.create({
      data: runbook,
      props: member(RUNBOOK_ADMIN),
    });

    const created: StoredRow | undefined = table.rows.find(
      (row: StoredRow): boolean => {
        return row["name"] === "Scale the API up (copy)";
      },
    );

    expect(created).toBeDefined();
    expect(
      (created!["steps"] as Array<JSONObject>).map(
        (step: JSONObject): JSONObject => {
          return step["config"] as JSONObject;
        },
      ),
    ).toEqual([
      { kubeconfig: KUBECONFIG, script: SCRIPT, agentId: RUNNER_ID },
      bashStep()["config"],
    ]);
  });

  test("an update of more than one runbook keeps them only where every runbook holds the step as it is", async () => {
    const SECOND_RUNBOOK_ID: string = "22222222-2222-4222-8222-2222222222de";

    table.rows.push({
      _id: SECOND_RUNBOOK_ID,
      projectId: PROJECT_ID.toString(),
      name: "Scale the API up, in staging",
      slug: "scale-the-api-up-in-staging",
      isEnabled: true,
      steps: [movedStep({ kubeconfig: "{{global.variables.staging}}" })],
      isScheduleEnabled: false,
      isWebhookEnabled: false,
      version: 1,
    });

    await RunbookService.updateBy({
      query: { projectId: PROJECT_ID },
      data: {
        steps: JSON.parse(JSON.stringify([movedStep(), bashStep()])),
      } as never,
      props: { isRoot: true, tenantId: PROJECT_ID },
      limit: 10,
      skip: 0,
    } as UpdateBy<Runbook>);

    for (const id of [RUNBOOK_ID, SECOND_RUNBOOK_ID]) {
      const steps: Array<JSONObject> = table.get(id)![
        "steps"
      ] as Array<JSONObject>;

      expect(legacyFieldsOf(steps[0]!["config"] as JSONObject)).toEqual([]);
    }
  });
});

describe("saving a runbook's steps through the API", () => {
  function api(
    props: DatabaseCommonInteractionProps,
  ): BaseAPI<Runbook, typeof RunbookService> {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props as never);

    return new BaseAPI<Runbook, typeof RunbookService>(Runbook, RunbookService);
  }

  function request(data: JSONObject, id?: string): OneUptimeRequest {
    return {
      params: id ? { id } : {},
      body: { data: JSON.parse(JSON.stringify(data)) },
      headers: {},
    } as unknown as OneUptimeRequest;
  }

  function response(): ExpressResponse {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
  }

  test("PUT with the steps as they are: the moved step keeps its credential and action", async () => {
    await api(member(RUNBOOK_ADMIN)).updateItem(
      request({ steps: [movedStep(), bashStep()] }, RUNBOOK_ID),
      response(),
    );

    expect(storedConfig()).toEqual(movedStep()["config"]);
  });

  test("PUT with its script edited - as Terraform or the CLI sends the whole list back - drops them", async () => {
    await api(member(RUNBOOK_ADMIN)).updateItem(
      request(
        {
          steps: [
            movedStep({ script: "kubectl scale deployment/api --replicas=4" }),
            bashStep(),
          ],
        },
        RUNBOOK_ID,
      ),
      response(),
    );

    expect(storedConfig()).toEqual({
      kubeconfig: KUBECONFIG,
      script: "kubectl scale deployment/api --replicas=4",
      agentId: RUNNER_ID,
    });
  });

  test("PUT with its kubeconfig changed drops them", async () => {
    await api(member(PROJECT_OWNER)).updateItem(
      request(
        {
          steps: [
            movedStep({ kubeconfig: "{{global.variables.staging}}" }),
            bashStep(),
          ],
        },
        RUNBOOK_ID,
      ),
      response(),
    );

    expect(legacyFieldsOf(storedConfig())).toEqual([]);
    expect(storedConfig()["kubeconfig"]).toBe("{{global.variables.staging}}");
  });

  test("POST of a runbook with a moved step stores it without them", async () => {
    await api(member(RUNBOOK_ADMIN)).createItem(
      request({
        projectId: PROJECT_ID.toString(),
        name: "Scale the API up, again",
        steps: [movedStep(), bashStep()],
      }),
      response(),
    );

    const created: StoredRow | undefined = table.rows.find(
      (row: StoredRow): boolean => {
        return row["name"] === "Scale the API up, again";
      },
    );

    expect(created).toBeDefined();
    expect(
      legacyFieldsOf(
        (created!["steps"] as Array<JSONObject>)[0]!["config"] as JSONObject,
      ),
    ).toEqual([]);
  });
});
