import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A case's "Why This Case Was Opened" card, drawn (#9556): the detection
 * that opened the case and how its rule counts, the events it matched -
 * each with what the rule looks for marked, how far its request got, where
 * it came from and its trace and logs one click away, the event whole in
 * the panel the Events explorer opens - the other detections folded to a
 * line, and where to look next.
 */

const panelProps: Array<Record<string, unknown>> = [];

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDetailPanel",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        panelProps.push(props);
        return React.createElement("div", { "data-testid": "event-panel" });
      },
    };
  },
);

import SecurityCaseWhyOpenedCard from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Matches/SecurityCaseWhyOpenedCard";
import { SECURITY_CASE_MATCHES_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Matches/SecurityCaseMatchesCopy";
import { SecurityCaseMatchesState } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Matches/useSecurityCaseMatches";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchedEventJson,
  SecurityCaseMatchesJson,
  SecurityCaseMatchesSource,
} from "../../../Types/SecurityCase/SecurityCaseMatches";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CASE_ID: string = "22222222-2222-4222-8222-222222222222";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

function event(
  index: number,
  overrides: Partial<SecurityCaseMatchedEventJson> = {},
): SecurityCaseMatchedEventJson {
  return {
    time: `2026-11-17T19:22:${String(10 + index).padStart(2, "0")}.000Z`,
    eventUid: `log:abc:${index}`,
    sourceId: "",
    severityName: "Medium",
    className: "HTTP Activity",
    categoryName: "",
    activityName: "",
    statusName: "",
    message: `Path traversal attempt: GET /api/get_log_file/../../proc/${index} → 404`,
    vendorName: "",
    productName: "",
    ruleName: "",
    principalUser: "",
    principalHost: "",
    principalIp: "35.196.249.14",
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: null,
    processName: "",
    processCommandLine: "",
    observables: [],
    mitreTactics: [],
    mitreTechniques: [],
    attributes: {
      "oneuptime.log.id": `abc-${index}`,
      "oneuptime.log.service": "oneuptime-nginx",
    },
    traceId: TRACE_ID,
    spanId: "00f067aa0ba902b7",
    sessionId: "",
    requestOutcome: "Rejected",
    hunt: null,
    ...overrides,
  };
}

function opening(
  overrides: Partial<SecurityCaseMatchedDetectionJson> = {},
): SecurityCaseMatchedDetectionJson {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    source: "Detection Rule",
    title: "Path traversal attempts — 35.196.249.14",
    severity: "Medium",
    groupValue: "35.196.249.14",
    ruleName: "Path traversal attempts",
    eventCount: 12,
    fireCount: 1,
    firstSeenAt: "2026-11-17T19:28:00.000Z",
    lastSeenAt: "2026-11-17T19:28:00.000Z",
    sampleMessage: "",
    isOpening: true,
    rule: {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Path traversal attempts",
      description:
        "Three or more requests from one IP address within five minutes trying to climb out of the web root with ../ sequences.",
      isEnabled: true,
      isRealTime: false,
      isCorrelation: false,
      threshold: 3,
      groupByField: "principalIp",
      distinctCountField: "",
      windowInMinutes: 5,
      sigmaRuleYaml:
        "title: Path traversal attempts\ndetection:\n  selection:\n    targetResource|contains: '../../'\n  condition: selection\n",
      falsePositives: [],
      references: ["https://owasp.org/www-community/attacks/Path_Traversal"],
      lookFor: [{ field: "targetResource", values: ["../../"] }],
    },
    threatIntelFeedId: "",
    securityEventConnectionId: "",
    basis: SecurityCaseMatchBasis.RuleCondition,
    windowStart: "2026-11-17T19:22:00.000Z",
    windowEnd: "2026-11-17T19:29:00.000Z",
    events: [0, 1, 2, 3, 4, 5, 6].map((index: number) => {
      return event(index);
    }),
    matchedEventCount: 12,
    outcomes: { Rejected: 12 },
    ...overrides,
  };
}

function matches(
  overrides: Partial<SecurityCaseMatchesJson> = {},
): SecurityCaseMatchesJson {
  return {
    detections: [opening()],
    detectionCount: 1,
    unreadableSources: [],
    failedSources: [],
    ...overrides,
  };
}

