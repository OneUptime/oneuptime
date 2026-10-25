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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Security Events, connected to the rest of OneUptime, as a reader sees it.
 *
 * Connected Signals (a case's page, an event's Connected tab, an entity's
 * card): one line per record the case names - its name opening its page,
 * why OneUptime connects it, a pill when it is only possibly the same, its
 * signals opening the explorers on it and the window, and what is going on
 * there - then what was looked for and not found, and what the reader's
 * role keeps from them.
 *
 * The way back: a host's, a cluster's, a service's page has a Security card
 * - drawn only for a reader who may read security events, in a project
 * that uses them - and an incident's page names the case that declared it
 * and the open cases naming what it affects, for a reader who may read
 * cases. A read that fails takes nothing from the page.
 */

const getConnectionsMock: MockFunction = getJestMockFunction();
const getResourceSecurityMock: MockFunction = getJestMockFunction();
const getIncidentSecurityMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi",
  () => {
    return {
      __esModule: true,
      default: {
        getConnections: (...args: Array<unknown>) => {
          return getConnectionsMock(...args);
        },
        getResourceSecurity: (...args: Array<unknown>) => {
          return getResourceSecurityMock(...args);
        },
        getIncidentSecurity: (...args: Array<unknown>) => {
          return getIncidentSecurityMock(...args);
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

import ConnectedSignals from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/ConnectedSignals";
import IncidentSecurityCard from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/IncidentSecurityCard";
import ResourceSecurityCard from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/ResourceSecurityCard";
import {
  CONNECTED_SIGNALS_CASE_DESCRIPTION,
  SECURITY_CONNECTIONS_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/SecurityConnectionsCopy";
import ObjectID from "../../../Types/ObjectID";
import {
  IncidentSecurityJson,
  ResourceSecurityJson,
  SecurityConnectedResourceJson,
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionReason,
  SecurityConnectionsJson,
} from "../../../Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const CASE_ID: string = "20000000-0000-4000-8000-000000000142";
const HOST_ID: string = "30000000-0000-4000-8000-000000000001";
const SERVICE_ID: string = "30000000-0000-4000-8000-000000000002";
const CLUSTER_ID: string = "30000000-0000-4000-8000-000000000003";
const INCIDENT_ID: string = "40000000-0000-4000-8000-000000000001";
const ALERT_ID: string = "40000000-0000-4000-8000-000000000002";
const MONITOR_ID: string = "40000000-0000-4000-8000-000000000003";
const BASE: string = `/dashboard/${PROJECT_ID}`;

const IDS: typeof SECURITY_CONNECTIONS_TEST_IDS = SECURITY_CONNECTIONS_TEST_IDS;

function host(
  overrides: Partial<SecurityConnectedResourceJson> = {},
): SecurityConnectedResourceJson {
  return {
    kind: SecurityConnectionKind.Host,
    id: HOST_ID,
    name: "web-1",
    certainty: SecurityConnectionCertainty.Exact,
    matches: [
      {
        entityType: "Host",
        entityValue: "web-1",
        certainty: SecurityConnectionCertainty.Exact,
        reason: SecurityConnectionReason.HostName,
        matchedValue: "web-1",
      },
    ],
    activeIncidents: {
      count: 3,
      items: [
        {
          id: INCIDENT_ID,
          number: "INC-7",
          title: "Checkout is down",
          stateName: "Investigating",
        },
      ],
    },
    activeAlerts: {
      count: 1,
      items: [{ id: ALERT_ID, number: "ALR-3", title: "CPU above 95%" }],
    },
    monitors: {
      count: 1,
      items: [{ id: MONITOR_ID, title: "web-1 ping" }],
    },
    recentChanges: [
      {
        id: "change-1",
        time: "2026-10-25T09:55:00.000Z",
        title: "Fixed: disk 91% full",
        eventType: "fix",
      },
    ],
    ...overrides,
  };
}

function answer(
  overrides: Partial<SecurityConnectionsJson> = {},
): SecurityConnectionsJson {
  return {
    windowStart: "2026-10-25T09:30:00.000Z",
    windowEnd: "2026-10-25T10:30:00.000Z",
    resources: [host()],
    hasMoreResources: false,
    unmatched: [],
    unreadableKinds: [],
    failedKinds: [],
    ...overrides,
  };
}

async function drawConnectedSignals(
  props: { requestKey?: string; refreshToken?: number } = {},
): Promise<ReturnType<typeof render>> {
  let rendered: ReturnType<typeof render> | undefined;

  await act(async () => {
    rendered = render(
      <MemoryRouter>
        <ConnectedSignals
          request={{ caseId: new ObjectID(CASE_ID) }}
          requestKey={props.requestKey || CASE_ID}
          refreshToken={props.refreshToken}
          description={CONNECTED_SIGNALS_CASE_DESCRIPTION}
        />
      </MemoryRouter>,
    );
  });

  return rendered!;
}

function href(element: Element): string {
  return element.closest("a")?.getAttribute("href") || "";
}

let isAllowed: boolean = true;

beforeEach(() => {
  isAllowed = true;
  getConnectionsMock.mockReset();
  getResourceSecurityMock.mockReset();
  getIncidentSecurityMock.mockReset();
  getItemMock.mockReset();
  getItemMock.mockResolvedValue(null as never);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(PermissionGate, "check").mockImplementation(() => {
    return { isAllowed };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Connected Signals", () => {
  test("a record the case names: its page, why, its signals and what is going on there", async () => {
    getConnectionsMock.mockResolvedValue(answer() as never);

    await drawConnectedSignals();

    const record: HTMLElement = await screen.findByTestId(IDS.record);

    expect(getConnectionsMock).toHaveBeenCalledWith({
      caseId: new ObjectID(CASE_ID),
    });
    expect(record).toHaveAttribute("data-kind", SecurityConnectionKind.Host);
    expect(record).toHaveAttribute(
      "data-certainty",
      SecurityConnectionCertainty.Exact,
    );
    expect(href(within(record).getByTestId(IDS.recordName))).toBe(
      `${BASE}/host/${HOST_ID}`,
    );
    expect(within(record).getByTestId(IDS.recordReason)).toHaveTextContent(
      "Named web-1, the name it reports.",
    );
    expect(within(record).queryByTestId(IDS.possiblePill)).toBeNull();

    // Its signals, each opening its explorer on the host and the window.
    const links: HTMLElement = within(record).getByTestId(IDS.signalLinks);

    expect(links).toHaveAttribute(
      "aria-label",
      "Signals of web-1 in this window",
    );
    expect(
      within(links)
        .getAllByRole("link")
        .map((link: HTMLElement): string => {
          return (link.textContent || "").trim();
        }),
    ).toEqual(["Logs", "Traces", "Metrics", "Topology"]);

    const logs: globalThis.URL = new globalThis.URL(
      href(within(links).getByText("Logs")),
      "https://oneuptime.example",
    );

    expect(logs.pathname).toBe(`${BASE}/logs`);
    expect(JSON.parse(logs.searchParams.get("filters") || "[]")).toEqual([
      ["hostId", [HOST_ID]],
    ]);
    expect(logs.searchParams.get("range")).toBe("Custom");

    // What is going on there.
    expect(within(record).getByTestId(IDS.incidents)).toHaveTextContent(
      "3 active incidents: INC-7 Checkout is down (Investigating) +2 more",
    );
    expect(href(within(record).getByText("INC-7 Checkout is down"))).toBe(
      `${BASE}/incidents/${INCIDENT_ID}`,
    );
    expect(within(record).getByTestId(IDS.alerts)).toHaveTextContent(
      "1 active alert: ALR-3 CPU above 95%",
    );
    expect(within(record).getByTestId(IDS.monitors)).toHaveTextContent(
      "Watched by 1 monitor: web-1 ping",
    );
    expect(href(within(record).getByText("web-1 ping"))).toBe(
      `${BASE}/monitors/${MONITOR_ID}`,
    );
    expect(within(record).getByTestId(IDS.changes)).toHaveTextContent(
      "Changed in this window: Fixed: disk 91% full",
    );
    expect(within(record).queryByTestId(IDS.nothingActive)).toBeNull();
    expect(screen.getByTestId(IDS.window)).toHaveTextContent("Signals from");
  });

  test("a possible match says so; a record with nothing open says that; a fact the role cannot read says nothing", async () => {
    getConnectionsMock.mockResolvedValue(
      answer({
        resources: [
          host({
            activeIncidents: { count: 0, items: [] },
            activeAlerts: { count: 0, items: [] },
            monitors: null,
            recentChanges: [],
          }),
          host({
            kind: SecurityConnectionKind.Service,
            id: SERVICE_ID,
            name: "checkout",
            certainty: SecurityConnectionCertainty.Possible,
            matches: [
              {
                entityType: "Other",
                entityValue: "checkout",
                certainty: SecurityConnectionCertainty.Possible,
                reason: SecurityConnectionReason.UntypedValue,
                matchedValue: "checkout",
              },
            ],
            activeIncidents: null,
            activeAlerts: null,
            monitors: null,
            recentChanges: null,
          }),
        ],
      }) as never,
    );

    await drawConnectedSignals();

    const [quiet, possible] = await screen.findAllByTestId(IDS.record);

    expect(within(quiet!).getByTestId(IDS.nothingActive)).toHaveTextContent(
      "No active incidents or alerts.",
    );
    expect(possible).toHaveAttribute(
      "data-certainty",
      SecurityConnectionCertainty.Possible,
    );
    expect(within(possible!).getByTestId(IDS.possiblePill)).toHaveTextContent(
      "Possible match",
    );
    expect(within(possible!).getByTestId(IDS.recordReason)).toHaveTextContent(
      "Named checkout without saying it is a host. Something else may have that name.",
    );
    // Unknown is not "nothing open": no line at all.
    expect(within(possible!).queryByTestId(IDS.nothingActive)).toBeNull();
    expect(within(possible!).queryByTestId(IDS.incidents)).toBeNull();
    expect(
      within(within(possible!).getByTestId(IDS.signalLinks))
        .getAllByRole("link")
        .map((link: HTMLElement): string => {
          return (link.textContent || "").trim();
        }),
    ).toEqual(["Logs", "Traces", "Metrics", "Exceptions"]);
  });

  test("what it looked for and did not find, what the role keeps from it, and what could not be read, with a way to read it again", async () => {
    getConnectionsMock.mockResolvedValue(
      answer({
        resources: [],
        hasMoreResources: false,
        unmatched: [
          { type: SecurityEntityType.User, value: "kim@acme.example" },
        ],
        unreadableKinds: [
          SecurityConnectionKind.Service,
          SecurityConnectionKind.User,
        ],
        failedKinds: [SecurityConnectionKind.KubernetesCluster],
      }) as never,
    );

    await drawConnectedSignals();

    // An empty state's title is a headline: its sentence without the stop.
    expect(await screen.findByTestId(IDS.empty)).toHaveTextContent(
      "Nothing it names is in OneUptime",
    );
    expect(screen.getByTestId(IDS.empty)).toHaveTextContent(
      "OneUptime looked for its hosts, addresses and users among your hosts, clusters, devices, services and users, and found none of them.",
    );
    expect(screen.getByTestId(IDS.notFound)).toHaveTextContent(
      "kim@acme.example",
    );
    expect(screen.getByTestId(IDS.unreadable)).toHaveTextContent(
      "Your role cannot see Services and Users, so none is shown.",
    );
    expect(screen.getByTestId(IDS.failed)).toHaveTextContent(
      "Kubernetes Clusters could not be read just now.",
    );

    getConnectionsMock.mockResolvedValue(answer() as never);

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId(IDS.failed)).getByRole("button", {
          name: "Try again",
        }),
      );
    });

    expect(getConnectionsMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId(IDS.record)).toBeInTheDocument();
  });

  test("a case that names nothing to look for says so", async () => {
    getConnectionsMock.mockResolvedValue(answer({ resources: [] }) as never);

    await drawConnectedSignals();

    expect(await screen.findByTestId(IDS.nothingToLookUp)).toHaveTextContent(
      "It names no host, address or user to look for",
    );
    expect(screen.getByTestId(IDS.nothingToLookUp)).toHaveTextContent(
      "Only hosts, addresses and users with an email can be found in OneUptime.",
    );
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
  });

  test("more records than are shown are said to exist", async () => {
    getConnectionsMock.mockResolvedValue(
      answer({ hasMoreResources: true }) as never,
    );

    await drawConnectedSignals();

    expect(await screen.findByTestId(IDS.moreRecords)).toHaveTextContent(
      "It names more records than are shown here.",
    );
  });

  test("a read that fails says why, and can be tried again", async () => {
    getConnectionsMock.mockRejectedValue(
      new Error("Reading security events takes a Security role.") as never,
    );

    await drawConnectedSignals();

    const error: HTMLElement = await screen.findByTestId(IDS.error);

    expect(error).toHaveTextContent(
      "Reading security events takes a Security role.",
    );

    getConnectionsMock.mockResolvedValue(answer() as never);

    await act(async () => {
      fireEvent.click(within(error).getByRole("button"));
    });

    expect(await screen.findByTestId(IDS.record)).toBeInTheDocument();
  });

  test("the same case read again keeps what it shows until the new answer is in", async () => {
    getConnectionsMock.mockResolvedValue(answer() as never);

    const rendered: ReturnType<typeof render> = await drawConnectedSignals({
      refreshToken: 1,
    });

    await screen.findByTestId(IDS.record);

    let resolve: (value: SecurityConnectionsJson) => void = () => {};

    getConnectionsMock.mockReturnValue(
      new Promise<SecurityConnectionsJson>(
        (done: (value: SecurityConnectionsJson) => void) => {
          resolve = done;
        },
      ) as never,
    );

    await act(async () => {
      rendered.rerender(
        <MemoryRouter>
          <ConnectedSignals
            request={{ caseId: new ObjectID(CASE_ID) }}
            requestKey={CASE_ID}
            refreshToken={2}
            description={CONNECTED_SIGNALS_CASE_DESCRIPTION}
          />
        </MemoryRouter>,
      );
    });

    // Still drawn while the case is read again.
    expect(screen.getByTestId(IDS.record)).toBeInTheDocument();

    await act(async () => {
      resolve(
        answer({
          resources: [],
          unmatched: [{ type: SecurityEntityType.Host, value: "db-9" }],
        }),
      );
    });

    expect(screen.queryByTestId(IDS.record)).toBeNull();
    expect(screen.getByTestId(IDS.notFound)).toHaveTextContent("db-9");
  });
});

describe("a record's Security card", () => {
  function security(
    overrides: Partial<ResourceSecurityJson> = {},
  ): ResourceSecurityJson {
    return {
      kind: SecurityConnectionKind.Host,
      id: HOST_ID,
      name: "web-1",
      isInUse: true,
      windowDays: 7,
      values: ["web-1"],
      entity: { type: SecurityEntityType.Host, value: "web-1" },
      eventCount: 42,
      findingCount: 3,
      maxSeverityId: 4,
      lastSeen: new Date().toISOString(),
      openCases: {
        count: 4,
        items: [
          {
            id: CASE_ID,
            number: "SEC-12",
            title: "Brute force against web-1",
            priorityName: "High",
            statusName: "Investigating",
          },
        ],
      },
      risk: { score: 64, entityValue: "web-1", entityType: "Host" },
      ...overrides,
    };
  }

  async function drawCard(
    kind: SecurityConnectionKind = SecurityConnectionKind.Host,
    id: string = HOST_ID,
  ): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter>
          <ResourceSecurityCard kind={kind} modelId={new ObjectID(id)} />
        </MemoryRouter>,
      );
    });
  }

  test("is not drawn, nor read, for a reader who may not read security events", async () => {
    isAllowed = false;
    getResourceSecurityMock.mockResolvedValue(security() as never);

    await drawCard();

    expect(getResourceSecurityMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId(IDS.resourceSecurity)).toBeNull();
  });

  test("is not drawn in a project that does not use Security Events, nor when the read fails", async () => {
    getResourceSecurityMock.mockResolvedValue(
      security({ isInUse: false }) as never,
    );

    await drawCard();

    expect(getResourceSecurityMock).toHaveBeenCalledWith({
      kind: SecurityConnectionKind.Host,
      id: new ObjectID(HOST_ID),
    });
    expect(screen.queryByTestId(IDS.resourceSecurity)).toBeNull();

    cleanup();
    getResourceSecurityMock.mockRejectedValue(new Error("down") as never);

    await drawCard();

    expect(screen.queryByTestId(IDS.resourceSecurity)).toBeNull();
  });

  test("a record nothing named says so in one line; a service's is about its logs", async () => {
    getResourceSecurityMock.mockResolvedValue(
      security({
        eventCount: 0,
        findingCount: 0,
        openCases: { count: 0, items: [] },
        risk: null,
        lastSeen: null,
      }) as never,
    );

    await drawCard();

    const card: HTMLElement = await screen.findByTestId(IDS.resourceSecurity);

    expect(card).toHaveAttribute("data-state", "quiet");
    expect(card).toHaveTextContent(
      "No security event named it in the last 7 days.",
    );

    cleanup();
    getResourceSecurityMock.mockResolvedValue(
      security({
        kind: SecurityConnectionKind.Service,
        id: SERVICE_ID,
        values: [],
        entity: null,
        eventCount: 0,
        findingCount: 0,
        openCases: { count: 0, items: [] },
        risk: null,
      }) as never,
    );

    await drawCard(SecurityConnectionKind.Service, SERVICE_ID);

    expect(await screen.findByTestId(IDS.resourceSecurity)).toHaveTextContent(
      "No security event was read from its logs in the last 7 days.",
    );
  });

  test("its open cases, events, findings and risk, each opening Security Events on it", async () => {
    getResourceSecurityMock.mockResolvedValue(security() as never);

    await drawCard();

    const card: HTMLElement = await screen.findByTestId(IDS.resourceSecurity);

    expect(card).toHaveAttribute("data-state", "news");
    expect(card).toHaveTextContent(
      "What Security Events found about it in the last 7 days.",
    );
    expect(card).toHaveTextContent("Open Cases");
    expect(card).toHaveTextContent("Findings");
    expect(card).toHaveTextContent("Risk");

    const events: globalThis.URL = new globalThis.URL(
      href(within(card).getByTestId(IDS.resourceSecurityOpen)),
      "https://oneuptime.example",
    );

    expect(
      within(card).getByTestId(IDS.resourceSecurityOpen),
    ).toHaveTextContent("42");
    expect(events.pathname).toBe(`${BASE}/security-events`);
    expect(decodeURIComponent(events.searchParams.get("search") || "")).toBe(
      "observable:web-1",
    );

    const cases: HTMLElement = within(card).getByTestId(
      IDS.resourceSecurityCases,
    );

    expect(cases).toHaveTextContent("SEC-12");
    expect(cases).toHaveTextContent("Brute force against web-1");
    expect(cases).toHaveTextContent("3 more open cases");
    expect(href(within(cases).getByText("Brute force against web-1"))).toBe(
      `${BASE}/security-events/cases/${CASE_ID}`,
    );
    expect(
      within(card).getByRole("button", { name: "Open in Security Events" }),
    ).toBeInTheDocument();
  });
});

