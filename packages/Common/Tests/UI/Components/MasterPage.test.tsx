import MasterPage, {
  ComponentProps,
} from "../../../UI/Components/MasterPage/MasterPage";
import { describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("MasterPage", () => {
  const defaultProps: ComponentProps = {
    children: <div>Children</div>,
    isLoading: false,
    error: "",
  };

  it("should render correctly", () => {
    render(<MasterPage {...defaultProps} />);

    const children: HTMLElement = screen.getByText("Children");
    expect(children).toBeInTheDocument();
  });

  it("should render correctly with isLoading", () => {
    render(<MasterPage {...defaultProps} isLoading />);

    const loader: HTMLElement = screen.getByTestId("bar-loader");
    expect(loader).toBeInTheDocument();
  });

  it("should render correctly with error", () => {
    const error: string = "error";
    render(<MasterPage {...defaultProps} error={error} />);

    const errorElement: HTMLElement = screen.getByText(error);
    expect(errorElement).toBeInTheDocument();
  });

  it("should render correctly with server error", () => {
    const error: string = "Server Error";
    render(<MasterPage {...defaultProps} error={error} />);

    const errorElement: HTMLElement = screen.getByText(
      "Network Error: Please reload the page and try again.",
    );
    expect(errorElement).toBeInTheDocument();
  });

  it("should render correctly with footer", () => {
    const footer: string = "footer";
    render(<MasterPage {...defaultProps} footer={<div>footer</div>} />);

    const footerElement: HTMLElement = screen.getByText(footer);
    expect(footerElement).toBeInTheDocument();
  });

  it("should render correctly with makeTopSectionUnstick", () => {
    render(
      <MasterPage
        {...defaultProps}
        header={<div>Header</div>}
        makeTopSectionUnstick
      />,
    );

    const topSection: HTMLElement = screen.getByRole("banner").parentElement!;
    expect(topSection).not.toHaveClass("sticky");
  });

  it("should render the top section when it has a header or a navbar", () => {
    const { rerender } = render(
      <MasterPage {...defaultProps} header={<div>Header</div>} />,
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();

    rerender(<MasterPage {...defaultProps} navBar={<div>NavBar</div>} />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  /*
   * The status page renders its own header and navbar inside children and
   * passes neither prop. Rendering the top section anyway left an empty white
   * bar with a drop shadow above the content.
   */
  it("should not render an empty top section when it has neither", () => {
    render(<MasterPage {...defaultProps} />);

    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("should not render the top section when its only header is hidden", () => {
    render(
      <MasterPage {...defaultProps} header={<div>Header</div>} hideHeader />,
    );

    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });
});
