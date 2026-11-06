import { describe, expect, test } from "@jest/globals";
import {
  FACET_SIDEBAR_DEFAULT_WIDTH_IN_PX,
  FACET_SIDEBAR_FIT_ROUNDING_IN_PX,
  FACET_SIDEBAR_MAX_SHARE_OF_ROOM,
  FACET_SIDEBAR_MAX_WIDTH_IN_PX,
  FACET_SIDEBAR_MIN_WIDTH_IN_PX,
  FACET_SIDEBAR_RESIZE_LARGE_STEP_IN_PX,
  FACET_SIDEBAR_RESIZE_STEP_IN_PX,
  FACET_SIDEBAR_WIDTH_ANONYMOUS_PERSON,
  FACET_SIDEBAR_WIDTH_CLASS_NAME,
  FACET_SIDEBAR_WIDTH_PROPERTY,
  FacetSidebarResizeKeyResult,
  clampFacetSidebarWidth,
  getFacetSidebarFitWidth,
  getFacetSidebarMaxWidth,
  getFacetSidebarWidthPreferenceKey,
  getFacetSidebarWidthStyle,
  getKeyboardResizedFacetSidebarWidth,
  getPointerResizedFacetSidebarWidth,
  readFacetSidebarWidth,
} from "../../../../UI/Components/TelemetryViewer/FacetSidebarWidth";
import {
  COLUMN_RESIZE_LARGE_STEP_IN_PX,
  COLUMN_RESIZE_STEP_IN_PX,
} from "../../../../UI/Components/Table/ColumnResize/ColumnWidths";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

/*
 * How wide the filters sidebar may be, and what a drag, a key or a
 * double-click on its edge makes it (issue #5773: "The sidebar has a fixed
 * width, which can make longer service names difficult to read"). The
 * arithmetic, apart from the page: the sidebar's edge and its remembered
 * width (FacetSidebarResize.test.tsx, useFacetSidebarWidth.test.tsx) only
 * read and write what these rules give.
 */

const MIN: number = FACET_SIDEBAR_MIN_WIDTH_IN_PX;
const MAX: number = FACET_SIDEBAR_MAX_WIDTH_IN_PX;
const DEFAULT: number = FACET_SIDEBAR_DEFAULT_WIDTH_IN_PX;

// A key on the edge, at a width, with room for the widest sidebar.
const pressKey: (data: {
  key: string;
  width?: number;
  shiftKey?: boolean;
  fitWidth?: number | null;
  maxWidth?: number;
  isRightToLeft?: boolean;
}) => FacetSidebarResizeKeyResult = (data: {
  key: string;
  width?: number;
  shiftKey?: boolean;
  fitWidth?: number | null;
  maxWidth?: number;
  isRightToLeft?: boolean;
}): FacetSidebarResizeKeyResult => {
  return getKeyboardResizedFacetSidebarWidth({
    key: data.key,
    shiftKey: data.shiftKey ?? false,
    width: data.width ?? DEFAULT,
    fitWidth: data.fitWidth === undefined ? null : data.fitWidth,
    maxWidth: data.maxWidth ?? MAX,
    isRightToLeft: data.isRightToLeft ?? false,
  });
};

