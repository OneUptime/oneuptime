import {
  BUTTON_DISABLED_CLASS_NAME,
  BUTTON_DISABLED_CURSOR_CLASS_NAME,
  BUTTON_DISABLED_FADE_CLASS_NAME,
  getHandDrawnButtonStateClassName,
  getHandDrawnLookClassName,
  getInertButtonFocusRingClassName,
  getInertButtonWrapperClassName,
  getLockedPartClassName,
  getRestingClassName,
  INERT_BUTTON_WRAPPER_FOCUS_CLASS_NAME,
} from "../../../UI/Components/Button/ButtonStates";
import * as ButtonModule from "../../../UI/Components/Button/Button";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The locked and busy look every button takes - Button's own, and a button
 * drawn by hand (a tile, a chip, a segmented control, a toolbar's or a
 * player's control) through ButtonStates:
 *
 *   - it can be pressed: its own look, with its hover;
 *   - locked: its own colours, faded (opacity-50), the not-allowed cursor,
 *     and no hover;
 *   - busy: its own look and no hover, never faded - a Refresh that turns
 *     while it works is not one that is turned off.
 */

const tokensOf: (className: string) => Array<string> = (
  className: string,
): Array<string> => {
  return className.split(/\s+/u).filter(Boolean);
};

describe("the locked look", () => {
  test("is the not-allowed cursor and a fade to half, as Button draws it", () => {
    expect(BUTTON_DISABLED_CURSOR_CLASS_NAME).toBe("cursor-not-allowed");
    expect(BUTTON_DISABLED_FADE_CLASS_NAME).toBe("opacity-50");
    expect(tokensOf(BUTTON_DISABLED_CLASS_NAME)).toEqual([
      "cursor-not-allowed",
      "opacity-50",
    ]);
  });

  test("Button hands out the very same classes, so the two can never drift", () => {
    expect(ButtonModule.BUTTON_DISABLED_CLASS_NAME).toBe(
      BUTTON_DISABLED_CLASS_NAME,
    );
    expect(ButtonModule.BUTTON_DISABLED_CURSOR_CLASS_NAME).toBe(
      BUTTON_DISABLED_CURSOR_CLASS_NAME,
    );
    expect(ButtonModule.getHandDrawnButtonStateClassName).toBe(
      getHandDrawnButtonStateClassName,
    );
  });
});

describe("getHandDrawnButtonStateClassName", () => {
  const HOVER: string = "hover:bg-gray-50 hover:text-gray-900";

  test("a button that can be pressed has its hover, and nothing locked about it", () => {
    expect(getHandDrawnButtonStateClassName({ hoverClassName: HOVER })).toBe(
      HOVER,
    );
    expect(
      getHandDrawnButtonStateClassName({
        isLocked: false,
        isBusy: false,
        hoverClassName: HOVER,
      }),
    ).toBe(HOVER);
  });

  test("with no hover of its own, a pressable button adds nothing", () => {
    expect(getHandDrawnButtonStateClassName({})).toBe("");
    expect(getHandDrawnButtonStateClassName({ isLocked: false })).toBe("");
  });

  test("a locked one fades with the not-allowed cursor, and gives no hover", () => {
    const className: string = getHandDrawnButtonStateClassName({
      isLocked: true,
      hoverClassName: HOVER,
    });

    expect(className).toBe(BUTTON_DISABLED_CLASS_NAME);
    expect(className).not.toContain("hover:");
  });

  test("a busy one keeps its look: no fade, no cursor of its own, no hover", () => {
    expect(
      getHandDrawnButtonStateClassName({
        isBusy: true,
        hoverClassName: HOVER,
      }),
    ).toBe("");
  });

  test("busy wins over locked: a button its caller locks while it works is not faded", () => {
    expect(
      getHandDrawnButtonStateClassName({
        isLocked: true,
        isBusy: true,
        hoverClassName: HOVER,
      }),
    ).toBe("");
  });

  test("a locked one that holds its reason takes the cursor only: its parts fade, not the reason", () => {
    expect(
      getHandDrawnButtonStateClassName({
        isLocked: true,
        holdsItsReason: true,
        hoverClassName: HOVER,
      }),
    ).toBe(BUTTON_DISABLED_CURSOR_CLASS_NAME);

    // Pressable, it has its hover whatever it holds.
    expect(
      getHandDrawnButtonStateClassName({
        isLocked: false,
        holdsItsReason: true,
        hoverClassName: HOVER,
      }),
    ).toBe(HOVER);
  });
});

describe("getLockedPartClassName", () => {
  test("a part of a locked button fades; of a pressable or busy one it does not", () => {
    expect(getLockedPartClassName({ isLocked: true })).toBe(
      BUTTON_DISABLED_FADE_CLASS_NAME,
    );
    expect(getLockedPartClassName({ isLocked: false })).toBe("");
    expect(getLockedPartClassName({})).toBe("");
    expect(getLockedPartClassName({ isLocked: true, isBusy: true })).toBe("");
  });
});

describe("getRestingClassName", () => {
  test("leaves out every class that answers the pointer", () => {
    expect(
      getRestingClassName(
        "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50",
      ),
    ).toBe("border-gray-200 bg-white text-gray-700");
  });

  test("a hover behind another variant, and a group's or a peer's hover, too", () => {
    expect(
      getRestingClassName(
        "text-gray-600 dark:hover:bg-gray-800 md:hover:text-gray-900 group-hover:bg-white group-hover/row:text-gray-900 peer-hover:opacity-100",
      ),
    ).toBe("text-gray-600");
  });

  test("leaves out its own cursor, at rest or under a press", () => {
    expect(
      getRestingClassName(
        "cursor-grab text-gray-400 hover:text-gray-700 active:cursor-grabbing",
      ),
    ).toBe("text-gray-400");
    expect(
      getRestingClassName(
        "cursor-pointer text-indigo-600 hover:text-indigo-700 hover:underline",
      ),
    ).toBe("text-indigo-600");
  });

  test("keeps what is not about the pointer: focus rings, widths, other states", () => {
    expect(
      getRestingClassName(
        "rounded-md md:px-3 focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95 aria-pressed:bg-white shadow-sm hover:shadow",
      ),
    ).toBe(
      "rounded-md md:px-3 focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95 aria-pressed:bg-white shadow-sm",
    );
  });

  test("collapses the spaces the look was written with", () => {
    expect(getRestingClassName("  bg-white   hover:bg-gray-50  text-sm ")).toBe(
      "bg-white text-sm",
    );
    expect(getRestingClassName("")).toBe("");
  });
});

describe("getHandDrawnLookClassName", () => {
  const LOOK: string =
    "cursor-pointer border-gray-300 bg-white text-gray-700 hover:bg-gray-50";

  test("as written while it can be pressed", () => {
    expect(getHandDrawnLookClassName({ className: LOOK })).toBe(LOOK);
    expect(
      getHandDrawnLookClassName({ className: LOOK, isLocked: false }),
    ).toBe(LOOK);
  });

  test("locked: its own colours at rest, faded, with the not-allowed cursor", () => {
    const tokens: Array<string> = tokensOf(
      getHandDrawnLookClassName({ className: LOOK, isLocked: true }),
    );

    expect(tokens).toEqual([
      "border-gray-300",
      "bg-white",
      "text-gray-700",
      ...tokensOf(BUTTON_DISABLED_CLASS_NAME),
    ]);
    // One cursor, never two that fight: its own pointer is gone.
    expect(
      tokens.filter((token: string): boolean => {
        return token.startsWith("cursor-");
      }),
    ).toEqual(["cursor-not-allowed"]);
  });

  test("busy: its own colours at rest, never faded, with no cursor of its own", () => {
    expect(getHandDrawnLookClassName({ className: LOOK, isBusy: true })).toBe(
      "border-gray-300 bg-white text-gray-700",
    );
    expect(
      getHandDrawnLookClassName({
        className: LOOK,
        isBusy: true,
        isLocked: true,
      }),
    ).toBe("border-gray-300 bg-white text-gray-700");
  });
});

/*
 * The keyboard's focus on a wrapped button (a locked or busy one with a
 * reason): its wrapper takes the keyboard's stop, and the button draws its
 * own focus ring while the wrapper has the focus.
 */
describe("getInertButtonFocusRingClassName", () => {
  test("mirrors each of the button's focus-visible classes onto the wrapper's focus", () => {
    expect(
      tokensOf(
        getInertButtonFocusRingClassName(
          "inline-flex rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 md:ml-3",
        ),
      ),
    ).toEqual([
      "group-focus-visible/inert:ring-2",
      "group-focus-visible/inert:ring-indigo-500",
      "group-focus-visible/inert:ring-offset-2",
    ]);
  });

  test("is nothing for a button with no focus ring of its own", () => {
    expect(getInertButtonFocusRingClassName("inline-flex px-3")).toBe("");
  });

  test("names the group the wrapper is, and takes the browser's outline off it", () => {
    expect(tokensOf(INERT_BUTTON_WRAPPER_FOCUS_CLASS_NAME)).toEqual([
      "group/inert",
      "focus:outline-none",
    ]);
  });

  test("keeps the dark theme's focus colours: Theme.css softens the ring as it softens a button's own", () => {
    const theme: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
      "utf8",
    );

    for (const colour of ["indigo", "red", "green"]) {
      expect(theme).toContain(
        `html.dark .group\\/inert:focus-visible > [class*="group-focus-visible/inert:ring-${colour}-"]`,
      );
    }
  });
});

