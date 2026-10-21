import RemediationVerifier from "../../../../Server/Utils/AutoRemediation/RemediationVerifier";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlanUtil,
  ExternalMcpToolCallStatus,
} from "../../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Verifying a fix through MCP servers: its record is the plan on the
 * suggestion. A change that failed fails the fix; changes still being made
 * wait (until the window ends); once every change was made, recovery is
 * judged as every fix's is - the signal resolved, or its monitors
 * operational. Nothing is ever undone: an MCP tool has no undo OneUptime
 * can know of, so a failed fix is for a person to look at.
 */

interface VerificationOutcome {
  status: AutoRemediationVerificationStatus;
  note: string;
  pingWorkspace: boolean;
  shouldAutoResolve: boolean;
}

type VerifierInternals = {
  evaluate: (
    suggestion: AutoRemediationSuggestion,
  ) => Promise<VerificationOutcome | null>;
  isSubjectResolved: (
    suggestion: AutoRemediationSuggestion,
  ) => Promise<boolean>;
  areSubjectMonitorsOperational: (
    suggestion: AutoRemediationSuggestion,
  ) => Promise<boolean | null>;
};

const verifier: VerifierInternals =
  RemediationVerifier as unknown as VerifierInternals;

const FUTURE: Date = new Date(Date.now() + 10 * 60 * 1000);
const PAST: Date = new Date(Date.now() - 10 * 60 * 1000);

function call(
  sequence: number,
  status: ExternalMcpToolCallStatus,
): ExternalMcpToolCall {
  return {
    sequence,
    serverId: "9a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b01",
    serverNameSnapshot: "AWS",
    toolName: "restart_service",
    arguments: { service: "api" },
    status,
  };
}

function fix(
  calls: Array<ExternalMcpToolCall> | null,
  overrides: Record<string, unknown> = {},
): AutoRemediationSuggestion {
  return {
    id: new ObjectID("9a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b02"),
    incidentId: new ObjectID("9a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b03"),
    suggestionType: AutoRemediationSuggestionType.McpToolCalls,
    mcpToolCallPlan: calls
      ? ExternalMcpToolCallPlanUtil.toJSON({ calls })
      : null,
    verificationDeadlineAt: FUTURE,
    autoResolveOnRecovery: true,
    ...overrides,
  } as unknown as AutoRemediationSuggestion;
}

function recovery(data: {
  resolved?: boolean;
  monitorsOperational?: boolean | null;
}): void {
  jest
    .spyOn(verifier, "isSubjectResolved")
    .mockResolvedValue(data.resolved === true);
  jest
    .spyOn(verifier, "areSubjectMonitorsOperational")
    .mockResolvedValue(
      data.monitorsOperational === undefined ? false : data.monitorsOperational,
    );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("verifying a fix through MCP servers", () => {
  it("a fix with no change recorded is skipped, quietly", async () => {
    recovery({});

    for (const calls of [null, []]) {
      const outcome: VerificationOutcome | null = await verifier.evaluate(
        fix(calls),
      );
      expect(outcome?.status).toBe(AutoRemediationVerificationStatus.Skipped);
      expect(outcome?.pingWorkspace).toBe(false);
    }
  });

  it("a change that failed fails the fix, says nothing was undone, and never auto-resolves", async () => {
    recovery({ resolved: true, monitorsOperational: true });

    const outcome: VerificationOutcome | null = await verifier.evaluate(
      fix([
        call(1, ExternalMcpToolCallStatus.Succeeded),
        call(2, ExternalMcpToolCallStatus.Failed),
        call(3, ExternalMcpToolCallStatus.Skipped),
      ]),
    );

    expect(outcome?.status).toBe(AutoRemediationVerificationStatus.Failed);
    expect(outcome?.note).toContain("Nothing was undone");
    expect(outcome?.shouldAutoResolve).toBe(false);
  });

  it("waits while changes are still being made or not yet sent, and fails once the window is over", async () => {
    recovery({ resolved: true, monitorsOperational: true });

    for (const status of [
      ExternalMcpToolCallStatus.Running,
      ExternalMcpToolCallStatus.Proposed,
    ]) {
      expect(
        await verifier.evaluate(
          fix([call(1, ExternalMcpToolCallStatus.Succeeded), call(2, status)]),
        ),
      ).toBeNull();

      const late: VerificationOutcome | null = await verifier.evaluate(
        fix([call(1, status)], { verificationDeadlineAt: PAST }),
      );
      expect(late?.status).toBe(AutoRemediationVerificationStatus.Failed);
    }
  });

  it("every change skipped: nothing was made, so nothing is verified", async () => {
    recovery({ resolved: true });

    const outcome: VerificationOutcome | null = await verifier.evaluate(
      fix([call(1, ExternalMcpToolCallStatus.Skipped)]),
    );

    expect(outcome?.status).toBe(AutoRemediationVerificationStatus.Skipped);
  });

  it("made, and the signal was resolved: verified", async () => {
    recovery({ resolved: true });

    const outcome: VerificationOutcome | null = await verifier.evaluate(
      fix([call(1, ExternalMcpToolCallStatus.Succeeded)]),
    );

    expect(outcome?.status).toBe(AutoRemediationVerificationStatus.Verified);
  });

  it("made, and the monitors are operational again: verified, resolving the signal when the rule says so", async () => {
    recovery({ monitorsOperational: true });

    const outcome: VerificationOutcome | null = await verifier.evaluate(
      fix([call(1, ExternalMcpToolCallStatus.Succeeded)]),
    );

    expect(outcome?.status).toBe(AutoRemediationVerificationStatus.Verified);
    expect(outcome?.shouldAutoResolve).toBe(true);

    const withoutAutoResolve: VerificationOutcome | null =
      await verifier.evaluate(
        fix([call(1, ExternalMcpToolCallStatus.Succeeded)], {
          autoResolveOnRecovery: false,
        }),
      );
    expect(withoutAutoResolve?.shouldAutoResolve).toBe(false);
  });

  it("made, and nothing recovered: waits for the window, then fails without undoing anything", async () => {
    recovery({ monitorsOperational: false });

    expect(
      await verifier.evaluate(
        fix([call(1, ExternalMcpToolCallStatus.Succeeded)]),
      ),
    ).toBeNull();

    const late: VerificationOutcome | null = await verifier.evaluate(
      fix([call(1, ExternalMcpToolCallStatus.Succeeded)], {
        verificationDeadlineAt: PAST,
      }),
    );

    expect(late?.status).toBe(AutoRemediationVerificationStatus.Failed);
    expect(late?.note).toContain("Nothing was undone");
  });

  it("no monitors to judge by: skipped", async () => {
    recovery({ monitorsOperational: null });

    const outcome: VerificationOutcome | null = await verifier.evaluate(
      fix([call(1, ExternalMcpToolCallStatus.Succeeded)]),
    );

    expect(outcome?.status).toBe(AutoRemediationVerificationStatus.Skipped);
  });
});
