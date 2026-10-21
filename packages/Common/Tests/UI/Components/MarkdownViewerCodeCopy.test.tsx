/*
 * The Copy button on a code block in rendered Markdown - incident and
 * maintenance notes on a status page, a form's description in Accounts, AI
 * answers and notes in the Dashboard.
 *
 * It called navigator.clipboard.writeText directly: on a page served over
 * plain http, where the browser has no clipboard API, the click threw, and
 * a refused write said nothing at all (issue #5132). It copies through the
 * shared helper now, says "Copied!" only once the code is on the clipboard,
 * and otherwise says "Copy failed" and selects the code, to copy by hand.
 *
 * react-markdown is ESM and does not run under Common's jest, so it is
 * replaced by a stand-in that renders a tree built by each test through the
 * `components` map MarkdownViewer passes it (MarkdownViewerCopy.test.tsx).
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("react-markdown", () => {
  return {
    __esModule: true,
    default: (props: { components?: MockComponents }): React.ReactElement => {
      return mockRenderTree(props.components || {});
    },
    defaultUrlTransform: (url: string): string => {
      return url;
    },
  };
});

// react-syntax-highlighter 16's contract, as in MarkdownViewerCopy.test.tsx.
jest.mock("react-syntax-highlighter/dist/esm/prism-light", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;
  const Highlighter: {
    (props: Record<string, unknown>): React.ReactElement;
    registerLanguage: () => void;
  } = Object.assign(
    (props: Record<string, unknown>): React.ReactElement => {
      const rest: Record<string, unknown> = { ...props };
      for (const known of [
        "PreTag",
        "CodeTag",
        "codeTagProps",
        "children",
        "language",
        "style",
        "customStyle",
      ]) {
        delete rest[known];
      }
      return react.createElement(
        (props["PreTag"] as string | undefined) || "pre",
        rest,
        react.createElement(
          (props["CodeTag"] as string | undefined) || "code",
          props["codeTagProps"] as Record<string, unknown>,
          props["children"] as React.ReactNode,
        ),
      );
    },
    {
      registerLanguage: (): void => {},
    },
  );
  return { __esModule: true, default: Highlighter, vscDarkPlus: {} };
});

import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import MarkdownViewer from "../../../UI/Components/Markdown.tsx/MarkdownViewer";

type MockComponents = Record<string, React.ElementType>;

type TreeBuilder = (components: MockComponents) => React.ReactElement;

const mockTreeState: { build: TreeBuilder | null } = { build: null };

function mockRenderTree(components: MockComponents): React.ReactElement {
  if (!mockTreeState.build) {
    return <div />;
  }
  return mockTreeState.build(components);
}

const SOURCE: string = "kubectl rollout restart deployment/api\n";
const CODE: string = "kubectl rollout restart deployment/api";

// A ```bash fence as react-markdown hands it over: <pre><code class=...>.
function renderCodeFence(): void {
  mockTreeState.build = (components: MockComponents): React.ReactElement => {
    const Pre: React.ElementType = components["pre"] as React.ElementType;
    const Code: React.ElementType = components["code"] as React.ElementType;
    return (
      <Pre>
        <Code className="language-bash">{SOURCE}</Code>
      </Pre>
    );
  };

  render(<MarkdownViewer text="(stand-in)" />);
}

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

function copyButton(): HTMLElement {
  return screen.getByRole("button", { name: "Copy code" });
}

async function pressCopy(): Promise<void> {
  await act(async () => {
    fireEvent.click(copyButton());
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  installExecCommand(undefined);
});

afterEach(() => {
  cleanup();
  mockTreeState.build = null;
  jest.useRealTimers();
  window.getSelection()?.removeAllRanges();
  installClipboard(undefined);

  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  } else {
    installExecCommand(undefined);
  }
});

describe("a Markdown code block's Copy", () => {
  test("copies the code and only then says Copied!, for two seconds", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    installClipboard(writeText);
    renderCodeFence();

    expect(copyButton()).toHaveTextContent("Copy");

    await pressCopy();

    expect(writeText).toHaveBeenCalledWith(CODE);
    expect(copyButton()).toHaveTextContent("Copied!");
    expect(copyButton()).toHaveAttribute("data-copy-state", "copied");

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(copyButton()).not.toHaveTextContent("Copied!");
  });

  test("the bug: with no clipboard API the click no longer throws, and it says Copy failed", async () => {
    installClipboard(undefined);

    const errors: Array<unknown> = [];
    const onError: (event: ErrorEvent) => void = (event: ErrorEvent): void => {
      errors.push(event.error);
    };
    window.addEventListener("error", onError);

    renderCodeFence();
    await pressCopy();

    window.removeEventListener("error", onError);

    expect(errors).toEqual([]);
    expect(copyButton()).toHaveTextContent("Copy failed");
  });

  test("on a plain-http page it copies through the browser's copy command", async () => {
    installClipboard(undefined);
    const execCommand: ReturnType<
      typeof jest.fn<(command: string) => boolean>
    > = jest.fn<(command: string) => boolean>((): boolean => {
      return true;
    });
    installExecCommand(execCommand);

    renderCodeFence();
    await pressCopy();

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copyButton()).toHaveTextContent("Copied!");
  });

  test("a refused copy says Copy failed - never Copied! - and selects the code, to copy by hand", async () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {
        throw new DOMException("Clipboard denied", "NotAllowedError");
      }),
    );
    installExecCommand((): boolean => {
      return false;
    });

    renderCodeFence();
    await pressCopy();

    expect(copyButton()).not.toHaveTextContent("Copied!");
    expect(copyButton()).toHaveTextContent("Copy failed");
    expect(copyButton()).toHaveAttribute("data-copy-state", "failed");
    // The code alone, not the header's language label or the button.
    expect(window.getSelection()?.toString()).toBe(CODE);
  });

  test("what the button says is announced as it changes", async () => {
    installClipboard(undefined);
    renderCodeFence();

    const said: HTMLElement = copyButton().querySelector(
      "[aria-live='polite']",
    ) as HTMLElement;

    expect(said).toHaveTextContent("Copy");

    await pressCopy();

    expect(said).toHaveTextContent("Copy failed");
  });
});
