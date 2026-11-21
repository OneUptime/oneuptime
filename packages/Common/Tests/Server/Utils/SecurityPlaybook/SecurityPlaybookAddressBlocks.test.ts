import SecurityBlock from "../../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../../Models/DatabaseModels/SecurityBlockEnforcement";
import SecurityBlockEnforcementService from "../../../../Server/Services/SecurityBlockEnforcementService";
import SecurityBlockService, {
  SecurityBlockLiftStatus,
  SecurityBlockOutcome,
  SecurityBlockOutcomeStatus,
  SecurityBlockRequest,
} from "../../../../Server/Services/SecurityBlockService";
import SecurityBlockDestinations from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import SecurityBlocklistReconciler from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistReconciler";
import TestSecurityBlockDestination from "../../../../Server/Utils/SecurityBlocklist/TestSecurityBlockDestination";
import { PlaybookStepOutcome } from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import SecurityPlaybookAddressBlocks, {
  NOT_ENFORCED_ANYWHERE_ERROR,
  describeAddressBlockMade,
  formatBlockTime,
  joinNames,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookAddressBlocks";
import ObjectID from "../../../../Types/ObjectID";
import { assertPlaybookBlocksExpire } from "../../../../Server/Services/SecurityPlaybookService";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  SecurityPlaybookStep,
  parseSecurityPlaybookSteps,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockSource,
  SecurityBlockState,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockDestinationProvider,
  SecurityBlockEnforcementState,
} from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { SecurityProtectedAddressSource } from "../../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookStepStatus } from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// A reconcile that fails is logged; the tests read the outcome instead.
jest.mock("../../../../Server/Utils/Logger");

