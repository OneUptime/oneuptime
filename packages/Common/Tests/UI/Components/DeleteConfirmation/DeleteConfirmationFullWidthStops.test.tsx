import DeleteConfirmationMessage, {
  DELETE_IRREVERSIBLE_SENTENCE,
  DELETE_QUESTION_TEMPLATE,
  DELETE_STATEMENT_TEMPLATE,
  DELETE_THIS_QUESTION_TEMPLATE,
  getDeleteConfirmationText,
} from "../../../../UI/Components/DeleteConfirmation/DeleteConfirmationMessage";
import {
  getSentenceSeparator,
  joinSentences,
} from "../../../../UI/Components/DeleteConfirmation/DeleteConsequences";
import IrreversibleQuestion from "../../../../UI/Components/DeleteConfirmation/IrreversibleQuestion";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * Every Delete question in Japanese and Chinese put a space after its
 * full-width question mark - "test01 を削除してもよろしいですか？ この操作は元に
 * 戻せません。" - because DeleteConfirmationMessage ran its sentences
 * together with a space, where joinSentences writes none after a
 * full-width stop. Those scripts put no space between sentences: it read as
 * a stray gap, on every Delete dialog and every Delete page in the product.
 *
 * The sentences are the Dashboard's own translations, read from its locale
 * files, so the test says what a Japanese or Chinese reader sees.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src/Locales",
);

const readLocale: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
};

const KEYS: Array<string> = [
  DELETE_QUESTION_TEMPLATE,
  DELETE_STATEMENT_TEMPLATE,
  DELETE_IRREVERSIBLE_SENTENCE,
  DELETE_THIS_QUESTION_TEMPLATE,
  "workflow",
];

