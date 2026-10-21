/**
 * The registry of what each dashboard list widget can be sorted by, and how
 * the database orders the whole list by each column (issue #5082). The
 * browser's widgets and the public dashboard's server both read it, so:
 *
 *   - every widget kind with columns is in it, with columns its header
 *     shows, and a widget saved without a sort lists exactly as before;
 *   - a status or severity sorts by what it means, worst first, in the
 *     order the project keeps (a monitor status's priority grows worse, an
 *     incident severity's order shrinks worse);
 *   - a status written as a word is read rank by rank, within any filter
 *     the widget has on it;
 *   - a write's widget sorts are held to the same columns.
 */

import { describe, expect, test } from "@jest/globals";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  DashboardWidgetSortChoice,
  DashboardWidgetSortDirection,
  DashboardWidgetSortKind,
} from "../../../Types/Dashboard/DashboardWidgetSort";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import {
  DASHBOARD_WIDGET_TYPES_SORTED_BY_OWN_COLUMNS,
  DashboardWidgetListReadStep,
  DashboardWidgetListSortColumn,
  DashboardWidgetListSortSpec,
  KUBERNETES_POD_PHASE_RANKS,
  getDashboardWidgetEffectiveSort,
  getDashboardWidgetListReadSteps,
  getDashboardWidgetListSort,
  getDashboardWidgetListSortSelect,
  getDashboardWidgetSortColumns,
  getDashboardWidgetSortComponentTypes,
  getDashboardWidgetSortSpec,
  getDashboardWidgetSortValues,
  getDashboardWidgetSortsProblem,
  isWritableSortPath,
  readDashboardWidgetListInSteps,
  readDashboardWidgetSavedSort,
  withDashboardWidgetListSortSelect,
  withDashboardWidgetSavedSort,
} from "../../../Utils/Dashboard/DashboardWidgetSorts";
import { SLO_LIST_SORT } from "../../../Utils/Slo/SloListWidgetFormat";
import {
  STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES,
  STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES,
  STORAGE_ARRAY_WARNING_COMPONENT_STATUSES,
} from "../../../Utils/Dashboard/Components/DashboardStorageArrayResourceListShared";
import {
  TRACE_ANALYTICS_TABLE_GROUP_SORT_KEY,
  TRACE_ANALYTICS_TABLE_SORT_ALIASES,
} from "../../../Server/Services/TraceAggregationService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Incident from "../../../Models/DatabaseModels/Incident";
import Alert from "../../../Models/DatabaseModels/Alert";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesResource from "../../../Models/DatabaseModels/KubernetesResource";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerResource from "../../../Models/DatabaseModels/DockerResource";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import PodmanResource from "../../../Models/DatabaseModels/PodmanResource";
import ProxmoxResource from "../../../Models/DatabaseModels/ProxmoxResource";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import CephResource from "../../../Models/DatabaseModels/CephResource";
import StorageArrayResource from "../../../Models/DatabaseModels/StorageArrayResource";
import DockerSwarmResource from "../../../Models/DatabaseModels/DockerSwarmResource";
import Span from "../../../Models/AnalyticsModels/Span";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";

const ASC: DashboardWidgetSortDirection =
  DashboardWidgetSortDirection.Ascending;
const DESC: DashboardWidgetSortDirection =
  DashboardWidgetSortDirection.Descending;

// How the database writes a descending order that keeps empty rows last.
const DESC_NULLS_LAST: JSONObject = {
  direction: SortOrder.Descending,
  nulls: "LAST",
};

function choice(
  column: string,
  direction: DashboardWidgetSortDirection,
): DashboardWidgetSortChoice {
  return { column, direction };
}

// A key a widget's arguments and a viewer's browser keep a sort under.
const SORT_KEY_PATTERN: RegExp = /^[a-zA-Z][a-zA-Z0-9]*$/;

// A sort with its keys in order, as the database reads them.
function written(sort: JSONObject): string {
  return JSON.stringify(sort);
}

const KUBERNETES_NAMESPACED: Array<DashboardComponentType> = [
  DashboardComponentType.KubernetesPodList,
  DashboardComponentType.KubernetesDeploymentList,
  DashboardComponentType.KubernetesStatefulSetList,
  DashboardComponentType.KubernetesDaemonSetList,
  DashboardComponentType.KubernetesJobList,
  DashboardComponentType.KubernetesCronJobList,
];

/*
 * Every widget kind the registry orders, with the model its rows are and
 * the database order the widget always had - which a widget saved without
 * a sort must keep, written exactly as before.
 */
