import DeleteConfirmationMessage, {
  DeleteConfirmationTextOptions,
  DELETE_IRREVERSIBLE_SENTENCE,
  DELETE_QUESTION_TEMPLATE,
  DELETE_STATEMENT_TEMPLATE,
  getDeleteConfirmationText,
  getUnnamedDeleteSentence,
} from "../../../../UI/Components/DeleteConfirmation/DeleteConfirmationMessage";
import DeleteItemNames, {
  DELETE_MORE_ITEMS_TEMPLATE,
} from "../../../../UI/Components/DeleteConfirmation/DeleteItemNames";
import NamedSentence from "../../../../UI/Components/DeleteConfirmation/NamedSentence";
import TypeToConfirmDelete, {
  TYPE_TO_CONFIRM_TEMPLATE,
  isTypedNameConfirmed,
} from "../../../../UI/Components/DeleteConfirmation/TypeToConfirmDelete";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "@jest/globals";
import React, { ReactElement, useState } from "react";

/*
 * The pieces every delete confirmation is drawn with. The maintainer's
 * request: "show the name of the resource in delete modal so we're sure which
 * resource we're deleting" - so the sentence names it, in bold, and only falls
 * back to the old "this workflow" when the record has no name at all.
 */

type TextOfFunction = (testId: string) => string;

const textOf: TextOfFunction = (testId: string): string => {
  return screen.getByTestId(testId).textContent || "";
};

describe("DeleteConfirmationMessage", () => {
  test("asks about the record by name, in bold, and says it cannot be undone", () => {
    render(
      <DeleteConfirmationMessage
        name="Notify on-call"
        typeLabel="workflow"
        kind="question"
      />,
    );

    expect(textOf("delete-confirmation-message")).toBe(
      "Are you sure you want to delete Notify on-call? This action cannot be undone.",
    );

    const name: HTMLElement = screen.getByTestId("delete-confirmation-name");

    expect(name.tagName).toBe("STRONG");
    expect(name).toHaveTextContent(/^Notify on-call$/);
    expect(name).toHaveClass("font-semibold");
  });

  test("asks by default", () => {
    render(
      <DeleteConfirmationMessage name="Checkout API" typeLabel="monitor" />,
    );

    expect(textOf("delete-confirmation-message")).toBe(
      "Are you sure you want to delete Checkout API? This action cannot be undone.",
    );
  });

  test("states it on the card the Delete button sits on", () => {
    render(
      <DeleteConfirmationMessage
        name="Notify on-call"
        typeLabel="workflow"
        kind="statement"
      />,
    );

    expect(textOf("delete-confirmation-message")).toBe(
      "Permanently delete Notify on-call. This action cannot be undone.",
    );
  });

  test("asks about its kind when the record has no name", () => {
    render(<DeleteConfirmationMessage name="" typeLabel="Team Member" />);

    expect(textOf("delete-confirmation-message")).toBe(
      "Are you sure you want to delete this team member? This action cannot be undone.",
    );
    expect(screen.queryByTestId("delete-confirmation-name")).toBeNull();
  });

  test("treats a blank name as no name", () => {
    render(<DeleteConfirmationMessage name="   " typeLabel="monitor" />);

    expect(textOf("delete-confirmation-message")).toBe(
      "Are you sure you want to delete this monitor? This action cannot be undone.",
    );
  });

  test('calls a record of no kind an "item"', () => {
    render(<DeleteConfirmationMessage name="" typeLabel=" " />);

    expect(textOf("delete-confirmation-message")).toBe(
      "Are you sure you want to delete this item? This action cannot be undone.",
    );
  });

  /*
   * The card has its kind in its title already, and a sentence composed from
   * an English model name would be the one line on it left untranslated.
   */
  test("an unnamed card says only that it cannot be undone", () => {
    render(
      <DeleteConfirmationMessage
        name=""
        typeLabel="workflow"
        kind="statement"
      />,
    );

    expect(textOf("delete-confirmation-message")).toBe(
      "This action cannot be undone.",
    );
  });

  test("can leave out the sentence about undoing", () => {
    render(
      <DeleteConfirmationMessage
        name="Checkout API"
        typeLabel="monitor"
        isIrreversible={false}
      />,
    );

    expect(textOf("delete-confirmation-message")).toBe(
      "Are you sure you want to delete Checkout API?",
    );
  });

  test("ends with the caller's warning", () => {
    render(
      <DeleteConfirmationMessage
        name="orders"
        typeLabel="queue"
        warning="  Discovered queues come back.  "
      />,
    );

    expect(textOf("delete-confirmation-message")).toBe(
      "Are you sure you want to delete orders? This action cannot be undone. Discovered queues come back.",
    );
  });

  test("shows the full name on hover when it was shortened", () => {
    render(
      <DeleteConfirmationMessage
        name="Payments API in eu-west…"
        fullName="Payments API in eu-west-1, the primary region"
        typeLabel="monitor"
      />,
    );

    expect(screen.getByTestId("delete-confirmation-name")).toHaveAttribute(
      "title",
      "Payments API in eu-west-1, the primary region",
    );
  });

  test("has no hover text when the name is whole", () => {
    render(
      <DeleteConfirmationMessage
        name="Checkout API"
        fullName="Checkout API"
        typeLabel="monitor"
      />,
    );

    expect(screen.getByTestId("delete-confirmation-name")).not.toHaveAttribute(
      "title",
    );
  });

  /*
   * A name is whatever a user typed. It is drawn as text: markup in it stays
   * markup, and braces are not mistaken for a placeholder.
   */
  test("draws a name with markup in it as text", () => {
    const { container } = render(
      <DeleteConfirmationMessage
        name={'<img src="x" onerror="alert(1)"> & {{name}}'}
        typeLabel="monitor"
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("delete-confirmation-name")).toHaveTextContent(
      '<img src="x" onerror="alert(1)"> & {{name}}',
    );
  });

  test("uses its own test id when given one", () => {
    render(
      <DeleteConfirmationMessage
        name="Checkout API"
        typeLabel="monitor"
        dataTestId="custom-id"
      />,
    );

    expect(screen.getByTestId("custom-id")).toBeInTheDocument();
  });
});