let reread: MockFunction;

function draw(state: Partial<SecurityCaseMatchesState> = {}): void {
  render(
    <MemoryRouter>
      <SecurityCaseWhyOpenedCard
        caseId={new ObjectID(CASE_ID)}
        state={{
          matches: matches(),
          error: "",
          reread: reread as unknown as () => void,
          ...state,
        }}
      />
    </MemoryRouter>,
  );
}

function detectionSection(): HTMLElement {
  return screen.getAllByTestId(SECURITY_CASE_MATCHES_TEST_IDS.detection)[0]!;
}

beforeEach(() => {
  panelProps.length = 0;
  reread = getJestMockFunction();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("why the case was opened", () => {
  test("names the rule, says it opened the case, and what it is for", () => {
    draw();

    expect(screen.getByText("Why This Case Was Opened")).toBeInTheDocument();
    const section: HTMLElement = detectionSection();

    expect(
      within(section).getByTestId(
        SECURITY_CASE_MATCHES_TEST_IDS.detectionTitle,
      ),
    ).toHaveTextContent("Path traversal attempts");
    expect(within(section).getByText("Opened the case")).toBeInTheDocument();
    expect(within(section).getByText("Detection Rule")).toBeInTheDocument();
    expect(
      within(section).getByText(/trying to climb out of the web root/),
    ).toBeInTheDocument();
  });

  test("says when the rule fires: its threshold, its field as code, its window", () => {
    draw();

    const firesWhen: HTMLElement = screen.getByTestId(
      SECURITY_CASE_MATCHES_TEST_IDS.firesWhen,
    );

    expect(firesWhen).toHaveTextContent(
      "Fires when 3 events happen for the same principalIp within 5 minutes.",
    );
    expect(within(firesWhen).getByText("principalIp").tagName).toBe("CODE");
  });

  test("says how many events it matched, from what, over when; what the rule looks for; how far the requests got", () => {
    draw();

    expect(
      screen.getByTestId(SECURITY_CASE_MATCHES_TEST_IDS.matched),
    ).toHaveTextContent(/12 events from 35\.196\.249\.14 between/);
    expect(
      screen.getByTestId(SECURITY_CASE_MATCHES_TEST_IDS.lookFor),
    ).toHaveTextContent("../../ in targetResource");

    const requests: HTMLElement = screen.getByTestId(
      SECURITY_CASE_MATCHES_TEST_IDS.requests,
    );

    expect(requests).toHaveTextContent("Rejected");
    expect(requests).toHaveTextContent("All 12 requests were turned away.");
  });

  test("links where the rule's own YAML says to read more, and folds the YAML away", async () => {
    draw();

    expect(
      within(
        screen.getByTestId(SECURITY_CASE_MATCHES_TEST_IDS.references),
      ).getByRole("link"),
    ).toHaveAttribute(
      "href",
      "https://owasp.org/www-community/attacks/Path_Traversal",
    );

    expect(screen.queryByText(/targetResource\|contains/)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByText("Show the rule"));
    });

    expect(screen.getByText(/targetResource\|contains/)).toBeInTheDocument();
    expect(screen.getByText("Hide the rule")).toBeInTheDocument();
  });
});

