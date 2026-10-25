import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Button, {
  BUTTON_DISABLED_CLASS_NAME,
  BUTTON_DISABLED_CURSOR_CLASS_NAME,
  ButtonSize,
  ButtonStyleType,
  ComponentProps,
  OUTLINE_BUTTON_CLASS_NAME,
  OUTLINE_BUTTON_HOVER_CLASS_NAMES,
} from "../../../UI/Components/Button/Button";
import IconProp from "../../../Types/Icon/IconProp";
import { StyleRule, THEME_RULES } from "../Styles/ThemeStylesheet";

/*
 * The outline button and every button's disabled look.
 *
 * OUTLINE (and its HOVER_* variants) used to be two class names no
 * stylesheet defines - btn-outline-secondary and
 * background-very-light-Gray500-on-hover - on a block-level flex box: about
 * 200 buttons across the product, a network device's Ping and Traceroute
 * among them, had no border, no hover and no focus ring. And a disabled
 * NORMAL or OUTLINE button looked exactly like one that works until it was
 * hovered (only PRIMARY, SECONDARY and DANGER faded), so a locked action
 * looked pressable. These hold both to what the product draws now.
 */

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

type RenderButtonFunction = (props: Partial<ComponentProps>) => HTMLElement;

const renderButton: RenderButtonFunction = (
  props: Partial<ComponentProps>,
): HTMLElement => {
  const { unmount } = render(
    <Button dataTestId="button" title="Ping" {...props} />,
  );
  const button: HTMLElement = screen.getByTestId("button");
  const clone: HTMLElement = button.cloneNode(true) as HTMLElement;
  unmount();
  return clone;
};

const classesOf: (element: HTMLElement) => Array<string> = (
  element: HTMLElement,
): Array<string> => {
  return Array.from(element.classList);
};

const OUTLINE_STYLES: Array<[string, ButtonStyleType]> = [
  ["OUTLINE", ButtonStyleType.OUTLINE],
  ["HOVER_DANGER_OUTLINE", ButtonStyleType.HOVER_DANGER_OUTLINE],
  ["HOVER_SUCCESS_OUTLINE", ButtonStyleType.HOVER_SUCCESS_OUTLINE],
  ["HOVER_PRIMARY_OUTLINE", ButtonStyleType.HOVER_PRIMARY_OUTLINE],
];

const ALL_STYLES: Array<[string, ButtonStyleType]> = Object.keys(
  ButtonStyleType,
)
  .filter((key: string) => {
    return isNaN(Number(key));
  })
  .map((key: string): [string, ButtonStyleType] => {
    return [key, ButtonStyleType[key as keyof typeof ButtonStyleType]];
  });

// The filled styles, whose disabled look was a paler fill of their own.
const FILLED_STYLES: Array<[string, ButtonStyleType]> = [
  ["PRIMARY", ButtonStyleType.PRIMARY],
  ["SECONDARY", ButtonStyleType.SECONDARY],
  ["DANGER", ButtonStyleType.DANGER],
  ["SUCCESS", ButtonStyleType.SUCCESS],
  ["WARNING", ButtonStyleType.WARNING],
];

// The classes no stylesheet in the repository defines.
const UNDEFINED_OUTLINE_CLASSES: Array<string> = [
  "btn-outline-secondary",
  "background-very-light-Gray500-on-hover",
];

// NORMAL's look, without what lays it out in a dialog's footer.
const NORMAL_LAYOUT_CLASSES: Array<string> = [
  "w-full",
  "md:w-auto",
  "md:ml-3",
  "md:mt-0",
];

