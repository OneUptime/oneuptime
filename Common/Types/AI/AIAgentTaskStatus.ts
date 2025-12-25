enum AIAgentTaskStatus {
  Scheduled = "Scheduled",
  InProgress = "InProgress",
  Completed = "Completed",
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
      status === AIAgentTaskStatus.Error
    );
  }
}
