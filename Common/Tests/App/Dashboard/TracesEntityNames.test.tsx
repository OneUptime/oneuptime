import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * On a RUM application's traces tab the explorer is scoped by the
 * RumApplication id. It used to resolve that id against the Service table
 * only, so the locked chip read "Service: 84858d6c-…" and every row's pill
 * read "unknown service".
 *
 * This mounts the REAL TracesViewer — with the heavy TelemetryViewer shell
 * replaced by a probe that records the props it is handed — against mocked
 * APIs, and asserts what the user reads: the chips the shell is given, the
 * row TracesViewer renders for a span, and the span panel. The entity-name
 * lookup runs for real (TelemetryEntityNameResolver over the mocked
 * ModelAPI), so the typeHints wiring is exercised too.
 */

const viewerProbe: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
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
      formatDurationMs: (ms: number) => {
        return `${ms} ms`;
      },
    };
  },
);

import TracesViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer";
import TraceRow from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceRow";
import SpanDetailsPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/SpanDetailsPanel";
import Span from "../../../Models/AnalyticsModels/Span";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Service from "../../../Models/DatabaseModels/Service";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import { ActiveFilter } from "../../../UI/Components/TelemetryViewer/types";
import TelemetryEntityNameResolver, {
  ResolvedTelemetryEntity,
  TelemetryEntityNameMap,
} from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import Host from "../../../Models/DatabaseModels/Host";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const RUM_ID: string = "84858d6c-3333-4333-8333-333333333333";

type ModelListArgs = { modelType: unknown; query?: any };

const buildService: () => Service = (): Service => {
  const service: Service = new Service();
  service.id = new ObjectID(SERVICE_ID);
  service.name = "checkout-api";
  service.serviceColor = new Color("#ff0000");
  return service;
};

const buildRumApplication: () => RumApplication = (): RumApplication => {
  const app: RumApplication = new RumApplication();
  app.id = new ObjectID(RUM_ID);
  app.name = "checkout-web";
  return app;
};

const buildSpan: (spanId: string, entityId: string, name: string) => Span = (
  spanId: string,
  entityId: string,
  name: string,
): Span => {
  const span: Span = new Span();
  span.spanId = spanId;
  span.traceId = `trace-${spanId}`;
  span.name = name;
  span.primaryEntityId = new ObjectID(entityId);
  span.durationUnixNano = 1_000_000;
  return span;
};

type LastViewerPropsFunction = () => any;

const lastViewerProps: LastViewerPropsFunction = (): any => {
  const calls: Array<Array<any>> = viewerProbe.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0];
};

type ChipTextsFunction = () => Array<string>;

const chipTexts: ChipTextsFunction = (): Array<string> => {
  return (lastViewerProps().activeFilters as Array<ActiveFilter>).map(
    (filter: ActiveFilter): string => {
      return `${filter.displayKey}: ${filter.displayValue}`;
    },
  );
};

/*
 * Mirrors what the tables hold: the explorer lists Services / Hosts / …
 * (no RUM row there), and the entity resolver reads RumApplication by id.
 */
const installModelApi: (options?: { rumFails?: boolean }) => void = (
  options: { rumFails?: boolean } = {},
): void => {
  getListMock.mockImplementation(async (args: ModelListArgs) => {
    if (args.modelType === Service) {
      return { data: [buildService()], count: 1 };
    }
    if (args.modelType === RumApplication) {
      if (options.rumFails) {
        throw new Error("forbidden");
      }
      return { data: [buildRumApplication()], count: 1 };
    }
    return { data: [], count: 0 };
  });
};

const rumListCalls: () => Array<ModelListArgs> = (): Array<ModelListArgs> => {
  return getListMock.mock.calls
    .map((call: Array<any>): ModelListArgs => {
      return call[0] as ModelListArgs;
    })
    .filter((args: ModelListArgs): boolean => {
      return args.modelType === RumApplication;
    });
};

