import AIRun from "../../../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiAction from "../../../../../../Models/DatabaseModels/SecurityCaseAiAction";
import SecurityCaseFeed from "../../../../../../Models/DatabaseModels/SecurityCaseFeed";
import Semaphore from "../../../../../../Server/Infrastructure/Semaphore";
import AIRunService from "../../../../../../Server/Services/AIRunService";
import ProjectService from "../../../../../../Server/Services/ProjectService";
import SecurityBlockService from "../../../../../../Server/Services/SecurityBlockService";
import SecurityCaseAiActionService from "../../../../../../Server/Services/SecurityCaseAiActionService";
import SecurityCaseFeedService from "../../../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../../../Server/Services/SecurityCaseService";
import SecurityCaseAiEdgeTrial from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseAiEdgeTrial";
import SecurityCaseAiTrackRecordReader from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseAiTrackRecordReader";
import SecurityCaseResponse from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponse";
import SecurityCaseResponseDecisions from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponseDecisions";
import SecurityCaseResponseLook, {
  LookOutcome,
  LookStop,
} from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponseLook";
import * as Planner from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponsePlanner";
import {
  ResponderHandOff,
  ResponderIntent,
  ResponderPlan,
} from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponsePlanner";
import SecurityCaseResponseProductOff, {
  SECURITY_CASE_AI_PRODUCT_OFF_STOPS_PER_TICK,
  SecurityCaseProductOffStop,
} from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponseProductOff";
import SecurityCaseResponseRunner from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponseRunner";
import SecurityCaseResponseToolkit, {
  ToolResult,
  ToolkitCase,
} from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponseToolkit";
import AIInvestigationQueue from "../../../../../../Server/Utils/AI/SRE/InvestigationQueue";
import SecurityBlockDestinations from "../../../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import SecurityCaseAiHold from "../../../../../../Server/Utils/SecurityCase/SecurityCaseAiHold";
import SecurityCaseHandOff from "../../../../../../Server/Utils/SecurityCase/SecurityCaseHandOff";
import SecurityCaseNotifications from "../../../../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import SecurityEventsSwitch from "../../../../../../Server/Utils/SecurityCase/SecurityEventsSwitch";
import ServerProducts from "../../../../../../Server/Utils/ServerProducts/ServerProducts";
import Includes from "../../../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../../../Types/ObjectID";
import ProductKey from "../../../../../../Types/Product/ProductKey";
import { ServerProductOffReason } from "../../../../../../Types/Product/ServerProductOffReason";
import {
  SECURITY_CASE_AI_ACTIVE_RESPONSE_STATES,
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
  SecurityCaseAiDecisionKind,
  SecurityCaseAiResponseState,
  SecurityCaseHandOffReason,
} from "../../../../../../Types/SecurityCase/SecurityCaseAi";
import {
  SECURITY_CASE_HAND_OFF_SENTENCES,
  SECURITY_CASE_RESPONSE_NOT_STARTED_MESSAGES,
} from "../../../../../../Types/SecurityCase/SecurityCaseAiWords";
import SecurityCaseAiVerdict from "../../../../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCasePriorityLevel from "../../../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../../../../Types/SecurityCase/SecurityCaseStage";
import { SecurityEntityType } from "../../../../../../Types/SecurityCase/SecurityEntity";
import {
  testPriorityId,
  testStatusId,
} from "../../../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../../../Helpers/SecurityCaseValuesStub";
import { getJestSpyOn } from "../../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

jest.mock("../../../../../../Server/Utils/Logger");

