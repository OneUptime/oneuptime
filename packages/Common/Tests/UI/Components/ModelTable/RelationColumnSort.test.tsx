// UX rule: Docs/ux/README.md#lists
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A LIST SORTS BY A COLUMN THAT SHOWS A RELATED RECORD (#8134).
 *
 * The shared table turned sorting off for every relation column: an
 * incident's Severity and State, a monitor's Monitor Status, an alert's
 * Monitor, who created a record - none of their headers could be clicked.
 * The server orders a whole list through a to-one relation, by one field of
 * the related record, and the table now asks it to (ColumnSort's
 * getRelationColumnSort):
 *
 *  - a severity, a state or a status by its place in the project's list,
 *    worst first descending - the most severe, the offline monitor, the
 *    incident nobody has acknowledged - as the dashboard's list widgets run
 *    it, and the header's first click goes that way;
 *  - another ordered list (a device's role) as its settings page lists it;
 *  - anything else by the name the column shows, A to Z ascending;
 *  - a column of many records (labels, monitors) not at all.
 *
 * Pinned here on the models themselves, then on a table that is clicked.
 */

// A real BaseModelTable mounts a card, a header and a table before its row.
configure({ asyncUtilTimeout: 15000 });

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
          return value;
        },
      };
    },
  };
});

import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import ModelTableColumn from "../../../../UI/Components/ModelTable/Column";
import Columns from "../../../../UI/Components/ModelTable/Columns";
import {
  RelationColumnSort,
  getColumnSortForRead,
  getColumnSortKey,
  getRelationColumnSort,
  getRelationColumnSorts,
  getRelationColumnSortValue,
  withRelationColumnSortSelect,
} from "../../../../UI/Components/ModelTable/ColumnSort";
import FieldType from "../../../../UI/Components/Types/FieldType";
import AnalyticsLog from "../../../../Models/AnalyticsModels/Log";
import AnalyticsModels from "../../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseModels from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import Select from "../../../../Types/BaseDatabase/Select";
import Sort from "../../../../Types/BaseDatabase/Sort";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import { DashboardWidgetSortDirection } from "../../../../Types/Dashboard/DashboardWidgetSort";
import { JSONObject } from "../../../../Types/JSON";
import { getDashboardWidgetListSort } from "../../../../Utils/Dashboard/DashboardWidgetSorts";

const ASC: SortOrder = SortOrder.Ascending;
const DESC: SortOrder = SortOrder.Descending;

// The order Postgres reads "descending, rows with no record last" as.
const DESC_NULLS_LAST: JSONObject = { direction: "DESC", nulls: "LAST" };

type AnyColumn = ModelTableColumn<any>;

const column: (field: JSONObject, extra?: Partial<AnyColumn>) => AnyColumn = (
  field: JSONObject,
  extra?: Partial<AnyColumn>,
): AnyColumn => {
  return {
    field: field,
    title: "Column",
    type: FieldType.Entity,
    ...(extra || {}),
  } as unknown as AnyColumn;
};

const sortOf: (
  model: Incident | Alert | Monitor | NetworkDevice | ScheduledMaintenance,
  field: JSONObject,
  extra?: Partial<AnyColumn>,
) => RelationColumnSort | null = (
  model: Incident | Alert | Monitor | NetworkDevice | ScheduledMaintenance,
  field: JSONObject,
  extra?: Partial<AnyColumn>,
): RelationColumnSort | null => {
  return getRelationColumnSort<any>(model, column(field, extra));
};

