// Components
import SideMenuSection from "../../../UI/Components/SideMenu/SideMenuSection";
import { describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * The collapsible group every product side menu is built out of.
 *
 * Almost nothing here is about how the section looks. It is about the shape of
 * the DOM it produces, because Common/Tests/App/Dashboard/SideMenuHarness.tsx
 * walks exactly this shape -- h6 title, `div.mb-2` root, first <button> as the
 * toggle, the toggle's immediate next sibling as the body -- and five product
 * menu suites (alerts, incidents, scheduled maintenance and friends) read their
 * menus through it. Break one of those four lookups and the harness does not
 * throw: `linksIn()` quietly returns an empty list, so those five suites start
 * asserting things about a menu they can no longer see, and the failure surfaces
 * as five unrelated red suites with no hint that a section restyle caused it.
 *
 * Pinning the contract here means a restyle fails in one obvious place instead.
 */

const SECTION_TITLE: string = "Monitors";

type MenuRowsFunction = () => Array<ReactElement>;

/*
 * Plain anchors rather than SideMenuItem: what is under test is the section's
 * own wrapper, and a real menu row would drag Navigation into a suite that has
 * no opinion about routing.
 */
const menuRows: MenuRowsFunction = (): Array<ReactElement> => {
  return [
    <a key="uptime" href="/uptime">
      Uptime
    </a>,
    <a key="logs" href="/logs">
      Logs
    </a>,
  ];
};

type SectionHeadingFunction = () => HTMLElement;

const sectionHeading: SectionHeadingFunction = (): HTMLElement => {
  const heading: HTMLHeadingElement | null = document.querySelector("h6");

  if (!heading) {
    throw new Error("The section rendered no <h6> title.");
  }

  return heading;
};

type SectionRootFunction = () => HTMLElement;

const sectionRoot: SectionRootFunction = (): HTMLElement => {
  const root: HTMLElement | null = sectionHeading().closest("div.mb-2");

  if (!root) {
    throw new Error('The section title is not inside a "div.mb-2" root.');
  }

  return root;
};

type SectionToggleFunction = () => HTMLButtonElement;

const sectionToggle: SectionToggleFunction = (): HTMLButtonElement => {
  const toggle: HTMLButtonElement | null =
    sectionRoot().querySelector("button");

  if (!toggle) {
    throw new Error("The section has no collapse toggle.");
  }

  return toggle;
};

type SectionBodyFunction = () => HTMLElement;

const sectionBody: SectionBodyFunction = (): HTMLElement => {
  const body: Element | null = sectionToggle().nextElementSibling;

  if (!body) {
    throw new Error("The section toggle has no sibling body element.");
  }

  return body as HTMLElement;
};

describe("SideMenuSection", () => {
  describe("the DOM contract SideMenuHarness reads", () => {
    /*
     * `sectionTitlesInOrder()` in the harness is `querySelectorAll("h6")`. Move
     * the title to an <h5> or a <div> and every product menu suite reports zero
     * sections rather than a wrong one.
     */
    test("the title renders in an <h6>", () => {
      render(
        <SideMenuSection title={SECTION_TITLE}>{menuRows()}</SideMenuSection>,
      );

      expect(document.querySelectorAll("h6")).toHaveLength(1);
      expect(sectionHeading().textContent?.trim()).toBe(SECTION_TITLE);
    });

    /*
     * The harness climbs from the heading to the section with
     * `closest("div.mb-2")`. It has to land on the section's own outermost
     * element -- if `mb-2` moved to some inner wrapper, `linksIn()` would search
     * a subtree that no longer holds the rows.
     */
    test("the section root is the element carrying mb-2", () => {
      const { container } = render(
        <SideMenuSection title={SECTION_TITLE}>{menuRows()}</SideMenuSection>,
      );

      expect(sectionRoot()).toHaveClass("mb-2");
      expect(container.firstElementChild).toBe(sectionRoot());
    });

    /*
     * `sectionToggle()` takes the FIRST button in the section, so the header has
     * to be the only one. A second button in the header (a "collapse all", an
     * overflow menu) would silently hand the harness the wrong element.
     */
    test("the only button in the section is the collapse toggle, and it wraps the title", () => {
      render(
        <SideMenuSection title={SECTION_TITLE}>{menuRows()}</SideMenuSection>,
      );

      expect(sectionRoot().querySelectorAll("button")).toHaveLength(1);
      expect(sectionToggle()).toContainElement(sectionHeading());
    });

    /*
     * `isExpanded()` reads aria-expanded off that button -- which is also the
     * only thing telling a screen reader whether the group is open.
     */
    test("the toggle carries aria-expanded", () => {
      render(
        <SideMenuSection title={SECTION_TITLE}>{menuRows()}</SideMenuSection>,
      );

      expect(sectionToggle()).toHaveAttribute("aria-expanded", "true");
    });

    /*
     * `sectionBody()` is `toggle.nextElementSibling` -- IMMEDIATE, not a
     * descendant search. Wrapping the animated body in one more div would make
     * the harness read the wrapper's classes and conclude every section is
     * expanded.
     */
    test("the collapsible body is the toggle's immediate next sibling and holds the rows", () => {
      render(
        <SideMenuSection title={SECTION_TITLE}>{menuRows()}</SideMenuSection>,
      );

      const body: HTMLElement = sectionBody();

      expect(body).toContainElement(screen.getByText("Uptime"));
      expect(body).toContainElement(screen.getByText("Logs"));
      expect(body).toHaveClass("overflow-hidden");
    });
  });

  describe("collapse state", () => {
    /*
     * The class pair the harness (and the user's eye) reads collapse state
     * from. There is no `hidden` attribute and no unmount to check instead, so
     * if these two classes stop appearing together nothing else reports it.
     */
    test("defaultCollapsed renders the section closed", () => {
      render(
        <SideMenuSection title={SECTION_TITLE} defaultCollapsed={true}>
          {menuRows()}
        </SideMenuSection>,
      );

      expect(sectionToggle()).toHaveAttribute("aria-expanded", "false");
      expect(sectionBody()).toHaveClass("max-h-0");
      expect(sectionBody()).toHaveClass("opacity-0");
    });

    test("a section without defaultCollapsed renders open", () => {
      render(
        <SideMenuSection title={SECTION_TITLE}>{menuRows()}</SideMenuSection>,
      );

      expect(sectionToggle()).toHaveAttribute("aria-expanded", "true");
      expect(sectionBody()).toHaveClass("opacity-100");
      expect(sectionBody()).not.toHaveClass("max-h-0");
    });

    /*
     * Both directions, because a header that only ever closes is the worse
     * failure: the user loses the rows and has no way to get them back without
     * reloading the page.
     */
    test("clicking the toggle closes the section and clicking again reopens it", () => {
      render(
        <SideMenuSection title={SECTION_TITLE}>{menuRows()}</SideMenuSection>,
      );

      fireEvent.click(sectionToggle());

      expect(sectionToggle()).toHaveAttribute("aria-expanded", "false");
      expect(sectionBody()).toHaveClass("max-h-0");
      expect(sectionBody()).toHaveClass("opacity-0");

      fireEvent.click(sectionToggle());

      expect(sectionToggle()).toHaveAttribute("aria-expanded", "true");
      expect(sectionBody()).toHaveClass("opacity-100");
      expect(sectionBody()).not.toHaveClass("max-h-0");
    });
  });

  /*
   * "Please always collapse the advanced section by default. Please do this
   * for entire project." The rule lives in the section itself, keyed on the
   * title a menu passes in, so every menu gets it without a flag - including
   * menus written after it.
   */
  describe("a section titled Advanced", () => {
    test("starts collapsed without being told to", () => {
      render(<SideMenuSection title="Advanced">{menuRows()}</SideMenuSection>);

      expect(sectionToggle()).toHaveAttribute("aria-expanded", "false");
      expect(sectionBody()).toHaveClass("max-h-0", "opacity-0", "invisible");
    });

    test.each(["advanced", "ADVANCED", "  Advanced  "])(
      "matches the title %p regardless of case and spacing",
      (title: string) => {
        render(<SideMenuSection title={title}>{menuRows()}</SideMenuSection>);

        expect(sectionToggle()).toHaveAttribute("aria-expanded", "false");
      },
    );

    /*
     * Only the section NAMED Advanced. "Advanced Settings" is a page in the
     * status page menu, and Settings sections decide for themselves.
     */
    test.each(["Basic", "Settings", "Advanced Settings", "Danger Zone"])(
      "leaves a section titled %p open",
      (title: string) => {
        render(<SideMenuSection title={title}>{menuRows()}</SideMenuSection>);

        expect(sectionToggle()).toHaveAttribute("aria-expanded", "true");
        expect(sectionBody()).not.toHaveClass("invisible");
      },
    );

    test("a menu can still keep it open with defaultCollapsed={false}", () => {
      render(
        <SideMenuSection title="Advanced" defaultCollapsed={false}>
          {menuRows()}
        </SideMenuSection>,
      );

      expect(sectionToggle()).toHaveAttribute("aria-expanded", "true");
      expect(sectionBody()).toHaveClass("opacity-100");
    });

    // Collapsing must never hide the page the user is on.
    test("starts open when the current page is inside it", () => {
      render(
        <SideMenuSection title="Advanced" isActive={true}>
          {menuRows()}
        </SideMenuSection>,
      );

      expect(sectionToggle()).toHaveAttribute("aria-expanded", "true");
      expect(sectionBody()).not.toHaveClass("max-h-0");
      expect(sectionBody()).not.toHaveClass("invisible");
    });

    /*
     * A menu inside a layout stays mounted while the user moves between its
     * pages. Arriving on a page inside Advanced (from a link elsewhere on the
     * page, say) must open it there and then.
     */
    test("opens when the user arrives on a page inside it", () => {
      const { rerender } = render(
        <SideMenuSection title="Advanced" isActive={false}>
          {menuRows()}
        </SideMenuSection>,
      );

      expect(sectionToggle()).toHaveAttribute("aria-expanded", "false");

      rerender(
        <SideMenuSection title="Advanced" isActive={true}>
          {menuRows()}
        </SideMenuSection>,
      );

      expect(sectionToggle()).toHaveAttribute("aria-expanded", "true");
      expect(sectionBody()).not.toHaveClass("invisible");
    });

    /*
     * And it does not snap shut under the user when they leave: folding is
     * where a menu starts, not something done to it while it is being used.
     */
    test("stays open when the user leaves a page inside it", () => {
      const { rerender } = render(
        <SideMenuSection title="Advanced" isActive={true}>
          {menuRows()}
        </SideMenuSection>,
      );

      rerender(
        <SideMenuSection title="Advanced" isActive={false}>
          {menuRows()}
        </SideMenuSection>,
      );

      expect(sectionToggle()).toHaveAttribute("aria-expanded", "true");
    });

    test("opens on click and folds away again", () => {
      render(<SideMenuSection title="Advanced">{menuRows()}</SideMenuSection>);

      fireEvent.click(sectionToggle());

      expect(sectionToggle()).toHaveAttribute("aria-expanded", "true");
      expect(sectionBody()).toHaveClass("opacity-100");
      expect(sectionBody()).not.toHaveClass("invisible");

      fireEvent.click(sectionToggle());

      expect(sectionToggle()).toHaveAttribute("aria-expanded", "false");
      expect(sectionBody()).toHaveClass("max-h-0", "opacity-0", "invisible");
    });

    test("keeps its rows mounted while folded, so their badge fetches do not restart", () => {
      render(<SideMenuSection title="Advanced">{menuRows()}</SideMenuSection>);

      expect(sectionRoot().querySelectorAll("a")).toHaveLength(2);
      expect(screen.getByText("Uptime")).toBeInTheDocument();
    });

    /*
     * A section that cannot collapse has no toggle, so starting it collapsed
     * would hide its rows for good.
     */
    test("never starts collapsed when it cannot collapse", () => {
      render(
        <SideMenuSection title="Advanced" collapsible={false}>
          {menuRows()}
        </SideMenuSection>,
      );

      expect(screen.getByText("Uptime")).toBeInTheDocument();
      expect(
        sectionHeading().parentElement!.parentElement!.nextElementSibling,
      ).not.toHaveClass("max-h-0");
    });
  });

  /*
   * max-h-0 and opacity-0 only stop folded rows being SEEN. They stayed tab
   * stops, so a keyboard user walked through every link of a folded section
   * on a focus ring nobody could see, and a screen reader read them out.
   * `invisible` (visibility: hidden) takes them out of both, and the toggle
   * says which element it opens.
   */
  describe("a folded section is out of the way for keyboard and screen reader users", () => {
    test("its body is invisible while collapsed and visible while open", () => {
      render(
        <SideMenuSection title={SECTION_TITLE} defaultCollapsed={true}>
          {menuRows()}
        </SideMenuSection>,
      );

      expect(sectionBody()).toHaveClass("invisible");

      fireEvent.click(sectionToggle());

      expect(sectionBody()).not.toHaveClass("invisible");
    });

    test("the toggle names the body it controls", () => {
      render(
        <SideMenuSection title={SECTION_TITLE}>{menuRows()}</SideMenuSection>,
      );

      const bodyId: string | null = sectionBody().getAttribute("id");

      expect(bodyId).toBeTruthy();
      expect(sectionToggle()).toHaveAttribute("aria-controls", bodyId!);
    });

    test("two sections never share a body id", () => {
      render(
        <>
          <SideMenuSection title="Basic">{menuRows()}</SideMenuSection>
          <SideMenuSection title="Advanced">{menuRows()}</SideMenuSection>
        </>,
      );

      const ids: Array<string | null> = Array.from(
        document.querySelectorAll("button[aria-controls]"),
      ).map((toggle: Element): string | null => {
        return toggle.getAttribute("aria-controls");
      });

      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
      ids.forEach((id: string | null) => {
        expect(document.getElementById(id!)).not.toBeNull();
      });
    });
  });

  describe("collapsible={false}", () => {
    /*
     * A section that cannot collapse must not look like it can, to ANY user.
     * The chevron and the pointer cursor cover the sighted half of that; the
     * other half is that there must be no control at all. A <button
     * aria-expanded="true"> whose handler returns immediately is invisible to
     * a sighted user and, to everyone else, a tab stop announcing an expand
     * control that does nothing when activated.
     */
    test("renders no interactive control at all", () => {
      const { container } = render(
        <SideMenuSection title={SECTION_TITLE} collapsible={false}>
          {menuRows()}
        </SideMenuSection>,
      );

      expect(container.querySelector("button")).toBeNull();
      expect(container.querySelector("[aria-expanded]")).toBeNull();
    });

    test("renders no chevron and no pointer cursor", () => {
      render(
        <SideMenuSection title={SECTION_TITLE} collapsible={false}>
          {menuRows()}
        </SideMenuSection>,
      );

      const header: HTMLElement =
        sectionHeading().parentElement!.parentElement!;

      expect(header.querySelector("svg")).toBeNull();
      expect(header).toHaveClass("cursor-default");
      expect(header).not.toHaveClass("cursor-pointer");
    });

    test("its rows render and stay rendered", () => {
      render(
        <SideMenuSection title={SECTION_TITLE} collapsible={false}>
          {menuRows()}
        </SideMenuSection>,
      );

      expect(screen.getByText("Uptime")).toBeInTheDocument();
      expect(sectionHeading().textContent?.trim()).toBe(SECTION_TITLE);
    });
  });

  describe("children stay mounted while collapsed", () => {
    /*
     * The reason the body animates a max-height instead of rendering `null`.
     *
     * Several menus badge their rows from a fetch fired on mount
     * (CountModelSideMenuItem does exactly this). If a collapsed section
     * unmounted its children, every one of those requests would be re-issued
     * each time the user opened the section again -- a menu of ten counted rows
     * turns one idle click into ten API calls, and the counts flash back to
     * empty while they reload.
     */
    test("a section collapsed from the start still has its rows in the document", () => {
      render(
        <SideMenuSection title={SECTION_TITLE} defaultCollapsed={true}>
          {menuRows()}
        </SideMenuSection>,
      );

      expect(screen.getByText("Uptime")).toBeInTheDocument();
      expect(screen.getByText("Logs")).toBeInTheDocument();
      expect(sectionRoot().querySelectorAll("a")).toHaveLength(2);
    });

    /*
     * Same DOM node before and after, not merely an element with the same text:
     * a re-created node would mean React unmounted and remounted the row, which
     * is exactly the fetch storm above.
     */
    test("collapsing an open section keeps the very same row elements", () => {
      render(
        <SideMenuSection title={SECTION_TITLE}>{menuRows()}</SideMenuSection>,
      );

      const uptimeRowBeforeCollapse: HTMLElement = screen.getByText("Uptime");

      fireEvent.click(sectionToggle());

      expect(sectionToggle()).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText("Uptime")).toBe(uptimeRowBeforeCollapse);
      expect(screen.getByText("Logs")).toBeInTheDocument();
    });
  });
});