describe("an outline button has a border, a fill, a hover and a focus ring", () => {
  test.each(OUTLINE_STYLES)(
    "%s draws a grey border round a white fill, in the reading text",
    (_name: string, buttonStyle: ButtonStyleType) => {
      const button: HTMLElement = renderButton({ buttonStyle });

      expect(button).toHaveClass(
        "border",
        "border-gray-300",
        "bg-white",
        "text-gray-700",
        "font-medium",
        "rounded-md",
        "shadow-sm",
      );
    },
  );

  test.each(OUTLINE_STYLES)(
    "%s rings on keyboard focus only",
    (_name: string, buttonStyle: ButtonStyleType) => {
      const button: HTMLElement = renderButton({ buttonStyle });

      expect(button).toHaveClass(
        "focus:outline-none",
        "focus-visible:ring-2",
        "focus-visible:ring-indigo-500",
        "focus-visible:ring-offset-2",
      );
    },
  );

  test.each(OUTLINE_STYLES)(
    "%s carries neither of the class names no stylesheet defines, enabled or not",
    (_name: string, buttonStyle: ButtonStyleType) => {
      for (const disabled of [false, true]) {
        const classes: Array<string> = classesOf(
          renderButton({ buttonStyle, disabled }),
        );

        for (const undefinedClass of UNDEFINED_OUTLINE_CLASSES) {
          expect(classes).not.toContain(undefinedClass);
        }
      }
    },
  );

  test("OUTLINE's hover is NORMAL's: a pale grey wash", () => {
    expect(renderButton({ buttonStyle: ButtonStyleType.OUTLINE })).toHaveClass(
      "hover:bg-gray-50",
    );
    expect(renderButton({ buttonStyle: ButtonStyleType.NORMAL })).toHaveClass(
      "hover:bg-gray-50",
    );
  });

  test.each([
    [
      "HOVER_DANGER_OUTLINE",
      ButtonStyleType.HOVER_DANGER_OUTLINE,
      ["hover:bg-red-50", "hover:text-red-700"],
    ],
    [
      "HOVER_SUCCESS_OUTLINE",
      ButtonStyleType.HOVER_SUCCESS_OUTLINE,
      ["hover:bg-green-50", "hover:text-green-700"],
    ],
    [
      "HOVER_PRIMARY_OUTLINE",
      ButtonStyleType.HOVER_PRIMARY_OUTLINE,
      ["hover:bg-indigo-50", "hover:text-indigo-700"],
    ],
  ])(
    "%s rests as an outline button and tints its hover with what it does",
    (_name: string, buttonStyle: ButtonStyleType, hover: Array<string>) => {
      const button: HTMLElement = renderButton({ buttonStyle });

      expect(button).toHaveClass(...hover);
      expect(button).not.toHaveClass("hover:bg-gray-50");
      // At rest it is the plain outline button.
      expect(button).toHaveClass(
        "border-gray-300",
        "bg-white",
        "text-gray-700",
      );
    },
  );

  test("every outline style's hover tint is the one the style map names", () => {
    for (const [, buttonStyle] of OUTLINE_STYLES) {
      const tint: string =
        OUTLINE_BUTTON_HOVER_CLASS_NAMES[
          buttonStyle as keyof typeof OUTLINE_BUTTON_HOVER_CLASS_NAMES
        ];

      expect(tint.length).toBeGreaterThan(0);
      expect(renderButton({ buttonStyle })).toHaveClass(...tint.split(" "));
    }
  });
});

describe("an outline button is the plain bordered button, sized to its label", () => {
  test("it draws exactly NORMAL's border, fill, text, shadow and focus ring", () => {
    const outline: Array<string> = classesOf(
      renderButton({ buttonStyle: ButtonStyleType.OUTLINE }),
    );
    const normal: Array<string> = classesOf(
      renderButton({ buttonStyle: ButtonStyleType.NORMAL }),
    );

    // NORMAL's look, less what lays it out in a dialog's footer.
    const normalLook: Array<string> = normal.filter((token: string) => {
      return !NORMAL_LAYOUT_CLASSES.includes(token);
    });

    expect(outline.sort()).toEqual(normalLook.sort());
  });

  test.each(OUTLINE_STYLES)(
    "%s is an inline box as wide as its label at every width, with no margin of its own",
    (_name: string, buttonStyle: ButtonStyleType) => {
      const classes: Array<string> = classesOf(renderButton({ buttonStyle }));

      expect(classes).toContain("inline-flex");
      expect(classes).toContain("justify-center");
      expect(classes).toContain("items-center");
      // A block-level box stretched across a block parent with its border.
      expect(classes).not.toContain("flex");

      for (const layoutClass of NORMAL_LAYOUT_CLASSES) {
        expect(classes).not.toContain(layoutClass);
      }

      expect(
        classes.filter((token: string) => {
          return /^(?:[a-z]+:)?-?m[lrxy]?-/u.test(token);
        }),
      ).toEqual([]);
    },
  );

  test("its label is the reading size on a phone and a control's from md up, as NORMAL's is", () => {
    expect(renderButton({ buttonStyle: ButtonStyleType.OUTLINE })).toHaveClass(
      "text-base",
      "md:text-sm",
    );
  });

  test("its size is the button's size, as for every style", () => {
    expect(
      renderButton({
        buttonStyle: ButtonStyleType.OUTLINE,
        buttonSize: ButtonSize.Small,
      }),
    ).toHaveClass("px-2", "py-1");
    expect(renderButton({ buttonStyle: ButtonStyleType.OUTLINE })).toHaveClass(
      "px-3",
      "py-2",
    );
  });

  test("the exported class name is what the button draws", () => {
    expect(renderButton({ buttonStyle: ButtonStyleType.OUTLINE })).toHaveClass(
      ...OUTLINE_BUTTON_CLASS_NAME.split(" "),
    );
  });

  test("an icon-only outline button (a menu toggle) keeps its border too", () => {
    const button: HTMLElement = renderButton({
      buttonStyle: ButtonStyleType.OUTLINE,
      title: undefined,
      icon: IconProp.Bars3,
      className: "p-2",
    });

    expect(button).toHaveClass("border", "border-gray-300", "bg-white", "p-2");
    expect(button.querySelector("svg")).not.toBeNull();
  });
});

