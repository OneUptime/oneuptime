/**
 * A list or table widget's own sort in every write of a dashboard's config
 * (issue #5082): DashboardService refuses a dashboardViewConfig whose
 * widgets' `arguments.sort` names a column the widget cannot be sorted by,
 * on every create and update, so an API or Terraform user learns at once
 * that the widget would not list as they meant - where a reader would fall
 * back to the widget's built-in order without a word.
 *
 * It stores the config exactly as it was sent, the sorts included: Terraform
 * reads a write back and compares it with what it sent. And a public
 * dashboard's visitors receive each widget's sort with its config.
 */

import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardService, {
  assertDashboardWriteValues,
  getDashboardViewConfigProblem,
} from "../../../Server/Services/DashboardService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import PublicDashboardViewConfig from "../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import BadDataException from "../../../Types/Exception/BadDataException";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardMonitorListComponentUtil from "../../../Utils/Dashboard/Components/DashboardMonitorListComponent";
import {
  getDashboardWidgetSortComponentTypes,
  getDashboardWidgetSortValues,
} from "../../../Utils/Dashboard/DashboardWidgetSorts";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

afterEach(() => {
  jest.restoreAllMocks();
});

function widget(
  componentType: string,
  widgetArguments: JSONObject,
): JSONObject {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: ObjectID.generate().toString(),
    componentType,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    arguments: widgetArguments,
  };
}

function configWith(components: Array<JSONObject>): JSONObject {
  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    heightInDashboardUnits: 60,
  };
}

const refusal: (data: Record<string, unknown>) => string | null = (
  data: Record<string, unknown>,
): string | null => {
  try {
    assertDashboardWriteValues(data);
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as Error).message;
  }
};

describe("what a widget's own sort may be", () => {
  test.each(
    getDashboardWidgetSortComponentTypes().map(
      (componentType: DashboardComponentType) => {
        return [componentType];
      },
    ),
  )(
    "every sort a %s offers is saved",
    (componentType: DashboardComponentType) => {
      for (const sort of getDashboardWidgetSortValues(componentType)) {
        expect(
          refusal({
            dashboardViewConfig: configWith([widget(componentType, { sort })]),
          }),
        ).toBeNull();
      }
    },
  );

  test("a widget saved without a sort, or with none, is saved: its own order", () => {
    for (const widgetArguments of [{}, { sort: null }, { sort: "" }]) {
      expect(
        refusal({
          dashboardViewConfig: configWith([
            widget(DashboardComponentType.MonitorList, widgetArguments),
          ]),
        }),
      ).toBeNull();
    }
  });

  test("a sort the widget has no column for is refused, naming the widget and the sorts it takes", () => {
    expect(
      refusal({
        dashboardViewConfig: configWith([
          widget(DashboardComponentType.IncidentList, {
            sort: "severity:desc",
          }),
          widget(DashboardComponentType.MonitorList, { sort: "phase:desc" }),
        ]),
      }),
    ).toBe(
      "dashboardViewConfig.components[1].arguments.sort must be one of name:asc, name:desc, status:asc, status:desc, type:asc or type:desc, or left out for the widget's own order (name:asc).",
    );
  });

  test("a sort written another way is refused", () => {
    for (const sort of [
      "status:worst",
      "status",
      "STATUS:DESC",
      { column: "status", direction: "desc" },
      ["status", "desc"],
      42,
    ]) {
      expect(
        refusal({
          dashboardViewConfig: configWith([
            widget(DashboardComponentType.MonitorList, {
              sort: sort as unknown as string,
            }),
          ]),
        }),
      ).toContain("components[0].arguments.sort must be one of");
    }
  });

  test("a metric or Data Source table may be saved sorted by any of its own columns", () => {
    expect(
      refusal({
        dashboardViewConfig: configWith([
          widget(DashboardComponentType.Table, { sort: "col:3f2a:desc" }),
          widget(DashboardComponentType.Table, { sort: "attr:1:asc" }),
          widget(DashboardComponentType.DataSourceTable, {
            sort: "revenue:desc",
          }),
        ]),
      }),
    ).toBeNull();

    expect(
      refusal({
        dashboardViewConfig: configWith([
          widget(DashboardComponentType.DataSourceTable, {
            sort: "revenue",
          }),
        ]),
      }),
    ).toContain("must be a column and a direction");
  });

  test("a widget that does not sort, or that this version does not know, is stored as sent", () => {
    expect(
      refusal({
        dashboardViewConfig: configWith([
          widget(DashboardComponentType.Chart, { sort: "anything" }),
          widget("SomethingFromANewerVersion", { sort: "x:y" }),
        ]),
      }),
    ).toBeNull();
  });

  test("the config is read where every reader reads it: in the API reference's envelope, and as JSON text", () => {
    const bad: JSONObject = configWith([
      widget(DashboardComponentType.HostList, { sort: "cpu:desc" }),
    ]);

    expect(
      getDashboardViewConfigProblem({
        _type: "DashboardViewConfig",
        value: bad,
      }),
    ).toContain("components[0].arguments.sort must be one of");

    expect(getDashboardViewConfigProblem(JSON.stringify(bad))).toContain(
      "components[0].arguments.sort must be one of",
    );
  });

  test("the dashboard's own defaults are checked first, then its widgets' sorts", () => {
    expect(
      getDashboardViewConfigProblem({
        ...configWith([
          widget(DashboardComponentType.HostList, { sort: "cpu:desc" }),
        ]),
        timeRange: "Custom",
      }),
    ).toContain("dashboardViewConfig.timeRange must be one of");
  });
});

