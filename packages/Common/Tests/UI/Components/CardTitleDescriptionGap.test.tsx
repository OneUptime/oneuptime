import Button, { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Card, {
  CARD_DESCRIPTION_CLASS_NAME,
  CARD_DESCRIPTION_CLEARANCE_IN_PX,
  CARD_DESCRIPTION_UNDER_ACTIONS_CLASS_NAME,
  CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES,
  CARD_HEADER_ACTIONS_CLASS_NAME,
  CARD_HEADER_CONTROL_HEIGHT_IN_PX,
  CARD_HEADER_CONTROL_OVERHANG_IN_PX,
  CARD_HEADER_LAYOUTS,
  CARD_HEADER_TITLE_BLOCK_OVER_NOTHING_CLASS_NAME,
  CARD_HEADER_TITLE_LINE_CLASS_NAMES,
  CARD_HEADER_TITLE_ROW_CLASS_NAME,
  CARD_SECTION_TITLE_CLASS_NAME,
  CARD_TITLE_CLASS_NAME,
  CARD_TITLE_LINE_HEIGHT_IN_PX,
  CardButtonSchema,
  CardHeaderLayout,
  ComponentProps,
} from "../../../UI/Components/Card/Card";
import CardSections from "../../../UI/Components/Card/CardSections";
import { TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME } from "../../../UI/Components/Table/TableHeaderControls";
import IconProp from "../../../Types/Icon/IconProp";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import { resolveFlex } from "../../ResponsiveFlexLayout";
import { resolveSpacing } from "../../ResponsiveSpacing";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
  isVisibleAtWidth,
} from "../../ResponsiveVisibility";
import { WIDTHS_IN_PX, widthsBelow, widthsFrom } from "../../RenderedMarkup";
import {
  CardHeaderPlacement,
  DrawnCardHeaders,
  drawCardHeaders,
} from "../../Helpers/CardHeaderDrawing";

/*
 * "There's a lot of gap between the title of the card and the description
 * of the card. Can you please fix it? Please do it in other places as well
 * (if we have the same case everywhere)" - the Runbooks list: its title, a
 * button row's height of nothing, then "Reusable response procedures: ...".
 *
 * In Card's stacked and toolbar headers - every table (ModelTable, ModelList,
 * the lists a page builds on Table), and the one-third column of an overview
 * page - the description follows the line the title shares with the
 * actions. That line was as tall as the controls on it (38px from md up),
 * the title at its top, so the description came 20px under the title where
 * a card with no controls puts it 6px under. Now the actions are centred on
 * the title's line and reach past it, the title stays at the card's padding
 * (where every card's title is), and the description follows the title.
 *
 * jsdom draws nothing, so these tests read the classes Card draws with and
 * lay the header out the way a browser's flexbox does: each flex line as
 * tall as its tallest item's margin box, each item placed across its line
 * by align-items / align-self and its margins, the description after the
 * line by its own top margin. The model is checked against the old header:
 * it gives the 20px measured in Chromium on master. The same shapes are
 * measured for real in Chromium by packages/E2E/ModelTables/CardHeaders.spec.ts.
 */

// Inter at the Dashboard's sizes: a card title's line and a description's.
const DESCRIPTION_LINE_IN_PX: number = 22.75;

// A status pill (Pill isMinimal) is shorter than the title's line.
const PILL_HEIGHT_IN_PX: number = 22;

/*
 * A header control below md: Button's text-base (a 24px line) between its
 * 8px paddings and 1px borders, and a table's search taking the same
 * (TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME).
 */
const PHONE_CONTROL_HEIGHT_IN_PX: number = 42;

const MD_IN_PX: number = 768;

function classOf(element: Element | null): string {
  return element?.getAttribute("class") || "";
}

const EDIT: CardButtonSchema = {
  title: "Edit",
  icon: IconProp.Edit,
  buttonStyle: ButtonStyleType.NORMAL,
  onClick: (): void => {},
};

const REFRESH: CardButtonSchema = {
  title: "Refresh",
  icon: IconProp.Refresh,
  buttonStyle: ButtonStyleType.OUTLINE,
  onClick: (): void => {},
};

type ActionsShape =
  // No actions at all.
  | "none"
  // Buttons, 38px from md up, beside the title.
  | "controls"
  // A status pill beside the title, shorter than the title's line.
  | "pill"
  // Buttons that do not fit beside the title: on a line of their own.
  | "controls-under";

type DescriptionShape = "none" | "one-line" | "wrapped";

interface Shape {
  layout: CardHeaderLayout;
  titleLines: 1 | 2;
  actions: ActionsShape;
  description: DescriptionShape;
}

interface HeaderClasses {
  // The element that lays the title out beside the actions.
  row: string;
  titleBlock: string;
  /*
   * The stacked/toolbar description follows the row - unless the actions
   * went under the title; the default one is in the title's block.
   */
  descriptionInTitleBlock: boolean;
  actions: string | null;
  description: string | null;
}

interface LaidOutHeader {
  titleTop: number;
  titleBottom: number;
  actionsTop: number | null;
  actionsBottom: number | null;
  // null when the card has none, or does not show it at this width.
  descriptionTop: number | null;
  // Where the card's body starts (before its own margin).
  headerBottom: number;
}

