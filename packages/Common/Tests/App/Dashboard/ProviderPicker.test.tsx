import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import ProviderPicker from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ProviderPicker";
import { ChatProvider } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/useAiChat";
import { LAYERED_POPOVER_CLASS_NAME } from "../../../UI/Components/Tooltip/LayeredPopover";

/*
 * Ask AI's LLM provider picker. Drawn only when a project has more than one
 * provider to choose between (AskAiPanel); when it is, it is a menu a
 * keyboard and a screen reader can use, whose Escape closes the menu and
 * not the dialog around it, and which opens downwards from the composer at
 * the top of Ask AI's start.
 */

const PROVIDERS: Array<ChatProvider> = [
  {
    id: "provider-0",
    name: "OneUptime AI",
    description: null,
    llmType: null,
    modelName: null,
    isDefault: true,
    isGlobal: true,
  },
  {
    id: "provider-1",
    name: "Azure OpenAI",
    description: "gpt-5 in West Europe",
    llmType: "AzureOpenAI",
    modelName: "gpt-5",
    isDefault: false,
    isGlobal: false,
  },
];

function trigger(): HTMLElement {
  return screen.getByTitle("Choose LLM provider");
}

function renderPicker(
  props: Partial<React.ComponentProps<typeof ProviderPicker>> = {},
): { onSelect: MockFunction } {
  const onSelect: MockFunction = getJestMockFunction();

  render(
    <ProviderPicker
      providers={PROVIDERS}
      selectedProviderId="provider-0"
      onSelect={onSelect}
      {...props}
    />,
  );

  return { onSelect };
}

afterEach(() => {
  cleanup();
});

