import AIChatMessageStatus, {
  AIChatMessageStatusHelper,
} from "../../../Types/AI/AIChatMessageStatus";

describe("AIChatMessageStatusHelper", () => {
  const allStatuses: Array<AIChatMessageStatus> =
    Object.values(AIChatMessageStatus);

  describe("isTerminalStatus", () => {
    test("Completed and Error are terminal", () => {
      expect(
        AIChatMessageStatusHelper.isTerminalStatus(
          AIChatMessageStatus.Completed,
        ),
      ).toBe(true);
      expect(
        AIChatMessageStatusHelper.isTerminalStatus(AIChatMessageStatus.Error),
      ).toBe(true);
    });

    test("in-flight statuses are not terminal", () => {
      expect(
        AIChatMessageStatusHelper.isTerminalStatus(AIChatMessageStatus.Pending),
      ).toBe(false);
      expect(
        AIChatMessageStatusHelper.isTerminalStatus(
          AIChatMessageStatus.InProgress,
        ),
      ).toBe(false);
      expect(
        AIChatMessageStatusHelper.isTerminalStatus(
          AIChatMessageStatus.WaitingForApproval,
        ),
      ).toBe(false);
    });
  });

  describe("isActiveStatus", () => {
    test("Pending, InProgress and WaitingForApproval are active", () => {
      expect(
        AIChatMessageStatusHelper.isActiveStatus(AIChatMessageStatus.Pending),
      ).toBe(true);
      expect(
        AIChatMessageStatusHelper.isActiveStatus(
          AIChatMessageStatus.InProgress,
        ),
      ).toBe(true);
      expect(
        AIChatMessageStatusHelper.isActiveStatus(
          AIChatMessageStatus.WaitingForApproval,
        ),
      ).toBe(true);
    });

    test("terminal statuses are not active", () => {
      expect(
        AIChatMessageStatusHelper.isActiveStatus(AIChatMessageStatus.Completed),
      ).toBe(false);
      expect(
        AIChatMessageStatusHelper.isActiveStatus(AIChatMessageStatus.Error),
      ).toBe(false);
    });
  });

  test("active and terminal are mutually exclusive and jointly exhaustive", () => {
    /*
     * Every status must be exactly one of active or terminal — a status that
     * is neither would hang a spinner forever; one that is both is a
     * contradiction. This guards against a new enum member being added
     * without wiring it into both predicates.
     */
    for (const status of allStatuses) {
      const active: boolean = AIChatMessageStatusHelper.isActiveStatus(status);
      const terminal: boolean =
        AIChatMessageStatusHelper.isTerminalStatus(status);
      expect(active).not.toBe(terminal);
    }
  });
});
