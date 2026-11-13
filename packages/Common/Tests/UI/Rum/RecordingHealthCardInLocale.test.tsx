import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { RecordingHealthStatus } from "../../../Types/Rum/SessionReplayHealth";
import { diagnoseRecordingHealth } from "../../../Utils/SessionReplay/SessionReplayHealth";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  Translator,
} from "../../../Types/Translator";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The recording-health card on the Replay Policy page, the "Ask the
 * browser" paste box and the hook every health surface reads, in the
 * reader's language (#6369). Translation's translateString is stubbed to
 * wrap what it is given in ⟦ ⟧, so a string looked up whole reads ⟦...⟧ and
 * one looked up twice ⟦⟦...⟧⟧. What is left of the text once the marked
 * strings and the data are taken out is numbers and punctuation only.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: (): {
      translateString: (value: string | undefined) => string | undefined;
      translateValue: (value: unknown) => unknown;
      language: string;
    } => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value === undefined ? value : `⟦${value}⟧`;
        },
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" ? `⟦${value}⟧` : value;
        },
        language: "de",
      };
    },
  };
});

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

/* Imported after the mocks are registered so the components see them. */
import RecordingHealthCard, {
  RecorderDiagnosticsPasteBox,
  RecordingHealthSummaryView,
  describeStaleHealthRead,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthCard";
import {
  HEALTH_RESPONSE_UNREADABLE_MESSAGE,
  SessionReplayHealthError,
  SessionReplayHealthSnapshot,
  clearSessionReplayHealthStore,
  healthSnapshotInLanguage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");
const GB: number = 1024 * 1024 * 1024;

const OPEN: string = "⟦";
const CLOSE: string = "⟧";

const marking: Translator = createTranslator((text: string): string => {
  return `${OPEN}${text}${CLOSE}`;
}, "de");

const english: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

// The recording's and the recorder's own words: drawn as written.
const DATA: Array<string> = [
  "Forbidden",
  "idle",
  "privacy-signal",
  "click-events",
  "brand-new-code",
  "another-new-code",
  new Date(NOW).toISOString(),
];

const NOT_WORDS: RegExp = /^[\s\d.,:;%·•()\-–—/+]*$/;

function marked(text: string): string {
  return `${OPEN}${text}${CLOSE}`;
}

function iso(offsetMs: number): string {
  return new Date(NOW - offsetMs).toISOString();
}

function isoFromRealNow(offsetMs: number): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

function residueOf(text: string): string {
  let rest: string = text;
  let previous: string = "";

  while (rest !== previous) {
    previous = rest;
    rest = rest.replace(/⟦[^⟦⟧]*⟧/g, "");
  }

  for (const value of DATA) {
    rest = rest.split(value).join("");
  }

  return rest;
}

// Every text node outside code whose words are not all looked up.
function unmarkedText(container: HTMLElement): Array<string> {
  const left: Array<string> = [];
  const walker: TreeWalker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
  );

  for (
    let node: Node | null = walker.nextNode();
    node;
    node = walker.nextNode()
  ) {
    // Code, and what no reader sees or hears, is not copy.
    if (
      node.parentElement?.closest('code, pre, textarea, [aria-hidden="true"]')
    ) {
      continue;
    }

    const text: string = node.textContent || "";

    if (!NOT_WORDS.test(residueOf(text))) {
      left.push(text);
    }
  }

  return left;
}

function makeStatus(
  overrides?: Partial<RecordingHealthStatus>,
): RecordingHealthStatus {
  return {
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
    lastConfigFetchAt: iso(12 * 1000),
    lastChunkReceivedAt: iso(5 * 60 * 1000),
    lastSessionStartedAt: iso(60 * 1000),
    budgetExceededAt: null,
    sessionsLast24h: 143,
    playableSessionsLast24h: 120,
    refusalsLast24h: [],
    projectBytesUsedToday: 10 * 1024 * 1024,
    dailyByteLimit: GB,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    ...overrides,
  };
}

// A snapshot as the hook hands it out: diagnosed in the reader's language.
function makeSnapshot(
  status: RecordingHealthStatus | null,
  overrides?: Partial<SessionReplayHealthSnapshot>,
): SessionReplayHealthSnapshot {
  return {
    status: status,
    diagnosis: diagnoseRecordingHealth(status, NOW, marking),
    extras: { dropsLast24h: null, recorderCapabilities: null },
    isLoading: false,
    isRefreshing: false,
    error: null,
    fetchedAtUnixMs: NOW,
    nowUnixMs: NOW,
    ...overrides,
  };
}

function renderCard(snapshot: SessionReplayHealthSnapshot): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <RecordingHealthSummaryView rumApplicationId={APP_ID} health={snapshot} />
    </MemoryRouter>,
  );

  return container;
}

