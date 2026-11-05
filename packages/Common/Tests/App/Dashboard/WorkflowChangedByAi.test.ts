import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "../../../Types/AI/AIChatTypes";
import WorkflowChangesSeen from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/WorkflowChangedByAi";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #5945: a workflow's Builder holds its graph in memory and writes all of
 * it back on the next edit, so it has to hear when Ask AI changed the workflow.
 * It hears only of what it saw finish, not of a conversation's history.
 */

const WORKFLOW_ID: string = "e8000000-0000-4000-8000-0000000000c1";

type ActionFunction = (
  id: string,
  status: AIChatToolActionStatus,
  toolName?: string,
) => AIChatToolAction;

const action: ActionFunction = (
  id: string,
  status: AIChatToolActionStatus,
  toolName: string = "update_workflow",
): AIChatToolAction => {
  return {
    id: id,
    toolName: toolName,
    title: "Update workflow",
    arguments: { workflowId: WORKFLOW_ID },
    isMutation: true,
    requiresApproval: true,
    status: status,
  };
};

describe("WorkflowChangesSeen", () => {
  let seen: WorkflowChangesSeen;

  beforeEach(() => {
    seen = new WorkflowChangesSeen();
  });

  type ReadFunction = (
    actions: Array<AIChatToolAction>,
    conversationId?: string,
  ) => Array<string>;

  const read: ReadFunction = (
    actions: Array<AIChatToolAction>,
    conversationId: string = "conversation-1",
  ): Array<string> => {
    return seen.read({
      conversationId: conversationId,
      messages: [{ toolActions: actions }],
    });
  };

  test("an update already in a conversation's history changes nothing", () => {
    expect(read([action("a", AIChatToolActionStatus.Executed)])).toEqual([]);
  });

  test("an update seen to finish says which workflow", () => {
    read([action("a", AIChatToolActionStatus.Pending)]);

    expect(read([action("a", AIChatToolActionStatus.Executed)])).toEqual([
      WORKFLOW_ID,
    ]);
  });

  test("and says it once", () => {
    read([]);
    read([action("a", AIChatToolActionStatus.Executed)]);

    expect(read([action("a", AIChatToolActionStatus.Executed)])).toEqual([]);
  });

  test("one started in an already open conversation counts", () => {
    read([]);

    expect(read([action("b", AIChatToolActionStatus.Executed)])).toEqual([
      WORKFLOW_ID,
    ]);
  });

  test.each([
    AIChatToolActionStatus.Pending,
    AIChatToolActionStatus.Approved,
    AIChatToolActionStatus.Denied,
    AIChatToolActionStatus.Failed,
    AIChatToolActionStatus.Skipped,
  ])("one that is %s changed nothing yet", (status: AIChatToolActionStatus) => {
    read([]);

    expect(read([action("a", status)])).toEqual([]);
  });

  test("another tool is none of its business", () => {
    read([]);

    expect(
      read([
        action("a", AIChatToolActionStatus.Executed, "create_workflow"),
        action("b", AIChatToolActionStatus.Executed, "create_incident"),
      ]),
    ).toEqual([]);
  });

  test("moving to another conversation does not replay its history", () => {
    read([]);

    expect(
      read([action("a", AIChatToolActionStatus.Executed)], "conversation-2"),
    ).toEqual([]);
  });

  test("an action with no workflow named says nothing", () => {
    read([]);

    expect(
      read([
        {
          ...action("a", AIChatToolActionStatus.Executed),
          arguments: {},
        },
      ]),
    ).toEqual([]);
  });

  test("a message with no actions is fine", () => {
    expect(
      seen.read({ conversationId: "conversation-1", messages: [{}] }),
    ).toEqual([]);
  });
});
