import { describe, expect, test } from "@jest/globals";
import {
  describeRefusalReason,
  diagnoseRecordingHealth,
  formatBytesForCopy,
  formatCountForCopy,
  formatDurationForCopy,
  formatRelativeAge,
} from "../../../Utils/SessionReplay/SessionReplayHealth";
import {
  RecordingHealthDiagnosis,
  RecordingHealthState,
  RecordingHealthStatus,
  SESSION_REPLAY_REFUSAL_REASONS,
  SessionReplayRefusalReason,
} from "../../../Types/Rum/SessionReplayHealth";
import SessionReplayCaptureTrigger from "../../../Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "../../../Types/Rum/SessionReplayConsentMode";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  Translator,
} from "../../../Types/Translator";

/*
 * Recording health in the reader's language (#6369). The diagnosis - the
 * one sentence the Health page, the policy page's card, the setup guide,
 * the installation test and the list's empty state all show - was English
 * in every language, built from pieces ("Session replay is switched off" +
 * " for acme-web", "Uploads paused" + " 3h ago").
 *
 * A marking translator wraps whatever it looks up in ⟦ ⟧, so a sentence
 * looked up whole reads ⟦...⟧ end to end, its values inside: an age or a
 * duration in the sentence's language (⟦3h ago⟧), a refusal's label as a
 * term (⟦origin not allowed⟧), an application's identifier as written.
 * Without a translator every word is English, word for word, which
 * SessionReplayHealthDiagnosis.test.ts and SessionReplayHealth.test.ts pin.
 */

const NOW: number = Date.UTC(2026, 8, 4, 12, 0, 0);
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;
const MB: number = 1024 * 1024;
const GB: number = 1024 * MB;

const OPEN: string = "⟦";
const CLOSE: string = "⟧";

const marking: Translator = createTranslator((text: string): string => {
  return `${OPEN}${text}${CLOSE}`;
}, "de");

const english: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

/*
 * One lookup encloses the whole text: it opens with ⟦, and the ⟦ it opens
 * with is the one its last ⟧ closes - no word outside, nothing glued on.
 */
function isWhollyMarked(text: string): boolean {
  if (!text.startsWith(OPEN) || !text.endsWith(CLOSE)) {
    return false;
  }

  let depth: number = 0;

  for (let index: number = 0; index < text.length; index++) {
    const character: string = text.charAt(index);

    if (character === OPEN) {
      depth += 1;
    } else if (character === CLOSE) {
      depth -= 1;

      if (depth === 0 && index !== text.length - 1) {
        return false;
      }
    }
  }

  return depth === 0;
}

function healthy(
  overrides?: Partial<RecordingHealthStatus>,
): RecordingHealthStatus {
  const base: RecordingHealthStatus = {
    appIdentifier: "acme-web",
    allowedOrigins: ["https://acme.com"],
    policy: {
      isProjectEnabled: true,
      isApplicationEnabled: true,
      captureTrigger: SessionReplayCaptureTrigger.Always,
      samplePercentage: 100,
      consentMode: SessionReplayConsentMode.NotRequired,
      maskingMode: "MaskSensitiveInputsOnly",
      retentionInDays: 7,
    },
    publishedRecorderVersion: "1.2.3",
    lastConfigFetchAt: iso(-5 * SECOND),
    lastChunkReceivedAt: iso(-12 * SECOND),
    lastSessionStartedAt: iso(-2 * MINUTE),
    budgetExceededAt: null,
    sessionsLast24h: 143,
    playableSessionsLast24h: 120,
    refusalsLast24h: [],
    projectBytesUsedToday: 10 * MB,
    dailyByteLimit: GB,
    applicationBytesUsedThisMonth: 200 * MB,
    monthlyBudgetInGB: 2,
  };

  return { ...base, ...overrides } as RecordingHealthStatus;
}

function withPolicy(
  policy: Partial<RecordingHealthStatus["policy"]>,
  overrides?: Partial<RecordingHealthStatus>,
): RecordingHealthStatus {
  const base: RecordingHealthStatus = healthy(overrides);

  return { ...base, policy: { ...base.policy, ...policy } };
}

interface Case {
  name: string;
  state: RecordingHealthState;
  status: RecordingHealthStatus | null;
}

