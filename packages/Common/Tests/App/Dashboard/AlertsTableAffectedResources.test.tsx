import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The alerts list (Components/Alert/AlertsTable.tsx) backs the Alerts,
 * Unresolved and Home "Active Alerts" pages and the Alerts tab of monitors,
 * services, hosts, clusters and SLOs. An alert is raised on one monitor
 * (Alert.monitor, singular), and the alert overview's Affected Resources card
 * lists it. The list's Affected Resources column never passed it to the cell,
 * so every alert raised on a monitor and linked to nothing else read "No
 * resources." right next to a Monitor column naming that monitor.
 *
 * The table is replaced by a recorder so the columns and facets the list
 * builds can be read and run; each cell is then rendered for real. AppLink is
 * a plain anchor so hrefs can be read.
 */

const modelTableMock: MockFunction = getJestMockFunction();
const resourceOwnersMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: unknown): ReactElement => {
      modelTableMock(props);
      return <div data-testid="model-table" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          { href: props.to?.toString(), className: props.className },
          props.children,
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      default: (options: unknown) => {
        resourceOwnersMock(options);
        return {
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {},
          filterBar: null,
          mergeFiltersIntoQuery: (query: unknown) => {
            return query;
          },
          facetSaveState: undefined,
          restoreFacetState: () => {},
        };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/useCustomFieldFacets",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { facets: [], isLoading: false };
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkOwnerActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Alert/BulkIncidentLinkActions",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { bulkActions: [], modals: null };
      },
    };
  },
);

import AlertsTable from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertsTable";
import { ResourceFacet } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import { FilterChipDropdownOption } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import { getExportKeysFromColumn } from "../../../UI/Components/ModelTable/ExportFromColumns";
import Column from "../../../UI/Components/Table/Types/Column";
import FieldType from "../../../UI/Components/Types/FieldType";
import TableColumnsToCsv from "../../../UI/Utils/TableColumnsToCsv";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const MONITOR_ID: string = "0193c0de-9999-4aaa-8bbb-000000000001";
const SERVICE_ID: string = "0193c0de-9999-4aaa-8bbb-000000000002";
const SLO_ID: string = "0193c0de-9999-4aaa-8bbb-000000000003";

type CapturedColumn = {
  field: Record<string, unknown>;
  title: string;
  type: FieldType;
  getElement?: ((item: Alert) => ReactElement) | undefined;
};

type ListResult = {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
};

function listResult(data: Array<unknown>): ListResult {
  return { data: data, count: data.length, skip: 0, limit: data.length };
}

function monitorHref(id: string): string {
  return `/dashboard/${PROJECT_ID}/monitors/${id}`;
}

function buildMonitor(name: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  monitor.name = name;
  return monitor;
}

function buildService(name: string): Service {
  const service: Service = new Service();
  service._id = SERVICE_ID;
  service.name = name;
  service.serviceColor = new Color("#6366f1");
  return service;
}

function buildSlo(name: string): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = SLO_ID;
  slo.name = name;
  return slo;
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderTable(): Promise<void> {
  render(<AlertsTable />);
  await flush();

  expect(modelTableMock).toHaveBeenCalled();
}

function capturedColumns(): Array<CapturedColumn> {
  const props: { columns: Array<CapturedColumn> } = modelTableMock.mock.calls[
    modelTableMock.mock.calls.length - 1
  ]![0] as { columns: Array<CapturedColumn> };

  return props.columns;
}

function column(title: string): CapturedColumn {
  const found: Array<CapturedColumn> = capturedColumns().filter(
    (c: CapturedColumn): boolean => {
      return c.title === title;
    },
  );

  expect(found).toHaveLength(1);

  return found[0]!;
}

function renderCell(title: string, alert: Alert): void {
  cleanup();
  render(column(title).getElement!(alert));
}

function facet(key: string): ResourceFacet {
  const options: { extraFacets: Array<ResourceFacet> } = resourceOwnersMock.mock
    .calls[resourceOwnersMock.mock.calls.length - 1]![0] as {
    extraFacets: Array<ResourceFacet>;
  };

  const found: Array<ResourceFacet> = options.extraFacets.filter(
    (f: ResourceFacet): boolean => {
      return f.key === key;
    },
  );

  expect(found).toHaveLength(1);

  return found[0]!;
}

function linkTexts(): Array<string> {
  return screen.getAllByRole("link").map((link: HTMLElement): string => {
    return link.textContent?.trim() || "";
  });
}

beforeEach(() => {
  modelTableMock.mockReset();
  resourceOwnersMock.mockReset();
  getListMock.mockReset();

  /*
   * One named row of whatever is asked for, so a facet that searches a
   * resource type gets an option back for it.
   */
  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { modelType: { new (): BaseModel } } = args[0] as {
      modelType: { new (): BaseModel };
    };
    const row: BaseModel = new request.modelType();
    row._id = ObjectID.generate().toString();
    (row as unknown as { name: string }).name =
      `${row.singularName || "Row"} one`;
    return listResult([row]);
  });

  goTo(`/dashboard/${PROJECT_ID}/alerts`);
});

