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
import { Mock } from "jest-mock";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import ArgumentsForm from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm";
import DashboardCanvas from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index";
import {
  SORT_SETTING_SECTION_NAME,
  WIDGET_SORT_DEFAULT_VALUE,
  getWidgetSortOptionValue,
  getWidgetSortOptions,
  getWidgetSortSettingColumns,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/WidgetSortOptions";
import {
  DASHBOARD_WIDGET_SORT_SETTING_TEST_ID,
  getDashboardWidgetSortHeaderTestId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetSortCopy";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import {
  DashboardWidgetSortColumns,
  DashboardWidgetSortDirection,
  DashboardWidgetSortKind,
  readDashboardWidgetSortChoiceForColumns,
} from "../../../Types/Dashboard/DashboardWidgetSort";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import DashboardMonitorListComponentUtil from "../../../Utils/Dashboard/Components/DashboardMonitorListComponent";
import DashboardValueComponentUtil from "../../../Utils/Dashboard/Components/DashboardValueComponent";
import DashboardDataSourceTableComponentUtil from "../../../Utils/Dashboard/Components/DashboardDataSourceTableComponent";
import DashboardComponentsUtil from "../../../Utils/Dashboard/Components/Index";
import {
  DASHBOARD_WIDGET_TYPES_SORTED_BY_OWN_COLUMNS,
  getDashboardWidgetSortComponentTypes,
} from "../../../Utils/Dashboard/DashboardWidgetSorts";
import { createTranslator } from "../../../UI/Utils/TranslateTemplate";
import { ComponentArgument } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import fs from "fs";
import path from "path";

// A Dashboard locale file as it ships.
function readDashboardLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

/*
 * A list or table widget's Sort setting (issue #5082): the order everyone
 * sees its rows in, saved with the widget as `arguments.sort`. Its first
 * choice is the order the widget always had; then each sortable column,
 * its first way first. A click on a column header in the settings' live
 * preview sets it too.
 */

type GetList = (request: JSONObject) => Promise<{
  data: Array<JSONObject>;
  count: number;
}>;

const listMock: Mock<GetList> = jest.fn<GetList>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: JSONObject) => {
        return listMock(request);
      },
      count: () => {
        return Promise.resolve(0);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return PROJECT_ID;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: { children: React.ReactNode }) => {
        return <span>{props.children}</span>;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap", () => {
  return {
    __esModule: true,
    default: {},
    RouteUtil: {
      populateRouteParams: () => {
        return {
          toString: () => {
            return "/monitor";
          },
        };
      },
    },
  };
});

/*
 * jsdom has no ResizeObserver and lays nothing out, and the settings
 * preview only draws once it has measured a width. Report a real one.
 */
