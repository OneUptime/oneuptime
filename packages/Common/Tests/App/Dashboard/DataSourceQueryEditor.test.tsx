import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { act, FunctionComponent, ReactElement, useState } from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The four external Data Source widgets store their query in two DIFFERENT
 * shapes: the chart overlays several series, so it keeps an ARRAY under
 * arguments.queries, while value/gauge/table each render one number or one
 * result set and keep a SINGLE object under arguments.query. This editor is
 * the only writer of both shapes, and it writes them straight through
 * onChange rather than via a form. Getting the shape wrong is silent - the
 * widget renders its empty state and the operator's query is simply gone -
 * so the shape, the delete-the-key-on-empty behaviour, and the preservation
 * of the widget's unrelated arguments are pinned here.
 */

const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so naming the mocks directly would capture them before their
 * initializers have run.
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

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

import DataSourceQueryEditor from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/DataSourceQueryEditor";
import DataSourceModel from "../../../Models/DatabaseModels/DataSource";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DataSourceQueryConfig from "../../../Types/DataSource/DataSourceQueryConfig";
import DataSourceType from "../../../Types/DataSource/DataSourceType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const PROMETHEUS_ID: string = "22222222-2222-4222-8222-222222222222";
const POSTGRES_ID: string = "33333333-3333-4333-8333-333333333333";

const LEGEND_PLACEHOLDER: string = "e.g. {{instance}} — errors";
const LEGEND_LABEL: string = "Legend (optional)";
const NO_SOURCES_HINT: RegExp = /No data sources connected yet/;

type BuildDataSourceFunction = (
  id: string,
  name: string,
  dataSourceType: DataSourceType,
) => DataSourceModel;

const buildDataSource: BuildDataSourceFunction = (
  id: string,
  name: string,
  dataSourceType: DataSourceType,
): DataSourceModel => {
  const dataSource: DataSourceModel = new DataSourceModel();
  dataSource._id = id;
  dataSource.name = name;
  dataSource.dataSourceType = dataSourceType;
  return dataSource;
};

type ListResultShape = {
  data: Array<DataSourceModel>;
  count: number;
  skip: number;
  limit: number;
};

type ToListResultFunction = (data: Array<DataSourceModel>) => ListResultShape;

const toListResult: ToListResultFunction = (
  data: Array<DataSourceModel>,
): ListResultShape => {
  return { data: data, count: data.length, skip: 0, limit: data.length };
};

type BuildComponentFunction = (
  componentType: DashboardComponentType,
  componentArguments?: Record<string, unknown> | undefined,
) => DashboardBaseComponent;

const buildComponent: BuildComponentFunction = (
  componentType: DashboardComponentType,
  componentArguments?: Record<string, unknown> | undefined,
): DashboardBaseComponent => {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: ObjectID.generate(),
    componentType: componentType,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 2,
    arguments: componentArguments,
  };
};

/**
 * Everything the editor pushed back out through onChange, newest last.
 */
interface EditorHandle {
  emitted: Array<DashboardBaseComponent>;
}

interface HarnessProps {
  initialComponent: DashboardBaseComponent;
  onEmit: (component: DashboardBaseComponent) => void;
}

/*
 * The real caller feeds the edited component straight back down, so a
 * stateful wrapper is the only way a second edit sees the first one.
 */
const Harness: FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const [component, setComponent] = useState<DashboardBaseComponent>(
    props.initialComponent,
  );

  return (
    <DataSourceQueryEditor
      component={component}
      onChange={(next: DashboardBaseComponent) => {
        setComponent(next);
        props.onEmit(next);
      }}
    />
  );
};

type RenderEditorFunction = (
  component: DashboardBaseComponent,
) => Promise<EditorHandle>;

const renderEditor: RenderEditorFunction = async (
  component: DashboardBaseComponent,
): Promise<EditorHandle> => {
  const handle: EditorHandle = { emitted: [] };

  await act(async (): Promise<void> => {
    render(
      <Harness
        initialComponent={component}
        onEmit={(next: DashboardBaseComponent) => {
          handle.emitted.push(next);
        }}
      />,
    );
  });

  return handle;
};

type LastArgumentsFunction = (handle: EditorHandle) => Record<string, unknown>;

