import React from "react";
import { Alert } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import type { QueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import apiClient from "../api/client";
import IncidentDetailScreen from "./IncidentDetailScreen";
import AlertDetailScreen from "./AlertDetailScreen";
import IncidentEpisodeDetailScreen from "./IncidentEpisodeDetailScreen";
import AlertEpisodeDetailScreen from "./AlertEpisodeDetailScreen";
import MonitorDetailScreen from "./MonitorDetailScreen";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeAlert,
  makeAlertEpisode,
  makeFeedItem,
  makeIncident,
  makeIncidentEpisode,
  makeIncidentState,
  makeMonitor,
  makeNote,
} from "../__tests__/testSupport";
import type {
  IncidentState,
  IncidentItem,
  AlertItem,
  IncidentEpisodeItem,
  AlertEpisodeItem,
  MonitorItem,
} from "../api/types";

/*
 * Keep the API adapters, query hooks, cache and screen real. Only HTTP and
 * device feedback are replaced, so retry must recover through the full read path.
 */
jest.mock("../api/client", () => {
  return { __esModule: true, default: { post: jest.fn() } };
});
jest.mock("../hooks/useScreenPadding", () => {
  return {
    useScreenPadding: () => {
      return 40;
    },
  };
});
jest.mock("expo-haptics", () => {
  return {
    NotificationFeedbackType: { Success: "success", Error: "error" },
    ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
    notificationAsync: jest.fn(),
    impactAsync: jest.fn(),
    selectionAsync: jest.fn(),
  };
});

const PROJECT_ID: string = "project-recovery";
const ENTITY_ID: string = "response-1";
const TITLE: string = "Checkout response";
const RESOLVED_STATE: IncidentState = makeIncidentState({
  _id: "resolved",
  name: "Resolved",
  isResolvedState: true,
  isCreatedState: false,
});
const ACKNOWLEDGED_STATE: IncidentState = makeIncidentState({
  _id: "acknowledged",
  name: "Acknowledged",
  isAcknowledgedState: true,
  isCreatedState: false,
});

interface DetailProps {
  route: { params: Record<string, string> };
  navigation: Record<string, unknown>;
}

interface DetailCase {
  kind: string;
  label: string;
  states: string;
  stateField: string;
  idParam: string;
  component: React.ComponentType<DetailProps>;
  entity:
    | IncidentItem
    | AlertItem
    | IncidentEpisodeItem
    | AlertEpisodeItem
    | MonitorItem;
}

const responseCases: DetailCase[] = [
  {
    kind: "incident",
    label: "incident",
    states: "incident-state",
    stateField: "currentIncidentState",
    idParam: "incidentId",
    component:
      IncidentDetailScreen as unknown as React.ComponentType<DetailProps>,
    entity: makeIncident(),
  },
  {
    kind: "alert",
    label: "alert",
    states: "alert-state",
    stateField: "currentAlertState",
    idParam: "alertId",
    component: AlertDetailScreen as unknown as React.ComponentType<DetailProps>,
    entity: makeAlert(),
  },
  {
    kind: "incident-episode",
    label: "incident episode",
    states: "incident-state",
    stateField: "currentIncidentState",
    idParam: "episodeId",
    component:
      IncidentEpisodeDetailScreen as unknown as React.ComponentType<DetailProps>,
    entity: makeIncidentEpisode(),
  },
  {
    kind: "alert-episode",
    label: "alert episode",
    states: "alert-state",
    stateField: "currentAlertState",
    idParam: "episodeId",
    component:
      AlertEpisodeDetailScreen as unknown as React.ComponentType<DetailProps>,
    entity: makeAlertEpisode(),
  },
];

const monitorCase: DetailCase = {
  kind: "monitor",
  label: "monitor",
  states: "monitor-status",
  stateField: "currentMonitorStatus",
  idParam: "monitorId",
  component: MonitorDetailScreen as unknown as React.ComponentType<DetailProps>,
  entity: makeMonitor({ monitorType: "Website" }),
};

const postMock: jest.Mock = apiClient.post as unknown as jest.Mock;
const notificationMock: jest.Mock =
  Haptics.notificationAsync as unknown as jest.Mock;
let client: QueryClient;
let rows: Map<string, unknown[]>;
let failures: Set<string>;
let gates: Map<string, Promise<void>>;
let activeCase: DetailCase;

interface RequestBody {
  data?: Record<string, string>;
}

