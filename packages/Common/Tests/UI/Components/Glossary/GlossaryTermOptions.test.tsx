import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import { DOCS_URL } from "../../../../UI/Config";
import GlossaryTerm from "../../../../Types/Docs/GlossaryTerm";
import Card from "../../../../UI/Components/Card/Card";
import FieldLabelElement from "../../../../UI/Components/Forms/Fields/FieldLabel";
import { DEFINED_TERM_TEST_ID } from "../../../../UI/Components/Glossary/DefinedTerm";
import IconDropdownRow, {
  ICON_DROPDOWN_ROW_SEPARATED_CLASS_NAME,
} from "../../../../UI/Components/Header/IconDropdown/IconDropdownRow";
import LearnMoreLink, {
  LEARN_MORE_LINK_TEST_ID,
  LEARN_MORE_TEXT,
  getLearnMoreUrl,
} from "../../../../UI/Components/Link/LearnMoreLink";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";

/*
 * The ways a page puts a definition on a word without code of its own
 * (#6819): a form field's `glossaryTerm` ("Criteria (?)" on a form), a
 * card's `titleGlossaryTerm`, and "Learn more" from a hard form to the docs
 * page that explains it. A word is marked only where a page asks for it.
 */

let language: string = "en";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          if (language === "de" && key === "Learn more") {
            return "Mehr erfahren";
          }
          return (
            (options as { defaultValue?: string } | undefined)?.defaultValue ??
            key
          );
        },
        i18n: { resolvedLanguage: language, language: language },
      };
    },
  };
});

const DOCS: string = DOCS_URL.toString();

afterEach(() => {
  cleanup();
  language = "en";
});

describe("a form field's glossaryTerm", () => {
  test("draws the field's title as a defined term, inside its label", () => {
    render(
      <>
        <FieldLabelElement
          title="Criteria"
          htmlFor="criteria-input"
          glossaryTerm={GlossaryTerm.Criteria}
          required={true}
        />
        <input id="criteria-input" />
      </>,
    );

    const word: HTMLElement = screen.getByTestId(DEFINED_TERM_TEST_ID);

    expect(word).toHaveTextContent("Criteria");
    expect(word).toHaveAttribute("data-glossary-term", "criteria");
    expect(word.closest("label")).not.toBeNull();
    /*
     * The field is still named by its title, word for word, as the
     * accessible name is computed (a button's words count in its label's).
     */
    expect(screen.getByRole("textbox", { name: "Criteria" })).toHaveAttribute(
      "id",
      "criteria-input",
    );
  });

  test("pressing the word does not move into the field or tick its box", () => {
    const onChange: Mock = jest.fn();

    render(
      <>
        <FieldLabelElement
          title="Probes"
          htmlFor="probes-box"
          glossaryTerm={GlossaryTerm.Probe}
        />
        <input id="probes-box" type="checkbox" onChange={onChange} />
      </>,
    );

    fireEvent.click(screen.getByTestId(DEFINED_TERM_TEST_ID));

    expect(onChange).not.toHaveBeenCalled();
    /*
     * The box itself, by its role and its name. A lookup by label text skips
     * a button's words, so it never found the box: it found the definition,
     * open now and named by the word, which is never ticked.
     */
    expect(screen.getByRole("checkbox", { name: /Probes/ })).not.toBeChecked();
  });

  test("leaves a title without one as plain words", () => {
    render(<FieldLabelElement title="Name" />);

    expect(screen.queryByTestId(DEFINED_TERM_TEST_ID)).toBeNull();
    expect(screen.getByText("Name")).toBeInTheDocument();
  });

  test("keeps the optional mark outside the word", () => {
    render(
      <FieldLabelElement title="Labels" glossaryTerm={GlossaryTerm.Label} />,
    );

    expect(screen.getByTestId(DEFINED_TERM_TEST_ID).textContent).toBe("Labels");
    expect(screen.getByText("(Optional)")).toBeInTheDocument();
  });

  test("a form says it with the field's option alone", () => {
    render(
      <BasicForm
        id="glossary-form"
        name="Glossary form"
        initialValues={{ name: "" }}
        fields={[
          {
            field: { name: true },
            title: "Probes",
            glossaryTerm: GlossaryTerm.Probe,
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.Text,
            required: false,
          },
        ]}
        onSubmit={() => {
          return undefined;
        }}
      />,
    );

    const words: Array<HTMLElement> =
      screen.getAllByTestId(DEFINED_TERM_TEST_ID);

    expect(words).toHaveLength(1);
    expect(words[0]).toHaveTextContent("Probes");
    expect(words[0]).toHaveAttribute("data-glossary-term", "probe");
  });
});

