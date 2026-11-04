import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import Detail from "../../../../UI/Components/Detail/Detail";
import Field from "../../../../UI/Components/Detail/Field";
import FieldType from "../../../../UI/Components/Types/FieldType";
import IsolatedTextList from "../../../../UI/Components/IsolatedText/IsolatedTextList";
import DropdownValueBadge from "../../../../UI/Components/Dropdown/DropdownValueBadge";
import ColorViewer from "../../../../UI/Components/ColorViewer/ColorViewer";
import DictionaryOfStringsViewer from "../../../../UI/Components/Dictionary/DictionaryOfStingsViewer";
import ObjectIDView from "../../../../UI/Components/ObjectID/ObjectIDView";
import HiddenText from "../../../../UI/Components/HiddenText/HiddenText";
import Color from "../../../../Types/Color";
import { getListSeparator } from "../../../../Types/Translator";

/*
 * Values someone wrote, drawn in a Detail card, read the way they are
 * written on a page of either direction. On a Persian page (the html's dir
 * is rtl) a value drawn as part of the page's line is laid out right to
 * left: a component pattern "Git*" read "*Git", "#FF0000" read "FF0000#",
 * and a list of names joined into one string took one name's bracket to
 * the next. Each value is an isolate of its own - a bdi whose dir is the way
 * most of its letters read - and a list is separated the reader's way.
 */

const languages: Record<string, i18n> = {};

