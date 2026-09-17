enum AIAgentTaskStatus {
  Scheduled = "Scheduled",
  InProgress = "InProgress",
  Completed = "Completed",
  /*
   * The agent finished cleanly but had no fix to propose, so it opened no
   * pull request. Reported instead of Error so a negative result is not
   * counted as a failure — see AIRunStatus.NoFixFound, which this maps to.
   */
  NoFixFound = "NoFixFound",
  Error = "Error",
}

export default AIAgentTaskStatus;

export interface AIAgentTaskStatusProps {
  status: AIAgentTaskStatus;
  title: string;
  description: string;
}

export class AIAgentTaskStatusHelper {
  public static getAllStatusProps(): Array<AIAgentTaskStatusProps> {
    return [
      {
        status: AIAgentTaskStatus.Scheduled,
        title: "Scheduled",
        description:
          "Task is scheduled and waiting to be picked up by an agent.",
      },
      {
        status: AIAgentTaskStatus.InProgress,
        title: "In Progress",
        description: "Task is currently being processed by an AI agent.",
      },
      {
        status: AIAgentTaskStatus.Completed,
        title: "Completed",
        description: "Task has been completed successfully.",
      },
      {
        status: AIAgentTaskStatus.NoFixFound,
        title: "No Fix Found",
        description:
          "Task ran successfully but AI did not find a fix to propose.",
      },
      {
        status: AIAgentTaskStatus.Error,
        title: "Error",
        description: "Task encountered an error during execution.",
      },
    ];
  }

  public static getDescription(status: AIAgentTaskStatus): string {
    const props: AIAgentTaskStatusProps | undefined =
      this.getAllStatusProps().find((p: AIAgentTaskStatusProps) => {
        return p.status === status;
      });
    return props?.description || "";
  }

  public static getTitle(status: AIAgentTaskStatus): string {
    const props: AIAgentTaskStatusProps | undefined =
      this.getAllStatusProps().find((p: AIAgentTaskStatusProps) => {
        return p.status === status;
      });
    return props?.title || "";
  }

  public static isTerminalStatus(status: AIAgentTaskStatus): boolean {
    return (
      status === AIAgentTaskStatus.Completed ||
      status === AIAgentTaskStatus.NoFixFound ||
      status === AIAgentTaskStatus.Error
    );
  }
}
