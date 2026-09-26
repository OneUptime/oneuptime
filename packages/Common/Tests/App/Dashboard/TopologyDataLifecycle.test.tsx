import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import type { SpyInstance } from "jest-mock";
import getJestMockFunction, { MockFunction } from "../../MockType";
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
  TopologyData,
  TopologyView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/UseTopologyData";
import { TopologyEntity } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";

/*
 * useTopologyData's lifecycle edges that TopologyDataLoading does not reach:
 *
 *   - React 18 StrictMode mounts, unmounts and re-mounts every effect in
 *     development. The hook must come out of that with exactly ONE live
 *     request per tab (the discarded one aborted, its answer ignored), not
 *     two loads racing to write the same tab.
 *   - Unmounting with BOTH tabs in flight aborts both, and nothing that
 *     arrives afterwards writes state or logs.
 *   - A project change mid-flight — including one that returns to the first
 *     project, or loses the project altogether — never lets one project's
 *     payload appear under another, and aborts the background tab too.
 *
 * Same seam as TopologyDataLoading: API.post answered by a fake server that
 * records every request and answers when the test says so.
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

const PROJECT_ONE: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_TWO: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-09-01T09:15:00.000Z"),
    new Date("2026-09-01T10:15:00.000Z"),
  ),
};

interface PostOptions {
  url: URL;
  data: JSONObject;
  headers: Dictionary<string>;
  options?: { signal?: AbortSignal };
}

interface RecordedRequest {
  path: string;
  rangeStart: string;
  /* The `fresh` flag as sent; undefined when the body had none. */
  fresh: unknown;
  tenant: string;
  signal: AbortSignal | undefined;
  respond: (payload: JSONObject) => void;
  reject: (error: Error) => void;
}

let requests: Array<RecordedRequest> = [];
let autoRespond: boolean = false;

function pathOf(url: URL): string {
  return url.toString().replace(/^.*\/api(?=\/)/, "");
}

function requestsTo(path: TopologyApiPath): Array<RecordedRequest> {
  return requests.filter((request: RecordedRequest): boolean => {
    return request.path === path;
  });
}

function live(list: Array<RecordedRequest>): Array<RecordedRequest> {
  return list.filter((request: RecordedRequest): boolean => {
    return !request.signal?.aborted;
  });
}

function serviceMapPayload(rangeStart: string, name: string): JSONObject {
  return {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: rangeStart,
    generatedAt: "2026-09-01T10:15:30.000Z",
    entities: [
      {
        key: `service:${name}`,
        type: EntityType.Service,
        name: name,
        source: "discovered",
        lastSeenAt: null,
      },
    ],
    dependencies: [],
    runsOn: [],
    entityTruncation: null,
    dependencyTruncation: null,
  };
}