beforeAll(async () => {
  for (const code of ["en", "fa", "ja", "de"]) {
    const instance: i18n = createInstance();
    await instance.init({
      lng: code,
      resources: { [code]: { translation: {} } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
    languages[code] = instance;
  }
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

function renderIn(code: string, element: ReactElement): HTMLElement {
  if (code === "fa") {
    document.documentElement.setAttribute("dir", "rtl");
  }

  const { container } = render(
    <I18nextProvider i18n={languages[code] as i18n}>{element}</I18nextProvider>,
  );

  return container;
}

interface Item {
  components?: Array<string> | undefined;
  color?: Color | undefined;
  path?: string | undefined;
  heading?: string | undefined;
  attributes?: Record<string, string> | undefined;
  choice?: string | undefined;
}

function renderDetail(
  code: string,
  item: Item,
  field: Field<Item>,
): HTMLElement {
  return renderIn(
    code,
    <Detail<Item>
      item={item}
      fields={[field]}
      showDetailsInNumberOfColumns={1}
    />,
  );
}

const componentsField: Field<Item> = {
  key: "components",
  title: "Components",
  fieldType: FieldType.ArrayOfText,
  placeholder: "All components",
};

function isolates(root: HTMLElement): Array<{ text: string; dir: string }> {
  return Array.from(root.querySelectorAll("bdi")).map(
    (element: Element): { text: string; dir: string } => {
      return {
        text: element.textContent || "",
        dir: element.getAttribute("dir") || "",
      };
    },
  );
}

describe("a list of text values (ArrayOfText)", () => {
  test("draws each value in its own isolate, read the way its letters read", () => {
    const container: HTMLElement = renderDetail(
      "fa",
      { components: ["Git*", "Pull Requests (EU)", "مؤلفهٔ اصلی"] },
      componentsField,
    );
    const list: HTMLElement = within(container).getByTestId("detail-text-list");

    expect(isolates(list)).toEqual([
      { text: "Git*", dir: "ltr" },
      { text: "Pull Requests (EU)", dir: "ltr" },
      { text: "مؤلفهٔ اصلی", dir: "rtl" },
    ]);
  });

  test("separates the values the reader's way: Persian, Japanese, English", () => {
    const values: Array<string> = ["Git Operations", "Webhooks"];

    for (const [code, separator] of [
      ["fa", "، "],
      ["ja", "、"],
      ["en", ", "],
      ["de", ", "],
    ] as Array<[string, string]>) {
      const container: HTMLElement = renderDetail(
        code,
        { components: values },
        componentsField,
      );

      expect({
        code,
        text: within(container).getByTestId("detail-text-list").textContent,
      }).toEqual({ code, text: `Git Operations${separator}Webhooks` });

      cleanup();
      document.documentElement.removeAttribute("dir");
    }
  });

  test("is never one string the page lays out as a whole", () => {
    const container: HTMLElement = renderDetail(
      "fa",
      { components: ["Git*", "Copilot"] },
      componentsField,
    );
    const list: HTMLElement = within(container).getByTestId("detail-text-list");

    // No isolate holds two values, and no value is left outside one.
    for (const element of Array.from(list.querySelectorAll("bdi"))) {
      expect(element.textContent).not.toContain("، ");
    }

    expect(list.querySelectorAll("bdi")).toHaveLength(2);
  });

  test("leaves out empty values, and an empty list is the field's placeholder", () => {
    let container: HTMLElement = renderDetail(
      "en",
      { components: ["Git", "", "Webhooks"] },
      componentsField,
    );

    expect(isolates(within(container).getByTestId("detail-text-list"))).toEqual(
      [
        { text: "Git", dir: "ltr" },
        { text: "Webhooks", dir: "ltr" },
      ],
    );

    cleanup();

    container = renderDetail("en", { components: [] }, componentsField);

    expect(within(container).queryByTestId("detail-text-list")).toBeNull();
    expect(container).toHaveTextContent("All components");
  });

  test("a copyable list copies the list as it is drawn", async () => {
    const copied: Array<string> = [];

    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (text: string): Promise<void> => {
          copied.push(text);
          return Promise.resolve();
        },
      },
      configurable: true,
    });

    const container: HTMLElement = renderDetail(
      "fa",
      { components: ["Git*", "Copilot"] },
      { ...componentsField, opts: { isCopyable: true } },
    );

    fireEvent.click(
      within(within(container).getByTestId("detail-value-copy")).getByRole(
        "button",
      ),
    );

    await waitFor(() => {
      expect(copied).toEqual(["Git*، Copilot"]);
    });
  });

  test("IsolatedTextList on its own: a value of numbers takes the list's reading", () => {
    const container: HTMLElement = renderIn(
      "fa",
      <IsolatedTextList texts={["443", "8443"]} dataTestId="ports" />,
    );

    // A value with no letters has no direction of its own.
    expect(isolates(within(container).getByTestId("ports"))).toEqual([
      { text: "443", dir: "" },
      { text: "8443", dir: "" },
    ]);
  });

  test("getListSeparator: the separators formatList writes", () => {
    expect(getListSeparator("fa")).toBe("، ");
    expect(getListSeparator("ja")).toBe("、");
    expect(getListSeparator("zh-CN")).toBe("、");
    expect(getListSeparator("zh-TW")).toBe("、");
    expect(getListSeparator("de")).toBe(", ");
    expect(getListSeparator(undefined)).toBe(", ");
  });
});

describe("the other values a Detail card draws as written", () => {
  test("a dropdown's choice and a record's name in a pill read as written", () => {
    const container: HTMLElement = renderIn(
      "fa",
      <DropdownValueBadge label="Payments (EU)" />,
    );
    const badge: HTMLElement = container.querySelector(
      '[data-dropdown-value-badge="true"]',
    ) as HTMLElement;

    expect(isolates(badge)).toEqual([{ text: "Payments (EU)", dir: "ltr" }]);
    // The dot stays the pill's first child: it leads the way the page reads.
    expect(badge.firstElementChild?.getAttribute("data-ou-pill-dot")).toBe("");
  });

  test("a Persian choice reads right to left in a pill on an English page", () => {
    const container: HTMLElement = renderIn(
      "en",
      <DropdownValueBadge label="پرداخت‌ها" />,
    );

    expect(isolates(container)).toEqual([{ text: "پرداخت‌ها", dir: "rtl" }]);
  });

  test("a colour's code reads left to right on a Persian page", () => {
    const container: HTMLElement = renderIn(
      "fa",
      <ColorViewer value={new Color("#FF0000")} />,
    );

    expect(isolates(container)).toEqual([{ text: "#FF0000", dir: "ltr" }]);
  });

  test("a Detail card's inline code and heading read as written", () => {
    let container: HTMLElement = renderDetail(
      "fa",
      { path: "/var/lib/postgresql" },
      { key: "path", title: "Mount", fieldType: FieldType.InlineCode },
    );

    expect(isolates(container.querySelector("code") as HTMLElement)).toEqual([
      { text: "/var/lib/postgresql", dir: "ltr" },
    ]);

    cleanup();

    container = renderDetail(
      "fa",
      { heading: "Checkout API (v2)" },
      { key: "heading", title: "Name", fieldType: FieldType.Heading },
    );

    expect(isolates(container)).toEqual(
      expect.arrayContaining([{ text: "Checkout API (v2)", dir: "ltr" }]),
    );
  });

  test("a dictionary's keys and values read as written", () => {
    const container: HTMLElement = renderIn(
      "fa",
      <DictionaryOfStringsViewer value={{ region: "us-east-1*" }} />,
    );

    expect(isolates(container)).toEqual(
      expect.arrayContaining([
        { text: "region", dir: "ltr" },
        { text: "us-east-1*", dir: "ltr" },
      ]),
    );
  });

  test("an ID and a revealed secret are codes, read left to right", () => {
    let container: HTMLElement = renderIn(
      "fa",
      <ObjectIDView objectId="3f2a8b1c-9d4e-4b7a-a1c2-7e5f6d8c9b0a" />,
    );

    expect(container.querySelector("code")?.getAttribute("dir")).toBe("ltr");

    cleanup();

    container = renderIn("fa", <HiddenText text="sk-live-123*" />);
    fireEvent.click(container.firstElementChild as HTMLElement);

    const revealed: HTMLElement = within(container).getByRole("revealed-text");

    expect(revealed.getAttribute("dir")).toBe("ltr");
    expect(revealed).toHaveTextContent("sk-live-123*");
  });
});
