/** @timezone UTC */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
} from "../../../Types/SecurityCase/SecurityConnection";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import { SecurityAttackCampaignsResult } from "../../../Types/SecurityEvent/SecurityAttackCampaign";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { SECURITY_LOG_ID_ATTRIBUTE } from "../../../Types/SecurityEvent/SecurityLogFormat";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

type Spy = ReturnType<typeof getJestSpyOn>;
import SecurityEventWhatHappenedNext, {
  WHAT_HAPPENED_NEXT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventWhatHappenedNext";
import SecurityEventSourceSection, {
  SECURITY_EVENT_LOG_LINE_TEST_ID,
  WHERE_IT_CAME_FROM_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventSourceSection";
import SecurityEventsInSignal, {
  SECURITY_EVENTS_IN_SIGNAL_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsInSignal";
import SecurityAttackCampaigns, {
  SECURITY_ATTACK_CAMPAIGN_ROW_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityAttackCampaigns";
import {
  SecurityEventRequestFacts,
  readSecurityEventRequestFacts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventRequestStory";

/*
 * What Security Events says about the request behind an event, as a reader
 * sees it: the panel's What happened next and Where it came from, the
 * callout a log line, a trace or an exception shows about its security
 * events, and the Campaigns page. The server is stubbed at the doors these
 * views use (the analytics list, the model read, the session lookup and the
 * campaigns read), so each test shows what the reader is shown, and what
 * they are not shown when a read is refused.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LOG_ID: string = "0192f1a0-0000-7000-8000-000000000001";
const SERVICE_ID: string = "0192f1a0-0000-7000-8000-0000000000aa";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

const resolveReplayMock: MockFunction = getJestMockFunction();
const getAttackCampaignsMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/RumSessionLookup",
  () => {
    return {
      __esModule: true,
      resolveReplayMomentRouteForSession: (...args: Array<unknown>) => {
        return resolveReplayMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi",
  () => {
    return {
      __esModule: true,
      default: {
        getAttackCampaigns: (...args: Array<unknown>) => {
          return getAttackCampaignsMock(...args);
        },
      },
    };
  },
);

function event(fields: Partial<SecurityEvent> = {}): SecurityEvent {
  return Object.assign(new SecurityEvent(), {
    time: new Date("2026-10-27T06:45:12.000Z"),
    ...fields,
  });
}

function logEvent(fields: Partial<SecurityEvent> = {}): SecurityEvent {
  return event({
    attributes: {
      [SECURITY_LOG_ID_ATTRIBUTE]: LOG_ID,
      [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]: SERVICE_ID,
      [SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE]: ServiceType.OpenTelemetry,
    },
    ...fields,
  });
}

function factsOf(securityEvent: SecurityEvent): SecurityEventRequestFacts {
  return readSecurityEventRequestFacts(securityEvent);
}

function inRouter(element: React.ReactElement): React.ReactElement {
  return <MemoryRouter>{element}</MemoryRouter>;
}

beforeEach(() => {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  resolveReplayMock.mockReset();
  resolveReplayMock.mockResolvedValue(undefined as never);
  getAttackCampaignsMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("What happened next", () => {
  test("says the app turned a probe away, with who sent it", () => {
    const followed: SecurityEvent = event({
      traceId: TRACE_ID,
      requestOutcome: SecurityEventRequestOutcome.Rejected,
      principalIp: "198.51.100.23",
      attributes: {
        [SECURITY_REQUEST_ATTRIBUTES.statusCode]: "404",
        [SECURITY_REQUEST_ATTRIBUTES.durationMs]: "3",
        [SECURITY_REQUEST_ATTRIBUTES.method]: "GET",
        [SECURITY_REQUEST_ATTRIBUTES.url]: "/sitemap.xml?offset=1",
      },
    });

    render(
      <SecurityEventWhatHappenedNext
        facts={factsOf(followed)}
        hasTrace={true}
        isReadingTrace={false}
      />,
    );

    const section: HTMLElement = screen.getByTestId(WHAT_HAPPENED_NEXT_TEST_ID);

    expect(section).toHaveTextContent("What happened next");
    expect(section).toHaveTextContent("Rejected");
    expect(section).toHaveTextContent(
      "The app turned it away: it answered 404 Not Found in 3 ms.",
    );
    expect(section).toHaveTextContent("From 198.51.100.23");
    expect(section).toHaveTextContent("GET /sitemap.xml?offset=1");
  });

  test("shows the query an injection ran in", () => {
    render(
      <SecurityEventWhatHappenedNext
        facts={factsOf(
          event({
            traceId: TRACE_ID,
            requestOutcome: SecurityEventRequestOutcome.ReachedDatabase,
            attributes: {
              [SECURITY_REQUEST_ATTRIBUTES.databaseSystem]: "mysql",
              [SECURITY_REQUEST_ATTRIBUTES.databaseStatement]:
                "SELECT * FROM pages WHERE id = 1 UNION SELECT password",
            },
          }),
        )}
        hasTrace={true}
        isReadingTrace={false}
      />,
    );

    const section: HTMLElement = screen.getByTestId(WHAT_HAPPENED_NEXT_TEST_ID);

    expect(section).toHaveTextContent("Reached Database");
    expect(section).toHaveTextContent(
      "The injected SQL ran: a mysql query the request made holds it.",
    );
    expect(section).toHaveTextContent("UNION SELECT password");
  });

  test("says it is reading the trace while it is", () => {
    render(
      <SecurityEventWhatHappenedNext
        facts={factsOf(event({ traceId: TRACE_ID }))}
        hasTrace={true}
        isReadingTrace={true}
      />,
    );

    expect(screen.getByTestId(WHAT_HAPPENED_NEXT_TEST_ID)).toHaveTextContent(
      "Reading the request's trace",
    );
  });

  test("is not shown for an event in no request", () => {
    render(
      <SecurityEventWhatHappenedNext
        facts={factsOf(event())}
        hasTrace={false}
        isReadingTrace={false}
      />,
    );

    expect(
      screen.queryByTestId(WHAT_HAPPENED_NEXT_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("Where it came from", () => {
  test("shows the log line, the service that wrote it, and every way to the request", async () => {
    jest.spyOn(AnalyticsModelAPI, "getList").mockResolvedValue({
      data: [Object.assign(new SecurityEvent(), { body: "GET /x?id=1' or 1=1" })],
      count: 1,
      skip: 0,
      limit: 1,
    } as never);
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue({
      name: "api",
    } as never);
    resolveReplayMock.mockResolvedValue(
      new Route("/dashboard/p/rum/app/session-replay/session-1") as never,
    );

    const followed: SecurityEvent = logEvent({
      traceId: TRACE_ID,
      spanId: "00f067aa0ba902b7",
      sessionId: "session-1",
      attributes: {
        [SECURITY_LOG_ID_ATTRIBUTE]: LOG_ID,
        [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]: SERVICE_ID,
        [SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE]: ServiceType.OpenTelemetry,
        [SECURITY_REQUEST_ATTRIBUTES.exceptionFingerprint]: "fp-1",
      },
    });

    render(
      inRouter(
        <SecurityEventSourceSection
          securityEvent={followed}
          facts={factsOf(followed)}
        />,
      ),
    );

    const section: HTMLElement = screen.getByTestId(WHERE_IT_CAME_FROM_TEST_ID);

    await waitFor(() => {
      expect(screen.getByTestId(SECURITY_EVENT_LOG_LINE_TEST_ID)).toHaveTextContent(
        "GET /x?id=1' or 1=1",
      );
    });
    await waitFor(() => {
      expect(section).toHaveTextContent("From a log line written by api");
    });
    await waitFor(() => {
      expect(screen.getByTestId("security-event-watch-session")).toBeInTheDocument();
    });

    expect(screen.getByTestId("security-event-view-trace")).toHaveTextContent(
      "View trace",
    );
    expect(
      screen.getByTestId("security-event-view-exception"),
    ).toHaveTextContent("View exception");
    expect(screen.getByTestId("security-event-view-logs")).toHaveTextContent(
      "Logs of this request",
    );
    // The line names its trace, so there is nothing to explain.
    expect(section).not.toHaveTextContent("wasn't written inside a traced request");
  });

  test("a line written outside any request says why it cannot be followed", async () => {
    jest.spyOn(AnalyticsModelAPI, "getList").mockResolvedValue({
      data: [Object.assign(new SecurityEvent(), { body: "a line" })],
      count: 1,
      skip: 0,
      limit: 1,
    } as never);
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null as never);

    const fromLog: SecurityEvent = logEvent();

    render(
      inRouter(
        <SecurityEventSourceSection
          securityEvent={fromLog}
          facts={factsOf(fromLog)}
        />,
      ),
    );

    const section: HTMLElement = screen.getByTestId(WHERE_IT_CAME_FROM_TEST_ID);

    expect(section).toHaveTextContent("wasn't written inside a traced request");
    expect(section).toHaveTextContent("From a log line in your telemetry");
    expect(screen.queryByTestId("security-event-view-trace")).toBeNull();
    // Its neighbours in the logs, rather than its request's.
    expect(screen.getByTestId("security-event-view-logs")).toHaveTextContent(
      "Logs around it",
    );
  });

  test("a reader who may not read logs is told so, and nothing breaks", async () => {
    jest
      .spyOn(AnalyticsModelAPI, "getList")
      .mockRejectedValue({ statusCode: 403 } as never);
    jest.spyOn(ModelAPI, "getItem").mockRejectedValue(new Error("403") as never);

    const fromLog: SecurityEvent = logEvent({ traceId: TRACE_ID });

    render(
      inRouter(
        <SecurityEventSourceSection
          securityEvent={fromLog}
          facts={factsOf(fromLog)}
        />,
      ),
    );

    await waitFor(() => {
      expect(screen.getByTestId(WHERE_IT_CAME_FROM_TEST_ID)).toHaveTextContent(
        "Reading logs takes a Telemetry role.",
      );
    });
    expect(screen.getByTestId("security-event-view-trace")).toBeInTheDocument();
  });

  test("an event from a connected product, in no request, shows nothing", () => {
    render(
      inRouter(
        <SecurityEventSourceSection
          securityEvent={event()}
          facts={factsOf(event())}
        />,
      ),
    );

    expect(screen.queryByTestId(WHERE_IT_CAME_FROM_TEST_ID)).toBeNull();
  });
});

describe("the security events a request is part of", () => {
  test("says how many, names the worst, and links to all of them", async () => {
    const getList: Spy = getJestSpyOn(
      AnalyticsModelAPI,
      "getList",
    ).mockResolvedValue({
        data: [
          event({
            severityName: OcsfSeverity.Low,
            severityId: 2,
            message: "SQL injection attempt: GET /a → 404",
            requestOutcome: SecurityEventRequestOutcome.Rejected,
          }),
          event({
            severityName: OcsfSeverity.Critical,
            severityId: 5,
            message: "SQL injection attempt: GET /b → 200",
            requestOutcome: SecurityEventRequestOutcome.ReachedDatabase,
          }),
        ],
        count: 2,
        skip: 0,
        limit: 50,
      } as never);

    render(inRouter(<SecurityEventsInSignal scope={{ traceId: TRACE_ID }} />));

    const callout: HTMLElement = await screen.findByTestId(
      SECURITY_EVENTS_IN_SIGNAL_TEST_ID,
    );

    expect(callout).toHaveTextContent(
      "2 security events happened in this request",
    );
    expect(callout).toHaveTextContent("SQL injection attempt: GET /b → 200");
    expect(callout).toHaveTextContent("Reached Database");
    expect(
      screen.getByTestId("security-events-in-signal-open"),
    ).toHaveTextContent("Open in Security Events");

    const query: Record<string, unknown> = (
      getList.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["traceId"]).toBe(TRACE_ID);
  });

  test("shows nothing when there are none, or when the reader may not read them", async () => {
    const getList: Spy = getJestSpyOn(AnalyticsModelAPI, "getList")
      .mockResolvedValueOnce({ data: [], count: 0, skip: 0, limit: 50 })
      .mockRejectedValueOnce({ statusCode: 403 });

    const { rerender } = render(
      inRouter(<SecurityEventsInSignal scope={{ traceId: TRACE_ID }} />),
    );

    await waitFor(() => {
      expect(getList).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId(SECURITY_EVENTS_IN_SIGNAL_TEST_ID)).toBeNull();

    rerender(inRouter(<SecurityEventsInSignal scope={{ traceId: "other" }} />));

    await waitFor(() => {
      expect(getList).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByTestId(SECURITY_EVENTS_IN_SIGNAL_TEST_ID)).toBeNull();
  });

  test("asks nothing for nothing", () => {
    const getList: Spy = getJestSpyOn(AnalyticsModelAPI, "getList");

    render(inRouter(<SecurityEventsInSignal scope={{}} />));

    expect(getList).not.toHaveBeenCalled();
  });
});

describe("Campaigns", () => {
  function result(
    overrides: Partial<SecurityAttackCampaignsResult> = {},
  ): SecurityAttackCampaignsResult {
    return {
      campaigns: [
        {
          sourceIp: "203.0.113.9",
          requestCount: 4,
          rejectedCount: 3,
          reachedAppCount: 0,
          erroredCount: 0,
          reachedDatabaseCount: 1,
          worstOutcome: SecurityEventRequestOutcome.ReachedDatabase,
          maxSeverityId: 5,
          attackKinds: ["sql-injection"],
          userAgents: ["sqlmap/1.7.2#stable"],
          targetCount: 4,
          sampleTargets: ["/item?id=1' or 1=1"],
          firstSeen: "2026-10-27T05:00:00.000Z",
          lastSeen: "2026-10-27T06:00:00.000Z",
        },
        {
          sourceIp: "198.51.100.23",
          requestCount: 96,
          rejectedCount: 96,
          reachedAppCount: 0,
          erroredCount: 0,
          reachedDatabaseCount: 0,
          worstOutcome: SecurityEventRequestOutcome.Rejected,
          maxSeverityId: 2,
          attackKinds: ["path-traversal"],
          userAgents: [],
          targetCount: 40,
          sampleTargets: ["/etc/passwd"],
          firstSeen: "2026-10-27T05:00:00.000Z",
          lastSeen: "2026-10-27T06:45:00.000Z",
        },
      ],
      startTime: "2026-10-20T12:00:00.000Z",
      endTime: "2026-10-27T12:00:00.000Z",
      isTruncated: false,
      ...overrides,
    };
  }

  test("lists each attacker as one row, the one that got through first, with the page's totals", async () => {
    getAttackCampaignsMock.mockResolvedValue(result() as never);

    render(inRouter(<SecurityAttackCampaigns />));

    const rows: Array<HTMLElement> = await screen.findAllByTestId(
      SECURITY_ATTACK_CAMPAIGN_ROW_TEST_ID,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("203.0.113.9");
    expect(rows[0]).toHaveTextContent("SQL injection");
    expect(rows[0]).toHaveTextContent("1 request got through");
    expect(rows[0]).toHaveTextContent("sqlmap/1.7.2#stable");
    expect(rows[1]).toHaveTextContent("Every request was turned away");
    expect(rows[1]).toHaveTextContent("Path traversal");
    expect(screen.getByText("Attackers")).toBeInTheDocument();
    expect(screen.getByText("Got through")).toBeInTheDocument();
    // Seven days unless the reader picks another window.
    expect(getAttackCampaignsMock).toHaveBeenCalledTimes(1);
  });

  test("an empty window says so, and what would fill it", async () => {
    getAttackCampaignsMock.mockResolvedValue(
      result({ campaigns: [] }) as never,
    );

    render(inRouter(<SecurityAttackCampaigns />));

    expect(
      await screen.findByText("No attack campaigns in this window"),
    ).toBeInTheDocument();
  });

  test("a failed read says what failed", async () => {
    getAttackCampaignsMock.mockRejectedValue(
      new Error("Reading security events takes a Security role.") as never,
    );

    render(inRouter(<SecurityAttackCampaigns />));

    expect(
      await screen.findByText("Reading security events takes a Security role."),
    ).toBeInTheDocument();
  });
});
