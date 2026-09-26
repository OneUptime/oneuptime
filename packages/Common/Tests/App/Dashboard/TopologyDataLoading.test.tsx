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
import getJestMockFunction, { MockFunction } from "../../MockType";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  TOPOLOGY_API_FORMAT_VERSION,
  TopologyApiPath,
} from "../../../Types/Topology/TopologyApi";
import useTopologyData, {
  TOPOLOGY_RANGE_REPIN_AFTER_MS,
  TopologyData,
  TopologyView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/UseTopologyData";
import { TopologyEntity } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";

/*
 * useTopologyData decides WHEN the Topology page talks to the server: one
 * POST per telemetry tab, the first time that tab is opened, pinned to one
 * range start per generation. These tests drive it through the one seam the
 * browser really has — API.post — with a fake server that records every
 * request and answers when the test says so.
 */

const postMock: MockFunction = getJestMockFunction();
const getProjectIdMock: MockFunction = getJestMockFunction();

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
      getCommonHeaders: (): Dictionary<string> => {
        return { tenantid: String(getProjectIdMock()) };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return getProjectIdMock();
      },
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "dde060c6-fe0d-49ce-b44c-4035a13bc1db",
);
const FIRST_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-09-01T09:15:27.000Z"),
    new Date("2026-09-01T10:15:00.000Z"),
  ),
};
const SECOND_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-09-02T09:15:00.000Z"),
    new Date("2026-09-02T10:15:00.000Z"),
  ),
};
const LAST_HOUR: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_HOUR };

interface PostOptions {
  url: URL;
  data: JSONObject;
  headers: Dictionary<string>;
  options?: { signal?: AbortSignal };
}

/* One request the fake server received, answerable by the test. */
interface RecordedRequest {
  path: string;
  rangeStart: string;
  headers: Dictionary<string>;
  signal: AbortSignal | undefined;
  respond: (payload: JSONObject) => void;
  fail: (statusCode: number, message: string) => void;
  reject: (error: Error) => void;
}

let requests: Array<RecordedRequest> = [];
/* When true, every request is answered at once with defaultPayload. */
let autoRespond: boolean = true;

function pathOf(url: URL): string {
  return url.toString().replace(/^.*\/api(?=\/)/, "");
}

function requestsTo(path: TopologyApiPath): Array<RecordedRequest> {
  return requests.filter((request: RecordedRequest): boolean => {
    return request.path === path;
  });
}

function lastRequestTo(path: TopologyApiPath): RecordedRequest {
  const matching: Array<RecordedRequest> = requestsTo(path);
  return matching[matching.length - 1]!;
}

/*
 * The server floors the range start to the minute and echoes it; each answer
 * names its own ordinal so a test can tell which response is on screen.
 */
function floorToMinute(iso: string): string {
  const time: number = new Date(iso).getTime();
  return new Date(time - (time % 60000)).toISOString();
}

function serviceMapPayload(
  rangeStart: string,
  serviceName: string,
  extra: JSONObject = {},
): JSONObject {
  return {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: floorToMinute(rangeStart),
    generatedAt: "2026-09-02T10:15:30.000Z",
    entities: [
      {
        key: `service:${serviceName}`,
        type: EntityType.Service,
        name: serviceName,
        source: "discovered",
        lastSeenAt: null,
      },
    ],
    dependencies: [],
    runsOn: [],
    entityTruncation: null,
    dependencyTruncation: null,
    ...extra,
  };
}

function infrastructurePayload(
  rangeStart: string,
  hostName: string,
): JSONObject {
  return {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: floorToMinute(rangeStart),
    generatedAt: "2026-09-02T10:15:30.000Z",
    nodes: [
      {
        key: `host:${hostName}`,
        type: EntityType.Host,
        name: hostName,
        source: "discovered",
        lastSeenAt: null,
      },
    ],
    services: [],
    placements: [],
    collections: [],
    totals: { resources: 1, activeResources: 1 },
    truncation: null,
  };
}