function propsFor(shape: Shape): ComponentProps {
  const title: string =
    shape.titleLines === 2
      ? "Scheduled maintenance events this status page announces"
      : "Runbooks";
  const description: string | undefined =
    shape.description === "none"
      ? undefined
      : shape.description === "wrapped"
        ? "Reusable response procedures: ordered checklists of manual or automated steps, run by hand or by a runner, each step waiting for the one before it, so whoever is on call knows what to do next."
        : "Reusable response procedures: ordered checklists of manual or automated steps.";

  return {
    title: title,
    description: description,
    headerLayout: shape.layout,
    ...(shape.actions === "pill"
      ? { rightElement: <span>Completed</span> }
      : {}),
    ...(shape.actions === "controls" || shape.actions === "controls-under"
      ? { buttons: [EDIT, REFRESH] }
      : {}),
    children: <div data-testid="card-body">rows</div>,
  };
}

/*
 * Card reads where the browser put the actions (beside the title, or under
 * it) from the drawn header, which jsdom does not draw: each shape is drawn
 * where it goes (CardHeaderDrawing).
 */
function placementOf(shape: Shape): CardHeaderPlacement {
  if (shape.actions === "none") {
    return "undrawn";
  }

  return shape.actions === "controls-under" ? "under" : "beside";
}

function classesOf(shape: Shape): HeaderClasses {
  const drawn: DrawnCardHeaders = drawCardHeaders(placementOf(shape));

  try {
    render(<Card {...propsFor(shape)} />);
  } finally {
    drawn.restore();
  }

  const header: HTMLElement = screen.getByTestId("card-header");
  const actions: HTMLElement | null = screen.queryByTestId(
    "card-header-actions",
  );
  const description: HTMLElement | null =
    screen.queryByTestId("card-description");
  const titleBlock: HTMLElement = screen.getByTestId("card-header-title-block");
  const classes: HeaderClasses = {
    row: classOf(titleBlock.parentElement),
    titleBlock: classOf(titleBlock),
    descriptionInTitleBlock: Boolean(
      description && titleBlock.contains(description),
    ),
    actions: actions ? classOf(actions) : null,
    description: description ? classOf(description) : null,
  };

  // The row is the header itself in the default layout, its first line otherwise.
  if (shape.layout === "default") {
    expect(titleBlock.parentElement).toBe(header);
  } else {
    expect(titleBlock.parentElement).toBe(
      screen.getByTestId("card-header-title-row"),
    );
  }

  cleanup();

  return classes;
}

/*
 * Where an item's border box starts across a flex line as tall as `line`,
 * placed by its alignment, given its height and its margins.
 */
function placeAcross(
  alignment: string,
  line: number,
  height: number,
  marginTop: number,
  marginBottom: number,
): number {
  const marginBox: number = marginTop + height + marginBottom;

  switch (alignment) {
    case "flex-start":
      return marginTop;
    case "flex-end":
      return line - marginBox + marginTop;
    case "center":
      return (line - marginBox) / 2 + marginTop;
    default:
      /*
       * stretch (an auto-height block would fill the line) and baseline:
       * the header uses neither, and the model does not draw them.
       */
      throw new Error(`The model does not lay out align ${alignment}.`);
  }
}

// The row's gap between lines, from its gap-y utility (no screen variant).
function rowGapInPx(rowClassName: string): number {
  const tokens: Array<string> = rowClassName.split(/\s+/);

  for (const token of tokens) {
    expect(token).not.toMatch(/^[a-z0-9-]+:gap(-y)?-/);
  }

  const gapY: string | undefined = tokens.find((token: string): boolean => {
    return token.startsWith("gap-y-");
  });

  return gapY ? (parseFloat(gapY.slice("gap-y-".length)) * 16) / 4 : 0;
}

function descriptionHeight(shape: Shape): number {
  return shape.description === "wrapped"
    ? DESCRIPTION_LINE_IN_PX * 3
    : DESCRIPTION_LINE_IN_PX;
}

function actionsHeight(shape: Shape, width: number): number {
  if (shape.actions === "pill") {
    return PILL_HEIGHT_IN_PX;
  }

  return width >= MD_IN_PX
    ? CARD_HEADER_CONTROL_HEIGHT_IN_PX
    : PHONE_CONTROL_HEIGHT_IN_PX;
}

