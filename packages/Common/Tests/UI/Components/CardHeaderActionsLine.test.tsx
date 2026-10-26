import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Card, {
  CARD_DESCRIPTION_CLASS_NAME,
  CARD_DESCRIPTION_UNDER_ACTIONS_CLASS_NAME,
  CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES,
  CARD_HEADER_ACTIONS_UNDER_TITLE_ATTRIBUTE,
  CARD_HEADER_TITLE_BLOCK_OVER_NOTHING_CLASS_NAME,
  CARD_HEADER_TITLE_LINE_CLASS_NAMES,
  CARD_HEADER_TITLE_ROW_CLASS_NAME,
  CardButtonSchema,
  CardHeaderLayout,
  ComponentProps,
  cardHeaderActionsAreUnderTitle,
} from "../../../UI/Components/Card/Card";
import IconProp from "../../../Types/Icon/IconProp";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";
import {
  DrawnCardHeaders,
  FakeResizeObservers,
  drawCardHeaders,
  installFakeResizeObservers,
} from "../../Helpers/CardHeaderDrawing";
import { isVisibleAtWidth } from "../../ResponsiveVisibility";
import { widthsBelow, widthsFrom } from "../../RenderedMarkup";

/*
 * "There's a lot of gap between the title of the card and the description
 * of the card." In Card's stacked and toolbar headers the description runs
 * under the line the title shares with the actions - but where the actions
 * do not fit beside the title (a list with a side menu at 1024px, two
 * buttons in an overview's one-third column) they go to a line of their
 * own, and a description that followed them sat a button row or two under
 * its title: 48px on the Runbooks list at 1024px, 98px at 768px.
 *
 * Where the actions go is the browser's to say (the title, the controls and
 * the language decide it), so Card reads it from the drawn header and, when
 * they went under the title, puts the description in the title's block:
 * 6px under the title, as in a card with no actions, and the actions after
 * it. jsdom draws nothing, so the header is drawn here by hand
 * (Helpers/CardHeaderDrawing); CardHeaders.spec.ts measures it in Chromium.
 */

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

const DESCRIPTION: string =
  "Reusable response procedures: ordered checklists of manual or automated steps.";

const STACKED_LAYOUTS: Array<CardHeaderLayout> = ["stacked", "toolbar"];

function propsFor(layout: CardHeaderLayout): ComponentProps {
  return {
    title: "Runbooks",
    description: DESCRIPTION,
    headerLayout: layout,
    buttons: [EDIT, REFRESH],
    children: <div data-testid="card-body">rows</div>,
  };
}

function classOf(element: Element | null): string {
  return element?.getAttribute("class") || "";
}

function titleRow(): HTMLElement {
  return screen.getByTestId("card-header-title-row");
}

function titleBlock(): HTMLElement {
  return screen.getByTestId("card-header-title-block");
}

function description(): HTMLElement {
  return screen.getByTestId("card-description");
}

function actions(): HTMLElement {
  return screen.getByTestId("card-header-actions");
}

// What the header says by where its description is and how it is drawn.
function expectDescriptionInTitleBlock(): void {
  // In the title's block, right after the title...
  expect(description().parentElement).toBe(titleBlock());
  expect(description().previousElementSibling).toBe(
    screen.getByTestId("card-details-heading"),
  );
  // ...6px under it, as in a card with no actions.
  expect(classOf(description())).toBe(CARD_DESCRIPTION_CLASS_NAME);
  // The actions follow the block, and reach past nothing.
  expect(titleBlock().nextElementSibling).toBe(actions());
  for (const className of Object.values(
    CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES,
  )) {
    expect(classOf(actions()).split(" ")).not.toContain(className);
  }
  expect(classOf(titleBlock()).split(" ")).not.toContain(
    CARD_HEADER_TITLE_BLOCK_OVER_NOTHING_CLASS_NAME,
  );
  expect(classOf(titleRow())).toBe(
    `${CARD_HEADER_TITLE_ROW_CLASS_NAME} ${CARD_HEADER_TITLE_LINE_CLASS_NAMES.overActions}`,
  );
  // Nothing of the header follows the line.
  expect(titleRow().nextElementSibling).toBeNull();
}

