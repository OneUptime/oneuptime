import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Card, {
  CARD_HEADER_ACTIONS_UNDER_TITLE_ATTRIBUTE,
  CARD_HEADER_LAYOUTS,
  CARD_HEADER_STACKED_TITLE_BLOCK_CLASS_NAME,
  CARD_HEADER_TOOLBAR_FILL_CLASS_NAME,
  CARD_HEADER_TOOLBAR_TITLE_BLOCK_CLASS_NAME,
  ComponentProps,
} from "../../../UI/Components/Card/Card";
import {
  TABLE_HEADER_OPEN_SEARCH_BESIDE_BUTTONS_CLASS_NAME,
  TABLE_HEADER_OPEN_SEARCH_CLASS_NAME,
  TABLE_HEADER_SEARCH_CLASS_NAME,
  TABLE_HEADER_TOOLBAR_CLASS_NAME,
} from "../../../UI/Components/Table/TableHeaderControls";
import { resolveFlex } from "../../ResponsiveFlexLayout";

/*
 * Card's toolbar header (model-table-ui): the stacked header for a card as
 * wide as the page whose actions are a row of controls - a table's search,
 * saved views, main button and ⋯. The title and the controls share the
 * first line and the description runs under both, as in the stacked header;
 * but the title keeps only what a title needs (12rem) beside them, not half
 * the line, so a table's controls stay beside its title until they really
 * do not fit - rather than dropping to a line of their own the moment a
 * filter brings the Saved Views button in.
 */

const baseProps: ComponentProps = {
  title: "Incidents",
  description:
    "An incident is a problem that affects your users, like an outage or a slowdown.",
  buttons: [
    <a key="search" href="#search">
      Search
    </a>,
    <a key="views" href="#views">
      Saved Views
    </a>,
    <a key="declare" href="#declare">
      Declare Incident
    </a>,
  ],
  children: <div>rows</div>,
};

afterEach(() => {
  cleanup();
});

describe("the toolbar header", () => {
  test("is one of Card's layouts", () => {
    expect([...CARD_HEADER_LAYOUTS]).toEqual(["default", "stacked", "toolbar"]);
  });

  test("says which it is", () => {
    render(<Card {...baseProps} headerLayout="toolbar" />);

    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "toolbar",
    );
  });

  test("the title and the controls share the first row; the description follows it, across the card", () => {
    render(<Card {...baseProps} headerLayout="toolbar" />);

    const header: HTMLElement = screen.getByTestId("card-header");
    const row: HTMLElement = screen.getByTestId("card-header-title-row");
    const description: HTMLElement = screen.getByTestId("card-description");

    expect(Array.from(row.children)).toEqual([
      screen.getByTestId("card-header-title-block"),
      screen.getByTestId("card-header-actions"),
    ]);
    expect(Array.from(header.children)).toEqual([row, description]);
    expect(description).toHaveClass("w-full");
  });

  test("the title keeps 12rem beside the controls, not the stacked header's half of the line", () => {
    render(<Card {...baseProps} headerLayout="toolbar" />);

    const titleBlock: HTMLElement = screen.getByTestId(
      "card-header-title-block",
    );

    expect(titleBlock.className).toBe(
      CARD_HEADER_TOOLBAR_TITLE_BLOCK_CLASS_NAME,
    );
    expect(CARD_HEADER_TOOLBAR_TITLE_BLOCK_CLASS_NAME.split(" ")).toEqual([
      "min-w-0",
      "md:grow",
      "md:basis-48",
    ]);
    expect(CARD_HEADER_TOOLBAR_TITLE_BLOCK_CLASS_NAME).not.toBe(
      CARD_HEADER_STACKED_TITLE_BLOCK_CLASS_NAME,
    );
  });

  test("a title with no controls beside it takes the whole width", () => {
    render(
      <Card
        title="Incidents"
        description="All of them."
        headerLayout="toolbar"
      />,
    );

    expect(screen.getByTestId("card-header-title-block")).toHaveClass(
      "w-full",
      "min-w-0",
    );
    expect(screen.queryByTestId("card-header-actions")).toBeNull();
  });

  test("the controls may shrink and wrap at the right edge, never pushing the title off its line", () => {
    render(<Card {...baseProps} headerLayout="toolbar" />);

    const actions: HTMLElement = screen.getByTestId("card-header-actions");

    // The default header's md:flex-shrink-0 is what squeezed its title.
    expect(actions).not.toHaveClass("md:flex-shrink-0");
    expect(actions).toHaveClass("ml-auto", "flex-wrap", "justify-end");

    for (const width of [390, 768, 1024, 1280]) {
      expect(
        resolveFlex(
          screen.getByTestId("card-header-title-row").className,
          width,
          "flex-wrap",
        ),
      ).toBe("wrap");
    }
  });

  test("its markup is the stacked header's but for its name, the title's share, and the line a filling control may take on a phone", () => {
    const toolbar: string = renderToStaticMarkup(
      <Card {...baseProps} headerLayout="toolbar" />,
    );
    const stacked: string = renderToStaticMarkup(
      <Card {...baseProps} headerLayout="stacked" />,
    );

    expect(
      toolbar
        .replace('data-header-layout="toolbar"', 'data-header-layout="stacked"')
        .replace(
          CARD_HEADER_TOOLBAR_TITLE_BLOCK_CLASS_NAME,
          CARD_HEADER_STACKED_TITLE_BLOCK_CLASS_NAME,
        )
        // As markup writes it: its & is &amp;.
        .split(
          ` ${CARD_HEADER_TOOLBAR_FILL_CLASS_NAME.split("&").join("&amp;")}`,
        )
        .join(""),
    ).toBe(stacked);
  });
});

