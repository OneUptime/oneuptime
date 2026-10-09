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
import React from "react";
import { SpyInstance } from "jest-mock";
import RecordIdModal, {
  ComponentProps,
} from "../../../../UI/Components/ObjectID/RecordIdModal";
import { API_DOCS_URL } from "../../../../UI/Config";
import Navigation from "../../../../UI/Utils/Navigation";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import ObjectID from "../../../../Types/ObjectID";

/*
 * The dialog "Show ID" opens, on every table and on the status page's
 * resources and groups.
 *
 * Issue #4615: on AI / LLM > Overview, Show ID threw minified React error #31
 * ("Objects are not valid as a React child") - the LLM call's ID is an
 * ObjectID, and the dialog put whatever it was given straight into a <code>.
 * This dialog turns every shape an ID arrives in into its text, so these
 * tests hand it every shape: a string, an ObjectID, the { _type, value } JSON
 * of an API response, and nothing at all.
 */

const RECORD_ID: string = "0199c9b2-4f7e-7a10-9f1e-1234567890ab";

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

let onClose: ReturnType<typeof jest.fn<() => void>>;
let navigateSpy: SpyInstance<typeof Navigation.navigate>;
let consoleErrorSpy: SpyInstance<typeof console.error>;

function renderModal(props: Partial<ComponentProps> = {}): void {
  render(
    <RecordIdModal
      recordId={RECORD_ID}
      itemName="LLM Call"
      onClose={onClose}
      {...props}
    />,
  );
}

function idRow(): HTMLElement {
  return screen.getByTestId("record-id-value");
}

function footerButtonNames(): Array<string> {
  return within(screen.getByTestId("modal-footer"))
    .getAllByRole("button")
    .map((button: HTMLElement): string => {
      return (button.textContent || "").trim();
    });
}

// What React logs when it is handed an object as a child.
function reactChildErrors(): Array<string> {
  return consoleErrorSpy.mock.calls
    .map((call: Array<unknown>): string => {
      return call.map(String).join(" ");
    })
    .filter((message: string): boolean => {
      return message.includes("Objects are not valid as a React child");
    });
}

beforeEach(() => {
  onClose = jest.fn<() => void>();
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {
      return undefined;
    });
  consoleErrorSpy = jest.spyOn(console, "error");
  Object.defineProperty(document, "execCommand", {
    value: undefined,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  }
});

describe("the ID, in every shape it arrives in", () => {
  const SHAPES: Array<{ name: string; recordId: unknown }> = [
    { name: "a string (a database model's _id)", recordId: RECORD_ID },
    {
      name: "an ObjectID (an analytics row's _id - the LLM call of #4615)",
      recordId: new ObjectID(RECORD_ID),
    },
    {
      name: "the { _type, value } JSON of an API response",
      recordId: { _type: "ObjectID", value: RECORD_ID },
    },
    { name: "a string with spaces round it", recordId: `  ${RECORD_ID}\n` },
  ];

  for (const { name, recordId } of SHAPES) {
    test(`shows ${name} as its text`, () => {
      expect(() => {
        renderModal({ recordId });
      }).not.toThrow();

      expect(idRow().textContent).toBe(RECORD_ID);
      expect(screen.getByTestId("record-id")).not.toHaveTextContent(
        "[object Object]",
      );
      expect(reactChildErrors()).toEqual([]);
    });
  }

  test("shows a numeric id as its digits", () => {
    renderModal({ recordId: 1024 });

    expect(idRow().textContent).toBe("1024");
  });

  test("puts the ID on a row of its own, in a monospace font, selected with one click", () => {
    renderModal({ recordId: new ObjectID(RECORD_ID) });

    const code: HTMLElement = idRow();

    expect(code.tagName).toBe("CODE");
    expect(code).toHaveClass("font-mono", "select-all", "break-all");
    // An ID reads left to right, in a right-to-left page too.
    expect(code).toHaveAttribute("dir", "ltr");
  });

  test("puts the copy button beside the ID, and under it on a phone", () => {
    renderModal();

    const row: HTMLElement = screen.getByTestId("record-id-row");

    expect(row).toContainElement(idRow());
    expect(row).toContainElement(
      screen.getByRole("button", { name: "Copy ID to clipboard" }),
    );
    // Stacked below sm, so a 36-character ID keeps to one line on a phone.
    expect(row).toHaveClass("flex-col", "sm:flex-row", "sm:items-center");
    expect(idRow()).toHaveClass("w-full", "min-w-0", "flex-1");
  });
});

describe("a record with no ID", () => {
  const NOTHING: Array<{ name: string; recordId: unknown }> = [
    { name: "undefined", recordId: undefined },
    { name: "null", recordId: null },
    { name: "an empty string", recordId: "" },
    { name: "spaces", recordId: "   " },
    { name: "an empty ObjectID", recordId: new ObjectID("") },
    { name: "an object with no value", recordId: {} },
  ];

  for (const { name, recordId } of NOTHING) {
    test(`says so, for ${name}, and offers nothing to copy`, () => {
      renderModal({ recordId, apiReferencePagePath: "span" });

      expect(screen.getByTestId("record-id-none")).toHaveTextContent(
        "This LLM Call has no ID.",
      );
      expect(screen.queryByTestId("record-id-value")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Copy ID to clipboard" }),
      ).toBeNull();
      // Nothing to look up in the API, so no way there either.
      expect(screen.queryByTestId("record-id-api-reference")).toBeNull();
      expect(footerButtonNames()).toEqual(["Close"]);
      expect(reactChildErrors()).toEqual([]);
    });
  }
});

