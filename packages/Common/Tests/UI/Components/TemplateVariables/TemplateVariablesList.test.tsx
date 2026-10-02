import "@testing-library/jest-dom";
import type { Mock } from "jest-mock";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";

/*
 * "Template variables" under a template's field: the variables, collapsed
 * until opened ("show the list of variables at the bottom, but it should be
 * collapsed"), each a card that adds itself where the cursor is.
 */

const translated: Array<string> = [];

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          if (value) {
            translated.push(value);
          }
          return value ? `[${value}]` : value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import TemplateVariablesList from "../../../../UI/Components/TemplateVariables/TemplateVariablesList";
import TemplateVariablesCopy from "../../../../UI/Components/TemplateVariables/TemplateVariablesCopy";
import {
  TemplateVariable,
  TemplateVariableGroups,
} from "../../../../Types/Template/TemplateVariable";

const GROUPS: TemplateVariableGroups = [
  {
    title: "Incident",
    variables: [
      { name: "incident.title", description: "Title" },
      { name: "incident.startedAt", description: "Declared At" },
    ],
  },
  {
    title: "Custom Fields",
    description: "Each field has a variable of its own.",
    variables: [
      {
        name: "incident.customFields.customer_impact",
        description: "Customer Impact",
        isDescriptionVerbatim: true,
      },
    ],
  },
];

afterEach(() => {
  cleanup();
  translated.length = 0;
});

function listOf(): HTMLElement {
  return screen.getByTestId("template-variables");
}