const WIDGETS: Array<{
  componentType: DashboardComponentType;
  model: { new (): BaseModel } | { new (): AnalyticsBaseModel } | null;
  previousOrder: JSONObject | null;
}> = [
  {
    componentType: DashboardComponentType.MonitorList,
    model: Monitor,
    previousOrder: { name: SortOrder.Ascending },
  },
  {
    componentType: DashboardComponentType.IncidentList,
    model: Incident,
    previousOrder: { createdAt: SortOrder.Descending },
  },
  {
    componentType: DashboardComponentType.AlertList,
    model: Alert,
    previousOrder: { createdAt: SortOrder.Descending },
  },
  {
    componentType: DashboardComponentType.SloList,
    model: ServiceLevelObjective,
    previousOrder: SLO_LIST_SORT as JSONObject,
  },
  {
    componentType: DashboardComponentType.HostList,
    model: Host,
    previousOrder: { name: SortOrder.Ascending },
  },
  ...KUBERNETES_NAMESPACED.map((componentType: DashboardComponentType) => {
    return {
      componentType,
      model: KubernetesResource,
      previousOrder: {
        namespaceKey: SortOrder.Ascending,
        name: SortOrder.Ascending,
      } as JSONObject,
    };
  }),
  /*
   * Nodes and namespaces have no namespace, so the order they always had -
   * namespace, then name - is by name; the registry says so, by name first.
   */
  {
    componentType: DashboardComponentType.KubernetesNodeList,
    model: KubernetesResource,
    previousOrder: {
      name: SortOrder.Ascending,
      namespaceKey: SortOrder.Ascending,
    },
  },
  {
    componentType: DashboardComponentType.KubernetesNamespaceList,
    model: KubernetesResource,
    previousOrder: {
      name: SortOrder.Ascending,
      namespaceKey: SortOrder.Ascending,
    },
  },
  ...[
    {
      componentType: DashboardComponentType.DockerHostList,
      model: DockerHost,
    },
    {
      componentType: DashboardComponentType.PodmanHostList,
      model: PodmanHost,
    },
    {
      componentType: DashboardComponentType.DockerContainerList,
      model: DockerResource,
    },
    {
      componentType: DashboardComponentType.PodmanContainerList,
      model: PodmanResource,
    },
    {
      componentType: DashboardComponentType.DockerImageList,
      model: DockerResource,
    },
    {
      componentType: DashboardComponentType.PodmanImageList,
      model: PodmanResource,
    },
    {
      componentType: DashboardComponentType.DockerNetworkList,
      model: DockerResource,
    },
    {
      componentType: DashboardComponentType.PodmanNetworkList,
      model: PodmanResource,
    },
    {
      componentType: DashboardComponentType.DockerVolumeList,
      model: DockerResource,
    },
    {
      componentType: DashboardComponentType.PodmanVolumeList,
      model: PodmanResource,
    },
    {
      componentType: DashboardComponentType.ProxmoxNodeList,
      model: ProxmoxResource,
    },
    {
      componentType: DashboardComponentType.ProxmoxGuestList,
      model: ProxmoxResource,
    },
    {
      componentType: DashboardComponentType.VMwareHostList,
      model: VMwareResource,
    },
    {
      componentType: DashboardComponentType.VMwareVirtualMachineList,
      model: VMwareResource,
    },
    {
      componentType: DashboardComponentType.CephPoolList,
      model: CephResource,
    },
    {
      componentType: DashboardComponentType.StorageArrayVolumeList,
      model: StorageArrayResource,
    },
    {
      componentType: DashboardComponentType.StorageArrayHardwareList,
      model: StorageArrayResource,
    },
    {
      componentType: DashboardComponentType.DockerSwarmNodeList,
      model: DockerSwarmResource,
    },
    {
      componentType: DashboardComponentType.DockerSwarmServiceList,
      model: DockerSwarmResource,
    },
  ].map(
    (entry: {
      componentType: DashboardComponentType;
      model: { new (): BaseModel };
    }) => {
      return {
        ...entry,
        previousOrder: { name: SortOrder.Ascending } as JSONObject,
      };
    },
  ),
  {
    componentType: DashboardComponentType.CephOsdList,
    model: CephResource,
    previousOrder: { externalId: SortOrder.Ascending },
  },
  {
    componentType: DashboardComponentType.TraceList,
    model: Span,
    previousOrder: { startTime: SortOrder.Descending },
  },
  {
    componentType: DashboardComponentType.SecurityEventsList,
    model: SecurityEvent,
    previousOrder: { time: SortOrder.Descending },
  },
  /*
   * The trace table's rows are summed up in ClickHouse; its order is the
   * server's (TraceAggregationService), not a model's.
   */
  {
    componentType: DashboardComponentType.TraceTable,
    model: null,
    previousOrder: null,
  },
];

function getSpec(
  componentType: DashboardComponentType,
): DashboardWidgetListSortSpec {
  const spec: DashboardWidgetListSortSpec | null =
    getDashboardWidgetSortSpec(componentType);

  if (!spec) {
    throw new Error(`No sort for ${componentType}`);
  }

  return spec;
}

describe("which widgets the registry orders", () => {
  test("every list widget with columns, the trace table and the security events list - and nothing else", () => {
    expect(getDashboardWidgetSortComponentTypes().sort()).toEqual(
      WIDGETS.map((entry: { componentType: DashboardComponentType }) => {
        return entry.componentType;
      }).sort(),
    );
  });

  test.each([
    DashboardComponentType.Chart,
    DashboardComponentType.Value,
    DashboardComponentType.LogStream,
    DashboardComponentType.NetworkMap,
    DashboardComponentType.Slo,
    // These sort the rows they hold, by columns of their own.
    DashboardComponentType.Table,
    DashboardComponentType.DataSourceTable,
  ])("%s has no registry entry", (componentType: DashboardComponentType) => {
    expect(getDashboardWidgetSortSpec(componentType)).toBeNull();
    expect(getDashboardWidgetSortColumns(componentType)).toEqual([]);
  });

  test("a type that is not a widget kind, or not text, has none either", () => {
    for (const value of [
      "constructor",
      "__proto__",
      "toString",
      "",
      undefined,
      null,
      5,
      {},
    ]) {
      expect(getDashboardWidgetSortSpec(value)).toBeNull();
    }
  });

  test("the metric and Data Source tables are the widgets that sort by columns of their own", () => {
    expect([...DASHBOARD_WIDGET_TYPES_SORTED_BY_OWN_COLUMNS].sort()).toEqual(
      [
        DashboardComponentType.DataSourceTable,
        DashboardComponentType.Table,
      ].sort(),
    );
  });
});

