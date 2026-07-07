/*
 * How the AI chat agent is allowed to run tools that MUTATE project data
 * (create/acknowledge/resolve incidents and alerts, etc). Read-only tools are
 * never gated by this — they always run. This is stored per-conversation on
 * AIConversation.permissionMode and enforced in ChatAgentRunner.
 */
enum AIChatPermissionMode {
  /*
   * The agent pauses before every mutating tool and asks the user to approve
   * it. This is the safe default.
   */
  AskForApproval = "AskForApproval",
  /*
   * The agent runs mutating tools immediately (still gated by the user's RBAC
   * permissions). "Bypass permissions" / YOLO mode.
   */
  AutoRun = "AutoRun",
  // Mutating tools are not even offered to the model. The agent can only read.
  ReadOnly = "ReadOnly",
}

export default AIChatPermissionMode;

export interface AIChatPermissionModeOption {
  value: AIChatPermissionMode;
  title: string;
  description: string;
}

export class AIChatPermissionModeHelper {
  public static getDefault(): AIChatPermissionMode {
    return AIChatPermissionMode.AskForApproval;
  }

  public static isValid(
    value: string | undefined,
  ): value is AIChatPermissionMode {
    return Object.values(AIChatPermissionMode).includes(
      value as AIChatPermissionMode,
    );
  }

  public static parse(value: string | undefined): AIChatPermissionMode {
    return this.isValid(value) ? value : this.getDefault();
  }

  public static getOptions(): Array<AIChatPermissionModeOption> {
    return [
      {
        value: AIChatPermissionMode.AskForApproval,
        title: "Ask for approval",
        description:
          "The copilot pauses and asks before it changes anything (creating incidents, acknowledging alerts, etc).",
      },
      {
        value: AIChatPermissionMode.AutoRun,
        title: "Auto-run (bypass approvals)",
        description:
          "The copilot performs actions immediately, still limited to what your role can do.",
      },
      {
        value: AIChatPermissionMode.ReadOnly,
        title: "Read-only",
        description:
          "The copilot can investigate and answer questions but can never change anything.",
      },
    ];
  }
}
