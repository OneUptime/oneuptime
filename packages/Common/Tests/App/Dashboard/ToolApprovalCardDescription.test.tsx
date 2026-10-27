import "@testing-library/jest-dom";
import React from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
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
    /*
     * The title the incident takes is the card's own title: the argument
     * line, cut at two lines, does not spend them repeating it (#5301's UI
     * review).
     */
    expect(card).not.toHaveTextContent("title: High memory usage");
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

  /*
   * The title says what is being approved, and on a phone it shares its
   * row with Allow and Skip: cut at one line, "Link incident #1042 to
   * affected resources" lost the incident it acts on. It wraps instead, to
   * three lines at most - all a linking action's title needs there.
   */
  test("the title wraps rather than being cut at one line", () => {
    const title: string = "Link incident #1042 to affected resources";

    render(
      <ToolApprovalCard
        toolActions={[
          action({ title, toolName: "add_incident_affected_resources" }),
        ]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    const shown: HTMLElement = screen.getByTestId("tool-approval-title");
    expect(shown).toHaveTextContent(title);
    expect(shown.className).toContain("break-words");
    expect(shown.className).toContain("line-clamp-3");
    expect(shown.className).not.toContain("truncate");
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

  /*
   * #5301's UI review: "Create alert: High memory usage on test01" over
   * "title: High memory usage on test01 · description: Memory in use…":
   * the line is cut at two lines, and the repeat pushed the description
   * the alert will carry out of sight on a phone.
   */
  test("leaves out the argument the action's title ends with", () => {
    expect(
      argsPreview(
        {
          title: "High memory usage on test01",
          description: "Memory in use on test01 is at 78%.",
          severityName: "High",
        },
        { title: "Create alert: High memory usage on test01" },
      ),
    ).toBe(
      "description: Memory in use on test01 is at 78%.  ·  severityName: High",
    );
  });

  test("leaves it out whatever the spaces around it, and when the title is the argument itself", () => {
    expect(
      argsPreview(
        { title: "  Checkout down ", severityName: "SEV1" },
        { title: "Create incident: Checkout down" },
      ),
    ).toBe("severityName: SEV1");
    expect(
      argsPreview({ name: "Nightly backup" }, { title: "Nightly backup" }),
    ).toBe("");
  });

  test("keeps an argument the title only mentions: a severity that is a word of the title is still the severity", () => {
    expect(
      argsPreview(
        { title: "P1 outage in EU", severityName: "P1" },
        { title: "Create incident: P1 outage in EU" },
      ),
    ).toBe("severityName: P1");
    // An ID inside a sentence-like title is kept as before.
    expect(
      argsPreview(
        { incidentId: HOST_ID },
        { title: `Acknowledge incident ${HOST_ID}` },
      ),
    ).toBe(`incidentId: ${HOST_ID}`);
  });

  test("never leaves out a list or a number for matching the title", () => {
    expect(
      argsPreview({ count: 3, tags: ["3"] }, { title: "Create something: 3" }),
    ).toBe('count: 3  ·  tags: ["3"]');
  });
});

/*
 * Allow and Skip beside the action where the card has room, and under it
 * where it has not (#5301's UI review): beside it on a phone, German's
 * "Zulassen" and "Überspringen" left the title 85 px and cut it at three
 * lines. The card measures its own width - it sits in the Ask AI dialog,
 * a phone's full-screen sheet and an incident's AI card, each as wide as it is -
 * so the browser suite measures the layout; this holds the wiring.
 */
describe("the approval card's layout and its choice", () => {
  test("each action measures its own width, and goes side by side only from 28rem", () => {
    render(
      <ToolApprovalCard
        toolActions={[action()]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    const row: HTMLElement = screen.getByTestId("tool-approval-action");
    expect(row.className).toContain("[container-type:inline-size]");

    const layout: HTMLElement = row.firstElementChild as HTMLElement;
    const classes: Array<string> = layout.className.split(" ");
    // Stacked unless the card is wide enough for both.
    expect(classes).toContain("flex-col");
    expect(classes).not.toContain("flex-row");
    expect(classes).toContain("[@container(min-width:28rem)]:flex-row");
    expect(classes).toContain("[@container(min-width:28rem)]:items-start");
    expect(classes).toContain("[@container(min-width:28rem)]:justify-between");

    // The choice keeps its own width at the start of its line when stacked.
    const choice: HTMLElement = screen.getByTestId("tool-approval-choice");
    expect(choice.className).toContain("self-start");
    expect(choice.className).toContain("flex-shrink-0");
    expect(layout.lastElementChild).toBe(choice);
  });

  test("Allow and Skip are a pair named after the action they decide, and say which is chosen", () => {
    render(
      <ToolApprovalCard
        toolActions={[
          action(),
          action({
            id: "call-raise",
            toolName: "create_alert",
            title: "Create alert: High memory usage",
          }),
        ]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    const incident: HTMLElement = screen.getByRole("group", {
      name: "Create incident: High memory usage",
    });
    const alert: HTMLElement = screen.getByRole("group", {
      name: "Create alert: High memory usage",
    });

    // Allowed by default, each on its own.
    expect(
      within(alert).getByRole("button", { name: "Allow" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(within(alert).getByRole("button", { name: "Skip" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    act(() => {
      within(alert).getByRole("button", { name: "Skip" }).click();
    });

    expect(within(alert).getByRole("button", { name: "Skip" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      within(alert).getByRole("button", { name: "Allow" }),
    ).toHaveAttribute("aria-pressed", "false");
    // The other action is still allowed.
    expect(
      within(incident).getByRole("button", { name: "Allow" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Run 1 action" }),
    ).toBeInTheDocument();
  });

  test("a card only waiting for approval draws no choice", () => {
    render(
      <ToolApprovalCard
        toolActions={[action()]}
        interactive={false}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    expect(
      screen.queryByTestId("tool-approval-choice"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });
});

/*
 * WRITTEN IN ENGLISH, ON A PAGE READ RIGHT TO LEFT (#5349's UI review).
 *
 * The title, the description and the arguments come from the server and
 * the model in English today. On a Persian page, laid out in the card's
 * own direction, 'Linked to host "test01".' read '."Linked to host
 * "test01': its full stop and quote moved to the other end. Each is an
 * isolate that reads the way most of its letters do (Common's
 * IsolatedText), so its punctuation stays where it was written while the
 * line still starts where the card reads from.
 */
describe("the approval card's lines read the way they are written", () => {
  test("an English title, description and arguments are isolates read left to right", () => {
    render(
      <ToolApprovalCard
        toolActions={[action()]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    for (const testId of [
      "tool-approval-title",
      "tool-approval-description",
      "tool-approval-arguments",
    ]) {
      const isolate: HTMLElement | null = screen
        .getByTestId(testId)
        .querySelector("bdi");

      expect(isolate).not.toBeNull();
      expect(isolate).toHaveAttribute("dir", "ltr");
    }

    expect(
      screen.getByTestId("tool-approval-description").querySelector("bdi"),
    ).toHaveTextContent('Linked to host "test01".');
  });

  test("a description in Persian is read right to left", () => {
    render(
      <ToolApprovalCard
        toolActions={[
          action({
            description:
              "\u{0628}\u{0647} \u{0645}\u{06cc}\u{0632}\u{0628}\u{0627}\u{0646} test01 \u{067e}\u{06cc}\u{0648}\u{0646}\u{062f} \u{062f}\u{0627}\u{062f}\u{0647} \u{0634}\u{062f}.",
          }),
        ]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    expect(
      screen.getByTestId("tool-approval-description").querySelector("bdi"),
    ).toHaveAttribute("dir", "rtl");
  });

  test("the arguments keep their line's monospace, which every page's font rule on * would take from the isolate", () => {
    render(
      <ToolApprovalCard
        toolActions={[action()]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    const line: HTMLElement = screen.getByTestId("tool-approval-arguments");
    expect(line).toHaveClass("font-mono");
    expect(line.querySelector("bdi")).toHaveClass("[font-family:inherit]");
  });
});
