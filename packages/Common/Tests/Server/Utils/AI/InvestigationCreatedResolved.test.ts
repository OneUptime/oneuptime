import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import InvestigationEligibility from "../../../../Server/Utils/AI/SRE/InvestigationEligibility";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import { InvestigationNotStartedCode } from "../../../../Types/AI/InvestigationNotStartedReason";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * AN INCIDENT OR ALERT CREATED ALREADY RESOLVED IS NOT INVESTIGATED - AND ITS
 * AI CARD SAYS WHY, IN THE RIGHT ORDER.
 *
 * A record created already resolved (Common/Utils/StartingStage) was over
 * before it was recorded: there is nothing for an automatic investigation to
 * find. Its create hands the runner `createdResolved`, and the runner records
 * the reason on the record's AI card (InvestigationEligibility.recordSkipped)
 * in one order:
 *
 *   1. What stops OneUptime AI for the whole project - AI turned off,
 *      automatic investigation off, no provider, no credits, the project's
 *      daily limit. The card then names that, with what to change: for a
 *      project where AI is off or out of credits, "ask OneUptime AI about it"
 *      would not work either.
 *   2. Otherwise, that it was created resolved ("created_resolved").
 *
 * Either way no cost gate is read and nothing is queued. A live record goes
 * on to the gates and the queue exactly as before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4eee-8fff-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4eee-8fff-0000000000d1",
);
const ALERT_ID: ObjectID = new ObjectID("0193c0de-5a7e-4eee-8fff-0000000000d2");

const PROJECT_WIDE_REASONS: Array<InvestigationNotStartedCode> = [
  "ai_disabled",
  "automatic_investigation_disabled",
  "provider_missing",
  "insufficient_ai_balance",
  "project_daily_limit_reached",
];

interface Recorded {
  subject: Record<string, unknown>;
  code: string;
}

type Runner = (data: {
  projectId: ObjectID;
  createdResolved?: boolean | undefined;
}) => Promise<boolean>;

interface RunnerCase {
  name: string;
  subjectKey: string;
  subjectId: ObjectID;
  runnerClass: Record<string, unknown>;
  gateName: string;
  run: Runner;
}

const RUNNERS: Array<RunnerCase> = [
  {
    name: "an incident",
    subjectKey: "incidentId",
    subjectId: INCIDENT_ID,
    runnerClass: AIIncidentInvestigationRunner as unknown as Record<
      string,
      unknown
    >,
    gateName: "shouldInvestigateIncident",
    run: (data: {
      projectId: ObjectID;
      createdResolved?: boolean | undefined;
    }): Promise<boolean> => {
      return AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId: INCIDENT_ID,
        ...data,
      });
    },
  },
  {
    name: "an alert",
    subjectKey: "alertId",
    subjectId: ALERT_ID,
    runnerClass: AIAlertInvestigationRunner as unknown as Record<
      string,
      unknown
    >,
    gateName: "shouldInvestigateAlert",
    run: (data: {
      projectId: ObjectID;
      createdResolved?: boolean | undefined;
    }): Promise<boolean> => {
      return AIAlertInvestigationRunner.investigateNewAlert({
        alertId: ALERT_ID,
        ...data,
      });
    },
  },
];

let recorded: Array<Recorded> = [];
let gated: number = 0;
let queued: number = 0;
let disabledReason: InvestigationNotStartedCode | null = null;

function stubAround(runner: RunnerCase): void {
  jest
    .spyOn(AIInvestigationEngine, "getDisabledReason")
    .mockImplementation((async (): Promise<InvestigationNotStartedCode | null> => {
      return disabledReason;
    }) as never);

  jest
    .spyOn(runner.runnerClass as Record<string, () => unknown>, runner.gateName)
    .mockImplementation((async () => {
      gated++;
      return {
        investigate: false,
        notStartedCode: "severity_below_threshold",
        reason: "below the floor",
      };
    }) as never);

  jest.spyOn(AIInvestigationQueue, "enqueue").mockImplementation((async () => {
    queued++;
    return ObjectID.generate();
  }) as never);

  jest
    .spyOn(InvestigationEligibility, "recordSkipped")
    .mockImplementation((async (
      subject: Record<string, unknown>,
      code: string,
    ): Promise<void> => {
      recorded.push({ subject: { ...subject }, code: code });
    }) as never);
}

beforeEach(() => {
  recorded = [];
  gated = 0;
  queued = 0;
  disabledReason = null;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(RUNNERS)("$name created resolved", (runner: RunnerCase) => {
  test("is not investigated, and its AI card says it was created resolved", async () => {
    stubAround(runner);

    const enqueued: boolean = await runner.run({
      projectId: PROJECT_ID,
      createdResolved: true,
    });

    expect(enqueued).toBe(false);
    expect(recorded).toEqual([
      {
        subject: {
          [runner.subjectKey]: runner.subjectId,
          projectId: PROJECT_ID,
        },
        code: "created_resolved",
      },
    ]);
    expect(gated).toBe(0);
    expect(queued).toBe(0);
  });

  test.each(PROJECT_WIDE_REASONS)(
    "when %s stops OneUptime AI for the project, its AI card names that instead",
    async (reason: InvestigationNotStartedCode) => {
      disabledReason = reason;
      stubAround(runner);

      const enqueued: boolean = await runner.run({
        projectId: PROJECT_ID,
        createdResolved: true,
      });

      expect(enqueued).toBe(false);
      expect(
        recorded.map((entry: Recorded): string => {
          return entry.code;
        }),
      ).toEqual([reason]);
      expect(gated).toBe(0);
      expect(queued).toBe(0);
    },
  );

  test("the subject recorded is the record and its project, and nothing else", async () => {
    stubAround(runner);

    await runner.run({ projectId: PROJECT_ID, createdResolved: true });

    expect(Object.keys(recorded[0]!.subject).sort()).toEqual(
      [runner.subjectKey, "projectId"].sort(),
    );
  });
});

describe.each(RUNNERS)(
  "$name created live goes to the gates as before",
  (runner: RunnerCase) => {
    test.each([
      ["told it is live", false],
      ["told nothing", undefined],
    ] as Array<[string, boolean | undefined]>)(
      "%s: the cost gates decide, and their reason is recorded",
      async (_name: string, createdResolved: boolean | undefined) => {
        stubAround(runner);

        const enqueued: boolean = await runner.run({
          projectId: PROJECT_ID,
          ...(createdResolved === undefined
            ? {}
            : { createdResolved: createdResolved }),
        });

        expect(enqueued).toBe(false);
        expect(gated).toBe(1);
        expect(
          recorded.map((entry: Recorded): string => {
            return entry.code;
          }),
        ).toEqual(["severity_below_threshold"]);
      },
    );

    test("with the gates passing, the investigation is queued", async () => {
      stubAround(runner);
      jest
        .spyOn(
          runner.runnerClass as Record<string, () => unknown>,
          runner.gateName,
        )
        .mockImplementation((async () => {
          gated++;
          return { investigate: true, reason: "ok" };
        }) as never);

      const enqueued: boolean = await runner.run({
        projectId: PROJECT_ID,
        createdResolved: false,
      });

      expect(enqueued).toBe(true);
      expect(queued).toBe(1);
      expect(recorded).toEqual([]);
    });
  },
);
