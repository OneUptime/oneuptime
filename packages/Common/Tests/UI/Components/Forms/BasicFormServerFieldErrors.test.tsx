import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import { getAdvancedFormSection } from "../../../../UI/Components/Forms/Utils/AdvancedFormSection";
import getJestMockFunction from "../../../MockType";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * AN ANSWER FROM THE SERVER THAT IS ABOUT ONE FIELD, SAID UNDER THAT FIELD.
 *
 * The maintainer's follow-ups: "a server-refused promo code stays folded
 * under More fields". A form shows the server's refusal above itself
 * (props.error); when a field says the answer is about it
 * (Field.ownsServerError) the form shows it under that field instead: the
 * folded section the field is in opens, the form moves to the field's step,
 * and the field is brought into view. Changing the field puts the message
 * away; an answer no field owns stays above the form.
 */

const PROMO_ERROR: string = "Promo code is invalid.";
const NAME_ERROR: string = "Project with the same name already exists";
const OTHER_ERROR: string = "Server error. Please try again.";

const isPromoError: (message: string) => boolean = (
  message: string,
): boolean => {
  return message.toLowerCase().indexOf("promo code") !== -1;
};

const FIELDS: Fields<FormValues<any>> = [
  {
    field: { name: true },
    title: "Project Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    dataTestId: "name",
    ownsServerError: (message: string): boolean => {
      return message.indexOf("same name") !== -1;
    },
  },
  {
    field: { promoCode: true },
    title: "Promo Code",
    fieldType: FormFieldSchemaType.Text,
    required: false,
    dataTestId: "promo",
    collapsibleSection: getAdvancedFormSection<FormValues<any>>(),
    ownsServerError: isPromoError,
  },
];

let scrolled: Array<Element> = [];
const originalScrollIntoView: unknown = Element.prototype.scrollIntoView;

beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element): void {
    scrolled.push(this);
  };
});

afterEach(() => {
  Element.prototype.scrollIntoView =
    originalScrollIntoView as typeof Element.prototype.scrollIntoView;
  cleanup();
});

function TheForm(props: {
  error: string;
  fields?: Fields<FormValues<any>>;
  steps?: Array<FormStep<FormValues<any>>>;
}): React.ReactElement {
  return (
    <BasicForm
      id="server-field-errors"
      fields={props.fields || FIELDS}
      steps={props.steps}
      initialValues={{ name: "Acme", promoCode: "OLD10" }}
      onSubmit={getJestMockFunction()}
      submitButtonText="Create Project"
      error={props.error}
    />
  );
}

function moreFieldsHeader(): HTMLElement {
  return screen.getByTestId("folded-section-header");
}

