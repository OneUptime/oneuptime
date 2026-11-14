import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import React from "react";
import LeaveWithoutSavingQuestion from "../../../../App/FeatureSet/Dashboard/src/Components/UnsavedChanges/LeaveWithoutSavingQuestion";
import { LeavePrompt } from "../../../UI/Utils/UseLeaveGuard";

/*
 * The one question a Dashboard page asks before its unsaved work is lost
 * (issue #7401): a dashboard being edited, a runbook's steps, a form's
 * questions. "Leave without saving?", the page's own sentence naming what
 * is lost, Keep Editing and Discard Changes - the red one, so the focus
 * starts on Keep Editing and a stray Enter loses nothing. Nothing is drawn
 * until someone tries to leave.
 */

const RUNBOOK_SENTENCE: string =
  "You have unsaved changes to this runbook's steps. If you leave now, they will be lost.";

interface Answers {
  prompt: LeavePrompt;
  stay: Mock<() => void>;
  leave: Mock<() => void>;
}

function prompt(isAsking: boolean): Answers {
  const stay: Mock<() => void> = jest.fn<() => void>();
  const leave: Mock<() => void> = jest.fn<() => void>();

  return {
    prompt: { isAsking, stay, leave },
    stay,
    leave,
  };
}

async function draw(answers: Answers): Promise<void> {
  await act(async () => {
    render(
      <div>
        <p>The page</p>
        <LeaveWithoutSavingQuestion
          prompt={answers.prompt}
          description={RUNBOOK_SENTENCE}
        />
      </div>,
    );
  });
}

function question(): HTMLElement {
  return screen.getByRole("dialog", { name: "Leave without saving?" });
}

afterEach(() => {
  cleanup();
});

describe("while no one is leaving", () => {
  test("nothing is drawn", async () => {
    await draw(prompt(false));

    expect(screen.getByText("The page")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Leave without saving?")).toBeNull();
    expect(screen.queryByText(RUNBOOK_SENTENCE)).toBeNull();
  });
});

describe("someone is leaving", () => {
  test("it asks in the dashboard's voice, with the page's own sentence", async () => {
    await draw(prompt(true));

    const dialog: HTMLElement = question();

    expect(within(dialog).getByText(RUNBOOK_SENTENCE)).toBeInTheDocument();
    expect(
      within(dialog).getByTestId("modal-footer-close-button"),
    ).toHaveTextContent("Keep Editing");
    expect(
      within(dialog).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Discard Changes");
  });

  test("a screen reader hears what is lost with the question", async () => {
    await draw(prompt(true));

    expect(question()).toHaveAccessibleDescription(RUNBOOK_SENTENCE);
  });

  test("the close button and Escape keep editing, as Keep Editing does", async () => {
    const answers: Answers = prompt(true);
    await draw(answers);

    await act(async () => {
      fireEvent.click(within(question()).getByTestId("close-button"));
    });

    expect(answers.stay).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(answers.stay).toHaveBeenCalledTimes(2);
    expect(answers.leave).not.toHaveBeenCalled();
  });

  test("Keep Editing stays, and only stays", async () => {
    const answers: Answers = prompt(true);
    await draw(answers);

    await act(async () => {
      fireEvent.click(within(question()).getByText("Keep Editing"));
    });

    expect(answers.stay).toHaveBeenCalledTimes(1);
    expect(answers.leave).not.toHaveBeenCalled();
  });

  test("Discard Changes leaves, and only leaves", async () => {
    const answers: Answers = prompt(true);
    await draw(answers);

    await act(async () => {
      fireEvent.click(within(question()).getByText("Discard Changes"));
    });

    expect(answers.leave).toHaveBeenCalledTimes(1);
    expect(answers.stay).not.toHaveBeenCalled();
  });

  test("Discard Changes is the red one, and the focus starts on Keep Editing", async () => {
    await draw(prompt(true));

    const discard: HTMLElement = within(question()).getByTestId(
      "modal-footer-submit-button",
    );
    const keepEditing: HTMLElement = within(question()).getByTestId(
      "modal-footer-close-button",
    );

    expect(discard.className).toMatch(/bg-red-/);
    expect(keepEditing.className).not.toMatch(/bg-red-/);

    await waitFor(() => {
      expect(document.activeElement).toBe(keepEditing);
    });
  });
});
