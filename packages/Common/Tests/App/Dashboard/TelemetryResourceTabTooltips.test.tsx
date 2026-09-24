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
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  explanationOnFocus,
  explanationOnHover,
  expectNotNestedInControl,
  infoButtonsFor,
  infoLabels,
} from "./HostTooltipHarness";
import { expectReadableDescriptionRecord } from "./MetricDescriptionRules";

/*
 * The (i) tooltips on two telemetry-resource tabs that are not overviews:
 *
 *   - Cloud environment > Instances, whose CPU and Memory columns show the
 *     one reading ingest mirrors onto each instance row. The table is
 *     replaced by a recorder so the columns the page builds - header
 *     tooltip and cell renderer - can be read, run, and fed to the real
 *     table header;
 *   - Service > Profiles, whose flame graph has no title of its own - the
 *     heading above it, "Where the time is going", carries the (i). The
 *     page is rendered for real with the flame graph and the profile list
 *     replaced by recorders, so the window and type the text promises can
 *     be read off the props the flame graph receives.
 *
 * jest.mock is hoisted above the imports, so the factories only close over
 * names that start with "mock".
 */

const mockModelTable: MockFunction = getJestMockFunction();
const mockFlamegraph: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-4444-4aaa-8bbb-000000000004");
      },
      navigate: () => {},
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      mockModelTable(props);
      return <div data-testid="model-table" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/AggregatedFlamegraph",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        mockFlamegraph(props);
        return <div data-testid="aggregated-flamegraph" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileTable",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="profile-table" />;
      },
    };
  },
);

import CloudResourceInstances from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Instances";
import ServiceProfiles from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Profiles";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  CLOUD_INSTANCE_METRIC_DESCRIPTIONS,
  CloudInstanceMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/CloudMetricDescriptions";