/* Every state, and every wording each state has. */
const CASES: Array<Case> = [
  { name: "unknown", state: "unknown", status: null },
  {
    name: "disabled-project",
    state: "disabled-project",
    status: withPolicy({ isProjectEnabled: false }),
  },
  {
    name: "disabled-app, named",
    state: "disabled-app",
    status: withPolicy({ isApplicationEnabled: false }),
  },
  {
    name: "disabled-app, no identifier",
    state: "disabled-app",
    status: withPolicy({ isApplicationEnabled: false }, { appIdentifier: "" }),
  },
  {
    name: "budget-paused, monthly, with its time and size",
    state: "budget-paused",
    status: healthy({
      budgetExceededAt: iso(-3 * HOUR),
      applicationBytesUsedThisMonth: 3 * GB,
      monthlyBudgetInGB: 2,
    }),
  },
  {
    name: "budget-paused, monthly, without either",
    state: "budget-paused",
    status: healthy({
      budgetExceededAt: "not a date",
      applicationBytesUsedThisMonth: null,
      monthlyBudgetInGB: null,
    }),
  },
  {
    name: "budget-paused, daily",
    state: "budget-paused",
    status: healthy({ projectBytesUsedToday: 2 * GB, dailyByteLimit: GB }),
  },
  ...SESSION_REPLAY_REFUSAL_REASONS.map(
    (reason: SessionReplayRefusalReason): Case => {
      return {
        name: `refusing, ${reason}`,
        state: "refusing",
        status: healthy({ refusalsLast24h: [{ reason: reason, count: 1200 }] }),
      };
    },
  ),
  {
    name: "never-loaded, named",
    state: "never-loaded",
    status: healthy({ lastConfigFetchAt: null, lastChunkReceivedAt: null }),
  },
  {
    name: "never-loaded, no identifier",
    state: "never-loaded",
    status: healthy({
      appIdentifier: "",
      lastConfigFetchAt: null,
      lastChunkReceivedAt: null,
    }),
  },
  {
    name: "loaded-never-uploaded, sampling 0%",
    state: "loaded-never-uploaded",
    status: withPolicy(
      { samplePercentage: 0 },
      { lastConfigFetchAt: iso(-2 * MINUTE), lastChunkReceivedAt: null },
    ),
  },
  {
    name: "loaded-never-uploaded, waiting for consent",
    state: "loaded-never-uploaded",
    status: withPolicy(
      { consentMode: SessionReplayConsentMode.RequireExplicit },
      { lastConfigFetchAt: iso(-2 * MINUTE), lastChunkReceivedAt: null },
    ),
  },
  {
    name: "loaded-never-uploaded, error-only trigger",
    state: "loaded-never-uploaded",
    status: withPolicy(
      { captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration },
      { lastConfigFetchAt: iso(-2 * MINUTE), lastChunkReceivedAt: null },
    ),
  },
  {
    name: "loaded-never-uploaded, blocked on the way",
    state: "loaded-never-uploaded",
    status: healthy({
      lastConfigFetchAt: iso(-2 * MINUTE),
      lastChunkReceivedAt: null,
    }),
  },
  {
    name: "stale",
    state: "stale",
    status: healthy({
      lastConfigFetchAt: iso(-2 * MINUTE),
      lastChunkReceivedAt: iso(-7 * HOUR),
    }),
  },
  {
    name: "healthy-quiet, an older server",
    state: "healthy-quiet",
    status: healthy({
      lastConfigFetchAt: null,
      lastChunkReceivedAt: iso(-8 * HOUR),
    }),
  },
  {
    name: "healthy-quiet, no recorder running",
    state: "healthy-quiet",
    status: healthy({
      lastConfigFetchAt: iso(-2 * DAY),
      lastChunkReceivedAt: iso(-2 * DAY),
    }),
  },
  { name: "healthy", state: "healthy", status: healthy() },
  {
    name: "healthy, one session, playable unknown",
    state: "healthy",
    status: healthy({ sessionsLast24h: 1, playableSessionsLast24h: null }),
  },
  {
    name: "healthy, sessions unknown",
    state: "healthy",
    status: healthy({ sessionsLast24h: null, playableSessionsLast24h: null }),
  },
];

