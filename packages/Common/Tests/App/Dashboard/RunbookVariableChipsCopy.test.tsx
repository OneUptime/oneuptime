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
} from "@testing-library/react";
import * as React from "react";
import RunbookVariableChips from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/Steps/RunbookVariableChips";
import { RunbookVariableChoice } from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/Steps/RunbookVariableChoices";
import { RunbookVariableScope } from "../../../Types/Runbook/RunbookVariableReference";

/*
 * The variable chips under a runbook step's script: a click copies what to
 * write ({{global.variables.NAME}}). A refused copy said nothing - a chip
 * that seemed to do nothing (issue #5132's "every copy button copies or says
 * it could not"). The chip says Copied! once the reference is on the
 * clipboard, Copy failed when it is not, and a screen reader hears either.
 */

function choice(
  name: string,
  isSecret: boolean = false,
): RunbookVariableChoice {
  return {
    scope: RunbookVariableScope.Global,
    name: name,
    reference: `{{global.variables.${name}}}`,
    isSecret: isSecret,
    runnerIds: [],
    isAvailableToGlobalRunners: true,
  };
}

function renderChips(): void {
  render(
    <RunbookVariableChips
      choices={{
        variables: [choice("DB_HOST"), choice("SSH_KEY", true)],
        isReadable: true,
      }}
      dataTestId="step-variables"
    />,
  );
}

function chip(name: string): HTMLElement {
  return screen.getByRole("button", {
    name: `Copy {{global.variables.${name}}}`,
  });
}

async function pressChip(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(chip(name));
  });
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
    writable: true,
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

describe("runbook variable chips - copying a reference", () => {
  test("copies the reference, says Copied! on that chip alone, and a screen reader hears it", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    installClipboard(writeText);
    renderChips();

    await pressChip("DB_HOST");

    expect(writeText).toHaveBeenCalledWith("{{global.variables.DB_HOST}}");
    expect(chip("DB_HOST")).toHaveTextContent("Copied!");
    expect(chip("DB_HOST")).toHaveAttribute("data-copy-state", "copied");
    expect(chip("SSH_KEY")).not.toHaveTextContent("Copied!");
    expect(screen.getByRole("status")).toHaveTextContent("Copied!");

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    expect(chip("DB_HOST")).not.toHaveTextContent("Copied!");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  test("a refused copy says Copy failed on that chip - never Copied!", async () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {
        throw new DOMException("Clipboard denied", "NotAllowedError");
      }),
    );
    renderChips();

    await pressChip("SSH_KEY");

    expect(chip("SSH_KEY")).toHaveTextContent("Copy failed");
    expect(chip("SSH_KEY")).not.toHaveTextContent("Copied!");
    expect(chip("SSH_KEY")).toHaveAttribute("data-copy-state", "failed");
    expect(chip("DB_HOST")).not.toHaveTextContent("Copy failed");
    expect(screen.getByRole("status")).toHaveTextContent("Copy failed");
  });

  test("on a plain-http page (no clipboard API) it copies through the browser's copy command", async () => {
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
    renderChips();

    await pressChip("DB_HOST");

    expect(copied).toBe("{{global.variables.DB_HOST}}");
    expect(chip("DB_HOST")).toHaveTextContent("Copied!");
  });

  test("the chip's name stays what pressing it does, whatever it says", async () => {
    installClipboard(undefined);
    renderChips();

    await pressChip("DB_HOST");

    // chip() finds it by that name.
    expect(chip("DB_HOST")).toBeInTheDocument();
  });
});
