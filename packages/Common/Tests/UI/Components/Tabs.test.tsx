import { Tab } from "../../../UI/Components/Tabs/Tab";
import Tabs from "../../../UI/Components/Tabs/Tabs";
import "@testing-library/jest-dom";
import { fireEvent, render } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import React from "react";
import { describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

describe("Tabs", () => {
  const activeClass: string = "bg-gray-100 text-gray-700";

  const tab1: Tab = {
    name: "tab1",
    children: <div>tab 1 content</div>,
  };

  const tab2: Tab = {
    name: "tab2",
    children: <div>tab 2 content</div>,
  };

  const tabs: Array<Tab> = [tab1, tab2];

  test("it should render all props passed", () => {
    const onTabChange: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Tabs tabs={tabs} onTabChange={onTabChange} />,
    );

    expect(getByTestId("tab-tab1")).toBeInTheDocument();
    expect(getByTestId("tab-tab2")).toBeInTheDocument();
  });

  test("it should render the first tab as active by default", () => {
    const onTabChange: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Tabs tabs={tabs} onTabChange={onTabChange} />,
    );

    expect(getByTestId("tab-tab1")).toHaveClass(activeClass);
  });

  test("it should call onTabChange with the correct tab when a tab is clicked", () => {
    const onTabChange: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Tabs tabs={tabs} onTabChange={onTabChange} />,
    );

    fireEvent.click(getByTestId("tab-tab1"));
    expect(onTabChange).toHaveBeenCalledWith(tab1);

    fireEvent.click(getByTestId("tab-tab2"));
    expect(onTabChange).toHaveBeenCalledWith(tab2);
  });

  test("it should show the correct tab as active when a tab is clicked", () => {
    const onTabChange: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Tabs tabs={tabs} onTabChange={onTabChange} />,
    );

    fireEvent.click(getByTestId("tab-tab2"));

    expect(getByTestId("tab-tab1")).not.toHaveClass(activeClass);
    expect(getByTestId("tab-tab2")).toHaveClass(activeClass);
  });

  test("tabs ease colour changes and carry a focus-visible ring", () => {
    const onTabChange: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Tabs tabs={tabs} onTabChange={onTabChange} />,
    );

    /*
     * Selected and unselected tabs share the base classes, so asserting one
     * of each covers the whole strip. The ring is focus-visible (not focus:)
     * so mouse clicks do not flash it.
     */
    for (const tabTestId of ["tab-tab1", "tab-tab2"]) {
      expect(getByTestId(tabTestId)).toHaveClass(
        "transition-colors",
        "duration-150",
        "focus:outline-none",
        "focus-visible:ring-2",
        "focus-visible:ring-indigo-500",
        "focus-visible:ring-offset-2",
      );
    }
  });

  test("it should handle empty tabs array gracefully", () => {
    const tabs: Array<Tab> = [];
    const onTabChange: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Tabs tabs={tabs} onTabChange={onTabChange} />,
    );

    expect(() => {
      return getByTestId("tab-tab1");
    }).toThrow();

    expect(() => {
      return getByTestId("tab-tab2");
    }).toThrow();
  });

  test("a tab whose name is a name is drawn as given; any other is in the reader's language", async () => {
    // A product's name can be a word the language has: Japanese's text cursor.
    const japanese: i18n = createInstance();

    await japanese.init({
      lng: "ja",
      fallbackLng: false,
      resources: {
        ja: { translation: { Cursor: "カーソル", Settings: "設定" } },
      },
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
    });

    const named: Array<Tab> = [
      { name: "Cursor", isName: true, children: <div>cursor setup</div> },
      { name: "Settings", children: <div>settings</div> },
    ];

    const { getByTestId } = render(
      <I18nextProvider i18n={japanese}>
        <Tabs tabs={named} onTabChange={getJestMockFunction()} />
      </I18nextProvider>,
    );

    expect(getByTestId("tab-Cursor")).toHaveTextContent(/^Cursor$/);
    expect(getByTestId("tab-Settings")).toHaveTextContent(/^設定$/);
  });
});

/*
 * A few tabs inside a card (MCP Server's four clients): on a phone the row
 * wraps onto a second line, so no tab is scrolled out of sight, and the
 * panel lines up with the rest of the card. Left out, Tabs is as it was.
 */
describe("Tabs that wrap", () => {
  const clients: Array<Tab> = [
    "Claude Code",
    "Claude Desktop",
    "VS Code",
    "Cursor",
  ].map((name: string): Tab => {
    return { name: name, isName: true, children: <div>{name} setup</div> };
  });

  test("the tab row wraps instead of scrolling sideways", () => {
    const { getByRole } = render(
      <Tabs tabs={clients} wrap={true} onTabChange={getJestMockFunction()} />,
    );

    const row: HTMLElement = getByRole("tablist");

    expect(row).toHaveClass("flex", "flex-wrap", "gap-2", "py-3");
    expect(row).not.toHaveClass("overflow-x-auto");
    expect(row.className).not.toContain("space-x-");
  });

  test("its tabs add no margin of their own: the row spaces its lines", () => {
    const { getByTestId } = render(
      <Tabs tabs={clients} wrap={true} onTabChange={getJestMockFunction()} />,
    );

    for (const name of ["Claude Code", "Claude Desktop", "VS Code", "Cursor"]) {
      const holder: HTMLElement = getByTestId(`tab-${name}`)
        .parentElement as HTMLElement;

      expect(holder.className).toBe("");
    }
  });

  test("the panel starts at the edge the rest of the card starts at", () => {
    const { getByRole } = render(
      <Tabs tabs={clients} wrap={true} onTabChange={getJestMockFunction()} />,
    );

    const panel: HTMLElement = getByRole("tabpanel");

    expect(panel).toHaveClass("mt-3");
    expect(panel).not.toHaveClass("ml-1");
    expect(panel).toHaveTextContent("Claude Code setup");
  });

  test("left out, the row still scrolls on a phone and the panel is set in, as before", () => {
    const { getByRole, getByTestId } = render(
      <Tabs tabs={clients} onTabChange={getJestMockFunction()} />,
    );

    expect(getByRole("tablist")).toHaveClass(
      "flex",
      "space-x-2",
      "overflow-x-auto",
      "md:overflow-visible",
      "md:space-x-4",
    );
    expect(getByRole("tablist")).not.toHaveClass("flex-wrap");
    expect(getByTestId("tab-Cursor").parentElement).toHaveClass("mt-3", "mb-3");
    expect(getByRole("tabpanel")).toHaveClass("mt-3", "ml-1");
  });

  test("wrapping changes no behaviour: a click and the arrow keys still pick a tab", () => {
    const onTabChange: MockFunction = getJestMockFunction();
    const { getByTestId, getByRole } = render(
      <Tabs tabs={clients} wrap={true} onTabChange={onTabChange} />,
    );

    fireEvent.click(getByTestId("tab-Cursor"));
    expect(getByTestId("tab-Cursor")).toHaveAttribute("aria-selected", "true");
    expect(getByRole("tabpanel")).toHaveTextContent("Cursor setup");

    fireEvent.keyDown(getByRole("tablist"), { key: "Home" });
    expect(getByTestId("tab-Claude Code")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
