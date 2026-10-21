import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, renderHook, RenderHookResult } from "@testing-library/react";
import useClipboardCopy, {
  COPIED_FEEDBACK_MS,
  COPY_FAILED_FEEDBACK_MS,
  ClipboardCopy,
  ClipboardCopyOptions,
  ClipboardCopyStatus,
} from "../../../UI/Utils/UseClipboardCopy";

/*
 * useClipboardCopy: the one behaviour every copy control shares (issue
 * #5132). It copies through Clipboard.copyToClipboard, says Copied only when
 * the text reached the clipboard and Failed otherwise, for a while, and
 * never lets a slower earlier copy - or a copy that finishes after the
 * control is gone - say anything.
 */

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

const originalExecCommand: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(document, "execCommand");

function installClipboard(writeText: WriteTextMock | undefined): void {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

function installExecCommand(
  execCommand: ((command: string) => boolean) | undefined,
): void {
  Object.defineProperty(document, "execCommand", {
    value: execCommand,
    configurable: true,
    writable: true,
  });
}

function acceptingClipboard(): WriteTextMock {
  return jest.fn<(text: string) => Promise<void>>(
    async (): Promise<void> => {},
  );
}

function refusingClipboard(): WriteTextMock {
  return jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {
    throw new DOMException("Write permission denied.", "NotAllowedError");
  });
}

// A write the test finishes (or refuses) when it chooses.
interface HeldWrite {
  writeText: WriteTextMock;
  finish: () => void;
  refuse: () => void;
}

function heldClipboard(): HeldWrite {
  const held: HeldWrite = {
    writeText: jest.fn<(text: string) => Promise<void>>(),
    finish: (): void => {},
    refuse: (): void => {},
  };

  held.writeText.mockImplementation((): Promise<void> => {
    return new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void) => {
        held.finish = resolve;
        held.refuse = (): void => {
          reject(new Error("refused"));
        };
      },
    );
  });

  return held;
}

type Hook = RenderHookResult<ClipboardCopy, ClipboardCopyOptions | undefined>;

function renderCopy(options?: ClipboardCopyOptions): Hook {
  return renderHook(
    (props: ClipboardCopyOptions | undefined) => {
      return useClipboardCopy(props);
    },
    { initialProps: options },
  );
}

async function copy(hook: Hook, text: string, key?: string): Promise<boolean> {
  let result: boolean = false;

  await act(async () => {
    result = await hook.result.current.copy(text, key);
  });

  return result;
}

function advance(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  installClipboard(undefined);
  installExecCommand(undefined);
});

afterEach(() => {
  jest.useRealTimers();
  installClipboard(undefined);

  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  } else {
    installExecCommand(undefined);
  }
});

