import EventStatusPanel, {
  ComponentProps,
  EventStateAction,
  EventStateItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          if (key === "Resolve translation key") {
            return "Résoudre";
          }

          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

/*
 * Incident, alert, and scheduled-maintenance detail pages all render their
 * state controls through EventStatusPanel. This suite deliberately exercises
 * that shared component through a real JSDOM render: the visual hierarchy is
 * only useful if the controls remain native buttons, the overflow exposes the
 * states that are not already visible, and both layouts keep the same
 * accessible action group.
 */

const CREATED_COLOR: Color = new Color("#64748b");
const ACKNOWLEDGED_COLOR: Color = new Color("#f59e0b");
const INVESTIGATING_COLOR: Color = new Color("#0ea5e9");
const RESOLVED_COLOR: Color = new Color("#10b981");

type MakeStateFunction = (
  id: string,
  name: string,
  color?: Color | undefined,
) => EventStateItem;

const makeState: MakeStateFunction = (
  id: string,
  name: string,
  color?: Color | undefined,
): EventStateItem => {
  return {
    id: id,
    name: name,
    color: color || CREATED_COLOR,
  };
};

type DefaultStatesFunction = () => Array<EventStateItem>;

const defaultStates: DefaultStatesFunction = (): Array<EventStateItem> => {
  return [
    makeState("created", "Created", CREATED_COLOR),
    makeState("acknowledged", "Acknowledged", ACKNOWLEDGED_COLOR),
    makeState("investigating", "Investigating", INVESTIGATING_COLOR),
    makeState("resolved", "Resolved", RESOLVED_COLOR),
  ];
};

type DefaultActionsFunction = () => Array<EventStateAction>;

const defaultActions: DefaultActionsFunction = (): Array<EventStateAction> => {
  return [
    {
      stateId: "acknowledged",
      label: "Acknowledge",
      icon: IconProp.Check,
      buttonStyle: ButtonStyleType.PRIMARY,
      id: "incident-acknowledge-btn",
    },
    {
      stateId: "resolved",
      label: "Resolve",
      icon: IconProp.CheckCircle,
      buttonStyle: ButtonStyleType.DANGER,
      id: "incident-resolve-btn",
    },
  ];
};

interface RenderedPanel {
  actionClicks: Array<string>;
  stateSelections: Array<string>;
}

type RenderPanelFunction = (
  overrides?: Partial<ComponentProps> | undefined,
) => RenderedPanel;

const renderPanel: RenderPanelFunction = (
  overrides?: Partial<ComponentProps> | undefined,
): RenderedPanel => {
  const actionClicks: Array<string> = [];
  const stateSelections: Array<string> = [];

  const props: ComponentProps = {
    states: defaultStates(),
    identifier: "INC-42",
    currentStateId: "created",
    actions: defaultActions(),
    onActionClick: (stateId: string): void => {
      actionClicks.push(stateId);
    },
    onStateSelect: (stateId: string): void => {
      stateSelections.push(stateId);
    },
    ...overrides,
  };

  render(<EventStatusPanel {...props} />);

  return {
    actionClicks: actionClicks,
    stateSelections: stateSelections,
  };
};

type GetActionGroupFunction = () => HTMLElement;

const getActionGroup: GetActionGroupFunction = (): HTMLElement => {
  return screen.getByRole("group", { name: "Event actions" });
};

type GetMoreActionsTriggerFunction = () => HTMLElement;

const getMoreActionsTrigger: GetMoreActionsTriggerFunction =
  (): HTMLElement => {
    return screen.getByRole("button", { name: "More actions" });
  };

type OpenMenuFunction = () => HTMLElement;

const openMenu: OpenMenuFunction = (): HTMLElement => {
  fireEvent.click(getMoreActionsTrigger());
  return screen.getByRole("menu");
};

type GetMenuChoicesFunction = (menu: HTMLElement) => Array<HTMLElement>;

/*
 * MoreMenu historically wrapped a MoreMenuSection in one menuitem and put
 * the actual choices beneath it. Taking only leaf menuitems lets this test
 * describe the user-selectable states and remains valid if that redundant
 * wrapper is later removed.
 */
const getMenuChoices: GetMenuChoicesFunction = (
  menu: HTMLElement,
): Array<HTMLElement> => {
  return Array.from(
    menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ).filter((element: HTMLElement) => {
    return !element.querySelector('[role="menuitem"]');
  });
};

type GetMenuChoiceFunction = (menu: HTMLElement, name: string) => HTMLElement;

const getMenuChoice: GetMenuChoiceFunction = (
  menu: HTMLElement,
  name: string,
): HTMLElement => {
  const choice: HTMLElement | undefined = getMenuChoices(menu).find(
    (element: HTMLElement) => {
      return element.textContent?.trim() === name;
    },
  );

  if (!choice) {
    throw new Error(`Menu choice "${name}" was not rendered.`);
  }

  return choice;
};

type MenuChoiceNamesFunction = (menu: HTMLElement) => Array<string>;

const menuChoiceNames: MenuChoiceNamesFunction = (
  menu: HTMLElement,
): Array<string> => {
  return getMenuChoices(menu).map((element: HTMLElement) => {
    return element.textContent?.trim() || "";
  });
};

afterEach(() => {
  cleanup();
});

describe("EventStatusPanel action buttons", () => {
  test("renders actions as native, fixed-height buttons in caller order", () => {
    renderPanel();

    const group: HTMLElement = getActionGroup();
    const acknowledge: HTMLElement = within(group).getByRole("button", {
      name: "Acknowledge",
    });
    const resolve: HTMLElement = within(group).getByRole("button", {
      name: "Resolve",
    });
    const more: HTMLElement = within(group).getByRole("button", {
      name: "More actions",
    });

    expect(acknowledge.tagName).toBe("BUTTON");
    expect(resolve.tagName).toBe("BUTTON");
    expect(acknowledge).toHaveAttribute("type", "button");
    expect(resolve).toHaveAttribute("type", "button");
    expect(acknowledge).toHaveClass("h-9");
    expect(resolve).toHaveClass("h-9");

    const controls: Array<HTMLElement> = within(group).getAllByRole("button");
    expect(controls).toEqual([acknowledge, resolve, more]);
  });

  test("translates action labels and keeps the full label available when truncated", () => {
    renderPanel({
      actions: [
        {
          stateId: "resolved",
          label: "Resolve translation key",
          buttonStyle: ButtonStyleType.PRIMARY,
        },
      ],
    });

    const translatedAction: HTMLElement = screen.getByRole("button", {
      name: "Résoudre",
    });

    expect(translatedAction).toHaveAttribute("title", "Résoudre");
    expect(
      screen.queryByRole("button", { name: "Resolve translation key" }),
    ).not.toBeInTheDocument();
  });

  test("preserves stable DOM ids and reports the clicked state id", () => {
    const rendered: RenderedPanel = renderPanel();

    const acknowledge: HTMLElement = screen.getByRole("button", {
      name: "Acknowledge",
    });
    const resolve: HTMLElement = screen.getByRole("button", {
      name: "Resolve",
    });

    expect(acknowledge).toHaveAttribute("id", "incident-acknowledge-btn");
    expect(resolve).toHaveAttribute("id", "incident-resolve-btn");

    fireEvent.click(acknowledge);
    fireEvent.click(resolve);

    expect(rendered.actionClicks).toEqual(["acknowledged", "resolved"]);
  });

  test("uses a solid indigo hierarchy for the primary action", () => {
    renderPanel();

    const acknowledge: HTMLElement = screen.getByRole("button", {
      name: "Acknowledge",
    });

    expect(acknowledge).toHaveClass("bg-indigo-600", "text-white");
    expect(acknowledge).not.toHaveClass("bg-white", "text-gray-700");
    expect(acknowledge).not.toHaveAttribute("style");
    expect(acknowledge.className).not.toContain("var(--btn");
  });

  test.each([ButtonStyleType.OUTLINE, ButtonStyleType.DANGER])(
    "renders non-primary style %s as the same neutral outline hierarchy",
    (buttonStyle: ButtonStyleType) => {
      renderPanel({
        actions: [
          {
            stateId: "resolved",
            label: "Secondary action",
            buttonStyle: buttonStyle,
          },
        ],
      });

      const button: HTMLElement = screen.getByRole("button", {
        name: "Secondary action",
      });

      expect(button).toHaveClass(
        "h-9",
        "border-gray-300",
        "bg-white",
        "text-gray-700",
      );
      expect(button).not.toHaveClass(
        "bg-indigo-600",
        "bg-red-600",
        "bg-green-600",
      );
      expect(button).not.toHaveAttribute("style");
    },
  );

  test("renders the requested action icons and leaves iconless actions clean", () => {
    renderPanel({
      actions: [
        ...defaultActions(),
        {
          stateId: "investigating",
          label: "Escalate",
          buttonStyle: ButtonStyleType.OUTLINE,
        },
      ],
    });

    const acknowledge: HTMLElement = screen.getByRole("button", {
      name: "Acknowledge",
    });
    const resolve: HTMLElement = screen.getByRole("button", {
      name: "Resolve",
    });
    const escalate: HTMLElement = screen.getByRole("button", {
      name: "Escalate",
    });

    const acknowledgeIcon: SVGElement | null = acknowledge.querySelector("svg");
    const resolveIcon: SVGElement | null = resolve.querySelector("svg");

    expect(acknowledgeIcon).toHaveClass("h-4", "w-4");
    expect(resolveIcon).toHaveClass("h-4", "w-4");
    expect(acknowledgeIcon?.innerHTML).not.toEqual(resolveIcon?.innerHTML);
    expect(escalate.querySelector("svg")).toBeNull();
  });

  test("uses the same native presentation when an action has no color", () => {
    renderPanel({
      actions: [
        {
          stateId: "acknowledged",
          label: "Colorless primary",
          buttonStyle: ButtonStyleType.PRIMARY,
        },
        {
          stateId: "resolved",
          label: "Colorless secondary",
          buttonStyle: ButtonStyleType.OUTLINE,
        },
      ],
    });

    const primary: HTMLElement = screen.getByRole("button", {
      name: "Colorless primary",
    });
    const secondary: HTMLElement = screen.getByRole("button", {
      name: "Colorless secondary",
    });

    expect(primary.tagName).toBe("BUTTON");
    expect(primary).toHaveClass("h-9", "bg-indigo-600", "text-white");
    expect(secondary.tagName).toBe("BUTTON");
    expect(secondary).toHaveClass(
      "h-9",
      "border-gray-300",
      "bg-white",
      "text-gray-700",
    );
    expect(primary).not.toHaveAttribute("style");
    expect(secondary).not.toHaveAttribute("style");
  });
});

describe("EventStatusPanel overflow states", () => {
  test("excludes the current and visible-action states, preserves order, and deduplicates alternatives", () => {
    renderPanel({
      states: [
        makeState("created", "Created"),
        makeState("acknowledged", "Acknowledged"),
        makeState("investigating", "Investigating"),
        makeState("investigating", "Duplicate investigating"),
        makeState("monitoring", "Monitoring"),
        makeState("resolved", "Resolved"),
      ],
      currentStateId: "created",
    });

    const menu: HTMLElement = openMenu();

    expect(menuChoiceNames(menu)).toEqual(["Investigating", "Monitoring"]);
    expect(within(menu).queryByText("Created")).not.toBeInTheDocument();
    expect(within(menu).queryByText("Acknowledged")).not.toBeInTheDocument();
    expect(within(menu).queryByText("Resolved")).not.toBeInTheDocument();
    expect(
      within(menu).queryByText("Duplicate investigating"),
    ).not.toBeInTheDocument();
  });

  test("reports the selected alternative state and closes the menu", () => {
    const rendered: RenderedPanel = renderPanel();
    const menu: HTMLElement = openMenu();

    fireEvent.click(getMenuChoice(menu, "Investigating"));

    expect(rendered.stateSelections).toEqual(["investigating"]);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("uses the supplied overflow section title", () => {
    renderPanel({ moreMenuTitle: "Move incident to" });

    const menu: HTMLElement = openMenu();

    expect(within(menu).getByText("MOVE INCIDENT TO")).toBeInTheDocument();
  });

  test("does not render overflow without a selection callback", () => {
    renderPanel({ onStateSelect: undefined });

    expect(
      screen.queryByRole("button", { name: "More actions" }),
    ).not.toBeInTheDocument();
  });

  test("does not render overflow when every other state already has a visible action", () => {
    renderPanel({
      states: [
        makeState("created", "Created"),
        makeState("acknowledged", "Acknowledged"),
        makeState("resolved", "Resolved"),
      ],
    });

    expect(
      screen.queryByRole("button", { name: "More actions" }),
    ).not.toBeInTheDocument();
  });

  test("does not render overflow when the current state is the only state", () => {
    renderPanel({
      states: [makeState("created", "Created")],
      actions: [],
    });

    expect(
      screen.queryByRole("button", { name: "More actions" }),
    ).not.toBeInTheDocument();
  });

  test("does not offer backward transitions from an intermediate state", () => {
    renderPanel({
      currentStateId: "acknowledged",
      actions: [
        {
          stateId: "resolved",
          label: "Resolve",
          buttonStyle: ButtonStyleType.PRIMARY,
        },
      ],
    });

    const menu: HTMLElement = openMenu();

    expect(menuChoiceNames(menu)).toEqual(["Investigating"]);
    expect(within(menu).queryByText("Created")).not.toBeInTheDocument();
  });

  test("does not render invalid backward transitions after resolution", () => {
    renderPanel({ currentStateId: "resolved", actions: [] });

    expect(
      screen.queryByRole("button", { name: "More actions" }),
    ).not.toBeInTheDocument();
  });

  test("still renders overflow when alternatives exist but there are no visible actions", () => {
    renderPanel({ actions: [] });

    expect(getMoreActionsTrigger()).toBeInTheDocument();
    expect(menuChoiceNames(openMenu())).toEqual([
      "Acknowledged",
      "Investigating",
      "Resolved",
    ]);
  });

  test("keeps recovery alternatives available when the current state is missing", () => {
    renderPanel({ currentStateId: "removed-state" });

    expect(menuChoiceNames(openMenu())).toEqual(["Created", "Investigating"]);
  });
});

describe("EventStatusPanel disabled behavior", () => {
  test("disables every visible action and suppresses action callbacks", () => {
    const rendered: RenderedPanel = renderPanel({ isDisabled: true });
    const acknowledge: HTMLElement = screen.getByRole("button", {
      name: "Acknowledge",
    });
    const resolve: HTMLElement = screen.getByRole("button", {
      name: "Resolve",
    });

    expect(acknowledge).toBeDisabled();
    expect(resolve).toBeDisabled();

    fireEvent.click(acknowledge);
    fireEvent.click(resolve);

    expect(rendered.actionClicks).toEqual([]);
  });

  test("makes overflow accessibly disabled and prevents mouse or keyboard opening", () => {
    const rendered: RenderedPanel = renderPanel({ isDisabled: true });
    const trigger: HTMLElement = getMoreActionsTrigger();

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toBeDisabled();

    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
    fireEvent.keyDown(trigger, { key: " ", code: "Space" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(rendered.stateSelections).toEqual([]);
  });
});

describe("EventStatusPanel action-group layout", () => {
  test("labels one responsive wrapping group for every action control", () => {
    renderPanel();

    const group: HTMLElement = getActionGroup();

    expect(group).toHaveAttribute("aria-label", "Event actions");
    expect(group).toHaveClass(
      "flex",
      "w-full",
      "flex-wrap",
      "justify-end",
      "md:w-auto",
    );
    expect(within(group).getByRole("button", { name: "Acknowledge" })).toBe(
      screen.getByRole("button", { name: "Acknowledge" }),
    );
    expect(within(group).getByRole("button", { name: "Resolve" })).toBe(
      screen.getByRole("button", { name: "Resolve" }),
    );
    expect(within(group).getByRole("button", { name: "More actions" })).toBe(
      screen.getByRole("button", { name: "More actions" }),
    );
  });

  test("keeps the overflow control aligned to the fixed action height", () => {
    renderPanel();

    expect(getMoreActionsTrigger()).toHaveClass("h-9", "w-9");
  });

  test("constrains long state-action labels before truncating them", () => {
    renderPanel({
      actions: [
        {
          stateId: "acknowledged",
          label: "A very long custom scheduled maintenance state label",
          buttonStyle: ButtonStyleType.PRIMARY,
        },
      ],
    });

    const button: HTMLElement = screen.getByRole("button", {
      name: "A very long custom scheduled maintenance state label",
    });

    expect(button).toHaveClass("min-w-[7rem]", "max-w-full", "sm:max-w-64");
    expect(button.querySelector("span")).toHaveClass("truncate");
  });
});

describe("EventStatusPanel header layouts", () => {
  test("puts the title, identifier badge, and action group in the header layout", () => {
    renderPanel({ title: "Database connection failures" });

    const heading: HTMLElement = screen.getByRole("heading", {
      level: 2,
      name: "Database connection failures",
    });
    const identifier: HTMLElement = screen.getByTitle("Number");
    const group: HTMLElement = getActionGroup();
    const headingBlock: HTMLElement = heading.parentElement as HTMLElement;
    const headerRow: HTMLElement = headingBlock.parentElement as HTMLElement;

    expect(identifier).toHaveTextContent("INC-42");
    expect(identifier).toHaveClass("bg-gray-100", "uppercase");
    expect(headerRow).toHaveClass("md:items-start", "md:justify-between");
    expect(headerRow).toContainElement(group);
    expect(headerRow).not.toContainElement(screen.getByTestId("pill"));
  });

  test("uses the compact inline metadata layout when no title is supplied", () => {
    renderPanel();

    const identifier: HTMLElement = screen.getByTitle("Number");
    const group: HTMLElement = getActionGroup();
    const compactRow: HTMLElement = group.parentElement as HTMLElement;

    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    expect(identifier).toHaveTextContent("INC-42");
    expect(identifier).toHaveClass("text-sm", "font-semibold");
    expect(identifier).not.toHaveClass("bg-gray-100", "uppercase");
    expect(compactRow).toHaveClass("md:items-center", "md:justify-between");
    expect(compactRow).toContainElement(identifier);
    expect(compactRow).toContainElement(screen.getByTestId("pill"));
  });

  test("falls back to black when hydrated current-state color is absent", () => {
    renderPanel({
      states: [
        {
          id: "created",
          name: "Created",
          // Older API payloads can omit this despite the model-level type.
          color: undefined as unknown as Color,
        },
      ],
      actions: [],
    });

    expect(screen.getByTestId("pill")).toHaveStyle({
      backgroundColor: "#000000",
    });
  });
});