describe.each(WIDGETS)(
  "$componentType",
  (entry: {
    componentType: DashboardComponentType;
    model: { new (): BaseModel } | { new (): AnalyticsBaseModel } | null;
    previousOrder: JSONObject | null;
  }) => {
    const spec: DashboardWidgetListSortSpec = getSpec(entry.componentType);

    test("names each column once, by a key and by the header's words", () => {
      const keys: Array<string> = spec.columns.map(
        (column: DashboardWidgetListSortColumn) => {
          return column.key;
        },
      );
      const titles: Array<string> = spec.columns.map(
        (column: DashboardWidgetListSortColumn) => {
          return column.title;
        },
      );

      expect(new Set(keys).size).toBe(keys.length);
      expect(new Set(titles).size).toBe(titles.length);

      for (const column of spec.columns) {
        expect(column.key).toMatch(SORT_KEY_PATTERN);
        expect(column.title.trim()).toBe(column.title);
        expect(column.title.length).toBeGreaterThan(0);
      }
    });

    test("its own order is one of its columns", () => {
      expect(
        spec.columns.some((column: DashboardWidgetListSortColumn) => {
          return column.key === spec.defaultSort.column;
        }),
      ).toBe(true);
    });

    if (entry.previousOrder) {
      test("saved without a sort, it lists exactly as it always did", () => {
        expect(
          written(getDashboardWidgetListSort(entry.componentType, null)),
        ).toBe(written(entry.previousOrder as JSONObject));
        expect(
          written(
            getDashboardWidgetListSort(entry.componentType, spec.defaultSort),
          ),
        ).toBe(written(entry.previousOrder as JSONObject));
      });

      test("every column is ordered by the database, both ways", () => {
        for (const column of spec.columns) {
          expect(Boolean(column.fields?.length) || Boolean(column.ranks)).toBe(
            true,
          );

          for (const direction of [ASC, DESC]) {
            const steps: Array<DashboardWidgetListReadStep> =
              getDashboardWidgetListReadSteps({
                componentType: entry.componentType,
                choice: choice(column.key, direction),
                query: {},
              });

            expect(steps.length).toBeGreaterThan(0);

            for (const step of steps) {
              expect(Object.keys(step.sort).length).toBeGreaterThan(0);
            }
          }
        }
      });

      test("orders only by fields its model has, and by related fields a list may read", () => {
        const model: BaseModel | AnalyticsBaseModel = new (entry.model as {
          new (): BaseModel | AnalyticsBaseModel;
        })();

        const paths: Array<string> = [
          ...spec.columns.flatMap((column: DashboardWidgetListSortColumn) => {
            return (column.fields || []).map((field: { path: string }) => {
              return field.path;
            });
          }),
          ...spec.thenBy.map((tieBreak: { path: string }) => {
            return tieBreak.path;
          }),
        ];

        for (const path of paths) {
          const [relation, field] = path.split(".") as [
            string,
            string | undefined,
          ];

          if (model instanceof AnalyticsBaseModel) {
            expect(field).toBeUndefined();
            expect(model.getTableColumn(relation)).not.toBeNull();
            continue;
          }

          expect(model.hasColumn(relation)).toBe(true);

          if (!field) {
            expect(model.isEntityColumn(relation)).toBe(false);
            continue;
          }

          const relatedModelType: { new (): BaseModel } | undefined =
            model.getTableColumnMetadata(relation)?.modelType as
              | { new (): BaseModel }
              | undefined;

          expect(relatedModelType).toBeDefined();

          const related: BaseModel = new (relatedModelType as {
            new (): BaseModel;
          })();

          // A list orders by a related field only when it may read it.
          expect(related.getTableColumnMetadata(field)).toBeDefined();
          expect(
            related.getTableColumnMetadata(field)?.canReadOnRelationQuery,
          ).toBe(true);
        }
      });
    }

    test("every column can be saved both ways, and nothing else", () => {
      const values: Array<string> = getDashboardWidgetSortValues(
        entry.componentType,
      );

      expect(values).toHaveLength(spec.columns.length * 2);

      for (const value of values) {
        expect(
          readDashboardWidgetSavedSort(entry.componentType, { sort: value }),
        ).not.toBeNull();
      }

      expect(
        readDashboardWidgetSavedSort(entry.componentType, {
          sort: "notAColumn:asc",
        }),
      ).toBeNull();
    });
  },
);

