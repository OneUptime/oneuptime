enum AIChatMessageStatus {
  Pending = "Pending",
  InProgress = "InProgress",
  /*
   * The turn paused because the agent wants to run one or more mutating tools
   * and the conversation is in "Ask for approval" mode. The message carries the
   * pending tool actions; the user approves or denies them to resume the turn.
   */
  WaitingForApproval = "WaitingForApproval",
  Completed = "Completed",
  Error = "Error",
  /*
   * The user pressed Stop: POST /ai-chat/cancel-run finalized the message
   * mid-generation (contentInMarkdown says so). Terminal like Error, but
   * deliberate — never counted or rendered as a failure.
   */
  Cancelled = "Cancelled",
}

export default AIChatMessageStatus;

export class AIChatMessageStatusHelper {
  public static isTerminalStatus(status: AIChatMessageStatus): boolean {
    return (
      status === AIChatMessageStatus.Completed ||
      status === AIChatMessageStatus.Error ||
      status === AIChatMessageStatus.Cancelled
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
