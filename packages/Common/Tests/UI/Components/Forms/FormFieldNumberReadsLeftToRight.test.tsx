import "@testing-library/jest-dom";
import React, { ReactElement } from "react";
import { cleanup, render, RenderResult } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import Input, {
  InputType,
  NUMBER_AT_THE_PAGE_START_CLASS_NAME,
  NUMBER_READS_LEFT_TO_RIGHT_CLASS_NAME,
} from "../../../../UI/Components/Input/Input";
import { TYPED_TEXT_READS_ITS_OWN_WAY_CLASS_NAME } from "../../../../UI/Utils/TypedTextDirection";
import { JSONObject } from "../../../../Types/JSON";

/*
 * A NUMBER KEEPS ITS MINUS SIGN ON A PAGE READ RIGHT TO LEFT.
 *
 * A network site's Longitude is a number field, and Boston's is -71.0589.
 * On an Arabic or Persian page the browser laid the field's value out the
 * page's way, from the right: the minus sign is a neutral to the bidi
 * rules, so it was drawn after the digits - "71.0589-", another point than
 * the one saved - and the field's example "-89.6501" read "89.6501-".
 * There a number field now reads its number left to right (unicode-bidi:
 * plaintext, as every text field reads what is typed, and its example the
 * same way), still at the field's right, where the page's lines start and
 * where the number always sat. The field keeps the page's direction, so
 * its error icon and its spinner stay where every other field's are. On a
 * page read left to right nothing changes.
 *
 * jsdom does not lay text out: this pins the classes. A real browser
 * draws "-71.0589" at the field's right with them (Chrome and Safari; in
 * Firefox, which writes a number field's value in the page's own digits
 * with a real minus sign, the value already read right).
 */

interface TestEntity extends JSONObject {
  longitude?: string;
}

const RIGHT_TO_LEFT_LANGUAGES: Array<string> = ["ar", "fa"];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "de", "ar", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: {} },
        de: { translation: {} },
        ar: { translation: {} },
        fa: { translation: {} },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

const drawOn: (language: string, element: ReactElement) => RenderResult = (
  language: string,
  element: ReactElement,
): RenderResult => {
  return render(
    <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>,
  );
};

const inputOf: (result: RenderResult) => HTMLInputElement = (
  result: RenderResult,
): HTMLInputElement => {
  return result.container.querySelector("input") as HTMLInputElement;
};

const classesOf: (element: Element) => Array<string> = (
  element: Element,
): Array<string> => {
  return (element.getAttribute("class") || "")
    .split(" ")
    .filter((name: string): boolean => {
      return name.length > 0;
    });
};

const NUMBER_CLASSES: Array<string> = [
  ...NUMBER_READS_LEFT_TO_RIGHT_CLASS_NAME.split(" "),
  NUMBER_AT_THE_PAGE_START_CLASS_NAME,
];

const expectReadsLeftToRightAtTheRight: (input: HTMLInputElement) => void = (
  input: HTMLInputElement,
): void => {
  for (const className of NUMBER_CLASSES) {
    expect(classesOf(input)).toContain(className);
  }
};

const expectDrawnAsAlways: (input: HTMLInputElement) => void = (
  input: HTMLInputElement,
): void => {
  for (const className of NUMBER_CLASSES) {
    expect(classesOf(input)).not.toContain(className);
  }
};

type RenderFieldFunction = (
  language: string,
  overrides: Partial<Field<TestEntity>>,
  value?: string,
  error?: string,
) => RenderResult;

const renderField: RenderFieldFunction = (
  language: string,
  overrides: Partial<Field<TestEntity>>,
  value?: string,
  error?: string,
): RenderResult => {
  const field: Field<TestEntity> = {
    title: "Longitude",
    name: "longitude",
    field: { longitude: true },
    fieldType: FormFieldSchemaType.Number,
    placeholder: "-89.6501",
    required: false,
    ...overrides,
  } as Field<TestEntity>;

  return drawOn(
    language,
    <FormField<TestEntity>
      field={field}
      fieldName="longitude"
      index={0}
      isDisabled={false}
      error={error || ""}
      touched={Boolean(error)}
      currentValues={{ longitude: value || "" } as FormValues<TestEntity>}
      setFieldTouched={(): void => {}}
      setFieldValue={(): void => {}}
    />,
  );
};

describe("the classes", () => {
  test("read the number by its own characters, its example too, and put it at the right", () => {
    expect(NUMBER_READS_LEFT_TO_RIGHT_CLASS_NAME).toBe(
      `${TYPED_TEXT_READS_ITS_OWN_WAY_CLASS_NAME} placeholder:[unicode-bidi:plaintext]`,
    );
    // Written out in full: the page's left-and-right swap leaves it as the right.
    expect(NUMBER_AT_THE_PAGE_START_CLASS_NAME).toBe("[text-align:right]");
  });
});

