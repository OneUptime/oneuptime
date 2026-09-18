import ResourceGroupSection from "../../../../UI/Components/StatusPage/ResourceGroupSection";
import StatusPageGroupNestingLayoutUtil from "../../../../Utils/StatusPage/GroupNestingLayout";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement } from "react";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - one level of the status page resource group hierarchy.
 *
 * The nesting this replaces drew every level as a card inside a card inside a
 * card: at three levels deep a visitor saw four borders wrapped around one
 * uptime bar, the bars lost the width they need on a phone, and the header was a
 * div with role="button" wrapping markdown that may contain links. So the
 * assertions here are about structure rather than looks:
 *
 *   - only the top level is a card, and nothing nested adds a surface,
 *   - nested levels hang off a rail,
 *   - the header is a real button that reports its expanded state,
 *   - the rolled up reading stays visible when the level is expanded,
 *   - and a description never ends up inside the button.
 */

function renderSection(
  props: Partial<React.ComponentProps<typeof ResourceGroupSection>> = {},
): ReturnType<typeof render> {
  return render(
    <ResourceGroupSection
      depth={props.depth === undefined ? 0 : props.depth}
      name={props.name === undefined ? "Corporate" : props.name}
      description={props.description}
      subGroupCount={props.subGroupCount}
      subGroupCountLabel={props.subGroupCountLabel}
      rollupLabel={props.rollupLabel}
      rollupColor={props.rollupColor}
      isInitiallyExpanded={props.isInitiallyExpanded}
      resourcesElement={props.resourcesElement}
      subGroupsElement={props.subGroupsElement}
      hasOwnResources={props.hasOwnResources}
      testId={props.testId}
    />,
  );
}

function header(): HTMLElement {
  return screen.getByTestId("status-page-group-header");
}

