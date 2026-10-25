import "@testing-library/jest-dom";
import { cleanup, render, waitFor } from "@testing-library/react";
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
 * "We dont need to show these column in vmware: Can you please remove them
 * from the default view" - the maintainer, of the Collected By and Agent
 * Version columns on VMware > All vCenters.
 *
 * The list now opens on the columns every infrastructure list opens on -
 * Name, Status, Last Seen, Labels and Owners. The two columns are not gone:
 * they start hidden, and the table's Customize Columns turns either back on,
 * on a laptop and on a phone. How one vCenter is collected, and its agent's
 * version, stay on the vCenter's own pages.
 *
 * These render the real page, read the column set it hands ModelTable, and
 * run the real ColumnPreference rules over it, so "hidden" and "reachable"
 * are proved together, the way a viewer meets them. The table itself, with
 * its picker, is rendered in VMwareVCentersListColumnPicker.test.tsx.
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

type CapturedColumn = {
  title: string;
  field?: Record<string, unknown> | undefined;
  isHiddenByDefault?: boolean | undefined;
  isNotCustomizable?: boolean | undefined;
  isRemovable?: boolean | undefined;
  hideOnMobile?: boolean | undefined;
  disableCsvExport?: boolean | undefined;
  getElement?: ((item: VMwareVCenter) => ReactElement) | undefined;
};

