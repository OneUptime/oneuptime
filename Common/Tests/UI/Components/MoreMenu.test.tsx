import MoreMenu, {
  ComponentProps as MoreMenuProps,
} from "../../../UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import MoreMenuSection from "../../../UI/Components/MoreMenu/MoreMenuSection";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, jest, test } from "@jest/globals";
import React, { act, ReactElement } from "react";

jest.setTimeout(30000);

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

type TriggerVariant =
  | "default"
  | "custom"
  | "custom-native"
  | "custom-unstyled";
type OpenMethod = "click" | "Enter" | "Space";

interface MenuHarness {
  trigger: HTMLElement;
  outsideButton: HTMLButtonElement;
  onSelect: Array<SelectionMock>;
}

type MoreMenuTestProps = Omit<MoreMenuProps, "children">;
type SelectionMock = ReturnType<typeof jest.fn>;
type UserEventController = ReturnType<typeof userEvent.setup>;

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

async function userTab(
  user: UserEventController,
  shift: boolean,
): Promise<void> {
  await act(async () => {
    await user.tab({ shift: shift });
  });
}

const ACTION_LABELS: ReadonlyArray<string> = [
  "First action",
  "Second action",
  "Third action",
];

let originalRequestAnimationFrame:
  | typeof window.requestAnimationFrame
  | undefined;

beforeEach(() => {
  originalRequestAnimationFrame = window.requestAnimationFrame;

  /*
   * MoreMenu restores focus on the next animation frame. JSDOM does not
   * consistently expose requestAnimationFrame, so model that browser turn
   * with a zero-delay timer and let waitFor observe the resulting focus.
   */
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback): number => {
      return window.setTimeout(() => {
        callback(0);
      }, 0);
    },
  });
});

afterEach(() => {
  cleanup();

  if (originalRequestAnimationFrame) {
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: originalRequestAnimationFrame,
    });
  } else {
    Reflect.deleteProperty(window, "requestAnimationFrame");
  }

  jest.clearAllMocks();
});

function renderMenu(
  triggerVariant: TriggerVariant = "default",
  props: MoreMenuTestProps = {},
  useSection: boolean = false,
): MenuHarness {
  const onSelect: Array<SelectionMock> = ACTION_LABELS.map(() => {
    return jest.fn();
  });

  const menuItems: Array<ReactElement> = ACTION_LABELS.map(
    (label: string, index: number): ReactElement => {
      return (
        <MoreMenuItem
          key={label}
          text={label}
          onClick={() => {
            onSelect[index]!();
          }}
        />
      );
    },
  );

  const children: Array<ReactElement> = useSection
    ? [
        <MoreMenuSection key="state-changes" title="State changes">
          {menuItems}
        </MoreMenuSection>,
      ]
    : menuItems;

  const menuProps: MoreMenuTestProps = {
    text: "Event actions",
    ...props,
  };

  if (triggerVariant === "custom") {
    menuProps.elementToBeShownInsteadOfButton = (
      <span aria-hidden="true">•••</span>
    );
    menuProps.triggerClassName = props.triggerClassName || "custom-trigger";
  } else if (triggerVariant === "custom-native") {
    menuProps.elementToBeShownInsteadOfButton = (
      <button type="button" aria-label="Event actions">
        •••
      </button>
    );
  } else if (triggerVariant === "custom-unstyled") {
    menuProps.elementToBeShownInsteadOfButton = (
      <div aria-hidden="true">•••</div>
    );
    menuProps.triggerClassName = undefined;
  }

  render(
    <div>
      <MoreMenu {...menuProps}>{children}</MoreMenu>
      <button type="button">Outside target</button>
    </div>,
  );

  return {
    trigger: screen.getByRole("button", {
      name: menuProps.text || "More options",
    }),
    outsideButton: screen.getByRole("button", {
      name: "Outside target",
    }) as HTMLButtonElement,
    onSelect,
  };
}

async function openMenu(
  trigger: HTMLElement,
  method: OpenMethod = "click",
): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

  if (method === "click") {
    await userClick(user, trigger);
  } else {
    trigger.focus();
    await userKeyboard(user, method === "Enter" ? "{Enter}" : "[Space]");
  }

  expect(screen.getByRole("menu")).toBeInTheDocument();
}