describe("ResourceGroupSection", () => {
  describe("the header", () => {
    test("renders the group name", () => {
      renderSection({ name: "Region 1000" });

      expect(screen.getByText("Region 1000")).toBeInTheDocument();
    });

    /*
     * It used to be a div with role="button". A real button gets Enter, Space,
     * focus and the accessible name for free.
     */
    test("is a real button, not a div wearing a role", () => {
      renderSection();

      expect(header().tagName).toBe("BUTTON");
      expect(header()).toHaveAttribute("type", "button");
    });

    test("reports its collapsed and expanded state", () => {
      renderSection();

      expect(header()).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(header());

      expect(header()).toHaveAttribute("aria-expanded", "true");
    });

    test("toggles the body open and shut", () => {
      renderSection({
        resourcesElement: <div>Corporate API</div>,
      });

      expect(screen.queryByText("Corporate API")).not.toBeInTheDocument();

      fireEvent.click(header());
      expect(screen.getByText("Corporate API")).toBeInTheDocument();

      fireEvent.click(header());
      expect(screen.queryByText("Corporate API")).not.toBeInTheDocument();
    });

    /*
     * aria-controls may only name an element that exists, and the body is not
     * rendered while the section is shut.
     */
    test("points aria-controls at the body only while the body exists", () => {
      renderSection({ resourcesElement: <div>Corporate API</div> });

      expect(header()).not.toHaveAttribute("aria-controls");

      fireEvent.click(header());

      const bodyId: string | null = header().getAttribute("aria-controls");

      expect(bodyId).toBeTruthy();
      expect(screen.getByTestId("status-page-group-body")).toHaveAttribute(
        "id",
        bodyId,
      );
    });

    /*
     * A native button is focusable and activates on Enter and Space without
     * anything being wired up. The div with role="button" it replaces needed
     * tabIndex and a hand-rolled keydown handler to get halfway there.
     */
    test("is reachable by keyboard without a tabindex of its own", () => {
      renderSection();

      header().focus();

      expect(header()).toHaveFocus();
      expect(header()).not.toHaveAttribute("tabindex");
    });

    test("opens on Enter", async () => {
      const user: UserEvent = userEvent.setup();

      renderSection({ resourcesElement: <div>Corporate API</div> });

      header().focus();
      await user.keyboard("{Enter}");

      expect(header()).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("Corporate API")).toBeInTheDocument();
    });

    test("opens on Space", async () => {
      const user: UserEvent = userEvent.setup();

      renderSection({ resourcesElement: <div>Corporate API</div> });

      header().focus();
      await user.keyboard("{ }");

      expect(header()).toHaveAttribute("aria-expanded", "true");
    });
  });

  describe("expansion state", () => {
    test("is shut by default", () => {
      renderSection({ resourcesElement: <div>Corporate API</div> });

      expect(
        screen.queryByTestId("status-page-group-body"),
      ).not.toBeInTheDocument();
    });

    test("opens when the group is configured to expand by default", () => {
      renderSection({
        isInitiallyExpanded: true,
        resourcesElement: <div>Corporate API</div>,
      });

      expect(screen.getByText("Corporate API")).toBeInTheDocument();
    });

    /*
     * Groups arrive with the page payload, so the flag can flip after the first
     * render.
     */
    test("follows isInitiallyExpanded when it arrives late", () => {
      const { rerender } = render(
        <ResourceGroupSection depth={0} name="Corporate" />,
      );

      expect(header()).toHaveAttribute("aria-expanded", "false");

      rerender(
        <ResourceGroupSection
          depth={0}
          name="Corporate"
          isInitiallyExpanded={true}
        />,
      );

      expect(header()).toHaveAttribute("aria-expanded", "true");
    });

    /*
     * The hazard the effect is keyed on a boolean for: isExpandedByDefault is an
     * optional column, so it routinely arrives undefined and settles to false.
     * Keyed on the prop, that identity change fires the effect and slams shut a
     * section the visitor had just opened.
     */
    test("undefined settling to false does not shut a section the visitor opened", () => {
      const { rerender } = render(
        <ResourceGroupSection depth={0} name="Corporate" />,
      );

      fireEvent.click(header());
      expect(header()).toHaveAttribute("aria-expanded", "true");

      rerender(
        <ResourceGroupSection
          depth={0}
          name="Corporate"
          isInitiallyExpanded={false}
        />,
      );

      expect(header()).toHaveAttribute("aria-expanded", "true");
    });

    /*
     * A re-render that does not change the flag must not collapse a section the
     * visitor just opened.
     */
    test("keeps a section the visitor opened open across a re-render", () => {
      const { rerender } = render(
        <ResourceGroupSection depth={0} name="Corporate" />,
      );

      fireEvent.click(header());
      expect(header()).toHaveAttribute("aria-expanded", "true");

      rerender(<ResourceGroupSection depth={0} name="Corporate updated" />);

      expect(header()).toHaveAttribute("aria-expanded", "true");
    });
  });

  describe("the top level", () => {
    test("is a card", () => {
      renderSection({ depth: 0 });

      const container: HTMLElement = screen.getByTestId("status-page-group");

      expect(container).toHaveClass("bg-white");
      expect(container).toHaveClass("rounded-xl");
      expect(container).toHaveClass("shadow");
    });

    test("carries its depth for anything reading the DOM", () => {
      renderSection({ depth: 0 });

      expect(screen.getByTestId("status-page-group")).toHaveAttribute(
        "data-depth",
        "0",
      );
    });

    test("its body has no rail - the card edge is the boundary", () => {
      renderSection({
        depth: 0,
        isInitiallyExpanded: true,
        resourcesElement: <div>Corporate API</div>,
      });

      expect(
        screen.getByTestId("status-page-group-body").className,
      ).not.toMatch(/border-l/);
    });
  });

  describe("a nested level", () => {
    /*
     * The headline regression. A nested group is a row on a rail, not another
     * surface - no background, no border, no rounding, no shadow.
     */
    test.each([[1], [2], [3], [4], [7]])(
      "at depth %i adds no card of its own",
      (depth: number) => {
        renderSection({ depth: depth });

        const container: HTMLElement = screen.getByTestId(
          "status-page-nested-group",
        );

        /*
         * Asserted as the absence of each surface rather than as an empty class
         * string, so a future non-surface utility does not fail this while a
         * returning card still does.
         */
        expect(container.className).not.toMatch(/\bbg-/);
        expect(container.className).not.toMatch(/\bborder/);
        expect(container.className).not.toMatch(/\brounded/);
        expect(container.className).not.toMatch(/\bshadow/);
        expect(container.className).not.toMatch(/\bp[xytblr]?-\d/);
      },
    );

    test("hangs its body off exactly one hairline rail", () => {
      renderSection({
        depth: 1,
        isInitiallyExpanded: true,
        resourcesElement: <div>Region 1000 API</div>,
      });

      const body: HTMLElement = screen.getByTestId("status-page-group-body");

      expect(body).toHaveClass("border-l");
      expect(body).toHaveClass("border-gray-200");
      expect(body.className).not.toMatch(/border-l-2/);
    });

    test("carries its depth for anything reading the DOM", () => {
      renderSection({ depth: 3 });

      expect(screen.getByTestId("status-page-nested-group")).toHaveAttribute(
        "data-depth",
        "3",
      );
    });

    test("a title is never smaller than the resources it contains", () => {
      renderSection({ depth: 5, name: "Unit 0152" });

      const title: HTMLElement = screen.getByText("Unit 0152");

      expect(title.className).toContain("text-base");
      expect(title.className).not.toMatch(/(^|\s)text-sm(\s|$)/);
    });

    /*
     * Wrapping was tried here and is worse: the title is the only shrinkable
     * item in the header row, so beside a badge and a rollup it collapsed to a
     * ~30px column and broke the name one character per line on a phone.
     */
    test("a long title ellipsizes and keeps the full name reachable", () => {
      renderSection({ depth: 1, name: "Corporate Unit Northwest" });

      const title: HTMLElement = screen.getByText("Corporate Unit Northwest");

      expect(title.className).toContain("truncate");
      expect(title.className).toContain("min-w-0");
      expect(title.className).not.toContain("break-words");
      expect(title).toHaveAttribute("title", "Corporate Unit Northwest");
    });
  });

  describe("the rolled up reading", () => {
    test("is rendered when the group has one", () => {
      renderSection({ rollupLabel: "99.9% uptime" });

      expect(screen.getByText("99.9% uptime")).toBeInTheDocument();
    });

    /*
     * It used to live in the accordion's rightElement, which is hidden while the
     * accordion is open - so expanding a level hid the number you expanded it to
     * compare against.
     */
    test("stays visible while the level is expanded", () => {
      renderSection({ rollupLabel: "99.9% uptime" });

      fireEvent.click(header());

      expect(screen.getByText("99.9% uptime")).toBeInTheDocument();
    });

    test("leaves no empty slot behind when the group shows neither status nor uptime", () => {
      renderSection({});

      expect(
        screen.queryByTestId("status-page-group-rollup"),
      ).not.toBeInTheDocument();
    });

    /*
     * The dot is what stops a group rollup reading as one more resource figure -
     * "100% uptime" on a group and on a resource are otherwise identical.
     */
    test("carries a status dot in the rolled up status colour", () => {
      renderSection({ rollupLabel: "Operational", rollupColor: "#2ab57d" });

      const dot: HTMLElement = screen.getByTestId(
        "status-page-group-rollup-dot",
      );

      expect(dot).toHaveStyle({ backgroundColor: "#2ab57d" });
      expect(dot).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByText("Operational")).toHaveStyle({
        color: "#2ab57d",
      });
    });

    test("the dot is decoration - the reading itself is the text", () => {
      renderSection({ rollupLabel: "Operational", rollupColor: "#2ab57d" });

      expect(screen.getByTestId("status-page-group-rollup")).toHaveTextContent(
        "Operational",
      );
    });

    test("renders without a colour rather than crashing", () => {
      renderSection({ rollupLabel: "Operational" });

      expect(screen.getByText("Operational")).toBeInTheDocument();
      expect(
        screen.getByTestId("status-page-group-rollup-dot"),
      ).toBeInTheDocument();
    });
  });

  describe("the sub group count", () => {
    test("is shown when the caller supplies a label", () => {
      renderSection({ subGroupCountLabel: "3 groups", subGroupCount: 3 });

      expect(
        screen.getByTestId("status-page-group-sub-group-count"),
      ).toHaveTextContent("3 groups");
    });

    test("is absent for a group with no sub groups", () => {
      renderSection({ subGroupCount: 0 });

      expect(
        screen.queryByTestId("status-page-group-sub-group-count"),
      ).not.toBeInTheDocument();
    });
  });

  describe("the description", () => {
    /*
     * The markdown itself renders through a lazily imported viewer, so what is
     * asserted here is this component's part: that a group with a description
     * gets the slot, aligned with the title, and a group without one does not.
     */
    test("is rendered when the group has one", () => {
      renderSection({ description: "Everything in the corporate unit." });

      const description: HTMLElement = screen.getByTestId(
        "status-page-group-description",
      );

      expect(description).toBeInTheDocument();
      expect(description.className).toBe(
        StatusPageGroupNestingLayoutUtil.getDescriptionClassName(),
      );
    });

    test("is absent for a group with no description", () => {
      renderSection({});

      expect(
        screen.queryByTestId("status-page-group-description"),
      ).not.toBeInTheDocument();
    });

    /*
     * A description is markdown and may contain a link. A link inside a button
     * is not something a browser or a screen reader can make sense of, so the
     * description sits outside the header.
     */
    test("never ends up inside the header button", () => {
      renderSection({ description: "Everything in the corporate unit." });

      expect(
        header().contains(screen.getByTestId("status-page-group-description")),
      ).toBe(false);
    });

    test("is announced with the header rather than read as part of its name", () => {
      renderSection({ description: "Everything in the corporate unit." });

      expect(header().getAttribute("aria-describedby")).toBe(
        screen.getByTestId("status-page-group-description").getAttribute("id"),
      );
    });

    test("adds no describedby when there is no description", () => {
      renderSection({});

      expect(header()).not.toHaveAttribute("aria-describedby");
    });
  });

  describe("the body", () => {
    test("renders a group's own resources above its sub groups", () => {
      renderSection({
        isInitiallyExpanded: true,
        hasOwnResources: true,
        subGroupCount: 1,
        resourcesElement: <div>Corporate API</div>,
        subGroupsElement: <div>Region 1000</div>,
      });

      const body: HTMLElement = screen.getByTestId("status-page-group-body");
      const text: string = body.textContent || "";

      expect(text.indexOf("Corporate API")).toBeGreaterThanOrEqual(0);
      expect(text.indexOf("Corporate API")).toBeLessThan(
        text.indexOf("Region 1000"),
      );
    });

    /*
     * Without the line, a group's last resource reads as the first row of the
     * first sub group below it.
     */
    test("draws a line between own resources and sub groups", () => {
      renderSection({
        isInitiallyExpanded: true,
        hasOwnResources: true,
        subGroupCount: 1,
        resourcesElement: <div>Corporate API</div>,
        subGroupsElement: <div>Region 1000</div>,
      });

      expect(screen.getByTestId("status-page-sub-group-list")).toHaveClass(
        "border-t",
      );
    });

    test("draws no line for a group that only holds sub groups", () => {
      renderSection({
        isInitiallyExpanded: true,
        hasOwnResources: false,
        subGroupCount: 2,
        subGroupsElement: <div>Region 1000</div>,
      });

      expect(
        screen.getByTestId("status-page-sub-group-list").className,
      ).not.toMatch(/border-t/);
    });

    test("has no sub group list when there are no sub groups", () => {
      renderSection({
        isInitiallyExpanded: true,
        hasOwnResources: true,
        resourcesElement: <div>Corporate API</div>,
      });

      expect(
        screen.queryByTestId("status-page-sub-group-list"),
      ).not.toBeInTheDocument();
    });

    test("an expanded group with nothing in it still opens", () => {
      renderSection({ isInitiallyExpanded: true });

      expect(screen.getByTestId("status-page-group-body")).toBeInTheDocument();
    });
  });

  describe("a real hierarchy", () => {
    /*
     * Corporate -> Region -> Market -> Site -> Rack -> Node, all expanded. This
     * is the shape that used to produce six stacked cards.
     */
    type RenderNestedFunction = (depth: number) => ReactElement;

    const renderNested: RenderNestedFunction = (
      depth: number,
    ): ReactElement => {
      return (
        <ResourceGroupSection
          depth={depth}
          name={`Level ${depth}`}
          isInitiallyExpanded={true}
          subGroupCount={depth < 5 ? 1 : 0}
          testId={`level-${depth}`}
          subGroupsElement={depth < 5 ? renderNested(depth + 1) : undefined}
          resourcesElement={depth === 5 ? <div>Leaf API</div> : undefined}
          hasOwnResources={depth === 5}
        />
      );
    };

    test("renders every level and reaches the leaf", () => {
      render(renderNested(0));

      for (let depth: number = 0; depth <= 5; depth++) {
        expect(screen.getByTestId(`level-${depth}`)).toBeInTheDocument();
      }

      expect(screen.getByText("Leaf API")).toBeInTheDocument();
    });

    test("only one card is drawn, however deep the hierarchy goes", () => {
      const { container } = render(renderNested(0));

      const cards: Array<Element> = Array.from(
        container.querySelectorAll("[data-testid^='level-']"),
      ).filter((element: Element) => {
        return element.className.includes("bg-white");
      });

      expect(cards).toHaveLength(1);
      expect(cards[0]!.getAttribute("data-testid")).toBe("level-0");
    });

    test("every level below the top hangs off its own rail", () => {
      render(renderNested(0));

      for (let depth: number = 1; depth <= 5; depth++) {
        const level: HTMLElement = screen.getByTestId(`level-${depth}`);
        const body: Element | null = level.querySelector(
          "[data-testid='status-page-group-body']",
        );

        expect(body).not.toBeNull();
        expect(body!.className).toContain("border-l");
      }
    });

    /*
     * The indent has to stop growing at some point or a deep tree runs the
     * uptime bars off the right of a phone.
     */
    test("the indent stops growing once the cap is reached", () => {
      render(renderNested(0));

      const bodyClassAt: (depth: number) => string = (
        depth: number,
      ): string => {
        return (
          screen
            .getByTestId(`level-${depth}`)
            .querySelector("[data-testid='status-page-group-body']")
            ?.className || ""
        );
      };

      expect(bodyClassAt(1)).toBe(
        StatusPageGroupNestingLayoutUtil.getBodyClassName({ depth: 1 }),
      );
      expect(
        bodyClassAt(StatusPageGroupNestingLayoutUtil.MaxIndentedDepth + 1),
      ).toBe(bodyClassAt(StatusPageGroupNestingLayoutUtil.MaxIndentedDepth));
      /*
       * The step is smaller past the cap, which is what keeps a ten level tree
       * inside the content column. The px arithmetic lives in the util's own
       * suite; here it is enough that the two are not the same class.
       */
      expect(
        bodyClassAt(StatusPageGroupNestingLayoutUtil.MaxIndentedDepth),
      ).not.toBe(bodyClassAt(1));
    });

    test("collapsing a level hides everything under it", () => {
      render(renderNested(0));

      expect(screen.getByText("Leaf API")).toBeInTheDocument();

      fireEvent.click(
        screen
          .getByTestId("level-2")
          .querySelector(
            "[data-testid='status-page-group-header']",
          ) as HTMLElement,
      );

      expect(screen.queryByText("Leaf API")).not.toBeInTheDocument();
      expect(screen.getByTestId("level-2")).toBeInTheDocument();
    });
  });

  /*
   * A status page whose hierarchy is built but whose monitors are not added
   * yet. This used to be a page that rendered nothing at all; the section has
   * to draw the structure on its own, because that structure is the only thing
   * the operator has put there so far.
   */
  describe("a hierarchy with no resources anywhere in it", () => {
    type RenderEmptyFunction = (depth: number) => ReactElement;

    const renderEmpty: RenderEmptyFunction = (depth: number): ReactElement => {
      return (
        <ResourceGroupSection
          depth={depth}
          name={`Level ${depth}`}
          isInitiallyExpanded={true}
          subGroupCount={depth < 3 ? 1 : 0}
          testId={`empty-level-${depth}`}
          subGroupsElement={depth < 3 ? renderEmpty(depth + 1) : undefined}
          hasOwnResources={false}
        />
      );
    };

    test("every level is still drawn, and named", () => {
      render(renderEmpty(0));

      for (let depth: number = 0; depth <= 3; depth++) {
        expect(screen.getByTestId(`empty-level-${depth}`)).toBeInTheDocument();
        expect(screen.getByText(`Level ${depth}`)).toBeInTheDocument();
      }
    });

    test("each level is still a working disclosure control", () => {
      render(renderEmpty(0));

      const header: HTMLElement = screen
        .getByTestId("empty-level-1")
        .querySelector("[data-testid='status-page-group-header']")!;

      expect(header.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByTestId("empty-level-3")).toBeInTheDocument();

      fireEvent.click(header);

      expect(header.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByTestId("empty-level-3")).not.toBeInTheDocument();
      expect(screen.getByTestId("empty-level-1")).toBeInTheDocument();
    });

    /*
     * No resources means no rolled up reading to show. A group header with a
     * number on it that came from nowhere is worse than a header without one.
     */
    test("no rollup is drawn when the caller has none to give", () => {
      render(renderEmpty(0));

      expect(
        screen.queryByTestId("status-page-group-rollup"),
      ).not.toBeInTheDocument();
    });
  });

  describe("test ids", () => {
    test("the caller can override the default", () => {
      renderSection({ testId: "my-group" });

      expect(screen.getByTestId("my-group")).toBeInTheDocument();
      expect(screen.queryByTestId("status-page-group")).not.toBeInTheDocument();
    });
  });
});
