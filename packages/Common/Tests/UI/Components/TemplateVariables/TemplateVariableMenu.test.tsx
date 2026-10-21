import "@testing-library/jest-dom";
import type { Mock } from "jest-mock";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { createRef } from "react";
import TemplateVariableMenu, {
  TemplateVariableMenuHandle,
} from "../../../../UI/Components/TemplateVariables/TemplateVariableMenu";
import {
  TemplateVariable,
  TemplateVariableGroups,
} from "../../../../Types/Template/TemplateVariable";

/*
 * The list a template variable is picked from: behind the editor's Insert
 * variable button (with a search box) and under the cursor while "{{" is
 * typed (filtered by what follows the braces, driven by the field's keys).
 */

const GROUPS: TemplateVariableGroups = [
  {
    title: "Incident",
    variables: [
      { name: "incident.title", description: "Title" },
      { name: "incident.startedAt", description: "Declared At" },
      { name: "incident.severity", description: "Incident Severity" },
    ],
  },
  {
    title: "Custom Fields",
    variables: [
      {
        name: "incident.customFields.customer_impact",
        description: "Customer Impact",
        isDescriptionVerbatim: true,
      },
    ],
  },
];

afterEach(() => {
  cleanup();
});

type PickMock = Mock<(variable: TemplateVariable) => void>;

function optionNames(): Array<string> {
  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    return option.dataset["variableName"] || "";
  });
}

function activeName(): string | undefined {
  return screen
    .queryAllByRole("option")
    .find((option: HTMLElement): boolean => {
      return option.getAttribute("aria-selected") === "true";
    })?.dataset["variableName"];
}

function keyEvent(key: string): {
  key: string;
  preventDefault: Mock<() => void>;
} {
  return { key: key, preventDefault: jest.fn<() => void>() };
}