beforeEach(() => {
  client = createTestQueryClient();
  rows = new Map();
  failures = new Set();
  gates = new Map();
  notificationMock.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, "alert").mockImplementation(() => {
    return undefined;
  });
  postMock
    .mockReset()
    .mockImplementation(async (url: string, body: RequestBody) => {
      const endpoint: string = url.split("/")[2]!;
      await gates.get(endpoint);
      if (failures.has(endpoint)) {
        throw new Error("Connection lost");
      }
      if (body.data && endpoint.endsWith("-state-timeline")) {
        const stateId: string | undefined =
          body.data.incidentStateId ?? body.data.alertStateId;
        rows.set(activeCase.kind, [
          {
            ...(rows.get(activeCase.kind)?.[0] as Record<string, unknown>),
            [activeCase.stateField]:
              stateId === RESOLVED_STATE._id
                ? RESOLVED_STATE
                : ACKNOWLEDGED_STATE,
          },
        ]);
      }
      return {
        data: {
          data: rows.get(endpoint) ?? [],
          count: rows.get(endpoint)?.length ?? 0,
        },
      };
    });
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

async function renderDetail(detail: DetailCase): Promise<void> {
  activeCase = detail;
  rows.set(detail.kind, [
    { ...detail.entity, _id: ENTITY_ID, title: TITLE, name: TITLE },
  ]);
  rows.set(detail.states, [
    makeIncidentState(),
    ACKNOWLEDGED_STATE,
    RESOLVED_STATE,
  ]);
  const Component: React.ComponentType<DetailProps> = detail.component;
  await render(
    <Component
      route={{ params: { projectId: PROJECT_ID, [detail.idParam]: ENTITY_ID } }}
      navigation={{}}
    />,
    {
      wrapper: createQueryWrapper(client),
    },
  );
  await screen.findByText(TITLE);
}

function requestCount(endpoint: string): number {
  return postMock.mock.calls.filter((args: unknown[]) => {
    return String(args[0]).split("/")[2] === endpoint;
  }).length;
}

function refreshControl(): {
  refreshing: boolean;
  onRefresh: () => Promise<void>;
} {
  return screen.getByTestId("detail-scroll").props.refreshControl.props;
}

describe.each(responseCases)(
  "$label recovery through HTTP and React Query",
  (detail: DetailCase) => {
    test("a failed state lookup offers a retry that restores response actions", async () => {
      failures.add(detail.states);
      await renderDetail(detail);
      await screen.findByRole("button", { name: "Retry actions" });
      expect(
        screen.queryByRole("button", { name: `Acknowledge ${detail.label}` }),
      ).toBeNull();

      failures.delete(detail.states);
      await fireEvent.press(
        screen.getByRole("button", { name: "Retry actions" }),
      );

      await screen.findByRole("button", {
        name: `Acknowledge ${detail.label}`,
      });
      expect(
        screen.queryByRole("button", { name: "Retry actions" }),
      ).toBeNull();
      expect(requestCount(detail.states)).toBe(2);
      for (const request of postMock.mock.calls) {
        expect(request[2]).toEqual({ headers: { tenantid: PROJECT_ID } });
      }
    });

    test("failed notes and activity can be recovered without losing response context", async () => {
      const notesEndpoint: string = `${detail.kind}-internal-note`;
      const feedEndpoint: string = `${detail.kind}-feed`;
      failures.add(notesEndpoint);
      failures.add(feedEndpoint);
      await renderDetail(detail);
      await screen.findByRole("button", { name: "Retry notes" });
      await screen.findByRole("button", { name: "Retry activity" });
      expect(screen.queryByText("No notes yet.")).toBeNull();
      expect(screen.getByText(TITLE)).toBeTruthy();

      failures.clear();
      rows.set(notesEndpoint, [
        makeNote({ note: "Database failover complete." }),
      ]);
      rows.set(feedEndpoint, [
        makeFeedItem({ feedInfoInMarkdown: "The team was paged." }),
      ]);
      await fireEvent.press(
        screen.getByRole("button", { name: "Retry notes" }),
      );
      await fireEvent.press(
        screen.getByRole("button", { name: "Retry activity" }),
      );

      await screen.findByText("Database failover complete.");
      await screen.findByText("The team was paged.");
      expect(screen.queryByRole("button", { name: "Retry notes" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Retry activity" }),
      ).toBeNull();
    });

    test("a completed response stays successful when the device cannot vibrate", async () => {
      await renderDetail(detail);
      await screen.findByRole("button", { name: `Resolve ${detail.label}` });
      notificationMock.mockRejectedValue(new Error("Vibration unavailable"));

      await fireEvent.press(
        screen.getByRole("button", { name: `Resolve ${detail.label}` }),
      );

      await waitFor(() => {
        expect(
          screen.queryByRole("button", { name: `Resolve ${detail.label}` }),
        ).toBeNull();
      });
      expect(screen.getByText("Resolved")).toBeTruthy();
      expect(Alert.alert).not.toHaveBeenCalled();
      expect(requestCount(detail.kind)).toBe(2);
      expect(postMock).toHaveBeenCalledWith(
        `/api/${detail.kind}-state-timeline`,
        {
          data: expect.objectContaining({
            projectId: PROJECT_ID,
            [detail.idParam === "episodeId"
              ? `${detail.kind.startsWith("incident") ? "incident" : "alert"}EpisodeId`
              : detail.idParam]: ENTITY_ID,
          }),
        },
        { headers: { tenantid: PROJECT_ID } },
      );
    });

    test("a rejected response still shows its error when error feedback fails too", async () => {
      await renderDetail(detail);
      await screen.findByRole("button", { name: `Resolve ${detail.label}` });
      failures.add(`${detail.kind}-state-timeline`);
      notificationMock.mockRejectedValue(new Error("Vibration unavailable"));

      await fireEvent.press(
        screen.getByRole("button", { name: `Resolve ${detail.label}` }),
      );

      expect(Alert.alert).toHaveBeenCalledWith(
        "Error",
        "Failed to change state to Resolved.",
      );
      expect(
        screen.getByRole("button", { name: `Resolve ${detail.label}` }),
      ).toBeEnabled();
      expect(screen.queryByText("Resolved")).toBeNull();
    });
  },
);

describe.each([...responseCases, monitorCase])(
  "$label pull-to-refresh",
  (detail: DetailCase) => {
    test("keeps progress visible until every read settles, including failed sections", async () => {
      await renderDetail(detail);
      const heldEndpoint: string =
        detail.kind === "monitor" ? "monitor-probe" : detail.states;
      let release: () => void = () => {
        return undefined;
      };
      gates.set(
        heldEndpoint,
        new Promise<void>((resolve: () => void) => {
          release = resolve;
        }),
      );
      failures.add(`${detail.kind}-feed`);
      let refresh: Promise<void> = Promise.resolve();

      await act(async () => {
        refresh = refreshControl().onRefresh();
      });
      await waitFor(() => {
        expect(refreshControl().refreshing).toBe(true);
      });
      await screen.findByRole("button", { name: "Retry activity" });
      expect(refreshControl().refreshing).toBe(true);
      expect(screen.getByText(TITLE)).toBeTruthy();
      expect(requestCount(heldEndpoint)).toBe(2);

      await act(async () => {
        release();
        await refresh;
      });
      expect(refreshControl().refreshing).toBe(false);
      expect(screen.getByText(TITLE)).toBeTruthy();
    });
  },
);

test("monitor measurement and status-history failures provide working retries", async () => {
  failures.add("monitor-probe");
  failures.add("monitor-status-timeline");
  await renderDetail(monitorCase);
  await screen.findByRole("button", { name: "Retry monitor summary" });
  await screen.findByRole("button", { name: "Retry status history" });

  failures.clear();
  rows.set("monitor-probe", [
    {
      _id: "probe-row",
      probeId: "probe-1",
      probe: { _id: "probe-1", name: "London" },
      lastMonitoringLog: {
        "probe-1": { isOnline: true, responseTimeInMs: 137, responseCode: 200 },
      },
    },
  ]);
  rows.set("monitor-status-timeline", [
    {
      _id: "history-1",
      createdAt: "2026-09-01T10:00:00Z",
      monitorStatus: {
        _id: "restored",
        name: "Service restored",
        color: { r: 0, g: 128, b: 0 },
      },
    },
  ]);
  await fireEvent.press(
    screen.getByRole("button", { name: "Retry monitor summary" }),
  );
  await fireEvent.press(
    screen.getByRole("button", { name: "Retry status history" }),
  );

  await screen.findByText("137");
  expect(screen.getByText("ms")).toBeTruthy();
  await screen.findByText("Service restored");
  expect(
    screen.queryByRole("button", { name: "Retry monitor summary" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Retry status history" }),
  ).toBeNull();
});
