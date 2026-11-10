import { describe, expect, test } from "@jest/globals";
import {
  RecordingHealthDiagnosis,
  RecordingHealthStatus,
} from "Common/Types/Rum/SessionReplayHealth";
import { diagnoseRecordingHealth } from "Common/Utils/Rum/SessionReplayHealth";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  Translator,
} from "Common/Types/Translator";
import {
  HealthCounterBreakdown,
  RecordingPipelineStage,
  UsageMeter,
  buildCounterBreakdown,
  buildRecordingPipeline,
  buildUsageMeter,
  describePollInterval,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthModel";

/*
 * The Replay Health page's pipeline, counters, meters and refresh line in
 * the reader's language (#6369). The model writes every value and caption
 * with the Translator the page hands it; a marking translator wraps each
 * lookup in ⟦ ⟧, so a caption looked up whole reads ⟦...⟧ end to end, its
 * age, duration or count inside. A stage's label stays its English key: the
 * page looks it up where it draws it, and the (i) beside it looks it up
 * itself. Without a translator everything is English, word for word, as
 * RecordingHealthModel.test.ts pins.
 */

const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");
const SECOND_MS: number = 1000;
const MINUTE_MS: number = 60 * SECOND_MS;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;
const MB: number = 1024 * 1024;
const GB: number = 1024 * MB;

const OPEN: string = "⟦";
const CLOSE: string = "⟧";

const marking: Translator = createTranslator((text: string): string => {
  return `${OPEN}${text}${CLOSE}`;
}, "de");

const english: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

// A number as German writes it: "143", "1.234.567".
const GERMAN_NUMBER: RegExp = /^\d{1,3}(\.\d{3})*$/;

const STAGE_LABELS: Array<string> = [
  "Recorder loaded",
  "Recording allowed",
  "Chunks received",
  "Sessions in 24h",
];

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

function iso(ageMs: number): string {
  return new Date(NOW - ageMs).toISOString();
}

function makeStatus(
  overrides?: Partial<RecordingHealthStatus>,
): RecordingHealthStatus {
  const base: RecordingHealthStatus = {
    appIdentifier: "acme-web",
    allowedOrigins: ["https://app.acme.com"],
    policy: {
      isProjectEnabled: true,
      isApplicationEnabled: true,
      captureTrigger: "Always",
      samplePercentage: 100,
      consentMode: "NotRequired",
      maskingMode: "MaskSensitiveInputsOnly",
      retentionInDays: 7,
    },
    publishedRecorderVersion: "1.4.0",
    lastConfigFetchAt: iso(45 * SECOND_MS),
    lastChunkReceivedAt: iso(30 * SECOND_MS),
    lastSessionStartedAt: iso(7 * MINUTE_MS),
    budgetExceededAt: null,
    sessionsLast24h: 143,
    playableSessionsLast24h: 120,
    refusalsLast24h: [],
    dropsLast24h: [],
    projectBytesUsedToday: 10 * MB,
    dailyByteLimit: GB,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
  };

  return { ...base, ...overrides } as RecordingHealthStatus;
}

function withPolicy(
  policy: Partial<RecordingHealthStatus["policy"]>,
  overrides?: Partial<RecordingHealthStatus>,
): RecordingHealthStatus {
  const status: RecordingHealthStatus = makeStatus(overrides);

  return { ...status, policy: { ...status.policy, ...policy } };
}

function pipeline(
  status: RecordingHealthStatus,
  translator?: Translator,
): Array<RecordingPipelineStage> {
  const diagnosis: RecordingHealthDiagnosis = diagnoseRecordingHealth(
    status,
    NOW,
    translator,
  );

  return buildRecordingPipeline(status, diagnosis, NOW, translator);
}

/* Statuses that take every stage down each of its branches. */
const STATUSES: Array<{ name: string; status: RecordingHealthStatus }> = [
  { name: "healthy", status: makeStatus() },
  {
    name: "no policy-fetch stamp, a chunk arrived",
    status: makeStatus({ lastConfigFetchAt: null }),
  },
  {
    name: "never loaded",
    status: makeStatus({ lastConfigFetchAt: null, lastChunkReceivedAt: null }),
  },
  {
    name: "unreadable stamps",
    status: makeStatus({
      lastConfigFetchAt: "not a date",
      lastChunkReceivedAt: "not a date",
    }),
  },
  {
    name: "silent for days",
    status: makeStatus({
      lastConfigFetchAt: iso(2 * DAY_MS),
      lastChunkReceivedAt: iso(2 * DAY_MS),
    }),
  },
  {
    name: "project switched off",
    status: withPolicy({ isProjectEnabled: false }),
  },
  {
    name: "application switched off",
    status: withPolicy({ isApplicationEnabled: false }),
  },
  {
    name: "budget spent",
    status: makeStatus({ projectBytesUsedToday: GB, dailyByteLimit: GB }),
  },
  { name: "sampling 0%", status: withPolicy({ samplePercentage: 0 }) },
  {
    name: "error-only trigger with consent",
    status: withPolicy({
      captureTrigger: "OnErrorOrFrustration",
      consentMode: "RequireExplicit",
    }),
  },
  {
    name: "a trigger this build does not know",
    status: withPolicy({ captureTrigger: "SomethingNew" }),
  },
  {
    name: "refusals",
    status: makeStatus({
      refusalsLast24h: [
        { reason: "origin-not-allowed", count: 1200 },
        { reason: "rate-limited", count: 34 },
      ],
    }),
  },
  {
    name: "loaded, never uploaded",
    status: makeStatus({ lastChunkReceivedAt: null }),
  },
  {
    name: "sessions unknown",
    status: makeStatus({
      sessionsLast24h: null,
      playableSessionsLast24h: null,
    }),
  },
  { name: "no sessions", status: makeStatus({ sessionsLast24h: 0 }) },
  {
    name: "nothing playable",
    status: makeStatus({ sessionsLast24h: 4, playableSessionsLast24h: 0 }),
  },
  {
    name: "playable unknown, newest start unknown",
    status: makeStatus({
      playableSessionsLast24h: null,
      lastSessionStartedAt: null,
    }),
  },
  {
    name: "playable unknown, newest start known",
    status: makeStatus({ playableSessionsLast24h: null }),
  },
  {
    name: "playable known, newest start unknown",
    status: makeStatus({ lastSessionStartedAt: null }),
  },
];

describe("buildRecordingPipeline in the reader's language", () => {
  for (const entry of STATUSES) {
    test(`${entry.name}: every caption and value is looked up whole; labels stay keys`, () => {
      for (const stage of pipeline(entry.status, marking)) {
        expect(STAGE_LABELS).toContain(stage.label);
        expect({
          key: stage.key,
          caption: stage.caption,
          whole: isWhollyMarked(stage.caption),
        }).toEqual({ key: stage.key, caption: stage.caption, whole: true });
        expect({
          key: stage.key,
          value: stage.value,
          whole: isWhollyMarked(stage.value) || GERMAN_NUMBER.test(stage.value),
        }).toEqual({ key: stage.key, value: stage.value, whole: true });
        expect(`${stage.value} ${stage.caption}`).not.toContain("{{");
      }
    });

    test(`${entry.name}: English, word for word, without a translator`, () => {
      expect(pipeline(entry.status, english)).toEqual(pipeline(entry.status));
      expect(JSON.stringify(pipeline(entry.status))).not.toContain(OPEN);
    });
  }

  test("the values and captions carry their ages, durations and counts in place", () => {
    const healthyStages: Array<RecordingPipelineStage> = pipeline(
      makeStatus(),
      marking,
    );

    expect(healthyStages[0]!.value).toBe(`${OPEN}45s ago${CLOSE}`);
    expect(healthyStages[1]!.value).toBe(`${OPEN}100% sampled${CLOSE}`);
    expect(healthyStages[1]!.caption).toBe(
      `${OPEN}${OPEN}Always${CLOSE}; no consent prompt required.${CLOSE}`,
    );
    expect(healthyStages[3]!.caption).toBe(
      `${OPEN}120 playable; the newest started ${OPEN}7m ago${CLOSE}.${CLOSE}`,
    );

    const refused: Array<RecordingPipelineStage> = pipeline(
      makeStatus({
        refusalsLast24h: [{ reason: "origin-not-allowed", count: 1200 }],
      }),
      marking,
    );

    expect(refused[2]!.value).toBe(`${OPEN}1.200 refused${CLOSE}`);
    expect(refused[2]!.caption).toBe(
      `${OPEN}In the last 24h, mostly ${OPEN}origin not allowed${CLOSE}.${CLOSE}`,
    );

    const silent: Array<RecordingPipelineStage> = pipeline(
      makeStatus({
        lastConfigFetchAt: iso(2 * DAY_MS),
        lastChunkReceivedAt: iso(2 * DAY_MS),
      }),
      marking,
    );

    expect(silent[0]!.caption).toBe(
      `${OPEN}No page has loaded the recorder for ${OPEN}2d${CLOSE}.${CLOSE}`,
    );
    expect(silent[2]!.caption).toBe(
      `${OPEN}No chunk has arrived for ${OPEN}2d${CLOSE}.${CLOSE}`,
    );
  });

  test("a large session count is written the reader's way", () => {
    expect(
      pipeline(
        makeStatus({ sessionsLast24h: 1234567, playableSessionsLast24h: 1000 }),
        marking,
      )[3]!.value,
    ).toBe("1.234.567");
  });
});

describe("buildCounterBreakdown in the reader's language", () => {
  test("a known refusal reason is labelled in the reader's words; an open-vocabulary one keeps its slug", () => {
    const breakdown: HealthCounterBreakdown = buildCounterBreakdown(
      [
        { reason: "origin-not-allowed", count: 2 },
        { reason: "scrub-incomplete", count: 1 },
      ],
      marking,
    );

    if (breakdown.kind !== "list") {
      throw new Error("expected a list");
    }

    expect(breakdown.rows[0]!.label).toBe(`${OPEN}origin not allowed${CLOSE}`);
    expect(breakdown.rows[1]!.label).toBeNull();
    expect(
      buildCounterBreakdown([{ reason: "origin-not-allowed", count: 2 }]),
    ).toEqual({
      kind: "list",
      total: 2,
      rows: [
        {
          reason: "origin-not-allowed",
          label: "origin not allowed",
          count: 2,
          sharePercent: 100,
        },
      ],
    });
  });
});

describe("buildUsageMeter in the reader's language", () => {
  test("byte figures are written as the reader's language writes a number", () => {
    const meter: UsageMeter = buildUsageMeter(2.5 * GB, 10 * GB, marking);

    expect(meter).toEqual({
      kind: "limited",
      usedCopy: "2,5 GB",
      limitCopy: "10 GB",
      percent: 25,
      tone: "ok",
    });
    expect(buildUsageMeter(2.5 * GB, null, marking)).toEqual({
      kind: "unlimited",
      usedCopy: "2,5 GB",
    });
    expect(buildUsageMeter(2.5 * GB, 10 * GB)).toEqual({
      kind: "limited",
      usedCopy: "2.5 GB",
      limitCopy: "10 GB",
      percent: 25,
      tone: "ok",
    });
  });
});

describe("describePollInterval in the reader's language", () => {
  test("each cadence is one phrase looked up whole, its duration inside", () => {
    expect(describePollInterval(60 * 1000, marking)).toBe(
      `${OPEN}refreshes every minute${CLOSE}`,
    );
    expect(describePollInterval(10 * 1000, marking)).toBe(
      `${OPEN}refreshes every ${OPEN}10s${CLOSE}${CLOSE}`,
    );
    expect(describePollInterval(0, marking)).toBe(
      `${OPEN}refreshes manually${CLOSE}`,
    );
  });

  test("English without a translator", () => {
    expect(describePollInterval(60 * 1000)).toBe("refreshes every minute");
    expect(describePollInterval(5 * 60 * 1000)).toBe("refreshes every 5m");
    expect(describePollInterval(Number.NaN)).toBe("refreshes manually");
  });
});
