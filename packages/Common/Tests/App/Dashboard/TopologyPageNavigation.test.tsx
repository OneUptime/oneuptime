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
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  TOPOLOGY_API_FORMAT_VERSION,
  TopologyApiPath,
} from "../../../Types/Topology/TopologyApi";
import TopologyPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Topology/TopologyPage";
import {
  InfrastructureCollection,
  InfrastructureTotals,
  TopologyEntity,
  TopologyRelationship,
  TopologyRunsOnCounts,
  TopologyTruncation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";

/*
 * The Topology page's three tabs load independently: Service Map and
 * Infrastructure each POST their own endpoint the first time they are
 * opened, Network loads nothing here. These tests drive the page through a
 * fake server behind API.post and stub the three views, so they pin what the
 * page asks for, when, and what it hands each view.
 */

const postMock: MockFunction = getJestMockFunction();

/*
 * What the page's translations return. Identity by default; a test that
 * needs to see which fragments were translated swaps it for a marker.
 */
const identity: (value: string) => string = (value: string): string => {
  return value;
};
let translate: (value: string) => string = identity;

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        if (error && typeof error === "object" && "message" in error) {
          return String((error as { message: unknown }).message);
        }
        return "Unable to load topology";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "dde060c6-fe0d-49ce-b44c-4035a13bc1db" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("dde060c6-fe0d-49ce-b44c-4035a13bc1db");
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return translate(value);
        },
      };
    },
  };
});

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { children: React.ReactNode }): React.ReactElement => {
      return <main>{props.children}</main>;
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: (props: {
        onChange: (value: RangeStartAndEndDateTime) => void;
      }): React.ReactElement => {
        return (
          <div data-testid="topology-time-picker">
            Connection time range
            <button
              type="button"
              onClick={() => {
                props.onChange({ range: TimeRange.PAST_ONE_HOUR });
              }}
            >
              Pick the past hour
            </button>
          </div>
        );
      },
    };
  },
);

