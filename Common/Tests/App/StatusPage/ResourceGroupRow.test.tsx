import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import ResourceGroupRow from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/ResourceGroupRow";
import StatusPageGroupViewMode from "../../../Types/StatusPage/StatusPageGroupViewMode";
import StatusPageResourceEditorTreeUtil from "../../../Utils/StatusPage/ResourceEditorTree";

/*
 * Contract under test - one row of the Resources tab's group tree.
 *
 * The row is the whole fix for issue #3042 expressed as a component: while it
 * is closed it must not render what it contains, because what it contains is a
 * ModelTable, and a ModelTable fetches the instant it mounts. "Closed" therefore
 * has to mean "not in the React tree" rather than "hidden", and that is what
 * most of this file asserts.
 *
 * The rest is the things a row has to get right to be usable at fifteen
 * hundred rows: a real disclosure button that reports its state, actions that
 * are not inside that button, and an indent that stops before it runs the
 * deepest rows off the side of the card.
 */

type RenderRowFunction = (
  props?: Partial<React.ComponentProps<typeof ResourceGroupRow>>,
) => ReturnType<typeof render>;

const renderRow: RenderRowFunction = (
  props: Partial<React.ComponentProps<typeof ResourceGroupRow>> = {},
): ReturnType<typeof render> => {
  return render(
    <ResourceGroupRow
      depth={props.depth === undefined ? 0 : props.depth}
      name={props.name === undefined ? "Region 1000" : props.name}
      path={props.path}
      viewMode={props.viewMode}
      resourceCountLabel={props.resourceCountLabel}
      subGroupCountLabel={props.subGroupCountLabel}
      isExpanded={Boolean(props.isExpanded)}
      onToggle={
        props.onToggle ||
        (() => {
          return undefined;
        })
      }
      actionsElement={props.actionsElement}
      testId={props.testId}
    >
      {props.children}
    </ResourceGroupRow>,
  );
};

type HeaderFunction = () => HTMLElement;

const header: HeaderFunction = (): HTMLElement => {
  return screen.getByTestId("status-page-resource-group-header");
};