describe("a status, a severity or a state sorts by its place in the project's list, worst first descending", () => {
  test("an incident's severity: the most severe (order 1) first descending, the least severe first ascending", () => {
    expect(
      sortOf(new Incident(), {
        incidentSeverity: { _id: true, name: true, color: true },
      }),
    ).toEqual({
      relation: "incidentSeverity",
      field: "order",
      ascendingOrder: DESC,
      firstSortOrder: DESC,
    });
  });

  test("an incident's state: the state an incident starts in first descending - nobody has acknowledged it yet", () => {
    expect(
      sortOf(new Incident(), {
        currentIncidentState: { _id: true, name: true, color: true },
      }),
    ).toEqual({
      relation: "currentIncidentState",
      field: "order",
      ascendingOrder: DESC,
      firstSortOrder: DESC,
    });
  });

  test("a monitor's status: the list runs from operational down to offline, so descending is the highest priority first", () => {
    expect(
      sortOf(new Monitor(), {
        currentMonitorStatus: { color: true, name: true },
      }),
    ).toEqual({
      relation: "currentMonitorStatus",
      field: "priority",
      ascendingOrder: ASC,
      firstSortOrder: DESC,
    });
  });

  test("an alert's severity and state, as an incident's", () => {
    expect(
      sortOf(new Alert(), { alertSeverity: { name: true, color: true } }),
    ).toEqual({
      relation: "alertSeverity",
      field: "order",
      ascendingOrder: DESC,
      firstSortOrder: DESC,
    });
    expect(
      sortOf(new Alert(), { currentAlertState: { name: true, color: true } }),
    ).toEqual({
      relation: "currentAlertState",
      field: "order",
      ascendingOrder: DESC,
      firstSortOrder: DESC,
    });
  });

  test("a maintenance event's state, an incident's postmortem status and a security case's status and priority", () => {
    expect(
      sortOf(new ScheduledMaintenance(), {
        currentScheduledMaintenanceState: { name: true, color: true },
      }),
    ).toMatchObject({ field: "order", ascendingOrder: DESC });
    expect(
      sortOf(new Incident(), { postmortemStatus: { name: true, color: true } }),
    ).toMatchObject({ field: "order", ascendingOrder: DESC });
    expect(
      getRelationColumnSort<any>(
        new SecurityCase(),
        column({ securityCaseStatus: { name: true, color: true } }),
      ),
    ).toMatchObject({
      field: "order",
      ascendingOrder: DESC,
      firstSortOrder: DESC,
    });
    expect(
      getRelationColumnSort<any>(
        new SecurityCase(),
        column({ securityCasePriority: { name: true, color: true } }),
      ),
    ).toMatchObject({
      field: "order",
      ascendingOrder: DESC,
      firstSortOrder: DESC,
    });
  });

  test("by its place even where the column names the name it draws (selectedProperty): High is not after Low", () => {
    expect(
      sortOf(
        new Incident(),
        { incidentSeverity: { name: true } },
        { selectedProperty: "name", type: FieldType.Text },
      ),
    ).toMatchObject({ field: "order", ascendingOrder: DESC });
  });
});

describe("another ordered list runs as its settings page lists it", () => {
  test("a device's role: top of the list first ascending, and no first direction of its own", () => {
    expect(
      sortOf(
        new NetworkDevice(),
        { networkDeviceRole: { name: true } },
        { selectedProperty: "name" },
      ),
    ).toEqual({
      relation: "networkDeviceRole",
      field: "order",
      ascendingOrder: ASC,
    });
  });
});

describe("any other related record sorts by the name the column shows", () => {
  test("an alert's monitor, A to Z", () => {
    expect(sortOf(new Alert(), { monitor: { _id: true, name: true } })).toEqual(
      { relation: "monitor", field: "name", ascendingOrder: ASC },
    );
  });

  test("a user by their name before their email, whichever the column lists first", () => {
    expect(
      sortOf(new Incident(), {
        createdByUser: { email: true, name: true, profilePictureId: true },
      }),
    ).toEqual({
      relation: "createdByUser",
      field: "name",
      ascendingOrder: ASC,
    });
  });

  test("by their email where the column shows only that", () => {
    expect(
      sortOf(new Incident(), { createdByUser: { email: true } }),
    ).toMatchObject({ field: "email" });
  });

  test("by the property the column names (selectedProperty)", () => {
    expect(
      sortOf(
        new Incident(),
        { project: { name: true, _id: true } },
        { selectedProperty: "name", type: FieldType.Text },
      ),
    ).toEqual({ relation: "project", field: "name", ascendingOrder: ASC });
  });
});