describe("MoreMenu trigger accessibility", () => {
  test("the default trigger uses the supplied accessible name", () => {
    const { trigger } = renderMenu("default");

    expect(trigger).toHaveAccessibleName("Event actions");
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("the default trigger falls back to 'More options' when text is omitted", () => {
    const { trigger } = renderMenu("default", { text: undefined });

    expect(trigger).toHaveAccessibleName("More options");
  });

  test("a custom trigger exposes the supplied accessible name and menu semantics", () => {
    const { trigger } = renderMenu("custom");

    expect(trigger).toHaveAccessibleName("Event actions");
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("a custom trigger falls back to 'More options' when text is omitted", () => {
    renderMenu("custom", { text: undefined });

    expect(
      screen.getByRole("button", { name: "More options" }),
    ).toBeInTheDocument();
  });

  test("triggerClassName is applied to the focusable custom trigger", () => {
    const { trigger } = renderMenu("custom", {
      triggerClassName: "event-actions-trigger h-9",
    });

    expect(trigger).toHaveClass("event-actions-trigger", "h-9");
  });

  test("an unstyled non-interactive custom element keeps a keyboard-operable wrapper", () => {
    const { trigger } = renderMenu("custom-unstyled");

    expect(trigger.tagName).toBe("DIV");
    expect(trigger).toHaveAttribute("role", "button");
    expect(trigger).toHaveAttribute("tabindex", "0");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("an existing native custom button is enhanced without a nested trigger", () => {
    const { trigger } = renderMenu("custom-native");

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.parentElement).not.toHaveAttribute("role", "button");
    expect(
      screen.getAllByRole("button", { name: "Event actions" }),
    ).toHaveLength(1);
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});

describe.each<{
  label: string;
  variant: TriggerVariant;
}>([
  { label: "default trigger", variant: "default" },
  { label: "custom trigger", variant: "custom" },
  { label: "native custom trigger", variant: "custom-native" },
  { label: "unstyled custom trigger", variant: "custom-unstyled" },
])(
  "MoreMenu opening with the $label",
  ({ variant }: { variant: TriggerVariant }) => {
    test.each(["click", "Enter", "Space"])(
      "%s opens the menu",
      async (method: string) => {
        const { trigger } = renderMenu(variant);

        await openMenu(trigger, method as OpenMethod);

        expect(trigger).toHaveAttribute("aria-expanded", "true");
      },
    );

    test("aria-expanded and aria-controls track the open menu", async () => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      const { trigger } = renderMenu(variant);

      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger).not.toHaveAttribute("aria-controls");

      await userClick(user, trigger);

      const menu: HTMLElement = screen.getByRole("menu");

      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(trigger).toHaveAttribute("aria-controls", menu.id);
      expect(menu).toHaveAttribute("aria-labelledby", trigger.id);

      await userClick(user, trigger);

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger).not.toHaveAttribute("aria-controls");
    });
  },
);

describe("MoreMenu keyboard navigation", () => {
  test("opening focuses the first item and ArrowDown/ArrowUp move and wrap focus", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const { trigger } = renderMenu();

    await openMenu(trigger);

    const items: Array<HTMLElement> = screen.getAllByRole("menuitem");

    await waitFor(() => {
      expect(items[0]).toHaveFocus();
    });

    await userKeyboard(user, "{ArrowDown}");
    expect(items[1]).toHaveFocus();

    await userKeyboard(user, "{ArrowDown}");
    expect(items[2]).toHaveFocus();

    await userKeyboard(user, "{ArrowDown}");
    expect(items[0]).toHaveFocus();

    await userKeyboard(user, "{ArrowUp}");
    expect(items[2]).toHaveFocus();
  });

  test("Home and End jump to the first and last items", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const { trigger } = renderMenu();

    await openMenu(trigger);

    const items: Array<HTMLElement> = screen.getAllByRole("menuitem");

    await waitFor(() => {
      expect(items[0]).toHaveFocus();
    });

    await userKeyboard(user, "{End}");
    expect(items[2]).toHaveFocus();

    await userKeyboard(user, "{Home}");
    expect(items[0]).toHaveFocus();
  });

  test("section labels and dividers are skipped while nested actions receive roving focus", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const { trigger } = renderMenu("default", {}, true);

    await openMenu(trigger);

    const items: Array<HTMLElement> = screen.getAllByRole("menuitem");

    expect(items).toHaveLength(ACTION_LABELS.length);
    expect(
      items.map((item: HTMLElement) => {
        return item.textContent;
      }),
    ).toEqual(ACTION_LABELS);
    items.forEach((item: HTMLElement) => {
      expect(item.querySelector('[role="menuitem"]')).toBeNull();
    });
    expect(screen.getByText("STATE CHANGES")).not.toHaveAttribute(
      "role",
      "menuitem",
    );

    await waitFor(() => {
      expect(items[0]).toHaveFocus();
    });

    await userKeyboard(user, "{ArrowDown}");
    expect(items[1]).toHaveFocus();

    await userKeyboard(user, "{End}");
    expect(items[2]).toHaveFocus();

    await userKeyboard(user, "{ArrowDown}");
    expect(items[0]).toHaveFocus();
  });

  test("an established custom child button remains keyboard reachable and dismisses the menu", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const customAction: SelectionMock = jest.fn();

    render(
      <MoreMenu text="Custom children">
        {[
          <div key="custom-wrapper" className="px-2 py-1">
            <button type="button" onClick={customAction}>
              Custom child action
            </button>
          </div>,
        ]}
      </MoreMenu>,
    );

    const trigger: HTMLElement = screen.getByRole("button", {
      name: "Custom children",
    });
    await openMenu(trigger);

    const customItem: HTMLElement = await screen.findByRole("menuitem", {
      name: "Custom child action",
    });
    await waitFor(() => {
      expect(customItem).toHaveFocus();
    });

    await userKeyboard(user, "{Enter}");

    expect(customAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("navigation keys prevent their native scrolling behavior", async () => {
    const { trigger } = renderMenu();

    await openMenu(trigger);

    const items: Array<HTMLElement> = screen.getAllByRole("menuitem");

    await waitFor(() => {
      expect(items[0]).toHaveFocus();
    });

    expect(fireEvent.keyDown(items[0]!, { key: "ArrowDown" })).toBe(false);
    expect(items[1]).toHaveFocus();

    expect(fireEvent.keyDown(items[1]!, { key: "End" })).toBe(false);
    expect(items[2]).toHaveFocus();

    expect(fireEvent.keyDown(items[2]!, { key: "Home" })).toBe(false);
    expect(items[0]).toHaveFocus();
  });

  test("Escape closes the menu and restores focus to the trigger", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const { trigger } = renderMenu();

    await openMenu(trigger);
    await waitFor(() => {
      expect(screen.getAllByRole("menuitem")[0]).toHaveFocus();
    });

    await userKeyboard(user, "{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  test("Escape closes an empty loading menu and restores focus", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    render(
      <MoreMenu text="Loading actions">
        {[<div key="loader">Loading…</div>]}
      </MoreMenu>,
    );

    const trigger: HTMLElement = screen.getByRole("button", {
      name: "Loading actions",
    });

    await userClick(user, trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();

    await userKeyboard(user, "{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  test("items that replace an open loading state join roving focus immediately", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const firstAction: SelectionMock = jest.fn();
    const secondAction: SelectionMock = jest.fn();
    const { rerender } = render(
      <MoreMenu text="Async actions">
        {[<div key="loader">Loading…</div>]}
      </MoreMenu>,
    );

    const trigger: HTMLElement = screen.getByRole("button", {
      name: "Async actions",
    });
    await userClick(user, trigger);

    rerender(
      <MoreMenu text="Async actions">
        {[
          <MoreMenuItem
            key="first"
            text="First loaded action"
            onClick={firstAction}
          />,
          <MoreMenuItem
            key="second"
            text="Second loaded action"
            onClick={secondAction}
          />,
        ]}
      </MoreMenu>,
    );

    const loadedItems: Array<HTMLElement> =
      await screen.findAllByRole("menuitem");
    await waitFor(() => {
      expect(loadedItems[0]).toHaveFocus();
    });

    await userKeyboard(user, "{ArrowDown}{Enter}");

    expect(firstAction).not.toHaveBeenCalled();
    expect(secondAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test.each([
    { direction: "forward", shift: false },
    { direction: "backward", shift: true },
  ])(
    "Tab $direction dismisses the menu and follows the native focus order",
    async ({ shift }: { shift: boolean }) => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      const { trigger, outsideButton } = renderMenu();

      await openMenu(trigger);
      await waitFor(() => {
        expect(screen.getAllByRole("menuitem")[0]).toHaveFocus();
      });

      await userTab(user, shift);

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(shift ? trigger : outsideButton).toHaveFocus();
    },
  );

  test("disabled items are skipped by roving focus and cannot be activated", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const disabledAction: SelectionMock = jest.fn();
    const enabledAction: SelectionMock = jest.fn();

    render(
      <MoreMenu text="Mixed actions">
        {[
          <MoreMenuItem
            key="disabled"
            text="Disabled action"
            isDisabled={true}
            onClick={disabledAction}
          />,
          <MoreMenuItem
            key="enabled"
            text="Enabled action"
            onClick={enabledAction}
          />,
        ]}
      </MoreMenu>,
    );

    const trigger: HTMLElement = screen.getByRole("button", {
      name: "Mixed actions",
    });
    await openMenu(trigger);

    const disabledItem: HTMLElement = screen.getByRole("menuitem", {
      name: "Disabled action",
    });
    const enabledItem: HTMLElement = screen.getByRole("menuitem", {
      name: "Enabled action",
    });

    expect(disabledItem).toBeDisabled();
    expect(disabledItem).toHaveAttribute("tabindex", "-1");
    await waitFor(() => {
      expect(enabledItem).toHaveFocus();
    });

    fireEvent.click(disabledItem);
    expect(disabledAction).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(enabledItem).toHaveFocus();

    await userKeyboard(user, "{Enter}");
    expect(enabledAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("MoreMenu selection and dismissal", () => {
  test("clicking an item runs its action exactly once and closes the menu", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const { trigger, onSelect } = renderMenu();

    await openMenu(trigger);
    await userClick(user, screen.getByText("Second action"));

    expect(onSelect[0]).not.toHaveBeenCalled();
    expect(onSelect[1]).toHaveBeenCalledTimes(1);
    expect(onSelect[2]).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test.each([
    { key: "Enter", keySequence: "{Enter}", useSection: false },
    { key: "Space", keySequence: "[Space]", useSection: true },
  ])(
    "$key invokes the exact focused action once and closes the menu",
    async ({
      keySequence,
      useSection,
    }: {
      keySequence: string;
      useSection: boolean;
    }) => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      const { trigger, onSelect } = renderMenu("default", {}, useSection);

      await openMenu(trigger);
      await userKeyboard(user, "{ArrowDown}");
      expect(screen.getAllByRole("menuitem")[1]).toHaveFocus();

      await userKeyboard(user, keySequence);

      expect(onSelect[0]).not.toHaveBeenCalled();
      expect(onSelect[1]).toHaveBeenCalledTimes(1);
      expect(onSelect[2]).not.toHaveBeenCalled();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    },
  );

  test("an outside click closes the menu without selecting or stealing focus", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const { trigger, outsideButton, onSelect } = renderMenu();

    await openMenu(trigger);
    await userClick(user, outsideButton);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(outsideButton).toHaveFocus();
    onSelect.forEach((callback: SelectionMock) => {
      expect(callback).not.toHaveBeenCalled();
    });
  });
});

describe("MoreMenu disabled contract", () => {
  test("disabling an open menu closes it immediately", async () => {
    const action: SelectionMock = jest.fn();
    const children: Array<ReactElement> = [
      <MoreMenuItem key="action" text="Action" onClick={action} />,
    ];
    const { rerender } = render(
      <MoreMenu text="Dynamic actions">{children}</MoreMenu>,
    );

    const trigger: HTMLElement = screen.getByRole("button", {
      name: "Dynamic actions",
    });
    await openMenu(trigger);

    rerender(
      <MoreMenu text="Dynamic actions" isDisabled={true}>
        {children}
      </MoreMenu>,
    );

    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
    expect(trigger).toBeDisabled();
    expect(action).not.toHaveBeenCalled();
  });

  test("the disabled default trigger is a disabled native button and cannot open", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const { trigger } = renderMenu("default", { isDisabled: true });

    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("aria-disabled", "true");

    await userClick(user, trigger);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test.each([
    { label: "styled custom", variant: "custom" as TriggerVariant },
    {
      label: "existing native custom",
      variant: "custom-native" as TriggerVariant,
    },
  ])(
    "the disabled $label trigger ignores click, Enter, and Space",
    async ({ variant }: { variant: TriggerVariant }) => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      const { trigger } = renderMenu(variant, { isDisabled: true });

      expect(trigger).toBeDisabled();

      await userClick(user, trigger);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();

      trigger.focus();
      await userKeyboard(user, "{Enter}[Space]");

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    },
  );

  test("a disabled unstyled custom trigger is aria-disabled, leaves the tab order, and cannot open", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const { trigger } = renderMenu("custom-unstyled", { isDisabled: true });

    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).toHaveAttribute("tabindex", "-1");

    await userClick(user, trigger);
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: " " });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
