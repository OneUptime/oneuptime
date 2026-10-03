import Navbar, {
  ComponentProps,
  MoreMenuItem,
  NavItem,
} from "../../../UI/Components/Navbar/NavBar";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("uses a product's additional active routes in the mobile selector", () => {
    /*
     * Tasks owns /code-repository too (its side menu holds Code
     * Repositories). The desktop crumb already honoured that; the phone
     * header fell back to Home.
     */
    const projectId: string = "10000000-0000-4000-8000-000000000001";

    Navigation.setLocation({
      pathname: `/dashboard/${projectId}/code-repository`,
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
    const tasks: MoreMenuItem = {
      title: "Tasks",
      description: "AI opens pull requests that fix your code.",
      icon: IconProp.CPUChip,
      route: new Route(`/dashboard/${projectId}/ai/agents`),
      activeRoute: new Route("/dashboard/:projectId/ai/agents"),
      additionalActiveRoutes: [
        new Route("/dashboard/:projectId/code-repository"),
      ],
    };

    render(<Navbar items={[home]} moreMenuItems={[tasks]} />);

    expect(screen.getByTestId("mobile-nav-toggle")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.queryByText("Home")).not.toBeInTheDocument();
  });

  describe("the phone menu", () => {
    const projectId: string = "10000000-0000-4000-8000-000000000001";

    const home: NavItem = {
      id: "home-nav-bar-item",
      title: "Home",
      icon: IconProp.Home,
      route: new Route(`/dashboard/${projectId}/home`),
    };

    const settings: NavItem = {
      id: "user-settings-nav-bar-item",
      title: "User Settings",
      icon: IconProp.User,
      route: new Route(`/dashboard/${projectId}/user-settings`),
    };

    const products: Array<MoreMenuItem> = [
      {
        title: "Monitors",
        description: "Check uptime.",
        icon: IconProp.AltGlobe,
        route: new Route(`/dashboard/${projectId}/monitors`),
        category: "Essentials",
      },
      {
        title: "Logs",
        description: "Search logs.",
        icon: IconProp.Logs,
        route: new Route(`/dashboard/${projectId}/logs`),
        category: "Observability",
      },
      {
        title: "Hosts",
        description: "Watch servers.",
        icon: IconProp.Server,
        route: new Route(`/dashboard/${projectId}/hosts`),
        category: "Infrastructure",
      },
    ];

    function openPhoneMenu(props: Partial<ComponentProps>): Array<string> {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: 375,
      });
      Navigation.setLocation({
        pathname: `/dashboard/${projectId}/home`,
        search: "",
        hash: "",
        state: null,
        key: "test",
      } as Location);
      render(
        <Navbar
          items={[home]}
          moreMenuItems={products}
          rightElement={settings}
          {...props}
        />,
      );
      fireEvent.click(screen.getByTestId("mobile-nav-toggle"));
      return screen.getAllByRole("link").map((link: HTMLElement): string => {
        return `${link.id}:${link.textContent}`;
      });
    }

    beforeEach(() => {
      window.localStorage.clear();
    });

    it("lists every product one after another when the menu names no categories to open on", () => {
      expect(openPhoneMenu({})).toEqual([
        "home-nav-bar-item:Home",
        "more-monitors:Monitors",
        "more-logs:Logs",
        "more-hosts:Hosts",
        "right-user-settings:User Settings",
      ]);
      expect(
        screen.queryByRole("button", { name: "Observability" }),
      ).toBeNull();
    });

    it("folds every category but the ones it opens on, like the desktop products menu", () => {
      expect(
        openPhoneMenu({ moreMenuCategoriesOpenByDefault: ["Essentials"] }),
      ).toEqual([
        "home-nav-bar-item:Home",
        "more-monitors:Monitors",
        "right-user-settings:User Settings",
      ]);
      expect(
        screen.getByRole("button", { name: "Observability" }),
      ).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(screen.getByRole("button", { name: "Infrastructure" }));

      expect(screen.getByRole("link", { name: "Hosts" })).toHaveAttribute(
        "id",
        "more-hosts",
      );
      expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    });
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
