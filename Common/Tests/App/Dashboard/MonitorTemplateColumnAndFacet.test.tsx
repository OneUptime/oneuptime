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
};

type CapturedColumn = {
  title: string;
  field?: Record<string, unknown> | undefined;
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
