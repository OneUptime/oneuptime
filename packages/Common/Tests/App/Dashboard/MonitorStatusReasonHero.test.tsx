/** @timezone UTC */

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
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { getJestSpyOn } from "../../Spy";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import MonitorOverviewHero, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewHero";
import {
  getMonitorStatusReason,
  isStatusExplained,
  MONITOR_STATUS_REASON_ITEM_KEY,
  MonitorOverviewStatusReason,
  MonitorStatusReasonInput,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorStatusReasonView";
import { MonitorStatusCause } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/useMonitorStatusCause";
import { ResourceAttentionItem } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import { resolveSection } from "../../../../App/FeatureSet/Dashboard/src/Utils/OverviewSection";
import { ResourceOwnerEntry } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerEntry";
import Route from "../../../Types/API/Route";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn } from "../../../Types/Monitor/CriteriaFilter";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import MonitorOverviewPresentationUtil, {
  MonitorOverviewPresentation,
  MonitorOverviewPresentationInput,
  MonitorOverviewStatusRef,
} from "../../../Utils/Monitor/MonitorOverviewPresentationUtil";
import {
  MonitorEvaluationByProbe,
  MonitorOverviewProbeHealth,
  MonitorOverviewProbeRow,
  MonitorOverviewProbeSummary,
} from "../../../Utils/Monitor/MonitorOverviewProbeUtil";

/*
 * AN OFFLINE MONITOR SAYS WHY ON ITS HERO (#9592), RENDERED.
 *
 * The hero said "Offline for 3h" in a badge and nothing about why: the
 * reason was behind the Status Timeline's View Cause. Now a line under the
 * headline says what set the status, and the badge is a button that opens
 * the whole of it: the criteria that matched, what it found and what the
 * check saw, since when, and each probe that sees the monitor so - each a
 * step from the page with its details.
 */

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ROW_ID: string = "99999999-9999-4999-8999-999999999999";
const DOWN_CRITERIA_ID: string = "criteria-down";
const ONLINE_CRITERIA_ID: string = "criteria-online";

const STATUS_TIMELINE: Route = new Route(
  "/dashboard/p/monitors/11111111-1111-4111-8111-111111111111/status-timeline",
);
const CHECKS: Route = new Route(
  "/dashboard/p/monitors/11111111-1111-4111-8111-111111111111/logs",
);

const OPERATIONAL: MonitorOverviewStatusRef = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Operational",
  color: "#10B981",
  isOperationalState: true,
  isOfflineState: false,
};

const OFFLINE: MonitorOverviewStatusRef = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Offline",
  color: "#EF4444",
  isOperationalState: false,
  isOfflineState: true,
};

const ENGLISH: Translator = createTranslator((): string | undefined => {
  return undefined;
}, "en");

const hoursAgo: (hours: number) => Date = (hours: number): Date => {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
};

const STEPS: MonitorSteps = {
  data: {
    monitorStepsInstanceArray: [
      {
        data: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          monitorDestination: "https://shop.example.com/health",
          requestType: "GET",
          monitorCriteria: {
            data: {
              monitorCriteriaInstanceArray: [
                {
                  data: {
                    id: DOWN_CRITERIA_ID,
                    changeMonitorStatus: true,
                    monitorStatusId: OFFLINE.id,
                  },
                },
                {
                  data: {
                    id: ONLINE_CRITERIA_ID,
                    changeMonitorStatus: true,
                    monitorStatusId: OPERATIONAL.id,
                  },
                },
              ],
            },
          },
        },
      },
    ],
  },
} as unknown as MonitorSteps;

const FINDING: string =
  "Response Status Code was 503, at or above the 500 threshold.";

