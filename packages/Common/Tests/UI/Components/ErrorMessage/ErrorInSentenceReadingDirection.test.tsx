import ErrorSentence, {
  ErrorInSentence,
} from "../../../../UI/Components/ErrorMessage/ErrorSentence";
import ErrorMessageText from "../../../../UI/Components/ErrorMessage/ErrorMessageText";
import {
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorWords,
} from "../../../../Types/Exception/UnexplainedError";
import { getMonitorTypeMismatchRefusal } from "../../../../Utils/Monitor/MonitorTemplateLinkRefusal";
import { readDashboardLocale } from "../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import "@testing-library/jest-dom";
import { cleanup, render, RenderResult } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * AN ERROR DRAWN ON ITS OWN, READ THE WAY ITS WORDS ARE WRITTEN (#8279).
 *
 * About 170 places draw API.getFriendlyMessage's answer with
 * ErrorInSentence (#7537): a line under a button, a red paragraph in a
 * card. A message the server wrote - in English, usually - was drawn with
 * no direction of its own, so on an Arabic or Persian page, laid out right
 * to left, its full stop came first: ".You do not have permission to
 * update this Monitor". ErrorMessageText and ErrorLine set such words apart
 * already; ErrorInSentence now does too, wherever no sentence of the
 * page's surrounds it. Inside a card's sentence (ErrorSentence, a
 * TranslatedSentence) the sentence sets its slots apart itself, and words
 * in the page's own way are drawn exactly as before.
 */

const ENGLISH_MESSAGE: string =
  "You do not have permission to update this Monitor.";
const PERSIAN_MESSAGE: string = "این مانیتور را نمی‌توان روشن کرد.";
const ARABIC_MESSAGE: string = "لا يمكن تشغيل هذه المراقبة.";

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

const drawIn: (language: string, element: ReactElement) => HTMLElement = (
  language: string,
  element: ReactElement,
): HTMLElement => {
  const result: RenderResult = render(
    <I18nextProvider i18n={instances.get(language)!}>
      <p data-testid="line">{element}</p>
    </I18nextProvider>,
  );

  return result.getByTestId("line");
};

const isolates: (line: HTMLElement) => Array<HTMLElement> = (
  line: HTMLElement,
): Array<HTMLElement> => {
  return Array.from(line.querySelectorAll("bdi"));
};

describe("a message the server wrote, drawn on its own (showWhereToLook)", () => {
  test.each(["fa", "ar"])(
    "on a page in %s, an English message is set apart and reads left to right, its full stop at its end",
    (language: string) => {
      const line: HTMLElement = drawIn(
        language,
        <ErrorInSentence message={ENGLISH_MESSAGE} showWhereToLook={true} />,
      );

      const [words] = isolates(line);

      expect(isolates(line)).toHaveLength(1);
      expect(words).toHaveAttribute("dir", "ltr");
      expect(words!.textContent).toBe(ENGLISH_MESSAGE);
      // Nothing is added to the words: no mark, no space.
      expect(line.textContent).toBe(ENGLISH_MESSAGE);
    },
  );

  test("the issue's own example: no isolate marks and no dir before, an isolate now", () => {
    const line: HTMLElement = drawIn(
      "fa",
      <ErrorInSentence message={ENGLISH_MESSAGE} showWhereToLook={true} />,
    );

    expect(line.innerHTML).toBe(`<bdi dir="ltr">${ENGLISH_MESSAGE}</bdi>`);
  });

  test.each([
    ["English", "en", ENGLISH_MESSAGE],
    ["English", "de", ENGLISH_MESSAGE],
    ["Persian", "fa", PERSIAN_MESSAGE],
    ["Arabic", "ar", ARABIC_MESSAGE],
    ["Arabic", "fa", ARABIC_MESSAGE],
  ])(
    "a message in %s on a page in %s reads the page's way, drawn exactly as before",
    (_script: string, language: string, message: string) => {
      const line: HTMLElement = drawIn(
        language,
        <ErrorInSentence message={message} showWhereToLook={true} />,
      );

      expect(line.innerHTML).toBe(message);
      expect(isolates(line)).toHaveLength(0);
    },
  );

  test.each([
    ["Persian", "en", PERSIAN_MESSAGE],
    ["Persian", "de", PERSIAN_MESSAGE],
    ["Arabic", "en", ARABIC_MESSAGE],
  ])(
    "a message in %s on a page in %s is set apart and reads right to left",
    (_script: string, language: string, message: string) => {
      const line: HTMLElement = drawIn(
        language,
        <ErrorInSentence message={message} showWhereToLook={true} />,
      );

      const [words] = isolates(line);

      expect(words).toHaveAttribute("dir", "rtl");
      expect(line.textContent).toBe(message);
    },
  );

  test("an English message that quotes a name typed in Persian still reads left to right", () => {
    const message: string =
      'Runner "کانال اضطراری" is offline. Start it, then try again.';
    const line: HTMLElement = drawIn(
      "fa",
      <ErrorInSentence message={message} showWhereToLook={true} />,
    );

    expect(isolates(line)[0]).toHaveAttribute("dir", "ltr");
    expect(line.textContent).toBe(message);
  });

  test("a Japanese message on an Arabic page reads left to right too", () => {
    const message: string = "接続が拒否されました。";
    const line: HTMLElement = drawIn(
      "ar",
      <ErrorInSentence message={message} showWhereToLook={true} />,
    );

    expect(isolates(line)[0]).toHaveAttribute("dir", "ltr");
    expect(line.textContent).toBe(message);
  });

  test("a message with no letters takes the page's way", () => {
    const line: HTMLElement = drawIn(
      "fa",
      <ErrorInSentence message="404" showWhereToLook={true} />,
    );

    expect(line.innerHTML).toBe("404");
  });

  test("no message is no words, and no isolate", () => {
    const line: HTMLElement = drawIn(
      "fa",
      <ErrorInSentence message={undefined} showWhereToLook={true} />,
    );

    expect(line.innerHTML).toBe("");
  });
});

describe("a message after words a card put before it by hand", () => {
  test("on a Persian page, the English message is set apart after the card's Persian words", () => {
    const line: HTMLElement = drawIn(
      "fa",
      <>
        <span>هیچ یادآوری ارسال نشد.&nbsp;</span>
        <ErrorInSentence message={ENGLISH_MESSAGE} />
      </>,
    );

    const [words] = isolates(line);

    expect(words).toHaveAttribute("dir", "ltr");
    expect(words!.textContent).toBe(ENGLISH_MESSAGE);
  });

  test("on an English page, drawn as before", () => {
    const line: HTMLElement = drawIn(
      "en",
      <>
        <span>No reminders were sent.&nbsp;</span>
        <ErrorInSentence message={ENGLISH_MESSAGE} />
      </>,
    );

    expect(isolates(line)).toHaveLength(0);
    // The card's no-break space, then the message.
    const noBreakSpace: string = String.fromCharCode(0xa0);

    expect(line.textContent).toBe(
      `No reminders were sent.${noBreakSpace}${ENGLISH_MESSAGE}`,
    );
  });
});

describe("inside a card's sentence", () => {
  const WHO_IS_TOLD: string = "Couldn't work out who is told. {{error}}";

  test.each(["fa", "ar"])(
    "in %s, the sentence sets the message apart itself: no isolate of ErrorInSentence's own",
    (language: string) => {
      const line: HTMLElement = drawIn(
        language,
        <ErrorSentence template={WHO_IS_TOLD} error={ENGLISH_MESSAGE} />,
      );

      expect(isolates(line)).toHaveLength(0);

      const text: string = line.textContent || "";

      // The card's words in the page's language, then the message whole.
      expect(text).toContain(
        readDashboardLocale(language)
          [WHO_IS_TOLD]!.split("{{error}}")[0]!
          .trim(),
      );
      expect(withoutIsolateMarks(text)).toContain(ENGLISH_MESSAGE);
      // Set apart by the sentence's own isolate marks.
      expect(text).not.toBe(withoutIsolateMarks(text));
    },
  );

  test("in English, exactly as before", () => {
    const line: HTMLElement = drawIn(
      "en",
      <ErrorSentence template={WHO_IS_TOLD} error={ENGLISH_MESSAGE} />,
    );

    expect(line.innerHTML).toBe(
      `Couldn't work out who is told. ${ENGLISH_MESSAGE}`,
    );
  });
});

describe("what is already in the page's language is never set apart", () => {
  test("an error nobody explained says why and what to do next in Persian, as before", () => {
    const line: HTMLElement = drawIn(
      "fa",
      <ErrorInSentence
        message={UNEXPLAINED_ERROR_MESSAGES.unreachable}
        showWhereToLook={true}
      />,
    );

    const persian: Record<string, string> = readDashboardLocale("fa");

    expect(isolates(line)).toHaveLength(0);
    expect(line.textContent).toContain(
      persian[UnexplainedErrorWords.unreachableWhy]!,
    );
  });

  test("a refusal with values reads in Persian, its English values inside the Persian line", () => {
    const line: HTMLElement = drawIn(
      "fa",
      <ErrorInSentence
        message={getMonitorTypeMismatchRefusal({
          monitorType: "Ping",
          templateType: "API",
        })}
        showWhereToLook={true}
      />,
    );

    expect(isolates(line)).toHaveLength(0);
    expect(line.textContent).not.toContain("This monitor's type is");
    expect(line.textContent).toMatch(/[؀-ۿ]/);
  });
});

describe("the same message reads the same way in ErrorMessageText", () => {
  test.each(["fa", "ar"])(
    "in %s, both set the English apart in one left-to-right isolate",
    (language: string) => {
      const fromSentence: HTMLElement = drawIn(
        language,
        <ErrorInSentence message={ENGLISH_MESSAGE} showWhereToLook={true} />,
      );
      const sentenceHtml: string = fromSentence.innerHTML;

      cleanup();

      const fromText: HTMLElement = drawIn(
        language,
        <ErrorMessageText message={ENGLISH_MESSAGE} />,
      );

      expect(sentenceHtml).toBe(fromText.innerHTML);
    },
  );
});