type CapturedTableProps = {
  id?: string | undefined;
  columns?: Array<CapturedColumn> | undefined;
  userPreferencesKey?: string | undefined;
  disableColumnCustomization?: boolean | undefined;
  selectMoreFields?: Record<string, unknown> | undefined;
  query?: Record<string, unknown> | undefined;
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

/*
 * The hook is replaced rather than run: the real one fetches owners, labels
 * and every chip's options on mount. Its named exports stay real, because
 * the page builds its Status chip out of them.
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
      default: () => {
        return {
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {
            // no-op
          },
          filterBar: null,
          emptyState: undefined,
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

// A project that has vCenters: the list, not its first run.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/UseFirstRecordWatch",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {
          count: 2,
          isLoading: false,
          error: "",
          refreshToken: "0",
          onRecordCreated: () => {
            // no-op
          },
          retry: () => {
            // no-op
          },
        };
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

jest.mock("../../../UI/Components/BulkUpdate/BulkArchiveActions", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        archiveRowActions: [],
        unarchiveRowActions: [],
        archiveBulkActions: [],
        unarchiveBulkActions: [],
      };
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

import VCentersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/VCenters";
import ArchivedVCentersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Archived";
import { VMWARE_AGENT_VERSION } from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Columns from "../../../UI/Components/ModelTable/Columns";
import Column from "../../../UI/Components/ModelTable/Column";
import {
  ColumnPreference,
  CustomizableColumn,
  applyColumnPreference,
  buildColumnPreference,
  getColumnBaseId,
  getColumnIds,
  getCustomizableColumns,
} from "../../../UI/Components/ModelTable/ColumnPreference";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import Probe from "../../../Models/DatabaseModels/Probe";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import VMwareCollectionMethod from "../../../Types/VMware/VMwareCollectionMethod";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = ObjectID.generate();

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID.toString()}/vmware`),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

// What a first-time viewer of the list sees, in order.
const DEFAULT_TITLES: Array<string> = [
  "Name",
  "Status",
  "Last Seen",
  "Labels",
  "Owners",
];

// The two the maintainer asked to take out of the default view.
const HIDDEN_TITLES: Array<string> = ["Collected By", "Agent Version"];

type PageComponent = (props: PageComponentProps) => ReactElement | null;

type RenderListFunction = (page?: PageComponent) => Promise<CapturedTableProps>;

const renderList: RenderListFunction = async (
  page: PageComponent = VCentersPage as unknown as PageComponent,
): Promise<CapturedTableProps> => {
  const Page: PageComponent = page;

  render(
    <MemoryRouter>
      <Page {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedTableProps).not.toBeNull();
  });

  return capturedTableProps!;
};

type DeclaredColumnsFunction = () => Columns<VMwareVCenter>;

const declaredColumns: DeclaredColumnsFunction = (): Columns<VMwareVCenter> => {
  return (capturedTableProps?.columns ||
    []) as unknown as Columns<VMwareVCenter>;
};

type ColumnTitledFunction = (title: string) => CapturedColumn;

const columnTitled: ColumnTitledFunction = (title: string): CapturedColumn => {
  const column: CapturedColumn | undefined = (
    capturedTableProps?.columns || []
  ).find((candidate: CapturedColumn): boolean => {
    return candidate.title === title;
  });

  if (!column) {
    throw new Error(`The vCenters list declares no "${title}" column.`);
  }

  return column;
};

type ColumnIdFunction = (title: string) => string;

// The id a viewer's layout stores this column under.
const columnId: ColumnIdFunction = (title: string): string => {
  const columns: Columns<VMwareVCenter> = declaredColumns();
  const index: number = columns.findIndex(
    (column: Column<VMwareVCenter>): boolean => {
      return column.title === title;
    },
  );

  expect(index).toBeGreaterThan(-1);

  return getColumnIds<VMwareVCenter>(columns)[index] as string;
};

type VisibleTitlesFunction = (
  preference: ColumnPreference | null,
) => Array<string>;

// What the table draws for a viewer with this stored layout.
const visibleTitles: VisibleTitlesFunction = (
  preference: ColumnPreference | null,
): Array<string> => {
  return applyColumnPreference<VMwareVCenter>({
    columns: declaredColumns(),
    preference,
  }).map((column: Column<VMwareVCenter>): string => {
    return column.title;
  });
};

type PhoneTitlesFunction = (
  preference: ColumnPreference | null,
) => Array<string>;

/*
 * What a phone's card draws: the same layout, less the hideOnMobile columns,
 * which Table/TableRow drops at render.
 */
const phoneTitles: PhoneTitlesFunction = (
  preference: ColumnPreference | null,
): Array<string> => {
  return applyColumnPreference<VMwareVCenter>({
    columns: declaredColumns(),
    preference,
  })
    .filter((column: Column<VMwareVCenter>): boolean => {
      return !column.hideOnMobile;
    })
    .map((column: Column<VMwareVCenter>): string => {
      return column.title;
    });
};

type PickerEntryFunction = (
  title: string,
  preference?: ColumnPreference | null,
) => CustomizableColumn<VMwareVCenter>;

// The picker's row for a column.
const pickerEntry: PickerEntryFunction = (
  title: string,
  preference: ColumnPreference | null = null,
): CustomizableColumn<VMwareVCenter> => {
  const entry: CustomizableColumn<VMwareVCenter> | undefined =
    getCustomizableColumns<VMwareVCenter>({
      columns: declaredColumns(),
      preference,
    }).find((candidate: CustomizableColumn<VMwareVCenter>): boolean => {
      return candidate.column.title === title;
    });

  if (!entry) {
    throw new Error(`The picker offers no "${title}" column.`);
  }

  return entry;
};

type VCenterFunction = (values: {
  collectionMethod?: VMwareCollectionMethod | undefined;
  probeName?: string | undefined;
  agentVersion?: string | undefined;
}) => VMwareVCenter;

const vcenter: VCenterFunction = (values: {
  collectionMethod?: VMwareCollectionMethod | undefined;
  probeName?: string | undefined;
  agentVersion?: string | undefined;
}): VMwareVCenter => {
  const item: VMwareVCenter = new VMwareVCenter();
  item._id = ObjectID.generate().toString();
  item.name = "vcenter-lab";

  if (values.collectionMethod) {
    item.collectionMethod = values.collectionMethod;
  }

  if (values.probeName) {
    const probe: Probe = new Probe();
    probe.name = values.probeName;
    item.collectionProbe = probe;
  }

  if (values.agentVersion) {
    item.agentVersion = values.agentVersion;
  }

  return item;
};

type CellFunction = (title: string, item: VMwareVCenter) => HTMLElement;

// Draws one cell of a column, as the table would once it is switched on.
const cell: CellFunction = (
  title: string,
  item: VMwareVCenter,
): HTMLElement => {
  const getElement: ((item: VMwareVCenter) => ReactElement) | undefined =
    columnTitled(title).getElement;

  expect(getElement).toBeDefined();

  const { container } = render(
    <MemoryRouter>
      <div data-testid="cell">{getElement!(item)}</div>
    </MemoryRouter>,
  );

  return container.querySelector('[data-testid="cell"]') as HTMLElement;
};

beforeEach(() => {
  capturedTableProps = null;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

  /*
   * The table builds its row links off the current route. In the app the
   * router pushes this in; under test nothing does.
   */
  Navigation.setLocation({
    pathname: `/dashboard/${PROJECT_ID.toString()}/vmware`,
  } as unknown as Parameters<typeof Navigation.setLocation>[0]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("All vCenters, as a viewer first opens it", () => {
  test("opens on Name, Status, Last Seen, Labels and Owners", async () => {
    await renderList();

    expect(visibleTitles(null)).toEqual(DEFAULT_TITLES);
  });

  test.each(HIDDEN_TITLES)(
    "%s is still one of the list's columns, hidden by default",
    async (title: string) => {
      await renderList();

      expect(columnTitled(title).isHiddenByDefault).toBe(true);
      expect(visibleTitles(null)).not.toContain(title);
    },
  );

  /*
   * Only these two: hiding a column people do read (Status, Last Seen) would
   * be a different change, and nobody asked for it.
   */
  test("every other column is shown", async () => {
    await renderList();

    const hidden: Array<string> = declaredColumns()
      .filter((column: Column<VMwareVCenter>): boolean => {
        return Boolean(column.isHiddenByDefault);
      })
      .map((column: Column<VMwareVCenter>): string => {
        return column.title;
      });

    expect(hidden).toEqual(HIDDEN_TITLES);
  });

  test("on a phone, the card shows the name, the status and when it was last seen", async () => {
    await renderList();

    expect(phoneTitles(null)).toEqual(["Name", "Status", "Last Seen"]);
  });
});

/*
 * "Hidden" and "reachable" hold together: a column hidden on a table with no
 * picker is a column nobody can get back.
 */
describe("Customize Columns turns them back on", () => {
  /*
   * The flag only means something if the table keeps a layout: without a
   * userPreferencesKey the picker is never drawn (see
   * BaseModelTable.isColumnCustomizationEnabled).
   */
  test("the list has a column picker, kept under its own key", async () => {
    const props: CapturedTableProps = await renderList();

    expect(props.userPreferencesKey).toBe("vmware-vcenters-table");
    expect(props.disableColumnCustomization).toBeFalsy();

    for (const title of HIDDEN_TITLES) {
      expect(columnTitled(title).isNotCustomizable).toBeFalsy();
    }
  });

  test.each(HIDDEN_TITLES)(
    "the picker offers %s, switched off, and never offers to remove it",
    async (title: string) => {
      await renderList();

      const entry: CustomizableColumn<VMwareVCenter> = pickerEntry(title);

      expect(entry.isVisible).toBe(false);
      expect(entry.isPinned).toBe(false);
      // Off, not gone: nothing would put back a column the table ships.
      expect(entry.isRemovable).toBe(false);
    },
  );

  test("switched on, both show where the list declares them: after Status, before Last Seen", async () => {
    await renderList();

    // What the picker stores when a viewer ticks both and saves.
    const preference: ColumnPreference = buildColumnPreference<VMwareVCenter>(
      getCustomizableColumns<VMwareVCenter>({
        columns: declaredColumns(),
        preference: null,
      }).map(
        (
          entry: CustomizableColumn<VMwareVCenter>,
        ): CustomizableColumn<VMwareVCenter> => {
          return HIDDEN_TITLES.includes(entry.column.title)
            ? { ...entry, isVisible: true }
            : entry;
        },
      ),
    );

    expect(visibleTitles(preference)).toEqual([
      "Name",
      "Status",
      "Collected By",
      "Agent Version",
      "Last Seen",
      "Labels",
      "Owners",
    ]);
  });

  test("one switched on and the other off: only that one shows", async () => {
    await renderList();

    const preference: ColumnPreference = {
      order: getColumnIds<VMwareVCenter>(declaredColumns()),
      hidden: [columnId("Collected By")],
    };

    const titles: Array<string> = visibleTitles(preference);

    expect(titles).toContain("Agent Version");
    expect(titles).not.toContain("Collected By");
  });

  /*
   * Neither column is hideOnMobile. That flag drops a column at render while
   * the picker knows nothing of it, so on a phone a viewer could tick it,
   * watch the count of shown columns go up, and get no column - and for a
   * column hidden by default the picker is the only way back. Stated over the
   * whole set, so the pair cannot come back on another column.
   */
  test("no column the picker can switch on is one a phone would throw away", async () => {
    await renderList();

    const unreachable: Array<string> = declaredColumns()
      .filter((column: Column<VMwareVCenter>): boolean => {
        return (
          Boolean(column.isHiddenByDefault) && Boolean(column.hideOnMobile)
        );
      })
      .map((column: Column<VMwareVCenter>): string => {
        return column.title;
      });

    expect(unreachable).toEqual([]);
  });

  test("on a phone, a viewer who switched them on sees them on the card", async () => {
    await renderList();

    const preference: ColumnPreference = {
      order: getColumnIds<VMwareVCenter>(declaredColumns()),
      hidden: [],
    };

    expect(phoneTitles(preference)).toEqual([
      "Name",
      "Status",
      "Collected By",
      "Agent Version",
      "Last Seen",
    ]);
  });

  /*
   * A layout is stored by column id, and the id is the column's field. Were
   * a second column ever keyed on the same field, the ids would be told apart
   * by title and then by position, the stored entry would stop matching, and
   * a viewer who had switched the column on would silently lose it.
   */
  test("their ids are their fields, which no other column competes for", async () => {
    await renderList();

    const columns: Columns<VMwareVCenter> = declaredColumns();
    const ids: Array<string> = getColumnIds<VMwareVCenter>(columns);

    expect(columnId("Collected By")).toBe("collectionMethod");
    expect(columnId("Agent Version")).toBe("agentVersion");

    // Nothing had to be told apart, so no id depends on declaration order.
    expect(ids).toEqual(
      columns.map((column: Column<VMwareVCenter>): string => {
        return getColumnBaseId<VMwareVCenter>(column);
      }),
    );

    const titles: Array<string> = columns.map(
      (column: Column<VMwareVCenter>): string => {
        return column.title;
      },
    );
    expect(new Set(titles).size).toBe(titles.length);
  });
});

/*
 * What changes for people who already use the list. A stored layout is the
 * viewer's own: it names every column they had when they saved it, and a
 * column it names and does not hide stays on (ColumnPreference's rule, for
 * every table). So the new default reaches everyone who never customized this
 * list, and Reset to default brings it to the others.
 */
describe("viewers who arranged the list before", () => {
  type OldLayoutFunction = () => ColumnPreference;

  // A layout saved from the picker while both columns shipped switched on.
  const oldLayout: OldLayoutFunction = (): ColumnPreference => {
    return buildColumnPreference<VMwareVCenter>(
      getCustomizableColumns<VMwareVCenter>({
        columns: declaredColumns(),
        preference: null,
      }).map(
        (
          entry: CustomizableColumn<VMwareVCenter>,
        ): CustomizableColumn<VMwareVCenter> => {
          return { ...entry, isVisible: entry.column.title !== "Labels" };
        },
      ),
    );
  };

  test("keep the layout they saved, both columns included", async () => {
    await renderList();

    const titles: Array<string> = visibleTitles(oldLayout());

    expect(titles).toContain("Collected By");
    expect(titles).toContain("Agent Version");
    // Their own choice survives too.
    expect(titles).not.toContain("Labels");
  });

  test("and Reset to default (no stored layout) gives them the new list", async () => {
    await renderList();

    expect(visibleTitles(null)).toEqual(DEFAULT_TITLES);
  });

  test("a layout that names neither column shows neither", async () => {
    await renderList();

    const preference: ColumnPreference = {
      order: getColumnIds<VMwareVCenter>(declaredColumns()).filter(
        (id: string): boolean => {
          return id !== "collectionMethod" && id !== "agentVersion";
        },
      ),
      hidden: [],
    };

    expect(visibleTitles(preference)).toEqual(DEFAULT_TITLES);
  });
});

describe("switched on, the columns say what they always said", () => {
  test("Collected By names the probe that collects a vCenter", async () => {
    await renderList();

    expect(
      cell(
        "Collected By",
        vcenter({
          collectionMethod: VMwareCollectionMethod.Probe,
          probeName: "Lab Probe",
        }),
      ),
    ).toHaveTextContent(/^Probe: Lab Probe$/);
  });

  test("Collected By says Probe when the probe's name is not to hand", async () => {
    await renderList();

    expect(
      cell(
        "Collected By",
        vcenter({ collectionMethod: VMwareCollectionMethod.Probe }),
      ),
    ).toHaveTextContent(/^Probe$/);
  });

  test("Collected By says VMware Agent for a vCenter the agent sends", async () => {
    await renderList();

    expect(
      cell(
        "Collected By",
        vcenter({ collectionMethod: VMwareCollectionMethod.Agent }),
      ),
    ).toHaveTextContent(/^VMware Agent$/);
    // Every vCenter from before probe collection is an agent vCenter.
    expect(cell("Collected By", vcenter({}))).toHaveTextContent(
      /^VMware Agent$/,
    );
  });

  test("Agent Version shows the version an up-to-date agent reports, as plain text", async () => {
    await renderList();

    const drawn: HTMLElement = cell(
      "Agent Version",
      vcenter({ agentVersion: VMWARE_AGENT_VERSION }),
    );

    expect(drawn).toHaveTextContent(VMWARE_AGENT_VERSION);
    expect(
      drawn.querySelector('[data-testid="agent-version-outdated"]'),
    ).toBeNull();
  });

  test("Agent Version keeps the upgrade sign beside an outdated agent", async () => {
    await renderList();

    const drawn: HTMLElement = cell(
      "Agent Version",
      vcenter({ agentVersion: "0.100.0" }),
    );
    const sign: HTMLElement | null = drawn.querySelector(
      '[data-testid="agent-version-outdated"]',
    );

    expect(sign).not.toBeNull();
    expect(sign).toHaveTextContent("0.100.0");
    expect(sign!.getAttribute("aria-label")).toContain(VMWARE_AGENT_VERSION);
  });

  /*
   * A vCenter a probe collects reports no agent version. Its cell is the quiet
   * dash every empty cell has - which is also what a phone's card leaves out,
   * rather than naming an Agent Version field with nothing under it.
   */
  test("Agent Version is the quiet dash for a vCenter that reported none (a probe collects it)", async () => {
    await renderList();

    const drawn: HTMLElement = cell(
      "Agent Version",
      vcenter({ collectionMethod: VMwareCollectionMethod.Probe }),
    );
    const dash: HTMLElement | null = drawn.querySelector(
      `[data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"]`,
    );

    expect(dash).not.toBeNull();
    // What a screen reader hears in place of the dash.
    expect(dash).toHaveTextContent("Not reported");
    expect(
      drawn.querySelector('[data-testid="agent-version-outdated"]'),
    ).toBeNull();
  });

  /*
   * The table asks for every declared column, hidden or not, so a column
   * switched on draws at once, without a reload. Collected By also reads the
   * probe's name, which its field does not name: the page asks for it.
   */
  test("the list still asks for what both columns draw", async () => {
    const props: CapturedTableProps = await renderList();

    expect(columnTitled("Collected By").field).toEqual({
      collectionMethod: true,
    });
    expect(columnTitled("Agent Version").field).toEqual({
      agentVersion: true,
    });
    expect(props.selectMoreFields).toEqual({
      collectionMethod: true,
      collectionProbe: {
        name: true,
      },
    });
  });

  /*
   * The CSV follows the columns on screen: the two leave the default export by
   * being switched off, and come back when a viewer switches them on.
   */
  test("neither opts out of the CSV export", async () => {
    await renderList();

    for (const title of HIDDEN_TITLES) {
      expect(columnTitled(title).disableCsvExport).toBeFalsy();
    }
  });
});

describe("the rest of VMware's lists", () => {
  /*
   * Archived vCenters never had either column, and does not gain one: an
   * archived vCenter is found by its name, its owners (the Owner chip, and
   * the Owners column that shows what it filters on) and when it was
   * archived.
   */
  test("Archived vCenters shows neither column", async () => {
    const props: CapturedTableProps = await renderList(
      ArchivedVCentersPage as unknown as PageComponent,
    );

    expect(props.id).toBe("vmware-archived-table");

    const titles: Array<string> = (props.columns || []).map(
      (column: CapturedColumn): string => {
        return column.title;
      },
    );

    expect(titles).toEqual([
      "Name",
      "Last Seen",
      "Labels",
      "Owners",
      "Archived At",
      "Archived By",
    ]);
  });
});