function names(entities: Array<TopologyEntity>): string {
  return entities
    .map((entity: TopologyEntity): string => {
      return entity.displayName || "";
    })
    .join(",");
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/ServiceMapGraph",
  () => {
    return {
      __esModule: true,
      default: (props: {
        entities: Array<TopologyEntity>;
        relationships: Array<TopologyRelationship>;
        runsOnCounts?: TopologyRunsOnCounts;
        includeInactive?: boolean;
        rangeStart?: Date | null;
        metricsWindowSeconds: number;
        timeRange: RangeStartAndEndDateTime;
        onOpenInfrastructure?: (key: string) => void;
      }): React.ReactElement => {
        return (
          <div data-testid="topology-services">
            Services: {names(props.entities)}
            <span data-testid="services-relationships">
              {props.relationships
                .map((relationship: TopologyRelationship): string => {
                  return `${relationship.fromEntityKey}>${relationship.toEntityKey}`;
                })
                .join(",")}
            </span>
            <span data-testid="services-runs-on">
              {Array.from(props.runsOnCounts?.entries() || [])
                .map(
                  ([service, counts]: [
                    string,
                    Array<{ entityType: string; active: number }>,
                  ]): string => {
                    return `${service}:${counts
                      .map(
                        (count: {
                          entityType: string;
                          active: number;
                        }): string => {
                          return `${count.active} ${count.entityType}`;
                        },
                      )
                      .join("+")}`;
                  },
                )
                .join(",")}
            </span>
            <span data-testid="services-inactive">
              {String(Boolean(props.includeInactive))}
            </span>
            <span data-testid="services-range-start">
              {props.rangeStart ? props.rangeStart.toISOString() : "unset"}
            </span>
            <span data-testid="services-metrics-window">
              {props.metricsWindowSeconds}
            </span>
            <button
              type="button"
              onClick={() => {
                props.onOpenInfrastructure?.("pod-1");
              }}
            >
              Open pod in infrastructure
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureExplorer",
  () => {
    return {
      __esModule: true,
      default: (props: {
        entities: Array<TopologyEntity>;
        relationships: Array<TopologyRelationship>;
        collections?: Array<InfrastructureCollection>;
        totals?: InfrastructureTotals;
        truncation?: TopologyTruncation | null;
        includeInactive?: boolean;
        rangeStart?: Date | null;
        onOpenServiceMap?: (key: string) => void;
      }): React.ReactElement => {
        return (
          <div data-testid="topology-infrastructure">
            Infrastructure: {names(props.entities)}
            <span data-testid="infrastructure-relationships">
              {props.relationships
                .map((relationship: TopologyRelationship): string => {
                  return `${relationship.fromEntityKey}-${relationship.relationshipType}->${relationship.toEntityKey}`;
                })
                .join(",")}
            </span>
            <span data-testid="infrastructure-collections">
              {(props.collections || [])
                .map((collection: InfrastructureCollection): string => {
                  return `${collection.entityType}:${collection.active}/${collection.total}`;
                })
                .join(",")}
            </span>
            <span data-testid="infrastructure-totals">
              {props.totals
                ? `${props.totals.activeResources}/${props.totals.resources}`
                : "none"}
            </span>
            <span data-testid="infrastructure-truncation">
              {props.truncation
                ? `${props.truncation.shown}/${props.truncation.total}`
                : "none"}
            </span>
            <span data-testid="infrastructure-inactive">
              {String(Boolean(props.includeInactive))}
            </span>
            <span data-testid="infrastructure-range-start">
              {props.rangeStart ? props.rangeStart.toISOString() : "unset"}
            </span>
            <button
              type="button"
              onClick={() => {
                props.onOpenServiceMap?.("checkout");
              }}
            >
              Open service on map
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyExplorer",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="topology-network">Live network discovery</div>;
      },
    };
  },
);

interface PostOptions {
  url: URL;
  data: JSONObject;
}

interface RecordedRequest {
  path: string;
  rangeStart: string;
  /* True when the request asked the server to bypass its response cache. */
  fresh: boolean;
  respond: (payload: JSONObject) => void;
  fail: (statusCode: number, message: string) => void;
}

let requests: Array<RecordedRequest> = [];
/*
 * How the fake server answers a request: a payload, an HTTP failure, or
 * "hold" (the test answers it later).
 */
type Answer = JSONObject | { status: number; message: string } | "hold";
let answer: (request: RecordedRequest) => Answer;

const ECHOED_RANGE_START: string = "2026-09-20T10:15:00.000Z";

function requestsTo(path: TopologyApiPath): Array<RecordedRequest> {
  return requests.filter((request: RecordedRequest): boolean => {
    return request.path === path;
  });
}

function serviceMapPayload(extra: JSONObject = {}): JSONObject {
  return {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: ECHOED_RANGE_START,
    generatedAt: "2026-09-21T10:15:42.000Z",
    entities: [
      {
        key: "checkout",
        type: EntityType.Service,
        name: "Checkout API",
        source: "discovered",
        lastSeenAt: null,
      },
      {
        key: "orders-db",
        type: EntityType.Database,
        name: "Orders DB",
        source: "discovered",
        lastSeenAt: null,
      },
    ],
    dependencies: [
      {
        from: "checkout",
        to: "orders-db",
        callCount: 10,
        errorCount: 0,
        avgDurationMs: 4,
      },
    ],
    runsOn: [
      {
        service: "checkout",
        type: EntityType.KubernetesPod,
        active: 3,
        total: 4,
      },
    ],
    entityTruncation: null,
    dependencyTruncation: null,
    ...extra,
  };
}

function infrastructurePayload(extra: JSONObject = {}): JSONObject {
  return {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: ECHOED_RANGE_START,
    generatedAt: "2026-09-21T10:15:42.000Z",
    nodes: [
      {
        key: "node-a",
        type: EntityType.KubernetesNode,
        name: "Node A",
        source: "discovered",
        lastSeenAt: null,
      },
      {
        key: "pod-1",
        type: EntityType.KubernetesPod,
        name: "Pod 1",
        source: "discovered",
        lastSeenAt: null,
        parent: 0,
        parentVia: "runs-on",
      },
    ],
    services: [{ key: "checkout", name: "Checkout API" }],
    placements: [[0, 1]],
    collections: [
      {
        type: EntityType.IoTDevice,
        total: 25000,
        active: 24000,
        lastSeenAt: null,
        activeLastSeenAt: null,
      },
    ],
    totals: { resources: 25002, activeResources: 24002 },
    truncation: null,
    ...extra,
  };
}

function defaultAnswer(request: RecordedRequest): Answer {
  return request.path === TopologyApiPath.ServiceMap
    ? serviceMapPayload()
    : infrastructurePayload();
}

function installFakeServer(): void {
  postMock.mockImplementation((...args: Array<unknown>) => {
    const options: PostOptions = args[0] as PostOptions;
    return new Promise(
      (
        resolve: (value: HTTPResponse<JSONObject> | HTTPErrorResponse) => void,
      ): void => {
        const request: RecordedRequest = {
          path: options.url.toString().replace(/^.*\/api(?=\/)/, ""),
          rangeStart: String(options.data["rangeStart"]),
          fresh: options.data["fresh"] === true,
          respond: (payload: JSONObject): void => {
            resolve(new HTTPResponse<JSONObject>(200, payload, {}));
          },
          fail: (statusCode: number, message: string): void => {
            resolve(new HTTPErrorResponse(statusCode, { message }, {}));
          },
        };
        requests.push(request);
        const reply: Answer = answer(request);
        if (reply === "hold") {
          return;
        }
        if ("status" in reply && typeof reply["status"] === "number") {
          request.fail(reply["status"], String(reply["message"]));
          return;
        }
        request.respond(reply as JSONObject);
      },
    );
  });
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <TopologyPage
        pageRoute={new Route("/topology/overview")}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

function tab(name: string): HTMLElement {
  return screen.getByRole("tab", { name });
}

beforeEach(() => {
  requests = [];
  answer = defaultAnswer;
  translate = identity;
  postMock.mockReset();
  installFakeServer();
  window.history.replaceState({}, "", "/dashboard/project/topology/overview");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what each tab loads", () => {
  test("the Service Map loads its own endpoint once, behind a labelled loader", async () => {
    answer = (): Answer => {
      return "hold";
    };
    renderPage();
    const loader: HTMLElement = await screen.findByText("Loading service map…");
    expect(loader.closest('[role="status"]')).not.toBeNull();
    expect(
      requests.map((request: RecordedRequest): string => {
        return request.path;
      }),
    ).toEqual([TopologyApiPath.ServiceMap]);
    await act(async () => {
      requests[0]!.respond(serviceMapPayload());
    });
    expect(screen.getByTestId("topology-services")).toHaveTextContent(
      "Checkout API,Orders DB",
    );
    expect(screen.queryByText("Loading service map…")).not.toBeInTheDocument();
    expect(requests).toHaveLength(1);
  });

  test("the Service Map receives entities, dependencies, runs-on counts and the echoed range start", async () => {
    renderPage();
    await screen.findByTestId("topology-services");
    expect(screen.getByTestId("services-relationships")).toHaveTextContent(
      "checkout>orders-db",
    );
    expect(screen.getByTestId("services-runs-on")).toHaveTextContent(
      `checkout:3 ${EntityType.KubernetesPod}`,
    );
    expect(screen.getByTestId("services-range-start")).toHaveTextContent(
      ECHOED_RANGE_START,
    );
    expect(screen.getByTestId("services-metrics-window")).toHaveTextContent(
      "900",
    );
  });

  test("Infrastructure receives resources, containment, collections, totals and the echoed range start", async () => {
    window.history.replaceState({}, "", "?tab=Infrastructure");
    renderPage();
    await screen.findByTestId("topology-infrastructure");
    expect(
      requests.map((request: RecordedRequest): string => {
        return request.path;
      }),
    ).toEqual([TopologyApiPath.Infrastructure]);
    expect(screen.getByTestId("topology-infrastructure")).toHaveTextContent(
      "Node A,Pod 1,Checkout API",
    );
    expect(
      screen.getByTestId("infrastructure-relationships"),
    ).toHaveTextContent("pod-1-runs-on->node-a,checkout-runs-on->pod-1");
    expect(screen.getByTestId("infrastructure-collections")).toHaveTextContent(
      `${EntityType.IoTDevice}:24000/25000`,
    );
    expect(screen.getByTestId("infrastructure-totals")).toHaveTextContent(
      "24002/25002",
    );
    expect(screen.getByTestId("infrastructure-truncation")).toHaveTextContent(
      "none",
    );
    expect(screen.getByTestId("infrastructure-range-start")).toHaveTextContent(
      ECHOED_RANGE_START,
    );
  });

  test("Infrastructure shows its own loader while it loads", async () => {
    window.history.replaceState({}, "", "?tab=Infrastructure");
    answer = (): Answer => {
      return "hold";
    };
    renderPage();
    const loader: HTMLElement = await screen.findByText(
      "Loading infrastructure…",
    );
    expect(loader.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByText("Loading service map…")).not.toBeInTheDocument();
  });

  test("switching tabs loads each telemetry tab once and never refetches", async () => {
    renderPage();
    expect(await screen.findByTestId("topology-services")).toHaveTextContent(
      "Checkout API",
    );
    fireEvent.click(tab("Infrastructure"));
    expect(
      await screen.findByTestId("topology-infrastructure"),
    ).toHaveTextContent("Node A");
    fireEvent.click(tab("Network"));
    fireEvent.click(tab("Service Map"));
    expect(screen.getByTestId("topology-services")).toHaveTextContent(
      "Checkout API",
    );
    fireEvent.click(tab("Infrastructure"));
    expect(screen.getByTestId("topology-infrastructure")).toBeVisible();
    expect(requestsTo(TopologyApiPath.ServiceMap)).toHaveLength(1);
    expect(requestsTo(TopologyApiPath.Infrastructure)).toHaveLength(1);
    /* Both tabs were requested for the same pinned range start. */
    expect(requests[0]!.rangeStart).toBe(requests[1]!.rangeStart);
  });

  test("opens live Network while telemetry is still pending, and loads nothing for it", async () => {
    answer = (): Answer => {
      return "hold";
    };
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Network" }));
    expect(screen.getByTestId("topology-network")).toBeVisible();
    expect(
      screen.queryByTestId("topology-time-picker"),
    ).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("tab")).toBe(
      "Network",
    );
    expect(
      requests.map((request: RecordedRequest): string => {
        return request.path;
      }),
    ).toEqual([TopologyApiPath.ServiceMap]);
  });

  test.each(["Infrastructure", "Network"])(
    "restores a shared %s link on the first render",
    async (tabName: string) => {
      window.history.replaceState(
        {},
        "",
        `?tab=${encodeURIComponent(tabName)}`,
      );
      renderPage();
      await waitFor(() => {
        expect(tab(tabName)).toHaveAttribute("aria-selected", "true");
      });
      if (tabName === "Network") {
        expect(screen.getByTestId("topology-network")).toBeVisible();
        expect(
          screen.queryByTestId("topology-time-picker"),
        ).not.toBeInTheDocument();
        await act(async () => {
          await Promise.resolve();
        });
        expect(postMock).not.toHaveBeenCalled();
      } else {
        expect(
          await screen.findByTestId("topology-infrastructure"),
        ).toBeVisible();
        expect(screen.getByTestId("topology-time-picker")).toBeVisible();
        expect(requestsTo(TopologyApiPath.ServiceMap)).toHaveLength(0);
      }
    },
  );

  test("an invalid tab falls back to Service Map and preserves both maps' search state", async () => {
    window.history.replaceState(
      {},
      "",
      "?tab=Missing&search=checkout&infraSearch=worker",
    );
    renderPage();
    expect(await screen.findByTestId("topology-services")).toBeVisible();
    fireEvent.click(tab("Infrastructure"));
    await screen.findByTestId("topology-infrastructure");
    fireEvent.click(tab("Service Map"));
    const query: URLSearchParams = new URLSearchParams(window.location.search);
    expect(query.has("tab")).toBe(false);
    expect(query.get("search")).toBe("checkout");
    expect(query.get("infraSearch")).toBe("worker");
  });
});

describe("errors stay inside their tab", () => {
  test("a Service Map failure does not block Network or Infrastructure, and Try again retries only the Service Map", async () => {
    answer = (request: RecordedRequest): Answer => {
      return request.path === TopologyApiPath.ServiceMap
        ? { status: 500, message: "Telemetry is temporarily unavailable" }
        : infrastructurePayload();
    };
    renderPage();
    const failure: HTMLElement = await screen.findByText(
      "Telemetry is temporarily unavailable",
    );
    expect(failure.closest('[role="alert"]')).not.toBeNull();

    fireEvent.click(tab("Network"));
    expect(screen.getByTestId("topology-network")).toBeVisible();
    expect(
      screen.queryByText("Telemetry is temporarily unavailable"),
    ).not.toBeInTheDocument();

    /* Infrastructure has its own endpoint and loads fine. */
    fireEvent.click(tab("Infrastructure"));
    expect(await screen.findByTestId("topology-infrastructure")).toBeVisible();
    expect(
      screen.queryByText("Telemetry is temporarily unavailable"),
    ).not.toBeInTheDocument();

    fireEvent.click(tab("Service Map"));
    expect(
      screen.getByText("Telemetry is temporarily unavailable"),
    ).toBeVisible();
    answer = defaultAnswer;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("topology-services")).toBeVisible();
    expect(
      screen.queryByText("Telemetry is temporarily unavailable"),
    ).not.toBeInTheDocument();
    expect(requestsTo(TopologyApiPath.ServiceMap)).toHaveLength(2);
    expect(requestsTo(TopologyApiPath.Infrastructure)).toHaveLength(1);

    /* The retry did not throw Infrastructure's data away. */
    fireEvent.click(tab("Infrastructure"));
    expect(screen.getByTestId("topology-infrastructure")).toBeVisible();
    expect(requestsTo(TopologyApiPath.Infrastructure)).toHaveLength(1);
  });

  test.each([
    ["a newer payload format", "version"],
    ["a server without the endpoint", "404"],
  ])(
    "%s asks for a page reload instead of offering a pointless retry",
    async (_label: string, mode: string) => {
      answer = (): Answer => {
        return mode === "404"
          ? { status: 404, message: "Not found" }
          : serviceMapPayload({
              formatVersion: TOPOLOGY_API_FORMAT_VERSION + 1,
            });
      };
      renderPage();
      expect(
        await screen.findByText("Topology was updated. Reload the page."),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "Reload page" })).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Try again" }),
      ).not.toBeInTheDocument();
    },
  );

  /*
   * The server caps concurrent topology work and answers 429 when it is
   * full. That passes in a moment, so the tab says so in plain, translated
   * words and offers "Try again" — not the outdated-bundle reload.
   */
  test("a busy server (429) gets a friendly message and Try again, which recovers", async () => {
    answer = (): Answer => {
      return {
        status: 429,
        message: "Too many topology requests are running for this project.",
      };
    };
    translate = (value: string): string => {
      return value === "The topology service is busy. Try again in a moment."
        ? "[busy, translated]"
        : value;
    };
    renderPage();
    const failure: HTMLElement = await screen.findByText("[busy, translated]");
    expect(failure.closest('[role="alert"]')).not.toBeNull();
    expect(
      screen.queryByText(
        "Too many topology requests are running for this project.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Topology was updated. Reload the page."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reload page" }),
    ).not.toBeInTheDocument();

    answer = defaultAnswer;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("topology-services")).toBeVisible();
    expect(screen.queryByText("[busy, translated]")).not.toBeInTheDocument();
    expect(requestsTo(TopologyApiPath.ServiceMap)).toHaveLength(2);
    /* A retry is an ordinary load, not an explicit refresh. */
    expect(
      requests.map((request: RecordedRequest): boolean => {
        return request.fresh;
      }),
    ).toEqual([false, false]);
  });
});

describe("the refresh button and the time range", () => {
  test("refresh is disabled while the active tab loads, then reloads only the active tab", async () => {
    answer = (): Answer => {
      return "hold";
    };
    renderPage();
    const refresh: HTMLElement = await screen.findByRole("button", {
      name: "Refresh topology",
    });
    expect(refresh).toBeDisabled();
    expect(refresh).not.toHaveAttribute("title");
    await act(async () => {
      requests[0]!.respond(serviceMapPayload());
    });
    expect(refresh).toBeEnabled();
    expect(refresh.getAttribute("title")).toContain("Last refreshed");

    /* Infrastructure is loading: the button follows the ACTIVE tab. */
    fireEvent.click(tab("Infrastructure"));
    await waitFor(() => {
      expect(requestsTo(TopologyApiPath.Infrastructure)).toHaveLength(1);
    });
    expect(
      screen.getByRole("button", { name: "Refresh topology" }),
    ).toBeDisabled();
    await act(async () => {
      requestsTo(TopologyApiPath.Infrastructure)[0]!.respond(
        infrastructurePayload(),
      );
    });
    expect(
      screen.getByRole("button", { name: "Refresh topology" }),
    ).toBeEnabled();

    answer = defaultAnswer;
    fireEvent.click(screen.getByRole("button", { name: "Refresh topology" }));
    await screen.findByTestId("topology-infrastructure");
    expect(requestsTo(TopologyApiPath.Infrastructure)).toHaveLength(2);
    expect(requestsTo(TopologyApiPath.ServiceMap)).toHaveLength(1);

    /* The Service Map was dropped with the old generation: it loads again. */
    fireEvent.click(tab("Service Map"));
    await screen.findByTestId("topology-services");
    expect(requestsTo(TopologyApiPath.ServiceMap)).toHaveLength(2);
  });

  /*
   * The server keeps each map for a minute. The refresh button is the user
   * asking for current data, so it — and nothing else — bypasses that cache,
   * for the active tab and for the other tab's first load after it.
   */
  test("refresh asks the server for fresh data; ordinary loads use its cache", async () => {
    renderPage();
    await screen.findByTestId("topology-services");
    fireEvent.click(tab("Infrastructure"));
    await screen.findByTestId("topology-infrastructure");
    fireEvent.click(tab("Service Map"));
    fireEvent.click(screen.getByTestId("topology-show-inactive"));
    expect(
      requests.map((request: RecordedRequest): boolean => {
        return request.fresh;
      }),
    ).toEqual([false, false]);

    fireEvent.click(screen.getByRole("button", { name: "Refresh topology" }));
    await waitFor(() => {
      expect(requestsTo(TopologyApiPath.ServiceMap)).toHaveLength(2);
    });
    await screen.findByTestId("topology-services");
    fireEvent.click(tab("Infrastructure"));
    await screen.findByTestId("topology-infrastructure");
    expect(
      requests.map((request: RecordedRequest): string => {
        return `${request.path}:${request.fresh ? "fresh" : "cached"}`;
      }),
    ).toEqual([
      `${TopologyApiPath.ServiceMap}:cached`,
      `${TopologyApiPath.Infrastructure}:cached`,
      `${TopologyApiPath.ServiceMap}:fresh`,
      `${TopologyApiPath.Infrastructure}:fresh`,
    ]);

    /* A new time range is an ordinary load again. */
    fireEvent.click(screen.getByRole("button", { name: "Pick the past hour" }));
    await waitFor(() => {
      expect(requestsTo(TopologyApiPath.Infrastructure)).toHaveLength(3);
    });
    await screen.findByTestId("topology-infrastructure");
    expect(requests[requests.length - 1]!.fresh).toBe(false);
  });

  test("a new time range reloads the active tab for that range", async () => {
    renderPage();
    await screen.findByTestId("topology-services");
    const firstStart: string = requests[0]!.rangeStart;
    fireEvent.click(screen.getByRole("button", { name: "Pick the past hour" }));
    await waitFor(() => {
      expect(requestsTo(TopologyApiPath.ServiceMap)).toHaveLength(2);
    });
    const secondStart: string = requests[1]!.rangeStart;
    expect(new Date(secondStart).getTime()).toBeGreaterThan(
      new Date(firstStart).getTime(),
    );
    expect(requestsTo(TopologyApiPath.Infrastructure)).toHaveLength(0);
    expect(await screen.findByTestId("topology-services")).toBeVisible();
  });
});

describe("the truncation banner", () => {
  const SERVICE_MAP_NOTE: string =
    "The map, counts and search cover what is shown.";
  const INFRASTRUCTURE_NOTE: string =
    "Counts are exact; the map and search cover the resources shown.";

  test("appears only for the active tab's truncated payload, with exact totals", async () => {
    answer = (request: RecordedRequest): Answer => {
      return request.path === TopologyApiPath.ServiceMap
        ? serviceMapPayload({
            entityTruncation: { shown: 50000, total: 61234 },
          })
        : infrastructurePayload();
    };
    renderPage();
    await screen.findByTestId("topology-services");
    const banner: HTMLElement = screen.getByTestId("topology-truncation");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent(
      `${(50000).toLocaleString()} of ${(61234).toLocaleString()} resources shown.`,
    );
    /*
     * The Service Map's tiles count what was shipped, so it must not claim
     * its counts are exact.
     */
    expect(banner).toHaveTextContent(SERVICE_MAP_NOTE);
    expect(banner).not.toHaveTextContent("Counts are exact");
    expect(banner).not.toHaveTextContent("connections shown.");
    expect(banner).not.toHaveTextContent("Partial inventory");

    fireEvent.click(tab("Infrastructure"));
    await screen.findByTestId("topology-infrastructure");
    expect(screen.queryByTestId("topology-truncation")).not.toBeInTheDocument();

    fireEvent.click(tab("Network"));
    expect(screen.queryByTestId("topology-truncation")).not.toBeInTheDocument();

    fireEvent.click(tab("Service Map"));
    expect(screen.getByTestId("topology-truncation")).toBeVisible();
  });

  /*
   * The dependency cap limits connection rows, not resources: calling
   * 200,000 connections "resources" would misstate what is missing.
   */
  test("a Service Map with only its connections capped says connections", async () => {
    answer = (request: RecordedRequest): Answer => {
      return request.path === TopologyApiPath.ServiceMap
        ? serviceMapPayload({
            dependencyTruncation: { shown: 200000, total: 250001 },
          })
        : infrastructurePayload();
    };
    renderPage();
    await screen.findByTestId("topology-services");
    const banner: HTMLElement = screen.getByTestId("topology-truncation");
    expect(banner.textContent).toBe(
      `${(200000).toLocaleString()} of ${(250001).toLocaleString()} connections shown. ${SERVICE_MAP_NOTE}`,
    );
    expect(banner).not.toHaveTextContent("resources shown.");
    expect(banner).not.toHaveTextContent("Counts are exact");
  });

  test("a Service Map with both caps hit reports both", async () => {
    answer = (): Answer => {
      return serviceMapPayload({
        entityTruncation: { shown: 50000, total: 50001 },
        dependencyTruncation: { shown: 200000, total: 200002 },
      });
    };
    renderPage();
    await screen.findByTestId("topology-services");
    expect(screen.getByTestId("topology-truncation").textContent).toBe(
      `${(50000).toLocaleString()} of ${(50001).toLocaleString()} resources shown. ` +
        `${(200000).toLocaleString()} of ${(200002).toLocaleString()} connections shown. ` +
        SERVICE_MAP_NOTE,
    );
  });

  /*
   * Every word of the banner goes through translation, and no number is
   * baked into a key: the fragments are translated, the figures are not.
   */
  test("the banner is built from translated fragments with the numbers outside them", async () => {
    translate = (value: string): string => {
      return `«${value}»`;
    };
    answer = (): Answer => {
      return serviceMapPayload({
        entityTruncation: { shown: 50000, total: 50001 },
        dependencyTruncation: { shown: 200000, total: 200002 },
      });
    };
    renderPage();
    await screen.findByTestId("topology-services");
    expect(screen.getByTestId("topology-truncation").textContent).toBe(
      `${(50000).toLocaleString()} «of» ${(50001).toLocaleString()} «resources shown.» ` +
        `${(200000).toLocaleString()} «of» ${(200002).toLocaleString()} «connections shown.» ` +
        `«${SERVICE_MAP_NOTE}»`,
    );
  });

  test("an Infrastructure cap shows on Infrastructure only, and reaches the explorer", async () => {
    answer = (request: RecordedRequest): Answer => {
      return request.path === TopologyApiPath.Infrastructure
        ? infrastructurePayload({
            truncation: { shown: 200000, total: 212345 },
          })
        : serviceMapPayload();
    };
    renderPage();
    await screen.findByTestId("topology-services");
    expect(screen.queryByTestId("topology-truncation")).not.toBeInTheDocument();
    fireEvent.click(tab("Infrastructure"));
    await screen.findByTestId("topology-infrastructure");
    expect(screen.getByTestId("topology-truncation").textContent).toBe(
      `${(200000).toLocaleString()} of ${(212345).toLocaleString()} resources shown. ${INFRASTRUCTURE_NOTE}`,
    );
    /* Only Infrastructure's summary switches to the server's exact totals. */
    expect(screen.getByTestId("topology-truncation")).not.toHaveTextContent(
      SERVICE_MAP_NOTE,
    );
    expect(screen.getByTestId("infrastructure-truncation")).toHaveTextContent(
      "200000/212345",
    );
  });

  test("no banner while the tab is still loading", async () => {
    answer = (): Answer => {
      return "hold";
    };
    renderPage();
    await screen.findByText("Loading service map…");
    expect(screen.queryByTestId("topology-truncation")).not.toBeInTheDocument();
  });
});

describe("show inactive and cross-tab links", () => {
  test("show inactive reaches both telemetry views and the shareable URL", async () => {
    renderPage();
    await screen.findByTestId("topology-services");
    expect(screen.getByTestId("services-inactive")).toHaveTextContent("false");
    fireEvent.click(screen.getByTestId("topology-show-inactive"));
    expect(screen.getByTestId("services-inactive")).toHaveTextContent("true");
    expect(new URLSearchParams(window.location.search).get("inactive")).toBe(
      "show",
    );
    fireEvent.click(tab("Infrastructure"));
    expect(
      await screen.findByTestId("infrastructure-inactive"),
    ).toHaveTextContent("true");
    fireEvent.click(screen.getByTestId("topology-show-inactive"));
    expect(new URLSearchParams(window.location.search).has("inactive")).toBe(
      false,
    );
    /* The toggle is client-side: it never refetches. */
    expect(requests).toHaveLength(2);
  });

  test("a shared link restores show inactive", async () => {
    window.history.replaceState({}, "", "?inactive=show");
    renderPage();
    expect(await screen.findByTestId("services-inactive")).toHaveTextContent(
      "true",
    );
    expect(screen.getByTestId("topology-show-inactive")).toBeChecked();
  });

  test("the Service Map hands a resource to Infrastructure, which loads once, and back", async () => {
    renderPage();
    await screen.findByTestId("topology-services");
    fireEvent.click(
      screen.getByRole("button", { name: "Open pod in infrastructure" }),
    );
    expect(tab("Infrastructure")).toHaveAttribute("aria-selected", "true");
    let query: URLSearchParams = new URLSearchParams(window.location.search);
    expect(query.get("tab")).toBe("Infrastructure");
    expect(query.get("infraFocus")).toBe("pod-1");
    expect(await screen.findByTestId("topology-infrastructure")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Open service on map" }),
    );
    expect(tab("Service Map")).toHaveAttribute("aria-selected", "true");
    query = new URLSearchParams(window.location.search);
    expect(query.has("tab")).toBe(false);
    expect(query.get("focus")).toBe("checkout");
    expect(query.get("serviceView")).toBe("map");
    expect(screen.getByTestId("topology-services")).toBeVisible();

    /* Round trip again: still no refetch of either tab. */
    fireEvent.click(
      screen.getByRole("button", { name: "Open pod in infrastructure" }),
    );
    expect(screen.getByTestId("topology-infrastructure")).toBeVisible();
    expect(requestsTo(TopologyApiPath.ServiceMap)).toHaveLength(1);
    expect(requestsTo(TopologyApiPath.Infrastructure)).toHaveLength(1);
  });

  test("keyboard navigation switches maps and updates the shareable tab", async () => {
    renderPage();
    await screen.findByTestId("topology-services");
    const serviceTab: HTMLElement = tab("Service Map");
    serviceTab.focus();
    fireEvent.keyDown(serviceTab, { key: "ArrowRight" });
    await waitFor(() => {
      expect(tab("Infrastructure")).toHaveAttribute("aria-selected", "true");
    });
    expect(new URLSearchParams(window.location.search).get("tab")).toBe(
      "Infrastructure",
    );
    expect(tab("Infrastructure")).toHaveFocus();
    await screen.findByTestId("topology-infrastructure");
    fireEvent.keyDown(tab("Infrastructure"), { key: "End" });
    await waitFor(() => {
      expect(tab("Network")).toHaveAttribute("aria-selected", "true");
    });
  });
});
