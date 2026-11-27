import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import CodeFixPersonRepository, {
  CodeFixPersonRepositoryRefusals,
  CodeFixRepositoryUse,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixPersonRepository";
import CodeFixStartGate, {
  CodeFixStart,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixStartGate";
import CodeTaskAccess from "../../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskGate, {
  CODE_TASK_PLAN_REQUIRED_MESSAGE,
  CODE_TASK_SUBSCRIPTION_UNPAID_MESSAGE,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import { ResolvableRepository } from "../../../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeFixTaskContext from "../../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
} from "../../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
} from "../../../../../Types/CodeRepository/CodeRepositoryAllowance";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  MAX_CODE_FIX_REPOSITORY_CHOICES,
  NO_REPOSITORY_YOU_MAY_USE_MESSAGE,
  PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
  PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE,
  PICKED_REPOSITORY_NOT_FOUND_MESSAGE,
} from "../../../../../Utils/Suggestions/CodeFixRepositoryPick";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE REPOSITORY A PERSON'S FIX WITH AI IS MADE IN (#11075, #11209).
 *
 * One rule for every Fix with AI a person starts outside Code - a trace's,
 * an incident's or alert's, a service's logging or tracing: the person may
 * use the repository in Code (read it, ask OneUptime AI in it) and it is
 * connected. These hold the rule's own pieces, with Code's per-repository
 * checks (CodeTaskAccess) and its gate stood in for; each fix's suites hold
 * how it asks, and FixWithAiRepositoryYouMayUseOverHttp the whole of it
 * over HTTP with Code's checks run for real.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11209aaa-0000-4000-8000-000000000001",
);
const BILLING: string = "11209aaa-0000-4000-8000-0000000000a1";
const CHECKOUT: string = "11209aaa-0000-4000-8000-0000000000a2";
const LEDGER: string = "11209aaa-0000-4000-8000-0000000000a3";

const PERSON: DatabaseCommonInteractionProps = {
  userId: new ObjectID("11209aaa-0000-4000-8000-0000000000e1"),
  tenantId: PROJECT_ID,
};

const REFUSALS: CodeFixPersonRepositoryRefusals = {
  noConnectedRepository: "Nowhere to open the pull request: connect one.",
  pickARepository: "Pick the repository that holds this code.",
};

function resolvable(
  id: string,
  name: string = `repository-${id.slice(-2)}`,
): ResolvableRepository {
  return {
    id,
    name,
    organizationName: "acme",
    repositoryName: name,
    mainBranchName: "main",
    gitHubAppInstallationId: "1234",
  };
}

function rowOf(id: string): CodeRepository {
  const repository: CodeRepository = new CodeRepository();
  repository.id = new ObjectID(id);
  return repository;
}

/*
 * What one person may do in Code with the project's connected repositories:
 * read each in `readable`, ask AI in each in `askable` (a read and an ask
 * every check is answered by, as CodeTaskAccess would).
 */
interface PersonInCode {
  connected: Array<string>;
  readable: Array<string>;
  askable: Array<string>;
  reachable?: Array<string>;
}

interface Checks {
  readable: SpyInstance<typeof CodeTaskAccess.listReadableRepositoriesByIds>;
  askable: SpyInstance<typeof CodeTaskAccess.listAskableRepositoryIds>;
  findReadable: SpyInstance<typeof CodeTaskAccess.findReadableRepository>;
  canAsk: SpyInstance<typeof CodeTaskAccess.canAskInRepository>;
  reachable: SpyInstance<typeof CodeTaskGate.isRepositoryReachable>;
}

