import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import React from "react";
import Feed from "../../../UI/Components/Feed/Feed";
import { FeedItemProps } from "../../../UI/Components/Feed/FeedItem";
import IconProp from "../../../Types/Icon/IconProp";
import { Black } from "../../../Types/BrandColors";

function makeItems(count: number): Array<FeedItemProps> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return {
      key: `update-${index + 1}`,
      textInMarkdown: "",
      element: <span>{`Update ${index + 1}`}</span>,
      itemDateTime: new Date(Date.UTC(2026, 8, 7, 12, index)),
      icon: IconProp.Check,
      color: Black,
    };
  });
}

function displayedUpdates(): Array<string | null> {
  return screen.getAllByText(/^Update \d+$/).map((update: HTMLElement) => {
    return update.textContent;
  });
}

afterEach(() => {
  cleanup();
});

describe("Feed recent activity", () => {
  test("preserves the full chronological feed when no limit is requested", () => {
    render(<Feed items={makeItems(7)} noItemsMessage="No updates yet." />);

    expect(displayedUpdates()).toEqual([
      "Update 1",
      "Update 2",
      "Update 3",
      "Update 4",
      "Update 5",
      "Update 6",
      "Update 7",
    ]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("shows the latest updates in their original chronological order", () => {
    const items: Array<FeedItemProps> = makeItems(8);
    render(
      <Feed
        items={items}
        visibleItemLimit={3}
        noItemsMessage="No updates yet."
      />,
    );

    expect(displayedUpdates()).toEqual(["Update 6", "Update 7", "Update 8"]);
    expect(screen.queryByText("Update 5")).not.toBeInTheDocument();
    expect(items[0]?.key).toBe("update-1");
    expect(items).toHaveLength(8);
    expect(
      screen.getByRole("button", { name: "Show 5 earlier updates" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("lets responders expand history and return to recent activity", () => {
    render(
      <Feed
        items={makeItems(5)}
        visibleItemLimit={3}
        noItemsMessage="No updates yet."
      />,
    );

    const expand: HTMLElement = screen.getByRole("button", {
      name: "Show 2 earlier updates",
    });
    const controlledListId: string | null =
      expand.getAttribute("aria-controls");
    expect(controlledListId).toBeTruthy();
    expect(document.getElementById(controlledListId!)).toBe(
      screen.getByRole("list"),
    );
    fireEvent.click(expand);

    expect(displayedUpdates()).toEqual([
      "Update 1",
      "Update 2",
      "Update 3",
      "Update 4",
      "Update 5",
    ]);
    const collapse: HTMLElement = screen.getByRole("button", {
      name: "Show fewer updates",
    });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(collapse);

    expect(displayedUpdates()).toEqual(["Update 3", "Update 4", "Update 5"]);
    expect(
      screen.getByRole("button", { name: "Show 2 earlier updates" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("uses a singular label when exactly one earlier update is hidden", () => {
    render(
      <Feed
        items={makeItems(4)}
        visibleItemLimit={3}
        noItemsMessage="No updates yet."
      />,
    );

    expect(
      screen.getByRole("button", { name: "Show 1 earlier update" }),
    ).toBeInTheDocument();
  });

  test.each([1, 3])(
    "shows all %s items without unnecessary expansion controls when they fit the limit",
    (count: number) => {
      render(
        <Feed
          items={makeItems(count)}
          visibleItemLimit={3}
          noItemsMessage="No updates yet."
        />,
      );

      expect(screen.getAllByRole("listitem")).toHaveLength(count);
      expect(screen.getByText("Update 1")).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  test("preserves empty-state guidance without adding invalid non-item list content", () => {
    render(
      <Feed
        items={[]}
        visibleItemLimit={3}
        noItemsMessage="No maintenance updates yet."
      />,
    );

    const emptyState: HTMLElement = screen.getByText(
      "No maintenance updates yet.",
    );
    expect(emptyState).toBeInTheDocument();
    expect(emptyState.closest("ul")).toBeNull();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back to the full feed for invalid limit %s",
    (visibleItemLimit: number) => {
      render(
        <Feed
          items={makeItems(4)}
          visibleItemLimit={visibleItemLimit}
          noItemsMessage="No updates yet."
        />,
      );

      expect(screen.getAllByRole("listitem")).toHaveLength(4);
      expect(screen.getByText("Update 1")).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  test("keeps collapsed feeds current and preserves expanded history as updates arrive", () => {
    const { rerender } = render(
      <Feed
        items={makeItems(5)}
        visibleItemLimit={3}
        noItemsMessage="No updates yet."
      />,
    );

    rerender(
      <Feed
        items={makeItems(6)}
        visibleItemLimit={3}
        noItemsMessage="No updates yet."
      />,
    );

    expect(displayedUpdates()).toEqual(["Update 4", "Update 5", "Update 6"]);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 3 earlier updates" }),
    );

    rerender(
      <Feed
        items={makeItems(7)}
        visibleItemLimit={3}
        noItemsMessage="No updates yet."
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByText("Update 1")).toBeInTheDocument();
    expect(screen.getByText("Update 7")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show fewer updates" }),
    ).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "Show fewer updates" }));
    expect(displayedUpdates()).toEqual(["Update 5", "Update 6", "Update 7"]);
  });

  test("resets expansion when the requested preview size changes", () => {
    const { rerender } = render(
      <Feed
        items={makeItems(7)}
        visibleItemLimit={3}
        noItemsMessage="No updates yet."
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show 4 earlier updates" }),
    );

    rerender(
      <Feed
        items={makeItems(7)}
        visibleItemLimit={2}
        noItemsMessage="No updates yet."
      />,
    );

    expect(displayedUpdates()).toEqual(["Update 6", "Update 7"]);
    expect(
      screen.getByRole("button", { name: "Show 5 earlier updates" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("keeps expansion controls scoped to their own feed", () => {
    render(
      <React.Fragment>
        <section aria-label="Incident history">
          <Feed
            items={makeItems(5)}
            visibleItemLimit={3}
            noItemsMessage="No updates yet."
          />
        </section>
        <section aria-label="Maintenance history">
          <Feed
            items={makeItems(6)}
            visibleItemLimit={3}
            noItemsMessage="No updates yet."
          />
        </section>
      </React.Fragment>,
    );

    const incident: HTMLElement = screen.getByRole("region", {
      name: "Incident history",
    });
    const maintenance: HTMLElement = screen.getByRole("region", {
      name: "Maintenance history",
    });
    const incidentButton: HTMLElement = within(incident).getByRole("button");
    const maintenanceButton: HTMLElement =
      within(maintenance).getByRole("button");

    expect(incidentButton.getAttribute("aria-controls")).not.toBe(
      maintenanceButton.getAttribute("aria-controls"),
    );
    fireEvent.click(incidentButton);
    expect(within(incident).getAllByRole("listitem")).toHaveLength(5);
    expect(within(maintenance).getAllByRole("listitem")).toHaveLength(3);
    expect(maintenanceButton).toHaveAttribute("aria-expanded", "false");
  });
});
