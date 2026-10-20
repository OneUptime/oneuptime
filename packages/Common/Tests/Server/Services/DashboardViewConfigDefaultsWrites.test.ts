/**
 * A dashboard's default time range and auto-refresh in every write of its
 * config (issue #5080): DashboardService refuses a dashboardViewConfig whose
 * `timeRange` or `refreshInterval` no reader can use, on every create and
 * update, before anything it names is looked up - so an API or Terraform
 * user learns at once that the dashboard would not open where they meant
 * it to, where a reader used to fall back without a word.
 *
 * And it stores the config exactly as it was sent: Terraform reads a write
 * back and compares it with what it sent, so nothing is rewritten - the
 * defaults included.
 */

import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardService, {
  DASHBOARD_VIEW_CONFIG_COLUMN,
  assertDashboardWriteValues,
  getDashboardViewConfigProblem,
} from "../../../Server/Services/DashboardService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import { DASHBOARD_AUTO_REFRESH_PROBLEM } from "../../../Types/Dashboard/DashboardAutoRefresh";
import {
  DASHBOARD_TIME_RANGES,
  DASHBOARD_TIME_RANGE_PROBLEM,
} from "../../../Types/Dashboard/DashboardTimeRange";
import DashboardViewConfig, {
  AutoRefreshInterval,
} from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import PublicDashboardViewConfig from "../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import DashboardTextComponentUtil from "../../../Utils/Dashboard/Components/DashboardTextComponent";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

afterEach(() => {
  jest.restoreAllMocks();
});