function personWho(person: PersonInCode): Checks {
  jest
    .spyOn(CodeRepositoryService, "getResolvableRepositories")
    .mockResolvedValue(
      person.connected.map((id: string): ResolvableRepository => {
        return resolvable(id);
      }),
    );

  const lower: (ids: Array<ObjectID | string>) => Array<string> = (
    ids: Array<ObjectID | string>,
  ): Array<string> => {
    return ids.map((id: ObjectID | string): string => {
      return id.toString().toLowerCase();
    });
  };

  return {
    readable: jest
      .spyOn(CodeTaskAccess, "listReadableRepositoriesByIds")
      .mockImplementation(async (data: {
        repositoryIds: Array<ObjectID | string>;
      }): Promise<Array<CodeRepository>> => {
        return lower(data.repositoryIds)
          .filter((id: string): boolean => {
            return person.readable.includes(id);
          })
          .map(rowOf);
      }),
    askable: jest
      .spyOn(CodeTaskAccess, "listAskableRepositoryIds")
      .mockImplementation(async (data: {
        repositoryIds: Array<ObjectID | string>;
      }): Promise<Set<string>> => {
        return new Set<string>(
          lower(data.repositoryIds).filter((id: string): boolean => {
            return person.askable.includes(id);
          }),
        );
      }),
    findReadable: jest
      .spyOn(CodeTaskAccess, "findReadableRepository")
      .mockImplementation(async (data: {
        repositoryId: ObjectID;
      }): Promise<CodeRepository | null> => {
        const id: string = data.repositoryId.toString().toLowerCase();
        return person.readable.includes(id) ? rowOf(id) : null;
      }),
    canAsk: jest
      .spyOn(CodeTaskAccess, "canAskInRepository")
      .mockImplementation(async (data: {
        repositoryId: ObjectID;
      }): Promise<boolean> => {
        return person.askable.includes(
          data.repositoryId.toString().toLowerCase(),
        );
      }),
    reachable: jest
      .spyOn(CodeTaskGate, "isRepositoryReachable")
      .mockImplementation(async (data: {
        repositoryId: ObjectID;
      }): Promise<boolean> => {
        return (person.reachable || person.connected).includes(
          data.repositoryId.toString().toLowerCase(),
        );
      }),
  };
}

function gateSays(start: Partial<CodeFixStart> = {}): SpyInstance<
  typeof CodeFixStartGate.check
