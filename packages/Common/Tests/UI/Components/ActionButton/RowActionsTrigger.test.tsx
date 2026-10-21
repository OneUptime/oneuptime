import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../../UI/Components/ActionButton/ActionButtonSchema";
import RowActions from "../../../../UI/Components/ActionButton/RowActions";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import MoreMenu from "../../../../UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "../../../../UI/Components/MoreMenu/MoreMenuItem";
import IconProp from "../../../../Types/Icon/IconProp";
import { StyleRule, THEME_RULES } from "../../Styles/ThemeStylesheet";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

/*
 * The ⋯ at the end of every row used to be drawn as a small outlined button:
 * a grey border, a white fill and a shadow, sat beside the row's own outlined
 * button. Two boxes side by side read as two equal buttons. The ⋯ in a card
 * header has never had any of that - it is a bare icon - and the row's ⋯ now
 * matches it. These tests hold the trigger to that: nothing that draws a box
 * around it at rest, still a clear target on hover and on keyboard focus, the
 * same height as the button beside it, and readable in the dark theme.
 *
 * jsdom does not run Tailwind, so what the trigger looks like is read from the
 * utility classes it carries.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.setTimeout(30000);

interface Cluster {
  id: string;
  name: string;
}

const CLUSTER: Cluster = { id: "prod-eu", name: "prod-eu-west-1" };

const SHOW_ID: ActionButtonSchema<Cluster> = {
  title: "Show ID",
  icon: IconProp.Identification,
  buttonStyleType: ButtonStyleType.OUTLINE,
  hideOnMobile: true,
  placement: ActionButtonPlacement.MoreMenu,
  onClick: () => {},
};

const VIEW: ActionButtonSchema<Cluster> = {
  title: "View Kubernetes Cluster",
  icon: IconProp.Eye,
  buttonStyleType: ButtonStyleType.NORMAL,
  placement: ActionButtonPlacement.Primary,
  onClick: () => {},
};

const EDIT: ActionButtonSchema<Cluster> = {
  title: "Edit",
  icon: IconProp.Edit,
  buttonStyleType: ButtonStyleType.OUTLINE,
  onClick: () => {},
};

const DELETE: ActionButtonSchema<Cluster> = {
  title: "Delete",
  icon: IconProp.Trash,
  buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
  onClick: () => {},
};

interface RenderOptions {
  isMobile?: boolean;
  className?: string;
  itemLabel?: string;
}

const renderRow: (
  actionButtons: Array<ActionButtonSchema<Cluster>>,
  options?: RenderOptions,
) => RenderResult = (
  actionButtons: Array<ActionButtonSchema<Cluster>>,
  options?: RenderOptions,
): RenderResult => {
  return render(
    <RowActions<Cluster>
      item={CLUSTER}
      actionButtons={actionButtons}
      isMobile={options?.isMobile}
      className={options?.className}
      itemLabel={options?.itemLabel}
    />,
  );
};

const getTrigger: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("row-actions-more-button");
};

/*
 * Tailwind variants, split into the ones that hold whatever the pointer and
 * focus are doing (a breakpoint) and the ones that only apply in a state.
 */
const RESPONSIVE_VARIANTS: Array<string> = ["sm", "md", "lg", "xl", "2xl"];

const stripVariants: (token: string) => string = (token: string): string => {
  return token.split(":").pop() || token;
};

const variantsOf: (token: string) => Array<string> = (
  token: string,
): Array<string> => {
  return token.split(":").slice(0, -1);
};

// Every class that applies with no hover, focus or press on the element.
const restingUtilities: (element: HTMLElement) => Array<string> = (
  element: HTMLElement,
): Array<string> => {
  return Array.from(element.classList)
    .filter((token: string) => {
      return variantsOf(token).every((variant: string) => {
        return RESPONSIVE_VARIANTS.includes(variant);
      });
    })
    .map(stripVariants);
};

// Every class, in any state, without its variants.
const allUtilities: (element: HTMLElement) => Array<string> = (
  element: HTMLElement,
): Array<string> => {
  return Array.from(element.classList).map(stripVariants);
};

const BORDER_LAYOUT_UTILITY: RegExp =
  /^border(?:-[xytrblse])?(?:-(?:0|2|4|8|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing.*))?$/;