describe("the sidebar's bounds", () => {
  test("until a person sizes it, it is the 14rem it always was", () => {
    expect(DEFAULT).toBe(224);
    expect(DEFAULT).toBe(14 * 16);
  });

  test("it goes from 11rem to 40rem, the default between them", () => {
    expect(MIN).toBe(176);
    expect(MAX).toBe(640);
    expect(MIN).toBeLessThan(DEFAULT);
    expect(DEFAULT).toBeLessThan(MAX);
  });

  test("its width class reads the kept width, falls back to 14rem, and never takes more than half the room", () => {
    expect(FACET_SIDEBAR_WIDTH_PROPERTY).toBe("--ou-facet-sidebar-width");
    expect(FACET_SIDEBAR_WIDTH_CLASS_NAME.split(" ")).toEqual([
      `md:w-[var(${FACET_SIDEBAR_WIDTH_PROPERTY},14rem)]`,
      `md:max-w-[${FACET_SIDEBAR_MAX_SHARE_OF_ROOM * 100}%]`,
    ]);
    // The fallback is the default width, written in rem.
    expect(`${DEFAULT / 16}rem`).toBe("14rem");
  });

  test("its width applies from md up only: below md the sidebar stacks at full width", () => {
    for (const token of FACET_SIDEBAR_WIDTH_CLASS_NAME.split(" ")) {
      expect(token.startsWith("md:")).toBe(true);
    }
  });

  test("the arrow keys step as far as a table column's edge does", () => {
    expect(FACET_SIDEBAR_RESIZE_STEP_IN_PX).toBe(COLUMN_RESIZE_STEP_IN_PX);
    expect(FACET_SIDEBAR_RESIZE_LARGE_STEP_IN_PX).toBe(
      COLUMN_RESIZE_LARGE_STEP_IN_PX,
    );
  });
});

describe("getFacetSidebarMaxWidth: the room it shares with the list", () => {
  test("half the facets + list area", () => {
    expect(getFacetSidebarMaxWidth(1000)).toBe(500);
    expect(getFacetSidebarMaxWidth(901)).toBe(450);
    expect(getFacetSidebarMaxWidth(800)).toBe(400);
  });

  test("never more than 40rem, however wide the area", () => {
    expect(getFacetSidebarMaxWidth(1280)).toBe(MAX);
    expect(getFacetSidebarMaxWidth(3840)).toBe(MAX);
  });

  test("never less than 11rem, however narrow the area", () => {
    expect(getFacetSidebarMaxWidth(300)).toBe(MIN);
    expect(getFacetSidebarMaxWidth(351)).toBe(MIN);
    expect(getFacetSidebarMaxWidth(1)).toBe(MIN);
  });

  test("an area not measured leaves only the 40rem", () => {
    for (const room of [undefined, null, 0, -20, NaN, Infinity]) {
      expect({ room, max: getFacetSidebarMaxWidth(room) }).toEqual({
        room,
        max: MAX,
      });
    }
  });
});

describe("clampFacetSidebarWidth", () => {
  test("keeps a width in bounds as it is", () => {
    expect(clampFacetSidebarWidth(300)).toBe(300);
    expect(clampFacetSidebarWidth(MIN)).toBe(MIN);
    expect(clampFacetSidebarWidth(MAX)).toBe(MAX);
  });

  test("holds a width to 11rem and 40rem", () => {
    expect(clampFacetSidebarWidth(10)).toBe(MIN);
    expect(clampFacetSidebarWidth(-500)).toBe(MIN);
    expect(clampFacetSidebarWidth(5000)).toBe(MAX);
  });

  test("draws whole pixels", () => {
    expect(clampFacetSidebarWidth(300.4)).toBe(300);
    expect(clampFacetSidebarWidth(300.5)).toBe(301);
  });

  test("holds it to the room's most too, but never below 11rem nor above 40rem", () => {
    expect(clampFacetSidebarWidth(600, 450)).toBe(450);
    expect(clampFacetSidebarWidth(300, 450)).toBe(300);
    expect(clampFacetSidebarWidth(600, 100)).toBe(MIN);
    expect(clampFacetSidebarWidth(900, 2000)).toBe(MAX);
    expect(clampFacetSidebarWidth(900, NaN)).toBe(MAX);
  });

  test("a width that is not a number is the narrowest", () => {
    expect(clampFacetSidebarWidth(NaN)).toBe(MIN);
    expect(clampFacetSidebarWidth(Infinity)).toBe(MIN);
  });
});

