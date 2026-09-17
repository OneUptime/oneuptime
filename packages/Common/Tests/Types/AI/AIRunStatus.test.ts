import AIRunStatus, { AIRunStatusHelper } from "../../../Types/AI/AIRunStatus";

describe("AIRunStatusHelper", () => {
  /*
   * Database guards spell "still live" as notIn(terminalStatuses()), so the
   * list and the predicate must never disagree — a status missing from the
   * list turns a finished run into a permanent dedupe block.
   */
  describe("terminalStatuses", () => {
    test("lists every terminal status and nothing else", () => {
      const terminal: Array<AIRunStatus> = Object.values(AIRunStatus).filter(
        (status: AIRunStatus): boolean => {
          return AIRunStatusHelper.isTerminalStatus(status);
        },
      );

      expect(AIRunStatusHelper.terminalStatuses().sort()).toEqual(
        terminal.sort(),
      );
    });

    test("includes NoFixFound — a run that found no fix is over", () => {
      expect(AIRunStatusHelper.terminalStatuses()).toContain(
        AIRunStatus.NoFixFound,
      );
    });
  });

  describe("isTerminalStatus", () => {
    test.each([
      AIRunStatus.Completed,
      AIRunStatus.NoFixFound,
      AIRunStatus.Error,
      AIRunStatus.Cancelled,
      AIRunStatus.Stale,
    ])("returns true for terminal status %s", (status: AIRunStatus) => {
      expect(AIRunStatusHelper.isTerminalStatus(status)).toBe(true);
    });

    test.each([
      AIRunStatus.Queued,
      AIRunStatus.Running,
      AIRunStatus.WaitingForApproval,
    ])("returns false for non-terminal status %s", (status: AIRunStatus) => {
      expect(AIRunStatusHelper.isTerminalStatus(status)).toBe(false);
    });

    /*
     * A run that finished with no fix is DONE. Were it treated as non-terminal,
     * the exception page would report a task still in flight forever: no retry
     * offered, and the duplicate guard would refuse to start a new run.
     */
    test("NoFixFound is terminal — it is a result, not an in-flight run", () => {
      expect(AIRunStatusHelper.isTerminalStatus(AIRunStatus.NoFixFound)).toBe(
        true,
      );
    });

    test("every status in the enum is classified", () => {
      for (const status of Object.values(AIRunStatus)) {
        expect(typeof AIRunStatusHelper.isTerminalStatus(status)).toBe(
          "boolean",
        );
      }
    });
  });
});