afterEach(() => {
  cleanup();
});

describe("the alerts list's Affected Resources column", () => {
  test("lists the monitor an alert was raised on, never 'No resources.'", async () => {
    await renderTable();

    const alert: Alert = new Alert();
    alert.monitor = buildMonitor("Developer portal");

    renderCell("Affected Resources", alert);

    expect(screen.queryByText("No resources.")).toBeNull();

    const link: HTMLElement = screen.getByRole("link");

    expect(link).toHaveAttribute("href", monitorHref(MONITOR_ID));
    expect(link).toHaveTextContent("Developer portal");
    // The same type icon every other resource row carries.
    expect(link.querySelector("svg")).not.toBeNull();
  });

  test("names the same monitor the Monitor column does", async () => {
    await renderTable();

    const alert: Alert = new Alert();
    alert.monitor = buildMonitor("Developer portal");

    renderCell("Monitor", alert);
    const monitorColumnHref: string | null = screen
      .getByRole("link")
      .getAttribute("href");

    renderCell("Affected Resources", alert);

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      monitorColumnHref!,
    );
  });

  test("lists the monitor first, ahead of the service and SLO linked to the alert", async () => {
    await renderTable();

    const alert: Alert = new Alert();
    alert.monitor = buildMonitor("Developer portal");
    alert.services = [buildService("checkout-api")];
    alert.serviceLevelObjectives = [buildSlo("Checkout availability")];

    renderCell("Affected Resources", alert);

    expect(linkTexts()).toEqual([
      "Developer portal",
      "checkout-api",
      "Checkout availability",
    ]);
  });

  test("an alert with no monitor and nothing attached still reads 'No resources.'", async () => {
    await renderTable();

    renderCell("Affected Resources", new Alert());

    expect(screen.getByText("No resources.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  /*
   * Declared on this column rather than borrowed from the Monitor column, so
   * the cell still gets the monitor if that column goes. It is a secondary
   * key: a role that cannot read monitors has it dropped from the select
   * instead of the whole list failing, and hosts stays the column's primary
   * field (its sort and export key).
   */
  test("reads the monitor itself, after hosts", async () => {
    await renderTable();

    const field: Record<string, unknown> = column("Affected Resources").field;

    expect(Object.keys(field)[0]).toBe("hosts");
    expect(field["monitor"]).toEqual({
      name: true,
      _id: true,
      projectId: true,
    });
  });

  test("exports the monitor under Affected Resources", async () => {
    await renderTable();

    const affected: CapturedColumn = column("Affected Resources");
    const exportColumn: Column<Alert> = {
      title: affected.title,
      type: affected.type,
      key: "hosts",
      exportKeys: getExportKeysFromColumn<Alert>({
        column: affected as unknown as Column<Alert>,
        columnKey: "hosts",
      }),
    } as unknown as Column<Alert>;

    const alert: Alert = new Alert();
    alert.monitor = buildMonitor("Developer portal");

    expect(TableColumnsToCsv.getCellValue(alert, exportColumn)).toBe(
      "Developer portal",
    );
  });
});

/*
 * The column lists the monitor, but filtering by it stays with the dedicated
 * Monitor chip, which queries Alert.monitorId directly. Offering monitors in
 * the Affected Resources chip too would list every monitor twice and filter
 * through an ID lookup capped at LIMIT_PER_PROJECT alerts.
 */
describe("the alerts list's filters", () => {
  test("the Affected Resources chip offers every resource type but monitors", async () => {
    await renderTable();
    getListMock.mockClear();

    const options: Array<FilterChipDropdownOption> = await facet(
      "affectedResources",
    ).loadOptions!(new ObjectID(PROJECT_ID), "");

    const requestedTypes: Array<unknown> = getListMock.mock.calls.map(
      (call: Array<unknown>): unknown => {
        return (call[0] as { modelType: unknown }).modelType;
      },
    );

    expect(requestedTypes).not.toContain(Monitor);
    expect(requestedTypes).toContain(Service);
    expect(requestedTypes).toContain(ServiceLevelObjective);

    const groups: Array<string | undefined> = options.map(
      (option: FilterChipDropdownOption): string | undefined => {
        return option.group;
      },
    );

    expect(groups).not.toContain("Monitors");
    expect(groups).toContain("Services");
    expect(groups).toContain("SLOs");
  });

  test("a monitor key reaching the Affected Resources chip is not looked up", async () => {
    await renderTable();
    getListMock.mockClear();

    const ids: Array<string> = await facet("affectedResources")
      .computeMatchingResourceIds!(
      new ObjectID(PROJECT_ID),
      [`monitor:${MONITOR_ID}`],
      "is",
    );

    expect(ids).toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("the Monitor chip filters on the alert's monitorId", async () => {
    await renderTable();
    getListMock.mockClear();

    const monitorFacet: ResourceFacet = facet("monitor");

    expect(monitorFacet.queryField).toBe("monitorId");

    const options: Array<FilterChipDropdownOption> =
      await monitorFacet.loadOptions!(new ObjectID(PROJECT_ID), "");

    expect(
      (getListMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(Monitor);
    expect(options).toHaveLength(1);
  });
});
