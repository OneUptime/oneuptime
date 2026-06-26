// Libraries
import { BadgeType } from "../../../UI/Components/Badge/Badge";
// Components
import SideMenuItem, {
  ComponentProps,
} from "../../../UI/Components/SideMenu/SideMenuItem";
import * as Navigation from "../../../UI/Utils/Navigation";
import { describe, expect, afterEach, jest } from "@jest/globals";
import "@testing-library/jest-dom/extend-expect";
import { fireEvent, render, screen } from "@testing-library/react";
// Types
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import React from "react";
import getJestMockFunction from "../../../Tests/MockType";

const highlightClassList: string =
  "bg-gradient-to-r from-indigo-50 to-indigo-50/50 text-indigo-700 shadow-sm";

const subItemHighlightClassList: string = "bg-indigo-50/70 text-indigo-700";

jest.mock("../../../UI/Utils/Navigation.ts", () => {
  return {
    isOnThisPage: jest.fn().mockReturnValue(false),
    navigate: jest.fn(),
  };
});

describe("Side Menu Item", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const defaultProps: ComponentProps = {
    link: {
      title: "Home",
      to: new Route("/home"),
    },
  };

  it("Should render the main link with given title", () => {
    render(<SideMenuItem {...defaultProps} />);

    const mainLink: HTMLAnchorElement | null = screen
      .getByText(defaultProps.link.title)
      .closest("a");
    expect(mainLink).toBeInTheDocument();
  });

  it("Should call navigate function when clicked", () => {
    render(<SideMenuItem {...defaultProps} />);

    const mainLink: HTMLAnchorElement = screen
      .getByText(defaultProps.link.title)
      .closest("a") as HTMLAnchorElement;

    fireEvent.click(mainLink);

    expect(Navigation.default.navigate).toHaveBeenCalledTimes(1);
  });

  it("Should render icon if provided", () => {
    const { container } = render(
      <SideMenuItem {...defaultProps} icon={IconProp.Home} />,
    );

    // The icon renders an inline <svg> (no invalid role="icon"; WCAG 4.1.2).
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("Should render the sub item link with given title and Icon", () => {
    const subLink: {
      title: string;
      to: Route;
    } = {
      title: "Sub Page",
      to: new Route("/sub-page"),
    };
    const { container } = render(
      <SideMenuItem
        {...defaultProps}
        subItemLink={subLink}
        icon={IconProp.Home}
        subItemIcon={IconProp.ExternalLink}
      />,
    );

    const subLinkElement: HTMLAnchorElement | null = screen
      .getByText(subLink.title)
      .closest("a");

    expect(subLinkElement).toBeInTheDocument();
    // Main and sub-item icons each render an inline <svg> (no role="icon").
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });

  it("Should render link badge if provided", () => {
    const badgeCount: number = 2;
    render(
      <SideMenuItem
        {...defaultProps}
        badge={badgeCount}
        badgeType={BadgeType.SUCCESS}
      />,
    );

    expect(screen.getByText(badgeCount)).toBeInTheDocument();
  });

  it("Should show alert", () => {
    const { container } = render(
      <SideMenuItem {...defaultProps} showAlert={true} />,
    );

    // The alert icon renders an inline <svg> (no role="icon"; WCAG 4.1.2).
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("Should show warning", () => {
    const { container } = render(
      <SideMenuItem {...defaultProps} showWarning={true} />,
    );

    // The warning icon renders an inline <svg> (no role="icon"; WCAG 4.1.2).
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("Should highlights the main link when on the same page", () => {
    (Navigation.default.isOnThisPage as jest.Mock).mockReturnValue(true);
    render(<SideMenuItem {...defaultProps} />);

    const mainLink: HTMLAnchorElement | null = screen
      .getByText(defaultProps.link.title)
      .closest("a");
    expect(mainLink).toHaveClass(highlightClassList);
  });

  it("Should highlights sub item link when on the same page", () => {
    const subLink: {
      title: string;
      to: Route;
    } = {
      title: "Sub Page",
      to: new Route("/sub-page"),
    };
    Navigation.default.isOnThisPage = getJestMockFunction().mockImplementation(
      (to: Route) => {
        return to === subLink.to;
      },
    );
    render(
      <SideMenuItem
        {...defaultProps}
        subItemLink={subLink}
        icon={IconProp.Home}
        subItemIcon={IconProp.ExternalLink}
      />,
    );

    const subLinkElement: HTMLAnchorElement | null = screen
      .getByText(subLink.title)
      .closest("a");
    expect(subLinkElement).toHaveClass(subItemHighlightClassList);
  });
});