function renderPasteBox(showHeading?: boolean): HTMLElement {
  render(
    <MemoryRouter>
      <RecorderDiagnosticsPasteBox showHeading={showHeading} />
    </MemoryRouter>,
  );

  return screen.getByTestId("diagnostics-paste-box");
}

function explain(value: string): void {
  fireEvent.change(screen.getByTestId("diagnostics-paste-input"), {
    target: { value: value },
  });
  fireEvent.click(screen.getByTestId("diagnostics-explain"));
}

beforeEach(() => {
  postMock.mockReset();
  clearSessionReplayHealthStore();
});

afterEach(() => {
  cleanup();
  // No poll of a connected test outlives it.
  clearSessionReplayHealthStore();
});

describe("the Replay Policy page's health card in the reader's language", () => {
  it("the diagnosis, its action and the card's own words are all looked up", () => {
    const card: HTMLElement = renderCard(
      makeSnapshot(
        makeStatus({ lastConfigFetchAt: null, lastChunkReceivedAt: null }),
      ),
    );

    expect(screen.getByTestId("health-diagnosis")).toHaveTextContent(
      marked("The recorder has never loaded for acme-web"),
    );
    expect(screen.getByTestId("health-action")).toHaveTextContent(
      marked("Open the setup guide"),
    );
    expect(card).toHaveTextContent(marked("Recording health"));
    expect(card).toHaveTextContent(marked("View health details"));
    expect(unmarkedText(card)).toEqual([]);
  });

  /*
   * The server's words are looked up as any error put in a sentence is
   * (ErrorSentence, #7307): a message the Dashboard has words for reads in
   * the reader's language, any other as written. Every lookup is marked
   * here, so they are marked inside the sentence's own marks.
   */
  it("loading, and a failure with no status: the reader's words, the server's looked up inside them", () => {
    renderCard(makeSnapshot(null, { isLoading: true, fetchedAtUnixMs: null }));

    expect(screen.getByTestId("health-card-loading")).toHaveTextContent(
      marked("Checking recording health…"),
    );

    cleanup();

    const card: HTMLElement = renderCard(
      makeSnapshot(null, {
        error: { kind: "permission", message: "Forbidden" },
        fetchedAtUnixMs: null,
      }),
    );

    expect(screen.getByTestId("health-card-error")).toHaveTextContent(
      marked("You cannot see recording health"),
    );
    expect(screen.getByTestId("health-card-error")).toHaveTextContent(
      marked(`Server said: ${marked("Forbidden")}`),
    );
    /*
     * The sentence is drawn around its error (ErrorSentence): its two
     * halves are text of their own, one marked sentence with the error
     * between them (above). Nothing else is left unmarked.
     */
    expect(unmarkedText(card)).toEqual(["⟦Server said: ", "⟧"]);
  });

  it("a failed refresh: why, and how old the status is, as one sentence", () => {
    renderCard(
      makeSnapshot(makeStatus(), {
        error: { kind: "permission", message: "Forbidden" },
        fetchedAtUnixMs: NOW - 3 * 60 * 1000,
      }),
    );

    expect(screen.getByTestId("health-card-stale")).toHaveTextContent(
      marked(
        `The last refresh failed (you cannot see recording health); showing the status read ${marked("3m ago")}.`,
      ),
    );
  });
});