function layOut(
  shape: Shape,
  classes: HeaderClasses,
  width: number,
): LaidOutHeader {
  const titleHeight: number = CARD_TITLE_LINE_HEIGHT_IN_PX * shape.titleLines;
  const rowAlignment: string = resolveFlex(classes.row, width, "align-items");
  const descriptionShown: boolean =
    classes.description !== null && isShownAt(classes.description, width);
  const descriptionMargin: number = classes.description
    ? resolveSpacing(classes.description, width, "margin").top
    : 0;
  const hasActions: boolean = classes.actions !== null;
  const actionHeight: number = hasActions ? actionsHeight(shape, width) : 0;
  const actionMargins: { top: number; bottom: number } = classes.actions
    ? resolveSpacing(classes.actions, width, "margin")
    : { top: 0, bottom: 0 };
  const actionAlignment: string = classes.actions
    ? resolveFlex(classes.actions, width, "align-self")
    : "auto";
  const actionPlacement: string =
    actionAlignment === "auto" ? rowAlignment : actionAlignment;
  const titleMargins: { top: number; bottom: number } = resolveSpacing(
    classes.titleBlock,
    width,
    "margin",
  );

  if (classes.descriptionInTitleBlock) {
    // The description is in the title's block.
    const block: number =
      titleHeight +
      (descriptionShown ? descriptionMargin + descriptionHeight(shape) : 0);

    if (hasActions && shape.actions === "controls-under") {
      /*
       * A stacked header whose actions went under the title: the title's
       * block (the title and its description) alone on the first line, the
       * actions on the next.
       */
      const secondLine: number =
        actionHeight + actionMargins.top + actionMargins.bottom;
      const secondLineTop: number =
        block +
        titleMargins.top +
        titleMargins.bottom +
        rowGapInPx(classes.row);
      const actionsTop: number =
        secondLineTop +
        placeAcross(
          actionPlacement,
          secondLine,
          actionHeight,
          actionMargins.top,
          actionMargins.bottom,
        );

      return {
        titleTop: titleMargins.top,
        titleBottom: titleMargins.top + titleHeight,
        actionsTop: actionsTop,
        actionsBottom: actionsTop + actionHeight,
        descriptionTop: descriptionShown
          ? titleMargins.top + titleHeight + descriptionMargin
          : null,
        headerBottom: secondLineTop + secondLine,
      };
    }

    // The default header: the title's block beside the actions.
    const line: number = Math.max(
      block,
      hasActions ? actionHeight + actionMargins.top + actionMargins.bottom : 0,
    );
    const blockTop: number = placeAcross(rowAlignment, line, block, 0, 0);
    const actionsTop: number | null = hasActions
      ? placeAcross(
          actionPlacement,
          line,
          actionHeight,
          actionMargins.top,
          actionMargins.bottom,
        )
      : null;

    return {
      titleTop: blockTop,
      titleBottom: blockTop + titleHeight,
      actionsTop: actionsTop,
      actionsBottom: actionsTop === null ? null : actionsTop + actionHeight,
      descriptionTop: descriptionShown
        ? blockTop + titleHeight + descriptionMargin
        : null,
      headerBottom: line,
    };
  }

  const titleBox: number = titleHeight + titleMargins.top + titleMargins.bottom;
  let rowBottom: number;
  let titleTop: number;
  let actionsTop: number | null = null;

  if (hasActions && shape.actions === "controls-under") {
    // The title alone on the first line, the actions on the next.
    const firstLine: number = titleBox;
    const secondLine: number =
      actionHeight + actionMargins.top + actionMargins.bottom;
    const secondLineTop: number = firstLine + rowGapInPx(classes.row);

    titleTop = placeAcross(
      rowAlignment,
      firstLine,
      titleHeight,
      titleMargins.top,
      titleMargins.bottom,
    );
    actionsTop =
      secondLineTop +
      placeAcross(
        actionPlacement,
        secondLine,
        actionHeight,
        actionMargins.top,
        actionMargins.bottom,
      );
    rowBottom = secondLineTop + secondLine;
  } else {
    const line: number = Math.max(
      titleBox,
      hasActions ? actionHeight + actionMargins.top + actionMargins.bottom : 0,
    );

    titleTop = placeAcross(
      rowAlignment,
      line,
      titleHeight,
      titleMargins.top,
      titleMargins.bottom,
    );
    actionsTop = hasActions
      ? placeAcross(
          actionPlacement,
          line,
          actionHeight,
          actionMargins.top,
          actionMargins.bottom,
        )
      : null;
    rowBottom = line;
  }

  const descriptionTop: number | null = descriptionShown
    ? rowBottom + descriptionMargin
    : null;

  return {
    titleTop: titleTop,
    titleBottom: titleTop + titleHeight,
    actionsTop: actionsTop,
    actionsBottom: actionsTop === null ? null : actionsTop + actionHeight,
    descriptionTop: descriptionTop,
    headerBottom:
      descriptionTop === null
        ? rowBottom
        : descriptionTop + descriptionHeight(shape),
  };
}

function isShownAt(className: string, width: number): boolean {
  const element: HTMLParagraphElement = document.createElement("p");
  element.setAttribute("class", className);

  return isVisibleAtWidth(element, width);
}

function centreOf(top: number, bottom: number): number {
  return (top + bottom) / 2;
}

const STACKED_LAYOUTS: Array<CardHeaderLayout> = ["stacked", "toolbar"];

const DESKTOP_WIDTHS: Array<number> = widthsFrom("md");

const PHONE_WIDTHS: Array<number> = widthsBelow("md");

afterEach(() => {
  cleanup();
});

describe("the model reproduces the gap the maintainer saw", () => {
  /*
   * master's stacked/toolbar header, as Chromium measured it on the Runbooks
   * list at 1280px: title 121-145, controls 121-159, description at 165.
   */
  const OLD_CLASSES: HeaderClasses = {
    row: "flex flex-wrap items-center gap-x-4 gap-y-2 md:items-start",
    titleBlock: "min-w-0 md:grow md:basis-48",
    descriptionInTitleBlock: false,
    actions:
      "ml-auto flex max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-2",
    description:
      "mt-1.5 text-sm text-gray-500 w-full max-md:hidden md:block leading-relaxed",
  };

  test("the old header put the description 20px under the title, a button row's height down", () => {
    const old: LaidOutHeader = layOut(
      {
        layout: "toolbar",
        titleLines: 1,
        actions: "controls",
        description: "one-line",
      },
      OLD_CLASSES,
      LAPTOP_WIDTH_IN_PX,
    );

    expect(old.titleTop).toBe(0);
    expect(old.actionsTop).toBe(0);
    expect(old.descriptionTop! - old.titleBottom).toBe(20);
  });

  test("the new header puts it 9px under, as Chromium measures it (title 121-145, controls 114-152, description at 154)", () => {
    const shape: Shape = {
      layout: "toolbar",
      titleLines: 1,
      actions: "controls",
      description: "one-line",
    };
    const laidOut: LaidOutHeader = layOut(
      shape,
      classesOf(shape),
      LAPTOP_WIDTH_IN_PX,
    );

    // The title where it was, the controls centred on it, 7px higher.
    expect(laidOut.titleTop).toBe(0);
    expect(laidOut.actionsTop).toBe(-7);
    expect(laidOut.descriptionTop).toBe(33);
    expect(laidOut.descriptionTop! - laidOut.titleBottom).toBe(9);
  });
});