function defaultPayload(request: RecordedRequest): JSONObject {
  const ordinal: number = requestsTo(request.path as TopologyApiPath).length;
  if (request.path === TopologyApiPath.ServiceMap) {
    return serviceMapPayload(request.rangeStart, `service map #${ordinal}`);
  }
  return infrastructurePayload(
    request.rangeStart,
    `infrastructure #${ordinal}`,
  );
}

function installFakeServer(): void {
  postMock.mockImplementation((...args: Array<unknown>) => {
    const options: PostOptions = args[0] as PostOptions;
    return new Promise(
      (
        resolve: (value: HTTPResponse<JSONObject> | HTTPErrorResponse) => void,
        reject: (error: Error) => void,
      ): void => {
        const request: RecordedRequest = {
          path: pathOf(options.url),
          rangeStart: String(options.data["rangeStart"]),
          headers: options.headers,
          signal: options.options?.signal,
          respond: (payload: JSONObject): void => {
            resolve(new HTTPResponse<JSONObject>(200, payload, {}));
          },
          fail: (statusCode: number, message: string): void => {
            resolve(new HTTPErrorResponse(statusCode, { message }, {}));
          },
          reject: reject,
        };
        requests.push(request);
        if (autoRespond) {
          request.respond(defaultPayload(request));
        }
      },
    );
  });
}

function names(entities: Array<TopologyEntity> | undefined): string {
  return (entities || [])
    .map((entity: TopologyEntity): string => {
      return entity.displayName || "";
    })
    .join(",");
}

function Probe(props: {
  range: RangeStartAndEndDateTime;
  view: TopologyView;
}): React.ReactElement {
  const data: TopologyData = useTopologyData(props.range, props.view);
  return (
    <div>
      <span data-testid="generation">{data.generation}</span>
      <span data-testid="pinned">
        {data.pinnedRangeStart?.toISOString() || ""}
      </span>
      <span data-testid="sm-status">{data.serviceMap.status}</span>
      <span data-testid="sm-error">{data.serviceMap.error?.message || ""}</span>
      <span data-testid="sm-outdated">
        {String(Boolean(data.serviceMap.error?.isOutdated))}
      </span>
      <span data-testid="sm-entities">
        {names(data.serviceMap.data?.entities)}
      </span>
      <span data-testid="sm-range-start">
        {data.serviceMap.data?.rangeStart.toISOString() || ""}
      </span>
      <span data-testid="sm-loaded-at">
        {data.serviceMap.loadedAt?.toISOString() || ""}
      </span>
      <span data-testid="infra-status">{data.infrastructure.status}</span>
      <span data-testid="infra-error">
        {data.infrastructure.error?.message || ""}
      </span>
      <span data-testid="infra-outdated">
        {String(Boolean(data.infrastructure.error?.isOutdated))}
      </span>
      <span data-testid="infra-entities">
        {names(data.infrastructure.data?.entities)}
      </span>
      <span data-testid="infra-range-start">
        {data.infrastructure.data?.rangeStart.toISOString() || ""}
      </span>
      <button type="button" onClick={data.reload}>
        Reload topology
      </button>
      <button
        type="button"
        onClick={() => {
          data.retry("Service Map");
        }}
      >
        Retry service map
      </button>
      <button
        type="button"
        onClick={() => {
          data.retry("Infrastructure");
        }}
      >
        Retry infrastructure
      </button>
      <button
        type="button"
        onClick={() => {
          data.retry("Network");
        }}
      >
        Retry network
      </button>
    </div>
  );
}