// `border-[3px]` - an arbitrary border width, not a colour.
const BORDER_ARBITRARY_WIDTH_UTILITY: RegExp = /^border-\[\d/;

const SHADOW_UTILITY: RegExp = /^shadow(?:-(?:sm|md|lg|xl|2xl|inner))?$/;

// `ring`, `ring-1`, `ring-2` - a ring's width, which is what makes it show.
const RING_WIDTH_UTILITY: RegExp = /^ring(?:-(?:0|1|2|4|8|inset|\[.+\]))?$/;

const NEUTRAL_TEXT_COLOUR_UTILITY: RegExp = /^text-(?:gray|slate)-\d+$/;

// `border-gray-300`, `border-red-700/50`, `border-white` - a border colour.
const isBorderColourUtility: (utility: string) => boolean = (
  utility: string,
): boolean => {
  return (
    utility.startsWith("border-") &&
    !BORDER_LAYOUT_UTILITY.test(utility) &&
    !BORDER_ARBITRARY_WIDTH_UTILITY.test(utility)
  );
};

const isShadowUtility: (utility: string) => boolean = (
  utility: string,
): boolean => {
  return SHADOW_UTILITY.test(utility);
};

const isRingWidthUtility: (utility: string) => boolean = (
  utility: string,
): boolean => {
  return RING_WIDTH_UTILITY.test(utility);
};

/*
 * A trigger that draws no box: no visible border colour in any state, no
 * shadow in any state, no fill at rest and no ring other than a focus ring.
 */
const expectNoOutline: (element: HTMLElement) => void = (
  element: HTMLElement,
): void => {
  expect(
    allUtilities(element).filter((utility: string) => {
      return isBorderColourUtility(utility) && utility !== "border-transparent";
    }),
  ).toEqual([]);

  expect(allUtilities(element).filter(isShadowUtility)).toEqual([]);

  expect(
    restingUtilities(element).filter((utility: string) => {
      return utility.startsWith("bg-") && utility !== "bg-transparent";
    }),
  ).toEqual([]);

  expect(
    Array.from(element.classList).filter((token: string) => {
      return (
        isRingWidthUtility(stripVariants(token)) &&
        !variantsOf(token).some((variant: string) => {
          return variant === "focus" || variant === "focus-visible";
        })
      );
    }),
  ).toEqual([]);
};

const darkRuleCovers: (
  selectorFragment: string,
  property: string,
) => boolean = (selectorFragment: string, property: string): boolean => {
  return THEME_RULES.some((rule: StyleRule) => {
    const selectorText: string = rule.selectors.join(", ");

    return (
      selectorText.includes("html.dark") &&
      selectorText.includes(selectorFragment) &&
      rule.declarations[property] !== undefined
    );
  });
};

afterEach(() => {
  cleanup();
});

describe("the row ⋯ trigger at rest", () => {
  test("draws no border around itself", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const trigger: HTMLElement = getTrigger();

    expect(trigger).not.toHaveClass("border-gray-300");
    expect(
      allUtilities(trigger).filter((utility: string) => {
        return (
          isBorderColourUtility(utility) && utility !== "border-transparent"
        );
      }),
    ).toEqual([]);
  });

  test("has no white fill - the row shows through it", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const trigger: HTMLElement = getTrigger();

    expect(trigger).not.toHaveClass("bg-white");
    expect(trigger).toHaveClass("bg-transparent");
  });

  test("casts no shadow", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const trigger: HTMLElement = getTrigger();

    expect(trigger).not.toHaveClass("shadow-sm");
    expect(allUtilities(trigger).filter(isShadowUtility)).toEqual([]);
  });

  test("has no resting ring standing in for a border", () => {
    renderRow([VIEW, EDIT, DELETE]);

    expectNoOutline(getTrigger());
  });

  test("is still the ⋯ icon, at the size the card header uses", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const icon: SVGElement | null = getTrigger().querySelector("svg");

    expect(icon).not.toBeNull();
    expect(icon).toHaveClass("h-5");
    expect(icon).toHaveClass("w-5");
    expect(icon!.querySelector("path")?.getAttribute("d") || "").toMatch(
      /^M6\.75 12a\.75\.75/,
    );
  });

  test("its only content is the icon - no label text beside it", () => {
    renderRow([VIEW, EDIT, DELETE]);

    expect((getTrigger().textContent || "").trim()).toBe("");
  });

  test("is drawn in a muted grey, quieter than the row's button", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const trigger: HTMLElement = getTrigger();
    const rowButton: HTMLElement = screen.getByRole("button", {
      name: "View Kubernetes Cluster",
    });

    expect(trigger).toHaveClass("text-gray-500");
    expect(rowButton).toHaveClass("text-gray-700");
  });
});

