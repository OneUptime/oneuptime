import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Card, {
  CARD_HEADER_ACTION_CLASS_NAME,
  CardButtonSchema,
  ComponentProps,
} from "../../../UI/Components/Card/Card";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import IconProp from "../../../Types/Icon/IconProp";
import React, { ReactElement } from "react";
import { describe, expect, jest } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
  describeVisibility,
  isVisibleAtWidth,
  resolveDisplay,
} from "../../ResponsiveVisibility";
import { resolveFlex } from "../../ResponsiveFlexLayout";
import { resolveSpacing } from "../../ResponsiveSpacing";

describe("Card", () => {
  const props: ComponentProps = {
    title: "title",
    description: "description",
  };

  type RenderComponentFunction = (props: ComponentProps) => void;

  const renderComponent: RenderComponentFunction = (
    props: ComponentProps,
  ): void => {
    render(<Card {...props} />);
  };

  test("should display card title", () => {
    renderComponent(props);

    const title: HTMLElement = screen.getByText(props.title as string);
    expect(title).toBeInTheDocument();
    expect(title).toHaveClass("text-lg font-semibold leading-6 text-gray-900");
  });

  test("should display card description", () => {
    renderComponent(props);

    const description: HTMLElement = screen.getByText(
      props.description as string,
    );
    expect(description).toBeInTheDocument();
    expect(description).toHaveClass("mt-1.5 text-sm text-gray-500");
  });

  test("should render rightElement passed in the props", () => {
    const rightElementText: string = "right element";
    const rightElement: ReactElement = <div>{rightElementText}</div>;

    renderComponent({ ...props, rightElement });

    expect(screen.getByText(rightElementText)).toBeInTheDocument();
  });

  test("should render buttons with the button schemas passed in the props", () => {
    const buttons: CardButtonSchema[] = [
      {
        title: "btn 1",
        buttonStyle: ButtonStyleType.SUCCESS,
        onClick: jest.fn(),
        icon: IconProp.Success,
        className: "btn-1-class",
      },
      {
        title: "btn 2",
        buttonStyle: ButtonStyleType.DANGER,
        onClick: jest.fn(),
        icon: IconProp.Close,
        className: "btn-2-class",
        disabled: true,
      },
    ];

    renderComponent({ ...props, buttons });

    const button1: HTMLElement = screen.getByText(buttons[0]?.title ?? "");
    fireEvent.click(button1);
    expect(button1).toBeInTheDocument();
    expect(button1).toHaveClass(buttons[0]?.className ?? "");
    expect(buttons[0]?.onClick).toHaveBeenCalled();

    const button2: HTMLElement = screen.getByText(buttons[1]?.title ?? "");
    expect(button2).toBeInTheDocument();
    expect(button2).toBeDisabled();
  });

  test("should render component children passed in the props and their parent element should have bodyClassName value passed in the props as css class", () => {
    const bodyClassName: string = "body-class";
    const childElementText: string = "child element";
    const childElement: ReactElement = <div key={0}>{childElementText}</div>;

    renderComponent({ ...props, children: [childElement], bodyClassName });

    const childComponent: HTMLElement = screen.getByText(childElementText);

    expect(childComponent).toBeInTheDocument();
    expect(childComponent.parentElement).toHaveClass(bodyClassName);
  });

  test("should render component children passed in the props and their parent element have css class 'mt-4'", () => {
    const childElementText: string = "child element";
    const childElement: ReactElement = <div key={0}>{childElementText}</div>;

    renderComponent({ ...props, children: [childElement] });

    const childComponent: HTMLElement = screen.getByText(childElementText);

    expect(childComponent).toBeInTheDocument();
    expect(childComponent.parentElement).toHaveClass("mt-4");
  });
});

/*
 * "Why are edit buttons not on the right?" The overview pages' narrow
 * column drew its cards' Edit under the description, at the left, at every
 * width; a phone centred every card's buttons under its title; a status
 * badge that did not fit went under the title, at the left. Every header
 * now keeps what the card offers at its right edge, on the title's line,
 * and moves it to the next line - still at the right edge - only when the
 * two do not fit.
 *
 * jsdom has no stylesheet, so these tests read the classes the way the
 * cascade would (ResponsiveFlexLayout / ResponsiveSpacing /
 * ResponsiveVisibility). The browser half - real boxes on the real overview
 * pages - is in E2E/EventOverview and E2E/MonitorOverview.
 */