describe("the diagnosis in the reader's language", () => {
  test("the cases reach every state of the diagnosis", () => {
    const states: Set<RecordingHealthState> = new Set<RecordingHealthState>(
      CASES.map((entry: Case): RecordingHealthState => {
        return entry.state;
      }),
    );

    expect(Array.from(states).sort()).toEqual(
      [
        "budget-paused",
        "disabled-app",
        "disabled-project",
        "healthy",
        "healthy-quiet",
        "loaded-never-uploaded",
        "never-loaded",
        "refusing",
        "stale",
        "unknown",
      ].sort(),
    );
  });

  for (const entry of CASES) {
    test(`${entry.name}: the title, the detail and the action are each looked up whole`, () => {
      const diagnosis: RecordingHealthDiagnosis = diagnoseRecordingHealth(
        entry.status,
        NOW,
        marking,
      );
      const texts: Array<string> = [diagnosis.title, diagnosis.detail];

      if (diagnosis.action) {
        texts.push(diagnosis.action.label);
      }

      expect(diagnosis.state).toBe(entry.state);

      for (const text of texts) {
        expect({ text, whole: isWhollyMarked(text) }).toEqual({
          text,
          whole: true,
        });
        // Every value is in place: no placeholder is left to fill.
        expect(text).not.toContain("{{");
      }
    });

    test(`${entry.name}: without a translator, and with an English one, it is the same English`, () => {
      const plain: RecordingHealthDiagnosis = diagnoseRecordingHealth(
        entry.status,
        NOW,
      );

      expect(diagnoseRecordingHealth(entry.status, NOW, english)).toEqual(
        plain,
      );
      expect(JSON.stringify(plain)).not.toContain(OPEN);
    });
  }

  test("an application's identifier goes into the sentence as written, never glued after it", () => {
    expect(
      diagnoseRecordingHealth(
        withPolicy({ isApplicationEnabled: false }),
        NOW,
        marking,
      ).title,
    ).toBe(`${OPEN}Session replay is switched off for acme-web${CLOSE}`);
    expect(
      diagnoseRecordingHealth(
        healthy({ lastConfigFetchAt: null, lastChunkReceivedAt: null }),
        NOW,
        marking,
      ).title,
    ).toBe(`${OPEN}The recorder has never loaded for acme-web${CLOSE}`);
  });

  test("ages and durations are written in the sentence, in its language", () => {
    expect(
      diagnoseRecordingHealth(
        healthy({
          budgetExceededAt: iso(-3 * HOUR),
          applicationBytesUsedThisMonth: 3 * GB,
          monthlyBudgetInGB: 2,
        }),
        NOW,
        marking,
      ).title,
    ).toBe(`${OPEN}Uploads paused ${OPEN}3h ago${CLOSE}${CLOSE}`);

    const stale: RecordingHealthDiagnosis = diagnoseRecordingHealth(
      healthy({
        lastConfigFetchAt: iso(-2 * MINUTE),
        lastChunkReceivedAt: iso(-7 * HOUR),
      }),
      NOW,
      marking,
    );

    expect(stale.title).toBe(
      `${OPEN}No chunk for ${OPEN}7h${CLOSE} while the recorder keeps loading${CLOSE}`,
    );
    // Its explanation is a sentence of its own, looked up whole too.
    expect(stale.detail).toContain(
      `${OPEN}The policy fetch succeeds but no chunk has arrived.`,
    );
    expect(stale.detail).toContain(`${OPEN}2m ago${CLOSE}`);
    expect(stale.detail).toContain(`${OPEN}7h ago${CLOSE}`);
  });

  test("counts and byte figures are written as the reader's language writes a number", () => {
    expect(
      diagnoseRecordingHealth(
        healthy({
          refusalsLast24h: [{ reason: "origin-not-allowed", count: 1200 }],
        }),
        NOW,
        marking,
      ).title,
    ).toBe(
      `${OPEN}1.200 uploads refused in 24h: ${OPEN}origin not allowed${CLOSE}${CLOSE}`,
    );
    expect(
      diagnoseRecordingHealth(
        healthy({ projectBytesUsedToday: 2.5 * GB, dailyByteLimit: GB }),
        NOW,
        marking,
      ).detail,
    ).toBe(
      `${OPEN}This project used its 1 GB daily budget for session replay (2,5 GB used). Uploads resume tomorrow.${CLOSE}`,
    );
  });

  test("the healthy line's sessions are a phrase of their own, counted in the reader's form", () => {
    expect(
      diagnoseRecordingHealth(
        healthy({ sessionsLast24h: 2500, playableSessionsLast24h: 2400 }),
        NOW,
        marking,
      ).detail,
    ).toBe(
      `${OPEN}Last chunk ${OPEN}12s ago${CLOSE} - ${OPEN}2.500 sessions in 24h (2.400 playable)${CLOSE} - sampling 100%.${CLOSE}`,
    );
  });

  /*
   * A language that words an age but not yet the sentence it goes into
   * reads the sentence in English with its English age, never "Uploads
   * paused vor 3 Std."; once it words the sentence, the age follows.
   */
  test("a sentence a language has not worded yet reads wholly in English, its age too", () => {
    const status: RecordingHealthStatus = healthy({
      budgetExceededAt: iso(-3 * HOUR),
      applicationBytesUsedThisMonth: 3 * GB,
    });
    const wordsTheAgeOnly: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === "{{count}}h ago" ? "vor {{count}} Std." : undefined;
      },
      "de",
    );
    const wordsBoth: Translator = createTranslator(
      (text: string): string | undefined => {
        if (text === "{{count}}h ago") {
          return "vor {{count}} Std.";
        }

        return text === "Uploads paused {{age}}"
          ? "Uploads pausiert {{age}}"
          : undefined;
      },
      "de",
    );

    expect(diagnoseRecordingHealth(status, NOW, wordsTheAgeOnly).title).toBe(
      "Uploads paused 3h ago",
    );
    expect(diagnoseRecordingHealth(status, NOW, wordsBoth).title).toBe(
      "Uploads pausiert vor 3 Std.",
    );
  });
});