describe("the row ⋯ trigger is still a clear target", () => {
  test("hovering it gives it a soft background and darkens the icon", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const trigger: HTMLElement = getTrigger();

    expect(trigger).toHaveClass("hover:bg-gray-100");
    expect(trigger).toHaveClass("hover:text-gray-700");
  });

  test("the hover background has rounded corners rather than a hard square", () => {
    renderRow([VIEW, EDIT, DELETE]);

    expect(getTrigger()).toHaveClass("rounded-md");
  });

  test("hover colours ease in like every other button", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const trigger: HTMLElement = getTrigger();

    expect(trigger).toHaveClass("transition-colors");
    expect(trigger).toHaveClass("duration-150");
  });

  test("keyboard focus still draws a visible ring, even without a border", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const trigger: HTMLElement = getTrigger();

    expect(trigger).toHaveClass("focus:outline-none");
    expect(trigger).toHaveClass("focus-visible:ring-2");
    expect(trigger).toHaveClass("focus-visible:ring-indigo-500");
    expect(trigger).toHaveClass("focus-visible:ring-offset-2");
  });

  test("it can be focused from the keyboard", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const trigger: HTMLElement = getTrigger();

    trigger.focus();

    expect(trigger).toHaveFocus();
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).not.toBeDisabled();
  });

  test("keeps padding around the icon, so the target is larger than the dots", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const trigger: HTMLElement = getTrigger();

    expect(trigger).toHaveClass("px-1.5");
    expect(trigger).toHaveClass("py-1.5");
  });
});

describe("the row ⋯ trigger lines up with the row's button", () => {
  /*
   * The row's Small button has a 1px border. Without a frame of its own the
   * ⋯ would be 2px shorter, and its hover background would sit visibly lower
   * than the button's top and higher than its bottom. A transparent border
   * keeps the two the same height while drawing nothing.
   */
  test("keeps the same 1px frame as the button beside it, but transparent", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const trigger: HTMLElement = getTrigger();
    const rowButton: HTMLElement = screen.getByRole("button", {
      name: "View Kubernetes Cluster",
    });

    expect(rowButton).toHaveClass("border");
    expect(trigger).toHaveClass("border");
    expect(trigger).toHaveClass("border-transparent");
  });

  test("its vertical padding steps down at md, as the button's label does", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const trigger: HTMLElement = getTrigger();
    const rowButton: HTMLElement = screen.getByRole("button", {
      name: "View Kubernetes Cluster",
    });

    // The button's label is text-base below md and text-sm above.
    expect(rowButton).toHaveClass("text-base");
    expect(rowButton).toHaveClass("md:text-sm");
    expect(trigger).toHaveClass("py-1.5");
    expect(trigger).toHaveClass("md:py-1");
  });

  test("is centred against the button and never squeezed by a long label", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const trigger: HTMLElement = getTrigger();

    expect(screen.getByTestId("row-actions")).toHaveClass("items-center");
    expect(trigger).toHaveClass("inline-flex");
    expect(trigger).toHaveClass("items-center");
    expect(trigger).toHaveClass("justify-center");
    expect(trigger).toHaveClass("shrink-0");
  });

  test("the row's button keeps its own border - only the ⋯ lost its box", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const rowButton: HTMLElement = screen.getByRole("button", {
      name: "View Kubernetes Cluster",
    });

    expect(rowButton).toHaveClass("border-gray-300");
    expect(rowButton).toHaveClass("bg-white");
    expect(rowButton).toHaveClass("shadow-sm");
  });
});

