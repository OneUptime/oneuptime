import MasterPage, {
  ComponentProps,
} from "../../../UI/Components/MasterPage/MasterPage";
import { describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom/extend-expect";
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
    render(<MasterPage {...defaultProps} makeTopSectionUnstick />);

    const topSection: HTMLElement = screen.getByRole("banner").parentElement!;
    expect(topSection).not.toHaveClass("sticky");
  });
});