describe("describeStaleHealthRead", () => {
  const kinds: Array<SessionReplayHealthError["kind"]> = [
    "permission",
    "plan",
    "other",
  ];

  it("is one whole sentence per failure, with or without the time it was read", () => {
    for (const kind of kinds) {
      const error: SessionReplayHealthError = { kind: kind, message: "x" };
      const withTime: string = describeStaleHealthRead(
        error,
        NOW - 60 * 60 * 1000,
        NOW,
        marking,
      );
      const earlier: string = describeStaleHealthRead(
        error,
        null,
        NOW,
        marking,
      );

      expect(withTime.startsWith(`${OPEN}The last refresh failed (`)).toBe(
        true,
      );
      expect(withTime.endsWith(`${marked("1h ago")}.${CLOSE}`)).toBe(true);
      expect(earlier).toMatch(
        /^⟦The last refresh failed \([^⟦⟧]+\); showing the status read earlier\.⟧$/,
      );
    }
  });

  it("reads in English exactly as the card always said it", () => {
    expect(
      describeStaleHealthRead(
        { kind: "other", message: "boom" },
        NOW - 3 * 60 * 1000,
        NOW,
        english,
      ),
    ).toBe(
      "The last refresh failed (recording health could not be loaded); showing the status read 3m ago.",
    );
    expect(
      describeStaleHealthRead(
        { kind: "plan", message: "Please upgrade your plan" },
        null,
        NOW,
        english,
      ),
    ).toBe(
      "The last refresh failed (recording health is not included in this project's plan); showing the status read earlier.",
    );
    expect(
      describeStaleHealthRead(
        { kind: "permission", message: "Forbidden" },
        NOW - 5 * 1000,
        NOW,
        english,
      ),
    ).toBe(
      "The last refresh failed (you cannot see recording health); showing the status read 5s ago.",
    );
  });
});

describe("the paste box in the reader's language", () => {
  it("its heading, instructions and link are looked up, with or without its own heading", () => {
    const withHeading: HTMLElement = renderPasteBox();

    expect(withHeading).toHaveTextContent(marked("Ask the browser instead"));
    expect(withHeading).toHaveTextContent(
      marked(
        "Anything that stops the recorder before it uploads - a blocked script, a Do Not Track signal, an unsampled session, consent that was never granted - is only visible in the browser. On the page that is not recording, run this in the console, then paste the result below:",
      ),
    );
    expect(withHeading).toHaveTextContent(
      marked("Every code, explained in the docs"),
    );
    expect(withHeading).toHaveTextContent(marked("Explain it"));
    expect(unmarkedText(withHeading)).toEqual([]);

    cleanup();

    const withoutHeading: HTMLElement = renderPasteBox(false);

    expect(withoutHeading).toHaveTextContent(
      marked(
        "On the page that is not recording, run this in the browser console, then paste the result below.",
      ),
    );
    expect(unmarkedText(withoutHeading)).toEqual([]);
  });

  it("a paste that is not JSON is told so in the reader's language", () => {
    renderPasteBox();
    explain("not json {");

    expect(screen.getByTestId("diagnostics-error")).toHaveTextContent(
      marked(
        "That is not JSON. In the console run copy(JSON.stringify(OneUptimeReplay.getDiagnostics())) and paste the result here.",
      ),
    );
  });

  it("the explanation: the headline, the facts, the codes it does not know and every record, in the reader's words", () => {
    const box: HTMLElement = renderPasteBox();

    explain(
      JSON.stringify({
        version: "1.4.0",
        sessionId: null,
        isRecording: false,
        isUploading: false,
        state: "idle",
        bootstrapDecision: "privacy-signal",
        capabilities: ["click-events"],
        records: [
          { atUnixMs: NOW, level: "info", code: "loader-start" },
          { atUnixMs: NOW, level: "warn", code: "privacy-signal" },
          { atUnixMs: NOW, level: "info", code: "brand-new-code" },
          { atUnixMs: NOW, level: "info", code: "another-new-code" },
        ],
      }),
    );

    const explanation: HTMLElement = screen.getByTestId(
      "diagnostics-explanation",
    );

    expect(explanation).toHaveTextContent(
      marked(
        "This browser sends Do Not Track or Global Privacy Control, and the policy respects it, so nothing is recorded on it.",
      ),
    );
    expect(explanation).toHaveTextContent(
      marked(
        "Expected for this visitor. Test from a browser without the signal.",
      ),
    );
    expect(explanation).toHaveTextContent(
      `${marked("Session")}:${marked("none: no session was started on this page")}`,
    );
    expect(explanation).toHaveTextContent(
      `${marked("Capabilities")}:click-events`,
    );
    expect(explanation).toHaveTextContent(
      marked(
        "2 codes newer than this dashboard: brand-new-code, another-new-code. The docs link above lists every code.",
      ),
    );
    expect(screen.getAllByTestId("diagnostics-record")).toHaveLength(4);
    expect(unmarkedText(box)).toEqual([]);
  });

  it("an empty records array is explained in the reader's language", () => {
    renderPasteBox();
    explain(JSON.stringify({ records: [] }));

    expect(screen.getByTestId("diagnostics-explanation")).toHaveTextContent(
      marked(
        "The records array is empty: the recorder made no decision on that page at all, which means the loader never ran. Check that the script tag is on the page.",
      ),
    );
  });
});

