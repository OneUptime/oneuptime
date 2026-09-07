import {
  ButtonSize,
  ButtonStyleType,
} from "../../../UI/Components/Button/Button";
import Card, {
  CardButtonSchema,
  ComponentProps,
} from "../../../UI/Components/Card/Card";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
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

  test("keeps the title, description, content, and actions available in compact cards", () => {
    const onEdit: MockFunction = getJestMockFunction();
    renderComponent({
      title: "Affected resources",
      description: "Services impacted by this incident",
      compact: true,
      children: <p>Production API</p>,
      rightElement: <span>2 monitors</span>,
      buttons: [
        { title: "Edit resources", icon: IconProp.Edit, onClick: onEdit },
      ],
    });

    const title: HTMLElement = screen.getByRole("heading", {
      name: "Affected resources",
    });
    const button: HTMLElement = screen.getByRole("button", {
      name: "Edit resources",
    });

    expect(title).toHaveClass("text-sm");
    expect(title).not.toHaveClass("truncate", "whitespace-nowrap");
    expect(
      screen.getByText("Services impacted by this incident"),
    ).toBeInTheDocument();
    expect(screen.getByText("Production API")).toBeInTheDocument();
    expect(screen.getByText("2 monitors")).toBeInTheDocument();
    expect(button).toHaveClass(ButtonSize.Small);
    fireEvent.click(button);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  test("honors explicitly requested action sizes in compact cards", () => {
    renderComponent({
      ...props,
      compact: true,
      buttons: [
        {
          title: "Edit",
          icon: IconProp.Edit,
          onClick: jest.fn(),
          buttonSize: ButtonSize.Large,
        },
      ],
    });

    expect(screen.getByRole("button", { name: "Edit" })).toHaveClass(
      ButtonSize.Large,
    );
  });

  test("preserves disabled controls and their explanation in compact cards", () => {
    const onEdit: MockFunction = getJestMockFunction();
    renderComponent({
      ...props,
      compact: true,
      buttons: [
        {
          title: "Edit",
          icon: IconProp.Edit,
          onClick: onEdit,
          disabled: true,
          tooltip: "Only incident owners can edit these details.",
        },
      ],
    });

    const button: HTMLElement = screen.getByRole("button", { name: "Edit" });

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.mouseEnter(button.parentElement as HTMLElement);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Only incident owners can edit these details.",
    );
  });
});
