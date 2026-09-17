import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Logs Insights "Top errors" rows named each pattern's sources from the
 * page's Service list only, so a pattern seen on a RUM application read
 * "2 sources · 84858d6c-…, payments-api" while the drawer it opened (and
 * the "Sources reporting logs" cards) named it "checkout-web".
 *
 * This renders the real panel fed the way LogsDashboard feeds it: the
 * displayed pattern ids go through collectLogsInsightsResourceRefs, the
 * Service-named ids are skipped, the rest are resolved with the generic
 * entity-name hook against a mocked ModelAPI, and the map reaches the panel
 * as `resourceNames`. The wiring inside LogsDashboard itself is pinned by
 * App/Tests/Dashboard/LogsEntityNamesWiring.test.ts.
 */

const getListMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrapper is load bearing: jest.mock is hoisted above the
 * compiled requires, so getListMock is still unassigned when the factory
 * runs.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

/*
 * The panel only needs two sentence builders from Utils/LogsInsights; the
 * real module pulls in the Dashboard's RouteMap, which this suite has no use
 * for.
 */
jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/LogsInsights", () => {
  return {
    __esModule: true,
    describeTimeRange: () => {
      return "the past 1 hour";
    },
    describeOccurrenceCount: (count: number) => {
      return `${count} times in the past 1 hour`;
    },
  };
});

import TopErrorsPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/TopErrorsPanel";
import {
  LogsResourceRef,
  buildLogsResourceTypeHints,
  collectLogsInsightsResourceRefs,
  collectLogsResourceIds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsResourceDisplay";
import { TopErrorPatternRow } from "../../../../App/FeatureSet/Dashboard/src/Utils/LogsInsights";
import useTelemetryEntityNames from "../../../UI/Utils/Telemetry/UseTelemetryEntityNames";
import TelemetryEntityNameResolver, {
  TelemetryEntityNameMap,
} from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import Service from "../../../Models/DatabaseModels/Service";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import TimeRange from "../../../Types/Time/TimeRange";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "9e1b6b0e-0000-4000-8000-000000000031";
const RUM_APP_ID: string = "84858d6c-0000-4000-8000-000000000031";
const SERVICE_ID: string = "11111111-0000-4000-8000-000000000031";
const HOST_ID: string = "33333333-0000-4000-8000-000000000031";
const UNSHOWN_ID: string = "55555555-0000-4000-8000-000000000031";

interface GetListArgs {
  modelType: { name: string };
}

/*
 * One row per table the resolver may consult; any other table answers with
 * nothing, the way an id that is not there would.
 */
const ROWS_BY_MODEL: Record<string, Array<{ id: string; name: string }>> = {
  RumApplication: [{ id: RUM_APP_ID, name: "checkout-web" }],
  Host: [{ id: HOST_ID, name: "web-01" }],
};

const TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

const makePattern: (
  pattern: string,
  resourceIds: Array<string>,
) => TopErrorPatternRow = (
  pattern: string,
  resourceIds: Array<string>,
): TopErrorPatternRow => {
  return {
    pattern,
    sampleBody: pattern,
    count: 3,
    firstSeenAt: null,
    lastSeenAt: null,
    resourceCount: resourceIds.length,
    resourceIds,
    severities: ["Error"],
    traceCount: 0,
    sampleTraceIds: [],
  };
};

const makeService: (id: string, name: string) => Service = (
  id: string,
  name: string,
): Service => {
  const service: Service = new Service();
  service.id = new ObjectID(id);
  service.name = name;
  return service;
};

interface HarnessProps {
  patterns: Array<TopErrorPatternRow>;
  services: Array<Service>;
  onSelect?: ((row: TopErrorPatternRow) => void) | undefined;
}

/*
 * LogsDashboard's naming pipeline, reduced to the Top errors inputs (no
 * cards, no facets, no selection).
 */
const Harness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): React.ReactElement => {
  const serviceById: Map<string, Service> = React.useMemo(() => {
    const map: Map<string, Service> = new Map<string, Service>();
    for (const service of props.services) {
      map.set(service.id!.toString(), service);
    }
    return map;
  }, [props.services]);

  const refs: Array<LogsResourceRef> = React.useMemo(() => {
    return collectLogsInsightsResourceRefs({
      breakdownResourceIds: [],
      errorPatterns: props.patterns,
      scopeFacets: {},
      selectedScopeValues: [],
    });
  }, [props.patterns]);

  const unnamedIds: Array<string> = React.useMemo(() => {
    return collectLogsResourceIds(refs, (resourceId: string): boolean => {
      return Boolean(serviceById.get(resourceId)?.name);
    });
  }, [refs, serviceById]);

  const typeHints: Record<string, ServiceType> | undefined =
    React.useMemo(() => {
      return buildLogsResourceTypeHints(refs);
    }, [refs]);

  const resourceNames: TelemetryEntityNameMap = useTelemetryEntityNames(
    unnamedIds,
    { typeHints },
  );

  return (
    <TopErrorsPanel
      patterns={props.patterns}
      timeRange={TIME_RANGE}
      isLoading={false}
      serviceNameById={serviceById}
      resourceNames={resourceNames}
      onSelect={(row: TopErrorPatternRow): void => {
        props.onSelect?.(row);
      }}
    />
  );
};

