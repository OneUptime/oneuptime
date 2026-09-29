import EventStatusPanel, {
  ComponentProps,
  EventPanelAction,
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
import getJestMockFunction, { MockFunction } from "../../MockType";
import { Black, Red500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";

// React's warning for list items without a (unique) key.
const KEY_WARNING_PATTERN: RegExp = /unique "key"|same key/;

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
  test("labels one responsive wrapping group for every action control (compact layout)", () => {
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
    expect(headerRow).toHaveClass("xl:items-start", "xl:justify-between");
    expect(headerRow).toContainElement(group);
    expect(headerRow).not.toContainElement(screen.getByTestId("pill"));
  });

  /*
   * Beside a side menu, a header that went side by side from md squeezed the
   * title to a few characters and stacked the actions one per row, so the
   * titled header stacks the actions under the title until xl.
   */
  test("stacks the actions under the title until xl, and puts them beside it only from xl", () => {
    renderPanel({ title: "Database connection failures" });

    const heading: HTMLElement = screen.getByRole("heading", {
      level: 2,
      name: "Database connection failures",
    });
    const headerRow: HTMLElement = (heading.parentElement as HTMLElement)
      .parentElement as HTMLElement;

    expect(headerRow).toHaveClass(
      "flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between",
      { exact: true },
    );
    expect(headerRow).not.toHaveClass("md:flex-row");
    expect(headerRow).not.toHaveClass("md:items-start");
    expect(headerRow).not.toHaveClass("md:justify-between");
  });

  test("keeps the titled header's action group full width until xl", () => {
    renderPanel({ title: "Database connection failures" });

    const group: HTMLElement = getActionGroup();

    expect(group).toHaveClass(
      "flex w-full flex-wrap items-center justify-end gap-2 xl:w-auto xl:shrink-0",
      { exact: true },
    );
    expect(group).not.toHaveClass("md:w-auto");
    expect(group).toHaveAttribute("aria-label", "Event actions");
    expect(within(group).getAllByRole("button")).toEqual([
      screen.getByRole("button", { name: "Acknowledge" }),
      screen.getByRole("button", { name: "Resolve" }),
      screen.getByRole("button", { name: "More actions" }),
    ]);
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

  // Only the titled header moved to xl; the compact layout is as it was.
  test("keeps the compact layout side by side from md, with its action group full width until md", () => {
    renderPanel();

    const group: HTMLElement = getActionGroup();
    const compactRow: HTMLElement = group.parentElement as HTMLElement;

    expect(compactRow).toHaveClass(
      "flex flex-col gap-3 px-4 py-4 sm:px-5 md:flex-row md:items-center md:justify-between",
      { exact: true },
    );
    expect(compactRow).not.toHaveClass("xl:flex-row");
    expect(group).toHaveClass(
      "flex w-full flex-wrap items-center justify-end gap-2 md:w-auto",
      { exact: true },
    );
    expect(group).not.toHaveClass("xl:w-auto");
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

describe("EventStatusPanel header notice", () => {
  test("renders a notice inside the titled header card", () => {
    render(
      <EventStatusPanel
        title="Database latency"
        identifier="INC-42"
        states={[]}
        actions={[]}
        onActionClick={() => {}}
        headerNotice={
          <div data-testid="header-notice">AI is investigating</div>
        }
      />,
    );

    const notice: HTMLElement = screen.getByTestId("header-notice");
    expect(notice).toHaveTextContent("AI is investigating");
    expect(notice.parentElement).toHaveClass("mt-3");
    expect(screen.getByText("Database latency")).toBeInTheDocument();
    expect(screen.getByText("INC-42")).toBeInTheDocument();
  });

  test("adds no empty notice spacing when the optional content is absent", () => {
    const { container } = render(
      <EventStatusPanel
        title="Database latency"
        states={[]}
        actions={[]}
        onActionClick={() => {}}
      />,
    );

    expect(container.querySelector(".mt-3")).toBeNull();
  });

  test("keeps existing metadata, state progress, and actions intact beside the notice", () => {
    const onActionClick: MockFunction = getJestMockFunction();
    render(
      <EventStatusPanel
        title="Database latency"
        states={[
          { id: "created", name: "Created", color: CREATED_COLOR },
          {
            id: "acknowledged",
            name: "Acknowledged",
            color: ACKNOWLEDGED_COLOR,
          },
        ]}
        currentStateId="created"
        severity={{ name: "Critical", color: Red500 }}
        isPrivate={true}
        durationPrefix="Ongoing for"
        durationStartsAt={new Date("2026-08-07T10:00:00.000Z")}
        durationEndsAt={new Date("2026-08-07T10:05:00.000Z")}
        actions={[
          {
            stateId: "acknowledged",
            label: "Acknowledge",
            icon: IconProp.Check,
            buttonStyle: ButtonStyleType.PRIMARY,
          },
        ]}
        onActionClick={onActionClick}
        headerNotice={
          <div data-testid="header-notice">AI is investigating</div>
        }
      />,
    );

    expect(screen.getAllByText("Created").length).toBeGreaterThan(0);
    expect(screen.getByText("Acknowledged")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();
    expect(screen.getByText("Ongoing for")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(onActionClick).toHaveBeenCalledWith("acknowledged");
  });

  test("leaves compact consumers unchanged", () => {
    render(
      <EventStatusPanel
        identifier="#7"
        states={[{ id: "created", name: "Created", color: Black }]}
        currentStateId="created"
        actions={[]}
        onActionClick={() => {}}
        headerNotice={
          <div data-testid="header-notice">AI is investigating</div>
        }
      />,
    );

    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.queryByTestId("header-notice")).not.toBeInTheDocument();
  });
});

describe("EventStatusPanel header facts", () => {
  type GetFactsFunction = () => HTMLElement | null;

  const getFacts: GetFactsFunction = (): HTMLElement | null => {
    return screen.queryByTestId("event-status-facts");
  };

  type FactPairsFunction = (facts: HTMLElement) => Array<[string, string]>;

  const factPairs: FactPairsFunction = (
    facts: HTMLElement,
  ): Array<[string, string]> => {
    return Array.from(facts.children).map(
      (group: Element): [string, string] => {
        return [
          group.querySelector("dt")?.textContent?.trim() || "",
          group.querySelector("dd")?.textContent?.trim() || "",
        ];
      },
    );
  };

  test("renders facts as a description list of label and value pairs", () => {
    renderPanel({
      title: "Checkout latency",
      facts: [
        { label: "Declared", value: "Sep 14, 18:01" },
        { label: "Declared by", value: "Probe US East" },
        { label: "Monitor", value: "checkout-api" },
      ],
    });

    const facts: HTMLElement = getFacts() as HTMLElement;

    expect(facts.tagName).toBe("DL");
    expect(factPairs(facts)).toEqual([
      ["Declared", "Sep 14, 18:01"],
      ["Declared by", "Probe US East"],
      ["Monitor", "checkout-api"],
    ]);

    for (const group of Array.from(facts.children)) {
      expect(group.tagName).toBe("DIV");
      expect(group.children[0]?.tagName).toBe("DT");
      expect(group.children[1]?.tagName).toBe("DD");
    }
  });

  test("wraps on narrow screens and keeps long values from overflowing", () => {
    renderPanel({
      title: "Checkout latency",
      facts: [
        {
          label: "Monitor",
          value:
            "checkout-api-production-eu-west-1-primary-cluster-with-a-very-long-name",
        },
      ],
    });

    const facts: HTMLElement = getFacts() as HTMLElement;
    const value: HTMLElement = facts.querySelector("dd") as HTMLElement;

    expect(facts).toHaveClass("flex", "flex-wrap");
    expect(value).toHaveClass("min-w-0", "break-words");
    expect(value).not.toHaveClass("truncate");
    expect(facts.children[0]).toHaveClass("max-w-full", "min-w-0");
  });

  test("renders an element value such as a link", () => {
    renderPanel({
      title: "Checkout latency",
      facts: [
        {
          label: "Episode",
          value: <a href="/dashboard/episodes/7">#7</a>,
        },
      ],
    });

    const link: HTMLElement = screen.getByRole("link", { name: "#7" });

    expect(link).toHaveAttribute("href", "/dashboard/episodes/7");
    expect((getFacts() as HTMLElement).querySelector("dd")).toContainElement(
      link,
    );
  });

  test("renders a decorative icon inside the term", () => {
    renderPanel({
      title: "Checkout latency",
      facts: [
        { label: "Declared", value: "Sep 14", icon: IconProp.Calendar },
        { label: "Monitor", value: "checkout-api" },
      ],
    });

    const groups: Array<Element> = Array.from(
      (getFacts() as HTMLElement).children,
    );

    const declaredIcon: Element | null = groups[0]!.querySelector("dt svg");
    expect(declaredIcon).toHaveClass("h-4", "w-4", "text-gray-400");
    expect(declaredIcon).toHaveAttribute("aria-hidden", "true");
    expect(groups[1]!.querySelector("svg")).toBeNull();
    // The icon never lands directly in the <div> group or the <dd>.
    expect(groups[0]!.querySelector("dd svg")).toBeNull();
  });

  test("sits below the pills and above the header notice", () => {
    renderPanel({
      title: "Checkout latency",
      severity: { name: "Critical", color: Red500 },
      facts: [{ label: "Declared", value: "Sep 14" }],
      headerNotice: <div data-testid="header-notice">AI is investigating</div>,
    });

    const facts: HTMLElement = getFacts() as HTMLElement;
    const pills: Array<HTMLElement> = screen.getAllByTestId("pill");
    const notice: HTMLElement = screen.getByTestId("header-notice");

    expect(
      pills[0]!.compareDocumentPosition(facts) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      facts.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(facts).not.toContainElement(notice);
    expect(notice.parentElement).toHaveClass("mt-3");
  });

  test("still renders facts when the header has no pills", () => {
    render(
      <EventStatusPanel
        title="Database latency"
        states={[]}
        actions={[]}
        onActionClick={() => {}}
        facts={[{ label: "Created", value: "Sep 14" }]}
      />,
    );

    expect(factPairs(getFacts() as HTMLElement)).toEqual([
      ["Created", "Sep 14"],
    ]);
  });

  test("renders no list and no spacing when facts are missing or empty", () => {
    const { container, rerender } = render(
      <EventStatusPanel
        title="Database latency"
        states={[]}
        actions={[]}
        onActionClick={() => {}}
      />,
    );

    expect(container.querySelector("dl")).toBeNull();

    rerender(
      <EventStatusPanel
        title="Database latency"
        states={[]}
        actions={[]}
        onActionClick={() => {}}
        facts={[]}
      />,
    );

    expect(container.querySelector("dl")).toBeNull();
    // The existing contract: no stray spacing wrappers without content.
    expect(container.querySelector(".mt-3")).toBeNull();
    expect(container.querySelector(".mt-2\\.5")).toBeNull();
  });

  test("skips facts with an empty value so callers can pass optional ones", () => {
    renderPanel({
      title: "Checkout latency",
      facts: [
        { label: "Declared", value: "Sep 14" },
        { label: "Declared by", value: "" },
        { label: "Monitor", value: "   " },
        { label: "", value: "orphan value" },
        { label: "Episode", value: null as unknown as string },
      ],
    });

    expect(factPairs(getFacts() as HTMLElement)).toEqual([
      ["Declared", "Sep 14"],
    ]);
    expect(screen.queryByText("orphan value")).not.toBeInTheDocument();
  });

  test("renders nothing when every fact is empty", () => {
    const { container } = render(
      <EventStatusPanel
        title="Database latency"
        states={[]}
        actions={[]}
        onActionClick={() => {}}
        facts={[{ label: "Declared by", value: "" }]}
      />,
    );

    expect(container.querySelector("dl")).toBeNull();
  });

  test("keeps facts out of the compact layout", () => {
    renderPanel({
      facts: [{ label: "Declared", value: "Sep 14" }],
    });

    expect(getFacts()).toBeNull();
    expect(screen.queryByText("Declared")).not.toBeInTheDocument();
    // The compact row itself is untouched.
    expect(screen.getByTitle("Number")).toHaveTextContent("INC-42");
  });

  test("translates fact labels but never the values", () => {
    renderPanel({
      title: "Checkout latency",
      facts: [
        { label: "Resolve translation key", value: "Resolve translation key" },
      ],
    });

    expect(factPairs(getFacts() as HTMLElement)).toEqual([
      ["Résoudre", "Resolve translation key"],
    ]);
  });

  test("leaves the actions, pills and step rail intact beside the facts", () => {
    const rendered: RenderedPanel = renderPanel({
      title: "Checkout latency",
      facts: [{ label: "Declared", value: "Sep 14" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

    expect(rendered.actionClicks).toEqual(["acknowledged"]);
    expect(screen.getByTestId("pill")).toHaveTextContent("Created");
    expect(screen.getByText("Investigating")).toBeInTheDocument();
    expect(getActionGroup()).not.toContainElement(getFacts());
  });
});

/*
 * Secondary actions are the header's non-state buttons - "Declare Incident"
 * on an alert is the first. They share the state buttons' row and size but
 * never their primary look, never reach onActionClick (which would open a
 * state-change modal for a state that does not exist), never change what the
 * "More actions" menu offers, and stay on screen when no state action is
 * left. A locked one explains itself through a hoverable, focusable wrapper,
 * because a disabled <button> cannot trigger a tooltip.
 */
describe("EventStatusPanel secondary actions", () => {
  const DECLARE_ID: string = "alert-declare-incident-btn";
  const DECLARE_LABEL: string = "Declare Incident";
  const LOCKED_REASON: string =
    "You do not have permission to create this Incident.";

  type MakeSecondaryActionFunction = (
    overrides?: Partial<EventPanelAction> | undefined,
  ) => EventPanelAction;

  const makeSecondaryAction: MakeSecondaryActionFunction = (
    overrides?: Partial<EventPanelAction> | undefined,
  ): EventPanelAction => {
    return {
      id: DECLARE_ID,
      label: DECLARE_LABEL,
      icon: IconProp.Alert,
      onClick: (): void => {},
      ...overrides,
    };
  };

  type GetButtonFunction = (name: string) => HTMLElement;

  const getButton: GetButtonFunction = (name: string): HTMLElement => {
    return screen.getByRole("button", { name: name });
  };

  type IsBeforeFunction = (first: Node, second: Node) => boolean;

  const isBefore: IsBeforeFunction = (first: Node, second: Node): boolean => {
    return Boolean(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * First in this block on purpose: React reports a missing list key only
   * once per owner component, so the first render with secondary actions is
   * the one that would warn.
   */
  test("keys each action by its id, so reordering moves rather than relabels them", () => {
    const consoleErrorSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      console,
      "error",
    );

    const first: EventPanelAction = makeSecondaryAction({
      id: "first-secondary-btn",
      label: "First",
    });
    const second: EventPanelAction = makeSecondaryAction({
      id: "second-secondary-btn",
      label: "Second",
      isDisabled: true,
      tooltip: LOCKED_REASON,
    });
    const third: EventPanelAction = makeSecondaryAction({
      id: "third-secondary-btn",
      label: "Third",
    });

    const baseProps: ComponentProps = {
      states: defaultStates(),
      identifier: "ALR-12",
      currentStateId: "created",
      actions: defaultActions(),
      onActionClick: (): void => {},
      onStateSelect: (): void => {},
    };

    const { rerender } = render(
      <EventStatusPanel
        {...baseProps}
        secondaryActions={[first, second, third]}
      />,
    );

    const firstNode: HTMLElement = getButton("First");
    const secondWrapper: HTMLElement = screen.getByTestId(
      "second-secondary-btn-disabled-wrapper",
    );
    const thirdNode: HTMLElement = getButton("Third");

    rerender(
      <EventStatusPanel
        {...baseProps}
        secondaryActions={[third, second, first]}
      />,
    );

    // Same DOM nodes, now in the new order.
    expect(getButton("First")).toBe(firstNode);
    expect(getButton("Third")).toBe(thirdNode);
    expect(screen.getByTestId("second-secondary-btn-disabled-wrapper")).toBe(
      secondWrapper,
    );
    expect(firstNode).toHaveAttribute("id", "first-secondary-btn");
    expect(thirdNode).toHaveAttribute("id", "third-secondary-btn");
    expect(isBefore(thirdNode, secondWrapper)).toBe(true);
    expect(isBefore(secondWrapper, firstNode)).toBe(true);

    const keyWarnings: Array<unknown> = consoleErrorSpy.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return KEY_WARNING_PATTERN.test(String(call[0]));
      },
    );

    expect(keyWarnings).toEqual([]);
  });

  test("renders after the state buttons and before the More actions trigger", () => {
    renderPanel({ secondaryActions: [makeSecondaryAction()] });

    const group: HTMLElement = getActionGroup();
    const acknowledge: HTMLElement = within(group).getByRole("button", {
      name: "Acknowledge",
    });
    const resolve: HTMLElement = within(group).getByRole("button", {
      name: "Resolve",
    });
    const declare: HTMLElement = within(group).getByRole("button", {
      name: DECLARE_LABEL,
    });
    const more: HTMLElement = within(group).getByRole("button", {
      name: "More actions",
    });

    expect(within(group).getAllByRole("button")).toEqual([
      acknowledge,
      resolve,
      declare,
      more,
    ]);
    // A direct child of the group, like the state buttons - not nested.
    expect(declare.parentElement).toBe(group);
  });

  test("is a native button with its id and label as title", () => {
    renderPanel({ secondaryActions: [makeSecondaryAction()] });

    const declare: HTMLElement = getButton(DECLARE_LABEL);

    expect(declare.tagName).toBe("BUTTON");
    expect(declare).toHaveAttribute("type", "button");
    expect(declare).toHaveAttribute("id", DECLARE_ID);
    expect(declare).toHaveAttribute("title", DECLARE_LABEL);
    expect(declare).toBeEnabled();
    expect(declare).toHaveAttribute("aria-disabled", "false");
    expect(declare.querySelector("span")).toHaveClass("truncate");
    expect(declare.querySelector("span")).toHaveTextContent(DECLARE_LABEL);
  });

  test("uses the state buttons' base classes with the neutral, never the indigo, look", () => {
    renderPanel({ secondaryActions: [makeSecondaryAction()] });

    const acknowledge: HTMLElement = getButton("Acknowledge");
    // DANGER renders neutral, so Resolve is the neutral reference.
    const resolve: HTMLElement = getButton("Resolve");
    const declare: HTMLElement = getButton(DECLARE_LABEL);

    const primaryVariantClasses: Array<string> = [
      "border-indigo-600",
      "bg-indigo-600",
      "text-white",
      "hover:border-indigo-700",
      "hover:bg-indigo-700",
    ];
    const baseClasses: Array<string> = acknowledge.className
      .split(/\s+/)
      .filter((className: string): boolean => {
        return (
          className.length > 0 && !primaryVariantClasses.includes(className)
        );
      });

    expect(baseClasses).toEqual(
      expect.arrayContaining(["inline-flex", "h-9", "min-w-[7rem]"]),
    );
    expect(declare).toHaveClass(...baseClasses);
    expect(declare.className).toBe(resolve.className);
    expect(declare).toHaveClass(
      "border-gray-300",
      "bg-white",
      "text-gray-700",
      "hover:bg-gray-50",
    );
    expect(declare).not.toHaveClass(
      "bg-indigo-600",
      "border-indigo-600",
      "text-white",
      "pointer-events-none",
      "w-full",
    );
    expect(declare).not.toHaveAttribute("style");

    // The state action stays the one primary button in the row.
    const primaryButtons: Array<HTMLElement> = within(getActionGroup())
      .getAllByRole("button")
      .filter((button: HTMLElement): boolean => {
        return button.classList.contains("bg-indigo-600");
      });

    expect(primaryButtons).toEqual([acknowledge]);
  });

  test("translates its label like the state labels", () => {
    renderPanel({
      secondaryActions: [
        makeSecondaryAction({ label: "Resolve translation key" }),
      ],
    });

    const translated: HTMLElement = getButton("Résoudre");

    expect(translated).toHaveAttribute("id", DECLARE_ID);
    expect(translated).toHaveAttribute("title", "Résoudre");
    expect(
      screen.queryByRole("button", { name: "Resolve translation key" }),
    ).not.toBeInTheDocument();
  });

  test("renders its icon at the state buttons' icon size, and none when it has no icon", () => {
    renderPanel({
      secondaryActions: [
        makeSecondaryAction(),
        makeSecondaryAction({
          id: "iconless-secondary-btn",
          label: "Iconless",
          icon: undefined,
        }),
      ],
    });

    const declareIcon: SVGElement | null =
      getButton(DECLARE_LABEL).querySelector("svg");
    const acknowledgeIcon: SVGElement | null =
      getButton("Acknowledge").querySelector("svg");

    expect(declareIcon).not.toBeNull();
    expect(declareIcon).toHaveClass("h-4", "w-4", "shrink-0");
    expect(declareIcon?.innerHTML).not.toEqual(acknowledgeIcon?.innerHTML);
    expect(getButton("Iconless").querySelector("svg")).toBeNull();
  });

  test("calls its own onClick exactly once and never the state callbacks", () => {
    const onDeclare: MockFunction = getJestMockFunction();
    const rendered: RenderedPanel = renderPanel({
      secondaryActions: [makeSecondaryAction({ onClick: onDeclare })],
    });

    fireEvent.click(getButton(DECLARE_LABEL));

    expect(onDeclare).toHaveBeenCalledTimes(1);
    expect(onDeclare).toHaveBeenCalledWith();
    expect(rendered.actionClicks).toEqual([]);
    expect(rendered.stateSelections).toEqual([]);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // The state buttons beside it still report their own states only.
    fireEvent.click(getButton("Acknowledge"));

    expect(rendered.actionClicks).toEqual(["acknowledged"]);
    expect(onDeclare).toHaveBeenCalledTimes(1);
  });

  test("never reaches onActionClick even when its id matches a state id", () => {
    const onClick: MockFunction = getJestMockFunction();
    const rendered: RenderedPanel = renderPanel({
      secondaryActions: [
        makeSecondaryAction({
          id: "resolved",
          label: "Look-alike",
          onClick: onClick,
        }),
      ],
    });

    fireEvent.click(getButton("Look-alike"));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(rendered.actionClicks).toEqual([]);
  });

  test("leaves the More actions menu exactly as it was", () => {
    renderPanel();

    const withoutSecondary: Array<string> = menuChoiceNames(openMenu());

    cleanup();

    renderPanel({ secondaryActions: [makeSecondaryAction()] });

    const menu: HTMLElement = openMenu();

    expect(withoutSecondary).toEqual(["Investigating"]);
    expect(menuChoiceNames(menu)).toEqual(withoutSecondary);
    expect(within(menu).queryByText(DECLARE_LABEL)).not.toBeInTheDocument();
  });

  test.each(["investigating", "acknowledged", "resolved", "created"])(
    "does not hide the %s state from the menu when an action shares its id",
    (sharedId: string) => {
      renderPanel({
        actions: [],
        secondaryActions: [
          makeSecondaryAction({ id: sharedId, label: "Look-alike" }),
        ],
      });

      expect(menuChoiceNames(openMenu())).toEqual([
        "Acknowledged",
        "Investigating",
        "Resolved",
      ]);
    },
  );

  test("reports a menu selection as a state change, not a secondary click", () => {
    const onDeclare: MockFunction = getJestMockFunction();
    const rendered: RenderedPanel = renderPanel({
      secondaryActions: [makeSecondaryAction({ onClick: onDeclare })],
    });

    fireEvent.click(getMenuChoice(openMenu(), "Investigating"));

    expect(rendered.stateSelections).toEqual(["investigating"]);
    expect(onDeclare).not.toHaveBeenCalled();
  });

  test("does not conjure a More actions menu when every other state already has a button", () => {
    renderPanel({
      states: [
        makeState("created", "Created"),
        makeState("acknowledged", "Acknowledged"),
        makeState("resolved", "Resolved"),
      ],
      secondaryActions: [makeSecondaryAction()],
    });

    expect(
      screen.queryByRole("button", { name: "More actions" }),
    ).not.toBeInTheDocument();
    expect(within(getActionGroup()).getAllByRole("button")).toEqual([
      getButton("Acknowledge"),
      getButton("Resolve"),
      getButton(DECLARE_LABEL),
    ]);
  });

  test("stays on a resolved event, where it is the only button", () => {
    const onDeclare: MockFunction = getJestMockFunction();

    renderPanel({
      currentStateId: "resolved",
      actions: [],
      secondaryActions: [makeSecondaryAction({ onClick: onDeclare })],
    });

    const group: HTMLElement = getActionGroup();
    const declare: HTMLElement = getButton(DECLARE_LABEL);

    expect(within(group).getAllByRole("button")).toEqual([declare]);
    expect(declare).toBeEnabled();

    fireEvent.click(declare);

    expect(onDeclare).toHaveBeenCalledTimes(1);
  });

  test("renders even when the panel has no states at all", () => {
    render(
      <EventStatusPanel
        title="Database latency"
        states={[]}
        actions={[]}
        onActionClick={() => {}}
        secondaryActions={[makeSecondaryAction()]}
      />,
    );

    expect(within(getActionGroup()).getAllByRole("button")).toEqual([
      getButton(DECLARE_LABEL),
    ]);
  });

  test.each([
    ["undefined", undefined],
    ["an empty list", []],
  ])(
    "renders nothing extra when secondaryActions is %s",
    (_label: string, secondaryActions: Array<EventPanelAction> | undefined) => {
      renderPanel({ secondaryActions: secondaryActions });

      const group: HTMLElement = getActionGroup();

      expect(within(group).getAllByRole("button")).toEqual([
        getButton("Acknowledge"),
        getButton("Resolve"),
        getMoreActionsTrigger(),
      ]);
      expect(document.getElementById(DECLARE_ID)).toBeNull();
      expect(
        document.querySelector('[data-testid$="-disabled-wrapper"]'),
      ).toBeNull();
    },
  );

  test("is disabled with the rest of the panel, and a click does nothing", () => {
    const onDeclare: MockFunction = getJestMockFunction();

    renderPanel({
      isDisabled: true,
      secondaryActions: [makeSecondaryAction({ onClick: onDeclare })],
    });

    const declare: HTMLElement = getButton(DECLARE_LABEL);

    expect(declare).toBeDisabled();
    expect(declare).toHaveAttribute("aria-disabled", "true");
    // No reason to show, so no wrapper and the label stays as the title.
    expect(screen.queryByTestId(`${DECLARE_ID}-disabled-wrapper`)).toBeNull();
    expect(declare).toHaveAttribute("title", DECLARE_LABEL);

    fireEvent.click(declare);

    expect(onDeclare).not.toHaveBeenCalled();
  });

  test("gets the tooltip wrapper when the panel is disabled and the action carries a reason", () => {
    renderPanel({
      isDisabled: true,
      secondaryActions: [makeSecondaryAction({ tooltip: LOCKED_REASON })],
    });

    const wrapper: HTMLElement = screen.getByTestId(
      `${DECLARE_ID}-disabled-wrapper`,
    );

    expect(wrapper).toContainElement(getButton(DECLARE_LABEL));
    expect(getButton(DECLARE_LABEL)).toBeDisabled();
  });

  test.each([
    ["no tooltip", undefined],
    ["an empty tooltip", ""],
  ])(
    "a disabled action with %s is disabled in place, with no wrapper",
    (_label: string, tooltip: string | undefined) => {
      const onDeclare: MockFunction = getJestMockFunction();
      const rendered: RenderedPanel = renderPanel({
        secondaryActions: [
          makeSecondaryAction({
            isDisabled: true,
            tooltip: tooltip,
            onClick: onDeclare,
          }),
        ],
      });

      const declare: HTMLElement = getButton(DECLARE_LABEL);

      expect(declare).toBeDisabled();
      expect(declare).toHaveAttribute("aria-disabled", "true");
      expect(declare).toHaveAttribute("title", DECLARE_LABEL);
      expect(declare).not.toHaveClass("pointer-events-none", "w-full");
      expect(declare.parentElement).toBe(getActionGroup());
      expect(screen.queryByTestId(`${DECLARE_ID}-disabled-wrapper`)).toBeNull();

      fireEvent.click(declare);

      expect(onDeclare).not.toHaveBeenCalled();
      // Only this action is locked; the state controls still work.
      expect(getButton("Acknowledge")).toBeEnabled();
      expect(getButton("Resolve")).toBeEnabled();
      expect(getMoreActionsTrigger()).toBeEnabled();

      fireEvent.click(getButton("Resolve"));

      expect(rendered.actionClicks).toEqual(["resolved"]);
    },
  );

  test("a disabled action with a reason hands the pointer and focus to a wrapper", () => {
    renderPanel({
      secondaryActions: [
        makeSecondaryAction({ isDisabled: true, tooltip: LOCKED_REASON }),
      ],
    });

    const group: HTMLElement = getActionGroup();
    const wrapper: HTMLElement = screen.getByTestId(
      `${DECLARE_ID}-disabled-wrapper`,
    );
    const declare: HTMLElement = getButton(DECLARE_LABEL);

    expect(wrapper.tagName).toBe("SPAN");
    expect(wrapper).toHaveAttribute("tabindex", "0");
    expect(wrapper.tabIndex).toBe(0);
    expect(wrapper).toHaveClass(
      "inline-flex",
      "min-w-[7rem]",
      "max-w-full",
      "flex-auto",
      "rounded-md",
      "sm:max-w-64",
      "sm:flex-none",
    );
    expect(declare.parentElement).toBe(wrapper);
    expect(wrapper.parentElement).toBe(group);

    // Taken out of hit-testing so the wrapper receives the hover.
    expect(declare).toHaveClass("pointer-events-none", "w-full");
    // The tooltip carries the message; a native title would compete with it.
    expect(declare).not.toHaveAttribute("title");
    expect(declare).toBeDisabled();
    expect(declare).toHaveAttribute("aria-disabled", "true");
    // Still the neutral look.
    expect(declare).toHaveClass("border-gray-300", "bg-white", "text-gray-700");
    expect(declare).not.toHaveClass("bg-indigo-600");

    // Still between the state buttons and the menu.
    expect(isBefore(getButton("Resolve"), wrapper)).toBe(true);
    expect(isBefore(wrapper, getMoreActionsTrigger())).toBe(true);
  });

  test("shows the reason when the wrapper is hovered", () => {
    renderPanel({
      secondaryActions: [
        makeSecondaryAction({ isDisabled: true, tooltip: LOCKED_REASON }),
      ],
    });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId(`${DECLARE_ID}-disabled-wrapper`));

    expect(screen.getByRole("tooltip")).toHaveTextContent(LOCKED_REASON);
  });

  test("shows the reason when the wrapper is focused from the keyboard", () => {
    renderPanel({
      secondaryActions: [
        makeSecondaryAction({ isDisabled: true, tooltip: LOCKED_REASON }),
      ],
    });

    const wrapper: HTMLElement = screen.getByTestId(
      `${DECLARE_ID}-disabled-wrapper`,
    );

    wrapper.focus();

    expect(document.activeElement).toBe(wrapper);

    fireEvent.focus(wrapper);

    expect(screen.getByRole("tooltip")).toHaveTextContent(LOCKED_REASON);
  });

  test("translates the reason like the label", () => {
    renderPanel({
      secondaryActions: [
        makeSecondaryAction({
          isDisabled: true,
          tooltip: "Resolve translation key",
        }),
      ],
    });

    fireEvent.mouseEnter(screen.getByTestId(`${DECLARE_ID}-disabled-wrapper`));

    expect(screen.getByRole("tooltip")).toHaveTextContent("Résoudre");
    expect(screen.getByRole("tooltip")).not.toHaveTextContent(
      "Resolve translation key",
    );
  });

  test("a click on a locked action with a reason does nothing", () => {
    const onDeclare: MockFunction = getJestMockFunction();
    const rendered: RenderedPanel = renderPanel({
      secondaryActions: [
        makeSecondaryAction({
          isDisabled: true,
          tooltip: LOCKED_REASON,
          onClick: onDeclare,
        }),
      ],
    });

    fireEvent.click(screen.getByTestId(`${DECLARE_ID}-disabled-wrapper`));
    fireEvent.click(getButton(DECLARE_LABEL));

    expect(onDeclare).not.toHaveBeenCalled();
    expect(rendered.actionClicks).toEqual([]);
  });

  test("an enabled action ignores its tooltip and gets no wrapper", () => {
    renderPanel({
      secondaryActions: [makeSecondaryAction({ tooltip: LOCKED_REASON })],
    });

    const declare: HTMLElement = getButton(DECLARE_LABEL);

    expect(screen.queryByTestId(`${DECLARE_ID}-disabled-wrapper`)).toBeNull();
    expect(declare.parentElement).toBe(getActionGroup());
    expect(declare).toBeEnabled();
    expect(declare).toHaveAttribute("title", DECLARE_LABEL);
    expect(declare).not.toHaveClass("pointer-events-none");
  });

  test.each([
    ["titled", "Database latency"],
    ["compact", undefined],
  ])("works in the %s layout", (_layout: string, title: string | undefined) => {
    const onDeclare: MockFunction = getJestMockFunction();

    renderPanel({
      title: title,
      secondaryActions: [
        makeSecondaryAction({ onClick: onDeclare }),
        makeSecondaryAction({
          id: "locked-secondary-btn",
          label: "Locked",
          isDisabled: true,
          tooltip: LOCKED_REASON,
        }),
      ],
    });

    if (title) {
      expect(
        screen.getByRole("heading", { level: 2, name: title }),
      ).toBeInTheDocument();
    } else {
      expect(
        screen.queryByRole("heading", { level: 2 }),
      ).not.toBeInTheDocument();
    }

    const group: HTMLElement = getActionGroup();
    const declare: HTMLElement = getButton(DECLARE_LABEL);
    const locked: HTMLElement = getButton("Locked");

    expect(within(group).getAllByRole("button")).toEqual([
      getButton("Acknowledge"),
      getButton("Resolve"),
      declare,
      locked,
      getMoreActionsTrigger(),
    ]);
    expect(
      within(group).getByTestId("locked-secondary-btn-disabled-wrapper"),
    ).toContainElement(locked);

    fireEvent.click(declare);

    expect(onDeclare).toHaveBeenCalledTimes(1);
  });

  test("keeps several secondary actions in caller order, each with its own handler", () => {
    const onFirst: MockFunction = getJestMockFunction();
    const onSecond: MockFunction = getJestMockFunction();
    const onThird: MockFunction = getJestMockFunction();

    const rendered: RenderedPanel = renderPanel({
      secondaryActions: [
        makeSecondaryAction({
          id: "first-secondary-btn",
          label: "First",
          onClick: onFirst,
        }),
        makeSecondaryAction({
          id: "second-secondary-btn",
          label: "Second",
          onClick: onSecond,
          isDisabled: true,
          tooltip: LOCKED_REASON,
        }),
        makeSecondaryAction({
          id: "third-secondary-btn",
          label: "Third",
          onClick: onThird,
        }),
      ],
    });

    const group: HTMLElement = getActionGroup();
    const first: HTMLElement = getButton("First");
    const second: HTMLElement = getButton("Second");
    const third: HTMLElement = getButton("Third");

    expect(within(group).getAllByRole("button")).toEqual([
      getButton("Acknowledge"),
      getButton("Resolve"),
      first,
      second,
      third,
      getMoreActionsTrigger(),
    ]);
    expect(first).toHaveAttribute("id", "first-secondary-btn");
    expect(second).toHaveAttribute("id", "second-secondary-btn");
    expect(third).toHaveAttribute("id", "third-secondary-btn");

    fireEvent.click(third);
    fireEvent.click(second);
    fireEvent.click(first);

    expect(onFirst).toHaveBeenCalledTimes(1);
    expect(onSecond).not.toHaveBeenCalled();
    expect(onThird).toHaveBeenCalledTimes(1);
    expect(onThird.mock.invocationCallOrder[0]!).toBeLessThan(
      onFirst.mock.invocationCallOrder[0]!,
    );
    expect(rendered.actionClicks).toEqual([]);
  });
});
