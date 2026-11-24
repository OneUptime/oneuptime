import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useRef } from "react";
import { createPortal } from "react-dom";
import {
  makeOthersInert,
  ReleasePageInertFunction,
  usePageInert,
} from "../../../UI/Utils/PageInert";

/*
 * The page behind a modal surface (Ask AI's dialog) is inert while the
 * surface is up: no focus, no click and no screen reader cursor reaches it.
 * Everything off the path from the surface up to <body> is made inert; the
 * surface and what opens over it later are not. Shared and counted: two
 * surfaces at once hand the page back only when both are gone, and what
 * other code made inert stays as it was.
 */

// The app, and a surface beside it with a sibling of its own.
function page(): { app: HTMLElement; surface: HTMLElement } {
  document.body.innerHTML = `
    <div id="app"><header id="header"></header><main id="main"></main></div>
    <div id="surface-root"><div id="surface"></div><div id="beside"></div></div>
    <script id="script"></script>
  `;

  return {
    app: document.getElementById("app")!,
    surface: document.getElementById("surface")!,
  };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("makeOthersInert", () => {
  test("everything off the surface's path to <body> is inert; the path itself is not", () => {
    const { surface } = page();

    const release: ReleasePageInertFunction = makeOthersInert(surface);

    // The app beside the surface's root, and the surface's own sibling.
    expect(document.getElementById("app")).toHaveAttribute("inert");
    expect(document.getElementById("beside")).toHaveAttribute("inert");
    // The surface and its ancestors stay reachable.
    expect(surface).not.toHaveAttribute("inert");
    expect(document.getElementById("surface-root")).not.toHaveAttribute(
      "inert",
    );
    // A script is never part of what a person reads or reaches.
    expect(document.getElementById("script")).not.toHaveAttribute("inert");

    release();

    expect(document.getElementById("app")).not.toHaveAttribute("inert");
    expect(document.getElementById("beside")).not.toHaveAttribute("inert");
  });

  test("what opens later, over the surface, is never made inert", () => {
    const { surface } = page();
    const release: ReleasePageInertFunction = makeOthersInert(surface);

    const menu: HTMLElement = document.createElement("div");
    document.body.appendChild(menu);

    expect(menu).not.toHaveAttribute("inert");

    release();
  });

  test("two surfaces: the page wakes only when the last one goes", () => {
    const { surface } = page();
    const second: HTMLElement = document.createElement("div");
    document.body.appendChild(second);

    const releaseFirst: ReleasePageInertFunction = makeOthersInert(surface);
    const releaseSecond: ReleasePageInertFunction = makeOthersInert(second);

    releaseFirst();
    // The second surface still covers the app.
    expect(document.getElementById("app")).toHaveAttribute("inert");

    releaseSecond();
    expect(document.getElementById("app")).not.toHaveAttribute("inert");
  });

  test("an element other code made inert is left inert when the surface goes", () => {
    const { surface, app } = page();
    app.setAttribute("inert", "");

    const release: ReleasePageInertFunction = makeOthersInert(surface);
    release();

    expect(app).toHaveAttribute("inert");
  });

  test("releasing twice releases once", () => {
    const { surface } = page();
    const second: HTMLElement = document.createElement("div");
    document.body.appendChild(second);

    const releaseFirst: ReleasePageInertFunction = makeOthersInert(surface);
    const releaseSecond: ReleasePageInertFunction = makeOthersInert(second);

    releaseFirst();
    releaseFirst();

    // The first release, run again, did not take the second surface's hold.
    expect(document.getElementById("app")).toHaveAttribute("inert");

    releaseSecond();
    expect(document.getElementById("app")).not.toHaveAttribute("inert");
  });
});

/*
 * A surface that is no dialog (a dashboard shown full screen over its page,
 * #10409) covers the page around it, not the app's own layers: the walk
 * stops at the app's root, and passes by the children of its <main>, which
 * hold the command palette, Ask AI and the dialogs any page opens. Above
 * <main>, the header, the menus and the footer go inert as before.
 */
function app(): {
  root: HTMLElement;
  main: HTMLElement;
  view: HTMLElement;
} {
  document.body.innerHTML = `
    <div id="root">
      <div id="master">
        <div id="alerts"></div>
        <div id="page">
          <a id="skip" href="#main-content">Skip</a>
          <div id="top"><header id="header"></header><nav id="nav"></nav></div>
          <div id="content">
            <main id="main-content">
              <div id="ask-ai"></div>
              <div id="palette"></div>
              <div id="routes">
                <div id="breadcrumbs"></div>
                <aside id="side-menu"></aside>
                <section id="column"><div id="banner"></div><div id="view"></div></section>
              </div>
            </main>
            <footer id="footer"></footer>
          </div>
        </div>
      </div>
      <div id="toasts"></div>
      <div id="new-version"></div>
    </div>
    <div id="tippy-layer"></div>
  `;

  return {
    root: document.getElementById("root")!,
    main: document.getElementById("main-content")!,
    view: document.getElementById("view")!,
  };
}

function isInert(id: string): boolean {
  return document.getElementById(id)!.hasAttribute("inert");
}

describe("makeOthersInert with a scope", () => {
  test("the page around the surface is inert: its header, menus, breadcrumbs, banner and footer", () => {
    const { root, main, view } = app();

    const release: ReleasePageInertFunction = makeOthersInert(view, {
      boundary: root,
      keepChildrenOf: [main],
    });

    for (const id of [
      "banner",
      "breadcrumbs",
      "side-menu",
      "footer",
      "skip",
      "top",
      "alerts",
    ]) {
      expect({ id, inert: isInert(id) }).toEqual({ id, inert: true });
    }

    release();

    for (const id of ["banner", "side-menu", "footer", "top", "alerts"]) {
      expect({ id, inert: isInert(id) }).toEqual({ id, inert: false });
    }
  });

  test("the app's own layers stay reachable: what sits beside the page in its <main>, and beside the app in its root", () => {
    const { root, main, view } = app();

    const release: ReleasePageInertFunction = makeOthersInert(view, {
      boundary: root,
      keepChildrenOf: [main],
    });

    for (const id of ["ask-ai", "palette", "toasts", "new-version"]) {
      expect({ id, inert: isInert(id) }).toEqual({ id, inert: false });
    }

    // Nothing at or above the boundary: the root, and what is beside it in <body>.
    expect(root).not.toHaveAttribute("inert");
    expect(isInert("tippy-layer")).toBe(false);

    // The surface and its path stay reachable.
    for (const id of ["view", "column", "routes", "main-content", "content"]) {
      expect({ id, inert: isInert(id) }).toEqual({ id, inert: false });
    }

    release();
  });

  test("a scope naming nothing on the page walks as a dialog does", () => {
    const { view } = app();

    const release: ReleasePageInertFunction = makeOthersInert(view, {
      boundary: null,
      keepChildrenOf: [null, undefined],
    });

    // Beside the main: the app's layers, inert as for a dialog.
    expect(isInert("ask-ai")).toBe(true);
    expect(isInert("toasts")).toBe(true);
    expect(isInert("tippy-layer")).toBe(true);

    release();

    expect(isInert("ask-ai")).toBe(false);
    expect(isInert("toasts")).toBe(false);
    expect(isInert("tippy-layer")).toBe(false);
  });

  test("a dialog over the full-screen surface makes the app's layers inert, and hands them back when it goes", () => {
    const { root, main, view } = app();
    const dialog: HTMLElement = document.createElement("div");
    document.body.appendChild(dialog);

    const releaseView: ReleasePageInertFunction = makeOthersInert(view, {
      boundary: root,
      keepChildrenOf: [main],
    });
    const releaseDialog: ReleasePageInertFunction = makeOthersInert(dialog);

    expect(root).toHaveAttribute("inert");

    releaseDialog();

    // The view's own hold is still on its page; the app's root is awake.
    expect(root).not.toHaveAttribute("inert");
    expect(isInert("side-menu")).toBe(true);

    releaseView();

    expect(isInert("side-menu")).toBe(false);
  });
});

/*
 * The hook, as the dialog uses it: a surface portalled into <body> makes
 * the app's root inert while it is mounted and active.
 */
const Surface: FunctionComponent<{ isActive: boolean }> = (props: {
  isActive: boolean;
}): ReactElement => {
  const ref: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  usePageInert(props.isActive, ref);

  return createPortal(
    <div ref={ref} data-testid="surface">
      <button type="button">Inside</button>
    </div>,
    document.body,
  );
};

describe("usePageInert", () => {
  test("a portalled surface makes the app inert while it is up, and wakes it when it goes", () => {
    const { container, rerender, unmount } = render(
      <div data-testid="app">
        <button type="button">Behind</button>
        <Surface isActive={true} />
      </div>,
    );

    expect(container).toHaveAttribute("inert");

    rerender(
      <div data-testid="app">
        <button type="button">Behind</button>
        <Surface isActive={false} />
      </div>,
    );
    expect(container).not.toHaveAttribute("inert");

    rerender(
      <div data-testid="app">
        <button type="button">Behind</button>
        <Surface isActive={true} />
      </div>,
    );
    expect(container).toHaveAttribute("inert");

    unmount();
    expect(container).not.toHaveAttribute("inert");
  });

  test("with a scope: the page around an in-place surface sleeps, the layers beside it do not, and a new scope function each render changes nothing", () => {
    const scopeReads: Array<number> = [];

    function Page(props: { isActive: boolean; turn: number }): ReactElement {
      const ref: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

      // A new function every render, as a caller writes it inline.
      usePageInert(props.isActive, ref, () => {
        scopeReads.push(props.turn);

        return {
          boundary: document.getElementById("app-root"),
          keepChildrenOf: [document.getElementById("app-main")],
        };
      });

      return (
        <div id="app-root">
          <div data-testid="app">
            <header data-testid="header">
              <button type="button">Menu</button>
            </header>
            <main id="app-main">
              <div data-testid="palette" />
              <section>
                <nav data-testid="side-menu" />
                <div ref={ref} data-testid="view" />
              </section>
            </main>
            <footer data-testid="footer" />
          </div>
          <div data-testid="toasts" />
        </div>
      );
    }

    const { getByTestId, rerender } = render(<Page isActive={true} turn={1} />);

    expect(getByTestId("header")).toHaveAttribute("inert");
    expect(getByTestId("side-menu")).toHaveAttribute("inert");
    expect(getByTestId("footer")).toHaveAttribute("inert");
    expect(getByTestId("palette")).not.toHaveAttribute("inert");
    expect(getByTestId("toasts")).not.toHaveAttribute("inert");
    expect(getByTestId("view")).not.toHaveAttribute("inert");
    expect(scopeReads).toEqual([1]);

    // Drawn again with a new function: the page is not woken and put back to sleep.
    rerender(<Page isActive={true} turn={2} />);

    expect(scopeReads).toEqual([1]);
    expect(getByTestId("header")).toHaveAttribute("inert");

    rerender(<Page isActive={false} turn={3} />);

    expect(getByTestId("header")).not.toHaveAttribute("inert");
    expect(getByTestId("side-menu")).not.toHaveAttribute("inert");
    expect(getByTestId("footer")).not.toHaveAttribute("inert");

    // Active again: the scope is read afresh, from the page now on screen.
    rerender(<Page isActive={true} turn={4} />);

    expect(scopeReads).toEqual([1, 4]);
    expect(getByTestId("header")).toHaveAttribute("inert");
  });
});
