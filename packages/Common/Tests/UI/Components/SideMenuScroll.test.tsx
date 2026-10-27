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
  getSideMenuFadeClassName,
  getSideMenuHiddenEdges,
  getVisibleRoom,
  NO_HIDDEN_EDGES,
  revealCurrentSideMenuEntry,
  SIDE_MENU_BOTTOM_GAP_IN_PX,
  SIDE_MENU_FADE_CLASS_NAMES,
  SIDE_MENU_FADE_IN_PX,
  SIDE_MENU_MIN_HEIGHT_IN_PX,
  SIDE_MENU_REVEAL_PEEK_IN_PX,
  SIDE_MENU_SCROLL_PADDING_CLASS_NAME,
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
 * suites (RulesMenuSection/SideMenuNavigation.spec.ts, KubernetesEvents)
 * measure it for real.
 */

// A colour class, which the dark theme would have to remap.
const FADE_COLOUR_CLASS: RegExp =
  /(?:^|\s)(?:bg|from|via|to)-(?:white|gray|slate)/;

const FADE: number = SIDE_MENU_FADE_IN_PX;
const PEEK: number = SIDE_MENU_REVEAL_PEEK_IN_PX;

/*
 * Brought in flush against the list's edge, the lit entry read as the
 * menu's last: a node's page showed Nodes at the foot of the menu, nothing
 * past it in view and nothing to say the list went on. It now comes in
 * with the next entry peeking past it (3rem: the edge's fade and the start
 * of the next row), as a telemetry tab bar's lit tab does (TabBarScroll);
 * an entry clear of the fades stays where it is.
 */
describe("how far the menu scrolls (getRevealScrollDelta)", () => {
  const LIST: { top: number; bottom: number } = { top: 100, bottom: 500 };

  test("the peek is the fade and the start of the next row", () => {
    expect(FADE).toBe(24);
    expect(PEEK).toBe(48);
    expect(PEEK).toBeGreaterThan(FADE);
  });

  test("an entry clear of both fades moves nothing", () => {
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: 200, bottom: 232 },
      }),
    ).toBe(0);
  });

  /*
   * A click on an entry in sight never moves the list under the pointer:
   * clear of the fades, an entry stays put however near the edge it is.
   */
  test("an entry exactly clear of either fade moves nothing", () => {
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: 100 + FADE, bottom: 132 + FADE },
      }),
    ).toBe(0);
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: 468 - FADE, bottom: 500 - FADE },
      }),
    ).toBe(0);
  });

  test("an entry below the fold comes in with the next one peeking past it", () => {
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: 900, bottom: 932 },
      }),
    ).toBe(932 - (500 - PEEK));
  });

  test("an entry under the bottom edge's fade moves up to leave the peek", () => {
    // 16 pixels of it under the fade, none of it out of the list.
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: 460, bottom: 492 },
      }),
    ).toBe(492 - (500 - PEEK));
  });

  test("an entry cut by the bottom edge scrolls the rest into sight, and the peek", () => {
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: 480, bottom: 512 },
      }),
    ).toBe(512 - (500 - PEEK));
  });

  test("an entry above the top comes in with the one before it peeking", () => {
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: -300, bottom: -268 },
      }),
    ).toBe(-300 - (100 + PEEK));
  });

  test("an entry under the top edge's fade moves down to leave the peek", () => {
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: 110, bottom: 142 },
      }),
    ).toBe(110 - (100 + PEEK));
  });

  test("a room too small for the peek keeps half of what is left on either side", () => {
    // 80 pixels of room for a 32 pixel entry: 24 on each side.
    const delta: number = getRevealScrollDelta({
      list: { top: 100, bottom: 180 },
      entry: { top: 300, bottom: 332 },
    });

    expect(delta).toBe(332 - (180 - 24));
    expect(300 - delta - 100).toBe(180 - (332 - delta));
  });

  test("an entry taller than the room shows its top", () => {
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: 700, bottom: 1400 },
      }),
    ).toBe(700 - 100);
  });

  test("moves nothing for boxes it cannot read: no room, no entry, or not numbers", () => {
    expect(
      getRevealScrollDelta({
        list: { top: 100, bottom: 100 },
        entry: { top: 900, bottom: 932 },
      }),
    ).toBe(0);
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: 900, bottom: 900 },
      }),
    ).toBe(0);
    expect(
      getRevealScrollDelta({
        list: LIST,
        entry: { top: Number.NaN, bottom: 932 },
      }),
    ).toBe(0);
  });
});