describe("getInertButtonWrapperClassName", () => {
  const PHONE_WIDE: string =
    "inline-flex w-full justify-center rounded-md md:ml-3 md:w-auto md:text-sm px-3 py-2 pointer-events-none";

  test("a button as wide as a phone is wrapped as wide as the phone, inline from md up", () => {
    expect(
      tokensOf(
        getInertButtonWrapperClassName({
          buttonClassName: PHONE_WIDE,
          isLocked: false,
        }),
      ),
    ).toEqual(["flex", "w-full", "md:inline-flex", "md:w-auto"]);
  });

  test("a button sized to its label keeps a wrapper sized to it", () => {
    expect(
      getInertButtonWrapperClassName({
        buttonClassName:
          "inline-flex justify-center rounded-md border bg-white px-3 py-2",
        isLocked: false,
      }),
    ).toBe("inline-flex");
  });

  test("a locked one's wrapper takes the not-allowed cursor; a busy one's does not", () => {
    expect(
      tokensOf(
        getInertButtonWrapperClassName({
          buttonClassName: "inline-flex px-3",
          isLocked: true,
        }),
      ),
    ).toEqual(["inline-flex", "cursor-not-allowed"]);
    expect(
      getInertButtonWrapperClassName({
        buttonClassName: "inline-flex px-3",
        isLocked: false,
      }),
    ).not.toContain("cursor-not-allowed");
  });

  test("it carries the button's place in its row: width, flex share, grid span, an auto margin", () => {
    const wrapper: Array<string> = tokensOf(
      getInertButtonWrapperClassName({
        buttonClassName:
          "inline-flex px-3 flex-1 sm:flex-none min-w-0 max-w-full basis-1/2 grow shrink-0 self-end sm:col-span-2 ml-auto md:ms-auto !w-40",
        isLocked: false,
      }),
    );

    expect(wrapper).toEqual([
      "inline-flex",
      "flex-1",
      "sm:flex-none",
      "min-w-0",
      "max-w-full",
      "basis-1/2",
      "grow",
      "shrink-0",
      "self-end",
      "sm:col-span-2",
      "ml-auto",
      "md:ms-auto",
      "!w-40",
    ]);
  });

  test("but not what draws the button: margins, padding, colours, its own children's layout", () => {
    expect(
      getInertButtonWrapperClassName({
        buttonClassName:
          "inline-flex mt-2 md:ml-3 px-3 py-2 bg-white text-gray-700 flex-col flex-wrap items-center justify-center gap-2 text-left",
        isLocked: false,
      }),
    ).toBe("inline-flex");
  });
});
