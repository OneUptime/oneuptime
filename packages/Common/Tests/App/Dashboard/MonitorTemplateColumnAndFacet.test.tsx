import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Issue #3491: the monitor list had no way to see or filter which template a
 * monitor came from, so "which monitors did that template edit just change?"
 * could only be answered by opening monitors one at a time — which does not
 * survive a fleet of thousands sharing one template.
 *
 * The fix is a Template column and a Template chip on MonitorTable, and both
 * fail invisibly:
 *
 *  - a column whose `field` stops asking for the relation renders a blank cell
 *    on every row, exactly like a project with no templates;
 *  - a chip whose `queryField` stops naming the foreign key lights up over a
 *    list it is not filtering;
 *  - and on the template page's own Linked Monitors table — the same component,
 *    scoped by `monitorTemplateId` — a chip would OVERWRITE that scope rather
 *    than narrow it, because the facet bar merges everything into one query
 *    object, so the page would list another template's monitors under this
 *    template's heading.
 *
 * These render the real MonitorTable and read the column set and facet list it
 * actually hands downstream, rather than reading its source.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
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

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return false;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

type CapturedTableProps = {
  columns?: Array<CapturedColumn> | undefined;
  query?: Record<string, unknown> | undefined;
  userPreferencesKey?: string | undefined;
  disableColumnCustomization?: boolean | undefined;
};

