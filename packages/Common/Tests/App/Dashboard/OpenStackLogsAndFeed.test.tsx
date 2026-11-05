import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import ChangeEvent from "../../../Models/AnalyticsModels/ChangeEvent";
import Log from "../../../Models/AnalyticsModels/Log";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  OPENSTACK_CLOUD_LOG_ATTRIBUTE,
  OpenStackLogAttribute,
} from "../../../Utils/OpenStack/OpenStackLogs";
import { OpenStackEventAttribute } from "../../../Utils/OpenStack/OpenStackNotifications";
import { OpenStackAuditAttribute } from "../../../Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";
import { ChangeEventAttribute } from "../../../Utils/Telemetry/ChangeEventFields";
import OpenStackLogRequestLink from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackLogRequestLink";
import OpenStackRequestTrail, {
  getOpenStackRequestRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackRequestTrail";
import {
  OpenStackPartFeed,
  OpenStackWhoChangedThis,
  hasOpenStackPartFeed,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackPartFeed";
import OpenStackPartLogs, {
  hasOpenStackPartLogs,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackPartLogs";
import OpenStackPartPage from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackPartPage";
import { getOpenStackPartRoutes } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackPartRoutes";
import { OpenStackPart } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/UseOpenStackPart";
import OpenStackCloudLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Logs";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

/*
 * What a cloud's services said, on the pages that show it, over a stand-in for the network. What
 * matters here:
 *
 *   - a failed build goes from the instance's page to its request across every service in two
 *     clicks: the Logs tab, then the request;
 *   - a line anywhere offers the request it belongs to, and a line of anything else offers nothing;
 *   - where a service could not be joined the page says so, rather than leaving it out;
 *   - what a part's Logs and Feed tabs ask for is that part's, on that cloud;
 *   - a read that fails never reads as nothing having happened.
 *
 * The logs viewer is a world of its own with tests of its own, so it stands in here as what it was
 * handed.
 */

configure({ asyncUtilTimeout: 30000 });

jest.setTimeout(120000);

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
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>) => {
        return (
          <div data-testid="logs-viewer">
            {JSON.stringify({
              id: props["id"],
              initialSortOrder: props["initialSortOrder"],
              enableRealtime: props["enableRealtime"],
              noLogsMessage: props["noLogsMessage"],
              logQuery: props["logQuery"],
            })}
          </div>
        );
      },
    };
  },
);

const CLOUD_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const CLOUD_NAME: string = "prod-east";
const PROJECT_ID: string = "0193c0de-7777-4aaa-8bbb-000000000001";
const INSTANCE: string = "5f2a3a1c-7c11-4a55-9b1e-0a7a7d3f9c11";
const HYPERVISOR: string = "compute-07.example.internal";
const REQUEST: string = "req-2d6c83a1-8d7d-4f53-a5a2-5cf0f9a5e0c1";
const OTHER_REQUEST: string = "req-a3f19c06-14e8-4a0c-9c9d-1a7b0d5a3e22";
const NOW: number = Date.now();

function logRow(values: JSONObject): Log {
  const row: Log = new Log();

  Object.assign(row, values);

  return row;
}

