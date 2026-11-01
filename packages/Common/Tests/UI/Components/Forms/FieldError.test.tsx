import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import FieldError, {
  FIELD_ERROR_CLASS_NAME,
  FIELD_ERROR_TEST_ID,
} from "../../../../UI/Components/Forms/Fields/FieldError";
import Input from "../../../../UI/Components/Input/Input";
import TextArea from "../../../../UI/Components/TextArea/TextArea";
import Toggle from "../../../../UI/Components/Toggle/Toggle";
import MarkdownEditor from "../../../../UI/Components/Markdown.tsx/MarkdownEditor";
import CardSelect from "../../../../UI/Components/CardSelect/CardSelect";
import PermissionPicker from "../../../../UI/Components/Forms/Fields/PermissionPicker";
import IconProp from "../../../../Types/Icon/IconProp";

/*
 * Every field draws what is wrong with it with FieldError: red, under the
 * field, said to a screen reader, and read the way it is written. A check
 * the product makes is in the reader's language; an answer from the server
 * is English - "Promo code is invalid." - and on a Persian page its full
 * stop came first (".Promo code is invalid"). A message that reads the other
 * way from the page is drawn in an isolate of its own, so it keeps its full
 * stop at its end and still starts under the field. A message in the page's
 * own words is drawn exactly as it always was.
 */

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: {} },
        fa: {
          translation: { "Description is required": "توضیحات الزامی است" },
        },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

const draw: (language: string, element: ReactElement) => void = (
  language: string,
  element: ReactElement,
): void => {
  render(
    <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>,
  );
};

const line: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId(FIELD_ERROR_TEST_ID);
};

describe("on a Persian page", () => {
  test("an English answer from the server reads left to right, in an isolate of its own", () => {
    draw("fa", <FieldError message="Promo code is invalid." />);

    const words: Element | null = line().firstElementChild;

    expect(line()).toHaveTextContent(/^Promo code is invalid\.$/);
    expect(words?.tagName).toBe("BDI");
    expect(words).toHaveAttribute("dir", "ltr");
  });

  test("a check in the page's words is drawn in Persian, as it always was", () => {
    draw("fa", <FieldError message="Description is required" />);

    expect(line()).toHaveTextContent(/^توضیحات الزامی است$/);
    expect(line().firstElementChild).toBeNull();
  });

  test("the fields draw their server answers with it: a text field, a long text, a switch", () => {
    draw("fa", <Input onChange={() => {}} error="Promo code is invalid." />);

    expect(line().querySelector("bdi")).toHaveAttribute("dir", "ltr");
    expect(screen.getByRole("alert")).toBe(line());

    cleanup();

    draw(
      "fa",
      <TextArea onChange={() => {}} error="Rollback note is too long." />,
    );

    expect(line().querySelector("bdi")).toHaveAttribute("dir", "ltr");

    cleanup();

    draw(
      "fa",
      <Toggle
        title="Enabled"
        value={false}
        onChange={() => {}}
        error="Turn on at least one channel."
      />,
    );

    expect(line().querySelector("bdi")).toHaveTextContent(
      /^Turn on at least one channel\.$/,
    );
  });
});

/*
 * The fields that drew a red line of their own around their error - a
 * note's editor, a card picker, the permission list - draw it with
 * FieldError too (FieldErrorGuard's second shape): under a note's editor an
 * English answer put its full stop first on a Persian page.
 */
describe("the fields that drew their own error line", () => {
  test("a note's editor: its error reads as written, said at once, named by the editor", () => {
    draw(
      "fa",
      <MarkdownEditor
        initialValue="Customers cannot pay."
        error="Notes cannot be empty."
      />,
    );

    const alert: HTMLElement = screen.getByRole("alert");

    expect(alert).toBe(line());
    expect(alert).toHaveTextContent(/^Notes cannot be empty\.$/);
    expect(alert.querySelector("bdi")).toHaveAttribute("dir", "ltr");
    expect(
      document.querySelector(
        `[aria-describedby~="${alert.getAttribute("id")}"]`,
      ),
    ).not.toBeNull();
  });

  test("a card picker keeps its own spacing and colour", () => {
    draw(
      "fa",
      <CardSelect
        options={[
          {
            value: "Website",
            title: "Website",
            description: "Checks a page loads.",
            icon: IconProp.Globe,
          },
        ]}
        onChange={() => {}}
        error="Pick a monitor type."
      />,
    );

    expect(line()).toHaveAttribute("class", "mt-2 text-sm text-red-600");
    expect(line()).toHaveAttribute("role", "alert");
    expect(line().querySelector("bdi")).toHaveAttribute("dir", "ltr");
  });

  test("the permission list's error is drawn as before on an English page", () => {
    draw(
      "en",
      <PermissionPicker onChange={() => {}} error="Pick a permission." />,
    );

    expect(line()).toHaveAttribute("class", FIELD_ERROR_CLASS_NAME);
    expect(line().innerHTML).toBe("Pick a permission.");
    // Said by the field itself, as it was.
    expect(line()).not.toHaveAttribute("role");
  });

  test("a field whose suites find its error by an id of their own keeps it", () => {
    draw(
      "en",
      <FieldError
        message="Add at least one condition."
        dataTestId="rule-criteria-error"
      />,
    );

    expect(screen.getByTestId("rule-criteria-error")).toHaveTextContent(
      "Add at least one condition.",
    );
    expect(screen.queryByTestId(FIELD_ERROR_TEST_ID)).not.toBeInTheDocument();
  });
});

describe("on an English page", () => {
  test("an English error is drawn as it always was: its words alone in the line", () => {
    draw("en", <FieldError message="Promo code is invalid." />);

    expect(line().innerHTML).toBe("Promo code is invalid.");
  });

  test("a Persian message reads right to left, in an isolate of its own", () => {
    draw("en", <FieldError message="توضیحات الزامی است" />);

    expect(line().firstElementChild).toHaveAttribute("dir", "rtl");
  });
});

describe("how it is said and drawn", () => {
  test("said to a screen reader at once, by default, and named by its id", () => {
    draw(
      "en",
      <FieldError message="Promo code is invalid." id="promo-error" />,
    );

    const alert: HTMLElement = screen.getByRole("alert");

    expect(alert).toHaveAttribute("id", "promo-error");
    expect(alert).toHaveAttribute("data-testid", FIELD_ERROR_TEST_ID);
    expect(alert).not.toHaveAttribute("aria-live");
  });

  test("politely, or not at all, where a field says so", () => {
    draw("en", <FieldError message="Pick a time." announce="polite" />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(line()).toHaveAttribute("aria-live", "polite");

    cleanup();

    draw("en", <FieldError message="Pick a day." announce="none" />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(line()).not.toHaveAttribute("aria-live");
  });

  test("red, under the field; a field may space or colour it its own way", () => {
    draw("en", <FieldError message="Promo code is invalid." />);

    expect(line()).toHaveAttribute("class", FIELD_ERROR_CLASS_NAME);
    expect(FIELD_ERROR_CLASS_NAME).toBe("mt-1 text-sm text-red-400");

    cleanup();

    draw(
      "en",
      <FieldError message="Promo code is invalid." className="text-xs" />,
    );

    expect(line()).toHaveAttribute("class", "text-xs");
  });
});
