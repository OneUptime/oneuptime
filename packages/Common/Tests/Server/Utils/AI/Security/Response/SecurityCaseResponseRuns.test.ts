import AIRun from "../../../../../../Models/DatabaseModels/AIRun";
import AIRunService from "../../../../../../Server/Services/AIRunService";
import SecurityCaseService from "../../../../../../Server/Services/SecurityCaseService";
import Semaphore from "../../../../../../Server/Infrastructure/Semaphore";
import SecurityCaseResponse from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponse";
import AIInvestigationQueue, {
  QUEUED_RUN_TYPES,
  RUNS_NEVER_HANDED_BACK,
} from "../../../../../../Server/Utils/AI/SRE/InvestigationQueue";
import SecurityCaseHandOff from "../../../../../../Server/Utils/SecurityCase/SecurityCaseHandOff";
import AIRunType from "../../../../../../Types/AI/AIRunType";
import ObjectID from "../../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../../Types/PositiveNumber";
import {
  SecurityCaseAiResponseState,
  SecurityCaseHandOffReason,
} from "../../../../../../Types/SecurityCase/SecurityCaseAi";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../../../Server/Utils/Logger");

/*
 * ONEUPTIME AI'S RUNS ON A CASE (#10352): a look at a case changes things
 * outside the run - blocks, containments, the case - so a server shutting
 * down never hands one back mid-way, and a case has one look queued or
 * running at a time: a second start while one is on its way adds nothing,
 * and the queue leaves a run waiting while another of the case's runs
 * executes. A look the project's AI budget turns down hands the case to
 * people, saying so.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const RUN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

let activeRun: AIRun | null;
let enqueued: number;
let caseWrites: Array<Record<string, unknown>>;
let handOffs: Array<SecurityCaseHandOffReason>;
let notEnqueuedCode: string | null;

beforeEach(() => {
  activeRun = null;
  enqueued = 0;
  caseWrites = [];
  handOffs = [];
  notEnqueuedCode = null;

  jest.spyOn(Semaphore, "lock").mockImplementation((async () => {
    return { key: "lock" };
  }) as never);
  jest.spyOn(Semaphore, "release").mockImplementation((async () => {
    return undefined;
  }) as never);
  jest.spyOn(AIRunService, "findOneBy").mockImplementation((async () => {
    return activeRun;
  }) as never);
  jest
    .spyOn(SecurityCaseService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (args: { data: Record<string, unknown> }) => {
      caseWrites.push(args.data);
    }) as never);
  jest.spyOn(AIInvestigationQueue, "enqueue").mockImplementation((async (args: {
    isSecurityCaseResponse?: boolean;
    onNotEnqueued?: (code: string) => Promise<void>;
  }) => {
    expect(args.isSecurityCaseResponse).toBe(true);

    if (notEnqueuedCode) {
      await args.onNotEnqueued?.(notEnqueuedCode);
      return null;
    }

    enqueued++;
    return RUN_ID;
  }) as never);
  jest
    .spyOn(SecurityCaseHandOff, "handToPeople")
    .mockImplementation((async (args: {
      reason: SecurityCaseHandOffReason;
    }) => {
      handOffs.push(args.reason);
      return true;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a look's run", () => {
  test("changes things outside the run, so a server shutting down never hands it back", () => {
    expect(RUNS_NEVER_HANDED_BACK).toContain(AIRunType.SecurityCaseResponse);
    expect(QUEUED_RUN_TYPES).toContain(AIRunType.SecurityCaseResponse);
  });

  test("a first look takes the case and queues the run", async () => {
    expect(
      await SecurityCaseResponse.startLook({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        isFirstLook: true,
      }),
    ).toEqual(RUN_ID);
    expect(enqueued).toBe(1);
    expect(caseWrites[0]).toEqual(
      expect.objectContaining({
        aiResponseState: SecurityCaseAiResponseState.Working,
        aiHandOffReason: null,
      }),
    );
  });

  test("one per case: while a look is queued or running, another start adds nothing", async () => {
    activeRun = new AIRun(RUN_ID);

    expect(
      await SecurityCaseResponse.startLook({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        isFirstLook: false,
      }),
    ).toBeNull();
    expect(enqueued).toBe(0);
  });

  test("another start holding the case's lock queues it: this one adds nothing", async () => {
    jest.spyOn(Semaphore, "lock").mockImplementation((async () => {
      throw new Error("Lock is held.");
    }) as never);

    expect(
      await SecurityCaseResponse.startLook({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        isFirstLook: true,
      }),
    ).toBeNull();
    expect(enqueued).toBe(0);
    expect(caseWrites).toEqual([]);
  });

  test.each(["daily_budget_exhausted", "project_daily_limit_reached"])(
    "turned down by the budget (%s): the case goes to people, saying so",
    async (code: string) => {
      notEnqueuedCode = code;

      expect(
        await SecurityCaseResponse.startLook({
          projectId: PROJECT_ID,
          securityCaseId: CASE_ID,
          isFirstLook: true,
        }),
      ).toBeNull();
      expect(handOffs).toEqual([SecurityCaseHandOffReason.OutOfCredits]);
    },
  );

  test("the queue holds a run while another of the case's runs executes", async () => {
    let counted: Record<string, unknown> | undefined;

    jest.spyOn(AIRunService, "countBy").mockImplementation((async (args: {
      query: Record<string, unknown>;
    }) => {
      counted = args.query;
      return new PositiveNumber(1);
    }) as never);

    expect(
      await AIInvestigationQueue.isSecurityCaseResponseRunning({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        exceptRunId: RUN_ID,
      }),
    ).toBe(true);
    expect(counted).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        runType: AIRunType.SecurityCaseResponse,
        triggeredBySecurityCaseId: CASE_ID,
      }),
    );

    jest.spyOn(AIRunService, "countBy").mockImplementation((async () => {
      return new PositiveNumber(0);
    }) as never);

    expect(
      await AIInvestigationQueue.isSecurityCaseResponseRunning({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toBe(false);
  });
});
