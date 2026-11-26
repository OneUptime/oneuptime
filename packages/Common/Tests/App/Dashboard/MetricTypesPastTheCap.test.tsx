import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import CappedListServer, { namesSortingFirst } from "./CappedListServer";
import MetricUtil from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics";
import MetricTypeSearch, {
  useMetricTypesHeldIn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricTypeSearch";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Includes from "../../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

/*
 * A CHARTED METRIC IS KNOWN - ITS UNIT, ITS KIND OF COUNTER - HOWEVER MANY
 * METRICS THE PROJECT SENDS (#10691).
 *
 * The Metrics explorer and a dashboard read the project's first 10,000
 * metric types by name, up front, for every query on the page: its unit (to
 * convert a value into the unit the query shows), whether it is a counter
 * (to read a step with no point as 0) and its attributes. A metric past
 * them - one Kubernetes cluster sends more names than that - was charted
 * with none of it, outside the one picker that reads its own.
 *
 * What the page's queries chart is read by its names now, wherever it
 * sorts, and merged into the list (MetricTypeSearch.readByNames, the page
 * as its queries change: useMetricTypesHeldIn). ModelAPI answers from a
 * project faked whole (CappedListServer).
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

// Sorts after every one of the 10,050 below.
const LATE_METRIC: string = "zz.kiosk.requests";

const METRICS_BEFORE_IT: number = LIMIT_PER_PROJECT + 50;

let server: CappedListServer;

beforeAll(() => {
  server = new CappedListServer();
  server.add(
    MetricType,
    namesSortingFirst(METRICS_BEFORE_IT, "k8s.a").map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(MetricType, [
    {
      _id: ObjectID.generate().toString(),
      name: LATE_METRIC,
      unit: "By",
      isMonotonic: true,
    },
  ]);
});

beforeEach(() => {
  server.calls.length = 0;
  server.install();
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// A query as the Metrics explorer and a dashboard widget keep it.
const queryOf: (metricName: string) => Record<string, unknown> = (
  metricName: string,
): Record<string, unknown> => {
  return {
    metricAliasData: { metricVariable: "a" },
    metricQueryData: {
      filterData: { metricName: metricName, aggegationType: "Sum" },
    },
  };
};

describe("the metric names a page's queries hold", () => {
  test("are found wherever they are kept: query configs, a dashboard's widgets, a table's columns", () => {
    const board: Record<string, unknown> = {
      components: [
        { arguments: { metricQueryConfig: queryOf(LATE_METRIC) } },
        {
          arguments: {
            metricQueryConfigs: {
              queryConfigs: [queryOf("k8s.a000001"), queryOf(LATE_METRIC)],
            },
          },
        },
        { arguments: { columns: [{ metricName: "http.server.duration" }] } },
        // Not a metric: left out.
        { arguments: { metricName: "  " } },
      ],
    };

    expect(MetricTypeSearch.getMetricNamesIn(board).sort()).toEqual(
      ["http.server.duration", "k8s.a000001", LATE_METRIC].sort(),
    );
    expect(MetricTypeSearch.getMetricNamesIn(undefined)).toEqual([]);
  });
});

describe("the page's list of metric types", () => {
  test("REGRESSION: a charted metric past the 10,000th is in it, with its unit and kind of counter, read by its name", async () => {
    const { metricTypes } = await MetricUtil.loadAllMetricsTypes({
      includeAttributes: false,
      metricNames: MetricTypeSearch.getMetricNamesIn([
        queryOf(LATE_METRIC),
        queryOf("k8s.a000001"),
      ]),
    });

    const late: MetricType | undefined = metricTypes.find(
      (metricType: MetricType): boolean => {
        return metricType.name === LATE_METRIC;
      },
    );

    expect(late?.unit).toBe("By");
    expect(late?.isMonotonic).toBe(true);

    // The first read, then the late one by its name: never another page.
    const reads: Array<Record<string, unknown>> = server
      .callsFor(MetricType)
      .map((call: { query: Record<string, unknown> }) => {
        return call.query;
      });

    expect(reads).toHaveLength(2);
    expect(reads[1]!["name"]).toBeInstanceOf(Includes);
    expect((reads[1]!["name"] as Includes).values).toEqual([LATE_METRIC]);
  });

  test("a metric the first read had is not read again", async () => {
    await MetricUtil.loadAllMetricsTypes({
      includeAttributes: false,
      metricNames: ["k8s.a000001"],
    });

    expect(server.callsFor(MetricType)).toHaveLength(1);
  });

  test("a name the project sends no metric of is simply not in it", async () => {
    const { metricTypes } = await MetricUtil.loadAllMetricsTypes({
      includeAttributes: false,
      metricNames: ["nobody.sends.this"],
    });

    expect(metricTypes).toHaveLength(LIMIT_PER_PROJECT);
  });
});

describe("a page whose queries change", () => {
  // The page: its list, and what its queries chart.
  const Page: (props: { names: Array<string> }) => ReactElement = (props: {
    names: Array<string>;
  }): ReactElement => {
    const [metricTypes, setMetricTypes] = useState<Array<MetricType>>([]);

    useMetricTypesHeldIn({
      holder: props.names.map(queryOf),
      known: metricTypes,
      onRead: (found: Array<MetricType>): void => {
        setMetricTypes((current: Array<MetricType>): Array<MetricType> => {
          return MetricTypeSearch.merge(current, found);
        });
      },
    });

    return (
      <span data-testid="units">
        {metricTypes
          .map((metricType: MetricType): string => {
            return `${metricType.name}=${metricType.unit || ""}`;
          })
          .join(",")}
      </span>
    );
  };

  test("reads a metric picked since by its name, once", async () => {
    const { rerender } = render(<Page names={[]} />);

    rerender(<Page names={[LATE_METRIC]} />);

    await waitFor(() => {
      expect(screen.getByTestId("units")).toHaveTextContent(
        `${LATE_METRIC}=By`,
      );
    });

    // Drawn again with the same queries: nothing asked twice.
    rerender(<Page names={[LATE_METRIC]} />);

    expect(server.callsFor(MetricType)).toHaveLength(1);
  });
});
