import "@testing-library/jest-dom";
import React from "react";
import { cleanup, render, RenderResult } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import Input, { InputType } from "../../../../UI/Components/Input/Input";
import TextArea from "../../../../UI/Components/TextArea/TextArea";
import { TYPED_TEXT_READS_ITS_OWN_WAY_CLASS_NAME } from "../../../../UI/Utils/TypedTextDirection";
import { JSONObject } from "../../../../Types/JSON";

/*
 * A PHONE NUMBER AND A WEB ADDRESS READ LEFT TO RIGHT ON EVERY PAGE.
 *
 * A status page visitor subscribing by text message, someone signing up,
 * a user adding the number OneUptime calls: each types a phone number into
 * a Phone field. On a page read right to left (Arabic, Persian) the field's
 * placeholder came out back to front - "11234567890+" for "+11234567890" -
 * and a number typed with spaces or brackets started at the far end of the
 * field from that placeholder. A web address field did the same to its
 * example: a visitor subscribing by Slack read
 * ".../https://hooks.slack.com/services". A phone number and a web address
 * are written left to right in every language, so their fields read left
 * to right whatever the page's language: the box around them too, so the
 * error icon is at the end of the value, not over its start. A phone offers
 * its dial pad for a number. The error message under the field is a
 * sentence of the page, and keeps the page's direction.
 */

interface TestEntity extends JSONObject {
  value?: string;
}

type RenderFieldFunction = (
  overrides: Partial<Field<TestEntity>>,
  error?: string,
) => RenderResult;

const renderField: RenderFieldFunction = (
  overrides: Partial<Field<TestEntity>>,
  error?: string,
): RenderResult => {
  const field: Field<TestEntity> = {
    title: "Your Phone Number",
    name: "value",
    field: { value: true },
    required: true,
    ...overrides,
  } as Field<TestEntity>;

  return render(
    <FormField<TestEntity>
      field={field}
      fieldName="value"
      index={0}
      isDisabled={false}
      error={error || ""}
      touched={Boolean(error)}
      currentValues={{ value: "" } as FormValues<TestEntity>}
      setFieldTouched={(): void => {}}
      setFieldValue={(): void => {}}
    />,
  );
};

const inputOf: (result: RenderResult) => HTMLInputElement = (
  result: RenderResult,
): HTMLInputElement => {
  return result.container.querySelector("input") as HTMLInputElement;
};

const textAreaOf: (result: RenderResult) => HTMLTextAreaElement = (
  result: RenderResult,
): HTMLTextAreaElement => {
  return result.container.querySelector("textarea") as HTMLTextAreaElement;
};

// What the Twilio settings show in an empty list of numbers (#7180).
const LIST_EXAMPLE: string = "+14155550123, +447700900123";
const LINES_EXAMPLE: string = "+11234567890\n+11234567891\n+11234567892";

afterEach(() => {
  cleanup();
});

describe("a Phone field", () => {
  test("reads left to right, and so does the box around it", () => {
    const input: HTMLInputElement = inputOf(
      renderField({
        fieldType: FormFieldSchemaType.Phone,
        placeholder: "+11234567890",
      }),
    );

    expect(input).toHaveAttribute("dir", "ltr");
    expect(input.parentElement).toHaveAttribute("dir", "ltr");
  });

  test("asks a phone for its dial pad, and a browser for a saved number", () => {
    const input: HTMLInputElement = inputOf(
      renderField({ fieldType: FormFieldSchemaType.Phone }),
    );

    expect(input).toHaveAttribute("inputmode", "tel");
    expect(input).toHaveAttribute("autocomplete", "tel");
    // A text box still: a number input would drop the + and the spaces.
    expect(input).toHaveAttribute("type", "text");
  });

  test("keeps its placeholder as it was given", () => {
    const input: HTMLInputElement = inputOf(
      renderField({
        fieldType: FormFieldSchemaType.Phone,
        placeholder: "+11234567890",
      }),
    );

    expect(input).toHaveAttribute("placeholder", "+11234567890");
  });

  test("still lays out what is typed by its own letters, as every text field does", () => {
    const input: HTMLInputElement = inputOf(
      renderField({ fieldType: FormFieldSchemaType.Phone }),
    );

    for (const className of TYPED_TEXT_READS_ITS_OWN_WAY_CLASS_NAME.split(
      " ",
    )) {
      expect(input).toHaveClass(className);
    }
  });

  test("in error, puts its icon at the number's end and its message in the page's direction", () => {
    const result: RenderResult = renderField(
      { fieldType: FormFieldSchemaType.Phone },
      "Phone number is not valid.",
    );
    const input: HTMLInputElement = inputOf(result);
    const box: HTMLElement = input.parentElement as HTMLElement;
    const icon: HTMLElement = box.querySelector(
      '[aria-hidden="true"]',
    ) as HTMLElement;
    const message: HTMLElement = result.getByText("Phone number is not valid.");

    // The icon sits at the end of the left-to-right box, beside the last digit.
    expect(box).toHaveAttribute("dir", "ltr");
    expect(box).toContainElement(icon);
    expect(icon).toHaveClass("right-0");
    // Room for it at the end of the number.
    expect(input).toHaveClass("pr-10");
    // The message is a sentence of the page: outside the box, with no dir of its own.
    expect(box).not.toContainElement(message);
    expect(message.closest("[dir]")).toBeNull();
  });
});