function infrastructurePayload(rangeStart: string, name: string): JSONObject {
  return {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: rangeStart,
    generatedAt: "2026-09-01T10:15:30.000Z",
    nodes: [
      {
        key: `host:${name}`,
        type: EntityType.Host,
        name: name,
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

function payloadFor(request: RecordedRequest, name: string): JSONObject {
  return request.path === TopologyApiPath.ServiceMap
    ? serviceMapPayload(request.rangeStart, name)
    : infrastructurePayload(request.rangeStart, name);
}

function installFakeServer(): void {
  postMock.mockImplementation((...args: Array<unknown>) => {
    const options: PostOptions = args[0] as PostOptions;
    return new Promise(
      (
        resolve: (value: HTTPResponse<JSONObject>) => void,
        reject: (error: Error) => void,
      ): void => {
        const request: RecordedRequest = {
          path: pathOf(options.url),
          rangeStart: String(options.data["rangeStart"]),
          fresh: options.data["fresh"],
          tenant: String(options.headers["tenantid"]),
          signal: options.options?.signal,
          respond: (payload: JSONObject): void => {
            resolve(new HTTPResponse<JSONObject>(200, payload, {}));
          },
          reject: reject,
        };
        requests.push(request);
        if (autoRespond) {
          request.respond(
            payloadFor(
              request,
              `${request.path === TopologyApiPath.ServiceMap ? "service map" : "infrastructure"} #${requestsTo(request.path as TopologyApiPath).length}`,
            ),
          );
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
      <span data-testid="sm-status">{data.serviceMap.status}</span>
      <span data-testid="sm-error">{data.serviceMap.error?.message || ""}</span>
      <span data-testid="sm-entities">
        {names(data.serviceMap.data?.entities)}
      </span>
      <span data-testid="infra-status">{data.infrastructure.status}</span>
      <span data-testid="infra-entities">
        {names(data.infrastructure.data?.entities)}
      </span>
    </div>
  );
}

function StrictProbe(props: { view: TopologyView }): React.ReactElement {
  return (
    <React.StrictMode>
      <Probe range={RANGE} view={props.view} />
    </React.StrictMode>
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

let consoleError: SpyInstance<(...data: Array<unknown>) => void>;

/*
 * console.error calls other than the testing library's own one-time
 * "ReactDOMTestUtils.act is deprecated" notice, which lands in whichever
 * test first calls act().
 */
function unexpectedConsoleErrors(): Array<string> {
  return consoleError.mock.calls
    .map((call: Array<unknown>): string => {
      return call.map(String).join(" ");
    })
    .filter((message: string): boolean => {
      return !message.includes("ReactDOMTestUtils.act");
    });
}

beforeEach(() => {
  requests = [];
  autoRespond = false;
  postMock.mockReset();
  getProjectIdMock.mockReset();
  getProjectIdMock.mockReturnValue(PROJECT_ONE);
  installFakeServer();
  consoleError = jest.spyOn(console, "error");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("StrictMode's double mount", () => {
  test("leaves exactly one live request for the active tab, and only its answer lands", async () => {
    render(<StrictProbe view="Service Map" />);
    await flush();

    const serviceMap: Array<RecordedRequest> = requestsTo(
      TopologyApiPath.ServiceMap,
    );
    /*
     * React 18 replays mount effects under StrictMode in development, so the
     * hook really did start twice: the first load is aborted, the second is
     * the one that counts.
     */
    expect(serviceMap).toHaveLength(2);
    expect(serviceMap[0]!.signal?.aborted).toBe(true);
    expect(live(serviceMap)).toEqual([serviceMap[1]]);
    expect(serviceMap[1]!.rangeStart).toBe(serviceMap[0]!.rangeStart);
    expect(requestsTo(TopologyApiPath.Infrastructure)).toHaveLength(0);
    /*
     * The replayed mount is not the user's refresh: neither load may make
     * the server skip its response cache.
     */
    expect(
      serviceMap.map((request: RecordedRequest): unknown => {
        return request.fresh;
      }),
    ).toEqual([undefined, undefined]);

    /* The discarded mount's answer arriving first changes nothing... */
    await act(async () => {
      serviceMap[0]!.respond(
        serviceMapPayload(serviceMap[0]!.rangeStart, "discarded mount"),
      );
    });
    expect(text("sm-status")).toBe("loading");
    expect(text("sm-entities")).toBe("");

    /* ...and the live one is what the tab shows. */
    await act(async () => {
      serviceMap[1]!.respond(
        serviceMapPayload(serviceMap[1]!.rangeStart, "live mount"),
      );
    });
    expect(text("sm-status")).toBe("ready");
    expect(text("sm-entities")).toBe("live mount");
  });

  test("opening and revisiting tabs afterwards still loads each tab once", async () => {
    autoRespond = true;
    const view: ReturnType<typeof render> = render(
      <StrictProbe view="Service Map" />,
    );
    await flush();
    const serviceMapRequests: number = requestsTo(
      TopologyApiPath.ServiceMap,
    ).length;

    view.rerender(<StrictProbe view="Infrastructure" />);
    await flush();
    view.rerender(<StrictProbe view="Service Map" />);
    await flush();
    view.rerender(<StrictProbe view="Infrastructure" />);
    await flush();

    /* Updates are not replayed: one Infrastructure load, no Service Map reload. */
    expect(requestsTo(TopologyApiPath.Infrastructure)).toHaveLength(1);
    expect(
      requestsTo(TopologyApiPath.Infrastructure)[0]!.fresh,
    ).toBeUndefined();
    expect(requestsTo(TopologyApiPath.ServiceMap)).toHaveLength(
      serviceMapRequests,
    );
    expect(text("infra-status")).toBe("ready");
    expect(text("infra-entities")).toBe("infrastructure #1");
    expect(text("sm-status")).toBe("ready");
    /* Both tabs describe the same pinned moment. */
    expect(
      new Set<string>(
        live(requests).map((request: RecordedRequest): string => {
          return request.rangeStart;
        }),
      ).size,
    ).toBe(1);
  });

  test("unmounting under StrictMode aborts every request it made", async () => {
    const view: ReturnType<typeof render> = render(
      <StrictProbe view="Service Map" />,
    );
    await flush();
    view.rerender(<StrictProbe view="Infrastructure" />);
    await flush();
    expect(live(requests)).toHaveLength(2);

    view.unmount();

    expect(live(requests)).toHaveLength(0);
  });
});

describe("unmounting", () => {
  test("aborts both tabs' requests, and nothing that arrives afterwards writes or logs", async () => {
    const view: ReturnType<typeof render> = render(
      <Probe range={RANGE} view="Service Map" />,
    );
    await flush();
    view.rerender(<Probe range={RANGE} view="Infrastructure" />);
    await flush();
    const [serviceMap, infrastructure]: Array<RecordedRequest> = requests;
    expect(requests).toHaveLength(2);
    expect(serviceMap!.signal?.aborted).toBe(false);
    expect(infrastructure!.signal?.aborted).toBe(false);

    /* Only what happens from here on is under test. */
    consoleError.mockClear();
    view.unmount();

    expect(serviceMap!.signal?.aborted).toBe(true);
    expect(infrastructure!.signal?.aborted).toBe(true);

    await act(async () => {
      serviceMap!.respond(
        serviceMapPayload(serviceMap!.rangeStart, "after unmount"),
      );
      infrastructure!.reject(new Error("Request Canceled."));
    });
    await flush();

    /* No retry, no reload, and no React warning about the dead component. */
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(unexpectedConsoleErrors()).toEqual([]);
  });
});

describe("a project change mid-flight", () => {
  test("drops the old project's ready tab, aborts its background load, and reloads only the active tab for the new project", async () => {
    autoRespond = true;
    const view: ReturnType<typeof render> = render(
      <Probe range={RANGE} view="Service Map" />,
    );
    await flush();
    expect(text("sm-entities")).toBe("service map #1");

    /* Infrastructure starts loading, then the reader goes back. */
    autoRespond = false;
    view.rerender(<Probe range={RANGE} view="Infrastructure" />);
    await flush();
    view.rerender(<Probe range={RANGE} view="Service Map" />);
    await flush();
    const backgroundInfrastructure: RecordedRequest = requestsTo(
      TopologyApiPath.Infrastructure,
    )[0]!;
    expect(backgroundInfrastructure.tenant).toBe(PROJECT_ONE.toString());
    expect(text("infra-status")).toBe("loading");

    getProjectIdMock.mockReturnValue(PROJECT_TWO);
    view.rerender(<Probe range={RANGE} view="Service Map" />);
    await flush();

    expect(backgroundInfrastructure.signal?.aborted).toBe(true);
    const serviceMap: Array<RecordedRequest> = requestsTo(
      TopologyApiPath.ServiceMap,
    );
    expect(serviceMap).toHaveLength(2);
    expect(serviceMap[1]!.tenant).toBe(PROJECT_TWO.toString());
    /* Project one's map is gone while project two's loads. */
    expect(text("sm-status")).toBe("loading");
    expect(text("sm-entities")).toBe("");
    /* The background tab is dropped, not reloaded behind the reader's back. */
    expect(text("infra-status")).toBe("idle");
    expect(requestsTo(TopologyApiPath.Infrastructure)).toHaveLength(1);

    await act(async () => {
      backgroundInfrastructure.respond(
        infrastructurePayload(
          backgroundInfrastructure.rangeStart,
          "project one infrastructure",
        ),
      );
    });
    expect(text("infra-status")).toBe("idle");
    expect(text("infra-entities")).toBe("");

    await act(async () => {
      serviceMap[1]!.respond(
        serviceMapPayload(serviceMap[1]!.rangeStart, "project two map"),
      );
    });
    expect(text("sm-entities")).toBe("project two map");

    /* Opening Infrastructure now loads it for project two. */
    view.rerender(<Probe range={RANGE} view="Infrastructure" />);
    await flush();
    const infrastructure: Array<RecordedRequest> = requestsTo(
      TopologyApiPath.Infrastructure,
    );
    expect(infrastructure).toHaveLength(2);
    expect(infrastructure[1]!.tenant).toBe(PROJECT_TWO.toString());
  });

  test("going to another project and back before anything answers shows only the latest request's answer", async () => {
    const view: ReturnType<typeof render> = render(
      <Probe range={RANGE} view="Service Map" />,
    );
    await flush();
    getProjectIdMock.mockReturnValue(PROJECT_TWO);
    view.rerender(<Probe range={RANGE} view="Service Map" />);
    await flush();
    getProjectIdMock.mockReturnValue(PROJECT_ONE);
    view.rerender(<Probe range={RANGE} view="Service Map" />);
    await flush();

    expect(
      requests.map((request: RecordedRequest): string => {
        return request.tenant;
      }),
    ).toEqual([
      PROJECT_ONE.toString(),
      PROJECT_TWO.toString(),
      PROJECT_ONE.toString(),
    ]);
    expect(live(requests)).toEqual([requests[2]]);

    /*
     * The first request is for the SAME project as the current one — but an
     * older generation, so its answer must still be ignored.
     */
    await act(async () => {
      requests[0]!.respond(
        serviceMapPayload(requests[0]!.rangeStart, "first visit"),
      );
      requests[1]!.respond(
        serviceMapPayload(requests[1]!.rangeStart, "project two"),
      );
    });
    expect(text("sm-status")).toBe("loading");
    expect(text("sm-entities")).toBe("");

    await act(async () => {
      requests[2]!.respond(
        serviceMapPayload(requests[2]!.rangeStart, "second visit"),
      );
    });
    expect(text("sm-entities")).toBe("second visit");
  });

  test("losing the project mid-flight aborts the request and asks for a project without sending another", async () => {
    const view: ReturnType<typeof render> = render(
      <Probe range={RANGE} view="Service Map" />,
    );
    await flush();
    expect(requests).toHaveLength(1);

    getProjectIdMock.mockReturnValue(null);
    view.rerender(<Probe range={RANGE} view="Service Map" />);
    await flush();

    expect(requests[0]!.signal?.aborted).toBe(true);
    expect(requests).toHaveLength(1);
    expect(text("sm-status")).toBe("error");
    expect(text("sm-error")).toContain("Select a project");

    /* The aborted answer cannot resurrect the other project's map. */
    await act(async () => {
      requests[0]!.respond(
        serviceMapPayload(requests[0]!.rangeStart, "project one"),
      );
    });
    expect(text("sm-status")).toBe("error");
    expect(text("sm-entities")).toBe("");

    /* A project arriving loads normally, scoped to it. */
    autoRespond = true;
    getProjectIdMock.mockReturnValue(PROJECT_TWO);
    view.rerender(<Probe range={RANGE} view="Service Map" />);
    await flush();
    expect(requests).toHaveLength(2);
    expect(requests[1]!.tenant).toBe(PROJECT_TWO.toString());
    expect(text("sm-status")).toBe("ready");
  });
});
