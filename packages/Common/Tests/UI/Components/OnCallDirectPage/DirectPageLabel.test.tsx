/*
 * What the on-call logs say of a direct page where a run's policy would be
 * named: "Direct page", what that means, and what started it - the workflow
 * by the name it had then, or the person.
 *
 * A direct page is listed with the on-call runs. The lists used to say "No
 * on-call policy." of one, which reads as something that went wrong; this
 * is the label that replaced it.
 */

import DirectPageLabel, {
  DIRECT_PAGE_EXPLANATION,
  DIRECT_PAGE_LABEL,
  DIRECT_PAGE_WORKFLOW_TEMPLATE,
} from "../../../../UI/Components/OnCallDirectPage/DirectPageLabel";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

afterEach(() => {
  cleanup();
});

describe("the label", () => {
  test("says Direct page", () => {
    render(<DirectPageLabel />);

    expect(screen.getByTestId("on-call-direct-page-label")).toHaveTextContent(
      "Direct page",
    );
    expect(DIRECT_PAGE_LABEL).toBe("Direct page");
  });

  test("says what that means on hover, and to a screen reader with the label", () => {
    render(<DirectPageLabel />);

    const label: HTMLElement = screen.getByTestId("on-call-direct-page-label");

    expect(label).toHaveAttribute("title", DIRECT_PAGE_EXPLANATION);
    // Read out after the label, and not drawn.
    const spoken: HTMLElement = within(label).getByText(
      `. ${DIRECT_PAGE_EXPLANATION}`,
    );

    expect(spoken).toHaveClass("sr-only");
    expect(DIRECT_PAGE_EXPLANATION).toBe(
      "People were paged directly, with no on-call policy: everybody at once, and no escalation.",
    );
  });

  test("is drawn in the page colour, with an icon before the words", () => {
    render(<DirectPageLabel />);

    const label: HTMLElement = screen.getByTestId("on-call-direct-page-label");

    expect(label).toHaveClass("bg-pink-50", "text-pink-700", "ring-pink-200");
    expect(label.querySelector("svg")).not.toBeNull();
    // On one line, however narrow its column.
    expect(label).toHaveClass("whitespace-nowrap");
  });

  test("alone, it is all there is: no workflow, nobody", () => {
    render(<DirectPageLabel />);

    expect(screen.queryByTestId("on-call-direct-page-workflow")).toBeNull();
    expect(screen.queryByTestId("on-call-direct-page-started-by")).toBeNull();
    expect(screen.getByTestId("on-call-direct-page").children).toHaveLength(1);
  });
});

describe("what started the page", () => {
  test("a workflow is named under the label, by the name the run kept", () => {
    render(
      <DirectPageLabel workflowName="Page on-call for critical incidents" />,
    );

    expect(
      screen.getByTestId("on-call-direct-page-workflow"),
    ).toHaveTextContent("Workflow: Page on-call for critical incidents");
    expect(DIRECT_PAGE_WORKFLOW_TEMPLATE).toBe("Workflow: {{workflowName}}");
  });

  test("a long name wraps rather than widening the column", () => {
    render(<DirectPageLabel workflowName={"A".repeat(120)} />);

    expect(screen.getByTestId("on-call-direct-page-workflow")).toHaveClass(
      "break-words",
      "max-w-full",
    );
  });

  test.each([undefined, null, "", "   "])(
    "no name (%p): no line for it",
    (name: string | null | undefined) => {
      render(<DirectPageLabel workflowName={name} />);

      expect(screen.queryByTestId("on-call-direct-page-workflow")).toBeNull();
    },
  );

  test("a name is shown as written, never read as markup", () => {
    render(<DirectPageLabel workflowName={'<img src=x onerror="alert(1)">'} />);

    expect(
      screen.getByTestId("on-call-direct-page-workflow"),
    ).toHaveTextContent('Workflow: <img src=x onerror="alert(1)">');
    expect(
      screen.getByTestId("on-call-direct-page").querySelector("img"),
    ).toBeNull();
  });

  test("a person is drawn under the label, as the page draws people", () => {
    render(
      <DirectPageLabel
        startedBy={<span data-testid="person">Jane Doe</span>}
      />,
    );

    expect(
      within(screen.getByTestId("on-call-direct-page-started-by")).getByTestId(
        "person",
      ),
    ).toHaveTextContent("Jane Doe");
  });

  test("the label comes first, then the workflow, then the person", () => {
    render(
      <DirectPageLabel
        workflowName="Escalate"
        startedBy={<span>Jane Doe</span>}
      />,
    );

    expect(
      Array.from(screen.getByTestId("on-call-direct-page").children).map(
        (child: Element): string | null => {
          return child.getAttribute("data-testid");
        },
      ),
    ).toEqual([
      "on-call-direct-page-label",
      "on-call-direct-page-workflow",
      "on-call-direct-page-started-by",
    ]);
  });

  test("a test id of the caller's own names every part", () => {
    render(<DirectPageLabel dataTestId="run-7" workflowName="Escalate" />);

    expect(screen.getByTestId("run-7")).toBeInTheDocument();
    expect(screen.getByTestId("run-7-label")).toBeInTheDocument();
    expect(screen.getByTestId("run-7-workflow")).toBeInTheDocument();
  });
});
