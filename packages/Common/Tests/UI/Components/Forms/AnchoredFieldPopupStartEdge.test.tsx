import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { createPortal } from "react-dom";
import useAnchoredFieldPopup, {
  AnchoredFieldPopup,
  AnchoredPopupBox,
  AnchoredPopupPlacementResult,
  getAnchoredPopupLeft,
  placeAnchoredPopupInBounds,
} from "../../../../UI/Types/UseAnchoredFieldPopup";

/*
 * A popup opens from its anchor's start edge: the anchor's left on a page
 * read left to right, its right on one read right to left, so it opens
 * towards the end of the line, over what comes after its anchor. On a
 * Persian page the Add owners popup started at the button's left edge and
 * opened rightward, over the side menu (#5363).
 */

const box: (
  left: number,
  top: number,
  width: number,
  height: number,
) => AnchoredPopupBox = (
  left: number,
  top: number,
  width: number,
  height: number,
): AnchoredPopupBox => {
  return { left, top, right: left + width, bottom: top + height };
};

describe("getAnchoredPopupLeft", () => {
  const anchor: AnchoredPopupBox = box(600, 100, 100, 32);

  test("left to right: at the anchor's left edge", () => {
    expect(
      getAnchoredPopupLeft({
        anchor,
        width: 320,
        minimumLeft: 8,
        maximumRight: 1272,
        isRightToLeft: false,
      }),
    ).toBe(600);
  });

  test("right to left: its right edge at the anchor's right edge", () => {
    expect(
      getAnchoredPopupLeft({
        anchor,
        width: 320,
        minimumLeft: 8,
        maximumRight: 1272,
        isRightToLeft: true,
      }),
    ).toBe(700 - 320);
  });

  test("moved in from the window's edge when there is no room on the side it opens to", () => {
    // Near the left edge, right to left: it would start at -220.
    expect(
      getAnchoredPopupLeft({
        anchor: box(0, 100, 100, 32),
        width: 320,
        minimumLeft: 8,
        maximumRight: 1272,
        isRightToLeft: true,
      }),
    ).toBe(8);
    // Near the right edge, left to right: it would end past the window.
    expect(
      getAnchoredPopupLeft({
        anchor: box(1200, 100, 60, 32),
        width: 320,
        minimumLeft: 8,
        maximumRight: 1272,
        isRightToLeft: false,
      }),
    ).toBe(1272 - 320);
  });

  test("a popup wider than its room starts at the room's left", () => {
    expect(
      getAnchoredPopupLeft({
        anchor: box(100, 100, 100, 32),
        width: 500,
        minimumLeft: 8,
        maximumRight: 400,
        isRightToLeft: true,
      }),
    ).toBe(8);
  });
});

describe("placeAnchoredPopupInBounds", () => {
  const place: (isRightToLeft?: boolean) => AnchoredPopupPlacementResult = (
    isRightToLeft?: boolean,
  ): AnchoredPopupPlacementResult => {
    return placeAnchoredPopupInBounds({
      anchor: box(580, 200, 120, 36),
      viewportWidth: 1280,
      viewportHeight: 800,
      boundary: box(416, 120, 448, 500),
      popupWidth: 280,
      popupHeight: 300,
      popupMaxHeight: 420,
      preferredPlacement: "below",
      isRightToLeft,
    });
  };

  // Inside a 448px dialog body from 416 to 864, 4px in from each side.
  test("left to right, as before: at the anchor's left edge", () => {
    expect(place().left).toBe(580);
    expect(place(false).left).toBe(580);
  });

  test("right to left: ending where the anchor ends", () => {
    expect(place(true).left).toBe(700 - 280);
    expect(place(true).width).toBe(280);
  });
});

const Harness: FunctionComponent<{ isRightToLeft: boolean }> = (props: {
  isRightToLeft: boolean;
}): ReactElement => {
  const popup: AnchoredFieldPopup = useAnchoredFieldPopup({
    popupWidth: 320,
    popupMaxHeight: 420,
  });

  return (
    <div style={{ direction: props.isRightToLeft ? "rtl" : "ltr" }}>
      <div
        ref={popup.anchorRef}
        style={{ direction: props.isRightToLeft ? "rtl" : "ltr" }}
      >
        <button
          type="button"
          onClick={() => {
            popup.togglePopup();
          }}
        >
          Add owners
        </button>
      </div>
      {popup.isPopupOpen &&
        popup.portalTarget &&
        createPortal(
          <div
            ref={popup.popupRef}
            data-testid="popup"
            data-left={String(popup.popupPosition?.left)}
          />,
          popup.portalTarget,
        )}
    </div>
  );
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("useAnchoredFieldPopup", () => {
  // jsdom's window is 1024 wide; the anchor is a button from 600 to 700.
  const placeAnchor: () => void = (): void => {
    jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation((): DOMRect => {
        return {
          top: 100,
          bottom: 132,
          left: 600,
          right: 700,
          width: 100,
          height: 32,
          x: 600,
          y: 100,
          toJSON: () => {
            return {};
          },
        } as DOMRect;
      });
  };

  const open: () => HTMLElement = (): HTMLElement => {
    act(() => {
      screen.getByRole("button", { name: "Add owners" }).click();
    });

    return screen.getByTestId("popup");
  };

  test("on a page read left to right, opens from the anchor's left edge", () => {
    placeAnchor();
    render(<Harness isRightToLeft={false} />);

    expect(open()).toHaveAttribute("data-left", "600");
  });

  test("on a page read right to left, opens from the anchor's right edge, leftward", () => {
    placeAnchor();
    render(<Harness isRightToLeft={true} />);

    expect(open()).toHaveAttribute("data-left", String(700 - 320));
  });
});