describe("a control that fills the toolbar's line on a phone (a table's search)", () => {
  /*
   * On a phone a table's search filled only its own measure, hung at the
   * right edge; the toolbar's actions and the box the search is in take
   * the card's width below md when they hold an element marked
   * data-toolbar-fill (CARD_HEADER_TOOLBAR_FILL_ATTRIBUTE).
   */
  test("the toolbar's actions and each action's box may take the card's width, only when they hold such a control", () => {
    expect(CARD_HEADER_TOOLBAR_FILL_CLASS_NAME).toBe(
      "max-md:has-[[data-toolbar-fill]]:w-full [[data-actions-under-title=true]_&]:has-[[data-toolbar-fill]]:w-full",
    );

    render(<Card {...baseProps} headerLayout="toolbar" />);

    const actions: HTMLElement = screen.getByTestId("card-header-actions");

    expect(actions).toHaveClass(CARD_HEADER_TOOLBAR_FILL_CLASS_NAME);

    for (const box of Array.from(actions.children)) {
      expect(box).toHaveClass(CARD_HEADER_TOOLBAR_FILL_CLASS_NAME);
    }
  });

  test("a default or stacked header never does: their buttons keep to their own width", () => {
    for (const layout of ["default", "stacked"] as const) {
      expect(
        renderToStaticMarkup(
          <Card {...baseProps} headerLayout={layout} />,
        ).includes(CARD_HEADER_ACTIONS_UNDER_TITLE_ATTRIBUTE),
      ).toBe(false);
    }

    for (const layout of ["default", "stacked"] as const) {
      const markup: string = renderToStaticMarkup(
        <Card {...baseProps} headerLayout={layout} />,
      );

      expect([layout, markup.includes("data-toolbar-fill")]).toEqual([
        layout,
        false,
      ]);
      expect([
        layout,
        markup.includes(CARD_HEADER_TOOLBAR_FILL_CLASS_NAME),
      ]).toEqual([layout, false]);
    }
  });
});

/*
 * Between 768 and about 1100px beside a side menu a table's controls do
 * not fit beside its title and go to a line of their own. The search on
 * that line was a 14rem pill hung at its right edge, the rest of the line
 * empty. Card says when its toolbar's controls are under the title
 * (CARD_HEADER_ACTIONS_UNDER_TITLE_ATTRIBUTE on the title's row), and the
 * search then fills what the buttons leave of the line, as a phone's does.
 * Where they go is read as they are drawn when they share the title's line:
 * a toolbar that fills its line is read without its fill, so it moves back
 * beside the title as soon as it fits there again.
 */
