import ConfirmModal from "../../../UI/Components/Modal/ConfirmModal";
import Modal from "../../../UI/Components/Modal/Modal";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import useTranslator from "../../../UI/Utils/UseTranslator";
import "@testing-library/jest-dom";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { FunctionComponent, ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * A DIALOG'S TITLE IS LOOKED UP ONCE (#8070, #8431, #8461).
 *
 * Modal looks its title up in the reader's locale. A page that builds the
 * title itself - around a name, "SCIM URLs - {{name}}" - hands it over in
 * the reader's words already, and a second lookup of those words can come
 * back as another word: a German title that is also an English key, an
 * English key whose German is something else. isTitleTranslated draws such
 * a title as given; without it a title is looked up, as before.
 */

const NOT_LOOKED_UP_AGAIN: string = "Window not measured";

const german: i18n = createInstance();

beforeAll(async () => {
  await german.init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: {
        translation: {
          [NOT_LOOKED_UP_AGAIN]: "Fenster nicht gemessen",
          "SCIM URLs - {{name}}": "SCIM-URLs - {{name}}",
          Close: "Schließen",
        },
      },
    },
    interpolation: { escapeValue: false },
  });
});

const inGerman: (element: ReactElement) => void = (
  element: ReactElement,
): void => {
  render(<I18nextProvider i18n={german}>{element}</I18nextProvider>);
};

const noop: () => void = (): void => {};

// The status page's SCIM dialog: its title built around the connection's name.
const ScimUrlsDialog: FunctionComponent<{ name: string }> = (props: {
  name: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ConfirmModal
      title={translator.translateTemplate(
        "SCIM URLs - {{name}}",
        { name: props.name },
        { setsValuesApart: true },
      )}
      isTitleTranslated={true}
      description="Configure your identity provider with these SCIM endpoint URLs:"
      onSubmit={noop}
    />
  );
};

describe("Modal", () => {
  test("draws a title said to be translated as given, never looking it up again", () => {
    inGerman(
      <Modal
        title={NOT_LOOKED_UP_AGAIN}
        isTitleTranslated={true}
        onSubmit={noop}
      >
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      NOT_LOOKED_UP_AGAIN,
    );
    expect(screen.queryByText("Fenster nicht gemessen")).toBeNull();
  });

  test("looks a title up when it is not said to be translated", () => {
    inGerman(
      <Modal title={NOT_LOOKED_UP_AGAIN} onSubmit={noop}>
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Fenster nicht gemessen",
    );
  });

  test("the dialog is still named by its title for a screen reader", () => {
    inGerman(
      <Modal
        title={NOT_LOOKED_UP_AGAIN}
        isTitleTranslated={true}
        onSubmit={noop}
      >
        <p>Body</p>
      </Modal>,
    );

    expect(
      screen.getByRole("dialog", { name: NOT_LOOKED_UP_AGAIN }),
    ).toBeInTheDocument();
  });
});

describe("ConfirmModal", () => {
  test("hands a title said to be translated to Modal as given", () => {
    inGerman(
      <ConfirmModal
        title={NOT_LOOKED_UP_AGAIN}
        isTitleTranslated={true}
        description="Body"
        onSubmit={noop}
      />,
    );

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      NOT_LOOKED_UP_AGAIN,
    );
  });

  test("looks a title up when it is not said to be translated", () => {
    inGerman(
      <ConfirmModal
        title={NOT_LOOKED_UP_AGAIN}
        description="Body"
        onSubmit={noop}
      />,
    );

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Fenster nicht gemessen",
    );
  });

  test("a title built around a name reads in German, the name as written", () => {
    inGerman(<ScimUrlsDialog name="Okta SCIM" />);

    expect(screen.getByTestId("modal-title").textContent).toBe(
      "SCIM-URLs - Okta SCIM",
    );
  });

  test("a name that is itself an English key is drawn as the name, not its German", () => {
    inGerman(<ScimUrlsDialog name={NOT_LOOKED_UP_AGAIN} />);

    expect(screen.getByTestId("modal-title").textContent).toBe(
      `SCIM-URLs - ${NOT_LOOKED_UP_AGAIN}`,
    );
  });
});
