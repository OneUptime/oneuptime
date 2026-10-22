import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import TemplateVariablesModal from "../../../../UI/Components/MonitorTemplateVariables/TemplateVariablesModal";
import MonitorType from "../../../../Types/Monitor/MonitorType";

/*
 * Dynamic Template Variables: a click on a variable copies {{variable}} and
 * its chip says so. The chip flipped to "Copied" whatever happened - with no
 * clipboard API on a page served over plain http, nothing was copied at all
 * (issue #5132). It says Copied only once the token is on the clipboard now,
 * and Copy failed when it is not; the other chips keep saying Copy.
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

function variableButton(key: string): HTMLElement {
  return screen.getByTitle(`Click to copy {{${key}}}`);
}

function chipOf(key: string): HTMLElement {
  return within(variableButton(key)).getByText(/^(Copy|Copied|Copy failed)$/);
}

async function pressVariable(key: string): Promise<void> {
  await act(async () => {
    fireEvent.click(variableButton(key));
  });
}

function renderModal(): void {
  render(
    <TemplateVariablesModal
      monitorType={MonitorType.API}
      onClose={(): void => {}}
    />,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  installExecCommand(undefined);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  installClipboard(undefined);

  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  } else {
    installExecCommand(undefined);
  }
});

describe("TemplateVariablesModal - copying a variable", () => {
  test("copies {{variable}} and only that chip says Copied, for a moment", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    installClipboard(writeText);
    renderModal();

    await pressVariable("monitorName");

    expect(writeText).toHaveBeenCalledWith("{{monitorName}}");
    expect(chipOf("monitorName")).toHaveTextContent("Copied");
    expect(chipOf("monitorName")).toHaveAttribute("data-copy-state", "copied");
    expect(chipOf("responseStatusCode")).toHaveTextContent("Copy");

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    expect(chipOf("monitorName")).toHaveTextContent("Copy");
    expect(chipOf("monitorName")).not.toHaveTextContent("Copied");
  });

  test("the bug: with no clipboard API and no copy command, the chip never says Copied", async () => {
    installClipboard(undefined);
    renderModal();

    await pressVariable("monitorName");

    expect(chipOf("monitorName")).not.toHaveTextContent("Copied");
    expect(chipOf("monitorName")).toHaveTextContent("Copy failed");
    expect(chipOf("monitorName")).toHaveClass("text-red-700");
  });

  test("on a plain-http page it copies through the browser's copy command", async () => {
    installClipboard(undefined);
    let copied: string = "";
    installExecCommand((): boolean => {
      copied =
        (
          document.querySelector(
            "textarea[aria-hidden='true']",
          ) as HTMLTextAreaElement | null
        )?.value || "";
      return true;
    });
    renderModal();

    await pressVariable("monitorName");

    expect(copied).toBe("{{monitorName}}");
    expect(chipOf("monitorName")).toHaveTextContent("Copied");
  });

  test("a refused copy says Copy failed on that chip alone, and it is announced", async () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {
        throw new DOMException("Clipboard denied", "NotAllowedError");
      }),
    );
    renderModal();

    await pressVariable("monitorName");

    expect(chipOf("monitorName")).toHaveTextContent("Copy failed");
    expect(chipOf("monitorName")).toHaveAttribute("aria-live", "polite");
    expect(chipOf("responseStatusCode")).toHaveTextContent("Copy");
  });

  test("copying another variable moves the chip that speaks", async () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {}),
    );
    renderModal();

    await pressVariable("monitorName");
    await pressVariable("responseStatusCode");

    expect(chipOf("monitorName")).toHaveTextContent("Copy");
    expect(chipOf("monitorName")).not.toHaveTextContent("Copied");
    expect(chipOf("responseStatusCode")).toHaveTextContent("Copied");
  });
});
