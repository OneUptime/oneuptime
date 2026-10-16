import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import Button, {
  ButtonStyleType,
} from "../../../../UI/Components/Button/Button";
import {
  getSignInOptionClassName,
  SIGN_IN_OPTION_ICON_CLASS,
  SIGN_IN_OPTION_LAYOUT_CLASS,
  SIGN_IN_OPTION_LOOK_CLASS,
  SIGN_IN_OPTION_STATES,
  SignInOptionState,
} from "../../../../UI/Components/SignInOption/SignInOptionStyle";

/*
 * The look of a sign-in page's other ways in (SignInOptionStyle): a normal,
 * full-width, outlined button, as tall as the filled button above it, in one
 * of four states - ready, busy, paused, unavailable.
 */

// A class with a variant (hover:, md:, focus-visible:, disabled: ...).
const VARIANT: RegExp = /^[a-z-]+:/;

// What a class sets, for the classes these looks use.
const TEXT_SIZE: RegExp = /^text-(xs|sm|base|lg|xl|[2-9]xl)$/;
const TEXT_ALIGN: RegExp = /^text-(left|center|right|start|end|justify)$/;
const TEXT_COLOUR: RegExp = /^text-(white|black|[a-z]+-\d{2,3})$/;
const BACKGROUND_COLOUR: RegExp =
  /^bg-(white|black|transparent|[a-z]+-\d{2,3})$/;
const BORDER_WIDTH: RegExp = /^border(-[0-8])?$/;
const BORDER_COLOUR: RegExp = /^border-(transparent|[a-z]+-\d{2,3})$/;
const SHADOW: RegExp = /^shadow(-(sm|md|lg|xl|none))?$/;
const OPACITY: RegExp = /^opacity-\d+$/;
const CURSOR: RegExp = /^cursor-/;
const FILLED: RegExp = /^bg-(indigo|red|green|yellow)-600$/;

type PropertyRule = { property: string; pattern: RegExp };

const PROPERTY_RULES: Array<PropertyRule> = [
  { property: "font-size", pattern: TEXT_SIZE },
  { property: "text-align", pattern: TEXT_ALIGN },
  { property: "color", pattern: TEXT_COLOUR },
  { property: "background-color", pattern: BACKGROUND_COLOUR },
  { property: "border-width", pattern: BORDER_WIDTH },
  { property: "border-color", pattern: BORDER_COLOUR },
  { property: "box-shadow", pattern: SHADOW },
  { property: "opacity", pattern: OPACITY },
  { property: "cursor", pattern: CURSOR },
];

const classesOf: (className: string) => Array<string> = (
  className: string,
): Array<string> => {
  return className.split(" ").filter((name: string) => {
    return name.length > 0;
  });
};

// The classes that apply without any variant, grouped by what they set.
const propertiesSet: (className: string) => Record<string, Array<string>> = (
  className: string,
): Record<string, Array<string>> => {
  const byProperty: Record<string, Array<string>> = {};

  for (const name of classesOf(className)) {
    if (VARIANT.test(name)) {
      continue;
    }

    for (const rule of PROPERTY_RULES) {
      if (rule.pattern.test(name)) {
        byProperty[rule.property] = [
          ...(byProperty[rule.property] || []),
          name,
        ];
      }
    }
  }

  return byProperty;
};

const hoverClasses: (className: string) => Array<string> = (
  className: string,
): Array<string> => {
  return classesOf(className).filter((name: string) => {
    return name.startsWith("hover:") || name.startsWith("enabled:hover:");
  });
};

