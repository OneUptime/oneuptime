enum AIChatMessageStatus {
  Pending = "Pending",
  InProgress = "InProgress",
  Completed = "Completed",
  Error = "Error",
}

export default AIChatMessageStatus;

export class AIChatMessageStatusHelper {
  public static isTerminalStatus(status: AIChatMessageStatus): boolean {
    return (
      status === AIChatMessageStatus.Completed ||
      status === AIChatMessageStatus.Error
    );
  }
}