const resourcesOf: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  const locale: Record<string, string> = readLocale(language);
  const resources: Record<string, string> = {};

  for (const key of KEYS) {
    if (locale[key]) {
      resources[key] = locale[key]!;
    }
  }

  return resources;
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "ja",
    fallbackLng: false,
    resources: {
      ja: { translation: resourcesOf("ja") },
      "zh-CN": { translation: resourcesOf("zh-CN") },
      "zh-TW": { translation: resourcesOf("zh-TW") },
      de: { translation: resourcesOf("de") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

const messageText: () => string = (): string => {
  return screen.getByTestId("delete-confirmation-message").textContent || "";
};

describe("a Delete question in Japanese and Chinese", () => {
  test("the locales the test reads end the question with a full-width question mark", () => {
    for (const language of ["ja", "zh-CN", "zh-TW"]) {
      const question: string | undefined =
        readLocale(language)[DELETE_QUESTION_TEMPLATE];

      expect(question).toBeDefined();
      expect(question!.endsWith("？")).toBe(true);
    }
  });

  test.each([
    ["ja", "test01 を削除してもよろしいですか？この操作は元に戻せません。"],
    ["zh-CN", "确定要删除 test01 吗？此操作无法撤消。"],
    ["zh-TW", "確定要刪除 test01 嗎？此操作無法復原。"],
  ])(
    "in %s the dialog puts no space after the question mark",
    async (language: string, expected: string) => {
      await i18next.changeLanguage(language);

      render(
        <DeleteConfirmationMessage
          name="test01"
          typeLabel="host"
          kind="question"
        />,
      );

      expect(messageText()).toBe(expected);
      expect(messageText()).not.toContain("？ ");
    },
  );

  test.each([
    ["ja", "test01 を完全に削除します。この操作は元に戻せません。"],
    ["zh-CN", "永久删除 test01。此操作无法撤消。"],
  ])(
    "in %s the Delete page's card puts no space after its full stop",
    async (language: string, expected: string) => {
      await i18next.changeLanguage(language);

      render(
        <DeleteConfirmationMessage
          name="test01"
          typeLabel="host"
          kind="statement"
        />,
      );

      expect(messageText()).toBe(expected);
      expect(messageText()).not.toContain("。 ");
    },
  );

  test("the plain-text form (an aria-label, a test's expectation) agrees with the dialog", async () => {
    await i18next.changeLanguage("ja");

    expect(
      getDeleteConfirmationText({
        name: "test01",
        typeLabel: "host",
        kind: "question",
      }),
    ).toBe("test01 を削除してもよろしいですか？この操作は元に戻せません。");

    render(
      <DeleteConfirmationMessage
        name="test01"
        typeLabel="host"
        kind="question"
      />,
    );

    expect(messageText()).toBe(
      getDeleteConfirmationText({
        name: "test01",
        typeLabel: "host",
        kind: "question",
      }),
    );
  });

  test("a warning paragraph still follows the question, set apart", async () => {
    await i18next.changeLanguage("ja");

    render(
      <DeleteConfirmationMessage
        name="test01"
        typeLabel="host"
        kind="question"
        warning="ホストのコンテナも削除されます。"
      />,
    );

    expect(
      screen.getByTestId("delete-confirmation-consequence"),
    ).toHaveTextContent("ホストのコンテナも削除されます。");
    expect(
      messageText().startsWith("test01 を削除してもよろしいですか？この操作"),
    ).toBe(true);
  });

  test("a record with no name asks about its kind, with no space after the question mark either", async () => {
    await i18next.changeLanguage("ja");

    render(<DeleteConfirmationMessage name="" typeLabel="workflow" />);

    expect(messageText()).not.toContain("？ ");
    expect(messageText().endsWith("この操作は元に戻せません。")).toBe(true);
  });
});

describe("a Delete question in a language that spaces its sentences", () => {
  test("German keeps the space after the question mark", async () => {
    await i18next.changeLanguage("de");

    render(
      <DeleteConfirmationMessage
        name="test01"
        typeLabel="host"
        kind="question"
      />,
    );

    const de: Record<string, string> = readLocale("de");

    expect(messageText()).toBe(
      `${de[DELETE_QUESTION_TEMPLATE]!.replace("{{name}}", "test01")} ${
        de[DELETE_IRREVERSIBLE_SENTENCE]
      }`,
    );
  });

  test("a question that cannot be undone is said as one paragraph in English, with a space", async () => {
    await i18next.changeLanguage("en");

    expect(
      getDeleteConfirmationText({
        name: "Notify on-call",
        typeLabel: "workflow",
      }),
    ).toBe(
      "Are you sure you want to delete Notify on-call? This action cannot be undone.",
    );
  });
});

/*
 * The status and state timelines' Delete dialogs ask with names in bold and
 * then say it cannot be undone: IrreversibleQuestion runs the two together.
 */
const STATE_QUESTION: string =
  "Are you sure you want to delete the {{state}} state that started {{startsAt}}?";

const renderQuestion: () => void = (): void => {
  render(
    <span data-testid="question">
      <IrreversibleQuestion
        template={STATE_QUESTION}
        slots={{
          state: <strong key="state">Resolved</strong>,
          startsAt: <strong key="startsAt">10:42</strong>,
        }}
      />
    </span>,
  );
};

const questionText: () => string = (): string => {
  return screen.getByTestId("question").textContent || "";
};

describe("a timeline's Delete question with names in bold", () => {
  beforeAll(() => {
    for (const language of ["ja", "zh-CN"]) {
      const question: string | undefined = readLocale(language)[STATE_QUESTION];

      i18next.addResource(language, "translation", STATE_QUESTION, question!);
    }
  });

  test.each([
    [
      "ja",
      "10:42 に始まった Resolved の状態を削除してもよろしいですか？この操作は元に戻せません。",
    ],
    ["zh-CN", "确定要删除开始于 10:42 的 Resolved 状态吗？此操作无法撤消。"],
  ])(
    "in %s it puts no space after the question mark",
    async (language: string, expected: string) => {
      await i18next.changeLanguage(language);

      renderQuestion();

      expect(questionText()).toBe(expected);
      // The names are still drawn as they were handed in, in bold.
      expect(screen.getAllByText("Resolved")[0]!.tagName).toBe("STRONG");
    },
  );

  test("in English it keeps the space", async () => {
    await i18next.changeLanguage("en");

    renderQuestion();

    expect(questionText()).toBe(
      "Are you sure you want to delete the Resolved state that started 10:42? This action cannot be undone.",
    );
  });

  test("a translation that lost a slot is drawn in English, and spaced as English", async () => {
    i18next.addResource(
      "ja",
      "translation",
      STATE_QUESTION,
      "状態を削除してもよろしいですか？",
    );
    await i18next.changeLanguage("ja");

    renderQuestion();

    expect(questionText()).toBe(
      "Are you sure you want to delete the Resolved state that started 10:42? この操作は元に戻せません。",
    );

    i18next.addResource(
      "ja",
      "translation",
      STATE_QUESTION,
      readLocale("ja")[STATE_QUESTION]!,
    );
  });
});

describe("the separator the dialogs share", () => {
  test("is nothing after a full-width stop, and a space after anything else", () => {
    expect(getSentenceSeparator("よろしいですか？")).toBe("");
    expect(getSentenceSeparator("削除されます。")).toBe("");
    expect(getSentenceSeparator("注意！")).toBe("");
    expect(getSentenceSeparator("Are you sure?")).toBe(" ");
    expect(getSentenceSeparator("Done.")).toBe(" ");
    // Trailing space a translation kept does not hide the stop.
    expect(getSentenceSeparator("よろしいですか？ ")).toBe("");
  });

  test("joinSentences runs them together the same way", () => {
    expect(joinSentences(["よろしいですか？", "元に戻せません。"])).toBe(
      "よろしいですか？元に戻せません。",
    );
    expect(joinSentences(["Sure?", "It cannot be undone."])).toBe(
      "Sure? It cannot be undone.",
    );
  });
});