const queriedIds: () => Array<string> = (): Array<string> => {
  const ids: Set<string> = new Set<string>();
  for (const call of getListMock.mock.calls) {
    const query: { _id?: { values?: Array<unknown> } } | undefined = (
      call[0] as { query?: { _id?: { values?: Array<unknown> } } }
    ).query;
    for (const value of query?._id?.values || []) {
      ids.add(`${value}`);
    }
  }
  return Array.from(ids);
};

beforeEach(() => {
  TelemetryEntityNameResolver.clearCache();
  getListMock.mockReset();
  getListMock.mockImplementation((args: GetListArgs) => {
    return Promise.resolve({
      data: (ROWS_BY_MODEL[args.modelType.name] || []).map(
        (row: { id: string; name: string }) => {
          return { id: new ObjectID(row.id), name: row.name };
        },
      ),
      count: 0,
    });
  });
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Top errors rows name their sources (rendered)", () => {
  test("a RUM application reads by name next to a loaded Service, never as its id", async () => {
    render(
      <Harness
        patterns={[
          makePattern("TypeError: x is undefined", [RUM_APP_ID, SERVICE_ID]),
        ]}
        services={[makeService(SERVICE_ID, "payments-api")]}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("2 sources · checkout-web, payments-api"),
      ).toBeInTheDocument();
    });

    expect(document.body.textContent || "").not.toContain(RUM_APP_ID);
    expect(document.body.textContent || "").not.toContain(SERVICE_ID);
  });

  test("only the two ids a row prints are looked up; the Service-named one is not", async () => {
    render(
      <Harness
        patterns={[makePattern("disk full", [HOST_ID, SERVICE_ID, UNSHOWN_ID])]}
        services={[makeService(SERVICE_ID, "payments-api")]}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("3 sources · web-01, payments-api"),
      ).toBeInTheDocument();
    });

    const ids: Array<string> = queriedIds();
    expect(ids).toContain(HOST_ID);
    expect(ids).not.toContain(SERVICE_ID);
    expect(ids).not.toContain(UNSHOWN_ID);
  });

  test("without resolved names (prop omitted) the row keeps its old Service-or-id label", () => {
    render(
      <TopErrorsPanel
        patterns={[makePattern("boom", [RUM_APP_ID, SERVICE_ID])]}
        timeRange={TIME_RANGE}
        isLoading={false}
        serviceNameById={
          new Map<string, Service>([
            [SERVICE_ID, makeService(SERVICE_ID, "payments-api")],
          ])
        }
        onSelect={(): void => {}}
      />,
    );

    expect(
      screen.getByText(`2 sources · ${RUM_APP_ID}, payments-api`),
    ).toBeInTheDocument();
  });

  test("selecting a row hands back the row with its ids untouched", async () => {
    const selected: Array<TopErrorPatternRow> = [];
    const row: TopErrorPatternRow = makePattern("timeout", [RUM_APP_ID]);

    render(
      <Harness
        patterns={[row]}
        services={[]}
        onSelect={(picked: TopErrorPatternRow): void => {
          selected.push(picked);
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("1 source · checkout-web")).toBeInTheDocument();
    });

    screen.getByText("1 source · checkout-web").closest("button")!.click();

    expect(selected).toHaveLength(1);
    expect(selected[0]!.resourceIds).toEqual([RUM_APP_ID]);
  });
});