// The status event's root cause, as the engine writes it.
const ROOT_CAUSE: string = ((): string => {
  let rootCause: MarkdownText = mdText`
**Created because the following criteria was met**:

**Criteria Name**: ${"Website is down"}
`;

  rootCause = mdText`${rootCause}
**Filter Conditions Met**: ${FeedMarkdown.asMarkdown(mdText`${FINDING}`.toString())}
`;

  rootCause = mdText`${rootCause}
**Response Snapshot**
- Response Status Code: 503
- Response Time: 411.0 ms
- Attempts: 3
`;

  rootCause = mdText`${rootCause}
**Cause**: ${"Server returned 503"}
`;

  return rootCause.toString();
})();

function probeRow(
  overrides: Partial<MonitorOverviewProbeRow>,
): MonitorOverviewProbeRow {
  return {
    probeId: "london",
    name: "London",
    isEnabled: true,
    isConnected: true,
    health: MonitorOverviewProbeHealth.Down,
    latestResult: {
      probeId: "london",
      monitoredAt: new Date(NOW.getTime() - 60 * 1000),
      isOnline: false,
      responseTimeInMs: 411,
      responseCode: 503,
      failureCause: "Server returned 503",
    },
    ...overrides,
  };
}

const PROBES: MonitorOverviewProbeSummary = {
  rows: [
    probeRow({}),
    probeRow({
      probeId: "tokyo",
      name: "Tokyo",
      health: MonitorOverviewProbeHealth.Up,
      latestResult: {
        probeId: "tokyo",
        monitoredAt: new Date(NOW.getTime() - 30 * 1000),
        isOnline: true,
        responseTimeInMs: 120,
        responseCode: 200,
      },
    }),
  ],
  attachedCount: 2,
  enabledCount: 2,
  reportingCount: 2,
  upCount: 1,
  downCount: 1,
  disabledCount: 0,
  disconnectedCount: 0,
  lastResultAt: new Date(NOW.getTime() - 30 * 1000),
  nextCheckAt: new Date(NOW.getTime() + 30 * 1000),
  latestNextCheckAt: new Date(NOW.getTime() + 30 * 1000),
  latestResult: {
    probeId: "tokyo",
    probeName: "Tokyo",
    monitoredAt: new Date(NOW.getTime() - 30 * 1000),
    isOnline: true,
    responseTimeInMs: 120,
    responseCode: 200,
  },
  responseTime: {
    medianMs: 265,
    minMs: 120,
    maxMs: 411,
    respondedCount: 2,
    totalCount: 2,
  },
};

function evaluationMatching(criteriaId: string): MonitorEvaluationSummary {
  return {
    evaluatedAt: NOW,
    events: [],
    criteriaResults: [
      {
        criteriaId: criteriaId,
        criteriaName:
          criteriaId === DOWN_CRITERIA_ID ? "Website is down" : "Online",
        filterCondition: FilterCondition.Any,
        met: true,
        message: FINDING,
        filters: [
          {
            checkOn: CheckOn.ResponseStatusCode,
            message:
              criteriaId === DOWN_CRITERIA_ID
                ? FINDING
                : "Response Status Code was 200.",
            met: true,
          },
        ],
      },
    ],
  };
}

const EVALUATION: MonitorEvaluationByProbe = {
  byProbeId: {
    london: evaluationMatching(DOWN_CRITERIA_ID),
    tokyo: evaluationMatching(ONLINE_CRITERIA_ID),
  },
};

function presentationInput(
  overrides?: Partial<MonitorOverviewPresentationInput>,
): MonitorOverviewPresentationInput {
  return {
    now: NOW,
    monitorType: MonitorType.Website,
    monitorSteps: STEPS,
    monitoringInterval: "* * * * *",
    createdAt: hoursAgo(24 * 30),
    firstMeasuredAt: hoursAgo(24 * 30),
    currentStatus: OFFLINE,
    statusSince: hoursAgo(3),
    pause: {
      isDisabled: false,
      byManualIncident: false,
      byScheduledMaintenance: false,
    },
    probeFlags: { isNoProbeEnabled: false, isAllProbesDisconnected: false },
    probes: PROBES,
    heartbeat: {},
    email: {},
    agent: {},
    telemetry: {},
    latestEvaluationAt: new Date(NOW.getTime() - 30 * 1000),
    ...overrides,
  };
}