describe("what exactly matched", () => {
  test("lists the first events, each with what the rule looks for marked", () => {
    draw();

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      SECURITY_CASE_MATCHES_TEST_IDS.event,
    );

    expect(rows).toHaveLength(5);

    const marks: Array<HTMLElement> = within(rows[0]!).getAllByTestId(
      SECURITY_CASE_MATCHES_TEST_IDS.eventMark,
    );

    expect(marks[0]).toHaveTextContent("../../");
    expect(marks[0]!.tagName).toBe("MARK");
    expect(within(rows[0]!).getByText("Rejected")).toBeInTheDocument();
    expect(
      within(rows[0]!).getByText("Log line from oneuptime-nginx"),
    ).toBeInTheDocument();
  });

  test("opens each event's trace and logs", () => {
    draw();

    const links: HTMLElement = within(
      screen.getAllByTestId(SECURITY_CASE_MATCHES_TEST_IDS.event)[0]!,
    ).getByTestId(SECURITY_CASE_MATCHES_TEST_IDS.eventLinks);

    expect(within(links).getByText("Trace")).toBeInTheDocument();
    expect(within(links).getByText("Logs")).toBeInTheDocument();
    expect(within(links).getByText("Trace").closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining(TRACE_ID),
    );
  });

  test("shows the rest a click away, and says how many matched in all", async () => {
    draw();

    expect(
      screen.getByText("These are the first 7 of 12."),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(SECURITY_CASE_MATCHES_TEST_IDS.showAll),
      );
    });

    expect(
      screen.getAllByTestId(SECURITY_CASE_MATCHES_TEST_IDS.event),
    ).toHaveLength(7);
    expect(screen.getByText("Show fewer")).toBeInTheDocument();
  });

  test("an event opens whole, in the panel the Events explorer opens, saying what matched it", async () => {
    draw();

    await act(async () => {
      fireEvent.click(
        within(
          screen.getAllByTestId(SECURITY_CASE_MATCHES_TEST_IDS.event)[0]!,
        ).getByTestId(SECURITY_CASE_MATCHES_TEST_IDS.eventText),
      );
    });

    expect(screen.getByTestId("event-panel")).toBeInTheDocument();

    const props: Record<string, unknown> = panelProps[panelProps.length - 1]!;
    const shown: SecurityEvent = props["securityEvent"] as SecurityEvent;

    expect(shown.eventUid).toBe("log:abc:0");
    expect(shown.traceId).toBe(TRACE_ID);
    expect(props["showCaseActions"]).toBe(false);
  });

  test("says why no event is listed: none left, nothing to look up, refused or failed with Try again", async () => {
    draw({
      matches: matches({
        detections: [opening({ events: [], matchedEventCount: 0 })],
      }),
    });

    expect(
      screen.getByTestId(SECURITY_CASE_MATCHES_TEST_IDS.noEvents),
    ).toHaveTextContent("No events are left to show.");
    cleanup();

    draw({
      matches: matches({
        detections: [
          opening({
            events: [],
            matchedEventCount: null,
            windowStart: null,
            windowEnd: null,
          }),
        ],
      }),
    });

    expect(
      screen.getByTestId(SECURITY_CASE_MATCHES_TEST_IDS.noEvents),
    ).toHaveTextContent(
      "This detection names nothing to look its events up by.",
    );
    cleanup();

    draw({
      matches: matches({
        detections: [opening({ events: [], matchedEventCount: null })],
        unreadableSources: [SecurityCaseMatchesSource.Events],
      }),
    });

    expect(
      screen.getByTestId(SECURITY_CASE_MATCHES_TEST_IDS.noEvents),
    ).toHaveTextContent(
      "Your role cannot read the events this detection matched.",
    );
    cleanup();

    draw({
      matches: matches({
        detections: [opening({ events: [], matchedEventCount: null })],
        failedSources: [SecurityCaseMatchesSource.Events],
      }),
    });

    const failed: HTMLElement = screen.getByTestId(
      SECURITY_CASE_MATCHES_TEST_IDS.noEvents,
    );

    expect(failed).toHaveTextContent("The events could not be read just now.");

    await act(async () => {
      fireEvent.click(within(failed).getByText("Try again"));
    });

    expect(reread).toHaveBeenCalledTimes(1);
  });

  test("events that are not exactly what the rule matched say what they are", () => {
    draw({
      matches: matches({
        detections: [
          opening({ basis: SecurityCaseMatchBasis.NamedEntities, rule: null }),
        ],
      }),
    });

    expect(
      screen.getByTestId(SECURITY_CASE_MATCHES_TEST_IDS.basisNote),
    ).toHaveTextContent(
      "The events naming 35.196.249.14 around when it fired.",
    );
  });
});

