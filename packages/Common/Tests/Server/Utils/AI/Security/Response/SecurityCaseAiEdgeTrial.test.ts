import SecurityAutomaticResponsePolicy from "../../../../../../Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import SecurityAutomaticResponsePolicyService from "../../../../../../Server/Services/SecurityAutomaticResponsePolicyService";
import SecurityCaseAiEdgeTrial from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseAiEdgeTrial";
import ObjectID from "../../../../../../Types/ObjectID";
import {
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyKind,
} from "../../../../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SECURITY_CASE_AI_AREAS,
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiArea,
  SecurityCaseAiDecisionKind,
  SecurityCaseAiLimits,
  SecurityCaseAiMode,
  decideSecurityCaseAiAction,
} from "../../../../../../Types/SecurityCase/SecurityCaseAi";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../../../Server/Utils/Logger");

/*
 * EDGE'S ON ITS OWN, CLEARED BY THE SCANNERS POLICY'S TRIAL (#10352,
 * #10350).
 *
 * OneUptime AI blocks an address at the edge on its own only once someone
 * vouched for it: a Security Admin's confirmation, or the project's
 * Scanners policy having finished a whole week of trial run. The responder
 * asks automatic response whether it has (SecurityCaseAiEdgeTrial), and
 * this follows the answer from the policy's row to the decision: before
 * the week is over, On its own asks for the confirmation; after it, it
 * blocks without one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10350000-0000-4000-8000-000000000a01",
);
const NOW: Date = new Date("2026-11-23T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_IN_MS);
}

// Edge On its own, and no Security Admin's confirmation of it.
function edgeOnItsOwnUnconfirmed(): SecurityCaseAiLimits {
  const modes: Record<SecurityCaseAiArea, SecurityCaseAiMode> = {} as Record<
    SecurityCaseAiArea,
    SecurityCaseAiMode
  >;

  for (const area of SECURITY_CASE_AI_AREAS) {
    modes[area] = SecurityCaseAiMode.OnItsOwn;
  }

  return { isOn: true, modes, stamps: {} };
}

function scannersPolicy(
  fields: Partial<
    Pick<
      SecurityAutomaticResponsePolicy,
      | "mode"
      | "trialStartedAt"
      | "trialEndsAt"
      | "trialFinishedAt"
      | "trialSkippedAt"
    >
  >,
): SecurityAutomaticResponsePolicy {
  const policy: SecurityAutomaticResponsePolicy =
    new SecurityAutomaticResponsePolicy();

  policy.id = new ObjectID("10350000-0000-4000-8000-000000000a02");
  policy.kind = SecurityAutomaticResponsePolicyKind.Scanners;

  for (const [field, value] of Object.entries(fields)) {
    (policy as unknown as Record<string, unknown>)[field] = value;
  }

  return policy;
}

// The Scanners policy as the project has it, read once per question.
function givenScannersPolicy(
  policy: SecurityAutomaticResponsePolicy | null | Error,
): void {
  jest
    .spyOn(SecurityAutomaticResponsePolicyService, "findOneBy")
    .mockImplementation((async (data: {
      query: { projectId: ObjectID; kind: string };
    }): Promise<SecurityAutomaticResponsePolicy | null> => {
      expect(data.query.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(data.query.kind).toBe(SecurityAutomaticResponsePolicyKind.Scanners);

      if (policy instanceof Error) {
        throw policy;
      }

      return policy;
    }) as never);
}

async function decideEdgeBlock(): Promise<{
  cleared: boolean;
  decision: SecurityCaseAiDecisionKind;
  reason: SecurityCaseAiActionReason;
}> {
  const cleared: boolean =
    await SecurityCaseAiEdgeTrial.hasScannersPolicyFinishedTrial({
      projectId: PROJECT_ID,
      now: NOW,
    });
  const decision: ReturnType<typeof decideSecurityCaseAiAction> =
    decideSecurityCaseAiAction({
      kind: SecurityCaseAiActionKind.BlockAddress,
      limits: edgeOnItsOwnUnconfirmed(),
      hasScannersPolicyFinishedTrial: cleared,
    });

  return { cleared, decision: decision.decision, reason: decision.reason };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Edge's On its own, before the Scanners policy's trial is over", () => {
  test("a trial still running asks for a Security Admin's confirmation", async () => {
    givenScannersPolicy(
      scannersPolicy({
        mode: SecurityAutomaticResponseMode.TrialRun,
        trialStartedAt: daysFromNow(-3),
        trialEndsAt: daysFromNow(4),
      }),
    );

    expect(await decideEdgeBlock()).toEqual({
      cleared: false,
      decision: SecurityCaseAiDecisionKind.Ask,
      reason: SecurityCaseAiActionReason.EdgeNotCleared,
    });
  });

  test("a policy turned on without its week proves nothing, so it still asks", async () => {
    givenScannersPolicy(
      scannersPolicy({
        mode: SecurityAutomaticResponseMode.On,
        trialStartedAt: daysFromNow(-8),
        trialEndsAt: daysFromNow(-1),
        trialSkippedAt: daysFromNow(-6),
      }),
    );

    expect(await decideEdgeBlock()).toEqual({
      cleared: false,
      decision: SecurityCaseAiDecisionKind.Ask,
      reason: SecurityCaseAiActionReason.EdgeNotCleared,
    });
  });

  test("no Scanners policy yet, or one it cannot read: it asks", async () => {
    givenScannersPolicy(null);
    expect((await decideEdgeBlock()).decision).toBe(
      SecurityCaseAiDecisionKind.Ask,
    );

    jest.restoreAllMocks();
    givenScannersPolicy(new Error("connection reset"));
    expect(await decideEdgeBlock()).toEqual({
      cleared: false,
      decision: SecurityCaseAiDecisionKind.Ask,
      reason: SecurityCaseAiActionReason.EdgeNotCleared,
    });
  });
});

describe("Edge's On its own, once the Scanners policy finished its trial", () => {
  test("a week of trial run written down as finished clears it: it blocks without the confirmation", async () => {
    givenScannersPolicy(
      scannersPolicy({
        mode: SecurityAutomaticResponseMode.On,
        trialStartedAt: daysFromNow(-9),
        trialEndsAt: daysFromNow(-2),
        trialFinishedAt: daysFromNow(-2),
      }),
    );

    expect(await decideEdgeBlock()).toEqual({
      cleared: true,
      decision: SecurityCaseAiDecisionKind.Do,
      reason: SecurityCaseAiActionReason.OnItsOwn,
    });
  });

  test("a trial whose week is up clears it before the sweep writes it down", async () => {
    givenScannersPolicy(
      scannersPolicy({
        mode: SecurityAutomaticResponseMode.TrialRun,
        trialStartedAt: daysFromNow(-7),
        trialEndsAt: daysFromNow(-0.01),
      }),
    );

    expect((await decideEdgeBlock()).decision).toBe(
      SecurityCaseAiDecisionKind.Do,
    );
  });
});
