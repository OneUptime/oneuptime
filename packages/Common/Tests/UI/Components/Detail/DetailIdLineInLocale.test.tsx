import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import DetailIdLine from "../../../../UI/Components/Detail/DetailIdLine";
import ObjectIDView from "../../../../UI/Components/ObjectID/ObjectIDView";

/*
 * The ID line's words are the Dashboard's: each is a key of its locale files,
 * so the i18n tooling tracks it, and a reader sees them in their language. The
 * German here is what de.json ships, read from the file itself.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

// Everything DetailIdLine and the ID pill (ObjectIDView) put on the screen.
const LINE_STRINGS: Array<string> = [
  "ID",
  "Copy ID to clipboard",
  "Copied!",
  "Copied to clipboard",
  "Copy failed",
  "Click to copy",
];

const RECORD_ID: string = "3f2a8b1c-9d4e-4b7a-a1c2-7e5f6d8c9b0a";

function readLocale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");
const GERMAN_FILE: Record<string, string> = readLocale("de");

const GERMAN: Record<string, string> = {};

for (const key of LINE_STRINGS) {
  if (GERMAN_FILE[key] !== undefined) {
    GERMAN[key] = GERMAN_FILE[key] as string;
  }
}

const german: i18n = createInstance();

beforeAll(async () => {
  await german.init({
    lng: "de",
    resources: { de: { translation: GERMAN } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

function installClipboard(writeText: WriteTextMock | undefined): void {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

const originalExecCommand: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(document, "execCommand");

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(document, "execCommand", {
    value: undefined,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  }
});

function inGerman(element: ReactElement): void {
  render(<I18nextProvider i18n={german}>{element}</I18nextProvider>);
}

describe("the ID line's words", () => {
  test("are keys of the Dashboard's English locale", () => {
    for (const key of LINE_STRINGS) {
      expect({ key, english: ENGLISH[key] }).toEqual({ key, english: key });
    }
  });

  test("are translated in German, apart from ID, which German writes the same", () => {
    for (const key of LINE_STRINGS) {
      expect(GERMAN[key]).toBeDefined();

      if (key !== "ID") {
        expect({ key, german: GERMAN[key] }).not.toEqual({ key, german: key });
      }
    }
  });
});

describe("DetailIdLine in German", () => {
  test("names its copy button in German", () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {}),
    );
    inGerman(<DetailIdLine recordId={RECORD_ID} />);

    expect(screen.getByTestId("detail-id-label")).toHaveTextContent(
      GERMAN["ID"] as string,
    );
    expect(
      screen.getByRole("button", {
        name: GERMAN["Copy ID to clipboard"] as string,
      }),
    ).toBeInTheDocument();
  });

  test("says a copy worked in German", async () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {}),
    );
    inGerman(<DetailIdLine recordId={RECORD_ID} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("detail-id-copy"));
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      GERMAN["Copied to clipboard"] as string,
    );

    fireEvent.mouseEnter(screen.getByTestId("detail-id-copy"));
    await act(async () => {
      jest.advanceTimersByTime(250);
    });

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      GERMAN["Copied!"] as string,
    );
  });

  test("says a copy failed in German", async () => {
    installClipboard(undefined);
    inGerman(<DetailIdLine recordId={RECORD_ID} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("detail-id-copy"));
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      GERMAN["Copy failed"] as string,
    );
  });
});

describe("the ID pill in German", () => {
  test("offers to copy in German", async () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {}),
    );
    inGerman(<ObjectIDView objectId={RECORD_ID} />);

    // The pill around the ID is what the tooltip hangs on.
    fireEvent.mouseEnter(screen.getByText(RECORD_ID).parentElement!);
    await act(async () => {
      jest.advanceTimersByTime(250);
    });

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      GERMAN["Click to copy"] as string,
    );
  });
});