function configWith(defaults: JSONObject): JSONObject {
  return {
    _type: ObjectType.DashboardViewConfig,
    components: [],
    heightInDashboardUnits: 60,
    ...defaults,
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

describe("what a write's config may hold", () => {
  test("the config is the dashboardViewConfig column", () => {
    expect(DASHBOARD_VIEW_CONFIG_COLUMN).toBe("dashboardViewConfig");
    expect(
      new Dashboard().getTableColumnMetadata(DASHBOARD_VIEW_CONFIG_COLUMN),
    ).toBeTruthy();
  });

  test.each(
    DASHBOARD_TIME_RANGES.map((range: TimeRange): Array<TimeRange> => {
      return [range];
    }),
  )("a default time range of %s is saved", (range: TimeRange) => {
    expect(
      refusal({ dashboardViewConfig: configWith({ timeRange: range }) }),
    ).toBeNull();
  });

  test.each(
    Object.values(AutoRefreshInterval).map(
      (interval: AutoRefreshInterval): Array<AutoRefreshInterval> => {
        return [interval];
      },
    ),
  )(
    "a default auto-refresh of %s is saved",
    (interval: AutoRefreshInterval) => {
      expect(
        refusal({
          dashboardViewConfig: configWith({ refreshInterval: interval }),
        }),
      ).toBeNull();
    },
  );

  test("a config with neither is saved: the past hour, no auto-refresh, as before", () => {
    expect(refusal({ dashboardViewConfig: configWith({}) })).toBeNull();
    expect(
      refusal({
        dashboardViewConfig: configWith({
          timeRange: null,
          refreshInterval: null,
        }),
      }),
    ).toBeNull();
  });

  test("a write without a config is not asked about one", () => {
    expect(refusal({ name: "Checkout API" })).toBeNull();
    expect(refusal({ dashboardViewConfig: null })).toBeNull();
  });

  test.each([
    ["Custom, a moment in the past", TimeRange.CUSTOM],
    ["another case", "past 1 day"],
    ["a link's short form", "24h"],
    ["a range no preset has", "Past 6 Hours"],
    ["a number", 24],
  ])(
    "a default time range that is %s is refused",
    (_what: string, value: unknown) => {
      expect(
        refusal({
          dashboardViewConfig: configWith({ timeRange: value as never }),
        }),
      ).toBe(DASHBOARD_TIME_RANGE_PROBLEM);
    },
  );

  test.each([
    ["another case", "OFF"],
    ["an interval the menu does not offer", "2m"],
    ["milliseconds", 60000],
  ])(
    "a default auto-refresh that is %s is refused",
    (_what: string, value: unknown) => {
      expect(
        refusal({
          dashboardViewConfig: configWith({ refreshInterval: value as never }),
        }),
      ).toBe(DASHBOARD_AUTO_REFRESH_PROBLEM);
    },
  );

  test("a config is read the way every reader reads it: in the API reference's envelope, and as JSON text", () => {
    expect(
      getDashboardViewConfigProblem({
        _type: "DashboardViewConfig",
        value: { components: [], timeRange: "Past 6 Hours" },
      }),
    ).toBe(DASHBOARD_TIME_RANGE_PROBLEM);

    expect(
      getDashboardViewConfigProblem(
        JSON.stringify({ components: [], refreshInterval: "2m" }),
      ),
    ).toBe(DASHBOARD_AUTO_REFRESH_PROBLEM);

    expect(
      getDashboardViewConfigProblem(
        JSON.stringify({ components: [], timeRange: TimeRange.PAST_ONE_DAY }),
      ),
    ).toBeNull();
  });

  test("a config that is not one at all is left to the readers, as before", () => {
    expect(getDashboardViewConfigProblem("not json")).toBeNull();
    expect(getDashboardViewConfigProblem(42)).toBeNull();
    expect(getDashboardViewConfigProblem([])).toBeNull();
  });

  test("nothing else in a config is looked at", () => {
    expect(
      refusal({
        dashboardViewConfig: configWith({
          components: [{ componentType: "SomethingFromANewerVersion" }],
          layout: "grid",
          variables: "not a list",
        }),
      }),
    ).toBeNull();
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
    dashboard.dashboardViewConfig = configWith({
      timeRange: TimeRange.CUSTOM,
    }) as unknown as DashboardViewConfig;

    await expect(
      hooks.checkCreateBeforeReferences({
        data: dashboard,
        props: { isRoot: true },
      } as CreateBy<Dashboard>),
    ).rejects.toThrow(DASHBOARD_TIME_RANGE_PROBLEM);

    dashboard.dashboardViewConfig = configWith({
      timeRange: TimeRange.PAST_ONE_DAY,
      refreshInterval: AutoRefreshInterval.ONE_MINUTE,
    }) as unknown as DashboardViewConfig;

    await hooks.checkCreateBeforeReferences({
      data: dashboard,
      props: { isRoot: true },
    } as CreateBy<Dashboard>);
  });

  test("an update", async () => {
    await expect(
      hooks.checkUpdateBeforeReferences({
        query: {},
        data: { dashboardViewConfig: configWith({ refreshInterval: "2m" }) },
        props: { isRoot: true },
      } as unknown as UpdateBy<Dashboard>),
    ).rejects.toThrow(DASHBOARD_AUTO_REFRESH_PROBLEM);

    await hooks.checkUpdateBeforeReferences({
      query: {},
      data: {
        dashboardViewConfig: configWith({
          timeRange: TimeRange.PAST_ONE_WEEK,
        }),
      },
      props: { isRoot: true },
    } as unknown as UpdateBy<Dashboard>);
  });

  test("an update of other columns is not asked about the config", async () => {
    await hooks.checkUpdateBeforeReferences({
      query: {},
      data: { pageTitle: "Checkout API" },
      props: { isRoot: true },
    } as unknown as UpdateBy<Dashboard>);
  });
});

describe("a dashboard created with defaults", () => {
  type CreateHook = (createBy: CreateBy<Dashboard>) => Promise<{
    createBy: CreateBy<Dashboard>;
  }>;

  const onBeforeCreate: CreateHook = (
    DashboardService as unknown as { onBeforeCreate: CreateHook }
  ).onBeforeCreate.bind(DashboardService);

  test("keeps its config exactly as it was sent, the defaults included - what Terraform reads back", async () => {
    const sent: JSONObject = configWith({
      components: [
        JSON.parse(
          JSON.stringify(DashboardTextComponentUtil.getDefaultComponent()),
        ),
      ],
      timeRange: TimeRange.PAST_ONE_DAY,
      refreshInterval: AutoRefreshInterval.ONE_MINUTE,
    });
    const dashboard: Dashboard = new Dashboard();
    dashboard.projectId = ObjectID.generate();
    dashboard.name = "Production wall screen";
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
});

describe("a public dashboard's visitors", () => {
  test("receive the defaults with the config, so the public dashboard opens on them", () => {
    const served: DashboardViewConfig | null =
      PublicDashboardViewConfig.sanitize(
        configWith({
          timeRange: TimeRange.PAST_ONE_WEEK,
          refreshInterval: AutoRefreshInterval.FIVE_MINUTES,
        }) as unknown as DashboardViewConfig,
      );

    expect(served?.timeRange).toBe(TimeRange.PAST_ONE_WEEK);
    expect(served?.refreshInterval).toBe(AutoRefreshInterval.FIVE_MINUTES);
  });

  test("and from a config stored in the API reference's envelope, too", () => {
    const served: DashboardViewConfig | null =
      PublicDashboardViewConfig.sanitize({
        _type: "DashboardViewConfig",
        value: configWith({ timeRange: TimeRange.PAST_TWO_DAYS }),
      } as unknown as DashboardViewConfig);

    expect(served?.timeRange).toBe(TimeRange.PAST_TWO_DAYS);
  });
});
