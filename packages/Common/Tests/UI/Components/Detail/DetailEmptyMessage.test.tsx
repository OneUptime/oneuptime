import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import Detail, { DetailStyle } from "../../../../UI/Components/Detail/Detail";
import Field from "../../../../UI/Components/Detail/Field";
import FieldType from "../../../../UI/Components/Types/FieldType";

/*
 * What a detail says when none of its fields has anything to show
 * (emptyMessage): one line, in the reader's language, in place of an empty
 * grid - and the record's ID line after it, ruled off as it is under rows.
 *
 * #5307's follow-up: a resource Overview's details card draws only what
 * the resource reported (ResourceRecordDetailsCard), so a new Docker host,
 * cluster or storage array that has reported nothing yet would have shown
 * a card of nothing but its ID line. It says "No details reported yet."
 * there now, as a ResourceOverview's Details card does. A detail that sets
 * no emptyMessage draws as it always did.
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

const EMPTY_MESSAGE: string = "No details reported yet.";
const RECORD_ID: string = "3f2a8b1c-9d4e-4b7a-a1c2-7e5f6d8c9b0a";

interface Item {
  _id?: string | undefined;
  osVersion?: string | undefined;
  agentVersion?: string | undefined;
}

const ID_FIELD: Field<Item> = {
  key: "_id",
  title: "ID",
  fieldType: FieldType.ObjectID,
};

// Drawn only when the resource reported it, as a record details card's are.
function reported(key: keyof Item, title: string): Field<Item> {
  return {
    key: key,
    title: title,
    fieldType: FieldType.Text,
    showIf: (item: Item): boolean => {
      return Boolean(item[key]);
    },
  };
}

const OS_VERSION: Field<Item> = reported("osVersion", "OS Version");
const AGENT_VERSION: Field<Item> = reported("agentVersion", "Agent Version");

function readLocale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

const GERMAN_FILE: Record<string, string> = readLocale("de");
const german: i18n = createInstance();

beforeAll(async () => {
  await german.init({
    lng: "de",
    resources: {
      de: {
        translation: { [EMPTY_MESSAGE]: GERMAN_FILE[EMPTY_MESSAGE] as string },
      },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

function renderDetail(props: {
  item: Item;
  fields: Array<Field<Item>>;
  emptyMessage?: string | undefined;
  style?: DetailStyle | undefined;
  wrap?: (element: ReactElement) => ReactElement;
}): HTMLElement {
  const element: ReactElement = (
    <Detail<Item>
      id="docker-host-details"
      item={props.item}
      fields={props.fields}
      showDetailsInNumberOfColumns={2}
      emptyMessage={props.emptyMessage}
      style={props.style}
    />
  );
  const { container } = render(props.wrap ? props.wrap(element) : element);
  return container.firstElementChild as HTMLElement;
}

function emptyLine(): HTMLElement | null {
  return screen.queryByTestId("detail-empty-message");
}

describe("nothing to show, said in one line", () => {
  test("a detail whose every field is unreported says so, in place of an empty grid", () => {
    const detail: HTMLElement = renderDetail({
      item: {},
      fields: [OS_VERSION, AGENT_VERSION],
      emptyMessage: EMPTY_MESSAGE,
    });

    expect(emptyLine()).toHaveTextContent(EMPTY_MESSAGE);
    expect(emptyLine()!.tagName).toBe("P");
    expect(emptyLine()).toHaveClass("text-sm", "leading-6", "text-gray-500");
    // The detail's own element holds it; no grid, no row, no label.
    expect(detail).toHaveAttribute("id", "docker-host-details");
    expect(detail).toContainElement(emptyLine());
    expect(detail.querySelector(".grid")).toBeNull();
    expect(detail.querySelector("label")).toBeNull();
    expect(screen.queryByText("OS Version")).toBeNull();
  });

  test("the record's ID line follows it, ruled off as it is under rows", () => {
    const detail: HTMLElement = renderDetail({
      item: { _id: RECORD_ID },
      fields: [OS_VERSION, AGENT_VERSION, ID_FIELD],
      emptyMessage: EMPTY_MESSAGE,
    });

    const line: HTMLElement = screen.getByTestId("detail-record-line");
    expect(detail.firstElementChild).toBe(emptyLine());
    expect(emptyLine()!.nextElementSibling).toBe(line);
    expect(line).toHaveClass("mt-4", "border-t", "border-gray-100", "pt-3");
    expect(within(line).getByTestId("detail-id-value").textContent).toBe(
      RECORD_ID,
    );
  });

  test("in the compact style, the line keeps the compact rhythm", () => {
    renderDetail({
      item: { _id: RECORD_ID },
      fields: [OS_VERSION, ID_FIELD],
      emptyMessage: EMPTY_MESSAGE,
      style: DetailStyle.Compact,
    });

    expect(screen.getByTestId("detail-record-line")).toHaveClass(
      "mt-3",
      "border-t",
      "pt-3",
    );
  });

  test("one reported field is drawn, and the line is not", () => {
    const detail: HTMLElement = renderDetail({
      item: { _id: RECORD_ID, agentVersion: "0.161.1" },
      fields: [OS_VERSION, AGENT_VERSION, ID_FIELD],
      emptyMessage: EMPTY_MESSAGE,
    });

    expect(emptyLine()).toBeNull();
    expect(screen.getByText("0.161.1")).toBeInTheDocument();
    expect(screen.getByText("Agent Version")).toBeInTheDocument();
    expect(screen.queryByText("OS Version")).toBeNull();
    expect(detail.firstElementChild).toHaveClass("grid");
  });

  test("the ID line alone is not something to show: the line is still said", () => {
    renderDetail({
      item: { _id: RECORD_ID },
      fields: [ID_FIELD],
      emptyMessage: EMPTY_MESSAGE,
    });

    expect(emptyLine()).toHaveTextContent(EMPTY_MESSAGE);
    expect(screen.getByTestId("detail-id-line")).toBeInTheDocument();
  });

  test("it is read in the reader's language", () => {
    const words: string = GERMAN_FILE[EMPTY_MESSAGE] as string;
    expect(words).toBeTruthy();
    expect(words).not.toBe(EMPTY_MESSAGE);

    renderDetail({
      item: {},
      fields: [OS_VERSION],
      emptyMessage: EMPTY_MESSAGE,
      wrap: (element: ReactElement): ReactElement => {
        return <I18nextProvider i18n={german}>{element}</I18nextProvider>;
      },
    });

    expect(emptyLine()).toHaveTextContent(words);
    expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull();
  });
});

describe("a detail that sets no emptyMessage draws as it always did", () => {
  test("no fields to show and no record line: an empty grid, no line", () => {
    const detail: HTMLElement = renderDetail({
      item: {},
      fields: [OS_VERSION, AGENT_VERSION],
    });

    expect(emptyLine()).toBeNull();
    expect(detail).toHaveAttribute("id", "docker-host-details");
    expect(detail).toHaveClass("grid");
    expect(detail.children).toHaveLength(0);
  });

  test("no fields to show beside the ID: the ID line alone, with no rule above it", () => {
    const detail: HTMLElement = renderDetail({
      item: { _id: RECORD_ID },
      fields: [OS_VERSION, ID_FIELD],
    });

    const line: HTMLElement = screen.getByTestId("detail-record-line");
    expect(emptyLine()).toBeNull();
    expect(detail.firstElementChild).toBe(line);
    expect(line).not.toHaveClass("border-t");
  });
});

describe("the words are the Dashboard's", () => {
  test("a key of every locale, translated in every language but English", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(17);
    for (const file of files) {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      ) as Record<string, string>;
      const value: string | undefined = locale[EMPTY_MESSAGE];

      expect({ file, has: typeof value }).toEqual({ file, has: "string" });
      expect({ file, translated: value !== EMPTY_MESSAGE }).toEqual({
        file,
        translated: file !== "en.json",
      });
    }
  });
});