describe("status and severity sort by what they mean, worst first", () => {
  test("a monitor's status by the priority the project gives it - the higher, the worse", () => {
    expect(
      getDashboardWidgetListSort(
        DashboardComponentType.MonitorList,
        choice("status", DESC),
      ),
    ).toEqual({
      currentMonitorStatus: { priority: DESC_NULLS_LAST },
      name: SortOrder.Ascending,
    });

    expect(
      getDashboardWidgetListSort(
        DashboardComponentType.MonitorList,
        choice("status", ASC),
      ),
    ).toEqual({
      currentMonitorStatus: { priority: SortOrder.Ascending },
      name: SortOrder.Ascending,
    });
  });

  test.each([
    [DashboardComponentType.IncidentList, "incidentSeverity", "severity"],
    [DashboardComponentType.IncidentList, "currentIncidentState", "state"],
    [DashboardComponentType.AlertList, "alertSeverity", "severity"],
    [DashboardComponentType.AlertList, "currentAlertState", "state"],
  ])(
    "%s %s by its order - the lower, the worse: worst first is ascending",
    (
      componentType: DashboardComponentType,
      relation: string,
      column: string,
    ) => {
      expect(
        getDashboardWidgetListSort(componentType, choice(column, DESC)),
      ).toEqual({
        [relation]: { order: SortOrder.Ascending },
        createdAt: SortOrder.Descending,
      });

      expect(
        getDashboardWidgetListSort(componentType, choice(column, ASC)),
      ).toEqual({
        [relation]: { order: DESC_NULLS_LAST },
        createdAt: SortOrder.Descending,
      });
    },
  );

  test.each([
    [DashboardComponentType.KubernetesNodeList, "status", "isReady"],
    [DashboardComponentType.ProxmoxNodeList, "status", "isUp"],
    [DashboardComponentType.ProxmoxGuestList, "status", "isUp"],
    [DashboardComponentType.VMwareVirtualMachineList, "power", "isPoweredOn"],
    [DashboardComponentType.DockerSwarmNodeList, "status", "isReady"],
    [DashboardComponentType.DockerSwarmServiceList, "status", "isReady"],
  ])(
    "%s %s puts the false %s first, and rows that have not said last both ways",
    (componentType: DashboardComponentType, column: string, field: string) => {
      const worstFirst: JSONObject = getDashboardWidgetListSort(
        componentType,
        choice(column, DESC),
      );
      const bestFirst: JSONObject = getDashboardWidgetListSort(
        componentType,
        choice(column, ASC),
      );

      // false sorts before true, and Postgres keeps no value last ascending.
      expect(worstFirst[field]).toBe(SortOrder.Ascending);
      expect(Object.keys(worstFirst)[0]).toBe(field);
      expect(bestFirst[field]).toEqual(DESC_NULLS_LAST);
    },
  );

  test.each([
    DashboardComponentType.HostList,
    DashboardComponentType.DockerHostList,
    DashboardComponentType.PodmanHostList,
  ])(
    "%s status: disconnected first, with hosts that never connected (drawn as Disconnected) among them",
    (componentType: DashboardComponentType) => {
      // "disconnected" sorts after "connected"; no value sorts first descending.
      expect(
        getDashboardWidgetListSort(componentType, choice("status", DESC)),
      ).toEqual({
        otelCollectorStatus: SortOrder.Descending,
        name: SortOrder.Ascending,
      });
      expect(
        getDashboardWidgetListSort(componentType, choice("status", ASC)),
      ).toEqual({
        otelCollectorStatus: SortOrder.Ascending,
        name: SortOrder.Ascending,
      });
      expect("disconnected" > "connected").toBe(true);
    },
  );

  test("an SLO's status by its error budget - exhausted, at risk, healthy - with disabled SLOs after every enabled one both ways", () => {
    expect(
      written(
        getDashboardWidgetListSort(
          DashboardComponentType.SloList,
          choice("status", DESC),
        ),
      ),
    ).toBe(written(SLO_LIST_SORT as JSONObject));

    expect(
      getDashboardWidgetListSort(
        DashboardComponentType.SloList,
        choice("status", ASC),
      ),
    ).toEqual({
      isEnabled: SortOrder.Descending,
      errorBudgetRemainingPercentage: DESC_NULLS_LAST,
      name: SortOrder.Ascending,
    });

    for (const column of ["sli", "errorBudget", "burnRate"]) {
      for (const direction of [ASC, DESC]) {
        const sort: JSONObject = getDashboardWidgetListSort(
          DashboardComponentType.SloList,
          choice(column, direction),
        );

        expect(Object.keys(sort)[0]).toBe("isEnabled");
        expect(sort["isEnabled"]).toBe(SortOrder.Descending);
      }
    }
  });

  test("an SLO's SLI and error budget start lowest first: the worst", () => {
    const sli: DashboardWidgetListSortColumn = getSpec(
      DashboardComponentType.SloList,
    ).columns.find((column: DashboardWidgetListSortColumn) => {
      return column.key === "sli";
    }) as DashboardWidgetListSortColumn;
    const budget: DashboardWidgetListSortColumn = getSpec(
      DashboardComponentType.SloList,
    ).columns.find((column: DashboardWidgetListSortColumn) => {
      return column.key === "errorBudget";
    }) as DashboardWidgetListSortColumn;

    expect(sli.firstDirection).toBe(ASC);
    expect(budget.firstDirection).toBe(ASC);
  });

  test("a span's status by its code: Error (2), then Ok (1), then Unset (0)", () => {
    expect(
      getDashboardWidgetListSort(
        DashboardComponentType.TraceList,
        choice("status", DESC),
      ),
    ).toEqual({
      statusCode: SortOrder.Descending,
      startTime: SortOrder.Descending,
    });
  });

  test("a security event's severity by its OCSF id, which grows with the severity", () => {
    expect(
      getDashboardWidgetListSort(
        DashboardComponentType.SecurityEventsList,
        choice("severity", DESC),
      ),
    ).toEqual({ severityId: SortOrder.Descending, time: SortOrder.Descending });
  });

  test("every status column is a Status column, so its first click is worst first", () => {
    for (const componentType of getDashboardWidgetSortComponentTypes()) {
      for (const column of getDashboardWidgetSortColumns(componentType)) {
        if (
          ["status", "state", "severity", "phase", "power"].includes(column.key)
        ) {
          expect(column.kind).toBe(DashboardWidgetSortKind.Status);
          expect(column.firstDirection).toBeUndefined();
        }
      }
    }
  });
});

describe("numbers, times and names", () => {
  test("a number highest first keeps rows with no reading at the bottom, and lowest first too", () => {
    expect(
      getDashboardWidgetListSort(
        DashboardComponentType.DockerContainerList,
        choice("cpu", DESC),
      ),
    ).toEqual({ latestCpuPercent: DESC_NULLS_LAST, name: SortOrder.Ascending });

    expect(
      getDashboardWidgetListSort(
        DashboardComponentType.DockerContainerList,
        choice("cpu", ASC),
      ),
    ).toEqual({
      latestCpuPercent: SortOrder.Ascending,
      name: SortOrder.Ascending,
    });
  });

  test("a time a record always has is written plainly; one it may lack keeps empty rows last", () => {
    expect(
      getDashboardWidgetListSort(
        DashboardComponentType.IncidentList,
        choice("declared", ASC),
      ),
    ).toEqual({ createdAt: SortOrder.Ascending });

    expect(
      getDashboardWidgetListSort(
        DashboardComponentType.HostList,
        choice("lastSeen", DESC),
      ),
    ).toEqual({ lastSeenAt: DESC_NULLS_LAST, name: SortOrder.Ascending });
  });

  test("a name Z to A is not ordered by name twice", () => {
    expect(
      written(
        getDashboardWidgetListSort(
          DashboardComponentType.MonitorList,
          choice("name", DESC),
        ),
      ),
    ).toBe(written({ name: DESC_NULLS_LAST }));
  });

  test("a related record's name sorts through the relation, then by the list's own order", () => {
    expect(
      written(
        getDashboardWidgetListSort(
          DashboardComponentType.KubernetesPodList,
          choice("cluster", ASC),
        ),
      ),
    ).toBe(
      written({
        kubernetesCluster: { name: SortOrder.Ascending },
        namespaceKey: SortOrder.Ascending,
        name: SortOrder.Ascending,
      }),
    );
  });

  test("an OS sorts by its type, then its version", () => {
    expect(
      written(
        getDashboardWidgetListSort(
          DashboardComponentType.HostList,
          choice("os", ASC),
        ),
      ),
    ).toBe(
      written({
        osType: SortOrder.Ascending,
        osVersion: SortOrder.Ascending,
        name: SortOrder.Ascending,
      }),
    );
  });

  test("ClickHouse lists are ordered plainly: no empty-row placement", () => {
    for (const componentType of [
      DashboardComponentType.TraceList,
      DashboardComponentType.SecurityEventsList,
    ]) {
      for (const column of getDashboardWidgetSortColumns(componentType)) {
        for (const direction of [ASC, DESC]) {
          const sort: JSONObject = getDashboardWidgetListSort(
            componentType,
            choice(column.key, direction),
          );

          for (const value of Object.values(sort)) {
            expect([SortOrder.Ascending, SortOrder.Descending]).toContain(
              value,
            );
          }
        }
      }
    }
  });
});

