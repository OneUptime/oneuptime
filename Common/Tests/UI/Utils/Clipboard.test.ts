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
