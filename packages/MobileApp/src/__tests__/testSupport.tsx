import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  AlertEpisodeItem,
  AlertItem,
  AlertState,
  ColorField,
  FeedItem,
  IncidentEpisodeItem,
  IncidentItem,
  IncidentState,
  ListResponse,
  MonitorItem,
  MonitorStatusItem,
  NamedEntityWithColor,
  NoteItem,
  ProjectItem,
  SecurityCaseFeedItem,
  SecurityCaseItem,
  SecurityCasePriorityItem,
  SecurityCaseStatusItem,
  SecurityPlaybookRunItem,
  StateTimelineItem,
} from "../api/types";

/*
 * Shared scaffolding for the tests, kept here rather than copied into each
 * suite so that every suite is asserting against the SAME shape of data. A
 * fixture that drifts between two suites is a fixture that can make one of
 * them pass for a reason the app does not actually have.
 *
 * This file is deliberately not named *.test.ts, so jest's testMatch does not
 * collect it as an (empty) suite, and it sits under __tests__ so it is
 * excluded from coverage.
 */

/**
 * A query client wired for tests rather than for a handset.
 *
 * Retries are off because a test that exercises a failure would otherwise wait
 * out three exponential back-offs before the hook reports the error, and
 * garbage collection is immediate so one test's cache cannot answer the next
 * test's query.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export interface QueryWrapperProps {
  children: ReactNode;
}

/**
 * The `wrapper` to hand renderHook/render for anything that reads react-query.
 */
