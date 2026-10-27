import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import {
  chooseMenuSide,
  getVisibleBounds,
  MenuSide,
  MenuSideMeasure,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/MenuSide";

/*
 * WHERE A COMPOSER'S MENU OPENS.
 *
 * Ask AI's start draws its composer in the middle of the dialog and asks
 * its menus to open downwards; on a laptop window 800 px tall the "what
 * Ask AI may do" menu ran 70 px past the dialog's foot, which cut its last
 * choice in half (the UI review of #5349). A menu opens on the side asked
 * for unless it does not fit there and fits better on the other, measured
 * against what can show it: the window, cut by every box that clips it.
 */

afterEach(() => {
  cleanup();
});

function measure(overrides: Partial<MenuSideMeasure>): MenuSideMeasure {
  return {
    preferred: "bottom",
    buttonTop: 486,
    buttonBottom: 512,
    menuHeight: 286,
    boundaryTop: 80,
    boundaryBottom: 776,
    gap: 8,
    ...overrides,
  };
}

describe("chooseMenuSide", () => {
  test("Ask AI's start on a laptop 800 px tall: below would cut it off, above fits - up", () => {
    // 776 - 512 - 8 = 256 px below for 286 px of menu; 486 - 80 - 8 above.
    expect(chooseMenuSide(measure({}))).toBe("top");
  });

  test("with room below, it opens where it was asked to", () => {
    expect(chooseMenuSide(measure({ buttonTop: 402, buttonBottom: 428 }))).toBe(
      "bottom",
    );
  });

  test("a menu that exactly fits stays on its side", () => {
    // 776 - 482 - 8 = 286.
    expect(chooseMenuSide(measure({ buttonTop: 456, buttonBottom: 482 }))).toBe(
      "bottom",
    );
    // One pixel short, and above has room: up.
    expect(chooseMenuSide(measure({ buttonTop: 457, buttonBottom: 483 }))).toBe(
      "top",
    );
  });

  test("asked for the top, it stays up while it fits there (a composer at the foot)", () => {
    expect(
      chooseMenuSide(
        measure({ preferred: "top", buttonTop: 700, buttonBottom: 726 }),
      ),
    ).toBe("top");
  });

  test("asked for the top with no room above, it opens down when it fits there", () => {
    expect(
      chooseMenuSide(
        measure({ preferred: "top", buttonTop: 100, buttonBottom: 126 }),
      ),
    ).toBe("bottom");
  });

  test.each([
    // [asked, button top, button bottom, expected]: fits on neither side.
    ["bottom", 300, 326, "bottom"], // more room below (442 v 212)
    ["bottom", 500, 526, "top"], // more room above (412 v 242)
    ["top", 300, 326, "bottom"],
    ["top", 500, 526, "top"],
  ] as Array<[MenuSide, number, number, MenuSide]>)(
    "fitting nowhere (asked %s, button at %d), it takes the side with more room",
    (
      preferred: MenuSide,
      buttonTop: number,
      buttonBottom: number,
      expected: MenuSide,
    ) => {
      expect(
        chooseMenuSide(
          measure({ preferred, buttonTop, buttonBottom, menuHeight: 500 }),
        ),
      ).toBe(expected);
    },
  );

  test("a menu not measured yet (no layout, as in a test's DOM) stays where it was asked", () => {
    expect(chooseMenuSide(measure({ menuHeight: 0 }))).toBe("bottom");
    expect(
      chooseMenuSide(
        measure({
          preferred: "top",
          menuHeight: 0,
          buttonTop: 0,
          buttonBottom: 0,
          boundaryTop: 0,
          boundaryBottom: 0,
        }),
      ),
    ).toBe("top");
  });
});

describe("getVisibleBounds", () => {
  function rectOf(top: number, bottom: number): DOMRect {
    return {
      top: top,
      bottom: bottom,
      left: 0,
      right: 100,
      width: 100,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => {
        return {};
      },
    };
  }

  test("the window, with nothing that clips in between", () => {
    render(
      <div>
        <button type="button">Ask to act</button>
      </div>,
    );

    expect(getVisibleBounds(screen.getByRole("button"))).toEqual({
      top: 0,
      bottom: window.innerHeight,
    });
  });

  test("cut by every box that clips: the dialog, then its scrolling column", () => {
    render(
      <div data-testid="dialog" style={{ overflowY: "hidden" }}>
        <div>
          <div data-testid="column" style={{ overflowY: "auto" }}>
            <div style={{ overflowY: "visible" }}>
              <button type="button">Ask to act</button>
            </div>
          </div>
        </div>
      </div>,
    );

    const dialogBox: HTMLElement = screen.getByTestId("dialog");
    const column: HTMLElement = screen.getByTestId("column");
    dialogBox.getBoundingClientRect = (): DOMRect => {
      return rectOf(24, 720);
    };
    column.getBoundingClientRect = (): DOMRect => {
      return rectOf(80, 740);
    };

    // The column's top (under the dialog's header), the dialog's foot.
    expect(getVisibleBounds(screen.getByRole("button"))).toEqual({
      top: 80,
      bottom: 720,
    });

    // And the window's foot, where the boxes reach past it.
    dialogBox.getBoundingClientRect = (): DOMRect => {
      return rectOf(24, window.innerHeight + 200);
    };
    column.getBoundingClientRect = (): DOMRect => {
      return rectOf(80, window.innerHeight + 100);
    };

    expect(getVisibleBounds(screen.getByRole("button"))).toEqual({
      top: 80,
      bottom: window.innerHeight,
    });
  });
});