describe("ProviderPicker", () => {
  test("names the chosen provider, and says it opens a menu that is closed", () => {
    renderPicker();

    expect(trigger()).toHaveTextContent("OneUptime AI");
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).not.toHaveAttribute("aria-controls");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("opens a named menu of the providers, the chosen one checked", () => {
    renderPicker();

    fireEvent.click(trigger());

    const menu: HTMLElement = screen.getByRole("menu", {
      name: "LLM provider",
    });
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).toHaveAttribute("aria-controls", menu.id);
    const items: Array<HTMLElement> =
      within(menu).getAllByRole("menuitemradio");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    expect(items[1]).toHaveAttribute("aria-checked", "false");
    expect(items[1]).toHaveTextContent("gpt-5 in West Europe");
  });

  test("choosing one calls back, closes the menu and gives the focus back to the button", () => {
    const { onSelect } = renderPicker();

    fireEvent.click(trigger());
    fireEvent.click(
      within(screen.getByRole("menu")).getAllByRole("menuitemradio")[1]!,
    );

    expect(onSelect).toHaveBeenCalledWith("provider-1");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  test("Escape closes the menu only: the key is spent, and the focus goes back", () => {
    const { onSelect } = renderPicker();

    fireEvent.click(trigger());
    within(screen.getByRole("menu")).getAllByRole("menuitemradio")[0]!.focus();
    const event: KeyboardEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
  });

  test("a closed menu leaves Escape to the dialog", () => {
    renderPicker();

    const event: KeyboardEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  test("a press outside closes it", () => {
    renderPicker();

    fireEvent.click(trigger());
    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("draws its menu on the tooltip layer, never inside the box that holds the composer (#9910)", () => {
    render(
      <div data-testid="dialog" style={{ overflow: "hidden" }}>
        <ProviderPicker
          providers={PROVIDERS}
          selectedProviderId="provider-0"
          onSelect={getJestMockFunction()}
        />
      </div>,
    );

    fireEvent.click(trigger());

    const menu: HTMLElement = screen.getByRole("menu");

    expect(screen.getByTestId("dialog")).not.toContainElement(menu);
    expect(menu.closest(`.${LAYERED_POPOVER_CLASS_NAME}`)?.parentElement).toBe(
      document.body,
    );
    expect(menu).toHaveClass("w-72", "max-w-[calc(100vw-1rem)]");
    expect(menu).not.toHaveClass("absolute", "left-2", "bottom-full");
  });

  test("Tab on the button goes into the menu, and on from the button past its last", () => {
    renderPicker();

    fireEvent.click(trigger());
    act(() => {
      trigger().focus();
    });

    const items: Array<HTMLElement> = screen.getAllByRole("menuitemradio");

    expect(fireEvent.keyDown(trigger(), { key: "Tab" })).toBe(false);
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0]!, { key: "Tab" });
    expect(items[1]).toHaveFocus();
    expect(fireEvent.keyDown(items[1]!, { key: "Tab" })).toBe(true);
    expect(trigger()).toHaveFocus();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

/*
 * The menu is placed against the window, on the tooltip layer, which jsdom
 * does not lay out: these stub the window's height, where the button is and
 * how tall the menu is, and put the real ones back after each test.
 */
interface StubbedLayout {
  button: [number, number];
  windowHeight: number;
  menuHeight: number;
}

const restoreLayout: Array<() => void> = [];

function rectOf(top: number, bottom: number): DOMRect {
  return {
    top: top,
    bottom: bottom,
    left: 80,
    right: 280,
    width: 200,
    height: bottom - top,
    x: 80,
    y: top,
    toJSON: () => {
      return {};
    },
  };
}

function stubProperty(
  target: HTMLElement,
  property: string,
  getter: (this: HTMLElement) => number,
): void {
  const original: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(target, property);

  Object.defineProperty(target, property, { configurable: true, get: getter });

  restoreLayout.push(() => {
    if (original) {
      Object.defineProperty(target, property, original);
    } else {
      Reflect.deleteProperty(target, property);
    }
  });
}

function stubLayout(layout: StubbedLayout): void {
  const originalRect: () => DOMRect =
    HTMLElement.prototype.getBoundingClientRect;

  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ): DOMRect {
    if (this.getAttribute("aria-haspopup") === "menu") {
      return rectOf(layout.button[0], layout.button[1]);
    }

    return originalRect.call(this);
  };
  restoreLayout.push(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
  });

  stubProperty(document.documentElement, "clientHeight", () => {
    return layout.windowHeight;
  });
  stubProperty(document.documentElement, "clientWidth", () => {
    return 1280;
  });
  stubProperty(HTMLElement.prototype, "offsetHeight", function () {
    return this.getAttribute("role") === "menu" ? layout.menuHeight : 0;
  });
}

afterEach(() => {
  for (const restore of restoreLayout.splice(0).reverse()) {
    restore();
  }
});

function openedPlacement(): string | null {
  fireEvent.click(trigger());

  return (
    screen
      .getByRole("menu")
      .closest(`.${LAYERED_POPOVER_CLASS_NAME}`)
      ?.getAttribute("data-popper-placement") || null
  );
}

describe("ProviderPicker — where the menu opens", () => {
  test("opens upwards by default, from a composer at the foot of the dialog, from the button's start", () => {
    stubLayout({ button: [740, 766], windowHeight: 800, menuHeight: 190 });
    renderPicker();

    expect(openedPlacement()).toBe("top-start");
  });

  test("opens downwards from the composer at the top of Ask AI's start", () => {
    stubLayout({ button: [200, 226], windowHeight: 800, menuHeight: 190 });
    renderPicker({ menuSide: "bottom" });

    expect(openedPlacement()).toBe("bottom-start");
  });
});

describe("ProviderPicker — a menu that would not fit", () => {
  test("asked to open down where the window has no room, it opens up", () => {
    stubLayout({ button: [600, 626], windowHeight: 800, menuHeight: 190 });
    render(
      <div style={{ overflowY: "hidden" }}>
        <ProviderPicker
          providers={PROVIDERS}
          selectedProviderId="provider-0"
          onSelect={getJestMockFunction()}
          menuSide="bottom"
        />
      </div>,
    );

    expect(openedPlacement()).toBe("top-start");
  });

  test("with room below, it opens down as asked", () => {
    stubLayout({ button: [402, 428], windowHeight: 800, menuHeight: 190 });
    render(
      <div style={{ overflowY: "hidden" }}>
        <ProviderPicker
          providers={PROVIDERS}
          selectedProviderId="provider-0"
          onSelect={getJestMockFunction()}
          menuSide="bottom"
        />
      </div>,
    );

    expect(openedPlacement()).toBe("bottom-start");
  });
});
