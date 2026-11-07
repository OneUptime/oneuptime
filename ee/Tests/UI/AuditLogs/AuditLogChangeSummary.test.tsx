import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import AuditLogChangesModal, {
  readChangeSummary,
} from "../../../Dashboard/AuditLogs/AuditLogChangesModal";

/*
 * A change the entry describes rather than copies reads as what changed
 * (issue #6187): a workflow's graph is the lines the recorder wrote - a step
 * added, a setting changed, a connection made - above the graph before and
 * after in a few words; JSON shows the paths that changed above its values.
 */

afterEach(() => {
  cleanup();
});

describe("a workflow saved in the builder", () => {
  test("shows what changed in its steps, line by line, with the graph before and after", () => {
    render(
      <AuditLogChangesModal
        isOpen={true}
        onClose={jest.fn()}
        action="Update"
        resourceType="Workflow"
        resourceName="Page the database team"
        changes={[
          {
            field: "graph",
            oldValue: "1 step and no connections",
            newValue: "2 steps and 1 connection",
            summary: [
              'Added "Send Email" (send-email-1)',
              'Connected "Manual" (manual-1) to "Send Email" (send-email-1)',
            ],
          },
        ]}
      />,
    );

    const summary: HTMLElement = screen.getByTestId("audit-log-change-summary");

    expect(within(summary).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(summary).getByText('Added "Send Email" (send-email-1)'),
    ).toBeInTheDocument();
    expect(screen.getByText("1 step and no connections")).toBeInTheDocument();
    expect(screen.getByText("2 steps and 1 connection")).toBeInTheDocument();
    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
    expect(screen.getByText("1 field changed")).toBeInTheDocument();
  });

  test("a created workflow lists its steps above what it holds", () => {
    render(
      <AuditLogChangesModal
        isOpen={true}
        onClose={jest.fn()}
        action="Create"
        resourceType="Workflow"
        changes={[
          {
            field: "graph",
            newValue: "2 steps and no connections",
            summary: ['"Log" (log-1)', '"Manual" (manual-1)'],
          },
        ]}
      />,
    );

    expect(
      within(screen.getByTestId("audit-log-change-summary")).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(2);
    expect(screen.getByText("2 steps and no connections")).toBeInTheDocument();
  });
});

describe("a field without a summary", () => {
  test("shows no summary list, as before", () => {
    render(
      <AuditLogChangesModal
        isOpen={true}
        onClose={jest.fn()}
        action="Update"
        resourceType="Queue"
        changes={[{ field: "name", oldValue: "orders", newValue: "orders-v2" }]}
      />,
    );

    expect(
      screen.queryByTestId("audit-log-change-summary"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(screen.getByText("orders-v2")).toBeInTheDocument();
  });
});

describe("the summary as an entry stores it", () => {
  test("is read as its lines of text, and nothing else", () => {
    expect(readChangeSummary(["a", "b"])).toEqual(["a", "b"]);
    expect(readChangeSummary(["a", 1, null, { x: 1 }, " ", "b"])).toEqual([
      "a",
      "b",
    ]);
    expect(readChangeSummary("a")).toEqual([]);
    expect(readChangeSummary(undefined)).toEqual([]);
    expect(readChangeSummary(null)).toEqual([]);
    expect(readChangeSummary({ 0: "a" })).toEqual([]);
  });
});