describe("a disabled button looks it", () => {
  test.each(ALL_STYLES)(
    "%s fades, with the not-allowed cursor, when disabled",
    (_name: string, buttonStyle: ButtonStyleType) => {
      expect(renderButton({ buttonStyle, disabled: true })).toHaveClass(
        ...BUTTON_DISABLED_CLASS_NAME.split(" "),
      );
    },
  );

  test.each(ALL_STYLES)(
    "%s does not fade when it can be pressed",
    (_name: string, buttonStyle: ButtonStyleType) => {
      for (const disabled of [false, undefined]) {
        const classes: Array<string> = classesOf(
          renderButton({ buttonStyle, disabled }),
        );

        expect(classes).not.toContain("opacity-50");
        expect(classes).not.toContain("cursor-not-allowed");
      }
    },
  );

  /*
   * A filled style keeps its fill and fades with it: a paler fill of its own
   * (indigo-300, red-300) was a bright block in the dark theme, brighter than
   * the enabled button, and SECONDARY's was darker than its own light fill.
   */
  test.each(FILLED_STYLES)(
    "%s keeps its own fill when locked and fades as a whole, in both themes",
    (_name: string, buttonStyle: ButtonStyleType) => {
      const disabled: Array<string> = classesOf(
        renderButton({ buttonStyle, disabled: true }),
      );
      const enabled: Array<string> = classesOf(renderButton({ buttonStyle }));

      const fill: (classes: Array<string>) => string | undefined = (
        classes: Array<string>,
      ): string | undefined => {
        return classes.find((token: string) => {
          return token.startsWith("bg-");
        });
      };

      expect(fill(disabled)).toBeDefined();
      expect(fill(disabled)).toBe(fill(enabled));
      expect(disabled).toContain("opacity-50");
      expect(disabled).toContain(BUTTON_DISABLED_CURSOR_CLASS_NAME);
      expect(disabled).not.toContain("bg-indigo-300");
      expect(disabled).not.toContain("bg-red-300");
    },
  );

  test.each(ALL_STYLES)(
    "%s keeps no hover of its own when disabled",
    (_name: string, buttonStyle: ButtonStyleType) => {
      const classes: Array<string> = classesOf(
        renderButton({ buttonStyle, disabled: true }),
      );

      expect(
        classes.filter((token: string) => {
          return token.startsWith("hover:");
        }),
      ).toEqual([]);
    },
  );

  test("the plain button a dialog's Cancel and a card's Edit use: faded and hoverless when locked", () => {
    const locked: HTMLElement = renderButton({
      buttonStyle: ButtonStyleType.NORMAL,
      disabled: true,
    });

    expect(locked).toBeDisabled();
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(locked).toHaveClass("opacity-50", "cursor-not-allowed");
    expect(locked).not.toHaveClass("hover:bg-gray-50");
    // Still the bordered button, so it reads as the same control, locked.
    expect(locked).toHaveClass("border-gray-300", "bg-white");
  });

  test("a loading button is busy, not locked: it keeps its look and shows its spinner", () => {
    for (const [, buttonStyle] of ALL_STYLES) {
      const busy: HTMLElement = renderButton({
        buttonStyle,
        isLoading: true,
      });

      expect(busy).toBeDisabled();
      expect(busy).not.toHaveClass("opacity-50");
      expect(busy).not.toHaveClass("cursor-not-allowed");
    }

    const busyOutline: HTMLElement = renderButton({
      buttonStyle: ButtonStyleType.OUTLINE,
      isLoading: true,
    });

    expect(busyOutline.querySelector(".animate-spin")).not.toBeNull();
  });

  /*
   * A link's spinner sits on its words' line: drawn as a block, a busy
   * Resend or Show more pushed its words onto a line of their own.
   */
  test.each([
    ["LINK", ButtonStyleType.LINK],
    ["SECONDARY_LINK", ButtonStyleType.SECONDARY_LINK],
  ])(
    "a busy %s keeps its spinner beside its words",
    (_name: string, buttonStyle: ButtonStyleType) => {
      const busy: HTMLElement = renderButton({
        buttonStyle,
        isLoading: true,
      });

      expect(busy).toHaveClass("flex");
      expect(busy.querySelector(".animate-spin")).not.toBeNull();
      expect(busy).toHaveTextContent("Ping");

      // A plain link with no icon and nothing to wait for stays inline.
      expect(renderButton({ buttonStyle })).not.toHaveClass("flex");
    },
  );

  /*
   * Logical margins: the gap sits between the icon and the words whichever
   * way the page reads. A right margin left a Persian button's icon touching
   * its words.
   */
  test("an icon's and a spinner's gap is on the words' side in either direction", () => {
    const withIcon: HTMLElement = renderButton({
      buttonStyle: ButtonStyleType.OUTLINE,
      icon: IconProp.Refresh,
    });
    const icon: Element | null = withIcon.querySelector("svg");

    expect(icon).toHaveClass("me-1");
    expect(icon).not.toHaveClass("mr-1");

    const busy: HTMLElement = renderButton({
      buttonStyle: ButtonStyleType.NORMAL,
      isLoading: true,
    });
    const spinner: Element | null = busy.querySelector(".animate-spin");

    expect(spinner).toHaveClass("-ms-1", "me-3");
    expect(spinner).not.toHaveClass("mr-3");
    expect(spinner).not.toHaveClass("-ml-1");
  });

  test("a locked button that is also loading fades as well", () => {
    expect(
      renderButton({
        buttonStyle: ButtonStyleType.OUTLINE,
        disabled: true,
        isLoading: true,
      }),
    ).toHaveClass("opacity-50", "cursor-not-allowed");
  });

  test("a disabled button never fires its click", () => {
    const onClick: jest.Mock = jest.fn();

    render(
      <Button
        dataTestId="locked"
        title="Ping"
        buttonStyle={ButtonStyleType.OUTLINE}
        disabled={true}
        onClick={onClick}
      />,
    );

    fireEvent.click(screen.getByTestId("locked"));

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("a locked button with a reason", () => {
  test("the wrapper the pointer reaches shows the not-allowed cursor", () => {
    render(
      <Button
        dataTestId="locked"
        title="Reset API Key"
        buttonStyle={ButtonStyleType.NORMAL}
        disabled={true}
        tooltip="Your role cannot change API keys."
      />,
    );

    const wrapper: HTMLElement = screen.getByTestId("locked-disabled-wrapper");

    expect(wrapper).toHaveClass("inline-flex", "cursor-not-allowed");
    // The button itself takes no pointer, so the wrapper's cursor shows.
    expect(screen.getByTestId("locked")).toHaveClass("pointer-events-none");
    expect(screen.getByTestId("locked")).toHaveClass("opacity-50");
  });

  test("a loading button's wrapper keeps the pointer's own cursor", () => {
    render(
      <Button
        dataTestId="busy"
        title="Reset API Key"
        buttonStyle={ButtonStyleType.NORMAL}
        isLoading={true}
        tooltip="Resetting the key."
      />,
    );

    expect(screen.getByTestId("busy-disabled-wrapper")).not.toHaveClass(
      "cursor-not-allowed",
    );
  });

  test("the reason is still read on hover", () => {
    render(
      <Button
        dataTestId="locked"
        title="Ping"
        buttonStyle={ButtonStyleType.OUTLINE}
        disabled={true}
        tooltip="Runs from this device's probe, which is offline."
      />,
    );

    fireEvent.mouseEnter(screen.getByTestId("locked-disabled-wrapper"));

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Runs from this device's probe, which is offline.",
    );
  });
});

/*
 * Theme.css re-colours the dashboards' light classes in the dark theme. A
 * class with no rule keeps its light colour there - a white button on a
 * slate card - so every colour the outline styles draw needs one.
 */
const darkRuleCovers: (token: string) => boolean = (token: string): boolean => {
  return THEME_RULES.some((rule: StyleRule) => {
    const selectorText: string = rule.selectors.join(", ");

    if (!selectorText.includes("html.dark")) {
      return false;
    }

    if (!token.includes(":") && selectorText.includes(`.${token}`)) {
      return true;
    }

    if (selectorText.includes(`[class~="${token}"]`)) {
      return true;
    }

    // [class*="hover:text-red-"] covers every hover:text-red-* class.
    return Array.from(selectorText.matchAll(/\[class\*="([^"]+)"\]/gu)).some(
      (match: RegExpMatchArray) => {
        return token.startsWith(match[1]!);
      },
    );
  });
};

const COLOUR_TOKEN: RegExp =
  /^(?:hover:|focus-visible:)?(?:bg|text|border|ring)-(?:white|black|[a-z]+-\d{2,3})$/u;

describe("the outline styles in the dark theme", () => {
  test.each(OUTLINE_STYLES)(
    "every colour %s draws, at rest and on hover, has a dark rule",
    (_name: string, buttonStyle: ButtonStyleType) => {
      const colours: Array<string> = classesOf(
        renderButton({ buttonStyle }),
      ).filter((token: string) => {
        return COLOUR_TOKEN.test(token);
      });

      expect(colours.length).toBeGreaterThan(3);

      for (const colour of colours) {
        expect({ colour, covered: darkRuleCovers(colour) }).toEqual({
          colour,
          covered: true,
        });
      }
    },
  );

  test("the helper finds a rule only where Theme.css has one", () => {
    expect(darkRuleCovers("bg-white")).toBe(true);
    expect(darkRuleCovers("hover:text-red-700")).toBe(true);
    expect(darkRuleCovers("bg-fuchsia-950")).toBe(false);
    expect(darkRuleCovers("hover:border-red-300")).toBe(false);
  });
});

/*
 * No frontend - Dashboard, Admin Dashboard, Accounts, Status Page, Public
 * Dashboard, the shared components or ee/ - draws the two class names no
 * stylesheet defines: a button given them would be bare text again.
 */
const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

const FRONTEND_SOURCE_DIRS: Array<string> = [
  "packages/Common/UI",
  "packages/App/FeatureSet/Dashboard/src",
  "packages/App/FeatureSet/AdminDashboard/src",
  "packages/App/FeatureSet/Accounts/src",
  "packages/App/FeatureSet/StatusPage/src",
  "packages/App/FeatureSet/PublicDashboard/src",
  "ee/Dashboard",
  "ee/AdminDashboard",
];

const listSourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "build") {
        files.push(...listSourceFiles(entryPath));
      }
      continue;
    }

    if (/\.(?:tsx?|jsx?|css|ejs|html)$/u.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
};

describe("no frontend draws the outline class names no stylesheet defines", () => {
  test("none of their source names them", () => {
    const offenders: Array<string> = [];
    let read: number = 0;

    for (const directory of FRONTEND_SOURCE_DIRS) {
      for (const file of listSourceFiles(
        path.join(REPOSITORY_ROOT, directory),
      )) {
        read++;
        const source: string = fs.readFileSync(file, "utf8");

        for (const undefinedClass of UNDEFINED_OUTLINE_CLASSES) {
          if (source.indexOf(undefinedClass) !== -1) {
            offenders.push(
              `${path.relative(REPOSITORY_ROOT, file)}: ${undefinedClass}`,
            );
          }
        }
      }
    }

    // The walk reached the frontends, so an empty list means something.
    expect(read).toBeGreaterThan(1000);
    expect(offenders).toEqual([]);
  });
});