describe("SignInOptionStyle", () => {
  afterEach(() => {
    cleanup();
  });

  test("lists exactly the four states it draws", () => {
    expect([...SIGN_IN_OPTION_STATES]).toEqual([
      "ready",
      "busy",
      "paused",
      "unavailable",
    ]);
    expect(Object.keys(SIGN_IN_OPTION_LOOK_CLASS).sort()).toEqual(
      [...SIGN_IN_OPTION_STATES].sort(),
    );
  });

  test("a sign-in option is ready unless it says otherwise", () => {
    expect(getSignInOptionClassName()).toBe(getSignInOptionClassName("ready"));
  });

  test.each([...SIGN_IN_OPTION_STATES])(
    "%s: the same full-width, outlined box with the keyboard focus ring",
    (state: SignInOptionState) => {
      const classes: Array<string> = classesOf(getSignInOptionClassName(state));

      for (const name of classesOf(SIGN_IN_OPTION_LAYOUT_CLASS)) {
        expect(classes).toContain(name);
      }
      expect(classes).toEqual(
        expect.arrayContaining([
          "flex",
          "w-full",
          "items-center",
          "justify-center",
          "gap-2",
          "rounded-md",
          "border",
          "font-medium",
          "focus:outline-none",
          "focus-visible:ring-2",
          "focus-visible:ring-indigo-500",
          "focus-visible:ring-offset-2",
          "motion-reduce:transition-none",
        ]),
      );
      // Outlined, never filled: the page's filled button is its own action.
      expect(
        classes.filter((name: string) => {
          return FILLED.test(name);
        }),
      ).toEqual([]);
    },
  );

  /*
   * Tailwind settles two classes that set one property by the order of its
   * stylesheet, not the order of the class list: "border-gray-300
   * border-gray-200" draws whichever the stylesheet happens to define last.
   * So no state may ask for two values of one property.
   */
  test.each([...SIGN_IN_OPTION_STATES])(
    "%s: no two classes set the same property",
    (state: SignInOptionState) => {
      const byProperty: Record<string, Array<string>> = propertiesSet(
        getSignInOptionClassName(state),
      );

      for (const [property, names] of Object.entries(byProperty)) {
        expect({ state, property, names }).toEqual({
          state,
          property,
          names: [names[0]],
        });
      }
      // Every state says what it draws for each of these.
      expect(Object.keys(byProperty).sort()).toEqual(
        expect.arrayContaining([
          "background-color",
          "border-color",
          "border-width",
          "color",
          "cursor",
          "font-size",
        ]),
      );
    },
  );

  test("the property check sees a clash (positive control)", () => {
    const clashing: Record<string, Array<string>> = propertiesSet(
      "border border-gray-300 border-gray-200 text-base text-gray-700 hover:bg-gray-50 bg-white",
    );

    expect(clashing["border-color"]).toEqual([
      "border-gray-300",
      "border-gray-200",
    ]);
    expect(clashing["border-width"]).toEqual(["border"]);
    expect(clashing["font-size"]).toEqual(["text-base"]);
    expect(clashing["color"]).toEqual(["text-gray-700"]);
    // A hover class sets nothing until the pointer is over it.
    expect(clashing["background-color"]).toEqual(["bg-white"]);
  });

  test("ready: a white, outlined button with a hover, and the pointer", () => {
    const className: string = getSignInOptionClassName("ready");

    expect(classesOf(className)).toEqual(
      expect.arrayContaining([
        "bg-white",
        "border-gray-300",
        "text-gray-700",
        "shadow-sm",
        "cursor-pointer",
      ]),
    );
    expect(hoverClasses(className)).toEqual(["hover:bg-gray-50"]);
    expect(propertiesSet(className)["opacity"]).toBeUndefined();
  });

  test("busy: full strength, without a hover - the attempt it runs is what is happening", () => {
    const busy: Record<string, Array<string>> = propertiesSet(
      getSignInOptionClassName("busy"),
    );
    const ready: Record<string, Array<string>> = propertiesSet(
      getSignInOptionClassName("ready"),
    );

    expect(hoverClasses(getSignInOptionClassName("busy"))).toEqual([]);
    expect(busy["opacity"]).toBeUndefined();
    expect(busy["cursor"]).toEqual(["cursor-default"]);
    // Otherwise drawn exactly as when it is ready.
    for (const property of [
      "background-color",
      "border-color",
      "color",
      "box-shadow",
    ]) {
      expect(busy[property]).toEqual(ready[property]);
    }
  });

  test("paused: faded like a paused form, without a hover", () => {
    const paused: Record<string, Array<string>> = propertiesSet(
      getSignInOptionClassName("paused"),
    );

    expect(paused["opacity"]).toEqual(["opacity-50"]);
    expect(paused["cursor"]).toEqual(["cursor-default"]);
    expect(hoverClasses(getSignInOptionClassName("paused"))).toEqual([]);
  });

  test("unavailable: drawn disabled - grey, flat, no hover - with words dark enough to read", () => {
    const unavailable: Record<string, Array<string>> = propertiesSet(
      getSignInOptionClassName("unavailable"),
    );

    expect(unavailable["background-color"]).toEqual(["bg-gray-50"]);
    expect(unavailable["border-color"]).toEqual(["border-gray-200"]);
    expect(unavailable["box-shadow"]).toBeUndefined();
    expect(unavailable["cursor"]).toEqual(["cursor-default"]);
    expect(hoverClasses(getSignInOptionClassName("unavailable"))).toEqual([]);
    // gray-500 on gray-50 is 4.6:1; gray-400 was too faint to read.
    expect(unavailable["color"]).toEqual(["text-gray-500"]);
    expect(unavailable["opacity"]).toBeUndefined();
  });

  test("only the ready look reacts to the pointer", () => {
    for (const state of SIGN_IN_OPTION_STATES) {
      expect({
        state,
        hover: hoverClasses(getSignInOptionClassName(state)).length > 0,
      }).toEqual({ state, hover: state === "ready" });
    }
  });

  /*
   * As tall as the filled button above it: the same padding, type size and
   * border as Button's PRIMARY, which the sign-in forms draw their own
   * button with.
   */
  test("has the box and type of the filled button it sits under", () => {
    render(
      <Button
        title="Login"
        dataTestId="filled"
        buttonStyle={ButtonStyleType.PRIMARY}
      />,
    );
    const filled: Array<string> = classesOf(
      screen.getByTestId("filled").className,
    );
    const option: Array<string> = classesOf(getSignInOptionClassName());

    for (const name of [
      "px-3",
      "py-2",
      "text-base",
      "md:text-sm",
      "font-medium",
      "rounded-md",
      "border",
    ]) {
      expect({ name, filled: filled.includes(name) }).toEqual({
        name,
        filled: true,
      });
      expect({ name, option: option.includes(name) }).toEqual({
        name,
        option: true,
      });
    }
  });

  test("the icon is the size of the label's line and never squeezed", () => {
    expect(classesOf(SIGN_IN_OPTION_ICON_CLASS).sort()).toEqual(
      ["h-5", "shrink-0", "w-5"].sort(),
    );
  });
});
