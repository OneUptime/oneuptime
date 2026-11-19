// UX rule: Docs/ux/README.md#dialogs-and-confirmations
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useState } from "react";
import LeaveGuard from "../../../UI/Utils/LeaveGuard";
import useLeaveGuard, { LeavePrompt } from "../../../UI/Utils/UseLeaveGuard";

/*
 * useLeaveGuard holds the leave guard while the page has unsaved work, and
 * hands the page what it needs to ask in its own words: whether someone is
 * leaving, Keep Editing (stay), Discard Changes (leave) and Save Changes
 * (saveAndLeave: the page's save, then the step - only once it worked).
 */

const Page: FunctionComponent<{ hasUnsavedChanges: boolean }> = (props: {
  hasUnsavedChanges: boolean;
}): ReactElement => {
  const prompt: LeavePrompt = useLeaveGuard(props.hasUnsavedChanges);

  return prompt.isAsking ? (
    <div role="dialog" aria-label="Leave without saving?">
      <button type="button" onClick={prompt.stay}>
        Keep Editing
      </button>
      <button type="button" onClick={prompt.leave}>
        Discard Changes
      </button>
    </div>
  ) : (
    <p>Editing</p>
  );
};

/*
 * A page whose save, as it lands, leaves nothing unsaved - as every editor's
 * does: it draws again and lets the guard go, often before the save's
 * caller goes on. `save` is handed what marks the work saved.
 */