const lastArguments: LastArgumentsFunction = (
  handle: EditorHandle,
): Record<string, unknown> => {
  const last: DashboardBaseComponent | undefined =
    handle.emitted[handle.emitted.length - 1];

  if (!last) {
    throw new Error("The editor did not emit anything.");
  }

  return (last.arguments || {}) as Record<string, unknown>;
};

type HasKeyFunction = (handle: EditorHandle, key: string) => boolean;

const hasKey: HasKeyFunction = (handle: EditorHandle, key: string): boolean => {
  return Object.prototype.hasOwnProperty.call(lastArguments(handle), key);
};

type LastQueriesFunction = (
  handle: EditorHandle,
) => Array<DataSourceQueryConfig>;

const lastQueries: LastQueriesFunction = (
  handle: EditorHandle,
): Array<DataSourceQueryConfig> => {
  return lastArguments(handle)["queries"] as Array<DataSourceQueryConfig>;
};

type LastQueryFunction = (handle: EditorHandle) => DataSourceQueryConfig;

const lastQuery: LastQueryFunction = (
  handle: EditorHandle,
): DataSourceQueryConfig => {
  return lastArguments(handle)["query"] as DataSourceQueryConfig;
};

type GetQueryBoxesFunction = () => Array<HTMLTextAreaElement>;

/**
 * The query text areas, in card order. Filtered by tag because react-select
 * also contributes a textbox to every card.
 */
const getQueryBoxes: GetQueryBoxesFunction = (): Array<HTMLTextAreaElement> => {
  return screen
    .queryAllByRole("textbox")
    .filter((element: HTMLElement): boolean => {
      return element.tagName === "TEXTAREA";
    }) as Array<HTMLTextAreaElement>;
};

type TypeQueryFunction = (index: number, value: string) => void;

const typeQuery: TypeQueryFunction = (index: number, value: string): void => {
  const box: HTMLTextAreaElement | undefined = getQueryBoxes()[index];

  if (!box) {
    throw new Error(`There is no query editor at index ${index}.`);
  }

  fireEvent.change(box, { target: { value: value } });
};

type ClickButtonFunction = (name: string, index?: number | undefined) => void;

const clickButton: ClickButtonFunction = (
  name: string,
  index?: number | undefined,
): void => {
  const buttons: Array<HTMLElement> = screen.getAllByRole("button", {
    name: name,
  });
  const button: HTMLElement | undefined = buttons[index || 0];

  if (!button) {
    throw new Error(`There is no "${name}" button at index ${index || 0}.`);
  }

  fireEvent.click(button);
};

type GetCardHeadingsFunction = () => Array<string>;

/*
 * Heading of every query card, in card order. Read off the card's own header
 * row rather than by text, because the section wrapper is also titled "Query".
 */
const getCardHeadings: GetCardHeadingsFunction = (): Array<string> => {
  return screen
    .queryAllByRole("button", { name: "Remove" })
    .map((removeButton: HTMLElement): string => {
      return removeButton.parentElement?.querySelector("p")?.textContent || "";
    });
};

type QueryAddButtonFunction = () => HTMLElement | null;

const queryAddButton: QueryAddButtonFunction = (): HTMLElement | null => {
  return screen.queryByRole("button", { name: "Add Query" });
};

const SINGLE_QUERY_TYPES: Array<DashboardComponentType> = [
  DashboardComponentType.DataSourceValue,
  DashboardComponentType.DataSourceGauge,
  DashboardComponentType.DataSourceTable,
];

beforeEach(() => {
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  getListMock.mockResolvedValue(
    toListResult([
      buildDataSource(
        PROMETHEUS_ID,
        "Prod Prometheus",
        DataSourceType.Prometheus,
      ),
      buildDataSource(POSTGRES_ID, "Billing DB", DataSourceType.PostgreSQL),
    ]) as never,
  );
});

