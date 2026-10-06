import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import * as BrandColors from "../../../Types/BrandColors";
import Color, { RGB } from "../../../Types/Color";
import HashCode from "../../../Types/HashCode";
import { getContrastRatio, parseColor } from "../../../Utils/ColorContrast";
import { DISTINCT_COLORS, getColorHue } from "../../../Utils/DistinctColor";
import {
  LIGHT_MARK_COLOR,
  MIN_MARK_CONTRAST,
  getMarkColor,
} from "../../../UI/Components/ColorPicker/ColorValue";
import {
  UserAvatarStyle,
  getColorForUserId,
  getUserAvatarStyle,
  getUserInitials,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerUserColors";

/*
 * A person's colour on the on-call screens (LayerUserColors).
 *
 * Every avatar, calendar block, timeline bar and legend dot on the on-call
 * screens colours a person from their user id. The colours used to come from
 * BrandColors.BrightColors, which starts with black and holds a grey: about
 * one person in twenty came out black - an avatar the dark theme swallowed -
 * and another one in twenty grey, which reads as a disabled account. People
 * are now coloured from Utils/DistinctColor's palette, the one new labels and
 * states get their colours from. What is pinned:
 *
 *   - every person's colour is a palette colour: never black, white or grey,
 *     and at least 3:1 against the light and the dark card;
 *   - it is worked out from the user id alone, the same every time, so a
 *     person is one colour on every card and every page, and nothing is
 *     stored;
 *   - people spread evenly over the palette;
 *   - an initials avatar pairs the colour with the mark colour that reads on
 *     it (white, at least 3:1, on every palette colour), given inline so the
 *     dark theme cannot recolour it.
 */

const THEME_CSS: string = fs.readFileSync(
  path.resolve(__dirname, "../../../UI/Styles/Theme.css"),
  "utf8",
);

const SURFACE_TOKEN: RegExp = /--ou-surface-primary:\s*([^;]+);/;

// The surface a card sits on, in one theme's block of Theme.css.
function surfaceIn(block: string): RGB {
  const start: number = THEME_CSS.indexOf(block);

  expect(start).toBeGreaterThanOrEqual(0);

  const match: RegExpExecArray | null = SURFACE_TOKEN.exec(
    THEME_CSS.slice(start),
  );

  expect(match).not.toBeNull();

  const rgb: RGB | null = parseColor(match![1]!.trim());

  expect(rgb).not.toBeNull();

  return rgb!;
}

const LIGHT_SURFACE: RGB = surfaceIn(":root {");
const DARK_SURFACE: RGB = surfaceIn("html.dark {");

// WCAG 2.1's minimum for a coloured dot, avatar or swatch (1.4.11).
const NON_TEXT_CONTRAST: number = 3;

const PALETTE: Array<string> = DISTINCT_COLORS.map((color: Color): string => {
  return color.toString();
});

const WHITE: RGB = { red: 255, green: 255, blue: 255 };

const HEX_COLOR: RegExp = /^#[0-9a-f]{6}$/;

/*
 * User ids shaped the way the database writes them (lowercase uuid v4), from
 * a fixed seed, so every run checks the same people. The top bits of a
 * linear congruential generator are its good ones.
 */
function makeUserIds(count: number, seed: number = 20261006): Array<string> {
  let state: number = seed >>> 0;

  const nextHexDigit: () => string = (): string => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 28).toString(16);
  };

  const hexDigits: (length: number) => string = (length: number): string => {
    let text: string = "";

    for (let index: number = 0; index < length; index++) {
      text += nextHexDigit();
    }

    return text;
  };

  const ids: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    const variant: string = "89ab"[parseInt(nextHexDigit(), 16) % 4]!;

    ids.push(
      `${hexDigits(8)}-${hexDigits(4)}-4${hexDigits(3)}-${variant}${hexDigits(3)}-${hexDigits(12)}`,
    );
  }

  return ids;
}

const USER_IDS: Array<string> = makeUserIds(2000);

// How the colour used to be picked: BrightColors, by the same hash.
function getOldColorForUserId(userId: string): string {
  return BrandColors.BrightColors[
    Math.abs(HashCode.fromString(userId)) % BrandColors.BrightColors.length
  ]!.toString();
}