describe("every create and update is checked", () => {
  type Check = (write: unknown) => Promise<void>;

  const hooks: {
    checkCreateBeforeReferences: Check;
    checkUpdateBeforeReferences: Check;
  } = DashboardService as unknown as {
    checkCreateBeforeReferences: Check;
    checkUpdateBeforeReferences: Check;
  };

  test("a create", async () => {
    const dashboard: Dashboard = new Dashboard();
    dashboard.dashboardViewConfig = configWith([
      widget(DashboardComponentType.MonitorList, { sort: "uptime:desc" }),
    ]) as unknown as DashboardViewConfig;

    await expect(
      hooks.checkCreateBeforeReferences({
        data: dashboard,
        props: { isRoot: true },
      } as CreateBy<Dashboard>),
    ).rejects.toThrow("components[0].arguments.sort must be one of");

    dashboard.dashboardViewConfig = configWith([
      widget(DashboardComponentType.MonitorList, { sort: "status:desc" }),
    ]) as unknown as DashboardViewConfig;

    await hooks.checkCreateBeforeReferences({
      data: dashboard,
      props: { isRoot: true },
    } as CreateBy<Dashboard>);
  });

  test("an update", async () => {
    await expect(
      hooks.checkUpdateBeforeReferences({
        query: {},
        data: {
          dashboardViewConfig: configWith([
            widget(DashboardComponentType.KubernetesPodList, {
              sort: "phase:worst",
            }),
          ]),
        },
        props: { isRoot: true },
      } as unknown as UpdateBy<Dashboard>),
    ).rejects.toThrow("components[0].arguments.sort must be one of");

    await hooks.checkUpdateBeforeReferences({
      query: {},
      data: {
        dashboardViewConfig: configWith([
          widget(DashboardComponentType.KubernetesPodList, {
            sort: "phase:desc",
          }),
        ]),
      },
      props: { isRoot: true },
    } as unknown as UpdateBy<Dashboard>);
  });
});

describe("a dashboard created with widget sorts", () => {
  type CreateHook = (createBy: CreateBy<Dashboard>) => Promise<{
    createBy: CreateBy<Dashboard>;
  }>;

  const onBeforeCreate: CreateHook = (
    DashboardService as unknown as { onBeforeCreate: CreateHook }
  ).onBeforeCreate.bind(DashboardService);

  test("keeps its config exactly as it was sent - what Terraform reads back", async () => {
    const monitorList: JSONObject = JSON.parse(
      JSON.stringify(DashboardMonitorListComponentUtil.getDefaultComponent()),
    );
    (monitorList["arguments"] as JSONObject)["sort"] = "status:desc";

    const sent: JSONObject = configWith([monitorList]);
    const dashboard: Dashboard = new Dashboard();
    dashboard.projectId = ObjectID.generate();
    dashboard.name = "NOC wall";
    dashboard.dashboardViewConfig = JSON.parse(
      JSON.stringify(sent),
    ) as unknown as DashboardViewConfig;

    const result: { createBy: CreateBy<Dashboard> } = await onBeforeCreate({
      data: dashboard,
      props: { isRoot: true },
      miscDataProps: {},
    } as unknown as CreateBy<Dashboard>);

    expect(
      JSON.parse(JSON.stringify(result.createBy.data.dashboardViewConfig)),
    ).toEqual(sent);
  });

  test("a public dashboard's visitors receive each widget's own sort with its config", () => {
    const served: DashboardViewConfig | null =
      PublicDashboardViewConfig.sanitize(
        configWith([
          widget(DashboardComponentType.MonitorList, { sort: "status:desc" }),
        ]) as unknown as DashboardViewConfig,
      );

    expect(
      (served?.components[0]?.arguments as JSONObject | undefined)?.["sort"],
    ).toBe("status:desc");
  });
});
