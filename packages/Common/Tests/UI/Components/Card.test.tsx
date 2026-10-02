import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Card, {
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

  type RenderMarkupFunction = (props: ComponentProps) => string;

  const renderMarkup: RenderMarkupFunction = (
    props: ComponentProps,
  ): string => {
    const { container, unmount } = render(<Card {...props} />);
    const markup: string = container.innerHTML;
    unmount();
    return markup;
  };

  // The nearest ancestor of an element that matches a selector, or a throw.
  type ClosestFunction = (element: HTMLElement, selector: string) => Element;

  const closest: ClosestFunction = (
    element: HTMLElement,
    selector: string,
  ): Element => {
    const match: Element | null = element.closest(selector);

    if (!match) {
      throw new Error(`No ancestor matches ${selector}`);
    }

    return match;
  };

  describe("default", () => {
    /*
     * Captured from Card before headerLayout existed. Every card in the app
     * that does not opt in must keep rendering exactly this.
     *
     * One token has moved on purpose since: the description was `hidden
     * md:block` and is now `max-md:hidden md:block`. The two paint the same
     * at every width, but only the second survives a foreign
     * `.hidden { display: none !important }` rule, which took the old
     * description off desktops as well (see "Card description" below).
     */
    const GOLDEN_WITH_ACTIONS: string =
      '<div data-testid="card" class="mb-5 extra"><div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible"><div class="py-6 px-5 md:px-6"><div class="flex flex-col md:flex-row md:justify-between md:items-start"><div class="flex-1 min-w-0"><h2 data-testid="card-details-heading" id="card-details-heading" class="text-lg font-semibold leading-6 text-gray-900">Title</h2><p data-testid="card-description" class="mt-1.5 text-sm text-gray-500 w-full max-md:hidden md:block leading-relaxed">Desc</p></div><div class="flex flex-col md:flex-row md:items-center md:w-fit mt-4 md:mt-0 md:ml-4 gap-2 md:gap-0 flex-shrink-0 items-center"><div class="mb-2 md:mb-0 md:mr-3"><span>right</span></div><div class="flex flex-wrap items-center gap-1.5"><div class="flex items-center"><a href="/docs">Docs</a></div></div></div></div><div class="mt-0"><div>body</div></div></div></div></div>';

    const GOLDEN_WITHOUT_ACTIONS: string =
      '<div data-testid="card" class="mb-5 "><div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible"><div class="py-6 px-5 md:px-6"><div class="flex flex-col md:flex-row md:justify-between md:items-start"><div class="w-full"><h2 data-testid="card-details-heading" id="card-details-heading" class="text-lg font-semibold leading-6 text-gray-900">Title</h2><p data-testid="card-description" class="mt-1.5 text-sm text-gray-500 w-full max-md:hidden md:block leading-relaxed">Desc</p></div></div></div></div></div>';

    test.each([
      ["left out", undefined],
      ["default", "default"],
    ] as Array<[string, "default" | undefined]>)(
      "headerLayout %s renders the markup Card has always rendered",
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

    test("leaving headerLayout out, or passing default, renders the same markup", () => {
      const withoutProp: string = renderMarkup(baseProps);
      const withDefault: string = renderMarkup({
        ...baseProps,
        headerLayout: "default",
      });

      expect(withDefault).toBe(withoutProp);
    });

    test("keeps the side-by-side header classes", () => {
      render(<Card {...baseProps} />);

      const heading: HTMLElement = screen.getByTestId("card-details-heading");
      const titleBlock: HTMLElement = heading.parentElement!;
      const headerRow: HTMLElement = titleBlock.parentElement!;

      expect(titleBlock).toHaveClass("flex-1", "min-w-0");
      expect(headerRow).toHaveClass(
        "flex",
        "flex-col",
        "md:flex-row",
        "md:justify-between",
        "md:items-start",
      );

      const actions: HTMLElement = headerRow.children[1] as HTMLElement;

      expect(actions).toHaveClass(
        "flex",
        "flex-col",
        "md:flex-row",
        "md:items-center",
        "md:w-fit",
        "mt-4",
        "md:mt-0",
        "md:ml-4",
        "flex-shrink-0",
      );
      expect(actions.children[0]).toHaveClass("mb-2", "md:mb-0", "md:mr-3");
      expect(actions.children[1]).toHaveClass(
        "flex",
        "flex-wrap",
        "items-center",
        "gap-1.5",
      );
      expect(screen.queryByTestId("card-header-actions")).toBeNull();
      expect(screen.queryByTestId("card-header")).toBeNull();
    });

    test("a card with no actions gives the title block the full width", () => {
      render(<Card title="Only a title" description="And a description" />);

      const titleBlock: HTMLElement = screen.getByTestId(
        "card-details-heading",
      ).parentElement!;

      expect(titleBlock).toHaveClass("w-full");
      expect(titleBlock).not.toHaveClass("flex-1");
    });
  });

  describe("stacked", () => {
    test("gives the title and description the full width", () => {
      render(<Card {...baseProps} headerLayout="stacked" />);

      const header: HTMLElement = screen.getByTestId("card-header");
      const titleBlock: HTMLElement = screen.getByTestId(
        "card-details-heading",
      ).parentElement!;

      expect(header).toHaveAttribute("data-header-layout", "stacked");
      expect(titleBlock).toHaveClass("w-full", "min-w-0");
      expect(titleBlock).not.toHaveClass("flex-1");
      expect(titleBlock).toContainElement(
        screen.getByTestId("card-description"),
      );
      // Nothing in the header lays the title out side by side any more.
      expect(header).not.toHaveClass("md:flex-row");
      expect(header.querySelector(".md\\:flex-row")).toBeNull();
    });

    test("puts the right element and the buttons on one row under the description", () => {
      render(<Card {...baseProps} headerLayout="stacked" />);

      const header: HTMLElement = screen.getByTestId("card-header");
      const actions: HTMLElement = screen.getByTestId("card-header-actions");

      expect(Array.from(header.children)).toEqual([
        screen.getByTestId("card-details-heading").parentElement,
        actions,
      ]);
      expect(actions).toHaveClass(
        "mt-3",
        "flex",
        "flex-wrap",
        "items-center",
        "gap-2",
      );
      expect(actions).not.toHaveClass("justify-end");
      expect(actions).not.toHaveClass("justify-between");

      const description: HTMLElement = screen.getByTestId("card-description");

      expect(
        description.compareDocumentPosition(actions) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      // Right element first, then each button, all direct children of the row.
      expect(actions.children).toHaveLength(3);
      expect(actions.children[0]).toHaveTextContent("right element");
      expect(
        closest(
          screen.getByText("Edit"),
          "[data-testid='card-header-actions'] > div",
        ),
      ).toBe(actions.children[1]);
      expect(
        closest(
          screen.getByText("Refresh"),
          "[data-testid='card-header-actions'] > div",
        ),
      ).toBe(actions.children[2]);
    });

    test("buttons still work and keep their test ids", () => {
      const onEdit: MockFunction = getJestMockFunction();

      render(
        <Card
          title="Details"
          headerLayout="stacked"
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
          headerLayout="stacked"
          buttons={[
            <a key="docs" href="/docs">
              Docs
            </a>,
          ]}
        />,
      );

      expect(
        within(screen.getByTestId("card-header-actions")).getByRole("link", {
          name: "Docs",
        }),
      ).toHaveAttribute("href", "/docs");
    });

    test("renders no actions row when there is nothing to put in it", () => {
      render(
        <Card
          title="Details"
          description="Nothing to do here."
          headerLayout="stacked"
          buttons={[]}
        />,
      );

      expect(screen.getByTestId("card-header")).toBeInTheDocument();
      expect(screen.queryByTestId("card-header-actions")).toBeNull();
    });

    test("a right element alone still gets the row", () => {
      render(
        <Card
          title="Details"
          headerLayout="stacked"
          rightElement={<span>just me</span>}
        />,
      );

      const actions: HTMLElement = screen.getByTestId("card-header-actions");

      expect(actions.children).toHaveLength(1);
      expect(actions).toHaveTextContent("just me");
      expect(screen.queryByTestId("card-button")).toBeNull();
    });

    test("leaves the body, its default spacing and bodyClassName alone", () => {
      const { rerender } = render(
        <Card {...baseProps} headerLayout="stacked" />,
      );

      expect(screen.getByText("body").parentElement).toHaveClass("mt-4");

      rerender(
        <Card {...baseProps} headerLayout="stacked" bodyClassName="mt-0" />,
      );

      expect(screen.getByText("body").parentElement).toHaveClass("mt-0");
    });
  });

  /*
   * The default layout drops what is on the right under the title below md
   * and centres it, and from md up holds it 12px short of the card's edge.
   * That suits a row of buttons. A small status badge (the AI Investigation
   * card's pill) ended up alone in the middle of a phone's card. "inline"
   * keeps it beside the title at any width they both fit in.
   */
  describe("inline", () => {
    function titleRow(): HTMLElement {
      return screen.getByTestId("card-details-heading").parentElement!;
    }

    test("puts the title and what is on the right on one row that wraps", () => {
      render(<Card {...baseProps} headerLayout="inline" />);

      const header: HTMLElement = screen.getByTestId("card-header");
      const actions: HTMLElement = screen.getByTestId("card-header-actions");

      expect(header).toHaveAttribute("data-header-layout", "inline");
      expect(titleRow().parentElement).toBe(header);
      expect(titleRow()).toHaveClass(
        "flex",
        "flex-wrap",
        "items-start",
        "justify-between",
        "gap-x-4",
        "gap-y-2",
      );
      // The same row at every width: nothing switches at md.
      expect(titleRow().className).not.toMatch(/(^|\s)(md|sm|lg):/);
      expect(titleRow()).not.toHaveClass("flex-col");
      expect(Array.from(titleRow().children)).toEqual([
        screen.getByTestId("card-details-heading"),
        actions,
      ]);
    });

    test("the description is under the row, so its length cannot push the right element off it", () => {
      render(<Card {...baseProps} headerLayout="inline" />);

      const description: HTMLElement = screen.getByTestId("card-description");

      expect(titleRow()).not.toContainElement(description);
      expect(description.parentElement).toBe(screen.getByTestId("card-header"));
      expect(titleRow().nextElementSibling).toBe(description);
      expect(description).toHaveTextContent("Key facts about this incident.");
    });

    test("the title is never the one that gives way", () => {
      render(<Card {...baseProps} headerLayout="inline" />);

      const heading: HTMLElement = screen.getByTestId("card-details-heading");

      /*
       * With flex-1/min-w-0 on it the title shrank to make room and broke
       * into two lines beside a long badge. Left at its own width, the row
       * wraps instead and the badge goes under the title.
       */
      expect(heading).not.toHaveClass("flex-1");
      expect(heading).not.toHaveClass("min-w-0");
      expect(heading).not.toHaveClass("truncate");
      expect(heading.className).toBe(
        "text-lg font-semibold leading-6 text-gray-900",
      );
    });

    test("what is on the right ends at the card's edge and is never centred", () => {
      render(<Card {...baseProps} headerLayout="inline" />);

      const actions: HTMLElement = screen.getByTestId("card-header-actions");

      expect(actions).toHaveClass("flex", "flex-wrap", "items-center", "gap-2");
      // None of the default layout's phone column or desktop margins.
      for (const className of [
        "flex-col",
        "mt-4",
        "md:mt-0",
        "md:ml-4",
        "md:w-fit",
      ]) {
        expect(actions).not.toHaveClass(className);
      }
      for (const child of Array.from(actions.children)) {
        expect(child).not.toHaveClass("md:mr-3");
        expect(child).not.toHaveClass("mb-2");
      }
    });

    test("holds the right element first, then the buttons", () => {
      render(<Card {...baseProps} headerLayout="inline" />);

      const actions: HTMLElement = screen.getByTestId("card-header-actions");

      expect(actions.children).toHaveLength(3);
      expect(actions.children[0]).toHaveTextContent("right element");
      expect(
        within(actions)
          .getAllByTestId("card-button")
          .map((button: HTMLElement): string => {
            return button.textContent || "";
          }),
      ).toEqual(["Edit", "Refresh"]);
      // A button's side-by-side margin is cleared: the gap spaces them.
      expect(actions).toHaveClass("[&_button]:ml-0", "[&_button]:md:ml-0");
    });

    test("buttons still work", () => {
      const onClick: MockFunction = getJestMockFunction();

      render(
        <Card
          title="Details"
          headerLayout="inline"
          buttons={[
            {
              title: "Edit",
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: onClick,
              icon: IconProp.Edit,
            },
          ]}
        />,
      );

      fireEvent.click(screen.getByTestId("card-button"));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    test("a right element alone is the whole right side", () => {
      render(
        <Card
          title="AI Investigation"
          headerLayout="inline"
          rightElement={<span>Completed</span>}
        />,
      );

      const actions: HTMLElement = screen.getByTestId("card-header-actions");

      expect(actions.children).toHaveLength(1);
      expect(actions).toHaveTextContent("Completed");
      expect(screen.queryByTestId("card-button")).toBeNull();
    });

    test("a title alone renders no right side", () => {
      render(<Card title="Only a title" headerLayout="inline" />);

      expect(screen.getByTestId("card-header")).toBeInTheDocument();
      expect(screen.queryByTestId("card-header-actions")).toBeNull();
      expect(titleRow().children).toHaveLength(1);
    });

    test("without a description there is nothing under the row", () => {
      render(
        <Card
          title="AI Investigation"
          headerLayout="inline"
          rightElement={<span>Completed</span>}
        />,
      );

      expect(screen.queryByTestId("card-description")).toBeNull();
      expect(screen.getByTestId("card-header").children).toHaveLength(1);
    });

    test("leaves the body, its default spacing and bodyClassName alone", () => {
      const { rerender } = render(
        <Card {...baseProps} headerLayout="inline" />,
      );

      expect(screen.getByText("body").parentElement).toHaveClass("mt-4");

      rerender(
        <Card {...baseProps} headerLayout="inline" bodyClassName="mt-6" />,
      );

      expect(screen.getByText("body").parentElement).toHaveClass("mt-6");
      // The header is not part of the body.
      expect(screen.getByText("body").parentElement).not.toContainElement(
        screen.getByTestId("card-header"),
      );
    });

    test("is opt-in: the other two layouts render what they always did", () => {
      const inline: string = renderMarkup({
        ...baseProps,
        headerLayout: "inline",
      });

      expect(inline).not.toBe(renderMarkup(baseProps));
      expect(inline).not.toBe(
        renderMarkup({ ...baseProps, headerLayout: "stacked" }),
      );
      expect(renderMarkup(baseProps)).not.toContain(
        'data-header-layout="inline"',
      );
      expect(
        closest(
          render(<Card {...baseProps} headerLayout="stacked" />).getByTestId(
            "card-header",
          ),
          "[data-header-layout]",
        ),
      ).toHaveAttribute("data-header-layout", "stacked");
    });
  });
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
    ["inline", "inline"],
  ] as Array<[string, "default" | "stacked" | "inline"]>)(
    "the %s layout holds it back on a phone and shows it from md up",
    (_label: string, headerLayout: "default" | "stacked" | "inline") => {
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
