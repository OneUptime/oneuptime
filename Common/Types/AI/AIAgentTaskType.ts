enum AIAgentTaskType {
  FixException = "FixException",
}

export default AIAgentTaskType;

export interface AIAgentTaskTypeProps {
  taskType: AIAgentTaskType;
  title: string;
  description: string;
}

export class AIAgentTaskTypeHelper {
  public static getAllTaskTypeProps(): Array<AIAgentTaskTypeProps> {
    return [
      {
        taskType: AIAgentTaskType.FixException,
        title: "Fix Exception",
        description:
          "Analyze and fix an exception that occurred in your application.",
      },
    ];
  }

  public static getDescription(taskType: AIAgentTaskType): string {
    const props: AIAgentTaskTypeProps | undefined =
      this.getAllTaskTypeProps().find((p: AIAgentTaskTypeProps) => {
        return p.taskType === taskType;
      });
    return props?.description || "";
  }

  public static getTitle(taskType: AIAgentTaskType): string {
    const props: AIAgentTaskTypeProps | undefined =
      this.getAllTaskTypeProps().find((p: AIAgentTaskTypeProps) => {
        return p.taskType === taskType;
      });
    return props?.title || "";
  }
}
