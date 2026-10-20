import {
  DashboardWidgetSortCopy,
  getDashboardWidgetSortDirectionWords,
} from "../../../FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetSortCopy";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  DASHBOARD_WIDGET_SORT_ARGUMENT,
  DashboardWidgetSortChoice,
  DashboardWidgetSortDirection,
  DashboardWidgetSortKind,
  getDashboardWidgetSortFirstDirection,
  parseDashboardWidgetSortChoice,
} from "Common/Types/Dashboard/DashboardWidgetSort";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "Common/Types/Dashboard/DashboardTemplates";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "Common/Types/JSON";
import {
  DashboardWidgetListSortColumn,
  DashboardWidgetListSortSpec,
  KUBERNETES_POD_PHASE_RANKS,
  getDashboardWidgetListSort,
  getDashboardWidgetSortColumns,
  getDashboardWidgetSortComponentTypes,
  getDashboardWidgetSortSpec,
  getDashboardWidgetSortsProblem,
  getDashboardWidgetSortValues,
} from "Common/Utils/Dashboard/DashboardWidgetSorts";
import { getDashboardViewerPickKey } from "Common/UI/Utils/DashboardViewerPicks";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The widgets guide's Sorting lists and tables (issue #5082), and the
 * sharing guide's line on it, held to the product: the header's words
 * (DashboardWidgetSortCopy), each widget kind's sortable columns and the
 * way they order (Common/Utils/Dashboard/DashboardWidgetSorts.ts), the
 * templates' sorts, what a write may hold, and where a viewer's sort is
 * kept. Markdown is not compiled, so a guide that drifts from any of them
 * fails here. Every language's copy is held to the English one by
 * DashboardsDocsTranslations.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, relativePath), "utf8");
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

// The text under a heading (any level), up to the next heading of its level or above.
function sectionOf(page: string, heading: string): string {
  const level: number = heading.indexOf(" ");
  const start: number = page.indexOf(`\n${heading}\n`);

  expect([heading, start >= 0]).toEqual([heading, true]);

  const rest: string = page.slice(start + heading.length + 2);
  const ends: Array<number> = [];

  for (let depth: number = 1; depth <= level; depth++) {
    const end: number = rest.indexOf(`\n${"#".repeat(depth)} `);

    if (end >= 0) {
      ends.push(end);
    }
  }

  return ends.length > 0 ? rest.slice(0, Math.min(...ends)) : rest;
}

const widgets: string = readPage("en/dashboards/widgets.md");
const sorting: string = sectionOf(widgets, "## Sorting lists and tables");
const ownSort: string = sectionOf(widgets, "### Your own sort");
const everyone: string = sectionOf(widgets, "### The order everyone sees");

const KINDS_BY_ROW: Array<[string, DashboardWidgetSortKind]> = [
  ["A status, state or severity", DashboardWidgetSortKind.Status],
  ["A time", DashboardWidgetSortKind.Date],
  ["A number", DashboardWidgetSortKind.Number],
  ["Text", DashboardWidgetSortKind.Text],
];

function reverse(
  direction: DashboardWidgetSortDirection,
): DashboardWidgetSortDirection {
  return direction === DashboardWidgetSortDirection.Ascending
    ? DashboardWidgetSortDirection.Descending
    : DashboardWidgetSortDirection.Ascending;
}

// Every list kind's columns that the database orders by fields.
function allListColumns(): Array<{
  type: DashboardComponentType;
  column: DashboardWidgetListSortColumn;
}> {
  return getDashboardWidgetSortComponentTypes().flatMap(
    (type: DashboardComponentType) => {
      return getDashboardWidgetSortColumns(type).map(
        (column: DashboardWidgetListSortColumn) => {
          return { type, column };
        },
      );
    },
  );
}