export function createQueryWrapper(
  client: QueryClient,
): (props: QueryWrapperProps) => React.JSX.Element {
  return function QueryWrapper({
    children,
  }: QueryWrapperProps): React.JSX.Element {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

export function makeColor(overrides: Partial<ColorField> = {}): ColorField {
  return { r: 220, g: 38, b: 38, ...overrides };
}

export function makeNamedEntityWithColor(
  overrides: Partial<NamedEntityWithColor> = {},
): NamedEntityWithColor {
  return {
    _id: "state-1",
    name: "Created",
    color: makeColor(),
    ...overrides,
  } as NamedEntityWithColor;
}

export function makeProject(overrides: Partial<ProjectItem> = {}): ProjectItem {
  return {
    _id: "project-1",
    name: "Acme Production",
    slug: "acme-production",
    ...overrides,
  } as ProjectItem;
}

export function makeAlert(overrides: Partial<AlertItem> = {}): AlertItem {
  return {
    _id: "alert-1",
    title: "Disk almost full",
    alertNumber: 12,
    alertNumberWithPrefix: "#12",
    description: "The primary volume is at 94%.",
    createdAt: "2026-08-30T10:00:00.000Z",
    currentAlertState: makeNamedEntityWithColor(),
    alertSeverity: makeNamedEntityWithColor({
      _id: "severity-1",
      name: "Critical",
    }),
    monitor: { _id: "monitor-1", name: "api.example.com" },
    ...overrides,
  } as AlertItem;
}

export function makeIncident(
  overrides: Partial<IncidentItem> = {},
): IncidentItem {
  return {
    _id: "incident-1",
    title: "Checkout is down",
    incidentNumber: 7,
    incidentNumberWithPrefix: "#7",
    description: "Checkout returns 500 for every request.",
    declaredAt: "2026-08-30T09:00:00.000Z",
    createdAt: "2026-08-30T09:00:00.000Z",
    currentIncidentState: makeNamedEntityWithColor(),
    incidentSeverity: makeNamedEntityWithColor({
      _id: "severity-1",
      name: "Critical",
    }),
    monitors: [{ _id: "monitor-1", name: "api.example.com" }],
    ...overrides,
  } as IncidentItem;
}

export function makeAlertEpisode(
  overrides: Partial<AlertEpisodeItem> = {},
): AlertEpisodeItem {
  return {
    _id: "alert-episode-1",
    title: "Repeated disk pressure",
    episodeNumber: 3,
    episodeNumberWithPrefix: "#3",
    description: "Four alerts in an hour from the same volume.",
    createdAt: "2026-08-30T08:00:00.000Z",
    alertCount: 4,
    currentAlertState: makeNamedEntityWithColor(),
    alertSeverity: makeNamedEntityWithColor({
      _id: "severity-1",
      name: "Critical",
    }),
    ...overrides,
  } as AlertEpisodeItem;
}

export function makeIncidentEpisode(
  overrides: Partial<IncidentEpisodeItem> = {},
): IncidentEpisodeItem {
  return {
    _id: "incident-episode-1",
    title: "Rolling checkout outage",
    episodeNumber: 2,
    episodeNumberWithPrefix: "#2",
    description: "Three incidents against the same service.",
    createdAt: "2026-08-30T07:00:00.000Z",
    declaredAt: "2026-08-30T07:00:00.000Z",
    incidentCount: 3,
    currentIncidentState: makeNamedEntityWithColor(),
    incidentSeverity: makeNamedEntityWithColor({
      _id: "severity-1",
      name: "Critical",
    }),
    ...overrides,
  } as IncidentEpisodeItem;
}

export function makeMonitor(overrides: Partial<MonitorItem> = {}): MonitorItem {
  return {
    _id: "monitor-1",
    name: "api.example.com",
    description: "The public API endpoint.",
    monitorType: "Website",
    currentMonitorStatus: makeNamedEntityWithColor({
      _id: "monitor-status-1",
      name: "Operational",
    }),
    disableActiveMonitoring: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeMonitorStatus(
  overrides: Partial<MonitorStatusItem> = {},
): MonitorStatusItem {
  return {
    _id: "monitor-status-1",
    name: "Operational",
    color: makeColor({ r: 34, g: 197, b: 94 }),
    isOperationalState: true,
    isOfflineState: false,
    priority: 1,
    ...overrides,
  };
}

export function makeIncidentState(
  overrides: Partial<IncidentState> = {},
): IncidentState {
  return {
    _id: "incident-state-1",
    name: "Created",
    color: makeColor(),
    isResolvedState: false,
    isAcknowledgedState: false,
    isCreatedState: true,
    order: 1,
    ...overrides,
  } as IncidentState;
}

export function makeAlertState(
  overrides: Partial<AlertState> = {},
): AlertState {
  return {
    _id: "alert-state-1",
    name: "Created",
    color: makeColor(),
    isResolvedState: false,
    isAcknowledgedState: false,
    isCreatedState: true,
    order: 1,
    ...overrides,
  } as AlertState;
}

export function makeStateTimelineItem(
  overrides: Partial<StateTimelineItem> = {},
): StateTimelineItem {
  return {
    _id: "timeline-1",
    createdAt: "2026-08-30T10:05:00.000Z",
    incidentState: makeNamedEntityWithColor(),
    ...overrides,
  } as StateTimelineItem;
}

export function makeFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    _id: "feed-1",
    feedInfoInMarkdown: "**Acknowledged** by Ada Lovelace",
    displayColor: makeColor(),
    createdAt: "2026-08-30T10:06:00.000Z",
    ...overrides,
  } as FeedItem;
}

export function makeNote(overrides: Partial<NoteItem> = {}): NoteItem {
  return {
    _id: "note-1",
    note: "Paged the database team.",
    createdAt: "2026-08-30T10:07:00.000Z",
    createdByUser: { _id: "user-1", name: "Ada Lovelace" },
    ...overrides,
  } as NoteItem;
}

/**
 * Wrap rows in the envelope every list endpoint answers with, so a test does
 * not have to restate `count`, `skip` and `limit` for every fixture.
 */
export function makeListResponse<T>(
  data: Array<T>,
  overrides: Partial<ListResponse<T>> = {},
): ListResponse<T> {
  return {
    data,
    count: data.length,
    skip: 0,
    limit: 20,
    ...overrides,
  };
}

/*
 * Security cases, as the API hands them back: a project's four built-in
 * statuses and five built-in priorities (with the ids the suites name them
 * by), a case, a playbook run waiting for an approval and a timeline entry.
 * Colours come the way the API serializes a Color: { _type: "Color", value }.
 */
export const SECURITY_STATUS_IDS: Readonly<{
  new: string;
  investigating: string;
  contained: string;
  closed: string;
}> = {
  new: "5717a7e5-0001-4000-8000-000000000001",
  investigating: "5717a7e5-0002-4000-8000-000000000002",
  contained: "5717a7e5-0003-4000-8000-000000000003",
  closed: "5717a7e5-0004-4000-8000-000000000004",
};

export const SECURITY_PRIORITY_IDS: Readonly<{
  critical: string;
  high: string;
  medium: string;
  low: string;
  informational: string;
}> = {
  critical: "9e10e117-0001-4000-8000-000000000001",
  high: "9e10e117-0002-4000-8000-000000000002",
  medium: "9e10e117-0003-4000-8000-000000000003",
  low: "9e10e117-0004-4000-8000-000000000004",
  informational: "9e10e117-0005-4000-8000-000000000005",
};

export function makeSecurityCaseStatuses(): Array<SecurityCaseStatusItem> {
  return [
    {
      _id: SECURITY_STATUS_IDS.new,
      name: "New",
      color: { _type: "Color", value: "#E5484D" },
      order: 1,
      isNewStatus: true,
    },
    {
      _id: SECURITY_STATUS_IDS.investigating,
      name: "Investigating",
      color: { _type: "Color", value: "#FFB224" },
      order: 2,
      isAcknowledgedStatus: true,
    },
    {
      _id: SECURITY_STATUS_IDS.contained,
      name: "Contained",
      color: { _type: "Color", value: "#3E63DD" },
      order: 3,
      isContainedStatus: true,
    },
    {
      _id: SECURITY_STATUS_IDS.closed,
      name: "Closed",
      color: { _type: "Color", value: "#30A46C" },
      order: 4,
      isClosedStatus: true,
    },
  ];
}

export function makeSecurityCasePriorities(): Array<SecurityCasePriorityItem> {
  return [
    {
      _id: SECURITY_PRIORITY_IDS.critical,
      name: "Critical",
      color: { _type: "Color", value: "#E5484D" },
      order: 1,
      isCriticalPriority: true,
    },
    {
      _id: SECURITY_PRIORITY_IDS.high,
      name: "High",
      color: { _type: "Color", value: "#F76B15" },
      order: 2,
      isHighPriority: true,
    },
    {
      _id: SECURITY_PRIORITY_IDS.medium,
      name: "Medium",
      color: { _type: "Color", value: "#FFB224" },
      order: 3,
      isMediumPriority: true,
    },
    {
      _id: SECURITY_PRIORITY_IDS.low,
      name: "Low",
      color: { _type: "Color", value: "#3E63DD" },
      order: 4,
      isLowPriority: true,
    },
    {
      _id: SECURITY_PRIORITY_IDS.informational,
      name: "Informational",
      color: { _type: "Color", value: "#8B8D98" },
      order: 5,
      isInformationalPriority: true,
    },
  ];
}

export function makeSecurityCase(
  overrides: Partial<SecurityCaseItem> = {},
): SecurityCaseItem {
  const statuses: Array<SecurityCaseStatusItem> = makeSecurityCaseStatuses();
  const priorities: Array<SecurityCasePriorityItem> =
    makeSecurityCasePriorities();

  return {
    _id: "5ec0ca5e-0142-4d1a-9a00-000000000142",
    title: "Password spray against the VPN",
    caseNumber: 142,
    caseNumberWithPrefix: "CASE-142",
    securityCaseStatusId: SECURITY_STATUS_IDS.new,
    securityCaseStatus: statuses[0]!,
    securityCasePriorityId: SECURITY_PRIORITY_IDS.critical,
    securityCasePriority: priorities[0]!,
    assignedToUserId: null,
    assignedToUser: null,
    assignedToTeamId: null,
    assignedToTeam: null,
    entities: [
      { type: "User", value: "alice@acme.test" },
      { type: "IP Address", value: "203.0.113.24" },
    ],
    detectionCount: 14,
    source: "Detection Rule",
    firstDetectedAt: "2026-08-30T09:46:00.000Z",
    lastDetectedAt: "2026-08-30T09:52:00.000Z",
    createdAt: "2026-08-30T09:46:00.000Z",
    ...overrides,
  };
}

export function makeWaitingPlaybookRun(
  overrides: Partial<SecurityPlaybookRunItem> = {},
): SecurityPlaybookRunItem {
  return {
    _id: "7a6b0000-0001-4000-8000-000000000001",
    securityCaseId: "5ec0ca5e-0142-4d1a-9a00-000000000142",
    playbookName: "Contain a compromised account",
    status: "Waiting for Approval",
    trigger: "Case Opened",
    currentStepIndex: 0,
    steps: [{ id: "step-1", action: "Suspend Okta User" }],
    stepResults: [
      {
        stepId: "step-1",
        action: "Suspend Okta User",
        status: "Waiting for Approval",
        targets: [
          {
            type: "User",
            value: "alice@acme.test",
            reason: "Grouped On",
            state: "Proposed",
          },
          {
            type: "User",
            value: "breakglass-admin@acme.test",
            reason: "Threat Intel",
            state: "Protected",
            protectedBy: "breakglass-*",
          },
        ],
      },
    ],
    triggeredByUserId: null,
    triggeredByUser: null,
    startedAt: "2026-08-30T09:47:00.000Z",
    createdAt: "2026-08-30T09:47:00.000Z",
    ...overrides,
  };
}

export function makeSecurityCaseFeedItem(
  overrides: Partial<SecurityCaseFeedItem> = {},
): SecurityCaseFeedItem {
  return {
    _id: "f1e00000-0001-4000-8000-000000000001",
    feedInfoInMarkdown: "Case opened by detection rule **VPN password spray**.",
    displayColor: makeColor(),
    securityCaseFeedEventType: "CaseOpened",
    postedAt: "2026-08-30T09:46:00.000Z",
    createdAt: "2026-08-30T09:46:00.000Z",
    ...overrides,
  } as SecurityCaseFeedItem;
}
