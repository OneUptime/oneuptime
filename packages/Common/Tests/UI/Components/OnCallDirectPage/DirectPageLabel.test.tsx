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

  /*
   * The label says what kind of row this is, not how the page went, so it
   * is a quiet grey. A logs table keeps its colours for the status pills,
   * and a pink label beside a red "Error" pill read as a second alarm.
   */
  test("is a quiet grey tag, with an icon before the words", () => {
    render(<DirectPageLabel />);

    const label: HTMLElement = screen.getByTestId("on-call-direct-page-label");

    expect(label).toHaveClass("bg-gray-100", "text-gray-700", "ring-gray-200");
    expect(label.querySelector("svg")).not.toBeNull();
    // On one line, however narrow its column.
    expect(label).toHaveClass("whitespace-nowrap");
  });

  test.each(["pink", "red", "rose", "amber", "yellow", "green"])(
    "carries no %s: those colours say how a run went",
    (colour: string) => {
      render(<DirectPageLabel workflowName="Escalate" />);

      expect(screen.getByTestId("on-call-direct-page").innerHTML).not.toContain(
        `-${colour}-`,
      );
    },
  );

  test("the icon sits in an element that may hold it: the label is not a span", () => {
    render(<DirectPageLabel />);

    const label: HTMLElement = screen.getByTestId("on-call-direct-page-label");

    // The icon is drawn inside a div of its own, which a span may not hold.
    expect(label.tagName).toBe("DIV");
    expect(label.querySelector("div svg")).not.toBeNull();
    expect(label.closest("span")).toBeNull();
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
      /*
       * Said here, not left to the cell: a table cell stays on one line
       * unless told otherwise, and what is inside it inherits that.
       */
      "whitespace-normal",
    );
  });

  /*
   * In a table short of room a cell that may wrap is given the least it
   * can take, which for this line would be its longest word: a name folded
   * to a word or two a line under the label. It keeps a width a sentence
   * can be read at.
   */
  test("its line keeps a readable width when the table is short of room", () => {
    render(
      <DirectPageLabel workflowName="Page whoever is on call when a critical incident is created" />,
    );

    expect(screen.getByTestId("on-call-direct-page-workflow")).toHaveClass(
      "min-w-[12rem]",
    );
  });

  test("the label itself asks for no more room than its own words", () => {
    render(<DirectPageLabel />);

    const label: HTMLElement = screen.getByTestId("on-call-direct-page-label");

    expect(label.className).not.toContain("min-w-");
    expect(screen.getByTestId("on-call-direct-page").className).not.toContain(
      "min-w-",
    );
  });

  describe("a page that can open the workflow draws its name itself", () => {
    test("the name is handed over as text, and what comes back is drawn in its place", () => {
      const seen: Array<string> = [];

      render(
        <DirectPageLabel
          workflowName="  Page on-call for critical incidents  "
          renderWorkflowName={(name: string) => {
            seen.push(name);
            return <a href="/workflows/1/builder">{name}</a>;
          }}
        />,
      );

      // Trimmed, as the name is when it is drawn as text.
      expect(seen).toEqual(["Page on-call for critical incidents"]);

      const link: HTMLElement = screen.getByRole("link", {
        name: "Page on-call for critical incidents",
      });

      expect(link).toHaveAttribute("href", "/workflows/1/builder");
      // "Workflow:" stays outside the link, around it in the sentence.
      expect(
        screen.getByTestId("on-call-direct-page-workflow"),
      ).toHaveTextContent("Workflow: Page on-call for critical incidents");
      expect(link).not.toHaveTextContent("Workflow:");
    });

    test("with no name there is nothing to draw, and it is not asked to", () => {
      let asked: number = 0;

      render(
        <DirectPageLabel
          workflowName="   "
          renderWorkflowName={(name: string) => {
            asked++;
            return <a href="/x">{name}</a>;
          }}
        />,
      );

      expect(asked).toBe(0);
      expect(screen.queryByTestId("on-call-direct-page-workflow")).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
    });
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
