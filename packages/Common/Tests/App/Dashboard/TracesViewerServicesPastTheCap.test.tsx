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
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

/*
 * THE TRACES EXPLORER'S SERVICES, PAST THE PROJECT'S FIRST 10,000 (#10921).
 *
 * The explorer read the project's first 10,000 services by name - and its
 * first 10,000 hosts, Docker and Podman hosts and Kubernetes clusters - to
 * name its span rows and its facets: a span whose service sorted past them
 * read "unknown service", its colour lost. The spans' and the Service
 * facet's services are read by their ids now, each once, as they land.
 * ModelAPI answers the services from a project faked whole
 * (CappedListServer); the spans are stood in for.
 */

const viewerProbe: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      viewerProbe(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
      },
      getFriendlyErrorMessage: () => {
        return "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
      formatDurationMsInLanguage: (ms: number) => {
        return `${ms} ms`;
      },
    };
  },
);

import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import TracesViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer";
import Span from "../../../Models/AnalyticsModels/Span";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const LATE_ID: string = "a1000000-0000-4000-8000-0000000000aa";
const FACET_LATE_ID: string = "a1000000-0000-4000-8000-0000000000ab";

let server: CappedListServer;
let spans: Array<Span>;
let facetsResponse: Record<string, unknown> | null;

function spanOf(spanId: string, serviceId: string): Span {
  return Object.assign(new Span(), {
    spanId: spanId,
    traceId: `trace-${spanId}`,
    name: `GET /checkout/${spanId}`,
    primaryEntityId: new ObjectID(serviceId),
    startTime: new Date("2026-11-24T10:00:00.000Z"),
    endTime: new Date("2026-11-24T10:00:01.000Z"),
    durationUnixNano: 1_000_000_000,
    statusCode: 0,
    kind: "SPAN_KIND_SERVER",
  });
}

function lastViewerProps(): any {
  const calls: Array<Array<unknown>> = viewerProbe.mock.calls;
  return calls[calls.length - 1]![0];
}

function serviceReads(): Array<CappedListCall> {
  return server.callsFor(Service);
}

function idsIn(value: unknown): Array<string> {
  return value instanceof Includes
    ? value.values.map((entry: unknown): string => {
        return String(entry).toLowerCase();
      })
    : [];
}

beforeEach(() => {
  TelemetryEntityNameResolver.clearCache();
  window.history.replaceState({}, "", "/");
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));

  server = new CappedListServer();
  server.add(
    Service,
    namesSortingFirst(LIMIT_PER_PROJECT + 50).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Service, [
    { _id: LATE_ID, name: "wbkiosk-payments", serviceColor: "#22c55e" },
    { _id: FACET_LATE_ID, name: "wbkiosk-login", serviceColor: "#f59e0b" },
  ]);

  spans = [];
  facetsResponse = null;

  getListMock.mockReset();
  getListMock.mockImplementation(async (...args: Array<any>) => {
    const options: any = args[0];

    if (options.modelType === Service) {
      return server.list(options);
    }

    return { data: [], count: 0 };
  });
  analyticsGetListMock.mockReset();
  analyticsGetListMock.mockImplementation(async () => {
    return { data: spans, count: spans.length };
  });
  apiPostMock.mockReset();
  apiPostMock.mockImplementation(async (args: any) => {
    if (
      facetsResponse &&
      String(args.url).includes("/telemetry/traces/facets")
    ) {
      return { data: { facets: facetsResponse } };
    }

    return { data: {} };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderViewer(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <TracesViewer />
      </MemoryRouter>,
    );
  });
}

describe("Traces explorer: services past the project's first 10,000", () => {
  test("a span's service past the 10,000th is named in its row, read by its id", async () => {
    spans = [spanOf("s1", LATE_ID)];

    await renderViewer();

    await waitFor(() => {
      expect(
        serviceReads().some((call: CappedListCall): boolean => {
          return idsIn(call.query["_id"]).includes(LATE_ID);
        }),
      ).toBe(true);
    });

    await waitFor(() => {
      cleanup();
      render(
        <MemoryRouter>{lastViewerProps().renderRow(spans[0])}</MemoryRouter>,
      );
      expect(screen.getAllByText("wbkiosk-payments").length).toBeGreaterThan(0);
    });
  });

  test("the Service facet's values past the 10,000th are named and coloured, read by their ids", async () => {
    facetsResponse = {
      primaryEntityId: [{ value: FACET_LATE_ID, count: 9 }],
    };

    await renderViewer();

    await waitFor(() => {
      const serviceFacet: any = lastViewerProps().facetConfigs.find(
        (config: { key: string }) => {
          return config.key === "primaryEntityId";
        },
      );

      expect(serviceFacet.valueDisplayMap[FACET_LATE_ID]).toBe("wbkiosk-login");
      expect(serviceFacet.valueColorMap[FACET_LATE_ID]).toBe("#f59e0b");
    });
  });

  test("each service is read once by id; the project's services, hosts and clusters never whole", async () => {
    spans = [spanOf("s1", LATE_ID), spanOf("s2", LATE_ID)];
    facetsResponse = {
      primaryEntityId: [{ value: LATE_ID, count: 2 }],
    };

    await renderViewer();

    await waitFor(() => {
      expect(serviceReads().length).toBeGreaterThan(0);
    });

    const asked: Array<string> = serviceReads().flatMap(
      (call: CappedListCall): Array<string> => {
        return idsIn(call.query["_id"]);
      },
    );

    expect(
      asked.filter((id: string): boolean => {
        return id === LATE_ID;
      }),
    ).toHaveLength(1);

    for (const call of getListMock.mock.calls) {
      const options: any = call[0];

      if (
        [Service, Host, DockerHost, PodmanHost, KubernetesCluster].includes(
          options.modelType,
        )
      ) {
        expect(options.query._id).toBeInstanceOf(Includes);
        expect(options.limit).toBeLessThan(LIMIT_PER_PROJECT);
      }
    }
  });
});