describe("getPointerResizedFacetSidebarWidth: a drag", () => {
  test("on a page read left to right, the sidebar follows the pointer to the right", () => {
    expect(
      getPointerResizedFacetSidebarWidth({
        startWidth: 224,
        startX: 300,
        x: 400,
        isRightToLeft: false,
        maxWidth: MAX,
      }),
    ).toBe(324);
    expect(
      getPointerResizedFacetSidebarWidth({
        startWidth: 224,
        startX: 300,
        x: 260,
        isRightToLeft: false,
        maxWidth: MAX,
      }),
    ).toBe(184);
  });

  test("on a page read right to left, the sidebar stands at the right: a drag to the left widens it", () => {
    expect(
      getPointerResizedFacetSidebarWidth({
        startWidth: 224,
        startX: 900,
        x: 800,
        isRightToLeft: true,
        maxWidth: MAX,
      }),
    ).toBe(324);
    expect(
      getPointerResizedFacetSidebarWidth({
        startWidth: 224,
        startX: 900,
        x: 940,
        isRightToLeft: true,
        maxWidth: MAX,
      }),
    ).toBe(184);
  });

  test("stops at 11rem and at the room's most, however far the pointer goes", () => {
    expect(
      getPointerResizedFacetSidebarWidth({
        startWidth: 224,
        startX: 300,
        x: -2000,
        isRightToLeft: false,
        maxWidth: MAX,
      }),
    ).toBe(MIN);
    expect(
      getPointerResizedFacetSidebarWidth({
        startWidth: 224,
        startX: 300,
        x: 5000,
        isRightToLeft: false,
        maxWidth: 450,
      }),
    ).toBe(450);
  });

  test("a pointer that has not moved leaves the width as it was", () => {
    expect(
      getPointerResizedFacetSidebarWidth({
        startWidth: 333,
        startX: 300,
        x: 300,
        isRightToLeft: false,
        maxWidth: MAX,
      }),
    ).toBe(333);
  });
});

describe("getKeyboardResizedFacetSidebarWidth: a key on the edge", () => {
  test("the arrows move the edge the way they point, 16px a press", () => {
    expect(pressKey({ key: "ArrowRight", width: 224 })).toEqual({
      kind: "width",
      width: 240,
    });
    expect(pressKey({ key: "ArrowLeft", width: 224 })).toEqual({
      kind: "width",
      width: 208,
    });
  });

  test("with Shift, 64px a press", () => {
    expect(pressKey({ key: "ArrowRight", width: 224, shiftKey: true })).toEqual(
      { kind: "width", width: 288 },
    );
    expect(pressKey({ key: "ArrowLeft", width: 288, shiftKey: true })).toEqual({
      kind: "width",
      width: 224,
    });
  });

  test("on a page read right to left, the left arrow widens", () => {
    expect(
      pressKey({ key: "ArrowLeft", width: 224, isRightToLeft: true }),
    ).toEqual({ kind: "width", width: 240 });
    expect(
      pressKey({ key: "ArrowRight", width: 224, isRightToLeft: true }),
    ).toEqual({ kind: "width", width: 208 });
  });

  test("the arrows stop at 11rem and at the room's most", () => {
    expect(pressKey({ key: "ArrowLeft", width: MIN })).toEqual({
      kind: "width",
      width: MIN,
    });
    expect(pressKey({ key: "ArrowRight", width: 450, maxWidth: 450 })).toEqual(
      { kind: "width", width: 450 },
    );
  });

  test("Home makes it as narrow as it goes", () => {
    expect(pressKey({ key: "Home", width: 500 })).toEqual({
      kind: "width",
      width: MIN,
    });
  });

  test("End and Enter fit it to its names, within the room", () => {
    for (const key of ["End", "Enter"]) {
      expect(pressKey({ key, width: 224, fitWidth: 380 })).toEqual({
        kind: "width",
        width: 380,
      });
      expect(
        pressKey({ key, width: 224, fitWidth: 900, maxWidth: 450 }),
      ).toEqual({ kind: "width", width: 450 });
    }
  });

  test("End and Enter with nothing to fit leave it as it is", () => {
    for (const key of ["End", "Enter"]) {
      expect(pressKey({ key, width: 300, fitWidth: null })).toEqual({
        kind: "width",
        width: 300,
      });
    }
  });

  test("Delete and Backspace give it back its own width", () => {
    expect(pressKey({ key: "Delete", width: 500 })).toEqual({
      kind: "default",
    });
    expect(pressKey({ key: "Backspace", width: 500 })).toEqual({
      kind: "default",
    });
  });

  test("any other key goes on to the page", () => {
    for (const key of [
      "Tab",
      "Escape",
      " ",
      "a",
      "ArrowUp",
      "ArrowDown",
      "PageUp",
      "PageDown",
    ]) {
      expect({ key, result: pressKey({ key }) }).toEqual({
        key,
        result: null,
      });
    }
  });
});