describe("the numbers the header is built on", () => {
  test("a header control is 38px from md up: Button's normal size, and a table's search and ⋯", () => {
    render(<Button title="Create Runbook" />);

    const button: HTMLElement = screen.getByRole("button", {
      name: "Create Runbook",
    });
    const buttonClass: string = classOf(button);

    // md:text-sm: a 20px line; py-2 above and below it; a 1px border.
    expect(buttonClass.split(" ")).toEqual(
      expect.arrayContaining(["md:text-sm", "border", "py-2"]),
    );
    const padding: { top: number; bottom: number } = resolveSpacing(
      buttonClass,
      LAPTOP_WIDTH_IN_PX,
      "padding",
    );
    expect(20 + padding.top + padding.bottom + 2).toBe(
      CARD_HEADER_CONTROL_HEIGHT_IN_PX,
    );

    // A table's search takes the same padding from md up (TableHeaderControls).
    const searchPadding: { top: number; bottom: number } = resolveSpacing(
      TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME,
      LAPTOP_WIDTH_IN_PX,
      "padding",
    );
    expect(20 + searchPadding.top + searchPadding.bottom + 2).toBe(
      CARD_HEADER_CONTROL_HEIGHT_IN_PX,
    );

    /*
     * And 42px on a phone: the search's 20px line between 10px paddings
     * (Button's text-base, a 24px line, between its 8px ones).
     */
    expect(buttonClass.split(" ")).toContain("text-base");
    expect(
      24 +
        resolveSpacing(buttonClass, PHONE_WIDTH_IN_PX, "padding").top +
        resolveSpacing(buttonClass, PHONE_WIDTH_IN_PX, "padding").bottom +
        2,
    ).toBe(PHONE_CONTROL_HEIGHT_IN_PX);
    const phonePadding: { top: number; bottom: number } = resolveSpacing(
      TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME,
      PHONE_WIDTH_IN_PX,
      "padding",
    );
    expect(20 + phonePadding.top + phonePadding.bottom + 2).toBe(
      PHONE_CONTROL_HEIGHT_IN_PX,
    );
  });

  test("a card's title, and a section's, stand on a 24px line", () => {
    expect(CARD_TITLE_LINE_HEIGHT_IN_PX).toBe(24);
    expect(CARD_TITLE_CLASS_NAME.split(" ")).toContain("leading-6");
    expect(CARD_SECTION_TITLE_CLASS_NAME.split(" ")).toContain("leading-6");
  });

  test("the controls reach 7px past the title's line on each side, and the classes say so - from md up only", () => {
    expect(CARD_HEADER_CONTROL_OVERHANG_IN_PX).toBe(
      (CARD_HEADER_CONTROL_HEIGHT_IN_PX - CARD_TITLE_LINE_HEIGHT_IN_PX) / 2,
    );
    expect(CARD_HEADER_CONTROL_OVERHANG_IN_PX).toBe(7);

    for (const width of DESKTOP_WIDTHS) {
      // Over a description: above and below the title's line.
      expect(
        resolveSpacing(
          CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES.overDescription,
          width,
          "margin",
        ),
      ).toEqual({ top: -7, right: 0, bottom: -7, left: 0 });
      // Over nothing: above it only, the title's block taking 7px under it.
      expect(
        resolveSpacing(
          CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES.overNothing,
          width,
          "margin",
        ),
      ).toEqual({ top: -7, right: 0, bottom: 0, left: 0 });
      expect(
        resolveSpacing(
          CARD_HEADER_TITLE_BLOCK_OVER_NOTHING_CLASS_NAME,
          width,
          "margin",
        ),
      ).toEqual({ top: 0, right: 0, bottom: 7, left: 0 });
    }

    for (const width of PHONE_WIDTHS) {
      for (const className of [
        CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES.overDescription,
        CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES.overNothing,
        CARD_HEADER_TITLE_BLOCK_OVER_NOTHING_CLASS_NAME,
      ]) {
        expect(resolveSpacing(className, width, "margin")).toEqual({
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        });
      }
    }
  });

  test("a description under a stacked header's actions starts the overhang and 2px of air below the title's line; any other one 6px below the title", () => {
    expect(CARD_DESCRIPTION_CLEARANCE_IN_PX).toBe(2);

    for (const width of WIDTHS_IN_PX) {
      expect(
        resolveSpacing(
          CARD_DESCRIPTION_UNDER_ACTIONS_CLASS_NAME,
          width,
          "margin",
        ).top,
      ).toBe(
        CARD_HEADER_CONTROL_OVERHANG_IN_PX + CARD_DESCRIPTION_CLEARANCE_IN_PX,
      );
      expect(
        resolveSpacing(CARD_DESCRIPTION_CLASS_NAME, width, "margin").top,
      ).toBe(6);
    }
  });

  test("the two descriptions differ in their top margin alone: same words, colour, line and screens", () => {
    const withoutMargin: (className: string) => Array<string> = (
      className: string,
    ): Array<string> => {
      return className.split(" ").filter((token: string): boolean => {
        return !token.startsWith("mt-");
      });
    };

    expect(withoutMargin(CARD_DESCRIPTION_UNDER_ACTIONS_CLASS_NAME)).toEqual(
      withoutMargin(CARD_DESCRIPTION_CLASS_NAME),
    );

    for (const width of WIDTHS_IN_PX) {
      expect(isShownAt(CARD_DESCRIPTION_UNDER_ACTIONS_CLASS_NAME, width)).toBe(
        isShownAt(CARD_DESCRIPTION_CLASS_NAME, width),
      );
    }

    // Shown from md up, as it was; a phone never shows a card's description.
    for (const width of PHONE_WIDTHS) {
      expect(isShownAt(CARD_DESCRIPTION_CLASS_NAME, width)).toBe(false);
    }
    for (const width of DESKTOP_WIDTHS) {
      expect(isShownAt(CARD_DESCRIPTION_CLASS_NAME, width)).toBe(true);
    }
  });

  test("the first line's alignments: the actions centred on the title beside it, the top of the line alone or over actions that went under it - each from md up; centred on a phone", () => {
    expect(CARD_HEADER_TITLE_LINE_CLASS_NAMES).toEqual({
      besideActions: "md:items-center",
      alone: "md:items-start",
      overActions: "md:items-start",
    });

    const expected: Record<string, string> = {
      besideActions: "center",
      alone: "flex-start",
      overActions: "flex-start",
    };

    for (const [name, className] of Object.entries(
      CARD_HEADER_TITLE_LINE_CLASS_NAMES,
    )) {
      const row: string = `${CARD_HEADER_TITLE_ROW_CLASS_NAME} ${className}`;

      for (const width of DESKTOP_WIDTHS) {
        expect([name, resolveFlex(row, width, "align-items")]).toEqual([
          name,
          expected[name],
        ]);
      }
      for (const width of PHONE_WIDTHS) {
        expect([name, resolveFlex(row, width, "align-items")]).toEqual([
          name,
          "center",
        ]);
      }
    }
  });
});

