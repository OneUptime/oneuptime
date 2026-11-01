import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import Alert, { AlertType } from "../../../UI/Components/Alerts/Alert";
import ErrorMessage from "../../../UI/Components/ErrorMessage/ErrorMessage";
import ModalBody from "../../../UI/Components/Modal/ModalBody";

/*
 * An answer from the server is in English - "Promo code is invalid." - and
 * on a Persian page, laid out right to left, it put its full stop first
 * (".Promo code is invalid"): above a form (Alert), in a dialog (ModalBody's
 * Alert) and where a list could not be read (ErrorMessage). Each now draws
 * words that read the other way from the page in an isolate that reads the
 * way they are written. Words in the page's own way, and a message the page
 * draws as an element of its own, are drawn as they always were.
 */

const persian: i18n = createInstance();
const english: i18n = createInstance();

beforeAll(async () => {
  for (const [instance, language] of [
    [persian, "fa"],
    [english, "en"],
  ] as Array<[i18n, string]>) {
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: {} },
        fa: {
          translation: {
            "Could not save.": "ذخیره نشد.",
          },
        },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  }
});

afterEach(() => {
  cleanup();
});

const inPersian: (element: React.ReactElement) => void = (
  element: React.ReactElement,
): void => {
  render(<I18nextProvider i18n={persian}>{element}</I18nextProvider>);
};

describe("an alert above a form", () => {
  test("an English answer from the server reads left to right, its full stop at its end", () => {
    inPersian(
      <Alert
        title="Promo code is invalid."
        type={AlertType.DANGER}
        dataTestId="form-error"
      />,
    );

    const words: HTMLElement | null = screen
      .getByTestId("form-error")
      .querySelector("bdi");

    expect(words).toHaveTextContent(/^Promo code is invalid\.$/);
    expect(words).toHaveAttribute("dir", "ltr");
  });

  test("words the product translated read as the page does, drawn as they always were", () => {
    inPersian(<Alert title="Could not save." dataTestId="form-error" />);

    const alert: HTMLElement = screen.getByTestId("form-error");

    expect(alert).toHaveTextContent("ذخیره نشد.");
    expect(alert.querySelector("bdi")).toBeNull();
  });

  test("on an English page an English answer is drawn as it always was", () => {
    render(
      <I18nextProvider i18n={english}>
        <Alert title="Promo code is invalid." dataTestId="form-error" />
      </I18nextProvider>,
    );

    expect(screen.getByText("Promo code is invalid.").tagName).toBe("DIV");
    expect(
      screen.getByTestId("form-error").querySelector("bdi"),
    ).toBeNull();
  });

  test("its bold title and its words on the right read as written too", () => {
    inPersian(
      <Alert
        strongTitle="Release v2.4.1 failed."
        title="Rolled back the deploy."
        textOnRight="Try again."
        dataTestId="form-error"
      />,
    );

    const isolates: Array<Element> = Array.from(
      screen.getByTestId("form-error").querySelectorAll("bdi"),
    );

    expect(
      isolates.map((isolate: Element): Array<string | null> => {
        return [isolate.textContent, isolate.getAttribute("dir")];
      }),
    ).toEqual([
      ["Release v2.4.1 failed.", "ltr"],
      ["Rolled back the deploy.", "ltr"],
      ["Try again.", "ltr"],
    ]);
  });

  test("a message the page draws as an element is drawn as it is", () => {
    inPersian(
      <Alert
        title={
          <span data-testid="own-words">
            Read the <a href="/docs">guide</a>.
          </span>
        }
        dataTestId="form-error"
      />,
    );

    expect(screen.getByTestId("own-words").parentElement?.tagName).toBe(
      "DIV",
    );
    expect(
      screen.getByTestId("form-error").querySelector("bdi"),
    ).not.toBeInTheDocument();
  });
});

describe("a dialog's refusal", () => {
  test("ModalBody's alert reads the server's answer as written", () => {
    inPersian(
      <ModalBody error="Name is already taken.">
        <p>Fields</p>
      </ModalBody>,
    );

    expect(
      screen.getByTestId("modal-error").querySelector("bdi"),
    ).toHaveAttribute("dir", "ltr");
  });
});

describe("a list that could not be read", () => {
  test("ErrorMessage reads the server's answer as written", () => {
    inPersian(<ErrorMessage message="Request failed with status 502." />);

    const words: HTMLElement = screen.getByText(
      "Request failed with status 502.",
    );

    expect(words.tagName).toBe("BDI");
    expect(words).toHaveAttribute("dir", "ltr");
  });

  test("a message drawn as an element is drawn as it is", () => {
    inPersian(
      <ErrorMessage message={<span data-testid="own">No monitors.</span>} />,
    );

    expect(screen.getByTestId("own").closest("bdi")).toBeNull();
  });
});
