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
     */
    const GOLDEN_WITH_ACTIONS: string =
      '<div data-testid="card" class="mb-5 extra"><div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible"><div class="py-6 px-5 md:px-6"><div class="flex flex-col md:flex-row md:justify-between md:items-start"><div class="flex-1 min-w-0"><h2 data-testid="card-details-heading" id="card-details-heading" class="text-lg font-semibold leading-6 text-gray-900">Title</h2><p data-testid="card-description" class="mt-1.5 text-sm text-gray-500 w-full hidden md:block leading-relaxed">Desc</p></div><div class="flex flex-col md:flex-row md:items-center md:w-fit mt-4 md:mt-0 md:ml-4 gap-2 md:gap-0 flex-shrink-0 items-center"><div class="mb-2 md:mb-0 md:mr-3"><span>right</span></div><div class="flex flex-wrap items-center gap-1.5"><div class="flex items-center"><a href="/docs">Docs</a></div></div></div></div><div class="mt-0"><div>body</div></div></div></div></div>';

    const GOLDEN_WITHOUT_ACTIONS: string =
      '<div data-testid="card" class="mb-5 "><div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible"><div class="py-6 px-5 md:px-6"><div class="flex flex-col md:flex-row md:justify-between md:items-start"><div class="w-full"><h2 data-testid="card-details-heading" id="card-details-heading" class="text-lg font-semibold leading-6 text-gray-900">Title</h2><p data-testid="card-description" class="mt-1.5 text-sm text-gray-500 w-full hidden md:block leading-relaxed">Desc</p></div></div></div></div></div>';

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
});
