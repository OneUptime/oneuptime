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

  /*
   * The modes in the order the permission menu offers them, each with the
   * name the menu, its button and the docs give it, and what it means. The
   * Dashboard draws the same words from its own translated keys
   * (Components/AIChat/PermissionModePicker and PermissionModeWords).
   */
  public static getOptions(): Array<AIChatPermissionModeOption> {
    return [
      {
        value: AIChatPermissionMode.AskForApproval,
        title: "Ask to act",
        description: "Asks for approval before it changes anything.",
      },
      {
        value: AIChatPermissionMode.AutoRun,
        title: "Auto-run",
        description:
          "Acts on clear requests right away, within your permissions.",
      },
      {
        value: AIChatPermissionMode.ReadOnly,
        title: "Read-only",
        description: "Only reads and answers. It never changes anything.",
      },
    ];
  }
}