function text(testId: string): string {
  return screen.getByTestId(testId).textContent || "";
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  requests = [];
  autoRespond = true;
  postMock.mockReset();
  getProjectIdMock.mockReset();
  getProjectIdMock.mockReturnValue(PROJECT_ID);
  installFakeServer();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("which tab loads, and when", () => {
  test("the active tab loads with exactly one POST pinned to the range start", async () => {
    render(<Probe range={FIRST_RANGE} view="Service Map" />);
    await waitFor(() => {
      expect(text("sm-status")).toBe("ready");
    });
    expect(requests).toHaveLength(1);
    const request: RecordedRequest = requests[0]!;
    expect(request.path).toBe(TopologyApiPath.ServiceMap);
    /* The exact start, unfloored: flooring is the server's job. */
    expect(request.rangeStart).toBe("2026-09-01T09:15:27.000Z");
    expect(request.headers).toEqual({ tenantid: PROJECT_ID.toString() });
    expect(text("pinned")).toBe("2026-09-01T09:15:27.000Z");
    expect(text("sm-entities")).toBe("service map #1");
    /* Views judge activity against the server's echo, not the request. */
    expect(text("sm-range-start")).toBe("2026-09-01T09:15:00.000Z");
    expect(text("sm-loaded-at")).toBe("2026-09-02T10:15:30.000Z");
    expect(text("infra-status")).toBe("idle");
  });

  test("the Network tab loads nothing at all", async () => {
    render(<Probe range={FIRST_RANGE} view="Network" />);
    await flush();
    expect(postMock).not.toHaveBeenCalled();
    expect(text("sm-status")).toBe("idle");
    expect(text("infra-status")).toBe("idle");
    fireEvent.click(screen.getByRole("button", { name: "Retry network" }));
    await flush();
    expect(postMock).not.toHaveBeenCalled();
  });

  test("a shared Infrastructure link loads only Infrastructure", async () => {
    render(<Probe range={FIRST_RANGE} view="Infrastructure" />);
    await waitFor(() => {
      expect(text("infra-status")).toBe("ready");
    });
    expect(
      requests.map((request: RecordedRequest) => {
        return request.path;
      }),
    ).toEqual([TopologyApiPath.Infrastructure]);
    expect(text("infra-entities")).toBe("infrastructure #1");
    expect(text("infra-range-start")).toBe("2026-09-01T09:15:00.000Z");
    expect(text("sm-status")).toBe("idle");
  });

  test("a tab loads on first activation only; switching back and forth never refetches", async () => {
    const view: ReturnType<typeof render> = render(
      <Probe range={FIRST_RANGE} view="Service Map" />,
    );
    await waitFor(() => {
      expect(text("sm-status")).toBe("ready");
    });
    view.rerender(<Probe range={FIRST_RANGE} view="Infrastructure" />);
    await waitFor(() => {
      expect(text("infra-status")).toBe("ready");
    });
    for (const next of [
      "Service Map",
      "Network",
      "Infrastructure",
      "Service Map",
    ] as Array<TopologyView>) {
      view.rerender(<Probe range={FIRST_RANGE} view={next} />);
      await flush();
    }
    expect(requestsTo(TopologyApiPath.ServiceMap)).toHaveLength(1);
    expect(requestsTo(TopologyApiPath.Infrastructure)).toHaveLength(1);
    expect(text("sm-entities")).toBe("service map #1");
    expect(text("infra-entities")).toBe("infrastructure #1");
    /* Both tabs describe the same moment. */
    expect(requests[0]!.rangeStart).toBe(requests[1]!.rangeStart);
    expect(text("generation")).toBe("1");
  });

  test("switching away from a loading tab neither cancels nor repeats it", async () => {
    autoRespond = false;
    const view: ReturnType<typeof render> = render(
      <Probe range={FIRST_RANGE} view="Service Map" />,
    );
    await flush();
    view.rerender(<Probe range={FIRST_RANGE} view="Infrastructure" />);
    await flush();
    view.rerender(<Probe range={FIRST_RANGE} view="Network" />);
    await flush();
    view.rerender(<Probe range={FIRST_RANGE} view="Service Map" />);
    await flush();
    expect(requests).toHaveLength(2);
    expect(text("sm-status")).toBe("loading");
    expect(text("infra-status")).toBe("loading");
    expect(requests[0]!.signal?.aborted).toBe(false);
    expect(requests[1]!.signal?.aborted).toBe(false);
    await act(async () => {
      requests[1]!.respond(
        infrastructurePayload(requests[1]!.rangeStart, "late infrastructure"),
      );
      requests[0]!.respond(
        serviceMapPayload(requests[0]!.rangeStart, "late service map"),
      );
    });
    expect(text("sm-entities")).toBe("late service map");
    expect(text("infra-entities")).toBe("late infrastructure");
  });
});

describe("generations: range, project and reload", () => {
  test("a range change aborts in-flight work, drops both tabs and reloads only the active one", async () => {
    const view: ReturnType<typeof render> = render(
      <Probe range={FIRST_RANGE} view="Service Map" />,
    );
    await waitFor(() => {
      expect(text("sm-status")).toBe("ready");
    });
    autoRespond = false;
    view.rerender(<Probe range={FIRST_RANGE} view="Infrastructure" />);
    await flush();
    const obsoleteInfrastructure: RecordedRequest = lastRequestTo(
      TopologyApiPath.Infrastructure,
    );
    expect(text("infra-status")).toBe("loading");

    autoRespond = true;
    view.rerender(<Probe range={SECOND_RANGE} view="Infrastructure" />);
    await waitFor(() => {
      expect(text("infra-status")).toBe("ready");
    });
    expect(obsoleteInfrastructure.signal?.aborted).toBe(true);
    expect(text("generation")).toBe("2");
    expect(text("pinned")).toBe("2026-09-02T09:15:00.000Z");
    expect(lastRequestTo(TopologyApiPath.Infrastructure).rangeStart).toBe(
      "2026-09-02T09:15:00.000Z",
    );
    /* The Service Map's old-range data is gone and was NOT refetched. */
    expect(text("sm-status")).toBe("idle");
    expect(text("sm-entities")).toBe("");
    expect(requestsTo(TopologyApiPath.ServiceMap)).toHaveLength(1);

    /* The obsolete answer arriving now changes nothing. */
    await act(async () => {
      obsoleteInfrastructure.respond(
        infrastructurePayload(
          obsoleteInfrastructure.rangeStart,
          "obsolete range",
        ),
      );
    });
    expect(text("infra-entities")).toBe("infrastructure #2");

    /* Opening the Service Map again loads it for the new range. */
    view.rerender(<Probe range={SECOND_RANGE} view="Service Map" />);
    await waitFor(() => {
      expect(text("sm-status")).toBe("ready");
    });
    expect(requestsTo(TopologyApiPath.ServiceMap)).toHaveLength(2);
    expect(lastRequestTo(TopologyApiPath.ServiceMap).rangeStart).toBe(
      "2026-09-02T09:15:00.000Z",
    );
  });

  test("an older range finishing last cannot replace the selected range", async () => {
    autoRespond = false;
    const view: ReturnType<typeof render> = render(
      <Probe range={FIRST_RANGE} view="Service Map" />,
    );
    await flush();
    view.rerender(<Probe range={SECOND_RANGE} view="Service Map" />);
    await flush();
    expect(requests).toHaveLength(2);
    await act(async () => {
      requests[1]!.respond(
        serviceMapPayload(requests[1]!.rangeStart, "latest range"),
      );
    });
    expect(text("sm-entities")).toBe("latest range");
    await act(async () => {
      requests[0]!.respond(
        serviceMapPayload(requests[0]!.rangeStart, "obsolete range", {
          entityTruncation: { shown: 1, total: 100 },
        }),
      );
    });
    expect(text("sm-entities")).toBe("latest range");
    expect(text("sm-range-start")).toBe("2026-09-02T09:15:00.000Z");
  });

  test("an obsolete failure cannot clear the loading state or show an error", async () => {
    autoRespond = false;
    const view: ReturnType<typeof render> = render(
      <Probe range={FIRST_RANGE} view="Service Map" />,
    );
    await flush();
    view.rerender(<Probe range={SECOND_RANGE} view="Service Map" />);
    await flush();
    await act(async () => {
      requests[0]!.reject(new Error("An old request failed"));
    });
    expect(text("sm-status")).toBe("loading");
    expect(text("sm-error")).toBe("");
    await act(async () => {
      requests[1]!.respond(
        serviceMapPayload(requests[1]!.rangeStart, "current inventory"),
      );
    });
    expect(text("sm-entities")).toBe("current inventory");
    expect(text("sm-error")).toBe("");
  });

  test("reload() starts a new generation and loads only the active tab", async () => {
    const view: ReturnType<typeof render> = render(
      <Probe range={FIRST_RANGE} view="Service Map" />,
    );
    await waitFor(() => {
      expect(text("sm-status")).toBe("ready");
    });
    view.rerender(<Probe range={FIRST_RANGE} view="Infrastructure" />);
    await waitFor(() => {
      expect(text("infra-status")).toBe("ready");
    });
    fireEvent.click(screen.getByRole("button", { name: "Reload topology" }));
    await waitFor(() => {
      expect(text("infra-entities")).toBe("infrastructure #2");
    });
    expect(text("generation")).toBe("2");
    expect(text("sm-status")).toBe("idle");
    expect(requestsTo(TopologyApiPath.ServiceMap)).toHaveLength(1);
    expect(requestsTo(TopologyApiPath.Infrastructure)).toHaveLength(2);
    view.rerender(<Probe range={FIRST_RANGE} view="Service Map" />);
    await waitFor(() => {
      expect(text("sm-entities")).toBe("service map #2");
    });
  });

  test("reload() while a request is pending aborts it and ignores its answer", async () => {
    autoRespond = false;
    render(<Probe range={FIRST_RANGE} view="Service Map" />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Reload topology" }));
    await flush();
    expect(requests).toHaveLength(2);
    expect(requests[0]!.signal?.aborted).toBe(true);
    expect(requests[1]!.signal?.aborted).toBe(false);
    await act(async () => {
      requests[1]!.respond(
        serviceMapPayload(requests[1]!.rangeStart, "reloaded"),
      );
    });
    await act(async () => {
      requests[0]!.reject(new Error("Request Canceled."));
    });
    expect(text("sm-entities")).toBe("reloaded");
    expect(text("sm-error")).toBe("");
  });

  test("reload() on the Network tab re-pins the range but requests nothing", async () => {
    render(<Probe range={FIRST_RANGE} view="Network" />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Reload topology" }));
    await flush();
    expect(text("generation")).toBe("2");
    expect(postMock).not.toHaveBeenCalled();
  });

  test("changing projects refetches and ignores the previous project's response", async () => {
    autoRespond = false;
    const view: ReturnType<typeof render> = render(
      <Probe range={FIRST_RANGE} view="Service Map" />,
    );
    await flush();
    const nextProject: ObjectID = new ObjectID(
      "22222222-2222-4222-8222-222222222222",
    );
    getProjectIdMock.mockReturnValue(nextProject);
    view.rerender(<Probe range={FIRST_RANGE} view="Service Map" />);
    await flush();
    expect(requests).toHaveLength(2);
    expect(requests[0]!.signal?.aborted).toBe(true);
    expect(requests[1]!.headers).toEqual({ tenantid: nextProject.toString() });
    await act(async () => {
      requests[1]!.respond(
        serviceMapPayload(requests[1]!.rangeStart, "project two"),
      );
    });
    await act(async () => {
      requests[0]!.respond(
        serviceMapPayload(requests[0]!.rangeStart, "project one"),
      );
    });
    expect(text("sm-entities")).toBe("project two");
  });

  test("never sends an unscoped request without a project", async () => {
    getProjectIdMock.mockReturnValue(null);
    const view: ReturnType<typeof render> = render(
      <Probe range={FIRST_RANGE} view="Service Map" />,
    );
    await waitFor(() => {
      expect(text("sm-status")).toBe("error");
    });
    expect(text("sm-error")).toContain("Select a project");
    view.rerender(<Probe range={FIRST_RANGE} view="Infrastructure" />);
    await waitFor(() => {
      expect(text("infra-status")).toBe("error");
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Retry infrastructure" }),
    );
    await flush();
    expect(postMock).not.toHaveBeenCalled();
  });

  test("unmounting aborts in-flight requests", async () => {
    autoRespond = false;
    const view: ReturnType<typeof render> = render(
      <Probe range={FIRST_RANGE} view="Service Map" />,
    );
    await flush();
    view.unmount();
    expect(requests[0]!.signal?.aborted).toBe(true);
    await act(async () => {
      requests[0]!.respond(
        serviceMapPayload(requests[0]!.rangeStart, "after unmount"),
      );
    });
  });
});

describe("per-tab errors and retry", () => {
  test("a failed tab reports its own error; retry reloads only that tab", async () => {
    const view: ReturnType<typeof render> = render(
      <Probe range={FIRST_RANGE} view="Service Map" />,
    );
    await waitFor(() => {
      expect(text("sm-status")).toBe("ready");
    });
    autoRespond = false;
    view.rerender(<Probe range={FIRST_RANGE} view="Infrastructure" />);
    await flush();
    await act(async () => {
      lastRequestTo(TopologyApiPath.Infrastructure).fail(500, "Please retry");
    });
    expect(text("infra-status")).toBe("error");
    expect(text("infra-error")).toBe("Please retry");
    expect(text("infra-outdated")).toBe("false");
    /* The other tab is untouched. */
    expect(text("sm-status")).toBe("ready");
    expect(text("sm-entities")).toBe("service map #1");

    autoRespond = true;
    fireEvent.click(
      screen.getByRole("button", { name: "Retry infrastructure" }),
    );
    await waitFor(() => {
      expect(text("infra-status")).toBe("ready");
    });
    expect(text("infra-error")).toBe("");
    expect(requestsTo(TopologyApiPath.Infrastructure)).toHaveLength(2);
    expect(requestsTo(TopologyApiPath.ServiceMap)).toHaveLength(1);
    /* Same generation, same pinned range as the Service Map. */
    expect(text("generation")).toBe("1");
    expect(lastRequestTo(TopologyApiPath.Infrastructure).rangeStart).toBe(
      requests[0]!.rangeStart,
    );
    expect(text("sm-entities")).toBe("service map #1");
  });

  test.each([
    ["a transport error", "reject"],
    ["an HTTP error", "fail"],
  ])(
    "%s never presents partial data, and retry recovers",
    async (_label: string, mode: string) => {
      autoRespond = false;
      render(<Probe range={FIRST_RANGE} view="Service Map" />);
      await flush();
      await act(async () => {
        if (mode === "reject") {
          requests[0]!.reject(new Error("Network is down"));
        } else {
          requests[0]!.fail(503, "Network is down");
        }
      });
      expect(text("sm-status")).toBe("error");
      expect(text("sm-error")).toBe("Network is down");
      expect(text("sm-entities")).toBe("");
      expect(text("sm-loaded-at")).toBe("");
      autoRespond = true;
      fireEvent.click(
        screen.getByRole("button", { name: "Retry service map" }),
      );
      await waitFor(() => {
        expect(text("sm-status")).toBe("ready");
      });
      expect(text("sm-entities")).toBe("service map #2");
    },
  );

  test("a retry supersedes a still-pending attempt of the same tab", async () => {
    autoRespond = false;
    render(<Probe range={FIRST_RANGE} view="Service Map" />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Retry service map" }));
    await flush();
    expect(requests).toHaveLength(2);
    expect(requests[0]!.signal?.aborted).toBe(true);
    await act(async () => {
      requests[1]!.respond(
        serviceMapPayload(requests[1]!.rangeStart, "retry result"),
      );
    });
    await act(async () => {
      requests[0]!.reject(new Error("Original attempt failed"));
    });
    expect(text("sm-entities")).toBe("retry result");
    expect(text("sm-error")).toBe("");
    expect(text("generation")).toBe("1");
  });

  test.each([
    ["a newer payload format", "version"],
    ["a server without the endpoint (404)", "404"],
  ])(
    "%s is reported as an outdated page, not a transient failure",
    async (_label: string, mode: string) => {
      autoRespond = false;
      render(<Probe range={FIRST_RANGE} view="Service Map" />);
      await flush();
      await act(async () => {
        if (mode === "version") {
          requests[0]!.respond(
            serviceMapPayload(requests[0]!.rangeStart, "future", {
              formatVersion: TOPOLOGY_API_FORMAT_VERSION + 1,
            }),
          );
        } else {
          requests[0]!.fail(404, "Not found");
        }
      });
      expect(text("sm-status")).toBe("error");
      expect(text("sm-outdated")).toBe("true");
      expect(text("sm-error")).toBe("Topology was updated. Reload the page.");
      expect(text("sm-entities")).toBe("");
    },
  );
});

describe("a relative range drifts while a tab waits to be opened", () => {
  /*
   * Only Date is faked: promises, timers and Testing Library's polling keep
   * running for real.
   */
  function fakeClock(now: string): void {
    jest.useFakeTimers({
      now: new Date(now),
      doNotFake: [
        "hrtime",
        "nextTick",
        "performance",
        "queueMicrotask",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
      ],
    });
  }

  test("opening a tab more than 5 minutes after a relative pin re-pins both tabs", async () => {
    fakeClock("2026-09-02T12:00:00.000Z");
    const view: ReturnType<typeof render> = render(
      <Probe range={LAST_HOUR} view="Service Map" />,
    );
    await waitFor(() => {
      expect(text("sm-status")).toBe("ready");
    });
    expect(requests[0]!.rangeStart).toBe("2026-09-02T11:00:00.000Z");

    jest.setSystemTime(
      new Date(
        new Date("2026-09-02T12:00:00.000Z").getTime() +
          TOPOLOGY_RANGE_REPIN_AFTER_MS +
          60 * 1000,
      ),
    );
    view.rerender(<Probe range={LAST_HOUR} view="Infrastructure" />);
    await waitFor(() => {
      expect(text("infra-status")).toBe("ready");
    });
    expect(text("generation")).toBe("2");
    expect(lastRequestTo(TopologyApiPath.Infrastructure).rangeStart).toBe(
      "2026-09-02T11:06:00.000Z",
    );
    /* The Service Map was drawn for the old window: it is dropped too. */
    expect(text("sm-status")).toBe("idle");
    view.rerender(<Probe range={LAST_HOUR} view="Service Map" />);
    await waitFor(() => {
      expect(text("sm-status")).toBe("ready");
    });
    expect(lastRequestTo(TopologyApiPath.ServiceMap).rangeStart).toBe(
      "2026-09-02T11:06:00.000Z",
    );
    expect(text("generation")).toBe("2");
  });

  test("within 5 minutes the lazy tab reuses the pinned range", async () => {
    fakeClock("2026-09-02T12:00:00.000Z");
    const view: ReturnType<typeof render> = render(
      <Probe range={LAST_HOUR} view="Service Map" />,
    );
    await waitFor(() => {
      expect(text("sm-status")).toBe("ready");
    });
    jest.setSystemTime(new Date("2026-09-02T12:04:59.000Z"));
    view.rerender(<Probe range={LAST_HOUR} view="Infrastructure" />);
    await waitFor(() => {
      expect(text("infra-status")).toBe("ready");
    });
    expect(text("generation")).toBe("1");
    expect(lastRequestTo(TopologyApiPath.Infrastructure).rangeStart).toBe(
      "2026-09-02T11:00:00.000Z",
    );
    expect(text("sm-status")).toBe("ready");
  });

  test("a custom range never drifts", async () => {
    fakeClock("2026-09-02T12:00:00.000Z");
    const view: ReturnType<typeof render> = render(
      <Probe range={FIRST_RANGE} view="Service Map" />,
    );
    await waitFor(() => {
      expect(text("sm-status")).toBe("ready");
    });
    jest.setSystemTime(new Date("2026-09-02T15:00:00.000Z"));
    view.rerender(<Probe range={FIRST_RANGE} view="Infrastructure" />);
    await waitFor(() => {
      expect(text("infra-status")).toBe("ready");
    });
    expect(text("generation")).toBe("1");
    expect(text("sm-status")).toBe("ready");
  });

  test("a drifted retry re-pins instead of loading the old window", async () => {
    fakeClock("2026-09-02T12:00:00.000Z");
    autoRespond = false;
    render(<Probe range={LAST_HOUR} view="Service Map" />);
    await flush();
    await act(async () => {
      requests[0]!.fail(500, "Please retry");
    });
    expect(text("sm-status")).toBe("error");
    autoRespond = true;
    jest.setSystemTime(new Date("2026-09-02T12:10:00.000Z"));
    fireEvent.click(screen.getByRole("button", { name: "Retry service map" }));
    await waitFor(() => {
      expect(text("sm-status")).toBe("ready");
    });
    expect(text("generation")).toBe("2");
    expect(requests[1]!.rangeStart).toBe("2026-09-02T11:10:00.000Z");
  });
});
