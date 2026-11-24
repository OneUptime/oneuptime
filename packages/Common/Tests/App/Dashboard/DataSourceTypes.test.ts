import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DataSourceTypes from "../../../../App/FeatureSet/Dashboard/src/Utils/DataSourceTypes";
import { fillDataSourceVariables } from "../../../../App/FeatureSet/Dashboard/src/Utils/DataSourceVariables";
import DataSourceModel from "../../../Models/DatabaseModels/DataSource";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DataSourceType from "../../../Types/DataSource/DataSourceType";
import { PROJECT_METRICS_DATA_SOURCE_ID } from "../../../Types/DataSource/ProjectMetricsDataSource";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * THE TYPE OF A WIDGET'S DATA SOURCE, READ ONCE A PAGE (issue #10326): a
 * widget over an outside Prometheus fills its variables as Grafana's
 * Prometheus data source does, so the page reads the project's data
 * sources' types - once for every widget, again only for a source it has
 * not seen, and never for a query that names no variable.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const PROMETHEUS_ID: string = "20000000-0000-4000-8000-000000000001";
const LOKI_ID: string = "20000000-0000-4000-8000-000000000002";
const NEW_ID: string = "20000000-0000-4000-8000-000000000003";

let lists: number;
let listed: Array<DataSourceModel>;
let fails: boolean;

const source: (id: string, type: DataSourceType) => DataSourceModel = (
  id: string,
  type: DataSourceType,
): DataSourceModel => {
  const model: DataSourceModel = new DataSourceModel();
  model._id = id;
  model.dataSourceType = type;
  return model;
};

beforeEach(() => {
  DataSourceTypes.forget();
  lists = 0;
  fails = false;
  listed = [
    source(PROMETHEUS_ID, DataSourceType.Prometheus),
    source(LOKI_ID, DataSourceType.Loki),
  ];

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
    modelType: unknown;
  }) => {
    lists++;

    if (fails) {
      throw new Error("The server did not answer.");
    }

    expect(args.modelType).toBe(DataSourceModel);

    return { data: [...listed], count: listed.length, skip: 0, limit: 100 };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the type of each of the project's data sources", () => {
  test("is read once for every widget of the page, however many ask at once", async () => {
    const types: Array<DataSourceType | undefined> = await Promise.all([
      DataSourceTypes.getType(PROMETHEUS_ID),
      DataSourceTypes.getType(LOKI_ID),
      DataSourceTypes.getType(PROMETHEUS_ID),
    ]);

    expect(types).toEqual([
      DataSourceType.Prometheus,
      DataSourceType.Loki,
      DataSourceType.Prometheus,
    ]);
    expect(await DataSourceTypes.getType(LOKI_ID)).toBe(DataSourceType.Loki);
    expect(lists).toBe(1);
  });

  test("a source added since is read for again, once; one that is gone is not read for again", async () => {
    expect(await DataSourceTypes.getType(PROMETHEUS_ID)).toBe(
      DataSourceType.Prometheus,
    );

    listed.push(source(NEW_ID, DataSourceType.Prometheus));

    expect(await DataSourceTypes.getType(NEW_ID)).toBe(
      DataSourceType.Prometheus,
    );
    expect(lists).toBe(2);

    const gone: string = "20000000-0000-4000-8000-000000000009";

    expect(await DataSourceTypes.getType(gone)).toBeUndefined();
    expect(await DataSourceTypes.getType(gone)).toBeUndefined();
    expect(lists).toBe(3);
  });

  test("a read that fails answers nothing, and the next read tries again", async () => {
    fails = true;

    expect(await DataSourceTypes.getType(PROMETHEUS_ID)).toBeUndefined();

    fails = false;

    expect(await DataSourceTypes.getType(LOKI_ID)).toBe(DataSourceType.Loki);
  });

  test("no id, no read", async () => {
    expect(await DataSourceTypes.getType(undefined)).toBeUndefined();
    expect(await DataSourceTypes.getType("")).toBeUndefined();
    expect(lists).toBe(0);
  });
});

describe("a widget's query, with the dashboard's variables filled", () => {
  const node: DashboardVariable = {
    id: "node",
    name: "node",
    type: DashboardVariableType.TelemetryAttribute,
    attributeKey: "instance",
  };

  test("over an outside Prometheus, a variable on All matches every value", async () => {
    expect(
      await fillDataSourceVariables({
        queryConfig: {
          dataSourceId: PROMETHEUS_ID,
          query: 'node_load1{instance="{{node}}"}',
        },
        variables: [node],
      }),
    ).toBe('node_load1{instance=~".*"}');
  });

  test("over a Loki, the token is filled as text: nothing picked leaves it as written", async () => {
    expect(
      await fillDataSourceVariables({
        queryConfig: {
          dataSourceId: LOKI_ID,
          query: '{instance="{{node}}"}',
        },
        variables: [node],
      }),
    ).toBe('{instance="{{node}}"}');
  });

  test("a query that names no variable, and the project's own metrics, are answered at once, with no read", () => {
    expect(
      fillDataSourceVariables({
        queryConfig: { dataSourceId: PROMETHEUS_ID, query: "up" },
        variables: [node],
      }),
    ).toBe("up");
    expect(
      fillDataSourceVariables({
        queryConfig: {
          dataSourceId: PROJECT_METRICS_DATA_SOURCE_ID,
          query: 'up{instance="{{node}}"}',
        },
        variables: [node],
      }),
    ).toBe('up{instance=~".*"}');
    expect(
      fillDataSourceVariables({
        queryConfig: {
          dataSourceId: PROMETHEUS_ID,
          query: 'up{instance="{{node}}"}',
        },
        variables: [],
      }),
    ).toBe('up{instance="{{node}}"}');
    expect(lists).toBe(0);
  });
});