describe("the Template variables list", () => {
  test("starts collapsed, as one line that names it and counts the variables", () => {
    render(<TemplateVariablesList groups={GROUPS} />);

    const list: HTMLElement = listOf();

    expect(list.tagName).toBe("DETAILS");
    expect(list).not.toHaveAttribute("open");

    const summary: HTMLElement = list.querySelector("summary") as HTMLElement;

    expect(summary).toHaveTextContent(`[${TemplateVariablesCopy.listTitle}]`);
    expect(
      within(summary).getByTestId("template-variables-count"),
    ).toHaveTextContent("3");
  });

  test("opens when asked to", () => {
    render(<TemplateVariablesList groups={GROUPS} defaultOpen={true} />);

    expect(listOf()).toHaveAttribute("open");
  });

  test("holds every variable while collapsed, so find-in-page and tests see them", () => {
    render(<TemplateVariablesList groups={GROUPS} />);

    for (const name of [
      "{{incident.title}}",
      "{{incident.startedAt}}",
      "{{incident.customFields.customer_impact}}",
    ]) {
      expect(within(listOf()).getByText(name)).toBeInTheDocument();
    }
  });

  test("lists the groups under their titles, with a group's description", () => {
    render(<TemplateVariablesList groups={GROUPS} />);

    const groups: Array<HTMLElement> = screen.getAllByTestId(
      "template-variables-group",
    );

    expect(groups).toHaveLength(2);
    expect(within(groups[0]!).getByRole("heading")).toHaveTextContent(
      "[Incident]",
    );
    expect(within(groups[1]!).getByRole("heading")).toHaveTextContent(
      "[Custom Fields]",
    );
    expect(
      within(groups[1]!).getByTestId("template-variables-group-description"),
    ).toHaveTextContent("[Each field has a variable of its own.]");
  });

  test("each variable shows its name in braces and what it holds", () => {
    render(<TemplateVariablesList groups={GROUPS} onInsert={() => {}} />);

    const card: HTMLElement = screen
      .getAllByTestId("template-variable-insert")
      .find((element: HTMLElement): boolean => {
        return element.dataset["variableName"] === "incident.startedAt";
      })!;

    expect(within(card).getByText("{{incident.startedAt}}").tagName).toBe(
      "CODE",
    );
    expect(card).toHaveTextContent("[Declared At]");
  });

  test("looks up descriptions in the page's language, but shows a field's name as it was typed", () => {
    render(<TemplateVariablesList groups={GROUPS} />);

    expect(translated).toContain("Declared At");
    expect(translated).not.toContain("Customer Impact");
    expect(listOf()).toHaveTextContent("Customer Impact");
    expect(listOf()).not.toHaveTextContent("[Customer Impact]");
  });

  test("never looks up a variable's name, whose braces the lookup would read as its own", () => {
    render(<TemplateVariablesList groups={GROUPS} onInsert={() => {}} />);

    expect(
      translated.some((text: string): boolean => {
        return text.includes("incident.");
      }),
    ).toBe(false);
  });

  test("a long name may wrap after each dot, never inside a word", () => {
    render(<TemplateVariablesList groups={GROUPS} />);

    const code: HTMLElement = within(listOf()).getByText(
      "{{incident.customFields.customer_impact}}",
    );

    expect(code.querySelectorAll("wbr")).toHaveLength(2);
    expect(code.innerHTML).toBe(
      "{{incident.<wbr>customFields.<wbr>customer_impact}}",
    );
    expect(code).toHaveTextContent("{{incident.customFields.customer_impact}}");
  });

  test("a name with no dot is one piece", () => {
    render(
      <TemplateVariablesList
        groups={[
          { variables: [{ name: "slaStatus", description: "SLA Status" }] },
        ]}
      />,
    );

    expect(within(listOf()).getByText("{{slaStatus}}").innerHTML).toBe(
      "{{slaStatus}}",
    );
  });

  test("shows an example when the variable has one", () => {
    render(
      <TemplateVariablesList
        groups={[
          {
            variables: [
              {
                name: "sloName",
                description: "Name of the SLO.",
                example: "Checkout availability",
              },
            ],
          },
        ]}
      />,
    );

    expect(listOf()).toHaveTextContent("Checkout availability");
  });

  test("a click on a card adds that variable", () => {
    const onInsert: Mock<(variable: TemplateVariable) => void> =
      jest.fn<(variable: TemplateVariable) => void>();

    render(<TemplateVariablesList groups={GROUPS} onInsert={onInsert} />);

    const card: HTMLElement = screen
      .getAllByTestId("template-variable-insert")
      .find((element: HTMLElement): boolean => {
        return (
          element.dataset["variableName"] ===
          "incident.customFields.customer_impact"
        );
      })!;

    expect(card.tagName).toBe("BUTTON");
    expect(card).toHaveAttribute("type", "button");

    fireEvent.click(card);

    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        name: "incident.customFields.customer_impact",
      }),
    );
  });

  test("pressing a card does not take the focus from the field it adds to", () => {
    render(<TemplateVariablesList groups={GROUPS} onInsert={() => {}} />);

    const card: HTMLElement = screen.getAllByTestId(
      "template-variable-insert",
    )[0]!;
    const press: Event = createEvent.mouseDown(card);

    fireEvent(card, press);

    expect(press.defaultPrevented).toBe(true);
  });

  test("says what the variables are filled with, and how to add one", () => {
    render(
      <TemplateVariablesList
        groups={GROUPS}
        description="Filled in from the incident."
        onInsert={() => {}}
        supportsTyping={true}
      />,
    );

    expect(
      screen.getByTestId("template-variables-description"),
    ).toHaveTextContent("[Filled in from the incident.]");

    const hint: HTMLElement = screen.getByTestId("template-variables-hint");

    expect(hint).toHaveTextContent(`[${TemplateVariablesCopy.clickToInsert}]`);
    // The braces to type are drawn as a key, never looked up.
    expect(within(hint).getByText("{{").tagName).toBe("KBD");
    expect(hint).toHaveTextContent("You can also type {{ in the field");
  });

  test("only speaks of typing where the field supports it", () => {
    render(<TemplateVariablesList groups={GROUPS} onInsert={() => {}} />);

    const hint: HTMLElement = screen.getByTestId("template-variables-hint");

    expect(hint).toHaveTextContent(`[${TemplateVariablesCopy.clickToInsert}]`);
    expect(within(hint).queryByText("{{")).not.toBeInTheDocument();
  });

  test("without a field to add to, it is a list to read: no buttons, no hint", () => {
    render(<TemplateVariablesList groups={GROUPS} />);

    expect(screen.queryAllByTestId("template-variable-insert")).toHaveLength(0);
    expect(screen.getAllByTestId("template-variable")).toHaveLength(3);
    expect(screen.queryByTestId("template-variables-hint")).toBeNull();
    expect(within(listOf()).queryAllByRole("button")).toHaveLength(0);
  });

  test("a description given as an element is shown as it is", () => {
    render(
      <TemplateVariablesList
        groups={GROUPS}
        description={<span data-testid="own-description">Own words</span>}
      />,
    );

    expect(screen.getByTestId("own-description")).toHaveTextContent(
      "Own words",
    );
    expect(translated).not.toContain("Own words");
  });

  test("a group with no variables yet shows only what it says about them", () => {
    render(
      <TemplateVariablesList
        groups={[
          {
            title: "Custom Fields",
            description: "This project has no incident custom fields.",
            variables: [],
          },
        ]}
      />,
    );

    expect(screen.getByTestId("template-variables-group")).toHaveTextContent(
      "[This project has no incident custom fields.]",
    );
    expect(screen.queryByTestId("template-variables-count")).toBeNull();
    expect(screen.queryAllByRole("list")).toHaveLength(0);
  });

  test("ends with what the field adds of its own", () => {
    render(
      <TemplateVariablesList groups={GROUPS}>
        <p data-testid="extra">Who may place custom fields</p>
      </TemplateVariablesList>,
    );

    expect(within(listOf()).getByTestId("extra")).toBeInTheDocument();
  });

  test("shows no warning or alert of any kind", () => {
    render(
      <TemplateVariablesList
        groups={GROUPS}
        onInsert={() => {}}
        supportsTyping={true}
        description="Filled in."
      />,
    );

    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(listOf().querySelector(".bg-amber-50, .bg-yellow-50")).toBeNull();
  });
});