describe("Card header layout", () => {
  const buttons: Array<CardButtonSchema> = [
    {
      title: "Edit",
      buttonStyle: ButtonStyleType.NORMAL,
      onClick: jest.fn(),
      icon: IconProp.Edit,
    },
    {
      title: "Refresh",
      buttonStyle: ButtonStyleType.OUTLINE,
      onClick: jest.fn(),
      icon: IconProp.Refresh,
    },
  ];

  const baseProps: ComponentProps = {
    title: "Incident Details",
    description: "Key facts about this incident.",
    buttons: buttons,
    rightElement: <span>right element</span>,
    children: <div>body</div>,
  };

  const WIDTHS: Array<number> = [
    PHONE_WIDTH_IN_PX,
    TABLET_WIDTH_IN_PX,
    LAPTOP_WIDTH_IN_PX,
    WIDE_DESKTOP_WIDTH_IN_PX,
  ];

  const DESKTOP_WIDTHS: Array<number> = [
    TABLET_WIDTH_IN_PX,
    LAPTOP_WIDTH_IN_PX,
    WIDE_DESKTOP_WIDTH_IN_PX,
  ];

  type RenderMarkupFunction = (props: ComponentProps) => string;

  const renderMarkup: RenderMarkupFunction = (
    props: ComponentProps,
  ): string => {
    const { container, unmount } = render(<Card {...props} />);
    const markup: string = container.innerHTML;
    unmount();
    return markup;
  };

  function header(): HTMLElement {
    return screen.getByTestId("card-header");
  }

  function actions(): HTMLElement {
    return screen.getByTestId("card-header-actions");
  }

  function titleBlock(): HTMLElement {
    return screen.getByTestId("card-header-title-block");
  }

  // The flex row the title and the actions share.
  function titleRow(): HTMLElement {
    return actions().parentElement!;
  }

  function classOf(element: Element): string {
    return element.getAttribute("class") || "";
  }

  // margin-left: auto resolves to NaN: it has no length before layout.
  function hasAutoLeftMargin(element: Element, width: number): boolean {
    return Number.isNaN(resolveSpacing(classOf(element), width, "margin").left);
  }

  describe("default", () => {
    /*
     * Pinned whole: every card in the product that does not ask for another
     * layout draws exactly this, so a change to it is a change to all of
     * them and should be made on purpose.
     */
    const GOLDEN_WITH_ACTIONS: string =
      '<div data-testid="card" class="mb-5 extra"><div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible"><div class="py-6 px-5 md:px-6"><div data-testid="card-header" data-header-layout="default" class="flex flex-wrap items-center gap-x-4 gap-y-2 md:flex-nowrap md:items-start"><div data-testid="card-header-title-block" class="min-w-0 md:flex-1"><h2 data-testid="card-details-heading" id="card-details-heading" class="text-lg font-semibold leading-6 text-gray-900 text-balance break-words">Title</h2><p data-testid="card-description" class="mt-1.5 text-sm text-gray-500 w-full max-md:hidden md:block leading-relaxed">Desc</p></div><div data-testid="card-header-actions" class="ml-auto flex max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-2 md:flex-shrink-0"><div class="flex items-center"><span>right</span></div><div class="flex items-center [&amp;>button]:ml-0 [&amp;>button]:md:ml-0 [&amp;>*>button]:ml-0 [&amp;>*>button]:md:ml-0"><a href="/docs">Docs</a></div></div></div><div class="mt-0"><div>body</div></div></div></div></div>';

    const GOLDEN_WITHOUT_ACTIONS: string =
      '<div data-testid="card" class="mb-5 "><div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible"><div class="py-6 px-5 md:px-6"><div data-testid="card-header" data-header-layout="default" class="flex flex-wrap items-center gap-x-4 gap-y-2 md:flex-nowrap md:items-start"><div data-testid="card-header-title-block" class="w-full min-w-0"><h2 data-testid="card-details-heading" id="card-details-heading" class="text-lg font-semibold leading-6 text-gray-900 text-balance break-words">Title</h2><p data-testid="card-description" class="mt-1.5 text-sm text-gray-500 w-full max-md:hidden md:block leading-relaxed">Desc</p></div></div></div></div></div>';

    test.each([
      ["left out", undefined],
      ["default", "default"],
    ] as Array<[string, "default" | undefined]>)(
      "headerLayout %s renders this exact markup",
      (_label: string, headerLayout: "default" | undefined) => {
        expect(
          renderMarkup({
            title: "Title",
            description: "Desc",
            rightElement: <span>right</span>,
            buttons: [
              <a key="docs" href="/docs">
                Docs
              </a>,
            ],
            children: <div>body</div>,
            className: "extra",
            bodyClassName: "mt-0",
            headerLayout: headerLayout,
          }),
        ).toBe(GOLDEN_WITH_ACTIONS);

        expect(
          renderMarkup({
            title: "Title",
            description: "Desc",
            headerLayout: headerLayout,
          }),
        ).toBe(GOLDEN_WITHOUT_ACTIONS);
      },
    );

    test("the title block and the actions share one row, the actions last", () => {
      render(<Card {...baseProps} />);

      expect(header()).toHaveAttribute("data-header-layout", "default");
      expect(Array.from(header().children)).toEqual([titleBlock(), actions()]);
      expect(titleBlock()).toContainElement(
        screen.getByTestId("card-details-heading"),
      );
    });

    test.each(WIDTHS)(
      "at %ipx the row runs left to right and the actions sit at its right edge",
      (width: number) => {
        render(<Card {...baseProps} />);

        expect(resolveFlex(classOf(header()), width, "flex-direction")).toBe(
          "row",
        );
        expect(hasAutoLeftMargin(actions(), width)).toBe(true);
        expect(resolveFlex(classOf(actions()), width, "justify-content")).toBe(
          "flex-end",
        );
      },
    );

    test.each(DESKTOP_WIDTHS)(
      "at %ipx the row never wraps: the actions stay beside the title, never under the description",
      (width: number) => {
        render(<Card {...baseProps} />);

        expect(resolveFlex(classOf(header()), width, "flex-wrap")).toBe(
          "nowrap",
        );
        // The description is in the title block, beside the actions.
        expect(titleBlock()).toContainElement(
          screen.getByTestId("card-description"),
        );
        // Their tops are level: the title's line, not the block's middle.
        expect(resolveFlex(classOf(header()), width, "align-items")).toBe(
          "flex-start",
        );
        // The title block gives way, never the actions.
        expect(classOf(titleBlock())).toContain("md:flex-1");
        expect(classOf(actions())).toContain("md:flex-shrink-0");
      },
    );

    test("on a phone the title and the actions share a line while they fit, and the actions wrap - at the right edge - when they do not", () => {
      render(<Card {...baseProps} />);

      expect(
        resolveFlex(classOf(header()), PHONE_WIDTH_IN_PX, "flex-wrap"),
      ).toBe("wrap");
      expect(
        resolveFlex(classOf(header()), PHONE_WIDTH_IN_PX, "align-items"),
      ).toBe("center");
      // The description that would sit between them is not on a phone.
      expect(
        isVisibleAtWidth(
          screen.getByTestId("card-description"),
          PHONE_WIDTH_IN_PX,
        ),
      ).toBe(false);
      /*
       * The title keeps its whole width on a phone: no grow, no basis below
       * md, so the actions wrap before the title would break to make room.
       */
      const tokens: Array<string> = classOf(titleBlock()).split(" ");
      const FLEX_SIZING: RegExp = /^(grow|basis-|flex-1$|shrink)/;

      expect(tokens).toContain("min-w-0");
      expect(
        tokens.filter((token: string): boolean => {
          return FLEX_SIZING.test(token);
        }),
      ).toEqual([]);
    });

    test("a card with no actions gives the title block the full width", () => {
      render(<Card title="Only a title" description="And a description" />);

      expect(titleBlock()).toHaveClass("w-full", "min-w-0");
      expect(titleBlock()).not.toHaveClass("grow");
      expect(screen.queryByTestId("card-header-actions")).toBeNull();
      expect(header().children).toHaveLength(1);
    });
  });

  describe("stacked", () => {
    const GOLDEN_WITH_ACTIONS: string =
      '<div data-testid="card" class="mb-5 extra"><div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible"><div class="py-6 px-5 md:px-6"><div data-testid="card-header" data-header-layout="stacked"><div data-testid="card-header-title-row" class="flex flex-wrap items-center gap-x-4 gap-y-2 md:items-start"><div data-testid="card-header-title-block" class="min-w-0 md:grow md:basis-1/2"><h2 data-testid="card-details-heading" id="card-details-heading" class="text-lg font-semibold leading-6 text-gray-900 text-balance break-words">Title</h2></div><div data-testid="card-header-actions" class="ml-auto flex max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-2"><div class="flex items-center"><span>right</span></div><div class="flex items-center [&amp;>button]:ml-0 [&amp;>button]:md:ml-0 [&amp;>*>button]:ml-0 [&amp;>*>button]:md:ml-0"><a href="/docs">Docs</a></div></div></div><p data-testid="card-description" class="mt-1.5 text-sm text-gray-500 w-full max-md:hidden md:block leading-relaxed">Desc</p></div><div class="mt-0"><div>body</div></div></div></div></div>';

    test("renders this exact markup", () => {
      expect(
        renderMarkup({
          title: "Title",
          description: "Desc",
          rightElement: <span>right</span>,
          buttons: [
            <a key="docs" href="/docs">
              Docs
            </a>,
          ],
          children: <div>body</div>,
          className: "extra",
          bodyClassName: "mt-0",
          headerLayout: "stacked",
        }),
      ).toBe(GOLDEN_WITH_ACTIONS);
    });

    test("the title and the actions share the first row; the description follows it, across the whole width", () => {
      render(<Card {...baseProps} headerLayout="stacked" />);

      const description: HTMLElement = screen.getByTestId("card-description");

      expect(header()).toHaveAttribute("data-header-layout", "stacked");
      expect(titleRow()).toBe(screen.getByTestId("card-header-title-row"));
      expect(Array.from(titleRow().children)).toEqual([
        titleBlock(),
        actions(),
      ]);
      expect(Array.from(header().children)).toEqual([titleRow(), description]);
      expect(titleRow()).not.toContainElement(description);
      expect(description).toHaveClass("w-full");
    });

    test.each(WIDTHS)(
      "at %ipx the row runs left to right, wraps, and keeps the actions at its right edge",
      (width: number) => {
        render(<Card {...baseProps} headerLayout="stacked" />);

        expect(resolveFlex(classOf(titleRow()), width, "flex-direction")).toBe(
          "row",
        );
        expect(resolveFlex(classOf(titleRow()), width, "flex-wrap")).toBe(
          "wrap",
        );
        expect(hasAutoLeftMargin(actions(), width)).toBe(true);
        expect(resolveFlex(classOf(actions()), width, "justify-content")).toBe(
          "flex-end",
        );
      },
    );

    test("centred on each other on a phone; from md up their tops are level, as in the default header", () => {
      render(<Card {...baseProps} headerLayout="stacked" />);

      expect(
        resolveFlex(classOf(titleRow()), PHONE_WIDTH_IN_PX, "align-items"),
      ).toBe("center");

      for (const width of DESKTOP_WIDTHS) {
        expect(resolveFlex(classOf(titleRow()), width, "align-items")).toBe(
          "flex-start",
        );
      }
    });

    test("from md up the title takes what the actions leave, down to half the line, and wraps its own words before it gives up the line; on a phone it keeps its whole width", () => {
      render(<Card {...baseProps} headerLayout="stacked" />);

      const tokens: Array<string> = classOf(titleBlock()).split(" ");

      expect(tokens).toEqual(
        expect.arrayContaining(["min-w-0", "md:grow", "md:basis-1/2"]),
      );
      expect(tokens).not.toContain("grow");
      expect(tokens).not.toContain("basis-1/2");
      expect(screen.getByTestId("card-details-heading")).toHaveClass(
        "text-balance",
      );
    });

    test("without a title the row holds only the actions, still at the right edge", () => {
      render(
        <Card
          description="Only a description."
          headerLayout="stacked"
          buttons={buttons}
        />,
      );

      expect(screen.queryByTestId("card-header-title-block")).toBeNull();
      expect(Array.from(titleRow().children)).toEqual([actions()]);
      expect(hasAutoLeftMargin(actions(), LAPTOP_WIDTH_IN_PX)).toBe(true);
    });

    test("with neither a title nor actions there is no row, only the description", () => {
      render(<Card description="Only a description." headerLayout="stacked" />);

      expect(screen.queryByTestId("card-header-title-row")).toBeNull();
      expect(Array.from(header().children)).toEqual([
        screen.getByTestId("card-description"),
      ]);
    });

    test("without a description there is nothing under the row", () => {
      render(
        <Card
          title="Details"
          headerLayout="stacked"
          rightElement={<span>Completed</span>}
        />,
      );

      expect(screen.queryByTestId("card-description")).toBeNull();
      expect(header().children).toHaveLength(1);
    });

    test("with no actions there is no actions box", () => {
      render(
        <Card
          title="Details"
          description="Nothing to do here."
          headerLayout="stacked"
          buttons={[]}
        />,
      );

      expect(screen.queryByTestId("card-header-actions")).toBeNull();
      expect(screen.getByTestId("card-header-title-row").children).toHaveLength(
        1,
      );
    });
  });

  describe.each(["default", "stacked"] as Array<"default" | "stacked">)(
    "both layouts (%s)",
    (headerLayout: "default" | "stacked") => {
      test("the right element comes first, then each button, each in a box of its own", () => {
        render(<Card {...baseProps} headerLayout={headerLayout} />);

        expect(actions().children).toHaveLength(3);
        expect(actions().children[0]).toHaveTextContent("right element");
        expect(
          within(actions())
            .getAllByTestId("card-button")
            .map((button: HTMLElement): string => {
              return button.textContent || "";
            }),
        ).toEqual(["Edit", "Refresh"]);
        expect(
          screen
            .getByText("Edit")
            .closest("[data-testid='card-header-actions'] > div"),
        ).toBe(actions().children[1]);
      });

      test("each button's box clears the button's own left margin, so the row's gap alone spaces them", () => {
        render(<Card {...baseProps} headerLayout={headerLayout} />);

        const boxes: Array<Element> = Array.from(actions().children).slice(1);

        for (const box of boxes) {
          expect(box.getAttribute("class")).toBe(CARD_HEADER_ACTION_CLASS_NAME);
          expect(box).toHaveClass(
            "[&>button]:ml-0",
            "[&>button]:md:ml-0",
            "[&>*>button]:ml-0",
            "[&>*>button]:md:ml-0",
          );
        }

        // Normal buttons carry md:ml-3, outline ones ml-1: both are cleared.
        expect(screen.getByText("Edit").closest("button")).toHaveClass(
          "md:ml-3",
        );
        expect(screen.getByText("Refresh").closest("button")).toHaveClass(
          "ml-1",
        );
        expect(classOf(actions())).toContain("gap-x-3");
      });

      test("never centred, never in a column", () => {
        render(<Card {...baseProps} headerLayout={headerLayout} />);

        let node: HTMLElement | null = actions();

        while (node && node !== header().parentElement) {
          for (const width of WIDTHS) {
            expect(
              resolveFlex(classOf(node), width, "flex-direction"),
            ).not.toBe("column");
            expect(
              resolveFlex(classOf(node), width, "justify-content"),
            ).not.toBe("center");
          }
          expect(node).not.toHaveClass("mx-auto");
          expect(node).not.toHaveClass("self-center");
          node = node.parentElement;
        }
      });

      test("buttons still work and keep their test ids", () => {
        const onEdit: MockFunction = getJestMockFunction();

        render(
          <Card
            title="Details"
            headerLayout={headerLayout}
            buttons={[
              {
                title: "Edit",
                onClick: onEdit,
                icon: IconProp.Edit,
              },
            ]}
          />,
        );

        fireEvent.click(screen.getByText("Edit"));

        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(screen.getAllByTestId("card-button")).toHaveLength(1);
      });

      test("renders React element buttons as they are", () => {
        render(
          <Card
            title="Details"
            headerLayout={headerLayout}
            buttons={[
              <a key="docs" href="/docs">
                Docs
              </a>,
            ]}
          />,
        );

        expect(
          within(actions()).getByRole("link", {
            name: "Docs",
          }),
        ).toHaveAttribute("href", "/docs");
      });

      test("a right element alone is the whole of the actions", () => {
        render(
          <Card
            title="AI Investigation"
            headerLayout={headerLayout}
            rightElement={<span>Completed</span>}
          />,
        );

        expect(actions().children).toHaveLength(1);
        expect(actions()).toHaveTextContent("Completed");
        expect(screen.queryByTestId("card-button")).toBeNull();
        expect(hasAutoLeftMargin(actions(), PHONE_WIDTH_IN_PX)).toBe(true);
      });

      test("leaves the body, its default spacing and bodyClassName alone", () => {
        const { rerender } = render(
          <Card {...baseProps} headerLayout={headerLayout} />,
        );

        expect(screen.getByText("body").parentElement).toHaveClass("mt-4");

        rerender(
          <Card
            {...baseProps}
            headerLayout={headerLayout}
            bodyClassName="mt-6"
          />,
        );

        expect(screen.getByText("body").parentElement).toHaveClass("mt-6");
        expect(screen.getByText("body").parentElement).not.toContainElement(
          header(),
        );
      });
    },
  );
});