describe("a column the list cannot be ordered by gets no sort", () => {
  test("a column of many records: labels, monitors", () => {
    expect(
      sortOf(new Incident(), { labels: { name: true, color: true } }),
    ).toBe(null);
    expect(sortOf(new Incident(), { monitors: { name: true } })).toBe(null);
  });

  test("a relation the column selects no name of", () => {
    expect(
      sortOf(new Alert(), { monitor: { _id: true, projectId: true } }),
    ).toBe(null);
    expect(sortOf(new Alert(), { monitor: true })).toBe(null);
  });

  test("a property that is no name, or one a relation read may not take", () => {
    expect(
      sortOf(
        new Incident(),
        { createdByUser: { name: true } },
        { selectedProperty: "password" },
      ),
    ).toBe(null);
    expect(
      sortOf(
        new Incident(),
        { createdByUser: { name: true } },
        { selectedProperty: "doesNotExist" },
      ),
    ).toBe(null);
  });

  test("a column of the record itself, one with no field, and an analytics list", () => {
    expect(
      getRelationColumnSort<any>(
        new Incident(),
        column({ title: true }, { type: FieldType.Text }),
      ),
    ).toBe(null);
    expect(
      getRelationColumnSort<any>(new Incident(), {
        title: "Actions",
        type: FieldType.Actions,
      } as unknown as AnyColumn),
    ).toBe(null);
    expect(
      getRelationColumnSort<any>(
        new AnalyticsLog(),
        column({ body: true }, { type: FieldType.Text }),
      ),
    ).toBe(null);
  });
});

const SEVERITY_SORT: RelationColumnSort = {
  relation: "incidentSeverity",
  field: "order",
  ascendingOrder: DESC,
  firstSortOrder: DESC,
};

const MONITOR_NAME_SORT: RelationColumnSort = {
  relation: "monitor",
  field: "name",
  ascendingOrder: ASC,
};

describe("the order the server is asked for", () => {
  test("nested under the relation, rows with no related record last both ways", () => {
    expect(getRelationColumnSortValue(SEVERITY_SORT, DESC)).toEqual({
      incidentSeverity: { order: ASC },
    });
    expect(getRelationColumnSortValue(SEVERITY_SORT, ASC)).toEqual({
      incidentSeverity: { order: DESC_NULLS_LAST },
    });
    expect(getRelationColumnSortValue(MONITOR_NAME_SORT, ASC)).toEqual({
      monitor: { name: ASC },
    });
    expect(getRelationColumnSortValue(MONITOR_NAME_SORT, DESC)).toEqual({
      monitor: { name: DESC_NULLS_LAST },
    });
  });

  test("a relation column by its related field, any other by itself, nothing when unsorted", () => {
    const relationSorts: Map<string, RelationColumnSort> = new Map([
      ["incidentSeverity", SEVERITY_SORT],
    ]);

    expect(
      getColumnSortForRead<Incident>({
        model: new Incident(),
        sortBy: "incidentSeverity",
        sortOrder: DESC,
        relationSorts,
      }),
    ).toEqual({ incidentSeverity: { order: ASC } });
    expect(
      getColumnSortForRead<Incident>({
        model: new Incident(),
        sortBy: "declaredAt",
        sortOrder: DESC,
        relationSorts,
      }),
    ).toEqual({ declaredAt: DESC });
    expect(
      getColumnSortForRead<Incident>({
        model: new Incident(),
        sortBy: null,
        sortOrder: DESC,
        relationSorts,
      }),
    ).toEqual({});
  });

  /*
   * A link or a saved view made before a column changed can still name a
   * relation: an order the server refuses would fail the whole list.
   */
  test("a relation the list cannot be ordered by, as an old link names it, is read in the list's own order", () => {
    const relationSorts: Map<string, RelationColumnSort> = new Map([
      ["incidentSeverity", SEVERITY_SORT],
    ]);

    for (const staleKey of [
      "labels",
      "monitors",
      "currentIncidentState",
      "project.name",
      "customFields.Region",
    ]) {
      expect(
        getColumnSortForRead<Incident>({
          model: new Incident(),
          sortBy: staleKey,
          sortOrder: DESC,
          relationSorts,
        }),
      ).toEqual({});
    }

    // A column of the record's own, and the id, are sorted as before.
    expect(
      getColumnSortForRead<Incident>({
        model: new Incident(),
        sortBy: "_id",
        sortOrder: ASC,
        relationSorts,
      }),
    ).toEqual({ _id: ASC });
  });

  test("an analytics list keeps a key its model has", () => {
    expect(
      getColumnSortForRead<AnalyticsLog>({
        model: new AnalyticsLog(),
        sortBy: "time",
        sortOrder: DESC,
        relationSorts: new Map(),
      }),
    ).toEqual({ time: DESC });
  });

  /*
   * A link or a saved view made before a column was renamed or removed, or
   * an address someone edited, can name a column the model no longer has:
   * the server refuses an order by it (#8141), so the whole list would fail
   * to load (#8841). An attribute of a telemetry record is no column either,
   * and cannot order a list yet (#8140).
   */
  test("a column the model no longer has, as an old link or saved view names it, is read in the list's own order", () => {
    for (const staleKey of ["oldColumn", "nope", "constructor", "__proto__"]) {
      expect(
        getColumnSortForRead<Incident>({
          model: new Incident(),
          sortBy: staleKey,
          sortOrder: DESC,
          relationSorts: new Map(),
        }),
      ).toEqual({});
    }

    for (const staleKey of ["attributes.region", "oldColumn", "nope"]) {
      expect(
        getColumnSortForRead<AnalyticsLog>({
          model: new AnalyticsLog(),
          sortBy: staleKey,
          sortOrder: ASC,
          relationSorts: new Map(),
        }),
      ).toEqual({});
    }
  });

  test("every column of every model is still sorted by itself, both ways - and only a key no model has is dropped", () => {
    let columns: number = 0;

    for (const modelType of DatabaseModels as Array<{ new (): BaseModel }>) {
      const model: BaseModel = new modelType();

      for (const column of model.getTableColumns().columns) {
        if (model.isEntityColumn(column)) {
          continue;
        }

        for (const sortOrder of [ASC, DESC]) {
          columns++;

          expect([
            model.tableName,
            column,
            getColumnSortForRead<BaseModel>({
              model: model,
              sortBy: column,
              sortOrder: sortOrder,
              relationSorts: new Map(),
            }),
          ]).toEqual([model.tableName, column, { [column]: sortOrder }]);
        }
      }
    }

    for (const modelType of AnalyticsModels as Array<{
      new (): AnalyticsBaseModel;
    }>) {
      const model: AnalyticsBaseModel = new modelType();

      for (const column of model.getTableColumns()) {
        columns++;

        expect([
          model.tableName,
          column.key,
          getColumnSortForRead<AnalyticsBaseModel>({
            model: model,
            sortBy: column.key,
            sortOrder: DESC,
            relationSorts: new Map(),
          }),
        ]).toEqual([model.tableName, column.key, { [column.key]: DESC }]);
      }
    }

    expect(columns).toBeGreaterThan(10000);
  });

  test("a new object every time: the reads add their tie-break to it", () => {
    const relationSorts: Map<string, RelationColumnSort> = new Map([
      ["incidentSeverity", SEVERITY_SORT],
    ]);

    const first: Sort<Incident> = getColumnSortForRead<Incident>({
      model: new Incident(),
      sortBy: "incidentSeverity",
      sortOrder: DESC,
      relationSorts,
    });

    (first as JSONObject)["_id"] = ASC;

    expect(
      getColumnSortForRead<Incident>({
        model: new Incident(),
        sortBy: "incidentSeverity",
        sortOrder: DESC,
        relationSorts,
      }),
    ).toEqual({ incidentSeverity: { order: ASC } });
  });
});

