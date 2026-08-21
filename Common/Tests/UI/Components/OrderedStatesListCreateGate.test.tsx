import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

import OrderedStatesList from "../../../UI/Components/OrderedStatesList/OrderedStatesList";

/*
 * Ordered lists - monitor statuses, incident states, on-call escalation order -
 * put their "Add New" affordance inside the list rather than in the card
 * header, so it never went through the header button's permission check. It
 * had no check of its own either: a viewer could open the create modal for a
 * monitor status from any of these pages.
 *
 * The affordance is a clickable <div>, not a button, so being disabled is not
 * something the platform does for it. All three of those behaviours have to be
 * built by hand and are asserted here: it stops responding, it stops looking
 * clickable, and it explains itself.
 */

type Row = {
  _id: string;
  name: string;
  order: number;
};

const ROWS: Array<Row> = [
  { _id: "state-1", name: "Operational", order: 1 },
  { _id: "state-2", name: "Degraded", order: 2 },
];

const DENIED_REASON: string =
  "You do not have permission to create this Monitor Status.";

type RenderListFunction = (options: {
  data: Array<Row>;
  createDisabledReason?: string | undefined;
  onCreateNewItem?: ((order: number) => void) | undefined;
}) => ReturnType<typeof render>;

const renderList: RenderListFunction = (options: {
  data: Array<Row>;
  createDisabledReason?: string | undefined;
  onCreateNewItem?: ((order: number) => void) | undefined;
}): ReturnType<typeof render> => {
  return render(
    <OrderedStatesList<Row>
      data={options.data}
      titleField="name"
      orderField="order"
      singularLabel="Monitor Status"
      shouldAddItemInTheBeginning={true}
      shouldAddItemInTheEnd={true}
      onCreateNewItem={options.onCreateNewItem}
      createDisabledReason={options.createDisabledReason}
    />,
  );
};

type FindAddAffordanceFunction = () => HTMLElement | null;

const findAddAffordance: FindAddAffordanceFunction = (): HTMLElement | null => {
  return (
    Array.from(document.querySelectorAll<HTMLElement>("div")).find(
      (element: HTMLElement) => {
        return (
          Boolean(element.getAttribute("aria-disabled")) &&
          (element.textContent || "").includes("Add New")
        );
      },
    ) || null
  );
};

describe("OrderedStatesList create gate", () => {
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("creates when the viewer is allowed", () => {
    let createdOrder: number | null = null;

    renderList({
      data: ROWS,
      onCreateNewItem: (order: number) => {
        createdOrder = order;
      },
    });

    const addAffordance: HTMLElement = findAddAffordance()!;

    fireEvent.click(addAffordance);

    expect(createdOrder).not.toBeNull();
  });

  test("keeps the affordance on screen when the viewer is not allowed", () => {
    renderList({
      data: ROWS,
      createDisabledReason: DENIED_REASON,
      onCreateNewItem: () => {},
    });

    expect(findAddAffordance()).not.toBeNull();
    expect(findAddAffordance()).toHaveAttribute("aria-disabled", "true");
  });

  test("does not create when the locked affordance is clicked", () => {
    let created: boolean = false;

    renderList({
      data: ROWS,
      createDisabledReason: DENIED_REASON,
      onCreateNewItem: () => {
        created = true;
      },
    });

    fireEvent.click(findAddAffordance()!);

    expect(created).toBe(false);
  });

  test("explains itself on hover", () => {
    renderList({
      data: ROWS,
      createDisabledReason: DENIED_REASON,
      onCreateNewItem: () => {},
    });

    /*
     * Unlike a disabled <button>, a div still dispatches its own pointer
     * events - so the tooltip hangs directly off the affordance here.
     */
    fireEvent.mouseEnter(findAddAffordance()!);

    expect(screen.getByRole("tooltip")).toHaveTextContent(DENIED_REASON);
  });

  test("stops looking clickable when locked", () => {
    renderList({
      data: ROWS,
      createDisabledReason: DENIED_REASON,
      onCreateNewItem: () => {},
    });

    const addAffordance: HTMLElement = findAddAffordance()!;

    expect(addAffordance).toHaveClass("cursor-not-allowed");
    expect(addAffordance).not.toHaveClass("cursor-pointer");
  });

  /*
   * The empty state is the one place the affordance is the only thing on
   * screen, so a viewer opening an empty list sees the reason rather than a
   * blank page.
   */
  test("locks the empty-state affordance too", () => {
    renderList({
      data: [],
      createDisabledReason: DENIED_REASON,
      onCreateNewItem: () => {},
    });

    const addAffordance: HTMLElement = findAddAffordance()!;

    expect(addAffordance).toHaveTextContent("Add New Monitor Status");

    fireEvent.mouseEnter(addAffordance);

    expect(screen.getByRole("tooltip")).toHaveTextContent(DENIED_REASON);
  });
});
