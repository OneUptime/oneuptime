import EventStatusPanel, {
  ComponentProps,
  EventStateAction,
  EventStateItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import EventOverviewLayout from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventOverviewLayout";
import EventStatTile from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatTile";
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
  test("keeps long event titles readable without truncating the heading", () => {
    const title: string =
      "Recurring scheduled maintenance for the production authentication database and every dependent customer-facing service";
    renderPanel({ title: title });

    const heading: HTMLElement = screen.getByRole("heading", {
      level: 2,
      name: title,
    });

    expect(heading).toHaveTextContent(title);
    expect(heading).not.toHaveClass("truncate", "whitespace-nowrap");
    expect(heading.className).toMatch(/break-words|\[overflow-wrap:anywhere\]/);
  });

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

describe("EventStatusPanel state progression", () => {
  test("announces state order and identifies only the current step", () => {
    renderPanel({ currentStateId: "acknowledged" });

    const progression: HTMLElement = screen.getByRole("list", {
      name: "State progression",
    });
    const steps: Array<HTMLElement> =
      within(progression).getAllByRole("listitem");

    expect(progression.tagName).toBe("OL");
    expect(steps).toHaveLength(4);
    defaultStates().forEach((state: EventStateItem, index: number) => {
      expect(within(steps[index]!).getByText(state.name)).toBeInTheDocument();
    });
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(progression.querySelectorAll('[aria-current="step"]')).toHaveLength(
      1,
    );
    expect(steps[0]).not.toHaveAttribute("aria-current");
    expect(steps[2]).not.toHaveAttribute("aria-current");
    expect(steps[3]).not.toHaveAttribute("aria-current");
  });

  test.each([undefined, "removed-state"])(
    "does not invent current or completed steps for unknown state %s",
    (currentStateId: string | undefined) => {
      renderPanel({ currentStateId: currentStateId });

      const progression: HTMLElement = screen.getByRole("list", {
        name: "State progression",
      });

      expect(within(progression).getAllByRole("listitem")).toHaveLength(4);
      expect(progression.querySelector('[aria-current="step"]')).toBeNull();
      expect(progression.querySelector("svg")).toBeNull();
    },
  );

  test("omits an unhelpful progress rail for a single state", () => {
    renderPanel({ states: [makeState("created", "Created")], actions: [] });

    expect(
      screen.queryByRole("list", { name: "State progression" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
  });

  test("keeps private visibility explicit while actions are disabled", () => {
    renderPanel({
      title: "Private production incident",
      isPrivate: true,
      isDisabled: true,
      currentStateId: "acknowledged",
    });

    expect(screen.getByText("Private")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Private production incident" }),
    ).toBeInTheDocument();
    within(getActionGroup())
      .getAllByRole("button")
      .forEach((button: HTMLElement) => {
        expect(button).toBeDisabled();
      });
    expect(
      screen.getByRole("list", { name: "State progression" }),
    ).toBeInTheDocument();
  });
});

describe("EventOverviewLayout", () => {
  test("separates the summary, response activity, and details into named regions", () => {
    render(
      <EventOverviewLayout
        header={<h2>Database latency</h2>}
        summary={<EventStatTile label="Response time" value="2 minutes" />}
        sidebar={<p>Platform on-call</p>}
      >
        <p>Investigating the connection pool</p>
      </EventOverviewLayout>,
    );

    expect(
      screen.getByRole("heading", { name: "Database latency" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Event summary" })).getByText(
        "2 minutes",
      ),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", { name: "Response activity" }),
      ).getByText("Investigating the connection pool"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("complementary", { name: "Details" })).getByText(
        "Platform on-call",
      ),
    ).toBeInTheDocument();
  });

  test("supports maintenance-specific headings and activity context", () => {
    render(
      <EventOverviewLayout
        header={<h2>Database upgrade</h2>}
        summary={<p>Starts tomorrow</p>}
        sidebar={<p>Scheduled for 30 minutes</p>}
        activityTitle="Maintenance activity"
        activityDescription="Updates and conversations for this maintenance window."
        sidebarTitle="Maintenance details"
      >
        <p>Upgrade checklist reviewed</p>
      </EventOverviewLayout>,
    );

    const activity: HTMLElement = screen.getByRole("region", {
      name: "Maintenance activity",
    });

    expect(
      within(activity).getByRole("heading", { name: "Maintenance activity" }),
    ).toBeInTheDocument();
    expect(
      within(activity).getByText(
        "Updates and conversations for this maintenance window.",
      ),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("complementary", { name: "Maintenance details" }),
      ).getByText("Scheduled for 30 minutes"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Response activity" }),
    ).not.toBeInTheDocument();
  });

  test("provides keyboard skip links to focusable activity and details destinations", () => {
    render(
      <EventOverviewLayout
        header={<h2>Production incident</h2>}
        summary={<p>Investigating</p>}
        sidebar={<p>Platform team</p>}
      >
        <p>Latest response</p>
      </EventOverviewLayout>,
    );

    ["Skip to activity", "Skip to details"].forEach((name: string) => {
      const link: HTMLElement = screen.getByRole("link", { name: name });
      const href: string | null = link.getAttribute("href");

      expect(href).toMatch(/^#.+/);
      const destination: HTMLElement | null = document.getElementById(
        href!.slice(1),
      );
      expect(destination).toBeInTheDocument();
      expect(destination).toHaveAttribute("tabindex", "-1");
    });
  });

  test("keeps region labels and skip destinations unique when multiple layouts render", () => {
    const { container } = render(
      <React.Fragment>
        <EventOverviewLayout
          header={<h2>Incident</h2>}
          summary={<p>Incident summary</p>}
          sidebar={<p>Incident details</p>}
        >
          <p>Incident response</p>
        </EventOverviewLayout>
        <EventOverviewLayout
          header={<h2>Alert</h2>}
          summary={<p>Alert summary</p>}
          sidebar={<p>Alert details</p>}
        >
          <p>Alert response</p>
        </EventOverviewLayout>
      </React.Fragment>,
    );

    const ids: Array<string> = Array.from(
      container.querySelectorAll<HTMLElement>("[id]"),
    ).map((element: HTMLElement) => {
      return element.id;
    });
    const destinations: Array<string | null> = screen
      .getAllByRole("link")
      .map((link: HTMLElement) => {
        return link.getAttribute("href");
      });

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(destinations).size).toBe(4);
    expect(
      screen.getAllByRole("region", { name: "Response activity" }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole("complementary", { name: "Details" }),
    ).toHaveLength(2);
  });
});

describe("EventStatTile", () => {
  test("associates each summary value with a semantic term and optional description", () => {
    const { container } = render(
      <EventStatTile
        id="incident-response-time"
        label="Response time"
        value="2 minutes"
        description="From creation to acknowledgement"
      />,
    );

    const label: HTMLElement | null = screen
      .getByText("Response time")
      .closest("dt");
    const value: HTMLElement | null = screen
      .getByText("2 minutes")
      .closest("dd");

    expect(container.querySelector("dl")).toContainElement(label);
    expect(container.querySelector("dl")).toContainElement(value);
    expect(
      screen.getByText("From creation to acknowledgement"),
    ).toBeInTheDocument();
    expect(document.getElementById("incident-response-time")).toContainElement(
      value,
    );
  });

  test("wraps long labels and values so complete timing information remains readable", () => {
    const label: string =
      "Total scheduled maintenance duration including verification";
    const value: string = "2 days, 15 hours, 47 minutes, and 32 seconds";
    render(<EventStatTile label={label} value={value} />);

    const term: HTMLElement = screen
      .getByText(label)
      .closest("dt") as HTMLElement;
    const definition: HTMLElement = screen
      .getByText(value)
      .closest("dd") as HTMLElement;

    expect(term).toHaveTextContent(label);
    expect(definition).toHaveTextContent(value);
    expect(term).not.toHaveClass("truncate", "whitespace-nowrap");
    expect(definition).not.toHaveClass("truncate", "whitespace-nowrap");
    expect(definition).toHaveClass("break-words");
  });

  test("preserves interactive React values and hides decorative icons from assistive technology", () => {
    const { container } = render(
      <EventStatTile
        label="Affected monitor"
        value={<a href="/monitors/production-api">Production API</a>}
        icon={IconProp.Clock}
      />,
    );

    const link: HTMLElement = screen.getByRole("link", {
      name: "Production API",
    });
    const icon: SVGSVGElement | null = container.querySelector("svg");

    expect(link).toHaveAttribute("href", "/monitors/production-api");
    expect(link.closest("dd")).toBeInTheDocument();
    expect(icon).toBeInTheDocument();
    expect(icon?.closest('[aria-hidden="true"]')).toBeInTheDocument();
  });

  test("renders a value without requiring a description or an icon", () => {
    const { container } = render(
      <EventStatTile label="Time to acknowledge" value="Pending" />,
    );

    expect(screen.getByText("Pending").closest("dd")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelectorAll("dt")).toHaveLength(1);
    expect(container.querySelectorAll("dd")).toHaveLength(1);
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