describe("TracesViewer names non-Service entities", () => {
  beforeEach(() => {
    TelemetryEntityNameResolver.clearCache();
    getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
    apiPostMock.mockImplementation(async () => {
      return { data: {} };
    });
    analyticsGetListMock.mockImplementation(async () => {
      return {
        data: [
          buildSpan("rum-span", RUM_ID, "GET /checkout"),
          buildSpan("svc-span", SERVICE_ID, "POST /pay"),
        ],
        count: 2,
      };
    });
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test("REGRESSION: a RUM application's locked chip reads 'RUM Application: <name>'", async () => {
    installModelApi();

    render(
      <TracesViewer
        primaryEntityId={new ObjectID(RUM_ID)}
        scopeEntityType={ServiceType.RealUserMonitor}
      />,
    );

    // The type label is right from the very first render.
    const firstChips: Array<ActiveFilter> = viewerProbe.mock.calls[0]![0]
      .activeFilters as Array<ActiveFilter>;
    expect(firstChips[0]).toMatchObject({
      facetKey: "primaryEntityId",
      value: RUM_ID,
      displayKey: "RUM Application",
      readOnly: true,
    });

    await waitFor(() => {
      expect(chipTexts()).toContain("RUM Application: checkout-web");
    });

    expect(chipTexts().join(" | ")).not.toContain(RUM_ID);
    expect(chipTexts().join(" | ")).not.toContain("Service:");

    // The hinted id went straight to its own table.
    expect(rumListCalls().length).toBeGreaterThan(0);
    const rumQuery: any = rumListCalls()[0]!.query;
    expect(JSON.stringify(rumQuery)).toContain(RUM_ID);
  });

  test("filtering still uses the id: the span list query carries the RumApplication id", async () => {
    installModelApi();

    render(
      <TracesViewer
        primaryEntityId={new ObjectID(RUM_ID)}
        scopeEntityType={ServiceType.RealUserMonitor}
      />,
    );

    await waitFor(() => {
      expect(analyticsGetListMock).toHaveBeenCalled();
    });

    const query: any = (analyticsGetListMock.mock.calls[0]![0] as any).query;
    expect(query.primaryEntityId.toString()).toBe(RUM_ID);

    await waitFor(() => {
      expect(chipTexts()).toContain("RUM Application: checkout-web");
    });

    const scopeChip: ActiveFilter = (
      lastViewerProps().activeFilters as Array<ActiveFilter>
    )[0]!;
    expect(scopeChip.value).toBe(RUM_ID);
  });

  test("without scopeEntityType the resolved entity's own type still labels the chip", async () => {
    installModelApi();

    render(<TracesViewer primaryEntityId={new ObjectID(RUM_ID)} />);

    await waitFor(() => {
      expect(chipTexts()).toContain("RUM Application: checkout-web");
    });
  });

  test("a Service page is unchanged: 'Service: <service name>'", async () => {
    installModelApi();

    render(<TracesViewer primaryEntityId={new ObjectID(SERVICE_ID)} />);

    await waitFor(() => {
      expect(chipTexts()).toContain("Service: checkout-api");
    });
  });

  test("a failed lookup leaves the declared type with the id rather than throwing", async () => {
    installModelApi({ rumFails: true });

    /*
     * Record every lookup the viewer starts so the assertion runs only after
     * ALL of them have settled. Asserting as soon as the hinted RumApplication
     * request went out would pass even if a later step of the resolution (the
     * fall-through across the other tables) put a wrong name on the chip.
     */
    const lookups: Array<Promise<TelemetryEntityNameMap>> = [];
    const originalResolve: typeof TelemetryEntityNameResolver.resolve =
      TelemetryEntityNameResolver.resolve.bind(TelemetryEntityNameResolver);
    const resolveSpy: { mockRestore: () => void } = jest
      .spyOn(TelemetryEntityNameResolver, "resolve")
      .mockImplementation(
        (
          ...args: Parameters<typeof TelemetryEntityNameResolver.resolve>
        ): Promise<TelemetryEntityNameMap> => {
          const lookup: Promise<TelemetryEntityNameMap> = originalResolve(
            ...args,
          );
          lookups.push(lookup);
          return lookup;
        },
      );

    try {
      render(
        <TracesViewer
          primaryEntityId={new ObjectID(RUM_ID)}
          scopeEntityType={ServiceType.RealUserMonitor}
        />,
      );

      // The span list has landed, so the span ids have joined the lookup too.
      await waitFor(() => {
        expect((lastViewerProps().items as Array<Span>).length).toBe(2);
        expect(lookups.length).toBeGreaterThan(0);
      });

      // Drain: settling one lookup can re-render and start another.
      let settled: number = 0;
      while (settled < lookups.length) {
        const pending: Array<Promise<TelemetryEntityNameMap>> =
          lookups.slice(settled);
        settled = lookups.length;
        await act(async () => {
          const results: Array<TelemetryEntityNameMap> =
            await Promise.all(pending);
          for (const result of results) {
            expect(result[RUM_ID]).toBeUndefined();
          }
        });
      }

      // The hinted table failed, and the fall-through searched the others.
      expect(rumListCalls().length).toBeGreaterThan(0);
      expect(
        getListMock.mock.calls.some((call: Array<any>): boolean => {
          const args: ModelListArgs = call[0] as ModelListArgs;
          return (
            args.modelType === Host &&
            JSON.stringify(args.query).includes(RUM_ID)
          );
        }),
      ).toBe(true);

      expect(chipTexts()[0]).toBe(`RUM Application: ${RUM_ID}`);
    } finally {
      resolveSpy.mockRestore();
    }
  });

  test("locked attribute chips show the display override but keep the filter value", async () => {
    installModelApi();

    render(
      <TracesViewer
        attributeFilters={{ "resource.k8s.cluster.name": "prod-eu-1-7f3a" }}
        attributeFilterDisplayKeys={{ "resource.k8s.cluster.name": "Cluster" }}
        attributeFilterDisplayValues={{
          "resource.k8s.cluster.name": "Production EU",
        }}
      />,
    );

    await waitFor(() => {
      expect(analyticsGetListMock).toHaveBeenCalled();
    });

    const chips: Array<ActiveFilter> = lastViewerProps()
      .activeFilters as Array<ActiveFilter>;
    const clusterChip: ActiveFilter | undefined = chips.find(
      (chip: ActiveFilter): boolean => {
        return chip.facetKey === "attributes.resource.k8s.cluster.name";
      },
    );

    /*
     * A partial match: the chip also carries its explanation (lockedDetail),
     * which is display-only and pinned by its own suites. What this test
     * protects is that the override changes the label and never the filter.
     */
    expect(clusterChip).toMatchObject({
      facetKey: "attributes.resource.k8s.cluster.name",
      value: "prod-eu-1-7f3a",
      displayKey: "Cluster",
      displayValue: "Production EU",
      readOnly: true,
    });

    /*
     * The explanation must describe the FILTER (the identifier the rows
     * carry), not the friendly name the chip shows — a reader copying the
     * search syntax needs the value that matches.
     */
    expect(clusterChip?.lockedDetail?.searchToken).toBe(
      "@resource.k8s.cluster.name:prod-eu-1-7f3a",
    );
    expect(clusterChip?.lockedDetail?.predicates[0]?.expression).toBe(
      'resource.k8s.cluster.name = "prod-eu-1-7f3a"',
    );
  });

  test("REGRESSION: span rows name a RUM application instead of 'unknown service'", async () => {
    installModelApi();

    render(
      <TracesViewer
        primaryEntityId={new ObjectID(RUM_ID)}
        scopeEntityType={ServiceType.RealUserMonitor}
      />,
    );

    await waitFor(() => {
      expect((lastViewerProps().items as Array<Span>).length).toBe(2);
      expect(chipTexts()).toContain("RUM Application: checkout-web");
    });

    const renderRow: (span: Span) => React.ReactElement =
      lastViewerProps().renderRow;
    const items: Array<Span> = lastViewerProps().items as Array<Span>;

    cleanup();
    render(
      <div>
        {items.map((span: Span) => {
          return (
            <React.Fragment key={span.spanId}>{renderRow(span)}</React.Fragment>
          );
        })}
      </div>,
    );

    expect(
      screen.getByTitle("RUM Application: checkout-web"),
    ).toHaveTextContent("checkout-web");
    expect(screen.getByTitle("checkout-api")).toHaveTextContent("checkout-api");
    expect(screen.queryByText("unknown service")).not.toBeInTheDocument();
  });
});

describe("TraceRow", () => {
  const RUM_ENTITY: ResolvedTelemetryEntity = {
    id: RUM_ID,
    name: "checkout-web",
    entityType: ServiceType.RealUserMonitor,
    typeLabel: "RUM Application",
  };

  afterEach(() => {
    cleanup();
  });

  test("names a resolved non-Service entity", () => {
    render(
      <TraceRow
        span={buildSpan("a", RUM_ID, "GET /")}
        entity={RUM_ENTITY}
        maxDurationNano={1_000_000}
      />,
    );

    expect(screen.getByText("checkout-web")).toBeInTheDocument();
    expect(screen.queryByText("unknown service")).not.toBeInTheDocument();
  });

  test("a loaded Service wins over a resolved entity", () => {
    render(
      <TraceRow
        span={buildSpan("a", SERVICE_ID, "GET /")}
        service={buildService()}
        entity={{ ...RUM_ENTITY, id: SERVICE_ID }}
        maxDurationNano={1_000_000}
      />,
    );

    expect(screen.getByTitle("checkout-api")).toBeInTheDocument();
    expect(screen.queryByText("checkout-web")).not.toBeInTheDocument();
  });

  test("still reads 'unknown service' when nothing names the entity", () => {
    render(
      <TraceRow
        span={buildSpan("a", RUM_ID, "GET /")}
        maxDurationNano={1_000_000}
      />,
    );

    expect(screen.getByText("unknown service")).toBeInTheDocument();
  });
});

describe("SpanDetailsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  test("labels the overview row with the entity's type and name", async () => {
    // No spanId / sessionId: the lazy detail and replay lookups stay idle.
    const span: Span = new Span();
    span.name = "GET /checkout";
    span.primaryEntityId = new ObjectID(RUM_ID);

    await act(async () => {
      render(
        <SpanDetailsPanel
          span={span}
          entity={{
            id: RUM_ID,
            name: "checkout-web",
            entityType: ServiceType.RealUserMonitor,
            typeLabel: "RUM Application",
          }}
        />,
      );
    });

    expect(screen.getByText("RUM Application")).toBeInTheDocument();
    expect(screen.getAllByText(/checkout-web/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/unknown service/)).not.toBeInTheDocument();
  });

  test("a Service span keeps the 'Service' label", async () => {
    const span: Span = new Span();
    span.name = "POST /pay";
    span.primaryEntityId = new ObjectID(SERVICE_ID);

    await act(async () => {
      render(<SpanDetailsPanel span={span} service={buildService()} />);
    });

    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getAllByText(/checkout-api/).length).toBeGreaterThan(0);
  });
});