describe("which classes each header draws with", () => {
  test.each(STACKED_LAYOUTS)(
    "%s: controls over a description are centred on the title's line and reach past it on both sides",
    (layout: CardHeaderLayout) => {
      const classes: HeaderClasses = classesOf({
        layout,
        titleLines: 1,
        actions: "controls",
        description: "one-line",
      });

      expect(classes.row).toBe(
        `${CARD_HEADER_TITLE_ROW_CLASS_NAME} ${CARD_HEADER_TITLE_LINE_CLASS_NAMES.besideActions}`,
      );
      expect(classes.actions!.split(" ")).toEqual(
        expect.arrayContaining([
          ...CARD_HEADER_ACTIONS_CLASS_NAME.split(" "),
          CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES.overDescription,
        ]),
      );
      expect(classes.titleBlock.split(" ")).not.toContain(
        CARD_HEADER_TITLE_BLOCK_OVER_NOTHING_CLASS_NAME,
      );
      expect(classes.description).toBe(
        CARD_DESCRIPTION_UNDER_ACTIONS_CLASS_NAME,
      );
    },
  );

  test.each(STACKED_LAYOUTS)(
    "%s: with nothing under the line, the controls reach above it only and the title's block takes the same room under it",
    (layout: CardHeaderLayout) => {
      const classes: HeaderClasses = classesOf({
        layout,
        titleLines: 1,
        actions: "controls",
        description: "none",
      });

      expect(classes.row).toBe(
        `${CARD_HEADER_TITLE_ROW_CLASS_NAME} ${CARD_HEADER_TITLE_LINE_CLASS_NAMES.besideActions}`,
      );
      expect(classes.actions!.split(" ")).toContain(
        CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES.overNothing,
      );
      expect(classes.actions!.split(" ")).not.toContain(
        CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES.overDescription,
      );
      expect(classes.titleBlock.split(" ")).toContain(
        CARD_HEADER_TITLE_BLOCK_OVER_NOTHING_CLASS_NAME,
      );
      expect(classes.description).toBeNull();
    },
  );

  test.each(STACKED_LAYOUTS)(
    "%s: a title with no actions keeps the header it had, the description 6px under it",
    (layout: CardHeaderLayout) => {
      const classes: HeaderClasses = classesOf({
        layout,
        titleLines: 1,
        actions: "none",
        description: "one-line",
      });

      expect(classes.row).toBe(
        "flex flex-wrap items-center gap-x-4 gap-y-2 md:items-start",
      );
      expect(classes.titleBlock).toBe("w-full min-w-0");
      expect(classes.actions).toBeNull();
      expect(classes.description).toBe(CARD_DESCRIPTION_CLASS_NAME);
    },
  );

  test("the default header keeps its description beside the actions, 6px under the title, and its actions top-level with it", () => {
    const classes: HeaderClasses = classesOf({
      layout: "default",
      titleLines: 1,
      actions: "controls",
      description: "one-line",
    });

    expect(classes.descriptionInTitleBlock).toBe(true);
    expect(classes.description).toBe(CARD_DESCRIPTION_CLASS_NAME);
    expect(classes.actions).toBe(
      `${CARD_HEADER_ACTIONS_CLASS_NAME} md:flex-shrink-0`,
    );
    expect(classes.row).toBe(
      "flex flex-wrap items-center gap-x-4 gap-y-2 md:flex-nowrap md:items-start",
    );
  });

  test("a card drawn as a section of another card draws the same header", () => {
    render(
      <CardSections>
        <Card
          title="Runbooks"
          description="Reusable response procedures."
          headerLayout="toolbar"
          buttons={[EDIT]}
        >
          <div>The runbooks</div>
        </Card>
      </CardSections>,
    );

    expect(screen.getByTestId("card")).toHaveAttribute(
      "data-card-surface",
      "section",
    );
    expect(classOf(screen.getByTestId("card-header-title-row"))).toBe(
      `${CARD_HEADER_TITLE_ROW_CLASS_NAME} ${CARD_HEADER_TITLE_LINE_CLASS_NAMES.besideActions}`,
    );
    expect(classOf(screen.getByTestId("card-description"))).toBe(
      CARD_DESCRIPTION_UNDER_ACTIONS_CLASS_NAME,
    );
  });

  test("a description given as an element counts as a description; an empty one does not", () => {
    render(
      <Card
        title="Runbooks"
        description={<span>Reusable response procedures.</span>}
        headerLayout="toolbar"
        buttons={[EDIT]}
      />,
    );

    expect(classOf(screen.getByTestId("card-header-actions"))).toContain(
      CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES.overDescription,
    );
    cleanup();

    render(
      <Card
        title="Runbooks"
        description=""
        headerLayout="toolbar"
        buttons={[EDIT]}
      />,
    );

    expect(screen.queryByTestId("card-description")).toBeNull();
    expect(classOf(screen.getByTestId("card-header-actions"))).toContain(
      CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES.overNothing,
    );
    expect(
      classOf(screen.getByTestId("card-header-title-block")).split(" "),
    ).toContain(CARD_HEADER_TITLE_BLOCK_OVER_NOTHING_CLASS_NAME);
  });

  test("actions with no title to sit beside hang past nothing, and the description follows them 6px down", () => {
    render(
      <Card
        description="Reusable response procedures."
        headerLayout="stacked"
        buttons={[EDIT]}
      >
        <div>The runbooks</div>
      </Card>,
    );

    const actions: string = classOf(screen.getByTestId("card-header-actions"));

    expect(actions).not.toContain(
      CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES.overDescription,
    );
    expect(actions).not.toContain(
      CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES.overNothing,
    );
    expect(classOf(screen.getByTestId("card-description"))).toBe(
      CARD_DESCRIPTION_CLASS_NAME,
    );
  });
});