describe("the read selects the field it is ordered by", () => {
  const relationSorts: Map<string, RelationColumnSort> = new Map([
    ["incidentSeverity", SEVERITY_SORT],
  ]);

  test("added to the relation's own select, the select handed in left as it was", () => {
    const select: Select<Incident> = {
      _id: true,
      incidentSeverity: { _id: true, name: true, color: true },
    } as Select<Incident>;

    expect(
      withRelationColumnSortSelect<Incident>({
        select,
        sortBy: "incidentSeverity",
        relationSorts,
      }),
    ).toEqual({
      _id: true,
      incidentSeverity: { _id: true, name: true, color: true, order: true },
    });
    expect(select).toEqual({
      _id: true,
      incidentSeverity: { _id: true, name: true, color: true },
    });
  });

  test("a relation selected whole, or not at all, gets the field alone", () => {
    expect(
      withRelationColumnSortSelect<Incident>({
        select: { incidentSeverity: true } as Select<Incident>,
        sortBy: "incidentSeverity",
        relationSorts,
      }),
    ).toEqual({ incidentSeverity: { order: true } });
    expect(
      withRelationColumnSortSelect<Incident>({
        select: {} as Select<Incident>,
        sortBy: "incidentSeverity",
        relationSorts,
      }),
    ).toEqual({ incidentSeverity: { order: true } });
  });

  test("nothing added when the list is sorted by another column, or by none", () => {
    const select: Select<Incident> = { _id: true } as Select<Incident>;

    expect(
      withRelationColumnSortSelect<Incident>({
        select,
        sortBy: "declaredAt",
        relationSorts,
      }),
    ).toBe(select);
    expect(
      withRelationColumnSortSelect<Incident>({
        select,
        sortBy: null,
        relationSorts,
      }),
    ).toBe(select);
  });
});

