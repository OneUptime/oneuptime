import DeleteConfirmationMessage from "../../../../UI/Components/DeleteConfirmation/DeleteConfirmationMessage";
import DeleteConsequenceParagraph, {
  DELETE_CONSEQUENCE_PARAGRAPH_CLASS_NAME,
} from "../../../../UI/Components/DeleteConfirmation/DeleteConsequenceParagraph";
import {
  ADDED_BACK_BY_INGEST_SENTENCE,
  DELETE_CONSEQUENCES,
  getDeleteConsequence,
  joinSentences,
} from "../../../../UI/Components/DeleteConfirmation/DeleteConsequences";
import {
  createTranslator,
  Translator,
} from "../../../../UI/Utils/TranslateTemplate";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import React from "react";

/*
 * What goes with a record is said in a paragraph of its own under every
 * Delete question - a row's, a bulk Delete's, a record's own Delete page, a
 * timeline row's - drawn by one component so they all set it apart alike,
 * and run together the way the reader's script runs sentences: Chinese and
 * Japanese put no space after a full stop.
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

describe("DeleteConsequenceParagraph", () => {
  test("is a paragraph of its own: a block with a gap above it", () => {
    render(
      <span data-testid="question">
        Are you sure you want to delete Demo Status?
        <DeleteConsequenceParagraph>
          Deleting a status page also deletes its subscribers.
        </DeleteConsequenceParagraph>
      </span>,
    );

    const paragraph: HTMLElement = screen.getByTestId(
      "delete-confirmation-consequence",
    );

    expect(paragraph.tagName).toBe("SPAN");
    expect(paragraph.className).toBe(DELETE_CONSEQUENCE_PARAGRAPH_CLASS_NAME);
    expect(paragraph.className.split(" ")).toEqual(
      expect.arrayContaining(["block", "mt-3"]),
    );
  });

  test("reads apart from the question as plain text too: a space, not a run-on", () => {
    render(
      <span data-testid="question">
        Are you sure you want to delete Demo Status?
        <DeleteConsequenceParagraph>
          Deleting a status page also deletes its subscribers.
        </DeleteConsequenceParagraph>
      </span>,
    );

    expect(screen.getByTestId("question").textContent).toBe(
      "Are you sure you want to delete Demo Status? Deleting a status page also deletes its subscribers.",
    );
  });

  test("with nothing before it, starts without a space or a gap", () => {
    render(
      <span data-testid="question">
        <DeleteConsequenceParagraph hasTextBefore={false}>
          Deleting a team takes away the permissions it gave its members.
        </DeleteConsequenceParagraph>
      </span>,
    );

    expect(screen.getByTestId("question").textContent).toBe(
      "Deleting a team takes away the permissions it gave its members.",
    );
    expect(
      screen.getByTestId("delete-confirmation-consequence").className,
    ).toBe("block");
  });

  test("takes a test id of its own, for a dialog that says what a delete does", () => {
    render(
      <DeleteConsequenceParagraph dataTestId="state-row-delete-effect">
        {
          "Acknowledged, the state before it, becomes the incident's current state again."
        }
      </DeleteConsequenceParagraph>,
    );

    expect(screen.getByTestId("state-row-delete-effect")).toBeInTheDocument();
    expect(screen.queryByTestId("delete-confirmation-consequence")).toBeNull();
  });

  test("is what the shared Delete question draws its consequence with, after the question", () => {
    render(
      <DeleteConfirmationMessage
        name="Demo Status"
        typeLabel="status page"
        warning="Deleting a status page also deletes its subscribers, private users and custom domains."
      />,
    );

    const message: HTMLElement = screen.getByTestId(
      "delete-confirmation-message",
    );
    const paragraph: HTMLElement = screen.getByTestId(
      "delete-confirmation-consequence",
    );

    expect(paragraph.className).toBe(DELETE_CONSEQUENCE_PARAGRAPH_CLASS_NAME);
    expect(message.lastElementChild).toBe(paragraph);
    expect(message.textContent).toBe(
      "Are you sure you want to delete Demo Status? This action cannot be undone. Deleting a status page also deletes its subscribers, private users and custom domains.",
    );
  });
});

describe("joinSentences", () => {
  test("puts a space between sentences in a script that uses one", () => {
    expect(
      joinSentences([
        "Deleting a status page also deletes its subscribers.",
        "To take it off this list and keep everything, archive it instead.",
      ]),
    ).toBe(
      "Deleting a status page also deletes its subscribers. To take it off this list and keep everything, archive it instead.",
    );
  });

  test("puts none after a full-width full stop, question or exclamation mark", () => {
    expect(joinSentences(["削除されます。", "残ります。"])).toBe(
      "削除されます。残ります。",
    );
    expect(joinSentences(["よろしいですか？", "元に戻せません。"])).toBe(
      "よろしいですか？元に戻せません。",
    );
    expect(joinSentences(["注意！", "删除。"])).toBe("注意！删除。");
  });

  test("goes by how the sentence before ends, whatever the next one is", () => {
    expect(joinSentences(["削除されます。", "OneUptime keeps it."])).toBe(
      "削除されます。OneUptime keeps it.",
    );
    expect(joinSentences(["It goes.", "削除されます。"])).toBe(
      "It goes. 削除されます。",
    );
  });

  test("trims each sentence and leaves out empty ones", () => {
    expect(joinSentences(["  It goes.  ", "", "   ", "Its alerts stay."])).toBe(
      "It goes. Its alerts stay.",
    );
    expect(joinSentences([])).toBe("");
    expect(joinSentences(["", " "])).toBe("");
  });
});

const ENDS_WITH_IDEOGRAPHIC_FULL_STOP: RegExp = /。$/u;

describe("a consequence in Chinese and Japanese", () => {
  const sentence: string = DELETE_CONSEQUENCES["IoTFleet"]!.sentence!;

  test.each(["ja", "zh-CN", "zh-TW"])(
    "%s: its sentences run on with no space after the full stop",
    (language: string) => {
      const locale: Record<string, string> = readLocale(language);
      const translator: Translator = createTranslator((text: string) => {
        return locale[text];
      }, language);

      const first: string = locale[sentence]!;
      const second: string = locale[ADDED_BACK_BY_INGEST_SENTENCE]!;

      // Both are translated, and the first ends the way the script does.
      expect(first).toMatch(ENDS_WITH_IDEOGRAPHIC_FULL_STOP);
      expect(second).toBeDefined();

      expect(getDeleteConsequence("IoTFleet", translator)).toBe(
        `${first}${second}`,
      );
    },
  );

  test("German keeps the space", () => {
    const locale: Record<string, string> = readLocale("de");
    const translator: Translator = createTranslator((text: string) => {
      return locale[text];
    }, "de");

    expect(getDeleteConsequence("IoTFleet", translator)).toBe(
      `${locale[sentence]} ${locale[ADDED_BACK_BY_INGEST_SENTENCE]}`,
    );
  });
});
