import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
import { createTranslator, Translator } from "../../../Types/Translator";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Replay Health page in the reader's language (#6369). Every lookup is
 * marked: Translation's translateString wraps what it is given in ⟦ ⟧, so
 * a string the page looks up reads ⟦...⟧, a sentence looked up whole
 * encloses its values, and a string looked up twice reads ⟦⟦...⟧⟧. The
 * diagnosis comes as useSessionReplayHealth writes it, in the reader's
 * language. What is left of the page's text once the marked strings and
 * the recording's own data are taken out is numbers and punctuation only:
 * no English sentence is drawn as written.
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
import RecordingHealthDashboard, {
  RecordingHealthDashboardView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthDashboard";
import {
  SessionReplayHealthSnapshot,
  clearSessionReplayHealthStore,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");
const MB: number = 1024 * 1024;
const GB: number = 1024 * MB;

const OPEN: string = "⟦";
const CLOSE: string = "⟧";

// The reader's translator, as the stub above makes it for the page.
const marking: Translator = createTranslator((text: string): string => {
  return `${OPEN}${text}${CLOSE}`;
}, "de");

// The recording's own words: drawn as written.
const DATA: Array<string> = [
  "https://app.acme.com",
  "acme-web",
  "click-events",
  "web-vitals",
  "origin-not-allowed",
  "rate-limited",
  "scrub-incomplete",
  "Forbidden",
  "Brand-new",
];

// Numbers and punctuation: what may stand outside a lookup.
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

/*
 * The text left once every marked string (innermost first) and every
 * piece of data is taken out.
 */
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

// Every text node of the page outside code, with what is left of it.
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

// Every accessible name the page sets itself, with what is left of it.
function unmarkedLabels(container: HTMLElement): Array<string> {
  return Array.from(container.querySelectorAll("[aria-label]"))
    .map((element: Element): string => {
      return element.getAttribute("aria-label") || "";
    })
    .filter((label: string): boolean => {
      return !NOT_WORDS.test(residueOf(label));
    });
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
    lastChunkReceivedAt: iso(12 * 1000),
    lastSessionStartedAt: iso(60 * 1000),
    budgetExceededAt: null,
    sessionsLast24h: 143,
    playableSessionsLast24h: 120,
    refusalsLast24h: [
      { reason: "origin-not-allowed", count: 20 },
      { reason: "rate-limited", count: 3 },
    ],
    projectBytesUsedToday: 512 * MB,
    dailyByteLimit: GB,
    applicationBytesUsedThisMonth: 3 * MB,
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
    extras: {
      dropsLast24h: [{ reason: "scrub-incomplete", count: 12 }],
      recorderCapabilities: ["click-events", "web-vitals"],
    },
    isLoading: false,
    isRefreshing: false,
    error: null,
    fetchedAtUnixMs: NOW,
    nowUnixMs: NOW,
    ...overrides,
  };
}

function renderView(
  snapshot: SessionReplayHealthSnapshot,
  props?: Partial<React.ComponentProps<typeof RecordingHealthDashboardView>>,
): HTMLElement {
  render(
    <MemoryRouter>
      <RecordingHealthDashboardView
        rumApplicationId={APP_ID}
        health={snapshot}
        clockUnixMs={NOW + 45 * 1000}
        pollIntervalMs={60 * 1000}
        onRefresh={(): void => {}}
        {...props}
      />
    </MemoryRouter>,
  );

  return screen.getByTestId("health-page");
}

function wireStatus(overrides?: JSONObject): JSONObject {
  return {
    isProjectAllowed: true,
    isApplicationEnabled: true,
    appIdentifier: "acme-web",
    allowedOrigins: ["https://app.acme.com"],
    samplePercentage: 100,
    captureTrigger: "Always",
    lastChunkReceivedAt: isoFromRealNow(12 * 1000),
    budgetExceededAt: null,
    projectBytesUsedToday: 1024,
    dailyByteLimit: GB,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    consentMode: "NotRequired",
    maskingMode: "MaskSensitiveInputsOnly",
    retentionInDays: 7,
    publishedRecorderVersion: "1.4.0",
    lastConfigFetchAt: isoFromRealNow(12 * 1000),
    lastSessionStartedAt: isoFromRealNow(60 * 1000),
    sessionsLast24h: 143,
    playableSessionsLast24h: 120,
    refusalsLast24h: [],
    dropsLast24h: [],
    recorderCapabilities: ["click-events"],
    ...overrides,
  };
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

describe("the Replay Health page in the reader's language", () => {
  it("draws no English of its own: every string it shows is looked up", () => {
    const page: HTMLElement = renderView(makeSnapshot(makeStatus()));

    expect(unmarkedText(page)).toEqual([]);
    expect(unmarkedLabels(page)).toEqual([]);
  });

  /*
   * The state word the E2E suites read is the state as the code names it,
   * in every language - and no reader hears it: the title says the same
   * in their words.
   */
  it("keeps the E2E state word as the code names it, hidden from assistive technology", () => {
    renderView(makeSnapshot(makeStatus()));

    const level: HTMLElement = screen.getByTestId("health-level");

    expect(level.textContent).toBe("refusing");
    expect(level).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("health-title")).toHaveTextContent(
      marked(`20 uploads refused in 24h: ${marked("origin not allowed")}`),
    );
  });

  it("the hero: the diagnosis, the page's name beside the application's, when it was read and how often", () => {
    renderView(makeSnapshot(makeStatus({ refusalsLast24h: [] })));

    expect(screen.getByTestId("health-title")).toHaveTextContent(
      marked("Recording healthy"),
    );
    expect(screen.getByTestId("health-hero")).toHaveTextContent(
      `${marked("Recording health")} · acme-web`,
    );
    expect(screen.getByTestId("health-updated")).toHaveTextContent(
      marked(`Updated ${marked("45s ago")}`),
    );
    expect(screen.getByTestId("health-updated")).toHaveTextContent(
      marked("refreshes every minute"),
    );
  });

  it("each panel's title, hint, label and line is looked up once, and the (i) gets the English", () => {
    renderView(makeSnapshot(makeStatus()));

    expect(screen.getByTestId("health-uploads")).toHaveAttribute(
      "aria-label",
      marked("Uploads in the last 24 hours"),
    );
    expect(screen.getByTestId("health-refusals")).toHaveTextContent(
      marked("Refused at the gate"),
    );
    expect(screen.getByTestId("health-refusals-total")).toHaveTextContent(
      marked("23 total"),
    );
    expect(screen.getByTestId("health-refusals")).toHaveTextContent(
      marked("origin not allowed"),
    );
    expect(screen.getByTestId("health-drops")).toHaveTextContent(
      "scrub-incomplete",
    );
    expect(screen.getByTestId("health-meter-project-day")).toHaveTextContent(
      marked("512 MB of 1 GB"),
    );
    expect(screen.getByTestId("health-meter-app-month")).toHaveTextContent(
      marked("3 MB used"),
    );
    expect(screen.getByTestId("health-meter-app-month")).toHaveTextContent(
      marked("No monthly budget is set (0 or blank means no ceiling)."),
    );
    expect(screen.getByTestId("health-policy-retention")).toHaveTextContent(
      marked("7 days"),
    );
    expect(screen.getByTestId("health-policy-trigger")).toHaveTextContent(
      marked("Always"),
    );
    expect(screen.getByTestId("health-edit-policy")).toHaveTextContent(
      marked("Edit policy"),
    );
    expect(screen.getByTestId("health-stage-recorder")).toHaveTextContent(
      marked("Recorder loaded"),
    );
    expect(screen.getByTestId("health-stage-recorder-value")).toHaveTextContent(
      marked("12s ago"),
    );

    /*
     * The (i) names what it explains in a sentence of its own, the label
     * looked up with it: once, never ⟦⟦...⟧⟧.
     */
    const infoLabels: Array<string> = Array.from(
      document.querySelectorAll("button[aria-label]"),
    )
      .map((element: Element): string => {
        return element.getAttribute("aria-label") || "";
      })
      .filter((label: string): boolean => {
        return label.startsWith(`${OPEN}About`);
      });

    expect(infoLabels).toEqual([
      marked(`About ${marked("Recorder loaded")}`),
      marked(`About ${marked("Recording allowed")}`),
      marked(`About ${marked("Chunks received")}`),
      marked(`About ${marked("Sessions in 24h")}`),
      marked(`About ${marked("Refused at the gate")}`),
      marked(`About ${marked("Dropped after acceptance")}`),
      marked(`About ${marked("Project bytes today")}`),
      marked(`About ${marked("This application this month")}`),
    ]);
  });

  it("loading, unknown counters, an unreported policy and recorder: still no English of its own", () => {
    const loading: HTMLElement = renderView(
      makeSnapshot(null, { isLoading: true, fetchedAtUnixMs: null }),
    );

    expect(screen.getByTestId("health-title")).toHaveTextContent(
      marked("Checking recording health…"),
    );
    expect(screen.getByTestId("health-updated")).toHaveTextContent(
      marked("Not read yet"),
    );
    expect(unmarkedText(loading)).toEqual([]);

    cleanup();

    const unknown: HTMLElement = renderView(
      makeSnapshot(
        makeStatus({
          refusalsLast24h: null,
          sessionsLast24h: null,
          playableSessionsLast24h: null,
          projectBytesUsedToday: null,
          publishedRecorderVersion: null,
          allowedOrigins: [],
          policy: {
            ...makeStatus().policy,
            captureTrigger: "Brand-new",
            consentMode: "",
            retentionInDays: 30,
          },
        }),
        { extras: { dropsLast24h: null, recorderCapabilities: null } },
      ),
    );

    expect(screen.getByTestId("health-policy-trigger")).toHaveTextContent(
      marked("unrecognised value (Brand-new)"),
    );
    expect(screen.getByTestId("health-policy-retention")).toHaveTextContent(
      marked("30 days"),
    );
    expect(screen.getByTestId("health-refusals")).toHaveTextContent(
      marked("Unknown: the counter store was unreachable."),
    );
    expect(screen.getByTestId("health-capabilities")).toHaveTextContent(
      marked("not reported"),
    );
    expect(unmarkedText(unknown)).toEqual([]);
  });

  /*
   * The server's words are looked up as any error put in a sentence is
   * (ErrorSentence, #7307): a message the Dashboard has words for reads in
   * the reader's language, any other as written. Every lookup is marked
   * here, so they are marked inside the sentence's own marks.
   */
  it("no status and an error: the reason in the reader's words, the server's own words looked up inside them", () => {
    const page: HTMLElement = renderView(
      makeSnapshot(null, {
        error: { kind: "permission", message: "Forbidden" },
        fetchedAtUnixMs: null,
      }),
    );

    expect(screen.getByTestId("health-title")).toHaveTextContent(
      marked("You cannot see recording health"),
    );
    expect(screen.getByTestId("health-error-message")).toHaveTextContent(
      marked(`Server said: ${marked("Forbidden")}`),
    );
    /*
     * The sentence is drawn around its error (ErrorSentence): its two
     * halves are text of their own, one marked sentence with the error
     * between them (above). Nothing else is left unmarked.
     */
    expect(unmarkedText(page)).toEqual(["⟦Server said: ", "⟧"]);
  });

  it("a failed refresh says why and how old the status is, one whole sentence per failure", () => {
    renderView(
      makeSnapshot(makeStatus(), {
        error: { kind: "other", message: "boom" },
        fetchedAtUnixMs: NOW - 3 * 60 * 1000,
      }),
    );

    expect(screen.getByTestId("health-stale")).toHaveTextContent(
      marked(
        `The last refresh failed (recording health could not be loaded); showing the status read ${marked("3m ago")}.`,
      ),
    );

    cleanup();
    renderView(
      makeSnapshot(makeStatus(), {
        error: { kind: "plan", message: "Please upgrade your plan" },
        fetchedAtUnixMs: null,
      }),
    );

    expect(screen.getByTestId("health-stale")).toHaveTextContent(
      marked(
        "The last refresh failed (recording health is not included in this project's plan); showing the status read earlier.",
      ),
    );
  });
});

describe("the connected page diagnoses in the reader's language", () => {
  it("the hook hands every surface the diagnosis in the reader's words", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, wireStatus(), {}),
    );

    render(
      <MemoryRouter>
        <RecordingHealthDashboard rumApplicationId={APP_ID} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("health-level")).toHaveTextContent("healthy");
    });

    expect(screen.getByTestId("health-title")).toHaveTextContent(
      marked("Recording healthy"),
    );
    expect(screen.getByTestId("health-detail").textContent).toMatch(
      /^⟦Last chunk ⟦\d+s ago⟧ - ⟦143 sessions in 24h \(120 playable\)⟧ - sampling 100%\.⟧$/,
    );
  });

  it("a body that is not a status: OneUptime's own words for it are the reader's too", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, [] as unknown as JSONObject, {}),
    );

    render(
      <MemoryRouter>
        <RecordingHealthDashboard rumApplicationId={APP_ID} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("health-level")).toHaveTextContent("error");
    });

    expect(screen.getByTestId("health-title")).toHaveTextContent(
      marked("Recording health could not be loaded"),
    );
    expect(screen.getByTestId("health-error-message")).toHaveTextContent(
      /*
       * The hook hands its own words out in the reader's language, and the
       * sentence looks them up once more, as it does any error: a wording
       * is no key, so it reads as handed out.
       */
      marked(
        `Server said: ${marked(marked("The health response was not readable."))}`,
      ),
    );
  });
});
