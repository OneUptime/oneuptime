import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { createPortal } from "react-dom";
import useAnchoredFieldPopup, {
  AnchoredFieldPopup,
  AnchoredFieldPopupPlacement,
  shouldAnchoredPopupOpenAbove,
} from "../../../../UI/Types/UseAnchoredFieldPopup";

/*
 * Where an anchored popup opens. Below its anchor unless it asks for above
 * (preferredPlacement) - the note composer's template menu does, because its
 * trigger sits at the foot of the note - and either way it moves to the
 * other side when its own side leaves it less than a useful height (160px)
 * and the other side has more room. Its maxHeight is the room it got, so it
 * never runs off the screen.
 */

describe("shouldAnchoredPopupOpenAbove", () => {
  test.each([
    // [preferred, above, below, opens above]
    ["below", 50, 600, false],
    ["below", 600, 600, false],
    ["below", 600, 400, false],
    ["below", 600, 159, true],
    ["below", 100, 159, false],
    ["below", 100, 20, true],
    ["above", 600, 50, true],
    ["above", 160, 600, true],
    ["above", 400, 600, true],
    ["above", 159, 600, false],
    ["above", 159, 100, true],
    ["above", 20, 100, false],
  ] as Array<[AnchoredFieldPopupPlacement, number, number, boolean]>)(
    "prefers %s, %ipx above and %ipx below: above is %s",
    (
      preferredPlacement: AnchoredFieldPopupPlacement,
      spaceAbove: number,
      spaceBelow: number,
      isAbove: boolean,
    ) => {
      expect(
        shouldAnchoredPopupOpenAbove({
          preferredPlacement,
          spaceAbove,
          spaceBelow,
        }),
      ).toBe(isAbove);
    },
  );

  test("with no room either way it stays on the side it prefers", () => {
    expect(
      shouldAnchoredPopupOpenAbove({
        preferredPlacement: "below",
        spaceAbove: 0,
        spaceBelow: 0,
      }),
    ).toBe(false);
    expect(
      shouldAnchoredPopupOpenAbove({
        preferredPlacement: "above",
        spaceAbove: 0,
        spaceBelow: 0,
      }),
    ).toBe(true);
  });
});

interface HarnessProps {
  preferredPlacement?: AnchoredFieldPopupPlacement | undefined;
}

const Harness: FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const popup: AnchoredFieldPopup = useAnchoredFieldPopup({
    popupWidth: 320,
    popupMaxHeight: 420,
    preferredPlacement: props.preferredPlacement,
  });

  return (
    <div>
      <div ref={popup.anchorRef}>
        <button
          type="button"
          onClick={() => {
            popup.togglePopup();
          }}
        >
          Open
        </button>
      </div>
      {popup.isPopupOpen &&
        popup.portalTarget &&
        createPortal(
          <div
            ref={popup.popupRef}
            data-testid="popup"
            data-top={String(popup.popupPosition?.top)}
            data-bottom={String(popup.popupPosition?.bottom)}
            data-max-height={String(popup.popupPosition?.maxHeight)}
          />,
          popup.portalTarget,
        )}
    </div>
  );
};

function placeAnchorAt(top: number, height: number = 32): void {
  jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation((): DOMRect => {
      return {
        top,
        bottom: top + height,
        left: 40,
        right: 140,
        width: 100,
        height,
        x: 40,
        y: top,
        toJSON: () => {
          return {};
        },
      } as DOMRect;
    });
}

function open(): HTMLElement {
  act(() => {
    screen.getByRole("button", { name: "Open" }).click();
  });
  return screen.getByTestId("popup");
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("useAnchoredFieldPopup placement", () => {
  // jsdom's window is 1024x768.

  test("opens below by default when there is room below", () => {
    placeAnchorAt(100);
    render(<Harness />);
    const popup: HTMLElement = open();

    expect(popup).toHaveAttribute("data-top", String(100 + 32 + 4));
    expect(popup).toHaveAttribute("data-bottom", "undefined");
    expect(popup).toHaveAttribute("data-max-height", "420");
  });

  test("a popup that prefers above opens above when there is room above", () => {
    placeAnchorAt(600);
    render(<Harness preferredPlacement="above" />);
    const popup: HTMLElement = open();

    expect(popup).toHaveAttribute("data-top", "undefined");
    // Measured from the bottom of the window, up to just above the anchor.
    expect(popup).toHaveAttribute("data-bottom", String(768 - 600 + 4));
    expect(popup).toHaveAttribute("data-max-height", "420");
  });

  test("a popup that prefers above is clamped to the room above it", () => {
    placeAnchorAt(300);
    render(<Harness preferredPlacement="above" />);
    const popup: HTMLElement = open();

    expect(popup).toHaveAttribute("data-bottom", String(768 - 300 + 4));
    expect(popup).toHaveAttribute("data-max-height", String(300 - 4 - 8));
  });

  test("a popup that prefers above opens below when above is too short and below is roomier", () => {
    placeAnchorAt(60);
    render(<Harness preferredPlacement="above" />);
    const popup: HTMLElement = open();

    expect(popup).toHaveAttribute("data-top", String(60 + 32 + 4));
    expect(popup).toHaveAttribute("data-bottom", "undefined");
  });

  test("a popup that prefers below still flips above at the foot of the window", () => {
    placeAnchorAt(700);
    render(<Harness />);
    const popup: HTMLElement = open();

    expect(popup).toHaveAttribute("data-top", "undefined");
    expect(popup).toHaveAttribute("data-bottom", String(768 - 700 + 4));
  });
});
