import ColorViewer from "../../Components/ColorViewer/ColorViewer";
import "@testing-library/jest-dom/extend-expect";
import { fireEvent, render } from "@testing-library/react";
import Color from "Common/Types/Color";
import * as React from "react";
import { describe, expect, jest } from "@jest/globals";

describe("Color Viewer", () => {
  test("Render the component", () => {
    const { getByTestId } = render(
      <ColorViewer
        dataTestId="test-id"
        value={new Color("#0000ff")}
        placeholder="Blue500"
      />,
    );

    const parent: HTMLElement = getByTestId("test-id");
    const colorComponent: Element = parent.children[0]!;
    const placeholder: Element = parent.children[1]!;

    expect(parent).toBeInTheDocument();
    expect(colorComponent).toHaveStyle("background-color: #0000ff");
    expect(placeholder).toHaveTextContent("#0000ff");
  });

  test("Render with just a placeholder and the test id", () => {
    const { getByTestId } = render(
      <ColorViewer dataTestId="test-id" placeholder="Blue500" />,
    );

    const parent: HTMLElement = getByTestId("test-id");
    const placeholder: Element = parent.children[0]!;

    expect(parent).toBeInTheDocument();
    expect(placeholder).toHaveTextContent("Blue500");
  });

  test("Render without any props but the test id", () => {
    const { getByTestId } = render(<ColorViewer dataTestId="test-id" />);

    const parent: HTMLElement = getByTestId("test-id");
    const placeholder: Element = parent.children[0]!;

    expect(parent).toBeInTheDocument();
    expect(placeholder).toHaveTextContent("No Color Selected");
  });

  test("Render with an alert on click", () => {
    const onClick: jest.Mock = jest.fn();
    const { getByTestId } = render(
      <ColorViewer dataTestId="test-id" onClick={onClick} />,
    );

    const parent: HTMLElement = getByTestId("test-id");
    fireEvent.click(parent);
    fireEvent.click(parent);

    expect(onClick).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
