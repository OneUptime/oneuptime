import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import SessionReplayConsentMode from "../../../Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "../../../Types/Rum/SessionReplayMaskingMode";
import { createTranslator, Translator } from "../../../Types/Translator";

/*
 * "What a recording contains" in the reader's language (issue #6369). The
 * privacy summary's sentences and their Change links were English in every
 * language, the retention one glued around "7 days" and the selector
 * counts glued around "2 selectors". Each is a whole sentence of the
 * Dashboard's locales now, a count-dependent one a plural.
 *
 * The lookups here are marked, ⟦like this⟧, so a sentence drawn without one
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

import PrivacySummaryCard, {
  PrivacySummaryInput,
  PrivacySummarySentence,
  buildPrivacySummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/PrivacySummaryCard";

// A reader whose every lookup is marked: what was looked up shows.
const MARKING: Translator = createTranslator((text: string): string => {
  return `⟦${text}⟧`;
}, "de");

// The text outside every ⟦…⟧: what was drawn without a lookup.
function outsideMarks(text: string): string {
  let depth: number = 0;
  let outside: string = "";

  for (const character of text) {
    if (character === "⟦") {
      depth += 1;
    } else if (character === "⟧") {
      depth -= 1;
    } else if (depth === 0) {
      outside += character;
    }
  }

  return outside;
}

const LETTER: RegExp = /\p{L}/u;

// Only spaces and punctuation between the looked-up sentences.
function expectLookedUp(text: string): void {
  expect({ text: text, unmarked: LETTER.test(outsideMarks(text)) }).toEqual({
    text: text,
    unmarked: false,
  });
}

function sentence(
  sentences: Array<PrivacySummarySentence>,
  key: string,
): PrivacySummarySentence {
  const found: PrivacySummarySentence | undefined = sentences.find(
    (entry: PrivacySummarySentence): boolean => {
      return entry.key === key;
    },
  );

  expect(found).toBeDefined();

  return found as PrivacySummarySentence;
}

const EVERY_EXTRA: PrivacySummaryInput = {
  maskingMode: SessionReplayMaskingMode.MaskInputsOnly,
  maskSelectors: [".customer-name", "#invoice-total"],
  blockSelectors: ["iframe.payment", ".id-document"],
  recordCanvas: true,
  retentionInDays: 30,
};

/* Between them, every sentence the summary can say. */
const POLICIES: Array<{ name: string; policy: PrivacySummaryInput }> = [
  { name: "never set", policy: {} },
  { name: "every extra", policy: EVERY_EXTRA },
  {
    name: "wireframe, pseudonymous, no location, explicit consent",
    policy: {
      maskingMode: SessionReplayMaskingMode.MaskAllText,
      captureUserIdentity: false,
      captureGeo: false,
      consentMode: SessionReplayConsentMode.RequireExplicit,
      sameOriginTracePropagation: false,
      retentionInDays: 1,
    },
  },
  {
    name: "pseudonymous with the backend link",
    policy: { captureUserIdentity: false, sameOriginTracePropagation: true },
  },
  {
    name: "values this dashboard does not know",
    policy: { maskingMode: "Future", consentMode: "Future" },
  },
];

describe("buildPrivacySummary in the reader's language", () => {
  it.each(POLICIES)(
    "$name: every sentence and Change label is looked up",
    (entry: { name: string; policy: PrivacySummaryInput }) => {
      for (const line of buildPrivacySummary(entry.policy, MARKING)) {
        expectLookedUp(line.text);
        expectLookedUp(line.changeLabel);
      }
    },
  );

  it("looks each sentence up whole, a count's with its plural, the values in place", () => {
    const sentences: Array<PrivacySummarySentence> = buildPrivacySummary(
      EVERY_EXTRA,
      MARKING,
    );

    expect(sentence(sentences, "page-text").text).toBe(
      "⟦Readable page text is recorded; every input value is masked. An account number in a heading is visible in the replay, one typed into a form is not.⟧ ⟦2 extra selectors masked⟧; ⟦2 selectors blocked entirely⟧; ⟦canvas contents recorded⟧.",
    );
    expect(sentence(sentences, "retention").text).toBe(
      "⟦Recorded footage is deleted after 30 days, and the session row - duration, URLs, counts, device and any identity label - expires with it; only the session's logs, spans and exceptions follow the telemetry retention.⟧",
    );
    expect(sentence(sentences, "page-text").changeLabel).toBe(
      "⟦Change masking⟧",
    );
    expect(
      sentence(
        buildPrivacySummary(
          { maskingMode: "Future", consentMode: "Future" },
          MARKING,
        ),
        "consent",
      ).text,
    ).toBe(
      '⟦The consent mode "Future" is not one this dashboard knows; check the policy.⟧',
    );
  });

  it("reads in English, word for word, without a translator", () => {
    const sentences: Array<PrivacySummarySentence> = buildPrivacySummary({
      ...EVERY_EXTRA,
      maskSelectors: [".customer-name"],
      retentionInDays: 1,
    });

    expect(sentence(sentences, "page-text").text).toBe(
      "Readable page text is recorded; every input value is masked. An account number in a heading is visible in the replay, one typed into a form is not. 1 extra selector masked; 2 selectors blocked entirely; canvas contents recorded.",
    );
    expect(sentence(sentences, "retention").text).toBe(
      "Recorded footage is deleted after 1 day, and the session row - duration, URLs, counts, device and any identity label - expires with it; only the session's logs, spans and exceptions follow the telemetry retention.",
    );
    expect(sentence(sentences, "identity").changeLabel).toBe(
      "Change identity capture",
    );
    expect(sentence(buildPrivacySummary({}), "page-text").text).toBe(
      "Readable page text and most input values are recorded; only passwords and fields your markup declares sensitive (card, one-time code) are masked. This is the least private mode.",
    );
  });
});

describe("PrivacySummaryCard in the reader's language", () => {
  it("draws every sentence, its default note and its Change link looked up", () => {
    render(
      <PrivacySummaryCard policy={EVERY_EXTRA} changeHref="#replay-policy" />,
    );

    expect(screen.getByText("⟦What a recording contains⟧")).toBeInTheDocument();
    expect(
      screen.getByTestId("privacy-summary-change-retention"),
    ).toHaveTextContent("⟦Change retention⟧");
    expect(screen.getByTestId("privacy-summary-identity")).toHaveTextContent(
      "⟦(default; never set for this application)⟧",
    );

    const rows: Array<HTMLLIElement> = Array.from(
      screen.getByTestId("privacy-summary").querySelectorAll("li"),
    );

    expect(rows).toHaveLength(6);

    for (const row of rows) {
      expectLookedUp(row.textContent || "");
    }
  });

  it("says it is reading the policy, looked up", () => {
    render(
      <PrivacySummaryCard
        policy={null}
        changeHref="#replay-policy"
        isLoading={true}
      />,
    );

    expect(screen.getByTestId("privacy-summary-loading")).toHaveTextContent(
      "⟦Reading the policy…⟧",
    );
  });
});