describe("the key a header sorts on", () => {
  test("its first field, or the property of it the column shows", () => {
    expect(getColumnSortKey<any>(column({ incidentSeverity: {} }))).toBe(
      "incidentSeverity",
    );
    expect(
      getColumnSortKey<any>(
        column({ project: { name: true } }, { selectedProperty: "name" }),
      ),
    ).toBe("project.name");
    expect(
      getColumnSortKey<any>({
        title: "Actions",
        type: FieldType.Actions,
      } as unknown as AnyColumn),
    ).toBe(null);
  });

  test("a table's relation sorts, by that key; the first column with a key decides it", () => {
    const sorts: Map<string, RelationColumnSort> = getRelationColumnSorts<any>(
      new Incident(),
      [
        column({ title: true }, { type: FieldType.Text }),
        column({ incidentSeverity: { name: true, color: true } }),
        column({ incidentSeverity: { _id: true } }),
        column({ labels: { name: true } }, { type: FieldType.EntityArray }),
        column({ project: { name: true } }, { selectedProperty: "name" }),
      ],
    );

    expect(Array.from(sorts.keys())).toEqual([
      "incidentSeverity",
      "project.name",
    ]);
    expect(sorts.get("incidentSeverity")).toMatchObject({ field: "order" });
    expect(sorts.get("project.name")).toMatchObject({
      relation: "project",
      field: "name",
    });
  });
});

/*
 * The dashboard's list widgets sort the same columns from their headers
 * (Utils/DashboardWidgetSorts, #5082): "Severity ↓" there and here is the
 * same list in the same order.
 */
describe("a list sorts as the dashboard's list widget of the same records sorts", () => {
  const read: (sort: JSONObject, relation: string, field: string) => unknown = (
    sort: JSONObject,
    relation: string,
    field: string,
  ): unknown => {
    return (sort[relation] as JSONObject | undefined)?.[field];
  };

  const cases: Array<{
    name: string;
    widget: DashboardComponentType;
    widgetColumn: string;
    model: Incident | Alert | Monitor;
    field: JSONObject;
  }> = [
    {
      name: "an incident's severity",
      widget: DashboardComponentType.IncidentList,
      widgetColumn: "severity",
      model: new Incident(),
      field: { incidentSeverity: { name: true, color: true } },
    },
    {
      name: "an incident's state",
      widget: DashboardComponentType.IncidentList,
      widgetColumn: "state",
      model: new Incident(),
      field: { currentIncidentState: { name: true, color: true } },
    },
    {
      name: "an alert's severity",
      widget: DashboardComponentType.AlertList,
      widgetColumn: "severity",
      model: new Alert(),
      field: { alertSeverity: { name: true, color: true } },
    },
    {
      name: "an alert's state",
      widget: DashboardComponentType.AlertList,
      widgetColumn: "state",
      model: new Alert(),
      field: { currentAlertState: { name: true, color: true } },
    },
    {
      name: "a monitor's status",
      widget: DashboardComponentType.MonitorList,
      widgetColumn: "status",
      model: new Monitor(),
      field: { currentMonitorStatus: { name: true, color: true } },
    },
  ];

  for (const testCase of cases) {
    test(`${testCase.name}, both ways`, () => {
      const relationSort: RelationColumnSort = sortOf(
        testCase.model,
        testCase.field,
      ) as RelationColumnSort;

      expect(relationSort).not.toBeNull();

      for (const [direction, order] of [
        [DashboardWidgetSortDirection.Descending, DESC],
        [DashboardWidgetSortDirection.Ascending, ASC],
      ] as Array<[DashboardWidgetSortDirection, SortOrder]>) {
        const widgetSort: JSONObject = getDashboardWidgetListSort(
          testCase.widget,
          { column: testCase.widgetColumn, direction },
        );
        const tableSort: JSONObject = getRelationColumnSortValue(
          relationSort,
          order,
        );

        expect(
          read(tableSort, relationSort.relation, relationSort.field),
        ).toEqual(read(widgetSort, relationSort.relation, relationSort.field));
      }
    });
  }
});

