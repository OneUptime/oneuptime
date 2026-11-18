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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import React from "react";
import LeaveWithoutSavingQuestion, {
  LEAVE_QUESTION_DISCARD_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UnsavedChanges/LeaveWithoutSavingQuestion";
import Toast, { ToastItem, ToastType } from "../../../UI/Utils/Toast";
import {
  LeavePrompt,
  SaveBeforeLeavingFunction,
} from "../../../UI/Utils/UseLeaveGuard";

/*
 * The one question a Dashboard page asks before its unsaved work is lost
 * (issues #7401, #7402, #7973): a dashboard being edited, a schedule's
 * layers, a runbook's steps, a form's questions, a person's paging steps.
 * "Leave without saving?", the page's own sentence naming what is lost,
 * and its answers:
 *
 *   - with the page's save (onSaveChanges): Save Changes, the one primary
 *     button, which saves and then leaves - only once the save worked -
 *     Keep Editing, where the focus starts, and Discard Changes, outlined
 *     in red at the footer's start;
 *   - without one: Keep Editing, and Discard Changes - the red one, so the
 *     focus starts on Keep Editing and a stray Enter loses nothing.
 *
 * Nothing is drawn until someone tries to leave.
 */

const RUNBOOK_SENTENCE: string =
  "You have unsaved changes to this runbook's steps. If you leave now, they will be lost.";

interface Answers {
  prompt: LeavePrompt;
  stay: Mock<() => void>;
  leave: Mock<() => void>;
  // The step Save Changes takes, once the save it was handed lands.
  leaveAfterSave: Mock<() => void>;
}

function prompt(isAsking: boolean): Answers {
  const stay: Mock<() => void> = jest.fn<() => void>();
  const leave: Mock<() => void> = jest.fn<() => void>();
  const leaveAfterSave: Mock<() => void> = jest.fn<() => void>();

  return {
    prompt: {
      isAsking,
      stay,
      leave,
      // As useLeaveGuard's: the save, then the step - never the step alone.
      saveAndLeave: async (save: SaveBeforeLeavingFunction): Promise<void> => {
        await save();
        leaveAfterSave();
      },
    },
    stay,
    leave,
    leaveAfterSave,
  };
}

async function draw(
  answers: Answers,
  onSaveChanges?: SaveBeforeLeavingFunction,
): Promise<void> {
  await act(async () => {
    render(
      <div>
        <p>The page</p>
        <LeaveWithoutSavingQuestion
          prompt={answers.prompt}
          description={RUNBOOK_SENTENCE}
          onSaveChanges={onSaveChanges}
        />
      </div>,
    );
  });
}

function question(): HTMLElement {
  return screen.getByRole("dialog", { name: "Leave without saving?" });
}

function footerButton(testId: string): HTMLElement {
  return within(question()).getByTestId(testId);
}

function saveChangesButton(): HTMLElement {
  return footerButton("modal-footer-submit-button");
}

function keepEditingButton(): HTMLElement {
  return footerButton("modal-footer-close-button");
}

function discardButton(): HTMLElement {
  return footerButton(LEAVE_QUESTION_DISCARD_TEST_ID);
}

// A save that lands, or is refused, when the test says.
interface HeldSave {
  save: Mock<SaveBeforeLeavingFunction>;
  land: () => Promise<void>;
  refuse: (error: Error) => Promise<void>;
}

function heldSave(): HeldSave {
  let resolveSave: (() => void) | null = null;
  let rejectSave: ((error: Error) => void) | null = null;

  const save: Mock<SaveBeforeLeavingFunction> =
    jest.fn<SaveBeforeLeavingFunction>(() => {
      return new Promise<void>(
        (resolve: () => void, reject: (error: Error) => void) => {
          resolveSave = resolve;
          rejectSave = reject;
        },
      );
    });

  return {
    save,
    land: async (): Promise<void> => {
      await act(async () => {
        resolveSave?.();
      });
    },
    refuse: async (error: Error): Promise<void> => {
      await act(async () => {
        rejectSave?.(error);
      });
    },
  };
}

// A button drawn filled in the action's colour: a PRIMARY's, or a DANGER's.
const FILLED_BUTTON_CLASS: RegExp = /(^|\s)bg-(indigo|red)-[56]00(\s|$)/;

function toastTitles(): Array<string> {
  return Toast.getToasts().map((toast: ToastItem): string => {
    return `${toast.type}: ${toast.title}`;
  });
}

async function pressSaveChanges(): Promise<void> {
  await act(async () => {
    fireEvent.click(saveChangesButton());
  });
}

beforeEach(() => {
  Toast.dismissAll();
});

afterEach(() => {
  cleanup();
  Toast.dismissAll();
});

describe("while no one is leaving", () => {
  test("nothing is drawn", async () => {
    await draw(prompt(false));

    expect(screen.getByText("The page")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Leave without saving?")).toBeNull();
    expect(screen.queryByText(RUNBOOK_SENTENCE)).toBeNull();
  });

  test("nothing is drawn with a save either", async () => {
    await draw(prompt(false), jest.fn<SaveBeforeLeavingFunction>());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Save Changes")).toBeNull();
  });
});

describe("someone is leaving a page that cannot save from the question", () => {
  test("it asks in the dashboard's voice, with the page's own sentence", async () => {
    await draw(prompt(true));

    const dialog: HTMLElement = question();

    expect(within(dialog).getByText(RUNBOOK_SENTENCE)).toBeInTheDocument();
    expect(keepEditingButton()).toHaveTextContent("Keep Editing");
    expect(saveChangesButton()).toHaveTextContent("Discard Changes");
    expect(within(dialog).queryByText("Save Changes")).toBeNull();
    expect(within(dialog).queryByTestId(LEAVE_QUESTION_DISCARD_TEST_ID)).toBe(
      null,
    );
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

    const discard: HTMLElement = saveChangesButton();
    const keepEditing: HTMLElement = keepEditingButton();

    expect(discard.className).toMatch(/bg-red-/);
    expect(keepEditing.className).not.toMatch(/bg-red-/);

    await waitFor(() => {
      expect(document.activeElement).toBe(keepEditing);
    });
  });
});

describe("someone is leaving a page that can save (issue #7402)", () => {
  test("three answers: Save Changes, Keep Editing, and Discard Changes at the footer's start", async () => {
    await draw(prompt(true), jest.fn<SaveBeforeLeavingFunction>());

    const dialog: HTMLElement = question();

    expect(within(dialog).getByText(RUNBOOK_SENTENCE)).toBeInTheDocument();
    expect(question()).toHaveAccessibleDescription(RUNBOOK_SENTENCE);
    expect(saveChangesButton()).toHaveTextContent("Save Changes");
    expect(keepEditingButton()).toHaveTextContent("Keep Editing");
    expect(discardButton()).toHaveTextContent("Discard Changes");

    // Discard Changes sits apart, at the start of the footer, before the other two.
    const footer: HTMLElement = within(dialog).getByTestId("modal-footer");
    const order: Array<string> = Array.from(
      footer.querySelectorAll("button"),
    ).map((button: HTMLButtonElement): string => {
      return (button.textContent || "").trim();
    });

    expect(order).toEqual(["Discard Changes", "Keep Editing", "Save Changes"]);
    expect(discardButton().parentElement).not.toBe(
      saveChangesButton().parentElement,
    );
    expect(keepEditingButton().parentElement).toBe(
      saveChangesButton().parentElement,
    );
  });

  test("Save Changes is the one filled button; Discard Changes is red but outlined", async () => {
    await draw(prompt(true), jest.fn<SaveBeforeLeavingFunction>());

    const filled: Array<HTMLElement> = Array.from(
      question().querySelectorAll<HTMLElement>("button"),
    ).filter((button: HTMLElement): boolean => {
      return FILLED_BUTTON_CLASS.test(button.className);
    });

    expect(filled).toEqual([saveChangesButton()]);
    expect(saveChangesButton().className).toMatch(/bg-indigo-/);
    expect(discardButton().className).toMatch(/text-red-/);
    expect(discardButton().className).not.toMatch(/(^|\s)bg-red-[56]00(\s|$)/);
    expect(keepEditingButton().className).not.toMatch(/red|indigo-6/);
  });

  test("the focus starts on Keep Editing, not on Save Changes: a stray Enter saves nothing", async () => {
    await draw(prompt(true), jest.fn<SaveBeforeLeavingFunction>());

    await waitFor(() => {
      expect(document.activeElement).toBe(keepEditingButton());
    });
  });

  test("Save Changes saves, waits, and leaves only once the save lands", async () => {
    const answers: Answers = prompt(true);
    const held: HeldSave = heldSave();
    await draw(answers, held.save);

    await pressSaveChanges();

    expect(held.save).toHaveBeenCalledTimes(1);
    expect(answers.leaveAfterSave).not.toHaveBeenCalled();
    expect(answers.leave).not.toHaveBeenCalled();

    // While it saves: it says so, and every answer waits.
    expect(saveChangesButton()).toHaveTextContent("Saving...");
    expect(saveChangesButton()).toBeDisabled();
    expect(keepEditingButton()).toBeDisabled();
    expect(discardButton()).toBeDisabled();
    expect(within(question()).getByTestId("close-button")).toBeDisabled();

    await held.land();

    expect(answers.leaveAfterSave).toHaveBeenCalledTimes(1);
    expect(answers.leave).not.toHaveBeenCalled();
    expect(answers.stay).not.toHaveBeenCalled();
    // Said where the reader arrives: the page that would have said it is gone.
    expect(toastTitles()).toEqual([`${ToastType.Success}: Changes saved`]);
  });

  test("while it saves, Escape, the close button and a second press change nothing", async () => {
    const answers: Answers = prompt(true);
    const held: HeldSave = heldSave();
    await draw(answers, held.save);

    await pressSaveChanges();

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.click(within(question()).getByTestId("close-button"));
      fireEvent.click(keepEditingButton());
      fireEvent.click(discardButton());
      fireEvent.click(saveChangesButton());
    });

    expect(answers.stay).not.toHaveBeenCalled();
    expect(answers.leave).not.toHaveBeenCalled();
    expect(held.save).toHaveBeenCalledTimes(1);
    expect(question()).toBeInTheDocument();

    await held.land();

    expect(answers.leaveAfterSave).toHaveBeenCalledTimes(1);
    expect(answers.stay).not.toHaveBeenCalled();
  });

  test("a refused save stays, says why at the top of the question, and loses nothing", async () => {
    const answers: Answers = prompt(true);
    const held: HeldSave = heldSave();
    await draw(answers, held.save);

    await pressSaveChanges();
    await held.refuse(
      new Error("You no longer have permission to edit this runbook."),
    );

    expect(answers.leaveAfterSave).not.toHaveBeenCalled();
    expect(answers.leave).not.toHaveBeenCalled();
    expect(answers.stay).not.toHaveBeenCalled();

    const dialog: HTMLElement = question();

    expect(within(dialog).getByTestId("modal-error")).toHaveTextContent(
      "You no longer have permission to edit this runbook.",
    );
    // Every answer again: try again, keep editing, or let the work go.
    expect(saveChangesButton()).toHaveTextContent("Save Changes");
    expect(saveChangesButton()).toBeEnabled();
    expect(keepEditingButton()).toBeEnabled();
    expect(discardButton()).toBeEnabled();
    expect(toastTitles()).toEqual([]);
  });

  test("after a refusal, Save Changes again saves again, and leaves once it lands", async () => {
    const answers: Answers = prompt(true);
    const held: HeldSave = heldSave();
    await draw(answers, held.save);

    await pressSaveChanges();
    await held.refuse(new Error("The server is restarting. Try again."));

    await pressSaveChanges();

    expect(held.save).toHaveBeenCalledTimes(2);
    // The last refusal goes as the new try starts.
    expect(within(question()).queryByTestId("modal-error")).toBeNull();

    await held.land();

    expect(answers.leaveAfterSave).toHaveBeenCalledTimes(1);
  });

  test("after a refusal, Keep Editing stays and Discard Changes leaves", async () => {
    const answers: Answers = prompt(true);
    const held: HeldSave = heldSave();
    await draw(answers, held.save);

    await pressSaveChanges();
    await held.refuse(new Error("Refused."));

    await act(async () => {
      fireEvent.click(keepEditingButton());
    });
    expect(answers.stay).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(discardButton());
    });
    expect(answers.leave).toHaveBeenCalledTimes(1);
    expect(answers.leaveAfterSave).not.toHaveBeenCalled();
  });

  test("a failure nobody explained says the changes were not saved, and what to do", async () => {
    const answers: Answers = prompt(true);
    const held: HeldSave = heldSave();
    await draw(answers, held.save);

    await pressSaveChanges();
    // The browser's own words: never shown, the sentence for a page that failed instead.
    await held.refuse(new TypeError("Cannot read properties of undefined"));

    const alert: HTMLElement = within(question()).getByTestId("modal-error");

    expect(alert).toHaveTextContent("Your changes were not saved.");
    expect(alert).not.toHaveTextContent("Cannot read properties");
    expect(answers.leaveAfterSave).not.toHaveBeenCalled();
  });

  test("asked again, the question starts without the last refusal", async () => {
    const answers: Answers = prompt(true);
    const held: HeldSave = heldSave();
    const { rerender } = render(
      <LeaveWithoutSavingQuestion
        prompt={answers.prompt}
        description={RUNBOOK_SENTENCE}
        onSaveChanges={held.save}
      />,
    );

    await pressSaveChanges();
    await held.refuse(new Error("Refused."));
    expect(within(question()).getByTestId("modal-error")).toBeInTheDocument();

    // Keep Editing, then someone tries to leave again.
    await act(async () => {
      rerender(
        <LeaveWithoutSavingQuestion
          prompt={{ ...answers.prompt, isAsking: false }}
          description={RUNBOOK_SENTENCE}
          onSaveChanges={held.save}
        />,
      );
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      rerender(
        <LeaveWithoutSavingQuestion
          prompt={answers.prompt}
          description={RUNBOOK_SENTENCE}
          onSaveChanges={held.save}
        />,
      );
    });

    expect(within(question()).queryByTestId("modal-error")).toBeNull();
    expect(saveChangesButton()).toHaveTextContent("Save Changes");
  });
});
