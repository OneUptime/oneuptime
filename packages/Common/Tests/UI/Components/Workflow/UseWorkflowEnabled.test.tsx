/*
 * The Builder's hold on a run started while the workflow is turned off.
 *
 * "When workflow is not enabled, it doesnt tell me how to enable this
 * workflow." - the maintainer, after Run just this step on a workflow that
 * was off answered with an Error dialog saying "This workflow is not
 * enabled" and a Close button. The hook now holds such a run instead of
 * sending it, offers to turn the workflow on, and then sends exactly the run
 * that was asked for. These tests drive it through a real component
 * lifecycle with the server stood in by mocks.
 */

import useWorkflowEnabled, {
  UseWorkflowEnabledOptions,
  UseWorkflowEnabledResult,
  WorkflowRunAttempt,
  WorkflowRunKind,
} from "../../../../UI/Components/Workflow/UseWorkflowEnabled";
import "@testing-library/jest-dom";
import { act, cleanup, render } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

type SaveMock = Mock<(isEnabled: boolean) => Promise<void>>;
type FetchMock = Mock<() => Promise<boolean | null>>;
type ErrorMock = Mock<(message: string) => void>;
type RunMock = Mock<() => Promise<void>>;

let latest: UseWorkflowEnabledResult | null = null;
let saveIsEnabled: SaveMock;
let fetchIsEnabled: FetchMock;
let onError: ErrorMock;

const Harness: FunctionComponent<UseWorkflowEnabledOptions> = (
  props: UseWorkflowEnabledOptions,
): ReactElement => {
  latest = useWorkflowEnabled(props);

  return <div data-testid="harness" />;
};

type HookFunction = () => UseWorkflowEnabledResult;

const hook: HookFunction = (): UseWorkflowEnabledResult => {
  if (!latest) {
    throw new Error("The harness has not rendered.");
  }

  return latest;
};

type MountFunction = (loaded: boolean | null) => Promise<void>;

// The Builder has loaded the workflow, and it said this about the switch.
const mount: MountFunction = async (loaded: boolean | null): Promise<void> => {
  render(
    <Harness
      saveIsEnabled={saveIsEnabled}
      fetchIsEnabled={fetchIsEnabled}
      onError={onError}
    />,
  );

  await act(async () => {
    hook().setLoadedIsEnabled(loaded);
  });
};

type AttemptFunction = (
  run: RunMock,
  overrides?: Partial<WorkflowRunAttempt>,
) => WorkflowRunAttempt;

const stepAttempt: AttemptFunction = (
  run: RunMock,
  overrides?: Partial<WorkflowRunAttempt>,
): WorkflowRunAttempt => {
  return {
    kind: WorkflowRunKind.Step,
    stepTitle: "If / Else",
    run: run,
    ...overrides,
  };
};

type NewRunFunction = () => RunMock;

const newRun: NewRunFunction = (): RunMock => {
  return jest.fn(async (): Promise<void> => {
    // Sent.
  }) as RunMock;
};

type RefusedFunction = (message: string) => RunMock;

// A run the server refuses with this message.
const refusedRun: RefusedFunction = (message: string): RunMock => {
  return jest.fn(async (): Promise<void> => {
    throw new Error(message);
  }) as RunMock;
};

beforeEach(() => {
  latest = null;
  saveIsEnabled = jest.fn(async (): Promise<void> => {
    // Saved.
  }) as SaveMock;
  fetchIsEnabled = jest.fn(async (): Promise<boolean | null> => {
    return true;
  }) as FetchMock;
  onError = jest.fn() as ErrorMock;
});

afterEach(() => {
  cleanup();
});

