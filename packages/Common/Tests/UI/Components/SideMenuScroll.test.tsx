import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import type { Mock, SpyInstance } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import { Location } from "react-router-dom";
import Route from "../../../Types/API/Route";
import SideMenu from "../../../UI/Components/SideMenu/SideMenu";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "../../../UI/Components/SideMenu/SideMenuSection";
import {
  getRevealScrollDelta,
  revealCurrentSideMenuEntry,
  SIDE_MENU_REVEAL_MARGIN_IN_PX,
} from "../../../UI/Components/SideMenu/SideMenuScroll";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * A side menu is never taller than the window: past that it scrolls inside
 * itself. On a window under about 1,000 pixels tall a long menu - a
 * Kubernetes cluster's, Security Events' settings - opened with the entry
 * for the page below its fold, so it showed no sign of where the reader
 * was (#5250's line). The menu now scrolls its lit entry into sight when a
 * page opens, and the phone's menu does when it is opened. Only the menu's
 * own list moves: never the page.
 *
 * jsdom lays nothing out, so the arithmetic is tested on its own, and the
 * DOM step with the boxes a browser would measure stubbed in. The browser
 * suite (KubernetesEvents/SideMenuNavigation.spec.ts) measures it for real.
 */

const MARGIN: number = SIDE_MENU_REVEAL_MARGIN_IN_PX;

describe("how far the menu scrolls (getRevealScrollDelta)", () => {
  const LIST: { top: number; bottom: number } = { top: 100, bottom: 500 };

  test("an entry in sight, with room to spare, moves nothing", () => {
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: 200, bottom: 232 },
        margin: MARGIN,
      }),
    ).toBe(0);
  });

  test("an entry exactly at either edge of the room moves nothing", () => {
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: 100 + MARGIN, bottom: 132 + MARGIN },
        margin: MARGIN,
      }),
    ).toBe(0);
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: 468 - MARGIN, bottom: 500 - MARGIN },
        margin: MARGIN,
      }),
    ).toBe(0);
  });

  test("an entry below the fold scrolls down just far enough", () => {
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: 900, bottom: 932 },
        margin: MARGIN,
      }),
    ).toBe(932 - (500 - MARGIN));
  });

  test("an entry cut by the bottom edge scrolls the rest into sight", () => {
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: 480, bottom: 512 },
        margin: MARGIN,
      }),
    ).toBe(512 - (500 - MARGIN));
  });

  test("an entry above the top scrolls up just far enough", () => {
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: -300, bottom: -268 },
        margin: MARGIN,
      }),
    ).toBe(-300 - (100 + MARGIN));
  });

  test("an entry taller than the room shows its top", () => {
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: 700, bottom: 1400 },
        margin: MARGIN,
      }),
    ).toBe(700 - (100 + MARGIN));
  });
});

/*
 * The boxes a browser would give: the list, 400px tall, holding 1,000px of
 * entries; the entry wherever the list's scroll leaves it.
 */
function layOut(data: {
  list: HTMLElement;
  entry: HTMLElement | null;
  entryTopInList: number;
  scrollHeight?: number;
}): void {
  Object.defineProperty(data.list, "scrollHeight", {
    configurable: true,
    value: data.scrollHeight ?? 1000,
  });
  Object.defineProperty(data.list, "clientHeight", {
    configurable: true,
    value: 400,
  });
  data.list.getBoundingClientRect = (): DOMRect => {
    return { top: 100, bottom: 500 } as DOMRect;
  };

  if (data.entry) {
    data.entry.getBoundingClientRect = (): DOMRect => {
      const top: number = 100 + data.entryTopInList - data.list.scrollTop;
      return { top, bottom: top + 32 } as DOMRect;
    };
  }
}

