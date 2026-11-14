import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  Translator,
} from "Common/Types/Translator";
import {
  RECORDER_DEBUG_CODE_COPY,
  RecorderDebugCodeCopy,
  RecorderDiagnosticsResult,
  UNKNOWN_RECORDER_DEBUG_CODE_COPY,
  explainRecorderDebugCode,
  explainRecorderDiagnostics,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/RecorderDiagnosticsExplainer";

/*
 * The explanation of a pasted getDiagnostics() in the reader's language
 * (#6369): every code's sentence and advice, the headline, the facts'
 * labels and the explainer's own values, and the errors a malformed paste
 * gets. A marking translator wraps each lookup in ⟦ ⟧; what the recorder
 * wrote - its codes, version, session id, states and reasons - stays as
 * written. Without a translator it is English, word for word, as
 * RecorderDiagnosticsExplainer.test.ts pins.
 */

const OPEN: string = "⟦";
const CLOSE: string = "⟧";

const marking: Translator = createTranslator((text: string): string => {
  return `${OPEN}${text}${CLOSE}`;
}, "de");

const english: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

function marked(text: string): string {
  return `${OPEN}${text}${CLOSE}`;
}

const FULL_DIAGNOSTICS: Record<string, unknown> = {
  version: "1.4.0",
  sessionId: "abc",
  state: "recording",
  stopReason: "manual",
  bootstrapDecision: "started",
  triggerReason: "error",
  decisions: {
    isSampled: false,
    captureTrigger: "Always",
    consentMode: "RequireExplicit",
    consentState: "unknown",
    uploadsAllowed: false,
    uploadBlockedBy: "consent",
    lastDirective: "continue",
    lastDirectiveReason: "consent-required",
    startDecision: "recording",
  },
  capabilities: ["click-events"],
  records: [
    { code: "loader-start", level: "info" },
    { code: "privacy-signal", level: "warn" },
    { code: "brand-new-code", level: "info" },
  ],
};

function explained(
  input: unknown,
  translator?: Translator,
): RecorderDiagnosticsResult {
  return explainRecorderDiagnostics(input, translator);
}

function factsOf(result: RecorderDiagnosticsResult): Record<string, string> {
  const facts: Record<string, string> = {};

  if (result.ok) {
    for (const fact of result.explanation.facts) {
      facts[fact.label] = fact.value;
    }
  }

  return facts;
}

describe("the code table in the reader's language", () => {
  test("every code's explanation and advice are looked up whole", () => {
    for (const code of Object.keys(RECORDER_DEBUG_CODE_COPY)) {
      const copy: RecorderDebugCodeCopy = RECORDER_DEBUG_CODE_COPY[
        code
      ] as RecorderDebugCodeCopy;
      const result: {
        explanation: string;
        action: string | null;
        isKnown: boolean;
      } = explainRecorderDebugCode(code, marking);

      expect({ code, explanation: result.explanation }).toEqual({
        code,
        explanation: marked(copy.explanation),
      });
      expect({ code, action: result.action }).toEqual({
        code,
        action: copy.action === undefined ? null : marked(copy.action),
      });
    }
  });

  test("a code newer than the dashboard says so in the reader's language", () => {
    expect(explainRecorderDebugCode("future-code", marking)).toEqual({
      explanation: marked(UNKNOWN_RECORDER_DEBUG_CODE_COPY),
      action: null,
      isKnown: false,
    });
  });

  test("English without a translator", () => {
    for (const code of [
      ...Object.keys(RECORDER_DEBUG_CODE_COPY),
      "future-code",
    ]) {
      expect(explainRecorderDebugCode(code, english)).toEqual(
        explainRecorderDebugCode(code),
      );
    }

    expect(explainRecorderDebugCode("privacy-signal").explanation).toBe(
      RECORDER_DEBUG_CODE_COPY["privacy-signal"]!.explanation,
    );
  });
});

/*
 * Looked up whole is only half of it: a sentence no locale file carries is
 * English on every Dashboard. Each code's explanation and advice is a key
 * of en.json, as itself, and worded in every other language the Dashboard
 * offers, the calls it names (start(), OneUptimeReplay.pause()) kept as
 * written - the page's own pause and resume codes once had no sentence at
 * all.
 */

const LOCALES_DIRECTORY: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src/Locales",
);

type Locale = Record<string, unknown>;

function localeOf(language: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Locale;
}

// A call a sentence names, which no language translates.
const CALL: RegExp = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\(\)/g;

const TABLE_SENTENCES: Array<string> = Object.values(
  RECORDER_DEBUG_CODE_COPY,
).flatMap((copy: RecorderDebugCodeCopy): Array<string> => {
  return copy.action === undefined
    ? [copy.explanation]
    : [copy.explanation, copy.action];
});

