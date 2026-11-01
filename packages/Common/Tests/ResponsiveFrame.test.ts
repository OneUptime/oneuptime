import { describe, expect, test } from "@jest/globals";
import {
  BorderWidths,
  CornerRadii,
  resolveBorderWidths,
  resolveCornerRadii,
  resolveFrame,
  resolveShadow,
} from "./ResponsiveFrame";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
} from "./ResponsiveVisibility";

/*
 * The suites that hold a box drawn only from sm up - a card that is a
 * section on a phone, a criteria's bands - to "exactly the frame it had, at
 * every width from sm" lean on this helper, so it gets its own cover: a
 * helper that resolved too kindly would let a frame lost at 768px pass.
 */

function sides(
  top: number,
  right: number,
  bottom: number,
  left: number,
): BorderWidths {
  return { top: top, right: right, bottom: bottom, left: left };
}

function corners(radius: number): CornerRadii {
  return {
    topLeft: radius,
    topRight: radius,
    bottomRight: radius,
    bottomLeft: radius,
  };
}

const SM_WIDTH_IN_PX: number = 640;
const JUST_UNDER_SM_IN_PX: number = 639;

describe("resolveBorderWidths", () => {
  test("border is 1px on every side, at every width", () => {
    for (const width of [PHONE_WIDTH_IN_PX, LAPTOP_WIDTH_IN_PX]) {
      expect(resolveBorderWidths("border border-gray-200", width)).toEqual(
        sides(1, 1, 1, 1),
      );
    }
  });

  test("a colour is not a width", () => {
    expect(
      resolveBorderWidths(
        "border-gray-200 border-l-blue-500 !border-l-gray-300",
        LAPTOP_WIDTH_IN_PX,
      ),
    ).toEqual(sides(0, 0, 0, 0));
  });

  test("a side and an axis win over all sides, whatever order they are written in", () => {
    expect(resolveBorderWidths("border-l-4 border", PHONE_WIDTH_IN_PX)).toEqual(
      sides(1, 1, 1, 4),
    );
    expect(resolveBorderWidths("border-x-0 border", PHONE_WIDTH_IN_PX)).toEqual(
      sides(1, 0, 1, 0),
    );
    expect(
      resolveBorderWidths("border-t-0 border-y", PHONE_WIDTH_IN_PX),
    ).toEqual(sides(0, 0, 1, 0));
  });

  test("a screen's utility wins over an unprefixed one from its width up", () => {
    const className: string = "border-t sm:border";

    expect(resolveBorderWidths(className, PHONE_WIDTH_IN_PX)).toEqual(
      sides(1, 0, 0, 0),
    );
    expect(resolveBorderWidths(className, JUST_UNDER_SM_IN_PX)).toEqual(
      sides(1, 0, 0, 0),
    );
    expect(resolveBorderWidths(className, SM_WIDTH_IN_PX)).toEqual(
      sides(1, 1, 1, 1),
    );
    expect(resolveBorderWidths(className, TABLET_WIDTH_IN_PX)).toEqual(
      sides(1, 1, 1, 1),
    );
  });

  test("a later screen's all-sides utility wins over an earlier screen's side", () => {
    expect(resolveBorderWidths("border-y sm:border-2", SM_WIDTH_IN_PX)).toEqual(
      sides(2, 2, 2, 2),
    );
    expect(
      resolveBorderWidths("border-y sm:border-2", PHONE_WIDTH_IN_PX),
    ).toEqual(sides(1, 0, 1, 0));
  });

  test("widths: 0, 2, 4, 8 and an arbitrary px length", () => {
    expect(resolveBorderWidths("border-0", PHONE_WIDTH_IN_PX)).toEqual(
      sides(0, 0, 0, 0),
    );
    expect(resolveBorderWidths("border-b-8", PHONE_WIDTH_IN_PX)).toEqual(
      sides(0, 0, 8, 0),
    );
    expect(resolveBorderWidths("border-[3px]", PHONE_WIDTH_IN_PX)).toEqual(
      sides(3, 3, 3, 3),
    );
  });

  test("an important utility wins over a later screen's", () => {
    expect(
      resolveBorderWidths("!border-0 sm:border", LAPTOP_WIDTH_IN_PX),
    ).toEqual(sides(0, 0, 0, 0));
  });

  test("two widths for one side at one place in the stylesheet throw", () => {
    expect(() => {
      return resolveBorderWidths("border-t-2 border-t-4", PHONE_WIDTH_IN_PX);
    }).toThrow(/border-t-2.*border-t-4/);
  });

  test("a state variant draws nothing at rest", () => {
    expect(resolveBorderWidths("hover:border", LAPTOP_WIDTH_IN_PX)).toEqual(
      sides(0, 0, 0, 0),
    );
  });
});

