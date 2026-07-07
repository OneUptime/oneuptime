enum AIChatMessageStatus {
  Pending = "Pending",
  InProgress = "InProgress",
  // The turn paused because the agent wants to run one or more mutating tools
  // and the conversation is in "Ask for approval" mode. The message carries the
  // pending tool actions; the user approves or denies them to resume the turn.
  WaitingForApproval = "WaitingForApproval",
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

  // Statuses in which a run is still in flight (spinner or approval card shown).
  public static isActiveStatus(status: AIChatMessageStatus): boolean {
    return (
      status === AIChatMessageStatus.Pending ||
      status === AIChatMessageStatus.InProgress ||
      status === AIChatMessageStatus.WaitingForApproval
    );
  }
}