function expectDescriptionUnderLine(): void {
  // After the line the title shares with the actions, across the card...
  expect(description().parentElement).toBe(screen.getByTestId("card-header"));
  expect(titleRow().nextElementSibling).toBe(description());
  // ...9px under the title, clear of the controls centred on its line.
  expect(classOf(description())).toBe(
    CARD_DESCRIPTION_UNDER_ACTIONS_CLASS_NAME,
  );
  expect(classOf(actions()).split(" ")).toContain(
    CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES.overDescription,
  );
  expect(classOf(titleRow())).toBe(
    `${CARD_HEADER_TITLE_ROW_CLASS_NAME} ${CARD_HEADER_TITLE_LINE_CLASS_NAMES.besideActions}`,
  );
  expect(titleBlock()).not.toContainElement(description());
}

let drawn: DrawnCardHeaders | null = null;
let observers: FakeResizeObservers | null = null;

function draw(placement: "beside" | "under" | "undrawn"): DrawnCardHeaders {
  drawn = drawCardHeaders(placement);
  return drawn;
}

function watchResizes(): FakeResizeObservers {
  observers = installFakeResizeObservers();
  return observers;
}

afterEach(() => {
  cleanup();
  drawn?.restore();
  drawn = null;
  observers?.restore();
  observers = null;
});

describe("cardHeaderActionsAreUnderTitle reads the drawn header", () => {
  function partsAt(
    block: { top: number; height: number },
    controls: { top: number; height: number },
  ): { titleBlock: Element; actions: Element } {
    const at: (span: {
      top: number;
      height: number;
    }) => () => DOMRect = (span: { top: number; height: number }) => {
      return (): DOMRect => {
        return {
          x: 0,
          y: span.top,
          top: span.top,
          bottom: span.top + span.height,
          left: 0,
          right: 300,
          width: 300,
          height: span.height,
          toJSON: (): Record<string, unknown> => {
            return {};
          },
        } as DOMRect;
      };
    };
    const blockElement: HTMLDivElement = document.createElement("div");
    const actionsElement: HTMLDivElement = document.createElement("div");

    jest
      .spyOn(blockElement, "getBoundingClientRect")
      .mockImplementation(at(block));
    jest
      .spyOn(actionsElement, "getBoundingClientRect")
      .mockImplementation(at(controls));

    return { titleBlock: blockElement, actions: actionsElement };
  }

  test("38px controls centred on a one-line title, reaching 7px above it: beside", () => {
    const parts: { titleBlock: Element; actions: Element } = partsAt(
      { top: 0, height: 24 },
      { top: -7, height: 38 },
    );

    expect(
      cardHeaderActionsAreUnderTitle(parts.titleBlock, parts.actions),
    ).toBe(false);
  });

  test("Edit centred on a title over two lines: beside", () => {
    const parts: { titleBlock: Element; actions: Element } = partsAt(
      { top: 0, height: 48 },
      { top: 5, height: 38 },
    );

    expect(
      cardHeaderActionsAreUnderTitle(parts.titleBlock, parts.actions),
    ).toBe(false);
  });

  test("a status pill centred on the title: beside", () => {
    const parts: { titleBlock: Element; actions: Element } = partsAt(
      { top: 0, height: 24 },
      { top: 1, height: 22 },
    );

    expect(
      cardHeaderActionsAreUnderTitle(parts.titleBlock, parts.actions),
    ).toBe(false);
  });

  test("controls on the next line, 8px under the title's block: under", () => {
    const parts: { titleBlock: Element; actions: Element } = partsAt(
      { top: 0, height: 24 },
      { top: 32, height: 38 },
    );

    expect(
      cardHeaderActionsAreUnderTitle(parts.titleBlock, parts.actions),
    ).toBe(true);
  });

  test("under a block that holds the description too (a wrapped header read again): still under", () => {
    const parts: { titleBlock: Element; actions: Element } = partsAt(
      { top: 0, height: 52.75 },
      { top: 60.75, height: 38 },
    );

    expect(
      cardHeaderActionsAreUnderTitle(parts.titleBlock, parts.actions),
    ).toBe(true);
  });

  test("before the description moves, still reaching 7px up from the next line - 1px under the title: under", () => {
    const parts: { titleBlock: Element; actions: Element } = partsAt(
      { top: 0, height: 24 },
      { top: 25, height: 38 },
    );

    expect(
      cardHeaderActionsAreUnderTitle(parts.titleBlock, parts.actions),
    ).toBe(true);
  });

  test("a header that is not drawn (hidden, or no layout) cannot say", () => {
    expect(
      cardHeaderActionsAreUnderTitle(
        document.createElement("div"),
        document.createElement("div"),
      ),
    ).toBeNull();

    const hiddenActions: { titleBlock: Element; actions: Element } = partsAt(
      { top: 0, height: 24 },
      { top: 0, height: 0 },
    );
    expect(
      cardHeaderActionsAreUnderTitle(
        hiddenActions.titleBlock,
        hiddenActions.actions,
      ),
    ).toBeNull();
  });
});

