/**
 * @timezone UTC
 */
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  RumSignalDiagnosis,
  RumSignalState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalDiagnosis";
import {
  RumClientKind,
  RumPanelSignal,
  RumSetupCheckLine,
  RumSetupCheckSignal,
  RumSignalEmptyCopy,
  SETUP_CHECK_LABELS,
  formatSinceDate,
  getRumSetupCheckLabel,
  getRumSetupCheckLine,
  getRumSignalEmptyCopy,
  getSessionReplaySetupCheckLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalWords";
import {
  RUM_MOBILE_SETUP_DOCS_URL,
  RUM_WEB_VITALS_DOCS_URL,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/RumSetupGuide";
import { RUM_EMPTY_SIGNALS_DOCS_URL } from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/RumSignalSetupGuide";
import { RECORDING_HEALTH_ROW_WORDS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/OverviewHelpers";
import {
  SessionReplayHealthError,
  SessionReplayHealthErrorKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayHealthError";
import { RecordingHealthState } from "../../../Types/Rum/SessionReplayHealth";
import TimeRange from "../../../Types/Time/TimeRange";
import { createTranslator, Translator } from "../../../Types/Translator";
import { withDateDisplayLanguage } from "../../../Types/DateLanguage";

/*
 * WHAT AN EMPTY RUM CHART AND THE SETUP CHECK SAY (issue #5770).
 *
 * Every answer RumSignalDiagnosis gives, as the reader sees it: the title,
 * the sentence that says why, the one action that fixes it and where it
 * leads - in English, and in German from the Dashboard's own locale, with
 * the dates in the sentence's language.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const NOW: Date = new Date("2026-11-08T12:00:00.000Z");

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

function copyFor(data: {
  signal: RumPanelSignal;
  diagnosis: RumSignalDiagnosis;
  client?: RumClientKind;
  sessionsWithErrors?: number | null;
  translator?: Translator;
}): RumSignalEmptyCopy | null {
  return getRumSignalEmptyCopy({
    signal: data.signal,
    diagnosis: data.diagnosis,
    client: data.client || "browser",
    sessionsWithErrors: data.sessionsWithErrors,
    translator: data.translator || ENGLISH,
    now: NOW,
  });
}

describe("the clock these tests read", () => {
  test("is UTC, so a date reads the same on every machine", () => {
    expect(new Date("2026-11-08T12:00:00.000Z").getTimezoneOffset()).toBe(0);
  });
});

describe("formatSinceDate", () => {
  test("a recent date carries its time: right after an upgrade, the day alone says little", () => {
    expect(formatSinceDate(ago(2 * HOUR), NOW)).toMatch(/^Nov 08 2026, 10:00/);
  });

  test("an older date is the day alone", () => {
    expect(formatSinceDate(ago(40 * DAY), NOW)).toBe("Sep 29, 2026");
  });
});

describe("an empty chart says nothing while it loads or once something arrives", () => {
  test.each(["loading", "receiving"] as Array<RumSignalState>)(
    "%s draws no block",
    (state: RumSignalState) => {
      for (const signal of ["exceptions", "logs"] as Array<RumPanelSignal>) {
        expect(copyFor({ signal, diagnosis: diagnosis(state) })).toBeNull();
      }
    },
  );
});

describe("set up but quiet", () => {
  test("exceptions: when the last arrived, and a longer range that shows it", () => {
    expect(
      copyFor({
        signal: "exceptions",
        diagnosis: diagnosis("quiet", {
          lastArrivalAt: ago(3 * HOUR),
          widerRange: { range: TimeRange.PAST_ONE_WEEK },
        }),
      }),
    ).toEqual({
      title: "No exceptions in this time range",
      detail: "The last exception arrived 3 hours ago.",
      action: {
        kind: "set-range",
        label: "Show the past week",
        range: { range: TimeRange.PAST_ONE_WEEK },
      },
    });
  });

  test.each([
    [TimeRange.PAST_ONE_WEEK, "Show the past week"],
    [TimeRange.PAST_ONE_MONTH, "Show the past month"],
    [TimeRange.PAST_THREE_MONTHS, "Show the past 3 months"],
  ])("logs: %s is offered as '%s'", (range: TimeRange, label: string) => {
    const copy: RumSignalEmptyCopy | null = copyFor({
      signal: "logs",
      diagnosis: diagnosis("quiet", {
        lastArrivalAt: ago(10 * DAY),
        widerRange: { range },
      }),
    });

    expect(copy?.title).toBe("No logs in this time range");
    expect(copy?.detail).toBe("The last log arrived 10 days ago.");
    expect(copy?.action).toEqual({
      kind: "set-range",
      label,
      range: { range },
    });
  });

  test("no longer range to offer: the date alone, no action, no help link", () => {
    expect(
      copyFor({
        signal: "logs",
        diagnosis: diagnosis("quiet", { lastArrivalAt: ago(20 * MINUTE) }),
      }),
    ).toEqual({
      title: "No logs in this time range",
      detail: "The last log arrived 20 minutes ago.",
      action: undefined,
    });
  });

  test("a whole app silent since before arrivals were kept: since when, the setup steps and why nothing arrives", () => {
    const since: Date = ago(40 * DAY);

    expect(
      copyFor({
        signal: "logs",
        diagnosis: diagnosis("quiet", { since }),
      }),
    ).toEqual({
      title: "No logs in this time range",
      detail: "Nothing has arrived from this app since Sep 29, 2026.",
      action: { kind: "documentation", label: "See the setup steps" },
      helpLink: {
        text: "Why nothing arrives",
        url: RUM_EMPTY_SIGNALS_DOCS_URL,
      },
    });
  });
});

describe("not set up", () => {
  test("browser exceptions: the SDK reports none on its own, and the dialog that adds the lines", () => {
    expect(
      copyFor({
        signal: "exceptions",
        diagnosis: diagnosis("not-set-up", { cause: "signal" }),
      }),
    ).toEqual({
      title: "Exceptions aren't set up",
      detail:
        "No exception has arrived from this app. The OpenTelemetry browser SDK doesn't report errors on its own: a few lines in your telemetry file report them.",
      evidence: undefined,
      action: {
        kind: "set-up",
        label: "Set up exceptions",
        signal: "exceptions",
      },
      helpLink: {
        text: "Why nothing arrives",
        url: RUM_EMPTY_SIGNALS_DOCS_URL,
      },
    });
  });

  test("recorded sessions with errors are named as the evidence that errors happen", () => {
    expect(
      copyFor({
        signal: "exceptions",
        diagnosis: diagnosis("not-set-up", { cause: "signal" }),
        sessionsWithErrors: 1,
      })?.evidence,
    ).toBe(
      "Session Replay recorded 1 session with an error in this time range, so errors do happen.",
    );
    expect(
      copyFor({
        signal: "exceptions",
        diagnosis: diagnosis("not-set-up", { cause: "signal" }),
        sessionsWithErrors: 7,
      })?.evidence,
    ).toBe(
      "Session Replay recorded 7 sessions with errors in this time range, so errors do happen.",
    );
  });

  test("no recorded session with an error, or none counted: no evidence line", () => {
    for (const sessionsWithErrors of [0, null, undefined]) {
      expect(
        copyFor({
          signal: "exceptions",
          diagnosis: diagnosis("not-set-up", { cause: "signal" }),
          sessionsWithErrors,
        })?.evidence,
      ).toBeUndefined();
    }
  });

  test("the evidence line is for exceptions only", () => {
    expect(
      copyFor({
        signal: "logs",
        diagnosis: diagnosis("not-set-up", { cause: "signal" }),
        sessionsWithErrors: 4,
      })?.evidence,
    ).toBeUndefined();
  });

  test("browser logs, with no date: a log pipeline and code that writes records", () => {
    expect(
      copyFor({
        signal: "logs",
        diagnosis: diagnosis("not-set-up", { cause: "signal" }),
      }),
    ).toEqual({
      title: "Logs aren't set up",
      detail:
        "No logs have arrived from this app. The OpenTelemetry browser SDK sends page loads and requests on its own; logs need a log pipeline and code that writes log records.",
      action: { kind: "set-up", label: "Set up logs", signal: "logs" },
      helpLink: {
        text: "Why nothing arrives",
        url: RUM_EMPTY_SIGNALS_DOCS_URL,
      },
    });
  });

  test("browser logs since their arrivals are kept: the sentence names the date", () => {
    expect(
      copyFor({
        signal: "logs",
        diagnosis: diagnosis("not-set-up", {
          cause: "signal",
          since: ago(40 * DAY),
        }),
      })?.detail,
    ).toBe(
      "No logs have arrived from this app since Sep 29, 2026. The OpenTelemetry browser SDK sends page loads and requests on its own; logs need a log pipeline and code that writes log records.",
    );
  });

  test("a mobile app is sent to the Mobile Setup docs, not to browser code", () => {
    const exceptions: RumSignalEmptyCopy | null = copyFor({
      signal: "exceptions",
      client: "mobile",
      diagnosis: diagnosis("not-set-up", { cause: "signal" }),
    });

    expect(exceptions?.detail).toBe(
      "No exception has arrived from this app. A mobile SDK reports exceptions only where your app or its crash instrumentation records them.",
    );
    expect(exceptions?.action).toEqual({
      kind: "docs",
      label: "Open Mobile Setup",
      url: RUM_MOBILE_SETUP_DOCS_URL,
    });

    const logs: RumSignalEmptyCopy | null = copyFor({
      signal: "logs",
      client: "mobile",
      diagnosis: diagnosis("not-set-up", { cause: "signal" }),
    });

    expect(logs?.detail).toBe(
      "No logs have arrived from this app. A mobile SDK sends logs only once a log exporter is set up and your app writes log records.",
    );
    expect(logs?.action).toEqual({
      kind: "docs",
      label: "Open Mobile Setup",
      url: RUM_MOBILE_SETUP_DOCS_URL,
    });

    expect(
      copyFor({
        signal: "logs",
        client: "mobile",
        diagnosis: diagnosis("not-set-up", {
          cause: "signal",
          since: ago(40 * DAY),
        }),
      })?.detail,
    ).toBe(
      "No logs have arrived from this app since Sep 29, 2026. A mobile SDK sends logs only once a log exporter is set up and your app writes log records.",
    );
  });

  test("only Session Replay reports: the SDK is missing, and the setup steps fix it", () => {
    expect(
      copyFor({
        signal: "exceptions",
        diagnosis: diagnosis("not-set-up", { cause: "sdk" }),
      }),
    ).toEqual({
      title: "The OpenTelemetry SDK isn't reporting",
      detail:
        "Recordings arrive from this app, but exceptions come through the OpenTelemetry browser SDK, which hasn't reported yet.",
      action: { kind: "documentation", label: "See the setup steps" },
    });
    expect(
      copyFor({
        signal: "logs",
        diagnosis: diagnosis("not-set-up", { cause: "sdk" }),
      })?.detail,
    ).toBe(
      "Recordings arrive from this app, but logs come through the OpenTelemetry browser SDK, which hasn't reported yet.",
    );
  });
});

describe("not arriving, and unable to tell", () => {
  test("nothing has arrived from the app: the setup steps, and why nothing arrives", () => {
    expect(
      copyFor({ signal: "exceptions", diagnosis: diagnosis("not-arriving") }),
    ).toEqual({
      title: "Nothing has arrived from this app yet",
      detail:
        "Once its OpenTelemetry SDK reports, page loads and requests come first. Exceptions need a few lines more.",
      action: { kind: "documentation", label: "See the setup steps" },
      helpLink: {
        text: "Why nothing arrives",
        url: RUM_EMPTY_SIGNALS_DOCS_URL,
      },
    });
    expect(
      copyFor({ signal: "logs", diagnosis: diagnosis("not-arriving") })?.detail,
    ).toBe(
      "Once its OpenTelemetry SDK reports, page loads and requests come first. Logs need a log pipeline as well.",
    );
  });

  test("a read that failed says so and offers to try again", () => {
    expect(
      copyFor({ signal: "exceptions", diagnosis: diagnosis("unknown") }),
    ).toEqual({
      title: "Couldn't check why there are no exceptions",
      detail: "Part of the check didn't load. Try again in a moment.",
      action: { kind: "retry", label: "Try again" },
    });
    expect(
      copyFor({ signal: "logs", diagnosis: diagnosis("unknown") })?.title,
    ).toBe("Couldn't check why there are no logs");
  });
});

describe("the setup check's rows", () => {
  function line(
    signal: Exclude<RumSetupCheckSignal, "sessionReplay">,
    state: RumSignalState,
    extra: Partial<RumSignalDiagnosis> = {},
    client: RumClientKind = "browser",
  ): RumSetupCheckLine {
    return getRumSetupCheckLine({
      signal,
      diagnosis: diagnosis(state, extra),
      client,
      translator: ENGLISH,
      now: NOW,
    });
  }

  test("labels, in the order the card draws them; a mobile app's spans are Traces", () => {
    expect(Object.keys(SETUP_CHECK_LABELS)).toEqual([
      "traces",
      "exceptions",
      "logs",
      "webVitals",
      "sessionReplay",
    ]);
    expect(
      (Object.keys(SETUP_CHECK_LABELS) as Array<RumSetupCheckSignal>).map(
        (signal: RumSetupCheckSignal): string => {
          return getRumSetupCheckLabel(signal, "browser", ENGLISH);
        },
      ),
    ).toEqual([
      "Page loads and requests",
      "Exceptions",
      "Logs",
      "Web Vitals",
      "Session Replay",
    ]);
    expect(getRumSetupCheckLabel("traces", "mobile", ENGLISH)).toBe("Traces");
    expect(getRumSetupCheckLabel("logs", "mobile", ENGLISH)).toBe("Logs");
  });

  test("loading reads Checking", () => {
    expect(line("logs", "loading")).toEqual({
      tone: "waiting",
      text: "Checking…",
    });
  });

  test("arriving, with when the latest came in", () => {
    expect(
      line("traces", "receiving", { lastArrivalAt: ago(2 * MINUTE) }),
    ).toEqual({
      tone: "ok",
      text: "Arriving. The latest came in 2 minutes ago.",
    });
  });

  test("quiet, with when the latest came in", () => {
    expect(
      line("exceptions", "quiet", { lastArrivalAt: ago(3 * DAY) }),
    ).toEqual({
      tone: "waiting",
      text: "Quiet. The latest came in 3 days ago.",
    });
  });

  test("a silent app: since when nothing has arrived", () => {
    expect(line("logs", "quiet", { since: ago(40 * DAY) })).toEqual({
      tone: "waiting",
      text: "Quiet. Nothing has arrived from this app since Sep 29, 2026.",
    });
  });

  test("not set up, with or without a date, the reason, and the step that sets it up", () => {
    expect(line("exceptions", "not-set-up", { cause: "signal" })).toEqual({
      tone: "warning",
      text: "Not set up. Nothing has arrived yet.",
      detail: "The browser SDK doesn't report errors on its own.",
      action: {
        kind: "set-up",
        label: "Set up exceptions",
        signal: "exceptions",
      },
    });
    expect(
      line("logs", "not-set-up", { cause: "signal", since: ago(40 * DAY) }),
    ).toEqual({
      tone: "warning",
      text: "Not set up. Nothing has arrived since Sep 29, 2026.",
      detail: "The browser SDK sends no logs on its own.",
      action: { kind: "set-up", label: "Set up logs", signal: "logs" },
    });
  });

  test("traces not set up: the reason, and no action - the guide is right below", () => {
    expect(line("traces", "not-set-up", { cause: "signal" })).toEqual({
      tone: "warning",
      text: "Not set up. Nothing has arrived yet.",
      detail:
        "Page loads and requests come from the OpenTelemetry browser SDK, which the steps below set up.",
      action: undefined,
    });
  });

  test("Web Vitals not set up: the docs that add the web-vitals library", () => {
    expect(line("webVitals", "not-set-up", { cause: "signal" })).toEqual({
      tone: "warning",
      text: "Not set up. Nothing has arrived yet.",
      detail:
        "Web Vitals are metrics your app reports with the web-vitals library.",
      action: {
        kind: "docs",
        label: "Set up Web Vitals",
        url: RUM_WEB_VITALS_DOCS_URL,
      },
    });
  });

  test("Web Vitals under other names: said as such, with the same docs", () => {
    expect(line("webVitals", "not-set-up", { cause: "names" })).toEqual({
      tone: "warning",
      text: "Not found. Metrics arrive, but none in the past 30 days under a name the Web Vitals card reads.",
      action: {
        kind: "docs",
        label: "Set up Web Vitals",
        url: RUM_WEB_VITALS_DOCS_URL,
      },
    });
  });

  test("the SDK missing: said on the row, with the signal's reason", () => {
    expect(line("logs", "not-set-up", { cause: "sdk" })).toEqual({
      tone: "warning",
      text: "Not set up. Only Session Replay reports from this app.",
      detail: "The browser SDK sends no logs on its own.",
    });
  });

  test("nothing arrived from the app: waiting", () => {
    expect(line("traces", "not-arriving")).toEqual({
      tone: "waiting",
      text: "Waiting. Nothing has arrived from this app yet.",
      detail:
        "Page loads and requests come from the OpenTelemetry browser SDK, which the steps below set up.",
    });
  });

  test("a read that failed: couldn't be checked", () => {
    expect(line("exceptions", "unknown")).toEqual({
      tone: "off",
      text: "Couldn't be checked.",
    });
  });

  test("a mobile app's rows give the mobile reasons and the Mobile Setup docs", () => {
    expect(
      line("traces", "not-set-up", { cause: "signal" }, "mobile").detail,
    ).toBe(
      "App starts and requests come from the OpenTelemetry mobile SDK, which the steps below set up.",
    );
    expect(
      line("exceptions", "not-set-up", { cause: "signal" }, "mobile"),
    ).toEqual({
      tone: "warning",
      text: "Not set up. Nothing has arrived yet.",
      detail:
        "A mobile SDK reports exceptions only where your app or its crash instrumentation records them.",
      action: {
        kind: "docs",
        label: "Open Mobile Setup",
        url: RUM_MOBILE_SETUP_DOCS_URL,
      },
    });
    expect(
      line("logs", "not-set-up", { cause: "signal" }, "mobile").detail,
    ).toBe("A mobile SDK sends logs only once a log exporter is set up.");
  });
});

describe("the Session Replay row", () => {
  function failure(
    kind: SessionReplayHealthErrorKind,
  ): SessionReplayHealthError {
    return { kind, message: "refused" };
  }

  function replay(data: {
    isLoading?: boolean;
    error?: SessionReplayHealthError | null;
    state?: RecordingHealthState;
    lastChunkReceivedAt?: Date | null;
  }): RumSetupCheckLine | null {
    return getSessionReplaySetupCheckLine({
      isLoading: data.isLoading || false,
      error: data.error || null,
      state: data.state || "healthy",
      lastChunkReceivedAt: data.lastChunkReceivedAt || null,
      translator: ENGLISH,
      now: NOW,
    });
  }

  test("while the health loads: Checking", () => {
    expect(replay({ isLoading: true })).toEqual({
      tone: "waiting",
      text: "Checking…",
    });
  });

  test("a reader without Session Replay - no permission, or not in the plan - gets no row", () => {
    expect(replay({ error: failure("permission") })).toBeNull();
    expect(replay({ error: failure("plan") })).toBeNull();
  });

  test("any other failure is named, never silent", () => {
    expect(replay({ error: failure("other") })).toEqual({
      tone: "off",
      text: "Couldn't be checked.",
    });
  });

  test("healthy: the Overview's word, the latest recording, no action", () => {
    expect(
      replay({ state: "healthy", lastChunkReceivedAt: ago(4 * MINUTE) }),
    ).toEqual({
      tone: "ok",
      text: "Healthy",
      detail: "The latest recording came in 4 minutes ago.",
      action: undefined,
    });
  });

  test.each([
    ["disabled-project", "off"],
    ["disabled-app", "off"],
    ["budget-paused", "error"],
    ["refusing", "error"],
    ["never-loaded", "warning"],
    ["loaded-never-uploaded", "warning"],
    ["stale", "warning"],
    ["healthy-quiet", "waiting"],
    ["unknown", "off"],
  ] as Array<[RecordingHealthState, string]>)(
    "%s: tone %s, the Overview's words, and Recording Health to say the rest",
    (state: RecordingHealthState, tone: string) => {
      expect(replay({ state })).toEqual({
        tone,
        text: RECORDING_HEALTH_ROW_WORDS[state],
        detail: undefined,
        action: {
          kind: "recording-health",
          label: "Open Recording Health",
        },
      });
    },
  );
});

describe("in German", () => {
  const GERMAN: Translator = localeTranslator("de");

  test("every sentence an empty chart can say reads in German, with its date in German", () => {
    withDateDisplayLanguage("de", () => {
      const quiet: RumSignalEmptyCopy | null = copyFor({
        signal: "logs",
        translator: GERMAN,
        diagnosis: diagnosis("quiet", {
          lastArrivalAt: ago(3 * HOUR),
          widerRange: { range: TimeRange.PAST_ONE_WEEK },
        }),
      });

      expect(quiet?.title).not.toBe("No logs in this time range");
      expect(quiet?.detail).toContain("vor 3 Stunden");
      expect(quiet?.detail).not.toContain("The last log arrived");
      expect(quiet?.action?.label).not.toBe("Show the past week");
    });

    const cases: Array<{
      signal: RumPanelSignal;
      diagnosis: RumSignalDiagnosis;
      client?: RumClientKind;
    }> = [
      {
        signal: "exceptions",
        diagnosis: diagnosis("not-set-up", { cause: "signal" }),
      },
      {
        signal: "exceptions",
        client: "mobile",
        diagnosis: diagnosis("not-set-up", { cause: "signal" }),
      },
      {
        signal: "logs",
        diagnosis: diagnosis("not-set-up", { cause: "signal" }),
      },
      {
        signal: "logs",
        diagnosis: diagnosis("not-set-up", {
          cause: "signal",
          since: ago(40 * DAY),
        }),
      },
      { signal: "logs", diagnosis: diagnosis("not-set-up", { cause: "sdk" }) },
      { signal: "exceptions", diagnosis: diagnosis("not-arriving") },
      { signal: "logs", diagnosis: diagnosis("unknown") },
      {
        signal: "logs",
        diagnosis: diagnosis("quiet", { since: ago(40 * DAY) }),
      },
    ];

    for (const item of cases) {
      const english: RumSignalEmptyCopy | null = copyFor(item);
      const german: RumSignalEmptyCopy | null = copyFor({
        ...item,
        translator: GERMAN,
      });

      expect(german?.title).toBeTruthy();
      expect(german?.title).not.toBe(english?.title);
      expect(german?.detail).not.toBe(english?.detail);

      if (english?.action) {
        expect(german?.action?.label).not.toBe(english.action.label);
      }

      if (english?.helpLink) {
        expect(german?.helpLink?.text).not.toBe(english.helpLink.text);
        expect(german?.helpLink?.url).toBe(english.helpLink.url);
      }
    }
  });

  test("the setup check reads in German", () => {
    expect(getRumSetupCheckLabel("traces", "browser", GERMAN)).not.toBe(
      "Page loads and requests",
    );

    const row: RumSetupCheckLine = getRumSetupCheckLine({
      signal: "logs",
      diagnosis: diagnosis("not-set-up", { cause: "signal" }),
      client: "browser",
      translator: GERMAN,
      now: NOW,
    });

    expect(row.text).not.toBe("Not set up. Nothing has arrived yet.");
    expect(row.detail).not.toBe("The browser SDK sends no logs on its own.");
    expect(row.action?.label).not.toBe("Set up logs");
  });

  test("the evidence line counts in German", () => {
    const german: RumSignalEmptyCopy | null = copyFor({
      signal: "exceptions",
      translator: GERMAN,
      sessionsWithErrors: 3,
      diagnosis: diagnosis("not-set-up", { cause: "signal" }),
    });

    expect(german?.evidence).toContain("3");
    expect(german?.evidence).not.toContain("Session Replay recorded");
  });
});
