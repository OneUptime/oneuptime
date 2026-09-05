import ComponentsModal, {
  ComponentProps,
} from "../../../UI/Components/Workflow/ComponentsModal";
import ComponentMetadata, {
  ComponentCategory,
  ComponentType,
} from "../../../Types/Workflow/Component";
import IconProp from "../../../Types/Icon/IconProp";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

type UserEventController = ReturnType<typeof userEvent.setup>;

type MakeComponentFunction = (
  overrides: Partial<ComponentMetadata>,
) => ComponentMetadata;

const makeComponent: MakeComponentFunction = (
  overrides: Partial<ComponentMetadata>,
): ComponentMetadata => {
  return {
    id: "create-monitor",
    title: "Create One Monitor",
    description: "Database query to create one Monitor",
    category: "Monitor",
    componentType: ComponentType.Component,
    iconProp: IconProp.Activity,
    arguments: [],
    returnValues: [],
    inPorts: [],
    outPorts: [],
    ...overrides,
  };
};

const createMonitor: ComponentMetadata = makeComponent({});
const updateMonitor: ComponentMetadata = makeComponent({
  id: "update-monitor",
  title: "Update One Monitor",
  description: "Database query to update one Monitor",
});
const customCode: ComponentMetadata = makeComponent({
  id: "custom-code",
  title: "Run Custom JavaScript",
  description: "Run custom JavaScript in your workflow",
  category: "Custom Code",
});
const manualTrigger: ComponentMetadata = makeComponent({
  id: "manual",
  title: "Manual",
  description: "Run this workflow manually",
  category: "Utils",
  componentType: ComponentType.Trigger,
});
const monitorTrigger: ComponentMetadata = makeComponent({
  id: "monitor-created",
  title: "Monitor Created",
  description: "Run when a Monitor is created",
  componentType: ComponentType.Trigger,
});
const components: Array<ComponentMetadata> = [
  updateMonitor,
  customCode,
  manualTrigger,
  createMonitor,
  monitorTrigger,
];
const categories: Array<ComponentCategory> = [
  { name: "Utils", description: "Utilities", icon: IconProp.Activity },
  { name: "Monitor", description: "Monitoring", icon: IconProp.Activity },
  { name: "Custom Code", description: "Code", icon: IconProp.Code },
  { name: "Unused", description: "Unused", icon: IconProp.Activity },
];

type RenderPickerFunction = (
  overrides?: Partial<ComponentProps>,
) => RenderResult;

const renderPicker: RenderPickerFunction = (
  overrides: Partial<ComponentProps> = {},
): RenderResult => {
  return render(
    <ComponentsModal
      componentsType={ComponentType.Component}
      components={components}
      categories={categories}
      onCloseModal={getJestMockFunction()}
      onComponentClick={getJestMockFunction()}
      {...overrides}
    />,
  );
};

type SearchFunction = (value: string) => void;
const search: SearchFunction = (value: string): void => {
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
};

type GetAddButtonFunction = () => HTMLElement;
const getAddButton: GetAddButtonFunction = (): HTMLElement => {
  return screen.getByRole("button", { name: "Add to Workflow" });
};

type GetCardFunction = (component: ComponentMetadata) => HTMLElement;
const getCard: GetCardFunction = (
  component: ComponentMetadata,
): HTMLElement => {
  return screen.getByRole("button", { name: component.title });
};