describe("getFacetSidebarFitWidth: a double-click fits the names it lists", () => {
  test("widens until the name that lacks the most shows whole, and a pixel more for the rounding", () => {
    expect(FACET_SIDEBAR_FIT_ROUNDING_IN_PX).toBe(1);
    expect(
      getFacetSidebarFitWidth({
        width: 224,
        nameShortfalls: [40, -12, 96, 3],
        maxWidth: MAX,
      }),
    ).toBe(224 + 96 + 1);
  });

  test("narrows a sidebar wider than its names need, to the name with the least to spare", () => {
    expect(
      getFacetSidebarFitWidth({
        width: 600,
        nameShortfalls: [-120, -200, -90],
        maxWidth: MAX,
      }),
    ).toBe(600 - 90 + 1);
  });

  test("never narrower than its own 14rem: a list of short names fits back to it", () => {
    expect(
      getFacetSidebarFitWidth({
        width: 600,
        nameShortfalls: [-500, -450],
        maxWidth: MAX,
      }),
    ).toBe(DEFAULT);
    expect(
      getFacetSidebarFitWidth({
        width: MIN,
        nameShortfalls: [-10],
        maxWidth: MAX,
      }),
    ).toBe(DEFAULT);
  });

  test("never wider than the room allows: a longer name stays cut short", () => {
    expect(
      getFacetSidebarFitWidth({
        width: 224,
        nameShortfalls: [2000],
        maxWidth: 450,
      }),
    ).toBe(450);
    expect(
      getFacetSidebarFitWidth({
        width: 224,
        nameShortfalls: [2000],
        maxWidth: 5000,
      }),
    ).toBe(MAX);
  });

  test("rounds a part of a pixel up, so no name is cut by it", () => {
    expect(
      getFacetSidebarFitWidth({
        width: 224.4,
        nameShortfalls: [10.2],
        maxWidth: MAX,
      }),
    ).toBe(Math.ceil(224.4 + 10.2) + 1);
  });

  test("with no names listed there is nothing to fit", () => {
    expect(
      getFacetSidebarFitWidth({ width: 224, nameShortfalls: [], maxWidth: MAX }),
    ).toBeNull();
    expect(
      getFacetSidebarFitWidth({
        width: 224,
        nameShortfalls: [NaN, Infinity],
        maxWidth: MAX,
      }),
    ).toBeNull();
    expect(
      getFacetSidebarFitWidth({ width: NaN, nameShortfalls: [4], maxWidth: MAX }),
    ).toBeNull();
  });

  test("a name not measured is left out, not read as nothing", () => {
    expect(
      getFacetSidebarFitWidth({
        width: 224,
        nameShortfalls: [NaN, 50],
        maxWidth: MAX,
      }),
    ).toBe(224 + 50 + 1);
  });
});