/*
 * BLOCK THE ADDRESS, AND LIFT THE BLOCK ON IT, AS A PLAYBOOK STEP (#10342).
 *
 * Each target goes through the blocklist's one way in (SecurityBlockService,
 * faked here as it answers), and the blocklist is reconciled at once so the
 * step says where each block is enforced. Pinned: the words of each
 * outcome - "blocked until 2026-11-21 10:42 UTC, enforced at Cloudflare and
 * AWS WAF", "already blocked (covered by 35.205.11.0/24)", protected with
 * what protects it, failed with why - and that a block nothing enforces is
 * a failed step, for a person to see.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RUN_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CASE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const PERSON_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ADDRESS: string = "35.205.11.131";
const OTHER: string = "35.205.12.7";
const EXPIRES_AT: Date = new Date("2026-11-22T10:42:00.000Z");

function target(value: string): SecurityPlaybookTarget {
  return {
    type: SecurityEntityType.IpAddress,
    value,
    reason: SecurityPlaybookTargetReason.GroupedOn,
    state: SecurityPlaybookTargetState.Proposed,
  };
}

function madeBlock(data: {
  index: number;
  value: string;
  action?: SecurityBlockAction;
  expiresAt?: Date | null;
}): SecurityBlock {
  const block: SecurityBlock = new SecurityBlock(
    new ObjectID(`bbbbbbbb-bbbb-4bbb-8bbb-${String(data.index).padStart(12, "0")}`),
  );
  block.value = data.value;
  block.action = data.action || SecurityBlockAction.Block;
  block.state = SecurityBlockState.Active;
  block.expiresAt =
    data.expiresAt === null
      ? (undefined as unknown as Date)
      : data.expiresAt || EXPIRES_AT;
  return block;
}

function row(data: {
  block: SecurityBlock;
  destination: string;
  state: SecurityBlockEnforcementState;
  error?: string;
}): SecurityBlockEnforcement {
  const enforcement: SecurityBlockEnforcement = new SecurityBlockEnforcement();
  enforcement.securityBlockId = data.block.id!;
  enforcement.destinationName = data.destination;
  enforcement.state = data.state;

  if (data.state === SecurityBlockEnforcementState.Applied) {
    enforcement.appliedAt = new Date();
    enforcement.lastConfirmedAt = new Date();
  }

  if (data.error) {
    enforcement.error = data.error;
  }

  return enforcement;
}

let outcomes: Map<string, SecurityBlockOutcome | Error>;
let asked: Array<SecurityBlockRequest>;
let enforcement: Array<SecurityBlockEnforcement>;
let reconcile: ReturnType<typeof jest.fn>;

function withDestinations(names: Array<string>): void {
  SecurityBlockDestinations.setSourcesForTests([
    {
      provider: SecurityBlockDestinationProvider.Test,
      findForProject: async () => {
        return names.map((name: string): TestSecurityBlockDestination => {
          return new TestSecurityBlockDestination({ key: `Test:${name}`, name });
        });
      },
    },
  ]);
}

beforeEach(() => {
  outcomes = new Map();
  asked = [];
  enforcement = [];
  withDestinations(["Cloudflare", "AWS WAF"]);

  jest
    .spyOn(SecurityBlockService, "block")
    .mockImplementation(
      async (request: SecurityBlockRequest): Promise<SecurityBlockOutcome> => {
        asked.push(request);
        const outcome: SecurityBlockOutcome | Error | undefined =
          outcomes.get(request.value);

        if (outcome instanceof Error) {
          throw outcome;
        }

        if (!outcome) {
          throw new Error(`no outcome for ${request.value}`);
        }

        return outcome;
      },
    );
  reconcile = jest
    .spyOn(SecurityBlocklistReconciler, "reconcileProject")
    .mockResolvedValue({
      destinations: 2,
      skipped: 0,
      failed: 0,
    }) as unknown as ReturnType<typeof jest.fn>;
  jest
    .spyOn(SecurityBlockEnforcementService, "findForBlocks")
    .mockImplementation(async () => {
      return enforcement;
    });
});

afterEach(() => {
  SecurityBlockDestinations.resetSourcesForTests();
  jest.restoreAllMocks();
});

async function blockTargets(data: {
  targets: Array<SecurityPlaybookTarget>;
  blockAction?: SecurityBlockAction;
  duration?: SecurityBlockDuration;
  personId?: ObjectID;
}): Promise<PlaybookStepOutcome> {
  return await SecurityPlaybookAddressBlocks.block({
    projectId: PROJECT_ID,
    runId: RUN_ID,
    securityCaseId: CASE_ID,
    reason: `Path traversal attempts - ${ADDRESS}`,
    config: {
      blockAction: data.blockAction || SecurityBlockAction.Block,
      duration: data.duration || SecurityBlockDuration.OneDay,
    },
    targets: data.targets,
    personId: data.personId,
  });
}

describe("blocking each target", () => {
  test("blocked and enforced at two destinations: done, saying until when and where", async () => {
    const block: SecurityBlock = madeBlock({ index: 1, value: ADDRESS });
    outcomes.set(ADDRESS, { status: SecurityBlockOutcomeStatus.Blocked, block });
    enforcement.push(
      row({
        block,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Applied,
      }),
      row({
        block,
        destination: "AWS WAF",
        state: SecurityBlockEnforcementState.Applied,
      }),
    );

    const outcome: PlaybookStepOutcome = await blockTargets({
      targets: [target(ADDRESS)],
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.targets).toEqual([
      {
        ...target(ADDRESS),
        state: SecurityPlaybookTargetState.Done,
        detail:
          "blocked until 2026-11-22 10:42 UTC, enforced at Cloudflare and AWS WAF",
      },
    ]);
    expect(outcome.summary.toString()).toBe(
      `Block the address: done for \`${ADDRESS}\`.`,
    );
    expect(reconcile).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });

  test("blocks through the blocklist's one way in, for the case and the run, with the case's title as why", async () => {
    outcomes.set(ADDRESS, {
      status: SecurityBlockOutcomeStatus.Blocked,
      block: madeBlock({ index: 1, value: ADDRESS }),
    });

    await blockTargets({
      targets: [target(ADDRESS)],
      blockAction: SecurityBlockAction.Challenge,
      duration: SecurityBlockDuration.SevenDays,
    });

    expect(asked).toEqual([
      {
        projectId: PROJECT_ID,
        value: ADDRESS,
        action: SecurityBlockAction.Challenge,
        duration: SecurityBlockDuration.SevenDays,
        reason: `Path traversal attempts - ${ADDRESS}`,
        securityCaseId: CASE_ID,
        source: SecurityBlockSource.Playbook,
        securityPlaybookRunId: RUN_ID,
        props: { isRoot: true },
      },
    ]);
  });

  test("a person's one-step block is theirs: made as them, from the case", async () => {
    outcomes.set(ADDRESS, {
      status: SecurityBlockOutcomeStatus.Blocked,
      block: madeBlock({ index: 1, value: ADDRESS }),
    });

    await blockTargets({ targets: [target(ADDRESS)], personId: PERSON_ID });

    expect(asked[0]!.source).toBe(SecurityBlockSource.Person);
    expect(asked[0]!.props).toEqual({ isRoot: true, userId: PERSON_ID });
  });

  test("a destination still applying it: done, saying where it is being applied", async () => {
    const block: SecurityBlock = madeBlock({ index: 1, value: ADDRESS });
    outcomes.set(ADDRESS, { status: SecurityBlockOutcomeStatus.Blocked, block });
    enforcement.push(
      row({
        block,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Pending,
      }),
    );

    const outcome: PlaybookStepOutcome = await blockTargets({
      targets: [target(ADDRESS)],
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.targets?.[0]?.detail).toBe(
      "blocked until 2026-11-22 10:42 UTC, being applied at Cloudflare",
    );
  });

  test("challenged until someone lifts it, enforced at one and turned down at another", async () => {
    const block: SecurityBlock = madeBlock({
      index: 1,
      value: ADDRESS,
      action: SecurityBlockAction.Challenge,
      expiresAt: null,
    });
    outcomes.set(ADDRESS, { status: SecurityBlockOutcomeStatus.Blocked, block });
    enforcement.push(
      row({
        block,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Applied,
      }),
      row({
        block,
        destination: "Azure WAF",
        state: SecurityBlockEnforcementState.Failed,
        error: "Azure WAF cannot challenge.",
      }),
    );

    const outcome: PlaybookStepOutcome = await blockTargets({
      targets: [target(ADDRESS)],
      blockAction: SecurityBlockAction.Challenge,
      duration: SecurityBlockDuration.UntilLifted,
      personId: PERSON_ID,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.targets?.[0]?.detail).toBe(
      "challenged until someone lifts it, enforced at Cloudflare; not applied at Azure WAF: Azure WAF cannot challenge",
    );
  });

  test("turned down by every destination: the step fails, saying why, and the block is the person's to lift", async () => {
    const block: SecurityBlock = madeBlock({ index: 1, value: ADDRESS });
    outcomes.set(ADDRESS, { status: SecurityBlockOutcomeStatus.Blocked, block });
    enforcement.push(
      row({
        block,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Failed,
        error: "the Cloudflare list is full (10,000)",
      }),
    );

    const outcome: PlaybookStepOutcome = await blockTargets({
      targets: [target(ADDRESS)],
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.targets?.[0]).toMatchObject({
      state: SecurityPlaybookTargetState.Done,
      detail:
        "blocked until 2026-11-22 10:42 UTC, but not applied at Cloudflare: the Cloudflare list is full (10,000)",
    });
    expect(outcome.error).toBe(
      `Not enforced anywhere: ${ADDRESS} is blocked on your blocklist, and no destination holds it yet.`,
    );
  });

  test("nothing enforces the blocklist: a failed step - 'Not enforced anywhere' - with the block recorded, and no reconcile", async () => {
    withDestinations([]);
    outcomes.set(ADDRESS, {
      status: SecurityBlockOutcomeStatus.Blocked,
      block: madeBlock({ index: 1, value: ADDRESS }),
    });

    const outcome: PlaybookStepOutcome = await blockTargets({
      targets: [target(ADDRESS)],
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toBe(NOT_ENFORCED_ANYWHERE_ERROR);
    expect(NOT_ENFORCED_ANYWHERE_ERROR).toBe(
      "Not enforced anywhere: connect Cloudflare, AWS WAF or a firewall.",
    );
    expect(outcome.targets?.[0]?.detail).toBe(
      "blocked until 2026-11-22 10:42 UTC, but nothing enforces your blocklist",
    );
    expect(reconcile).not.toHaveBeenCalled();
  });

  test("already blocked by a range: done before, naming the range", async () => {
    outcomes.set(ADDRESS, {
      status: SecurityBlockOutcomeStatus.AlreadyBlocked,
      block: madeBlock({ index: 9, value: "35.205.11.0/24" }),
      message: "35.205.11.131 is blocked already, by 35.205.11.0/24.",
    });

    const outcome: PlaybookStepOutcome = await blockTargets({
      targets: [target(ADDRESS)],
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.targets?.[0]).toMatchObject({
      state: SecurityPlaybookTargetState.AlreadyDone,
      detail: "already blocked (covered by 35.205.11.0/24)",
    });
    // No block was made: nothing to reconcile.
    expect(reconcile).not.toHaveBeenCalled();
  });

  test("already blocked by a block of the address itself", async () => {
    outcomes.set(ADDRESS, {
      status: SecurityBlockOutcomeStatus.AlreadyBlocked,
      block: madeBlock({ index: 9, value: ADDRESS }),
      message: "35.205.11.131 is blocked already.",
    });

    const outcome: PlaybookStepOutcome = await blockTargets({
      targets: [target(ADDRESS)],
    });

    expect(outcome.targets?.[0]?.detail).toBe("already blocked");
  });

  test("protected: left alone, saying what protects it, and never a failure", async () => {
    outcomes.set(ADDRESS, {
      status: SecurityBlockOutcomeStatus.Protected,
      protection: {
        source: SecurityProtectedAddressSource.CloudResource,
        protectedValue: ADDRESS,
        name: "prod-alb",
        kind: "load balancer",
      },
      message: "35.205.11.131 is the address of load balancer prod-alb.",
    });
    outcomes.set(OTHER, {
      status: SecurityBlockOutcomeStatus.Blocked,
      block: madeBlock({ index: 1, value: OTHER }),
    });
    enforcement.push(
      row({
        block: madeBlock({ index: 1, value: OTHER }),
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Applied,
      }),
    );

    const outcome: PlaybookStepOutcome = await blockTargets({
      targets: [target(ADDRESS), target(OTHER)],
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.targets?.[0]).toEqual({
      ...target(ADDRESS),
      state: SecurityPlaybookTargetState.Protected,
      detail: "35.205.11.131 is the address of load balancer prod-alb.",
      protectedBy: ADDRESS,
    });
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "protected: 35.205.11.131 is the address of load balancer prod-alb",
    );
  });

  test("refused or broken: failed, with the blocklist's words, and the rest still blocked", async () => {
    outcomes.set(ADDRESS, {
      status: SecurityBlockOutcomeStatus.Refused,
      message:
        "OneUptime could not check whether 35.205.11.131 is one of your own addresses.",
    });
    outcomes.set(OTHER, new Error("the database went away"));

    const outcome: PlaybookStepOutcome = await blockTargets({
      targets: [target(ADDRESS), target(OTHER)],
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(
      outcome.targets?.map((item: SecurityPlaybookTarget) => {
        return [item.state, item.detail];
      }),
    ).toEqual([
      [
        SecurityPlaybookTargetState.Failed,
        "OneUptime could not check whether 35.205.11.131 is one of your own addresses.",
      ],
      [SecurityPlaybookTargetState.Failed, "the database went away"],
    ]);
    expect(outcome.summary.toString()).toBe(
      "Block the address: no address of the case could be acted on.",
    );
  });

  test("a reconcile that fails leaves the block to the queued one: it reads as being applied", async () => {
    const block: SecurityBlock = madeBlock({ index: 1, value: ADDRESS });
    outcomes.set(ADDRESS, { status: SecurityBlockOutcomeStatus.Blocked, block });
    reconcile.mockRejectedValueOnce(new Error("Cloudflare timed out"));
    enforcement.push(
      row({
        block,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Pending,
      }),
    );

    const outcome: PlaybookStepOutcome = await blockTargets({
      targets: [target(ADDRESS)],
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.targets?.[0]?.detail).toContain("being applied at Cloudflare");
  });

  test("only the targets still to act on: protected and left-out ones are never sent", async () => {
    const outcome: PlaybookStepOutcome = await blockTargets({
      targets: [
        {
          ...target(ADDRESS),
          state: SecurityPlaybookTargetState.Protected,
          protectedBy: "35.205.11.0/24",
        },
        { ...target(OTHER), state: SecurityPlaybookTargetState.LeftOut },
      ],
    });

    expect(asked).toEqual([]);
    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toBe(
      "No address to act on: `35.205.11.131` is protected (matches 35.205.11.0/24), `35.205.12.7` is left out by the approver.",
    );
  });

  test("none at all: skipped, saying why", async () => {
    const outcome: PlaybookStepOutcome = await blockTargets({ targets: [] });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toBe(
      "No address to act on: no detection of the case is grouped on a public address it did not only claim, and threat intel knows none of its addresses.",
    );
  });
});

describe("lifting the block on each target", () => {
  let lifted: Array<{ id: string; props: unknown; reason: unknown }>;
  let active: Array<SecurityBlock>;
  let covering: SecurityBlock | null;

  beforeEach(() => {
    lifted = [];
    active = [];
    covering = null;

    jest
      .spyOn(SecurityBlockService, "findBy")
      .mockImplementation(async (findBy: unknown): Promise<any> => {
        const query: Record<string, unknown> = (
          findBy as { query: Record<string, unknown> }
        ).query;

        return active.filter((block: SecurityBlock): boolean => {
          return (
            block.value === query["value"] &&
            (query["securityPlaybookRunId"] === undefined ||
              String(block.securityPlaybookRunId) ===
                String(query["securityPlaybookRunId"]))
          );
        });
      });
    jest
      .spyOn(SecurityBlockService, "findCoveringBlock")
      .mockImplementation(async () => {
        return covering;
      });
    jest
      .spyOn(SecurityBlockService, "lift")
      .mockImplementation(async (data: any) => {
        lifted.push({
          id: data.securityBlockId.toString(),
          props: data.props,
          reason: data.reason,
        });
        return { status: SecurityBlockLiftStatus.Lifted };
      });
  });

  test("a playbook's lift lifts the address's own block, as OneUptime", async () => {
    active.push(madeBlock({ index: 1, value: ADDRESS }));

    const outcome: PlaybookStepOutcome =
      await SecurityPlaybookAddressBlocks.lift({
        projectId: PROJECT_ID,
        targets: [target(ADDRESS)],
        reason: "Lifted by playbook Lift on false positive.",
      });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.targets?.[0]).toMatchObject({
      state: SecurityPlaybookTargetState.Done,
      detail: "lifted",
    });
    expect(lifted).toEqual([
      {
        id: active[0]!.id!.toString(),
        props: { isRoot: true },
        reason: "Lifted by playbook Lift on false positive.",
      },
    ]);
  });

  test("an address nothing blocks is not blocked already", async () => {
    const outcome: PlaybookStepOutcome =
      await SecurityPlaybookAddressBlocks.lift({
        projectId: PROJECT_ID,
        targets: [target(ADDRESS)],
      });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.targets?.[0]).toMatchObject({
      state: SecurityPlaybookTargetState.AlreadyDone,
      detail: "not blocked",
    });
    expect(lifted).toEqual([]);
  });

  test("a range that holds it is left to a person: lifting it lets a whole network in", async () => {
    covering = madeBlock({ index: 9, value: "35.205.11.0/24" });

    const outcome: PlaybookStepOutcome =
      await SecurityPlaybookAddressBlocks.lift({
        projectId: PROJECT_ID,
        targets: [target(ADDRESS)],
      });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.targets?.[0]).toMatchObject({
      state: SecurityPlaybookTargetState.Failed,
      detail:
        "blocked by the range 35.205.11.0/24, which this step leaves alone: lift it on the Blocklist",
    });
    expect(lifted).toEqual([]);
  });

  test("an undo lifts the block its run made, as the person who undoes it", async () => {
    const own: SecurityBlock = madeBlock({ index: 1, value: ADDRESS });
    own.securityPlaybookRunId = RUN_ID;
    active.push(own);
    const person: { userId: ObjectID; tenantId: ObjectID } = {
      userId: PERSON_ID,
      tenantId: PROJECT_ID,
    };

    const outcome: Awaited<
      ReturnType<typeof SecurityPlaybookAddressBlocks.liftOne>
    > = await SecurityPlaybookAddressBlocks.liftOne({
      projectId: PROJECT_ID,
      value: ADDRESS,
      props: person,
      securityPlaybookRunId: RUN_ID,
    });

    expect(outcome).toEqual({
      state: SecurityPlaybookTargetState.Done,
      detail: "lifted",
    });
    expect(lifted[0]!.props).toBe(person);
  });

  test("an undo after someone made another block of the address leaves that one alone", async () => {
    // Made by another run: the undo's run made none.
    const another: SecurityBlock = madeBlock({ index: 2, value: ADDRESS });
    another.securityPlaybookRunId = new ObjectID(
      "55555555-5555-4555-8555-555555555555",
    );
    active.push(another);

    const outcome: Awaited<
      ReturnType<typeof SecurityPlaybookAddressBlocks.liftOne>
    > = await SecurityPlaybookAddressBlocks.liftOne({
      projectId: PROJECT_ID,
      value: ADDRESS,
      props: { isRoot: true },
      securityPlaybookRunId: RUN_ID,
    });

    expect(outcome.state).toBe(SecurityPlaybookTargetState.AlreadyDone);
    expect(lifted).toEqual([]);
  });

  test("a lift the person may not make fails, in the blocklist's words", async () => {
    active.push(madeBlock({ index: 1, value: ADDRESS }));
    jest
      .spyOn(SecurityBlockService, "lift")
      .mockRejectedValue(new Error("You do not have permissions to edit Block."));

    expect(
      await SecurityPlaybookAddressBlocks.liftOne({
        projectId: PROJECT_ID,
        value: ADDRESS,
        props: { userId: PERSON_ID },
      }),
    ).toEqual({
      state: SecurityPlaybookTargetState.Failed,
      detail: "You do not have permissions to edit Block.",
    });
  });

  test("a value that is no address is not found", async () => {
    expect(
      (
        await SecurityPlaybookAddressBlocks.liftOne({
          projectId: PROJECT_ID,
          value: "not-an-address",
          props: { isRoot: true },
        })
      ).state,
    ).toBe(SecurityPlaybookTargetState.NotFound);
  });
});

describe("the words", () => {
  test("destinations joined as a sentence lists them", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Cloudflare"])).toBe("Cloudflare");
    expect(joinNames(["Cloudflare", "AWS WAF"])).toBe("Cloudflare and AWS WAF");
    expect(joinNames(["Cloudflare", "AWS WAF", "Azure WAF"])).toBe(
      "Cloudflare, AWS WAF and Azure WAF",
    );
    expect(joinNames(["Cloudflare", " "])).toBe("Cloudflare");
  });

  test("a moment as the blocklist writes it at a provider", () => {
    expect(formatBlockTime(new Date("2026-11-21T10:42:59.000Z"))).toBe(
      "2026-11-21 10:42 UTC",
    );
  });

  test("a block with no destination row yet holds nowhere", () => {
    expect(
      describeAddressBlockMade({
        made: {
          block: madeBlock({ index: 1, value: ADDRESS }),
          summary: { isEnforced: false, enforcedAt: [], notEnforcedAt: [] },
          pendingAt: [],
        },
        hasDestinations: true,
      }),
    ).toEqual({
      detail: "blocked until 2026-11-22 10:42 UTC, but no destination holds it yet",
      isEnforcedSomewhere: false,
    });
  });
});

describe("a playbook's block expires", () => {
  function stepsOf(
    duration: SecurityBlockDuration,
  ): Array<SecurityPlaybookStep> {
    return parseSecurityPlaybookSteps([
      {
        action: SecurityPlaybookActionType.AddCaseNote,
        config: { note: "Blocking the scanner." },
      },
      {
        action: SecurityPlaybookActionType.BlockAddress,
        config: { blockAction: SecurityBlockAction.Block, duration },
      },
    ]);
  }

  test.each([
    SecurityBlockDuration.OneHour,
    SecurityBlockDuration.OneDay,
    SecurityBlockDuration.SevenDays,
    SecurityBlockDuration.ThirtyDays,
  ])("%s is a playbook's to choose", (duration: SecurityBlockDuration) => {
    expect(() => {
      assertPlaybookBlocksExpire(stepsOf(duration));
    }).not.toThrow();
  });

  test("until someone lifts it is a person's: a playbook saved with it is refused, naming the step", () => {
    expect(() => {
      assertPlaybookBlocksExpire(stepsOf(SecurityBlockDuration.UntilLifted));
    }).toThrow(
      "Step 2 (Block the address): a playbook's block expires. Choose 1 hour, 24 hours, 7 days or 30 days.",
    );
  });
});
