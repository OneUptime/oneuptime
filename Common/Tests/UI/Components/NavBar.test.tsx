import Navbar, {
  ComponentProps,
  MoreMenuItem,
  NavItem,
} from "../../../UI/Components/Navbar/NavBar";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import Navigation from "../../../UI/Utils/Navigation";
import { Location } from "react-router-dom";

const ORIGINAL_INNER_WIDTH: number = window.innerWidth;

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

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: ORIGINAL_INNER_WIDTH,
    });
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

  it("uses a product's section-wide active route in the mobile selector", () => {
    const projectId: string = "10000000-0000-4000-8000-000000000001";
    const path: string = `/dashboard/${projectId}/exceptions/overview`;

    Navigation.setLocation({
      pathname: path,
      search: "",
      hash: "",
      state: null,
      key: "test",
    } as Location);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 375,
    });

    const home: NavItem = {
      id: "home-nav-bar-item",
      title: "Home",
      icon: IconProp.Home,
      route: new Route(`/dashboard/${projectId}/home`),
    };
    const exceptions: MoreMenuItem = {
      title: "Exceptions",
      description: "Investigate application exceptions.",
      icon: IconProp.Bug,
      route: new Route(`/dashboard/${projectId}/exceptions/unresolved`),
      activeRoute: new Route("/dashboard/:projectId/exceptions"),
    };

    render(<Navbar items={[home]} moreMenuItems={[exceptions]} />);

    expect(screen.getByTestId("mobile-nav-toggle")).toBeInTheDocument();
    expect(screen.getByText("Exceptions")).toBeInTheDocument();
    expect(screen.queryByText("Home")).not.toBeInTheDocument();
  });

  it("uses a product's section-wide active route in the desktop selector", () => {
    const projectId: string = "10000000-0000-4000-8000-000000000001";
    const path: string = `/dashboard/${projectId}/exceptions/overview`;

    Navigation.setLocation({
      pathname: path,
      search: "",
      hash: "",
      state: null,
      key: "test",
    } as Location);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1024,
    });

    const home: NavItem = {
      id: "home-nav-bar-item",
      title: "Home",
      icon: IconProp.Home,
      route: new Route(`/dashboard/${projectId}/home`),
    };
    const exceptions: MoreMenuItem = {
      title: "Exceptions",
      description: "Investigate application exceptions.",
      icon: IconProp.Bug,
      route: new Route(`/dashboard/${projectId}/exceptions/unresolved`),
      activeRoute: new Route("/dashboard/:projectId/exceptions"),
    };

    render(<Navbar items={[home]} moreMenuItems={[exceptions]} />);

    expect(screen.queryByTestId("mobile-nav-toggle")).not.toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Exceptions")).toBeInTheDocument();
    expect(screen.queryByText("Products")).not.toBeInTheDocument();
  });
});
