import ResourceGroupSection from "../../../../UI/Components/StatusPage/ResourceGroupSection";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - what a running search does to a collapsed group.
 *
 * The status page search filters resources, and most of them live inside
 * groups that are collapsed by default. A match folded inside a closed group
 * is indistinguishable from no match at all, so a search has to open the
 * groups it kept.
 *
 * The subtle half is what happens afterwards. Opening every group and leaving
 * them open would mean a search quietly rewrote the shape of the page, so the
 * visitor's own choice is remembered underneath and put back when the search
 * is cleared. And the open/close control has to keep working while the search
 * runs - a header that renders as a toggle and does nothing is a defect, not
 * a safeguard.
 */

function renderSection(
  props: Partial<React.ComponentProps<typeof ResourceGroupSection>> = {},
): ReturnType<typeof render> {
  return render(
    <ResourceGroupSection
      depth={props.depth === undefined ? 0 : props.depth}
      name={props.name === undefined ? "Europe" : props.name}
      isInitiallyExpanded={props.isInitiallyExpanded}
      autoExpand={props.autoExpand}
      hasOwnResources={true}
      resourcesElement={
        (props.resourcesElement as ReactElement) || (
          <div data-testid="resources">Checkout API</div>
        )
      }
    />,
  );
}

function isOpen(): boolean {
  return screen.queryByTestId("status-page-group-body") !== null;
}

function header(): HTMLElement {
  return screen.getByTestId("status-page-group-header");
}

describe("ResourceGroupSection - autoExpand", () => {
  test("a collapsed group opens when autoExpand turns on", () => {
    const { rerender } = renderSection({ isInitiallyExpanded: false });

    expect(isOpen()).toBe(false);

    rerender(
      <ResourceGroupSection
        depth={0}
        name="Europe"
        isInitiallyExpanded={false}
        autoExpand={true}
        hasOwnResources={true}
        resourcesElement={<div data-testid="resources">Checkout API</div>}
      />,
    );

    expect(isOpen()).toBe(true);
    expect(screen.getByTestId("resources")).toBeInTheDocument();
  });

  test("the header reports the group as expanded once it is", () => {
    const { rerender } = renderSection({ isInitiallyExpanded: false });

    expect(header()).toHaveAttribute("aria-expanded", "false");

    rerender(
      <ResourceGroupSection
        depth={0}
        name="Europe"
        isInitiallyExpanded={false}
        autoExpand={true}
        hasOwnResources={true}
        resourcesElement={<div data-testid="resources">Checkout API</div>}
      />,
    );

    expect(header()).toHaveAttribute("aria-expanded", "true");
  });

  /*
   * The point of remembering: clearing a search must leave the page as the
   * visitor had it, not with every group on it hanging open.
   */
  test("clearing autoExpand puts the group back the way it was", () => {
    const { rerender } = renderSection({ isInitiallyExpanded: false });

    rerender(
      <ResourceGroupSection
        depth={0}
        name="Europe"
        isInitiallyExpanded={false}
        autoExpand={true}
        hasOwnResources={true}
        resourcesElement={<div data-testid="resources">Checkout API</div>}
      />,
    );

    expect(isOpen()).toBe(true);

    rerender(
      <ResourceGroupSection
        depth={0}
        name="Europe"
        isInitiallyExpanded={false}
        autoExpand={false}
        hasOwnResources={true}
        resourcesElement={<div data-testid="resources">Checkout API</div>}
      />,
    );

    expect(isOpen()).toBe(false);
  });

  test("a group the visitor had opened is still open after a search ends", () => {
    const { rerender } = renderSection({ isInitiallyExpanded: false });

    fireEvent.click(header());

    expect(isOpen()).toBe(true);

    rerender(
      <ResourceGroupSection
        depth={0}
        name="Europe"
        isInitiallyExpanded={false}
        autoExpand={true}
        hasOwnResources={true}
        resourcesElement={<div data-testid="resources">Checkout API</div>}
      />,
    );

    rerender(
      <ResourceGroupSection
        depth={0}
        name="Europe"
        isInitiallyExpanded={false}
        autoExpand={false}
        hasOwnResources={true}
        resourcesElement={<div data-testid="resources">Checkout API</div>}
      />,
    );

    expect(isOpen()).toBe(true);
  });

  /*
   * autoExpand is a nudge, not a lock. Pinning the section open would leave
   * the header rendering as a working toggle that does nothing.
   */
  test("the visitor can still close a group while a search is running", () => {
    renderSection({ isInitiallyExpanded: false, autoExpand: true });

    expect(isOpen()).toBe(true);

    fireEvent.click(header());

    expect(isOpen()).toBe(false);
    expect(header()).toHaveAttribute("aria-expanded", "false");
  });

  test("a group already open is left alone by autoExpand", () => {
    const { rerender } = renderSection({ isInitiallyExpanded: true });

    expect(isOpen()).toBe(true);

    rerender(
      <ResourceGroupSection
        depth={0}
        name="Europe"
        isInitiallyExpanded={true}
        autoExpand={true}
        hasOwnResources={true}
        resourcesElement={<div data-testid="resources">Checkout API</div>}
      />,
    );

    rerender(
      <ResourceGroupSection
        depth={0}
        name="Europe"
        isInitiallyExpanded={true}
        autoExpand={false}
        hasOwnResources={true}
        resourcesElement={<div data-testid="resources">Checkout API</div>}
      />,
    );

    expect(isOpen()).toBe(true);
  });

  test("a group mounted with autoExpand already on opens immediately", () => {
    renderSection({ isInitiallyExpanded: false, autoExpand: true });

    expect(isOpen()).toBe(true);
  });

  /*
   * Searching, changing the query, and searching again is one episode as far
   * as the visitor is concerned; it must not be remembered as several.
   */
  test("autoExpand staying on across renders does not re-open a closed group", () => {
    const { rerender } = renderSection({
      isInitiallyExpanded: false,
      autoExpand: true,
    });

    fireEvent.click(header());

    expect(isOpen()).toBe(false);

    rerender(
      <ResourceGroupSection
        depth={0}
        name="Europe"
        isInitiallyExpanded={false}
        autoExpand={true}
        hasOwnResources={true}
        resourcesElement={<div data-testid="resources">Search</div>}
      />,
    );

    expect(isOpen()).toBe(false);
  });

  test("groups with no autoExpand at all behave exactly as before", () => {
    renderSection({ isInitiallyExpanded: false });

    expect(isOpen()).toBe(false);

    fireEvent.click(header());

    expect(isOpen()).toBe(true);

    fireEvent.click(header());

    expect(isOpen()).toBe(false);
  });
});
