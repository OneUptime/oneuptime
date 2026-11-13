import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { RecordingHealthStatus } from "../../../Types/Rum/SessionReplayHealth";
import { createTranslator, Translator } from "../../../Types/Translator";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The installation test in the reader's language (issue #6369).
 *
 * Every row's title, detail and action, the cadence line under them, the
 * panel's headings and the Content-Security-Policy sentence were English
 * in every language: the rows were built from string literals and template
 * literals ("Uploads " + a label lower-cased + ", sampling 50%"). Each is a
 * whole sentence of the Dashboard's locales now, looked up with the
 * reader's translator, with its values (an age, a count, the origins, the
 * reason words) in place.
 *
 * The lookups here are marked, ⟦like this⟧, so a sentence drawn without one
 * shows up unmarked.
 */

type TranslatorModule = typeof import("../../../Types/Translator");

const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

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
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
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

import InstallationTestPanel, {
  CheckRow,
  buildInstallationCheckRows,
  describeInstallationTestCadence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/InstallationTestPanel";
import {
  SessionReplayHealthExtras,
  clearSessionReplayHealthStore,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const DAY: number = 24 * 60 * MINUTE;
const GB: number = 1024 * 1024 * 1024;

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
  otherFilesParts: Array<string>,
): string {
  const copy: HTMLElement = element.cloneNode(true) as HTMLElement;

  for (const selector of ["code", "pre", ...otherFilesParts]) {
    copy.querySelectorAll(selector).forEach((node: Element): void => {
      node.remove();
    });
  }

  return outsideMarks(copy.textContent || "").replace(/[^\p{L}]+/gu, " ");
}

function iso(offsetMs: number): string {
  return new Date(NOW - offsetMs).toISOString();
}

function makeStatus(
  overrides?: Partial<RecordingHealthStatus>,
): RecordingHealthStatus {
  return {
    appIdentifier: "acme-web",
    allowedOrigins: ["https://app.acme.com", "https://www.acme.com"],
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
    lastConfigFetchAt: iso(12 * SECOND),
    lastChunkReceivedAt: iso(5 * MINUTE),
    lastSessionStartedAt: iso(MINUTE),
    budgetExceededAt: null,
    sessionsLast24h: 143,
    playableSessionsLast24h: 120,
    refusalsLast24h: [
      { reason: "consent-required", count: 40 },
      { reason: "origin-not-allowed", count: 3 },
    ],
    projectBytesUsedToday: 10 * 1024 * 1024,
    dailyByteLimit: GB,
    applicationBytesUsedThisMonth: 3 * GB,
    monthlyBudgetInGB: 2,
    ...overrides,
  };
}

function policy(
  overrides: Partial<RecordingHealthStatus["policy"]>,
): RecordingHealthStatus["policy"] {
  return {
    isProjectEnabled: true,
    isApplicationEnabled: true,
    captureTrigger: "Always",
    samplePercentage: 100,
    consentMode: "NotRequired",
    maskingMode: "MaskAllText",
    retentionInDays: 7,
    ...overrides,
  };
}

const REPORTED_EXTRAS: SessionReplayHealthExtras = {
  dropsLast24h: [{ reason: "worker-error", count: 2 }],
  recorderCapabilities: ["click-events", "web-vitals"],
};

const NO_EXTRAS: SessionReplayHealthExtras = {
  dropsLast24h: null,
  recorderCapabilities: null,
};

const EMPTY_EXTRAS: SessionReplayHealthExtras = {
  dropsLast24h: [],
  recorderCapabilities: [],
};

interface Fixture {
  name: string;
  status: RecordingHealthStatus;
  extras: SessionReplayHealthExtras;
}

/* Between them, every branch of every row. */
const FIXTURES: Array<Fixture> = [
  {
    name: "everything reported, a live pause",
    status: makeStatus({ budgetExceededAt: iso(30 * MINUTE) }),
    extras: REPORTED_EXTRAS,
  },
  {
    name: "switched off, error trigger with consent, nothing read",
    status: makeStatus({
      allowedOrigins: [],
      policy: policy({
        isProjectEnabled: false,
        isApplicationEnabled: false,
        captureTrigger: "OnErrorOrFrustration",
        samplePercentage: 50,
        consentMode: "RequireExplicit",
      }),
      lastConfigFetchAt: null,
      lastChunkReceivedAt: null,
      lastSessionStartedAt: null,
      sessionsLast24h: null,
      playableSessionsLast24h: null,
      refusalsLast24h: null,
      budgetExceededAt: iso(40 * DAY),
      projectBytesUsedToday: null,
      applicationBytesUsedThisMonth: null,
    }),
    extras: NO_EXTRAS,
  },
  {
    name: "sampling 0% with consent, nothing refused, no budget",
    status: makeStatus({
      policy: policy({ samplePercentage: 0, consentMode: "RequireExplicit" }),
      lastConfigFetchAt: null,
      lastChunkReceivedAt: null,
      lastSessionStartedAt: null,
      sessionsLast24h: 0,
      refusalsLast24h: [],
      monthlyBudgetInGB: null,
    }),
    extras: EMPTY_EXTRAS,
  },
  {
    name: "error trigger, loaded, no chunk yet",
    status: makeStatus({
      policy: policy({ captureTrigger: "OnErrorOrFrustration" }),
      lastChunkReceivedAt: null,
    }),
    extras: NO_EXTRAS,
  },
  {
    name: "a trigger not reported, consent asked, no current artifact",
    status: makeStatus({
      policy: policy({ captureTrigger: "", consentMode: "RequireExplicit" }),
      playableSessionsLast24h: null,
      publishedRecorderVersion: null,
    }),
    extras: NO_EXTRAS,
  },
  {
    name: "a trigger this page does not know",
    status: makeStatus({ policy: policy({ captureTrigger: "Sometimes" }) }),
    extras: NO_EXTRAS,
  },
  {
    name: "half sampled with consent",
    status: makeStatus({
      policy: policy({ samplePercentage: 50, consentMode: "RequireExplicit" }),
    }),
    extras: NO_EXTRAS,
  },
  {
    name: "a chunk without a policy stamp",
    status: makeStatus({ lastConfigFetchAt: null }),
    extras: NO_EXTRAS,
  },
  {
    name: "Always, never uploaded",
    status: makeStatus({ lastChunkReceivedAt: null }),
    extras: NO_EXTRAS,
  },
];

function rowByKey(rows: Array<CheckRow>, key: string): CheckRow {
  const row: CheckRow | undefined = rows.find((entry: CheckRow): boolean => {
    return entry.key === key;
  });

  expect(row).toBeDefined();

  return row as CheckRow;
}

function rowsOf(fixture: Fixture, translator?: Translator): Array<CheckRow> {
  return buildInstallationCheckRows(
    fixture.status,
    fixture.extras,
    NOW,
    APP_ID,
    translator,
  );
}

function fixture(name: string): Fixture {
  return FIXTURES.find((entry: Fixture): boolean => {
    return entry.name === name;
  }) as Fixture;
}

beforeEach(() => {
  postMock.mockReset();
  getListMock.mockReset();
  clearSessionReplayHealthStore();
});

describe("buildInstallationCheckRows in the reader's language", () => {
  it.each(FIXTURES)(
    "$name: every title, detail and action is looked up",
    (entry: Fixture) => {
      for (const row of rowsOf(entry, MARKING)) {
        expectLookedUp(row.title);
        expectLookedUp(row.detail);

        if (row.action) {
          expectLookedUp(row.action.label);
        }
      }
    },
  );

  it("looks each sentence up whole, with its values in place", () => {
    const reported: Array<CheckRow> = rowsOf(
      fixture("everything reported, a live pause"),
      MARKING,
    );

    expect(rowByKey(reported, "policy").title).toBe(
      "⟦Uploads always, sampling 100%⟧",
    );
    expect(rowByKey(reported, "loaded").title).toBe(
      "⟦Recorder loaded on your site ⟦12s ago⟧⟧",
    );
    expect(rowByKey(reported, "origins").detail).toBe(
      "⟦https://app.acme.com, https://www.acme.com. A request must also pass the ingestion key's own allowed origins; if the two lists disagree, uploads are refused as origin-not-allowed and counted below.⟧",
    );
    expect(rowByKey(reported, "sessions").title).toBe(
      "⟦143 sessions in the last 24h (120 playable)⟧",
    );
    expect(rowByKey(reported, "refusals").title).toBe(
      "⟦43 uploads refused in the last 24h⟧",
    );
    expect(rowByKey(reported, "refusals").detail).toBe(
      "⟦40 consent-required, 3 origin-not-allowed. The reason words match the recorder's own diagnostics.⟧",
    );
    expect(rowByKey(reported, "drops").detail).toBe(
      "⟦2 worker-error. These were accepted with a 202 and then not stored by the worker; the recorder was never told.⟧",
    );
    expect(rowByKey(reported, "capabilities").title).toBe(
      "⟦Recorder capabilities: click-events, web-vitals⟧",
    );
    expect(rowByKey(reported, "budget-exceeded").title).toBe(
      "⟦Uploads are paused: a byte budget was exhausted ⟦30m ago⟧⟧",
    );
    expect(rowByKey(reported, "bytes").detail).toBe(
      "⟦10 MB of 1 GB used today across this project.⟧ ⟦3 GB of this application's 2 GB monthly budget used.⟧",
    );

    const switchedOff: Array<CheckRow> = rowsOf(
      fixture("switched off, error trigger with consent, nothing read"),
      MARKING,
    );

    expect(rowByKey(switchedOff, "policy").title).toBe(
      "⟦Uploads on error or frustration, sampling 50%, consent required⟧",
    );
    // The page the ingestion keys are on, named as the guide's link names it.
    expect(rowByKey(switchedOff, "origins").detail).toContain(
      "allowed origins (⟦Project Settings > Telemetry & APM > Ingestion Keys⟧) are checked first",
    );
    expect(rowByKey(switchedOff, "budget-exceeded").title).toBe(
      "⟦A byte budget was exhausted ⟦40d ago⟧; uploads are flowing again⟧",
    );

    // The trigger's name, as the policy names it.
    expect(
      rowByKey(
        rowsOf(fixture("error trigger, loaded, no chunk yet"), MARKING),
        "chunk",
      ).detail,
    ).toContain(
      "⟦Under ⟦On error or frustration⟧ a healthy visit uploads nothing",
    );

    // A trigger nobody reported is named as the policy card names it.
    expect(
      rowByKey(
        rowsOf(
          fixture("a trigger not reported, consent asked, no current artifact"),
          MARKING,
        ),
        "policy",
      ).title,
    ).toBe("⟦Uploads ⟦not reported⟧, sampling 100%, consent required⟧");

    // Two whole sentences, never one glued from pieces.
    expect(
      rowByKey(rowsOf(fixture("half sampled with consent"), MARKING), "policy")
        .detail,
    ).toBe(
      "⟦About 50% of sessions upload from the first event, so an ordinary visit is as watchable as a broken one.⟧ ⟦Nothing uploads until the page calls OneUptimeReplay.grantConsent().⟧",
    );
  });

  it("reads in English, word for word, without a translator", () => {
    const reported: Array<CheckRow> = rowsOf(
      fixture("everything reported, a live pause"),
    );

    expect(rowByKey(reported, "origins").title).toBe(
      "This application allows 2 origins",
    );
    expect(rowByKey(reported, "sessions").title).toBe(
      "143 sessions in the last 24h (120 playable)",
    );
    expect(rowByKey(reported, "sessions").detail).toBe(
      "Last session started 1m ago.",
    );
    expect(rowByKey(reported, "refusals").detail).toBe(
      "40 consent-required, 3 origin-not-allowed. The reason words match the recorder's own diagnostics.",
    );
    expect(rowByKey(reported, "drops").title).toBe(
      "2 chunks dropped after acceptance in the last 24h",
    );
    expect(rowByKey(reported, "bytes").detail).toBe(
      "10 MB of 1 GB used today across this project. 3 GB of this application's 2 GB monthly budget used.",
    );
    expect(rowByKey(reported, "budget-exceeded").title).toBe(
      "Uploads are paused: a byte budget was exhausted 30m ago",
    );

    const switchedOff: Array<CheckRow> = rowsOf(
      fixture("switched off, error trigger with consent, nothing read"),
    );

    expect(rowByKey(switchedOff, "origins").detail).toBe(
      "Two allowlists compose: the ingestion key's allowed origins (Project Settings > Telemetry & APM > Ingestion Keys) are checked first, then this application's. With this list empty, only the key's list protects the project from a copied key. Fine for getting started; list your domains before production.",
    );
    expect(rowByKey(switchedOff, "policy").title).toBe(
      "Uploads on error or frustration, sampling 50%, consent required",
    );
    expect(rowByKey(switchedOff, "policy").detail).toBe(
      "Sampled sessions keep a rolling buffer in memory and upload only when an error, a frustration signal or a performance budget fires. A healthy visit produces no recording; that is this setting working as configured. Nothing uploads until the page calls OneUptimeReplay.grantConsent().",
    );
    expect(rowByKey(switchedOff, "bytes").detail).toBe(
      "Today's project usage is unknown (the usage counter was unreachable). This month's application usage is unknown.",
    );
    expect(rowByKey(switchedOff, "budget-exceeded").title).toBe(
      "A byte budget was exhausted 40d ago; uploads are flowing again",
    );

    const recordsNothing: Array<CheckRow> = rowsOf(
      fixture("sampling 0% with consent, nothing refused, no budget"),
    );

    expect(rowByKey(recordsNothing, "policy").title).toBe(
      "Uploads always, sampling 0%, consent required",
    );
    expect(rowByKey(recordsNothing, "bytes").detail).toBe(
      "10 MB of 1 GB used today across this project. No monthly budget is set for this application (0 or blank means no ceiling).",
    );

    expect(
      rowByKey(
        rowsOf(
          fixture("a trigger not reported, consent asked, no current artifact"),
        ),
        "policy",
      ).title,
    ).toBe("Uploads not reported, sampling 100%, consent required");
    expect(
      rowByKey(rowsOf(fixture("half sampled with consent")), "policy").detail,
    ).toBe(
      "About 50% of sessions upload from the first event, so an ordinary visit is as watchable as a broken one. Nothing uploads until the page calls OneUptimeReplay.grantConsent().",
    );
    expect(
      rowByKey(rowsOf(fixture("error trigger, loaded, no chunk yet")), "chunk")
        .detail,
    ).toBe(
      "Under On error or frustration a healthy visit uploads nothing, so silence here can be correct. To prove the path, throw an error on an instrumented page or call OneUptimeReplay.captureSession(), then reload.",
    );
  });
});

describe("describeInstallationTestCadence", () => {
  it("says how often, when last read and why the last refresh failed, each a whole sentence", () => {
    expect(
      describeInstallationTestCadence(
        {
          isWaiting: true,
          fetchedAtUnixMs: NOW - 5 * SECOND,
          nowUnixMs: NOW,
          error: { kind: "other", message: "Bad gateway" },
        },
        MARKING,
      ),
    ).toBe(
      "⟦Checking every 10s while a first chunk is outstanding; last read ⟦5s ago⟧.⟧ ⟦The last refresh failed: recording health could not be loaded.⟧",
    );
    expect(
      describeInstallationTestCadence(
        {
          isWaiting: false,
          fetchedAtUnixMs: null,
          nowUnixMs: NOW,
          error: { kind: "plan", message: "Please upgrade" },
        },
        MARKING,
      ),
    ).toBe(
      "⟦Refreshes every 60s.⟧ ⟦The last refresh failed: recording health is not included in this project's plan.⟧",
    );
  });

  it("reads in English, word for word, without a translator", () => {
    expect(
      describeInstallationTestCadence({
        isWaiting: true,
        fetchedAtUnixMs: NOW - 5 * SECOND,
        nowUnixMs: NOW,
        error: { kind: "permission", message: "Not authorized" },
      }),
    ).toBe(
      "Checking every 10s while a first chunk is outstanding; last read 5s ago. The last refresh failed: you cannot see recording health.",
    );
    expect(
      describeInstallationTestCadence({
        isWaiting: false,
        fetchedAtUnixMs: NOW - 2 * MINUTE,
        nowUnixMs: NOW,
        error: null,
      }),
    ).toBe("Refreshes every 60s; last read 2m ago.");
    expect(
      describeInstallationTestCadence({
        isWaiting: true,
        fetchedAtUnixMs: null,
        nowUnixMs: NOW,
        error: null,
      }),
    ).toBe("Checking every 10s while a first chunk is outstanding.");
  });
});

/* The wire shape, as /ingest-status answers it, aged against the real clock. */
function wireStatus(overrides?: JSONObject): JSONObject {
  const recent: string = new Date(Date.now() - 12 * SECOND).toISOString();

  return {
    isProjectAllowed: true,
    isApplicationEnabled: true,
    appIdentifier: "acme-web",
    allowedOrigins: ["https://app.acme.com"],
    samplePercentage: 100,
    captureTrigger: "Always",
    lastChunkReceivedAt: null,
    budgetExceededAt: null,
    projectBytesUsedToday: 0,
    dailyByteLimit: GB,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    consentMode: "NotRequired",
    maskingMode: "MaskSensitiveInputsOnly",
    retentionInDays: 7,
    publishedRecorderVersion: "1.4.0",
    lastConfigFetchAt: recent,
    lastSessionStartedAt: null,
    sessionsLast24h: 0,
    playableSessionsLast24h: 0,
    refusalsLast24h: [],
    dropsLast24h: null,
    ...overrides,
  };
}

/*
 * Left out of the check: what the recording-health card's file draws (the
 * diagnosis and the paste box, routed on their own) and the snippet's tabs,
 * which are frameworks' and products' names, the same in every language.
 */
const OTHER_FILES_PARTS: Array<string> = [
  '[data-testid="health-diagnosis"]',
  '[data-testid="diagnostics-paste-box"]',
  '[role="tablist"]',
];

describe("InstallationTestPanel in the reader's language", () => {
  it("draws its headings, rows, cadence and the CSP sentence looked up", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, wireStatus(), {}),
    );

    render(
      <MemoryRouter>
        <InstallationTestPanel rumApplicationId={APP_ID} />
      </MemoryRouter>,
    );

    await screen.findByTestId("install-test-rows");

    expect(screen.getByText("⟦Test your installation⟧")).toBeInTheDocument();
    expect(screen.getByText("⟦Install snippet⟧")).toBeInTheDocument();
    expect(
      screen.getByText("⟦Content-Security-Policy your site must allow⟧"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("install-check-policy")).toHaveTextContent(
      "⟦Uploads always, sampling 100%⟧",
    );
    expect(screen.getByTestId("install-test-cadence")).toHaveTextContent(
      "⟦Checking every 10s while a first chunk is outstanding; last read",
    );
    expect(screen.getByTestId("install-test-panel")).toHaveTextContent(
      "⟦script-src decides whether the recorder loads, connect-src whether it uploads; both fail silently. Add",
    );

    expect(
      wordsNotLookedUp(
        screen.getByTestId("install-test-panel"),
        OTHER_FILES_PARTS,
      ).trim(),
    ).toBe("");
  });

  /*
   * The server's words are looked up as any error put in a sentence is
   * (ErrorSentence, #7307) - a message the Dashboard has words for reads in
   * the reader's language, any other as it came - so here, where every
   * lookup is marked, they are marked inside the sentence's own marks.
   */
  it("draws a failed health read in the reader's language, the server's words looked up inside it", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(403, { message: "Not authorized" }, {}),
    );

    render(
      <MemoryRouter>
        <InstallationTestPanel rumApplicationId={APP_ID} />
      </MemoryRouter>,
    );

    const error: HTMLElement = await screen.findByTestId("install-test-error");

    expect(error).toHaveTextContent("⟦You cannot see recording health⟧");
    expect(error).toHaveTextContent("⟦Server said: ⟦Not authorized⟧⟧");
    expect(wordsNotLookedUp(error, []).trim()).toBe("");
  });

  it("says the application list could not be loaded, or that there is none, looked up", async () => {
    getListMock.mockResolvedValue({ data: [], count: 0 });

    const empty: ReturnType<typeof render> = render(
      <MemoryRouter>
        <InstallationTestPanel />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(
        "⟦No RUM applications yet. Create one first, then test its installation here.⟧",
      ),
    ).toBeInTheDocument();

    empty.unmount();
    getListMock.mockRejectedValue(new Error("The list is unavailable"));

    render(
      <MemoryRouter>
        <InstallationTestPanel />
      </MemoryRouter>,
    );

    expect(
      await screen.findByTestId("install-test-apps-error"),
    ).toHaveTextContent(
      "⟦The application list could not be loaded: ⟦Error: The list is unavailable⟧⟧",
    );
  });
});