describe("an incident's Security card", () => {
  async function drawCard(): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter>
          <IncidentSecurityCard incidentId={new ObjectID(INCIDENT_ID)} />
        </MemoryRouter>,
      );
    });
  }

  const SECURITY: IncidentSecurityJson = {
    declaredBy: [
      {
        id: CASE_ID,
        number: "SEC-12",
        title: "Brute force against web-1",
        statusName: "Contained",
      },
    ],
    namingItsResources: [
      {
        id: "20000000-0000-4000-8000-000000000143",
        number: "SEC-13",
        title: "Cryptominer on prod-eu",
        resources: [
          { kind: SecurityConnectionKind.Host, id: HOST_ID, name: "web-1" },
          {
            kind: SecurityConnectionKind.KubernetesCluster,
            id: CLUSTER_ID,
            name: "prod-eu",
          },
        ],
      },
    ],
    namingItsResourcesCount: 3,
  };

  test("names the case that declared it, and the open cases naming what it affects", async () => {
    getIncidentSecurityMock.mockResolvedValue(SECURITY as never);

    await drawCard();

    const card: HTMLElement = await screen.findByTestId(IDS.incidentSecurity);

    expect(getIncidentSecurityMock).toHaveBeenCalledWith(
      new ObjectID(INCIDENT_ID),
    );
    expect(
      within(card).getByTestId(IDS.incidentSecurityDeclared),
    ).toHaveTextContent("Declared from");
    expect(
      within(card).getByTestId(IDS.incidentSecurityDeclared),
    ).toHaveTextContent("SEC-12");

    const naming: HTMLElement = within(card).getByTestId(
      IDS.incidentSecurityNaming,
    );

    expect(naming).toHaveTextContent("Open cases naming what it affects");
    expect(naming).toHaveTextContent("Names web-1 and prod-eu");
    expect(naming).toHaveTextContent("2 more open cases");
  });

  test("an incident Security Events has nothing to say about draws nothing; nor does a reader who may not read cases", async () => {
    getIncidentSecurityMock.mockResolvedValue({
      declaredBy: [],
      namingItsResources: [],
      namingItsResourcesCount: 0,
    } as never);

    await drawCard();

    await waitFor(() => {
      expect(getIncidentSecurityMock).toHaveBeenCalled();
    });
    expect(screen.queryByTestId(IDS.incidentSecurity)).toBeNull();

    cleanup();
    getIncidentSecurityMock.mockClear();
    isAllowed = false;

    await drawCard();

    expect(getIncidentSecurityMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId(IDS.incidentSecurity)).toBeNull();
  });
});