describe("what the Builder knows about the switch", () => {
  test("nothing until the workflow has loaded", () => {
    render(
      <Harness
        saveIsEnabled={saveIsEnabled}
        fetchIsEnabled={fetchIsEnabled}
        onError={onError}
      />,
    );

    expect(hook().isEnabled).toBeNull();
    expect(hook().heldRun).toBeNull();
    expect(hook().isSaving).toBe(false);
    expect(hook().isTurningOn).toBe(false);
    expect(hook().turnOnError).toBe("");
  });

  test.each([true, false])(
    "what the workflow said when it loaded: %s",
    async (loaded: boolean) => {
      await mount(loaded);

      expect(hook().isEnabled).toBe(loaded);
    },
  );
});

describe("a run started while the workflow is off", () => {
  test("is held, not sent, and nothing is saved yet", async () => {
    await mount(false);
    const run: RunMock = newRun();

    await act(async () => {
      await hook().run(stepAttempt(run));
    });

    expect(run).not.toHaveBeenCalled();
    expect(saveIsEnabled).not.toHaveBeenCalled();
    expect(fetchIsEnabled).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(hook().heldRun?.kind).toBe(WorkflowRunKind.Step);
    expect(hook().heldRun?.stepTitle).toBe("If / Else");
  });

  test("Turn on and run turns the workflow on, then sends that very run once", async () => {
    await mount(false);
    const order: Array<string> = [];
    saveIsEnabled.mockImplementation(async (value: boolean): Promise<void> => {
      order.push(`save ${value}`);
    });
    const run: RunMock = jest.fn(async (): Promise<void> => {
      order.push("run");
    }) as RunMock;

    await act(async () => {
      await hook().run(stepAttempt(run));
    });

    await act(async () => {
      await hook().turnOnAndRun();
    });

    expect(order).toEqual(["save true", "run"]);
    expect(saveIsEnabled).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(hook().isEnabled).toBe(true);
    expect(hook().heldRun).toBeNull();
    expect(hook().isTurningOn).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  test("once it is on, the next run goes straight through", async () => {
    await mount(false);

    await act(async () => {
      await hook().run(stepAttempt(newRun()));
    });

    await act(async () => {
      await hook().turnOnAndRun();
    });

    const next: RunMock = newRun();

    await act(async () => {
      await hook().run({ kind: WorkflowRunKind.Workflow, run: next });
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(hook().heldRun).toBeNull();
    expect(saveIsEnabled).toHaveBeenCalledTimes(1);
  });

  test("a workflow that cannot be turned on keeps the run held, with the reason, and sends nothing", async () => {
    await mount(false);
    saveIsEnabled.mockRejectedValue(
      new Error("You do not have permission to update this Workflow."),
    );
    const run: RunMock = newRun();

    await act(async () => {
      await hook().run(stepAttempt(run));
    });

    await act(async () => {
      await hook().turnOnAndRun();
    });

    expect(run).not.toHaveBeenCalled();
    expect(hook().turnOnError).toBe(
      "You do not have permission to update this Workflow.",
    );
    expect(hook().heldRun).not.toBeNull();
    expect(hook().isEnabled).toBe(false);
    expect(hook().isTurningOn).toBe(false);
    // Said in the dialog, not in a second dialog on top of it.
    expect(onError).not.toHaveBeenCalled();
  });

  test("a second try after a refused turn-on clears the old reason and can succeed", async () => {
    await mount(false);
    saveIsEnabled.mockRejectedValueOnce(new Error("Network error"));
    const run: RunMock = newRun();

    await act(async () => {
      await hook().run(stepAttempt(run));
    });

    await act(async () => {
      await hook().turnOnAndRun();
    });

    expect(hook().turnOnError).toBe("Network error");

    await act(async () => {
      await hook().turnOnAndRun();
    });

    expect(hook().turnOnError).toBe("");
    expect(run).toHaveBeenCalledTimes(1);
    expect(hook().heldRun).toBeNull();
  });

  test("Cancel drops the run: nothing saved, nothing sent", async () => {
    await mount(false);
    const run: RunMock = newRun();

    await act(async () => {
      await hook().run(stepAttempt(run));
    });

    act(() => {
      hook().dismissHeldRun();
    });

    expect(hook().heldRun).toBeNull();

    await act(async () => {
      await hook().turnOnAndRun();
    });

    expect(saveIsEnabled).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(hook().isEnabled).toBe(false);
  });

  test("the dialog cannot be dismissed while the workflow is being turned on", async () => {
    await mount(false);
    let finishSave: () => void = (): void => {
      // Replaced below.
    };
    saveIsEnabled.mockImplementation((): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        finishSave = resolve;
      });
    });
    const run: RunMock = newRun();

    await act(async () => {
      await hook().run(stepAttempt(run));
    });

    let turningOn: Promise<void> = Promise.resolve();

    act(() => {
      turningOn = hook().turnOnAndRun();
    });

    expect(hook().isTurningOn).toBe(true);

    act(() => {
      hook().dismissHeldRun();
    });

    expect(hook().heldRun).not.toBeNull();

    await act(async () => {
      finishSave();
      await turningOn;
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(hook().heldRun).toBeNull();
  });

  test("a second press of Turn on and run while the first is saving sends one run", async () => {
    await mount(false);
    let finishSave: () => void = (): void => {
      // Replaced below.
    };
    saveIsEnabled.mockImplementation((): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        finishSave = resolve;
      });
    });
    const run: RunMock = newRun();

    await act(async () => {
      await hook().run(stepAttempt(run));
    });

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();

    act(() => {
      first = hook().turnOnAndRun();
      second = hook().turnOnAndRun();
    });

    await act(async () => {
      finishSave();
      await Promise.all([first, second]);
    });

    expect(saveIsEnabled).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("a run refused again after the workflow was turned on is shown as it is, not held a second time", async () => {
    await mount(false);
    const run: RunMock = refusedRun("Plan limit reached.");

    await act(async () => {
      await hook().run(stepAttempt(run));
    });

    await act(async () => {
      await hook().turnOnAndRun();
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("Plan limit reached.");
    expect(hook().heldRun).toBeNull();
    // Only the turn-on was saved; nothing asked the server for the switch.
    expect(fetchIsEnabled).not.toHaveBeenCalled();
  });
});

describe("a run the server refuses while the Builder thinks the workflow is on", () => {
  test("because it was turned off elsewhere: the run is held and the dialog opens, no Error dialog", async () => {
    await mount(true);
    fetchIsEnabled.mockResolvedValue(false);
    const run: RunMock = refusedRun(
      "This workflow is turned off, so it can't run.",
    );

    await act(async () => {
      await hook().run(stepAttempt(run));
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(fetchIsEnabled).toHaveBeenCalledTimes(1);
    expect(hook().isEnabled).toBe(false);
    expect(hook().heldRun?.stepTitle).toBe("If / Else");
    expect(onError).not.toHaveBeenCalled();
  });

  test("then turning it on sends the run again", async () => {
    await mount(true);
    fetchIsEnabled.mockResolvedValue(false);
    const run: RunMock = jest.fn() as RunMock;
    run
      .mockRejectedValueOnce(new Error("turned off"))
      .mockResolvedValueOnce(undefined);

    await act(async () => {
      await hook().run(stepAttempt(run));
    });

    await act(async () => {
      await hook().turnOnAndRun();
    });

    expect(run).toHaveBeenCalledTimes(2);
    expect(saveIsEnabled).toHaveBeenCalledWith(true);
    expect(hook().isEnabled).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  test("for any other reason: the reason is shown, and nothing is held", async () => {
    await mount(true);
    const run: RunMock = refusedRun(
      "You do not have permission to run this workflow.",
    );

    await act(async () => {
      await hook().run(stepAttempt(run));
    });

    expect(onError).toHaveBeenCalledWith(
      "You do not have permission to run this workflow.",
    );
    expect(hook().heldRun).toBeNull();
    expect(hook().isEnabled).toBe(true);
  });

  test("when the switch cannot be read either, the refusal is shown as it is", async () => {
    await mount(true);
    fetchIsEnabled.mockRejectedValue(new Error("offline"));

    await act(async () => {
      await hook().run(stepAttempt(refusedRun("Server Error")));
    });

    expect(onError).toHaveBeenCalledWith("Server Error");
    expect(hook().heldRun).toBeNull();
  });

  test("when the switch reads as unknown, the refusal is shown as it is", async () => {
    await mount(true);
    fetchIsEnabled.mockResolvedValue(null);

    await act(async () => {
      await hook().run(stepAttempt(refusedRun("Server Error")));
    });

    expect(onError).toHaveBeenCalledWith("Server Error");
    expect(hook().heldRun).toBeNull();
    expect(hook().isEnabled).toBe(true);
  });
});

describe("a run while the switch is not known", () => {
  test("is sent: the server decides", async () => {
    await mount(null);
    const run: RunMock = newRun();

    await act(async () => {
      await hook().run(stepAttempt(run));
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(hook().heldRun).toBeNull();
  });

  test("and refused because the workflow is off, it is held like any other", async () => {
    await mount(null);
    fetchIsEnabled.mockResolvedValue(false);

    await act(async () => {
      await hook().run({
        kind: WorkflowRunKind.Workflow,
        run: refusedRun("turned off"),
      });
    });

    expect(hook().heldRun?.kind).toBe(WorkflowRunKind.Workflow);
    expect(hook().isEnabled).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("the switch", () => {
  test("turning it on moves at once and saves true", async () => {
    await mount(false);

    await act(async () => {
      await hook().setIsEnabled(true);
    });

    expect(saveIsEnabled).toHaveBeenCalledWith(true);
    expect(hook().isEnabled).toBe(true);
    expect(hook().isSaving).toBe(false);
  });

  test("turning it off saves false", async () => {
    await mount(true);

    await act(async () => {
      await hook().setIsEnabled(false);
    });

    expect(saveIsEnabled).toHaveBeenCalledWith(false);
    expect(hook().isEnabled).toBe(false);
  });

  test("shows the new state while saving, and moves back when the save is refused", async () => {
    await mount(false);
    let refuse: (reason: Error) => void = (): void => {
      // Replaced below.
    };
    saveIsEnabled.mockImplementation((): Promise<void> => {
      return new Promise<void>(
        (_resolve: () => void, reject: (reason: Error) => void) => {
          refuse = reject;
        },
      );
    });

    let saving: Promise<void> = Promise.resolve();

    act(() => {
      saving = hook().setIsEnabled(true);
    });

    expect(hook().isEnabled).toBe(true);
    expect(hook().isSaving).toBe(true);

    await act(async () => {
      refuse(new Error("You do not have permission to update this Workflow."));
      await saving;
    });

    expect(hook().isEnabled).toBe(false);
    expect(hook().isSaving).toBe(false);
    expect(onError).toHaveBeenCalledWith(
      "You do not have permission to update this Workflow.",
    );
  });

  test("a second press while the first is saving is not sent", async () => {
    await mount(false);
    let finishSave: () => void = (): void => {
      // Replaced below.
    };
    saveIsEnabled.mockImplementation((): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        finishSave = resolve;
      });
    });

    let first: Promise<void> = Promise.resolve();

    act(() => {
      first = hook().setIsEnabled(true);
    });

    await act(async () => {
      await hook().setIsEnabled(false);
    });

    await act(async () => {
      finishSave();
      await first;
    });

    expect(saveIsEnabled).toHaveBeenCalledTimes(1);
    expect(hook().isEnabled).toBe(true);
  });

  test("setting the state it already has saves nothing", async () => {
    await mount(true);

    await act(async () => {
      await hook().setIsEnabled(true);
    });

    expect(saveIsEnabled).not.toHaveBeenCalled();
  });

  test("turned on from the notice, a run started next is not held", async () => {
    await mount(false);

    await act(async () => {
      await hook().setIsEnabled(true);
    });

    const run: RunMock = newRun();

    await act(async () => {
      await hook().run(stepAttempt(run));
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(hook().heldRun).toBeNull();
  });
});
