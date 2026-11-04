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
import Span from "../../../Models/AnalyticsModels/Span";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import { TraceSpanType } from "../../../Types/Telemetry/TraceSpanType";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  OSPROFILER_DRIVER_SCOPE_NAME,
  OSPROFILER_SCOPE_SPAN_ATTRIBUTE,
} from "../../../Utils/OpenStack/OpenStackTraces";
import {
  keyForOpenStackCloud,
  keyForOpenStackResource,
} from "../../../Utils/Telemetry/EntityKey";
import OpenStackPartTraces, {
  getOpenStackPartTracedService,
  hasOpenStackPartTraces,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackPartTraces";
import { getOpenStackPartRoutes } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackPartRoutes";
import { OpenStackPart } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/UseOpenStackPart";
import OpenStackTraceContextCard from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Traces/OpenStackTraceContextCard";
import OpenStackCloudTraces from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Traces";
import { findOpenStackServiceRow } from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackTraceContext";

/*
 * A cloud's Traces page, over a stand-in for the network, and the two places a trace meets the
 * rest of the product: the card above it and a part's Traces tab. What matters here:
 *
 *   - with OSProfiler off nothing breaks, and the page explains how to turn it on;
 *   - a read that failed is never mistaken for that, because it would send someone to change
 *     a config that is fine;
 *   - a trace is tied to the instance it made, in both directions.
 *
 * The traces list, the map's canvas and the guide's key picker are each a world of their own
 * with tests of their own, so they stand in here as what they were handed.
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>) => {
        return (
          <div data-testid="traces-viewer">{JSON.stringify(props)}</div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceServiceMap",
  () => {
    return {
      __esModule: true,
      default: (props: {
        spans: Array<{ spanId?: string }>;
        telemetryServices: Array<{ name?: string }>;
        caption?: string;
        onSpanSelect?: (spanId: string) => void;
      }) => {
        return (
          <div data-testid="trace-service-map">
            <span data-testid="map-services">
              {props.telemetryServices
                .map((service: { name?: string }) => {
                  return service.name;
                })
                .join(",")}
            </span>
            <span data-testid="map-span-count">{props.spans.length}</span>
            <button
              data-testid="map-select"
              onClick={() => {
                props.onSpanSelect?.(props.spans[0]?.spanId || "");
              }}
            >
              select
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuideCard",
  () => {
    return {
      __esModule: true,
      default: (props: {
        title: string;
        getContent: (context: Record<string, unknown>) => {
          steps: Array<{ title: string }>;
        };
      }) => {
        const content: { steps: Array<{ title: string }> } = props.getContent({
          oneuptimeUrl: "https://oneuptime.example.com",
          apiKey: "<YOUR_API_KEY>",
          hasApiKey: false,
          option: "not-sure",
        });

        return (
          <div data-testid="setup-guide">
            <h2>{props.title}</h2>
            {content.steps.map((step: { title: string }) => {
              return <p key={step.title}>{step.title}</p>;
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
const TRACE: string = "4e3e0ec6293840b1850409eb1d4b0dee";

function resource(values: Partial<OpenStackResource>): OpenStackResource {
  const row: OpenStackResource = new OpenStackResource();

  Object.assign(row, values);

  return row;
}

function span(values: JSONObject): Span {
  const row: Span = new Span();

  Object.assign(row, values);

  return row;
}

type ListQuery = {
  modelType: { name: string };
  query: JSONObject;
};

interface Stand {
  spans: Array<Span>;
  spanError?: Error | undefined;
  resources: Array<OpenStackResource>;
  logs: Array<unknown>;
  navigated: Array<string>;
}

const stand: Stand = {
  spans: [],
  resources: [],
  logs: [],
  navigated: [],
};

function kindsOf(query: JSONObject): Array<string> {
  const kind: unknown = query["kind"];

  if (kind && typeof kind === "object" && "values" in kind) {
    return (kind as { values: Array<string> }).values;
  }

  return kind ? [String(kind)] : [];
}

beforeEach(() => {
  stand.spans = [];
  stand.spanError = undefined;
  stand.resources = [];
  stand.logs = [];
  stand.navigated = [];

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(CLOUD_ID));
  jest.spyOn(Navigation, "navigate").mockImplementation(((to: Route) => {
    stand.navigated.push(to.toString());
  }) as unknown as typeof Navigation.navigate);

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    const cloud: OpenStackCloud = new OpenStackCloud();

    cloud.name = CLOUD_NAME;

    return cloud;
  }) as unknown as typeof ModelAPI.getItem);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (
    call: ListQuery,
  ) => {
    if (call.modelType === (OpenStackCloud as unknown)) {
      const cloud: OpenStackCloud = new OpenStackCloud();

      cloud._id = CLOUD_ID;
      cloud.name = CLOUD_NAME;

      return { data: [cloud], count: 1, skip: 0, limit: 1 };
    }

    if (call.modelType === (OpenStackResource as unknown)) {
      const kinds: Array<string> = kindsOf(call.query);
      const ids: unknown = call.query["externalId"];
      const data: Array<OpenStackResource> = stand.resources.filter(
        (row: OpenStackResource): boolean => {
          if (kinds.length > 0 && !kinds.includes(row.kind || "")) {
            return false;
          }

          return !(
            ids &&
            typeof ids === "object" &&
            "values" in ids &&
            !(ids as { values: Array<string> }).values.includes(
              row.externalId || "",
            )
          );
        },
      );

      return { data, count: data.length, skip: 0, limit: 200 };
    }

    return { data: [], count: 0, skip: 0, limit: 10 };
  }) as unknown as typeof ModelAPI.getList);

  jest.spyOn(AnalyticsModelAPI, "getList").mockImplementation((async (
    call: ListQuery,
  ) => {
    if (call.modelType === (Span as unknown)) {
      if (stand.spanError) {
        throw stand.spanError;
      }

      return {
        data: stand.spans,
        count: stand.spans.length,
        skip: 0,
        limit: 500,
      };
    }

    return {
      data: stand.logs,
      count: stand.logs.length,
      skip: 0,
      limit: 1000,
    };
  }) as unknown as typeof AnalyticsModelAPI.getList);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderPage(): void {
  render(
    <MemoryRouter>
      <OpenStackCloudTraces
        {...({
          pageRoute: new Route("/"),
        } as unknown as React.ComponentProps<typeof OpenStackCloudTraces>)}
      />
    </MemoryRouter>,
  );
}

function tracedSpan(values: JSONObject = {}): Span {
  return span({
    startTime: "2026-11-04T10:00:00.000Z",
    traceId: TRACE,
    attributes: {
      "openstack.service": "nova-api",
      "resource.openstack.cloud.name": CLOUD_NAME,
    },
    ...values,
  });
}

describe("with OSProfiler off, which is how every cloud starts", () => {
  test("nothing breaks, and the page explains how to turn it on", async () => {
    renderPage();

    expect(
      await screen.findByTestId("openstack-traces-off"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("openstack-traces-off-notice"),
    ).toHaveTextContent("nothing depends on them");
    expect(screen.getByText("Turn on traces")).toBeInTheDocument();
    expect(screen.getByText("Turn OSProfiler on")).toBeInTheDocument();
    expect(
      screen.getByText("Give each service the libraries"),
    ).toBeInTheDocument();
  });

  test("it says it is experimental and that OpenStack gives no figure, rather than promising one", async () => {
    renderPage();

    const notice: HTMLElement = await screen.findByTestId(
      "openstack-traces-off-notice",
    );

    expect(notice).toHaveTextContent("marked experimental");
    expect(notice).toHaveTextContent("OpenStack gives no figure");
  });

  test("it does not draw a list and a map of nothing", async () => {
    renderPage();

    await screen.findByTestId("openstack-traces-off");

    expect(screen.queryByTestId("traces-viewer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("trace-service-map")).not.toBeInTheDocument();
  });

  test("it still gives the command, so turning it on can be checked from here", async () => {
    renderPage();

    await screen.findByTestId("openstack-traces-off");

    expect(screen.getByTestId("openstack-trace-a-request")).toBeInTheDocument();
  });
});

describe("a read that failed", () => {
  test("is said to be that, and never that tracing is off", async () => {
    stand.spanError = new Error("Server is not available");

    renderPage();

    expect(
      await screen.findByTestId("openstack-traces-read-failed"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("openstack-traces-off")).not.toBeInTheDocument();
    expect(screen.queryByText("Turn on traces")).not.toBeInTheDocument();
  });
});

describe("with traces", () => {
  test("it says what has been traced, and what has not, without calling that a fault", async () => {
    stand.spans = [tracedSpan()];
    stand.resources = [
      resource({ kind: OpenStackResourceKind.Api, name: "compute" }),
      resource({
        kind: OpenStackResourceKind.Service,
        name: "cinder-volume",
        facts: { family: "volume" },
      }),
      resource({
        kind: OpenStackResourceKind.Service,
        name: "neutron-ovn-metadata-agent",
        facts: { family: "network" },
      }),
    ];

    renderPage();

    expect(
      await screen.findByTestId("openstack-traces-services-seen"),
    ).toHaveTextContent("nova-api");

    const notSeen: HTMLElement = await screen.findByTestId(
      "openstack-traces-services-not-seen",
    );

    expect(notSeen).toHaveTextContent("cinder-volume");
    // nova-api is what the compute API's row means to a trace, and it was seen.
    expect(notSeen).not.toHaveTextContent("nova-api");
    // No request is signed through a Neutron agent.
    expect(notSeen).not.toHaveTextContent("neutron-ovn-metadata-agent");
    expect(
      screen.getByTestId("openstack-traces-status"),
    ).toHaveTextContent("no fault");
  });

  test("its list is the cloud's, by the same key a host's or a cluster's page uses", async () => {
    stand.spans = [tracedSpan()];

    renderPage();

    const viewer: HTMLElement = await screen.findByTestId("traces-viewer");
    const props: JSONObject = JSON.parse(viewer.textContent || "{}");

    expect(props["attributeFilters"]).toEqual({
      "resource.openstack.cloud.name": CLOUD_NAME,
    });
    expect((props["entityScope"] as JSONObject)["entityKeys"]).toEqual([
      keyForOpenStackCloud(PROJECT_ID, CLOUD_NAME),
    ]);
  });

  test("its map names services without the cloud the page is already about", async () => {
    stand.spans = [tracedSpan({ spanId: "1c089ea828fe4f3d" })];

    jest.spyOn(ModelAPI, "getList").mockImplementation((async (
      call: ListQuery,
    ) => {
      const service: JSONObject = {
        _id: "0193c0de-7777-4aaa-8bbb-000000000099",
        name: `${CLOUD_NAME}/nova-api`,
      };
      const isService: boolean =
        (call.modelType as unknown as { name: string }).name === "Service";

      return {
        data: isService ? [Object.assign(new (call.modelType as any)(), service)] : [],
        count: 1,
        skip: 0,
        limit: 10,
      };
    }) as unknown as typeof ModelAPI.getList);

    renderPage();

    expect(await screen.findByTestId("map-services")).toHaveTextContent(
      /^nova-api$/,
    );
  });

  test("clicking the map opens the trace, at the span", async () => {
    stand.spans = [tracedSpan({ spanId: "1c089ea828fe4f3d" })];

    renderPage();

    fireEvent.click(await screen.findByTestId("map-select"));

    expect(stand.navigated).toHaveLength(1);
    expect(stand.navigated[0]).toContain(`/traces/view/${TRACE}`);
    expect(stand.navigated[0]).toContain("spanId=1c089ea828fe4f3d");
  });
});

describe("Trace a request", () => {
  async function card(): Promise<void> {
    renderPage();

    await screen.findByTestId("openstack-trace-a-request");
  }

  test("the command asks for what this cloud has", async () => {
    stand.resources = [
      resource({
        kind: OpenStackResourceKind.Flavor,
        name: "m1.tiny",
        diskCapacityBytes: 1073741824,
      }),
      resource({
        kind: OpenStackResourceKind.Image,
        name: "cirros",
        status: "active",
      }),
      resource({
        kind: OpenStackResourceKind.Network,
        name: "private",
        externalId: "net-1",
      }),
    ];

    await card();

    await waitFor(() => {
      expect(screen.getByTestId("openstack-trace-boot")).toHaveTextContent(
        "--flavor m1.tiny --image cirros --network private",
      );
    });
  });

  test("it never asks OneUptime to hold the key: the shell reads it, and keeps it out of history", async () => {
    await card();

    const key: HTMLElement = screen.getByTestId("openstack-trace-key");

    expect(key).toHaveTextContent("read -rs OS_PROFILE");
    expect(key).toHaveTextContent("keeps it out of your history");
  });

  test("the boot says it boots something real", async () => {
    await card();

    expect(screen.getByTestId("openstack-trace-boot")).toHaveTextContent(
      "boots a small real instance",
    );
    expect(screen.getByTestId("openstack-trace-boot")).toHaveTextContent(
      "server delete --wait",
    );
    expect(screen.getByTestId("openstack-trace-list")).toHaveTextContent(
      "changes nothing",
    );
  });

  test("it says how to stop signing, and what no Trace ID means", async () => {
    await card();

    expect(screen.getByTestId("openstack-trace-end")).toHaveTextContent(
      "unset OS_PROFILE",
    );
    expect(
      screen.getByTestId("openstack-trace-a-request"),
    ).toHaveTextContent("pip install osprofiler");
  });

  test("what the client printed opens that trace", async () => {
    await card();

    fireEvent.change(screen.getByTestId("openstack-trace-id"), {
      target: { value: "Trace ID: 4e3e0ec6-2938-40b1-8504-09eb1d4b0dee" },
    });
    fireEvent.click(screen.getByTestId("openstack-trace-open"));

    expect(stand.navigated).toHaveLength(1);
    expect(stand.navigated[0]).toContain(`/traces/view/${TRACE}`);
  });

  test("anything else says what to look for, and goes nowhere", async () => {
    await card();

    fireEvent.change(screen.getByTestId("openstack-trace-id"), {
      target: { value: "Short trace ID for OpenTracing-based drivers: 850409" },
    });
    fireEvent.click(screen.getByTestId("openstack-trace-open"));

    expect(stand.navigated).toEqual([]);
    expect(
      screen.getByTestId("openstack-trace-id-invalid"),
    ).toBeInTheDocument();
  });
});

describe("the card above a trace", () => {
  function renderCard(): void {
    render(
      <MemoryRouter>
        <OpenStackTraceContextCard traceId={TRACE} />
      </MemoryRouter>,
    );
  }

  test("any other trace gets nothing", async () => {
    stand.spans = [];

    const { container } = render(
      <MemoryRouter>
        <OpenStackTraceContextCard traceId={TRACE} />
      </MemoryRouter>,
    );

    // Long enough for its read to answer.
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 50);
    });

    expect(container).toBeEmptyDOMElement();
  });

  test("a failed look is no reason to say anything: the trace below does not depend on it", async () => {
    stand.spanError = new Error("Server is not available");

    const { container } = render(
      <MemoryRouter>
        <OpenStackTraceContextCard traceId={TRACE} />
      </MemoryRouter>,
    );

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 50);
    });

    expect(container).toBeEmptyDOMElement();
  });

  test("it asks for this trace's spans in the driver's scope, so a look costs one row or none", async () => {
    stand.spans = [];

    renderCard();

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 50);
    });

    const calls: Array<Array<unknown>> = (
      AnalyticsModelAPI.getList as unknown as { mock: { calls: Array<Array<unknown>> } }
    ).mock.calls;
    const query: JSONObject = (calls[0]![0] as ListQuery).query;

    expect(query["traceId"]).toBe(TRACE);
    expect(query["attributes"]).toEqual({
      [OSPROFILER_SCOPE_SPAN_ATTRIBUTE]: OSPROFILER_DRIVER_SCOPE_NAME,
    });
  });

  test("a trace is tied to the instance it made, one step from its page", async () => {
    stand.spans = [
      tracedSpan({
        attributes: {
          "openstack.service": "placement-api",
          "resource.openstack.cloud.name": CLOUD_NAME,
          "openstack.instance_id": INSTANCE,
        },
      }),
    ];
    stand.resources = [
      resource({
        kind: OpenStackResourceKind.Instance,
        externalId: INSTANCE,
        name: "my-instance",
      }),
    ];

    renderCard();

    const parts: HTMLElement = await screen.findByTestId(
      "openstack-trace-parts",
    );
    const link: HTMLElement = await screen.findByText("my-instance");

    expect(parts).toHaveTextContent("Instance");
    expect(link.closest("a")?.getAttribute("href")).toContain(
      `/openstack/${CLOUD_ID}/instances/${INSTANCE}`,
    );
  });

  test("an instance the inventory has not got yet is named, and said to be that", async () => {
    stand.spans = [
      tracedSpan({
        attributes: {
          "openstack.service": "placement-api",
          "resource.openstack.cloud.name": CLOUD_NAME,
          "openstack.instance_id": INSTANCE,
        },
      }),
    ];

    renderCard();

    const parts: HTMLElement = await screen.findByTestId(
      "openstack-trace-parts",
    );

    expect(parts).toHaveTextContent(INSTANCE);
    expect(parts).toHaveTextContent("Not in the inventory");
  });

  test("each service goes to its own page", async () => {
    stand.spans = [
      tracedSpan({
        attributes: {
          "openstack.service": "nova-api",
          "resource.openstack.cloud.name": CLOUD_NAME,
        },
      }),
    ];
    stand.resources = [
      resource({
        kind: OpenStackResourceKind.Api,
        name: "compute",
        externalId: "RegionOne/compute",
      }),
    ];

    renderCard();

    const link: HTMLElement = await screen.findByText("nova-api");

    expect(link.closest("a")?.getAttribute("href")).toContain(
      encodeURIComponent("RegionOne/compute"),
    );
  });

  test("spans with no cloud say what would join them, and link nothing", async () => {
    stand.spans = [
      tracedSpan({ attributes: { "openstack.service": "nova-api" } }),
    ];

    renderCard();

    expect(
      await screen.findByTestId("openstack-trace-no-cloud"),
    ).toHaveTextContent("agent's traces collector");
  });

  test("its requests in the logs say how sure each is, and follow the logs' own route", async () => {
    stand.spans = [
      tracedSpan({
        startTime: "2026-11-04T10:00:00.000Z",
        endTime: "2026-11-04T10:00:05.000Z",
        attributes: {
          "openstack.service": "nova-compute",
          "resource.openstack.cloud.name": CLOUD_NAME,
          "openstack.instance_id": INSTANCE,
        },
      }),
    ];
    stand.logs = [
      {
        time: "2026-11-04T10:00:02.000Z",
        body: "Spawning",
        attributes: {
          "openstack.request_root_id": "req-build",
          "openstack.service": "nova-compute",
          "openstack.instance_id": INSTANCE,
        },
      },
    ];

    renderCard();

    const requests: HTMLElement = await screen.findByTestId(
      "openstack-trace-requests",
    );

    expect(requests).toHaveTextContent(
      "No span holds a request ID and no log line holds a trace's",
    );
    expect(requests).toHaveTextContent("Its lines name an instance");

    const link: HTMLElement = await screen.findByText("req-build");

    expect(link.closest("a")?.getAttribute("href")).toContain(
      `/openstack/${CLOUD_ID}/logs`,
    );
    expect(link.closest("a")?.getAttribute("href")).toContain(
      "request=req-build",
    );
  });
});

describe("which row a traced service is", () => {
  const rows: Array<OpenStackResource> = [
    resource({
      kind: OpenStackResourceKind.Service,
      name: "nova-compute",
      externalId: "RegionOne/compute/compute-01.example.internal/nova-compute",
    }),
    resource({
      kind: OpenStackResourceKind.Service,
      name: "nova-compute",
      externalId: "RegionOne/compute/compute-02/nova-compute",
    }),
    resource({
      kind: OpenStackResourceKind.Api,
      name: "compute",
      externalId: "RegionOne/compute",
    }),
  ];

  test("a worker by its binary and host, whichever way the host is written", () => {
    expect(
      findOpenStackServiceRow({
        service: "nova-compute",
        host: "compute-02.example.internal",
        rows,
      })?.externalId,
    ).toBe("RegionOne/compute/compute-02/nova-compute");
    expect(
      findOpenStackServiceRow({
        service: "nova-compute",
        host: "compute-01",
        rows,
      })?.externalId,
    ).toBe("RegionOne/compute/compute-01.example.internal/nova-compute");
  });

  test("an API by the type its row is named for", () => {
    expect(
      findOpenStackServiceRow({ service: "nova-api", host: "any", rows })
        ?.externalId,
    ).toBe("RegionOne/compute");
  });

  test("a service this cloud does not list is nobody's row", () => {
    expect(
      findOpenStackServiceRow({ service: "heat-engine", host: "h", rows }),
    ).toBeNull();
  });

  test("a host it cannot place still gets a page of that service", () => {
    expect(
      findOpenStackServiceRow({ service: "nova-compute", host: "", rows })
        ?.name,
    ).toBe("nova-compute");
  });
});

describe("a part's Traces tab", () => {
  function partOf(kind: OpenStackResourceKind, externalId: string): OpenStackPart {
    return {
      kind,
      externalId,
      openStackCloudId: new ObjectID(CLOUD_ID),
      routes: getOpenStackPartRoutes(new ObjectID(CLOUD_ID)),
      cloudName: CLOUD_NAME,
      isLoadingCloud: false,
      cloudError: "",
      row: null,
      isLoadingRow: false,
      rowError: "",
      refreshToken: 0,
      retry: () => {},
    };
  }

  test.each([
    OpenStackResourceKind.Instance,
    OpenStackResourceKind.Volume,
    OpenStackResourceKind.Network,
    OpenStackResourceKind.Subnet,
    OpenStackResourceKind.Router,
    OpenStackResourceKind.FloatingIp,
    OpenStackResourceKind.Image,
    OpenStackResourceKind.Project,
  ])("%s has one, because a request can name it", (kind: OpenStackResourceKind) => {
    expect(hasOpenStackPartTraces({ kind }, resource({ kind }))).toBe(true);
  });

  test.each([
    OpenStackResourceKind.Hypervisor,
    OpenStackResourceKind.Flavor,
    OpenStackResourceKind.StoragePool,
    OpenStackResourceKind.Domain,
  ])("%s has none, because nothing in a span joins to it", (kind: OpenStackResourceKind) => {
    expect(hasOpenStackPartTraces({ kind }, resource({ kind }))).toBe(false);
  });

  test("a service has one under the word a trace knows it by, and a Neutron agent none", () => {
    const api: OpenStackResource = resource({
      kind: OpenStackResourceKind.Api,
      name: "network",
    });
    const worker: OpenStackResource = resource({
      kind: OpenStackResourceKind.Service,
      name: "nova-conductor",
      facts: { family: "compute" },
    });
    const agent: OpenStackResource = resource({
      kind: OpenStackResourceKind.Service,
      name: "neutron-ovn-metadata-agent",
      facts: { family: "network" },
    });

    expect(
      getOpenStackPartTracedService({ kind: OpenStackResourceKind.Api }, api),
    ).toBe("neutron-server");
    expect(
      getOpenStackPartTracedService(
        { kind: OpenStackResourceKind.Service },
        worker,
      ),
    ).toBe("nova-conductor");
    expect(
      hasOpenStackPartTraces({ kind: OpenStackResourceKind.Service }, agent),
    ).toBe(false);
  });

  test("an instance's finds the spans that named it, by the key ingest gave them", () => {
    render(
      <MemoryRouter>
        <OpenStackPartTraces
          part={partOf(OpenStackResourceKind.Instance, INSTANCE)}
          row={resource({
            kind: OpenStackResourceKind.Instance,
            name: "my-instance",
            externalId: INSTANCE,
          })}
        />
      </MemoryRouter>,
    );

    const props: JSONObject = JSON.parse(
      screen.getByTestId("traces-viewer").textContent || "{}",
    );
    const key: string = keyForOpenStackResource(PROJECT_ID, {
      cloudName: CLOUD_NAME,
      kind: OpenStackResourceKind.Instance,
      id: INSTANCE,
    });

    expect(props["entityKeysFilter"]).toEqual([key]);
    expect(
      (props["entityKeyDisplays"] as JSONObject)[key],
    ).toEqual({ displayKey: "Instance", displayValue: "my-instance" });
    // A request's own span is an entry, and what it calls may not be: every span.
    expect(props["defaultSpanType"]).toBe(TraceSpanType.All);
    expect(props["emptyMessage"]).toContain("Traces page says how");
  });

  test("a service's finds the spans it sent, in this cloud", () => {
    render(
      <MemoryRouter>
        <OpenStackPartTraces
          part={partOf(OpenStackResourceKind.Api, "RegionOne/compute")}
          row={resource({ kind: OpenStackResourceKind.Api, name: "compute" })}
        />
      </MemoryRouter>,
    );

    const props: JSONObject = JSON.parse(
      screen.getByTestId("traces-viewer").textContent || "{}",
    );

    expect(props["attributeFilters"]).toEqual({
      "resource.openstack.cloud.name": CLOUD_NAME,
      "openstack.service": "nova-api",
    });
    expect((props["entityScope"] as JSONObject)["entityKeys"]).toEqual([
      keyForOpenStackCloud(PROJECT_ID, CLOUD_NAME),
    ]);
  });
});
