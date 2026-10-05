import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import {
  AI_AGENT_RESET_AGENT_TEST_ID,
  AI_AGENT_SWITCH_TO_AGENT_TEST_ID,
  AI_AGENT_TEST_CONNECTION_TEST_ID,
  AiAgentAction,
  getAiAgentActions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAgentActions";
import {
  AI_AGENT_ACTIONS_BUTTON_TEST_ID,
  AiAgentActionsMenu,
  AiAgentTestProgress,
  getAiAgentCardButtons,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAgentActionsMenu";
import { Green500 } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import Card from "../../../UI/Components/Card/Card";
import CardMoreMenu from "../../../UI/Components/Card/CardMoreMenu";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import Pill from "../../../UI/Components/Pill/Pill";
import { getGlyphOfIcon, getGlyphOfMenuItem } from "../../UI/Components/MenuItemIcons";

/*
 * The AI agent card's ⋯, on its own and in the card header it was made for:
 * "We can have both of these buttons, like "Test Connection" and "Reset
 * Agent," in a more button style with three dots."
 *
 * It is the card header's ⋯ (CardMoreMenu) named for what it holds. Its
 * items are the actions AiAgentActions.ts offers: picked with the pointer or
 * the keyboard, a locked one says why and does nothing. Under it, the line
 * that says a test is running, which the menu cannot carry once it closes.
 */

type VoidMock = ReturnType<typeof jest.fn<() => void>>;
type UserEventController = ReturnType<typeof userEvent.setup>;

const REQUIREMENT: string =
  "Testing the connection needs permission to edit this Docker host (one of: Project Owner, Project Admin, Edit Docker Host).";

interface Handlers {
  onRun: VoidMock;
  onSwitch: VoidMock;
  onReset: VoidMock;
}

function makeHandlers(): Handlers {
  return {
    onRun: jest.fn<() => void>(),
    onSwitch: jest.fn<() => void>(),
    onReset: jest.fn<() => void>(),
  };
}

// What the pages hand in, for each kind of user.
function makeActions(
  handlers: Handlers,
  options: {
    who?: "admin" | "member" | "reader";
    isRunning?: boolean;
    isActing?: boolean;
    withSwitch?: boolean;
  } = {},
): Array<AiAgentAction> {
  const who: "admin" | "member" | "reader" = options.who || "admin";

  return getAiAgentActions({
    testConnection: {
      hasTarget: true,
      gate:
        who === "reader"
          ? {
              isAllowed: false,
              disabledReason:
                "You do not have permission to update this Docker Host.",
            }
          : { isAllowed: true },
      permissionRequirement: REQUIREMENT,
      isRunning: Boolean(options.isRunning),
      onRun: handlers.onRun,
    },
    switchToAgent: options.withSwitch
      ? { isOffered: who === "admin", onClick: handlers.onSwitch }
      : undefined,
    resetAgent: { isOffered: who === "admin", onClick: handlers.onReset },
    isActing: Boolean(options.isActing),
  });
}

function getTrigger(): HTMLElement {
  return screen.getByRole("button", { name: "AI agent actions" });
}

function openMenu(): HTMLElement {
  fireEvent.click(getTrigger());
  return screen.getByRole("menu");
}

function getItemTexts(menu: HTMLElement): Array<string> {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

async function userClick(
  user: UserEventController,
  element: Element,
): Promise<void> {
  await act(async () => {
    await user.click(element);
  });
}

async function userKeyboard(
  user: UserEventController,
  keys: string,
): Promise<void> {
  await act(async () => {
    await user.keyboard(keys);
  });
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the ⋯", () => {
  test("is one closed three-dots button named AI agent actions, with no visible label", () => {
    render(<AiAgentActionsMenu actions={makeActions(makeHandlers())} />);

    const trigger: HTMLElement = getTrigger();

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute(
      "data-testid",
      AI_AGENT_ACTIONS_BUTTON_TEST_ID,
    );
    expect(trigger.textContent).toBe("");
    expect(getGlyphOfMenuItem(trigger)).toBe(
      getGlyphOfIcon(IconProp.EllipsisHorizontal),
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // The actions are in the menu, not beside it.
    expect(screen.queryByText("Test connection")).not.toBeInTheDocument();
    expect(screen.queryByText("Reset agent")).not.toBeInTheDocument();
  });

  test("is the card header's ⋯ a table has, but for its name and test id", () => {
    render(<AiAgentActionsMenu actions={makeActions(makeHandlers())} />);
    const agentTrigger: HTMLElement = getTrigger();
    const agentClassName: string = agentTrigger.className;
    cleanup();

    render(
      <CardMoreMenu>
        {[
          <MoreMenuItem
            key="refresh"
            text="Refresh"
            icon={IconProp.Refresh}
            onClick={() => {}}
          />,
        ]}
      </CardMoreMenu>,
    );
    const tableTrigger: HTMLElement = screen.getByRole("button", {
      name: "More options",
    });

    expect(agentClassName).toBe(tableTrigger.className);
    expect(tableTrigger).not.toHaveAttribute("data-testid");
  });

  test("opens a menu of the actions, in order, each with its own icon and test id", () => {
    render(
      <AiAgentActionsMenu
        actions={makeActions(makeHandlers(), { withSwitch: true })}
      />,
    );

    const menu: HTMLElement = openMenu();

    expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
    expect(getItemTexts(menu)).toEqual([
      "Test connection",
      "Switch to the AI agent",
      "Reset agent",
    ]);

    const expected: Array<{ testId: string; icon: IconProp }> = [
      { testId: AI_AGENT_TEST_CONNECTION_TEST_ID, icon: IconProp.Play },
      {
        testId: AI_AGENT_SWITCH_TO_AGENT_TEST_ID,
        icon: IconProp.ArrowCircleRight,
      },
      { testId: AI_AGENT_RESET_AGENT_TEST_ID, icon: IconProp.Refresh },
    ];

    for (const row of expected) {
      const item: HTMLElement = within(menu).getByTestId(row.testId);
      expect(item).toHaveAttribute("role", "menuitem");
      expect(getGlyphOfMenuItem(item)).toBe(getGlyphOfIcon(row.icon));
      expect(item).not.toBeDisabled();
      expect(item).toHaveAttribute("aria-disabled", "false");
    }
  });

  test("picking an action runs it once, closes the menu and hands focus back to the ⋯", async () => {
    const user: UserEventController = userEvent.setup();
    const handlers: Handlers = makeHandlers();
    render(<AiAgentActionsMenu actions={makeActions(handlers)} />);

    await userClick(user, getTrigger());
    await userClick(
      user,
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Test connection",
      }),
    );

    expect(handlers.onRun).toHaveBeenCalledTimes(1);
    expect(handlers.onReset).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(getTrigger()).toHaveFocus();
    });
    expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
  });

  test("Reset agent runs the page's reset (its confirmation) and nothing else", async () => {
    const user: UserEventController = userEvent.setup();
    const handlers: Handlers = makeHandlers();
    render(<AiAgentActionsMenu actions={makeActions(handlers)} />);

    await userClick(user, getTrigger());
    await userClick(
      user,
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Reset agent",
      }),
    );

    expect(handlers.onReset).toHaveBeenCalledTimes(1);
    expect(handlers.onRun).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("a locked action says why, stays reachable from the keyboard, and does nothing", async () => {
    const user: UserEventController = userEvent.setup();
    const handlers: Handlers = makeHandlers();
    render(
      <AiAgentActionsMenu
        actions={makeActions(handlers, { who: "reader" })}
      />,
    );

    await userClick(user, getTrigger());
    const menu: HTMLElement = screen.getByRole("menu");
    const item: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Test connection",
    });

    // aria-disabled rather than disabled: a disabled button takes no focus.
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).not.toBeDisabled();
    expect(item).toHaveAccessibleDescription(REQUIREMENT);
    // The menu's roving focus lands on it, so its reason is read out.
    await waitFor(() => {
      expect(item).toHaveFocus();
    });

    await userClick(user, item);
    await userKeyboard(user, "{Enter}");

    expect(handlers.onRun).not.toHaveBeenCalled();
    // Nothing was picked, so the menu stays open.
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  test("a reader is offered only the locked test, never the admin actions", () => {
    render(
      <AiAgentActionsMenu
        actions={makeActions(makeHandlers(), {
          who: "reader",
          withSwitch: true,
        })}
      />,
    );

    expect(getItemTexts(openMenu())).toEqual(["Test connection"]);
  });

  test("a member is offered the test, ready to run", () => {
    render(
      <AiAgentActionsMenu
        actions={makeActions(makeHandlers(), {
          who: "member",
          withSwitch: true,
        })}
      />,
    );

    const menu: HTMLElement = openMenu();

    expect(getItemTexts(menu)).toEqual(["Test connection"]);
    expect(
      within(menu).getByRole("menuitem", { name: "Test connection" }),
    ).toHaveAttribute("aria-disabled", "false");
  });

  test("an action that is only busy is locked without a reason, and the arrow keys skip it", async () => {
    const user: UserEventController = userEvent.setup();
    const handlers: Handlers = makeHandlers();
    render(
      <AiAgentActionsMenu
        actions={makeActions(handlers, { isRunning: true, withSwitch: true })}
      />,
    );

    await userClick(user, getTrigger());
    const menu: HTMLElement = screen.getByRole("menu");
    const testItem: HTMLElement = within(menu).getByTestId(
      AI_AGENT_TEST_CONNECTION_TEST_ID,
    );
    const switchItem: HTMLElement = within(menu).getByTestId(
      AI_AGENT_SWITCH_TO_AGENT_TEST_ID,
    );
    const reset: HTMLElement = within(menu).getByTestId(
      AI_AGENT_RESET_AGENT_TEST_ID,
    );

    expect(testItem).toBeDisabled();
    expect(testItem).not.toHaveAttribute("aria-describedby");

    // The first item it can reach is the switch, then the reset, then round.
    await waitFor(() => {
      expect(switchItem).toHaveFocus();
    });
    await userKeyboard(user, "{ArrowDown}");
    expect(reset).toHaveFocus();
    await userKeyboard(user, "{ArrowDown}");
    expect(switchItem).toHaveFocus();

    fireEvent.click(testItem);

    expect(handlers.onRun).not.toHaveBeenCalled();
  });

  test("works from the keyboard: Enter opens it, the arrows move, Enter picks", async () => {
    const user: UserEventController = userEvent.setup();
    const handlers: Handlers = makeHandlers();
    render(
      <AiAgentActionsMenu
        actions={makeActions(handlers, { withSwitch: true })}
      />,
    );

    getTrigger().focus();
    await userKeyboard(user, "{Enter}");

    const menu: HTMLElement = screen.getByRole("menu");
    await waitFor(() => {
      expect(
        within(menu).getByRole("menuitem", { name: "Test connection" }),
      ).toHaveFocus();
    });

    await userKeyboard(user, "{End}");
    expect(
      within(menu).getByRole("menuitem", { name: "Reset agent" }),
    ).toHaveFocus();
    await userKeyboard(user, "{ArrowUp}");
    expect(
      within(menu).getByRole("menuitem", { name: "Switch to the AI agent" }),
    ).toHaveFocus();
    await userKeyboard(user, "{Home}");
    expect(
      within(menu).getByRole("menuitem", { name: "Test connection" }),
    ).toHaveFocus();
    await userKeyboard(user, "{ArrowDown}{Enter}");

    expect(handlers.onSwitch).toHaveBeenCalledTimes(1);
    expect(handlers.onRun).not.toHaveBeenCalled();
    expect(handlers.onReset).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("Escape closes it without picking anything and hands focus back", async () => {
    const user: UserEventController = userEvent.setup();
    const handlers: Handlers = makeHandlers();
    render(<AiAgentActionsMenu actions={makeActions(handlers)} />);

    await userClick(user, getTrigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await userKeyboard(user, "{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(getTrigger()).toHaveFocus();
    expect(handlers.onRun).not.toHaveBeenCalled();
    expect(handlers.onReset).not.toHaveBeenCalled();
  });

  test("a click outside closes it without picking anything", async () => {
    const user: UserEventController = userEvent.setup();
    const handlers: Handlers = makeHandlers();
    render(
      <div>
        <p>Outside</p>
        <AiAgentActionsMenu actions={makeActions(handlers)} />
      </div>,
    );

    await userClick(user, getTrigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await userClick(user, screen.getByText("Outside"));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(handlers.onRun).not.toHaveBeenCalled();
    expect(handlers.onReset).not.toHaveBeenCalled();
  });
});

describe("in German", () => {
  const german: i18n = createInstance();

  // The Dashboard's own German file, so a missing translation fails here.
  const GERMAN: JSONObject = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Locales",
        "de.json",
      ),
      "utf8",
    ),
  ) as JSONObject;

  function inGerman(key: string): string {
    const value: unknown = GERMAN[key];

    if (typeof value !== "string" || value === key) {
      throw new Error(`"${key}" has no German translation.`);
    }

    return value;
  }

  beforeAll(async () => {
    await german.init({
      lng: "de",
      resources: { de: { translation: GERMAN } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  test("names the ⋯ and every item in German", () => {
    render(
      <I18nextProvider i18n={german}>
        <AiAgentActionsMenu
          actions={makeActions(makeHandlers(), { withSwitch: true })}
        />
      </I18nextProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: inGerman("AI agent actions") }),
    );

    expect(getItemTexts(screen.getByRole("menu"))).toEqual([
      inGerman("Test connection"),
      inGerman("Switch to the AI agent"),
      inGerman("Reset agent"),
    ]);
  });

  test("says a test is running in German", () => {
    render(
      <I18nextProvider i18n={german}>
        <AiAgentTestProgress />
      </I18nextProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      inGerman("Testing the connection…"),
    );
  });
});

describe("the card's header buttons", () => {
  test("nothing to offer: no buttons at all - never an empty ⋯", () => {
    expect(getAiAgentCardButtons([])).toEqual([]);
  });

  test("anything to offer: exactly one ⋯, holding all of it", () => {
    const actions: Array<AiAgentAction> = makeActions(makeHandlers(), {
      withSwitch: true,
    });
    const buttons: Array<ReactElement> = getAiAgentCardButtons(actions);

    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.type).toBe(AiAgentActionsMenu);
    expect(buttons[0]!.key).toBe("ai-agent-actions");
    expect((buttons[0]!.props as { actions: Array<AiAgentAction> }).actions).toBe(
      actions,
    );
  });
});

describe("in the agent card's header", () => {
  function renderCard(actions: Array<AiAgentAction>): HTMLElement {
    render(
      <Card
        title="Docker AI agent"
        description="The small container next to your Docker host that runs commands for OneUptime AI."
        rightElement={
          <span data-testid="ai-agent-status">
            <Pill text="Connected" color={Green500} icon={IconProp.Check} />
          </span>
        }
        buttons={getAiAgentCardButtons(actions)}
      >
        <p>Body</p>
      </Card>,
    );

    return screen.getByTestId("card-header-actions");
  }

  test("keeps the status in sight, then one ⋯ - the only button in the header", () => {
    const header: HTMLElement = renderCard(makeActions(makeHandlers()));

    const status: HTMLElement = within(header).getByTestId("ai-agent-status");
    const trigger: HTMLElement = within(header).getByRole("button", {
      name: "AI agent actions",
    });

    expect(status).toHaveTextContent("Connected");
    expect(within(header).getAllByRole("button")).toEqual([trigger]);
    // The status first, the ⋯ after it.
    expect(
      status.compareDocumentPosition(trigger) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(header).queryByText("Test connection")).toBeNull();
    expect(within(header).queryByText("Reset agent")).toBeNull();
  });

  test("with nothing to offer, the header holds the status alone", () => {
    const header: HTMLElement = renderCard([]);

    expect(within(header).getByTestId("ai-agent-status")).toHaveTextContent(
      "Connected",
    );
    expect(within(header).queryAllByRole("button")).toEqual([]);
    expect(
      screen.queryByTestId(AI_AGENT_ACTIONS_BUTTON_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("the ⋯ opens over the card with the actions, and the card stays put", () => {
    const header: HTMLElement = renderCard(makeActions(makeHandlers()));

    fireEvent.click(
      within(header).getByRole("button", { name: "AI agent actions" }),
    );

    const menu: HTMLElement = within(header).getByRole("menu");
    expect(getItemTexts(menu)).toEqual(["Test connection", "Reset agent"]);
    expect(screen.getByText("Body")).toBeInTheDocument();
  });
});

describe("the running test's line", () => {
  test("says the test is running, as a status a screen reader announces", () => {
    render(<AiAgentTestProgress />);

    const status: HTMLElement = screen.getByRole("status");

    expect(status).toHaveAttribute("data-testid", "ai-agent-test-progress");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(/^Testing the connection…$/);
    // A spinner beside the words, hidden from screen readers.
    const svg: SVGElement | null = status.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg!.getAttribute("class")).toContain("animate-spin");
    expect(getGlyphOfMenuItem(status)).toBe(getGlyphOfIcon(IconProp.Spinner));
  });
});