describe("what a list must read for its order", () => {
  test("a related field it orders by is in its select, the same for every order", () => {
    expect(
      getDashboardWidgetListSortSelect(DashboardComponentType.MonitorList),
    ).toEqual({ currentMonitorStatus: { priority: true } });

    expect(
      getDashboardWidgetListSortSelect(DashboardComponentType.IncidentList),
    ).toEqual({
      currentIncidentState: { order: true },
      incidentSeverity: { order: true },
    });

    expect(
      getDashboardWidgetListSortSelect(DashboardComponentType.AlertList),
    ).toEqual({
      currentAlertState: { order: true },
      alertSeverity: { order: true },
    });

    expect(
      getDashboardWidgetListSortSelect(
        DashboardComponentType.KubernetesPodList,
      ),
    ).toEqual({ kubernetesCluster: { name: true } });

    expect(
      getDashboardWidgetListSortSelect(DashboardComponentType.HostList),
    ).toEqual({});

    expect(getDashboardWidgetListSortSelect("NotAWidget")).toEqual({});
  });

  test("merges into the relation's own select without taking anything away", () => {
    const select: JSONObject = {
      _id: true,
      name: true,
      currentMonitorStatus: { name: true, color: true },
    };

    expect(
      withDashboardWidgetListSortSelect(
        DashboardComponentType.MonitorList,
        select,
      ),
    ).toEqual({
      _id: true,
      name: true,
      currentMonitorStatus: { name: true, color: true, priority: true },
    });

    // The select handed in is left as it was.
    expect(select).toEqual({
      _id: true,
      name: true,
      currentMonitorStatus: { name: true, color: true },
    });
  });
});

describe("the widget's own sort", () => {
  test("is read from its arguments, as none when it names no column of its kind", () => {
    expect(
      readDashboardWidgetSavedSort(DashboardComponentType.MonitorList, {
        sort: "status:desc",
      }),
    ).toEqual(choice("status", DESC));

    for (const widgetArguments of [
      {},
      { sort: "" },
      { sort: "severity:desc" },
      { sort: "status:up" },
      { sort: 5 },
      null,
      undefined,
      "status:desc",
    ]) {
      expect(
        readDashboardWidgetSavedSort(
          DashboardComponentType.MonitorList,
          widgetArguments,
        ),
      ).toBeNull();
    }
  });

  test("decides the order unless a better choice is handed in; an unknown one falls back to the built-in order", () => {
    expect(
      getDashboardWidgetEffectiveSort(
        DashboardComponentType.MonitorList,
        choice("type", DESC),
      ),
    ).toEqual(choice("type", DESC));

    expect(
      getDashboardWidgetEffectiveSort(
        DashboardComponentType.MonitorList,
        choice("nope", DESC),
      ),
    ).toEqual(choice("name", ASC));

    expect(
      getDashboardWidgetEffectiveSort(DashboardComponentType.MonitorList, null),
    ).toEqual(choice("name", ASC));

    expect(
      getDashboardWidgetEffectiveSort(DashboardComponentType.Chart, null),
    ).toBeNull();
  });

  test("is set and taken away without changing the widget handed in", () => {
    const widget: { componentType: string; arguments: JSONObject } = {
      componentType: DashboardComponentType.MonitorList,
      arguments: { title: "Network", maxRows: 25 },
    };

    const sorted: { componentType: string; arguments?: unknown } =
      withDashboardWidgetSavedSort(widget, "status:desc");

    expect(sorted.arguments).toEqual({
      title: "Network",
      maxRows: 25,
      sort: "status:desc",
    });
    expect(widget.arguments).toEqual({ title: "Network", maxRows: 25 });

    expect(withDashboardWidgetSavedSort(sorted, null).arguments).toEqual({
      title: "Network",
      maxRows: 25,
    });

    // A widget saved without arguments gets them.
    const bare: { componentType: string; arguments?: unknown } = {
      componentType: "MonitorList",
    };

    expect(withDashboardWidgetSavedSort(bare, "name:asc").arguments).toEqual({
      sort: "name:asc",
    });
  });
});

function stepPhases(step: DashboardWidgetListReadStep): unknown {
  const phase: unknown = step.query["phase"];

  if (phase instanceof Includes) {
    return { in: phase.values };
  }

  if (phase instanceof IncludesNone) {
    return { notIn: phase.values };
  }

  if (phase instanceof IsNull) {
    return "null";
  }

  return phase;
}