describe.each(STACKED_LAYOUTS)(
  "the %s header, where its actions went",
  (layout: CardHeaderLayout) => {
    test("actions on a line of their own under the title: the description joins the title's block - 6px under the title - and the actions follow it", () => {
      draw("under");
      render(<Card {...propsFor(layout)} />);

      expectDescriptionInTitleBlock();
      // Read in that order too: the title, what it is, then what to do.
      expect(screen.getByTestId("card-header").textContent).toBe(
        `Runbooks${DESCRIPTION}EditRefresh`,
      );
    });

    test("actions beside the title: the description runs under both, across the card, 9px under the title", () => {
      draw("beside");
      render(<Card {...propsFor(layout)} />);

      expectDescriptionUnderLine();
      expect(screen.getByTestId("card-header").textContent).toBe(
        `RunbooksEditRefresh${DESCRIPTION}`,
      );
    });

    test("a header that is not drawn (a hidden card, a test's DOM) stays as it would be beside the title", () => {
      draw("undrawn");
      render(<Card {...propsFor(layout)} />);

      expectDescriptionUnderLine();
    });

    test("read again whenever the header's size changes: narrowed until the actions go under the title, and widened back", () => {
      const resizes: FakeResizeObservers = watchResizes();
      const header: DrawnCardHeaders = draw("beside");

      render(<Card {...propsFor(layout)} />);
      expectDescriptionUnderLine();
      // It watches the line the title shares with the actions.
      expect(resizes.observed()).toEqual([titleRow()]);

      header.setPlacement("under");
      act(() => {
        resizes.resize();
      });
      expectDescriptionInTitleBlock();

      header.setPlacement("beside");
      act(() => {
        resizes.resize();
      });
      expectDescriptionUnderLine();

      // A size it cannot read (the card hidden for a moment) changes nothing.
      header.setPlacement("undrawn");
      act(() => {
        resizes.resize();
      });
      expectDescriptionUnderLine();

      header.setPlacement("under");
      act(() => {
        resizes.resize();
      });
      expectDescriptionInTitleBlock();
      header.setPlacement("undrawn");
      act(() => {
        resizes.resize();
      });
      expectDescriptionInTitleBlock();

      // The same observer all along: a re-render does not start another.
      expect(resizes.made()).toBe(1);
    });

    test("stops watching when the card goes away", () => {
      const resizes: FakeResizeObservers = watchResizes();
      draw("beside");

      const { unmount } = render(<Card {...propsFor(layout)} />);
      expect(resizes.observed()).toHaveLength(1);

      unmount();
      expect(resizes.observed()).toHaveLength(0);
    });

    test("a description that comes and goes (a table's own, dropped while its empty state says it) is read when it comes back", () => {
      const resizes: FakeResizeObservers = watchResizes();
      draw("under");

      const { rerender } = render(<Card {...propsFor(layout)} />);
      expectDescriptionInTitleBlock();

      /*
       * Without a description there is nothing to move: a stacked header
       * stops watching. A toolbar still reads where its controls went, for
       * its search - on a line of their own, it fills it.
       */
      rerender(<Card {...propsFor(layout)} description={undefined} />);
      expect(screen.queryByTestId("card-description")).toBeNull();
      if (layout === "toolbar") {
        expect(resizes.observed()).toEqual([titleRow()]);
        expect(titleRow()).toHaveAttribute(
          CARD_HEADER_ACTIONS_UNDER_TITLE_ATTRIBUTE,
          "true",
        );
      } else {
        expect(resizes.observed()).toHaveLength(0);
        expect(titleRow()).not.toHaveAttribute(
          CARD_HEADER_ACTIONS_UNDER_TITLE_ATTRIBUTE,
        );
      }
      expect(classOf(titleRow())).toBe(
        `${CARD_HEADER_TITLE_ROW_CLASS_NAME} ${CARD_HEADER_TITLE_LINE_CLASS_NAMES.besideActions}`,
      );
      expect(classOf(actions()).split(" ")).toContain(
        CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES.overNothing,
      );

      rerender(<Card {...propsFor(layout)} />);
      expectDescriptionInTitleBlock();
      expect(resizes.observed()).toEqual([titleRow()]);
    });

    test("on a phone the description is not shown, in the title's block or under the line", () => {
      draw("under");
      render(<Card {...propsFor(layout)} />);

      for (const width of widthsBelow("md")) {
        expect(isVisibleAtWidth(description(), width)).toBe(false);
      }
      for (const width of widthsFrom("md")) {
        expect(isVisibleAtWidth(description(), width)).toBe(true);
      }
    });
  },
);

