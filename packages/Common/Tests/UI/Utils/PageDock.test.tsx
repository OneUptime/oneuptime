import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  clearPageDock,
  movePageDock,
  PAGE_DOCK_END_CLASS_NAME,
  PAGE_DOCK_WIDTH_VARIABLE,
  setPageDockWidth,
  usePageDock,
} from "../../../UI/Utils/PageDock";

/*
 * A surface docked at the end of the window takes its width from the page
 * rather than covering it (issue #5597: Ask AI beside the page, with nothing
 * hidden behind it). The page is told in two ways: by a variable the page's
 * <html> pads itself with, and that a surface pinned to the window's end stops
 * at, and by a resize event for what only measures itself on one.
 */

function dockWidth(): string {
  return document.documentElement.style.getPropertyValue(
    PAGE_DOCK_WIDTH_VARIABLE,
  );
}

function pagePadding(): string {
  return document.documentElement.style.getPropertyValue("padding-inline-end");
}

interface Dock {
  width: number | null;
}

function Docked(props: Dock): ReactElement {
  usePageDock(props.width);
  return <p>Docked</p>;
}

let resizes: number = 0;
const countResize: () => void = (): void => {
  resizes++;
};

beforeEach(() => {
  clearPageDock();
  resizes = 0;
  window.addEventListener("resize", countResize);
});

afterEach(() => {
  cleanup();
  clearPageDock();
  window.removeEventListener("resize", countResize);
});

describe("setPageDockWidth", () => {
  test("the page leaves the width free at its end", () => {
    setPageDockWidth(440);

    expect(dockWidth()).toBe("440px");
    expect(pagePadding()).toBe(`var(${PAGE_DOCK_WIDTH_VARIABLE})`);
  });

  test("on <html>, never on the body PageScrollLock writes to", () => {
    setPageDockWidth(440);

    expect(document.body.style.getPropertyValue("padding-inline-end")).toBe("");
    expect(document.body.style.paddingRight).toBe("");
  });

  test("tells what measures itself on a resize, once for each width", () => {
    setPageDockWidth(440);
    expect(resizes).toBe(1);

    setPageDockWidth(440);
    expect(resizes).toBe(1);

    setPageDockWidth(500);
    expect(resizes).toBe(2);
  });
});

describe("movePageDock", () => {
  test("the page follows a drag, and nothing is told until the edge stops", () => {
    movePageDock(460);
    movePageDock(480);
    movePageDock(500);

    expect(dockWidth()).toBe("500px");
    expect(pagePadding()).toBe(`var(${PAGE_DOCK_WIDTH_VARIABLE})`);
    expect(resizes).toBe(0);

    setPageDockWidth(500);

    expect(resizes).toBe(1);
  });
});

describe("clearPageDock", () => {
  test("gives the page its whole width back, leaving no value behind", () => {
    setPageDockWidth(440);

    clearPageDock();

    expect(dockWidth()).toBe("");
    expect(pagePadding()).toBe("");
    expect(document.documentElement.getAttribute("style") || "").not.toContain(
      PAGE_DOCK_WIDTH_VARIABLE,
    );
  });

  test("tells what measures itself that the room came back", () => {
    setPageDockWidth(440);
    resizes = 0;

    clearPageDock();

    expect(resizes).toBe(1);
  });

  test("with nothing docked there is nothing to tell", () => {
    clearPageDock();

    expect(resizes).toBe(0);
  });

  test("leaves what else <html> carries alone", () => {
    document.documentElement.style.setProperty("--app-header-height", "112px");
    setPageDockWidth(440);

    clearPageDock();

    expect(
      document.documentElement.style.getPropertyValue("--app-header-height"),
    ).toBe("112px");
    document.documentElement.style.removeProperty("--app-header-height");
  });
});

describe("usePageDock", () => {
  test("the page makes room while it is mounted, and has it back when it goes", () => {
    const { unmount } = render(<Docked width={440} />);

    expect(dockWidth()).toBe("440px");

    unmount();

    expect(dockWidth()).toBe("");
    expect(pagePadding()).toBe("");
  });

  test("follows the width it is given", () => {
    const { rerender } = render(<Docked width={440} />);

    rerender(<Docked width={520} />);

    expect(dockWidth()).toBe("520px");
  });

  test("null, a surface over the page and not beside it, takes nothing from it", () => {
    const { rerender } = render(<Docked width={null} />);

    expect(dockWidth()).toBe("");

    rerender(<Docked width={440} />);
    expect(dockWidth()).toBe("440px");

    rerender(<Docked width={null} />);
    expect(dockWidth()).toBe("");
    expect(pagePadding()).toBe("");
  });

  test("a new width never gives the page its room back on the way: no flash of a full-width page", () => {
    const { rerender } = render(<Docked width={440} />);
    resizes = 0;
    const seen: Array<string> = [];
    const watch: () => void = (): void => {
      seen.push(dockWidth());
    };

    window.addEventListener("resize", watch);
    rerender(<Docked width={520} />);
    window.removeEventListener("resize", watch);

    expect(seen).toEqual(["520px"]);
  });
});

describe("a surface pinned to the end of the window", () => {
  test("stops where the dock starts, and at the window's edge with none", () => {
    expect(PAGE_DOCK_END_CLASS_NAME).toBe(
      `end-[var(${PAGE_DOCK_WIDTH_VARIABLE},0px)]`,
    );
  });
});