describe("scrolling the menu's own list (revealCurrentSideMenuEntry)", () => {
  let list: HTMLElement;
  let entry: HTMLElement;

  beforeEach(() => {
    list = document.createElement("nav");
    entry = document.createElement("a");
    entry.setAttribute("aria-current", "page");
    list.appendChild(document.createElement("a"));
    list.appendChild(entry);
    document.body.appendChild(list);
  });

  afterEach(() => {
    list.remove();
    jest.restoreAllMocks();
  });

  test("brings an entry below the fold into sight", () => {
    layOut({ list, entry, entryTopInList: 900 });

    revealCurrentSideMenuEntry(list);

    expect(list.scrollTop).toBe(900 + 32 - (400 - MARGIN));
    // In sight now.
    const box: DOMRect = entry.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(100 + MARGIN);
    expect(box.bottom).toBeLessThanOrEqual(500 - MARGIN);
  });

  test("brings an entry scrolled above the top back into sight", () => {
    list.scrollTop = 600;
    layOut({ list, entry, entryTopInList: 100 });

    revealCurrentSideMenuEntry(list);

    expect(list.scrollTop).toBe(100 - MARGIN);
  });

  test("leaves the list where it is when the entry is in sight", () => {
    list.scrollTop = 40;
    layOut({ list, entry, entryTopInList: 200 });

    revealCurrentSideMenuEntry(list);

    expect(list.scrollTop).toBe(40);
  });

  test("does nothing when the list does not scroll, or holds no lit entry", () => {
    layOut({ list, entry, entryTopInList: 900, scrollHeight: 400 });
    revealCurrentSideMenuEntry(list);
    expect(list.scrollTop).toBe(0);

    entry.removeAttribute("aria-current");
    layOut({ list, entry, entryTopInList: 900 });
    revealCurrentSideMenuEntry(list);
    expect(list.scrollTop).toBe(0);

    expect(() => {
      revealCurrentSideMenuEntry(null);
    }).not.toThrow();
  });

  /*
   * Element.scrollIntoView scrolls every box around the entry, the page's
   * too: it would pull the page down to the menu on every navigation.
   */
  test("never scrolls the page, only the list", () => {
    const scrollIntoView: Mock<
      (arg?: boolean | ScrollIntoViewOptions) => void
    > = jest.fn();
    const ownScrollIntoView: typeof Element.prototype.scrollIntoView =
      Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    const scrollTo: SpyInstance = jest
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});
    layOut({ list, entry, entryTopInList: 900 });

    try {
      revealCurrentSideMenuEntry(list);

      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(scrollTo).not.toHaveBeenCalled();
      expect(list.scrollTop).toBeGreaterThan(0);
    } finally {
      Element.prototype.scrollIntoView = ownScrollIntoView;
    }
  });
});

function goTo(path: string): void {
  window.history.pushState({}, "", path);
  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
}

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

// A long cluster menu: the autoscalers are last, in a section that folds.
function clusterMenu(): ReactElement {
  const rows: Array<[string, string]> = [
    ["Overview", "/k/1"],
    ["Topology", "/k/1/topology"],
    ["Pods", "/k/1/pods"],
    ["Nodes", "/k/1/nodes"],
  ];

  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        {rows.map(([title, path]: [string, string]) => {
          return (
            <SideMenuItem key={path} link={{ title, to: new Route(path) }} />
          );
        })}
      </SideMenuSection>
      <SideMenuSection title="Scaling" defaultCollapsed={true}>
        <SideMenuItem link={{ title: "HPAs", to: new Route("/k/1/hpas") }} />
        <SideMenuItem link={{ title: "VPAs", to: new Route("/k/1/vpas") }} />
      </SideMenuSection>
    </SideMenu>
  );
}

/*
 * Every <nav> drawn gets a browser's boxes: 400px of room for 1,000px of
 * entries, the lit one 900px down.
 */
function layOutEveryList(): void {
  jest
    .spyOn(HTMLElement.prototype, "scrollHeight", "get")
    .mockImplementation(function (this: HTMLElement): number {
      return this.tagName === "NAV" ? 1000 : 0;
    });
  jest
    .spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockImplementation(function (this: HTMLElement): number {
      return this.tagName === "NAV" ? 400 : 0;
    });
  jest
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element): DOMRect {
      if (this.tagName === "NAV") {
        return { top: 100, bottom: 500 } as DOMRect;
      }

      const list: Element | null = this.closest("nav");
      const top: number =
        100 + 900 - ((list as HTMLElement | null)?.scrollTop ?? 0);
      return { top, bottom: top + 32 } as DOMRect;
    });
}

describe("the side menu scrolls its lit entry into sight", () => {
  beforeEach(() => {
    setViewportWidth(1280);
    layOutEveryList();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("when a page opens, on a desktop", async () => {
    goTo("/k/1/vpas");

    await act(async () => {
      render(clusterMenu());
    });

    const list: HTMLElement = screen
      .getByRole("link", { name: "VPAs" })
      .closest("nav") as HTMLElement;

    await waitFor(() => {
      expect(list.scrollTop).toBe(900 + 32 - (400 - MARGIN));
    });
    // The folded section holding the page opened by itself.
    expect(screen.getByRole("button", { name: "Scaling" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  test("on a page whose entry is in sight, the list stays where it is", async () => {
    jest
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element): DOMRect {
        return this.tagName === "NAV"
          ? ({ top: 100, bottom: 500 } as DOMRect)
          : ({ top: 140, bottom: 172 } as DOMRect);
      });
    goTo("/k/1/topology");

    await act(async () => {
      render(clusterMenu());
    });

    const list: HTMLElement = screen
      .getByRole("link", { name: "Topology" })
      .closest("nav") as HTMLElement;

    // Two frames pass, and nothing moves.
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 80);
      });
    });
    expect(list.scrollTop).toBe(0);
  });

  test("on a phone, when its menu is opened", async () => {
    setViewportWidth(375);
    goTo("/k/1/vpas");

    await act(async () => {
      render(clusterMenu());
    });

    fireEvent.click(screen.getByTestId("mobile-sidemenu-toggle"));

    const list: HTMLElement = screen
      .getByRole("link", { name: "VPAs" })
      .closest("nav") as HTMLElement;

    await waitFor(() => {
      expect(list.scrollTop).toBe(900 + 32 - (400 - MARGIN));
    });
  });
});
