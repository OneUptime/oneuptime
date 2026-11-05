import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "Common/Types/AI/AIChatTypes";

/*
 * Ask AI changed a workflow, and its Builder may be open behind the panel.
 *
 * The Builder holds its graph in memory and saves all of it on the next edit, so
 * without being told it would show the old workflow and then write it back over
 * what Ask AI just did. So the chat says when an update_workflow it was following
 * has run, and the Builder reads its graph again (Pages/Workflow/View/Builder).
 *
 * Only an action seen to finish counts: reading an old conversation's history
 * changes nothing, so a conversation's first read only notes what has run.
 */
const UPDATE_WORKFLOW_TOOL_NAME: string = "update_workflow";

type ToolActionsOfFunction = (
  messages: Array<{ toolActions?: Array<AIChatToolAction> | undefined }>,
) => Array<AIChatToolAction>;

const updatesThatRan: ToolActionsOfFunction = (
  messages: Array<{ toolActions?: Array<AIChatToolAction> | undefined }>,
): Array<AIChatToolAction> => {
  return messages
    .flatMap(
      (message: { toolActions?: Array<AIChatToolAction> | undefined }) => {
        return message.toolActions || [];
      },
    )
    .filter((action: AIChatToolAction): boolean => {
      return (
        action.toolName === UPDATE_WORKFLOW_TOOL_NAME &&
        action.status === AIChatToolActionStatus.Executed
      );
    });
};

export default class WorkflowChangesSeen {
  private conversationId: string | null = null;
  private seenActionIds: Set<string> = new Set<string>();

  // The workflows changed since this conversation was last read, by their id.
  public read(data: {
    conversationId: string;
    messages: Array<{ toolActions?: Array<AIChatToolAction> | undefined }>;
  }): Array<string> {
    const updates: Array<AIChatToolAction> = updatesThatRan(data.messages);
    const isFirstRead: boolean = this.conversationId !== data.conversationId;

    if (isFirstRead) {
      this.conversationId = data.conversationId;
      this.seenActionIds = new Set<string>();
    }

    const changed: Array<string> = [];

    for (const update of updates) {
      if (this.seenActionIds.has(update.id)) {
        continue;
      }

      this.seenActionIds.add(update.id);

      const workflowId: unknown = update.arguments?.["workflowId"];

      if (!isFirstRead && typeof workflowId === "string") {
        changed.push(workflowId);
      }
    }

    return changed;
  }
}