describe("a person's colour on the on-call screens", () => {
  test("the ids this suite checks look like the database's", () => {
    expect(new Set(USER_IDS).size).toBe(USER_IDS.length);

    for (const userId of USER_IDS.slice(0, 50)) {
      expect(userId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  test("is always a colour of the shared palette, written as lowercase hex", () => {
    for (const userId of USER_IDS) {
      const color: string = getColorForUserId(userId);

      expect({ userId, color, inPalette: PALETTE.includes(color) }).toEqual({
        userId,
        color,
        inPalette: true,
      });
      expect(color).toMatch(HEX_COLOR);
    }
  });

  test("is never black, white or grey", () => {
    const neutrals: Array<string> = [
      BrandColors.Black,
      BrandColors.White,
      BrandColors.Gray500,
      BrandColors.Grey,
      BrandColors.Slate500,
      BrandColors.Zinc500,
      BrandColors.Stone500,
      BrandColors.Neutra500l,
      BrandColors.LightGray,
      BrandColors.VeryLightGray,
    ].map((color: Color): string => {
      return color.toString().toLowerCase();
    });

    for (const userId of USER_IDS) {
      const color: string = getColorForUserId(userId);

      expect({ userId, hue: getColorHue(color) }).not.toEqual({
        userId,
        hue: null,
      });
      expect(neutrals).not.toContain(color);
    }
  });

  test("shows on both themes: at least 3:1 against the light and the dark card", () => {
    expect(LIGHT_SURFACE).toEqual({ red: 255, green: 255, blue: 255 });
    expect(DARK_SURFACE).toEqual({ red: 23, green: 32, blue: 51 });

    const seen: Set<string> = new Set<string>(
      USER_IDS.map((userId: string): string => {
        return getColorForUserId(userId);
      }),
    );

    for (const color of Array.from(seen)) {
      const rgb: RGB = parseColor(color)!;

      expect({
        color,
        light: getContrastRatio(rgb, LIGHT_SURFACE) >= NON_TEXT_CONTRAST,
        dark: getContrastRatio(rgb, DARK_SURFACE) >= NON_TEXT_CONTRAST,
      }).toEqual({ color, light: true, dark: true });
    }
  });

  test("is the same for the same person, every time it is asked", () => {
    const first: Array<string> = USER_IDS.map((userId: string): string => {
      return getColorForUserId(userId);
    });

    // Asked again, in the opposite order: nothing depends on who came before.
    const second: Array<string> = [...USER_IDS]
      .reverse()
      .map((userId: string): string => {
        return getColorForUserId(userId);
      })
      .reverse();

    expect(second).toEqual(first);
  });

  test("is pinned for known ids, so a change to the rule is a decision, not an accident", () => {
    /*
     * Changing how a person's colour is worked out recolours every person on
     * every customer's screens at once. That may be right, but it should be
     * chosen: these pins make such a change show up in review.
     */
    const pins: Array<[string, Color]> = [
      ["a3f1c2d4-5b6e-4f70-8a9b-0c1d2e3f4a5b", BrandColors.Sky600],
      ["b7e2d3c4-6a5f-4e81-9b0c-1d2e3f4a5b6c", BrandColors.Lime600],
      ["c9d8e7f6-a5b4-4c3d-8e2f-1a0b9c8d7e6f", BrandColors.Amber600],
      ["d1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e5f6", BrandColors.Pink500],
      // An id with nothing in it still gets a colour: the palette's first.
      ["", BrandColors.Indigo500],
    ];

    for (const [userId, expected] of pins) {
      expect({ userId, color: getColorForUserId(userId) }).toEqual({
        userId,
        color: expected.toString(),
      });
    }
  });

  test("comes from the user id alone, read the way the database writes it", () => {
    const userId: string = "bbbbbbbb-2222-4222-8222-222222222222";
    const color: string = getColorForUserId(userId);

    // Case and stray spaces are not a different person.
    expect(getColorForUserId(userId.toUpperCase())).toBe(color);
    expect(getColorForUserId(`  ${userId}\n`)).toBe(color);
  });

  test("spreads people evenly over the palette", () => {
    const ids: Array<string> = makeUserIds(10000, 4207);
    const counts: Map<string, number> = new Map<string, number>();

    for (const userId of ids) {
      const color: string = getColorForUserId(userId);
      counts.set(color, (counts.get(color) || 0) + 1);
    }

    // Every colour is used.
    expect(Array.from(counts.keys()).sort()).toEqual([...PALETTE].sort());

    // And none by much more or less than its share (a tenth, here).
    const share: number = ids.length / PALETTE.length;

    for (const [color, count] of Array.from(counts.entries())) {
      expect({
        color,
        fair: count > share * 0.8 && count < share * 1.2,
      }).toEqual({ color, fair: true });
    }
  });

  test("two people on a rotation look alike no more often than they used to", () => {
    /*
     * Ten colours instead of twenty sounds like more people sharing one. But
     * many of the twenty were near twins (indigo, violet and blue; pink, rose
     * and fuchsia; green and emerald), so pairs that LOOK alike - the same
     * hue family - were about as common then. Measured over the same people.
     */
    const ids: Array<string> = makeUserIds(400, 77);
    let pairs: number = 0;
    let alikeBefore: number = 0;
    let alikeNow: number = 0;

    const looksAlike: (first: string, second: string) => boolean = (
      first: string,
      second: string,
    ): boolean => {
      if (first === second) {
        return true;
      }

      const firstHue: number | null = getColorHue(first);
      const secondHue: number | null = getColorHue(second);

      if (firstHue === null || secondHue === null) {
        return false;
      }

      const distance: number = Math.abs(firstHue - secondHue) % 360;

      return Math.min(distance, 360 - distance) < 20;
    };

    for (let first: number = 0; first < ids.length; first++) {
      for (let second: number = first + 1; second < ids.length; second++) {
        pairs++;

        if (
          looksAlike(
            getOldColorForUserId(ids[first]!),
            getOldColorForUserId(ids[second]!),
          )
        ) {
          alikeBefore++;
        }

        if (
          looksAlike(
            getColorForUserId(ids[first]!),
            getColorForUserId(ids[second]!),
          )
        ) {
          alikeNow++;
        }
      }
    }

    expect(alikeNow / pairs).toBeLessThanOrEqual(alikeBefore / pairs + 0.01);
    // About one pair in ten: the palette's ten hue families.
    expect(alikeNow / pairs).toBeLessThan(0.12);
  });
});

/*
 * The bug this replaces: the old rule really did draw people black and grey,
 * and those same people now get a colour.
 */
describe("the people the old palette drew black or grey", () => {
  const black: string = BrandColors.Black.toString();
  const grey: string = BrandColors.Gray500.toString();

  const drawnBlack: Array<string> = USER_IDS.filter(
    (userId: string): boolean => {
      return getOldColorForUserId(userId) === black;
    },
  );
  const drawnGrey: Array<string> = USER_IDS.filter(
    (userId: string): boolean => {
      return getOldColorForUserId(userId) === grey;
    },
  );

  test("were about one in twenty each", () => {
    // BrightColors still starts with black and holds a grey.
    expect(BrandColors.BrightColors[0]!.toString()).toBe(black);
    expect(
      BrandColors.BrightColors.map((color: Color): string => {
        return color.toString();
      }),
    ).toContain(grey);

    for (const affected of [drawnBlack, drawnGrey]) {
      const share: number = affected.length / USER_IDS.length;

      expect(share).toBeGreaterThan(0.03);
      expect(share).toBeLessThan(0.07);
    }
  });

  test("now each get a colour of the palette", () => {
    for (const userId of [...drawnBlack, ...drawnGrey]) {
      const color: string = getColorForUserId(userId);

      expect({ userId, inPalette: PALETTE.includes(color) }).toEqual({
        userId,
        inPalette: true,
      });
      expect(color).not.toBe(black);
      expect(color).not.toBe(grey);
    }
  });

  test("and every one of them now shows on the dark card", () => {
    for (const userId of drawnBlack) {
      const before: RGB = parseColor(getOldColorForUserId(userId))!;
      const now: RGB = parseColor(getColorForUserId(userId))!;

      expect(getContrastRatio(before, DARK_SURFACE)).toBeLessThan(
        NON_TEXT_CONTRAST,
      );
      expect(getContrastRatio(now, DARK_SURFACE)).toBeGreaterThanOrEqual(
        NON_TEXT_CONTRAST,
      );
    }
  });
});

describe("an initials avatar", () => {
  test("is the person's colour behind initials in the mark colour that reads on it", () => {
    for (const userId of USER_IDS.slice(0, 200)) {
      const style: UserAvatarStyle = getUserAvatarStyle(userId);

      expect(style).toEqual({
        backgroundColor: getColorForUserId(userId),
        color: getMarkColor(getColorForUserId(userId)),
      });
    }
  });

  test("has white initials on every palette colour, at least 3:1", () => {
    for (const color of PALETTE) {
      expect({ color, mark: getMarkColor(color) }).toEqual({
        color,
        mark: LIGHT_MARK_COLOR,
      });
      expect(
        getContrastRatio(parseColor(color)!, WHITE),
      ).toBeGreaterThanOrEqual(MIN_MARK_CONTRAST);
    }
  });

  test("names both colours as colours, not theme classes, so the dark theme cannot fade the initials", () => {
    const style: UserAvatarStyle = getUserAvatarStyle(USER_IDS[0]!);

    expect(Object.keys(style).sort()).toEqual(["backgroundColor", "color"]);
    expect(style.backgroundColor).toMatch(HEX_COLOR);
    expect(style.color).toMatch(HEX_COLOR);
  });

  test("is the same pair for the same person every time", () => {
    const userId: string = USER_IDS[1]!;

    expect(getUserAvatarStyle(userId)).toEqual(getUserAvatarStyle(userId));
    expect(getUserAvatarStyle(userId.toUpperCase())).toEqual(
      getUserAvatarStyle(userId),
    );
  });

  test("hands out a fresh object, so one card cannot recolour another", () => {
    const userId: string = USER_IDS[2]!;
    const first: UserAvatarStyle = getUserAvatarStyle(userId);

    first.backgroundColor = "#000000";

    expect(getUserAvatarStyle(userId).backgroundColor).toBe(
      getColorForUserId(userId),
    );
  });
});

describe("initials", () => {
  test("are the first letters of the first two names", () => {
    expect(getUserInitials("Alice Scheduled", "alice@example.com")).toBe("AS");
    expect(getUserInitials("ada lovelace byron", "")).toBe("AL");
  });

  test("are the first two letters of a single name", () => {
    expect(getUserInitials("Bob", "bob@example.com")).toBe("BO");
  });

  test("come from the email when there is no name", () => {
    expect(getUserInitials("", "carol@example.com")).toBe("CA");
  });

  test("are a question mark for nobody at all", () => {
    expect(getUserInitials("", "")).toBe("?");
  });

  test("ignore extra spaces", () => {
    expect(getUserInitials("  Dee   Dee  ", "")).toBe("DD");
  });
});