describe("DataSourceQueryEditor", () => {
  describe("loading the project's data sources", () => {
    test("asks only for the current project's sources, by name", async () => {
      await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart, {}),
      );

      await waitFor((): void => {
        expect(getListMock).toHaveBeenCalledTimes(1);
      });

      const request: Record<string, unknown> = getListMock.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(request["modelType"]).toBe(DataSourceModel);
      expect(request["query"]).toEqual({ projectId: PROJECT_ID });
      expect(request["select"]).toEqual({
        _id: true,
        name: true,
        dataSourceType: true,
      });
    });

    test("offers the Add Query affordance once sources have loaded", async () => {
      await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart, {}),
      );

      expect(screen.queryByText(NO_SOURCES_HINT)).not.toBeInTheDocument();
      expect(queryAddButton()).toBeInTheDocument();
    });

    test("explains where to connect a source when the project has none", async () => {
      getListMock.mockResolvedValue(toListResult([]) as never);

      await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart, {}),
      );

      expect(screen.getByText(NO_SOURCES_HINT)).toBeInTheDocument();
      // Nothing to point a query at, so adding one would only mislead.
      expect(queryAddButton()).not.toBeInTheDocument();
    });

    test("surfaces a load failure instead of the empty-project hint", async () => {
      getListMock.mockRejectedValue(
        new Error("Data sources unreachable") as never,
      );

      await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart, {}),
      );

      expect(screen.getByText("Data sources unreachable")).toBeInTheDocument();
      expect(screen.queryByText(NO_SOURCES_HINT)).not.toBeInTheDocument();
      expect(queryAddButton()).not.toBeInTheDocument();
    });
  });

  describe("chart widgets write an array", () => {
    test("edits land in arguments.queries and never in arguments.query", async () => {
      const handle: EditorHandle = await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart, {
          queries: [
            { id: "q1", dataSourceId: PROMETHEUS_ID, query: "up" },
          ] as Array<DataSourceQueryConfig>,
        }),
      );

      typeQuery(0, 'rate(http_requests_total{job="api"}[5m])');

      expect(Array.isArray(lastQueries(handle))).toBe(true);
      expect(lastQueries(handle)).toHaveLength(1);
      expect(lastQueries(handle)[0]!.query).toBe(
        'rate(http_requests_total{job="api"}[5m])',
      );
      expect(hasKey(handle, "query")).toBe(false);
    });

    test("adding a query appends to the array rather than replacing it", async () => {
      const handle: EditorHandle = await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart, {
          queries: [
            { id: "q1", dataSourceId: PROMETHEUS_ID, query: "up" },
          ] as Array<DataSourceQueryConfig>,
        }),
      );

      clickButton("Add Query");

      expect(lastQueries(handle)).toHaveLength(2);
      expect(lastQueries(handle)[0]!.query).toBe("up");
      expect(lastQueries(handle)[1]).toEqual({
        id: expect.any(String),
        dataSourceId: "",
        query: "",
      });
      // A fresh identity, or React would reuse the first card's editor state.
      expect(lastQueries(handle)[1]!.id).not.toBe("q1");
    });

    test("keeps offering Add Query while queries already exist", async () => {
      await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart, {
          queries: [
            { id: "q1", dataSourceId: PROMETHEUS_ID, query: "up" },
            { id: "q2", dataSourceId: PROMETHEUS_ID, query: "down" },
          ] as Array<DataSourceQueryConfig>,
        }),
      );

      expect(getQueryBoxes()).toHaveLength(2);
      expect(queryAddButton()).toBeInTheDocument();
      // Numbered, because on a chart the series are told apart by position.
      expect(getCardHeadings()).toEqual(["Query 1", "Query 2"]);
    });

    test("editing one series leaves the others and their ids alone", async () => {
      const handle: EditorHandle = await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart, {
          queries: [
            {
              id: "q1",
              dataSourceId: PROMETHEUS_ID,
              query: "up",
              legend: "up",
            },
            { id: "q2", dataSourceId: POSTGRES_ID, query: "SELECT 1" },
          ] as Array<DataSourceQueryConfig>,
        }),
      );

      typeQuery(1, "SELECT 2");

      expect(lastQueries(handle)).toEqual([
        { id: "q1", dataSourceId: PROMETHEUS_ID, query: "up", legend: "up" },
        { id: "q2", dataSourceId: POSTGRES_ID, query: "SELECT 2" },
      ]);
    });

    test("removing one of two queries keeps the survivor", async () => {
      const handle: EditorHandle = await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart, {
          queries: [
            { id: "q1", dataSourceId: PROMETHEUS_ID, query: "up" },
            { id: "q2", dataSourceId: PROMETHEUS_ID, query: "down" },
          ] as Array<DataSourceQueryConfig>,
        }),
      );

      clickButton("Remove", 0);

      expect(lastQueries(handle)).toEqual([
        { id: "q2", dataSourceId: PROMETHEUS_ID, query: "down" },
      ]);
    });

    test("removing the last query drops the key rather than storing []", async () => {
      const handle: EditorHandle = await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart, {
          chartTitle: "Errors",
          queries: [
            { id: "q1", dataSourceId: PROMETHEUS_ID, query: "up" },
          ] as Array<DataSourceQueryConfig>,
        }),
      );

      clickButton("Remove");

      expect(hasKey(handle, "queries")).toBe(false);
      expect(lastArguments(handle)["queries"]).toBeUndefined();
      expect(lastArguments(handle)["chartTitle"]).toBe("Errors");
    });

    test("a chart with no queries yet still writes an array on first add", async () => {
      const handle: EditorHandle = await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart),
      );

      expect(getQueryBoxes()).toHaveLength(0);

      clickButton("Add Query");

      expect(Array.isArray(lastQueries(handle))).toBe(true);
      expect(lastQueries(handle)).toHaveLength(1);
      expect(hasKey(handle, "query")).toBe(false);
    });
  });

  describe("value, gauge and table widgets write a single object", () => {
    test.each(SINGLE_QUERY_TYPES)(
      "%s edits land in arguments.query and never in arguments.queries",
      async (componentType: DashboardComponentType): Promise<void> => {
        const handle: EditorHandle = await renderEditor(
          buildComponent(componentType, {
            query: {
              id: "only",
              dataSourceId: POSTGRES_ID,
              query: "SELECT 1",
            } as DataSourceQueryConfig,
          }),
        );

        typeQuery(0, "SELECT count(*) FROM orders");

        expect(Array.isArray(lastArguments(handle)["query"])).toBe(false);
        expect(lastQuery(handle)).toEqual({
          id: "only",
          dataSourceId: POSTGRES_ID,
          query: "SELECT count(*) FROM orders",
        });
        expect(hasKey(handle, "queries")).toBe(false);
      },
    );

    test.each(SINGLE_QUERY_TYPES)(
      "%s hides Add Query once a query exists",
      async (componentType: DashboardComponentType): Promise<void> => {
        await renderEditor(
          buildComponent(componentType, {
            query: {
              id: "only",
              dataSourceId: POSTGRES_ID,
              query: "SELECT 1",
            } as DataSourceQueryConfig,
          }),
        );

        expect(getQueryBoxes()).toHaveLength(1);
        expect(queryAddButton()).not.toBeInTheDocument();
        // One query means there is no position to number.
        expect(getCardHeadings()).toEqual(["Query"]);
      },
    );

    test.each(SINGLE_QUERY_TYPES)(
      "%s offers Add Query while it has none",
      async (componentType: DashboardComponentType): Promise<void> => {
        const handle: EditorHandle = await renderEditor(
          buildComponent(componentType, {}),
        );

        expect(queryAddButton()).toBeInTheDocument();

        clickButton("Add Query");

        expect(lastQuery(handle)).toEqual({
          id: expect.any(String),
          dataSourceId: "",
          query: "",
        });
        expect(hasKey(handle, "queries")).toBe(false);
      },
    );

    test.each(SINGLE_QUERY_TYPES)(
      "%s drops the key entirely when its only query is removed",
      async (componentType: DashboardComponentType): Promise<void> => {
        const handle: EditorHandle = await renderEditor(
          buildComponent(componentType, {
            query: {
              id: "only",
              dataSourceId: POSTGRES_ID,
              query: "SELECT 1",
            } as DataSourceQueryConfig,
          }),
        );

        clickButton("Remove");

        expect(hasKey(handle, "query")).toBe(false);
        expect(lastArguments(handle)["query"]).toBeUndefined();
        expect(hasKey(handle, "queries")).toBe(false);
      },
    );

    test("a gauge's range settings survive a query edit untouched", async () => {
      const handle: EditorHandle = await renderEditor(
        buildComponent(DashboardComponentType.DataSourceGauge, {
          minValue: 0,
          maxValue: 100,
          unit: "%",
          query: {
            id: "only",
            dataSourceId: PROMETHEUS_ID,
            query: "up",
          } as DataSourceQueryConfig,
        }),
      );

      typeQuery(0, "avg(node_cpu_seconds_total)");

      expect(lastArguments(handle)["minValue"]).toBe(0);
      expect(lastArguments(handle)["maxValue"]).toBe(100);
      expect(lastArguments(handle)["unit"]).toBe("%");
      expect(lastQuery(handle).query).toBe("avg(node_cpu_seconds_total)");
    });
  });

  describe("query identity", () => {
    test("an existing id survives an edit", async () => {
      const handle: EditorHandle = await renderEditor(
        buildComponent(DashboardComponentType.DataSourceValue, {
          query: {
            id: "keep-me",
            dataSourceId: PROMETHEUS_ID,
            query: "up",
          } as DataSourceQueryConfig,
        }),
      );

      typeQuery(0, 'up{job="api"}');

      expect(lastQuery(handle).id).toBe("keep-me");
    });

    test("a legacy query without an id is not given one by an edit", async () => {
      const handle: EditorHandle = await renderEditor(
        buildComponent(DashboardComponentType.DataSourceValue, {
          query: {
            dataSourceId: PROMETHEUS_ID,
            query: "up",
          } as DataSourceQueryConfig,
        }),
      );

      typeQuery(0, "down");

      expect(lastQuery(handle)).toEqual({
        dataSourceId: PROMETHEUS_ID,
        query: "down",
      });
    });
  });

  describe("legend field", () => {
    test.each([
      DashboardComponentType.DataSourceChart,
      DashboardComponentType.DataSourceValue,
      DashboardComponentType.DataSourceGauge,
    ])(
      "%s offers a legend because its result is a series",
      async (componentType: DashboardComponentType): Promise<void> => {
        const isChart: boolean =
          componentType === DashboardComponentType.DataSourceChart;

        await renderEditor(
          buildComponent(
            componentType,
            isChart
              ? {
                  queries: [
                    { id: "q1", dataSourceId: PROMETHEUS_ID, query: "up" },
                  ] as Array<DataSourceQueryConfig>,
                }
              : {
                  query: {
                    id: "q1",
                    dataSourceId: PROMETHEUS_ID,
                    query: "up",
                  } as DataSourceQueryConfig,
                },
          ),
        );

        expect(screen.getByText(LEGEND_LABEL)).toBeInTheDocument();
        expect(
          screen.getByPlaceholderText(LEGEND_PLACEHOLDER),
        ).toBeInTheDocument();
      },
    );

    test("the table variant has no series, so it has no legend field", async () => {
      await renderEditor(
        buildComponent(DashboardComponentType.DataSourceTable, {
          query: {
            id: "q1",
            dataSourceId: POSTGRES_ID,
            query: "SELECT 1",
          } as DataSourceQueryConfig,
        }),
      );

      // The query editor is still there - only the legend is gone.
      expect(getQueryBoxes()).toHaveLength(1);
      expect(screen.queryByText(LEGEND_LABEL)).not.toBeInTheDocument();
      expect(
        screen.queryByPlaceholderText(LEGEND_PLACEHOLDER),
      ).not.toBeInTheDocument();
    });

    test("a legend template is stored on the query it belongs to", async () => {
      const handle: EditorHandle = await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart, {
          queries: [
            { id: "q1", dataSourceId: PROMETHEUS_ID, query: "up" },
          ] as Array<DataSourceQueryConfig>,
        }),
      );

      fireEvent.change(screen.getByPlaceholderText(LEGEND_PLACEHOLDER), {
        target: { value: "{{instance}}" },
      });

      expect(lastQueries(handle)[0]!.legend).toBe("{{instance}}");
    });

    test("clearing the legend stores undefined, not an empty string", async () => {
      const handle: EditorHandle = await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart, {
          queries: [
            {
              id: "q1",
              dataSourceId: PROMETHEUS_ID,
              query: "up",
              legend: "{{instance}}",
            },
          ] as Array<DataSourceQueryConfig>,
        }),
      );

      fireEvent.change(screen.getByPlaceholderText(LEGEND_PLACEHOLDER), {
        target: { value: "" },
      });

      expect(lastQueries(handle)[0]!.legend).toBeUndefined();
    });
  });

  describe("per-source query language help", () => {
    test("names the language and shows SQL time macros for a database source", async () => {
      await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart, {
          queries: [
            { id: "q1", dataSourceId: POSTGRES_ID, query: "SELECT 1" },
          ] as Array<DataSourceQueryConfig>,
        }),
      );

      expect(screen.getByText("Query (SQL)")).toBeInTheDocument();
      expect(screen.getByText(/\$__startTime/)).toBeInTheDocument();
      expect(screen.getByText(/Return a time column/)).toBeInTheDocument();
    });

    test("tells a table it may run any read-only query", async () => {
      await renderEditor(
        buildComponent(DashboardComponentType.DataSourceTable, {
          query: {
            id: "q1",
            dataSourceId: POSTGRES_ID,
            query: "SELECT 1",
          } as DataSourceQueryConfig,
        }),
      );

      expect(screen.getByText(/Any read-only query works/)).toBeInTheDocument();
      expect(
        screen.queryByText(/Return a time column/),
      ).not.toBeInTheDocument();
    });

    test("a non-database source gets the variable hint, not the SQL macros", async () => {
      await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart, {
          queries: [
            { id: "q1", dataSourceId: PROMETHEUS_ID, query: "up" },
          ] as Array<DataSourceQueryConfig>,
        }),
      );

      expect(screen.getByText("Query (PromQL)")).toBeInTheDocument();
      expect(
        screen.getByText(/Dashboard variables interpolate with/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/\$__startTime/)).not.toBeInTheDocument();
    });

    test("an unresolvable data source id degrades to the generic prompt", async () => {
      await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart, {
          queries: [
            { id: "q1", dataSourceId: "deleted-source", query: "up" },
          ] as Array<DataSourceQueryConfig>,
        }),
      );

      expect(
        screen.getByPlaceholderText("Enter your query"),
      ).toBeInTheDocument();
      // No source resolved, so there is no language to name and no macros.
      expect(screen.queryByText(/^Query \(/)).not.toBeInTheDocument();
      expect(screen.queryByText(/\$__startTime/)).not.toBeInTheDocument();
      // The query itself is still shown, so nothing has been thrown away.
      expect(getQueryBoxes()[0]!.value).toBe("up");
    });

    test("shows the connected source's name and type on the picker", async () => {
      await renderEditor(
        buildComponent(DashboardComponentType.DataSourceValue, {
          query: {
            id: "q1",
            dataSourceId: PROMETHEUS_ID,
            query: "up",
          } as DataSourceQueryConfig,
        }),
      );

      expect(
        screen.getByText("Prod Prometheus (Prometheus)"),
      ).toBeInTheDocument();
    });
  });

  describe("edge cases in the query text", () => {
    test("a whitespace-only query is stored as typed, not silently trimmed away", async () => {
      const handle: EditorHandle = await renderEditor(
        buildComponent(DashboardComponentType.DataSourceValue, {
          query: {
            id: "q1",
            dataSourceId: PROMETHEUS_ID,
            query: "up",
          } as DataSourceQueryConfig,
        }),
      );

      typeQuery(0, "   ");

      expect(lastQuery(handle).query).toBe("   ");
      // Blanking the text must not be mistaken for removing the query.
      expect(hasKey(handle, "query")).toBe(true);
    });

    test("emptying the query keeps the row so the operator can retype", async () => {
      const handle: EditorHandle = await renderEditor(
        buildComponent(DashboardComponentType.DataSourceChart, {
          queries: [
            { id: "q1", dataSourceId: PROMETHEUS_ID, query: "up" },
          ] as Array<DataSourceQueryConfig>,
        }),
      );

      typeQuery(0, "");

      expect(hasKey(handle, "queries")).toBe(true);
      expect(lastQueries(handle)).toEqual([
        { id: "q1", dataSourceId: PROMETHEUS_ID, query: "" },
      ]);
    });
  });
});
