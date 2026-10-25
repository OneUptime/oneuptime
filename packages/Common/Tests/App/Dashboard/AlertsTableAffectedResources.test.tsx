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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The alerts list (Components/Alert/AlertsTable.tsx) backs the Alerts,
 * Unresolved and Home "Active Alerts" pages and the Alerts tab of monitors,
 * monitor groups, services, hosts, clusters, databases, inventory items and
 * SLOs. An alert is about one monitor (Alert.monitor, singular), and the
 * list's Affected Resources column names it, first, ahead of anything else
 * linked to the alert.
 *
 * The list had a Monitor column too, so every row raised by a monitor named
 * that monitor twice, side by side (the maintainer: "why do we have a
 * monitors column when we have monitors in the affected resources anyway?").
 * The Monitor column is gone. This suite holds what that must not cost:
 *
 *   - the columns: no Monitor column, Affected Resources naming the monitor
 *     first and linking it to its page;
 *   - the request: the monitor is still asked for on every read;
 *   - a viewer's saved layout: one that had switched Affected Resources off
 *     while the Monitor column named the monitor shows it again, and one that
 *     arranged the old columns keeps the rest of its choices;
 *   - the CSV: no Monitor column in the file, and Affected Resources names
 *     the monitor first, as the row draws it;
 *   - the filters: picking monitors is still the Monitor chip's job, on the
 *     alert's monitorId.
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
      return { rowActions: [], bulkActions: [], modals: null };
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

import AlertsTable, {
  ALERTS_AFFECTED_RESOURCES_COLUMN_ID,
  getAlertAffectedResources,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertsTable";
import { getAffectedResourceNames } from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourceNames";
import { ResourceFacet } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import {
  FacetColumnQuery,
  buildFacetColumnQuery,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FacetColumnQuery";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import StorageArray from "../../../Models/DatabaseModels/StorageArray";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import Search from "../../../Types/BaseDatabase/Search";
import Color from "../../../Types/Color";
import Dictionary from "../../../Types/Dictionary";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ColumnPreference,
  applyColumnPreference,
  fromJSON as columnPreferenceFromJSON,
  getColumnIds,
  sanitizeColumnPreference,
} from "../../../UI/Components/ModelTable/ColumnPreference";
import { getExportKeysFromColumn } from "../../../UI/Components/ModelTable/ExportFromColumns";
import {
  getRelationSelectFromColumns,
  getSelectFromColumns,
} from "../../../UI/Components/ModelTable/SelectFromColumns";
/*
 * Two different column types are in play: the ModelTable column (it declares
 * a `field`), which the list hands its table, and the Table column (a `key`
 * and the export keys), which BaseModelTable builds from it and
 * TableColumnsToCsv consumes.
 */
import ModelTableColumn from "../../../UI/Components/ModelTable/Column";
import ModelTableColumns from "../../../UI/Components/ModelTable/Columns";
import Column from "../../../UI/Components/Table/Types/Column";
import TableBody from "../../../UI/Components/Table/TableBody";
import {
  TABLE_CARD_LIST_ITEM_CLASS_NAME,
  TABLE_LIST_ITEM_CLASS_NAME,
} from "../../../UI/Components/Table/TableLayout";
import FieldType from "../../../UI/Components/Types/FieldType";
import TableColumnsToCsv from "../../../UI/Utils/TableColumnsToCsv";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const MONITOR_ID: string = "0193c0de-9999-4aaa-8bbb-000000000001";
const SERVICE_ID: string = "0193c0de-9999-4aaa-8bbb-000000000002";
const SLO_ID: string = "0193c0de-9999-4aaa-8bbb-000000000003";
const CLUSTER_ID: string = "0193c0de-9999-4aaa-8bbb-000000000004";
const OTHER_MONITOR_ID: string = "0193c0de-9999-4aaa-8bbb-000000000005";

// The rows of the maintainer's screenshot: a monitor and its cluster.
const SCREENSHOT_MONITOR: string =
  "oneuptime-test - High Node Memory Utilization";
const SCREENSHOT_CLUSTER: string = "oneuptime-test";

// The columns the list draws, in order.
const ALERT_COLUMN_TITLES: Array<string> = [
  "Alert Number",
  "Title",
  "State",
  "Severity",
  "Affected Resources",
  "Created",
  "Duration",
  "Labels",
  "Owners",
];

/*
 * The ids a viewer's layout was stored under before the Monitor column went:
 * each column's first field ("monitor" for the Monitor column, "hosts" for
 * Affected Resources), the two columns on createdAt told apart by title
 * (ColumnPreference.getColumnIds). Real layouts in people's preferences and
 * saved views hold these.
 */
const LAYOUT_IDS_BEFORE: Array<string> = [
  "alertNumber",
  "title",
  "currentAlertState",
  "alertSeverity",
  "monitor",
  "hosts",
  "createdAt:created",
  "createdAt:duration",
  "labels",
  "_id",
];

type CapturedColumn = {
  id?: string | undefined;
  field: Record<string, unknown>;
  title: string;
  type: FieldType;
  getElement?: ((item: Alert) => ReactElement) | undefined;
  getExportValue?: ((item: Alert) => string) | undefined;
  disableCsvExport?: boolean | undefined;
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

function viewHref(pageMapKey: string, id: string): string {
  return RouteUtil.populateRouteParams(RouteMap[pageMapKey] as Route, {
    modelId: new ObjectID(id),
  }).toString();
}

function buildMonitor(name: string, id: string = MONITOR_ID): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
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

function buildCluster(name: string): KubernetesCluster {
  const cluster: KubernetesCluster = new KubernetesCluster();
  cluster._id = CLUSTER_ID;
  cluster.name = name;
  return cluster;
}

// A row of the maintainer's screenshot.
function screenshotAlert(): Alert {
  const alert: Alert = new Alert();
  alert.monitor = buildMonitor(SCREENSHOT_MONITOR);
  alert.kubernetesClusters = [buildCluster(SCREENSHOT_CLUSTER)];
  return alert;
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

// The same columns, typed as the ModelTable columns the helpers read.
function modelTableColumns(): ModelTableColumns<Alert> {
  return capturedColumns() as unknown as ModelTableColumns<Alert>;
}

function titlesOf(columns: ModelTableColumns<Alert>): Array<string> {
  return columns.map((c: ModelTableColumn<Alert>): string => {
    return c.title;
  });
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

/*
 * A ModelTable column as BaseModelTable hands it to the Table (its
 * serializeToTableColumns): the first declared field is the key, every
 * declared field an export key.
 */
function asTableColumn(modelColumn: CapturedColumn): Column<Alert> {
  const key: string = Object.keys(modelColumn.field)[0]!;

  return {
    ...modelColumn,
    key: key,
    exportKeys: getExportKeysFromColumn<Alert>({
      column: modelColumn as unknown as ModelTableColumn<Alert>,
      columnKey: key,
    }),
  } as unknown as Column<Alert>;
}

/*
 * What a stored layout leaves on screen, read the way BaseModelTable reads
 * it: parsed, cleared of ids that name no column, then applied.
 */
function visibleTitles(
  columns: ModelTableColumns<Alert>,
  stored: JSONObject,
): Array<string> {
  const preference: ColumnPreference | null = sanitizeColumnPreference({
    preference: columnPreferenceFromJSON(stored),
    knownColumnIds: getColumnIds<Alert>(columns),
  });

  return titlesOf(
    applyColumnPreference<Alert>({
      columns: columns,
      preference: preference,
    }),
  );
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

function linkHrefs(): Array<string | null> {
  return screen.getAllByRole("link").map((link: HTMLElement): string | null => {
    return link.getAttribute("href");
  });
}

// A column under the id derived from its first field, as before it had one.
function withDerivedId(
  modelColumn: ModelTableColumn<Alert>,
): ModelTableColumn<Alert> {
  const copy: ModelTableColumn<Alert> = { ...modelColumn };
  delete copy.id;
  return copy;
}

// One named row of a kind, with a real id.
function named<TModel extends BaseModel>(
  ModelType: { new (): TModel },
  name: string,
): TModel {
  const row: TModel = new ModelType();
  row._id = ObjectID.generate().toString();
  (row as unknown as { name: string }).name = name;
  return row;
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

describe("the alerts list's columns", () => {
  test("has no Monitor column: Alert Number, Title, State, Severity, Affected Resources, Created, Duration, Labels and Owners", async () => {
    await renderTable();

    expect(titlesOf(modelTableColumns())).toEqual(ALERT_COLUMN_TITLES);
  });

  test("names the monitor in one column only, Affected Resources, and never as a column's own field", async () => {
    await renderTable();

    const naming: Array<string> = capturedColumns()
      .filter((c: CapturedColumn): boolean => {
        return Object.keys(c.field).includes("monitor");
      })
      .map((c: CapturedColumn): string => {
        return c.title;
      });

    expect(naming).toEqual(["Affected Resources"]);

    const primaryFields: Array<string> = capturedColumns().map(
      (c: CapturedColumn): string => {
        return Object.keys(c.field)[0]!;
      },
    );

    expect(primaryFields).not.toContain("monitor");
  });

  /*
   * The columns before and after Affected Resources moved together when the
   * Monitor column went: it sits where the Monitor column did, right after
   * Severity.
   */
  test("puts Affected Resources right after Severity, where the Monitor column was", async () => {
    await renderTable();

    const titles: Array<string> = titlesOf(modelTableColumns());

    expect(titles.indexOf("Affected Resources")).toBe(
      titles.indexOf("Severity") + 1,
    );
  });
});

describe("the alerts list's Affected Resources column", () => {
  test("lists the monitor an alert was raised on, never 'No resources.'", async () => {
    await renderTable();

    const alert: Alert = new Alert();
    alert.monitor = buildMonitor("Developer portal");

    renderCell("Affected Resources", alert);

    expect(screen.queryByText("No resources.")).toBeNull();

    const link: HTMLElement = screen.getByRole("link");

    // The monitor's own page, as the Monitor column linked it.
    expect(link).toHaveAttribute("href", monitorHref(MONITOR_ID));
    expect(link).toHaveTextContent("Developer portal");
    // The same type icon every other resource row carries.
    expect(link.querySelector("svg")).not.toBeNull();
  });

  test("a row of the maintainer's screenshot names its monitor once, first, then its Kubernetes cluster", async () => {
    await renderTable();

    renderCell("Affected Resources", screenshotAlert());

    expect(linkTexts()).toEqual([SCREENSHOT_MONITOR, SCREENSHOT_CLUSTER]);
    expect(linkHrefs()).toEqual([
      monitorHref(MONITOR_ID),
      viewHref(PageMap.KUBERNETES_CLUSTER_VIEW, CLUSTER_ID),
    ]);
    // Each one with its own type's icon.
    for (const link of screen.getAllByRole("link")) {
      expect(link.querySelector("svg")).not.toBeNull();
    }
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

  test("an alert created by hand with no monitor lists what it is linked to, and no monitor", async () => {
    await renderTable();

    const alert: Alert = new Alert();
    alert.kubernetesClusters = [buildCluster(SCREENSHOT_CLUSTER)];

    renderCell("Affected Resources", alert);

    expect(linkTexts()).toEqual([SCREENSHOT_CLUSTER]);
    expect(linkHrefs()).not.toContain(monitorHref(MONITOR_ID));
  });

  test("an alert with no monitor and nothing attached still reads 'No resources.'", async () => {
    await renderTable();

    renderCell("Affected Resources", new Alert());

    expect(screen.getByText("No resources.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  /*
   * Declared on this column, as a secondary key: hosts stays the column's
   * primary field (the key its cells and export are read under).
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

  /*
   * On a phone each row is a card, and with no Monitor column a card names
   * its monitor only under Affected Resources. The Monitor field showed the
   * whole name, wrapping; the list cut it short ("oneuptime-test - High Node
   * Memory Utili..."), and a phone has no pointer to show the rest. In a
   * card each name runs onto the next line instead (TableCardContext).
   */
  test("on a phone, the card names the monitor in full: its name runs onto the next line, never cut short", async () => {
    await renderTable();

    cleanup();
    render(
      <TableBody<Alert>
        id="alerts-on-a-phone"
        data={[screenshotAlert()]}
        columns={[asTableColumn(column("Affected Resources"))]}
        selectedItems={[]}
        matchBulkSelectedItemByField={undefined}
        isMobile={true}
      />,
    );

    expect(screen.getByText("Affected Resources").tagName).toBe("DT");
    expect(linkTexts()).toEqual([SCREENSHOT_MONITOR, SCREENSHOT_CLUSTER]);

    for (const link of screen.getAllByRole("link")) {
      expect(link.parentElement?.className).toBe(
        TABLE_CARD_LIST_ITEM_CLASS_NAME,
      );
    }
  });

  test("in a row of the table, each name keeps to its line, its whole name under the pointer", async () => {
    await renderTable();

    cleanup();
    render(
      <table>
        <TableBody<Alert>
          id="alerts-on-a-laptop"
          data={[screenshotAlert()]}
          columns={[asTableColumn(column("Affected Resources"))]}
          selectedItems={[]}
          matchBulkSelectedItemByField={undefined}
          isMobile={false}
        />
      </table>,
    );

    expect(linkTexts()).toEqual([SCREENSHOT_MONITOR, SCREENSHOT_CLUSTER]);

    const monitorItem: HTMLElement = screen.getAllByRole("link")[0]!
      .parentElement as HTMLElement;

    expect(monitorItem.className).toBe(TABLE_LIST_ITEM_CLASS_NAME);

    // Wider than its column: the whole name shows under the pointer.
    Object.defineProperty(monitorItem, "scrollWidth", { value: 420 });
    Object.defineProperty(monitorItem, "clientWidth", { value: 320 });
    fireEvent.mouseEnter(monitorItem);

    expect(monitorItem).toHaveAttribute("title", SCREENSHOT_MONITOR);
  });
});

/*
 * The Monitor column's field was the request's one sure claim on the
 * monitor: a column's first field is always selected. Affected Resources
 * names it as a secondary field, which the select leaves out for a viewer
 * whose permissions say no - or have not loaded yet. The relation select,
 * built from every entity field of every column, is what still asks for it.
 * BaseModelTable sends the two together ({...getSelect(),
 * ...getRelationSelect()}).
 */
describe("the alerts list's request", () => {
  function requestSelect(canRead: boolean): Dictionary<unknown> {
    const columns: ModelTableColumns<Alert> = modelTableColumns();

    return {
      ...getSelectFromColumns<Alert>({
        columns: columns,
        model: new Alert(),
        hasPermissionToReadField: (): boolean => {
          return canRead;
        },
      }),
      ...getRelationSelectFromColumns<Alert>({
        columns: columns,
        model: new Alert(),
      }),
    } as Dictionary<unknown>;
  }

  test("asks for the alert's monitor, with its name and project, on every read", async () => {
    await renderTable();

    expect(requestSelect(true)["monitor"]).toEqual({
      name: true,
      _id: true,
      projectId: true,
    });
  });

  test("asks for it even before the viewer's permissions have loaded", async () => {
    await renderTable();

    expect(requestSelect(false)["monitor"]).toEqual({
      name: true,
      _id: true,
      projectId: true,
    });
  });
});

describe("a viewer's saved column layout", () => {
  /*
   * The ids above are what a viewer stored, so they have to be the ids the
   * old column set had: today's columns with the Monitor column back after
   * Severity, and Affected Resources under its derived id.
   */
  test("the ids a layout stored before the change are those of the list with its Monitor column", async () => {
    await renderTable();

    const columnsBefore: ModelTableColumns<Alert> = [];

    for (const current of modelTableColumns()) {
      columnsBefore.push(
        current.title === "Affected Resources"
          ? withDerivedId(current)
          : current,
      );

      if (current.title === "Severity") {
        columnsBefore.push({
          field: { monitor: { name: true, _id: true, projectId: true } },
          title: "Monitor",
          type: FieldType.Entity,
        } as unknown as ModelTableColumn<Alert>);
      }
    }

    expect(getColumnIds<Alert>(columnsBefore)).toEqual(LAYOUT_IDS_BEFORE);
  });

  test("Affected Resources has an id of its own, which no other column shares", async () => {
    await renderTable();

    const ids: Array<string> = getColumnIds<Alert>(modelTableColumns());

    expect(column("Affected Resources").id).toBe(
      ALERTS_AFFECTED_RESOURCES_COLUMN_ID,
    );
    expect(
      ids.filter((id: string): boolean => {
        return id === ALERTS_AFFECTED_RESOURCES_COLUMN_ID;
      }),
    ).toHaveLength(1);
    expect(ids).not.toContain("monitor");
    expect(ids).not.toContain("hosts");
    expect(new Set(ids).size).toBe(ids.length);
  });

  /*
   * Someone who switched Affected Resources off while the Monitor column
   * named the monitor beside it would, under the column's old id, now see no
   * monitor at all.
   */
  test("one that switched Affected Resources off while the Monitor column named the monitor shows it again", async () => {
    await renderTable();

    const stored: JSONObject = { order: LAYOUT_IDS_BEFORE, hidden: ["hosts"] };

    expect(visibleTitles(modelTableColumns(), stored)).toEqual(
      ALERT_COLUMN_TITLES,
    );

    // Under the id it used to have, that layout would still hide it.
    const underOldId: ModelTableColumns<Alert> =
      modelTableColumns().map(withDerivedId);

    expect(visibleTitles(underOldId, stored)).not.toContain(
      "Affected Resources",
    );
  });

  test("one that switched the Monitor column off keeps the rest of the viewer's choices", async () => {
    await renderTable();

    expect(
      visibleTitles(modelTableColumns(), {
        order: LAYOUT_IDS_BEFORE,
        hidden: ["monitor", "labels"],
      }),
    ).toEqual(
      ALERT_COLUMN_TITLES.filter((title: string): boolean => {
        return title !== "Labels";
      }),
    );
  });

  test("one that moved the old columns around puts Affected Resources where the Monitor column was, after Severity", async () => {
    await renderTable();

    expect(
      visibleTitles(modelTableColumns(), {
        order: [
          "labels",
          "title",
          "alertNumber",
          "currentAlertState",
          "alertSeverity",
          "monitor",
          "hosts",
          "createdAt:created",
          "createdAt:duration",
          "_id",
        ],
        hidden: [],
      }),
    ).toEqual([
      "Labels",
      "Title",
      "Alert Number",
      "State",
      "Severity",
      "Affected Resources",
      "Created",
      "Duration",
      "Owners",
    ]);
  });

  test("one saved from now on keeps Affected Resources off when the viewer switches it off", async () => {
    await renderTable();

    const ids: Array<string> = getColumnIds<Alert>(modelTableColumns());

    expect(
      visibleTitles(modelTableColumns(), {
        order: ids,
        hidden: [ALERTS_AFFECTED_RESOURCES_COLUMN_ID],
      }),
    ).not.toContain("Affected Resources");
  });
});

describe("the alerts list's CSV export", () => {
  test("writes Affected Resources the way the row draws it: the monitor first, then the cluster", async () => {
    await renderTable();

    expect(
      TableColumnsToCsv.getCellValue(
        screenshotAlert(),
        asTableColumn(column("Affected Resources")),
      ),
    ).toBe(`${SCREENSHOT_MONITOR}; ${SCREENSHOT_CLUSTER}`);
  });

  test("has no Monitor column, and its Affected Resources names the monitor", async () => {
    await renderTable();

    const alert: Alert = screenshotAlert();
    alert.title = "Node memory above 90%";

    const csv: string = TableColumnsToCsv.convertToCsv<Alert>({
      items: [alert],
      columns: capturedColumns().map(asTableColumn),
    });
    const [headerRow, row] = csv.split("\r\n");
    const header: Array<string> = (headerRow || "").split(",");

    /*
     * Duration is left out of the file (its cell is a live clock), and so
     * is Owners (a placeholder field, its cell drawn from another read).
     */
    expect(header).toEqual([
      "Alert Number",
      "Title",
      "State",
      "Severity",
      "Affected Resources",
      "Created",
      "Labels",
    ]);
    expect((row || "").split(",")[header.indexOf("Affected Resources")]).toBe(
      `${SCREENSHOT_MONITOR}; ${SCREENSHOT_CLUSTER}`,
    );
  });

  test("an alert with only a monitor exports the monitor", async () => {
    await renderTable();

    const alert: Alert = new Alert();
    alert.monitor = buildMonitor("Developer portal");

    expect(
      TableColumnsToCsv.getCellValue(
        alert,
        asTableColumn(column("Affected Resources")),
      ),
    ).toBe("Developer portal");
  });

  test("an alert with nothing attached exports an empty cell", async () => {
    await renderTable();

    expect(
      TableColumnsToCsv.getCellValue(
        new Alert(),
        asTableColumn(column("Affected Resources")),
      ),
    ).toBe("");
  });

  /*
   * The file and the cell read the same lists (getAlertAffectedResources),
   * and the file's order is AffectedResourceNames'. One alert linked to one
   * resource of every kind an alert can have proves the two orders agree.
   */
  test("the cell and the file list one resource of every kind in the same order, the monitor first", async () => {
    await renderTable();

    const alert: Alert = new Alert();
    alert.monitor = named(Monitor, "1 Monitor");
    alert.hosts = [named(Host, "2 Host")];
    alert.kubernetesClusters = [named(KubernetesCluster, "3 Kubernetes")];
    alert.dockerHosts = [named(DockerHost, "4 Docker host")];
    alert.podmanHosts = [named(PodmanHost, "5 Podman host")];
    alert.proxmoxClusters = [named(ProxmoxCluster, "6 Proxmox")];
    alert.vmwareVCenters = [named(VMwareVCenter, "7 vCenter")];
    alert.cephClusters = [named(CephCluster, "8 Ceph")];
    alert.storageArrays = [named(StorageArray, "9 Storage array")];
    alert.dockerSwarmClusters = [named(DockerSwarmCluster, "10 Swarm")];
    alert.iotFleets = [named(IoTFleet, "11 IoT fleet")];
    alert.databaseServers = [named(DatabaseServer, "12 Database")];
    const service: Service = named(Service, "13 Service");
    service.serviceColor = new Color("#6366f1");
    alert.services = [service];
    alert.serviceLevelObjectives = [named(ServiceLevelObjective, "14 SLO")];

    renderCell("Affected Resources", alert);

    // The cell lists three and folds the rest behind a button.
    fireEvent.click(screen.getByRole("button", { name: /more resources/ }));

    const drawn: Array<string> = linkTexts();

    expect(drawn).toHaveLength(14);
    expect(drawn[0]).toBe("1 Monitor");
    expect(getAffectedResourceNames(getAlertAffectedResources(alert))).toEqual(
      drawn,
    );
    expect(
      TableColumnsToCsv.getCellValue(
        alert,
        asTableColumn(column("Affected Resources")),
      ),
    ).toBe(drawn.join("; "));
  });
});

/*
 * The column lists the monitor, but filtering by it stays with the dedicated
 * Monitor chip, which queries Alert.monitorId directly. Offering monitors in
 * the Affected Resources chip too would list every monitor twice and filter
 * through an ID lookup capped at LIMIT_PER_PROJECT alerts.
 */
describe("the alerts list's filters", () => {
  function monitorChipQuery(
    operator: FilterOperator,
    values: Array<string>,
  ): FacetColumnQuery | null {
    return buildFacetColumnQuery({
      facet: facet("monitor"),
      operator: operator,
      values: values,
      existingValue: undefined,
    });
  }

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

    expect(monitorFacet.label).toBe("Monitor");
    expect(monitorFacet.queryField).toBe("monitorId");
    expect(monitorFacet.isMultiSelect).toBe(true);

    const options: Array<FilterChipDropdownOption> =
      await monitorFacet.loadOptions!(new ObjectID(PROJECT_ID), "");

    expect(
      (getListMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(Monitor);
    expect(options).toHaveLength(1);
  });

  test("picking monitors on the Monitor chip asks for their alerts by monitorId", async () => {
    await renderTable();

    const query: FacetColumnQuery | null = monitorChipQuery("is", [
      MONITOR_ID,
      OTHER_MONITOR_ID,
    ]);

    expect(query?.field).toBe("monitorId");
    expect(query?.value).toBeInstanceOf(Includes);
    expect(
      (query?.value as Includes).values.map((id: unknown): string => {
        return String(id);
      }),
    ).toEqual([MONITOR_ID, OTHER_MONITOR_ID]);
  });

  test("'is not' leaves those monitors' alerts out, and 'is empty' finds the alerts with no monitor", async () => {
    await renderTable();

    const isNot: FacetColumnQuery | null = monitorChipQuery("is_not", [
      MONITOR_ID,
    ]);

    expect(isNot?.field).toBe("monitorId");
    expect(isNot?.value).toBeInstanceOf(IncludesNone);

    const isEmpty: FacetColumnQuery | null = monitorChipQuery("is_empty", []);

    expect(isEmpty?.field).toBe("monitorId");
    expect(isEmpty?.value).toBeInstanceOf(IsNull);

    // Nothing picked constrains nothing.
    expect(monitorChipQuery("is", [])).toBeNull();
  });

  test("the Monitor chip finds monitors by name, A to Z, each with the monitor icon", async () => {
    await renderTable();
    getListMock.mockClear();

    const options: Array<FilterChipDropdownOption> = await facet("monitor")
      .loadOptions!(new ObjectID(PROJECT_ID), "  portal ");

    const request: {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
    } = getListMock.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
    };

    expect(request.query["name"]).toBeInstanceOf(Search);
    expect((request.query["name"] as Search<string>).toString()).toBe("portal");
    expect(Object.keys(request.sort)).toEqual(["name"]);
    expect(options[0]?.icon).toBe(IconProp.AltGlobe);
  });

  test("the Monitor chip names the monitors a saved filter holds", async () => {
    await renderTable();
    getListMock.mockClear();

    const options: Array<FilterChipDropdownOption> = await facet("monitor")
      .resolveOptions!(new ObjectID(PROJECT_ID), [MONITOR_ID]);

    const request: { query: Record<string, unknown>; modelType: unknown } =
      getListMock.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        modelType: unknown;
      };

    expect(request.modelType).toBe(Monitor);
    expect(request.query["_id"]).toBeInstanceOf(Includes);
    expect(options).toHaveLength(1);
  });
});