describe("readFacetSidebarWidth: a stored width read back", () => {
  test("a number of pixels is kept, held to the bounds", () => {
    expect(readFacetSidebarWidth(320)).toBe(320);
    expect(readFacetSidebarWidth(320.6)).toBe(321);
    expect(readFacetSidebarWidth(20)).toBe(MIN);
    expect(readFacetSidebarWidth(99999)).toBe(MAX);
  });

  test("a number written as text is read as one", () => {
    expect(readFacetSidebarWidth("320")).toBe(320);
    expect(readFacetSidebarWidth(" 300 ")).toBe(300);
  });

  test("anything else is no width at all: the sidebar is its own 14rem", () => {
    for (const value of [
      null,
      undefined,
      "",
      "   ",
      "wide",
      "320px",
      0,
      -40,
      NaN,
      Infinity,
      -Infinity,
      true,
      false,
      {},
      { width: 320 },
      [320],
      [],
    ]) {
      expect({ value, width: readFacetSidebarWidth(value) }).toEqual({
        value,
        width: null,
      });
    }
  });
});

describe("getFacetSidebarWidthStyle", () => {
  test("no width kept: no style, so the class's 14rem applies", () => {
    expect(getFacetSidebarWidthStyle(null)).toBeUndefined();
    expect(getFacetSidebarWidthStyle(undefined)).toBeUndefined();
    expect(getFacetSidebarWidthStyle(NaN)).toBeUndefined();
  });

  test("a kept width, in the property the class reads", () => {
    expect(getFacetSidebarWidthStyle(320)).toEqual({
      "--ou-facet-sidebar-width": "320px",
    });
  });

  test("held to the bounds, in whole pixels", () => {
    expect(getFacetSidebarWidthStyle(9000)).toEqual({
      "--ou-facet-sidebar-width": `${MAX}px`,
    });
    expect(getFacetSidebarWidthStyle(3)).toEqual({
      "--ou-facet-sidebar-width": `${MIN}px`,
    });
    expect(getFacetSidebarWidthStyle(300.7)).toEqual({
      "--ou-facet-sidebar-width": "301px",
    });
  });
});

describe("getFacetSidebarWidthPreferenceKey: one entry per person", () => {
  test("is the person's id", () => {
    expect(
      getFacetSidebarWidthPreferenceKey("8a3b0c3e-0000-4000-8000-0000000000aa"),
    ).toBe("8a3b0c3e-0000-4000-8000-0000000000aa");
    expect(getFacetSidebarWidthPreferenceKey("  abc  ")).toBe("abc");
  });

  test("with no one signed in, one entry for whoever reads the page", () => {
    expect(FACET_SIDEBAR_WIDTH_ANONYMOUS_PERSON).toBe("anyone");

    for (const personId of [undefined, null, "", "   "]) {
      expect(getFacetSidebarWidthPreferenceKey(personId)).toBe("anyone");
    }
  });
});