// -- A table that is clicked ------------------------------------------------

interface ListCall {
  sort: JSONObject;
  select: JSONObject;
}

const INCIDENT_ID: string = "1d7c39a4-6a8b-4a5e-9a3f-0f7a7d0c1a11";
const MONITOR_ID: string = "2e8d4ab5-7b9c-4b6f-8b4a-1a8b8e1d2b22";

const pillOf: (record: unknown) => ReactElement = (
  record: unknown,
): ReactElement => {
  return <span>{(record as JSONObject | undefined)?.["name"] as string}</span>;
};

const INCIDENT_COLUMNS: Columns<Incident> = [
  {
    field: { title: true },
    title: "Title",
    type: FieldType.Text,
  },
  {
    field: { currentIncidentState: { _id: true, name: true, color: true } },
    title: "State",
    type: FieldType.Entity,
    getElement: (item: Incident): ReactElement => {
      return pillOf(item.currentIncidentState);
    },
  },
  {
    field: { incidentSeverity: { _id: true, name: true, color: true } },
    title: "Severity",
    type: FieldType.Entity,
    getElement: (item: Incident): ReactElement => {
      return pillOf(item.incidentSeverity);
    },
  },
  {
    field: { createdByUser: { name: true, email: true } },
    title: "Created By",
    type: FieldType.Entity,
    getElement: (item: Incident): ReactElement => {
      return pillOf(item.createdByUser);
    },
  },
  {
    field: { labels: { name: true, color: true } },
    title: "Labels",
    type: FieldType.EntityArray,
    getElement: (): ReactElement => {
      return <span>Production</span>;
    },
  },
] as Columns<Incident>;

const MONITOR_COLUMNS: Columns<Monitor> = [
  {
    field: { name: true },
    title: "Name",
    type: FieldType.Text,
  },
  {
    field: { currentMonitorStatus: { color: true, name: true } },
    title: "Monitor Status",
    type: FieldType.Entity,
    getElement: (item: Monitor): ReactElement => {
      return pillOf(item.currentMonitorStatus);
    },
  },
] as Columns<Monitor>;

const makeCallbacks: <T extends Incident | Monitor>(
  calls: Array<ListCall>,
  row: JSONObject,
) => BaseTableCallbacks<T> = <T extends Incident | Monitor>(
  calls: Array<ListCall>,
  row: JSONObject,
): BaseTableCallbacks<T> => {
  return {
    deleteItem: async () => {
      return undefined;
    },
    getModelFromJSON: (item: JSONObject) => {
      return item as unknown as T;
    },
    getJSONFromModel: (item: T) => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown) => {
      return select;
    },
    getList: async (data: {
      limit: number;
      sort: JSONObject;
      select: JSONObject;
    }): Promise<ListResult<T>> => {
      calls.push({
        sort: JSON.parse(JSON.stringify(data.sort || {})),
        select: JSON.parse(JSON.stringify(data.select || {})),
      });

      return {
        data: [row as unknown as T],
        count: 1,
        skip: 0,
        limit: data.limit,
      };
    },
    toJSONArray: () => {
      return [];
    },
    updateById: async () => {
      return undefined;
    },
    showCreateEditModal: () => {
      return <></>;
    },
  } as unknown as BaseTableCallbacks<T>;
};

const INCIDENT_ROW: JSONObject = {
  _id: INCIDENT_ID,
  title: "Checkout is down",
  currentIncidentState: { _id: "s1", name: "Created", color: "#ff0000" },
  incidentSeverity: { _id: "v1", name: "Critical", color: "#ff0000" },
  createdByUser: { name: "Ada Lovelace", email: "ada@example.com" },
  labels: [],
};

const MONITOR_ROW: JSONObject = {
  _id: MONITOR_ID,
  name: "api-gateway",
  currentMonitorStatus: { name: "Offline", color: "#ff0000" },
};