describe("resolveCornerRadii", () => {
  test("the scale, in px", () => {
    expect(resolveCornerRadii("rounded", PHONE_WIDTH_IN_PX)).toEqual(
      corners(4),
    );
    expect(resolveCornerRadii("rounded-md", PHONE_WIDTH_IN_PX)).toEqual(
      corners(6),
    );
    expect(resolveCornerRadii("rounded-lg", PHONE_WIDTH_IN_PX)).toEqual(
      corners(8),
    );
    expect(resolveCornerRadii("rounded-xl", PHONE_WIDTH_IN_PX)).toEqual(
      corners(12),
    );
    expect(resolveCornerRadii("rounded-none", PHONE_WIDTH_IN_PX)).toEqual(
      corners(0),
    );
    expect(resolveCornerRadii("rounded-[10px]", PHONE_WIDTH_IN_PX)).toEqual(
      corners(10),
    );
  });

  test("rounded from sm up only is square on a phone", () => {
    expect(resolveCornerRadii("sm:rounded-xl", PHONE_WIDTH_IN_PX)).toEqual(
      corners(0),
    );
    expect(resolveCornerRadii("sm:rounded-xl", SM_WIDTH_IN_PX)).toEqual(
      corners(12),
    );
  });

  test("a side and a corner win over all corners", () => {
    expect(
      resolveCornerRadii("rounded-t-none rounded-lg", PHONE_WIDTH_IN_PX),
    ).toEqual({ topLeft: 0, topRight: 0, bottomRight: 8, bottomLeft: 8 });
    expect(
      resolveCornerRadii("rounded-t-lg rounded-tl-none", PHONE_WIDTH_IN_PX),
    ).toEqual({ topLeft: 0, topRight: 8, bottomRight: 0, bottomLeft: 0 });
  });
});

describe("resolveShadow", () => {
  test("the shadow that applies at the width, or none", () => {
    expect(resolveShadow("shadow-sm", PHONE_WIDTH_IN_PX)).toBe("shadow-sm");
    expect(resolveShadow("sm:shadow-sm", PHONE_WIDTH_IN_PX)).toBeNull();
    expect(resolveShadow("sm:shadow-sm", SM_WIDTH_IN_PX)).toBe("shadow-sm");
    expect(resolveShadow("shadow-sm sm:shadow-none", LAPTOP_WIDTH_IN_PX)).toBe(
      null,
    );
    expect(resolveShadow("bg-white border", LAPTOP_WIDTH_IN_PX)).toBeNull();
  });

  test("two shadows at one place in the stylesheet throw", () => {
    expect(() => {
      return resolveShadow("shadow-sm shadow-md", PHONE_WIDTH_IN_PX);
    }).toThrow(/shadow-sm.*shadow-md/);
  });
});

describe("resolveFrame", () => {
  test("a card's frame, and the same frame given from sm up only", () => {
    const card: string =
      "bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible";
    const fromSmUp: string =
      "bg-white border-t border-gray-200 overflow-visible sm:border sm:rounded-xl sm:shadow-sm";

    for (const width of [
      SM_WIDTH_IN_PX,
      TABLET_WIDTH_IN_PX,
      LAPTOP_WIDTH_IN_PX,
    ]) {
      expect(resolveFrame(fromSmUp, width)).toEqual(resolveFrame(card, width));
    }

    expect(resolveFrame(fromSmUp, PHONE_WIDTH_IN_PX)).toEqual({
      border: sides(1, 0, 0, 0),
      radius: corners(0),
      shadow: null,
    });
  });
});