/*
 * An edge of the list with entries behind it fades out, so a reader sees
 * the list goes on: its scrollbar shows only while it scrolls on many
 * screens, and a list the menu scrolled for them hid its first entries
 * with no sign of them.
 */
describe("which edges hide entries (getSideMenuHiddenEdges)", () => {
  test("a list that holds all its entries hides none", () => {
    expect(
      getSideMenuHiddenEdges({
        scrollTop: 0,
        scrollHeight: 400,
        clientHeight: 400,
      }),
    ).toEqual(NO_HIDDEN_EDGES);
    // A pixel of rounding is not an entry.
    expect(
      getSideMenuHiddenEdges({
        scrollTop: 0,
        scrollHeight: 401,
        clientHeight: 400,
      }),
    ).toEqual(NO_HIDDEN_EDGES);
  });

  test("at its top, a long list hides entries below only", () => {
    expect(
      getSideMenuHiddenEdges({
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toEqual({ top: false, bottom: true });
  });

  test("scrolled part way, it hides entries on both sides", () => {
    expect(
      getSideMenuHiddenEdges({
        scrollTop: 300,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toEqual({ top: true, bottom: true });
  });

  test("scrolled to its end, it hides entries above only", () => {
    expect(
      getSideMenuHiddenEdges({
        scrollTop: 600,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toEqual({ top: true, bottom: false });
  });

  test("a touch screen's bounce past either end reads as that end", () => {
    expect(
      getSideMenuHiddenEdges({
        scrollTop: -40,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toEqual({ top: false, bottom: true });
    expect(
      getSideMenuHiddenEdges({
        scrollTop: 640,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toEqual({ top: true, bottom: false });
  });

  test("hides nothing it cannot measure", () => {
    expect(
      getSideMenuHiddenEdges({
        scrollTop: Number.NaN,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toEqual(NO_HIDDEN_EDGES);
  });
});

describe("the fade at a hidden edge (getSideMenuFadeClassName)", () => {
  test("each hidden edge, and only a hidden edge, fades", () => {
    expect(getSideMenuFadeClassName({ top: true, bottom: true })).toBe(
      SIDE_MENU_FADE_CLASS_NAMES.both,
    );
    expect(getSideMenuFadeClassName({ top: true, bottom: false })).toBe(
      SIDE_MENU_FADE_CLASS_NAMES.top,
    );
    expect(getSideMenuFadeClassName({ top: false, bottom: true })).toBe(
      SIDE_MENU_FADE_CLASS_NAMES.bottom,
    );
    expect(getSideMenuFadeClassName(NO_HIDDEN_EDGES)).toBe("");
  });

  /*
   * A mask, not a coloured overlay: it fades the entries into whatever the
   * card is, light or dark, with no colour for the dark theme to remap.
   */
  test("is a colour-free mask over the fade's 1.5rem, for every browser", () => {
    for (const className of Object.values(SIDE_MENU_FADE_CLASS_NAMES)) {
      expect(className).toContain("[mask-image:linear-gradient(");
      expect(className).toContain("[-webkit-mask-image:linear-gradient(");
      expect(className).toContain("transparent,black_1.5rem");
      expect(className).not.toMatch(FADE_COLOUR_CLASS);
    }

    expect(SIDE_MENU_FADE_CLASS_NAMES.top).toContain("to_bottom");
    expect(SIDE_MENU_FADE_CLASS_NAMES.bottom).toContain("to_top");
    expect(SIDE_MENU_FADE_CLASS_NAMES.both).toContain(
      "black_calc(100%-1.5rem),transparent",
    );
    // The fade is the 1.5rem the reveal keeps clear of.
    expect(FADE).toBe(1.5 * 16);
  });

  test("keeps the keyboard's focus clear of the fades, as the reveal does", () => {
    // scroll-py-12: 3rem of scroll padding, the reveal's peek.
    expect(SIDE_MENU_SCROLL_PADDING_CLASS_NAME).toBe("scroll-py-12");
    expect(PEEK).toBe(3 * 16);
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

  test("brings an entry below the fold into sight, the next one peeking past it", () => {
    layOut({ list, entry, entryTopInList: 900 });

    revealCurrentSideMenuEntry(list);

    expect(list.scrollTop).toBe(900 + 32 - (400 - PEEK));
    // In sight now, clear of the fade, with a row's room past it.
    const box: DOMRect = entry.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(100 + FADE);
    expect(box.bottom).toBe(500 - PEEK);
  });

  test("brings an entry scrolled above the top back into sight, the one before it peeking", () => {
    list.scrollTop = 600;
    layOut({ list, entry, entryTopInList: 100 });

    revealCurrentSideMenuEntry(list);

    expect(list.scrollTop).toBe(100 - PEEK);
    expect(entry.getBoundingClientRect().top).toBe(100 + PEEK);
  });

  test("moves an entry under the fade, though in the list, to leave the peek", () => {
    layOut({ list, entry, entryTopInList: 360 });

    revealCurrentSideMenuEntry(list);

    // Its foot was at 492, under the bottom fade (476 to 500).
    expect(list.scrollTop).toBe(492 - (500 - PEEK));
  });

  test("never scrolls above the top of the list for an entry near its start", () => {
    // The second entry, under where the top fade would be: nothing above.
    layOut({ list, entry, entryTopInList: 10 });

    revealCurrentSideMenuEntry(list);

    expect(list.scrollTop).toBe(0);
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
      expect(box.bottom).toBeLessThanOrEqual(400 - PEEK);
      expect(list.scrollTop).toBe(900 + 32 - (300 - PEEK));
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
      expect(list.scrollTop).toBe(900 + 32 - (400 - PEEK));
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

  /*
   * A banner or a title that arrives above the menu after it was fitted
   * moves its card down, and the page grows: the card is fitted again
   * then, not only when the page is scrolled or the window resized.
   */
  test("its card is fitted again when the page changes size, as a banner arriving above it makes it", async () => {
    const observers: Array<{ notify: () => void; targets: Array<Element> }> =
      [];

    class RecordingResizeObserver {
      private readonly record: {
        notify: () => void;
        targets: Array<Element>;
      };

      public constructor(callback: () => void) {
        this.record = { notify: callback, targets: [] };
        observers.push(this.record);
      }

      public observe(target: Element): void {
        this.record.targets.push(target);
      }

      public unobserve(): void {}

      public disconnect(): void {
        this.record.targets = [];
      }
    }

    const globals: { ResizeObserver?: unknown } = window as unknown as {
      ResizeObserver?: unknown;
    };
    const ownResizeObserver: unknown = globals.ResizeObserver;
    globals.ResizeObserver = RecordingResizeObserver;

    try {
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

      expect(card.style.maxHeight).toBe(
        `${window.innerHeight - 200 - SIDE_MENU_BOTTOM_GAP_IN_PX}px`,
      );

      const pageWatch:
        | { notify: () => void; targets: Array<Element> }
        | undefined = observers.find(
        (observer: { targets: Array<Element> }): boolean => {
          return observer.targets.includes(document.body);
        },
      );

      expect(pageWatch).toBeDefined();

      // A banner 120px tall arrives above the page.
      cardTop = 320;
      await act(async () => {
        pageWatch!.notify();
      });

      await waitFor(() => {
        expect(card.style.maxHeight).toBe(
          `${window.innerHeight - 320 - SIDE_MENU_BOTTOM_GAP_IN_PX}px`,
        );
      });
    } finally {
      if (ownResizeObserver === undefined) {
        delete globals.ResizeObserver;
      } else {
        globals.ResizeObserver = ownResizeObserver;
      }
    }
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
      expect(list.scrollTop).toBe(900 + 32 - (400 - PEEK));
    });
  });

  /*
   * The list says which of its edges hide entries (data-hidden-top and
   * -bottom) and fades out there, read again as it scrolls: brought down
   * to the autoscalers, it hides entries both above and below; at its end,
   * above only; back at its start, below only.
   */
  test("on a desktop, the list fades out at each edge that hides entries, as it scrolls", async () => {
    goTo("/k/1/vpas");

    await act(async () => {
      render(clusterMenu());
    });

    const list: HTMLElement = screen
      .getByRole("link", { name: "VPAs" })
      .closest("nav") as HTMLElement;

    expect(list).toHaveClass(SIDE_MENU_SCROLL_PADDING_CLASS_NAME);

    await waitFor(() => {
      expect(list.scrollTop).toBe(900 + 32 - (400 - PEEK));
      expect(list).toHaveAttribute("data-hidden-top", "true");
    });
    expect(list).toHaveAttribute("data-hidden-bottom", "true");
    expect(list.className).toContain(SIDE_MENU_FADE_CLASS_NAMES.both);

    await act(async () => {
      list.scrollTop = 600;
      fireEvent.scroll(list);
    });
    expect(list).toHaveAttribute("data-hidden-top", "true");
    expect(list).toHaveAttribute("data-hidden-bottom", "false");
    expect(list.className).toContain(SIDE_MENU_FADE_CLASS_NAMES.top);
    expect(list.className).not.toContain(SIDE_MENU_FADE_CLASS_NAMES.both);

    await act(async () => {
      list.scrollTop = 0;
      fireEvent.scroll(list);
    });
    expect(list).toHaveAttribute("data-hidden-top", "false");
    expect(list).toHaveAttribute("data-hidden-bottom", "true");
    expect(list.className).toContain(SIDE_MENU_FADE_CLASS_NAMES.bottom);
  });

  test("a list that holds all its entries does not fade", async () => {
    jest
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation((): number => {
        return 400;
      });
    goTo("/k/1/topology");

    await act(async () => {
      render(clusterMenu());
    });

    const list: HTMLElement = screen
      .getByRole("link", { name: "Topology" })
      .closest("nav") as HTMLElement;

    expect(list).toHaveAttribute("data-hidden-top", "false");
    expect(list).toHaveAttribute("data-hidden-bottom", "false");
    for (const className of Object.values(SIDE_MENU_FADE_CLASS_NAMES)) {
      expect(list.className).not.toContain(className);
    }
  });

  test("on a phone, the open menu's list fades out at the edges that hide entries", async () => {
    setViewportWidth(375);
    goTo("/k/1/vpas");

    await act(async () => {
      render(clusterMenu());
    });

    fireEvent.click(screen.getByTestId("mobile-sidemenu-toggle"));

    const list: HTMLElement = screen
      .getByRole("link", { name: "VPAs" })
      .closest("nav") as HTMLElement;

    expect(list).toHaveClass(SIDE_MENU_SCROLL_PADDING_CLASS_NAME);
    await waitFor(() => {
      expect(list).toHaveAttribute("data-hidden-top", "true");
    });
    expect(list).toHaveAttribute("data-hidden-bottom", "true");
    expect(list.className).toContain(SIDE_MENU_FADE_CLASS_NAMES.both);
  });
});
