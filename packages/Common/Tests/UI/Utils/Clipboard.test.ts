import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Clipboard from "../../../UI/Utils/Clipboard";

/*
 * Clipboard.copyToClipboard reports whether text reached the clipboard.
 * The async API is missing on plain-http origins and inside some frames,
 * and rejects when the document is not focused; the legacy execCommand path
 * covers the first case and the boolean is what lets a button say "Copy
 * failed" instead of a green "Copied!" over an empty clipboard.
 */

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

type ExecCommandMock = ReturnType<typeof jest.fn<(command: string) => boolean>>;

const originalExecCommand: unknown = (
  document as unknown as Record<string, unknown>
)["execCommand"];

function installClipboard(writeText: WriteTextMock | undefined): void {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

function installExecCommand(execCommand: ExecCommandMock | undefined): void {
  Object.defineProperty(document, "execCommand", {
    value: execCommand,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  installClipboard(undefined);
  installExecCommand(undefined);
});

afterEach(() => {
  installClipboard(undefined);
  Object.defineProperty(document, "execCommand", {
    value: originalExecCommand,
    configurable: true,
    writable: true,
  });
});

describe("Clipboard.copyToClipboard", () => {
  test("uses the async clipboard when it is there and reports success", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    const execCommand: ExecCommandMock = jest.fn<(command: string) => boolean>(
      (): boolean => {
        return true;
      },
    );
    installClipboard(writeText);
    installExecCommand(execCommand);

    await expect(Clipboard.copyToClipboard("@k:v")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("@k:v");
    expect(execCommand).not.toHaveBeenCalled();
  });

  test("falls back to execCommand when the async clipboard is absent", async () => {
    const execCommand: ExecCommandMock = jest.fn<(command: string) => boolean>(
      (): boolean => {
        return true;
      },
    );
    installExecCommand(execCommand);

    await expect(Clipboard.copyToClipboard("@k:v")).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledWith("copy");
    // The scratch textarea does not outlive the copy.
    expect(document.querySelector("textarea")).toBeNull();
  });

  test("the scratch textarea holds the text while the command runs", async () => {
    let seenValue: string = "";
    const execCommand: ExecCommandMock = jest.fn<(command: string) => boolean>(
      (): boolean => {
        seenValue = document.querySelector("textarea")?.value || "";

        return true;
      },
    );
    installExecCommand(execCommand);

    await Clipboard.copyToClipboard('@resource.host.name:"web 01"');

    expect(seenValue).toBe('@resource.host.name:"web 01"');
  });

  test("falls back to execCommand when the async write rejects", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {
        throw new Error("Document is not focused.");
      },
    );
    const execCommand: ExecCommandMock = jest.fn<(command: string) => boolean>(
      (): boolean => {
        return true;
      },
    );
    installClipboard(writeText);
    installExecCommand(execCommand);

    await expect(Clipboard.copyToClipboard("@k:v")).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  test("reports failure, without throwing, when neither path can copy", async () => {
    await expect(Clipboard.copyToClipboard("@k:v")).resolves.toBe(false);
  });

  test("reports failure when execCommand itself refuses", async () => {
    const execCommand: ExecCommandMock = jest.fn<(command: string) => boolean>(
      (): boolean => {
        return false;
      },
    );
    installExecCommand(execCommand);

    await expect(Clipboard.copyToClipboard("@k:v")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  test("reports failure when execCommand throws", async () => {
    const execCommand: ExecCommandMock = jest.fn<(command: string) => boolean>(
      (): boolean => {
        throw new Error("not supported");
      },
    );
    installExecCommand(execCommand);

    await expect(Clipboard.copyToClipboard("@k:v")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });
});

/*
 * The legacy path selects a scratch textarea, and selecting it moves the
 * focus to it - removed straight after, it would leave the focus on <body>:
 * a keyboard reader's place lost, out of the dialog the copy button sat in.
 * jsdom does not move the focus on select(), so these copy commands do what
 * browsers do and focus the scratch field themselves.
 */
describe("Clipboard.copyToClipboard, the legacy path and the focus", () => {
  function scratchField(): HTMLTextAreaElement | null {
    return document.querySelector("textarea[aria-hidden='true']");
  }

  function focusingExecCommand(result: boolean): ExecCommandMock {
    return jest.fn<(command: string) => boolean>((): boolean => {
      scratchField()?.focus();

      return result;
    });
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("puts the focus back on the button that copied", async () => {
    const button: HTMLButtonElement = document.createElement("button");
    button.textContent = "Copy link";
    document.body.appendChild(button);
    button.focus();

    const execCommand: ExecCommandMock = focusingExecCommand(true);
    installExecCommand(execCommand);

    await expect(Clipboard.copyToClipboard("https://x.test/a")).resolves.toBe(
      true,
    );

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.activeElement).toBe(button);
  });

  test("puts the focus back after a refused copy too", async () => {
    const field: HTMLInputElement = document.createElement("input");
    document.body.appendChild(field);
    field.focus();

    installExecCommand(focusingExecCommand(false));

    await expect(Clipboard.copyToClipboard("x")).resolves.toBe(false);

    expect(document.activeElement).toBe(field);
  });

  test("puts the focus back after the copy command throws", async () => {
    const button: HTMLButtonElement = document.createElement("button");
    document.body.appendChild(button);
    button.focus();

    installExecCommand(
      jest.fn<(command: string) => boolean>((): boolean => {
        scratchField()?.focus();
        throw new Error("not supported");
      }),
    );

    await expect(Clipboard.copyToClipboard("x")).resolves.toBe(false);

    expect(document.activeElement).toBe(button);
  });

  test("leaves the focus alone when nothing had it", async () => {
    installExecCommand(focusingExecCommand(true));

    await Clipboard.copyToClipboard("x");

    expect(document.activeElement).toBe(document.body);
  });

  test("does not reach for an element the copy took off the page", async () => {
    const button: HTMLButtonElement = document.createElement("button");
    document.body.appendChild(button);
    button.focus();

    installExecCommand(
      jest.fn<(command: string) => boolean>((): boolean => {
        scratchField()?.focus();
        button.remove();
        return true;
      }),
    );

    await expect(Clipboard.copyToClipboard("x")).resolves.toBe(true);

    expect(document.activeElement).not.toBe(button);
  });

  test("the scratch field is out of the tab order, hidden from screen readers, read-only and 16px", async () => {
    let attributes: Record<string, string | null> = {};

    installExecCommand(
      jest.fn<(command: string) => boolean>((): boolean => {
        const field: HTMLTextAreaElement = scratchField()!;

        attributes = {
          tabindex: field.getAttribute("tabindex"),
          ariaHidden: field.getAttribute("aria-hidden"),
          readonly: field.getAttribute("readonly"),
          // iOS zooms the page into a focused field whose text is smaller.
          fontSize: field.style.fontSize,
          position: field.style.position,
          selected: String(
            field.selectionStart === 0 &&
              field.selectionEnd === field.value.length,
          ),
        };

        return true;
      }),
    );

    await Clipboard.copyToClipboard("webcal://status.example.lan/x.ics");

    expect(attributes).toEqual({
      tabindex: "-1",
      ariaHidden: "true",
      readonly: "",
      fontSize: "16px",
      position: "fixed",
      selected: "true",
    });
    expect(scratchField()).toBeNull();
  });
});

/*
 * After a copy that failed, the text a control copies is selected where it
 * is shown, so the reader can copy it with the keyboard or the browser's
 * menu: a field focused and selected whole, any other element's text
 * selected without taking the focus.
 */
describe("Clipboard.selectForManualCopy", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  test("focuses a read-only field and selects all of it", () => {
    const field: HTMLInputElement = document.createElement("input");
    field.readOnly = true;
    field.value = "http://status.example.lan/maintenance.ics";
    document.body.appendChild(field);

    Clipboard.selectForManualCopy(field);

    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });

  test("selects a textarea whole as well", () => {
    const field: HTMLTextAreaElement = document.createElement("textarea");
    field.value = "line one\nline two";
    document.body.appendChild(field);

    Clipboard.selectForManualCopy(field);

    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });

  test("selects the text of any other element, and leaves the focus where it is", () => {
    const button: HTMLButtonElement = document.createElement("button");
    const code: HTMLElement = document.createElement("code");
    code.textContent = "npm install @oneuptime/cli";
    document.body.append(button, code);
    button.focus();

    Clipboard.selectForManualCopy(code);

    expect(window.getSelection()?.toString()).toBe(
      "npm install @oneuptime/cli",
    );
    expect(document.activeElement).toBe(button);
  });

  test("replaces whatever was selected before", () => {
    const first: HTMLElement = document.createElement("p");
    first.textContent = "something else";
    const code: HTMLElement = document.createElement("code");
    code.textContent = "the id";
    document.body.append(first, code);
    window.getSelection()?.selectAllChildren(first);

    Clipboard.selectForManualCopy(code);

    expect(window.getSelection()?.toString()).toBe("the id");
  });

  test("does nothing for an element that is missing or no longer on the page", () => {
    const detached: HTMLElement = document.createElement("code");
    detached.textContent = "gone";

    expect(() => {
      Clipboard.selectForManualCopy(null);
      Clipboard.selectForManualCopy(undefined);
      Clipboard.selectForManualCopy(detached);
    }).not.toThrow();
    expect(window.getSelection()?.toString() || "").toBe("");
  });
});