type CapturedColumn = {
  title: string;
  field?: Record<string, unknown> | undefined;
  isHiddenByDefault?: boolean | undefined;
  isNotCustomizable?: boolean | undefined;
  hideOnMobile?: boolean | undefined;
  disableCsvExport?: boolean | undefined;
  getElement?: ((item: Monitor) => ReactElement) | undefined;
  getExportValue?: ((item: Monitor) => string) | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

type CapturedHookOptions = {
  extraFacets?: Array<ResourceFacet> | undefined;
};

let capturedHookOptions: CapturedHookOptions | null = null;

/*
 * The hook is replaced rather than run: the real one fetches owners, labels and
 * every chip's options over the network on mount. Its named exports stay real,
 * because MonitorTable builds its other chips out of them.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      default: (options: CapturedHookOptions) => {
        capturedHookOptions = options;

        return {
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {
            // no-op
          },
          filterBar: null,
          mergeFiltersIntoQuery: (
            base: Record<string, unknown> | undefined,
          ) => {
            return base || {};
          },
          facetSaveState: {},
          restoreFacetState: () => {
            // no-op
          },
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

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: async () => {
        return [];
      },
    },
  };
});

import MonitorTable from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable";
import {
  MONITOR_TEMPLATE_FACET_KEY,
  MONITOR_TEMPLATE_FACET_QUERY_FIELD,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorFacets";
import { ResourceFacet } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import Columns from "../../../UI/Components/ModelTable/Columns";
import {
  ColumnPreference,
  CustomizableColumn,
  applyColumnPreference,
  getColumnBaseId,
  getColumnIds,
  getCustomizableColumns,
} from "../../../UI/Components/ModelTable/ColumnPreference";
import Column from "../../../UI/Components/ModelTable/Column";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = ObjectID.generate();
const TEMPLATE_ID: ObjectID = ObjectID.generate();

type RenderTableFunction = (
  query: Record<string, unknown>,
) => Promise<CapturedTableProps>;

const renderTable: RenderTableFunction = async (
  query: Record<string, unknown>,
): Promise<CapturedTableProps> => {
  render(
    <MemoryRouter>
      <MonitorTable query={query as never} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedTableProps).not.toBeNull();
  });

  return capturedTableProps!;
};

type ColumnTitledFunction = (title: string) => CapturedColumn | undefined;

const columnTitled: ColumnTitledFunction = (
  title: string,
): CapturedColumn | undefined => {
  return (capturedTableProps?.columns || []).find(
    (column: CapturedColumn): boolean => {
      return column.title === title;
    },
  );
};

type FacetKeyedFunction = (key: string) => ResourceFacet | undefined;

const facetKeyed: FacetKeyedFunction = (
  key: string,
): ResourceFacet | undefined => {
  return (capturedHookOptions?.extraFacets || []).find(
    (facet: ResourceFacet): boolean => {
      return facet.key === key;
    },
  );
};

type MonitorWithTemplateFunction = (
  templateName: string | undefined,
) => Monitor;

const monitorWithTemplate: MonitorWithTemplateFunction = (
  templateName: string | undefined,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor.name = "core-switch-01";

  if (templateName) {
    const template: MonitorTemplate = new MonitorTemplate();
    template._id = TEMPLATE_ID.toString();
    template.templateName = templateName;
    monitor.monitorTemplate = template;
  }

  return monitor;
};

beforeEach(() => {
  capturedTableProps = null;
  capturedHookOptions = null;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

  /*
   * The table builds its row link off the current route. In the app the router
   * pushes this in; under test nothing does.
   */
  Navigation.setLocation({
    pathname: `/dashboard/${PROJECT_ID.toString()}/monitors`,
  } as unknown as Parameters<typeof Navigation.setLocation>[0]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Template column on the monitor list", () => {
  test("is one of the table's columns", async () => {
    await renderTable({ projectId: PROJECT_ID });

    expect(columnTitled("Template")).toBeDefined();
  });

  /*
   * Both keys, and through the relation. `templateName` is the label the cell
   * prints; `_id` is what makes it a link to the template — which is the reason
   * to look at the column at all, since the next thing a user does is go and
   * read what the template now says.
   */
  test("asks for the template's name and id through the relation", async () => {
    await renderTable({ projectId: PROJECT_ID });

    expect(columnTitled("Template")!.field).toEqual({
      monitorTemplate: {
        _id: true,
        templateName: true,
      },
    });
  });

  test("renders the template's name, linked to the template", async () => {
    await renderTable({ projectId: PROJECT_ID });

    render(
      <MemoryRouter>
        {columnTitled("Template")!.getElement!(
          monitorWithTemplate("Production API Health"),
        )}
      </MemoryRouter>,
    );

    const link: HTMLElement = screen.getByText("Production API Health");

    expect(link).toBeInTheDocument();
    expect(link.closest("a")?.getAttribute("href")).toContain(
      TEMPLATE_ID.toString(),
    );
    expect(link.closest("a")?.getAttribute("href")).toContain(
      "settings/templates",
    );
  });

  /*
   * Most monitors are not created from a template, so the empty case is the
   * common one and has to read as "no template" rather than as a value that
   * failed to load.
   */
  test("renders a dash when the monitor came from no template", async () => {
    await renderTable({ projectId: PROJECT_ID });

    render(
      <MemoryRouter>
        {columnTitled("Template")!.getElement!(monitorWithTemplate(undefined))}
      </MemoryRouter>,
    );

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  /*
   * "Export the list and diff it" is exactly what an admin does after a
   * template change, and a cell rendered through getElement contributes nothing
   * usable to the CSV on its own.
   */
  test("exports the template name, and an empty cell when there is none", async () => {
    await renderTable({ projectId: PROJECT_ID });

    const column: CapturedColumn = columnTitled("Template")!;

    expect(column.getExportValue!(monitorWithTemplate("Edge Ping"))).toBe(
      "Edge Ping",
    );
    expect(column.getExportValue!(monitorWithTemplate(undefined))).toBe("");
  });
});

/*
 * Issue #3491 shipped the column switched on, which put a stripe of "—" down
 * the middle of every monitor list: most monitors are not created from a
 * template, and the ones that are still only need the answer occasionally.
 * It is now off by default and turned on from the Customize Columns picker.
 * "Hidden" and "reachable" have to hold together — a column hidden on a table
 * with no picker is a column nobody can get back — so these run the real
 * ColumnPreference rules over the column set the table actually declares,
 * rather than reading the flag on its own.
 */
describe("the Template column's place in a first-time viewer's table", () => {
  type DeclaredColumnsFunction = () => Columns<Monitor>;

  const declaredColumns: DeclaredColumnsFunction = (): Columns<Monitor> => {
    return (capturedTableProps?.columns || []) as unknown as Columns<Monitor>;
  };

  type TemplateColumnIdFunction = () => string;

  const templateColumnId: TemplateColumnIdFunction = (): string => {
    const columns: Columns<Monitor> = declaredColumns();

    const index: number = columns.findIndex((column: { title: string }) => {
      return column.title === "Template";
    });

    return getColumnIds<Monitor>(columns)[index] as string;
  };

  type VisibleTitlesFunction = (
    preference: ColumnPreference | null,
  ) => Array<string>;

  const visibleTitles: VisibleTitlesFunction = (
    preference: ColumnPreference | null,
  ): Array<string> => {
    return applyColumnPreference<Monitor>({
      columns: declaredColumns(),
      preference,
    }).map((column: { title: string }) => {
      return column.title;
    });
  };

  /*
   * The flag only means something if the table persists a layout: without a
   * `userPreferencesKey` the picker is never rendered (see
   * BaseModelTable.isColumnCustomizationEnabled), so a hidden-by-default
   * column would be a column nobody could ever get back.
   */
  test("is switchable back on, because the table has a column picker", async () => {
    const props: CapturedTableProps = await renderTable({
      projectId: PROJECT_ID,
    });

    expect(props.userPreferencesKey).toBeTruthy();
    expect(props.disableColumnCustomization).toBeFalsy();
    expect(columnTitled("Template")!.isNotCustomizable).toBeFalsy();
  });

  test("is not rendered for a viewer with no stored layout", async () => {
    await renderTable({ projectId: PROJECT_ID });

    const titles: Array<string> = visibleTitles(null);

    expect(titles).not.toContain("Template");
    // Not because the table came back empty.
    expect(titles).toContain("Name");
    expect(titles).toContain("Monitor Status");
    expect(titles).toContain("Labels");
  });

  test("is offered by the picker, switched off", async () => {
    await renderTable({ projectId: PROJECT_ID });

    const entry: CustomizableColumn<Monitor> | undefined =
      getCustomizableColumns<Monitor>({
        columns: declaredColumns(),
        preference: null,
      }).find((candidate: CustomizableColumn<Monitor>) => {
        return candidate.column.title === "Template";
      });

    expect(entry).toBeDefined();
    expect(entry!.isVisible).toBe(false);
    expect(entry!.isPinned).toBe(false);
    /*
     * Off, not gone: the picker must not offer to remove a column the table
     * ships, because nothing would put it back.
     */
    expect(entry!.isRemovable).toBe(false);
  });

  test("stays on for a viewer who already switched it on", async () => {
    await renderTable({ projectId: PROJECT_ID });

    const preference: ColumnPreference = {
      order: [templateColumnId()],
      hidden: [],
    };

    expect(visibleTitles(preference)).toContain("Template");
  });

  /*
   * The id a viewer's "switch Template on" is stored under is the column's
   * first field key, and getColumnIds breaks ties on that key with a title
   * slug and then a POSITIONAL suffix. So the day someone adds a second column
   * keyed on `monitorTemplate` - a "Template Version" column is entirely
   * plausible - this column's persisted id changes under everyone who had it
   * on, their stored entry stops matching, and the column falls back to its
   * declared default, which is now off. Nobody would report that as a bug;
   * they would just never see the column again.
   */
  test("has an id no other column competes for, so a stored layout keeps meaning it", async () => {
    await renderTable({ projectId: PROJECT_ID });

    const columns: Columns<Monitor> = declaredColumns();
    const ids: Array<string> = getColumnIds<Monitor>(columns);

    const baseIds: Array<string> = columns.map((column: Column<Monitor>) => {
      return getColumnBaseId<Monitor>(column);
    });

    // Nothing had to be disambiguated, so no id depends on declaration order.
    expect(ids).toEqual(baseIds);

    expect(
      ids.filter((id: string) => {
        return id === templateColumnId();
      }),
    ).toHaveLength(1);

    /*
     * Titles are the first tie-breaker, so two columns sharing one would push
     * the tie down to position - and the picker would show the viewer two rows
     * they cannot tell apart either.
     */
    const titles: Array<string> = columns.map((column: Column<Monitor>) => {
      return column.title;
    });

    expect(new Set(titles).size).toBe(titles.length);
  });

  /*
   * The upgrade path almost every real viewer takes: they arranged this table
   * before the Template column existed, so their stored `order` simply has no
   * entry for it and it has to stay off rather than appear uninvited. The
   * generic rule is pinned in ColumnPreference's own tests; this pins it
   * against the ids MonitorTable actually declares, so that giving the column
   * an explicit `id` - which those generic tests would not notice - cannot
   * quietly change what an existing layout resolves to.
   */
  test("stays off for a viewer whose layout predates the column", async () => {
    await renderTable({ projectId: PROJECT_ID });

    const templateId: string = templateColumnId();

    const preference: ColumnPreference = {
      order: getColumnIds<Monitor>(declaredColumns()).filter((id: string) => {
        return id !== templateId;
      }),
      hidden: [],
    };

    const titles: Array<string> = visibleTitles(preference);

    expect(titles).not.toContain("Template");
    // The rest of their arrangement survived, so this is not an empty result.
    expect(titles).toContain("Name");
    expect(titles).toContain("Labels");
  });

  /*
   * `hideOnMobile` is enforced at render (Table/TableHeader and Table/TableRow
   * drop the column outright) while the picker knows nothing about it, so a
   * column carrying both flags is a dead control on a phone: the viewer ticks
   * it, the shown-columns count goes up, and no column arrives. For a column
   * that is hidden by default that is also a one-way door, since the picker is
   * the only route back. Stated over the whole set so the next author cannot
   * reintroduce the pair on a different column.
   */
  test("no column the picker can switch on is one the phone would throw away", async () => {
    await renderTable({ projectId: PROJECT_ID });

    const columns: Columns<Monitor> = declaredColumns();

    /*
     * An invariant over an empty set holds for the wrong reason, and this one
     * is read off captured props - so prove the column it exists for is in
     * there before believing the result.
     */
    expect(
      columns.map((column: Column<Monitor>) => {
        return column.title;
      }),
    ).toContain("Template");

    const unreachable: Array<string> = columns
      .filter((column: Column<Monitor>) => {
        return (
          Boolean(column.isHiddenByDefault) && Boolean(column.hideOnMobile)
        );
      })
      .map((column: Column<Monitor>) => {
        return column.title;
      });

    expect(unreachable).toEqual([]);
  });

  /*
   * The default monitors CSV no longer carries a Template column, and it
   * matters *why*: exports follow what is on screen (BaseModelTable attaches
   * export keys only while walking the columns it is about to render), so the
   * column leaves the CSV purely by being switched off, and comes back the
   * moment the viewer switches it on. Someone chasing "the export lost the
   * template" could reach for `disableCsvExport` or teach the exporter about
   * visibility; both would break the column for the viewers who did switch it
   * on. This records which lever is the real one.
   */
  test("does not opt out of the CSV", async () => {
    await renderTable({ projectId: PROJECT_ID });

    expect(columnTitled("Template")!.disableCsvExport).toBeFalsy();
  });
});

describe("the Template chip in the monitor list's filter bar", () => {
  test("is one of the chips the bar is given", async () => {
    await renderTable({ projectId: PROJECT_ID });

    expect(facetKeyed(MONITOR_TEMPLATE_FACET_KEY)).toBeDefined();
    expect(facetKeyed(MONITOR_TEMPLATE_FACET_KEY)!.label).toBe("Template");
  });

  /*
   * The foreign key, not the relation. "is empty" is only answerable of the
   * column — a monitor from no template has no template row to join against —
   * and the same field is what the template page scopes its own table by.
   */
  test("filters the monitor's template foreign key", async () => {
    await renderTable({ projectId: PROJECT_ID });

    expect(facetKeyed(MONITOR_TEMPLATE_FACET_KEY)!.queryField).toBe(
      MONITOR_TEMPLATE_FACET_QUERY_FIELD,
    );
    expect(MONITOR_TEMPLATE_FACET_QUERY_FIELD).toBe("monitorTemplateId");
  });

  test("turns a picked template into an id filter", async () => {
    await renderTable({ projectId: PROJECT_ID });

    const value: unknown = facetKeyed(MONITOR_TEMPLATE_FACET_KEY)!
      .toQueryValue!([TEMPLATE_ID.toString()], "is");

    expect(value).toBeInstanceOf(Includes);
    expect(((value as Includes).values as Array<ObjectID>)[0]!.toString()).toBe(
      TEMPLATE_ID.toString(),
    );
  });

  test("turns 'is empty' into the monitors that came from no template", async () => {
    await renderTable({ projectId: PROJECT_ID });

    expect(
      facetKeyed(MONITOR_TEMPLATE_FACET_KEY)!.toQueryValue!([], "is_empty"),
    ).toBeInstanceOf(IsNull);
  });

  test("offers the empty operators, which is how that is asked for", async () => {
    await renderTable({ projectId: PROJECT_ID });

    expect(facetKeyed(MONITOR_TEMPLATE_FACET_KEY)!.supportedOperators).toEqual([
      "is",
      "is_not",
      "is_empty",
      "is_not_empty",
    ]);
  });

  /*
   * A project can hold any number of templates, so the options have to be
   * searched server-side, and a selection restored from a shared link has to be
   * resolvable to a label even when it is not on the first page of results.
   */
  test("searches its options on the server and resolves restored ones", async () => {
    await renderTable({ projectId: PROJECT_ID });

    expect(typeof facetKeyed(MONITOR_TEMPLATE_FACET_KEY)!.loadOptions).toBe(
      "function",
    );
    expect(typeof facetKeyed(MONITOR_TEMPLATE_FACET_KEY)!.resolveOptions).toBe(
      "function",
    );
  });

  /*
   * BaseModelTable builds its request as `{...props.query, ...columnFilterQuery}`,
   * so a column-filter popup over the chip's field would replace the chip's
   * constraint outright, silently, while the chip carried on claiming to apply.
   */
  test("no column filter competes with it for the same field", async () => {
    const props: CapturedTableProps & {
      filters?: Array<{ field?: Record<string, unknown> }>;
    } = (await renderTable({ projectId: PROJECT_ID })) as CapturedTableProps & {
      filters?: Array<{ field?: Record<string, unknown> }>;
    };

    for (const filter of props.filters || []) {
      expect(Object.keys(filter.field || {})).not.toContain(
        MONITOR_TEMPLATE_FACET_QUERY_FIELD,
      );
      expect(Object.keys(filter.field || {})).not.toContain("monitorTemplate");
    }
  });
});

describe("the same table scoped to one template", () => {
  /*
   * The template page's Linked Monitors card. A chip here would overwrite the
   * page's own scope rather than narrow it, and the column would repeat one
   * value down every row.
   */
  test("shows no Template chip", async () => {
    await renderTable({
      projectId: PROJECT_ID,
      monitorTemplateId: TEMPLATE_ID,
    });

    expect(facetKeyed(MONITOR_TEMPLATE_FACET_KEY)).toBeUndefined();
  });

  test("shows no Template column", async () => {
    await renderTable({
      projectId: PROJECT_ID,
      monitorTemplateId: TEMPLATE_ID,
    });

    expect(columnTitled("Template")).toBeUndefined();
  });

  /*
   * Guards the two above from passing because the table rendered nothing at
   * all: the rest of its columns and chips have to still be there.
   */
  test("keeps every other column and chip", async () => {
    await renderTable({
      projectId: PROJECT_ID,
      monitorTemplateId: TEMPLATE_ID,
    });

    expect(columnTitled("Name")).toBeDefined();
    expect(columnTitled("Monitor Status")).toBeDefined();
    expect(columnTitled("Labels")).toBeDefined();
    expect(facetKeyed("currentMonitorStatus")).toBeDefined();
    expect(facetKeyed("monitorType")).toBeDefined();
  });
});

/*
 * The two tables above are the same component with different column sets, and
 * a saved layout records only the columns the picker was showing. Put those
 * two facts together over one shared storage key and the template page becomes
 * a trap: a viewer who tidies the Linked Monitors table writes a layout with
 * no "monitorTemplate" entry in either `order` or `hidden`, and back on the
 * monitors list a column named in neither list falls back to its declared
 * default - which is now hidden. Their earlier "switch Template on" is gone,
 * with no action that looks like it touched the monitors list.
 *
 * ModelTable is stubbed here, so no Save can be driven; what can be pinned is
 * the precondition, and the precondition is what has to stay false.
 */
describe("the layout key each monitor table saves under", () => {
  type ColumnIdsOfFunction = (props: CapturedTableProps) => Array<string>;

  const columnIdsOf: ColumnIdsOfFunction = (
    props: CapturedTableProps,
  ): Array<string> => {
    return getColumnIds<Monitor>(
      (props.columns || []) as unknown as Columns<Monitor>,
    );
  };

  test("cannot let the template page overwrite the monitor list's layout", async () => {
    const unscoped: CapturedTableProps = await renderTable({
      projectId: PROJECT_ID,
    });

    const unscopedKey: string | undefined = unscoped.userPreferencesKey;
    const unscopedIds: Array<string> = columnIdsOf(unscoped);

    /*
     * A second render rather than a rerender: the two pages mount the table
     * independently, and a stale capture would make this test agree with
     * itself.
     */
    cleanup();
    capturedTableProps = null;

    const scoped: CapturedTableProps = await renderTable({
      projectId: PROJECT_ID,
      monitorTemplateId: TEMPLATE_ID,
    });

    const scopedKey: string | undefined = scoped.userPreferencesKey;
    const scopedIds: Array<string> = columnIdsOf(scoped);

    /*
     * The invariant, stated so that either fix satisfies it: keep the two
     * tables on separate keys, or make them offer the same columns. Only
     * "shared key AND different columns" loses a viewer's choice.
     */
    const sharesKey: boolean = unscopedKey === scopedKey;
    const offersSameColumns: boolean =
      [...unscopedIds].sort().join(",") === [...scopedIds].sort().join(",");

    expect(sharesKey && !offersSameColumns).toBe(false);

    /*
     * And the arrangement that satisfies it today, recorded so a rename of
     * either key is a deliberate act - changing the unscoped key silently
     * resets every existing viewer's monitor list layout.
     */
    expect(unscopedKey).toBe("monitors-table");
    expect(scopedKey).toBe("monitor-template-monitors-table");

    // The half of the invariant that is genuinely false, so it is the keys doing the work.
    expect(unscopedIds).toContain("monitorTemplate");
    expect(scopedIds).not.toContain("monitorTemplate");
  });
});