describe("the row ⋯ trigger looks the same wherever a row draws it", () => {
  test.each<[string, Array<ActionButtonSchema<Cluster>>, RenderOptions]>([
    ["beside a row button", [VIEW, EDIT, DELETE], {}],
    ["with no row button beside it", [SHOW_ID], {}],
    ["with only everyday actions in the menu", [VIEW, SHOW_ID, EDIT], {}],
    ["with only a destructive action in the menu", [VIEW, DELETE], {}],
    ["on a mobile card", [VIEW, EDIT, DELETE], { isMobile: true }],
    [
      "in a centred ordered-states item",
      [VIEW, EDIT, DELETE],
      { className: "justify-center" },
    ],
    [
      "when the row names itself for screen readers",
      [VIEW, EDIT, DELETE],
      { itemLabel: "Kubernetes Cluster: prod-eu-west-1" },
    ],
  ])(
    "%s",
    (
      _label: string,
      actionButtons: Array<ActionButtonSchema<Cluster>>,
      options: RenderOptions,
    ) => {
      renderRow(actionButtons, options);

      const trigger: HTMLElement = getTrigger();

      expectNoOutline(trigger);
      expect(trigger).toHaveClass("border-transparent");
      expect(trigger).toHaveClass("bg-transparent");
      expect(trigger).toHaveClass("hover:bg-gray-100");
      expect(trigger).toHaveClass("focus-visible:ring-2");
    },
  );

  test("every row of a table gets the same bare trigger", () => {
    render(
      <div>
        {["a", "b", "c"].map((id: string) => {
          return (
            <RowActions<Cluster>
              key={id}
              item={{ id, name: `cluster-${id}` }}
              actionButtons={[VIEW, EDIT, DELETE]}
            />
          );
        })}
      </div>,
    );

    const triggers: Array<HTMLElement> = screen.getAllByTestId(
      "row-actions-more-button",
    );

    expect(triggers).toHaveLength(3);

    const firstClassName: string = triggers[0]!.className;

    triggers.forEach((trigger: HTMLElement) => {
      expectNoOutline(trigger);
      expect(trigger.className).toBe(firstClassName);
    });
  });

  test("opening the menu does not draw a box around the trigger", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const trigger: HTMLElement = getTrigger();
    const classNameWhenClosed: string = trigger.className;

    fireEvent.click(trigger);

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger.className).toBe(classNameWhenClosed);
    expectNoOutline(trigger);

    fireEvent.click(trigger);

    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger.className).toBe(classNameWhenClosed);
  });

  test("the menu it opens keeps its own frame - only the trigger is bare", () => {
    renderRow([VIEW, EDIT, DELETE]);

    fireEvent.click(getTrigger());

    const menu: HTMLElement = screen.getByRole("menu");

    expect(menu).toHaveClass("ring-1");
    expect(menu).toHaveClass("shadow-xl");
    expect(menu).toHaveClass("bg-white");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
  });

  test("no trigger is drawn at all when nothing goes in the menu", () => {
    renderRow([EDIT]);

    expect(screen.queryByTestId("row-actions-more-button")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });
});

describe("the row ⋯ trigger matches the card header's ⋯", () => {
  /*
   * The card header's overflow menu - the one a ModelTable puts beside its
   * Create button - is MoreMenu's own default trigger with the horizontal
   * ellipsis. That is what the row's ⋯ is meant to look like.
   */
  const renderCardHeaderMoreMenu: () => HTMLElement = (): HTMLElement => {
    render(
      <MoreMenu menuIcon={IconProp.EllipsisHorizontal} text="">
        {[<MoreMenuItem key="export" text="Export" onClick={() => {}} />]}
      </MoreMenu>,
    );

    return screen.getByRole("button", { name: "More options" });
  };

  test("the card header's ⋯ itself draws no box", () => {
    expectNoOutline(renderCardHeaderMoreMenu());
  });

  test("neither ⋯ draws a border, a white fill or a shadow", () => {
    const cardHeaderTrigger: HTMLElement = renderCardHeaderMoreMenu();

    cleanup();

    renderRow([VIEW, EDIT, DELETE]);

    const rowTrigger: HTMLElement = getTrigger();

    for (const trigger of [cardHeaderTrigger, rowTrigger]) {
      expect(trigger).not.toHaveClass("border-gray-300");
      expect(trigger).not.toHaveClass("bg-white");
      expect(trigger).not.toHaveClass("shadow-sm");
    }

    expectNoOutline(rowTrigger);
  });

  test("both draw the same horizontal ellipsis", () => {
    const cardHeaderPath: string | null | undefined = renderCardHeaderMoreMenu()
      .querySelector("svg path")
      ?.getAttribute("d");

    cleanup();

    renderRow([VIEW, EDIT, DELETE]);

    const rowPath: string | null | undefined = getTrigger()
      .querySelector("svg path")
      ?.getAttribute("d");

    expect(cardHeaderPath).toBeTruthy();
    expect(rowPath).toBe(cardHeaderPath);
  });

  test("both are menu buttons with an accessible name", () => {
    const cardHeaderTrigger: HTMLElement = renderCardHeaderMoreMenu();

    expect(cardHeaderTrigger).toHaveAttribute("aria-haspopup", "menu");

    cleanup();

    renderRow([VIEW, EDIT, DELETE], {
      itemLabel: "Kubernetes Cluster: prod-eu-west-1",
    });

    expect(getTrigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(getTrigger()).toHaveAccessibleName(
      "More actions for Kubernetes Cluster: prod-eu-west-1",
    );
  });
});

describe("the row ⋯ trigger in the dark theme", () => {
  /*
   * Theme.css repaints light Tailwind colours under html.dark one class token
   * at a time. A colour on the trigger that it does not list keeps its light
   * value - a near-white hover patch on a dark row.
   */
  test("its resting icon colour is repainted in the dark theme", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const textColours: Array<string> = restingUtilities(getTrigger()).filter(
      (utility: string) => {
        return NEUTRAL_TEXT_COLOUR_UTILITY.test(utility);
      },
    );

    expect(textColours.length).toBeGreaterThan(0);

    textColours.forEach((utility: string) => {
      expect(darkRuleCovers(`.${utility}`, "color")).toBe(true);
    });
  });

  test("its hover background is repainted in the dark theme", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const hoverBackgrounds: Array<string> = Array.from(
      getTrigger().classList,
    ).filter((token: string) => {
      return token.startsWith("hover:bg-");
    });

    expect(hoverBackgrounds.length).toBeGreaterThan(0);

    hoverBackgrounds.forEach((token: string) => {
      expect(darkRuleCovers(`[class~="${token}"]`, "background-color")).toBe(
        true,
      );
    });
  });

  test("its hover icon colour is repainted in the dark theme", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const hoverTextColours: Array<string> = Array.from(
      getTrigger().classList,
    ).filter((token: string) => {
      return token.startsWith("hover:text-");
    });

    expect(hoverTextColours.length).toBeGreaterThan(0);

    hoverTextColours.forEach((token: string) => {
      expect(darkRuleCovers(`[class~="${token}"]`, "color")).toBe(true);
    });
  });

  test("its transparent border and fill need no dark rule - they draw nothing", () => {
    renderRow([VIEW, EDIT, DELETE]);

    const trigger: HTMLElement = getTrigger();

    expect(
      restingUtilities(trigger).filter((utility: string) => {
        return (
          (isBorderColourUtility(utility) || utility.startsWith("bg-")) &&
          !utility.endsWith("-transparent")
        );
      }),
    ).toEqual([]);
  });
});