describe("Sorting lists and tables, against the header and the registry", () => {
  it("gives each kind of column its first and next click in the header's words", () => {
    for (const [row, kind] of KINDS_BY_ROW) {
      const first: DashboardWidgetSortDirection =
        getDashboardWidgetSortFirstDirection({ key: row, title: row, kind });

      expect(sorting).toContain(
        `| ${row} | ${getDashboardWidgetSortDirectionWords(kind, first)} | ${getDashboardWidgetSortDirectionWords(kind, reverse(first))} |`,
      );
    }
  });

  it("names the only columns that start the other way: an SLO's SLI and error budget, and a guest's VMID", () => {
    const startingTheOtherWay: Array<string> = allListColumns()
      .filter(
        (entry: {
          type: DashboardComponentType;
          column: DashboardWidgetListSortColumn;
        }): boolean => {
          return (
            getDashboardWidgetSortFirstDirection(entry.column) !==
            getDashboardWidgetSortFirstDirection({
              key: entry.column.key,
              title: entry.column.title,
              kind: entry.column.kind,
            })
          );
        },
      )
      .map(
        (entry: {
          type: DashboardComponentType;
          column: DashboardWidgetListSortColumn;
        }): string => {
          return `${entry.type}.${entry.column.key}`;
        },
      )
      .sort();

    expect(startingTheOtherWay).toEqual([
      `${DashboardComponentType.ProxmoxGuestList}.vmid`,
      `${DashboardComponentType.SloList}.errorBudget`,
      `${DashboardComponentType.SloList}.sli`,
    ]);
    expect(sorting).toContain(
      "An SLO's SLI and error budget, and a Proxmox guest's VMID, sort lowest first.",
    );
  });

  it("orders a monitor status by its priority and an incident's or alert's by the project's order", () => {
    const fieldOf: (
      type: DashboardComponentType,
      key: string,
    ) => { path: string; worstFirst: unknown } = (
      type: DashboardComponentType,
      key: string,
    ): { path: string; worstFirst: unknown } => {
      const column: DashboardWidgetListSortColumn | undefined =
        getDashboardWidgetSortColumns(type).find(
          (candidate: DashboardWidgetListSortColumn): boolean => {
            return candidate.key === key;
          },
        );

      return {
        path: column!.fields![0]!.path,
        worstFirst: column!.fields![0]!.whenDescending,
      };
    };

    // Higher priority is worse; a lower place in the project's list is.
    expect(fieldOf(DashboardComponentType.MonitorList, "status")).toEqual({
      path: "currentMonitorStatus.priority",
      worstFirst: SortOrder.Descending,
    });
    for (const [type, severity, state] of [
      [
        DashboardComponentType.IncidentList,
        "incidentSeverity.order",
        "currentIncidentState.order",
      ],
      [
        DashboardComponentType.AlertList,
        "alertSeverity.order",
        "currentAlertState.order",
      ],
    ] as Array<[DashboardComponentType, string, string]>) {
      expect(fieldOf(type, "severity")).toEqual({
        path: severity,
        worstFirst: SortOrder.Ascending,
      });
      expect(fieldOf(type, "state")).toEqual({
        path: state,
        worstFirst: SortOrder.Ascending,
      });
    }

    expect(sorting).toContain(
      "Worst follows your project's own order: a monitor status by its priority, an incident's or alert's severity and state by the order you keep them in, and a resource that is down, not ready or powered off before a healthy one.",
    );
  });

  it("puts down, not-ready and powered-off resources first", () => {
    const flags: Array<string> = allListColumns()
      .filter(
        (entry: {
          type: DashboardComponentType;
          column: DashboardWidgetListSortColumn;
        }): boolean => {
          return (
            entry.column.kind === DashboardWidgetSortKind.Status &&
            Boolean(entry.column.fields) &&
            ["isUp", "isReady", "isPoweredOn"].includes(
              entry.column.fields![0]!.path,
            )
          );
        },
      )
      .map(
        (entry: {
          type: DashboardComponentType;
          column: DashboardWidgetListSortColumn;
        }): string => {
          // false sorts before true: worst first is ascending.
          return `${entry.column.fields![0]!.path}:${entry.column.fields![0]!.whenDescending}`;
        },
      );

    expect(flags.length).toBeGreaterThanOrEqual(6);
    expect(new Set(flags)).toEqual(
      new Set([
        `isUp:${SortOrder.Ascending}`,
        `isReady:${SortOrder.Ascending}`,
        `isPoweredOn:${SortOrder.Ascending}`,
      ]),
    );
  });

  it("gives a pod's phases in the order they are read", () => {
    const phases: Array<string> = KUBERNETES_POD_PHASE_RANKS.map(
      (rank: Array<string>): string => {
        return rank.join(" and ");
      },
    );

    expect(sorting).toContain(
      `A pod's phase sorts ${phases.slice(0, -1).join(", then ")}, then ${phases[phases.length - 1]}.`,
    );
  });

  it("says rows that tie keep the widget's own order: every sort ends with it", () => {
    for (const type of getDashboardWidgetSortComponentTypes()) {
      const spec: DashboardWidgetListSortSpec = getDashboardWidgetSortSpec(
        type,
      ) as DashboardWidgetListSortSpec;

      for (const column of spec.columns) {
        if (!column.fields) {
          continue;
        }

        for (const direction of [
          DashboardWidgetSortDirection.Ascending,
          DashboardWidgetSortDirection.Descending,
        ]) {
          const sort: JSONObject = getDashboardWidgetListSort(type, {
            column: column.key,
            direction,
          });
          const paths: string = JSON.stringify(sort);

          for (const tieBreak of spec.thenBy) {
            const leaf: string = tieBreak.path.split(".").pop() as string;
            expect({ type, column: column.key, tieBreak: tieBreak.path, inSort: paths.includes(`"${leaf}"`) }).toEqual({
              type,
              column: column.key,
              tieBreak: tieBreak.path,
              inSort: true,
            });
          }
        }
      }
    }

    expect(sorting).toContain("Rows that tie keep the widget's own order.");
  });

  it("names a column the list cannot be sorted by: a security event's message", () => {
    expect(
      getDashboardWidgetSortColumns(DashboardComponentType.SecurityEventsList).map(
        (column: DashboardWidgetListSortColumn): string => {
          return column.key;
        },
      ),
    ).not.toContain("message");
    expect(
      readSource(
        "App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSecurityEventsListComponent.tsx",
      ),
    ).toContain('{ label: "Message", widthPct: "30%" },');
    expect(sorting).toContain(
      "A column a list can't be sorted by as a whole, such as a security event's message, has no sort.",
    );
  });

  it("gives the 25 rows a list shows unless its settings say otherwise", () => {
    expect(
      readSource(
        "App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardMonitorListComponent.tsx",
      ),
    ).toContain("props.component.arguments.maxRows || 25");
    expect(sorting).toContain(
      "a list that shows 25 rows, sorted worst first, shows the 25 worst of all of them.",
    );
  });
});