describe("describeRefusalReason in the reader's language", () => {
  test("every reason's label is looked up, and English without a translator", () => {
    for (const reason of SESSION_REPLAY_REFUSAL_REASONS) {
      const label: string | null = describeRefusalReason(reason);

      expect(label).not.toBeNull();
      expect(describeRefusalReason(reason, marking)).toBe(
        `${OPEN}${label}${CLOSE}`,
      );
      expect(label).not.toContain(OPEN);
    }

    expect(describeRefusalReason("origin-not-allowed")).toBe(
      "origin not allowed",
    );
  });

  test("a reason this build has no words for is still null", () => {
    expect(describeRefusalReason("scrub-incomplete", marking)).toBeNull();
  });
});

describe("the copy formatters in the reader's language", () => {
  test("an age: the reader's words, English without a translator", () => {
    expect(formatRelativeAge(NOW - 5 * MINUTE, NOW, marking)).toBe(
      `${OPEN}5m ago${CLOSE}`,
    );
    expect(formatRelativeAge(NOW - 3 * DAY, NOW, marking)).toBe(
      `${OPEN}3d ago${CLOSE}`,
    );
    expect(formatRelativeAge(NOW, NOW, marking)).toBe(
      `${OPEN}just now${CLOSE}`,
    );
    expect(formatRelativeAge(Number.NaN, NOW, marking)).toBe(
      `${OPEN}unknown${CLOSE}`,
    );
    expect(formatRelativeAge(NOW - 5 * MINUTE, NOW)).toBe("5m ago");
    expect(formatRelativeAge(NOW, NOW)).toBe("just now");
  });

  test("a duration: the reader's words, English without a translator", () => {
    expect(formatDurationForCopy(45 * SECOND, marking)).toBe(
      `${OPEN}45s${CLOSE}`,
    );
    expect(formatDurationForCopy(7 * HOUR, marking)).toBe(`${OPEN}7h${CLOSE}`);
    expect(formatDurationForCopy(-1, marking)).toBe(`${OPEN}unknown${CLOSE}`);
    expect(formatDurationForCopy(7 * HOUR)).toBe("7h");
  });

  test("a count: the reader's digits and grouping, English without a translator", () => {
    expect(formatCountForCopy(1234, marking)).toBe("1.234");
    expect(formatCountForCopy(null, marking)).toBe(`${OPEN}unknown${CLOSE}`);
    expect(formatCountForCopy(1234)).toBe("1,234");
    expect(formatCountForCopy(null)).toBe("unknown");
  });

  test("bytes: the reader's figure beside the unit, English without a translator", () => {
    expect(formatBytesForCopy(2.5 * GB, marking)).toBe("2,5 GB");
    expect(formatBytesForCopy(512 * MB, marking)).toBe("512 MB");
    expect(formatBytesForCopy(-1, marking)).toBe(`${OPEN}unknown${CLOSE}`);
    expect(formatBytesForCopy(2.5 * GB)).toBe("2.5 GB");
    expect(formatBytesForCopy(-1)).toBe("unknown");
  });
});