/*
 * SECURITY EVENTS SWITCHED OFF WHILE ONEUPTIME AI WORKS A CASE (#10816).
 *
 * The AI queue already took no run of a case while the product was off on
 * the server (#9489), but quietly: a case OneUptime AI worked stayed
 * "Working" with nothing working it, nobody was told, a look under way
 * kept carrying out its steps, and once the product was back the case was
 * taken up again on its own. Here, while it is off:
 *
 *   - a look under way starts no new step: what it started finishes in the
 *     engine, and the case goes to people, saying why, with the steps it
 *     was about to take left for a person;
 *   - no look starts, and every case OneUptime AI works goes to people
 *     within a minute (the every-minute job), a closed one done with;
 *   - a case it was about to take up after a triage goes to people too.
 *
 * Switched on again, nothing resumes on its own: a look claimed after a
 * hand-off does nothing, only Respond with AI takes the case up again.
 * Take Over still works while it is off, and stops a look before its next
 * step; where a look leaves the case never undoes a hand-off.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_CASE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222223",
);
const RUN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const PERSON_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const NOW: Date = new Date("2026-11-23T20:00:00.000Z");
const ADDRESS: string = "35.196.249.14";

// The steps of the case's Response Plan the look reads, by key.
const STEP_TAKE: string = "triage:assign";
const STEP_BLOCK: string = `contain:block-ip:${ADDRESS}`;
const STEP_CONTAINED: string = "contain:status";
const PRIORITY_KEY: string = "case:priority";

const PLAN_STEPS: Array<{
  key: string;
  text: { template: string; values: Record<string, string> };
}> = [
  { key: STEP_TAKE, text: { template: "Take the case.", values: {} } },
  {
    key: STEP_BLOCK,
    text: {
      template: "Block {{address}} at the edge.",
      values: { address: ADDRESS },
    },
  },
  {
    key: STEP_CONTAINED,
    text: { template: "Move the case to Contained.", values: {} },
  },
];

const SECURITY_CASE_API: string = path.resolve(
  __dirname,
  "../../../../../../Server/API/SecurityCaseAPI.ts",
);

// Security Events, as the server answers whether it is off.
let isProductOff: boolean;
// The cases, as the database holds them, by id.
let caseRows: Map<string, Record<string, unknown>>;
// What a look plans, in order, and what happens as each step is carried out.
let intents: Array<ResponderIntent>;
let plannedHandOff: ResponderHandOff | null;
let onCarryOut: ((intent: ResponderIntent) => void) | null;
// What was done.
let carriedOut: Array<string>;
let handOffs: Array<Record<string, unknown>>;
let stateWrites: Array<{
  id: string;
  data: Record<string, unknown>;
  expected: Record<string, unknown>;
  landed: boolean;
}>;
let updates: Array<{ id: string; data: Record<string, unknown> }>;
let reconciled: number;
let planned: number;
let enqueued: number;
let activeRun: AIRun | null;
let workingCases: Array<SecurityCase>;
let workingQuery: Record<string, unknown> | null;
let handToPeopleSpy: ReturnType<typeof getJestSpyOn>;

function caseRow(id: ObjectID = CASE_ID): Record<string, unknown> {
  return caseRows.get(id.toString())!;
}

function newCaseRow(id: ObjectID): Record<string, unknown> {
  return {
    _id: id.toString(),
    projectId: PROJECT_ID,
    title: `Web scanner from ${ADDRESS}`,
    entities: [{ type: SecurityEntityType.IpAddress, value: ADDRESS }],
    groupingKey: "detection:scanner",
    securityCaseStatusId: testStatusId(SecurityCaseStage.New),
    securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.Medium),
    aiVerdict: SecurityCaseAiVerdict.LikelyMalicious,
    aiResponseState: SecurityCaseAiResponseState.Working,
    aiNextLookAt: NOW,
    createdAt: new Date(NOW.getTime() - 30 * 60 * 1000),
  };
}

function intent(
  kind: SecurityCaseAiActionKind,
  stepKey: string,
  decision: SecurityCaseAiDecisionKind = SecurityCaseAiDecisionKind.Do,
): ResponderIntent {
  return {
    kind,
    stepKey,
    decision,
    reason:
      decision === SecurityCaseAiDecisionKind.Ask
        ? SecurityCaseAiActionReason.SettingAsks
        : SecurityCaseAiActionReason.OnItsOwn,
    mode: null,
    ...(kind === SecurityCaseAiActionKind.BlockAddress
      ? { target: ADDRESS }
      : {}),
  };
}

function productIsOff(): void {
  isProductOff = true;
}

async function look(): Promise<LookOutcome> {
  return await SecurityCaseResponseLook.look({
    projectId: PROJECT_ID,
    securityCaseId: CASE_ID,
    aiRunId: RUN_ID,
    now: NOW,
  });
}

beforeEach(() => {
  isProductOff = false;
  caseRows = new Map<string, Record<string, unknown>>([
    [CASE_ID.toString(), newCaseRow(CASE_ID)],
    [OTHER_CASE_ID.toString(), newCaseRow(OTHER_CASE_ID)],
  ]);
  intents = [
    intent(SecurityCaseAiActionKind.TakeCase, STEP_TAKE),
    intent(SecurityCaseAiActionKind.SetPriority, PRIORITY_KEY),
    intent(SecurityCaseAiActionKind.BlockAddress, STEP_BLOCK),
    intent(SecurityCaseAiActionKind.MarkContained, STEP_CONTAINED),
  ];
  plannedHandOff = null;
  onCarryOut = null;
  carriedOut = [];
  handOffs = [];
  stateWrites = [];
  updates = [];
  reconciled = 0;
  planned = 0;
  enqueued = 0;
  activeRun = null;
  workingCases = [];
  workingQuery = null;

  stubSecurityCaseValues();

  // Security Events, on or off on the server; every other product on.
  getJestSpyOn(ServerProducts, "getOffReasonOfServerWork").mockImplementation(
    async (product: ProductKey) => {
      return product === ProductKey.SecurityEvents && isProductOff
        ? ServerProductOffReason.SwitchedOff
        : null;
    },
  );

  getJestSpyOn(SecurityCaseService, "findOneBy").mockImplementation(
    async (args: { query: Record<string, unknown> }) => {
      const row: Record<string, unknown> | undefined = caseRows.get(
        String(args.query["_id"]),
      );

      if (!row) {
        return null;
      }

      const securityCase: SecurityCase = new SecurityCase(
        new ObjectID(String(row["_id"])),
      );
      Object.assign(securityCase, row);
      return securityCase;
    },
  );

  // As Postgres's compare-and-set: a write lands only on the values it expects.
  getJestSpyOn(
    SecurityCaseService,
    "compareAndSetColumnsByIdWithoutHooks",
  ).mockImplementation(
    async (args: {
      id: ObjectID;
      data: Record<string, unknown>;
      expectedData: Record<string, unknown>;
    }) => {
      const row: Record<string, unknown> | undefined = caseRows.get(
        args.id.toString(),
      );
      let landed: boolean = Boolean(row);

      for (const [column, expected] of Object.entries(args.expectedData)) {
        if (String(row?.[column] ?? null) !== String(expected ?? null)) {
          landed = false;
        }
      }

      stateWrites.push({
        id: args.id.toString(),
        data: args.data,
        expected: args.expectedData,
        landed,
      });

      if (landed) {
        Object.assign(row!, args.data);
      }

      return landed;
    },
  );

  getJestSpyOn(
    SecurityCaseService,
    "updateColumnsByIdWithoutHooks",
  ).mockImplementation(
    async (args: { id: ObjectID; data: Record<string, unknown> }) => {
      updates.push({ id: args.id.toString(), data: args.data });
      Object.assign(caseRows.get(args.id.toString()) || {}, args.data);
    },
  );

  getJestSpyOn(SecurityCaseService, "findBy").mockImplementation(
    async (args: { query: Record<string, unknown> }) => {
      workingQuery = args.query;
      return workingCases;
    },
  );

  getJestSpyOn(ProjectService, "findOneById").mockImplementation(async () => {
    const project: Project = new Project(PROJECT_ID);
    project.enableAi = true;
    project.enableAutomaticSecurityCaseResponse = true;
    return project;
  });

  // What a look reads beside the case: none of it decides anything here.
  getJestSpyOn(SecurityCaseResponseLook, "reconcile").mockImplementation(
    async () => {
      reconciled++;
      return [];
    },
  );
  getJestSpyOn(SecurityCaseResponseLook, "readPlan").mockImplementation(
    async () => {
      return {
        plan: { steps: PLAN_STEPS } as never,
        matches: null,
        playbooks: [],
      };
    },
  );
  getJestSpyOn(SecurityCaseResponseLook, "getAiGate").mockResolvedValue(null);
  getJestSpyOn(SecurityBlockService, "findBy").mockResolvedValue([]);
  getJestSpyOn(
    SecurityCaseAiEdgeTrial,
    "hasScannersPolicyFinishedTrial",
  ).mockResolvedValue(false);
  getJestSpyOn(SecurityBlockDestinations, "findForProject").mockResolvedValue({
    destinations: [],
  });
  getJestSpyOn(SecurityCaseAiTrackRecordReader, "read").mockResolvedValue(null);

  // The plan of the look: the intents above, the most urgent first.
  getJestSpyOn(Planner, "planSecurityCaseResponse").mockImplementation(
    (): ResponderPlan => {
      planned++;
      return {
        handOff: plannedHandOff,
        intents,
        waits: [],
        quietUntil: null,
        isFinished: false,
      };
    },
  );

  // Each step, through the engine: recorded here, and what happens meanwhile.
  getJestSpyOn(SecurityCaseResponseToolkit, "carryOut").mockImplementation(
    async (
      _toolkit: ToolkitCase,
      carried: ResponderIntent,
    ): Promise<ToolResult> => {
      carriedOut.push(carried.stepKey);
      onCarryOut?.(carried);
      return { status: SecurityCaseAiActionStatus.Doing };
    },
  );

  // A hand-off, as SecurityCaseHandOff makes it: once, and not of a closed case.
  handToPeopleSpy = getJestSpyOn(
    SecurityCaseHandOff,
    "handToPeople",
  ).mockImplementation(
    async (args: {
      securityCaseId: ObjectID;
      reason: SecurityCaseHandOffReason;
    }): Promise<boolean> => {
      handOffs.push(args as unknown as Record<string, unknown>);

      const row: Record<string, unknown> | undefined = caseRows.get(
        args.securityCaseId.toString(),
      );

      if (
        !row ||
        row["closedAt"] ||
        row["aiResponseState"] === SecurityCaseAiResponseState.HandedToPeople ||
        row["aiResponseState"] === SecurityCaseAiResponseState.Finished
      ) {
        return false;
      }

      row["aiResponseState"] = SecurityCaseAiResponseState.HandedToPeople;
      row["aiHandOffReason"] = args.reason;
      row["aiNextLookAt"] = null;
      return true;
    },
  );

  // Starting a look: the case's start lock, its runs and the AI queue.
  getJestSpyOn(Semaphore, "lock").mockResolvedValue({ key: "lock" });
  getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined);
  getJestSpyOn(AIRunService, "findOneBy").mockImplementation(async () => {
    return activeRun;
  });
  getJestSpyOn(AIInvestigationQueue, "enqueue").mockImplementation(async () => {
    enqueued++;
    return RUN_ID;
  });
  getJestSpyOn(SecurityCaseAiHold, "reviewSoon").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Security Events switched off while a look is under way", () => {
  test("the step under way finishes, no new step starts, and the case goes to people saying why, with the steps it had not got to left for a person", async () => {
    // Switched off as the engine takes the first step.
    onCarryOut = (carried: ResponderIntent): void => {
      if (carried.stepKey === STEP_TAKE) {
        productIsOff();
      }
    };

    const outcome: LookOutcome = await look();

    expect(carriedOut).toEqual([STEP_TAKE]);
    expect(outcome).toEqual({
      handedOff: SecurityCaseHandOffReason.ProductOff,
      carriedOut: 1,
      waits: [],
      isFinished: false,
      nextLookAt: null,
      isNoLongerWorking: false,
    });
    expect(handOffs).toEqual([
      {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        reason: SecurityCaseHandOffReason.ProductOff,
        // The plan's steps only: the priority it would have raised is no step of it.
        stepKeys: [STEP_BLOCK, STEP_CONTAINED],
        stepTitles: {
          [STEP_BLOCK]: `Block ${ADDRESS} at the edge.`,
          [STEP_CONTAINED]: "Move the case to Contained.",
        },
        aiRunId: RUN_ID,
        now: NOW,
      },
    ]);
    expect(caseRow()["aiResponseState"]).toBe(
      SecurityCaseAiResponseState.HandedToPeople,
    );
    expect(caseRow()["aiHandOffReason"]).toBe(
      SecurityCaseHandOffReason.ProductOff,
    );
    // Nothing says it still works the case, or when it looks again.
    expect(stateWrites).toEqual([]);
    expect(caseRow()["aiNextLookAt"]).toBeNull();
  });

  test("off before its first step: it records how what it started went, plans and starts nothing, and hands the case over", async () => {
    productIsOff();

    const outcome: LookOutcome = await look();

    expect(reconciled).toBe(1);
    expect(planned).toBe(0);
    expect(carriedOut).toEqual([]);
    expect(outcome.handedOff).toBe(SecurityCaseHandOffReason.ProductOff);
    expect(outcome.carriedOut).toBe(0);
    expect(handOffs).toHaveLength(1);
    expect(handOffs[0]!["reason"]).toBe(SecurityCaseHandOffReason.ProductOff);
    expect(handOffs[0]!["stepKeys"]).toEqual([]);
    expect(handOffs[0]!["aiRunId"]).toEqual(RUN_ID);
  });

  test("a case closed meanwhile is done with, as a look leaves a closed case: no hand-off, nobody told", async () => {
    productIsOff();
    caseRow()["closedAt"] = NOW;
    caseRow()["aiResponseState"] = SecurityCaseAiResponseState.WaitingForPeople;

    const outcome: LookOutcome = await look();

    expect(outcome.isFinished).toBe(true);
    expect(outcome.handedOff).toBeNull();
    expect(handOffs).toEqual([]);
    expect(caseRow()["aiResponseState"]).toBe(
      SecurityCaseAiResponseState.Finished,
    );
    expect(stateWrites).toEqual([
      {
        id: CASE_ID.toString(),
        data: {
          aiResponseState: SecurityCaseAiResponseState.Finished,
          aiNextLookAt: null,
        },
        expected: {
          projectId: PROJECT_ID,
          aiResponseState: SecurityCaseAiResponseState.WaitingForPeople,
        },
        landed: true,
      },
    ]);
  });

  test("a case another hand-off got to first is left as it is", async () => {
    productIsOff();
    // The every-minute job handed it over a moment ago.
    onCarryOut = null;
    getJestSpyOn(SecurityCaseResponseLook, "reconcile").mockImplementation(
      async () => {
        caseRow()["aiResponseState"] =
          SecurityCaseAiResponseState.HandedToPeople;
        return [];
      },
    );

    const outcome: LookOutcome = await look();

    expect(outcome.isNoLongerWorking).toBe(true);
    expect(outcome.handedOff).toBeNull();
    expect(stateWrites).toEqual([]);
  });

  test("Security Events on: every step is carried out and where it stands is set, as before", async () => {
    const outcome: LookOutcome = await look();

    expect(carriedOut).toEqual([
      STEP_TAKE,
      PRIORITY_KEY,
      STEP_BLOCK,
      STEP_CONTAINED,
    ]);
    expect(handOffs).toEqual([]);
    expect(outcome.carriedOut).toBe(4);
    expect(outcome.isNoLongerWorking).toBe(false);
    expect(outcome.nextLookAt).toEqual(new Date(NOW.getTime() + 2 * 60 * 1000));
    expect(stateWrites).toEqual([
      {
        id: CASE_ID.toString(),
        data: {
          aiResponseState: SecurityCaseAiResponseState.Working,
          aiNextLookAt: new Date(NOW.getTime() + 2 * 60 * 1000),
        },
        expected: {
          projectId: PROJECT_ID,
          aiResponseState: SecurityCaseAiResponseState.Working,
        },
        landed: true,
      },
    ]);
  });

  test("before each step it asks again: the switch is read once per step, never cached by the look", async () => {
    const products: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ServerProducts,
      "getOffReasonOfServerWork",
    );

    await look();

    // Once after reading how its steps went, then once before each of the four.
    expect(products).toHaveBeenCalledTimes(5);
    expect(products).toHaveBeenCalledWith(ProductKey.SecurityEvents);
  });
});

describe("a case handed to people stays theirs", () => {
  test("a look claimed after a hand-off does nothing - as one queued while the product was off does once it is back on", async () => {
    caseRow()["aiResponseState"] = SecurityCaseAiResponseState.HandedToPeople;
    caseRow()["aiHandOffReason"] = SecurityCaseHandOffReason.ProductOff;

    const outcome: LookOutcome = await look();

    expect(outcome).toEqual({
      handedOff: null,
      carriedOut: 0,
      waits: [],
      isFinished: false,
      nextLookAt: null,
      isNoLongerWorking: true,
    });
    expect(reconciled).toBe(0);
    expect(planned).toBe(0);
    expect(carriedOut).toEqual([]);
    expect(stateWrites).toEqual([]);
    expect(updates).toEqual([]);
    expect(caseRow()["aiResponseState"]).toBe(
      SecurityCaseAiResponseState.HandedToPeople,
    );
  });

  test("Take Over while it looks stops it before its next step, and the case stays the person's", async () => {
    onCarryOut = (carried: ResponderIntent): void => {
      if (carried.stepKey === STEP_TAKE) {
        // Take Over, pressed while the engine took the first step.
        caseRow()["aiResponseState"] =
          SecurityCaseAiResponseState.HandedToPeople;
        caseRow()["aiHandOffReason"] = SecurityCaseHandOffReason.TakenOver;
      }
    };

    const outcome: LookOutcome = await look();

    expect(carriedOut).toEqual([STEP_TAKE]);
    expect(outcome.isNoLongerWorking).toBe(true);
    expect(outcome.carriedOut).toBe(1);
    expect(handOffs).toEqual([]);
    expect(stateWrites).toEqual([]);
    expect(caseRow()["aiResponseState"]).toBe(
      SecurityCaseAiResponseState.HandedToPeople,
    );
    expect(caseRow()["aiHandOffReason"]).toBe(
      SecurityCaseHandOffReason.TakenOver,
    );
  });

  test("a hand-off while its last step ran is never undone by where the look leaves the case", async () => {
    intents = [intent(SecurityCaseAiActionKind.TakeCase, STEP_TAKE)];
    onCarryOut = (): void => {
      caseRow()["aiResponseState"] = SecurityCaseAiResponseState.HandedToPeople;
    };

    const outcome: LookOutcome = await look();

    expect(outcome.isNoLongerWorking).toBe(true);
    expect(caseRow()["aiResponseState"]).toBe(
      SecurityCaseAiResponseState.HandedToPeople,
    );
    // It tried each state the case may still be its own in - never a hand-off's.
    expect(
      stateWrites.map(
        (write: { expected: Record<string, unknown>; landed: boolean }) => {
          return [write.expected["aiResponseState"], write.landed];
        },
      ),
    ).toEqual([
      [SecurityCaseAiResponseState.Working, false],
      [SecurityCaseAiResponseState.WaitingForPeople, false],
      [SecurityCaseAiResponseState.Finished, false],
    ]);
  });

  test("a case closed while it looked is looked at once more, as before: only a hand-off is final", async () => {
    intents = [
      intent(SecurityCaseAiActionKind.TakeCase, STEP_TAKE),
      intent(SecurityCaseAiActionKind.BlockAddress, STEP_BLOCK),
    ];
    onCarryOut = (carried: ResponderIntent): void => {
      if (carried.stepKey === STEP_TAKE) {
        // Closed meanwhile: the case service finishes OneUptime AI's work on it.
        caseRow()["aiResponseState"] = SecurityCaseAiResponseState.Finished;
      }
    };

    const outcome: LookOutcome = await look();

    expect(carriedOut).toEqual([STEP_TAKE, STEP_BLOCK]);
    expect(outcome.isNoLongerWorking).toBe(false);
    expect(caseRow()["aiResponseState"]).toBe(
      SecurityCaseAiResponseState.Working,
    );
  });

  test("a step that waits on a person leaves the case waiting for people, as before", async () => {
    intents = [
      intent(
        SecurityCaseAiActionKind.BlockAddress,
        STEP_BLOCK,
        SecurityCaseAiDecisionKind.Ask,
      ),
    ];

    await look();

    expect(caseRow()["aiResponseState"]).toBe(
      SecurityCaseAiResponseState.WaitingForPeople,
    );
  });

  test("what stops a look before its next step", async () => {
    expect(
      await SecurityCaseResponseLook.getStop({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toBeNull();

    caseRow()["aiResponseState"] = SecurityCaseAiResponseState.WaitingForPeople;

    expect(
      await SecurityCaseResponseLook.getStop({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toBeNull();

    caseRow()["aiResponseState"] = SecurityCaseAiResponseState.HandedToPeople;

    expect(
      await SecurityCaseResponseLook.getStop({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toBe(LookStop.HandedOver);

    // Gone: nothing to go on with.
    expect(
      await SecurityCaseResponseLook.getStop({
        projectId: PROJECT_ID,
        securityCaseId: new ObjectID("99999999-9999-4999-8999-999999999999"),
      }),
    ).toBe(LookStop.HandedOver);

    // The switch is asked first: off, whatever the case says.
    productIsOff();

    expect(
      await SecurityCaseResponseLook.getStop({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toBe(LookStop.ProductOff);
  });

  test("the run's activity says what the look did", () => {
    const base: LookOutcome = {
      handedOff: null,
      carriedOut: 0,
      waits: [],
      isFinished: false,
      nextLookAt: null,
      isNoLongerWorking: false,
    };

    expect(
      SecurityCaseResponseRunner.describe({
        ...base,
        handedOff: SecurityCaseHandOffReason.ProductOff,
      }),
    ).toBe("Handed the case to people (ProductOff).");
    expect(
      SecurityCaseResponseRunner.describe({ ...base, isNoLongerWorking: true }),
    ).toBe("Did nothing: the case was handed to people.");
    expect(
      SecurityCaseResponseRunner.describe({
        ...base,
        isNoLongerWorking: true,
        carriedOut: 2,
      }),
    ).toBe(
      "Carried out 2 step(s), then stopped: the case was handed to people.",
    );
  });
});

describe("no look starts while Security Events is off", () => {
  test("the every-minute job starts none: every case OneUptime AI works goes to people, a closed one is done with", async () => {
    productIsOff();
    caseRow(OTHER_CASE_ID)["closedAt"] = NOW;
    workingCases = [CASE_ID, OTHER_CASE_ID].map((id: ObjectID) => {
      const row: SecurityCase = new SecurityCase(id);
      row.projectId = PROJECT_ID;
      return row;
    });

    expect(await SecurityCaseResponse.startDueLooks(NOW)).toBe(0);

    // No look leased or queued.
    expect(enqueued).toBe(0);
    expect(
      stateWrites.filter((write: { data: Record<string, unknown> }) => {
        return write.data["aiNextLookAt"] instanceof Date;
      }),
    ).toEqual([]);

    // Every case it works, whenever its next look was due, by the index its looks are read by.
    expect(workingQuery).not.toBeNull();
    expect((workingQuery!["aiResponseState"] as Includes).values).toEqual([
      ...SECURITY_CASE_AI_ACTIVE_RESPONSE_STATES,
    ]);
    expect(
      (
        workingQuery!["aiNextLookAt"] as { getSql: (alias: string) => string }
      ).getSql('"aiNextLookAt"'),
    ).toBe('("aiNextLookAt" IS NOT NULL)');

    expect(
      handOffs.map((handOff: Record<string, unknown>) => {
        return [String(handOff["securityCaseId"]), handOff["reason"]];
      }),
    ).toEqual([[CASE_ID.toString(), SecurityCaseHandOffReason.ProductOff]]);
    expect(caseRow(CASE_ID)["aiResponseState"]).toBe(
      SecurityCaseAiResponseState.HandedToPeople,
    );
    expect(caseRow(OTHER_CASE_ID)["aiResponseState"]).toBe(
      SecurityCaseAiResponseState.Finished,
    );
  });

  test("a long list is worked through tick by tick, oldest look first", async () => {
    let read: Record<string, unknown> | undefined;

    getJestSpyOn(SecurityCaseService, "findBy").mockImplementation(
      async (args: Record<string, unknown>) => {
        read = args;
        return [];
      },
    );

    expect(await SecurityCaseResponseProductOff.stopEveryCase(NOW)).toBe(0);
    expect(read!["limit"]).toBe(SECURITY_CASE_AI_PRODUCT_OFF_STOPS_PER_TICK);
    expect(read!["sort"]).toEqual({ aiNextLookAt: SortOrder.Ascending });
    expect(read!["props"]).toEqual({ isRoot: true });
  });

  test("a case that cannot be handed over is tried again next minute; the rest still go", async () => {
    workingCases = [CASE_ID, OTHER_CASE_ID].map((id: ObjectID) => {
      const row: SecurityCase = new SecurityCase(id);
      row.projectId = PROJECT_ID;
      return row;
    });
    handToPeopleSpy.mockImplementation(
      async (args: { securityCaseId: ObjectID }): Promise<boolean> => {
        if (args.securityCaseId.toString() === CASE_ID.toString()) {
          throw new Error("The database went away.");
        }

        caseRow(OTHER_CASE_ID)["aiResponseState"] =
          SecurityCaseAiResponseState.HandedToPeople;
        return true;
      },
    );

    expect(await SecurityCaseResponseProductOff.stopEveryCase(NOW)).toBe(1);
    expect(caseRow(OTHER_CASE_ID)["aiResponseState"]).toBe(
      SecurityCaseAiResponseState.HandedToPeople,
    );
  });

  test("the cases cannot be read: nothing is stopped, and nothing throws", async () => {
    getJestSpyOn(SecurityCaseService, "findBy").mockRejectedValue(
      new Error("The database went away."),
    );

    expect(await SecurityCaseResponseProductOff.stopEveryCase(NOW)).toBe(0);
    expect(handOffs).toEqual([]);
  });

  test.each([true, false])(
    "a look the starter would queue (first look: %s) is not queued: the case goes to people, saying why",
    async (isFirstLook: boolean) => {
      productIsOff();

      if (isFirstLook) {
        // Not taken up yet: its triage just read it.
        caseRow()["aiResponseState"] = null;
      }

      expect(
        await SecurityCaseResponse.startLook({
          projectId: PROJECT_ID,
          securityCaseId: CASE_ID,
          isFirstLook,
        }),
      ).toBeNull();
      expect(Semaphore.lock).not.toHaveBeenCalled();
      expect(enqueued).toBe(0);
      // Never marked as OneUptime AI's to work.
      expect(updates).toEqual([]);
      expect(handOffs).toHaveLength(1);
      expect(handOffs[0]!["reason"]).toBe(SecurityCaseHandOffReason.ProductOff);
      expect(caseRow()["aiResponseState"]).toBe(
        SecurityCaseAiResponseState.HandedToPeople,
      );
    },
  );

  test("why OneUptime AI cannot work the project's cases: Security Events off, after AI and its switch", async () => {
    expect(
      await SecurityCaseResponse.getNotStartedReason({ projectId: PROJECT_ID }),
    ).toBeNull();

    productIsOff();

    expect(
      await SecurityCaseResponse.getNotStartedReason({ projectId: PROJECT_ID }),
    ).toBe("product_off");

    // A project that does not let OneUptime AI work cases says so first: there is nothing of its own to hand over.
    getJestSpyOn(ProjectService, "findOneById").mockImplementation(async () => {
      const project: Project = new Project(PROJECT_ID);
      project.enableAi = true;
      project.enableAutomaticSecurityCaseResponse = false;
      return project;
    });

    expect(
      await SecurityCaseResponse.getNotStartedReason({ projectId: PROJECT_ID }),
    ).toBe("response_disabled");

    getJestSpyOn(ProjectService, "findOneById").mockImplementation(async () => {
      const project: Project = new Project(PROJECT_ID);
      project.enableAi = false;
      project.enableAutomaticSecurityCaseResponse = true;
      return project;
    });

    expect(
      await SecurityCaseResponse.getNotStartedReason({ projectId: PROJECT_ID }),
    ).toBe("ai_disabled");
  });

  test("a triage that read the case as Likely Malicious while the product is off hands it to people instead of starting a look", async () => {
    productIsOff();
    caseRow()["aiResponseState"] = null;

    await SecurityCaseResponse.startAfterTriage({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      verdict: SecurityCaseAiVerdict.LikelyMalicious,
      isSteeringTextFound: false,
    });

    expect(enqueued).toBe(0);
    expect(updates).toEqual([]);
    expect(handOffs).toHaveLength(1);
    expect(handOffs[0]!["reason"]).toBe(SecurityCaseHandOffReason.ProductOff);
  });

  test("a triage of a case it would not work anyway hands nothing over", async () => {
    productIsOff();
    caseRow()["aiResponseState"] = null;

    await SecurityCaseResponse.startAfterTriage({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      verdict: SecurityCaseAiVerdict.LikelyBenign,
      isSteeringTextFound: false,
    });

    expect(enqueued).toBe(0);
    expect(handOffs).toEqual([]);
  });

  test("Respond with AI is turned down, saying where Security Events is switched back on", async () => {
    productIsOff();

    expect(
      await SecurityCaseResponse.startForPerson({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toEqual({ started: false, code: "product_off" });
    expect(enqueued).toBe(0);
    expect(SECURITY_CASE_RESPONSE_NOT_STARTED_MESSAGES.product_off).toBe(
      "Security Events is switched off on this server. A server admin can switch it on in Admin Dashboard > Settings > Products.",
    );
  });

  test("the route refuses Respond with AI while the product is off, before anything is read", () => {
    const api: string = fs.readFileSync(SECURITY_CASE_API, "utf8");
    const start: string = routeOf(
      api,
      "`${basePath}/:caseId/ai-response/start`",
    );

    expect(start).toContain(
      "ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents)",
    );
  });
});

describe("Security Events switched back on", () => {
  test("the every-minute job looks only at cases OneUptime AI still works: a case handed over is not taken up", async () => {
    caseRow()["aiResponseState"] = SecurityCaseAiResponseState.HandedToPeople;

    expect(await SecurityCaseResponse.startDueLooks(NOW)).toBe(0);
    expect(workingQuery).not.toBeNull();
    expect((workingQuery!["aiResponseState"] as Includes).values).not.toContain(
      SecurityCaseAiResponseState.HandedToPeople,
    );
    expect(enqueued).toBe(0);
    expect(handOffs).toEqual([]);
  });

  test("Respond with AI takes the case up again, afresh: it is OneUptime AI's, and a look is queued", async () => {
    caseRow()["aiResponseState"] = SecurityCaseAiResponseState.HandedToPeople;
    caseRow()["aiHandOffReason"] = SecurityCaseHandOffReason.ProductOff;
    caseRow()["aiNextLookAt"] = null;

    expect(
      await SecurityCaseResponse.startForPerson({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toEqual({ started: true, runId: RUN_ID });
    expect(enqueued).toBe(1);
    expect(updates[0]!.data).toEqual(
      expect.objectContaining({
        aiResponseState: SecurityCaseAiResponseState.Working,
        aiHandOffReason: null,
      }),
    );

    // And that look goes on with the case.
    const outcome: LookOutcome = await look();

    expect(outcome.isNoLongerWorking).toBe(false);
    expect(carriedOut).toHaveLength(4);
  });
});

describe("Take Over while Security Events is off", () => {
  test("hands the case to the person, telling nobody, and a look claimed after it does nothing", async () => {
    productIsOff();
    handToPeopleSpy.mockRestore();

    const rows: Array<SecurityCaseAiAction> = [];
    const told: Array<unknown> = [];

    getJestSpyOn(SecurityCaseAiActionService, "create").mockImplementation(
      async (args: { data: SecurityCaseAiAction }) => {
        rows.push(args.data);
        return args.data;
      },
    );
    getJestSpyOn(
      SecurityCaseFeedService,
      "createSecurityCaseFeedItem",
    ).mockResolvedValue(new SecurityCaseFeed());
    getJestSpyOn(SecurityCaseNotifications, "aiHandedOff").mockImplementation(
      async (args: unknown) => {
        told.push(args);
      },
    );
    getJestSpyOn(SecurityCaseAiHold, "onHandedToPeople").mockResolvedValue(
      false,
    );

    expect(
      await SecurityCaseResponseDecisions.takeOver({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        props: { userId: PERSON_ID },
      }),
    ).toBe(true);
    expect(caseRow()["aiResponseState"]).toBe(
      SecurityCaseAiResponseState.HandedToPeople,
    );
    expect(caseRow()["aiHandOffReason"]).toBe(
      SecurityCaseHandOffReason.TakenOver,
    );
    expect(rows[0]!.decidedByUserId).toEqual(PERSON_ID);
    expect(told).toEqual([]);

    // The look queued before it, claimed now, leaves the case to the person.
    expect((await look()).isNoLongerWorking).toBe(true);
    expect(carriedOut).toEqual([]);
  });

  test("its route is never refused while a product is off: stopping OneUptime AI is never held back", () => {
    const api: string = fs.readFileSync(SECURITY_CASE_API, "utf8");
    const takeOver: string = routeOf(
      api,
      "`${basePath}/:caseId/ai-response/take-over`",
    );

    expect(takeOver).toContain("SecurityCaseResponseDecisions.takeOver");
    expect(takeOver).not.toContain("refuseWhileOff");
  });
});

describe("the switch and the words", () => {
  test("Security Events is read as the server's own work reads a product: off for any reason, and a read that fails is on", async () => {
    expect(await SecurityEventsSwitch.isOff()).toBe(false);

    for (const reason of [
      ServerProductOffReason.SwitchedOff,
      ServerProductOffReason.TelemetryIngestionStopped,
    ]) {
      getJestSpyOn(
        ServerProducts,
        "getOffReasonOfServerWork",
      ).mockResolvedValue(reason);

      expect(await SecurityEventsSwitch.isOff()).toBe(true);
    }

    getJestSpyOn(ServerProducts, "getOffReasonOfServerWork").mockRejectedValue(
      new Error("The products could not be read."),
    );

    expect(await SecurityEventsSwitch.isOff()).toBe(false);
    expect(await SecurityCaseResponseProductOff.isOff()).toBe(false);
    expect(await SecurityCaseAiHold.isProductOff()).toBe(false);
  });

  test("one case, stopped: once, and only a case OneUptime AI works or was about to take up", async () => {
    productIsOff();

    expect(
      await SecurityCaseResponseProductOff.stopCase({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toBe(SecurityCaseProductOffStop.HandedOff);
    // Handed over already: once.
    expect(
      await SecurityCaseResponseProductOff.stopCase({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toBe(SecurityCaseProductOffStop.None);

    // Closed, and its close finished OneUptime AI's work on it already.
    caseRow(OTHER_CASE_ID)["closedAt"] = NOW;
    caseRow(OTHER_CASE_ID)["aiResponseState"] =
      SecurityCaseAiResponseState.Finished;

    expect(
      await SecurityCaseResponseProductOff.stopCase({
        projectId: PROJECT_ID,
        securityCaseId: OTHER_CASE_ID,
      }),
    ).toBe(SecurityCaseProductOffStop.Finished);
    expect(stateWrites).toEqual([]);

    // Closed, and handed over before.
    caseRow(OTHER_CASE_ID)["aiResponseState"] =
      SecurityCaseAiResponseState.HandedToPeople;

    expect(
      await SecurityCaseResponseProductOff.stopCase({
        projectId: PROJECT_ID,
        securityCaseId: OTHER_CASE_ID,
      }),
    ).toBe(SecurityCaseProductOffStop.None);

    // Gone.
    expect(
      await SecurityCaseResponseProductOff.stopCase({
        projectId: PROJECT_ID,
        securityCaseId: new ObjectID("99999999-9999-4999-8999-999999999999"),
      }),
    ).toBe(SecurityCaseProductOffStop.None);
    expect(handOffs).toHaveLength(2);
  });

  test("the hand-off's reason is worded for the card, the timeline and the notices", () => {
    expect(
      SECURITY_CASE_HAND_OFF_SENTENCES[SecurityCaseHandOffReason.ProductOff],
    ).toBe(
      "Security Events is switched off on this server, so OneUptime AI stopped working the case.",
    );
  });
});

// One route's handler, from its path to the next route.
function routeOf(api: string, routePath: string): string {
  const start: number = api.indexOf(routePath);

  expect(start).toBeGreaterThan(-1);

  const next: number = api.indexOf("this.router.", start + routePath.length);

  return api.slice(start, next === -1 ? undefined : next);
}
