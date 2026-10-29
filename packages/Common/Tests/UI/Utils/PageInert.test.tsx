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
});