describe("Workflow picker availability and quick filters", () => {
  it("counts only components and suggests only categories with components", () => {
    renderPicker();

    expect(screen.getByText("3 available")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Search components" }),
    ).toHaveFocus();
    expect(getCard(createMonitor)).toBeInTheDocument();
    expect(getCard(customCode)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Manual" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Monitor Created" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Monitor" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Custom Code" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Utils" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Unused" }),
    ).not.toBeInTheDocument();
  });

  it("counts triggers separately and excludes categories containing only components", () => {
    renderPicker({ componentsType: ComponentType.Trigger });

    expect(screen.getByText("2 available")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Search triggers" }),
    ).toBeInTheDocument();
    expect(getCard(manualTrigger)).toBeInTheDocument();
    expect(getCard(monitorTrigger)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Utils" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Custom Code" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: createMonitor.title }),
    ).not.toBeInTheDocument();
  });

  it("shows singular labels when one matching type exists in a mixed catalog", () => {
    renderPicker({
      components: [manualTrigger, createMonitor],
      componentsType: ComponentType.Trigger,
    });

    expect(screen.getByText("1 available")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Search trigger" }),
    ).toBeInTheDocument();
    search("manual");
    expect(screen.getByText("1 match")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 1 trigger.")).toBeInTheDocument();
  });

  it("uses the current type total when a search has one, several, or no matches", () => {
    renderPicker();

    search("monitor");
    expect(screen.getByText("2 matches")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 3 components.")).toBeInTheDocument();
    search("create monitor");
    expect(screen.getByText("1 match")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 3 components.")).toBeInTheDocument();
    search("nothing exists");
    expect(screen.getByText("0 matches")).toBeInTheDocument();
    expect(screen.getByText("Showing 0 of 3 components.")).toBeInTheDocument();
  });

  it("shows no available items or quick filters when the catalog contains only the other type", () => {
    renderPicker({ components: [manualTrigger, monitorTrigger] });

    expect(screen.getByText("0 available")).toBeInTheDocument();
    expect(screen.getByText("No components to show.")).toBeInTheDocument();
    expect(screen.queryByText("Quick filters:")).not.toBeInTheDocument();
    expect(getAddButton()).toBeDisabled();
  });

  it("activates a multiword quick filter and restores all items when cleared", () => {
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Custom Code" }));
    expect(screen.getByRole("textbox")).toHaveValue("Custom Code");
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Custom Code" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(getCard(customCode)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: createMonitor.title }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear", exact: true }));
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Custom Code" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(getCard(createMonitor)).toBeInTheDocument();
    expect(screen.getByText("3 available")).toBeInTheDocument();
  });
});