/*
 * The description is a phone-width casualty on purpose: it is secondary copy,
 * and a phone header has no room for it. What it must never be is a desktop
 * casualty. It used to carry the bare `hidden` class and lean on `md:block`
 * to come back, and a page carrying a foreign `.hidden { display: none
 * !important }` rule (Bootstrap 3, HTML5 Boilerplate, a browser extension)
 * beats `md:block` at every width — so every card in the product lost its
 * description, on the widest screen as well as the narrowest.
 */
describe("Card description", () => {
  const OLD_DESCRIPTION_CLASS_NAME: string =
    "mt-1.5 text-sm text-gray-500 w-full hidden md:block leading-relaxed";

  test.each([
    ["default", "default"],
    ["stacked", "stacked"],
  ] as Array<[string, "default" | "stacked"]>)(
    "the %s layout holds it back on a phone and shows it from md up",
    (_label: string, headerLayout: "default" | "stacked") => {
      render(
        <Card title="Title" description="Desc" headerLayout={headerLayout} />,
      );

      const description: HTMLElement = screen.getByTestId("card-description");

      expect(isVisibleAtWidth(description, PHONE_WIDTH_IN_PX)).toBe(false);

      for (const width of [
        TABLET_WIDTH_IN_PX,
        LAPTOP_WIDTH_IN_PX,
        WIDE_DESKTOP_WIDTH_IN_PX,
      ]) {
        expect(describeVisibility(description, width)).toBe(
          `visible at ${width}px`,
        );
      }
    },
  );

  test("a foreign .hidden rule cannot take it off a tablet or a desktop", () => {
    render(<Card title="Title" description="Desc" />);

    const description: HTMLElement = screen.getByTestId("card-description");

    expect(description).not.toHaveClass("hidden");

    for (const width of [
      TABLET_WIDTH_IN_PX,
      LAPTOP_WIDTH_IN_PX,
      WIDE_DESKTOP_WIDTH_IN_PX,
    ]) {
      expect(
        describeVisibility(description, width, { withForeignHiddenRule: true }),
      ).toBe(`visible at ${width}px with a foreign .hidden rule on the page`);
    }

    /*
     * The control: the class string the description shipped with before
     * paints at these widths on a clean page, and on the customer's page it
     * is gone at every one of them.
     */
    for (const width of [
      TABLET_WIDTH_IN_PX,
      LAPTOP_WIDTH_IN_PX,
      WIDE_DESKTOP_WIDTH_IN_PX,
    ]) {
      expect(resolveDisplay(OLD_DESCRIPTION_CLASS_NAME, width)).toBe("block");
      expect(
        resolveDisplay(OLD_DESCRIPTION_CLASS_NAME, width, {
          withForeignHiddenRule: true,
        }),
      ).toBe("hidden");
    }
  });
});