const renderIncidents: (
  calls: Array<ListCall>,
  extra?: Partial<BaseModelTableProps<Incident>>,
) => void = (
  calls: Array<ListCall>,
  extra?: Partial<BaseModelTableProps<Incident>>,
): void => {
  const props: BaseModelTableProps<Incident> = {
    modelType: Incident,
    id: "incidents-table",
    name: "Incidents",
    userPreferencesKey: "incidents-relation-sort",
    cardProps: { title: "Incidents" },
    columns: INCIDENT_COLUMNS,
    filters: [],
    isDeleteable: false,
    isCreateable: false,
    isViewable: false,
    isEditable: false,
    disableUrlState: true,
    callbacks: makeCallbacks<Incident>(calls, INCIDENT_ROW),
    ...(extra || {}),
  } as unknown as BaseModelTableProps<Incident>;

  render(<BaseModelTable<Incident> {...props} />);
};

const renderMonitors: (calls: Array<ListCall>) => void = (
  calls: Array<ListCall>,
): void => {
  const props: BaseModelTableProps<Monitor> = {
    modelType: Monitor,
    id: "monitors-table",
    name: "Monitors",
    userPreferencesKey: "monitors-relation-sort",
    cardProps: { title: "Monitors" },
    columns: MONITOR_COLUMNS,
    filters: [],
    isDeleteable: false,
    isCreateable: false,
    isViewable: false,
    isEditable: false,
    disableUrlState: true,
    callbacks: makeCallbacks<Monitor>(calls, MONITOR_ROW),
  } as unknown as BaseModelTableProps<Monitor>;

  render(<BaseModelTable<Monitor> {...props} />);
};

const header: (title: string) => HTMLElement = (title: string): HTMLElement => {
  return screen.getByRole("columnheader", { name: title });
};

const clickHeader: (title: string) => void = (title: string): void => {
  act(() => {
    fireEvent.click(within(header(title)).getByRole("button"));
  });
};

const lastCall: (calls: Array<ListCall>) => ListCall = (
  calls: Array<ListCall>,
): ListCall => {
  return calls[calls.length - 1] as ListCall;
};

