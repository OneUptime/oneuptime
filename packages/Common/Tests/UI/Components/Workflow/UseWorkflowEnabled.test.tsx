/*
 * The Builder's Enabled switch, and what it no longer does.
 *
 * "Run - Why do I have to enable a workflow in order to test run it? Can you
 * please fix it?" - the maintainer. The hook used to hold a run started while
 * the workflow was off and ask to turn the workflow on before sending it,
 * which let the workflow's trigger loose just to try it once. Off now pauses
 * the trigger, not a person testing it (Types/Workflow/WorkflowEnabled): the
 * Builder sends every run as it is asked for, and this hook only knows and
 * saves the switch. These tests drive it through a real component lifecycle
 * with the server stood in by mocks.
 */

import useWorkflowEnabled, {
  UseWorkflowEnabledOptions,
  UseWorkflowEnabledResult,
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
import fs from "fs";
import path from "path";

type SaveMock = Mock<(isEnabled: boolean) => Promise<void>>;
type ErrorMock = Mock<(message: string) => void>;

let latest: UseWorkflowEnabledResult | null = null;
let saveIsEnabled: SaveMock;
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
  render(<Harness saveIsEnabled={saveIsEnabled} onError={onError} />);

  await act(async () => {
    hook().setLoadedIsEnabled(loaded);
  });
};

beforeEach(() => {
  latest = null;
  saveIsEnabled = jest.fn(async (): Promise<void> => {
    // Saved.
  }) as SaveMock;
  onError = jest.fn() as ErrorMock;
});

afterEach(() => {
  cleanup();
});

describe("what the Builder knows about the switch", () => {
  test("nothing until the workflow has loaded", () => {
    render(<Harness saveIsEnabled={saveIsEnabled} onError={onError} />);

    expect(hook().isEnabled).toBeNull();
    expect(hook().isSaving).toBe(false);
  });

  test.each([true, false, null])(
    "what the workflow said when it loaded: %p",
    async (loaded: boolean | null) => {
      await mount(loaded);

      expect(hook().isEnabled).toBe(loaded);
      expect(saveIsEnabled).not.toHaveBeenCalled();
    },
  );
});

describe("it holds no run", () => {
  test("it offers nothing to hold a run with, or to turn a workflow on for one", async () => {
    await mount(false);

    expect(Object.keys(hook()).sort()).toEqual([
      "isEnabled",
      "isSaving",
      "setIsEnabled",
      "setLoadedIsEnabled",
    ]);
  });

  test("its source no longer holds a run, or asks the server about the switch after one", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "UI",
        "Components",
        "Workflow",
        "UseWorkflowEnabled.ts",
      ),
      "utf8",
    );

    for (const gone of [
      "heldRun",
      "turnOnAndRun",
      "dismissHeldRun",
      "fetchIsEnabled",
      "WorkflowRunAttempt",
    ]) {
      expect({ gone, present: source.includes(gone) }).toEqual({
        gone,
        present: false,
      });
    }
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

  test("turning on a workflow whose state is not known saves it", async () => {
    await mount(null);

    await act(async () => {
      await hook().setIsEnabled(true);
    });

    expect(saveIsEnabled).toHaveBeenCalledWith(true);
    expect(hook().isEnabled).toBe(true);
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

  test("a press after a save settles is sent", async () => {
    await mount(false);

    await act(async () => {
      await hook().setIsEnabled(true);
    });

    await act(async () => {
      await hook().setIsEnabled(false);
    });

    expect(saveIsEnabled.mock.calls).toEqual([[true], [false]]);
    expect(hook().isEnabled).toBe(false);
  });

  test("setting the state it already has saves nothing", async () => {
    await mount(true);

    await act(async () => {
      await hook().setIsEnabled(true);
    });

    expect(saveIsEnabled).not.toHaveBeenCalled();
  });

  test("a callback made by an earlier render saves with the latest options", async () => {
    const firstSave: SaveMock = jest.fn(async (): Promise<void> => {
      // The first render's save.
    }) as SaveMock;
    const laterSave: SaveMock = jest.fn(async (): Promise<void> => {
      // The newer render's save.
    }) as SaveMock;

    const { rerender } = render(
      <Harness saveIsEnabled={firstSave} onError={onError} />,
    );

    await act(async () => {
      hook().setLoadedIsEnabled(false);
    });

    // Kept from the first render, as an open dialog or a pending click would.
    const setIsEnabled: (value: boolean) => Promise<void> =
      hook().setIsEnabled;

    rerender(<Harness saveIsEnabled={laterSave} onError={onError} />);

    await act(async () => {
      await setIsEnabled(true);
    });

    expect(firstSave).not.toHaveBeenCalled();
    expect(laterSave).toHaveBeenCalledWith(true);
    expect(hook().isEnabled).toBe(true);
  });
});