describe("whatever the inputs (seeded sweep)", () => {
  const random: SeededRandom = seededRandom(5773);
  const SWEEPS: number = 2000;

  // A width anywhere from off the low end to off the high end.
  const anyWidth: () => number = (): number => {
    return random(1200) - 200 + random();
  };

  test("a drag always draws a whole width within the bounds and the room", () => {
    for (let index: number = 0; index < SWEEPS; index++) {
      const maxWidth: number = getFacetSidebarMaxWidth(random(2400));
      const width: number = getPointerResizedFacetSidebarWidth({
        startWidth: anyWidth(),
        startX: random(2000),
        x: random(2000),
        isRightToLeft: random(2) === 1,
        maxWidth: maxWidth,
      });

      expect(Number.isInteger(width)).toBe(true);
      expect(width).toBeGreaterThanOrEqual(MIN);
      expect(width).toBeLessThanOrEqual(Math.max(MIN, Math.min(MAX, maxWidth)));
    }
  });

  test("a drag never moves the edge against the pointer", () => {
    for (let index: number = 0; index < SWEEPS; index++) {
      const isRightToLeft: boolean = random(2) === 1;
      const startWidth: number = MIN + random(MAX - MIN);
      const startX: number = random(2000);
      const firstX: number = random(2000);
      const secondX: number = firstX + random(400);

      const first: number = getPointerResizedFacetSidebarWidth({
        startWidth,
        startX,
        x: firstX,
        isRightToLeft,
        maxWidth: MAX,
      });
      const second: number = getPointerResizedFacetSidebarWidth({
        startWidth,
        startX,
        x: secondX,
        isRightToLeft,
        maxWidth: MAX,
      });

      // Further right is never narrower left to right, nor wider right to left.
      if (isRightToLeft) {
        expect(second).toBeLessThanOrEqual(first);
      } else {
        expect(second).toBeGreaterThanOrEqual(first);
      }
    }
  });

  test("an arrow and its opposite give the width back, away from the bounds", () => {
    for (let index: number = 0; index < SWEEPS; index++) {
      const shiftKey: boolean = random(2) === 1;
      const isRightToLeft: boolean = random(2) === 1;
      const step: number = shiftKey
        ? FACET_SIDEBAR_RESIZE_LARGE_STEP_IN_PX
        : FACET_SIDEBAR_RESIZE_STEP_IN_PX;
      const width: number = MIN + step + random(MAX - MIN - 2 * step);

      const there: FacetSidebarResizeKeyResult = pressKey({
        key: "ArrowRight",
        width,
        shiftKey,
        isRightToLeft,
      });
      const back: FacetSidebarResizeKeyResult = pressKey({
        key: "ArrowLeft",
        width: (there as { kind: "width"; width: number }).width,
        shiftKey,
        isRightToLeft,
      });

      expect(back).toEqual({ kind: "width", width });
    }
  });

  test("a fit is always within the bounds and the room, and never below 14rem the room allows", () => {
    for (let index: number = 0; index < SWEEPS; index++) {
      const maxWidth: number = getFacetSidebarMaxWidth(random(2400));
      const names: Array<number> = Array.from(
        { length: 1 + random(12) },
        (): number => {
          return random(900) - 450;
        },
      );
      const fit: number | null = getFacetSidebarFitWidth({
        width: MIN + random(MAX - MIN),
        nameShortfalls: names,
        maxWidth: maxWidth,
      });

      expect(fit).not.toBeNull();
      expect(fit as number).toBeGreaterThanOrEqual(
        Math.min(DEFAULT, Math.max(MIN, maxWidth)),
      );
      expect(fit as number).toBeLessThanOrEqual(
        Math.max(MIN, Math.min(MAX, maxWidth)),
      );
    }
  });

  test("a fit shows every name whole when the room allows it", () => {
    for (let index: number = 0; index < SWEEPS; index++) {
      const width: number = MIN + random(MAX - MIN);
      const names: Array<number> = Array.from(
        { length: 1 + random(12) },
        (): number => {
          return random(400) - 200;
        },
      );
      const fit: number = getFacetSidebarFitWidth({
        width,
        nameShortfalls: names,
        maxWidth: MAX,
      }) as number;
      const needed: number = width + Math.max(...names);

      if (needed <= MAX - FACET_SIDEBAR_FIT_ROUNDING_IN_PX) {
        // Wide enough for the name that lacks the most, with its pixel.
        expect(fit).toBeGreaterThanOrEqual(
          Math.min(MAX, Math.ceil(needed) + FACET_SIDEBAR_FIT_ROUNDING_IN_PX),
        );
      }
    }
  });

  test("whatever is stored, what is read back is a width the sidebar may be, or none", () => {
    for (let index: number = 0; index < SWEEPS; index++) {
      const value: unknown = [
        anyWidth(),
        String(anyWidth()),
        `${random(900)}px`,
        random(2) === 1,
        null,
        { width: anyWidth() },
      ][random(6)];
      const width: number | null = readFacetSidebarWidth(value);

      if (width !== null) {
        expect(Number.isInteger(width)).toBe(true);
        expect(width).toBeGreaterThanOrEqual(MIN);
        expect(width).toBeLessThanOrEqual(MAX);
      }
    }
  });
});