describe("a URL field", () => {
  test("reads left to right, and so does the box around it", () => {
    const input: HTMLInputElement = inputOf(
      renderField({
        title: "Slack Incoming Webhook URL",
        fieldType: FormFieldSchemaType.URL,
        placeholder: "https://hooks.slack.com/services/...",
      }),
    );

    expect(input).toHaveAttribute("dir", "ltr");
    expect(input.parentElement).toHaveAttribute("dir", "ltr");
    expect(input).toHaveAttribute(
      "placeholder",
      "https://hooks.slack.com/services/...",
    );
  });

  test("is still a web address field, with no dial pad", () => {
    const input: HTMLInputElement = inputOf(
      renderField({ fieldType: FormFieldSchemaType.URL }),
    );

    expect(input).toHaveAttribute("type", "url");
    expect(input).toHaveAttribute("autocomplete", "url");
    expect(input).not.toHaveAttribute("inputmode", "tel");
  });

  test("in error, puts its icon at the address's end and its message in the page's direction", () => {
    const result: RenderResult = renderField(
      { fieldType: FormFieldSchemaType.URL },
      "URL is not valid.",
    );
    const input: HTMLInputElement = inputOf(result);
    const box: HTMLElement = input.parentElement as HTMLElement;
    const message: HTMLElement = result.getByText("URL is not valid.");

    expect(box).toHaveAttribute("dir", "ltr");
    expect(
      box.querySelector('[aria-hidden="true"]') as HTMLElement,
    ).toHaveClass("right-0");
    expect(box).not.toContainElement(message);
    expect(message.closest("[dir]")).toBeNull();
  });
});

describe("every other text field keeps the page's direction", () => {
  const otherFields: Array<FormFieldSchemaType> = [
    FormFieldSchemaType.Text,
    FormFieldSchemaType.Name,
    FormFieldSchemaType.Email,
    FormFieldSchemaType.Hostname,
    FormFieldSchemaType.Number,
    FormFieldSchemaType.Password,
  ];

  test.each(otherFields)(
    "a %s field has no dir and no dial pad",
    (fieldType: FormFieldSchemaType) => {
      const result: RenderResult = renderField({ fieldType: fieldType });
      const input: HTMLInputElement = inputOf(result);

      expect(input).not.toHaveAttribute("dir");
      expect(input.parentElement).not.toHaveAttribute("dir");
      expect(input).not.toHaveAttribute("inputmode", "tel");
    },
  );
});

/*
 * ISSUE #7180: A TEXT FIELD THAT HOLDS PHONE NUMBERS SAYS SO.
 *
 * A list of phone numbers is a Text field - typed with commas, which a dial
 * pad has none of - or, one a line, a LongText one, so it took the page's
 * direction: on a Persian or Arabic page its example
 * "+14155550123, +447700900123" drew each "+" after its digits. Such a field
 * says it reads left to right now (readsLeftToRight), and reads so on every
 * page, as a Phone field does: the field and the box around it, and so its
 * example. It keeps its keyboard - no dial pad for a list - and the message
 * under it is still a sentence of the page.
 */