describe("getDeleteConfirmationText", () => {
  test.each([
    [
      { name: "Notify on-call", typeLabel: "workflow" },
      "Are you sure you want to delete Notify on-call? This action cannot be undone.",
    ],
    [
      {
        name: "Notify on-call",
        typeLabel: "workflow",
        kind: "statement" as const,
      },
      "Permanently delete Notify on-call. This action cannot be undone.",
    ],
    [
      { name: "", typeLabel: "Incident Form" },
      "Are you sure you want to delete this incident form? This action cannot be undone.",
    ],
    [
      { name: "", typeLabel: "workflow", kind: "statement" as const },
      "This action cannot be undone.",
    ],
    [
      { name: "x", typeLabel: "y", isIrreversible: false, warning: "Careful." },
      "Are you sure you want to delete x? Careful.",
    ],
  ])(
    "says the same as the rendered message for %j",
    (options: DeleteConfirmationTextOptions, text: string) => {
      expect(getDeleteConfirmationText(options)).toBe(text);

      render(<DeleteConfirmationMessage {...options} />);

      expect(textOf("delete-confirmation-message")).toBe(text);
    },
  );
});

describe("the sentences", () => {
  test("are whole sentences with one name slot, ready to translate", () => {
    for (const template of [
      DELETE_QUESTION_TEMPLATE,
      DELETE_STATEMENT_TEMPLATE,
      TYPE_TO_CONFIRM_TEMPLATE,
    ]) {
      expect(template.match(/\{\{name\}\}/g)).toHaveLength(1);
      expect(template).toMatch(/[.?]$/);
    }

    expect(DELETE_MORE_ITEMS_TEMPLATE).toContain("{{remaining}}");
    expect(DELETE_IRREVERSIBLE_SENTENCE).toBe("This action cannot be undone.");
  });

  // The old shape, so the translations that exist for it still apply.
  test("keep the old question for a record with no name", () => {
    expect(
      getUnnamedDeleteSentence({
        typeLabel: "Incident Form",
        kind: "question",
      }),
    ).toBe("Are you sure you want to delete this incident form?");
    expect(
      getUnnamedDeleteSentence({
        typeLabel: "Incident Form",
        kind: "statement",
      }),
    ).toBe("");
  });
});

describe("NamedSentence", () => {
  test("fills the slot it is told to with the name, in bold", () => {
    render(
      <p data-testid="sentence">
        <NamedSentence
          template="Are you sure you want to delete your account ({{email}})?"
          slot="email"
          name="jane@example.com"
        />
      </p>,
    );

    expect(textOf("sentence")).toBe(
      "Are you sure you want to delete your account (jane@example.com)?",
    );
    expect(screen.getByTestId("delete-confirmation-name").tagName).toBe(
      "STRONG",
    );
  });

  test("fills other placeholders around it", () => {
    render(
      <p data-testid="sentence">
        <NamedSentence
          template="Remove {{name}} from {{place}}?"
          name="P1 response"
          values={{ place: "this incident" }}
          dataTestId="rule-name"
        />
      </p>,
    );

    expect(textOf("sentence")).toBe("Remove P1 response from this incident?");
    expect(screen.getByTestId("rule-name")).toHaveTextContent("P1 response");
  });

  // Safe inside a card's <p>: nothing block-level.
  test("draws no block element", () => {
    const { container } = render(
      <p>
        <NamedSentence template={DELETE_QUESTION_TEMPLATE} name="x" />
      </p>,
    );

    expect(container.querySelector("p div")).toBeNull();
  });
});

