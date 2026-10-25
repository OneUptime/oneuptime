import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Mock } from "jest-mock";
import React, { FunctionComponent, ReactElement } from "react";
import { createPortal } from "react-dom";
import useAnchoredFieldPopup, {
  AnchoredFieldPopup,
  AnchoredPopupTriggerProps,
  getAnchoredPopupRevealScroll,
  getAnchoredPopupTriggerProps,
} from "../../../../UI/Types/UseAnchoredFieldPopup";

/*
 * ROOM FOR A LIST OPENED LOW ON A PHONE.
 *
 * An incident header's Add opens the Add owners list under it. On a phone the
 * Add sits near the foot of the screen, and the list opened below it with room
 * for its search box and two rows. A popup that asks for it
 * (revealRoomOnOpen) scrolls the page as it opens, just enough for its full
 * height below the anchor - never further than the anchor's own top, and not
 * at all when it has the room, or when it opens above.
 *
 * jsdom's window is 1024x768. Gap 4px, margin 8px.
 */

describe("getAnchoredPopupRevealScroll", () => {
  test.each([
    // [anchor top, anchor height, max height, scroll]
    // Room below: nothing to do.
    [100, 24, 380, 0],
    [352, 24, 380, 0],
    // 198px below an anchor at 534..558: 182px more for 380.
    [534, 24, 380, 182],
    // Anything short of the full height scrolls the difference.
    [353, 24, 380, 1],
    // A popup taller than the window: as far as the anchor's own top.
    [100, 24, 900, 92],
  ] as Array<[number, number, number, number]>)(
    "an anchor at %ipx (%ipx tall), a popup of %ipx: scroll %ipx",
    (top: number, height: number, maxHeight: number, scroll: number) => {
      expect(
        getAnchoredPopupRevealScroll({
          anchor: { top, bottom: top + height, left: 40, right: 140 },
          viewportHeight: 768,
          popupMaxHeight: maxHeight,
        }),
      ).toBe(scroll);
    },
  );

  test("a popup that opens above (too little room below, more above) is left alone", () => {
    expect(
      getAnchoredPopupRevealScroll({
        // 100px below: the hook opens it above.
        anchor: { top: 640, bottom: 664, left: 40, right: 140 },
        viewportHeight: 768,
        popupMaxHeight: 380,
      }),
    ).toBe(0);
    // One that prefers above, with the room for it there.
    expect(
      getAnchoredPopupRevealScroll({
        anchor: { top: 534, bottom: 558, left: 40, right: 140 },
        viewportHeight: 768,
        popupMaxHeight: 380,
        preferredPlacement: "above",
      }),
    ).toBe(0);
  });

  test("a window shorter than the popup asks for what fits, at most", () => {
    // 400px tall: 400 - 24 - 4 - 16 = 356px of popup can fit at all.
    expect(
      getAnchoredPopupRevealScroll({
        anchor: { top: 200, bottom: 224, left: 40, right: 140 },
        viewportHeight: 400,
        popupMaxHeight: 380,
      }),
    ).toBe(192);
  });
});

interface HarnessProps {
  revealRoomOnOpen?: boolean | undefined;
}

const Harness: FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const popup: AnchoredFieldPopup = useAnchoredFieldPopup({
    popupWidth: 320,
    popupMaxHeight: 380,
    revealRoomOnOpen: props.revealRoomOnOpen,
  });
  const trigger: AnchoredPopupTriggerProps = getAnchoredPopupTriggerProps(popup);

  return (
    <div>
      <div ref={popup.anchorRef}>
        <button type="button" {...trigger}>
          Add owners
        </button>
      </div>
      {popup.isPopupOpen &&
        popup.portalTarget &&
        createPortal(
          <div ref={popup.popupRef} id={popup.popupId} data-testid="popup" />,
          popup.portalTarget,
        )}
    </div>
  );
};

let scrollBy: Mock<(options?: ScrollToOptions) => void>;

function placeAnchorAt(top: number): void {
  jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation((): DOMRect => {
      return {
        top,
        bottom: top + 24,
        left: 40,
        right: 140,
        width: 100,
        height: 24,
        x: 40,
        y: top,
        toJSON: () => {
          return {};
        },
      } as DOMRect;
    });
}

function press(): void {
  act(() => {
    screen.getByRole("button", { name: "Add owners" }).click();
  });
}

beforeEach(() => {
  scrollBy = jest.fn<(options?: ScrollToOptions) => void>();
  window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("revealRoomOnOpen", () => {
  test("scrolls the page once as the list opens low, by what it lacks", () => {
    placeAnchorAt(534);
    render(<Harness revealRoomOnOpen={true} />);

    press();

    expect(screen.getByTestId("popup")).toBeInTheDocument();
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith({ top: 182, behavior: "auto" });
  });

  test("does nothing with the room already there", () => {
    placeAnchorAt(100);
    render(<Harness revealRoomOnOpen={true} />);

    press();

    expect(scrollBy).not.toHaveBeenCalled();
  });

  test("a popup that does not ask for it never scrolls the page", () => {
    placeAnchorAt(534);
    render(<Harness />);

    press();

    expect(screen.getByTestId("popup")).toBeInTheDocument();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  test("closing the list scrolls nothing back", () => {
    placeAnchorAt(534);
    render(<Harness revealRoomOnOpen={true} />);

    press();
    press();

    expect(screen.queryByTestId("popup")).toBeNull();
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });
});

describe("getAnchoredPopupTriggerProps", () => {
  test("the button toggles the popup and says that it opens a dialog, whether it is open, and which", () => {
    placeAnchorAt(100);
    render(<Harness />);

    const button: HTMLElement = screen.getByRole("button", {
      name: "Add owners",
    });

    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).not.toHaveAttribute("aria-controls");

    press();

    const popup: HTMLElement = screen.getByTestId("popup");

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", popup.id);

    press();

    expect(screen.queryByTestId("popup")).toBeNull();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("Enter on the button opens the popup from the keyboard", () => {
    placeAnchorAt(100);
    render(<Harness />);

    const button: HTMLElement = screen.getByRole("button", {
      name: "Add owners",
    });

    act(() => {
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(screen.getByTestId("popup")).toBeInTheDocument();
  });
});