function reasonFor(data: {
  cause?: MonitorStatusCause | undefined;
  input?: Partial<MonitorOverviewPresentationInput> | undefined;
  evaluation?: MonitorEvaluationByProbe | null | undefined;
}): MonitorOverviewStatusReason | null {
  const input: MonitorOverviewPresentationInput = presentationInput(data.input);
  const presentation: MonitorOverviewPresentation =
    MonitorOverviewPresentationUtil.build(input);
  const reasonInput: MonitorStatusReasonInput = {
    translator: ENGLISH,
    presentation: presentation,
    currentStatus: input.currentStatus,
    statusSince: input.statusSince,
    cause: data.cause || {
      state: "loaded",
      rowId: ROW_ID,
      rootCause: ROOT_CAUSE,
    },
    probes: input.probes,
    evaluation: data.evaluation === undefined ? EVALUATION : data.evaluation,
    monitorSteps: input.monitorSteps,
    monitorType: input.monitorType,
    now: NOW,
    statusTimelineRoute: STATUS_TIMELINE,
    checksRoute: CHECKS,
  };

  return getMonitorStatusReason(reasonInput);
}

const OWNERS: ComponentProps["owners"] = resolveSection<
  Array<ResourceOwnerEntry>
>({ value: [], subjectId: MONITOR_ID.toString() });

function renderHero(data: {
  statusReason?: MonitorOverviewStatusReason | null | undefined;
  input?: Partial<MonitorOverviewPresentationInput> | undefined;
}): RenderResult {
  const presentation: MonitorOverviewPresentation =
    MonitorOverviewPresentationUtil.build(presentationInput(data.input));

  return render(
    <MemoryRouter>
      <MonitorOverviewHero
        monitorId={MONITOR_ID}
        monitorType={MonitorType.Website}
        presentation={presentation}
        owners={OWNERS}
        isRefreshing={false}
        refreshError=""
        lastLoadedAt={new Date(NOW.getTime() - 10 * 1000)}
        onRefresh={() => {}}
        statusReason={data.statusReason || undefined}
      />
    </MemoryRouter>,
  );
}

