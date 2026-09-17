import AIInsightStatus, {
  AIInsightStatusHelper,
} from "../../../Types/AI/AIInsightStatus";

describe("AIInsightStatusHelper.isTerminalStatus", () => {
  test("the two human end states are terminal", () => {
    expect(
      AIInsightStatusHelper.isTerminalStatus(AIInsightStatus.Resolved),
    ).toBe(true);
    expect(
      AIInsightStatusHelper.isTerminalStatus(AIInsightStatus.Dismissed),
    ).toBe(true);
  });

  test("the scanner-owned lifecycle states are not terminal", () => {
    /*
     * Detected/ActionRequired/FixOpened are the states a detector may still
     * refresh (dedupe into). If any were treated as terminal the scanner
     * would stop updating a live insight.
     */
    expect(
      AIInsightStatusHelper.isTerminalStatus(AIInsightStatus.Detected),
    ).toBe(false);
    expect(
      AIInsightStatusHelper.isTerminalStatus(AIInsightStatus.ActionRequired),
    ).toBe(false);
    expect(
      AIInsightStatusHelper.isTerminalStatus(AIInsightStatus.FixOpened),
    ).toBe(false);
  });

  test("exactly two of the five statuses are terminal", () => {
    const terminalCount: number = Object.values(AIInsightStatus).filter(
      (status: AIInsightStatus) => {
        return AIInsightStatusHelper.isTerminalStatus(status);
      },
    ).length;
    expect(terminalCount).toBe(2);
  });
});
