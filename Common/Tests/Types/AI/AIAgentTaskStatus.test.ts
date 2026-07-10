import AIAgentTaskStatus, {
  AIAgentTaskStatusHelper,
  AIAgentTaskStatusProps,
} from "../../../Types/AI/AIAgentTaskStatus";

describe("AIAgentTaskStatusHelper", () => {
  describe("getAllStatusProps", () => {
    test("returns one entry per status with a title and description", () => {
      const props: Array<AIAgentTaskStatusProps> =
        AIAgentTaskStatusHelper.getAllStatusProps();

      const statuses: Array<AIAgentTaskStatus> =
        Object.values(AIAgentTaskStatus);
      expect(props.length).toBe(statuses.length);

      for (const prop of props) {
        expect(typeof prop.title).toBe("string");
        expect(prop.title.length).toBeGreaterThan(0);
        expect(typeof prop.description).toBe("string");
        expect(prop.description.length).toBeGreaterThan(0);
      }
    });

    test("covers every status in the enum exactly once", () => {
      const seen: Set<AIAgentTaskStatus> = new Set<AIAgentTaskStatus>();
      for (const prop of AIAgentTaskStatusHelper.getAllStatusProps()) {
        expect(seen.has(prop.status)).toBe(false);
        seen.add(prop.status);
      }

      for (const status of Object.values(AIAgentTaskStatus)) {
        expect(seen.has(status)).toBe(true);
      }
    });
  });

  describe("getTitle", () => {
    test("returns the configured title for a known status", () => {
      expect(
        AIAgentTaskStatusHelper.getTitle(AIAgentTaskStatus.InProgress),
      ).toBe("In Progress");
      expect(
        AIAgentTaskStatusHelper.getTitle(AIAgentTaskStatus.Completed),
      ).toBe("Completed");
    });

    test("returns an empty string for an unknown status", () => {
      expect(
        AIAgentTaskStatusHelper.getTitle("NonExistent" as AIAgentTaskStatus),
      ).toBe("");
    });
  });

  describe("getDescription", () => {
    test("returns a non-empty description for a known status", () => {
      expect(
        AIAgentTaskStatusHelper.getDescription(AIAgentTaskStatus.Scheduled)
          .length,
      ).toBeGreaterThan(0);
    });

    test("returns an empty string for an unknown status", () => {
      expect(
        AIAgentTaskStatusHelper.getDescription(
          "NonExistent" as AIAgentTaskStatus,
        ),
      ).toBe("");
    });
  });

  describe("isTerminalStatus", () => {
    test.each([AIAgentTaskStatus.Completed, AIAgentTaskStatus.Error])(
      "returns true for terminal status %s",
      (status: AIAgentTaskStatus) => {
        expect(AIAgentTaskStatusHelper.isTerminalStatus(status)).toBe(true);
      },
    );

    test.each([AIAgentTaskStatus.Scheduled, AIAgentTaskStatus.InProgress])(
      "returns false for non-terminal status %s",
      (status: AIAgentTaskStatus) => {
        expect(AIAgentTaskStatusHelper.isTerminalStatus(status)).toBe(false);
      },
    );
  });
});