// An element's words as a reader reads them: each run of space one space.
function textOf(element: HTMLElement): string {
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

function itemsOf(dialog: HTMLElement): Array<HTMLElement> {
  return within(dialog).getAllByTestId(
    "monitor-overview-status-why-dialog-item",
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
  getJestSpyOn(ModelAPI, "getList").mockImplementation(
    async (): Promise<unknown> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("which status the hero explains", () => {
  test("an Offline or Degraded status the badge names", () => {
    const presentation: MonitorOverviewPresentation =
      MonitorOverviewPresentationUtil.build(presentationInput());

    expect(
      isStatusExplained({ presentation: presentation, currentStatus: OFFLINE }),
    ).toBe(true);
  });

  test("never an operational one", () => {
    expect(
      reasonFor({
        input: { currentStatus: OPERATIONAL },
      }),
    ).toBeNull();
  });

  test("never a monitor someone turned off: its badge says Disabled", () => {
    expect(
      reasonFor({
        input: {
          pause: {
            isDisabled: true,
            byManualIncident: false,
            byScheduledMaintenance: false,
          },
        },
      }),
    ).toBeNull();
  });
});

describe("an Offline monitor's hero", () => {
  test("says what set the status under its headline", () => {
    renderHero({ statusReason: reasonFor({}) });

    const line: HTMLElement = screen.getByTestId(
      "monitor-overview-status-reason",
    );

    expect(
      within(line).getByTestId("monitor-overview-status-reason-criteria"),
    ).toHaveTextContent("Website is down:");
    expect(
      within(line).getByTestId("monitor-overview-status-reason-text"),
    ).toHaveTextContent(FINDING);
  });

  test("draws its status as a button that opens why", () => {
    renderHero({ statusReason: reasonFor({}) });

    const badge: HTMLElement = screen.getByTestId(
      "monitor-overview-status-why",
    );

    expect(badge.tagName).toBe("BUTTON");
    expect(badge).toHaveAttribute("aria-haspopup", "dialog");
    expect(badge).toHaveTextContent("Offline");
    expect(badge).toHaveAttribute("data-tone", "danger");
    expect(
      within(screen.getByTestId("monitor-overview-badge")).getByTestId(
        "monitor-overview-status-why",
      ),
    ).toBe(badge);
  });

  test("opens what set the status first, then each probe that sees it so", () => {
    renderHero({ statusReason: reasonFor({}) });

    fireEvent.click(screen.getByTestId("monitor-overview-status-why"));

    const dialog: HTMLElement = screen.getByTestId(
      "monitor-overview-status-why-dialog",
    );
    const items: Array<HTMLElement> = itemsOf(dialog);

    expect(
      items.map((item: HTMLElement): string | null => {
        return item.getAttribute("data-key");
      }),
    ).toEqual([MONITOR_STATUS_REASON_ITEM_KEY, "probe-london"]);
    expect(
      screen.getByText("Why is this monitor offline?"),
    ).toBeInTheDocument();
  });

  test("the reason row says the criteria, what it found, what the check saw and since when", () => {
    renderHero({ statusReason: reasonFor({}) });
    fireEvent.click(screen.getByTestId("monitor-overview-status-why"));

    const reasonRow: HTMLElement = itemsOf(
      screen.getByTestId("monitor-overview-status-why-dialog"),
    )[0] as HTMLElement;

    expect(
      within(reasonRow).getByTestId("monitor-overview-status-why-dialog-name"),
    ).toHaveTextContent("Website is down");
    expect(
      within(reasonRow).getByTestId(
        "monitor-overview-status-why-dialog-explanation",
      ),
    ).toHaveTextContent(FINDING);
    expect(
      within(reasonRow)
        .getAllByTestId("monitor-overview-status-why-dialog-fact")
        .map(textOf),
    ).toEqual([
      "Response Status Code:503",
      "Response Time:411 ms",
      "Attempts:3",
    ]);
    expect(
      within(reasonRow).getByTestId(
        "monitor-overview-status-why-dialog-message",
      ),
    ).toHaveTextContent("Server returned 503");
    expect(
      within(reasonRow).getByTestId("monitor-overview-status-why-dialog-since"),
    ).toHaveTextContent("Started 3 hours ago");
    expect(
      within(reasonRow).getByTestId("monitor-overview-status-why-dialog-view"),
    ).toHaveAttribute("href", STATUS_TIMELINE.toString());
  });

  test("a probe row says what that probe saw, when, and opens its checks", () => {
    renderHero({ statusReason: reasonFor({}) });
    fireEvent.click(screen.getByTestId("monitor-overview-status-why"));

    const probeRowElement: HTMLElement = itemsOf(
      screen.getByTestId("monitor-overview-status-why-dialog"),
    )[1] as HTMLElement;

    expect(
      within(probeRowElement).getByTestId(
        "monitor-overview-status-why-dialog-name",
      ),
    ).toHaveTextContent("London");
    expect(
      within(probeRowElement).getByTestId(
        "monitor-overview-status-why-dialog-reason",
      ),
    ).toHaveTextContent("Down");
    expect(
      within(probeRowElement)
        .getAllByTestId("monitor-overview-status-why-dialog-fact")
        .map(textOf),
    ).toEqual(["Status code:503", "Response time:411 ms"]);
    expect(
      within(probeRowElement).getByTestId(
        "monitor-overview-status-why-dialog-message",
      ),
    ).toHaveTextContent("Server returned 503");
    expect(
      within(probeRowElement).getByTestId(
        "monitor-overview-status-why-dialog-since",
      ),
    ).toHaveTextContent("Checked 1 minute ago");
    expect(
      within(probeRowElement).getByTestId(
        "monitor-overview-status-why-dialog-view",
      ),
    ).toHaveAttribute("href", CHECKS.toString());
  });

  test("a probe whose newest check is fine is not listed", () => {
    const reason: MonitorOverviewStatusReason | null = reasonFor({});

    expect(
      reason?.items.map((item: ResourceAttentionItem): string => {
        return item.name;
      }),
    ).toEqual(["Website is down", "London"]);
  });
});

describe("while the reason is read, and when it cannot be", () => {
  test("the hero keeps the line's room while the cause is read", () => {
    renderHero({
      statusReason: reasonFor({ cause: { state: "loading", rowId: ROW_ID } }),
    });

    expect(
      screen.getByTestId("monitor-overview-status-reason-loading"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("monitor-overview-status-reason"),
    ).not.toBeInTheDocument();
  });

  test("a cause that could not be read is explained by the probes behind the status", () => {
    const reason: MonitorOverviewStatusReason | null = reasonFor({
      cause: { state: "failed", rowId: ROW_ID },
    });

    expect(reason?.line).toEqual({
      criteriaName: "Website is down",
      text: FINDING,
    });
    expect(
      reason?.items.map((item: ResourceAttentionItem): string => {
        return item.key;
      }),
    ).toEqual(["probe-london"]);
  });

  test("with neither a cause nor a probe behind it the badge stays a badge", () => {
    renderHero({
      statusReason: reasonFor({
        cause: { state: "failed", rowId: ROW_ID },
        evaluation: null,
        input: {
          probes: { ...PROBES, rows: [] },
        },
      }),
    });

    expect(
      screen.queryByTestId("monitor-overview-status-why"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("monitor-overview-badge")).toHaveTextContent(
      "Offline",
    );
    expect(
      screen.queryByTestId("monitor-overview-status-reason"),
    ).not.toBeInTheDocument();
  });

  test("a hero handed no reason draws its badge and nothing else, as before", () => {
    renderHero({ statusReason: undefined });

    expect(
      screen.queryByTestId("monitor-overview-status-why"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("monitor-overview-status-reason"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("monitor-overview-status-reason-loading"),
    ).not.toBeInTheDocument();
  });
});

describe("a status no criteria set", () => {
  test("says who set it", () => {
    const rootCause: string =
      mdText`Monitor status created by ${mdText`[${"Jane Doe"}](${"https://oneuptime.example/dashboard/p/users/u"})`}`.toString();

    renderHero({
      statusReason: reasonFor({
        cause: { state: "loaded", rowId: ROW_ID, rootCause: rootCause },
        evaluation: null,
        input: { probes: { ...PROBES, rows: [] } },
      }),
    });

    expect(
      screen.getByTestId("monitor-overview-status-reason"),
    ).toHaveTextContent("Changed by Jane Doe");
    expect(
      screen.queryByTestId("monitor-overview-status-reason-criteria"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("monitor-overview-status-why"));

    const row: HTMLElement = itemsOf(
      screen.getByTestId("monitor-overview-status-why-dialog"),
    )[0] as HTMLElement;

    expect(
      within(row).getByTestId("monitor-overview-status-why-dialog-name"),
    ).toHaveTextContent("Changed by Jane Doe");
    expect(
      within(row).getByTestId("monitor-overview-status-why-dialog-kind"),
    ).toHaveTextContent("Monitor Status");
  });
});

describe("a Degraded status", () => {
  test("opens why in the warning tone", () => {
    const degraded: MonitorOverviewStatusRef = {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Degraded",
      color: "#F59E0B",
      isOperationalState: false,
      isOfflineState: false,
    };

    renderHero({
      statusReason: reasonFor({ input: { currentStatus: degraded } }),
      input: { currentStatus: degraded },
    });

    expect(screen.getByTestId("monitor-overview-status-why")).toHaveAttribute(
      "data-tone",
      "warning",
    );
  });
});
