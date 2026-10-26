import "@testing-library/jest-dom";
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import ToolApprovalCard, {
  argsPreview,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolApprovalCard";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../Types/JSON";

/*
 * WHAT AN ACTION NAMES, BY NAME, BEFORE IT IS APPROVED (#5293).
 *
 * Declared from host test01's page, Ask AI's create_incident links the
 * incident to test01. The arguments name the host by its ID, which tells
 * the person approving nothing, so the server prepares a line saying what
 * they name - "Linked to host "test01"." - and the approval card shows it
 * under the action's title. The lists it names are then left out of the
 * one-line argument preview, where they would only repeat it as IDs; every
 * other action's preview is as it was.
 */

afterEach(() => {
  cleanup();
});

const HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const DECLARE_ARGUMENTS: JSONObject = {
  title: "High memory usage",
  severityName: "SEV2",
  affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
};

function action(overrides: Partial<AIChatToolAction> = {}): AIChatToolAction {
  return {
    id: "call-declare",
    toolName: "create_incident",
    title: "Create incident: High memory usage",
    description: 'Linked to host "test01".',
    arguments: DECLARE_ARGUMENTS,
    isMutation: true,
    requiresApproval: true,
    status: AIChatToolActionStatus.Pending,
    ...overrides,
  };
}

describe("the approval card names what an action links", () => {
  test("the description sits under the title, and the IDs it names are not repeated", () => {
    render(
      <ToolApprovalCard
        toolActions={[action()]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    const description: HTMLElement = screen.getByTestId(
      "tool-approval-description",
    );
    expect(description).toHaveTextContent('Linked to host "test01".');

    // The title first, then what it links, then the plain arguments.
    const card: HTMLElement = description.parentElement!;
    expect(
      within(card).getByText("Create incident: High memory usage"),
    ).toBeInTheDocument();
    expect(card).toHaveTextContent("title: High memory usage");
    expect(card).toHaveTextContent("severityName: SEV2");
    expect(card).not.toHaveTextContent(HOST_ID);
    expect(card).not.toHaveTextContent("affectedResources");
  });

  test("an action with no description shows its arguments as before, lists included", () => {
    render(
      <ToolApprovalCard
        toolActions={[action({ description: undefined })]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    expect(
      screen.queryByTestId("tool-approval-description"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/affectedResources:/)).toBeInTheDocument();
  });

  test("a long description wraps rather than being cut off", () => {
    const long: string = `Linked to ${Array.from(
      { length: 10 },
      (_: unknown, index: number) => {
        return `host "web-${index}"`;
      },
    ).join(", ")}.`;

    render(
      <ToolApprovalCard
        toolActions={[action({ description: long })]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    const description: HTMLElement = screen.getByTestId(
      "tool-approval-description",
    );
    expect(description).toHaveTextContent(long);
    expect(description.className).toContain("break-words");
    expect(description.className).not.toContain("truncate");
    expect(description.className).not.toContain("line-clamp");
  });

  test("the description is shown while waiting, even before the buttons are live", () => {
    render(
      <ToolApprovalCard
        toolActions={[action()]}
        interactive={false}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    expect(screen.getByTestId("tool-approval-description")).toHaveTextContent(
      'Linked to host "test01".',
    );
  });

  test("a decided action keeps its one-line history row", () => {
    render(
      <ToolApprovalCard
        toolActions={[action({ status: AIChatToolActionStatus.Executed })]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    expect(
      screen.getByText("Create incident: High memory usage"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("tool-approval-description"),
    ).not.toBeInTheDocument();
  });
});

describe("argsPreview", () => {
  test("names every argument, as before", () => {
    expect(argsPreview(DECLARE_ARGUMENTS)).toBe(
      `title: High memory usage  ·  severityName: SEV2  ·  affectedResources: [{"resourceType":"Host","resourceId":"${HOST_ID}"}]`,
    );
  });

  test("leaves the lists out when a description names them", () => {
    expect(argsPreview(DECLARE_ARGUMENTS, { leaveOutLists: true })).toBe(
      "title: High memory usage  ·  severityName: SEV2",
    );
  });

  test("still leaves out empty values", () => {
    expect(
      argsPreview({ title: "", note: null, count: 0 }, { leaveOutLists: true }),
    ).toBe("count: 0");
  });
});