describe("a list's relation headers sort the whole list", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  test("Severity, State and Created By sort; Labels, a column of many records, does not", async () => {
    const calls: Array<ListCall> = [];

    renderIncidents(calls);

    await waitFor(() => {
      expect(screen.queryByText("Checkout is down")).not.toBeNull();
    });

    expect(header("Severity")).toHaveAttribute("aria-sort", "none");
    expect(header("State")).toHaveAttribute("aria-sort", "none");
    expect(header("Created By")).toHaveAttribute("aria-sort", "none");
    expect(header("Labels")).not.toHaveAttribute("aria-sort");
    expect(within(header("Labels")).queryByRole("button")).toBeNull();
  });

  test("a click on Severity asks the server for the most severe first, by the severity's place, and selects it", async () => {
    const calls: Array<ListCall> = [];

    renderIncidents(calls);

    await waitFor(() => {
      expect(screen.queryByText("Checkout is down")).not.toBeNull();
    });

    // Nothing sorted yet: the server's own order.
    expect(lastCall(calls).sort).toEqual({});

    clickHeader("Severity");

    await waitFor(() => {
      expect(lastCall(calls).sort).toEqual({
        incidentSeverity: { order: ASC },
      });
    });

    expect(lastCall(calls).select["incidentSeverity"]).toEqual({
      _id: true,
      name: true,
      color: true,
      order: true,
    });
    expect(header("Severity")).toHaveAttribute("aria-sort", "descending");

    // Again: the least severe first, incidents with no severity still last.
    clickHeader("Severity");

    await waitFor(() => {
      expect(lastCall(calls).sort).toEqual({
        incidentSeverity: { order: DESC_NULLS_LAST },
      });
    });

    expect(header("Severity")).toHaveAttribute("aria-sort", "ascending");
  });

  test("a status's first click is worst first whichever way the list ran before", async () => {
    const calls: Array<ListCall> = [];

    renderIncidents(calls);

    await waitFor(() => {
      expect(screen.queryByText("Checkout is down")).not.toBeNull();
    });

    // Title, then Title again: the list now runs ascending.
    clickHeader("Title");
    await waitFor(() => {
      expect(lastCall(calls).sort).toEqual({ title: DESC });
    });
    clickHeader("Title");
    await waitFor(() => {
      expect(lastCall(calls).sort).toEqual({ title: ASC });
    });

    clickHeader("State");

    await waitFor(() => {
      expect(lastCall(calls).sort).toEqual({
        currentIncidentState: { order: ASC },
      });
    });
    expect(header("State")).toHaveAttribute("aria-sort", "descending");
  });

  test("a name column's first click turns the list's direction round, as any other column's does", async () => {
    const calls: Array<ListCall> = [];

    renderIncidents(calls);

    await waitFor(() => {
      expect(screen.queryByText("Checkout is down")).not.toBeNull();
    });

    clickHeader("Created By");

    await waitFor(() => {
      expect(lastCall(calls).sort).toEqual({
        createdByUser: { name: DESC_NULLS_LAST },
      });
    });

    // The name it is ordered by is selected already: nothing added.
    expect(lastCall(calls).select["createdByUser"]).toEqual({
      name: true,
      email: true,
    });

    clickHeader("Created By");

    await waitFor(() => {
      expect(lastCall(calls).sort).toEqual({ createdByUser: { name: ASC } });
    });
  });

  test("Monitor Status: offline first, the highest priority first", async () => {
    const calls: Array<ListCall> = [];

    renderMonitors(calls);

    await waitFor(() => {
      expect(screen.queryByText("api-gateway")).not.toBeNull();
    });

    expect(header("Monitor Status")).toHaveAttribute("aria-sort", "none");

    clickHeader("Monitor Status");

    await waitFor(() => {
      expect(lastCall(calls).sort).toEqual({
        currentMonitorStatus: { priority: DESC_NULLS_LAST },
      });
    });

    expect(lastCall(calls).select["currentMonitorStatus"]).toEqual({
      color: true,
      name: true,
      priority: true,
    });

    clickHeader("Monitor Status");

    await waitFor(() => {
      expect(lastCall(calls).sort).toEqual({
        currentMonitorStatus: { priority: ASC },
      });
    });
  });

  test("a sort the page starts with names a relation column: the first read is already in its order", async () => {
    const calls: Array<ListCall> = [];

    renderIncidents(calls, {
      sortBy: "incidentSeverity",
      sortOrder: SortOrder.Descending,
    } as Partial<BaseModelTableProps<Incident>>);

    await waitFor(() => {
      expect(screen.queryByText("Checkout is down")).not.toBeNull();
    });

    expect(calls[0]?.sort).toEqual({ incidentSeverity: { order: ASC } });
    expect((calls[0]?.select["incidentSeverity"] as JSONObject)["order"]).toBe(
      true,
    );
    expect(header("Severity")).toHaveAttribute("aria-sort", "descending");
  });

  test("a list people put in order by dragging sorts by nothing else, relations included", async () => {
    const calls: Array<ListCall> = [];

    renderIncidents(calls, {
      enableDragAndDrop: true,
      dragDropIndexField: "incidentNumber",
    } as Partial<BaseModelTableProps<Incident>>);

    await waitFor(() => {
      expect(screen.queryByText("Checkout is down")).not.toBeNull();
    });

    expect(header("Severity")).not.toHaveAttribute("aria-sort");
    expect(header("State")).not.toHaveAttribute("aria-sort");
    expect(header("Created By")).not.toHaveAttribute("aria-sort");
    expect(lastCall(calls).select["incidentSeverity"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
  });

  test("a list opened sorted by a relation it cannot be ordered by - its Labels - still loads, in its own order", async () => {
    const calls: Array<ListCall> = [];

    renderIncidents(calls, {
      sortBy: "labels",
      sortOrder: SortOrder.Descending,
    } as Partial<BaseModelTableProps<Incident>>);

    await waitFor(() => {
      expect(screen.queryByText("Checkout is down")).not.toBeNull();
    });

    expect(calls[0]?.sort).toEqual({});
    expect(header("Labels")).not.toHaveAttribute("aria-sort");
  });

  test("a list opened sorted by a column its model no longer has - from an old link or saved view - still loads, in its own order (#8841)", async () => {
    const calls: Array<ListCall> = [];

    renderIncidents(calls, {
      sortBy: "oldColumn",
      sortOrder: SortOrder.Descending,
    } as unknown as Partial<BaseModelTableProps<Incident>>);

    await waitFor(() => {
      expect(screen.queryByText("Checkout is down")).not.toBeNull();
    });

    expect(calls[0]?.sort).toEqual({});

    // No header reads as the one the list is sorted by.
    for (const title of ["Severity", "State", "Created By", "Labels"]) {
      expect(["none", null]).toContain(header(title).getAttribute("aria-sort"));
    }
  });
});