describe("an answer about a folded field", () => {
  test("opens the fold and says it under the field, not above the form", async () => {
    const { rerender } = render(<TheForm error="" />);
    await screen.findByTestId("name");
    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "false");

    rerender(<TheForm error={PROMO_ERROR} />);

    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("promo")).toBeVisible();
    expect(screen.getByTestId("promo")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("promo")).toHaveAccessibleDescription(
      PROMO_ERROR,
    );
    // Once: not again in the alert above the form.
    expect(screen.getAllByText(PROMO_ERROR)).toHaveLength(1);
    expect(
      screen.getByText(PROMO_ERROR).closest("[data-testid='folded-section']"),
    ).not.toBeNull();
  });

  test("brings the field into view as the fold opens", async () => {
    const { rerender } = render(<TheForm error="" />);
    await screen.findByTestId("name");

    rerender(<TheForm error={PROMO_ERROR} />);

    const promo: HTMLElement = screen.getByTestId("promo");
    const brought: Element | undefined = scrolled.find((element: Element) => {
      return element.contains(promo);
    });

    expect(brought).toBeDefined();
    // The field's own box, not the whole form.
    expect(brought!.contains(screen.getByTestId("name"))).toBe(false);
  });

  test("puts the focus in the field, where the code is changed or cleared", async () => {
    const { rerender } = render(<TheForm error="" />);
    await screen.findByTestId("name");
    screen.getByRole("button", { name: "Create Project" }).focus();

    rerender(<TheForm error={PROMO_ERROR} />);

    expect(screen.getByTestId("promo")).toHaveFocus();
  });

  test("changing the field moves nothing, though another field says what is wrong with it", async () => {
    const { rerender } = render(<TheForm error="" />);
    await screen.findByTestId("name");

    // The form was sent (a press), and the server refused the code.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    });
    rerender(<TheForm error={PROMO_ERROR} />);

    // The reader empties the name, which says so once left ...
    await act(async () => {
      fireEvent.change(screen.getByTestId("name"), { target: { value: "" } });
    });
    await act(async () => {
      fireEvent.blur(screen.getByTestId("name"));
    });
    expect(screen.getByText("Project Name is required.")).toBeVisible();

    // ... then types a new code: the page stays put, the focus in the code.
    screen.getByTestId("promo").focus();
    scrolled = [];

    await act(async () => {
      fireEvent.change(screen.getByTestId("promo"), {
        target: { value: "N" },
      });
    });

    expect(screen.queryByText(PROMO_ERROR)).toBeNull();
    expect(scrolled).toEqual([]);
    expect(screen.getByTestId("promo")).toHaveFocus();
  });

  test("changing the field puts the message away", async () => {
    const { rerender } = render(<TheForm error="" />);
    await screen.findByTestId("name");
    rerender(<TheForm error={PROMO_ERROR} />);

    await act(async () => {
      fireEvent.change(screen.getByTestId("promo"), {
        target: { value: "NEW20" },
      });
    });

    expect(screen.queryByText(PROMO_ERROR)).toBeNull();
    expect(screen.getByTestId("promo")).not.toHaveAttribute("aria-invalid");
  });

  test("the same answer again, after the form was sent again, is said again", async () => {
    const { rerender } = render(<TheForm error="" />);
    await screen.findByTestId("name");
    rerender(<TheForm error={PROMO_ERROR} />);

    await act(async () => {
      fireEvent.change(screen.getByTestId("promo"), {
        target: { value: "NEW20" },
      });
    });
    expect(screen.queryByText(PROMO_ERROR)).toBeNull();

    // A form clears its error as it sends, and gets the answer back.
    rerender(<TheForm error="" />);
    rerender(<TheForm error={PROMO_ERROR} />);

    expect(screen.getByText(PROMO_ERROR)).toBeVisible();
  });
});

describe("an answer about a field in sight", () => {
  test("is said under the name, and the fold stays shut", async () => {
    const { rerender } = render(<TheForm error="" />);
    await screen.findByTestId("name");

    rerender(<TheForm error={NAME_ERROR} />);

    expect(screen.getByTestId("name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByText(NAME_ERROR)).toHaveLength(1);
    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "false");
  });
});

describe("an answer no field owns", () => {
  test("stays above the form, and no field is marked", async () => {
    const { rerender } = render(<TheForm error="" />);
    await screen.findByTestId("name");

    rerender(<TheForm error={OTHER_ERROR} />);

    expect(screen.getByText(OTHER_ERROR)).toBeVisible();
    expect(screen.getByTestId("name")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByTestId("promo")).not.toHaveAttribute("aria-invalid");
    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "false");
  });

  test("a field hidden by its showIf does not take the answer", async () => {
    const fields: Fields<FormValues<any>> = [
      FIELDS[0]!,
      {
        ...FIELDS[1]!,
        collapsibleSection: undefined,
        showIf: (): boolean => {
          return false;
        },
      },
    ];
    const { rerender } = render(<TheForm error="" fields={fields} />);
    await screen.findByTestId("name");

    rerender(<TheForm error={PROMO_ERROR} fields={fields} />);

    // Above the form, where it can be read.
    expect(screen.getByText(PROMO_ERROR)).toBeVisible();
    expect(screen.queryByTestId("promo")).toBeNull();
  });
});

describe("an answer about a field on another step", () => {
  test("moves the form to that step and says it under the field", async () => {
    const steps: Array<FormStep<FormValues<any>>> = [
      { title: "Project", id: "project" },
      { title: "Billing", id: "billing" },
    ];
    const fields: Fields<FormValues<any>> = [
      { ...FIELDS[0]!, stepId: "project" },
      { ...FIELDS[1]!, stepId: "billing", collapsibleSection: undefined },
    ];
    const { rerender } = render(
      <TheForm error="" fields={fields} steps={steps} />,
    );
    await screen.findByTestId("name");
    expect(screen.queryByTestId("promo")).toBeNull();

    rerender(<TheForm error={PROMO_ERROR} fields={fields} steps={steps} />);

    expect(await screen.findByTestId("promo")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByText(PROMO_ERROR)).toBeVisible();
    // Brought into view and focused once the form is on that step.
    expect(
      scrolled.some((element: Element) => {
        return element.contains(screen.getByTestId("promo"));
      }),
    ).toBe(true);
    expect(screen.getByTestId("promo")).toHaveFocus();
  });
});
