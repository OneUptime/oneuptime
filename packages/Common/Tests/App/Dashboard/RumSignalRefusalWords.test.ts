/**
 * @timezone UTC
 */
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { RumKindRefusal } from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumIngestRefusals";
import {
  RumSignalDiagnosis,
  RumSignalState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalDiagnosis";
import {
  RumPanelSignal,
  RumSetupCheckLine,
  RumSignalEmptyCopy,
  getRefusalAction,
  getRumSetupCheckLine,
  getRumSignalEmptyCopy,
  getSessionReplaySetupCheckLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalWords";
import { RUM_EMPTY_SIGNALS_DOCS_URL } from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/RumSignalSetupGuide";
import { IngestRefusalFact } from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/IngestRefusalFacts";
import { RecordingHealthState } from "../../../Types/Rum/SessionReplayHealth";
import { TelemetryIngestRefusalReason } from "../../../Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import { withDateDisplayLanguage } from "../../../Types/DateLanguage";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import { Translator, createTranslator } from "../../../Types/Translator";

/*
 * WHAT THE SETUP CHECK AND AN EMPTY CHART SAY OF REFUSED TELEMETRY
 * (issue #6378).
 *
 * A refusal the app's telemetry has not got past is the answer: the row
 * says Refused and when, the reason under it and the one thing that puts
 * it right. Partly refused says so only beside telemetry that does
 * arrive. A check that is still loading, or that could not be made, stays
 * what it is - a refusal read alone cannot say the app is fine or not.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

const NOW: Date = new Date("2026-11-09T12:00:00.000Z");
const KEY_ID: string = "6c3d0000-0000-4000-8000-0000000000b2";

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

const ENGLISH: Translator = createTranslator(undefined, "en");

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function localeTranslator(language: string): Translator {
  const words: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;

  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, language);
}

function refusal(
  state: RumKindRefusal["state"],
  overrides: Partial<IngestRefusalFact> = {},
): RumKindRefusal {
  return {
    state,
    refusal: {
      keyId: KEY_ID,
      keyName: "Storefront browser key",
      keyType: TelemetryIngestionKeyType.Browser,
      pinnedServiceName: null,
      reason: TelemetryIngestRefusalReason.KeyDisabled,
      surface: TelemetryIngestSurface.OtelTraces,
      count: 40,
      firstRefusedAt: ago(5 * HOUR),
      lastRefusedAt: ago(30 * MINUTE),
      ...overrides,
    },
  };
}

function diagnosis(
  state: RumSignalState,
  extra: Partial<RumSignalDiagnosis> = {},
): RumSignalDiagnosis {
  return {
    state,
    lastArrivalAt: null,
    since: null,
    widerRange: null,
    ...extra,
  };
}

function line(data: {
  state: RumSignalState;
  refusal: RumKindRefusal | null;
  signal?: "traces" | "exceptions" | "logs" | "webVitals";
  translator?: Translator;
  extra?: Partial<RumSignalDiagnosis>;
}): RumSetupCheckLine {
  return getRumSetupCheckLine({
    signal: data.signal || "traces",
    diagnosis: diagnosis(data.state, {
      lastArrivalAt: data.state === "receiving" ? ago(20 * MINUTE) : null,
      ...(data.extra || {}),
    }),
    client: "browser",
    refusal: data.refusal,
    translator: data.translator || ENGLISH,
    now: NOW,
  });
}

function emptyCopy(data: {
  signal: RumPanelSignal;
  state: RumSignalState;
  refusal: RumKindRefusal | null;
  translator?: Translator;
}): RumSignalEmptyCopy | null {
  return getRumSignalEmptyCopy({
    signal: data.signal,
    diagnosis: diagnosis(data.state, {
      cause: data.state === "not-set-up" ? "signal" : undefined,
    }),
    client: "browser",
    refusal: data.refusal,
    translator: data.translator || ENGLISH,
    now: NOW,
  });
}

const REFUSED_LINE: RumSetupCheckLine = {
  tone: "error",
  text: "Refused. The latest was refused 30 minutes ago.",
  detail:
    'The key "Storefront browser key" is turned off, so everything sent with it is refused.',
  action: { kind: "pick-key", label: "Pick another key" },
};

describe("a setup check row whose telemetry is refused", () => {
  test.each(["not-set-up", "not-arriving", "quiet", "receiving"] as const)(
    "refused wins over %s",
    (state: RumSignalState) => {
      expect(
        line({
          state,
          refusal: refusal("refused"),
          extra: state === "not-set-up" ? { cause: "signal" } : {},
        }),
      ).toEqual(REFUSED_LINE);
    },
  );

  test("partly refused, beside telemetry that arrives: a warning with the reason and its fix", () => {
    expect(
      line({
        state: "receiving",
        refusal: refusal("partly-refused", {
          reason: TelemetryIngestRefusalReason.ProjectIngestionRate,
          lastRefusedAt: ago(5 * MINUTE),
        }),
      }),
    ).toEqual({
      tone: "warning",
      text: "Arriving, but some are refused. The latest was refused 5 minutes ago.",
      detail: "This project went over its ingestion rate limit.",
      action: { kind: "budgets", label: "See budgets" },
    });
  });

  test.each(["not-set-up", "not-arriving", "quiet"] as const)(
    "partly refused says nothing over %s: what arrives is the rest of the answer",
    (state: RumSignalState) => {
      const extra: Partial<RumSignalDiagnosis> =
        state === "not-set-up" ? { cause: "signal" } : {};

      expect(
        line({ state, refusal: refusal("partly-refused"), extra }),
      ).toEqual(line({ state, refusal: null, extra }));
    },
  );

  test.each(["loading", "unknown"] as const)(
    "while %s, the row stays what it is",
    (state: RumSignalState) => {
      expect(line({ state, refusal: refusal("refused") })).toEqual(
        line({ state, refusal: null }),
      );
    },
  );

  test("the exceptions and Web Vitals rows say what refused the traces and metrics that carry them", () => {
    expect(
      line({
        state: "not-set-up",
        signal: "exceptions",
        refusal: refusal("refused"),
      }),
    ).toEqual(REFUSED_LINE);
    expect(
      line({
        state: "not-arriving",
        signal: "webVitals",
        refusal: refusal("refused"),
      }),
    ).toEqual(REFUSED_LINE);
  });

  test("each reason's fix is the row's action: another key, the key's page, budgets, billing, or none", () => {
    const actionOf: (
      reason: TelemetryIngestRefusalReason,
    ) => RumSetupCheckLine["action"] = (
      reason: TelemetryIngestRefusalReason,
    ): RumSetupCheckLine["action"] => {
      return line({
        state: "not-arriving",
        refusal: refusal("refused", { reason }),
      }).action;
    };

    expect(actionOf(TelemetryIngestRefusalReason.KeyExpired)).toEqual({
      kind: "pick-key",
      label: "Pick another key",
    });
    expect(actionOf(TelemetryIngestRefusalReason.OriginNotAllowed)).toEqual({
      kind: "open-key",
      label: "Open the key",
      keyId: KEY_ID,
    });
    expect(actionOf(TelemetryIngestRefusalReason.KeyDailyBudget)).toEqual({
      kind: "open-key",
      label: "Open the key",
      keyId: KEY_ID,
    });
    expect(actionOf(TelemetryIngestRefusalReason.ProjectDailyBudget)).toEqual({
      kind: "budgets",
      label: "See budgets",
    });
    expect(actionOf(TelemetryIngestRefusalReason.PaymentRequired)).toEqual({
      kind: "billing",
      label: "Add a payment method",
    });
    expect(
      actionOf(TelemetryIngestRefusalReason.ProjectBlocked),
    ).toBeUndefined();
    expect(
      actionOf(TelemetryIngestRefusalReason.BrowserKeyNotAllowedHere),
    ).toBeUndefined();
  });

  test("getRefusalAction is the same for the empty charts", () => {
    expect(getRefusalAction(refusal("refused"), ENGLISH)).toEqual(
      REFUSED_LINE.action,
    );
  });
});

describe("an empty chart whose telemetry is refused", () => {
  test.each([
    ["exceptions", "Exceptions are being refused"],
    ["logs", "Logs are being refused"],
  ] as const)(
    "%s: the title, the reason, when, its fix and why nothing arrives",
    (signal: RumPanelSignal, title: string) => {
      for (const state of ["not-set-up", "not-arriving", "quiet"] as const) {
        expect(
          emptyCopy({ signal, state, refusal: refusal("refused") }),
        ).toEqual({
          title,
          detail:
            'The key "Storefront browser key" is turned off, so everything sent with it is refused.',
          evidence: "The latest was refused 30 minutes ago.",
          action: { kind: "pick-key", label: "Pick another key" },
          helpLink: {
            text: "Why nothing arrives",
            url: RUM_EMPTY_SIGNALS_DOCS_URL,
          },
        });
      }
    },
  );

  test("a refusal nothing here puts right has no action, and still says why", () => {
    const copy: RumSignalEmptyCopy | null = emptyCopy({
      signal: "logs",
      state: "not-arriving",
      refusal: refusal("refused", {
        reason: TelemetryIngestRefusalReason.ProjectBlocked,
      }),
    });

    expect(copy?.detail).toBe(
      "An administrator blocked this project, so its telemetry is refused.",
    );
    expect(copy?.action).toBeUndefined();
  });

  test("partly refused, loading, arriving or unknown: the chart's own answer", () => {
    for (const state of ["not-set-up", "not-arriving", "quiet"] as const) {
      expect(
        emptyCopy({
          signal: "logs",
          state,
          refusal: refusal("partly-refused"),
        }),
      ).toEqual(emptyCopy({ signal: "logs", state, refusal: null }));
    }

    for (const state of ["loading", "receiving", "unknown"] as const) {
      expect(
        emptyCopy({ signal: "exceptions", state, refusal: refusal("refused") }),
      ).toEqual(emptyCopy({ signal: "exceptions", state, refusal: null }));
    }
  });
});

describe("the Session Replay row", () => {
  function replay(data: {
    state: RecordingHealthState;
    refusal: RumKindRefusal | null;
    isLoading?: boolean;
    failed?: boolean;
  }): RumSetupCheckLine | null {
    return getSessionReplaySetupCheckLine({
      isLoading: data.isLoading || false,
      error: data.failed ? { kind: "other", message: "boom" } : null,
      state: data.state,
      lastChunkReceivedAt: null,
      refusal: data.refusal,
      translator: ENGLISH,
      now: NOW,
    });
  }

  const recordings: RumKindRefusal = refusal("refused", {
    surface: TelemetryIngestSurface.SessionReplay,
  });

  test.each([
    "never-loaded",
    "loaded-never-uploaded",
    "stale",
    "healthy-quiet",
    "healthy",
    "refusing",
    "budget-paused",
  ] as const)(
    "a refused key turns recordings away before the recorder counts: refused wins over %s",
    (state: RecordingHealthState) => {
      expect(replay({ state, refusal: recordings })).toEqual(REFUSED_LINE);
    },
  );

  test.each(["disabled-project", "disabled-app", "unknown"] as const)(
    "recording turned off, or a health it cannot read, stays the answer: %s",
    (state: RecordingHealthState) => {
      expect(replay({ state, refusal: recordings })).toEqual(
        replay({ state, refusal: null }),
      );
    },
  );

  test("partly refused only beside recordings that arrive", () => {
    const partly: RumKindRefusal = refusal("partly-refused", {
      reason: TelemetryIngestRefusalReason.ProjectDailyBudget,
    });

    expect(replay({ state: "healthy", refusal: partly })?.tone).toBe("warning");
    expect(replay({ state: "healthy-quiet", refusal: partly })?.tone).toBe(
      "warning",
    );
    expect(replay({ state: "stale", refusal: partly })).toEqual(
      replay({ state: "stale", refusal: null }),
    );
  });

  test("while the health loads, or when it failed, the row says that first", () => {
    expect(
      replay({ state: "healthy", refusal: recordings, isLoading: true }),
    ).toEqual({ tone: "waiting", text: "Checking…" });
    expect(
      replay({ state: "healthy", refusal: recordings, failed: true }),
    ).toEqual({ tone: "off", text: "Couldn't be checked." });
  });
});

describe("in German and in Persian", () => {
  test("the row, its reason and its fix read in German, the time in German", () => {
    const GERMAN: Translator = localeTranslator("de");

    withDateDisplayLanguage("de", () => {
      expect(
        line({
          state: "not-arriving",
          refusal: refusal("refused"),
          translator: GERMAN,
        }),
      ).toEqual({
        tone: "error",
        text: "Abgelehnt. Die letzte Ablehnung war vor 30 Minuten.",
        detail:
          "Der Schlüssel „Storefront browser key“ ist ausgeschaltet, daher wird alles abgelehnt, was damit gesendet wird.",
        action: { kind: "pick-key", label: "Anderen Schlüssel wählen" },
      });

      const copy: RumSignalEmptyCopy | null = emptyCopy({
        signal: "logs",
        state: "not-arriving",
        translator: GERMAN,
        refusal: refusal("refused", {
          reason: TelemetryIngestRefusalReason.PaymentRequired,
        }),
      });

      expect(copy?.title).toBe("Protokolle werden abgelehnt");
      expect(copy?.evidence).toBe("Die letzte Ablehnung war vor 30 Minuten.");
      expect(copy?.action).toEqual({
        kind: "billing",
        label: "Zahlungsmethode hinzufügen",
      });
      expect(copy?.helpLink?.text).toBe("Warum nichts ankommt");
    });
  });

  test("in Persian, the key's Latin name is set apart, and nothing is left in English", () => {
    const PERSIAN: Translator = localeTranslator("fa");
    const persian: RumSetupCheckLine = line({
      state: "receiving",
      translator: PERSIAN,
      refusal: refusal("partly-refused", {
        keyType: TelemetryIngestionKeyType.Server,
        pinnedServiceName: "storefront-web",
        reason: TelemetryIngestRefusalReason.KeyRequestsPerMinute,
      }),
    });

    expect(persian.tone).toBe("warning");
    expect(persian.text).not.toContain("Arriving");
    expect(persian.detail).toContain(
      `${FIRST_STRONG_ISOLATE}Storefront browser key${POP_DIRECTIONAL_ISOLATE}`,
    );
    expect(persian.detail).not.toContain("went over");
    expect(persian.action).toEqual({
      kind: "open-key",
      label: "باز کردن کلید",
      keyId: KEY_ID,
    });
  });
});
