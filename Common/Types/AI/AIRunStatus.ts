enum AIRunStatus {
  Running = "Running",
  Completed = "Completed",
  Error = "Error",
  Cancelled = "Cancelled",
  Stale = "Stale",
}

export default AIRunStatus;

export class AIRunStatusHelper {
  public static isTerminalStatus(status: AIRunStatus): boolean {
    return status !== AIRunStatus.Running;
  }
}