describe("Your own sort and the order everyone sees, against the product", () => {
  it("keeps a viewer's sort per widget, per dashboard, in their browser", () => {
    expect(
      getDashboardViewerPickKey(
        "d1",
        "widget-sort-c1",
      ),
    ).toBe("oneuptime-dashboard-widget-sort-c1:d1");
    expect(ownSort).toContain(
      "your browser remembers it for that widget on that dashboard",
    );
  });

  it("names the setting and the preview as the settings dialog draws them", () => {
    expect(DashboardWidgetSortCopy.settingLabel).toBe("Sort");
    expect(
      readSource(
        "App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ComponentSettingsModal.tsx",
      ),
    ).toContain('translator.translateText("Live Preview")');
    expect(
      readSource(
        "App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar.tsx",
      ),
    ).toContain('translator.translateText("Save Changes")');

    expect(everyone).toContain(
      `pick the order under **${DashboardWidgetSortCopy.settingLabel}**, or click a column header in its **Live Preview**, then click **Save Changes**.`,
    );
  });

  it("lists the template lists that open worst first, and only those", () => {
    const sorted: Array<string> = [];

    for (const type of Object.values(DashboardTemplateType)) {
      const config: DashboardViewConfig | null = getTemplateConfig(type);

      for (const widget of config?.components || []) {
        const sort: DashboardWidgetSortChoice | null =
          parseDashboardWidgetSortChoice(
            ((widget as DashboardBaseComponent).arguments as JSONObject)[
              DASHBOARD_WIDGET_SORT_ARGUMENT
            ],
          );

        if (!sort) {
          continue;
        }

        const column: DashboardWidgetListSortColumn | undefined =
          getDashboardWidgetSortColumns(widget.componentType).find(
            (candidate: DashboardWidgetListSortColumn): boolean => {
              return candidate.key === sort.column;
            },
          );

        // Worst first: a status column's first way.
        expect({
          widget: widget.componentType,
          kind: column?.kind,
          direction: sort.direction,
        }).toEqual({
          widget: widget.componentType,
          kind: DashboardWidgetSortKind.Status,
          direction: DashboardWidgetSortDirection.Descending,
        });

        sorted.push(widget.componentType);
      }
    }

    expect([...new Set(sorted)].sort()).toEqual(
      [
        DashboardComponentType.HostList,
        DashboardComponentType.KubernetesNodeList,
        DashboardComponentType.ProxmoxNodeList,
        DashboardComponentType.DockerSwarmNodeList,
        DashboardComponentType.KubernetesPodList,
        DashboardComponentType.DockerSwarmServiceList,
        // The network devices list.
        DashboardComponentType.MonitorList,
      ].sort(),
    );
    expect(everyone).toContain(
      "The dashboard templates open their lists of hosts, nodes, pods, Swarm services and network devices worst first.",
    );
  });

  it("names the API's field, with an example the server saves, and says a column a list lacks is refused", () => {
    const config: (sort: string) => JSONObject = (sort: string): JSONObject => {
      return {
        _type: ObjectType.DashboardViewConfig,
        components: [
          {
            _type: ObjectType.DashboardComponent,
            componentType: DashboardComponentType.MonitorList,
            componentId: "c1",
            arguments: { [DASHBOARD_WIDGET_SORT_ARGUMENT]: sort },
          },
        ],
      } as unknown as JSONObject;
    };

    expect(DASHBOARD_WIDGET_SORT_ARGUMENT).toBe("sort");
    expect(getDashboardWidgetSortsProblem(config("status:desc"))).toBeNull();

    const problem: string | null = getDashboardWidgetSortsProblem(
      config("uptime:desc"),
    );
    expect(problem).not.toBeNull();
    for (const value of getDashboardWidgetSortValues(
      DashboardComponentType.MonitorList,
    )) {
      expect(problem).toContain(value);
    }

    expect(everyone).toContain(
      "Through the API and Terraform, the order is the widget's `arguments.sort`: a column and a direction, such as `status:desc`. A list widget refuses a column it doesn't have, and the error lists the sorts it has.",
    );
  });
});

describe("the sharing guide's line on a public dashboard's sorts", () => {
  it("says visitors sort too, each in their own browser, by the widget's own columns", () => {
    const route: string = readSource("Common/Server/API/DashboardAPI.ts");

    // The public route reads only the viewer's pick, held to the widget's columns.
    expect(route).toContain("req.body[DASHBOARD_WIDGET_SORT_REQUEST_FIELD]");
    expect(
      readSource(
        "Common/Server/Utils/Dashboard/PublicDashboardResourceListPolicy.ts",
      ),
    ).toContain("getDashboardWidgetSortColumns");

    expect(readPage("en/dashboards/sharing.md")).toContain(
      "- Lets visitors [sort its lists and tables](/docs/dashboards/widgets#sorting-lists-and-tables) by clicking a column header, as your team does. Each visitor's browser remembers their own sort, and OneUptime sorts the whole list itself, only ever by one of the widget's own columns.",
    );
  });
});