function lineOf(data: {
  service: string;
  rootId?: string;
  severityText?: string;
  secondsAgo: number;
  host?: string;
}): Log {
  return logRow({
    time: new Date(NOW - data.secondsAgo * 1000),
    severityText: data.severityText || "Information",
    attributes: {
      [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD_NAME,
      [OpenStackLogAttribute.Service]: data.service,
      [OpenStackLogAttribute.Host]: data.host || "controller",
      ...(data.rootId
        ? { [OpenStackLogAttribute.RequestRootId]: data.rootId }
        : {}),
    },
  } as unknown as JSONObject);
}

interface ListCall {
  model: string;
  query: JSONObject;
  limit: number;
  sort: JSONObject;
}

interface Stand {
  // Answers a read of logs by what it asks for: a request's own, or a window's.
  requestRows: Array<Log>;
  windowRows: Array<Log>;
  instanceRows: Array<Log>;
  changes: Array<ChangeEvent>;
  auditEvents: Array<SecurityEvent>;
  clouds: Array<OpenStackCloud>;
  logFailure: Error | null;
  changeFailure: Error | null;
  cloudFailure: Error | null;
  mayReadAudit: boolean;
  calls: Array<ListCall>;
  navigated: Array<string>;
}

const stand: Stand = {
  requestRows: [],
  windowRows: [],
  instanceRows: [],
  changes: [],
  auditEvents: [],
  clouds: [],
  logFailure: null,
  changeFailure: null,
  cloudFailure: null,
  mayReadAudit: true,
  calls: [],
  navigated: [],
};

function callsOf(model: string): Array<ListCall> {
  return stand.calls.filter((call: ListCall): boolean => {
    return call.model === model;
  });
}

function attributesOf(call: ListCall): JSONObject {
  return call.query["attributes"] as JSONObject;
}

function viewerProps(): {
  id: string;
  initialSortOrder?: string;
  enableRealtime?: boolean;
  noLogsMessage?: string;
  logQuery: {
    attributes: JSONObject;
    time?: { startValue: string; endValue: string };
  };
} {
  return JSON.parse(screen.getByTestId("logs-viewer").textContent || "{}");
}

function partOf(data: {
  kind: OpenStackResourceKind;
  externalId: string;
}): OpenStackPart {
  return {
    kind: data.kind,
    openStackCloudId: new ObjectID(CLOUD_ID),
    externalId: data.externalId,
    routes: getOpenStackPartRoutes(new ObjectID(CLOUD_ID)),
    isLoadingCloud: false,
    cloudError: "",
    cloudName: CLOUD_NAME,
    row: null,
    isLoadingRow: false,
    rowError: "",
    refreshToken: 0,
    retry: () => {},
  };
}

function rowOf(values: Partial<OpenStackResource>): OpenStackResource {
  const row: OpenStackResource = new OpenStackResource();

  Object.assign(row, values);

  return row;
}

const INSTANCE_PART: OpenStackPart = partOf({
  kind: OpenStackResourceKind.Instance,
  externalId: INSTANCE,
});
const INSTANCE_ROW: OpenStackResource = rowOf({
  kind: OpenStackResourceKind.Instance,
  externalId: INSTANCE,
  name: "web-1",
  hypervisorName: HYPERVISOR,
});

function renderWithRouter(element: React.ReactElement): void {
  render(<MemoryRouter>{element}</MemoryRouter>);
}

beforeEach(() => {
  stand.requestRows = [];
  stand.windowRows = [];
  stand.instanceRows = [];
  stand.changes = [];
  stand.auditEvents = [];
  stand.clouds = [];
  stand.logFailure = null;
  stand.changeFailure = null;
  stand.cloudFailure = null;
  stand.mayReadAudit = true;
  stand.calls = [];
  stand.navigated = [];

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(CLOUD_ID));
  jest.spyOn(Navigation, "navigate").mockImplementation(((to: unknown) => {
    stand.navigated.push(String(to));
  }) as unknown as typeof Navigation.navigate);
  jest.spyOn(PermissionGate, "check").mockImplementation((() => {
    return { isAllowed: stand.mayReadAudit };
  }) as unknown as typeof PermissionGate.check);

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    const cloud: OpenStackCloud = new OpenStackCloud();

    cloud.name = CLOUD_NAME;

    return cloud;
  }) as unknown as typeof ModelAPI.getItem);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (call: {
    query: JSONObject;
  }) => {
    stand.calls.push({
      model: "OpenStackCloud",
      query: call.query,
      limit: 1,
      sort: {},
    });

    if (stand.cloudFailure) {
      throw stand.cloudFailure;
    }

    return {
      data: stand.clouds,
      count: stand.clouds.length,
      skip: 0,
      limit: 1,
    };
  }) as unknown as typeof ModelAPI.getList);

  jest.spyOn(AnalyticsModelAPI, "getList").mockImplementation((async (call: {
    modelType: unknown;
    query: JSONObject;
    limit: number;
    sort: JSONObject;
  }) => {
    const attributes: JSONObject = (call.query["attributes"] ||
      {}) as JSONObject;
    let model: string = "Log";
    let data: Array<unknown> = [];

    if (call.modelType === ChangeEvent) {
      model = "ChangeEvent";
      if (stand.changeFailure) {
        throw stand.changeFailure;
      }
      data = stand.changes;
    } else if (call.modelType === SecurityEvent) {
      model = "SecurityEvent";
      data = stand.auditEvents;
    } else {
      if (stand.logFailure) {
        throw stand.logFailure;
      }
      data = attributes[OpenStackLogAttribute.RequestRootId]
        ? stand.requestRows
        : attributes[OpenStackLogAttribute.InstanceId]
          ? stand.instanceRows
          : stand.windowRows;
    }

    stand.calls.push({
      model,
      query: call.query,
      limit: call.limit,
      sort: call.sort,
    });

    return { data, count: data.length, skip: 0, limit: call.limit };
  }) as unknown as typeof AnalyticsModelAPI.getList);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a line's way to its request", () => {
  function cloudLine(attributes: JSONObject = {}): Log {
    return logRow({
      time: new Date("2026-10-30T10:00:00.000Z"),
      primaryEntityType: ServiceType.OpenStackCloud,
      primaryEntityId: CLOUD_ID,
      attributes: {
        [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD_NAME,
        [OpenStackLogAttribute.RequestRootId]: REQUEST,
        ...attributes,
      },
    } as unknown as JSONObject);
  }

  test("opens it, from the moment the line was written", () => {
    renderWithRouter(<OpenStackLogRequestLink log={cloudLine()} />);

    const link: HTMLElement = screen.getByRole("link", {
      name: `Follow request ${REQUEST} across every service`,
    });

    expect(link.getAttribute("href")).toContain(
      `/dashboard/${PROJECT_ID}/openstack/${CLOUD_ID}/logs?request=${REQUEST}`,
    );
    expect(link.getAttribute("href")).toContain(
      `at=${encodeURIComponent("2026-10-30T10:00:00.000Z")}`,
    );
    // Its own record names its cloud: nothing is asked.
    expect(callsOf("OpenStackCloud")).toHaveLength(0);
  });

  test("a pod's line names a cluster, so its cloud is found by name", async () => {
    const cloud: OpenStackCloud = new OpenStackCloud();
    cloud._id = CLOUD_ID;
    stand.clouds = [cloud];

    renderWithRouter(
      <OpenStackLogRequestLink
        log={logRow({
          time: new Date("2026-10-30T10:00:00.000Z"),
          primaryEntityType: ServiceType.KubernetesCluster,
          primaryEntityId: "0193c0de-7777-4aaa-8bbb-000000000009",
          attributes: {
            [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD_NAME,
            [OpenStackLogAttribute.RequestRootId]: REQUEST,
          },
        } as unknown as JSONObject)}
      />,
    );

    expect(
      await screen.findByTestId("openstack-log-request-link"),
    ).toHaveTextContent(REQUEST);
    expect(callsOf("OpenStackCloud")).toHaveLength(1);
    expect(callsOf("OpenStackCloud")[0]?.query).toEqual({ name: CLOUD_NAME });
  });

  test("a cloud nobody here has, or a read that fails, offers nothing rather than a dead link", async () => {
    stand.cloudFailure = new Error("nope");

    renderWithRouter(
      <OpenStackLogRequestLink
        log={logRow({
          primaryEntityType: ServiceType.KubernetesCluster,
          attributes: {
            [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD_NAME,
            [OpenStackLogAttribute.RequestRootId]: REQUEST,
          },
        } as unknown as JSONObject)}
      />,
    );

    await waitFor(() => {
      expect(callsOf("OpenStackCloud")).toHaveLength(1);
    });
    expect(screen.queryByTestId("openstack-log-request-link")).toBeNull();
  });

  test.each([
    ["no attributes at all", null],
    ["a line of anything else", { "resource.service.name": "api" }],
    [
      "a cloud's line with no request",
      { [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD_NAME },
    ],
    [
      "a request with no cloud",
      { [OpenStackLogAttribute.RequestRootId]: REQUEST },
    ],
    [
      "values that are not text",
      {
        [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: 12,
        [OpenStackLogAttribute.RequestRootId]: { a: 1 },
      },
    ],
  ])("%s offers nothing", (_what: string, attributes: JSONObject | null) => {
    renderWithRouter(
      <OpenStackLogRequestLink
        log={logRow({
          primaryEntityType: ServiceType.OpenStackCloud,
          primaryEntityId: CLOUD_ID,
          attributes,
        } as unknown as JSONObject)}
      />,
    );

    expect(screen.queryByTestId("openstack-log-request-link")).toBeNull();
    expect(callsOf("OpenStackCloud")).toHaveLength(0);
  });

  test("a request ID anyone could shape stays one query value in the address", () => {
    const route: string = getOpenStackRequestRoute({
      openStackCloudId: new ObjectID(CLOUD_ID),
      rootId: 'req-a&admin=true#"><script>',
      at: null,
    }).toString();

    expect(route).toContain(
      `request=${encodeURIComponent('req-a&admin=true#"><script>')}`,
    );
    expect(route).not.toContain("<script>");
    expect(route).not.toContain("&admin");
    expect(route).not.toContain("at=");
  });
});

describe("a request, followed across every service", () => {
  function renderTrail(at: Date | null = new Date(NOW - 60_000)): void {
    renderWithRouter(
      <OpenStackRequestTrail
        openStackCloudId={new ObjectID(CLOUD_ID)}
        cloudName={CLOUD_NAME}
        rootId={REQUEST}
        at={at}
      />,
    );
  }

  test("says who joined, in the order they first wrote, on which machines, and how much", async () => {
    stand.requestRows = [
      lineOf({ service: "nova-api", rootId: REQUEST, secondsAgo: 100 }),
      lineOf({ service: "nova-scheduler", rootId: REQUEST, secondsAgo: 90 }),
      lineOf({ service: "nova-scheduler", rootId: REQUEST, secondsAgo: 89 }),
      lineOf({
        service: "nova-compute",
        rootId: REQUEST,
        secondsAgo: 80,
        severityText: "Error",
        host: "compute-07.example.internal",
      }),
    ];
    stand.windowRows = stand.requestRows;

    renderTrail();

    const joined: HTMLElement = await screen.findByTestId(
      "openstack-request-joined",
    );
    const rows: Array<string> = Array.from(joined.querySelectorAll("li")).map(
      (item: Element): string => {
        return item.textContent || "";
      },
    );

    expect(rows[0]).toContain("nova-api");
    expect(rows[0]).toContain("controller");
    expect(rows[1]).toContain("nova-scheduler");
    expect(rows[2]).toContain("nova-compute");
    expect(rows[2]).toContain("compute-07");
    expect(rows[2]).not.toContain("example.internal");
    // The one that failed reads as failing.
    expect(joined.querySelectorAll("li")[2]?.className).toContain("text-red");
    expect(joined.querySelectorAll("li")[0]?.className).not.toContain(
      "text-red",
    );
  });

  test("names what it could not join, and says why it can't tell", async () => {
    stand.requestRows = [
      lineOf({ service: "nova-api", rootId: REQUEST, secondsAgo: 100 }),
    ];
    stand.windowRows = [
      ...stand.requestRows,
      lineOf({ service: "keystone", rootId: OTHER_REQUEST, secondsAgo: 100 }),
      lineOf({ service: "glance-api", rootId: OTHER_REQUEST, secondsAgo: 99 }),
      // A periodic task's line says nothing about whether it was called.
      lineOf({ service: "cinder-volume", secondsAgo: 100 }),
    ];

    renderTrail();

    const note: HTMLElement = await screen.findByTestId(
      "openstack-request-not-joined",
    );

    expect(note).toHaveTextContent("glance-api, keystone");
    expect(note).toHaveTextContent(
      "A service only joins when its caller sends a global request ID",
    );
    expect(note).not.toHaveTextContent("cinder-volume");
  });

  test("says so when nothing else was writing about a request", async () => {
    stand.requestRows = [
      lineOf({ service: "nova-api", rootId: REQUEST, secondsAgo: 100 }),
    ];
    stand.windowRows = stand.requestRows;

    renderTrail();

    expect(
      await screen.findByText(
        "No other service was writing about a request at the same moments.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("openstack-request-not-joined")).toBeNull();
  });

  test("asks for this request's lines on this cloud, then for what the cloud wrote around them", async () => {
    stand.requestRows = [
      lineOf({ service: "nova-api", rootId: REQUEST, secondsAgo: 100 }),
      lineOf({ service: "nova-api", rootId: REQUEST, secondsAgo: 50 }),
    ];
    stand.windowRows = stand.requestRows;

    const at: Date = new Date(NOW - 60_000);

    renderTrail(at);

    await screen.findByTestId("openstack-request-joined");

    const reads: Array<ListCall> = callsOf("Log");

    // Exactly two: its own lines, and the moments around them.
    expect(reads).toHaveLength(2);
    expect(attributesOf(reads[0]!)).toEqual({
      [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD_NAME,
      [OpenStackLogAttribute.RequestRootId]: REQUEST,
    });
    expect(reads[0]?.sort).toEqual({ time: SortOrder.Ascending });

    const around: InBetween<Date> = reads[0]?.query[
      "time"
    ] as unknown as InBetween<Date>;

    // Longer than any build takes, either side of the line it was opened from.
    expect(new Date(around.startValue).getTime()).toBe(
      at.getTime() - 6 * 60 * 60 * 1000,
    );
    expect(new Date(around.endValue).getTime()).toBe(
      at.getTime() + 6 * 60 * 60 * 1000,
    );

    expect(attributesOf(reads[1]!)).toEqual({
      [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD_NAME,
    });

    const moments: InBetween<Date> = reads[1]?.query[
      "time"
    ] as unknown as InBetween<Date>;

    expect(new Date(moments.startValue).getTime()).toBe(NOW - 100_000 - 30_000);
    expect(new Date(moments.endValue).getTime()).toBe(NOW - 50_000 + 30_000);
  });

  test("no line of it found asks nothing more, and says nothing wrong", async () => {
    renderTrail();

    await waitFor(() => {
      expect(callsOf("Log")).toHaveLength(1);
    });
    await screen.findByTestId("openstack-request-joined");
    expect(callsOf("Log")).toHaveLength(1);
  });

  test("hands the viewer this request, oldest line first", async () => {
    renderTrail();

    const props: ReturnType<typeof viewerProps> = viewerProps();

    expect(props.initialSortOrder).toBe(SortOrder.Ascending);
    expect(props.logQuery.attributes).toEqual({
      [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD_NAME,
      [OpenStackLogAttribute.RequestRootId]: REQUEST,
    });
    expect(props.logQuery.time).toBeDefined();
    expect(props.noLogsMessage).toContain("this request's ID");

    await screen.findByTestId("openstack-request-joined");
  });

  test("with no moment to go from, it looks back from now", async () => {
    renderTrail(null);

    await screen.findByTestId("openstack-request-joined");

    const around: InBetween<Date> = callsOf("Log")[0]?.query[
      "time"
    ] as unknown as InBetween<Date>;

    expect(
      new Date(around.endValue).getTime() -
        new Date(around.startValue).getTime(),
    ).toBe(6 * 60 * 60 * 1000);
  });

  test("a read that fails says so, and is not mistaken for nobody having written", async () => {
    stand.logFailure = new Error("The server is not available");

    renderTrail();

    expect(
      await screen.findByText("The server is not available"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("openstack-request-joined")).toBeNull();
  });

  test("goes back to all of the cloud's logs", async () => {
    renderTrail();

    const back: HTMLElement = screen.getByRole("link", {
      name: "Back to all of this cloud's logs",
    });

    expect(back.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/openstack/${CLOUD_ID}/logs`,
    );

    await screen.findByTestId("openstack-request-joined");
  });
});

describe("the cloud's Logs page", () => {
  const PROPS: PageComponentProps = {} as unknown as PageComponentProps;

  function renderPage(search: string): void {
    window.history.pushState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/openstack/${CLOUD_ID}/logs${search}`,
    );
    renderWithRouter(<OpenStackCloudLogs {...PROPS} />);
  }

  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  test("with a request in its address, follows that request", async () => {
    renderPage(
      `?request=${REQUEST}&at=${encodeURIComponent("2026-10-30T10:00:00.000Z")}`,
    );

    expect(
      await screen.findByTestId("openstack-request-trail"),
    ).toBeInTheDocument();
    expect(viewerProps().logQuery.attributes).toEqual({
      [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD_NAME,
      [OpenStackLogAttribute.RequestRootId]: REQUEST,
    });

    await screen.findByTestId("openstack-request-joined");

    const around: InBetween<Date> = callsOf("Log")[0]?.query[
      "time"
    ] as unknown as InBetween<Date>;

    expect(new Date(around.startValue).toISOString()).toBe(
      "2026-10-30T04:00:00.000Z",
    );
  });

  test("a time it can't read is no time, and it still follows the request", async () => {
    renderPage(`?request=${REQUEST}&at=not-a-time`);

    expect(
      await screen.findByTestId("openstack-request-trail"),
    ).toBeInTheDocument();
  });

  test("a request ID shaped to be HTML is shown as text", async () => {
    const hostile: string = "<img src=x onerror=alert(1)>";

    renderPage(`?request=${encodeURIComponent(hostile)}`);

    await screen.findByTestId("openstack-request-trail");

    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(
      screen.getByText(`Following request ${hostile}`),
    ).toBeInTheDocument();
  });

  test("with none, shows the cloud's every log, live", async () => {
    renderPage("");

    await screen.findByTestId("logs-viewer");

    expect(screen.queryByTestId("openstack-request-trail")).toBeNull();
    expect(viewerProps().logQuery.attributes).toEqual({
      [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD_NAME,
    });
    expect(viewerProps().enableRealtime).toBe(true);
  });
});

describe("a part's Logs tab", () => {
  test("an instance's asks for what names its UUID on this cloud", async () => {
    renderWithRouter(
      <OpenStackPartLogs part={INSTANCE_PART} row={INSTANCE_ROW} />,
    );

    expect(viewerProps().logQuery.attributes).toEqual({
      [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD_NAME,
      [OpenStackLogAttribute.InstanceId]: INSTANCE,
    });
    expect(viewerProps().noLogsMessage).toContain("logs profile");

    await waitFor(() => {
      expect(callsOf("Log")).toHaveLength(1);
    });
  });

  test("a hypervisor's asks for what came from it, by the name its lines use", () => {
    const part: OpenStackPart = partOf({
      kind: OpenStackResourceKind.Hypervisor,
      externalId: `RegionOne/${HYPERVISOR}`,
    });

    renderWithRouter(
      <OpenStackPartLogs
        part={part}
        row={rowOf({
          kind: OpenStackResourceKind.Hypervisor,
          name: HYPERVISOR,
          hypervisorName: HYPERVISOR,
        })}
      />,
    );

    expect(viewerProps().logQuery.attributes).toEqual({
      [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD_NAME,
      [OpenStackLogAttribute.Host]: "compute-07",
    });
    // Only an instance's starts with its requests.
    expect(callsOf("Log")).toHaveLength(0);
  });

  test("a service's asks for its own lines, on its own machine", () => {
    const part: OpenStackPart = partOf({
      kind: OpenStackResourceKind.Service,
      externalId: "RegionOne/compute/compute-07/nova-compute",
    });

    renderWithRouter(
      <OpenStackPartLogs
        part={part}
        row={rowOf({
          kind: OpenStackResourceKind.Service,
          name: "nova-compute",
          facts: { host: "compute-07" } as unknown as JSONObject,
        })}
      />,
    );

    expect(viewerProps().logQuery.attributes).toEqual({
      [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD_NAME,
      [OpenStackLogAttribute.Service]: "nova-compute",
      [OpenStackLogAttribute.Host]: "compute-07",
    });
  });

  test("a kind no line can be about has no tab", () => {
    const part: OpenStackPart = partOf({
      kind: OpenStackResourceKind.Flavor,
      externalId: "RegionOne/1",
    });
    const row: OpenStackResource = rowOf({
      kind: OpenStackResourceKind.Flavor,
      name: "m1.tiny",
    });

    expect(hasOpenStackPartLogs(part, row)).toBe(false);
    expect(hasOpenStackPartLogs(INSTANCE_PART, INSTANCE_ROW)).toBe(true);
  });

  describe("an instance's requests", () => {
    test("name the ones that failed first, then the newest, each opening that request", async () => {
      stand.instanceRows = [
        lineOf({ service: "nova-api", rootId: OTHER_REQUEST, secondsAgo: 10 }),
        lineOf({
          service: "nova-compute",
          rootId: REQUEST,
          secondsAgo: 500,
          severityText: "Error",
        }),
        lineOf({ service: "nova-scheduler", rootId: REQUEST, secondsAgo: 600 }),
      ];

      renderWithRouter(
        <OpenStackPartLogs part={INSTANCE_PART} row={INSTANCE_ROW} />,
      );

      const list: HTMLElement = await screen.findByTestId(
        "openstack-instance-requests",
      );
      const rows: NodeListOf<HTMLLIElement> = list.querySelectorAll("li");

      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent(REQUEST);
      expect(rows[0]).toHaveTextContent("nova-compute, nova-scheduler");
      expect(rows[0]).toHaveTextContent("Failed");
      expect(rows[1]).toHaveTextContent(OTHER_REQUEST);
      expect(rows[1]).not.toHaveTextContent("Failed");

      const link: HTMLAnchorElement = rows[0]!.querySelector(
        "a",
      ) as HTMLAnchorElement;

      expect(link.getAttribute("href")).toContain(`request=${REQUEST}`);
      expect(link.getAttribute("href")).toContain("at=");
    });

    test("ask once, for this instance on this cloud, over the week", async () => {
      stand.instanceRows = [
        lineOf({ service: "nova-api", rootId: REQUEST, secondsAgo: 10 }),
      ];

      renderWithRouter(
        <OpenStackPartLogs part={INSTANCE_PART} row={INSTANCE_ROW} />,
      );

      await screen.findByTestId("openstack-instance-requests");

      const reads: Array<ListCall> = callsOf("Log");

      expect(reads).toHaveLength(1);
      expect(attributesOf(reads[0]!)).toEqual({
        [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD_NAME,
        [OpenStackLogAttribute.InstanceId]: INSTANCE,
      });
      expect(reads[0]?.limit).toBe(500);
      expect(reads[0]?.sort).toEqual({ time: SortOrder.Descending });
    });

    test("lines with no request leave no card", async () => {
      stand.instanceRows = [lineOf({ service: "nova-api", secondsAgo: 10 })];

      renderWithRouter(
        <OpenStackPartLogs part={INSTANCE_PART} row={INSTANCE_ROW} />,
      );

      await waitFor(() => {
        expect(callsOf("Log")).toHaveLength(1);
      });
      expect(screen.queryByTestId("openstack-instance-requests")).toBeNull();
      expect(screen.getByTestId("logs-viewer")).toBeInTheDocument();
    });

    test("a read that fails leaves the lines below it", async () => {
      stand.logFailure = new Error("nope");

      renderWithRouter(
        <OpenStackPartLogs part={INSTANCE_PART} row={INSTANCE_ROW} />,
      );

      await waitFor(() => {
        expect(screen.queryByTestId("openstack-instance-requests")).toBeNull();
      });
      expect(screen.getByTestId("logs-viewer")).toBeInTheDocument();
    });
  });
});

describe("from an instance's page to its scheduler line", () => {
  /*
   * The first half of the walk that #5737 is done by: the whole page, its tabs and all. The Logs
   * page it lands on is the suite above. packages/E2E/OpenStackPages walks it in a browser.
   */
  test("takes two clicks: the Logs tab, and the request that failed", async () => {
    stand.instanceRows = [
      lineOf({
        service: "nova-conductor",
        rootId: REQUEST,
        severityText: "Error",
        secondsAgo: 30,
      }),
      lineOf({ service: "nova-scheduler", rootId: REQUEST, secondsAgo: 31 }),
      lineOf({ service: "nova-api", rootId: OTHER_REQUEST, secondsAgo: 2000 }),
    ];

    renderWithRouter(
      <OpenStackPartPage
        part={{ ...INSTANCE_PART, row: INSTANCE_ROW }}
        overview={() => {
          return <p>Overview of the instance</p>;
        }}
      />,
    );

    expect(screen.getByText("Overview of the instance")).toBeInTheDocument();
    expect(screen.queryByTestId("openstack-instance-requests")).toBeNull();

    // One.
    fireEvent.click(screen.getByRole("tab", { name: "Logs" }));

    const list: HTMLElement = await screen.findByTestId(
      "openstack-instance-requests",
    );
    const failed: HTMLLIElement = list.querySelector("li") as HTMLLIElement;

    expect(failed).toHaveTextContent("Failed");
    expect(failed).toHaveTextContent("nova-scheduler");

    // Two.
    const request: HTMLAnchorElement = failed.querySelector(
      "a",
    ) as HTMLAnchorElement;

    expect(request.getAttribute("href")).toContain(
      `/dashboard/${PROJECT_ID}/openstack/${CLOUD_ID}/logs?request=${REQUEST}`,
    );
  });

  test("the page has its Logs tab only when a row says what lines would be its", () => {
    renderWithRouter(
      <OpenStackPartPage
        part={INSTANCE_PART}
        overview={() => {
          return <p>Overview of the instance</p>;
        }}
      />,
    );

    expect(screen.queryByRole("tab", { name: "Logs" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Feed" })).toBeNull();
  });
});

describe("a part's Feed", () => {
  function changeOf(values: JSONObject): ChangeEvent {
    const row: ChangeEvent = new ChangeEvent();

    Object.assign(row, values);

    return row;
  }

  test("says what its cloud said happened to it, who did it, and marks what failed", async () => {
    stand.changes = [
      changeOf({
        _id: "c1",
        time: new Date("2026-10-30T10:00:05.000Z"),
        title: "Instance web-1: create failed: Flavor's disk is too small",
        attributes: {
          [OpenStackEventAttribute.Outcome]: "failed",
          [ChangeEventAttribute.CloudActor]: "the-actor",
        },
      } as unknown as JSONObject),
      changeOf({
        _id: "c2",
        time: new Date("2026-10-30T09:00:00.000Z"),
        title: "Instance web-1: rebooted",
        attributes: { [OpenStackEventAttribute.Outcome]: "succeeded" },
      } as unknown as JSONObject),
    ];

    renderWithRouter(
      <OpenStackPartFeed part={INSTANCE_PART} row={INSTANCE_ROW} />,
    );

    const failed: HTMLElement = await screen.findByText(
      "Instance web-1: create failed: Flavor's disk is too small",
    );

    expect(failed.closest("div")?.className).toContain("text-red");
    expect(screen.getByText("the-actor")).toBeInTheDocument();
    expect(
      screen.getByText("Instance web-1: rebooted").closest("div")?.className,
    ).not.toContain("text-red");
  });

  test("asks once, for this part on this cloud, newest first", async () => {
    renderWithRouter(
      <OpenStackPartFeed part={INSTANCE_PART} row={INSTANCE_ROW} />,
    );

    await screen.findByText("Nothing has been said about this yet.");

    const reads: Array<ListCall> = callsOf("ChangeEvent");

    expect(reads).toHaveLength(1);
    expect(attributesOf(reads[0]!)).toEqual({
      [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD_NAME,
      [ChangeEventAttribute.CloudResourceId]: INSTANCE,
    });
    expect(reads[0]?.sort).toEqual({ time: SortOrder.Descending });
  });

  test("a hypervisor's is everything that happened on the machine", async () => {
    const part: OpenStackPart = partOf({
      kind: OpenStackResourceKind.Hypervisor,
      externalId: `RegionOne/${HYPERVISOR}`,
    });

    renderWithRouter(
      <OpenStackPartFeed
        part={part}
        row={rowOf({
          kind: OpenStackResourceKind.Hypervisor,
          name: HYPERVISOR,
          hypervisorName: HYPERVISOR,
        })}
      />,
    );

    await screen.findByText("Nothing has been said about this yet.");

    expect(attributesOf(callsOf("ChangeEvent")[0]!)).toEqual({
      [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD_NAME,
      "openstack.host": "compute-07",
    });
  });

  test("a read that fails says so, and is not mistaken for nothing having happened", async () => {
    stand.changeFailure = new Error("nope");

    renderWithRouter(
      <OpenStackPartFeed part={INSTANCE_PART} row={INSTANCE_ROW} />,
    );

    expect(
      await screen.findByText("The feed could not be read."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Nothing has been said about this yet."),
    ).toBeNull();
  });

  test("a title anyone could write is text", async () => {
    stand.changes = [
      changeOf({
        _id: "c1",
        time: new Date(),
        title: "Instance <img src=x onerror=alert(1)>: created",
        attributes: {},
      } as unknown as JSONObject),
    ];

    renderWithRouter(
      <OpenStackPartFeed part={INSTANCE_PART} row={INSTANCE_ROW} />,
    );

    expect(
      await screen.findByText("Instance <img src=x onerror=alert(1)>: created"),
    ).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });

  test("a kind with no notifications of its own has no tab", () => {
    expect(
      hasOpenStackPartFeed(
        partOf({
          kind: OpenStackResourceKind.Flavor,
          externalId: "RegionOne/1",
        }),
        rowOf({ kind: OpenStackResourceKind.Flavor, name: "m1.tiny" }),
      ),
    ).toBe(false);
    expect(hasOpenStackPartFeed(INSTANCE_PART, INSTANCE_ROW)).toBe(true);
  });
});

describe("who changed a part", () => {
  const CHANGED: Date = new Date("2026-10-30T10:00:00.000Z");
  const CHANGED_ROW: OpenStackResource = rowOf({
    ...INSTANCE_ROW,
    kind: OpenStackResourceKind.Instance,
    externalId: INSTANCE,
    name: "web-1",
    stateChangedAt: CHANGED,
  });

  function securityEvent(values: JSONObject): SecurityEvent {
    const row: SecurityEvent = new SecurityEvent();

    Object.assign(row, values);

    return row;
  }

  function changeOf(values: JSONObject): ChangeEvent {
    const row: ChangeEvent = new ChangeEvent();

    Object.assign(row, values);

    return row;
  }

  test("reads its audit trail around the moment its state changed", async () => {
    stand.auditEvents = [
      securityEvent({
        _id: "a1",
        time: CHANGED,
        principalUser: "an-admin",
        statusName: "Failure",
        attributes: { [OpenStackAuditAttribute.Action]: "update/stop" },
      } as unknown as JSONObject),
    ];

    renderWithRouter(
      <OpenStackWhoChangedThis part={INSTANCE_PART} row={CHANGED_ROW} />,
    );

    const list: HTMLElement = await screen.findByTestId(
      "openstack-who-changed-this",
    );

    expect(list).toHaveTextContent("an-admin");
    expect(list).toHaveTextContent("update/stop");
    expect(list).toHaveTextContent("Failed");

    const read: ListCall = callsOf("SecurityEvent")[0] as ListCall;
    const around: InBetween<Date> = read.query[
      "time"
    ] as unknown as InBetween<Date>;

    expect(attributesOf(read)).toEqual({
      [OpenStackAuditAttribute.Cloud]: CLOUD_NAME,
      [OpenStackAuditAttribute.TargetId]: INSTANCE,
    });
    expect(new Date(around.startValue).getTime()).toBe(
      CHANGED.getTime() - 15 * 60 * 1000,
    );
    expect(new Date(around.endValue).getTime()).toBe(
      CHANGED.getTime() + 5 * 60 * 1000,
    );
    // It found someone, so there is nothing more to ask.
    expect(callsOf("ChangeEvent")).toHaveLength(0);
  });

  test("with no audit trail, a notification's own actor still says who", async () => {
    stand.changes = [
      changeOf({
        _id: "c1",
        time: CHANGED,
        title: "Instance web-1: stopped",
        attributes: { [ChangeEventAttribute.CloudActor]: "the-actor" },
      } as unknown as JSONObject),
      changeOf({
        _id: "c2",
        time: CHANGED,
        title: "Instance web-1: updated",
        attributes: {},
      } as unknown as JSONObject),
    ];

    renderWithRouter(
      <OpenStackWhoChangedThis part={INSTANCE_PART} row={CHANGED_ROW} />,
    );

    const list: HTMLElement = await screen.findByTestId(
      "openstack-who-changed-this",
    );

    expect(list).toHaveTextContent("the-actor");
    expect(list).toHaveTextContent("Instance web-1: stopped");
    expect(list).not.toHaveTextContent("Instance web-1: updated");
  });

  test("someone who may not read Security Events isn't asked to", async () => {
    stand.mayReadAudit = false;

    renderWithRouter(
      <OpenStackWhoChangedThis part={INSTANCE_PART} row={CHANGED_ROW} />,
    );

    await waitFor(() => {
      expect(callsOf("ChangeEvent")).toHaveLength(1);
    });
    expect(callsOf("SecurityEvent")).toHaveLength(0);
  });

  test("nobody to name, no card", async () => {
    renderWithRouter(
      <OpenStackWhoChangedThis part={INSTANCE_PART} row={CHANGED_ROW} />,
    );

    await waitFor(() => {
      expect(callsOf("ChangeEvent")).toHaveLength(1);
    });
    expect(screen.queryByTestId("openstack-who-changed-this")).toBeNull();
  });

  test("a part whose state never changed asks nothing", async () => {
    renderWithRouter(
      <OpenStackWhoChangedThis part={INSTANCE_PART} row={INSTANCE_ROW} />,
    );

    await Promise.resolve();

    expect(callsOf("SecurityEvent")).toHaveLength(0);
    expect(callsOf("ChangeEvent")).toHaveLength(0);
  });
});
