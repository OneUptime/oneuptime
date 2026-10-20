// Libraries
import { BadgeType } from "../../../UI/Components/Badge/Badge";
// Components
import SideMenuItem, {
  ComponentProps,
} from "../../../UI/Components/SideMenu/SideMenuItem";
import * as Navigation from "../../../UI/Utils/Navigation";
import {
  describe,
  expect,
  it,
  afterEach,
  beforeEach,
  jest,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
// Types
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import React from "react";
import getJestMockFunction from "../../../Tests/MockType";

/*
 * The active-row treatment, pinned here because it is the only thing that
 * tells a user which page they are on. A flat indigo ground plus semibold
 * text replaced the earlier gradient-and-shadow: the shadow read as a raised
 * card inside a card, and the gradient's second stop was invisible at the
 * width the menu actually renders at.
 */
const highlightClassList: string = "bg-indigo-50 text-indigo-700 font-semibold";

const subItemHighlightClassList: string = "bg-indigo-50 text-indigo-700";

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

  it("Should use activeRoute for highlighting without changing the link target", () => {
    const linkTarget: Route = new Route("/network/map?site=");
    const activeRoute: Route = new Route("/network/map");

    Navigation.default.isOnThisPage = getJestMockFunction().mockImplementation(
      (route: Route): boolean => {
        return route === activeRoute;
      },
    );

    render(
      <SideMenuItem
        link={{ title: "Network Map", to: linkTarget }}
        activeRoute={activeRoute}
      />,
    );

    const mainLink: HTMLAnchorElement = screen
      .getByText("Network Map")
      .closest("a") as HTMLAnchorElement;

    expect(Navigation.default.isOnThisPage).toHaveBeenCalledWith(activeRoute);
    expect(mainLink).toHaveClass(highlightClassList);
    expect(mainLink).toHaveAttribute("href", linkTarget.toString());

    fireEvent.click(mainLink);

    expect(Navigation.default.navigate).toHaveBeenCalledWith(linkTarget);
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

  /*
   * The redesigned row: a bare icon, a truncating title span, and indicators
   * that carry no text. Each of the three is depended on somewhere outside
   * this component, so a well-meaning restyle breaks a suite that says nothing
   * about side menus.
   */
  describe("Redesigned row layout", () => {
    type SetActivePageFunction = (activeRoute: Route | URL | null) => void;

    /*
     * Every test below states the active page for itself instead of inheriting
     * whatever mock the previous test left on the module -- jest.clearAllMocks
     * clears calls, not implementations, so an inherited mockReturnValue(true)
     * would quietly turn a "this row is not highlighted" assertion into a test
     * of nothing.
     */
    const setActivePage: SetActivePageFunction = (
      activeRoute: Route | URL | null,
    ): void => {
      Navigation.default.isOnThisPage =
        getJestMockFunction().mockImplementation((to: Route | URL): boolean => {
          return activeRoute !== null && to === activeRoute;
        });
    };

    const longLink: {
      title: string;
      to: Route;
    } = {
      title: "Scheduled Maintenance",
      to: new Route("/scheduled-maintenance"),
    };

    /*
     * `span.truncate` is a read interface, not just an ellipsis.
     * SideMenuHarness.linksIn() takes a row's title from `span.truncate` and
     * falls back to the anchor's whole textContent when it is missing -- so
     * dropping the class does not fail here, it makes five product menu suites
     * expect "Scheduled Maintenance" and read "Scheduled Maintenance12".
     */
    it("Should keep the title in span.truncate with the badge digits outside it", () => {
      setActivePage(null);

      const badgeCount: number = 12;
      render(
        <SideMenuItem
          link={longLink}
          icon={IconProp.Home}
          badge={badgeCount}
          badgeType={BadgeType.DANGER}
        />,
      );

      const mainLink: HTMLAnchorElement = screen
        .getByText(longLink.title)
        .closest("a") as HTMLAnchorElement;

      const titleSpan: HTMLSpanElement | null =
        mainLink.querySelector("span.truncate");

      expect(titleSpan).not.toBeNull();
      expect(titleSpan?.textContent).toBe(longLink.title);
      expect(titleSpan?.textContent).not.toContain(String(badgeCount));

      // The badge is inside the same anchor, which is why the span is needed.
      expect(mainLink.textContent).toContain(String(badgeCount));
      expect(mainLink.textContent).not.toBe(longLink.title);
    });

    /*
     * The icon is drawn bare. A filled chip around it cost ~28px of a 208px
     * menu, and that is the width the long titles above were losing to the
     * ellipsis -- so a chip coming back is a layout regression, not a taste
     * question.
     */
    it("Should render the icon without a filled chip behind it", () => {
      setActivePage(null);

      const { container } = render(
        <SideMenuItem {...defaultProps} icon={IconProp.Home} />,
      );

      const mainLink: HTMLAnchorElement = container.querySelector(
        "a",
      ) as HTMLAnchorElement;

      expect(mainLink.querySelector("svg")).not.toBeNull();
      expect(mainLink.querySelector(".bg-gray-100")).toBeNull();
      expect(mainLink.querySelector(".bg-indigo-100")).toBeNull();
    });

    // The active row is where a tinted chip is most tempting, and costs the same width.
    it("Should render the active row's icon without a filled chip either", () => {
      setActivePage(defaultProps.link.to);

      const { container } = render(
        <SideMenuItem {...defaultProps} icon={IconProp.Home} />,
      );

      const mainLink: HTMLAnchorElement = container.querySelector(
        "a",
      ) as HTMLAnchorElement;

      expect(mainLink).toHaveClass(highlightClassList);
      expect(mainLink.querySelector(".bg-indigo-100")).toBeNull();
      expect(mainLink.querySelector(".bg-gray-100")).toBeNull();
    });

    /*
     * The other half of the highlight assertion above. Without this, a row that
     * painted itself active unconditionally would still pass the positive test
     * -- and the menu would tell the user they are on every page at once.
     */
    it("Should not highlight the main link when on a different page", () => {
      setActivePage(null);

      render(<SideMenuItem {...defaultProps} />);

      const mainLink: HTMLAnchorElement | null = screen
        .getByText(defaultProps.link.title)
        .closest("a");

      expect(mainLink).not.toHaveClass("bg-indigo-50");
      expect(mainLink).not.toHaveClass("text-indigo-700");
      expect(mainLink).not.toHaveClass("font-semibold");
      expect(mainLink).toHaveClass("text-gray-600");
    });

    /*
     * A sub-item is a different page from its parent. Highlighting both would
     * leave two rows claiming to be the current page, which is precisely the
     * question the highlight exists to answer.
     */
    it("Should leave the main link unhighlighted when only the sub item is active", () => {
      const subLink: {
        title: string;
        to: Route;
      } = {
        title: "Sub Page",
        to: new Route("/sub-page"),
      };

      setActivePage(subLink.to);

      render(<SideMenuItem {...defaultProps} subItemLink={subLink} />);

      const mainLink: HTMLAnchorElement | null = screen
        .getByText(defaultProps.link.title)
        .closest("a");
      const subLinkElement: HTMLAnchorElement | null = screen
        .getByText(subLink.title)
        .closest("a");

      expect(subLinkElement).toHaveClass(subItemHighlightClassList);
      expect(mainLink).not.toBe(subLinkElement);
      expect(mainLink).not.toHaveClass("bg-indigo-50");
      expect(mainLink).not.toHaveClass("text-indigo-700");
    });

    /*
     * "Something is wrong here" and "something needs attention here" are
     * different messages, and colour alone is not enough to tell them apart --
     * the two indicators have to be different glyphs as well.
     */
    it("Should render alert and warning as distinguishable indicators", () => {
      setActivePage(null);

      const withAlert: HTMLElement = render(
        <SideMenuItem {...defaultProps} showAlert={true} />,
      ).container;
      const withWarning: HTMLElement = render(
        <SideMenuItem {...defaultProps} showWarning={true} />,
      ).container;

      const alertIcon: SVGElement | null =
        withAlert.querySelector("svg.text-red-500");
      const warningIcon: SVGElement | null =
        withWarning.querySelector("svg.text-amber-500");

      expect(alertIcon).not.toBeNull();
      expect(warningIcon).not.toBeNull();
      expect(withAlert.querySelector("svg.text-amber-500")).toBeNull();
      expect(withWarning.querySelector("svg.text-red-500")).toBeNull();
      expect(alertIcon?.innerHTML).not.toBe(warningIcon?.innerHTML);
    });

    /*
     * Neither indicator may put TEXT inside the anchor.
     * Common/Tests/App/Dashboard/AdminUserOnCallPages.test.tsx reads
     * anchor.textContent as the row's title, so a screen-reader label rendered
     * as visible text here ("Alert", "!") fails that unrelated suite instead of
     * this one.
     */
    it("Should add no text to the anchor for the alert and warning indicators", () => {
      setActivePage(null);

      const { container } = render(
        <SideMenuItem
          {...defaultProps}
          icon={IconProp.Home}
          showAlert={true}
          showWarning={true}
        />,
      );

      const mainLink: HTMLAnchorElement = container.querySelector(
        "a",
      ) as HTMLAnchorElement;

      expect(mainLink.textContent?.trim()).toBe(defaultProps.link.title);
      // Row icon plus both indicators, all drawn as inline <svg>.
      expect(mainLink.querySelectorAll("svg")).toHaveLength(3);
    });
  });

  /*
   * The menu draws a title on one line and ends what does not fit with an
   * ellipsis: "Importer depuis un autre outil" in the 192px a desktop
   * leaves it, or "Import from another tool" in a tablet's 160px. The
   * pointer shows such a title whole; a title that fits gets no tooltip
   * repeating it. jsdom lays nothing out, so each test says how wide the
   * title is and how much room it has.
   */
  describe("A title the menu cuts short", () => {
    const LONG_TITLE: string = "Importer depuis un autre outil";

    type SetWidthsFunction = (
      element: HTMLElement,
      widths: { scrollWidth: number; clientWidth: number },
    ) => void;

    const setWidths: SetWidthsFunction = (
      element: HTMLElement,
      widths: { scrollWidth: number; clientWidth: number },
    ): void => {
      Object.defineProperty(element, "scrollWidth", {
        configurable: true,
        value: widths.scrollWidth,
      });
      Object.defineProperty(element, "clientWidth", {
        configurable: true,
        value: widths.clientWidth,
      });
    };

    type TitleSpanFunction = (title: string) => HTMLSpanElement;

    // The span the title is drawn in, the one that ellipsizes.
    const titleSpan: TitleSpanFunction = (title: string): HTMLSpanElement => {
      const span: HTMLElement = screen.getByText(title);

      expect(span.tagName).toBe("SPAN");
      expect(span).toHaveClass("truncate");

      return span as HTMLSpanElement;
    };

    // Each test says which page is open; none inherits the last one's.
    beforeEach(() => {
      Navigation.default.isOnThisPage =
        getJestMockFunction().mockReturnValue(false);
    });

    it("shows the whole title on hover when it is cut short", () => {
      render(
        <SideMenuItem
          link={{ title: LONG_TITLE, to: new Route("/settings/import") }}
          icon={IconProp.InboxArrowDown}
        />,
      );
      setWidths(titleSpan(LONG_TITLE), { scrollWidth: 211, clientWidth: 192 });

      fireEvent.mouseEnter(titleSpan(LONG_TITLE));

      expect(titleSpan(LONG_TITLE)).toHaveAttribute("title", LONG_TITLE);
    });

    // The active row draws its title in semibold, wider than the rest.
    it("shows it on the row of the page you are on too", () => {
      const to: Route = new Route("/settings/import");
      Navigation.default.isOnThisPage =
        getJestMockFunction().mockImplementation((route: Route): boolean => {
          return route === to;
        });

      render(
        <SideMenuItem
          link={{ title: LONG_TITLE, to }}
          icon={IconProp.InboxArrowDown}
        />,
      );
      const span: HTMLSpanElement = titleSpan(LONG_TITLE);

      expect(span.closest("a")).toHaveClass(highlightClassList);

      setWidths(span, { scrollWidth: 214, clientWidth: 192 });
      fireEvent.mouseEnter(span);

      expect(span).toHaveAttribute("title", LONG_TITLE);
    });

    it("adds no hover text when the title fits", () => {
      render(<SideMenuItem {...defaultProps} icon={IconProp.Home} />);
      setWidths(titleSpan(defaultProps.link.title), {
        scrollWidth: 40,
        clientWidth: 192,
      });

      fireEvent.mouseEnter(titleSpan(defaultProps.link.title));

      expect(titleSpan(defaultProps.link.title)).not.toHaveAttribute("title");
    });

    // A wider window (or a language switch) gives the title its room back.
    it("drops the hover text once the title fits again", () => {
      render(
        <SideMenuItem
          link={{ title: LONG_TITLE, to: new Route("/settings/import") }}
        />,
      );
      const span: HTMLSpanElement = titleSpan(LONG_TITLE);

      setWidths(span, { scrollWidth: 211, clientWidth: 160 });
      fireEvent.mouseEnter(span);
      expect(span).toHaveAttribute("title", LONG_TITLE);

      setWidths(span, { scrollWidth: 211, clientWidth: 211 });
      fireEvent.mouseEnter(span);
      expect(span).not.toHaveAttribute("title");
    });

    /*
     * The badge is drawn in the same anchor. Hover text read off the whole
     * row would say "Importer depuis un autre outil12" - so it is read off
     * the title alone, and the anchor gets none.
     */
    it("never puts the badge's digits in the hover text", () => {
      render(
        <SideMenuItem
          link={{ title: LONG_TITLE, to: new Route("/settings/import") }}
          icon={IconProp.InboxArrowDown}
          badge={12}
          badgeType={BadgeType.DANGER}
        />,
      );
      const span: HTMLSpanElement = titleSpan(LONG_TITLE);

      setWidths(span, { scrollWidth: 211, clientWidth: 150 });
      fireEvent.mouseEnter(span);

      expect(span).toHaveAttribute("title", LONG_TITLE);
      expect(span.closest("a")?.textContent).toContain("12");
      expect(span.closest("a")).not.toHaveAttribute("title");
    });

    it("shows a cut-short sub item whole on hover as well", () => {
      const subTitle: string = "Benachrichtigungsprotokolle";

      render(
        <SideMenuItem
          {...defaultProps}
          subItemLink={{ title: subTitle, to: new Route("/notification-logs") }}
        />,
      );
      const span: HTMLSpanElement = titleSpan(subTitle);

      setWidths(span, { scrollWidth: 203, clientWidth: 170 });
      fireEvent.mouseEnter(span);

      expect(span).toHaveAttribute("title", subTitle);
    });
  });
});