describe("only a header with something to move reads where its actions went", () => {
  /*
   * Each case drawn with its actions under the title: none of them watches
   * its size, and the description stays where that header always has it.
   */
  type DescriptionPlace =
    // The default header: the title's block, beside the actions.
    | "title block"
    // After the first line, 6px under a title with nothing beside it.
    | "after a title alone"
    // After the first line, 6px under actions with no title beside them.
    | "after the actions"
    | "none";

  const cases: Array<[string, ComponentProps, DescriptionPlace]> = [
    [
      "the default header (its description is always in the title's block)",
      { ...propsFor("toolbar"), headerLayout: "default" },
      "title block",
    ],
    [
      "a stacked header with no description",
      { ...propsFor("stacked"), description: undefined },
      "none",
    ],
    [
      "a toolbar header with no actions",
      { ...propsFor("toolbar"), buttons: undefined },
      "after a title alone",
    ],
    [
      "a stacked header with no title (nothing to sit beside)",
      { ...propsFor("stacked"), title: undefined },
      "after the actions",
    ],
  ];

  test.each(cases)(
    "%s",
    (_name: string, props: ComponentProps, place: DescriptionPlace) => {
      const resizes: FakeResizeObservers = watchResizes();
      draw("under");

      render(<Card {...props} />);

      expect(resizes.made()).toBe(0);

      const found: HTMLElement | null =
        screen.queryByTestId("card-description");

      if (place === "none") {
        expect(found).toBeNull();
        return;
      }

      expect(found).not.toBeNull();

      if (place === "title block") {
        expect(found!.parentElement).toBe(titleBlock());
        expect(classOf(found)).toBe(CARD_DESCRIPTION_CLASS_NAME);
        return;
      }

      expect(found!.parentElement).toBe(screen.getByTestId("card-header"));
      expect(found!.previousElementSibling).toBe(titleRow());
      expect(classOf(found)).toBe(CARD_DESCRIPTION_CLASS_NAME);
    },
  );

  test("a header drawn on the server (no layout) renders as beside the title, with no warning", () => {
    const errors: Array<unknown> = [];
    const spy: SpyInstance<typeof console.error> = jest
      .spyOn(console, "error")
      .mockImplementation((...args: Array<unknown>): void => {
        errors.push(args[0]);
      });

    try {
      const markup: string = renderToStaticMarkup(
        <Card {...propsFor("toolbar")} />,
      );

      expect(markup).toContain(CARD_DESCRIPTION_UNDER_ACTIONS_CLASS_NAME);
      expect(errors).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
