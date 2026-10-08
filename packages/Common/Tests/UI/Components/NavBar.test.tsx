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
import Icon from "../../../UI/Components/Icon/Icon";
import { DEFAULT_CATEGORY_ICON } from "../../../UI/Components/Navbar/NavBarCategoryToggle";
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

    it("opens on the categories it names and folds the rest, like the desktop products menu", () => {
      expect(
        openPhoneMenu({ moreMenuCategoriesOpenByDefault: ["Essentials"] }),
      ).toEqual([
        "home-nav-bar-item:Home",
        "more-monitors:Monitors",
        "right-user-settings:User Settings",
      ]);
      expect(
        screen.getByRole("button", { name: "Essentials" }),
      ).toHaveAttribute("aria-expanded", "true");
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

    it("draws the categories it opens on as rows that fold like the others, and forgets their fold", () => {
      // What the menu stored when a fold of Essentials was remembered.
      window.localStorage.setItem(
        "oneuptime-navbar-product-categories",
        JSON.stringify({ Essentials: false }),
      );

      openPhoneMenu({ moreMenuCategoriesOpenByDefault: ["Essentials"] });

      const toggle: HTMLElement = screen.getByRole("button", {
        name: "Essentials",
      });
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(
        screen.getByRole("heading", { level: 3, name: "Essentials" }),
      ).toContainElement(toggle);
      expect(
        screen.getByRole("group", { name: "Essentials" }),
      ).toContainElement(screen.getByRole("link", { name: "Monitors" }));
      // Drawn as every other category's row is.
      const row: (name: string) => HTMLElement = (
        name: string,
      ): HTMLElement => {
        return screen
          .getByRole("button", { name })
          .closest("div.relative") as HTMLElement;
      };
      expect(row("Essentials").className).toBe(row("Observability").className);
      expect(toggle.className).toBe(
        screen.getByRole("button", { name: "Observability" }).className,
      );

      // A tap folds them, without closing the menu or remembering it.
      fireEvent.click(toggle);

      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("link", { name: "Monitors" })).toBeNull();
      expect(toggle).toHaveAccessibleDescription("1 product Monitors");
      expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
      expect(
        JSON.parse(
          window.localStorage.getItem("oneuptime-navbar-product-categories")!,
        ),
      ).toEqual({ Essentials: false });

      // Another tap opens them again.
      fireEvent.click(toggle);
      expect(
        screen.getByRole("link", { name: "Monitors" }),
      ).toBeInTheDocument();
    });

    // What <Icon icon={icon} /> draws, to compare a row's glyph against.
    function glyphOf(icon: IconProp): string {
      const { container, unmount } = render(<Icon icon={icon} />);
      const markup: string = container.querySelector("svg")!.innerHTML;
      unmount();
      return markup;
    }

    // The glyph a category's row draws before its name.
    function categoryIcon(category: string): string {
      const heading: HTMLElement = screen.getByRole("heading", {
        level: 3,
        name: category,
      });
      return heading.querySelector("svg")!.innerHTML;
    }

    it("draws each category with the icon it was given, and the menu's own for the rest", () => {
      openPhoneMenu({
        moreMenuCategoriesOpenByDefault: ["Essentials"],
        moreMenuCategoryIcons: {
          Essentials: IconProp.Star,
          Infrastructure: IconProp.ServerStack,
        },
      });

      expect(categoryIcon("Essentials")).toBe(glyphOf(IconProp.Star));
      expect(categoryIcon("Infrastructure")).toBe(
        glyphOf(IconProp.ServerStack),
      );
      expect(categoryIcon("Observability")).toBe(
        glyphOf(DEFAULT_CATEGORY_ICON),
      );
    });

    it("draws a category row as the product rows are: the icon before the name, the same size", () => {
      openPhoneMenu({
        moreMenuCategoriesOpenByDefault: ["Essentials"],
        moreMenuCategoryIcons: { Infrastructure: IconProp.ServerStack },
      });

      const productIcon: SVGElement = screen
        .getByRole("link", { name: "Monitors" })
        .querySelector("svg")!;
      const rowIcon: SVGElement = screen
        .getByRole("heading", { level: 3, name: "Infrastructure" })
        .querySelector("svg")!;

      for (const token of ["mr-1", "h-4", "w-4", "stroke-2"]) {
        expect([token, productIcon.classList.contains(token)]).toEqual([
          token,
          true,
        ]);
        expect([token, rowIcon.classList.contains(token)]).toEqual([
          token,
          true,
        ]);
      }
      expect(
        screen.getByRole("button", { name: "Infrastructure" }),
      ).toHaveClass("text-base", "font-medium", "text-gray-900");
    });

    it("sets the categories apart from Home above them with one rule", () => {
      openPhoneMenu({ moreMenuCategoriesOpenByDefault: ["Essentials"] });

      const first: HTMLElement = screen.getByRole("group", {
        name: "Essentials",
      });

      expect(first).toHaveClass("mt-1", "border-t", "border-gray-100", "pt-2");
      expect(first).not.toHaveClass("pt-1");
      // One rule for the list, not one per row.
      for (const name of ["Observability", "Infrastructure"]) {
        const next: HTMLElement = screen.getByRole("group", { name });
        expect([name, next.classList.contains("pt-1")]).toEqual([name, true]);
        expect([name, next.classList.contains("border-t")]).toEqual([
          name,
          false,
        ]);
      }
    });

    it("draws the rule above the first category, whichever ones the menu opens on", () => {
      openPhoneMenu({ moreMenuCategoriesOpenByDefault: ["Observability"] });

      // Essentials are folded here, and still first, right after Home.
      expect(
        screen.getByRole("button", { name: "Essentials" }),
      ).toHaveAttribute("aria-expanded", "false");
      expect(
        screen.getByRole("button", { name: "Observability" }),
      ).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("group", { name: "Essentials" })).toHaveClass(
        "border-t",
      );
      expect(
        screen.getByRole("group", { name: "Observability" }),
      ).not.toHaveClass("border-t");
      expect(
        screen.getByRole("group", { name: "Infrastructure" }),
      ).not.toHaveClass("border-t");
    });

    it("indents an opened category's products under its row, on a guide line, the essentials' too", () => {
      openPhoneMenu({ moreMenuCategoriesOpenByDefault: ["Essentials"] });

      const toggle: HTMLElement = screen.getByRole("button", {
        name: "Infrastructure",
      });
      fireEvent.click(toggle);

      const body: HTMLElement = document.getElementById(
        toggle.getAttribute("aria-controls")!,
      )!;
      expect(body).toContainElement(
        screen.getByRole("link", { name: "Hosts" }),
      );
      expect(body).toHaveClass("ml-5", "border-l", "border-gray-100", "pl-1");

      // The essentials' products sit under their row the same way.
      const essentials: HTMLElement = document.getElementById(
        screen
          .getByRole("button", { name: "Essentials" })
          .getAttribute("aria-controls")!,
      )!;
      expect(essentials).toContainElement(
        screen.getByRole("link", { name: "Monitors" }),
      );
      expect(essentials.className).toBe(body.className);
    });
  });

  describe("the desktop products menu", () => {
    it("draws each folded category's row with the icon the navbar was given for it", () => {
      // Nothing opened or folded before, by the phone menu's tests above.
      window.localStorage.clear();
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: 1280,
      });
      Navigation.setLocation({
        pathname: "/dashboard/home",
        search: "",
        hash: "",
        state: null,
        key: "test",
      } as Location);
      Element.prototype.scrollIntoView = (): void => {};

      render(
        <Navbar
          items={[
            {
              id: "home-nav-bar-item",
              title: "Home",
              icon: IconProp.Home,
              route: new Route("/dashboard/home"),
            },
          ]}
          moreMenuItems={[
            {
              title: "Monitors",
              description: "Check uptime.",
              icon: IconProp.AltGlobe,
              route: new Route("/dashboard/monitors"),
              category: "Essentials",
            },
            {
              title: "Hosts",
              description: "Watch servers.",
              icon: IconProp.Server,
              route: new Route("/dashboard/hosts"),
              category: "Infrastructure",
            },
          ]}
          moreMenuCategoriesOpenByDefault={["Essentials"]}
          moreMenuCategoryIcons={{ Infrastructure: IconProp.ServerStack }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Products" }));

      const row: HTMLElement = screen
        .getByRole("button", { name: "Infrastructure" })
        .closest("div.relative") as HTMLElement;
      const { container } = render(<Icon icon={IconProp.ServerStack} />);

      expect(row.querySelector("svg")!.innerHTML).toBe(
        container.querySelector("svg")!.innerHTML,
      );
      // The category it opens on is a row as well, open.
      expect(
        screen.getByRole("button", { name: "Essentials" }),
      ).toHaveAttribute("aria-expanded", "true");
      expect(
        screen.getByRole("button", { name: "Infrastructure" }),
      ).toHaveAttribute("aria-expanded", "false");
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