describe("the hook hands every surface the diagnosis in the reader's language", () => {
  it("healthSnapshotInLanguage diagnoses the stored status again in the reader's words", () => {
    const stored: SessionReplayHealthSnapshot = {
      ...makeSnapshot(null, {
        error: { kind: "other", message: HEALTH_RESPONSE_UNREADABLE_MESSAGE },
      }),
      diagnosis: diagnoseRecordingHealth(null, NOW),
    };

    const inLanguage: SessionReplayHealthSnapshot = healthSnapshotInLanguage(
      stored,
      marking,
    );

    expect(inLanguage.diagnosis.title).toBe(
      marked("Recording health is unknown"),
    );
    // OneUptime's own words for an unreadable body are the reader's.
    expect(inLanguage.error?.message).toBe(
      marked("The health response was not readable."),
    );
    // The server's words stay as it wrote them.
    expect(
      healthSnapshotInLanguage(
        { ...stored, error: { kind: "permission", message: "Not authorized" } },
        marking,
      ).error?.message,
    ).toBe("Not authorized");
    // English, word for word.
    expect(healthSnapshotInLanguage(stored, english)).toEqual(stored);
  });

  it("the connected card shows the hook's diagnosis in the reader's words", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          isProjectAllowed: true,
          isApplicationEnabled: false,
          appIdentifier: "acme-web",
          allowedOrigins: [],
          samplePercentage: 100,
          captureTrigger: "Always",
          lastChunkReceivedAt: isoFromRealNow(12 * 1000),
          budgetExceededAt: null,
          projectBytesUsedToday: 0,
          dailyByteLimit: GB,
          applicationBytesUsedThisMonth: null,
          monthlyBudgetInGB: null,
        },
        {},
      ),
    );

    render(
      <MemoryRouter>
        <RecordingHealthCard rumApplicationId={APP_ID} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("health-card")).toHaveAttribute(
        "data-state",
        "disabled-app",
      );
    });

    expect(screen.getByTestId("health-diagnosis")).toHaveTextContent(
      marked("Session replay is switched off for acme-web"),
    );
    expect(screen.getByTestId("health-action")).toHaveTextContent(
      marked("Turn it on"),
    );
  });
});
