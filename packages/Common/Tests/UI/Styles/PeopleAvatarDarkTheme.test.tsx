import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import PeopleAvatar from "../../../UI/Components/PeoplePicker/PeopleAvatar";
import { PeoplePickerKind } from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import {
  declaredValue,
  selectorsDeclaring,
  StyleRule,
  THEME_RULES,
} from "./ThemeStylesheet";

/*
 * A team's avatar is a dark slate tile (PeopleAvatar's group palette). On
 * the dark theme's surfaces it all but vanished - in the people row of an
 * incident's header, where the owner teams now sit beside the state, as on
 * an Owners page - so Theme.css lifts the group palette a few steps there.
 * The palette lives in the component and the lift in the stylesheet; this
 * holds the two together: every tile colour a team can get is lifted, and a
 * person's coloured circle is left as it is.
 */

const LIFTED_FROM: string = "#67778e var(--tw-gradient-from-position)";
const LIFTED_TO: string = "#64748b var(--tw-gradient-to-position)";

// Enough names to land on every entry of a five-colour palette.
const NAMES: Array<string> = Array.from(
  { length: 60 },
  (_value: unknown, index: number): string => {
    return `Team ${index} ${String.fromCharCode(65 + (index % 26))}`;
  },
);

function gradientFromClasses(
  kind: PeoplePickerKind,
  names: Array<string>,
): Set<string> {
  const classes: Set<string> = new Set<string>();

  for (const name of names) {
    const view: RenderResult = render(
      <PeopleAvatar item={{ kind: kind, name: name }} size="chip" />,
    );

    for (const element of Array.from(view.container.querySelectorAll("*"))) {
      for (const className of Array.from(element.classList)) {
        if (className.startsWith("from-")) {
          classes.add(className);
        }
      }
    }

    view.unmount();
  }

  return classes;
}

// Selectors the dark rule names, split at their commas by the reader.
function liftedSelectors(property: string, value: string): string {
  return selectorsDeclaring(property, value).join(",");
}

afterEach(() => {
  cleanup();
});

describe("a team's avatar in the dark theme", () => {
  const teamClasses: Set<string> = gradientFromClasses(
    PeoplePickerKind.Team,
    NAMES,
  );

  test("the group palette is the five dark tiles it was designed with", () => {
    expect(Array.from(teamClasses).sort()).toEqual([
      "from-gray-700",
      "from-neutral-700",
      "from-slate-700",
      "from-stone-700",
      "from-zinc-700",
    ]);
  });

  test("every tile a team can get is lifted, from and to, under html.dark only", () => {
    const from: string = liftedSelectors("--tw-gradient-from", LIFTED_FROM);
    const to: string = liftedSelectors("--tw-gradient-to", LIFTED_TO);

    expect(from.startsWith("html.dark :is(")).toBe(true);
    expect(to).toBe(from);

    for (const className of Array.from(teamClasses)) {
      expect(from).toContain(`.${className}`);
    }
  });

  test("a person's coloured circle is not touched", () => {
    const personClasses: Set<string> = gradientFromClasses(
      PeoplePickerKind.User,
      NAMES,
    );
    const from: string = liftedSelectors("--tw-gradient-from", LIFTED_FROM);

    expect(personClasses.size).toBeGreaterThan(0);

    for (const className of Array.from(personClasses)) {
      expect(from).not.toContain(`.${className}`);
    }
  });
});

/*
 * How the lifted tile reads, measured from the shipped stylesheet rather
 * than restated: every stop of it stands out from the dark theme's card and
 * from its grey wash (a hovered row, a secondary panel) at 3:1, the
 * contrast a person's coloured circle has, and keeps the team's white
 * initials at 4.5:1. The tile used to end on slate-700 (#334155), the
 * card's own colour within 1.6:1, so its lower edge and its people badge
 * dissolved into the card on every owners surface.
 */

function channel(value: number): number {
  const srgb: number = value / 255;

  return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const match: RegExpMatchArray | null = hex
    .trim()
    .match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);

  if (!match) {
    throw new Error(`Not a #rrggbb colour: ${hex}`);
  }

  return (
    0.2126 * channel(parseInt(match[1]!, 16)) +
    0.7152 * channel(parseInt(match[2]!, 16)) +
    0.0722 * channel(parseInt(match[3]!, 16))
  );
}

function contrast(first: string, second: string): number {
  const a: number = luminance(first);
  const b: number = luminance(second);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// The colour a stop declaration names: "#67778e var(--tw-gradient-from-position)".
function stopColour(declaration: string | undefined): string {
  const colour: string | undefined = declaration?.split(" ")[0];

  if (!colour) {
    throw new Error("The team tile rule declares no stop");
  }

  return colour;
}

// The html.dark rule that lifts the group palette, found by what it covers.
function teamTileRule(): StyleRule {
  const rule: StyleRule | undefined = THEME_RULES.find(
    (candidate: StyleRule): boolean => {
      return (
        candidate.selectors.join(",").startsWith("html.dark :is(") &&
        candidate.selectors.join(",").includes(".from-slate-700") &&
        candidate.declarations["--tw-gradient-from"] !== undefined
      );
    },
  );

  if (!rule) {
    throw new Error("Theme.css has no dark rule for a team's tile");
  }

  return rule;
}

function darkToken(name: string): string {
  const value: string | undefined = declaredValue("html.dark", name);

  if (!value) {
    throw new Error(`html.dark declares no ${name}`);
  }

  return value;
}

describe("a team's lifted tile on the dark theme's surfaces", () => {
  const rule: StyleRule = teamTileRule();
  const stops: Array<[string, string]> = [
    ["its lighter stop", stopColour(rule.declarations["--tw-gradient-from"])],
    ["its darker stop", stopColour(rule.declarations["--tw-gradient-to"])],
  ];
  const surfaces: Array<[string, string]> = [
    ["a card", darkToken("--ou-surface-primary")],
    ["a card's grey wash", darkToken("--ou-surface-secondary")],
  ];

  test("the rule this suite measures is the one the palette test pins", () => {
    expect(rule.declarations["--tw-gradient-from"]).toBe(LIFTED_FROM);
    expect(rule.declarations["--tw-gradient-to"]).toBe(LIFTED_TO);
  });

  for (const [stopName, stop] of stops) {
    for (const [surfaceName, surface] of surfaces) {
      test(`${stopName} (${stop}) stands out from ${surfaceName} (${surface}) at 3:1`, () => {
        expect(contrast(stop, surface)).toBeGreaterThanOrEqual(3);
      });
    }

    test(`the team's white initials read at 4.5:1 on ${stopName} (${stop})`, () => {
      expect(contrast("#ffffff", stop)).toBeGreaterThanOrEqual(4.5);
    });

    /*
     * The people badge is a disc of the card's own colour in the dark theme
     * (bg-white becomes the card): it reads only where the tile under it
     * stands apart from the card.
     */
    test(`the people badge, a disc of the card's colour, stands out on ${stopName}`, () => {
      expect(
        contrast(darkToken("--ou-surface-primary"), stop),
      ).toBeGreaterThanOrEqual(3);
    });
  }

  test("the measure fails the slate-700 end the tile used to have", () => {
    expect(contrast("#334155", darkToken("--ou-surface-primary"))).toBeLessThan(
      3,
    );
  });
});
