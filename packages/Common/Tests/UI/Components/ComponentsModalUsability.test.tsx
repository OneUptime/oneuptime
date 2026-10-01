import ComponentsModal, {
  ComponentProps,
  SEARCH_INPUT_ID,
  SEARCH_RESULTS_ID,
  getSearchOptionId,
} from "../../../UI/Components/Workflow/ComponentsModal";
import { ComponentType } from "../../../Types/Workflow/Component";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  FixturePalette,
  buildFixturePalette,
  findByTitle,
} from "./Workflow/ComponentPicker/PickerFixtures";
import { describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

/*
 * The picker from the keyboard: the search box is a combobox over its
 * results (the arrows move, Enter adds), the browse views are buttons the
 * arrows move between, and Escape and "/" do what they say. Rendering and
 * clicking are in ComponentsModal.test.tsx.
 */

type UserEventController = ReturnType<typeof userEvent.setup>;

const palette: FixturePalette = buildFixturePalette();

type RenderPickerFunction = (
  overrides?: Partial<ComponentProps>,
) => RenderResult;

const renderPicker: RenderPickerFunction = (
  overrides: Partial<ComponentProps> = {},
): RenderResult => {
  return render(
    <ComponentsModal
      componentsType={ComponentType.Component}
      components={palette.components}
      categories={palette.categories}
      onCloseModal={getJestMockFunction()}
      onComponentClick={getJestMockFunction()}
      {...overrides}
    />,
  );
};

type SearchBoxFunction = () => HTMLElement;

const searchBox: SearchBoxFunction = (): HTMLElement => {
  return screen.getByRole("combobox", { name: "Search components" });
};

type ActiveOptionTitleFunction = () => string;

// The option the search box points at, by its title.
const activeOptionTitle: ActiveOptionTitleFunction = (): string => {
  const activeId: string | null = searchBox().getAttribute(
    "aria-activedescendant",
  );
  const option: HTMLElement | null = activeId
    ? document.getElementById(activeId)
    : null;

  expect(option).not.toBeNull();
  expect(option).toHaveAttribute("aria-selected", "true");

  return option!.getAttribute("aria-label") || "";
};

type SettledFunction = () => Promise<void>;

/*
 * The results follow what was typed a moment later (useDeferredValue), and
 * user-event's keys are not wrapped in act, so wait for the list to catch
 * up before reading it.
 */
const settled: SettledFunction = async (): Promise<void> => {
  await waitFor(() => {
    expect(
      screen.getByTestId("workflow-component-picker-body"),
    ).toHaveAttribute("aria-busy", "false");
  });
};

describe("the search box", () => {
  it("has the focus when the panel opens, and is labelled for what it searches", () => {
    renderPicker();

    expect(searchBox()).toHaveFocus();
    expect(searchBox()).toHaveAttribute("id", SEARCH_INPUT_ID);
    expect(searchBox()).toHaveAttribute(
      "placeholder",
      "Search components, e.g. create incident",
    );
    expect(searchBox()).toHaveAttribute("aria-autocomplete", "list");
    expect(searchBox()).toHaveAttribute("aria-expanded", "false");
    expect(searchBox()).not.toHaveAttribute("aria-activedescendant");

    renderPicker({ componentsType: ComponentType.Trigger });
    expect(
      screen.getByRole("combobox", { name: "Search triggers" }),
    ).toHaveAttribute("placeholder", "Search triggers, e.g. incident created");
  });

  it("points at the best match as soon as there are results", async () => {
    const user: UserEventController = userEvent.setup();
    renderPicker();

    await user.type(searchBox(), "create incident");
    await settled();

    expect(searchBox()).toHaveAttribute("aria-expanded", "true");
    expect(searchBox()).toHaveAttribute("aria-controls", SEARCH_RESULTS_ID);
    expect(searchBox()).toHaveAttribute(
      "aria-activedescendant",
      getSearchOptionId(0),
    );
    expect(activeOptionTitle()).toBe("Create One Incident");
    expect(screen.getAllByRole("option", { selected: true })).toHaveLength(1);
  });

  it("moves through the results with the arrow keys, and stops at either end", async () => {
    const user: UserEventController = userEvent.setup();
    renderPicker();

    await user.type(searchBox(), "create incident");
    await settled();
    await user.keyboard("{ArrowDown}");
    expect(activeOptionTitle()).toBe("Create Many Incidents");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(searchBox()).toHaveAttribute(
      "aria-activedescendant",
      getSearchOptionId(3),
    );

    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(activeOptionTitle()).toBe("Create One Incident");

    // The focus never leaves the box while moving.
    expect(searchBox()).toHaveFocus();
  });

  it("adds the result pointed at with Enter", async () => {
    const user: UserEventController = userEvent.setup();
    const onComponentClick: MockFunction = getJestMockFunction();
    renderPicker({ onComponentClick });

    await user.type(searchBox(), "incident state");
    await settled();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(onComponentClick).toHaveBeenCalledTimes(1);
    expect(onComponentClick).toHaveBeenCalledWith(
      findByTitle(palette.components, "Find One Incident State"),
    );
  });

  it("adds the best match when Enter follows the typing straight away", async () => {
    const user: UserEventController = userEvent.setup();
    const onComponentClick: MockFunction = getJestMockFunction();
    renderPicker({ onComponentClick });

    await user.type(searchBox(), "send slack message{Enter}");

    expect(onComponentClick).toHaveBeenCalledTimes(1);
    expect(onComponentClick).toHaveBeenCalledWith(
      findByTitle(palette.components, "Send Message to Slack"),
    );
  });

  it("does nothing on Enter when nothing matches, or nothing was typed", async () => {
    const user: UserEventController = userEvent.setup();
    const onComponentClick: MockFunction = getJestMockFunction();
    renderPicker({ onComponentClick });

    await user.keyboard("{Enter}");
    await user.type(searchBox(), "zzzz{Enter}");

    expect(onComponentClick).not.toHaveBeenCalled();
  });

  it("follows the pointer over the results, so Enter adds what is under it", async () => {
    const user: UserEventController = userEvent.setup();
    const onComponentClick: MockFunction = getJestMockFunction();
    renderPicker({ onComponentClick });

    await user.type(searchBox(), "incident");
    await settled();
    fireEvent.mouseMove(screen.getAllByRole("option")[4]!);

    expect(activeOptionTitle()).toBe("Update One Incident");

    await user.keyboard("{Enter}");
    expect(onComponentClick).toHaveBeenCalledWith(
      findByTitle(palette.components, "Update One Incident"),
    );
  });

  it("starts each new search at its best match", async () => {
    const user: UserEventController = userEvent.setup();
    renderPicker();

    await user.type(searchBox(), "incident");
    await settled();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(activeOptionTitle()).toBe("Find One Incident");

    await user.type(searchBox(), " state");
    await settled();
    expect(activeOptionTitle()).toBe("Create One Incident State");
  });

  it("clears the search with Escape, and leaves the panel open", async () => {
    const user: UserEventController = userEvent.setup();
    const onCloseModal: MockFunction = getJestMockFunction();
    renderPicker({ onCloseModal });

    await user.type(searchBox(), "update monitor");
    await user.keyboard("{Escape}");

    expect(searchBox()).toHaveValue("");
    expect(searchBox()).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onCloseModal).not.toHaveBeenCalled();
  });

  it("clears the search with its × button, and keeps the focus in the box", async () => {
    const user: UserEventController = userEvent.setup();
    renderPicker();

    await user.type(searchBox(), "slack");
    await user.click(screen.getByRole("button", { name: "Clear search" }));

    expect(searchBox()).toHaveValue("");
    expect(searchBox()).toHaveFocus();
    expect(
      screen.queryByRole("button", { name: "Clear search" }),
    ).not.toBeInTheDocument();
  });

  it("announces how many matched", async () => {
    const user: UserEventController = userEvent.setup();
    renderPicker();

    expect(screen.getByRole("status")).toHaveTextContent("");

    await user.type(searchBox(), "send message");
    await settled();
    expect(screen.getByRole("status")).toHaveTextContent("5 matches.");
  });
});