describe("the title and the words", () => {
  test("names what the record is", () => {
    renderModal();

    expect(screen.getByTestId("modal-title")).toHaveTextContent("LLM Call ID");
    expect(screen.getByTestId("record-id")).toHaveTextContent(
      "ID of this LLM Call:",
    );
  });

  test("is titled after the record's own name when it has one", () => {
    renderModal({ itemName: "Status Page Resource", recordName: "API Server" });

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "API Server ID",
    );
    expect(screen.getByTestId("record-id")).toHaveTextContent(
      "ID of this Status Page Resource:",
    );
  });

  test("falls back to what the record is for a blank name", () => {
    renderModal({ itemName: "Status Page Group", recordName: "   " });

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Status Page Group ID",
    );
  });

  test("starts on the copy button, so Enter copies the ID", () => {
    renderModal();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Copy ID to clipboard" }),
    );
  });
});

describe("the copy button", () => {
  test("copies the ID's text - not the object - and says so", async () => {
    jest.useFakeTimers();
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    installClipboard(writeText);

    renderModal({ recordId: new ObjectID(RECORD_ID) });

    const copy: HTMLElement = screen.getByRole("button", {
      name: "Copy ID to clipboard",
    });

    await act(async () => {
      fireEvent.click(copy);
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(RECORD_ID);
    expect(typeof writeText.mock.calls[0]![0]).toBe("string");
    expect(copy).toHaveTextContent("Copied!");

    await act(async () => {
      jest.advanceTimersByTime(1010);
    });

    expect(copy).toHaveTextContent("Copy");
    expect(copy).not.toHaveTextContent("Copied!");
  });

  test("copies the text of the JSON shape too", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    installClipboard(writeText);

    renderModal({ recordId: { _type: "ObjectID", value: RECORD_ID } });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy ID to clipboard" }),
      );
    });

    expect(writeText).toHaveBeenCalledWith(RECORD_ID);
  });

  test("does not claim a copy the browser refused, and leaves the ID to select by hand", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {
        throw new DOMException("Clipboard denied", "NotAllowedError");
      },
    );
    installClipboard(writeText);

    renderModal({ recordId: new ObjectID(RECORD_ID) });

    const copy: HTMLElement = screen.getByRole("button", {
      name: "Copy ID to clipboard",
    });

    await act(async () => {
      fireEvent.click(copy);
    });

    expect(writeText).toHaveBeenCalledWith(RECORD_ID);
    expect(copy).not.toHaveTextContent("Copied!");
    expect(idRow()).toHaveClass("select-all");
    expect(idRow().textContent).toBe(RECORD_ID);
  });

  test("copying does not close the dialog", async () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {}),
    );

    renderModal();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy ID to clipboard" }),
      );
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal")).toBeInTheDocument();
  });
});

describe("the way to the API Reference", () => {
  test("is offered for a model the API Reference documents", () => {
    renderModal({ apiReferencePagePath: "span" });

    expect(screen.getByTestId("record-id-api-reference")).toHaveTextContent(
      "You can use this ID to interact with LLM Call via the OneUptime API. Click the button below to go to API Reference.",
    );
    expect(footerButtonNames()).toEqual(["Close", "Go to API Docs"]);
  });

  test("opens that model's page in a new tab, and closes the dialog", () => {
    renderModal({ apiReferencePagePath: "span" });

    fireEvent.click(screen.getByRole("button", { name: "Go to API Docs" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledTimes(1);

    const [destination, options] = navigateSpy.mock.calls[0]!;

    expect(destination).toBeInstanceOf(URL);
    expect((destination as URL | Route).toString()).toBe(
      URL.fromString(API_DOCS_URL.toString()).addRoute("/span").toString(),
    );
    expect(destination.toString().endsWith("/reference/span")).toBe(true);
    expect(options).toEqual({ openInNewTab: true });
  });

  for (const apiReferencePagePath of [undefined, null, ""]) {
    test(`is not offered without a page (${String(apiReferencePagePath)}) - no sentence, no button`, () => {
      renderModal({ apiReferencePagePath });

      expect(screen.queryByTestId("record-id-api-reference")).toBeNull();
      expect(screen.getByTestId("record-id")).not.toHaveTextContent(
        "OneUptime API",
      );
      expect(footerButtonNames()).toEqual(["Close"]);
      expect(
        screen.queryByRole("button", { name: "Go to API Docs" }),
      ).toBeNull();
      // The ID itself is still there to copy.
      expect(idRow().textContent).toBe(RECORD_ID);
    });
  }
});

describe("closing", () => {
  test("Close closes it, and goes nowhere", () => {
    renderModal({ apiReferencePagePath: "span" });

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("the header's X closes it", () => {
    renderModal();

    fireEvent.click(screen.getByTestId("close-button"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Escape closes it", () => {
    renderModal();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("a dialog with no API page still closes from its one button", () => {
    renderModal({ apiReferencePagePath: null });

    fireEvent.click(
      within(screen.getByTestId("modal-footer")).getByRole("button", {
        name: "Close",
      }),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