describe("the code table in every language the Dashboard offers", () => {
  test("English carries every sentence as itself", () => {
    const englishLocale: Locale = localeOf("en");

    expect(TABLE_SENTENCES.length).toBeGreaterThan(100);
    expect(
      TABLE_SENTENCES.filter((sentence: string): boolean => {
        return englishLocale[sentence] !== sentence;
      }),
    ).toEqual([]);
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words every sentence, the calls it names as written",
    (language: string) => {
      const locale: Locale = localeOf(language);

      const problems: Array<string> = TABLE_SENTENCES.flatMap(
        (sentence: string): Array<string> => {
          const value: unknown = locale[sentence];

          if (typeof value !== "string" || value.trim().length === 0) {
            return [`missing: ${sentence}`];
          }

          if (value === sentence) {
            return [`left in English: ${sentence}`];
          }

          return (sentence.match(CALL) || [])
            .filter((call: string): boolean => {
              return !value.includes(call);
            })
            .map((call: string): string => {
              return `${call} not kept: ${sentence}`;
            });
        },
      );

      expect(problems).toEqual([]);
    },
  );
});

describe("explainRecorderDiagnostics in the reader's language", () => {
  test("a malformed paste is told so in the reader's language", () => {
    for (const input of ["   ", "{ nope", "42", JSON.stringify({ a: 1 })]) {
      const inLocale: RecorderDiagnosticsResult = explained(input, marking);
      const inEnglish: RecorderDiagnosticsResult = explained(input);

      expect(inLocale.ok).toBe(false);
      expect(inEnglish.ok).toBe(false);

      if (!inLocale.ok && !inEnglish.ok) {
        // The same sentence, looked up whole.
        expect(inLocale.error).toBe(marked(inEnglish.error));
      }
    }
  });

  test("the facts' labels and the explainer's own values are the reader's; the recorder's words stay as written", () => {
    const facts: Record<string, string> = factsOf(
      explained(FULL_DIAGNOSTICS, marking),
    );

    expect(facts).toEqual({
      [marked("Recorder version")]: "1.4.0",
      [marked("Session")]: "abc",
      [marked("State")]: "recording",
      [marked("Stop reason")]: "manual",
      [marked("Bootstrap")]: "started",
      [marked("Upload trigger")]: "error",
      [marked("Sampled")]: marked("no: this session records nothing"),
      [marked("Capture trigger")]: "Always",
      [marked("Consent")]: "RequireExplicit (unknown)",
      [marked("Uploads")]: marked("blocked by consent"),
      [marked("Last server directive")]: "continue (consent-required)",
      [marked("Start decision")]: "recording",
    });
  });

  test("the explainer's other values: allowed, blocked, sampled, no session, no decisions", () => {
    expect(
      factsOf(
        explained(
          {
            decisions: { isSampled: true, uploadsAllowed: true },
            records: [],
          },
          marking,
        ),
      ),
    ).toEqual({
      [marked("Session")]: marked("none: no session was started on this page"),
      [marked("Sampled")]: marked("yes"),
      [marked("Uploads")]: marked("allowed"),
    });
    expect(
      factsOf(
        explained(
          { decisions: { uploadsAllowed: false }, records: [] },
          marking,
        ),
      )[marked("Uploads")],
    ).toBe(marked("blocked"));
    expect(
      factsOf(explained({ decisions: null, records: [] }, marking))[
        marked("Decisions")
      ],
    ).toBe(marked("none yet: no recorder object was built on this page"));
  });

  test("every headline is looked up whole, the recorder's stop reason inside", () => {
    const headline: (input: Record<string, unknown>) => string = (
      input: Record<string, unknown>,
    ): string => {
      const result: RecorderDiagnosticsResult = explained(input, marking);

      return result.ok ? result.explanation.headline : "";
    };

    expect(headline(FULL_DIAGNOSTICS)).toBe(
      marked(RECORDER_DEBUG_CODE_COPY["privacy-signal"]!.explanation),
    );
    expect(headline({ isUploading: true, records: [] })).toBe(
      marked("The recorder is recording and uploading on this page."),
    );
    expect(headline({ isRecording: true, records: [] })).toBe(
      marked(
        "The recorder is recording on this page; nothing has triggered an upload yet.",
      ),
    );
    expect(headline({ bootstrapDecision: "not-started", records: [] })).toBe(
      marked(
        "The recorder artifact never started on this page; the loader's records above say where it stopped.",
      ),
    );
    expect(headline({ stopReason: "manual", records: [] })).toBe(
      marked("The recorder stopped (manual)."),
    );
    expect(headline({ records: [] })).toBe(
      marked(
        "No outcome record was found; the records below list what the recorder did.",
      ),
    );
  });

  test("records keep the recorder's code and message, explained in the reader's language", () => {
    const result: RecorderDiagnosticsResult = explained(
      {
        records: [
          { code: "chunk-refused", level: "warn", message: "refused" },
          { code: "brand-new-code", level: "info", message: "?" },
        ],
      },
      marking,
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.explanation.records[0]!.code).toBe("chunk-refused");
      expect(result.explanation.records[0]!.message).toBe("refused");
      expect(result.explanation.records[0]!.explanation).toBe(
        marked(RECORDER_DEBUG_CODE_COPY["chunk-refused"]!.explanation),
      );
      expect(result.explanation.records[1]!.explanation).toBe(
        marked(UNKNOWN_RECORDER_DEBUG_CODE_COPY),
      );
      expect(result.explanation.unknownCodes).toEqual(["brand-new-code"]);
    }
  });

  test("English, word for word, without a translator", () => {
    for (const input of [
      FULL_DIAGNOSTICS,
      { decisions: null, records: [] },
      { isRecording: true, records: [] },
      "{ nope",
    ]) {
      expect(explained(input, english)).toEqual(explained(input));
    }

    const result: RecorderDiagnosticsResult = explained(FULL_DIAGNOSTICS);

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain(OPEN);
    expect(factsOf(result)["Uploads"]).toBe("blocked by consent");
  });
});