describe("a status written as a word is read rank by rank", () => {
  const POD_QUERY: JSONObject = { projectId: "p", kind: "Pod" };
  const POD_TIE_BREAK: JSONObject = {
    namespaceKey: SortOrder.Ascending,
    name: SortOrder.Ascending,
  };

  test("pods worst first: Failed, Unknown, Pending, then the healthy, then what no rank holds", () => {
    const steps: Array<DashboardWidgetListReadStep> =
      getDashboardWidgetListReadSteps({
        componentType: DashboardComponentType.KubernetesPodList,
        choice: choice("phase", DESC),
        query: POD_QUERY,
      });

    expect(steps.map(stepPhases)).toEqual([
      { in: ["Failed"] },
      { in: ["Unknown"] },
      { in: ["Pending"] },
      { in: ["Running", "Succeeded"] },
      { notIn: KUBERNETES_POD_PHASE_RANKS.flat() },
      "null",
    ]);

    for (const step of steps) {
      // Every read is the widget's own query, ordered within its rank.
      expect(step.query["projectId"]).toBe("p");
      expect(step.query["kind"]).toBe("Pod");
      expect(step.sort).toEqual(POD_TIE_BREAK);
    }
  });

  test("pods best first: the ranks the other way round, what no rank holds still last", () => {
    expect(
      getDashboardWidgetListReadSteps({
        componentType: DashboardComponentType.KubernetesPodList,
        choice: choice("phase", ASC),
        query: POD_QUERY,
      }).map(stepPhases),
    ).toEqual([
      { in: ["Running", "Succeeded"] },
      { in: ["Pending"] },
      { in: ["Unknown"] },
      { in: ["Failed"] },
      { notIn: KUBERNETES_POD_PHASE_RANKS.flat() },
      "null",
    ]);
  });

  test("the ranks hold every phase once", () => {
    const phases: Array<string> = KUBERNETES_POD_PHASE_RANKS.flat();

    expect(new Set(phases).size).toBe(phases.length);
    expect([...phases].sort()).toEqual(
      ["Failed", "Pending", "Running", "Succeeded", "Unknown"].sort(),
    );
  });

  test("a pod list kept to some phases reads only the ranks those phases are in", () => {
    expect(
      getDashboardWidgetListReadSteps({
        componentType: DashboardComponentType.KubernetesPodList,
        choice: choice("phase", DESC),
        query: { ...POD_QUERY, phase: new Includes(["Running", "Failed"]) },
      }).map(stepPhases),
    ).toEqual([{ in: ["Failed"] }, { in: ["Running"] }]);
  });

  test("a pod list kept to one phase reads that one", () => {
    expect(
      getDashboardWidgetListReadSteps({
        componentType: DashboardComponentType.KubernetesPodList,
        choice: choice("phase", DESC),
        query: { ...POD_QUERY, phase: "Pending" },
      }).map(stepPhases),
    ).toEqual(["Pending"]);
  });

  test("a filter the ranks cannot be read within reads the list in one go, in its own order", () => {
    const query: JSONObject = { ...POD_QUERY, phase: new Search("Run") };

    expect(
      getDashboardWidgetListReadSteps({
        componentType: DashboardComponentType.KubernetesPodList,
        choice: choice("phase", DESC),
        query,
      }),
    ).toEqual([{ query, sort: POD_TIE_BREAK }]);
  });

  test("storage hardware worst first: critical statuses, warning statuses, every other status, then none", () => {
    const steps: Array<DashboardWidgetListReadStep> =
      getDashboardWidgetListReadSteps({
        componentType: DashboardComponentType.StorageArrayHardwareList,
        choice: choice("status", DESC),
        query: { projectId: "p" },
      });

    const statuses: Array<unknown> = steps.map(
      (step: DashboardWidgetListReadStep) => {
        const status: unknown = step.query["status"];

        if (status instanceof Includes) {
          return { in: status.values };
        }

        if (status instanceof IncludesNone) {
          return { notIn: status.values };
        }

        return status instanceof IsNull ? "null" : status;
      },
    );

    expect(statuses).toEqual([
      { in: [...STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES] },
      { in: [...STORAGE_ARRAY_WARNING_COMPONENT_STATUSES] },
      {
        notIn: [
          ...STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES,
          ...STORAGE_ARRAY_WARNING_COMPONENT_STATUSES,
        ],
      },
      "null",
    ]);
  });

  test("storage hardware kept to the unhealthy reads the critical, then the warning", () => {
    const steps: Array<DashboardWidgetListReadStep> =
      getDashboardWidgetListReadSteps({
        componentType: DashboardComponentType.StorageArrayHardwareList,
        choice: choice("status", DESC),
        query: {
          projectId: "p",
          status: new Includes([...STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES]),
        },
      });

    expect(
      steps.map((step: DashboardWidgetListReadStep) => {
        return (step.query["status"] as Includes).values;
      }),
    ).toEqual([
      [...STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES],
      [...STORAGE_ARRAY_WARNING_COMPONENT_STATUSES],
    ]);
  });

  test("Ceph OSDs worst first: down but in, up but out, down and out, up and in, then those missing a flag", () => {
    const steps: Array<DashboardWidgetListReadStep> =
      getDashboardWidgetListReadSteps({
        componentType: DashboardComponentType.CephOsdList,
        choice: choice("state", DESC),
        query: { projectId: "p", kind: "Osd" },
      });

    expect(
      steps.map((step: DashboardWidgetListReadStep) => {
        return [step.query["isUp"], step.query["isIn"]];
      }),
    ).toEqual([
      [false, true],
      [true, false],
      [false, false],
      [true, true],
      [expect.any(IsNull), undefined],
      [expect.any(NotNull), expect.any(IsNull)],
    ]);

    for (const step of steps) {
      expect(step.sort).toEqual({ externalId: SortOrder.Ascending });
    }
  });

  test("Ceph OSDs kept to the down ones read only the ranks a down OSD can be in", () => {
    expect(
      getDashboardWidgetListReadSteps({
        componentType: DashboardComponentType.CephOsdList,
        choice: choice("state", DESC),
        query: { projectId: "p", kind: "Osd", isUp: false },
      }).map((step: DashboardWidgetListReadStep) => {
        return [step.query["isUp"], step.query["isIn"]];
      }),
    ).toEqual([
      [false, true],
      [false, false],
      [false, expect.any(IsNull)],
    ]);
  });

  test("Ceph OSDs kept to the out ones read only the ranks an out OSD can be in", () => {
    expect(
      getDashboardWidgetListReadSteps({
        componentType: DashboardComponentType.CephOsdList,
        choice: choice("state", DESC),
        query: { projectId: "p", kind: "Osd", isIn: false },
      }).map((step: DashboardWidgetListReadStep) => {
        return [step.query["isUp"], step.query["isIn"]];
      }),
    ).toEqual([
      [true, false],
      [false, false],
      [expect.any(IsNull), false],
    ]);
  });

  test("a column the database orders is one read", () => {
    const query: JSONObject = { projectId: "p", kind: "Pod" };

    expect(
      getDashboardWidgetListReadSteps({
        componentType: DashboardComponentType.KubernetesPodList,
        choice: choice("name", DESC),
        query,
      }),
    ).toEqual([
      {
        query,
        sort: { name: DESC_NULLS_LAST, namespaceKey: SortOrder.Ascending },
      },
    ]);
  });

  test("a kind the registry does not order is one read with no order of its own", () => {
    expect(
      getDashboardWidgetListReadSteps({
        componentType: DashboardComponentType.Chart,
        choice: null,
        query: { a: 1 },
      }),
    ).toEqual([{ query: { a: 1 }, sort: {} }]);
  });

  test("the rank conditions in the registry are not changed by a read", () => {
    getDashboardWidgetListReadSteps({
      componentType: DashboardComponentType.KubernetesPodList,
      choice: choice("phase", DESC),
      query: { phase: new Includes(["Failed"]) },
    });

    expect(
      getDashboardWidgetListReadSteps({
        componentType: DashboardComponentType.KubernetesPodList,
        choice: choice("phase", DESC),
        query: {},
      }).map(stepPhases)[0],
    ).toEqual({ in: ["Failed"] });
  });
});

