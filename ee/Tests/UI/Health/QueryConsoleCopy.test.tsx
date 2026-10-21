import "@testing-library/jest-dom";
// The global jest, as HealthLicenseRequired.test.tsx uses: its jest.Mock type.
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import QueryConsole from "../../../AdminDashboard/Health/QueryConsole";

/*
 * The OneUptime Health query console's Copy JSON, over a result table.
 *
 * It called navigator.clipboard?.writeText and said nothing either way: on a
 * page served over plain http - a self-hosted install reached by a LAN
 * hostname - there is no navigator.clipboard, so the button did nothing at
 * all (issue #5132). It copies through the shared helper now (the async
 * clipboard, then the browser's older copy command), says Copied! only once
 * the rows are on the clipboard, and Copy failed when they are not.
 */

const mockApiPost: jest.Mock = jest.fn();

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (): Promise<never> => {
        return new Promise<never>(() => {
          // never settles
        });
      },
      post: (...args: Array<unknown>): unknown => {
        return mockApiPost(...args);
      },
      getFriendlyMessage: (err: unknown): string => {
        return String(err);
      },
    },
  };
});

// A plain textarea stands in for the editor: typing a query is simplest there.
jest.mock("Common/UI/Components/CodeEditor/CodeEditor", () => {
  const react: typeof import("react") = jest.requireActual(
    "react",
  ) as typeof import("react");

  return {
    __esModule: true,
    default: (props: {
      value?: string;
      onChange?: (value: string) => void;
    }): ReactElement => {
      return react.createElement("textarea", {
        "data-testid": "code-editor",
        value: props.value || "",
        onChange: (event: { target: { value: string } }): void => {
          props.onChange?.(event.target.value);
        },
      });
    },
  };
});

const ROWS: Array<JSONObject> = [
  { id: 1, name: "api" },
  { id: 2, name: "worker" },
];

const ROWS_AS_JSON: string = JSON.stringify(ROWS, null, 2);

type WriteText = (text: string) => Promise<void>;

const originalExecCommand: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(document, "execCommand");

function installClipboard(writeText: WriteText | undefined): void {
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

async function runQueryWithRows(): Promise<void> {
  mockApiPost.mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        success: true,
        columns: ["id", "name"],
        columnTypes: [
          { name: "id", type: "int4" },
          { name: "name", type: "text" },
        ],
        rows: ROWS,
        rowsReturned: 2,
        totalRows: 2,
        truncated: false,
        readOnly: true,
        executionTimeMs: 3,
      } as unknown as JSONObject,
      {},
    ),
  );

  render(
    <MemoryRouter>
      <QueryConsole />
    </MemoryRouter>,
  );

  fireEvent.change(screen.getByTestId("code-editor"), {
    target: { value: "SELECT id, name FROM services" },
  });

  await act(async () => {
    fireEvent.click(screen.getByText("Run"));
  });

  await screen.findByTestId("query-console-copy-json");
}

function copyJson(): HTMLElement {
  return screen.getByTestId("query-console-copy-json");
}

async function pressCopyJson(): Promise<void> {
  await act(async () => {
    fireEvent.click(copyJson());
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  installExecCommand(undefined);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  mockApiPost.mockReset();
  installClipboard(undefined);
  window.localStorage.clear();

  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  } else {
    installExecCommand(undefined);
  }
});

describe("the query console's Copy JSON", () => {
  test("copies the rows as JSON and says Copied! once they are on the clipboard", async () => {
    const copied: Array<string> = [];
    installClipboard(async (text: string): Promise<void> => {
      copied.push(text);
    });

    await runQueryWithRows();

    expect(copyJson()).toHaveTextContent("Copy JSON");

    await pressCopyJson();

    expect(copied).toEqual([ROWS_AS_JSON]);
    expect(copyJson()).toHaveTextContent("Copied!");

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(copyJson()).toHaveTextContent("Copy JSON");
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

    await runQueryWithRows();
    await pressCopyJson();

    expect(copied).toBe(ROWS_AS_JSON);
    expect(copyJson()).toHaveTextContent("Copied!");
  });

  test("the bug: when nothing can copy, it says Copy failed instead of nothing", async () => {
    installClipboard(async (): Promise<void> => {
      throw new DOMException("Clipboard denied", "NotAllowedError");
    });

    await runQueryWithRows();
    await pressCopyJson();

    expect(copyJson()).toHaveTextContent("Copy failed");
    expect(copyJson()).not.toHaveTextContent("Copied!");

    await act(async () => {
      jest.advanceTimersByTime(4000);
    });

    expect(copyJson()).toHaveTextContent("Copy JSON");
  });
});