class FakeResizeObserver {
  private callback: ResizeObserverCallback;

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  public observe(): void {
    this.callback(
      [{ contentRect: { width: 800 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }

  public unobserve(): void {
    // Nothing to stop observing.
  }

  public disconnect(): void {
    // Nothing to disconnect.
  }
}

const ENGLISH: ReturnType<typeof createTranslator> = createTranslator(
  undefined,
  "en",
);

type OnFormChange = (component: DashboardBaseComponent) => void;

function monitorList(widgetArguments: JSONObject = {}): DashboardBaseComponent {
  const component: DashboardBaseComponent =
    DashboardMonitorListComponentUtil.getDefaultComponent() as DashboardBaseComponent;
  component.arguments = {
    title: "Monitors",
    maxRows: 25,
    ...widgetArguments,
  } as DashboardBaseComponent["arguments"];
  return component;
}

function sortCombobox(): HTMLElement {
  return within(
    screen.getByTestId(DASHBOARD_WIDGET_SORT_SETTING_TEST_ID),
  ).getByRole("combobox");
}

// The open menu's choices: it is drawn on the page body, as a listbox.
function openSortChoices(): Array<string> {
  fireEvent.keyDown(sortCombobox(), { key: "ArrowDown" });
  return within(screen.getByRole("listbox"))
    .getAllByRole("option")
    .map((option: HTMLElement): string => {
      return (option.textContent || "").trim();
    });
}

function pickSortChoice(label: string): void {
  fireEvent.keyDown(sortCombobox(), { key: "ArrowDown" });
  const option: HTMLElement = within(screen.getByRole("listbox")).getByRole(
    "option",
    { name: label },
  );
  fireEvent.mouseDown(option);
  fireEvent.click(option);
}

function lastSaved(onFormChange: Mock<OnFormChange>): JSONObject {
  const calls: Array<[DashboardBaseComponent]> = onFormChange.mock.calls;
  const last: [DashboardBaseComponent] | undefined = calls[calls.length - 1];

  expect(last).toBeDefined();
  return last![0].arguments as JSONObject;
}

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    FakeResizeObserver;
});

beforeEach(() => {
  listMock.mockReset();
  listMock.mockResolvedValue({ data: [], count: 0 });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("the Sort setting's choices", () => {
  test("a monitor list offers its own order first, then each column its first way first", () => {
    const columns: DashboardWidgetSortColumns | null =
      getWidgetSortSettingColumns(DashboardComponentType.MonitorList, null);

    expect(
      getWidgetSortOptions({
        columns: columns!.columns,
        builtInSort: columns!.builtInSort,
        savedSort: undefined,
        translator: ENGLISH,
      }),
    ).toEqual([
      { value: WIDGET_SORT_DEFAULT_VALUE, label: "Default (Name: A to Z)" },
      // Name, A to Z is the default: offered once.
      { value: "name:desc", label: "Name: Z to A" },
      { value: "status:desc", label: "Status: Worst first" },
      { value: "status:asc", label: "Status: Best first" },
      { value: "type:asc", label: "Type: A to Z" },
      { value: "type:desc", label: "Type: Z to A" },
    ]);
  });

  test("an incident list's own order is newest first", () => {
    const columns: DashboardWidgetSortColumns | null =
      getWidgetSortSettingColumns(DashboardComponentType.IncidentList, null);

    const options: Array<{ value: string; label: string }> =
      getWidgetSortOptions({
        columns: columns!.columns,
        builtInSort: columns!.builtInSort,
        savedSort: undefined,
        translator: ENGLISH,
      });

    expect(options[0]).toEqual({
      value: WIDGET_SORT_DEFAULT_VALUE,
      label: "Default (Declared: Newest first)",
    });
    expect(options).toContainEqual({
      value: "severity:desc",
      label: "Severity: Worst first",
    });
    expect(options).toContainEqual({
      value: "declared:asc",
      label: "Declared: Oldest first",
    });
    expect(
      options.some((option: { value: string }): boolean => {
        return option.value === "declared:desc";
      }),
    ).toBe(false);
  });

  /*
   * A saved sort on a column the widget no longer has is kept as a choice of
   * its own, so the setting shows what is saved - but in words: the widget
   * reads such a sort as none and shows its default order, which the stored
   * key ("uptime:desc", "group:asc") never said.
   */
  test("a saved sort on a column the widget no longer has says so, never its stored key", () => {
    const columns: DashboardWidgetSortColumns | null =
      getWidgetSortSettingColumns(DashboardComponentType.MonitorList, null);

    const options: Array<{ value: string; label: string }> =
      getWidgetSortOptions({
        columns: columns!.columns,
        builtInSort: columns!.builtInSort,
        savedSort: "uptime:desc",
        translator: ENGLISH,
      });

    expect(options[options.length - 1]).toEqual({
      value: "uptime:desc",
      label: "A removed column (the default order is shown)",
    });

    for (const option of options) {
      expect(option.label).not.toContain(":desc");
      expect(option.label).not.toContain(":asc");
    }

    // The widget itself reads that sort as none: its default order.
    expect(
      readDashboardWidgetSortChoiceForColumns("uptime:desc", columns!.columns),
    ).toBeNull();
  });

  test("a trace table's saved sort on its group column, once it groups by a resource, reads as a removed column", () => {
    /*
     * Grouped by a resource (a host, a cluster), its preview reports the
     * metric columns only: the server names those ids after ranking, so the
     * group column does not sort. A sort an editor saved while it grouped
     * by span name is then on a column it no longer has.
     */
    const metricColumnsOnly: DashboardWidgetSortColumns =
      getWidgetSortSettingColumns(DashboardComponentType.TraceTable, null)!;
    const columns: DashboardWidgetSortColumns | null =
      getWidgetSortSettingColumns(
        DashboardComponentType.TraceTable,
        metricColumnsOnly,
      );

    expect(
      columns!.columns.some((column: { key: string }): boolean => {
        return column.key === "group";
      }),
    ).toBe(false);

    const options: Array<{ value: string; label: string }> =
      getWidgetSortOptions({
        columns: columns!.columns,
        builtInSort: columns!.builtInSort,
        savedSort: "group:asc",
        translator: ENGLISH,
      });

    expect(
      options.find((option: { value: string }): boolean => {
        return option.value === "group:asc";
      }),
    ).toEqual({
      value: "group:asc",
      label: "A removed column (the default order is shown)",
    });
  });

  test("a Data Source column saved before the query has answered is named as the query names it", () => {
    const before: DashboardWidgetSortColumns | null =
      getWidgetSortSettingColumns(DashboardComponentType.DataSourceTable, null);

    expect(
      getWidgetSortOptions({
        columns: before!.columns,
        builtInSort: before!.builtInSort,
        savedSort: "p95_latency:desc",
        translator: ENGLISH,
      }),
    ).toEqual([
      { value: WIDGET_SORT_DEFAULT_VALUE, label: "The query's order" },
      { value: "p95_latency:desc", label: "p95_latency: Descending" },
    ]);
    expect(
      getWidgetSortOptions({
        columns: before!.columns,
        builtInSort: before!.builtInSort,
        savedSort: "service:asc",
        translator: ENGLISH,
      })[1],
    ).toEqual({ value: "service:asc", label: "service: Ascending" });
  });

  test("the removed column's words read in the reader's language", () => {
    const columns: DashboardWidgetSortColumns | null =
      getWidgetSortSettingColumns(DashboardComponentType.MonitorList, null);
    const germanWords: Record<string, string> = readDashboardLocale("de");
    const GERMAN: ReturnType<typeof createTranslator> = createTranslator(
      (key: string): string | undefined => {
        return germanWords[key];
      },
      "de",
    );

    const removed: { value: string; label: string } | undefined =
      getWidgetSortOptions({
        columns: columns!.columns,
        builtInSort: columns!.builtInSort,
        savedSort: "uptime:desc",
        translator: GERMAN,
      }).find((option: { value: string }): boolean => {
        return option.value === "uptime:desc";
      });

    expect(removed?.label).toBe(
      germanWords["A removed column (the default order is shown)"],
    );
    expect(removed?.label).not.toBe(
      "A removed column (the default order is shown)",
    );

    const before: DashboardWidgetSortColumns | null =
      getWidgetSortSettingColumns(DashboardComponentType.DataSourceTable, null);

    expect(
      getWidgetSortOptions({
        columns: before!.columns,
        builtInSort: before!.builtInSort,
        savedSort: "errors:desc",
        translator: GERMAN,
      })[1]!.label,
    ).toBe(`errors: ${germanWords["Descending"]}`);
  });

  test("the saved sort selects its choice; none, or the built-in order, selects the default", () => {
    const builtIn: { column: string; direction: DashboardWidgetSortDirection } =
      {
        column: "name",
        direction: DashboardWidgetSortDirection.Ascending,
      };

    expect(
      getWidgetSortOptionValue({
        savedSort: "status:desc",
        builtInSort: builtIn,
      }),
    ).toBe("status:desc");
    expect(
      getWidgetSortOptionValue({ savedSort: undefined, builtInSort: builtIn }),
    ).toBe(WIDGET_SORT_DEFAULT_VALUE);
    expect(
      getWidgetSortOptionValue({ savedSort: "name:asc", builtInSort: builtIn }),
    ).toBe(WIDGET_SORT_DEFAULT_VALUE);
    expect(
      getWidgetSortOptionValue({ savedSort: "nonsense", builtInSort: builtIn }),
    ).toBe(WIDGET_SORT_DEFAULT_VALUE);
  });

  test("a Data Source table has only its query's order until the query names its columns", () => {
    const before: DashboardWidgetSortColumns | null =
      getWidgetSortSettingColumns(DashboardComponentType.DataSourceTable, null);

    expect(before).toEqual({ columns: [], builtInSort: null });
    expect(
      getWidgetSortOptions({
        columns: before!.columns,
        builtInSort: before!.builtInSort,
        savedSort: undefined,
        translator: ENGLISH,
      }),
    ).toEqual([
      { value: WIDGET_SORT_DEFAULT_VALUE, label: "The query's order" },
    ]);

    const reported: DashboardWidgetSortColumns = {
      columns: [
        {
          key: "errors",
          title: "Errors",
          kind: DashboardWidgetSortKind.Number,
          isTitleUserText: true,
        },
      ],
      builtInSort: null,
    };

    expect(
      getWidgetSortOptions({
        columns: getWidgetSortSettingColumns(
          DashboardComponentType.DataSourceTable,
          reported,
        )!.columns,
        builtInSort: null,
        savedSort: undefined,
        translator: ENGLISH,
      }),
    ).toEqual([
      { value: WIDGET_SORT_DEFAULT_VALUE, label: "The query's order" },
      { value: "errors:desc", label: "Errors: Highest first" },
      { value: "errors:asc", label: "Errors: Lowest first" },
    ]);
  });

  test("a metric table has no Sort setting until its preview reports its columns", () => {
    expect(
      getWidgetSortSettingColumns(DashboardComponentType.Table, null),
    ).toBeNull();

    const reported: DashboardWidgetSortColumns = {
      columns: [
        {
          key: "attr:0",
          title: "Service",
          kind: DashboardWidgetSortKind.Text,
          isTitleUserText: true,
        },
      ],
      builtInSort: {
        column: "attr:0",
        direction: DashboardWidgetSortDirection.Ascending,
      },
    };

    expect(
      getWidgetSortSettingColumns(DashboardComponentType.Table, reported),
    ).toBe(reported);
  });

  test("a trace table offers its metric columns before its preview names the group column", () => {
    const columns: DashboardWidgetSortColumns | null =
      getWidgetSortSettingColumns(DashboardComponentType.TraceTable, null);

    expect(
      columns!.columns.map((column: { key: string }): string => {
        return column.key;
      }),
    ).toEqual([
      "count",
      "errorCount",
      "avg",
      "p50",
      "p90",
      "p95",
      "p99",
      "min",
      "max",
    ]);
    expect(
      getWidgetSortOptions({
        columns: columns!.columns,
        builtInSort: columns!.builtInSort,
        savedSort: undefined,
        translator: ENGLISH,
      })[0],
    ).toEqual({
      value: WIDGET_SORT_DEFAULT_VALUE,
      label: "Default (Requests: Highest first)",
    });
  });

  test("widgets that do not sort have no Sort setting", () => {
    for (const componentType of [
      DashboardComponentType.Chart,
      DashboardComponentType.Value,
      DashboardComponentType.Text,
      DashboardComponentType.Gauge,
      DashboardComponentType.LogStream,
    ]) {
      expect(getWidgetSortSettingColumns(componentType, null)).toBeNull();
    }
  });

  test("every widget that sorts has the section the Sort setting sits in", () => {
    const sortable: Array<DashboardComponentType> = [
      ...getDashboardWidgetSortComponentTypes(),
      ...DASHBOARD_WIDGET_TYPES_SORTED_BY_OWN_COLUMNS,
    ];

    expect(sortable.length).toBeGreaterThan(30);

    for (const componentType of sortable) {
      const sections: Array<string> =
        DashboardComponentsUtil.getComponentSettingsArguments(
          componentType,
        ).map((argument: ComponentArgument<DashboardBaseComponent>): string => {
          return argument.section?.name || "";
        });

      expect({
        componentType,
        hasSection: sections.includes(SORT_SETTING_SECTION_NAME),
      }).toEqual({
        componentType,
        hasSection: true,
      });
    }
  });
});

describe("the Sort setting in a list widget's settings", () => {
  test("sits in Display Options, showing the widget's own order", async () => {
    render(
      <ArgumentsForm
        component={monitorList()}
        metrics={{ metricTypes: [], telemetryAttributes: [] }}
        onFormChange={jest.fn<OnFormChange>()}
      />,
    );

    const setting: HTMLElement = await screen.findByTestId(
      DASHBOARD_WIDGET_SORT_SETTING_TEST_ID,
    );
    expect(within(setting).getByText("Sort")).toBeInTheDocument();
    expect(
      within(setting).getByText(
        "The order everyone sees the rows in. Viewers can still click a column header to sort it their own way.",
      ),
    ).toBeInTheDocument();
    expect(
      within(setting).getByText("Default (Name: A to Z)"),
    ).toBeInTheDocument();
    expect(sortCombobox()).toHaveAccessibleName("Sort");

    expect(openSortChoices()).toEqual([
      "Default (Name: A to Z)",
      "Name: Z to A",
      "Status: Worst first",
      "Status: Best first",
      "Type: A to Z",
      "Type: Z to A",
    ]);
  });

  test("picking a choice saves it as the widget's sort, keeping its other settings", async () => {
    const onFormChange: Mock<OnFormChange> = jest.fn<OnFormChange>();

    render(
      <ArgumentsForm
        component={monitorList({ statusFilter: "non-operational" })}
        metrics={{ metricTypes: [], telemetryAttributes: [] }}
        onFormChange={onFormChange}
      />,
    );
    await screen.findByTestId(DASHBOARD_WIDGET_SORT_SETTING_TEST_ID);

    pickSortChoice("Status: Worst first");

    expect(lastSaved(onFormChange)).toMatchObject({
      title: "Monitors",
      maxRows: 25,
      statusFilter: "non-operational",
      sort: "status:desc",
    });
  });

  test("the default choice takes a saved sort off the widget", async () => {
    const onFormChange: Mock<OnFormChange> = jest.fn<OnFormChange>();

    render(
      <ArgumentsForm
        component={monitorList({ sort: "status:desc" })}
        metrics={{ metricTypes: [], telemetryAttributes: [] }}
        onFormChange={onFormChange}
      />,
    );
    const setting: HTMLElement = await screen.findByTestId(
      DASHBOARD_WIDGET_SORT_SETTING_TEST_ID,
    );
    expect(
      within(setting).getByText("Status: Worst first"),
    ).toBeInTheDocument();

    pickSortChoice("Default (Name: A to Z)");

    const saved: JSONObject = lastSaved(onFormChange);
    expect(saved).not.toHaveProperty("sort");
    expect(saved["title"]).toBe("Monitors");
  });

  test("a widget that does not sort has no Sort setting", async () => {
    const value: DashboardBaseComponent =
      DashboardValueComponentUtil.getDefaultComponent() as DashboardBaseComponent;

    render(
      <ArgumentsForm
        component={value}
        metrics={{ metricTypes: [], telemetryAttributes: [] }}
        onFormChange={jest.fn<OnFormChange>()}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    });
    expect(
      screen.queryByTestId(DASHBOARD_WIDGET_SORT_SETTING_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a table's columns come from its preview", async () => {
    const table: DashboardBaseComponent =
      DashboardDataSourceTableComponentUtil.getDefaultComponent() as DashboardBaseComponent;

    render(
      <ArgumentsForm
        component={table}
        metrics={{ metricTypes: [], telemetryAttributes: [] }}
        onFormChange={jest.fn<OnFormChange>()}
        widgetSortColumns={{
          columns: [
            {
              key: "service",
              title: "service_name",
              kind: DashboardWidgetSortKind.Text,
              isTitleUserText: true,
            },
          ],
          builtInSort: null,
        }}
      />,
    );
    await screen.findByTestId(DASHBOARD_WIDGET_SORT_SETTING_TEST_ID);

    expect(openSortChoices()).toEqual([
      "The query's order",
      "service_name: A to Z",
      "service_name: Z to A",
    ]);
  });
});

describe("a click on a column header in the settings preview", () => {
  const MONITOR_LIST_ID: ObjectID = new ObjectID(
    "abababab-2222-4222-8222-abababababab",
  );

  const BOARD_RANGE: RangeStartAndEndDateTime = {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(
      new Date("2026-10-19T10:00:00.000Z"),
      new Date("2026-10-19T11:00:00.000Z"),
    ),
  };

  function initialConfig(): DashboardViewConfig {
    const component: DashboardBaseComponent = monitorList();
    component.componentId = MONITOR_LIST_ID;

    return {
      _type: ObjectType.DashboardViewConfig,
      components: [component],
      heightInDashboardUnits: 12,
    };
  }

  function EditedDashboard(props: {
    onChange: (config: DashboardViewConfig) => void;
  }): React.ReactElement {
    const [config, setConfig] =
      React.useState<DashboardViewConfig>(initialConfig());

    return (
      <DashboardCanvas
        dashboardViewConfig={config}
        onDashboardViewConfigChange={(next: DashboardViewConfig) => {
          setConfig(next);
          props.onChange(next);
        }}
        isEditMode={true}
        currentTotalDashboardWidthInPx={1200}
        onComponentSelected={() => {}}
        onComponentUnselected={() => {}}
        selectedComponentId={MONITOR_LIST_ID}
        metrics={{ metricTypes: [], telemetryAttributes: [] }}
        dashboardStartAndEndDate={BOARD_RANGE}
        refreshTick={0}
        isDashboardTimeRangeZoomed={false}
        dashboardId="d0000000-0000-4000-8000-0000000000cc"
      />
    );
  }

  beforeEach(() => {
    listMock.mockResolvedValue({
      data: [
        {
          _id: "33333333-3333-4333-8333-333333333333",
          name: "checkout",
          monitorType: "Website",
          currentMonitorStatus: { name: "Offline" },
        },
      ],
      count: 1,
    });
  });

  test("sets the widget's own sort, which the Sort setting then shows - and keeps no pick", async () => {
    const onChange: Mock<(config: DashboardViewConfig) => void> =
      jest.fn<(config: DashboardViewConfig) => void>();

    render(<EditedDashboard onChange={onChange} />);

    const modal: HTMLElement = await screen.findByTestId("modal");
    const statusHeader: HTMLElement = await within(modal).findByTestId(
      getDashboardWidgetSortHeaderTestId("status"),
    );

    fireEvent.click(statusHeader);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const saved: DashboardViewConfig =
      onChange.mock.calls[onChange.mock.calls.length - 1]![0];
    expect((saved.components[0]!.arguments as JSONObject)["sort"]).toBe(
      "status:desc",
    );

    const setting: HTMLElement = within(modal).getByTestId(
      DASHBOARD_WIDGET_SORT_SETTING_TEST_ID,
    );
    await waitFor(() => {
      expect(
        within(setting).getByText("Status: Worst first"),
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        within(modal)
          .getByTestId(getDashboardWidgetSortHeaderTestId("status"))
          .closest("th"),
      ).toHaveAttribute("aria-sort", "descending");
    });

    // The preview is the widget as everyone will see it: no viewer pick.
    expect(window.localStorage.length).toBe(0);
  });

  test("the preview's header cycles the widget's own sort back to its built-in order", async () => {
    const onChange: Mock<(config: DashboardViewConfig) => void> =
      jest.fn<(config: DashboardViewConfig) => void>();

    render(<EditedDashboard onChange={onChange} />);

    const modal: HTMLElement = await screen.findByTestId("modal");
    const header: () => HTMLElement = (): HTMLElement => {
      return within(modal).getByTestId(
        getDashboardWidgetSortHeaderTestId("status"),
      );
    };
    await within(modal).findByTestId(
      getDashboardWidgetSortHeaderTestId("status"),
    );

    const savedSort: () => unknown = (): unknown => {
      const calls: Array<[DashboardViewConfig]> = onChange.mock.calls;
      return (
        calls[calls.length - 1]![0].components[0]!.arguments as JSONObject
      )["sort"];
    };

    fireEvent.click(header());
    await waitFor(() => {
      expect(savedSort()).toBe("status:desc");
    });

    fireEvent.click(header());
    await waitFor(() => {
      expect(savedSort()).toBe("status:asc");
    });

    fireEvent.click(header());
    await waitFor(() => {
      expect(savedSort()).toBeUndefined();
    });
    await waitFor(() => {
      expect(
        within(
          within(modal).getByTestId(DASHBOARD_WIDGET_SORT_SETTING_TEST_ID),
        ).getByText("Default (Name: A to Z)"),
      ).toBeInTheDocument();
    });
  });
});
