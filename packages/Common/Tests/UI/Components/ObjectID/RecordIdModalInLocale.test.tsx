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
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import RecordIdModal from "../../../../UI/Components/ObjectID/RecordIdModal";
import ObjectID from "../../../../Types/ObjectID";

/*
 * The Show ID dialog's words are the Dashboard's: each is a key of its
 * locale files, so the i18n tooling tracks it, and a reader sees the dialog
 * in their language - the record's kind ("LLM Call") translated with the
 * sentence it sits in. The German here is what de.json ships, read from the
 * file itself.
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

// Everything the dialog puts on the screen, apart from the ID itself.
const DIALOG_STRINGS: Array<string> = [
  "{{itemName}} ID",
  "{{name}} ID",
  "ID of this {{itemName}}:",
  "You can use this ID to interact with {{itemName}} via the OneUptime API. Click the button below to go to API Reference.",
  "This {{itemName}} has no ID.",
  "Copy ID to clipboard",
  "Copy",
  "Copied!",
  "Go to API Docs",
  "Close",
];

// Sentences every language must word itself: none reads right in English.
const SENTENCES: Array<string> = [
  "ID of this {{itemName}}:",
  "You can use this ID to interact with {{itemName}} via the OneUptime API. Click the button below to go to API Reference.",
  "This {{itemName}} has no ID.",
  "Copy ID to clipboard",
  "Copied!",
];

const RECORD_ID: string = "0199c9b2-4f7e-7a10-9f1e-1234567890ab";

function readLocale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");
const GERMAN_FILE: Record<string, string> = readLocale("de");

const GERMAN: Record<string, string> = {};

for (const key of [...DIALOG_STRINGS, "LLM Call"]) {
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

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

function inGerman(element: ReactElement): void {
  render(<I18nextProvider i18n={german}>{element}</I18nextProvider>);
}

function fill(template: string, values: Record<string, string>): string {
  let text: string = template;

  for (const [name, value] of Object.entries(values)) {
    text = text.split(`{{${name}}}`).join(value);
  }

  return text;
}

function localeCodes(): Array<string> {
  return fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string): string => {
      return file.replace(/\.json$/, "");
    });
}

describe("the Show ID dialog's words", () => {
  test("are keys of the Dashboard's English locale", () => {
    for (const key of DIALOG_STRINGS) {
      expect({ key, english: ENGLISH[key] }).toEqual({ key, english: key });
    }
  });

  test("are translated in every language the Dashboard ships", () => {
    const codes: Array<string> = localeCodes();

    expect(codes.length).toBeGreaterThanOrEqual(16);

    for (const code of codes) {
      const locale: Record<string, string> = readLocale(code);

      for (const sentence of SENTENCES) {
        expect({ code, sentence, has: typeof locale[sentence] }).toEqual({
          code,
          sentence,
          has: "string",
        });
        expect({
          code,
          sentence,
          translated: locale[sentence] !== sentence,
        }).toEqual({ code, sentence, translated: true });
      }
    }
  });

  test("keep their placeholder in every language", () => {
    for (const code of localeCodes()) {
      const locale: Record<string, string> = readLocale(code);

      for (const sentence of DIALOG_STRINGS) {
        for (const placeholder of sentence.match(/\{\{\w+\}\}/g) || []) {
          expect({
            code,
            sentence,
            placeholder,
            kept: (locale[sentence] || "").includes(placeholder),
          }).toEqual({ code, sentence, placeholder, kept: true });
        }
      }
    }
  });
});

describe("the dialog in German", () => {
  test("titles, labels and explains the ID in German, the record's kind included", () => {
    inGerman(
      <RecordIdModal
        recordId={new ObjectID(RECORD_ID)}
        itemName="LLM Call"
        apiReferencePagePath="span"
        onClose={(): void => {}}
      />,
    );

    const itemName: string = GERMAN["LLM Call"] as string;

    expect(itemName).not.toBe("LLM Call");
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      fill(GERMAN["{{itemName}} ID"] as string, { itemName }),
    );
    expect(screen.getByTestId("record-id")).toHaveTextContent(
      fill(GERMAN["ID of this {{itemName}}:"] as string, { itemName }),
    );
    expect(screen.getByTestId("record-id-api-reference")).toHaveTextContent(
      fill(
        GERMAN[
          "You can use this ID to interact with {{itemName}} via the OneUptime API. Click the button below to go to API Reference."
        ] as string,
        { itemName },
      ),
    );
    expect(screen.getByTestId("record-id-value").textContent).toBe(RECORD_ID);

    const footer: HTMLElement = screen.getByTestId("modal-footer");

    expect(
      within(footer).getByRole("button", {
        name: GERMAN["Go to API Docs"] as string,
      }),
    ).toBeInTheDocument();
    expect(
      within(footer).getByRole("button", { name: GERMAN["Close"] as string }),
    ).toBeInTheDocument();
  });

  test("says Copied! in German once the ID is copied", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    inGerman(
      <RecordIdModal
        recordId={RECORD_ID}
        itemName="LLM Call"
        onClose={(): void => {}}
      />,
    );

    const copy: HTMLElement = screen.getByRole("button", {
      name: GERMAN["Copy ID to clipboard"] as string,
    });

    expect(copy).toHaveTextContent(GERMAN["Copy"] as string);

    await act(async () => {
      fireEvent.click(copy);
    });

    expect(writeText).toHaveBeenCalledWith(RECORD_ID);
    expect(copy).toHaveTextContent(GERMAN["Copied!"] as string);
    expect(copy).not.toHaveTextContent("Copied!");
  });

  test("says in German that a record has no ID", () => {
    inGerman(
      <RecordIdModal
        recordId={null}
        itemName="LLM Call"
        onClose={(): void => {}}
      />,
    );

    expect(screen.getByTestId("record-id-none")).toHaveTextContent(
      fill(GERMAN["This {{itemName}} has no ID."] as string, {
        itemName: GERMAN["LLM Call"] as string,
      }),
    );
  });

  test("titles a named record after its name, which is not translated", () => {
    inGerman(
      <RecordIdModal
        recordId={RECORD_ID}
        itemName="Status Page Resource"
        recordName="Checkout API"
        onClose={(): void => {}}
      />,
    );

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      fill(GERMAN["{{name}} ID"] as string, { name: "Checkout API" }),
    );
  });
});
