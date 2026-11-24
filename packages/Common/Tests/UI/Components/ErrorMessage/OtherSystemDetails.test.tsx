import OtherSystemDetails from "../../../../UI/Components/ErrorMessage/OtherSystemDetails";
import { readDashboardLocale } from "../../../Helpers/DashboardLocales";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * ANOTHER SYSTEM'S OWN WORDS, FOLDED UNDER "DETAILS" (#7268).
 *
 * OneUptime says what happened and what to do next in its own words, in the
 * reader's language; the other system's words - a mail server's answer, a
 * cloud's error, a chat tool's refusal - come second, folded, exactly as
 * the system gave them, with a copy button. These draw the fold in English,
 * in German (a long language) and in Persian and Arabic (right to left).
 */

const SMTP_ANSWER: string =
  "Invalid login: 535-5.7.8 Username and Password not accepted. Learn more at\n535 5.7.8  https://support.google.com/mail/?p=BadCredentials";

const PERSIAN_ANSWER: string = "نام کاربری یا گذرواژه درست نیست.";

const instances: Map<string, i18n> = new Map<string, i18n>();

beforeAll(async () => {
  for (const language of ["en", "de", "fa", "ar"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances.set(language, instance);
  }
});

afterEach(() => {
  cleanup();
});

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

const installClipboard: (writeText: WriteTextMock) => void = (
  writeText: WriteTextMock,
): void => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
};

const drawIn: (language: string, element: ReactElement) => RenderResult = (
  language: string,
  element: ReactElement,
): RenderResult => {
  return render(
    <I18nextProvider i18n={instances.get(language)!}>
      {element}
    </I18nextProvider>,
  );
};

const open: (result: RenderResult) => void = (result: RenderResult): void => {
  fireEvent.click(result.getByTestId("other-system-details-toggle"));
};

describe("folded until asked for", () => {
  test("drawn folded: the toggle says Details, says it is closed, and the words are not on the page", () => {
    const result: RenderResult = drawIn(
      "en",
      <OtherSystemDetails details={SMTP_ANSWER} />,
    );
    const toggle: HTMLElement = result.getByTestId(
      "other-system-details-toggle",
    );

    expect(toggle).toHaveTextContent("Details");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.tagName).toBe("BUTTON");
    expect(result.queryByTestId("other-system-details-words")).toBeNull();
    // Nothing to copy while the words are folded away.
    expect(result.queryByText("Copy")).toBeNull();
  });

  test("opened, it shows the system's words exactly as they came, line breaks and all, and says it is open", () => {
    const result: RenderResult = drawIn(
      "en",
      <OtherSystemDetails details={SMTP_ANSWER} />,
    );

    open(result);

    const toggle: HTMLElement = result.getByTestId(
      "other-system-details-toggle",
    );
    const words: HTMLElement = result.getByTestId("other-system-details-words");

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", words.id);
    expect(words.textContent).toBe(SMTP_ANSWER);
    expect(words.tagName).toBe("PRE");
    expect(words.className).toContain("whitespace-pre-wrap");
    // A long answer scrolls in its own box, which a keyboard can reach.
    expect(words.className).toContain("overflow-y-auto");
    expect(words).toHaveAttribute("tabindex", "0");
  });

  test("pressed again, it folds away again", () => {
    const result: RenderResult = drawIn(
      "en",
      <OtherSystemDetails details={SMTP_ANSWER} />,
    );

    open(result);
    open(result);

    expect(
      result.getByTestId("other-system-details-toggle"),
    ).toHaveAttribute("aria-expanded", "false");
    expect(result.queryByTestId("other-system-details-words")).toBeNull();
  });

  test("drawn open where no sentence of OneUptime's says what happened", () => {
    const result: RenderResult = drawIn(
      "en",
      <OtherSystemDetails details={SMTP_ANSWER} isOpenByDefault={true} />,
    );

    expect(
      result.getByTestId("other-system-details-toggle"),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      result.getByTestId("other-system-details-words").textContent,
    ).toBe(SMTP_ANSWER);
  });

  test.each([undefined, null, "", "   \n "])(
    "nothing is drawn when the system said nothing (%p)",
    (details: string | null | undefined) => {
      const result: RenderResult = drawIn(
        "en",
        <div data-testid="holder">
          <OtherSystemDetails details={details} />
        </div>,
      );

      expect(result.getByTestId("holder")).toBeEmptyDOMElement();
    },
  );

  test("a surface names its own fold", () => {
    const result: RenderResult = drawIn(
      "en",
      <OtherSystemDetails details={SMTP_ANSWER} dataTestId="smtp-details" />,
    );

    expect(result.getByTestId("smtp-details-toggle")).toBeInTheDocument();
  });
});

describe("copyable", () => {
  test("Copy puts the system's words on the clipboard, exactly, and only then says Copied!", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async () => {
        // The clipboard took it.
      },
    );
    installClipboard(writeText);

    const result: RenderResult = drawIn(
      "en",
      <OtherSystemDetails details={`  ${SMTP_ANSWER}\n`} />,
    );

    open(result);

    await act(async () => {
      fireEvent.click(result.getByText("Copy"));
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(SMTP_ANSWER);
    expect(result.getByText("Copied!")).toBeInTheDocument();
  });
});

describe("in the reader's language, the system's words as written", () => {
  test("German, a long language: the fold and its Copy are German, the words are the server's", () => {
    const result: RenderResult = drawIn(
      "de",
      <OtherSystemDetails details={SMTP_ANSWER} />,
    );

    open(result);

    expect(
      result.getByTestId("other-system-details-toggle"),
    ).toHaveTextContent(readDashboardLocale("de")["Details"] as string);
    expect(result.getByText("Kopieren")).toBeInTheDocument();
    expect(
      result.getByTestId("other-system-details-words").textContent,
    ).toBe(SMTP_ANSWER);
    // Read from the left as the page is: no direction of its own.
    expect(
      result.getByTestId("other-system-details-words"),
    ).not.toHaveAttribute("dir");
  });

  test.each([
    ["fa", "جزئیات", "کپی"],
    ["ar", "التفاصيل", "نسخ"],
  ])(
    "on a page in %s, the fold is named in the page's words, and an English answer reads left to right, its full stop at its end",
    (language: string, title: string, copy: string) => {
      const result: RenderResult = drawIn(
        language,
        <OtherSystemDetails details={SMTP_ANSWER} />,
      );

      open(result);

      expect(
        result.getByTestId("other-system-details-toggle"),
      ).toHaveTextContent(title);
      expect(result.getByText(copy)).toBeInTheDocument();

      const words: HTMLElement = result.getByTestId(
        "other-system-details-words",
      );

      expect(words).toHaveAttribute("dir", "ltr");
      expect(words.textContent).toBe(SMTP_ANSWER);
    },
  );

  test("words in the page's own way take no direction of their own", () => {
    const result: RenderResult = drawIn(
      "fa",
      <OtherSystemDetails details={PERSIAN_ANSWER} />,
    );

    open(result);

    expect(
      result.getByTestId("other-system-details-words"),
    ).not.toHaveAttribute("dir");
  });

  test("Persian words on an English page read right to left", () => {
    const result: RenderResult = drawIn(
      "en",
      <OtherSystemDetails details={PERSIAN_ANSWER} />,
    );

    open(result);

    expect(result.getByTestId("other-system-details-words")).toHaveAttribute(
      "dir",
      "rtl",
    );
  });
});
