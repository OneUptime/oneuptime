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
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * Security Events, connected to the rest of OneUptime, as a reader sees it.
 *
 * Connected Signals (a case's page, an event's Connected tab, an entity's
 * card): one line per record the case names - its name opening its page,
 * why OneUptime connects it, a pill when it is only possibly the same, its
 * signals opening the explorers on it and the window, and what is going on
 * there - then what was looked for and no record matches, and what the
 * reader's role keeps from them. Under them, on a read of its own, where
 * what it names appears in the logs and traces themselves: each value with
 * how many log lines and spans name it, where in them (each opening its
 * explorer on exactly those) and the records that sent them.
 *
 * The way back: a host's, a cluster's, a service's page has a Security card
 * - drawn only for a reader who may read security events, in a project
 * that uses them - and an incident's page names the case that declared it
 * and the open cases naming what it affects, for a reader who may read
 * cases. A read that fails takes nothing from the page.
 */

const getConnectionsMock: MockFunction = getJestMockFunction();
const getTelemetryMentionsMock: MockFunction = getJestMockFunction();
const getResourceSecurityMock: MockFunction = getJestMockFunction();
const getIncidentSecurityMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

/*
 * The reader's language and its words: English, as written, unless a test
 * reads the cards in another language.
 */
const mockReader: { language: string; words: Record<string, string> } = {
  language: "en",
  words: {},
};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return mockReader.words[value] ?? value;
        },
        i18n: {
          language: mockReader.language,
          resolvedLanguage: mockReader.language,
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
        getTelemetryMentions: (...args: Array<unknown>) => {
          return getTelemetryMentionsMock(...args);
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

import ConnectedSignals, {
  CONNECTED_CHANGE_ITEM_CLASS_NAME,
  CONNECTED_CHANGE_TITLE_CLASS_NAME,
  CONNECTED_FACT_ROW_CLASS_NAME,
  CONNECTED_NO_RECORD_TITLE_CLASS_NAME,
  CONNECTED_RECORD_TEXT_CLASS_NAME,
  TELEMETRY_SECTION_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/ConnectedSignals";
import { CONNECTED_ENTRY_ICON_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/SecurityConnectionsLayout";
import {
  TELEMETRY_FAILED_LINE_CLASS_NAME,
  TELEMETRY_PLACE_LINK_CLASS_NAME,
  TELEMETRY_ROW_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/TelemetryMentions";
import IncidentSecurityCard from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/IncidentSecurityCard";
import ResourceSecurityCard, {
  RESOURCE_SECURITY_OPEN_LINK_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/ResourceSecurityCard";
import {
  CONNECTED_SIGNALS_CASE_DESCRIPTION,
  CONNECTED_SIGNALS_EVENT_DESCRIPTION,
  SECURITY_CONNECTIONS_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/SecurityConnectionsCopy";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import {
  getUnexplainedServerErrorMessage,
  UnexplainedErrorWords,
} from "../../../Types/Exception/UnexplainedError";
import ObjectID from "../../../Types/ObjectID";
import {
  IncidentSecurityJson,
  ResourceSecurityJson,
  SecurityConnectedResourceJson,
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionReason,
  SecurityConnectionsJson,
  SECURITY_TELEMETRY_MESSAGE_PLACE,
  SecurityTelemetryHitsJson,
  SecurityTelemetryMentionsJson,
  SecurityTelemetrySignal,
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

// Where what it names appears in the logs and traces: nothing searched, unless a test says.
function mentions(
  overrides: Partial<SecurityTelemetryMentionsJson> = {},
): SecurityTelemetryMentionsJson {
  return {
    windowStart: "2026-10-25T09:30:00.000Z",
    windowEnd: "2026-10-25T10:30:00.000Z",
    values: [],
    hasMoreValues: false,
    unreadableSignals: [],
    failedSignals: [],
    ...overrides,
  };
}

function hits(
  overrides: Partial<SecurityTelemetryHitsJson> = {},
): SecurityTelemetryHitsJson {
  return {
    count: 0,
    sources: [],
    sourceCount: 0,
    places: [],
    lastSeen: null,
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

// A fact's items, each as its link (or text) reads: its number and title.
function factItems(row: HTMLElement): Array<string> {
  return within(row)
    .getAllByTestId(IDS.factItem)
    .map((item: HTMLElement): string => {
      return (item.querySelector("bdi")?.textContent || "").trim();
    });
}

let isAllowed: boolean = true;

beforeEach(() => {
  isAllowed = true;
  getConnectionsMock.mockReset();
  getTelemetryMentionsMock.mockReset();
  getTelemetryMentionsMock.mockResolvedValue(mentions() as never);
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
  mockReader.language = "en";
  mockReader.words = {};
});

/*
 * A record's reason is a sentence drawn and nothing else, so its values
 * are set apart (setsValuesApart): in Persian, what the case named and what
 * the record holds - a host, an address, a URL - are each an isolate, read
 * left to right in one piece, where the sentence reads from the right.
 */
describe("a record's reason, read from the right", () => {
  const PERSIAN: Record<string, string> = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json",
      ),
      "utf-8",
    ),
  ) as Record<string, string>;

  test("in Persian the host the case named is an isolate in its sentence", async () => {
    mockReader.language = "fa";
    mockReader.words = PERSIAN;
    getConnectionsMock.mockResolvedValue(answer() as never);

    await drawConnectedSignals();

    const record: HTMLElement = await screen.findByTestId(IDS.record);
    const reason: string =
      within(record).getByTestId(IDS.recordReason).textContent || "";

    expect(reason).toBe(
      (PERSIAN["Named {{value}}, the name it reports."] as string).replace(
        "{{value}}",
        isolated("web-1"),
      ),
    );
  });

  test("a URL the case named, beside the address the monitor checks, is two isolates", async () => {
    mockReader.language = "fa";
    mockReader.words = PERSIAN;
    getConnectionsMock.mockResolvedValue(
      answer({
        resources: [
          host({
            kind: SecurityConnectionKind.Monitor,
            id: MONITOR_ID,
            name: "Checkout login",
            matches: [
              {
                entityType: SecurityEntityType.Url,
                entityValue: "https://login.acme-retail.example/sign-in?next=/",
                certainty: SecurityConnectionCertainty.Exact,
                reason: SecurityConnectionReason.MonitorTarget,
                matchedValue: "https://login.acme-retail.example",
              },
            ],
          }),
        ],
      }) as never,
    );

    await drawConnectedSignals();

    const record: HTMLElement = await screen.findByTestId(IDS.record);
    const reason: string =
      within(record).getByTestId(IDS.recordReason).textContent || "";

    expect(reason).toContain(
      isolated("https://login.acme-retail.example/sign-in?next=/"),
    );
    expect(reason).toContain(isolated("https://login.acme-retail.example"));
  });

  test("in English the reason carries no mark", async () => {
    getConnectionsMock.mockResolvedValue(answer() as never);

    await drawConnectedSignals();

    const record: HTMLElement = await screen.findByTestId(IDS.record);
    const reason: string =
      within(record).getByTestId(IDS.recordReason).textContent || "";

    expect(reason).toBe("Named web-1, the name it reports.");
    expect(reason).toBe(withoutIsolateMarks(reason));
  });
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
    // A group named for its record, not a landmark: a case of ten records is not ten navigations.
    expect(links).toHaveAttribute("role", "group");
    expect(links.tagName).not.toBe("NAV");
    expect(screen.queryAllByRole("navigation")).toEqual([]);
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

    /*
     * What is going on there: one fact a row of a list - its label, then its
     * items, each on a line of its own, opening its page, with where it
     * stands; the ones left out counted.
     */
    const incidents: HTMLElement = within(record).getByTestId(IDS.incidents);

    expect(within(incidents).getByTestId(IDS.factLabel).tagName).toBe("DT");
    expect(within(incidents).getByTestId(IDS.factLabel)).toHaveTextContent(
      "3 active incidents",
    );
    expect(factItems(incidents)).toEqual(["INC-7 Checkout is down"]);
    expect(incidents).toHaveTextContent("+2 more");
    expect(
      href(
        within(incidents).getByRole("link", { name: "INC-7 Checkout is down" }),
      ),
    ).toBe(`${BASE}/incidents/${INCIDENT_ID}`);
    expect(
      within(within(incidents).getByTestId(IDS.factItem)).getByText(
        "Investigating",
      ),
    ).toBeInTheDocument();

    const alerts: HTMLElement = within(record).getByTestId(IDS.alerts);

    expect(within(alerts).getByTestId(IDS.factLabel)).toHaveTextContent(
      "1 active alert",
    );
    expect(factItems(alerts)).toEqual(["ALR-3 CPU above 95%"]);
    expect(alerts).not.toHaveTextContent("more");

    const monitors: HTMLElement = within(record).getByTestId(IDS.monitors);

    expect(within(monitors).getByTestId(IDS.factLabel)).toHaveTextContent(
      "Watched by 1 monitor",
    );
    expect(
      href(within(monitors).getByRole("link", { name: "web-1 ping" })),
    ).toBe(`${BASE}/monitors/${MONITOR_ID}`);

    // A change: its time, then what changed - its own line.
    const changes: HTMLElement = within(record).getByTestId(IDS.changes);
    const change: HTMLElement = within(changes).getByTestId(IDS.factItem);

    expect(within(changes).getByTestId(IDS.factLabel)).toHaveTextContent(
      "Changed in this window",
    );
    expect(change.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-10-25T09:55:00.000Z",
    );
    expect(change).toHaveTextContent("Fixed: disk 91% full");
    // Its title beside the time while it keeps 16rem there, under it on a phone.
    expect(change.className).toBe(CONNECTED_CHANGE_ITEM_CLASS_NAME);
    expect(CONNECTED_CHANGE_ITEM_CLASS_NAME).toContain("flex-wrap");
    expect(change.querySelector("time + span")?.className).toBe(
      CONNECTED_CHANGE_TITLE_CLASS_NAME,
    );
    expect(CONNECTED_CHANGE_TITLE_CLASS_NAME).toContain("basis-64");
    expect(within(record).queryByTestId(IDS.nothingActive)).toBeNull();
    expect(screen.getByTestId(IDS.window)).toHaveTextContent("Signals from");
    // No colon run-on sentences any more: a label is a label.
    expect(record).not.toHaveTextContent("incidents:");
  });

  test("a monitor: its status beside its name, the address it checks in its own words, its logs and metrics", async () => {
    getConnectionsMock.mockResolvedValue(
      answer({
        resources: [
          {
            kind: SecurityConnectionKind.Monitor,
            id: MONITOR_ID,
            name: "Checkout site",
            certainty: SecurityConnectionCertainty.Exact,
            status: { name: "Degraded", color: "#f59e0b" },
            matches: [
              {
                entityType: SecurityEntityType.Url,
                entityValue: "https://shop.acme.example/admin",
                certainty: SecurityConnectionCertainty.Exact,
                reason: SecurityConnectionReason.MonitorTarget,
                matchedValue: "shop.acme.example",
              },
            ],
            activeIncidents: { count: 0, items: [] },
            activeAlerts: { count: 0, items: [] },
            monitors: null,
            recentChanges: null,
          },
        ],
      }) as never,
    );

    await drawConnectedSignals();

    const record: HTMLElement = await screen.findByTestId(IDS.record);

    expect(record).toHaveAttribute("data-kind", SecurityConnectionKind.Monitor);
    expect(href(within(record).getByTestId(IDS.recordName))).toBe(
      `${BASE}/monitors/${MONITOR_ID}`,
    );
    expect(record).toHaveTextContent("Monitor");
    expect(within(record).getByTestId(IDS.monitorStatus)).toHaveTextContent(
      "Degraded",
    );
    // A URL on the address it checks: the URL, then the address.
    expect(within(record).getByTestId(IDS.recordReason)).toHaveTextContent(
      "Named https://shop.acme.example/admin, on shop.acme.example, the address it checks.",
    );
    expect(
      within(within(record).getByTestId(IDS.signalLinks))
        .getAllByRole("link")
        .map((link: HTMLElement): string => {
          return `${(link.textContent || "").trim()} ${
            new globalThis.URL(href(link), "https://oneuptime.example").pathname
          }`;
        }),
    ).toEqual([
      `Logs ${BASE}/monitors/${MONITOR_ID}/logs`,
      `Metrics ${BASE}/monitors/${MONITOR_ID}/metrics`,
    ]);
    // Nothing open on it says so; a monitor watches nothing itself.
    expect(within(record).getByTestId(IDS.nothingActive)).toBeInTheDocument();
    expect(within(record).queryByTestId(IDS.monitors)).toBeNull();
  });

  test("a monitor checking the very host it names reads as the address it checks; one that may check it, in a monitor's words", async () => {
    const monitor: (
      id: string,
      match: SecurityConnectedResourceJson["matches"][number],
    ) => SecurityConnectedResourceJson = (
      id: string,
      match: SecurityConnectedResourceJson["matches"][number],
    ): SecurityConnectedResourceJson => {
      return {
        kind: SecurityConnectionKind.Monitor,
        id,
        name: `Monitor ${id.slice(-1)}`,
        certainty: match.certainty,
        matches: [match],
        activeIncidents: null,
        activeAlerts: null,
        monitors: null,
        recentChanges: null,
      };
    };

    getConnectionsMock.mockResolvedValue(
      answer({
        resources: [
          monitor("40000000-0000-4000-8000-000000000011", {
            entityType: SecurityEntityType.IpAddress,
            entityValue: "203.0.113.7",
            certainty: SecurityConnectionCertainty.Exact,
            reason: SecurityConnectionReason.MonitorTarget,
            matchedValue: "203.0.113.7",
          }),
          monitor("40000000-0000-4000-8000-000000000012", {
            entityType: SecurityEntityType.Host,
            entityValue: "web-1",
            certainty: SecurityConnectionCertainty.Possible,
            reason: SecurityConnectionReason.ShortHostName,
            matchedValue: "web-1.acme.internal",
          }),
          monitor("40000000-0000-4000-8000-000000000013", {
            entityType: SecurityEntityType.IpAddress,
            entityValue: "10.0.3.17",
            certainty: SecurityConnectionCertainty.Possible,
            reason: SecurityConnectionReason.PrivateAddress,
            matchedValue: "10.0.3.17",
          }),
        ],
      }) as never,
    );

    await drawConnectedSignals();
    await screen.findAllByTestId(IDS.record);

    expect(
      screen.getAllByTestId(IDS.recordReason).map((reason: HTMLElement) => {
        return (reason.textContent || "").trim();
      }),
    ).toEqual([
      "Named 203.0.113.7, the address it checks.",
      "Named web-1, a short or full form of web-1.acme.internal, which it checks. Another machine may share it.",
      "Named by 10.0.3.17, a private address it checks. Another network can give it to another machine.",
    ]);
  });

  test("a member: the on-call schedules they are on, on call now first, and the teams they are in, each opening its page", async () => {
    const USER_ID: string = "50000000-0000-4000-8000-000000000001";
    const PRIMARY: string = "50000000-0000-4000-8000-000000000011";
    const SECONDARY: string = "50000000-0000-4000-8000-000000000012";
    const TEAM_ID: string = "50000000-0000-4000-8000-000000000021";

    getConnectionsMock.mockResolvedValue(
      answer({
        resources: [
          {
            kind: SecurityConnectionKind.User,
            id: USER_ID,
            name: "Kim Morgan",
            certainty: SecurityConnectionCertainty.Exact,
            matches: [
              {
                entityType: SecurityEntityType.User,
                entityValue: "kim@acme.example",
                certainty: SecurityConnectionCertainty.Exact,
                reason: SecurityConnectionReason.Email,
                matchedValue: "kim@acme.example",
              },
            ],
            activeIncidents: null,
            activeAlerts: null,
            monitors: null,
            recentChanges: null,
            onCallSchedules: {
              count: 4,
              items: [
                { id: PRIMARY, name: "Platform primary", isOnCallNow: true },
                {
                  id: SECONDARY,
                  name: "Platform secondary",
                  isOnCallNow: false,
                },
              ],
            },
            teams: { count: 1, items: [{ id: TEAM_ID, title: "SRE" }] },
          },
        ],
      }) as never,
    );

    await drawConnectedSignals();

    const record: HTMLElement = await screen.findByTestId(IDS.record);
    const schedules: HTMLElement = within(record).getByTestId(IDS.schedules);

    expect(within(schedules).getByTestId(IDS.factLabel)).toHaveTextContent(
      "On 4 on-call schedules",
    );
    expect(factItems(schedules)).toEqual([
      "Platform primary",
      "Platform secondary",
    ]);
    expect(schedules).toHaveTextContent("+2 more");
    expect(
      href(within(schedules).getByRole("link", { name: "Platform primary" })),
    ).toBe(`${BASE}/on-call-duty/schedules/${PRIMARY}`);
    // Only the one they are on call for now says so.
    expect(within(schedules).getAllByTestId(IDS.onCallNow)).toHaveLength(1);
    expect(
      within(
        within(schedules).getAllByTestId(IDS.factItem)[0] as HTMLElement,
      ).getByTestId(IDS.onCallNow),
    ).toHaveTextContent("On call now");

    const teams: HTMLElement = within(record).getByTestId(IDS.teams);

    expect(within(teams).getByTestId(IDS.factLabel)).toHaveTextContent(
      "In 1 team",
    );
    expect(href(within(teams).getByRole("link", { name: "SRE" }))).toBe(
      `${BASE}/teams/${TEAM_ID}`,
    );
    // A person has no incidents or alerts of their own: no quiet line either.
    expect(within(record).queryByTestId(IDS.nothingActive)).toBeNull();
  });

  test("a member on no schedule and in no team, or whose schedules the role cannot read, shows neither row", async () => {
    getConnectionsMock.mockResolvedValue(
      answer({
        resources: [
          {
            kind: SecurityConnectionKind.User,
            id: "50000000-0000-4000-8000-000000000001",
            name: "Kim Morgan",
            certainty: SecurityConnectionCertainty.Exact,
            matches: [],
            activeIncidents: null,
            activeAlerts: null,
            monitors: null,
            recentChanges: null,
            onCallSchedules: null,
            teams: { count: 0, items: [] },
          },
        ],
      }) as never,
    );

    await drawConnectedSignals();

    const record: HTMLElement = await screen.findByTestId(IDS.record);

    expect(within(record).queryByTestId(IDS.schedules)).toBeNull();
    expect(within(record).queryByTestId(IDS.teams)).toBeNull();
    expect(within(record).queryByTestId(IDS.facts)).toBeNull();
  });

  test("a cloud resource and a serverless function: each its page, and its logs, traces and metrics on it and the window", async () => {
    const CLOUD_ID: string = "60000000-0000-4000-8000-000000000001";
    const FUNCTION_ID: string = "60000000-0000-4000-8000-000000000002";
    const record: (
      kind: SecurityConnectionKind,
      id: string,
      name: string,
    ) => SecurityConnectedResourceJson = (
      kind: SecurityConnectionKind,
      id: string,
      name: string,
    ): SecurityConnectedResourceJson => {
      return {
        kind,
        id,
        name,
        certainty: SecurityConnectionCertainty.Exact,
        matches: [
          {
            entityType: SecurityEntityType.Other,
            entityValue: name,
            certainty: SecurityConnectionCertainty.Exact,
            reason: SecurityConnectionReason.LogSource,
            matchedValue: name,
          },
        ],
        activeIncidents: null,
        activeAlerts: null,
        monitors: null,
        recentChanges: [],
      };
    };

    getConnectionsMock.mockResolvedValue(
      answer({
        resources: [
          record(
            SecurityConnectionKind.CloudResource,
            CLOUD_ID,
            "checkout-alb",
          ),
          record(
            SecurityConnectionKind.ServerlessFunction,
            FUNCTION_ID,
            "checkout-handler",
          ),
        ],
      }) as never,
    );

    await drawConnectedSignals();

    const [cloud, handler] = (await screen.findAllByTestId(IDS.record)) as [
      HTMLElement,
      HTMLElement,
    ];

    expect(href(within(cloud).getByTestId(IDS.recordName))).toBe(
      `${BASE}/cloud/${CLOUD_ID}`,
    );
    expect(cloud).toHaveTextContent("Cloud Resource");
    expect(href(within(handler).getByTestId(IDS.recordName))).toBe(
      `${BASE}/serverless/${FUNCTION_ID}`,
    );
    expect(handler).toHaveTextContent("Serverless Function");

    for (const [element, facet, id, metrics] of [
      [cloud, "cloudResourceId", CLOUD_ID, `${BASE}/cloud/${CLOUD_ID}/metrics`],
      [
        handler,
        "serverlessFunctionId",
        FUNCTION_ID,
        `${BASE}/serverless/${FUNCTION_ID}/metrics`,
      ],
    ] as Array<[HTMLElement, string, string, string]>) {
      const links: HTMLElement = within(element).getByTestId(IDS.signalLinks);

      expect(
        within(links)
          .getAllByRole("link")
          .map((link: HTMLElement): string => {
            return (link.textContent || "").trim();
          }),
      ).toEqual(["Logs", "Traces", "Metrics"]);

      const logs: globalThis.URL = new globalThis.URL(
        href(within(links).getByText("Logs")),
        "https://oneuptime.example",
      );

      expect(JSON.parse(logs.searchParams.get("filters") || "[]")).toEqual([
        [facet, [id]],
      ]);
      expect(
        new globalThis.URL(
          href(within(links).getByText("Metrics")),
          "https://oneuptime.example",
        ).pathname,
      ).toBe(metrics);
    }
  });

  test("every fact's items sit in a list of their own, its label a dt laid out beside them by the record's own width", async () => {
    getConnectionsMock.mockResolvedValue(
      answer({
        resources: [
          host({
            activeIncidents: {
              count: 3,
              items: [
                {
                  id: INCIDENT_ID,
                  number: "INC-7",
                  title: "Checkout is down",
                  stateName: "Investigating",
                  stateColor: "#f97316",
                },
                {
                  id: "40000000-0000-4000-8000-000000000011",
                  number: "INC-8",
                  title: "Card payments time out",
                },
                {
                  id: "40000000-0000-4000-8000-000000000012",
                  title: "Search is slow",
                },
              ],
            },
          }),
        ],
      }) as never,
    );

    await drawConnectedSignals();

    const record: HTMLElement = await screen.findByTestId(IDS.record);
    const facts: HTMLElement = within(record).getByTestId(IDS.facts);
    const incidents: HTMLElement = within(record).getByTestId(IDS.incidents);

    // A description list: each row a label and its items.
    expect(facts.querySelector("dl")).not.toBeNull();
    expect(incidents.parentElement?.tagName).toBe("DL");
    expect(incidents.className).toBe(CONNECTED_FACT_ROW_CLASS_NAME);
    expect(CONNECTED_FACT_ROW_CLASS_NAME).toContain("grid-cols-1");
    expect(CONNECTED_FACT_ROW_CLASS_NAME).toContain(
      "[@container(min-width:32rem)]:grid-cols-[11rem_minmax(0,1fr)]",
    );
    // The record's text column is the size container those rows read.
    expect(
      within(record).getByTestId(IDS.recordName).closest("div")?.parentElement
        ?.className,
    ).toBe(CONNECTED_RECORD_TEXT_CLASS_NAME);
    expect(CONNECTED_RECORD_TEXT_CLASS_NAME).toContain(
      "[container-type:inline-size]",
    );

    // Each item a list item of its own, in the order the server sent them.
    const items: Array<HTMLElement> = within(incidents).getAllByTestId(
      IDS.factItem,
    );

    expect(
      items.map((item: HTMLElement): string => {
        return item.tagName;
      }),
    ).toEqual(["LI", "LI", "LI"]);
    expect(factItems(incidents)).toEqual([
      "INC-7 Checkout is down",
      "INC-8 Card payments time out",
      "Search is slow",
    ]);
    // Where each stands, when the server says: a pill, in its own colour.
    expect(within(items[0]!).getByText("Investigating")).toBeInTheDocument();
    expect(within(items[1]!).queryByText("Investigating")).toBeNull();
    // A record's name and an item's title are written outside the reader's language: isolated.
    expect(items[0]!.querySelector("bdi")).toHaveTextContent(
      "INC-7 Checkout is down",
    );
    expect(
      within(record).getByTestId(IDS.recordName).querySelector("bdi"),
    ).toHaveTextContent("web-1");
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

  test("possible matches come after the exact ones, under a heading that says what possible means", async () => {
    getConnectionsMock.mockResolvedValue(
      answer({
        resources: [
          host(),
          host({
            id: "30000000-0000-4000-8000-000000000009",
            name: "web-1.staging.acme.example",
            certainty: SecurityConnectionCertainty.Possible,
            matches: [
              {
                entityType: "Host",
                entityValue: "web-1",
                certainty: SecurityConnectionCertainty.Possible,
                reason: SecurityConnectionReason.ShortHostName,
                matchedValue: "web-1.staging.acme.example",
              },
            ],
          }),
        ],
      }) as never,
    );

    await drawConnectedSignals();

    const group: HTMLElement = await screen.findByTestId(IDS.possibleGroup);

    expect(within(group).getByRole("heading", { level: 3 })).toHaveTextContent(
      "Possible matches",
    );
    expect(group).toHaveTextContent(
      "OneUptime cannot be sure these are the same records, so they are not counted on their pages or linked to incidents.",
    );
    // The exact record outside the group, before it; the possible one inside, with its pill.
    const [exact, possible] = screen.getAllByTestId(IDS.record);

    expect(group).not.toContainElement(exact!);
    expect(group).toContainElement(possible!);
    expect(
      exact!.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(possible!).getByTestId(IDS.possiblePill)).toBeInTheDocument();
    // Parted from the exact ones by a rule.
    expect(group).toHaveClass("border-t");

    // All of them possible: the heading still says what that means, with no rule above it.
    cleanup();
    getConnectionsMock.mockResolvedValue(
      answer({
        resources: [
          host({
            certainty: SecurityConnectionCertainty.Possible,
          }),
        ],
      }) as never,
    );

    await drawConnectedSignals();

    expect(await screen.findByTestId(IDS.possibleGroup)).not.toHaveClass(
      "border-t",
    );

    // None possible: no heading.
    cleanup();
    getConnectionsMock.mockResolvedValue(answer() as never);

    await drawConnectedSignals();

    await screen.findByTestId(IDS.record);
    expect(screen.queryByTestId(IDS.possibleGroup)).toBeNull();
  });

  test("every kind of record read and none is what it names: then, and only then, no record matches what it names", async () => {
    getConnectionsMock.mockResolvedValue(
      answer({
        resources: [],
        unmatched: [{ type: SecurityEntityType.Host, value: "kiosk-17" }],
      }) as never,
    );

    await drawConnectedSignals();

    const empty: HTMLElement = await screen.findByTestId(IDS.empty);

    expect(empty).toHaveTextContent("No record matches what it names.");
    expect(empty).toHaveTextContent(
      "OneUptime looked for them among your hosts, clusters, devices, cloud resources, services, monitors and users, and found none.",
    );
    expect(screen.getByTestId(IDS.notFound)).toHaveTextContent("kiosk-17");
    expect(screen.queryByTestId(IDS.partialEmpty)).toBeNull();
    // A window over no record says nothing.
    expect(screen.queryByTestId(IDS.window)).toBeNull();

    /*
     * An entry of the list, as a record's is drawn - the list's icon in its
     * square, its sentence beside it - not a page's large empty state that
     * pushes the logs and traces below out of sight. What it looked for is
     * under the sentence that says none matched, not repeated under a
     * heading of its own.
     */
    expect(screen.queryByTestId("table-empty-state")).toBeNull();
    expect((empty.firstElementChild as HTMLElement).className).toBe(
      CONNECTED_ENTRY_ICON_CLASS_NAME,
    );
    const text: HTMLElement = empty.lastElementChild as HTMLElement;

    expect(text.className).toBe(CONNECTED_RECORD_TEXT_CLASS_NAME);
    expect((text.firstElementChild as HTMLElement).className).toBe(
      CONNECTED_NO_RECORD_TITLE_CLASS_NAME,
    );
    expect(text).toContainElement(screen.getByTestId(IDS.notFound));
    expect(screen.queryByText("No matching record")).toBeNull();
  });

  test("beside records, what it looked for that no record matches follows them under a heading of its own", async () => {
    getConnectionsMock.mockResolvedValue(
      answer({
        unmatched: [{ type: SecurityEntityType.Host, value: "kiosk-17" }],
      }) as never,
    );

    await drawConnectedSignals();

    await screen.findByTestId(IDS.record);

    const notFound: HTMLElement = screen.getByTestId(IDS.notFound);

    expect(
      within(notFound).getByRole("heading", { level: 3 }),
    ).toHaveTextContent("No matching record");
    expect(notFound).toHaveTextContent("kiosk-17");
    expect(notFound.className).toContain("border-t");
    expect(
      screen.getByTestId(IDS.record).compareDocumentPosition(notFound) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
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

    /*
     * Kinds the role cannot see, or that could not be read, may still hold
     * what it names: no matching record found, never "no record matches".
     */
    expect(await screen.findByTestId(IDS.partialEmpty)).toHaveTextContent(
      "No matching record was found",
    );
    expect(screen.getByTestId(IDS.partialEmpty)).toHaveTextContent(
      "Some kinds of record could not be read, so one may still match.",
    );
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
    expect(document.body).not.toHaveTextContent(
      "No record matches what it names",
    );
    expect(document.body).not.toHaveTextContent("and found none");
    // What it looked for, under the sentence that says one may still match.
    expect(screen.getByTestId(IDS.notFound)).toHaveTextContent(
      "kim@acme.example",
    );
    expect(screen.getByTestId(IDS.partialEmpty)).toContainElement(
      screen.getByTestId(IDS.notFound),
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

    /*
     * Said of the records alone, and of every value a record can be found
     * by - a URL and a cloud resource ID among them: a file hash it names
     * may still be in the logs and traces below.
     */
    expect(await screen.findByTestId(IDS.nothingToLookUp)).toHaveTextContent(
      "Nothing it names can be matched to a record.",
    );
    expect(screen.getByTestId(IDS.nothingToLookUp)).toHaveTextContent(
      "Records are found by a host name, an address, a URL, a cloud resource ID or a user's email.",
    );
    expect(document.body).not.toHaveTextContent("can be found in OneUptime");
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
    expect(screen.queryByTestId(IDS.notFound)).toBeNull();
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

describe("In your logs and traces, under Connected Signals", () => {
  const attacker: SecurityTelemetryMentionsJson["values"][number] = {
    entityType: SecurityEntityType.IpAddress,
    entityValue: "203.0.113.7",
    logs: hits({
      count: 1284,
      sources: [
        {
          kind: SecurityConnectionKind.Service,
          id: SERVICE_ID,
          name: "checkout-api",
          count: 1200,
        },
        {
          kind: SecurityConnectionKind.Host,
          id: HOST_ID,
          name: "edge-1",
          count: 80,
        },
      ],
      sourceCount: 4,
      places: [
        { key: SECURITY_TELEMETRY_MESSAGE_PLACE, count: 1200 },
        { key: "client_ip", count: 84, value: "203.0.113.7" },
      ],
      lastSeen: "2026-10-25T10:12:00.000Z",
    }),
    traces: hits({
      count: 312,
      sources: [
        {
          kind: SecurityConnectionKind.Service,
          id: SERVICE_ID,
          name: "checkout-api",
          count: 312,
        },
      ],
      sourceCount: 1,
      places: [{ key: "client.address", count: 312, value: "203.0.113.7" }],
    }),
  };
  const quiet: SecurityTelemetryMentionsJson["values"][number] = {
    entityType: SecurityEntityType.Domain,
    entityValue: "evil-c2.example.net",
    logs: hits(),
    traces: hits(),
  };

  function section(): HTMLElement {
    return screen.getByTestId(IDS.telemetry);
  }

  test("read with the same request as the records, side by side, not after them", async () => {
    let resolveRecords: (value: SecurityConnectionsJson) => void = () => {};

    getConnectionsMock.mockReturnValue(
      new Promise<SecurityConnectionsJson>(
        (done: (value: SecurityConnectionsJson) => void) => {
          resolveRecords = done;
        },
      ) as never,
    );
    getTelemetryMentionsMock.mockResolvedValue(
      mentions({ values: [attacker] }) as never,
    );

    await drawConnectedSignals();

    expect(getTelemetryMentionsMock).toHaveBeenCalledWith({
      caseId: new ObjectID(CASE_ID),
    });
    // In before the records are.
    expect(await screen.findByTestId(IDS.telemetryValue)).toBeInTheDocument();
    expect(screen.queryByTestId(IDS.record)).toBeNull();

    await act(async () => {
      resolveRecords(answer());
    });

    expect(screen.getByTestId(IDS.record)).toBeInTheDocument();

    // Under the records, a rule between.
    const records: HTMLElement = screen.getByTestId(IDS.record);

    expect(
      records.compareDocumentPosition(section()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(section().className).toContain(TELEMETRY_SECTION_CLASS_NAME);
  });

  test("a value found: how many log lines and spans name it, where in them - each opening its explorer on exactly those - and the records that sent them", async () => {
    getConnectionsMock.mockResolvedValue(answer() as never);
    getTelemetryMentionsMock.mockResolvedValue(
      mentions({ values: [attacker] }) as never,
    );

    await drawConnectedSignals();

    const value: HTMLElement = await screen.findByTestId(IDS.telemetryValue);

    expect(section()).toHaveTextContent("In your logs and traces");
    expect(section()).toHaveTextContent(
      "Where the values it names appear in your logs and traces from",
    );
    expect(value).toHaveTextContent("203.0.113.7");

    // The log lines: their count is the row's label, a dt.
    const logs: HTMLElement = within(value).getByTestId(IDS.telemetryLogs);
    const logsLabel: HTMLElement = within(logs).getByTestId(IDS.factLabel);

    expect(logsLabel.tagName).toBe("DT");
    expect(logsLabel).toHaveTextContent("In 1,284 log lines");
    // A record's fact row, in a text column of the record's own: the columns line up.
    expect(logs.className).toBe(TELEMETRY_ROW_CLASS_NAME);
    expect(TELEMETRY_ROW_CLASS_NAME).toBe(CONNECTED_FACT_ROW_CLASS_NAME);
    expect((logs.closest("dl")!.parentElement as HTMLElement).className).toBe(
      CONNECTED_RECORD_TEXT_CLASS_NAME,
    );
    // The value as it is written, and what it is.
    const name: HTMLElement = within(value).getByTestId(IDS.telemetryValueName);
    expect(name.querySelector("bdi")).toHaveTextContent("203.0.113.7");
    expect(name).toHaveTextContent("IP Address");
    /*
     * Its isolate sits in a box that reads as the page does, as a record's
     * name does: a long value that wraps keeps its lines at the page's
     * start on a right-to-left page.
     */
    expect(name.querySelector("bdi")!.parentElement!.tagName).toBe("SPAN");
    expect(name.querySelector("bdi")!.parentElement!.parentElement).toBe(name);
    // Its monospace face on the isolate itself, which "* { font-family }" would reset.
    expect(name.querySelector("bdi")).toHaveClass("font-mono");

    // Where in them: the message, then an attribute by its key, each with its count.
    const places: Array<HTMLElement> = within(logs).getAllByTestId(
      IDS.telemetryPlace,
    );

    expect(
      places.map((place: HTMLElement): string => {
        return (place.textContent || "").trim();
      }),
    ).toEqual(["In the message1,200", "client_ip84"]);
    expect(places[0]!.className).toContain(TELEMETRY_PLACE_LINK_CLASS_NAME);
    expect(places[0]).toHaveAttribute("title", "Open in Logs");

    const message: globalThis.URL = new globalThis.URL(
      href(places[0]!),
      "https://oneuptime.example",
    );

    expect(message.pathname).toBe(`${BASE}/logs`);
    expect(JSON.parse(message.searchParams.get("filters") || "[]")).toEqual([
      ["body", ["203.0.113.7"]],
    ]);
    expect(message.searchParams.get("range")).toBe("Custom");

    const attribute: globalThis.URL = new globalThis.URL(
      href(places[1]!),
      "https://oneuptime.example",
    );

    expect(JSON.parse(attribute.searchParams.get("filters") || "[]")).toEqual([
      ["attributes.client_ip", ["203.0.113.7"]],
    ]);
    // An attribute's key is the telemetry's own text, isolated.
    expect(places[1]!.querySelector("bdi")).toHaveTextContent("client_ip");

    // The records that sent them, each opening its page; the rest counted.
    const sources: Array<HTMLElement> = within(logs).getAllByTestId(
      IDS.telemetrySource,
    );

    expect(
      sources.map((source: HTMLElement): string => {
        return (source.querySelector("bdi")?.textContent || "").trim();
      }),
    ).toEqual(["checkout-api", "edge-1"]);
    expect(sources[0]).toHaveTextContent("Service");
    // How many of the lines each sent, said as lines: never a bare number.
    expect(
      within(sources[0]!).getByTestId(IDS.telemetrySourceCount),
    ).toHaveTextContent(/^1,200 lines$/);
    expect(
      within(sources[1]!).getByTestId(IDS.telemetrySourceCount),
    ).toHaveTextContent(/^80 lines$/);
    // Their list is named for a screen reader: who sent them.
    expect(sources[0]!.closest("ul")).toHaveAttribute("aria-label", "Sent by");
    expect(href(sources[0]!.querySelector("bdi")!)).toBe(
      `${BASE}/service/${SERVICE_ID}`,
    );
    expect(href(sources[1]!.querySelector("bdi")!)).toBe(
      `${BASE}/host/${HOST_ID}`,
    );
    expect(logs).toHaveTextContent("+2 more");

    // The spans: an attribute, opening the Traces explorer's search on it.
    const spans: HTMLElement = within(value).getByTestId(IDS.telemetrySpans);

    expect(within(spans).getByTestId(IDS.factLabel)).toHaveTextContent(
      "In 312 spans",
    );

    const spanPlace: HTMLElement = within(spans).getByTestId(
      IDS.telemetryPlace,
    );

    expect(spanPlace).toHaveAttribute("title", "Open in Traces");

    const traces: globalThis.URL = new globalThis.URL(
      href(spanPlace),
      "https://oneuptime.example",
    );

    expect(traces.pathname).toBe(`${BASE}/traces`);
    expect(traces.searchParams.get("search")).toBe(
      "@client.address:203.0.113.7",
    );
    expect(spans).not.toHaveTextContent("more");
    // A span's sender counts spans.
    expect(
      within(spans).getByTestId(IDS.telemetrySourceCount),
    ).toHaveTextContent(/^312 spans$/);
  });

  test("one line and one span from a sender are said in the singular", async () => {
    getConnectionsMock.mockResolvedValue(answer() as never);
    getTelemetryMentionsMock.mockResolvedValue(
      mentions({
        values: [
          {
            ...attacker,
            logs: hits({
              count: 1,
              sources: [
                {
                  kind: SecurityConnectionKind.Service,
                  id: SERVICE_ID,
                  name: "checkout-api",
                  count: 1,
                },
              ],
              sourceCount: 1,
              places: [{ key: SECURITY_TELEMETRY_MESSAGE_PLACE, count: 1 }],
            }),
            traces: hits({
              count: 1,
              sources: [
                {
                  kind: SecurityConnectionKind.Service,
                  id: SERVICE_ID,
                  name: "checkout-api",
                  count: 1,
                },
              ],
              sourceCount: 1,
              places: [{ key: "client.address", count: 1 }],
            }),
          },
        ],
      }) as never,
    );

    await drawConnectedSignals();

    const value: HTMLElement = await screen.findByTestId(IDS.telemetryValue);

    expect(
      within(within(value).getByTestId(IDS.telemetryLogs)).getByTestId(
        IDS.telemetrySourceCount,
      ),
    ).toHaveTextContent(/^1 line$/);
    expect(
      within(within(value).getByTestId(IDS.telemetrySpans)).getByTestId(
        IDS.telemetrySourceCount,
      ),
    ).toHaveTextContent(/^1 span$/);
  });

  test("a value only one signal named shows that one; the values every signal was searched for and none named follow, under their own heading", async () => {
    getConnectionsMock.mockResolvedValue(answer() as never);
    getTelemetryMentionsMock.mockResolvedValue(
      mentions({
        values: [
          quiet,
          {
            ...attacker,
            traces: hits(),
          },
        ],
      }) as never,
    );

    await drawConnectedSignals();

    const value: HTMLElement = await screen.findByTestId(IDS.telemetryValue);

    expect(screen.getAllByTestId(IDS.telemetryValue)).toHaveLength(1);
    expect(within(value).getByTestId(IDS.telemetryLogs)).toBeInTheDocument();
    expect(within(value).queryByTestId(IDS.telemetrySpans)).toBeNull();

    const notFound: HTMLElement = screen.getByTestId(IDS.telemetryNotFound);

    expect(notFound).toHaveTextContent("Not in your logs or traces");
    expect(notFound).toHaveTextContent("evil-c2.example.net");
    // After the values found, a rule between.
    expect(notFound.className).toContain("border-t");
  });

  test("a value a signal could not be searched for is never said not to be in them; the role's limits and a failed search are said, with a way to search again", async () => {
    getConnectionsMock.mockResolvedValue(answer() as never);
    getTelemetryMentionsMock.mockResolvedValue(
      mentions({
        values: [
          {
            ...quiet,
            logs: null,
          },
          {
            ...attacker,
            entityValue: "198.51.100.4",
            logs: null,
            traces: null,
          },
        ],
        unreadableSignals: [SecurityTelemetrySignal.Logs],
        failedSignals: [SecurityTelemetrySignal.Traces],
        hasMoreValues: true,
      }) as never,
    );

    await drawConnectedSignals();

    const unreadable: HTMLElement = await screen.findByTestId(
      IDS.telemetryUnreadable,
    );

    expect(unreadable).toHaveTextContent(
      "Your role cannot read Logs, so they were not searched.",
    );
    expect(screen.getByTestId(IDS.telemetryFailed)).toHaveTextContent(
      "Traces could not be searched just now.",
    );
    expect(screen.getByTestId(IDS.telemetryMoreValues)).toHaveTextContent(
      "It names more values than were searched for.",
    );
    expect(screen.queryByTestId(IDS.telemetryNotFound)).toBeNull();
    expect(screen.queryByTestId(IDS.telemetryValue)).toBeNull();

    getTelemetryMentionsMock.mockResolvedValue(
      mentions({ values: [attacker] }) as never,
    );

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId(IDS.telemetryFailed)).getByRole("button", {
          name: "Try again",
        }),
      );
    });

    // Only the search is read again, not the records.
    expect(getTelemetryMentionsMock).toHaveBeenCalledTimes(2);
    expect(getConnectionsMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId(IDS.telemetryValue)).toBeInTheDocument();
    expect(screen.queryByTestId(IDS.telemetryFailed)).toBeNull();
  });

  test("a case that names nothing searched for shows no section at all", async () => {
    getConnectionsMock.mockResolvedValue(answer() as never);

    await drawConnectedSignals();

    await screen.findByTestId(IDS.record);
    await waitFor(() => {
      expect(getTelemetryMentionsMock).toHaveBeenCalled();
    });
    // Its answer in, not even the line that said it was searching stays.
    await waitFor(() => {
      expect(screen.queryByTestId(IDS.telemetryLoading)).toBeNull();
    });
    expect(screen.queryByTestId(IDS.telemetry)).toBeNull();
    expect(document.body).not.toHaveTextContent("In your logs and traces");
  });

  test("a search that fails says why, in its own place, and can be tried again; the records stay", async () => {
    getConnectionsMock.mockResolvedValue(answer() as never);
    getTelemetryMentionsMock.mockRejectedValue(
      new Error("This query took longer than 15 seconds.") as never,
    );

    await drawConnectedSignals();

    const error: HTMLElement = await screen.findByTestId(IDS.telemetryError);

    /*
     * One line under the section's heading, said as a signal that could not
     * be searched is - then why, as the server put it, in an isolate of its
     * own - and Try again: never the app's large centred error block.
     */
    expect(error).toHaveTextContent(
      "Logs and Traces could not be searched just now. This query took longer than 15 seconds. Try again",
    );
    expect(error.className).toBe(TELEMETRY_FAILED_LINE_CLASS_NAME);
    expect(error.querySelector("bdi")).toHaveTextContent(
      "This query took longer than 15 seconds.",
    );
    expect(within(error).queryByTestId("refresh-button")).toBeNull();
    expect(section()).toHaveTextContent("In your logs and traces");
    // No window is said for a search that did not answer.
    expect(section()).not.toHaveTextContent("Where the values it names");
    expect(screen.getByTestId(IDS.record)).toBeInTheDocument();
    expect(screen.queryByTestId(IDS.error)).toBeNull();

    getTelemetryMentionsMock.mockResolvedValue(
      mentions({ values: [attacker] }) as never,
    );

    await act(async () => {
      fireEvent.click(within(error).getByRole("button", { name: "Try again" }));
    });

    expect(await screen.findByTestId(IDS.telemetryValue)).toBeInTheDocument();
    expect(screen.queryByTestId(IDS.telemetryError)).toBeNull();
  });

  test("a search the server could not explain says why once, on its one line - and a reference to give is said whole", async () => {
    getConnectionsMock.mockResolvedValue(answer() as never);
    // An answer that says nothing, as an older server or a proxy's (#6836).
    getTelemetryMentionsMock.mockRejectedValue(
      new HTTPErrorResponse(500, { message: "Server Error" }, {}) as never,
    );

    await drawConnectedSignals();

    const error: HTMLElement = await screen.findByTestId(IDS.telemetryError);

    /*
     * Why is that the server could not explain it - and only that: the line
     * already says the search did not finish, and Try again is its button.
     */
    expect(error).toHaveTextContent(
      "Logs and Traces could not be searched just now. The server ran into a problem it could not explain. Try again",
    );
    expect(error.querySelector("bdi")).toHaveTextContent(
      UnexplainedErrorWords.serverWhy,
    );
    expect(error).not.toHaveTextContent("Server Error");
    expect(error).not.toHaveTextContent("did not finish");
    expect(within(error).getAllByText(/try again/i)).toHaveLength(1);

    // A reference is something to give, so that sentence is said whole.
    getTelemetryMentionsMock.mockRejectedValue(
      new HTTPErrorResponse(
        500,
        {
          message: getUnexplainedServerErrorMessage("abcd1234"),
          reference: "abcd1234",
        },
        {},
      ) as never,
    );

    await act(async () => {
      fireEvent.click(within(error).getByRole("button", { name: "Try again" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId(IDS.telemetryError)).toHaveTextContent(
        "abcd1234",
      );
    });
    expect(screen.getByTestId(IDS.telemetryError)).toHaveTextContent(
      `Logs and Traces could not be searched just now. ${getUnexplainedServerErrorMessage("abcd1234")} Try again`,
    );
  });

  test("a search the server could not explain says why in the reader's language", async () => {
    mockReader.language = "fa";
    mockReader.words = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json",
        ),
        "utf-8",
      ),
    ) as Record<string, string>;
    getConnectionsMock.mockResolvedValue(answer() as never);
    getTelemetryMentionsMock.mockRejectedValue(
      new HTTPErrorResponse(500, { message: "Server Error" }, {}) as never,
    );

    await drawConnectedSignals();

    const error: HTMLElement = await screen.findByTestId(IDS.telemetryError);
    const why: string | undefined =
      mockReader.words[UnexplainedErrorWords.serverWhy];

    expect(why).toBeTruthy();
    expect(why).not.toBe(UnexplainedErrorWords.serverWhy);
    expect(error.querySelector("bdi")).toHaveTextContent(why as string);
  });

  test("while the search runs, one quiet line under the records says so - no heading yet - and its answer takes the line's place", async () => {
    let resolveSearch: (
      value: SecurityTelemetryMentionsJson,
    ) => void = () => {};

    getConnectionsMock.mockResolvedValue(answer() as never);
    getTelemetryMentionsMock.mockReturnValue(
      new Promise<SecurityTelemetryMentionsJson>(
        (done: (value: SecurityTelemetryMentionsJson) => void) => {
          resolveSearch = done;
        },
      ) as never,
    );

    await drawConnectedSignals();

    await screen.findByTestId(IDS.record);

    const searching: HTMLElement = screen.getByTestId(IDS.telemetryLoading);

    expect(searching).toHaveTextContent("Searching your logs and traces…");
    // Said once to a screen reader, and not a page's loader band.
    expect(searching).toHaveAttribute("role", "status");
    expect(screen.queryByTestId("component-loader")).toBeNull();
    // Under the records, a rule between, as the answer will be.
    expect(searching.parentElement!.className).toBe(
      TELEMETRY_SECTION_CLASS_NAME,
    );
    expect(
      screen.getByTestId(IDS.record).compareDocumentPosition(searching) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // No heading or section until there is something to say.
    expect(screen.queryByTestId(IDS.telemetry)).toBeNull();
    expect(document.body).not.toHaveTextContent("In your logs and traces");

    await act(async () => {
      resolveSearch(mentions({ values: [attacker] }));
    });

    expect(screen.getByTestId(IDS.telemetryValue)).toBeInTheDocument();
    expect(screen.queryByTestId(IDS.telemetryLoading)).toBeNull();
  });

  test("a search that answers nothing searched for leaves no line behind it", async () => {
    let resolveSearch: (
      value: SecurityTelemetryMentionsJson,
    ) => void = () => {};

    getConnectionsMock.mockResolvedValue(answer() as never);
    getTelemetryMentionsMock.mockReturnValue(
      new Promise<SecurityTelemetryMentionsJson>(
        (done: (value: SecurityTelemetryMentionsJson) => void) => {
          resolveSearch = done;
        },
      ) as never,
    );

    await drawConnectedSignals();

    expect(await screen.findByTestId(IDS.telemetryLoading)).toBeInTheDocument();

    await act(async () => {
      resolveSearch(mentions());
    });

    expect(screen.queryByTestId(IDS.telemetryLoading)).toBeNull();
    expect(screen.queryByTestId(IDS.telemetry)).toBeNull();
    expect(screen.getByTestId(IDS.record)).toBeInTheDocument();
  });

  test("records that fail to read take nothing from the logs and traces", async () => {
    getConnectionsMock.mockRejectedValue(
      new Error("Reading security events takes a Security role.") as never,
    );
    getTelemetryMentionsMock.mockResolvedValue(
      mentions({ values: [attacker] }) as never,
    );

    await drawConnectedSignals();

    expect(await screen.findByTestId(IDS.error)).toBeInTheDocument();
    expect(await screen.findByTestId(IDS.telemetryValue)).toBeInTheDocument();
  });

  test("the same case read again reads its logs and traces again, keeping what they show until the new answer is in", async () => {
    getConnectionsMock.mockResolvedValue(answer() as never);
    getTelemetryMentionsMock.mockResolvedValue(
      mentions({ values: [attacker] }) as never,
    );

    const rendered: ReturnType<typeof render> = await drawConnectedSignals({
      refreshToken: 1,
    });

    await screen.findByTestId(IDS.telemetryValue);

    let resolve: (value: SecurityTelemetryMentionsJson) => void = () => {};

    getTelemetryMentionsMock.mockReturnValue(
      new Promise<SecurityTelemetryMentionsJson>(
        (done: (value: SecurityTelemetryMentionsJson) => void) => {
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

    expect(getTelemetryMentionsMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId(IDS.telemetryValue)).toBeInTheDocument();

    await act(async () => {
      resolve(mentions({ values: [quiet] }));
    });

    expect(screen.queryByTestId(IDS.telemetryValue)).toBeNull();
    expect(screen.getByTestId(IDS.telemetryNotFound)).toHaveTextContent(
      "evil-c2.example.net",
    );
  });

  test("an event's Connected tab carries it too, with the event's own values and time", async () => {
    getConnectionsMock.mockResolvedValue(answer() as never);
    getTelemetryMentionsMock.mockResolvedValue(
      mentions({ values: [attacker] }) as never,
    );

    const time: Date = new Date("2026-10-25T10:00:00.000Z");

    await act(async () => {
      render(
        <MemoryRouter>
          <ConnectedSignals
            request={{
              entities: [
                { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
              ],
              time,
            }}
            requestKey="event:1"
            description={CONNECTED_SIGNALS_EVENT_DESCRIPTION}
            isEmbedded={true}
          />
        </MemoryRouter>,
      );
    });

    expect(await screen.findByTestId(IDS.telemetryValue)).toBeInTheDocument();
    expect(getTelemetryMentionsMock).toHaveBeenCalledWith({
      entities: [{ type: SecurityEntityType.IpAddress, value: "203.0.113.7" }],
      time,
    });
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
      isSearchedByLogs: false,
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
    headerLayout?: "stacked" | undefined,
  ): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter>
          <ResourceSecurityCard
            kind={kind}
            modelId={new ObjectID(id)}
            headerLayout={headerLayout}
          />
        </MemoryRouter>,
      );
    });
  }

  test("its header is stacked where its page asks - an overview's one-third side column - and the default everywhere else", async () => {
    getResourceSecurityMock.mockResolvedValue(security() as never);

    await drawCard();

    // A record's page as wide as its content: the default header.
    expect(
      within(await screen.findByTestId(IDS.resourceSecurity)).getByTestId(
        "card-header",
      ),
    ).toHaveAttribute("data-header-layout", "default");

    // A monitor's side column: stacked, news or quiet.
    for (const overrides of [
      {},
      {
        eventCount: 0,
        findingCount: 0,
        openCases: { count: 0, items: [] },
        risk: null,
        lastSeen: null,
      },
    ]) {
      cleanup();
      getResourceSecurityMock.mockResolvedValue(
        security({
          kind: SecurityConnectionKind.Monitor,
          id: MONITOR_ID,
          values: ["shop.acme.example"],
          entity: { type: SecurityEntityType.Host, value: "shop.acme.example" },
          ...overrides,
        }) as never,
      );

      await drawCard(SecurityConnectionKind.Monitor, MONITOR_ID, "stacked");

      const card: HTMLElement = await screen.findByTestId(IDS.resourceSecurity);

      expect(within(card).getByTestId("card-header")).toHaveAttribute(
        "data-header-layout",
        "stacked",
      );
      // Open in Security Events stays in the header, at its right edge.
      expect(
        within(within(card).getByTestId("card-header")).getByRole("link", {
          name: "Open in Security Events",
        }),
      ).toBeInTheDocument();
    }
  });

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
        isSearchedByLogs: true,
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

  test("a monitor's card is about what it checks, quiet or not", async () => {
    getResourceSecurityMock.mockResolvedValue(
      security({
        kind: SecurityConnectionKind.Monitor,
        id: MONITOR_ID,
        values: ["shop.acme.example"],
        entity: { type: SecurityEntityType.Host, value: "shop.acme.example" },
        eventCount: 0,
        findingCount: 0,
        openCases: { count: 0, items: [] },
        risk: null,
        lastSeen: null,
      }) as never,
    );

    await drawCard(SecurityConnectionKind.Monitor, MONITOR_ID);

    expect(await screen.findByTestId(IDS.resourceSecurity)).toHaveTextContent(
      "No security event named what it checks in the last 7 days.",
    );

    cleanup();
    getResourceSecurityMock.mockResolvedValue(
      security({
        kind: SecurityConnectionKind.Monitor,
        id: MONITOR_ID,
        values: ["shop.acme.example"],
        entity: { type: SecurityEntityType.Host, value: "shop.acme.example" },
      }) as never,
    );

    await drawCard(SecurityConnectionKind.Monitor, MONITOR_ID);

    const card: HTMLElement = await screen.findByTestId(IDS.resourceSecurity);

    expect(card).toHaveTextContent(
      "What Security Events found about what it checks in the last 7 days.",
    );
    // The events: those naming the hosts it checks.
    expect(
      decodeURIComponent(
        new globalThis.URL(
          href(within(card).getByTestId(IDS.resourceSecurityOpen)),
          "https://oneuptime.example",
        ).searchParams.get("search") || "",
      ),
    ).toBe("observable:shop.acme.example");
  });

  test("a serverless function's card, and a cloud resource searched by its logs, are about its logs", async () => {
    const FUNCTION_ID: string = "60000000-0000-4000-8000-000000000002";

    for (const kind of [
      SecurityConnectionKind.ServerlessFunction,
      SecurityConnectionKind.CloudResource,
    ]) {
      cleanup();
      getResourceSecurityMock.mockResolvedValue(
        security({
          kind,
          id: FUNCTION_ID,
          values: [],
          isSearchedByLogs: true,
          entity: null,
          openCases: null,
          risk: null,
        }) as never,
      );

      await drawCard(kind, FUNCTION_ID);

      const card: HTMLElement = await screen.findByTestId(IDS.resourceSecurity);

      expect(card).toHaveTextContent(
        "What Security Events found in its logs in the last 7 days.",
      );
      expect(
        decodeURIComponent(
          new globalThis.URL(
            href(within(card).getByTestId(IDS.resourceSecurityOpen)),
            "https://oneuptime.example",
          ).searchParams.get("search") || "",
        ),
      ).toBe(`@oneuptime.log.resource.id:${FUNCTION_ID}`);
    }
  });

  test("a cloud resource searched by its names reads as any record does", async () => {
    getResourceSecurityMock.mockResolvedValue(
      security({
        kind: SecurityConnectionKind.CloudResource,
        values: ["arn:aws:s3:::acme-prod-data"],
        entity: {
          type: SecurityEntityType.Other,
          value: "arn:aws:s3:::acme-prod-data",
        },
      }) as never,
    );

    await drawCard(SecurityConnectionKind.CloudResource);

    expect(await screen.findByTestId(IDS.resourceSecurity)).toHaveTextContent(
      "What Security Events found about it in the last 7 days.",
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
    /*
     * The number and the title each read in their own direction (an
     * isolate, IsolatedText), and the number's gap is on the element around
     * its isolate, which reads in the page's: a right-to-left page keeps the
     * number first and the gap between the two (AssetDetails.spec.ts
     * measures it in Persian).
     */
    const caseNumber: HTMLElement = within(cases).getByText("SEC-12");
    expect(caseNumber.tagName).toBe("BDI");
    expect(caseNumber).toHaveAttribute("dir", "ltr");
    expect(caseNumber.parentElement?.tagName).toBe("SPAN");
    expect(caseNumber.parentElement).toHaveClass("mr-1.5");
    expect(caseNumber).not.toHaveClass("mr-1.5");
    const caseTitle: HTMLElement = within(cases).getByText(
      "Brute force against web-1",
    );
    expect(caseTitle.tagName).toBe("BDI");
    expect(caseTitle).toHaveAttribute("dir", "ltr");
    expect(href(within(cases).getByText("Brute force against web-1"))).toBe(
      `${BASE}/security-events/cases/${CASE_ID}`,
    );
    /*
     * Open in Security Events: a real link - a middle click opens a tab -
     * to the entity's page, styled as the product's other card header links.
     */
    const open: HTMLElement = within(card).getByRole("link", {
      name: "Open in Security Events",
    });

    expect(
      within(card).queryByRole("button", { name: "Open in Security Events" }),
    ).toBeNull();
    expect(open.className).toContain(RESOURCE_SECURITY_OPEN_LINK_CLASS_NAME);
    expect(open.closest("[data-testid]")).toHaveAttribute(
      "data-testid",
      IDS.resourceSecurityOpenLink,
    );

    const openUrl: globalThis.URL = new globalThis.URL(
      href(open),
      "https://oneuptime.example",
    );

    expect(openUrl.pathname).toBe(`${BASE}/security-events/entity-risk/entity`);
    expect(openUrl.searchParams.get("value")).toBe("web-1");
  });

  test("its figures share a row by the card's own width, each saying only what is its own", async () => {
    getResourceSecurityMock.mockResolvedValue(security() as never);

    await drawCard();

    const card: HTMLElement = await screen.findByTestId(IDS.resourceSecurity);
    const bar: HTMLElement = within(card).getByRole("group", {
      name: "Security",
    });

    // Four short figures: two a row on a phone, four from 36rem of the card's width.
    expect(bar).toHaveClass(
      "[@container(min-width:16rem)]:grid-cols-2",
      "[@container(min-width:36rem)]:grid-cols-4",
    );
    expect(bar).not.toHaveClass("[@container(min-width:56rem)]:grid-cols-4");
    expect(bar.parentElement).toHaveClass("[container-type:inline-size]");

    // The card's description says the week: no tile says it again.
    expect(bar).not.toHaveTextContent("In the last 7 days");
    expect(bar).toHaveTextContent("Last seen");
    // The worst finding's pill says what it is to a screen reader and under the pointer.
    expect(within(bar).getByText("Highest severity")).toHaveClass("sr-only");
    expect(within(bar).getByTitle("Highest severity")).toHaveTextContent(
      "High",
    );

    // Not seen at all: the Events tile says nothing under its number, never the week again.
    cleanup();
    getResourceSecurityMock.mockResolvedValue(
      security({ lastSeen: null }) as never,
    );

    await drawCard();

    const quietBar: HTMLElement = within(
      await screen.findByTestId(IDS.resourceSecurity),
    ).getByRole("group", { name: "Security" });

    expect(quietBar).not.toHaveTextContent("In the last 7 days");
    expect(quietBar).not.toHaveTextContent("Last seen");
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
