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

/*
 * Ask AI's LLM provider picker. Drawn only when a project has more than one
 * provider to choose between (AskAiDialog); when it is, it is a menu a
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
  return screen.getByTitle("Choose AI provider");
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

    const menu: HTMLElement = screen.getByRole("menu", { name: "AI provider" });
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

  test("opens upwards by default, from a composer at the foot of the dialog", () => {
    renderPicker();

    fireEvent.click(trigger());

    expect(screen.getByRole("menu")).toHaveClass("bottom-full", "mb-1.5");
  });

  test("opens downwards from the composer at the top of Ask AI's start", () => {
    renderPicker({ menuSide: "bottom" });

    fireEvent.click(trigger());

    const menu: HTMLElement = screen.getByRole("menu");
    expect(menu).toHaveClass("top-full", "mt-1.5");
    expect(menu).not.toHaveClass("bottom-full");
  });
});

/*
 * The menu's side is measured, which jsdom does not do: these stub where
 * the button is, how tall the menu is and the box that clips them both
 * (Ask AI's dialog), and put the real methods back after each test.
 */
interface StubbedLayout {
  button: [number, number];
  boundary: [number, number];
  menuHeight: number;
}

const restoreLayout: Array<() => void> = [];

function rectOf(top: number, bottom: number): DOMRect {
  return {
    top: top,
    bottom: bottom,
    left: 0,
    right: 200,
    width: 200,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => {
      return {};
    },
  };
}

function stubLayout(layout: StubbedLayout): void {
  const originalRect: () => DOMRect =
    HTMLElement.prototype.getBoundingClientRect;
  const originalOffsetHeight: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ): DOMRect {
    if (this.getAttribute("aria-haspopup") === "menu") {
      return rectOf(layout.button[0], layout.button[1]);
    }

    if (this.hasAttribute("data-boundary")) {
      return rectOf(layout.boundary[0], layout.boundary[1]);
    }

    return originalRect.call(this);
  };

  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement): number {
      return this.getAttribute("role") === "menu" ? layout.menuHeight : 0;
    },
  });

  restoreLayout.push(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;

    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetHeight",
        originalOffsetHeight,
      );
    }
  });
}

afterEach(() => {
  for (const restore of restoreLayout.splice(0)) {
    restore();
  }
});

describe("ProviderPicker — a menu that would not fit", () => {
  test("asked to open down where the dialog would cut it off, it opens up", () => {
    stubLayout({ button: [600, 626], boundary: [24, 776], menuHeight: 190 });
    render(
      <div data-boundary="" style={{ overflowY: "hidden" }}>
        <ProviderPicker
          providers={PROVIDERS}
          selectedProviderId="provider-0"
          onSelect={getJestMockFunction()}
          menuSide="bottom"
        />
      </div>,
    );

    fireEvent.click(trigger());

    const menu: HTMLElement = screen.getByRole("menu");
    expect(menu).toHaveAttribute("data-menu-side", "top");
    expect(menu).toHaveClass("bottom-full", "mb-1.5");
  });

  test("with room below, it opens down as asked", () => {
    stubLayout({ button: [402, 428], boundary: [24, 776], menuHeight: 190 });
    render(
      <div data-boundary="" style={{ overflowY: "hidden" }}>
        <ProviderPicker
          providers={PROVIDERS}
          selectedProviderId="provider-0"
          onSelect={getJestMockFunction()}
          menuSide="bottom"
        />
      </div>,
    );

    fireEvent.click(trigger());

    expect(screen.getByRole("menu")).toHaveAttribute(
      "data-menu-side",
      "bottom",
    );
  });
});