describe("the template variable menu", () => {
  test("lists every variable under its group, what it holds first and its name under it", () => {
    render(
      <TemplateVariableMenu
        groups={GROUPS}
        hasSearchBox={false}
        onPick={() => {}}
      />,
    );

    expect(optionNames()).toEqual([
      "incident.title",
      "incident.startedAt",
      "incident.severity",
      "incident.customFields.customer_impact",
    ]);

    const groups: Array<HTMLElement> = screen.getAllByRole("group");

    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveAccessibleName("Incident");
    expect(groups[1]).toHaveAccessibleName("Custom Fields");

    const startedAt: HTMLElement = screen.getAllByRole("option")[1]!;

    expect(startedAt).toHaveTextContent("Declared At");
    expect(within(startedAt).getByText("{{incident.startedAt}}")).toBeVisible();
  });

  test("is a listbox whose first option starts out chosen", () => {
    render(
      <TemplateVariableMenu
        groups={GROUPS}
        hasSearchBox={false}
        onPick={() => {}}
      />,
    );

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(activeName()).toBe("incident.title");
  });

  test("while typing, is filtered by what follows the braces", () => {
    render(
      <TemplateVariableMenu
        groups={GROUPS}
        hasSearchBox={false}
        query="declared"
        onPick={() => {}}
      />,
    );

    expect(optionNames()).toEqual(["incident.startedAt"]);
  });

  test("with a search box, searches by name or by what a variable holds", () => {
    render(
      <TemplateVariableMenu
        groups={GROUPS}
        hasSearchBox={true}
        onPick={() => {}}
      />,
    );

    const search: HTMLElement = screen.getByTestId("template-variable-search");

    expect(search).toHaveFocus();
    expect(search).toHaveAttribute("role", "combobox");

    fireEvent.change(search, { target: { value: "impact" } });
    expect(optionNames()).toEqual(["incident.customFields.customer_impact"]);

    fireEvent.change(search, { target: { value: "severity" } });
    expect(optionNames()).toEqual(["incident.severity"]);
  });

  test("says so when nothing matches", () => {
    render(
      <TemplateVariableMenu
        groups={GROUPS}
        hasSearchBox={true}
        onPick={() => {}}
      />,
    );

    fireEvent.change(screen.getByTestId("template-variable-search"), {
      target: { value: "nothing like this" },
    });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(
      screen.getByTestId("template-variable-menu-empty"),
    ).toHaveTextContent("No variables match your search.");
  });

  test("the search box's arrow keys move through the list, wrapping, and Enter picks", () => {
    const onPick: PickMock = jest.fn<(variable: TemplateVariable) => void>();

    render(
      <TemplateVariableMenu
        groups={GROUPS}
        hasSearchBox={true}
        onPick={onPick}
      />,
    );

    const search: HTMLElement = screen.getByTestId("template-variable-search");

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(activeName()).toBe("incident.startedAt");
    expect(search).toHaveAttribute(
      "aria-activedescendant",
      screen.getAllByRole("option")[1]!.id,
    );

    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(activeName()).toBe("incident.customFields.customer_impact");

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(activeName()).toBe("incident.title");

    const enter: Event = createEvent.keyDown(search, { key: "Enter" });
    fireEvent(search, enter);

    expect(enter.defaultPrevented).toBe(true);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]![0].name).toBe("incident.title");
  });

  test("a new search starts at the top of what it found", () => {
    render(
      <TemplateVariableMenu
        groups={GROUPS}
        hasSearchBox={true}
        onPick={() => {}}
      />,
    );

    const search: HTMLElement = screen.getByTestId("template-variable-search");

    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.change(search, { target: { value: "incident" } });

    expect(activeName()).toBe("incident.title");
  });

  test("while typing, the field hands over its keys: arrows, Enter and Tab are the list's", () => {
    const onPick: PickMock = jest.fn<(variable: TemplateVariable) => void>();
    const ref: React.RefObject<TemplateVariableMenuHandle> =
      createRef<TemplateVariableMenuHandle>();

    render(
      <TemplateVariableMenu
        ref={ref}
        groups={GROUPS}
        hasSearchBox={false}
        onPick={onPick}
      />,
    );

    const down: ReturnType<typeof keyEvent> = keyEvent("ArrowDown");

    act(() => {
      expect(ref.current!.handleKeyDown(down)).toBe(true);
    });
    expect(down.preventDefault).toHaveBeenCalled();
    expect(activeName()).toBe("incident.startedAt");

    const tab: ReturnType<typeof keyEvent> = keyEvent("Tab");

    act(() => {
      expect(ref.current!.handleKeyDown(tab)).toBe(true);
    });
    expect(tab.preventDefault).toHaveBeenCalled();
    expect(onPick.mock.calls[0]![0].name).toBe("incident.startedAt");
  });

  test("keys that are not the list's stay the field's", () => {
    const ref: React.RefObject<TemplateVariableMenuHandle> =
      createRef<TemplateVariableMenuHandle>();

    render(
      <TemplateVariableMenu
        ref={ref}
        groups={GROUPS}
        hasSearchBox={false}
        onPick={() => {}}
      />,
    );

    for (const key of ["a", "ArrowLeft", "ArrowRight", "Home", "Backspace"]) {
      const event: ReturnType<typeof keyEvent> = keyEvent(key);

      expect(ref.current!.handleKeyDown(event)).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  });

  test("with a search box, Tab is not a pick: it leaves the list", () => {
    const onPick: PickMock = jest.fn<(variable: TemplateVariable) => void>();

    render(
      <TemplateVariableMenu
        groups={GROUPS}
        hasSearchBox={true}
        onPick={onPick}
      />,
    );

    fireEvent.keyDown(screen.getByTestId("template-variable-search"), {
      key: "Tab",
    });

    expect(onPick).not.toHaveBeenCalled();
  });

  test("with nothing to pick, no key is the list's", () => {
    const ref: React.RefObject<TemplateVariableMenuHandle> =
      createRef<TemplateVariableMenuHandle>();

    render(
      <TemplateVariableMenu
        ref={ref}
        groups={GROUPS}
        hasSearchBox={false}
        query="zzz"
        onPick={() => {}}
      />,
    );

    expect(ref.current!.handleKeyDown(keyEvent("Enter"))).toBe(false);
    expect(ref.current!.handleKeyDown(keyEvent("ArrowDown"))).toBe(false);
  });

  test("a click picks, the pointer moves the choice, and a press keeps the focus where it was", () => {
    const onPick: PickMock = jest.fn<(variable: TemplateVariable) => void>();

    render(
      <TemplateVariableMenu
        groups={GROUPS}
        hasSearchBox={false}
        onPick={onPick}
      />,
    );

    const severity: HTMLElement = screen.getAllByRole("option")[2]!;

    fireEvent.mouseMove(severity);
    expect(activeName()).toBe("incident.severity");

    const press: Event = createEvent.mouseDown(severity);
    fireEvent(severity, press);
    expect(press.defaultPrevented).toBe(true);

    fireEvent.click(severity);
    expect(onPick.mock.calls[0]![0].name).toBe("incident.severity");
  });

  test("tells the field which option the keys are on, for its aria-activedescendant", () => {
    const onActiveOptionChange: Mock<(id: string | undefined) => void> =
      jest.fn<(id: string | undefined) => void>();

    render(
      <TemplateVariableMenu
        groups={GROUPS}
        hasSearchBox={false}
        listboxId="variables"
        onActiveOptionChange={onActiveOptionChange}
        onPick={() => {}}
      />,
    );

    expect(screen.getByRole("listbox")).toHaveAttribute("id", "variables");
    expect(onActiveOptionChange).toHaveBeenLastCalledWith("variables-option-0");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute(
      "id",
      "variables-option-0",
    );
  });

  test("shows a field's name as it was typed, and a description in the page's words", () => {
    render(
      <TemplateVariableMenu
        groups={GROUPS}
        hasSearchBox={false}
        onPick={() => {}}
      />,
    );

    expect(screen.getAllByRole("option")[3]).toHaveTextContent(
      "Customer Impact",
    );
  });
});