describe("ResourceGroupRow", () => {
  describe("what a closed row renders", () => {
    /*
     * The regression this whole rewrite is about. If the body renders while the
     * row is closed, every group's table is mounted again and every one of them
     * fetches.
     */
    test("does not render its body at all", () => {
      renderRow({
        isExpanded: false,
        children: <div>Resources for this group</div>,
      });

      expect(
        screen.queryByText("Resources for this group"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("status-page-resource-group-body"),
      ).not.toBeInTheDocument();
    });

    test("still renders its name and badges", () => {
      renderRow({
        isExpanded: false,
        resourceCountLabel: "40 resources",
        subGroupCountLabel: "3 sub groups",
      });

      expect(screen.getByText("Region 1000")).toBeInTheDocument();
      expect(screen.getByText("40 resources")).toBeInTheDocument();
      expect(screen.getByText("3 sub groups")).toBeInTheDocument();
    });

    test("reports itself as collapsed", () => {
      renderRow({ isExpanded: false });

      expect(header()).toHaveAttribute("aria-expanded", "false");
      expect(header()).not.toHaveAttribute("aria-controls");
    });
  });

  describe("what an open row renders", () => {
    test("renders its body", () => {
      renderRow({
        isExpanded: true,
        children: <div>Resources for this group</div>,
      });

      expect(screen.getByText("Resources for this group")).toBeInTheDocument();
    });

    test("reports itself as expanded and points at its body", () => {
      renderRow({ isExpanded: true, children: <div>Body</div> });

      expect(header()).toHaveAttribute("aria-expanded", "true");

      const bodyId: string | null = header().getAttribute("aria-controls");

      expect(bodyId).toBeTruthy();
      expect(
        screen.getByTestId("status-page-resource-group-body"),
      ).toHaveAttribute("id", bodyId);
    });
  });

  describe("the disclosure control", () => {
    /*
     * A real button, not a div with a click handler: Enter, Space, focus and
     * the screen reader's "collapsed / expanded" all come free, and this row is
     * the only way to reach a group's monitors.
     */
    test("is a real button", () => {
      renderRow();

      expect(header().tagName).toBe("BUTTON");
      expect(header()).toHaveAttribute("type", "button");
    });

    test("calls back when clicked", () => {
      const onToggle: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

      renderRow({ onToggle: onToggle });

      fireEvent.click(header());

      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    test("opens on Enter", async () => {
      const user: UserEvent = userEvent.setup();
      const onToggle: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

      renderRow({ onToggle: onToggle });

      header().focus();
      await user.keyboard("{Enter}");

      expect(onToggle).toHaveBeenCalled();
    });

    test("its chevron turns when the row is open", () => {
      const { rerender } = render(
        <ResourceGroupRow
          depth={0}
          name="Region 1000"
          isExpanded={false}
          onToggle={() => {
            return undefined;
          }}
        />,
      );

      expect(
        screen.getByTestId("status-page-resource-group-chevron").innerHTML,
      ).not.toContain("rotate-90");

      rerender(
        <ResourceGroupRow
          depth={0}
          name="Region 1000"
          isExpanded={true}
          onToggle={() => {
            return undefined;
          }}
        />,
      );

      expect(
        screen.getByTestId("status-page-resource-group-chevron").innerHTML,
      ).toContain("rotate-90");
    });
  });

  describe("row actions", () => {
    /*
     * A button inside a button is not something a browser or a screen reader
     * can make sense of, and "Add Monitor" must not also toggle the row it
     * sits on.
     */
    test("live outside the disclosure button", () => {
      renderRow({
        actionsElement: <button type="button">Add Monitor</button>,
      });

      const action: HTMLElement = screen.getByText("Add Monitor");

      expect(header()).not.toContainElement(action);
    });

    test("clicking one does not toggle the row", () => {
      const onToggle: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

      renderRow({
        onToggle: onToggle,
        actionsElement: <button type="button">Add Monitor</button>,
      });

      fireEvent.click(screen.getByText("Add Monitor"));

      expect(onToggle).not.toHaveBeenCalled();
    });

    test("the action area is not rendered when there are no actions", () => {
      renderRow();

      expect(
        screen.queryByTestId("status-page-resource-group-actions"),
      ).not.toBeInTheDocument();
    });
  });

  describe("the path", () => {
    /*
     * Group names are unique per status page, not per level, so a hierarchy
     * built from a spreadsheet has plenty of repeated leaf names. Out of the
     * tree - in a flat search result - the path is the only thing that tells
     * two rows called "Unit 0152" apart.
     */
    test("is shown when the row is out of its place in the tree", () => {
      renderRow({
        name: "Unit 0152",
        path: "Corporate › Region 1000 › Market 1001 › Unit 0152",
      });

      expect(
        screen.getByTestId("status-page-resource-group-path"),
      ).toHaveTextContent("Corporate › Region 1000 › Market 1001 › Unit 0152");
    });

    test("is absent for a row sitting under its own parent", () => {
      renderRow({ name: "Unit 0152" });

      expect(
        screen.queryByTestId("status-page-resource-group-path"),
      ).not.toBeInTheDocument();
    });
  });

  describe("the view mode badge", () => {
    test("marks a grid group", () => {
      renderRow({ viewMode: StatusPageGroupViewMode.Grid });

      expect(
        screen.getByTestId("status-page-resource-group-view-mode"),
      ).toHaveTextContent("Grid");
    });

    /*
     * List is the default and the overwhelming majority, so labelling it would
     * be fifteen hundred badges that say nothing.
     */
    test("says nothing about a list group", () => {
      renderRow({ viewMode: StatusPageGroupViewMode.List });

      expect(
        screen.queryByTestId("status-page-resource-group-view-mode"),
      ).not.toBeInTheDocument();
    });
  });

  describe("the badges", () => {
    test("a row with no counts renders no badges", () => {
      renderRow({ resourceCountLabel: null, subGroupCountLabel: null });

      expect(
        screen.queryByTestId("status-page-resource-group-resource-count"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("status-page-resource-group-sub-group-count"),
      ).not.toBeInTheDocument();
    });
  });

  describe("indentation", () => {
    type BodyFunction = () => HTMLElement;

    const body: BodyFunction = (): HTMLElement => {
      return screen.getByTestId("status-page-resource-group-body");
    };

    type RowFunction = () => HTMLElement;

    const row: RowFunction = (): HTMLElement => {
      return screen.getByTestId("status-page-resource-group-row");
    };

    /*
     * The row is drawn inside the body of every group above it, and each of
     * those bodies already steps its contents in. A row that indented itself
     * as well would indent on top of an indent, and ten legal levels of
     * nesting would push the deepest rows off the side of the card.
     */
    test("a row never indents itself, however deep it is", () => {
      renderRow({ depth: 7 });

      expect((row().firstElementChild as HTMLElement).style.paddingLeft).toBe(
        "",
      );
    });

    test("a row steps its own contents in by one level", () => {
      renderRow({ depth: 0, isExpanded: true, children: <div>Body</div> });

      expect(body().style.paddingLeft).toBe(
        `${StatusPageResourceEditorTreeUtil.getIndentStepPixels({
          depth: 0,
        })}px`,
      );
    });

    test("the step tightens once the nesting gets deep", () => {
      renderRow({ depth: 8, isExpanded: true, children: <div>Body</div> });

      expect(body().style.paddingLeft).toBe(
        `${StatusPageResourceEditorTreeUtil.TightIndentStepPixels}px`,
      );
    });
  });

  describe("test ids", () => {
    test("a caller can name the row", () => {
      renderRow({ testId: "uncategorized-row" });

      expect(screen.getByTestId("uncategorized-row")).toBeInTheDocument();
    });
  });
});
