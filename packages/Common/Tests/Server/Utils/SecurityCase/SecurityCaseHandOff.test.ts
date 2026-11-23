import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiAction from "../../../../Models/DatabaseModels/SecurityCaseAiAction";
import SecurityCaseFeed, {
  SecurityCaseFeedEventType,
} from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCaseAiActionService from "../../../../Server/Services/SecurityCaseAiActionService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityCaseHandOff from "../../../../Server/Utils/SecurityCase/SecurityCaseHandOff";
import SecurityCaseNotifications from "../../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import ObjectID from "../../../../Types/ObjectID";
import {
  SECURITY_CASE_AI_HAND_OFF_STEP_KEY,
  SecurityCaseAiActionKind,
  SecurityCaseAiActionStatus,
  SecurityCaseAiResponseState,
  SecurityCaseHandOffReason,
} from "../../../../Types/SecurityCase/SecurityCaseAi";
import { SECURITY_CASE_HAND_OFF_SENTENCES } from "../../../../Types/SecurityCase/SecurityCaseAiWords";
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
 * HANDING A CASE TO PEOPLE (#10352): OneUptime AI never stands down
 * quietly. A hand-off sets where it stands on the case, logs why, says so
 * on the timeline as OneUptime AI's, and tells the people on the case -
 * once, and never for a person who took the case over, who has it. #10353
 * calls the same.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PERSON_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const NOW: Date = new Date("2026-11-22T12:00:00.000Z");

let state: SecurityCaseAiResponseState | null;
let closedAt: Date | null;
let isSetWins: boolean;
let sets: Array<{ data: Record<string, unknown>; expected: unknown }>;
let logged: Array<SecurityCaseAiAction>;
let feed: Array<Record<string, unknown>>;
let told: Array<{ reason: SecurityCaseHandOffReason }>;

beforeEach(() => {
  state = SecurityCaseAiResponseState.Working;
  closedAt = null;
  isSetWins = true;
  sets = [];
  logged = [];
  feed = [];
  told = [];

  jest.spyOn(SecurityCaseService, "findOneBy").mockImplementation((async () => {
    const securityCase: SecurityCase = new SecurityCase(CASE_ID);
    securityCase.aiResponseState = state as never;

    if (closedAt) {
      securityCase.closedAt = closedAt;
    }

    return securityCase;
  }) as never);
  jest
    .spyOn(SecurityCaseService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (args: {
      data: Record<string, unknown>;
      expectedData: unknown;
    }) => {
      sets.push({ data: args.data, expected: args.expectedData });
      return isSetWins;
    }) as never);
  jest
    .spyOn(SecurityCaseAiActionService, "create")
    .mockImplementation((async (args: { data: SecurityCaseAiAction }) => {
      logged.push(args.data);
      return args.data;
    }) as never);
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation((async (args: Record<string, unknown>) => {
      feed.push(args);
      return new SecurityCaseFeed();
    }) as never);
  jest
    .spyOn(SecurityCaseNotifications, "aiHandedOff")
    .mockImplementation((async (args: {
      reason: SecurityCaseHandOffReason;
    }) => {
      told.push({ reason: args.reason });
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a hand-off", () => {
  test("sets where OneUptime AI stands, logs why, says so on the timeline and tells the people on the case", async () => {
    const isHandedOver: boolean = await SecurityCaseHandOff.handToPeople({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      reason: SecurityCaseHandOffReason.ProtectedTarget,
      stepKeys: ["contain:block-ip:10.0.0.1"],
      stepTitles: { "contain:block-ip:10.0.0.1": "Block 10.0.0.1." },
      now: NOW,
    });

    expect(isHandedOver).toBe(true);
    expect(sets).toEqual([
      {
        data: {
          aiResponseState: SecurityCaseAiResponseState.HandedToPeople,
          aiHandOffReason: SecurityCaseHandOffReason.ProtectedTarget,
          aiNextLookAt: null,
        },
        expected: { aiResponseState: SecurityCaseAiResponseState.Working },
      },
    ]);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toEqual(
      expect.objectContaining({
        kind: SecurityCaseAiActionKind.HandToPeople,
        status: SecurityCaseAiActionStatus.Done,
        handOffReason: SecurityCaseHandOffReason.ProtectedTarget,
        stepKey: SECURITY_CASE_AI_HAND_OFF_STEP_KEY,
      }),
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]!["eventType"]).toBe(SecurityCaseFeedEventType.AiResponse);
    expect(String(feed[0]!["feedInfoInMarkdown"])).toContain(
      "AI handed this case to people.",
    );
    expect(String(feed[0]!["feedInfoInMarkdown"])).toContain(
      SECURITY_CASE_HAND_OFF_SENTENCES[
        SecurityCaseHandOffReason.ProtectedTarget
      ],
    );
    expect(String(feed[0]!["moreInformationInMarkdown"])).toContain(
      "Block 10.0.0.1.",
    );
    expect(told).toEqual([
      { reason: SecurityCaseHandOffReason.ProtectedTarget },
    ]);
  });

  test.each([
    SecurityCaseHandOffReason.SteeringText,
    SecurityCaseHandOffReason.HighestPriority,
    SecurityCaseHandOffReason.BreakerTripped,
    SecurityCaseHandOffReason.AiOff,
    SecurityCaseHandOffReason.OutOfCredits,
    SecurityCaseHandOffReason.DidNotHold,
    SecurityCaseHandOffReason.Declined,
    SecurityCaseHandOffReason.OnlyPeopleCanDo,
    SecurityCaseHandOffReason.CannotTell,
  ])("%s: people are told", async (reason: SecurityCaseHandOffReason) => {
    await SecurityCaseHandOff.handToPeople({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      reason,
      now: NOW,
    });

    expect(told).toEqual([{ reason }]);
  });

  test("a person who took the case over has it: nobody else is told", async () => {
    await SecurityCaseHandOff.handToPeople({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      reason: SecurityCaseHandOffReason.TakenOver,
      byUserId: PERSON_ID,
      now: NOW,
    });

    expect(told).toEqual([]);
    expect(logged[0]!.decidedByUserId).toEqual(PERSON_ID);
    expect(feed[0]!["userId"]).toEqual(PERSON_ID);
  });

  test("once: a case already handed over, or done with, or closed, is not handed over again", async () => {
    for (const already of [
      SecurityCaseAiResponseState.HandedToPeople,
      SecurityCaseAiResponseState.Finished,
    ]) {
      state = already;

      expect(
        await SecurityCaseHandOff.handToPeople({
          projectId: PROJECT_ID,
          securityCaseId: CASE_ID,
          reason: SecurityCaseHandOffReason.DidNotHold,
        }),
      ).toBe(false);
    }

    state = SecurityCaseAiResponseState.Working;
    closedAt = NOW;

    expect(
      await SecurityCaseHandOff.handToPeople({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        reason: SecurityCaseHandOffReason.DidNotHold,
      }),
    ).toBe(false);
    expect(sets).toEqual([]);
    expect(told).toEqual([]);
  });

  test("another look that handed it over first wins: nobody is told twice", async () => {
    isSetWins = false;

    expect(
      await SecurityCaseHandOff.handToPeople({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        reason: SecurityCaseHandOffReason.DidNotHold,
      }),
    ).toBe(false);
    expect(logged).toEqual([]);
    expect(feed).toEqual([]);
    expect(told).toEqual([]);
  });

  test("every reason has the words people read", () => {
    for (const reason of Object.values(SecurityCaseHandOffReason)) {
      expect(SECURITY_CASE_HAND_OFF_SENTENCES[reason]).toMatch(/\.$/);
    }
  });
});