const SavingPage: FunctionComponent<{
  save: (markSaved: () => void) => Promise<void>;
}> = (props: {
  save: (markSaved: () => void) => Promise<void>;
}): ReactElement => {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(true);
  const [refusal, setRefusal] = useState<string>("");
  const prompt: LeavePrompt = useLeaveGuard(hasUnsavedChanges);

  return (
    <div>
      <p>{hasUnsavedChanges ? "Unsaved" : "Saved"}</p>
      {prompt.isAsking ? (
        <div role="dialog" aria-label="Leave without saving?">
          <button
            type="button"
            onClick={() => {
              prompt
                .saveAndLeave(() => {
                  return props.save(() => {
                    setHasUnsavedChanges(false);
                  });
                })
                .catch((err: Error) => {
                  setRefusal(err.message);
                });
            }}
          >
            Save Changes
          </button>
          {refusal ? <p role="alert">{refusal}</p> : <></>}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

// Every timer and microtask a save's landing schedules, run.
const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    for (let turn: number = 0; turn < 4; turn++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
};

const dispatchBeforeUnload: () => Event = (): Event => {
  const event: Event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
};

const leaveTo: (address: string, step: () => void) => void = (
  address: string,
  step: () => void,
): void => {
  act(() => {
    LeaveGuard.whenLeaving(address, step);
  });
};

beforeEach(() => {
  LeaveGuard.reset();
  window.history.replaceState(
    { usr: null, key: "d1", idx: 0 },
    "",
    "/dashboard/p1/dashboards/d1",
  );
});

afterEach(() => {
  cleanup();
  LeaveGuard.reset();
});

describe("useLeaveGuard", () => {
  test("a page with nothing unsaved holds nothing, and nothing asks", () => {
    const step: Mock<() => void> = jest.fn<() => void>();

    render(<Page hasUnsavedChanges={false} />);

    expect(LeaveGuard.isHeld()).toBe(false);
    leaveTo("/dashboard/p1/monitors", step);

    expect(step).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  test("with unsaved work, leaving asks, and the step waits", () => {
    const step: Mock<() => void> = jest.fn<() => void>();

    render(<Page hasUnsavedChanges={true} />);

    expect(LeaveGuard.isHeld()).toBe(true);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    leaveTo("/dashboard/p1/monitors", step);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(step).not.toHaveBeenCalled();
  });

  test("Keep Editing closes the question, drops the step and keeps holding", () => {
    const step: Mock<() => void> = jest.fn<() => void>();

    render(<Page hasUnsavedChanges={true} />);
    leaveTo("/dashboard/p1/monitors", step);

    fireEvent.click(screen.getByText("Keep Editing"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(step).not.toHaveBeenCalled();
    expect(LeaveGuard.isHeld()).toBe(true);

    // The next try asks again.
    leaveTo("/dashboard/p1/monitors", step);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("Discard Changes takes the step once, with the guard let go", () => {
    const heldWhenTaken: Array<boolean> = [];

    render(<Page hasUnsavedChanges={true} />);
    leaveTo("/dashboard/p1/monitors", () => {
      heldWhenTaken.push(LeaveGuard.isHeld());
    });

    fireEvent.click(screen.getByText("Discard Changes"));

    expect(heldWhenTaken).toEqual([false]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  test("asked twice before answering, Discard Changes takes the latest step", () => {
    const first: Mock<() => void> = jest.fn<() => void>();
    const second: Mock<() => void> = jest.fn<() => void>();

    render(<Page hasUnsavedChanges={true} />);
    leaveTo("/dashboard/p1/monitors", first);
    leaveTo("/dashboard/p1/incidents", second);

    fireEvent.click(screen.getByText("Discard Changes"));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("once nothing is unsaved (saved or discarded), it lets go and stops asking", () => {
    const step: Mock<() => void> = jest.fn<() => void>();
    const { rerender } = render(<Page hasUnsavedChanges={true} />);

    leaveTo("/dashboard/p1/monitors", step);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    rerender(<Page hasUnsavedChanges={false} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(LeaveGuard.isHeld()).toBe(false);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

    leaveTo("/dashboard/p1/monitors", step);
    expect(step).toHaveBeenCalledTimes(1);
  });

  test("a page that leaves the screen lets go", () => {
    const { unmount } = render(<Page hasUnsavedChanges={true} />);

    expect(LeaveGuard.isHeld()).toBe(true);

    unmount();

    expect(LeaveGuard.isHeld()).toBe(false);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });
});

describe("Save Changes: saveAndLeave (issue #7402)", () => {
  test("the step waits for the save, and is taken once it lands", async () => {
    const step: Mock<() => void> = jest.fn<() => void>();
    let land: () => void = (): void => {};

    render(
      <SavingPage
        save={(markSaved: () => void): Promise<void> => {
          return new Promise<void>((resolve: () => void) => {
            land = (): void => {
              markSaved();
              resolve();
            };
          });
        }}
      />,
    );
    leaveTo("/dashboard/p1/monitors", step);

    fireEvent.click(screen.getByText("Save Changes"));
    await settle();

    // Saving: still asked, still held, nothing taken.
    expect(step).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(LeaveGuard.isHeld()).toBe(true);

    await act(async () => {
      land();
    });
    await settle();

    expect(step).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(LeaveGuard.isHeld()).toBe(false);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  test("a save that lets the guard go before it resolves still takes the step it was asked about", async () => {
    const heldWhenTaken: Array<boolean> = [];
    const heldBeforeResolving: Array<boolean> = [];

    render(
      <SavingPage
        save={async (markSaved: () => void): Promise<void> => {
          // Saved: the page draws with nothing unsaved, and lets go, first.
          markSaved();
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 0);
          });
          heldBeforeResolving.push(LeaveGuard.isHeld());
        }}
      />,
    );
    leaveTo("/dashboard/p1/monitors", () => {
      heldWhenTaken.push(LeaveGuard.isHeld());
    });

    fireEvent.click(screen.getByText("Save Changes"));
    await settle();

    expect(heldBeforeResolving).toEqual([false]);
    expect(heldWhenTaken).toEqual([false]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("a refused save takes no step, keeps asking, and says why", async () => {
    const step: Mock<() => void> = jest.fn<() => void>();

    render(
      <SavingPage
        save={async (): Promise<void> => {
          throw new Error("You no longer have permission.");
        }}
      />,
    );
    leaveTo("/dashboard/p1/monitors", step);

    fireEvent.click(screen.getByText("Save Changes"));
    await settle();

    expect(step).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You no longer have permission.",
    );
    expect(LeaveGuard.isHeld()).toBe(true);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
  });

  test("with no one leaving, a save takes no step and keeps holding", async () => {
    const save: Mock<() => Promise<void>> = jest.fn<() => Promise<void>>(
      async (): Promise<void> => {},
    );
    const prompts: Array<LeavePrompt> = [];

    const Holder: FunctionComponent = (): ReactElement => {
      prompts.push(useLeaveGuard(true));
      return <p>Editing</p>;
    };

    render(<Holder />);

    await act(async () => {
      await prompts[prompts.length - 1]!.saveAndLeave(save);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(LeaveGuard.isHeld()).toBe(true);
  });
});
