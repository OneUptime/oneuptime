import WorkflowUndoRedoButtons from "../../../../UI/Components/Workflow/WorkflowUndoRedoButtons";
import {
  WorkflowEditCause,
  WorkflowHistoryDirection,
  WorkflowHistoryStep,
} from "../../../../UI/Components/Workflow/WorkflowEditHistory";
import WorkflowStatusBar, {
  WorkflowSaveState,
  WorkflowStatusBarCopy,
} from "../../../../UI/Components/Workflow/WorkflowStatusBar";
import { WorkflowGraphChangeKind } from "../../../../Utils/Workflow/WorkflowGraphChanges";
import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * The builder's toolbar Undo and Redo, and the save pill's Try again
 * (issue #6188): each says what it would do, is locked saying there is
 * nothing to do, and a failed save says why and can be tried again.
 */

afterEach(() => {
  cleanup();
});

const DELETED_EMAIL: WorkflowHistoryStep = {
  direction: WorkflowHistoryDirection.Undo,
  cause: WorkflowEditCause.Edit,
  changes: [
    {
      kind: WorkflowGraphChangeKind.Removed,
      line: 'Removed "Send Email" (send-email-1)',
      steps: [{ key: "card-email", label: '"Send Email" (send-email-1)' }],
    },
  ],
};

const RESTORED: WorkflowHistoryStep = {
  direction: WorkflowHistoryDirection.Redo,
  cause: WorkflowEditCause.Restore,
  restoredVersionNumber: 3,
  changes: [],
};

describe("Undo and Redo", () => {
  test("each says what it would do", () => {
    render(
      <WorkflowUndoRedoButtons
        undoStep={DELETED_EMAIL}
        redoStep={RESTORED}
        onUndo={() => {}}
        onRedo={() => {}}
      />,
    );

    expect(screen.getByTestId("workflow-undo-button")).toHaveAttribute(
      "aria-label",
      'Undo deleting "Send Email" (send-email-1)',
    );
    expect(screen.getByTestId("workflow-redo-button")).toHaveAttribute(
      "aria-label",
      "Redo restoring version 3",
    );
    expect(screen.getByTestId("workflow-undo-button")).not.toBeDisabled();
    expect(screen.getByTestId("workflow-redo-button")).not.toBeDisabled();
  });

  test("are a group named for what they are", () => {
    render(
      <WorkflowUndoRedoButtons
        undoStep={null}
        redoStep={null}
        onUndo={() => {}}
        onRedo={() => {}}
      />,
    );

    expect(
      screen.getByRole("group", { name: "Undo and redo" }),
    ).toBeInTheDocument();
  });

  test("a press does what it says", () => {
    const onUndo: MockFunction = getJestMockFunction();
    const onRedo: MockFunction = getJestMockFunction();

    render(
      <WorkflowUndoRedoButtons
        undoStep={DELETED_EMAIL}
        redoStep={RESTORED}
        onUndo={onUndo}
        onRedo={onRedo}
      />,
    );

    fireEvent.click(screen.getByTestId("workflow-undo-button"));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("workflow-redo-button"));
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  test("with nothing to do, each is locked and says so - and a press does nothing", () => {
    const onUndo: MockFunction = getJestMockFunction();
    const onRedo: MockFunction = getJestMockFunction();

    render(
      <WorkflowUndoRedoButtons
        undoStep={null}
        redoStep={null}
        onUndo={onUndo}
        onRedo={onRedo}
      />,
    );

    const undo: HTMLElement = screen.getByTestId("workflow-undo-button");
    const redo: HTMLElement = screen.getByTestId("workflow-redo-button");

    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    expect(undo).toHaveAttribute("aria-label", "Nothing to undo");
    expect(redo).toHaveAttribute("aria-label", "Nothing to redo");
    // A locked button says why from a wrapper the pointer and the keyboard reach.
    expect(
      screen.getByTestId("workflow-undo-button-disabled-wrapper"),
    ).toBeInTheDocument();

    fireEvent.click(undo);
    fireEvent.click(redo);
    expect(onUndo).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();
  });

  test("one can be locked while the other is not", () => {
    render(
      <WorkflowUndoRedoButtons
        undoStep={DELETED_EMAIL}
        redoStep={null}
        onUndo={() => {}}
        onRedo={() => {}}
      />,
    );

    expect(screen.getByTestId("workflow-undo-button")).not.toBeDisabled();
    expect(screen.getByTestId("workflow-redo-button")).toBeDisabled();
  });
});

describe("a save that failed, in the save pill", () => {
  test("says it could not save, says why, and offers Try again", () => {
    const onRetrySave: MockFunction = getJestMockFunction();

    render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Error}
        saveError="The server is not reachable."
        onRetrySave={onRetrySave}
      />,
    );

    const pill: HTMLElement = screen.getByTestId("workflow-save-status");

    expect(pill).toHaveTextContent("Could not save");
    expect(pill).toHaveAttribute("title", "The server is not reachable.");
    expect(pill).toHaveAttribute("role", "alert");
    expect(pill).toHaveTextContent("The server is not reachable.");

    const retry: HTMLElement = screen.getByTestId("workflow-save-retry-button");

    expect(retry).toHaveTextContent(WorkflowStatusBarCopy.retrySave);
    expect(retry).toHaveAttribute(
      "title",
      WorkflowStatusBarCopy.retrySaveDescription,
    );

    fireEvent.click(retry);
    expect(onRetrySave).toHaveBeenCalledTimes(1);
  });

  test.each([
    WorkflowSaveState.Idle,
    WorkflowSaveState.Saving,
    WorkflowSaveState.Saved,
  ])(
    "is not offered while %s, nor is the pill an alert",
    (state: WorkflowSaveState) => {
      render(
        <WorkflowStatusBar
          saveState={state}
          saveError="stale"
          onRetrySave={() => {}}
        />,
      );

      expect(screen.queryByTestId("workflow-save-retry-button")).toBeNull();
      expect(screen.getByTestId("workflow-save-status")).not.toHaveAttribute(
        "role",
      );
      expect(screen.getByTestId("workflow-save-status")).not.toHaveAttribute(
        "title",
      );
    },
  );

  test("is not offered without a way to try again, nor in a view", () => {
    const { unmount } = render(
      <WorkflowStatusBar saveState={WorkflowSaveState.Error} />,
    );

    expect(screen.queryByTestId("workflow-save-retry-button")).toBeNull();
    unmount();

    render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Error}
        onRetrySave={() => {}}
        readOnlyReason="You may only look at this workflow."
      />,
    );

    expect(screen.queryByTestId("workflow-save-retry-button")).toBeNull();
  });
});
