import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { createTranslator, Translator } from "../../../Types/Translator";
import SessionReplayMaskingMode from "../../../Types/Rum/SessionReplayMaskingMode";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import {
  CONSENT_STATE_LABELS,
  REPLAY_CLOCK_AHEAD,
  REPLAY_CLOCK_BEHIND,
  TRIGGER_REASON_LABELS,
  formatReplayClockSkew,
  formatReplayMilliseconds,
  getReplayConsentStateLabel,
  getReplayTriggerReasonLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ReplayCorrelation";
import ReplayCorrelationPanel, {
  ReplayCorrelationPanelProps,
  ReplaySessionDetails,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayCorrelationPanel";
import { formatReplayScreenshotSize } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayScreenshotActions";

/*
 * THE SESSION DETAILS PANEL'S FIGURES, AND A SCREENSHOT'S SIZE, IN THE
 * READER'S LANGUAGE (#8299, #8350).
 *
 * The details panel's client clock skew read "1.5s ahead (server-clamped)"
 * and each gap "1.5s missing between chunk ۳ and chunk ۵" on a Persian page:
 * English words glued around a figure in Latin digits with an English
 * decimal point, beside chunk numbers already in Persian. A skew is one
 * sentence of the locale now, with its length as a placeholder; a length is
 * written the way the sentence's language writes one - milliseconds through
 * formatMilliseconds, seconds with the language's own unit, decimal sign
 * and digits, a minute or more as the player writes a length. A copied
 * screenshot's size takes the reader's digits, as the viewport chip does.
 * English reads exactly as before.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const LATIN_DIGIT: RegExp = /[0-9]/;
const PERSIAN_DIGIT: RegExp = /[\u{06F0}-\u{06F9}]/u;
const ARABIC_INDIC_DIGIT: RegExp = /[\u{0660}-\u{0669}]/u;

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function translatorIn(language: string): Translator {
  const words: Record<string, string> = readDashboardLocale(language);

  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, language);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  await readIn("en");
});

afterEach(() => {
  cleanup();
});

describe("formatReplayMilliseconds, in each language", () => {
  test("English reads exactly as it always did", () => {
    const english: Translator = translatorIn("en");

    for (const translator of [undefined, english]) {
      expect(formatReplayMilliseconds(0, translator)).toBe("0\u00A0ms");
      expect(formatReplayMilliseconds(420, translator)).toBe("420\u00A0ms");
      expect(formatReplayMilliseconds(999, translator)).toBe("999\u00A0ms");
      expect(formatReplayMilliseconds(1000, translator)).toBe("1s");
      expect(formatReplayMilliseconds(1500, translator)).toBe("1.5s");
      expect(formatReplayMilliseconds(12_400, translator)).toBe("12s");
      expect(formatReplayMilliseconds(65_000, translator)).toBe("1m 05s");
      expect(formatReplayMilliseconds(-1500, translator)).toBe("-1.5s");
      expect(formatReplayMilliseconds(-65_000, translator)).toBe("-1m 05s");
      expect(formatReplayMilliseconds(Number.NaN, translator)).toBe("unknown");
    }
  });

  test("a length just short of the next minute carries into it, never '1m 60s'", () => {
    expect(formatReplayMilliseconds(119_600)).toBe("2m 00s");
    expect(formatReplayMilliseconds(59_600)).toBe("60s");
    expect(formatReplayMilliseconds(3_599_600)).toBe("60m 00s");
  });

  test("German: its own unit and decimal comma", () => {
    const german: Translator = translatorIn("de");

    expect(formatReplayMilliseconds(420, german)).toBe("420\u00A0ms");
    expect(formatReplayMilliseconds(1500, german)).toBe("1,5\u00A0Sek.");
    expect(formatReplayMilliseconds(12_400, german)).toBe("12\u00A0Sek.");

    const minute: string = formatReplayMilliseconds(65_000, german);

    expect(minute).toContain("1\u00A0Min.");
    expect(minute).toContain("5\u00A0Sek.");
    expect(formatReplayMilliseconds(Number.NaN, german)).toBe("unbekannt");
  });

  test("Persian: its own digits, decimal sign and units", () => {
    const persian: Translator = translatorIn("fa");

    expect(formatReplayMilliseconds(1500, persian)).toBe("۱٫۵\u00A0ثانیه");
    expect(formatReplayMilliseconds(12_400, persian)).toBe("۱۲\u00A0ثانیه");

    for (const ms of [420, 1500, 12_400, 65_000, 119_600, 3_725_000]) {
      const written: string = withoutIsolateMarks(
        formatReplayMilliseconds(ms, persian),
      );

      expect({ ms, written, latin: LATIN_DIGIT.test(written) }).toEqual({
        ms,
        written,
        latin: false,
      });
      expect(PERSIAN_DIGIT.test(written)).toBe(true);
    }

    expect(formatReplayMilliseconds(Number.NaN, persian)).toBe("نامعلوم");
  });

  test("Arabic: its own units, in Latin digits", () => {
    const arabic: Translator = translatorIn("ar");

    expect(formatReplayMilliseconds(1500, arabic)).toBe("1.5\u00A0ث");

    for (const ms of [420, 1500, 65_000]) {
      const written: string = formatReplayMilliseconds(ms, arabic);

      expect(LATIN_DIGIT.test(written)).toBe(true);
      expect(PERSIAN_DIGIT.test(written)).toBe(false);
      expect(ARABIC_INDIC_DIGIT.test(written)).toBe(false);
      expect(written).not.toMatch(/\d(s|m)\b/);
    }
  });

  test("a negative length keeps the language's own minus", () => {
    const persian: string = formatReplayMilliseconds(
      -65_000,
      translatorIn("fa"),
    );
    const german: string = formatReplayMilliseconds(
      -65_000,
      translatorIn("de"),
    );

    expect(
      persian.startsWith(translatorIn("fa").formatNumber(-1).slice(0, -1)),
    ).toBe(true);
    expect(german.startsWith("-")).toBe(true);
    expect(formatReplayMilliseconds(-1500, translatorIn("de"))).toBe(
      "-1,5\u00A0Sek.",
    );
  });
});

describe("formatReplayClockSkew, one sentence in each language", () => {
  test("English reads exactly as it always did", () => {
    expect(formatReplayClockSkew(300)).toBe(
      "300\u00A0ms ahead (server-clamped)",
    );
    expect(formatReplayClockSkew(-2500)).toBe("2.5s behind (server-clamped)");
    expect(formatReplayClockSkew(0)).toBe("None");
    expect(formatReplayClockSkew(Number.NaN)).toBe("None");
    expect(formatReplayClockSkew(1500, translatorIn("en"))).toBe(
      "1.5s ahead (server-clamped)",
    );
  });

  test("German: the locale's sentence, its length in German", () => {
    const german: Translator = translatorIn("de");

    expect(formatReplayClockSkew(1500, german)).toBe(
      german.translateTemplate(REPLAY_CLOCK_AHEAD, {
        duration: "1,5\u00A0Sek.",
      }),
    );
    expect(formatReplayClockSkew(-300, german)).toBe(
      german.translateTemplate(REPLAY_CLOCK_BEHIND, {
        duration: "300\u00A0ms",
      }),
    );
    expect(formatReplayClockSkew(1500, german)).not.toContain("ahead");
    expect(formatReplayClockSkew(1500, german)).not.toContain("server-clamped");
    expect(formatReplayClockSkew(0, german)).toBe("Keine");
  });

  test.each(["de", "ar", "fa"])(
    "%s words both ways the clock can run",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of [REPLAY_CLOCK_AHEAD, REPLAY_CLOCK_BEHIND]) {
        expect(words[key]).toBeDefined();
        expect(words[key]).not.toBe(key);
        expect(words[key]).toContain("{{duration}}");
      }
    },
  );

  test("Persian: no Latin digit, no English word", () => {
    const persian: Translator = translatorIn("fa");

    for (const skew of [300, -1500, 65_000]) {
      const written: string = withoutIsolateMarks(
        formatReplayClockSkew(skew, persian),
      );

      expect(LATIN_DIGIT.test(written)).toBe(false);
      expect(written).not.toMatch(/[A-Za-z]/);
    }
  });

  test("a language that has not worded the sentence reads it wholly in English", () => {
    const words: Record<string, string> = readDashboardLocale("de");
    const unworded: Translator = createTranslator(
      (key: string): string | undefined => {
        return key === REPLAY_CLOCK_AHEAD ? undefined : words[key];
      },
      "de",
    );

    expect(formatReplayClockSkew(1500, unworded)).toBe(
      "1.5s ahead (server-clamped)",
    );
  });
});

function makeDetails(
  overrides?: Partial<ReplaySessionDetails>,
): ReplaySessionDetails {
  return {
    entryUrl: "https://app.acme.com/checkout",
    exitUrl: "https://app.acme.com/checkout/done",
    browserName: "Chrome",
    browserVersion: "126",
    osName: "macOS",
    deviceType: "desktop",
    countryCode: "DE",
    identifiedUserLabel: "jane@acme.com",
    identifiedUserKey: "5f4dcc3b5aa765d61d8327deb882cf99",
    visitorId: "",
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    consentState: "NotRequired",
    triggerReason: "error",
    recorderKind: "dom",
    recorderVersion: "1.4.0",
    rrwebVersion: "2.0.0",
    viewportWidth: 1440,
    viewportHeight: 900,
    clockSkewMs: 1500,
    payloadBytes: 2048,
    startTime: "2026-08-14T10:00:00.000Z",
    endTime: "2026-08-14T10:12:30.000Z",
    traceIds: [],
    exceptionFingerprints: [],
    ...overrides,
  };
}

function renderPanel(overrides?: Partial<ReplayCorrelationPanelProps>): void {
  const props: ReplayCorrelationPanelProps = {
    isOpen: true,
    onClose: (): void => {
      // not asserted here
    },
    activeTabId: "session",
    onTabChange: (): void => {
      // not asserted here
    },
    sessionId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    details: makeDetails(),
    fidelityNotices: [],
    missingAssets: [],
    gaps: [],
    ...overrides,
  };

  render(
    <MemoryRouter>
      <ReplayCorrelationPanel {...props} />
    </MemoryRouter>,
  );
}

function skewText(): string {
  return withoutIsolateMarks(
    screen.getByTestId("replay-details-skew").querySelector("dd")
      ?.textContent || "",
  );
}

function gapText(): string {
  return withoutIsolateMarks(
    screen.getByTestId("replay-details-gap").textContent || "",
  );
}

describe("the details panel's Timing and Gaps, drawn", () => {
  test("English: as it always read", async () => {
    renderPanel({ activeTabId: "provenance" });

    expect(skewText()).toBe("1.5s ahead (server-clamped)");
    cleanup();

    renderPanel({
      activeTabId: "fidelity",
      gaps: [{ fromIndex: 3, toIndex: 5, missingMs: 1500 }],
    });

    expect(gapText()).toBe("1.5s missing between chunk 3 and chunk 5");
  });

  test("Persian: the skew and a gap wholly in Persian digits", async () => {
    await readIn("fa");
    renderPanel({ activeTabId: "provenance" });

    const skew: string = skewText();

    expect(skew).toContain("۱٫۵\u00A0ثانیه");
    expect(LATIN_DIGIT.test(skew)).toBe(false);
    cleanup();

    renderPanel({
      activeTabId: "fidelity",
      gaps: [{ fromIndex: 3, toIndex: 5, missingMs: 1500 }],
    });

    const gap: string = gapText();

    expect(gap).toContain("۱٫۵\u00A0ثانیه");
    expect(gap).toContain("۳");
    expect(gap).toContain("۵");
    expect(LATIN_DIGIT.test(gap)).toBe(false);
  });

  test("German: its own words and decimal comma", async () => {
    await readIn("de");
    renderPanel({
      activeTabId: "provenance",
      details: makeDetails({ clockSkewMs: -1500 }),
    });

    expect(skewText()).toBe(
      translatorIn("de").translateTemplate(REPLAY_CLOCK_BEHIND, {
        duration: "1,5\u00A0Sek.",
      }),
    );
    cleanup();

    renderPanel({
      activeTabId: "fidelity",
      gaps: [{ fromIndex: 3, toIndex: 5, missingMs: 65_000 }],
    });

    expect(gapText()).toContain("1\u00A0Min.");
    expect(gapText()).not.toMatch(/\d(s|m)\b/);
  });

  test("Arabic: Latin digits, never Persian or Arabic-Indic ones", async () => {
    await readIn("ar");
    renderPanel({ activeTabId: "provenance" });

    const skew: string = skewText();

    expect(skew).toContain("1.5\u00A0ث");
    expect(PERSIAN_DIGIT.test(skew)).toBe(false);
    expect(ARABIC_INDIC_DIGIT.test(skew)).toBe(false);
  });

  test("no skew measured reads the locale's word for none", async () => {
    await readIn("fa");
    renderPanel({
      activeTabId: "provenance",
      details: makeDetails({ clockSkewMs: 0 }),
    });

    expect(skewText()).toBe(translatorIn("fa").translateText("None"));
  });
});

describe("a copied screenshot's size, in the reader's digits", () => {
  test("Persian digits in Persian, the sign between them kept", () => {
    expect(formatReplayScreenshotSize(1440, 900, "fa")).toBe("۱۴۴۰ × ۹۰۰");
    expect(formatReplayScreenshotSize(1439.6, 899.5, "fa")).toBe("۱۴۴۰ × ۹۰۰");
  });

  test("Latin digits, never grouped, in every other language and with none", () => {
    for (const language of ["en", "de", "ar", undefined]) {
      expect(formatReplayScreenshotSize(1440, 900, language)).toBe(
        "1440 × 900",
      );
      expect(formatReplayScreenshotSize(12800, 7200, language)).toBe(
        "12800 × 7200",
      );
    }
  });

  test("the check would find a Latin digit in a Persian size", () => {
    expect(LATIN_DIGIT.test(formatReplayScreenshotSize(1440, 900))).toBe(true);
    expect(LATIN_DIGIT.test(formatReplayScreenshotSize(1440, 900, "fa"))).toBe(
      false,
    );
  });
});

/*
 * The Privacy tab's Consent and Why recorded read English on every page,
 * beside a Masking mode in the reader's words: each known label is a key
 * now, looked up where the panel draws it.
 */
describe("the Privacy tab's consent and reason, in the reader's words", () => {
  test("every known label is worded in German, Arabic and Persian", () => {
    for (const language of ["de", "ar", "fa"]) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const label of [
        ...Object.values(CONSENT_STATE_LABELS),
        ...Object.values(TRIGGER_REASON_LABELS),
      ]) {
        const worded: boolean = Boolean(words[label]) && words[label] !== label;

        expect({ language, label, worded }).toEqual({
          language,
          label,
          worded: true,
        });
      }
    }
  });

  test("English reads as it always did", () => {
    expect(getReplayConsentStateLabel("NotRequired")).toBe(
      "Not required by this application's policy",
    );
    expect(getReplayTriggerReasonLabel("error", translatorIn("en"))).toBe(
      "An error occurred on the page",
    );
  });

  test("a label is looked up in the translator's language", () => {
    expect(getReplayConsentStateLabel("Granted", translatorIn("de"))).toBe(
      "Vom Endnutzer erteilt",
    );
    expect(getReplayTriggerReasonLabel("sampled", translatorIn("fa"))).toBe(
      "با درصد نمونه‌گیری انتخاب شد",
    );
    expect(getReplayTriggerReasonLabel("manual", translatorIn("ar"))).toContain(
      "OneUptimeReplay.captureSession()",
    );
  });

  test("an unknown value is the recorder's word, humanised, in every language", () => {
    for (const language of LANGUAGES) {
      expect(
        getReplayTriggerReasonLabel("some-new-reason", translatorIn(language)),
      ).toBe("Some New Reason");
      expect(getReplayConsentStateLabel("  ", translatorIn(language))).toBe("");
    }
  });

  test("drawn: Persian on the Privacy tab", async () => {
    await readIn("fa");
    renderPanel({ activeTabId: "provenance" });

    const consent: string =
      screen.getByTestId("replay-details-consent").querySelector("dd")
        ?.textContent || "";
    const reason: string =
      screen.getByTestId("replay-details-trigger").querySelector("dd")
        ?.textContent || "";

    expect(consent).toBe(
      translatorIn("fa").translateText(
        "Not required by this application's policy",
      ),
    );
    expect(reason).toBe("خطایی در صفحه رخ داد");
    expect(`${consent} ${reason}`).not.toMatch(/[A-Za-z]/);
  });
});