describe("the browse views from the keyboard", () => {
  it("goes from the search box into the list with the down arrow, and back up from the first entry", async () => {
    const user: UserEventController = userEvent.setup();
    renderPicker();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Log" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "If / Else" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(
      screen.getByRole("button", { name: "API Post (JSON)" }),
    ).toHaveFocus();

    await user.keyboard("{ArrowLeft}{ArrowUp}");
    expect(screen.getByRole("button", { name: "Log" })).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(searchBox()).toHaveFocus();
  });

  it("adds a focused step with Enter or Space, as any button", async () => {
    const user: UserEventController = userEvent.setup();
    const onComponentClick: MockFunction = getJestMockFunction();
    renderPicker({ onComponentClick });

    screen.getByRole("button", { name: "Sleep" }).focus();
    await user.keyboard("{Enter}");
    expect(onComponentClick).toHaveBeenLastCalledWith(
      findByTitle(palette.components, "Sleep"),
    );

    screen.getByRole("button", { name: "Merge JSON" }).focus();
    await user.keyboard(" ");
    expect(onComponentClick).toHaveBeenLastCalledWith(
      findByTitle(palette.components, "Merge JSON"),
    );
    expect(onComponentClick).toHaveBeenCalledTimes(2);
  });

  it("starts a search from a step when a letter is typed on it", async () => {
    const user: UserEventController = userEvent.setup();
    renderPicker();

    screen.getByRole("button", { name: "Sleep" }).focus();
    await user.keyboard("j");

    expect(searchBox()).toHaveFocus();
    expect(searchBox()).toHaveValue("j");

    await user.keyboard("son");
    expect(searchBox()).toHaveValue("json");
  });

  it("opens a resource onto its first step, and returns to the resource it came from", async () => {
    const user: UserEventController = userEvent.setup();
    renderPicker();

    screen.getByRole("button", { name: "Monitor, 8 actions" }).focus();
    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("button", { name: "Create One Monitor" }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(
      screen.getByRole("button", { name: "Monitor, 8 actions" }),
    ).toHaveFocus();
  });

  it("goes back a view with Escape from an empty search box too", async () => {
    const user: UserEventController = userEvent.setup();
    renderPicker();

    await user.click(
      screen.getByRole("button", { name: /^Browse all resources/ }),
    );
    expect(
      screen.getByRole("button", { name: "AI Agent, 2 actions" }),
    ).toHaveFocus();

    await user.click(searchBox());
    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("heading", { name: "All resources" }),
    ).not.toBeInTheDocument();
    expect(searchBox()).toHaveFocus();
  });

  it("goes back from the list of every resource to the button that opened it", async () => {
    const user: UserEventController = userEvent.setup();
    renderPicker();

    await user.click(
      screen.getByRole("button", { name: /^Browse all resources/ }),
    );
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.getByRole("button", { name: /^Browse all resources/ }),
    ).toHaveFocus();
  });
});

describe("the slash key", () => {
  it("jumps to the search box from anywhere in the panel", async () => {
    const user: UserEventController = userEvent.setup();
    renderPicker();

    screen.getByRole("button", { name: "Sleep" }).focus();
    await user.keyboard("/");

    expect(searchBox()).toHaveFocus();
    expect(searchBox()).toHaveValue("");
  });

  it("is typed as text inside the search box", async () => {
    const user: UserEventController = userEvent.setup();
    renderPicker();

    await user.keyboard("/");

    expect(searchBox()).toHaveValue("/");
  });
});