describe("a toolbar whose controls are on a line of their own", () => {
  type Placement = (titleRow: Element) => "beside" | "under";

  const rect: (top: number, bottom: number) => DOMRect = (
    top: number,
    bottom: number,
  ): DOMRect => {
    return {
      x: 0,
      y: top,
      top: top,
      bottom: bottom,
      left: 0,
      right: 600,
      width: 600,
      height: bottom - top,
      toJSON: (): unknown => {
        return {};
      },
    } as DOMRect;
  };

  let placement: Placement = (): "beside" | "under" => {
    return "beside";
  };
  const observers: Array<() => void> = [];
  const original: typeof Element.prototype.getBoundingClientRect =
    Element.prototype.getBoundingClientRect;
  const originalObserver: typeof ResizeObserver | undefined = (
    window as unknown as { ResizeObserver?: typeof ResizeObserver }
  ).ResizeObserver;

  beforeEach(() => {
    observers.length = 0;
    Element.prototype.getBoundingClientRect = function (
      this: Element,
    ): DOMRect {
      const testId: string | null = this.getAttribute("data-testid");
      const titleRow: Element | null = this.closest(
        '[data-testid="card-header-title-row"]',
      );

      if (testId === "card-header-title-block") {
        return rect(0, 24);
      }

      if (testId === "card-header-actions" && titleRow) {
        // Beside the title: centred on its line; under it: a line down.
        return placement(titleRow) === "under" ? rect(36, 74) : rect(-7, 31);
      }

      return original.call(this);
    };
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      public constructor(read: () => void) {
        observers.push(read);
      }

      public observe(): void {}

      public disconnect(): void {}
    };
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = original;
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver =
      originalObserver;
  });

  const titleRow: () => HTMLElement = (): HTMLElement => {
    return screen.getByTestId("card-header-title-row");
  };

  const readAgain: () => void = (): void => {
    act(() => {
      for (const read of observers) {
        read();
      }
    });
  };

  test("the title's row says so while they are under the title, and not while they are beside it", () => {
    placement = (): "beside" | "under" => {
      return "under";
    };
    render(<Card {...baseProps} headerLayout="toolbar" />);

    expect(titleRow()).toHaveAttribute(
      CARD_HEADER_ACTIONS_UNDER_TITLE_ATTRIBUTE,
      "true",
    );

    placement = (): "beside" | "under" => {
      return "beside";
    };
    readAgain();

    expect(titleRow()).not.toHaveAttribute(
      CARD_HEADER_ACTIONS_UNDER_TITLE_ATTRIBUTE,
    );
  });

  test("a toolbar with no description is read too", () => {
    placement = (): "beside" | "under" => {
      return "under";
    };
    render(
      <Card {...baseProps} description={undefined} headerLayout="toolbar" />,
    );

    expect(titleRow()).toHaveAttribute(
      CARD_HEADER_ACTIONS_UNDER_TITLE_ATTRIBUTE,
      "true",
    );
    // With no description, nothing joins the title's block.
    expect(screen.queryByTestId("card-description")).toBeNull();
  });

  test("it is read as drawn without its fill, so a toolbar that fits beside the title again goes back there", () => {
    /*
     * Filling its line, the toolbar is under the title whatever else: it
     * is as wide as the line. Without its fill it fits beside the title.
     */
    placement = (row: Element): "beside" | "under" => {
      return row.getAttribute(CARD_HEADER_ACTIONS_UNDER_TITLE_ATTRIBUTE) ===
        "true"
        ? "under"
        : "beside";
    };
    const startsUnder: { value: boolean } = { value: true };
    const fills: Placement = placement;
    placement = (row: Element): "beside" | "under" => {
      return startsUnder.value ? "under" : fills(row);
    };

    render(<Card {...baseProps} headerLayout="toolbar" />);

    expect(titleRow()).toHaveAttribute(
      CARD_HEADER_ACTIONS_UNDER_TITLE_ATTRIBUTE,
      "true",
    );

    // The window made wider: without its fill the toolbar fits beside.
    startsUnder.value = false;
    readAgain();

    expect(titleRow()).not.toHaveAttribute(
      CARD_HEADER_ACTIONS_UNDER_TITLE_ATTRIBUTE,
    );

    // And it stays there: read again, it is still beside the title.
    readAgain();
    expect(titleRow()).not.toHaveAttribute(
      CARD_HEADER_ACTIONS_UNDER_TITLE_ATTRIBUTE,
    );
  });

  test("a stacked header's actions are never marked: only a toolbar's search fills a line", () => {
    placement = (): "beside" | "under" => {
      return "under";
    };
    render(<Card {...baseProps} headerLayout="stacked" />);

    expect(titleRow()).not.toHaveAttribute(
      CARD_HEADER_ACTIONS_UNDER_TITLE_ATTRIBUTE,
    );
  });

  test("the table's toolbar, its search and its opened search fill the line while it is so", () => {
    const UNDER: string = "[[data-actions-under-title=true]_&]:";

    expect(TABLE_HEADER_TOOLBAR_CLASS_NAME).toContain(`${UNDER}w-full`);
    expect(TABLE_HEADER_SEARCH_CLASS_NAME).toContain(`${UNDER}flex-1`);
    expect(TABLE_HEADER_SEARCH_CLASS_NAME).toContain(`${UNDER}min-w-[11rem]`);
    // Its 14rem pill otherwise, from md up.
    expect(TABLE_HEADER_SEARCH_CLASS_NAME).toContain("md:w-56");
    expect(TABLE_HEADER_OPEN_SEARCH_CLASS_NAME).toContain(`${UNDER}flex-1`);
    expect(TABLE_HEADER_OPEN_SEARCH_BESIDE_BUTTONS_CLASS_NAME).toContain(
      `${UNDER}flex-1`,
    );
    // The attribute those read is the one Card writes.
    expect(UNDER).toContain(
      `[${CARD_HEADER_ACTIONS_UNDER_TITLE_ATTRIBUTE}=true]`,
    );
  });
});