describe("a card's titleGlossaryTerm", () => {
  test("draws a title of words as a defined term, in the card's heading", () => {
    render(
      <Card
        title="Escalation Rules"
        titleGlossaryTerm={GlossaryTerm.EscalationRule}
      >
        <p>Body</p>
      </Card>,
    );

    const heading: HTMLElement = screen.getByTestId("card-details-heading");
    const word: HTMLElement = within(heading).getByTestId(DEFINED_TERM_TEST_ID);

    expect(word).toHaveTextContent("Escalation Rules");
    expect(word).toHaveAttribute("data-glossary-term", "escalation-rule");
  });

  test("leaves a title drawn as more than words to whoever drew it", () => {
    render(
      <Card
        title={<span data-testid="custom-title">Rules and a badge</span>}
        titleGlossaryTerm={GlossaryTerm.Rule}
      >
        <p>Body</p>
      </Card>,
    );

    expect(screen.getByTestId("custom-title")).toBeInTheDocument();
    expect(screen.queryByTestId(DEFINED_TERM_TEST_ID)).toBeNull();
  });

  test("marks nothing on a card that does not ask", () => {
    render(
      <Card title="Escalation Rules">
        <p>Body</p>
      </Card>,
    );

    expect(screen.queryByTestId(DEFINED_TERM_TEST_ID)).toBeNull();
  });
});

describe("Learn more", () => {
  test("opens the docs page in a new tab, on this instance's docs", () => {
    render(<LearnMoreLink docsPath="/docs/on-call/escalation-rules" />);

    const link: HTMLElement = screen.getByTestId(LEARN_MORE_LINK_TEST_ID);

    expect(link).toHaveTextContent(LEARN_MORE_TEXT);
    expect(link).toHaveAttribute("href", `${DOCS}/en/on-call/escalation-rules`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("opens it in the reader's language, at the heading it names", () => {
    language = "de";
    render(
      <LearnMoreLink
        docsPath="/docs/on-call/schedules#layers"
        dataTestId="layers-learn-more"
      />,
    );

    const link: HTMLElement = screen.getByTestId("layers-learn-more");

    expect(link).toHaveTextContent("Mehr erfahren");
    expect(link).toHaveAttribute("href", `${DOCS}/de/on-call/schedules#layers`);
  });

  test("a language the docs are not written in opens the English page", () => {
    expect(getLearnMoreUrl("/docs/monitor/criteria-and-statuses", "ar")).toBe(
      `${DOCS}/en/monitor/criteria-and-statuses`,
    );
    expect(getLearnMoreUrl("/docs/monitor/criteria-and-statuses")).toBe(
      `${DOCS}/en/monitor/criteria-and-statuses`,
    );
  });
});

describe("a menu's groups", () => {
  test("a group after another is set apart by a line", () => {
    render(
      <>
        <IconDropdownRow dataTestId="first">
          <span>One</span>
        </IconDropdownRow>
        <IconDropdownRow dataTestId="second" isSeparated={true}>
          <span>Two</span>
        </IconDropdownRow>
      </>,
    );

    expect(screen.getByTestId("first").className).toBe("");
    expect(screen.getByTestId("second").className).toBe(
      ICON_DROPDOWN_ROW_SEPARATED_CLASS_NAME,
    );
    expect(ICON_DROPDOWN_ROW_SEPARATED_CLASS_NAME).toContain("border-t");
  });
});