describe("the helpers these tests lean on", () => {
  /*
   * expectNoOutline is what most of the suite rests on, so it is checked
   * against the trigger as it used to be: if it would have passed that, it
   * would pass anything.
   */
  const renderElement: (className: string) => HTMLElement = (
    className: string,
  ): HTMLElement => {
    render(
      <button type="button" data-testid="probe" className={className}>
        ⋯
      </button>,
    );

    return screen.getByTestId("probe");
  };

  test("rejects the old bordered, filled, shadowed trigger", () => {
    const oldTrigger: HTMLElement = renderElement(
      "inline-flex shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white px-1.5 py-1.5 md:py-1 text-gray-500 shadow-sm hover:bg-gray-50 hover:text-gray-700 focus-visible:ring-2",
    );

    expect(() => {
      expectNoOutline(oldTrigger);
    }).toThrow();
  });

  test.each([
    ["a border that only appears on hover", "hover:border-gray-300"],
    ["a border at a breakpoint", "md:border-gray-200"],
    ["a translucent border colour", "border-gray-300/50"],
    ["a white border", "border-white"],
    ["a shadow on hover", "hover:shadow-sm"],
    ["a resting shadow", "shadow"],
    ["a white fill", "bg-white"],
    ["a grey fill at a breakpoint", "md:bg-gray-50"],
    ["a resting ring", "ring-1 ring-gray-300"],
    ["a ring on hover", "hover:ring-1"],
  ])("rejects %s", (_label: string, className: string) => {
    const element: HTMLElement = renderElement(`rounded-md ${className}`);

    expect(() => {
      expectNoOutline(element);
    }).toThrow();
  });

  test.each([
    ["a transparent border", "border border-transparent"],
    ["a transparent fill", "bg-transparent"],
    ["a hover background", "hover:bg-gray-100"],
    [
      "a keyboard focus ring",
      "focus-visible:ring-2 focus-visible:ring-indigo-500",
    ],
    ["a focus ring", "focus:ring-2"],
    ["a border width with no colour", "border-0"],
  ])("accepts %s", (_label: string, className: string) => {
    expect(() => {
      expectNoOutline(renderElement(`rounded-md ${className}`));
    }).not.toThrow();
  });

  test("finds Theme.css's dark rules for colours it repaints, and not for others", () => {
    expect(darkRuleCovers(".text-gray-500", "color")).toBe(true);
    expect(
      darkRuleCovers('[class~="hover:bg-gray-100"]', "background-color"),
    ).toBe(true);
    expect(
      darkRuleCovers('[class~="hover:bg-fuchsia-950"]', "background-color"),
    ).toBe(false);
  });
});