describe("a Text or LongText field that says it reads left to right (#7180)", () => {
  test("a Text field: it and its box read left to right, its example as given, with no dial pad", () => {
    const input: HTMLInputElement = inputOf(
      renderField({
        title: "Twilio SMS Phone Numbers",
        fieldType: FormFieldSchemaType.Text,
        placeholder: LIST_EXAMPLE,
        readsLeftToRight: true,
      }),
    );

    expect(input).toHaveAttribute("dir", "ltr");
    expect(input.parentElement).toHaveAttribute("dir", "ltr");
    expect(input).toHaveAttribute("placeholder", LIST_EXAMPLE);
    expect(input).toHaveAttribute("type", "text");
    expect(input).not.toHaveAttribute("inputmode");
    // What is typed is still laid out by its own letters.
    for (const className of TYPED_TEXT_READS_ITS_OWN_WAY_CLASS_NAME.split(
      " ",
    )) {
      expect(input).toHaveClass(className);
    }
  });

  test("a LongText field: the text area and its box read left to right, its example as given", () => {
    const textArea: HTMLTextAreaElement = textAreaOf(
      renderField({
        title: "Phone Numbers",
        fieldType: FormFieldSchemaType.LongText,
        placeholder: LINES_EXAMPLE,
        readsLeftToRight: true,
      }),
    );

    expect(textArea).toHaveAttribute("dir", "ltr");
    expect(textArea.parentElement).toHaveAttribute("dir", "ltr");
    expect(textArea).toHaveAttribute("placeholder", LINES_EXAMPLE);
  });

  test("in error, its message under it keeps the page's direction", () => {
    const result: RenderResult = renderField(
      {
        title: "Twilio SMS Phone Numbers",
        fieldType: FormFieldSchemaType.Text,
        placeholder: LIST_EXAMPLE,
        readsLeftToRight: true,
      },
      "mobile is not a phone number.",
    );
    const box: HTMLElement = inputOf(result).parentElement as HTMLElement;
    const message: HTMLElement = result.getByText(
      "mobile is not a phone number.",
    );

    expect(box).toHaveAttribute("dir", "ltr");
    expect(box).not.toContainElement(message);
    expect(message.closest("[dir]")).toBeNull();
  });

  test("a Text or LongText field that does not say so keeps the page's direction", () => {
    const input: HTMLInputElement = inputOf(
      renderField({
        fieldType: FormFieldSchemaType.Text,
        placeholder: LIST_EXAMPLE,
      }),
    );

    expect(input).not.toHaveAttribute("dir");
    expect(input.parentElement).not.toHaveAttribute("dir");
    cleanup();

    const textArea: HTMLTextAreaElement = textAreaOf(
      renderField({
        fieldType: FormFieldSchemaType.LongText,
        placeholder: LINES_EXAMPLE,
        readsLeftToRight: false,
      }),
    );

    expect(textArea).not.toHaveAttribute("dir");
    expect(textArea.parentElement).not.toHaveAttribute("dir");
  });
});

describe("the TextArea itself", () => {
  test("reads left to right when told to, the box around it too", () => {
    const textArea: HTMLTextAreaElement = textAreaOf(
      render(<TextArea readsLeftToRight={true} placeholder={LINES_EXAMPLE} />),
    );

    expect(textArea).toHaveAttribute("dir", "ltr");
    expect(textArea.parentElement).toHaveAttribute("dir", "ltr");
  });

  test("keeps the page's direction otherwise", () => {
    const textArea: HTMLTextAreaElement = textAreaOf(
      render(<TextArea placeholder="What happened?" />),
    );

    expect(textArea).not.toHaveAttribute("dir");
    expect(textArea.parentElement).not.toHaveAttribute("dir");
  });
});

describe("the Input itself", () => {
  test("reads left to right when told to, with the keyboard it asks for (#7180)", () => {
    const input: HTMLInputElement = inputOf(
      render(
        <Input
          type={InputType.TEXT}
          readsLeftToRight={true}
          placeholder={LIST_EXAMPLE}
        />,
      ),
    );

    expect(input).toHaveAttribute("dir", "ltr");
    expect(input.parentElement).toHaveAttribute("dir", "ltr");
    expect(input).not.toHaveAttribute("inputmode");
  });

  test("told it does not, it keeps the page's direction", () => {
    const input: HTMLInputElement = inputOf(
      render(<Input type={InputType.TEXT} readsLeftToRight={false} />),
    );

    expect(input).not.toHaveAttribute("dir");
    expect(input.parentElement).not.toHaveAttribute("dir");
  });

  test("reads left to right for a phone number (inputMode tel)", () => {
    const result: RenderResult = render(
      <Input inputMode="tel" placeholder="+966 50 123 4567" />,
    );
    const input: HTMLInputElement = inputOf(result);

    expect(input).toHaveAttribute("dir", "ltr");
    expect(input.parentElement).toHaveAttribute("dir", "ltr");
  });

  test("reads left to right for a web address (type url, or inputMode url)", () => {
    const typed: HTMLInputElement = inputOf(
      render(<Input type={InputType.URL} placeholder="https://example.com/" />),
    );

    expect(typed).toHaveAttribute("dir", "ltr");
    expect(typed.parentElement).toHaveAttribute("dir", "ltr");
    cleanup();

    const asked: HTMLInputElement = inputOf(render(<Input inputMode="url" />));

    expect(asked).toHaveAttribute("dir", "ltr");
    expect(asked.parentElement).toHaveAttribute("dir", "ltr");
  });

  test("keeps the page's direction for any other keyboard", () => {
    for (const inputMode of [
      "numeric",
      "decimal",
      "email",
      "search",
    ] as const) {
      const result: RenderResult = render(<Input inputMode={inputMode} />);
      const input: HTMLInputElement = inputOf(result);

      expect([inputMode, input.getAttribute("dir")]).toEqual([inputMode, null]);
      expect([inputMode, input.parentElement?.getAttribute("dir")]).toEqual([
        inputMode,
        null,
      ]);
      cleanup();
    }
  });

  test("keeps the page's direction with no keyboard asked for", () => {
    const input: HTMLInputElement = inputOf(
      render(<Input type={InputType.TEXT} placeholder="Name" />),
    );

    expect(input).not.toHaveAttribute("dir");
    expect(input.parentElement).not.toHaveAttribute("dir");
  });
});