describe("useClipboardCopy", () => {
  test("starts idle", () => {
    const hook: Hook = renderCopy();

    expect(hook.result.current.status).toBe(ClipboardCopyStatus.Idle);
    expect(hook.result.current.isCopied).toBe(false);
    expect(hook.result.current.isFailed).toBe(false);
  });

  test("a copy the clipboard takes says Copied, then goes back to idle after two seconds", async () => {
    const writeText: WriteTextMock = acceptingClipboard();
    installClipboard(writeText);

    const hook: Hook = renderCopy();

    await expect(copy(hook, "https://status.example.com/x.ics")).resolves.toBe(
      true,
    );

    expect(writeText).toHaveBeenCalledWith("https://status.example.com/x.ics");
    expect(hook.result.current.status).toBe(ClipboardCopyStatus.Copied);
    expect(hook.result.current.isCopied).toBe(true);

    advance(COPIED_FEEDBACK_MS - 1);
    expect(hook.result.current.isCopied).toBe(true);

    advance(1);
    expect(hook.result.current.status).toBe(ClipboardCopyStatus.Idle);
  });

  test("the regression: no clipboard API and no copy command is a failure, never Copied", async () => {
    // A page served over plain http, in a browser that refuses the old command.
    const hook: Hook = renderCopy();

    await expect(copy(hook, "x")).resolves.toBe(false);

    expect(hook.result.current.status).toBe(ClipboardCopyStatus.Failed);
    expect(hook.result.current.isCopied).toBe(false);
    expect(hook.result.current.isFailed).toBe(true);
  });

  test("no clipboard API but a working copy command: Copied (the plain-http page)", async () => {
    const execCommand: ReturnType<
      typeof jest.fn<(command: string) => boolean>
    > = jest.fn<(command: string) => boolean>((): boolean => {
      return true;
    });
    installExecCommand(execCommand);

    const hook: Hook = renderCopy();

    await expect(copy(hook, "x")).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(hook.result.current.isCopied).toBe(true);
  });

  test("a refused write with nothing else to try is a failure", async () => {
    installClipboard(refusingClipboard());

    const hook: Hook = renderCopy();

    await expect(copy(hook, "x")).resolves.toBe(false);

    expect(hook.result.current.isFailed).toBe(true);
  });

  test("a failure shows for four seconds by default, longer than a tick", async () => {
    const hook: Hook = renderCopy();

    await copy(hook, "x");

    advance(COPY_FAILED_FEEDBACK_MS - 1);
    expect(hook.result.current.isFailed).toBe(true);

    advance(1);
    expect(hook.result.current.status).toBe(ClipboardCopyStatus.Idle);
    expect(COPY_FAILED_FEEDBACK_MS).toBeGreaterThan(COPIED_FEEDBACK_MS);
  });

  test("failedForMs null keeps the failure until the next copy", async () => {
    const hook: Hook = renderCopy({ failedForMs: null });

    await copy(hook, "x");

    advance(60 * 1000);
    expect(hook.result.current.isFailed).toBe(true);

    installClipboard(acceptingClipboard());
    await copy(hook, "x");

    expect(hook.result.current.isCopied).toBe(true);
    expect(hook.result.current.isFailed).toBe(false);
  });

  test("copiedForMs sets how long Copied stays", async () => {
    installClipboard(acceptingClipboard());

    const hook: Hook = renderCopy({ copiedForMs: 1000 });

    await copy(hook, "x");

    advance(999);
    expect(hook.result.current.isCopied).toBe(true);

    advance(1);
    expect(hook.result.current.isCopied).toBe(false);
  });

  test("nothing is claimed while the write is still in flight", async () => {
    const held: HeldWrite = heldClipboard();
    installClipboard(held.writeText);

    const hook: Hook = renderCopy();
    let pending: Promise<boolean> | null = null;

    act(() => {
      pending = hook.result.current.copy("x");
    });

    expect(hook.result.current.status).toBe(ClipboardCopyStatus.Idle);

    await act(async () => {
      held.finish();
      await pending;
    });

    expect(hook.result.current.isCopied).toBe(true);
  });

  test("a copy again restarts the clock, it does not stack timers", async () => {
    installClipboard(acceptingClipboard());

    const hook: Hook = renderCopy();

    await copy(hook, "x");
    advance(1500);
    await copy(hook, "x");
    advance(1500);

    // 3 s after the first copy, 1.5 s after the second: still Copied.
    expect(hook.result.current.isCopied).toBe(true);

    advance(500);
    expect(hook.result.current.isCopied).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("the latest copy wins: a slower earlier one never overwrites it", async () => {
    const held: HeldWrite = heldClipboard();
    installClipboard(held.writeText);

    const hook: Hook = renderCopy();
    let first: Promise<boolean> | null = null;

    act(() => {
      first = hook.result.current.copy("first", "a");
    });

    // The second copy goes to a clipboard that answers at once.
    installClipboard(acceptingClipboard());
    await copy(hook, "second", "b");

    expect(hook.result.current.statusOf("b")).toBe(ClipboardCopyStatus.Copied);

    // The first one is refused afterwards (and nothing else can copy).
    await act(async () => {
      held.refuse();
      await first;
    });

    expect(hook.result.current.statusOf("b")).toBe(ClipboardCopyStatus.Copied);
    expect(hook.result.current.statusOf("a")).toBe(ClipboardCopyStatus.Idle);
    expect(hook.result.current.isFailed).toBe(false);
  });

  test("a key tells apart the buttons of a list: only the one copied last is Copied", async () => {
    installClipboard(acceptingClipboard());

    const hook: Hook = renderCopy();

    await copy(hook, "answer one", "message-1");

    expect(hook.result.current.statusOf("message-1")).toBe(
      ClipboardCopyStatus.Copied,
    );
    expect(hook.result.current.statusOf("message-2")).toBe(
      ClipboardCopyStatus.Idle,
    );

    installClipboard(undefined);
    await copy(hook, "answer two", "message-2");

    expect(hook.result.current.statusOf("message-1")).toBe(
      ClipboardCopyStatus.Idle,
    );
    expect(hook.result.current.statusOf("message-2")).toBe(
      ClipboardCopyStatus.Failed,
    );
  });

  test("reset goes back to idle at once, and a copy still running then says nothing", async () => {
    const held: HeldWrite = heldClipboard();
    installClipboard(held.writeText);

    const hook: Hook = renderCopy();
    let pending: Promise<boolean> | null = null;

    act(() => {
      pending = hook.result.current.copy("x");
    });

    act(() => {
      hook.result.current.reset();
    });

    await act(async () => {
      held.finish();
      await pending;
    });

    expect(hook.result.current.status).toBe(ClipboardCopyStatus.Idle);
  });

  test("reset clears a failure that would otherwise stay", async () => {
    const hook: Hook = renderCopy({ failedForMs: null });

    await copy(hook, "x");
    expect(hook.result.current.isFailed).toBe(true);

    act(() => {
      hook.result.current.reset();
    });

    expect(hook.result.current.status).toBe(ClipboardCopyStatus.Idle);
  });

  test("a copy that finishes after the control is gone sets nothing and leaves no timer, and still says what happened", async () => {
    const held: HeldWrite = heldClipboard();
    installClipboard(held.writeText);

    const hook: Hook = renderCopy();

    // Watched from here: the render's own warnings are not this test's.
    const errors: ReturnType<typeof jest.spyOn> = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    let pending: Promise<boolean> | null = null;

    act(() => {
      pending = hook.result.current.copy("x");
    });

    hook.unmount();

    let result: boolean | null = null;

    await act(async () => {
      held.finish();
      result = await pending;
    });

    expect(result).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    expect(errors).not.toHaveBeenCalled();

    errors.mockRestore();
  });

  test("leaving while Copied shows leaves no timer behind", async () => {
    installClipboard(acceptingClipboard());

    const hook: Hook = renderCopy();

    await copy(hook, "x");
    expect(jest.getTimerCount()).toBe(1);

    hook.unmount();

    expect(jest.getTimerCount()).toBe(0);
  });

  test("copy keeps its identity across renders, so it can sit in a callback's dependencies", async () => {
    installClipboard(acceptingClipboard());

    const hook: Hook = renderCopy();
    const first: ClipboardCopy["copy"] = hook.result.current.copy;

    await copy(hook, "x");
    hook.rerender(undefined);

    expect(hook.result.current.copy).toBe(first);
  });
});