describe.each(RIGHT_TO_LEFT_LANGUAGES)(
  "a number field on a %s page",
  (language: string) => {
    test("reads its number left to right, at the field's right", () => {
      const input: HTMLInputElement = inputOf(
        renderField(language, {}, "-71.0589"),
      );

      expect(input).toHaveAttribute("type", "number");
      expect(input).toHaveValue(-71.0589);
      expectReadsLeftToRightAtTheRight(input);
    });

    test("keeps its example as it was given, read the same way", () => {
      const input: HTMLInputElement = inputOf(renderField(language, {}));

      expect(input).toHaveAttribute("placeholder", "-89.6501");
      expect(classesOf(input)).toContain(
        "placeholder:[unicode-bidi:plaintext]",
      );
    });

    test("keeps the page's direction, so its error icon is where every field's is", () => {
      const result: RenderResult = renderField(
        language,
        {},
        "-200",
        "Longitude must be between -180 and 180.",
      );
      const input: HTMLInputElement = inputOf(result);
      const box: HTMLElement = input.parentElement as HTMLElement;

      expect(input).not.toHaveAttribute("dir");
      expect(box).not.toHaveAttribute("dir");
      expect(
        box.querySelector('[aria-hidden="true"]') as HTMLElement,
      ).toHaveClass("right-0");
      expect(classesOf(input)).toContain("pr-10");
      expectReadsLeftToRightAtTheRight(input);
    });

    test("does the same for a number that cannot be negative", () => {
      expectReadsLeftToRightAtTheRight(
        inputOf(
          renderField(language, {
            fieldType: FormFieldSchemaType.PositiveNumber,
          }),
        ),
      );
    });

    test("an Input of type number, outside a form, does the same", () => {
      expectReadsLeftToRightAtTheRight(
        inputOf(
          drawOn(
            language,
            <Input type={InputType.NUMBER} initialValue="-33.8688" />,
          ),
        ),
      );
    });

    test("a number field that says where its line sits keeps it", () => {
      const input: HTMLInputElement = inputOf(
        drawOn(
          language,
          <Input type={InputType.NUMBER} className="w-20 text-center" />,
        ),
      );

      for (const className of NUMBER_READS_LEFT_TO_RIGHT_CLASS_NAME.split(
        " ",
      )) {
        expect(classesOf(input)).toContain(className);
      }
      expect(classesOf(input)).toContain("text-center");
      expect(classesOf(input)).not.toContain(
        NUMBER_AT_THE_PAGE_START_CLASS_NAME,
      );
    });

    test("a text field, a date and a time are not numbers: none of it", () => {
      const result: RenderResult = drawOn(
        language,
        <>
          <Input placeholder="Boston Store 1216" />
          <Input type={InputType.DATE} />
          <Input type={InputType.DATETIME_LOCAL} />
          <Input type={InputType.TIME} />
        </>,
      );
      const fields: Array<HTMLInputElement> = Array.from(
        result.container.querySelectorAll("input"),
      );

      expect(fields).toHaveLength(4);

      // A text field reads what is typed its own way, lined up as it always was.
      expect(classesOf(fields[0]!)).toContain("[unicode-bidi:plaintext]");
      expect(classesOf(fields[0]!)).not.toContain(
        "placeholder:[unicode-bidi:plaintext]",
      );
      expect(classesOf(fields[0]!)).not.toContain(
        NUMBER_AT_THE_PAGE_START_CLASS_NAME,
      );

      for (const field of fields.slice(1)) {
        expect(field.className).not.toContain("unicode-bidi");
        expect(classesOf(field)).not.toContain(
          NUMBER_AT_THE_PAGE_START_CLASS_NAME,
        );
      }
    });

    test("a phone number still reads left to right in a box of its own", () => {
      const input: HTMLInputElement = inputOf(
        drawOn(language, <Input inputMode="tel" />),
      );

      expect(input).toHaveAttribute("dir", "ltr");
      expect(input.parentElement).toHaveAttribute("dir", "ltr");
      expect(classesOf(input)).not.toContain(
        NUMBER_AT_THE_PAGE_START_CLASS_NAME,
      );
    });
  },
);

describe.each(["en", "de"])(
  "a number field on a %s page",
  (language: string) => {
    test("is drawn as it always was: no dir, no class of these", () => {
      const result: RenderResult = renderField(language, {}, "-71.0589");
      const input: HTMLInputElement = inputOf(result);

      expect(input).not.toHaveAttribute("dir");
      expect(input.parentElement).not.toHaveAttribute("dir");
      expect(input.className).not.toContain("unicode-bidi");
      expectDrawnAsAlways(input);
    });

    test("its classes are exactly an English page's", () => {
      const onThisPage: string = inputOf(
        drawOn(language, <Input type={InputType.NUMBER} />),
      ).className;
      cleanup();
      const onAnArabicPage: string = inputOf(
        drawOn("ar", <Input type={InputType.NUMBER} />),
      ).className;

      expect(onAnArabicPage).toBe(
        `${onThisPage} ${NUMBER_READS_LEFT_TO_RIGHT_CLASS_NAME} ${NUMBER_AT_THE_PAGE_START_CLASS_NAME}`,
      );
    });
  },
);