> {
  return jest.spyOn(CodeFixStartGate, "check").mockResolvedValue({
    codeRepositoryId: null,
    blocker: null,
    ...start,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CodeFixPersonRepository.getUsableRepositories", () => {
  test("none connected: none, and nothing of the person is read", async () => {
    const checks: Checks = personWho({
      connected: [],
      readable: [],
      askable: [],
    });

    expect(
      await CodeFixPersonRepository.getUsableRepositories({
        projectId: PROJECT_ID,
        props: PERSON,
      }),
    ).toEqual({ connectedCount: 0, usable: [], allowance: NO_CODE_REPOSITORY });
    expect(checks.readable).not.toHaveBeenCalled();
    expect(checks.askable).not.toHaveBeenCalled();
  });

  test("every connected one theirs: every repository", async () => {
    personWho({
      connected: [BILLING, CHECKOUT],
      readable: [BILLING, CHECKOUT],
      askable: [BILLING, CHECKOUT],
    });

    const use: CodeFixRepositoryUse =
      await CodeFixPersonRepository.getUsableRepositories({
        projectId: PROJECT_ID,
        props: PERSON,
      });

    expect(use.connectedCount).toBe(2);
    expect(use.allowance).toEqual(EVERY_CODE_REPOSITORY);
    expect(
      use.usable.map((repository: ResolvableRepository): string => {
        return repository.id;
      }),
    ).toEqual([BILLING, CHECKOUT]);
  });

  test("some theirs: those, in the connected list's order, by their ids", async () => {
    personWho({
      connected: [BILLING, CHECKOUT, LEDGER],
      readable: [BILLING, CHECKOUT, LEDGER],
      askable: [LEDGER, CHECKOUT],
    });

    const use: CodeFixRepositoryUse =
      await CodeFixPersonRepository.getUsableRepositories({
        projectId: PROJECT_ID,
        props: PERSON,
      });

    expect(use.connectedCount).toBe(3);
    expect(use.allowance).toEqual({
      isEveryRepository: false,
      repositoryIds: [CHECKOUT, LEDGER],
    });
  });

  test("one they may ask in but not read is not theirs: reading comes first", async () => {
    const checks: Checks = personWho({
      connected: [BILLING, CHECKOUT],
      readable: [CHECKOUT],
      askable: [BILLING, CHECKOUT],
    });

    const use: CodeFixRepositoryUse =
      await CodeFixPersonRepository.getUsableRepositories({
        projectId: PROJECT_ID,
        props: PERSON,
      });

    expect(use.allowance).toEqual({
      isEveryRepository: false,
      repositoryIds: [CHECKOUT],
    });
    // Only the readable ones are asked about.
    expect(
      checks.askable.mock.calls[0]![0].repositoryIds.map(
        (id: ObjectID | string): string => {
          return id.toString();
        },
      ),
    ).toEqual([CHECKOUT]);
  });

  test("none theirs to ask in: none", async () => {
    personWho({
      connected: [BILLING, CHECKOUT],
      readable: [BILLING, CHECKOUT],
      askable: [],
    });

    expect(
      await CodeFixPersonRepository.getUsableRepositories({
        projectId: PROJECT_ID,
        props: PERSON,
      }),
    ).toEqual({ connectedCount: 2, usable: [], allowance: NO_CODE_REPOSITORY });
  });

  test("asked under the person's own props, a read a batch - never one repository at a time", async () => {
    const checks: Checks = personWho({
      connected: [BILLING, CHECKOUT, LEDGER],
      readable: [BILLING, CHECKOUT, LEDGER],
      askable: [BILLING],
    });

    await CodeFixPersonRepository.getUsableRepositories({
      projectId: PROJECT_ID,
      props: PERSON,
    });

    expect(checks.readable).toHaveBeenCalledTimes(1);
    expect(checks.askable).toHaveBeenCalledTimes(1);
    expect(checks.findReadable).not.toHaveBeenCalled();
    expect(checks.canAsk).not.toHaveBeenCalled();
    expect(checks.readable.mock.calls[0]![0].props).toBe(PERSON);
    expect(checks.askable.mock.calls[0]![0].props).toBe(PERSON);
    expect(checks.readable.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
  });

  /*
   * A person whose role reads nothing of Code - or whose plan does not
   * include it - has their read of the repositories refused outright by
   * the permission layer: none of them is theirs, said in the rule's own
   * words by whoever asks, and never an error that stops the page.
   */
  test.each([
    [
      "refused by their role",
      new NotAuthorizedException(
        "You do not have permissions to read Code Repository.",
      ),
    ],
    ["refused by the plan", new PaymentRequiredException("Upgrade.")],
    ["answered as not found", new NotFoundException("Not found.")],
  ])(
    "a read of the repositories %s: none theirs",
    async (_label: string, refusal: Exception) => {
      personWho({
        connected: [BILLING],
        readable: [BILLING],
        askable: [BILLING],
      });
      jest
        .spyOn(CodeTaskAccess, "listReadableRepositoriesByIds")
        .mockRejectedValue(refusal);

      expect(
        await CodeFixPersonRepository.getUsableRepositories({
          projectId: PROJECT_ID,
          props: PERSON,
        }),
      ).toEqual({
        connectedCount: 1,
        usable: [],
        allowance: NO_CODE_REPOSITORY,
      });
    },
  );

  test("anything else that goes wrong is said, never taken for none", async () => {
    personWho({ connected: [BILLING], readable: [BILLING], askable: [BILLING] });
    jest
      .spyOn(CodeTaskAccess, "listReadableRepositoriesByIds")
      .mockRejectedValue(new Error("connection reset"));

    await expect(
      CodeFixPersonRepository.getUsableRepositories({
        projectId: PROJECT_ID,
        props: PERSON,
      }),
    ).rejects.toThrow("connection reset");
  });
});

describe("CodeFixPersonRepository.checkRepositoryPick", () => {
  async function check(
    pick: string | undefined,
    person: PersonInCode,
  ): Promise<{ refusal: Exception | null; checks: Checks }> {
    const checks: Checks = personWho(person);

    return {
      refusal: await CodeFixPersonRepository.checkRepositoryPick({
        projectId: PROJECT_ID,
        pickedRepositoryId: pick ? new ObjectID(pick) : undefined,
        props: PERSON,
      }),
      checks,
    };
  }

  const EVERYTHING: PersonInCode = {
    connected: [BILLING, CHECKOUT],
    readable: [BILLING, CHECKOUT],
    askable: [BILLING, CHECKOUT],
  };

  test("one they may read and ask AI in, connected: no refusal", async () => {
    expect((await check(CHECKOUT, EVERYTHING)).refusal).toBeNull();
  });

  test("one they may not read: not found - never said to exist", async () => {
    const { refusal } = await check(CHECKOUT, {
      ...EVERYTHING,
      readable: [BILLING],
    });

    expect(refusal).toBeInstanceOf(NotFoundException);
    expect(refusal?.message).toBe(PICKED_REPOSITORY_NOT_FOUND_MESSAGE);
  });

  test("one they may read but not ask AI in: refused as such", async () => {
    const { refusal } = await check(CHECKOUT, {
      ...EVERYTHING,
      askable: [BILLING],
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal?.message).toBe(PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE);
  });

  test("one theirs that is not connected: refused as not connected", async () => {
    const { refusal } = await check(CHECKOUT, {
      ...EVERYTHING,
      reachable: [BILLING],
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toBe(PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE);
  });

  test("no pick at all: refused as not connected, nothing read", async () => {
    const { refusal, checks } = await check(undefined, EVERYTHING);

    expect(refusal?.message).toBe(PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE);
    expect(checks.findReadable).not.toHaveBeenCalled();
  });

  test("a read refused by their role or plan: not found, in the rule's words", async () => {
    personWho(EVERYTHING);
    jest
      .spyOn(CodeTaskAccess, "findReadableRepository")
      .mockRejectedValue(new NotAuthorizedException("no read"));

    const refusal: Exception | null =
      await CodeFixPersonRepository.checkRepositoryPick({
        projectId: PROJECT_ID,
        pickedRepositoryId: new ObjectID(CHECKOUT),
        props: PERSON,
      });

    expect(refusal).toBeInstanceOf(NotFoundException);
    expect(refusal?.message).toBe(PICKED_REPOSITORY_NOT_FOUND_MESSAGE);
  });

  test("asked in order, each under the person's props, and of that repository alone", async () => {
    const { checks } = await check(CHECKOUT, EVERYTHING);

    expect(checks.findReadable.mock.calls[0]![0]).toEqual({
      props: PERSON,
      projectId: PROJECT_ID,
      repositoryId: new ObjectID(CHECKOUT),
    });
    expect(checks.canAsk.mock.calls[0]![0].props).toBe(PERSON);
    expect(checks.findReadable.mock.invocationCallOrder[0]).toBeLessThan(
      checks.canAsk.mock.invocationCallOrder[0]!,
    );
    expect(checks.canAsk.mock.invocationCallOrder[0]).toBeLessThan(
      checks.reachable.mock.invocationCallOrder[0]!,
    );
    expect(checks.readable).not.toHaveBeenCalled();
  });

  test("a pick written in capitals is asked about as the database writes it", async () => {
    const { checks, refusal } = await check(CHECKOUT.toUpperCase(), EVERYTHING);

    expect(refusal).toBeNull();
    expect(checks.findReadable.mock.calls[0]![0].repositoryId.toString()).toBe(
      CHECKOUT,
    );
  });

  test("isRepositoryChoice says the same", async () => {
    personWho(EVERYTHING);

    expect(
      await CodeFixPersonRepository.isRepositoryChoice({
        projectId: PROJECT_ID,
        pickedRepositoryId: new ObjectID(BILLING),
        props: PERSON,
      }),
    ).toBe(true);

    personWho({ ...EVERYTHING, askable: [] });

    expect(
      await CodeFixPersonRepository.isRepositoryChoice({
        projectId: PROJECT_ID,
        pickedRepositoryId: new ObjectID(BILLING),
        props: PERSON,
      }),
    ).toBe(false);
  });
});

describe("CodeFixPersonRepository.isEveryonesBlocker", () => {
  test("the bill and the plan stop everyone; nothing else does", () => {
    for (const type of Object.values(CodeTaskBlockerType)) {
      expect(
        CodeFixPersonRepository.isEveryonesBlocker({ type, message: "" }),
      ).toBe(
        type === CodeTaskBlockerType.SubscriptionUnpaid ||
          type === CodeTaskBlockerType.PlanRequired,
      );
    }

    expect(CodeFixPersonRepository.isEveryonesBlocker(null)).toBe(false);
    expect(CodeFixPersonRepository.isEveryonesBlocker(undefined)).toBe(false);
  });
});

describe("CodeFixPersonRepository.getRepositoryChoices", () => {
  function use(repositories: Array<ResolvableRepository>): CodeFixRepositoryUse {
    return {
      connectedCount: repositories.length,
      usable: repositories,
      allowance: EVERY_CODE_REPOSITORY,
    };
  }

  test("by name, whatever the letter case, the id breaking a tie", () => {
    expect(
      CodeFixPersonRepository.getRepositoryChoices(
        use([
          resolvable(LEDGER, "ledger"),
          resolvable(CHECKOUT, "Billing"),
          resolvable(BILLING, "billing"),
        ]),
      ),
    ).toEqual([
      { id: BILLING, name: "billing" },
      { id: CHECKOUT, name: "Billing" },
      { id: LEDGER, name: "ledger" },
    ]);
  });

  test("a repository with no name is named by its organization and repository, else its id", () => {
    const unnamed: ResolvableRepository = {
      ...resolvable(CHECKOUT),
      name: "  ",
    };
    const bare: ResolvableRepository = {
      ...resolvable(LEDGER),
      name: "",
      organizationName: "",
      repositoryName: "",
    };

    expect(
      CodeFixPersonRepository.getRepositoryChoices(use([unnamed, bare])),
    ).toEqual([
      { id: LEDGER, name: LEDGER },
      { id: CHECKOUT, name: `acme/${unnamed.repositoryName}` },
    ]);
  });

  test(`at most ${MAX_CODE_FIX_REPOSITORY_CHOICES}`, () => {
    const many: Array<ResolvableRepository> = [];

    for (let index: number = 0; index < MAX_CODE_FIX_REPOSITORY_CHOICES + 25; index++) {
      const suffix: string = index.toString(16).padStart(12, "0");
      many.push(
        resolvable(
          `11209bbb-0000-4000-8000-${suffix}`,
          `repository-${index.toString().padStart(4, "0")}`,
        ),
      );
    }

    expect(
      CodeFixPersonRepository.getRepositoryChoices(use(many)),
    ).toHaveLength(MAX_CODE_FIX_REPOSITORY_CHOICES);
  });
});

describe("CodeFixPersonRepository.decideRepository", () => {
  let taskContext: CodeFixTaskContext;

  beforeEach(() => {
    taskContext = { serviceName: "billing-api" };
  });

  async function decide(
    data: {
      pick?: string;
      incidentId?: ObjectID;
      alertId?: ObjectID;
    } = {},
  ): Promise<ObjectID> {
    return await CodeFixPersonRepository.decideRepository({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.ImproveLogging,
      taskContext,
      person: PERSON,
      pickedRepositoryId: data.pick ? new ObjectID(data.pick) : undefined,
      incidentId: data.incidentId,
      alertId: data.alertId,
      refusals: REFUSALS,
    });
  }

  async function refusalOf(
    data: { pick?: string } = {},
  ): Promise<Exception | undefined> {
    try {
      await decide(data);
    } catch (error) {
      return error as Exception;
    }

    return undefined;
  }

  const EVERYTHING: PersonInCode = {
    connected: [BILLING, CHECKOUT, LEDGER],
    readable: [BILLING, CHECKOUT, LEDGER],
    askable: [BILLING, CHECKOUT, LEDGER],
  };

  test("a pick they may use: the run is queued on it, pinned to it, and Code's gate asked about it alone", async () => {
    personWho(EVERYTHING);
    const gate: SpyInstance<typeof CodeFixStartGate.check> = gateSays({
      codeRepositoryId: new ObjectID(LEDGER),
    });

    const repositoryId: ObjectID = await decide({ pick: LEDGER });

    expect(repositoryId.toString()).toBe(LEDGER);
    expect(taskContext.pickedCodeRepositoryId).toBe(LEDGER);
    expect(gate.mock.calls[0]![0].allowance).toEqual({
      isEveryRepository: false,
      repositoryIds: [LEDGER],
    });
  });

  test("a pick is never looked for among a list of their repositories", async () => {
    const checks: Checks = personWho(EVERYTHING);
    gateSays({ codeRepositoryId: new ObjectID(LEDGER) });

    await decide({ pick: LEDGER });

    expect(checks.readable).not.toHaveBeenCalled();
    expect(checks.askable).not.toHaveBeenCalled();
  });

  test("no pick: Code's gate resolves the run among theirs, and it is pinned to what resolved", async () => {
    personWho({ ...EVERYTHING, askable: [CHECKOUT, LEDGER] });
    const gate: SpyInstance<typeof CodeFixStartGate.check> = gateSays({
      codeRepositoryId: new ObjectID(CHECKOUT),
    });

    const repositoryId: ObjectID = await decide();

    expect(repositoryId.toString()).toBe(CHECKOUT);
    expect(taskContext.pickedCodeRepositoryId).toBe(CHECKOUT);
    expect(gate.mock.calls[0]![0].allowance).toEqual({
      isEveryRepository: false,
      repositoryIds: [CHECKOUT, LEDGER],
    });
  });

  test("no pick, nothing resolves, and one is theirs: that one", async () => {
    personWho({ ...EVERYTHING, askable: [LEDGER] });
    gateSays({ codeRepositoryId: null });

    const repositoryId: ObjectID = await decide();

    expect(repositoryId.toString()).toBe(LEDGER);
    expect(taskContext.pickedCodeRepositoryId).toBe(LEDGER);
  });

  test("no pick, nothing resolves, and several are theirs: a pick to make, in the fix's words - nothing pinned", async () => {
    personWho(EVERYTHING);
    gateSays({ codeRepositoryId: null });

    const refusal: Exception | undefined = await refusalOf();

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toBe(REFUSALS.pickARepository);
    expect(taskContext.pickedCodeRepositoryId).toBeUndefined();
  });

  test("none connected: nowhere to work, in the fix's words", async () => {
    personWho({ connected: [], readable: [], askable: [] });
    gateSays();

    const refusal: Exception | undefined = await refusalOf();

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toBe(REFUSALS.noConnectedRepository);
  });

  test("none theirs: refused, saying who can help - and Code's gate is asked as for no repository", async () => {
    personWho({ ...EVERYTHING, askable: [] });
    const gate: SpyInstance<typeof CodeFixStartGate.check> = gateSays();

    const refusal: Exception | undefined = await refusalOf();

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal?.message).toBe(NO_REPOSITORY_YOU_MAY_USE_MESSAGE);
    expect(gate.mock.calls[0]![0].allowance).toEqual(NO_CODE_REPOSITORY);
  });

  test("a pick they may not use is asked of Code's gate as no repository at all", async () => {
    personWho({ ...EVERYTHING, readable: [BILLING] });
    const gate: SpyInstance<typeof CodeFixStartGate.check> = gateSays();

    const refusal: Exception | undefined = await refusalOf({ pick: LEDGER });

    expect(refusal?.message).toBe(PICKED_REPOSITORY_NOT_FOUND_MESSAGE);
    expect(gate.mock.calls[0]![0].allowance).toEqual(NO_CODE_REPOSITORY);
    expect(taskContext.pickedCodeRepositoryId).toBeUndefined();
  });

  /*
   * THE BILL AND THE PLAN FIRST: they stop everyone, and a plan below the
   * repositories' own also reads as "may not edit the repository".
   */
  const EVERYONES: Array<[string, CodeTaskBlocker]> = [
    [
      "an unpaid subscription",
      {
        type: CodeTaskBlockerType.SubscriptionUnpaid,
        message: CODE_TASK_SUBSCRIPTION_UNPAID_MESSAGE,
      },
    ],
    [
      "a plan without AI in Code",
      {
        type: CodeTaskBlockerType.PlanRequired,
        message: CODE_TASK_PLAN_REQUIRED_MESSAGE,
      },
    ],
  ];

  test.each(EVERYONES)(
    "%s is said before a pick they may not use, as a payment",
    async (_label: string, blocker: CodeTaskBlocker) => {
      personWho({ ...EVERYTHING, askable: [] });
      gateSays({ blocker });

      const refusal: Exception | undefined = await refusalOf({ pick: LEDGER });

      expect(refusal).toBeInstanceOf(PaymentRequiredException);
      expect(refusal?.message).toBe(blocker.message);
    },
  );

  test.each(EVERYONES)(
    "%s is said before none of the repositories being theirs",
    async (_label: string, blocker: CodeTaskBlocker) => {
      personWho({ ...EVERYTHING, askable: [] });
      gateSays({ blocker });

      expect((await refusalOf())?.message).toBe(blocker.message);
    },
  );

  test("what stops only a repository's work comes after why it is not theirs", async () => {
    personWho({ ...EVERYTHING, askable: [] });
    gateSays({
      blocker: {
        type: CodeTaskBlockerType.NoAgent,
        message: "No Runner is online.",
      },
    });

    const refusal: Exception | undefined = await refusalOf({ pick: LEDGER });

    expect(refusal?.message).toBe(PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE);
  });

  test("a repository theirs, and Code's gate in the way: its words, as an error of its kind", async () => {
    personWho(EVERYTHING);
    gateSays({
      codeRepositoryId: new ObjectID(BILLING),
      blocker: {
        type: CodeTaskBlockerType.NoAgent,
        message: "No Runner is online.",
      },
    });

    const refusal: Exception | undefined = await refusalOf();

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toBe("No Runner is online.");
    expect(taskContext.pickedCodeRepositoryId).toBeUndefined();
  });

  test("Code's gate is asked with the run's context, kind and record", async () => {
    personWho(EVERYTHING);
    const gate: SpyInstance<typeof CodeFixStartGate.check> = gateSays({
      codeRepositoryId: new ObjectID(BILLING),
    });
    const incidentId: ObjectID = ObjectID.generate();

    await decide({ incidentId });

    expect(gate.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.ImproveLogging,
      taskContext,
      incidentId,
      alertId: undefined,
    });
  });

  test("the pin is the repository the run is queued on, as the database writes it", async () => {
    personWho(EVERYTHING);
    gateSays({ codeRepositoryId: null });

    await decide({ pick: CHECKOUT.toUpperCase() });

    expect(taskContext.pickedCodeRepositoryId).toBe(CHECKOUT);
  });

  test("every allowance the run is resolved among is the person's: never every repository for some", async () => {
    personWho({ ...EVERYTHING, askable: [BILLING] });
    const gate: SpyInstance<typeof CodeFixStartGate.check> = gateSays({
      codeRepositoryId: new ObjectID(BILLING),
    });

    await decide();

    const allowance: CodeRepositoryAllowance =
      gate.mock.calls[0]![0].allowance!;
    expect(allowance.isEveryRepository).toBe(false);
  });
});