describe.each(STACKED_LAYOUTS)(
  "the %s header, laid out",
  (layout: CardHeaderLayout) => {
    describe.each(["one-line", "wrapped"] as Array<DescriptionShape>)(
      "with a %s description",
      (description: DescriptionShape) => {
        test.each(DESKTOP_WIDTHS)(
          "at %ipx the description sits 9px under the title beside 38px controls - not a button row down - and 2px clear of their foot; the title stays at the card's padding",
          (width: number) => {
            const shape: Shape = {
              layout,
              titleLines: 1,
              actions: "controls",
              description,
            };
            const laidOut: LaidOutHeader = layOut(
              shape,
              classesOf(shape),
              width,
            );

            expect(laidOut.descriptionTop! - laidOut.titleBottom).toBe(9);
            expect(laidOut.descriptionTop! - laidOut.actionsBottom!).toBe(2);
            // The controls are centred on the title...
            expect(
              centreOf(laidOut.titleTop, laidOut.titleBottom) -
                centreOf(laidOut.actionsTop!, laidOut.actionsBottom!),
            ).toBe(0);
            // ...which stays where every card's title is, the controls reaching 7px above it.
            expect(laidOut.titleTop).toBe(0);
            expect(laidOut.actionsTop).toBe(-7);
            // And whatever comes next starts under all of it.
            expect(laidOut.headerBottom).toBeGreaterThan(
              laidOut.actionsBottom!,
            );
          },
        );

        test.each(DESKTOP_WIDTHS)(
          "at %ipx a status pill beside the title is centred on it, and the description 9px under the title",
          (width: number) => {
            const shape: Shape = {
              layout,
              titleLines: 1,
              actions: "pill",
              description,
            };
            const laidOut: LaidOutHeader = layOut(
              shape,
              classesOf(shape),
              width,
            );

            expect(laidOut.titleTop).toBe(0);
            expect(
              centreOf(laidOut.titleTop, laidOut.titleBottom) -
                centreOf(laidOut.actionsTop!, laidOut.actionsBottom!),
            ).toBe(0);
            expect(laidOut.descriptionTop! - laidOut.titleBottom).toBe(9);
            expect(laidOut.descriptionTop!).toBeGreaterThan(
              laidOut.actionsBottom!,
            );
          },
        );

        test.each(DESKTOP_WIDTHS)(
          "at %ipx a title that breaks over two lines has the controls centred on both, and the description 9px under its last",
          (width: number) => {
            const shape: Shape = {
              layout,
              titleLines: 2,
              actions: "controls",
              description,
            };
            const laidOut: LaidOutHeader = layOut(
              shape,
              classesOf(shape),
              width,
            );

            expect(laidOut.titleTop).toBe(0);
            expect(laidOut.actionsTop).toBe(5);
            expect(
              centreOf(laidOut.titleTop, laidOut.titleBottom) -
                centreOf(laidOut.actionsTop!, laidOut.actionsBottom!),
            ).toBe(0);
            expect(laidOut.descriptionTop! - laidOut.titleBottom).toBe(9);
            expect(laidOut.descriptionTop! - laidOut.actionsBottom!).toBe(14);
          },
        );

        test.each(DESKTOP_WIDTHS)(
          "at %ipx controls that do not fit beside the title go under it - and the description stays 6px under the title, as in a card with no controls, the controls 8px under the description and the body under them",
          (width: number) => {
            const shape: Shape = {
              layout,
              titleLines: 1,
              actions: "controls-under",
              description,
            };
            const classes: HeaderClasses = classesOf(shape);
            const laidOut: LaidOutHeader = layOut(shape, classes, width);

            /*
             * Under the controls, the description sat a button row (or two)
             * under its title: 48px on the Runbooks list at 1024px, 98px at
             * 768px.
             */
            expect(classes.descriptionInTitleBlock).toBe(true);
            expect(classes.description).toBe(CARD_DESCRIPTION_CLASS_NAME);
            expect(laidOut.titleTop).toBe(0);
            expect(laidOut.descriptionTop! - laidOut.titleBottom).toBe(6);
            expect(
              laidOut.actionsTop! -
                (laidOut.descriptionTop! + descriptionHeight(shape)),
            ).toBe(8);
            // Nothing hangs past the header: the body starts under the controls.
            expect(laidOut.headerBottom).toBe(laidOut.actionsBottom);
          },
        );

        test.each(DESKTOP_WIDTHS)(
          "at %ipx with no actions the description is 6px under the title, as in every card",
          (width: number) => {
            const shape: Shape = {
              layout,
              titleLines: 1,
              actions: "none",
              description,
            };
            const laidOut: LaidOutHeader = layOut(
              shape,
              classesOf(shape),
              width,
            );

            expect(laidOut.titleTop).toBe(0);
            expect(laidOut.descriptionTop! - laidOut.titleBottom).toBe(6);
          },
        );
      },
    );

    test.each(DESKTOP_WIDTHS)(
      "at %ipx with no description the controls are centred on the title, which stays at the card's padding, and the card's body starts under them",
      (width: number) => {
        const shape: Shape = {
          layout,
          titleLines: 1,
          actions: "controls",
          description: "none",
        };
        const laidOut: LaidOutHeader = layOut(shape, classesOf(shape), width);

        expect(laidOut.descriptionTop).toBeNull();
        expect(laidOut.titleTop).toBe(0);
        expect(laidOut.actionsTop).toBe(-7);
        expect(laidOut.headerBottom).toBe(laidOut.actionsBottom);
      },
    );

    test.each(DESKTOP_WIDTHS)(
      "at %ipx with no description, controls that do not fit beside the title go under it, 8px down, and the body under them",
      (width: number) => {
        const shape: Shape = {
          layout,
          titleLines: 1,
          actions: "controls-under",
          description: "none",
        };
        const laidOut: LaidOutHeader = layOut(shape, classesOf(shape), width);

        expect(laidOut.titleTop).toBe(0);
        expect(laidOut.actionsTop! - laidOut.titleBottom).toBe(8);
        expect(laidOut.headerBottom).toBe(laidOut.actionsBottom);
      },
    );

    test.each(DESKTOP_WIDTHS)(
      "at %ipx a status pill with no description is centred on the title, and the body starts under the line",
      (width: number) => {
        const shape: Shape = {
          layout,
          titleLines: 1,
          actions: "pill",
          description: "none",
        };
        const laidOut: LaidOutHeader = layOut(shape, classesOf(shape), width);

        expect(laidOut.titleTop).toBe(0);
        expect(
          centreOf(laidOut.titleTop, laidOut.titleBottom) -
            centreOf(laidOut.actionsTop!, laidOut.actionsBottom!),
        ).toBe(0);
        expect(laidOut.headerBottom).toBeGreaterThanOrEqual(
          laidOut.actionsBottom!,
        );
      },
    );

    test.each(DESKTOP_WIDTHS)(
      "at %ipx the title and the controls stand where they stood when a description comes or goes (a table drops its own while its empty state says it)",
      (width: number) => {
        const withDescription: Shape = {
          layout,
          titleLines: 1,
          actions: "controls",
          description: "one-line",
        };
        const withoutDescription: Shape = {
          ...withDescription,
          description: "none",
        };
        const shown: LaidOutHeader = layOut(
          withDescription,
          classesOf(withDescription),
          width,
        );
        const dropped: LaidOutHeader = layOut(
          withoutDescription,
          classesOf(withoutDescription),
          width,
        );

        expect([dropped.titleTop, dropped.actionsTop]).toEqual([
          shown.titleTop,
          shown.actionsTop,
        ]);
      },
    );

    test.each(PHONE_WIDTHS)(
      "at %ipx (a phone, no description shown) the title and the 42px controls are centred on each other, nothing hangs past the line, and the body starts under it",
      (width: number) => {
        for (const description of [
          "one-line",
          "none",
        ] as Array<DescriptionShape>) {
          const shape: Shape = {
            layout,
            titleLines: 1,
            actions: "controls",
            description,
          };
          const classes: HeaderClasses = classesOf(shape);
          const laidOut: LaidOutHeader = layOut(shape, classes, width);

          expect(laidOut.descriptionTop).toBeNull();
          const actionMargins: { top: number; bottom: number } = resolveSpacing(
            classes.actions,
            width,
            "margin",
          );
          expect([actionMargins.top, actionMargins.bottom]).toEqual([0, 0]);
          expect(resolveSpacing(classes.titleBlock, width, "margin")).toEqual({
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          });
          expect(
            centreOf(laidOut.titleTop, laidOut.titleBottom) -
              centreOf(laidOut.actionsTop!, laidOut.actionsBottom!),
          ).toBe(0);
          expect(laidOut.headerBottom).toBe(laidOut.actionsBottom);
        }
      },
    );
  },
);