describe("reading a list step by step", () => {
  const steps: Array<DashboardWidgetListReadStep> = [
    { query: { rank: 1 }, sort: {} },
    { query: { rank: 2 }, sort: {} },
    { query: { rank: 3 }, sort: {} },
  ];

  test("stops as soon as the list is full, asking each read for what is still wanted", async () => {
    const asked: Array<[number, number]> = [];

    const rows: Array<string> = await readDashboardWidgetListInSteps<string>({
      steps,
      limit: 5,
      read: async (
        step: DashboardWidgetListReadStep,
        limit: number,
      ): Promise<Array<string>> => {
        const rank: number = step.query["rank"] as number;
        asked.push([rank, limit]);
        return [`${rank}a`, `${rank}b`, `${rank}c`].slice(0, limit);
      },
    });

    expect(rows).toEqual(["1a", "1b", "1c", "2a", "2b"]);
    expect(asked).toEqual([
      [1, 5],
      [2, 2],
    ]);
  });

  test("reads every rank when they hold too few rows", async () => {
    const rows: Array<string> = await readDashboardWidgetListInSteps<string>({
      steps,
      limit: 25,
      read: async (
        step: DashboardWidgetListReadStep,
      ): Promise<Array<string>> => {
        return step.query["rank"] === 2 ? [] : [`${step.query["rank"]}`];
      },
    });

    expect(rows).toEqual(["1", "3"]);
  });

  test("never keeps more than the limit, whatever a read returns", async () => {
    const rows: Array<number> = await readDashboardWidgetListInSteps<number>({
      steps,
      limit: 2,
      read: async (): Promise<Array<number>> => {
        return [1, 2, 3, 4];
      },
    });

    expect(rows).toEqual([1, 2]);
  });

  test("reads no further ranks once it is told to stop - a viewer's next click replaced it", async () => {
    const asked: Array<number> = [];
    let isReplaced: boolean = false;

    const rows: Array<string> = await readDashboardWidgetListInSteps<string>({
      steps,
      limit: 25,
      read: async (
        step: DashboardWidgetListReadStep,
      ): Promise<Array<string>> => {
        const rank: number = step.query["rank"] as number;
        asked.push(rank);
        // The click comes while the first rank is being read.
        isReplaced = true;
        return [`${rank}`];
      },
      shouldStop: (): boolean => {
        return isReplaced;
      },
    });

    expect(asked).toEqual([1]);
    expect(rows).toEqual(["1"]);
  });

  test("a read never stopped reads every rank it needs", async () => {
    const asked: Array<number> = [];

    await readDashboardWidgetListInSteps<string>({
      steps,
      limit: 25,
      read: async (
        step: DashboardWidgetListReadStep,
      ): Promise<Array<string>> => {
        asked.push(step.query["rank"] as number);
        return [];
      },
      shouldStop: (): boolean => {
        return false;
      },
    });

    expect(asked).toEqual([1, 2, 3]);
  });
});