import {
  SERVICE_PROFILE_METRIC_DESCRIPTIONS,
  ServiceProfileMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/ServiceMetricDescriptions";
import TableHeader from "../../../UI/Components/Table/TableHeader";
import Columns from "../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../UI/Components/Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";

const CLOUD: Record<CloudInstanceMetric, string> =
  CLOUD_INSTANCE_METRIC_DESCRIPTIONS;
const PROFILES: Record<ServiceProfileMetric, string> =
  SERVICE_PROFILE_METRIC_DESCRIPTIONS;

// The pages read their ids from the route, not from these props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const MIB: number = 1024 * 1024;
const MINUTE_MS: number = 60 * 1000;
const FLAMEGRAPH_TITLE: string = "Where the time is going";
// The pill's name also carries its icon.
const EVERYTHING_PILL: RegExp = /Everything/;

beforeEach(() => {
  jest.useFakeTimers();
  mockModelTable.mockReset();
  mockFlamegraph.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// ------------------------------------------------------- Cloud Instances

type CapturedColumn = {
  field: Record<string, unknown>;
  title: string;
  type: FieldType;
  headerTooltip?: string | undefined;
  disableSort?: boolean | undefined;
  getElement?: ((item: unknown) => React.ReactElement) | undefined;
};

function instanceColumns(): Array<CapturedColumn> {
  render(<CloudResourceInstances {...PAGE_PROPS} />);
  expect(mockModelTable).toHaveBeenCalled();

  const props: { columns: Array<CapturedColumn> } = mockModelTable.mock.calls[
    mockModelTable.mock.calls.length - 1
  ]![0] as { columns: Array<CapturedColumn> };

  return props.columns;
}

function instanceColumn(title: string): CapturedColumn {
  const found: CapturedColumn | undefined = instanceColumns().find(
    (column: CapturedColumn): boolean => {
      return column.title === title;
    },
  );

  expect(found).toBeDefined();

  return found!;
}

function cellText(column: CapturedColumn, item: unknown): string {
  const cell: ReturnType<typeof render> = render(column.getElement!(item));
  const text: string = cell.container.textContent || "";

  cell.unmount();

  return text;
}

type HeaderRow = Record<string, unknown>;

/*
 * The captured columns, drawn by the real table header the way ModelTable
 * hands them over (ModelTable spreads each column, headerTooltip included,
 * and keys it by its field).
 */
function renderInstanceHeader(): void {
  const columns: Columns<HeaderRow> = instanceColumns().map(
    (column: CapturedColumn) => {
      return {
        title: column.title,
        type: column.type,
        key: Object.keys(column.field)[0] as string,
        headerTooltip: column.headerTooltip,
        disableSort: column.disableSort,
      };
    },
  );

  cleanup();

  render(
    <table>
      <TableHeader<HeaderRow>
        id="cloud-resource-instances-header"
        columns={columns}
        onSortChanged={() => {}}
        isBulkActionsEnabled={false}
        onAllItemsOnThePageSelected={undefined}
        onAllItemsDeselected={undefined}
        hasTableItems={true}
        isAllItemsOnThePageSelected={false}
        sortBy={null}
        sortOrder={SortOrder.Descending}
      />
    </table>,
  );
}

describe("Cloud Instances tab", () => {
  test("the texts read as short, finished sentences", () => {
    expectReadableDescriptionRecord(
      CLOUD_INSTANCE_METRIC_DESCRIPTIONS,
      "CLOUD_INSTANCE_METRIC_DESCRIPTIONS",
    );
  });

  test("CPU and Memory carry their own text; the other columns carry none", () => {
    const tooltips: Record<string, string | undefined> = {};

    for (const column of instanceColumns()) {
      tooltips[column.title] = column.headerTooltip;
    }

    expect(tooltips).toEqual({
      Instance: undefined,
      Status: undefined,
      CPU: CLOUD.cpu,
      Memory: CLOUD.memory,
      "Last Seen": undefined,
    });
  });

  test("the header shows an (i) beside CPU and Memory only, each with its own text", async () => {
    renderInstanceHeader();

    expect(infoLabels()).toEqual(["CPU", "Memory"]);

    const cpu: HTMLElement = infoButtonsFor("CPU")[0]!;
    const memory: HTMLElement = infoButtonsFor("Memory")[0]!;

    expect(await explanationOnHover(cpu)).toBe(CLOUD.cpu);
    expect(await explanationOnFocus(memory)).toBe(CLOUD.memory);

    // Beside the sort button, never inside it.
    expectNotNestedInControl(cpu);
    expectNotNestedInControl(memory);
    expect(
      within(cpu.closest("th") as HTMLElement).getByRole("button", {
        name: "CPU",
      }),
    ).not.toContainElement(cpu);
  });

  test("asking what CPU means does not sort the table", () => {
    const onSortChanged: MockFunction = getJestMockFunction();
    const columns: Columns<HeaderRow> = [
      {
        title: "CPU",
        type: FieldType.Element,
        key: "latestCpuPercent",
        headerTooltip: instanceColumn("CPU").headerTooltip,
      },
    ];

    cleanup();
    render(
      <table>
        <TableHeader<HeaderRow>
          id="cloud-resource-instances-sort"
          columns={columns}
          onSortChanged={onSortChanged}
          isBulkActionsEnabled={false}
          onAllItemsOnThePageSelected={undefined}
          onAllItemsDeselected={undefined}
          hasTableItems={true}
          isAllItemsOnThePageSelected={false}
          sortBy={null}
          sortOrder={SortOrder.Descending}
        />
      </table>,
    );

    fireEvent.click(screen.getByRole("button", { name: "About CPU" }));
    expect(onSortChanged).not.toHaveBeenCalled();
  });

  test("'can read above 100%': the CPU cell shows the stored percentage uncapped", () => {
    const cpu: CapturedColumn = instanceColumn("CPU");

    expect(cellText(cpu, { latestCpuPercent: 250 })).toBe("250.0%");
    expect(cellText(cpu, { latestCpuPercent: 37.25 })).toBe("37.3%");
    expect(CLOUD.cpu).toContain("so it can read above 100%");
  });

  test("'A dash means no reading has arrived': both cells show a dash without one", () => {
    const cpu: CapturedColumn = instanceColumn("CPU");
    const memory: CapturedColumn = instanceColumn("Memory");

    expect(cellText(cpu, {})).toBe("—");
    expect(cellText(cpu, { latestCpuPercent: undefined })).toBe("—");
    expect(cellText(memory, {})).toBe("—");
    expect(cellText(memory, { latestMemoryBytes: 512 * MIB })).toBe("512 MiB");

    expect(CLOUD.cpu).toContain("A dash means no CPU reading has arrived.");
    expect(CLOUD.memory).toContain(
      "A dash means no memory reading has arrived.",
    );
  });

  test("a Stale row keeps showing its last reading, as 'kept until a newer one arrives' says", () => {
    const status: CapturedColumn = instanceColumn("Status");
    const cpu: CapturedColumn = instanceColumn("CPU");
    const staleRow: Record<string, unknown> = {
      lastSeenAt: new Date(Date.now() - 60 * MINUTE_MS),
      latestCpuPercent: 42,
    };

    expect(cellText(status, staleRow)).toBe("Stale");
    expect(cellText(cpu, staleRow)).toBe("42.0%");

    for (const key of ["cpu", "memory"] as const) {
      expect(CLOUD[key]).toContain("kept until a newer one arrives");
    }
  });
});

// ------------------------------------------------------ Service Profiles

type FlamegraphProps = {
  startTime: Date;
  endTime: Date;
  profileType?: string | undefined;
};

function lastFlamegraphProps(): FlamegraphProps {
  expect(mockFlamegraph).toHaveBeenCalled();

  return mockFlamegraph.mock.calls[
    mockFlamegraph.mock.calls.length - 1
  ]![0] as FlamegraphProps;
}

function windowMinutes(props: FlamegraphProps): number {
  return (props.endTime.getTime() - props.startTime.getTime()) / MINUTE_MS;
}

describe("Service Profiles tab", () => {
  test("the text reads as a short, finished sentence", () => {
    expectReadableDescriptionRecord(
      SERVICE_PROFILE_METRIC_DESCRIPTIONS,
      "SERVICE_PROFILE_METRIC_DESCRIPTIONS",
    );
  });

  test("the heading above the flame graph carries the page's only (i)", async () => {
    render(<ServiceProfiles {...PAGE_PROPS} />);

    expect(
      screen.getByRole("heading", { name: FLAMEGRAPH_TITLE }),
    ).toBeInTheDocument();
    expect(infoLabels()).toEqual([FLAMEGRAPH_TITLE]);

    const info: HTMLElement = infoButtonsFor(FLAMEGRAPH_TITLE)[0]!;

    expect(await explanationOnHover(info)).toBe(PROFILES.flamegraph);
    expect(await explanationOnFocus(info)).toBe(PROFILES.flamegraph);
    expectNotNestedInControl(info);
  });

  test("clicking the (i) changes neither the window nor the type", () => {
    render(<ServiceProfiles {...PAGE_PROPS} />);

    const before: FlamegraphProps = lastFlamegraphProps();

    fireEvent.click(infoButtonsFor(FLAMEGRAPH_TITLE)[0]!);

    const after: FlamegraphProps = lastFlamegraphProps();

    expect(windowMinutes(after)).toBe(windowMinutes(before));
    expect(after.profileType).toBe(before.profileType);
  });

  test("'the time window picked beside it': the flame graph follows the tab's chips", () => {
    render(<ServiceProfiles {...PAGE_PROPS} />);

    expect(windowMinutes(lastFlamegraphProps())).toBe(60);

    fireEvent.click(screen.getByRole("button", { name: "15m" }));
    expect(windowMinutes(lastFlamegraphProps())).toBe(15);

    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    expect(windowMinutes(lastFlamegraphProps())).toBe(7 * 24 * 60);

    expect(PROFILES.flamegraph).toContain(
      "in the time window picked beside it",
    );
  });

  test("'CPU time by default', and Everything sends no type at all", () => {
    render(<ServiceProfiles {...PAGE_PROPS} />);

    expect(lastFlamegraphProps().profileType).toBe("cpu");
    expect(PROFILES.flamegraph).toContain("CPU time by default");

    fireEvent.click(screen.getByRole("button", { name: EVERYTHING_PILL }));
    expect(lastFlamegraphProps().profileType).toBeUndefined();
    expect(PROFILES.flamegraph).toContain(
      "every type added together for Everything",
    );
  });
});
