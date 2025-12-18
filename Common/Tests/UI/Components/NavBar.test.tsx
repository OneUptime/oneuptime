import Navbar, {
  ComponentProps,
  NavItem,
} from "../../../UI/Components/Navbar/NavBar";
import { describe, expect, it, beforeEach } from "@jest/globals";
import "@testing-library/jest-dom/extend-expect";
import { render, screen } from "@testing-library/react";
import React from "react";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import Navigation from "../../../UI/Utils/Navigation";
import { Location } from "react-router-dom";

describe("Navbar", () => {
  // Mock Navigation location for Navigation utility
  beforeEach(() => {
    const mockLocation: Location = {
      pathname: "/",
      search: "",
      hash: "",
      state: null,
      key: "default",
    };
    Navigation.setLocation(mockLocation);
  });
  const defaultProps: ComponentProps = {
    children: <div>Test</div>,
  };

  it("renders without crashing", () => {
    render(<Navbar {...defaultProps} />);
    expect(screen.getByText("Test")).toBeInTheDocument();
  });

  it("renders with a custom className", () => {
    const customProps: ComponentProps = {
      ...defaultProps,
      className: "custom-class",
    };
    render(<Navbar {...customProps} />);
    const container: HTMLElement = screen.getByTestId("nav-children");
    expect(container).toHaveClass("custom-class");
  });

  it("renders with a rightElement", () => {
    const rightElement: NavItem = {
      id: "test-right-element",
      title: "Right Element",
      icon: IconProp.User,
      route: new Route("/test"),
    };
    const customProps: ComponentProps = { ...defaultProps, rightElement };
    render(<Navbar {...customProps} />);
    expect(screen.getByText("Right Element")).toBeInTheDocument();
  });

  it("renders with multiple children", () => {
    const customProps: ComponentProps = {
      ...defaultProps,
      children: [<div key={1}>Child 1</div>, <div key={2}>Child 2</div>],
    };
    render(<Navbar {...customProps} />);
    expect(screen.getByText("Child 1")).toBeInTheDocument();
    expect(screen.getByText("Child 2")).toBeInTheDocument();
  });
});