describe("DeleteItemNames", () => {
  test("lists every name when there are few", () => {
    render(
      <DeleteItemNames
        names={["Checkout API", "Billing Worker"]}
        totalCount={2}
      />,
    );

    expect(
      screen
        .getAllByTestId("delete-confirmation-item")
        .map((item: HTMLElement) => {
          return item.textContent;
        }),
    ).toEqual(["Checkout API", "Billing Worker"]);
    expect(screen.queryByTestId("delete-confirmation-more-items")).toBeNull();
  });

  test("names the first five and counts the rest", () => {
    const names: Array<string> = Array.from(
      { length: 12 },
      (_value: unknown, index: number) => {
        return `Monitor ${index + 1}`;
      },
    );

    render(<DeleteItemNames names={names} totalCount={12} />);

    expect(screen.getAllByTestId("delete-confirmation-item")).toHaveLength(5);
    expect(
      screen.getByTestId("delete-confirmation-more-items"),
    ).toHaveTextContent("and 7 more");
  });

  test("counts records without a name as more", () => {
    render(<DeleteItemNames names={["Checkout API", "", ""]} totalCount={3} />);

    expect(screen.getAllByTestId("delete-confirmation-item")).toHaveLength(1);
    expect(
      screen.getByTestId("delete-confirmation-more-items"),
    ).toHaveTextContent("and 2 more");
  });

  test("writes a large count with separators", () => {
    const names: Array<string> = Array.from(
      { length: 10 },
      (_value: unknown, index: number) => {
        return `Row ${index}`;
      },
    );

    render(<DeleteItemNames names={names} totalCount={10000} />);

    expect(
      screen.getByTestId("delete-confirmation-more-items"),
    ).toHaveTextContent(`and ${(9995).toLocaleString()} more`);
  });

  test("draws nothing when nothing has a name", () => {
    const { container } = render(
      <DeleteItemNames names={["", " "]} totalCount={2} />,
    );

    expect(container.innerHTML).toBe("");
  });

  test("honours a smaller limit", () => {
    render(
      <DeleteItemNames
        names={["A", "B", "C", "D"]}
        totalCount={4}
        maxShown={2}
      />,
    );

    expect(screen.getAllByTestId("delete-confirmation-item")).toHaveLength(2);
    expect(
      screen.getByTestId("delete-confirmation-more-items"),
    ).toHaveTextContent("and 2 more");
  });

  test("draws a name with markup in it as text", () => {
    const { container } = render(
      <DeleteItemNames names={["<script>x()</script>"]} totalCount={1} />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByTestId("delete-confirmation-item")).toHaveTextContent(
      "<script>x()</script>",
    );
  });
});

describe("isTypedNameConfirmed", () => {
  test.each([
    ["the name", "Acme Production", "Acme Production", true],
    [
      "the name with stray spaces round it",
      "  Acme Production ",
      "Acme Production",
      true,
    ],
    ["a different case", "acme production", "Acme Production", false],
    ["part of the name", "Acme", "Acme Production", false],
    ["more than the name", "Acme Production 2", "Acme Production", false],
    ["nothing", "", "Acme Production", false],
    ["anything, for a blank name", "", "  ", false],
  ])(
    "%s",
    (_label: string, typed: string, name: string, confirmed: boolean) => {
      expect(isTypedNameConfirmed({ typed: typed, name: name })).toBe(
        confirmed,
      );
    },
  );
});

describe("TypeToConfirmDelete", () => {
  interface HarnessProps {
    name: string;
    onConfirm: () => void;
  }

  const Harness: (props: HarnessProps) => ReactElement = (
    props: HarnessProps,
  ): ReactElement => {
    const [value, setValue] = useState<string>("");

    return (
      <TypeToConfirmDelete
        name={props.name}
        value={value}
        onChange={setValue}
        onConfirm={props.onConfirm}
      />
    );
  };

  test("asks for the name, shown in bold, with a box labelled by it", () => {
    render(<Harness name="Acme Production" onConfirm={(): void => {}} />);

    expect(textOf("delete-confirmation-type-to-confirm")).toContain(
      "Type Acme Production to confirm.",
    );
    expect(
      screen.getByTestId("delete-confirmation-type-to-confirm-name"),
    ).toHaveTextContent(/^Acme Production$/);

    const input: HTMLElement = screen.getByLabelText(
      "Type Acme Production to confirm.",
    );

    expect(input).toBe(
      screen.getByTestId("delete-confirmation-type-to-confirm-input"),
    );
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
  });

  test("Enter confirms once the name matches, and not before", () => {
    const onConfirm: MockFunction = getJestMockFunction();

    render(<Harness name="Acme Production" onConfirm={onConfirm} />);

    const input: HTMLElement = screen.getByTestId(
      "delete-confirmation-type-to-confirm-input",
    );

    fireEvent.change(input, { target: { value: "Acme" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Acme Production" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("ignores keys other than Enter", () => {
    const onConfirm: MockFunction = getJestMockFunction();

    render(<Harness name="Acme" onConfirm={onConfirm} />);

    const input: HTMLElement = screen.getByTestId(
      "delete-confirmation-type-to-confirm-input",
    );

    fireEvent.change(input, { target: { value: "Acme" } });
    fireEvent.keyDown(input, { key: "a" });

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