describe("a dashboard write's widget sorts", () => {
  function config(components: Array<unknown>): JSONObject {
    return {
      _type: ObjectType.DashboardViewConfig,
      components: components as Array<JSONObject>,
    } as JSONObject;
  }

  test("are saved when each is one its widget can be sorted by, or left out", () => {
    expect(
      getDashboardWidgetSortsProblem(
        config([
          {
            componentType: DashboardComponentType.MonitorList,
            arguments: { sort: "status:desc" },
          },
          {
            componentType: DashboardComponentType.IncidentList,
            arguments: { sort: "severity:asc" },
          },
          {
            componentType: DashboardComponentType.HostList,
            arguments: {},
          },
          { componentType: DashboardComponentType.KubernetesPodList },
          {
            componentType: DashboardComponentType.Table,
            arguments: { sort: "col:7d8a1c2e:desc" },
          },
          {
            componentType: DashboardComponentType.DataSourceTable,
            arguments: { sort: "Total Revenue:asc" },
          },
          {
            componentType: DashboardComponentType.TraceTable,
            arguments: { sort: "p99:desc" },
          },
          // Nothing at all is the widget's own order.
          {
            componentType: DashboardComponentType.MonitorList,
            arguments: { sort: null },
          },
          {
            componentType: DashboardComponentType.MonitorList,
            arguments: { sort: "" },
          },
        ]),
      ),
    ).toBeNull();
  });

  test("are refused when a list widget's sort names no column of its kind, naming the widget and every sort it takes", () => {
    expect(
      getDashboardWidgetSortsProblem(
        config([
          {
            componentType: DashboardComponentType.MonitorList,
            arguments: { sort: "status:desc" },
          },
          {
            componentType: DashboardComponentType.MonitorList,
            arguments: { sort: "severity:desc" },
          },
        ]),
      ),
    ).toBe(
      "dashboardViewConfig.components[1].arguments.sort must be one of name:asc, name:desc, status:asc, status:desc, type:asc or type:desc, or left out for the widget's own order (name:asc).",
    );
  });

  test.each([
    ["a direction that is not asc or desc", "status:sideways"],
    ["no direction", "status"],
    ["a number", 5],
    ["an object", { column: "status", direction: "desc" }],
    ["a database order", "DESC"],
  ])("refuse %s", (_what: string, sort: unknown) => {
    expect(
      getDashboardWidgetSortsProblem(
        config([
          {
            componentType: DashboardComponentType.IncidentList,
            arguments: { sort },
          },
        ]),
      ),
    ).toContain(
      "dashboardViewConfig.components[0].arguments.sort must be one of",
    );
  });

  test("a metric or Data Source table's sort may name any column, but must name a column and a direction", () => {
    expect(
      getDashboardWidgetSortsProblem(
        config([
          {
            componentType: DashboardComponentType.Table,
            arguments: { sort: "descending" },
          },
        ]),
      ),
    ).toBe(
      "dashboardViewConfig.components[0].arguments.sort must be a column and a direction, such as <column>:asc or <column>:desc, or left out for the widget's own order.",
    );

    expect(
      getDashboardWidgetSortsProblem(
        config([
          {
            componentType: DashboardComponentType.DataSourceTable,
            arguments: { sort: 12 },
          },
        ]),
      ),
    ).toContain(
      "components[0].arguments.sort must be a column and a direction",
    );
  });

  test("widgets that do not sort, or that this version does not know, are kept as written", () => {
    expect(
      getDashboardWidgetSortsProblem(
        config([
          {
            componentType: DashboardComponentType.Chart,
            arguments: { sort: "anything" },
          },
          {
            componentType: "SomeNewerWidget",
            arguments: { sort: "x:sideways" },
          },
          "not a widget",
          null,
          { componentType: DashboardComponentType.MonitorList, arguments: [] },
          {
            componentType: DashboardComponentType.MonitorList,
            arguments: "status:sideways",
          },
        ]),
      ),
    ).toBeNull();
  });

  test("reads the widgets wherever the config keeps them, as every reader does", () => {
    const bad: JSONObject = config([
      {
        componentType: DashboardComponentType.MonitorList,
        arguments: { sort: "nope:asc" },
      },
    ]);

    // The widget list written as JSON text.
    expect(
      getDashboardWidgetSortsProblem({
        components: JSON.stringify(bad["components"]),
      } as JSONObject),
    ).toContain("components[0].arguments.sort");
  });

  test("every trace table sort the registry offers is one the server orders by", () => {
    const keys: Array<string> = getDashboardWidgetSortColumns(
      DashboardComponentType.TraceTable,
    ).map((column: DashboardWidgetListSortColumn) => {
      return column.key;
    });

    expect([...keys].sort()).toEqual(
      [
        TRACE_ANALYTICS_TABLE_GROUP_SORT_KEY,
        ...Object.keys(TRACE_ANALYTICS_TABLE_SORT_ALIASES),
      ].sort(),
    );
  });
});

// What Object.prototype holds before any sort is built, to see that none adds to it.
const OBJECT_PROTOTYPE_NAMES: ReadonlyArray<string> =
  Object.getOwnPropertyNames(Object.prototype);

/*
 * A sort and a select are built by writing field paths into objects. Every
 * path is one the registry declares - a request names only a column key -
 * so no path can reach an object's prototype: the registry declares none,
 * a request's column key naming one picks no column, and a path that did
 * would be left out where it is written (CodeQL #2358).
 */
describe("field paths never reach an object's prototype", () => {
  test("a path is written only when every part is a name and none a prototype key", () => {
    for (const path of ["name", "monitorStatus.priority", "a.b.c"]) {
      expect({ path, writable: isWritableSortPath(path) }).toEqual({
        path,
        writable: true,
      });
    }

    for (const path of [
      "__proto__",
      "__proto__.polluted",
      "monitor.constructor.prototype",
      "prototype",
      "",
      "a..b",
      "a.",
    ]) {
      expect({ path, writable: isWritableSortPath(path) }).toEqual({
        path,
        writable: false,
      });
    }
  });

  test("every path the registry declares is writable", () => {
    const unwritable: Array<string> = [];

    for (const componentType of getDashboardWidgetSortComponentTypes()) {
      const spec: DashboardWidgetListSortSpec | null =
        getDashboardWidgetSortSpec(componentType);

      for (const column of spec?.columns || []) {
        for (const field of column.fields || []) {
          if (!isWritableSortPath(field.path)) {
            unwritable.push(`${componentType} ${column.key}: ${field.path}`);
          }
        }
      }

      for (const tieBreak of spec?.thenBy || []) {
        if (!isWritableSortPath(tieBreak.path)) {
          unwritable.push(`${componentType} then by: ${tieBreak.path}`);
        }
      }
    }

    expect(unwritable).toEqual([]);
  });

  test("a request naming a prototype key as its column gets the widget's own order and changes no prototype", () => {
    for (const componentType of getDashboardWidgetSortComponentTypes()) {
      const ownOrder: JSONObject = getDashboardWidgetListSort(
        componentType,
        null,
      );

      for (const column of ["__proto__", "constructor", "prototype"]) {
        const sort: JSONObject = getDashboardWidgetListSort(componentType, {
          column: column,
          direction: DashboardWidgetSortDirection.Descending,
        } as DashboardWidgetSortChoice);

        expect({ componentType, column, sort }).toEqual({
          componentType,
          column,
          sort: ownOrder,
        });
      }
    }

    expect(
      Object.getOwnPropertyNames(Object.prototype).filter(
        (name: string): boolean => {
          return !OBJECT_PROTOTYPE_NAMES.includes(name);
        },
      ),
    ).toEqual([]);
  });
});