describe("Workflow picker selection follows visible results", () => {
  it("disables Add when search hides the selected card and requires deliberate reselection", () => {
    const onComponentClick: MockFunction = getJestMockFunction();
    renderPicker({ onComponentClick });

    fireEvent.click(getCard(createMonitor));
    expect(getAddButton()).toBeEnabled();
    search("update monitor");
    expect(getAddButton()).toBeDisabled();
    fireEvent.click(getAddButton());
    expect(onComponentClick).not.toHaveBeenCalled();

    search("");
    expect(getAddButton()).toBeDisabled();
    expect(getCard(createMonitor)).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(getCard(updateMonitor));
    fireEvent.click(getAddButton());
    expect(onComponentClick).toHaveBeenCalledTimes(1);
    expect(onComponentClick).toHaveBeenCalledWith(updateMonitor);
  });

  it("preserves selection while all search words still match the selected card", () => {
    const onComponentClick: MockFunction = getJestMockFunction();
    renderPicker({ onComponentClick });

    fireEvent.click(getCard(createMonitor));
    search("  CrEaTe   MONITOR  ");
    expect(getCard(createMonitor)).toHaveAttribute("aria-pressed", "true");
    expect(getAddButton()).toBeEnabled();
    fireEvent.click(getAddButton());
    expect(onComponentClick).toHaveBeenCalledWith(createMonitor);
  });

  it("clears selection when a quick filter hides it", () => {
    renderPicker();

    fireEvent.click(getCard(createMonitor));
    fireEvent.click(screen.getByRole("button", { name: "Custom Code" }));
    expect(getAddButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Monitor" }));
    expect(getCard(createMonitor)).toHaveAttribute("aria-pressed", "false");
    expect(getAddButton()).toBeDisabled();
  });

  it("does not restore a stale selection after resetting a search with no results", () => {
    renderPicker();
    fireEvent.click(getCard(createMonitor));
    search("no matching component");
    expect(getAddButton()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Reset search" }));
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(getCard(createMonitor)).toHaveAttribute("aria-pressed", "false");
    expect(getAddButton()).toBeDisabled();
  });

  it("switches type without carrying over selection, counts, or irrelevant quick filters", () => {
    const onComponentClick: MockFunction = getJestMockFunction();
    const props: ComponentProps = {
      components,
      categories,
      componentsType: ComponentType.Component,
      onComponentClick,
      onCloseModal: getJestMockFunction(),
    };
    const view: RenderResult = renderPicker(props);
    fireEvent.click(getCard(createMonitor));

    view.rerender(
      <ComponentsModal {...props} componentsType={ComponentType.Trigger} />,
    );
    expect(screen.getByText("2 available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Utils" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Custom Code" }),
    ).not.toBeInTheDocument();
    expect(getAddButton()).toBeDisabled();
    fireEvent.click(getCard(manualTrigger));
    fireEvent.click(getAddButton());
    expect(onComponentClick).toHaveBeenCalledWith(manualTrigger);

    view.rerender(<ComponentsModal {...props} />);
    expect(screen.getByText("3 available")).toBeInTheDocument();
    expect(getCard(createMonitor)).toHaveAttribute("aria-pressed", "false");
    expect(getAddButton()).toBeDisabled();
  });

  it("drops a selection removed from the catalog and does not restore it when reintroduced", () => {
    const props: ComponentProps = {
      components,
      categories,
      componentsType: ComponentType.Component,
      onComponentClick: getJestMockFunction(),
      onCloseModal: getJestMockFunction(),
    };
    const view: RenderResult = renderPicker(props);
    fireEvent.click(getCard(createMonitor));

    view.rerender(<ComponentsModal {...props} components={[customCode]} />);
    expect(screen.getByText("1 available")).toBeInTheDocument();
    expect(getAddButton()).toBeDisabled();
    view.rerender(<ComponentsModal {...props} />);
    expect(getCard(createMonitor)).toHaveAttribute("aria-pressed", "false");
    expect(getAddButton()).toBeDisabled();
  });

  it("submits the latest metadata for a selected component after the catalog updates", () => {
    const onComponentClick: MockFunction = getJestMockFunction();
    const props: ComponentProps = {
      components,
      categories,
      componentsType: ComponentType.Component,
      onComponentClick,
      onCloseModal: getJestMockFunction(),
    };
    const view: RenderResult = renderPicker(props);
    fireEvent.click(getCard(createMonitor));
    const updatedComponent: ComponentMetadata = {
      ...createMonitor,
      description: "Create a monitor with updated defaults",
    };

    view.rerender(
      <ComponentsModal
        {...props}
        components={[updatedComponent, customCode]}
      />,
    );
    expect(getCard(updatedComponent)).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(getAddButton());
    expect(onComponentClick).toHaveBeenCalledWith(updatedComponent);
  });
});

describe("Workflow picker keyboard access", () => {
  it.each(["{Enter}", " "])(
    "selects a focused card using %s without adding it before confirmation",
    async (key: string) => {
      const user: UserEventController = userEvent.setup();
      const onComponentClick: MockFunction = getJestMockFunction();
      renderPicker({ onComponentClick });
      const card: HTMLElement = getCard(createMonitor);

      // Reach the card through the actual tab order, starting at the focused search.
      await user.tab();
      expect(screen.getByRole("button", { name: "Monitor" })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole("button", { name: "Custom Code" })).toHaveFocus();
      await user.tab();
      expect(card).toHaveFocus();
      expect(card.tagName).toBe("BUTTON");
      expect(card).toHaveAttribute("type", "button");
      expect(card).toHaveAccessibleDescription(createMonitor.description);
      expect(card).toHaveAttribute("aria-pressed", "false");

      await user.keyboard(key);
      expect(card).toHaveAttribute("aria-pressed", "true");
      expect(getAddButton()).toBeEnabled();
      expect(onComponentClick).not.toHaveBeenCalled();
      await user.click(getAddButton());
      expect(onComponentClick).toHaveBeenCalledWith(createMonitor);
    },
  );

  it("announces only the most recently selected card as selected", async () => {
    const user: UserEventController = userEvent.setup();
    renderPicker();
    await user.click(getCard(createMonitor));
    await user.tab();
    expect(getCard(updateMonitor)).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(getCard(createMonitor)).toHaveAttribute("aria-pressed", "false");
    expect(getCard(updateMonitor)).toHaveAttribute("aria-pressed", "true");
  });

  it("returns focus from a card to search with slash and clears search with Escape", async () => {
    const user: UserEventController = userEvent.setup();
    const onCloseModal: MockFunction = getJestMockFunction();
    renderPicker({ onCloseModal });
    await user.click(getCard(createMonitor));
    await user.keyboard("/");
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(screen.getByRole("textbox")).toHaveValue("");
    await user.type(screen.getByRole("textbox"), "update monitor");
    expect(getAddButton()).toBeDisabled();
    await user.keyboard("{Escape}");

    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(getAddButton()).toBeDisabled();
    expect(onCloseModal).not.toHaveBeenCalled();
  });

  it("leaves slash available as input text", async () => {
    const user: UserEventController = userEvent.setup();
    renderPicker();
    await user.keyboard("/");
    expect(screen.getByRole("textbox")).toHaveValue("/");
  });
});

describe("Workflow picker search highlighting", () => {
  it("highlights each non-adjacent word with original capitalization", () => {
    renderPicker();
    search("  CrEaTe  MONITOR ");
    const card: HTMLElement = getCard(createMonitor);
    const marks: Array<string | null> = Array.from(
      card.querySelectorAll("mark"),
    ).map((mark: HTMLElement) => {
      return mark.textContent;
    });

    expect(marks).toEqual([
      "Create",
      "Monitor",
      "Monitor",
      "create",
      "Monitor",
    ]);
    expect(card).toHaveAccessibleName("Create One Monitor");
    expect(card).toHaveAccessibleDescription(createMonitor.description);
  });

  it("highlights tokens spread across title, category, and description", () => {
    renderPicker();
    search("javascript code workflow");
    const card: HTMLElement = getCard(customCode);
    const marks: Array<string | null> = Array.from(
      card.querySelectorAll("mark"),
    ).map((mark: HTMLElement) => {
      return mark.textContent;
    });

    expect(marks).toEqual(["JavaScript", "Code", "JavaScript", "workflow"]);
    expect(
      screen.queryByRole("button", { name: createMonitor.title }),
    ).not.toBeInTheDocument();
  });

  it.each([".", "[", "(", "*", "+", "?", "$", "^", "|", "\\"])(
    "treats regex metacharacter %s as literal text",
    (token: string) => {
      const literalComponent: ComponentMetadata = makeComponent({
        id: "literal",
        title: `Literal ${token} operation`,
        description: "A component with punctuation",
      });
      renderPicker({ components: [literalComponent, createMonitor] });
      search(`${token} operation`);
      const card: HTMLElement = getCard(literalComponent);
      const marks: Array<string | null> = Array.from(
        card.querySelectorAll("mark"),
      ).map((mark: HTMLElement) => {
        return mark.textContent;
      });

      expect(marks).toEqual([token, "operation"]);
      expect(screen.getByText("1 match")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: createMonitor.title }),
      ).not.toBeInTheDocument();
    },
  );

  it("highlights the longest token when search words overlap and repeat", () => {
    renderPicker();
    search("mon monitor MONITOR");
    const marks: Array<string | null> = Array.from(
      getCard(createMonitor).querySelectorAll("mark"),
    ).map((mark: HTMLElement) => {
      return mark.textContent;
    });

    expect(marks).toEqual(["Monitor", "Monitor", "Monitor"]);
  });

  it("renders whitespace-only searches without highlights or a reset action", () => {
    renderPicker();
    search("    ");

    expect(getCard(createMonitor).querySelectorAll("mark")).toHaveLength(0);
    expect(screen.getByText("3 available")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear", exact: true }),
    ).not.toBeInTheDocument();
  });
});
