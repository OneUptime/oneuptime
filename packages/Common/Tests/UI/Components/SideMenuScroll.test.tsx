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
  fitSideMenuCard,
  getFittedMenuHeight,
  getRevealScrollDelta,
  getVisibleRoom,
  revealCurrentSideMenuEntry,
  SIDE_MENU_BOTTOM_GAP_IN_PX,
  SIDE_MENU_MIN_HEIGHT_IN_PX,
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
 * The menu's card is as tall as the window under the header: sized for when
 * it sticks below the header. On a page not yet scrolled it starts under the
 * page's title and runs on below the window, so the room an entry is
 * brought into is the list's box cut to the window.
 */
/*
 * The card is capped in CSS to the window under the app's header: its
 * height once it sticks there. On a page not yet scrolled it starts lower,
 * under the trail and the title, and ran on below the window - the end of
 * its list out of reach of its own scroll. It is fitted to end above the
 * window's bottom edge wherever it is.
 */
describe("how tall the menu's card may be (getFittedMenuHeight)", () => {
  test("the window under the card's top, less the gap at the bottom", () => {
    expect(getFittedMenuHeight({ cardTop: 200, windowHeight: 900 })).toBe(
      900 - 200 - SIDE_MENU_BOTTOM_GAP_IN_PX,
    );
  });

  test("grows as the page scrolls the card up, to its height once it sticks", () => {
    const unscrolled: number = getFittedMenuHeight({
      cardTop: 220,
      windowHeight: 800,
    });
    const stuck: number = getFittedMenuHeight({
      cardTop: 88,
      windowHeight: 800,
    });

    expect(stuck).toBeGreaterThan(unscrolled);
    expect(stuck).toBe(800 - 88 - SIDE_MENU_BOTTOM_GAP_IN_PX);
  });

  test("a card scrolled past the window's top is measured from the top", () => {
    expect(getFittedMenuHeight({ cardTop: -50, windowHeight: 700 })).toBe(
      700 - SIDE_MENU_BOTTOM_GAP_IN_PX,
    );
  });

  test("is never squeezed below the least height: it runs on below the window instead", () => {
    expect(getFittedMenuHeight({ cardTop: 500, windowHeight: 560 })).toBe(
      SIDE_MENU_MIN_HEIGHT_IN_PX,
    );
  });
});

describe("fitting the card (fitSideMenuCard)", () => {
  test("sets the card's max height in pixels from where it is", () => {
    const card: HTMLDivElement = document.createElement("div");
    card.style.maxHeight = "calc(100vh - 3rem)";
    card.getBoundingClientRect = (): DOMRect => {
      return { top: 200 } as DOMRect;
    };

    fitSideMenuCard(card);

    expect(card.style.maxHeight).toBe(
      `${window.innerHeight - 200 - SIDE_MENU_BOTTOM_GAP_IN_PX}px`,
    );
  });

  test("does nothing without a card", () => {
    expect(() => {
      fitSideMenuCard(null);
    }).not.toThrow();
  });
});

describe("the room the entry is brought into (getVisibleRoom)", () => {
  test("is the list's box when the whole list is in the window", () => {
    expect(
      getVisibleRoom({ list: { top: 120, bottom: 600 }, windowHeight: 900 }),
    ).toEqual({ top: 120, bottom: 600 });
  });

  test("ends at the window's bottom when the list runs on below it", () => {
    expect(
      getVisibleRoom({ list: { top: 200, bottom: 752 }, windowHeight: 560 }),
    ).toEqual({ top: 200, bottom: 560 });
  });

  test("starts at the window's top when the list starts above it", () => {
    expect(
      getVisibleRoom({ list: { top: -80, bottom: 400 }, windowHeight: 560 }),
    ).toEqual({ top: 0, bottom: 400 });
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

  /*
   * A page not yet scrolled: the list (100 to 500) runs on below a window
   * 400 pixels tall, so the entry is brought above the window's bottom, not
   * only above the list's.
   */
  test("brings the entry into the part of the list the window shows", () => {
    const ownHeight: number = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 400,
    });

    try {
      layOut({ list, entry, entryTopInList: 900, scrollHeight: 2000 });

      revealCurrentSideMenuEntry(list);

      const box: DOMRect = entry.getBoundingClientRect();
      expect(box.bottom).toBeLessThanOrEqual(400 - MARGIN);
      expect(list.scrollTop).toBe(900 + 32 - (300 - MARGIN));
    } finally {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        writable: true,
        value: ownHeight,
      });
    }
  });

  test("never scrolls past the end of the list", () => {
    // The entry is the list's last: the list scrolls as far as it goes.
    layOut({ list, entry, entryTopInList: 990, scrollHeight: 1000 });

    revealCurrentSideMenuEntry(list);

    expect(list.scrollTop).toBe(1000 - 400);
  });

  test("does nothing when none of the list is in the window", () => {
    const ownHeight: number = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 80,
    });

    try {
      layOut({ list, entry, entryTopInList: 900 });
      revealCurrentSideMenuEntry(list);
      expect(list.scrollTop).toBe(0);
    } finally {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        writable: true,
        value: ownHeight,
      });
    }
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
    const scrollTo: SpyInstance<(x: number, y: number) => void> = jest
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

  /*
   * The card ends above the window's bottom edge wherever it is: under the
   * page's title on a page not yet scrolled, below the header once the
   * page scrolls it there.
   */
  test("its card is fitted to the window on a desktop, and refitted as the page scrolls", async () => {
    let cardTop: number = 200;
    jest
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation((): DOMRect => {
        return { top: cardTop, bottom: cardTop + 300 } as DOMRect;
      });
    goTo("/k/1/topology");

    await act(async () => {
      render(clusterMenu());
    });

    const card: HTMLElement = document.querySelector(
      "aside[role='navigation'] div.sticky > div",
    ) as HTMLElement;

    expect(card).not.toBeNull();

    expect(card.style.maxHeight).toBe(
      `${window.innerHeight - 200 - SIDE_MENU_BOTTOM_GAP_IN_PX}px`,
    );

    // The page scrolls; the card sticks 88px from the top.
    cardTop = 88;
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });

    await waitFor(() => {
      expect(card.style.maxHeight).toBe(
        `${window.innerHeight - 88 - SIDE_MENU_BOTTOM_GAP_IN_PX}px`,
      );
    });
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