describe("the default header, laid out", () => {
  test.each(DESKTOP_WIDTHS)(
    "at %ipx keeps its description 6px under the title, beside the actions, whose top is the title's",
    (width: number) => {
      for (const actions of [
        "controls",
        "pill",
        "none",
      ] as Array<ActionsShape>) {
        const shape: Shape = {
          layout: "default",
          titleLines: 1,
          actions,
          description: "one-line",
        };
        const laidOut: LaidOutHeader = layOut(shape, classesOf(shape), width);

        expect([
          actions,
          laidOut.descriptionTop! - laidOut.titleBottom,
        ]).toEqual([actions, 6]);
        expect([actions, laidOut.titleTop]).toEqual([actions, 0]);

        if (laidOut.actionsTop !== null) {
          expect([actions, laidOut.actionsTop]).toEqual([actions, 0]);
        }
      }
    },
  );
});

describe("every layout, at every width", () => {
  test.each(WIDTHS_IN_PX)(
    "at %ipx no description is ever more than 9px under its title, wherever the actions go, and never runs into the controls",
    (width: number) => {
      for (const layout of CARD_HEADER_LAYOUTS) {
        // The default header never sends its actions under the title from md up.
        const actionShapes: Array<ActionsShape> =
          layout === "default"
            ? ["controls", "pill", "none"]
            : ["controls", "pill", "none", "controls-under"];

        for (const actions of actionShapes) {
          for (const titleLines of [1, 2] as Array<1 | 2>) {
            const shape: Shape = {
              layout,
              titleLines,
              actions,
              description: "wrapped",
            };
            const laidOut: LaidOutHeader = layOut(
              shape,
              classesOf(shape),
              width,
            );

            if (laidOut.descriptionTop === null) {
              // A phone: no description to keep close.
              expect(width).toBeLessThan(TABLET_WIDTH_IN_PX);
              continue;
            }

            const label: string = `${layout}, ${actions}, ${titleLines} title line(s)`;
            expect([
              label,
              laidOut.descriptionTop - laidOut.titleBottom <= 9,
            ]).toEqual([label, true]);

            if (laidOut.actionsBottom !== null && layout !== "default") {
              // Under the controls' foot, or - when they went under the title - over their top.
              expect([
                label,
                actions === "controls-under"
                  ? laidOut.descriptionTop + descriptionHeight(shape) <=
                    laidOut.actionsTop!
                  : laidOut.descriptionTop >= laidOut.actionsBottom,
              ]).toEqual([label, true]);
            }
          }
        }
      }
    },
  );

  test.each(WIDTHS_IN_PX)(
    "at %ipx every card's title is at the top of its header - with or without controls, a description or a second line - so the titles of cards side by side line up",
    (width: number) => {
      for (const layout of CARD_HEADER_LAYOUTS) {
        for (const actions of [
          "controls",
          "pill",
          "none",
        ] as Array<ActionsShape>) {
          for (const description of [
            "one-line",
            "none",
          ] as Array<DescriptionShape>) {
            for (const titleLines of [1, 2] as Array<1 | 2>) {
              const shape: Shape = {
                layout,
                titleLines,
                actions,
                description,
              };
              const laidOut: LaidOutHeader = layOut(
                shape,
                classesOf(shape),
                width,
              );

              // A phone centres a short title on taller controls, as it did.
              if (width < MD_IN_PX && actions === "controls") {
                continue;
              }

              const label: string = `${layout}, ${actions}, ${description}, ${titleLines} title line(s)`;
              expect([label, laidOut.titleTop]).toEqual([label, 0]);
            }
          }
        }
      }
    },
  );

  test("a wide desktop draws what a laptop does", () => {
    for (const layout of CARD_HEADER_LAYOUTS) {
      const shape: Shape = {
        layout,
        titleLines: 1,
        actions: "controls",
        description: "one-line",
      };
      const classes: HeaderClasses = classesOf(shape);

      expect(layOut(shape, classes, WIDE_DESKTOP_WIDTH_IN_PX)).toEqual(
        layOut(shape, classes, LAPTOP_WIDTH_IN_PX),
      );
    }
  });
});

describe("the body after a header with no description", () => {
  /*
   * With nothing under the first line, the controls' foot stays in the line
   * (they reach above it only), so the body's own 16px margin is measured
   * from the controls' foot, as it was.
   */
  test.each([...CARD_HEADER_LAYOUTS])(
    "%s: the body keeps its 16px under the line, which ends at the controls' foot",
    (layout: CardHeaderLayout) => {
      const card: ReactElement = (
        <Card
          {...propsFor({
            layout,
            titleLines: 1,
            actions: "controls",
            description: "none",
          })}
        />
      );

      render(card);

      const body: HTMLElement = screen.getByTestId("card-body");

      expect(
        resolveSpacing(
          classOf(body.parentElement),
          LAPTOP_WIDTH_IN_PX,
          "margin",
        ).top,
      ).toBe(16);
      expect(
        resolveSpacing(
          classOf(screen.getByTestId("card-header-actions")),
          LAPTOP_WIDTH_IN_PX,
          "margin",
        ).bottom,
      ).toBe(0);
    },
  );
});