describe("the rest of the case", () => {
  test("its other detections fold to a line, their events a click away, and more detections link to the page that lists them", async () => {
    draw({
      matches: matches({
        detections: [
          opening(),
          opening({
            id: "77777777-7777-4777-8777-777777777777",
            isOpening: false,
            title: "Abuse IPs — 35.196.249.14",
            source: "Threat Intel",
            rule: null,
            basis: SecurityCaseMatchBasis.Indicator,
            fireCount: 3,
          }),
        ],
        detectionCount: 4,
      }),
    });

    const others: HTMLElement = screen.getByTestId(
      SECURITY_CASE_MATCHES_TEST_IDS.others,
    );

    expect(
      within(others).getByText("Abuse IPs — 35.196.249.14"),
    ).toBeInTheDocument();
    expect(within(others).getByText("Fired 3 times")).toBeInTheDocument();
    expect(
      screen.getByTestId(SECURITY_CASE_MATCHES_TEST_IDS.moreDetections),
    ).toHaveTextContent("2 more detections are on the Detections page.");

    expect(
      screen.getAllByTestId(SECURITY_CASE_MATCHES_TEST_IDS.detection),
    ).toHaveLength(1);

    await act(async () => {
      fireEvent.click(within(others).getByText("Show what it matched"));
    });

    expect(
      screen.getAllByTestId(SECURITY_CASE_MATCHES_TEST_IDS.detection),
    ).toHaveLength(2);
    expect(screen.getByText("Joined the case")).toBeInTheDocument();
  });

  test("says where to look next", () => {
    draw();

    const lookNext: HTMLElement = screen.getByTestId(
      SECURITY_CASE_MATCHES_TEST_IDS.lookNext,
    );

    expect(
      within(lookNext).getByText("Everything about 35.196.249.14"),
    ).toBeInTheDocument();
    expect(
      within(lookNext).getByText("Events naming 35.196.249.14"),
    ).toBeInTheDocument();
    expect(
      within(lookNext).getByText("Log lines naming 35.196.249.14"),
    ).toBeInTheDocument();
    expect(
      within(lookNext).getByText("The trace of this request"),
    ).toBeInTheDocument();
    expect(within(lookNext).getByText("The case's story")).toBeInTheDocument();
  });

  test("a case nobody's detection opened says it was opened by hand, with the way to its evidence", () => {
    draw({ matches: matches({ detections: [], detectionCount: 0 }) });

    expect(
      screen.getByTestId(SECURITY_CASE_MATCHES_TEST_IDS.openedByHand),
    ).toHaveTextContent("Opened by hand");
    expect(screen.getByText("Open Evidence")).toBeInTheDocument();
  });

  /*
   * Regression: detections the reader's role cannot read, or that failed to
   * read, came back as none, and the card said nobody's detection opened a
   * case that three detections had.
   */
  test("detections it could not read are never said to be no detection: the role's refusal, or a failure with Try again", async () => {
    draw({
      matches: matches({
        detections: [],
        detectionCount: 3,
        unreadableSources: [SecurityCaseMatchesSource.Detections],
      }),
    });

    expect(
      screen.getByTestId(SECURITY_CASE_MATCHES_TEST_IDS.detectionsUnread),
    ).toHaveTextContent(
      "Your role cannot read this case's detections, so why it was opened is not shown.",
    );
    expect(
      screen.queryByTestId(SECURITY_CASE_MATCHES_TEST_IDS.openedByHand),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Try again")).not.toBeInTheDocument();
    cleanup();

    draw({
      matches: matches({
        detections: [],
        detectionCount: 3,
        failedSources: [SecurityCaseMatchesSource.Detections],
      }),
    });

    const failed: HTMLElement = screen.getByTestId(
      SECURITY_CASE_MATCHES_TEST_IDS.detectionsUnread,
    );

    expect(failed).toHaveTextContent(
      "The case's detections could not be read just now.",
    );
    expect(
      screen.queryByTestId(SECURITY_CASE_MATCHES_TEST_IDS.openedByHand),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(failed).getByText("Try again"));
    });

    expect(reread).toHaveBeenCalledTimes(1);
  });
});

describe("while it reads, and when it cannot", () => {
  test("draws the shape it will have while it reads", () => {
    draw({ matches: null });

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  test("says why it could not read, with a way to read it again", async () => {
    draw({ matches: null, error: "The server is down." });

    expect(
      screen.getByTestId(SECURITY_CASE_MATCHES_TEST_IDS.error),
    ).toHaveTextContent("The server is down.");
  });
});
