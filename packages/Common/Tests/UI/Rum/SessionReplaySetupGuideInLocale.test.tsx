import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { RecordingHealthStatus } from "../../../Types/Rum/SessionReplayHealth";
import { createTranslator, Translator } from "../../../Types/Translator";
import Navigation from "../../../UI/Utils/Navigation";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Session Replay Documentation page's setup guide in the reader's
 * language (issue #6369).
 *
 * Its five steps were paragraphs of English around <code> elements and a
 * link, its live checks were built from English literals, and the line
 * under them was glued from pieces. Each is a whole sentence of the
 * Dashboard's locales now: a paragraph with code in it is one sentence
 * with slots, a setting or page it names is looked up on its own, and an
 * age or a count goes in as a value.
 *
 * The lookups here are marked, ⟦like this⟧, so a sentence drawn without one
 * shows up unmarked.
 */

type TranslatorModule = typeof import("../../../Types/Translator");

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof HTTPErrorResponse
          ? error.message
          : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

// Every lookup a component makes comes back marked, in German.
jest.mock("../../../UI/Utils/Translation", () => {
  const translatorModule: TranslatorModule = jest.requireActual(
    "../../../Types/Translator",
  ) as TranslatorModule;
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

import SessionReplaySetupGuide, {
  LiveCheck,
  buildLiveChecks,
  describeLiveCheckCadence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplaySetupGuide";
import SessionReplayInstallSnippet from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayInstallSnippet";
import { clearSessionReplayHealthStore } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");
const SECOND: number = 1000;

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

/*
 * The words of an element no lookup produced, leaving out code (drawn as
 * written) and the parts other files draw.
 */
function wordsNotLookedUp(
  element: HTMLElement,
  otherParts: Array<string>,
): string {
  const copy: HTMLElement = element.cloneNode(true) as HTMLElement;

  for (const selector of ["code", "pre", ...otherParts]) {
    copy.querySelectorAll(selector).forEach((node: Element): void => {
      node.remove();
    });
  }

  return outsideMarks(copy.textContent || "")
    .replace(/[^\p{L}]+/gu, " ")
    .trim();
}

/*
 * Left out of the page-wide check: the diagnosis banner (the recording-health
 * card's file, routed on its own) and the install snippet's tabs, which are
 * frameworks' and products' names, the same in every language.
 */
const OTHER_PARTS: Array<string> = [
  '[data-testid="health-diagnosis"]',
  '[role="tablist"]',
];

function iso(offsetMs: number): string {
  return new Date(NOW - offsetMs).toISOString();
}

function makeStatus(
  overrides?: Partial<RecordingHealthStatus>,
  policy?: Partial<RecordingHealthStatus["policy"]>,
): RecordingHealthStatus {
  return {
    appIdentifier: "acme-web",
    allowedOrigins: [],
    policy: {
      isProjectEnabled: true,
      isApplicationEnabled: true,
      captureTrigger: "Always",
      samplePercentage: 100,
      consentMode: "NotRequired",
      maskingMode: "MaskSensitiveInputsOnly",
      retentionInDays: 7,
      ...policy,
    },
    publishedRecorderVersion: "1.4.0",
    lastConfigFetchAt: null,
    lastChunkReceivedAt: null,
    lastSessionStartedAt: null,
    budgetExceededAt: null,
    sessionsLast24h: 0,
    playableSessionsLast24h: 0,
    refusalsLast24h: [],
    projectBytesUsedToday: 0,
    dailyByteLimit: 1024 * 1024 * 1024,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    ...overrides,
  };
}

const LOADED: Partial<RecordingHealthStatus> = {
  lastConfigFetchAt: iso(12 * SECOND),
};

const RECEIVED: Partial<RecordingHealthStatus> = {
  lastConfigFetchAt: iso(12 * SECOND),
  lastChunkReceivedAt: iso(SECOND),
};

/* Between them, every branch of every check. */
const STATUSES: Array<{ name: string; status: RecordingHealthStatus | null }> =
  [
    { name: "no status yet", status: null },
    { name: "never loaded", status: makeStatus() },
    {
      name: "project switched off",
      status: makeStatus({}, { isProjectEnabled: false }),
    },
    {
      name: "application switched off",
      status: makeStatus({}, { isApplicationEnabled: false }),
    },
    {
      name: "loaded, sampling 0%",
      status: makeStatus(LOADED, { samplePercentage: 0 }),
    },
    {
      name: "loaded, consent asked",
      status: makeStatus(LOADED, { consentMode: "RequireExplicit" }),
    },
    {
      name: "loaded, error trigger",
      status: makeStatus(LOADED, { captureTrigger: "OnErrorOrFrustration" }),
    },
    {
      name: "loaded, sampling 10%",
      status: makeStatus(LOADED, { samplePercentage: 10 }),
    },
    { name: "loaded, nothing landed", status: makeStatus(LOADED) },
    {
      name: "a chunk, no policy stamp, count unread",
      status: makeStatus({
        lastChunkReceivedAt: iso(SECOND),
        playableSessionsLast24h: null,
      }),
    },
    {
      name: "a chunk, nothing playable yet",
      status: makeStatus(RECEIVED),
    },
    {
      name: "a session ready",
      status: makeStatus({ ...RECEIVED, playableSessionsLast24h: 3 }),
    },
  ];

function checkByKey(checks: Array<LiveCheck>, key: string): LiveCheck {
  const check: LiveCheck | undefined = checks.find(
    (entry: LiveCheck): boolean => {
      return entry.key === key;
    },
  );

  expect(check).toBeDefined();

  return check as LiveCheck;
}

beforeEach(() => {
  postMock.mockReset();
  clearSessionReplayHealthStore();
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {
    /* The guide's buttons are not followed here. */
  });
});

describe("buildLiveChecks in the reader's language", () => {
  it.each(STATUSES)(
    "$name: every title and detail is looked up",
    (entry: { name: string; status: RecordingHealthStatus | null }) => {
      for (const check of buildLiveChecks(entry.status, NOW, MARKING)) {
        expectLookedUp(check.title);
        expectLookedUp(check.detail);
      }
    },
  );

  it("looks each sentence up whole, with its values in place", () => {
    const received: Array<LiveCheck> = buildLiveChecks(
      makeStatus(RECEIVED),
      NOW,
      MARKING,
    );

    expect(checkByKey(received, "loaded").detail).toBe(
      "⟦Policy fetched ⟦12s ago⟧.⟧",
    );
    expect(checkByKey(received, "chunk").detail).toBe("⟦Last chunk ⟦1s ago⟧.⟧");

    // The trigger's and the other choice's names, as the policy names them.
    expect(
      checkByKey(
        buildLiveChecks(
          makeStatus(LOADED, { captureTrigger: "OnErrorOrFrustration" }),
          NOW,
          MARKING,
        ),
        "chunk",
      ).detail,
    ).toBe(
      "⟦The trigger is ⟦On error or frustration⟧, so a visit where nothing goes wrong uploads nothing. Throw an error on an instrumented page, call OneUptimeReplay.captureSession(), or switch the trigger to ⟦Always⟧.⟧",
    );
    expect(
      checkByKey(
        buildLiveChecks(
          makeStatus(LOADED, { samplePercentage: 10 }),
          NOW,
          MARKING,
        ),
        "chunk",
      ).detail,
    ).toBe(
      "⟦Sampling is 10%, so about 1 in 10 visits records. Load a few pages, or set sampling to 100% while testing.⟧",
    );
    expect(
      checkByKey(
        buildLiveChecks(
          makeStatus({ ...RECEIVED, playableSessionsLast24h: 3 }),
          NOW,
          MARKING,
        ),
        "playable",
      ).detail,
    ).toBe("⟦3 playable sessions in the last 24h.⟧");
  });

  it("reads in English without a translator, the visits counted as a plural", () => {
    expect(
      checkByKey(
        buildLiveChecks(
          makeStatus(LOADED, { captureTrigger: "OnErrorOrFrustration" }),
          NOW,
        ),
        "chunk",
      ).detail,
    ).toBe(
      "The trigger is On error or frustration, so a visit where nothing goes wrong uploads nothing. Throw an error on an instrumented page, call OneUptimeReplay.captureSession(), or switch the trigger to Always.",
    );
    expect(
      checkByKey(buildLiveChecks(makeStatus(RECEIVED), NOW), "chunk").detail,
    ).toBe("Last chunk 1s ago.");
    // "1 in 1 visits" was glued; one visit is one visit.
    expect(
      checkByKey(
        buildLiveChecks(makeStatus(LOADED, { samplePercentage: 80 }), NOW),
        "chunk",
      ).detail,
    ).toBe(
      "Sampling is 80%, so about 1 in 1 visit records. Load a few pages, or set sampling to 100% while testing.",
    );
    expect(
      checkByKey(
        buildLiveChecks(
          makeStatus({ ...RECEIVED, playableSessionsLast24h: 1 }),
          NOW,
        ),
        "playable",
      ).detail,
    ).toBe("1 playable session in the last 24h.");
  });
});

describe("describeLiveCheckCadence", () => {
  it("says whether the last refresh failed and how often the checks refresh, each a whole sentence", () => {
    expect(
      describeLiveCheckCadence(
        {
          hasRefreshFailed: true,
          fetchedAtUnixMs: NOW - 5 * SECOND,
          nowUnixMs: NOW,
          isListRefreshing: true,
        },
        MARKING,
      ),
    ).toBe(
      "⟦The last refresh failed; showing the status read ⟦5s ago⟧.⟧ ⟦Checks refresh every 10s while this page is open; the list above refreshes with them.⟧",
    );
    expect(
      describeLiveCheckCadence(
        {
          hasRefreshFailed: true,
          fetchedAtUnixMs: null,
          nowUnixMs: NOW,
          isListRefreshing: false,
        },
        MARKING,
      ),
    ).toBe(
      "⟦The last refresh failed; showing the status read earlier.⟧ ⟦Checks refresh every 10s while this page is open.⟧",
    );
  });

  it("reads in English, word for word, without a translator", () => {
    expect(
      describeLiveCheckCadence({
        hasRefreshFailed: true,
        fetchedAtUnixMs: NOW - 5 * SECOND,
        nowUnixMs: NOW,
        isListRefreshing: false,
      }),
    ).toBe(
      "The last refresh failed; showing the status read 5s ago. Checks refresh every 10s while this page is open.",
    );
    expect(
      describeLiveCheckCadence({
        hasRefreshFailed: false,
        fetchedAtUnixMs: NOW,
        nowUnixMs: NOW,
        isListRefreshing: true,
      }),
    ).toBe(
      "Checks refresh every 10s while this page is open; the list above refreshes with them.",
    );
  });
});

/* The wire shape, as /ingest-status answers it, aged against the real clock. */
function wireStatus(overrides?: JSONObject): JSONObject {
  return {
    isProjectAllowed: true,
    isApplicationEnabled: true,
    appIdentifier: "acme-web",
    allowedOrigins: [],
    samplePercentage: 100,
    captureTrigger: "Always",
    lastChunkReceivedAt: null,
    budgetExceededAt: null,
    projectBytesUsedToday: 0,
    dailyByteLimit: 1024 * 1024 * 1024,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    consentMode: "NotRequired",
    maskingMode: "MaskSensitiveInputsOnly",
    retentionInDays: 7,
    publishedRecorderVersion: "1.4.0",
    lastConfigFetchAt: null,
    lastSessionStartedAt: null,
    sessionsLast24h: 0,
    playableSessionsLast24h: 0,
    refusalsLast24h: [],
    ...overrides,
  };
}

function renderGuide(): void {
  render(
    <MemoryRouter>
      <SessionReplaySetupGuide rumApplicationId={new ObjectID(APP_ID)} />
    </MemoryRouter>,
  );
}

describe("SessionReplaySetupGuide in the reader's language", () => {
  it("draws every step, check and link looked up, with code and names as written", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, wireStatus(), {}),
    );

    renderGuide();

    await screen.findByTestId("setup-guide-diagnosis");

    expect(screen.getByText("⟦Set up Session Replay⟧")).toBeInTheDocument();
    expect(screen.getByTestId("setup-step-1")).toHaveTextContent(
      "⟦Create a telemetry ingestion key⟧",
    );
    expect(screen.getByTestId("setup-step-1")).toHaveTextContent(
      "Create one under ⟦Project Settings > Telemetry & APM > Ingestion Keys⟧: the new key opens on its own page",
    );
    expect(screen.getByTestId("setup-step-2")).toHaveTextContent(
      "Then call identify() as soon as your page knows who is signed in",
    );
    expect(screen.getByTestId("setup-step-2-docs")).toHaveTextContent(
      "⟦Read the docs on this⟧",
    );
    expect(screen.getByTestId("setup-step-3")).toHaveTextContent(
      "⟦No CSP on your site? Skip this step.⟧",
    );
    expect(
      screen.getByTestId("setup-correlation-cross-origin"),
    ).toHaveTextContent(
      "add it to ⟦Trace propagation origins⟧ in this application's replay policy",
    );
    expect(
      screen.getByTestId("setup-correlation-cross-origin"),
    ).toHaveTextContent(
      "turn off ⟦Same-origin trace propagation⟧ on the same page",
    );
    expect(screen.getByTestId("setup-live-checks")).toHaveTextContent(
      "⟦Checks refresh every 10s while this page is open.⟧",
    );
    expect(screen.getByTestId("setup-guide")).toHaveTextContent(
      "⟦The installation test on this application's ⟦Replay Policy⟧ page lists every switch",
    );
    expect(screen.getByTestId("setup-guide")).toHaveTextContent(
      "⟦Full documentation⟧",
    );

    expect(
      wordsNotLookedUp(screen.getByTestId("setup-guide"), OTHER_PARTS),
    ).toBe("");
  });

  it("says why the checks cannot run, in one sentence around the health error's own words", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(403, { message: "Not authorized" }, {}),
    );

    renderGuide();

    const error: HTMLElement = await screen.findByTestId(
      "setup-guide-health-error",
    );

    expect(error).toHaveTextContent(
      "⟦⟦You cannot see recording health⟧. ⟦Reading recording health needs",
    );
    expect(error).toHaveTextContent("⟧ The steps below still apply.⟧");
    expect(wordsNotLookedUp(error, [])).toBe("");
  });

  it("says why Watch it could not open a session", async () => {
    postMock.mockImplementation((request: unknown): Promise<unknown> => {
      const url: string = (
        request as { url: { toString: () => string } }
      ).url.toString();

      if (url.includes("/session-replay/list")) {
        return Promise.resolve(
          new HTTPResponse<JSONObject>(200, { sessions: [] }, {}),
        );
      }

      return Promise.resolve(
        new HTTPResponse<JSONObject>(
          200,
          wireStatus({
            lastConfigFetchAt: iso(SECOND),
            lastChunkReceivedAt: iso(SECOND),
            sessionsLast24h: 1,
            playableSessionsLast24h: 1,
          }),
          {},
        ),
      );
    });

    renderGuide();

    fireEvent.click(await screen.findByTestId("setup-watch-newest"));

    expect(await screen.findByTestId("setup-watch-error")).toHaveTextContent(
      "⟦No playable session came back from the list. The count and the list disagree for a moment while a session is being written; try again in a few seconds.⟧",
    );
  });

  it("draws the install snippet's explanations looked up around their code", () => {
    render(
      <SessionReplayInstallSnippet
        appIdentifier="acme-web"
        oneuptimeUrl="https://oneuptime.example.com"
      />,
    );

    const snippet: HTMLElement = screen.getByTestId("install-snippet");

    expect(snippet).toHaveTextContent(
      "⟦data-oneuptime-app-identifier must match this application's identifier (the same value you use for service.name).",
    );
    expect(snippet).toHaveTextContent("⟦Identify your users⟧");
    expect(snippet).toHaveTextContent(
      "identify() is what groups sessions by person, makes user: search work in the list",
    );
    // The frameworks' and products' names are drawn as written.
    expect(snippet).toHaveTextContent("Google Tag Manager");
    expect(snippet).not.toHaveTextContent("⟦Google Tag Manager⟧");
    expect(wordsNotLookedUp(snippet, ['[role="tablist"]'])).toBe("");
  });
});
