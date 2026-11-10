import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, jest } from "@jest/globals";
import { Translator } from "../../../Types/Translator";

/*
 * The Session Replay Documentation page's reference tiles in the reader's
 * language (issue #6369). Each tile's title and description were keys of
 * the locales, but the tiles drew them as written, so they read in English
 * in every language. They are looked up where they are drawn now.
 *
 * The lookups here are marked, ⟦like this⟧, so a tile drawn without one
 * shows up unmarked.
 */

type TranslatorModule = typeof import("../../../Types/Translator");

// Every lookup a component makes comes back marked, in German.
jest.mock("../../../UI/Utils/Translation", () => {
  const translatorModule: TranslatorModule =
    jest.requireActual("../../../Types/Translator") as TranslatorModule;
  const translateString: (value: string | undefined) => string | undefined = (
    value: string | undefined,
  ): string | undefined => {
    return value ? `⟦${value}⟧` : value;
  };
  const translator: Translator = translatorModule.createTranslator(
    translateString,
    "de",
  );

  return {
    __esModule: true,
    default: () => {
      return {
        translateString: translateString,
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" ? translateString(value) : value;
        },
        translateTemplate: translator.translateTemplate,
        translatePlural: translator.translatePlural,
        translateTerm: translator.translateTerm,
        hasTranslation: translator.hasTranslation,
        formatNumber: translator.formatNumber,
        language: translator.language,
      };
    },
  };
});

import SessionReplayDocsReference, {
  SESSION_REPLAY_DOCS_TOPICS,
  SessionReplayDocsTopic,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayDocsReference";

describe("SessionReplayDocsReference in the reader's language", () => {
  it("draws every tile's title and description looked up", () => {
    render(
      <MemoryRouter>
        <SessionReplayDocsReference />
      </MemoryRouter>,
    );

    const reference: HTMLElement = screen.getByTestId(
      "session-replay-docs-reference",
    );

    expect(SESSION_REPLAY_DOCS_TOPICS.length).toBeGreaterThan(0);

    for (const topic of SESSION_REPLAY_DOCS_TOPICS) {
      expect(reference).toHaveTextContent(`⟦${topic.title}⟧`);
      expect(reference).toHaveTextContent(`⟦${topic.description}⟧`);
    }

    // Nothing but the tiles' looked-up words, in their order.
    const looked: string = SESSION_REPLAY_DOCS_TOPICS.map(
      (topic: SessionReplayDocsTopic): string => {
        return `⟦${topic.title}⟧⟦${topic.description}⟧`;
      },
    ).join("");

    expect((reference.textContent || "").trim()).toBe(looked);
    expect(screen.getByText("⟦Session Replay Reference⟧")).toBeInTheDocument();
  });
});
