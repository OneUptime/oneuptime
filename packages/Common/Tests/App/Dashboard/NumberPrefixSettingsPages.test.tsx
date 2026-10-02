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
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import IncidentNumberPrefix from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentNumberPrefix";
import AlertNumberPrefix from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertNumberPrefix";
import ScheduledMaintenanceNumberPrefix from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNumberPrefix";
import {
  ALERT_NUMBER_PREFIXES,
  INCIDENT_NUMBER_PREFIXES,
  MORE_SETTINGS_PATH,
  NUMBER_PREFIX_PAGES,
  NumberPrefixPage,
  NumberPrefixRow,
  SCHEDULED_MAINTENANCE_NUMBER_PREFIXES,
  getNumberPrefixColumns,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NumberPrefix/NumberPrefixSettings";
import {
  getProjectColumnsPermissionMessage,
  getProjectColumnsUpdatePermissions,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/ProjectColumnEditGate";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  AlertsRoutePath,
  IncidentsRoutePath,
  ScheduledMaintenanceEventsRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getAlertsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/AlertBreadcrumbs";
import { getIncidentsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/IncidentBreadcrumbs";
import { getScheduleMaintenanceBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ScheduledMaintenanceBreadcrumbs";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Dictionary from "../../../Types/Dictionary";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import NumberPrefixUtil, {
  NUMBER_PREFIX_COLUMNS,
  NumberPrefixColumnInfo,
} from "../../../Utils/Project/NumberPrefix";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * The Number Prefix pages: Incidents, Alerts and Scheduled Maintenance →
 * Settings → Number Prefix.
 *
 * The maintainer, looking at the Number Prefix card on More Settings: "Can
 * you please create a new page called 'prefix' (or something better) and
 * have this there instead of 'more settings'? Please do this for alerts as
 * well. Please also make this UI easier to understand as well. Please make
 * the UI great."
 *
 * So each product has a Number Prefix page in place of More Settings. Its
 * card shows, for each kind of number, the prefix and the number it makes
 * (INC- → INC-42); its Update dialog is called Edit Number Prefix, says
 * that only new records use a new prefix, previews each number as it is
 * typed and says what is wrong with a prefix before it is saved. The real
 * pages are rendered here with the model API and the permission snapshot
 * stubbed.
 */

const WAIT_TIMEOUT: number = 20000;

interface PageUnderTest {
  name: string;
  page: NumberPrefixPage;
  Component: React.FunctionComponent<any>;
  pageMapKey: PageMap;
  routePaths: Dictionary<string>;
  productPath: string;
  getBreadcrumbs: (path: string) => Array<Link> | undefined;
  productCrumb: string;
  // The row labels and what a new project shows in them, in order.
  rows: Array<[string, string, string]>;
  description: string;
  editDescription: string;
}

const PAGES: Array<PageUnderTest> = [
  {
    name: "Incidents",
    page: INCIDENT_NUMBER_PREFIXES,
    Component: IncidentNumberPrefix,
    pageMapKey: PageMap.INCIDENTS_SETTINGS_NUMBER_PREFIX,
    routePaths: IncidentsRoutePath,
    productPath: "incidents",
    getBreadcrumbs: getIncidentsBreadcrumbs,
    productCrumb: "Incidents",
    rows: [
      ["Incidents", "INC-", "INC-42"],
      ["Incident Episodes", "IE-", "IE-42"],
    ],
    description:
      "The short text in front of incident and episode numbers, like INC- in INC-42.",
    editDescription:
      "Only new incidents and episodes use the new prefix. Existing ones keep their numbers.",
  },
  {
    name: "Alerts",
    page: ALERT_NUMBER_PREFIXES,
    Component: AlertNumberPrefix,
    pageMapKey: PageMap.ALERTS_SETTINGS_NUMBER_PREFIX,
    routePaths: AlertsRoutePath,
    productPath: "alerts",
    getBreadcrumbs: getAlertsBreadcrumbs,
    productCrumb: "Alerts",
    rows: [
      ["Alerts", "ALT-", "ALT-42"],
      ["Alert Episodes", "AE-", "AE-42"],
    ],
    description:
      "The short text in front of alert and episode numbers, like ALT- in ALT-42.",
    editDescription:
      "Only new alerts and episodes use the new prefix. Existing ones keep their numbers.",
  },
  {
    name: "Scheduled Maintenance",
    page: SCHEDULED_MAINTENANCE_NUMBER_PREFIXES,
    Component: ScheduledMaintenanceNumberPrefix,
    pageMapKey: PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NUMBER_PREFIX,
    routePaths: ScheduledMaintenanceEventsRoutePath,
    productPath: "scheduled-maintenance-events",
    getBreadcrumbs: getScheduleMaintenanceBreadcrumbs,
    productCrumb: "Scheduled Maintenance",
    rows: [["Events", "SM-", "SM-42"]],
    description:
      "The short text in front of scheduled maintenance event numbers, like SM- in SM-42.",
    editDescription:
      "Only new events use the new prefix. Existing ones keep their numbers.",
  },
];

const ALL_PREFIX_COLUMNS: Array<string> = NUMBER_PREFIX_COLUMNS.map(
  (info: NumberPrefixColumnInfo): string => {
    return info.column;
  },
);

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

let project: Project;
let getItemSpy: ReturnType<typeof jest.spyOn>;
let createOrUpdateSpy: ReturnType<typeof jest.spyOn>;

function grant(permissions: Array<Permission>, isMasterAdmin?: boolean): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(Boolean(isMasterAdmin));
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

function pagePath(under: PageUnderTest): string {
  return `/dashboard/${PROJECT_ID}/${under.productPath}/settings/number-prefix`;
}

function openPage(under: PageUnderTest): void {
  goTo(pagePath(under));
  const Component: React.FunctionComponent<any> = under.Component;
  render(
    <MemoryRouter initialEntries={[pagePath(under)]}>
      <Component
        pageRoute={RouteMap[under.pageMapKey] as Route}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

async function card(): Promise<HTMLElement> {
  return (
    await screen.findByText("Number Prefix", {}, { timeout: WAIT_TIMEOUT })
  ).closest('[data-testid="card"]') as HTMLElement;
}

async function row(column: string): Promise<HTMLElement> {
  return await screen.findByTestId(
    `number-prefix-row-${column}`,
    {},
    { timeout: WAIT_TIMEOUT },
  );
}

// What a row shows: its prefix (or "No prefix") and its example.
async function rowShows(column: string): Promise<[string, string]> {
  const element: HTMLElement = await row(column);
  return [
    within(element).getByTestId("number-prefix-value").textContent || "",
    within(element).getByTestId("number-prefix-example").textContent || "",
  ];
}

// The title a detail row is labelled with, as ModelDetail renders it.
function rowTitles(cardElement: HTMLElement): Array<string> {
  return Array.from(cardElement.querySelectorAll("label > span")).map(
    (title: Element): string => {
      return title.textContent || "";
    },
  );
}

async function updateButtons(): Promise<Array<HTMLElement>> {
  const cardElement: HTMLElement = await card();
  await within(cardElement).findByText("Update", {}, { timeout: WAIT_TIMEOUT });

  return within(cardElement)
    .getAllByText("Update")
    .map((text: HTMLElement): HTMLElement => {
      return text.closest("button") as HTMLElement;
    });
}

async function openEditModal(): Promise<HTMLElement> {
  const buttons: Array<HTMLElement> = await updateButtons();
  expect(buttons).toHaveLength(1);
  fireEvent.click(buttons[0]!);
  return await screen.findByRole("dialog", {}, { timeout: WAIT_TIMEOUT });
}

async function field(
  dialog: HTMLElement,
  column: string,
): Promise<HTMLInputElement> {
  return (await within(dialog).findByTestId(
    `number-prefix-field-${column}`,
    {},
    { timeout: WAIT_TIMEOUT },
  )) as HTMLInputElement;
}

async function waitForValue(
  dialog: HTMLElement,
  column: string,
  value: string,
): Promise<HTMLInputElement> {
  const input: HTMLInputElement = await field(dialog, column);
  await waitFor(
    () => {
      expect(input.value).toBe(value);
    },
    { timeout: WAIT_TIMEOUT },
  );
  return input;
}

function type(input: HTMLInputElement, value: string): void {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function preview(dialog: HTMLElement, column: string): HTMLElement | null {
  const footer: HTMLElement | null = within(dialog).queryByTestId(
    `number-prefix-preview-${column}`,
  );
  return footer ? within(footer).getByTestId("number-prefix-preview") : null;
}

async function waitForPreview(
  dialog: HTMLElement,
  column: string,
  text: string,
): Promise<void> {
  await waitFor(
    () => {
      expect(preview(dialog, column)?.textContent).toBe(text);
    },
    { timeout: WAIT_TIMEOUT },
  );
}

function submit(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
}

async function save(dialog: HTMLElement): Promise<void> {
  submit(dialog);
  await waitFor(
    () => {
      expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
    },
    { timeout: WAIT_TIMEOUT },
  );
}

function postedProject(): Project {
  return (createOrUpdateSpy.mock.calls[0]![0] as { model: Project }).model;
}

// The Project columns a saved model carries a value for, leaving out its id.
function writtenColumns(model: Project): Array<string> {
  const values: Record<string, unknown> = model as unknown as Record<
    string,
    unknown
  >;

  return Object.keys(values)
    .filter((key: string): boolean => {
      return (
        key !== "_id" && model.isTableColumn(key) && values[key] !== undefined
      );
    })
    .sort();
}

function setPrefix(column: string, value: string | undefined): void {
  (project as unknown as Record<string, unknown>)[column] = value;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);

  // A new project: every prefix at its default.
  project = new Project();
  project._id = PROJECT_ID;
  for (const info of NUMBER_PREFIX_COLUMNS) {
    setPrefix(info.column, info.defaultForNewProjects);
  }

  getItemSpy = jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<Project> => {
      return project;
    });
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<ListResult<Project>> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    });
  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(async (): Promise<number> => {
      return 0;
    });
  createOrUpdateSpy = jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (): Promise<never> => {
      return { data: {} } as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("where the pages live", () => {
  test.each(PAGES)(
    "$name: a Settings page at settings/number-prefix",
    (under: PageUnderTest) => {
      expect(under.routePaths[under.pageMapKey]).toBe("settings/number-prefix");
      expect((RouteMap[under.pageMapKey] as Route).toString()).toBe(
        `/dashboard/:projectId/${under.productPath}/settings/number-prefix`,
      );
    },
  );

  test.each(PAGES)(
    "$name: the trail reads Project / product / Settings / Number Prefix",
    (under: PageUnderTest) => {
      goTo(pagePath(under));

      const trail: Array<Link> | undefined = under.getBreadcrumbs(
        `/dashboard/:projectId/${under.productPath}/settings/number-prefix`,
      );

      expect(
        (trail || []).map((link: Link): string => {
          return link.title;
        }),
      ).toEqual(["Project", under.productCrumb, "Settings", "Number Prefix"]);
      for (const link of trail || []) {
        expect(link.to.toString()).not.toContain(":");
      }
      expect(trail?.[trail.length - 1]?.to.toString()).toBe(pagePath(under));
    },
  );

  test("More Settings is gone from every product's route table", () => {
    for (const routePaths of [
      IncidentsRoutePath,
      AlertsRoutePath,
      ScheduledMaintenanceEventsRoutePath,
    ]) {
      expect(Object.values(routePaths)).not.toContain(MORE_SETTINGS_PATH);
    }
    for (const key of Object.keys(PageMap)) {
      expect(key).not.toMatch(/_SETTINGS_MORE$/);
    }
  });

  test("the old address is the one each product's More Settings had", () => {
    expect(MORE_SETTINGS_PATH).toBe("settings/more");
  });
});

describe("what each page is for", () => {
  test("each kind of number has its row on exactly one page", () => {
    const columns: Array<string> = NUMBER_PREFIX_PAGES.flatMap(
      (page: NumberPrefixPage): Array<string> => {
        return getNumberPrefixColumns(page);
      },
    );

    expect([...columns].sort()).toEqual([...ALL_PREFIX_COLUMNS].sort());
    expect(new Set(columns).size).toBe(columns.length);
  });

  test("each page's rows belong to its product", () => {
    expect(getNumberPrefixColumns(INCIDENT_NUMBER_PREFIXES)).toEqual([
      "incidentNumberPrefix",
      "incidentEpisodeNumberPrefix",
    ]);
    expect(getNumberPrefixColumns(ALERT_NUMBER_PREFIXES)).toEqual([
      "alertNumberPrefix",
      "alertEpisodeNumberPrefix",
    ]);
    expect(
      getNumberPrefixColumns(SCHEDULED_MAINTENANCE_NUMBER_PREFIXES),
    ).toEqual(["scheduledMaintenanceNumberPrefix"]);
  });

  test("each form field is named by its column's title and offers its default as the placeholder", () => {
    for (const page of NUMBER_PREFIX_PAGES) {
      for (const prefixRow of page.rows) {
        const info: NumberPrefixColumnInfo = NUMBER_PREFIX_COLUMNS.find(
          (candidate: NumberPrefixColumnInfo): boolean => {
            return candidate.column === prefixRow.column;
          },
        )!;

        expect(prefixRow.formTitle).toBe(info.title);
        expect(prefixRow.placeholder).toBe(info.defaultForNewProjects);
        expect(prefixRow.formDescription).toMatch(
          /^Shown before every .+ number\. Leave empty for #\.$/,
        );
      }
    }
  });

  test("the pages have their own form names and detail ids", () => {
    const names: Array<string> = NUMBER_PREFIX_PAGES.map(
      (page: NumberPrefixPage): string => {
        return page.name;
      },
    );
    const ids: Array<string> = NUMBER_PREFIX_PAGES.map(
      (page: NumberPrefixPage): string => {
        return page.detailId;
      },
    );

    expect(new Set(names).size).toBe(names.length);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe.each(PAGES)(
  "$name → Settings → Number Prefix",
  (under: PageUnderTest) => {
    const columns: Array<string> = getNumberPrefixColumns(under.page);
    const firstColumn: string = columns[0]!;

    test("shows one card, Number Prefix, saying what a prefix is", async () => {
      openPage(under);

      const cardElement: HTMLElement = await card();

      expect(screen.getAllByTestId("card")).toHaveLength(1);
      expect(
        within(cardElement).getByText(under.description),
      ).toBeInTheDocument();
    });

    test("shows each kind of number with its prefix and the number it makes", async () => {
      openPage(under);

      for (const [index, column] of columns.entries()) {
        const [, prefix, example] = under.rows[index]!;
        expect(await rowShows(column)).toEqual([prefix, `${example}`]);
      }

      expect(rowTitles(await card())).toEqual(
        under.rows.map((expected: [string, string, string]): string => {
          return expected[0];
        }),
      );
    });

    test("a project with no prefix shows No prefix and numbers with #", async () => {
      for (const column of columns) {
        setPrefix(column, undefined);
      }
      openPage(under);

      for (const column of columns) {
        expect(await rowShows(column)).toEqual(["No prefix", "#42"]);
      }
    });

    test("shows a custom prefix exactly as stored", async () => {
      setPrefix(firstColumn, "OPS_");
      openPage(under);

      expect(await rowShows(firstColumn)).toEqual(["OPS_", "OPS_42"]);
    });

    /*
     * index.ejs gives every element Inter (`* { font-family }`), which beats a
     * font inherited from a parent: the code text must sit in the element
     * that sets font-mono itself.
     */
    test("draws the prefix, the example and the preview in monospace, on the elements that hold them", async () => {
      setPrefix(firstColumn, "OPS-");
      openPage(under);

      const element: HTMLElement = await row(firstColumn);

      for (const testId of ["number-prefix-value", "number-prefix-example"]) {
        const code: HTMLElement = within(element).getByTestId(testId);
        expect(code).toHaveClass("font-mono");
        expect(code.children).toHaveLength(0);
      }

      const dialog: HTMLElement = await openEditModal();
      await waitForPreview(dialog, firstColumn, "OPS-42");

      expect(preview(dialog, firstColumn)).toHaveClass("font-mono");
      expect(preview(dialog, firstColumn)!.children).toHaveLength(0);
    });

    test("labels the example, never builds a sentence around the number", async () => {
      openPage(under);

      const element: HTMLElement = await row(firstColumn);

      expect(element.textContent).toContain("Example:");
    });

    test("holds nothing but the prefixes - no linked alert switch, no other product's prefix", async () => {
      openPage(under);
      await row(firstColumn);

      const cardElement: HTMLElement = await card();

      expect(rowTitles(cardElement)).toHaveLength(columns.length);
      expect(cardElement.textContent || "").not.toMatch(/Linked Alerts/);
      expect(cardElement.textContent || "").not.toMatch(/More Settings/);
    });

    test("reads the project it is on, and only its own prefixes", async () => {
      openPage(under);
      await row(firstColumn);

      await waitFor(
        () => {
          expect(getItemSpy.mock.calls.length).toBeGreaterThan(0);
        },
        { timeout: WAIT_TIMEOUT },
      );

      const call: { id?: unknown; select?: Record<string, unknown> } =
        getItemSpy.mock.calls[0]![0] as {
          id?: unknown;
          select?: Record<string, unknown>;
        };

      expect(String(call.id)).toBe(PROJECT_ID);
      expect(Object.keys(call.select || {}).sort()).toEqual(
        ["_id", ...columns].sort(),
      );
    });

    test("Update opens Edit Number Prefix, saying only new records use a new prefix", async () => {
      openPage(under);

      const dialog: HTMLElement = await openEditModal();

      expect(
        within(dialog).getByText("Edit Number Prefix"),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByText("Edit Project"),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).getByText(under.editDescription),
      ).toBeInTheDocument();
    });

    test("the dialog holds one field per prefix, filled in, each previewing its number", async () => {
      openPage(under);

      const dialog: HTMLElement = await openEditModal();

      for (const [index, column] of columns.entries()) {
        const [, prefix, example] = under.rows[index]!;
        await waitForValue(dialog, column, prefix);
        await waitForPreview(dialog, column, example);
      }

      expect(within(dialog).getAllByRole("textbox")).toHaveLength(
        columns.length,
      );
      for (const prefixRow of under.page.rows) {
        expect(
          within(dialog).getByText(prefixRow.formDescription),
        ).toBeInTheDocument();
      }
    });

    test("the preview follows what is typed", async () => {
      openPage(under);

      const dialog: HTMLElement = await openEditModal();
      const input: HTMLInputElement = await waitForValue(
        dialog,
        firstColumn,
        under.rows[0]![1],
      );

      type(input, "OPS-");
      await waitForPreview(dialog, firstColumn, "OPS-42");

      type(input, "  SRE:  ");
      await waitForPreview(dialog, firstColumn, "SRE:42");
    });

    test("an emptied field previews the default #", async () => {
      openPage(under);

      const dialog: HTMLElement = await openEditModal();
      const input: HTMLInputElement = await waitForValue(
        dialog,
        firstColumn,
        under.rows[0]![1],
      );

      type(input, "");
      await waitForPreview(dialog, firstColumn, "#42");
    });

    test.each([
      [
        "a space",
        "IN C-",
        "Use only letters, numbers and - _ . / : # (no spaces).",
      ],
      [
        "a character that is not allowed",
        "INC*",
        "Use only letters, numbers and - _ . / : # (no spaces).",
      ],
      [
        "a digit at the end",
        "SEV1",
        "End with a letter or a symbol such as -. A digit at the end runs into the number: SEV1 would make SEV142.",
      ],
      ["21 characters", "A".repeat(20) + "-", "Use 20 characters or fewer."],
    ])(
      "a prefix with %s says why, drops the preview and is not saved",
      async (_case: string, value: string, message: string) => {
        openPage(under);

        const dialog: HTMLElement = await openEditModal();
        const input: HTMLInputElement = await waitForValue(
          dialog,
          firstColumn,
          under.rows[0]![1],
        );

        type(input, value);

        expect(
          await within(dialog).findByText(
            message,
            {},
            { timeout: WAIT_TIMEOUT },
          ),
        ).toBeInTheDocument();
        expect(preview(dialog, firstColumn)).toBeNull();

        submit(dialog);

        // Give a save that was not stopped the time to reach the API.
        await act(async () => {
          await new Promise((resolve: (value: unknown) => void) => {
            setTimeout(resolve, 300);
          });
        });

        expect(within(dialog).getByText(message)).toBeInTheDocument();
        expect(screen.getByRole("dialog")).toBe(dialog);
        expect(createOrUpdateSpy).not.toHaveBeenCalled();
      },
    );

    test("fixing the prefix clears the error and brings the preview back", async () => {
      openPage(under);

      const dialog: HTMLElement = await openEditModal();
      const input: HTMLInputElement = await waitForValue(
        dialog,
        firstColumn,
        under.rows[0]![1],
      );

      type(input, "SEV1");
      await within(dialog).findByText(
        /A digit at the end runs into the number/,
        {},
        { timeout: WAIT_TIMEOUT },
      );

      type(input, "SEV1-");

      await waitForPreview(dialog, firstColumn, "SEV1-42");
      expect(
        within(dialog).queryByText(/A digit at the end runs into the number/),
      ).not.toBeInTheDocument();
    });

    test("saves exactly the page's prefixes and nothing else on the project", async () => {
      openPage(under);

      const dialog: HTMLElement = await openEditModal();
      const input: HTMLInputElement = await waitForValue(
        dialog,
        firstColumn,
        under.rows[0]![1],
      );

      type(input, "OPS-");
      await waitForPreview(dialog, firstColumn, "OPS-42");
      await save(dialog);

      const posted: Project = postedProject();
      const values: Record<string, unknown> = posted as unknown as Record<
        string,
        unknown
      >;

      expect(values[firstColumn]).toBe("OPS-");
      expect(writtenColumns(posted)).toEqual([...columns].sort());
      for (const column of ALL_PREFIX_COLUMNS) {
        if (!columns.includes(column)) {
          expect(values[column]).toBeUndefined();
        }
      }
      expect(String(posted._id)).toBe(PROJECT_ID);
    });

    test("a project that had no prefix can be given one", async () => {
      for (const column of columns) {
        setPrefix(column, undefined);
      }
      openPage(under);

      const dialog: HTMLElement = await openEditModal();
      const input: HTMLInputElement = await field(dialog, firstColumn);

      await waitForPreview(dialog, firstColumn, "#42");
      expect(input.value).toBe("");
      expect(input.placeholder).toBe(under.rows[0]![1]);

      type(input, under.rows[0]![1]);
      await waitForPreview(dialog, firstColumn, under.rows[0]![2]);
      await save(dialog);

      expect(
        (postedProject() as unknown as Record<string, unknown>)[firstColumn],
      ).toBe(under.rows[0]![1]);
    });
  },
);

describe("who may change the prefixes", () => {
  const under: PageUnderTest = PAGES[0]!;

  test("every page's card is gated on exactly the columns it writes", () => {
    for (const page of NUMBER_PREFIX_PAGES) {
      expect(
        getProjectColumnsUpdatePermissions(getNumberPrefixColumns(page)),
      ).toEqual([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditProject,
      ]);
    }
  });

  test("is narrower than the Project table's update list", () => {
    // Why the card cannot rely on CardModelDetail's table-level gate.
    expect(new Project().getUpdatePermissions()).toContain(
      Permission.ManageProjectBilling,
    );
    expect(
      getProjectColumnsUpdatePermissions(
        getNumberPrefixColumns(INCIDENT_NUMBER_PREFIXES),
      ),
    ).not.toContain(Permission.ManageProjectBilling);
  });

  test("the locked button's reason names the permissions", () => {
    expect(
      getProjectColumnsPermissionMessage(
        getNumberPrefixColumns(INCIDENT_NUMBER_PREFIXES),
      ),
    ).toBe(
      "Changing these needs one of these permissions: Project Owner, Project Admin, Edit Project.",
    );
  });

  test.each([
    [Permission.ProjectOwner],
    [Permission.ProjectAdmin],
    [Permission.EditProject],
  ])("%s gets a working Update button", async (permission: Permission) => {
    grant([...BASE_PERMISSIONS, permission]);
    openPage(under);

    const buttons: Array<HTMLElement> = await updateButtons();
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).not.toBeDisabled();

    fireEvent.click(buttons[0]!);
    expect(
      await screen.findByRole("dialog", {}, { timeout: WAIT_TIMEOUT }),
    ).toBeInTheDocument();
  });

  test("a master admin gets a working Update button", async () => {
    grant([], true);
    openPage(under);

    const buttons: Array<HTMLElement> = await updateButtons();
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).not.toBeDisabled();
  });

  /*
   * The Project table's update list lets Manage Billing in, but the prefix
   * columns do not: the card's own gate would give it a save the server
   * refuses.
   */
  test("Manage Billing sees the Update button locked, and clicking it opens nothing", async () => {
    grant([
      ...BASE_PERMISSIONS,
      Permission.ManageProjectBilling,
      Permission.ReadProject,
    ]);
    openPage(under);

    const buttons: Array<HTMLElement> = await updateButtons();
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBeDisabled();

    fireEvent.click(buttons[0]!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(createOrUpdateSpy).not.toHaveBeenCalled();
  });

  test.each([[Permission.ProjectMember], [Permission.Viewer]])(
    "%s reads the prefixes behind a locked button",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      openPage(under);

      expect(await rowShows("incidentNumberPrefix")).toEqual([
        "INC-",
        "INC-42",
      ]);

      const buttons: Array<HTMLElement> = await updateButtons();
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toBeDisabled();
    },
  );

  test("offers no button before the permission snapshot has landed", async () => {
    grant([]);
    openPage(under);

    const cardElement: HTMLElement = await card();
    await screen.findByText(under.description, {}, { timeout: WAIT_TIMEOUT });
    expect(within(cardElement).queryByText("Update")).not.toBeInTheDocument();
  });
});

/*
 * Every word the pages show goes through the locale files, so the 16
 * translated dashboards show them translated, and none of the keys the old
 * More Settings pages used is left behind.
 */
describe("translations", () => {
  const LOCALES_DIR: string = path.join(
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
  );

  const LOCALE_FILES: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    });

  function locale(file: string): Record<string, string> {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    ) as Record<string, string>;
  }

  const SHOWN: Array<string> = [
    "Number Prefix",
    "Update",
    "Edit Number Prefix",
    "No prefix",
    "Example:",
    "Preview:",
    "Use 20 characters or fewer.",
    "Use only letters, numbers and - _ . / : # (no spaces).",
    "End with a letter or a symbol such as -. A digit at the end runs into the number: SEV1 would make SEV142.",
    ...NUMBER_PREFIX_PAGES.flatMap((page: NumberPrefixPage): Array<string> => {
      return [
        page.cardDescription,
        page.editDescription,
        ...page.rows.flatMap((prefixRow: NumberPrefixRow): Array<string> => {
          return [
            prefixRow.label,
            prefixRow.formTitle,
            prefixRow.formDescription,
          ];
        }),
      ];
    }),
  ];

  test("there are 17 locale files", () => {
    expect(LOCALE_FILES).toHaveLength(17);
  });

  test.each(SHOWN)("%j has a translation in every locale", (text: string) => {
    for (const file of LOCALE_FILES) {
      const value: string | undefined = locale(file)[text];
      expect({
        file,
        has: typeof value === "string" && value.length > 0,
      }).toEqual({ file, has: true });
    }
  });

  test("the validation messages the pages show are the ones the server sends", () => {
    for (const message of [
      "Use 20 characters or fewer.",
      "Use only letters, numbers and - _ . / : # (no spaces).",
      "End with a letter or a symbol such as -. A digit at the end runs into the number: SEV1 would make SEV142.",
    ]) {
      expect([
        NumberPrefixUtil.getError("A".repeat(21)),
        NumberPrefixUtil.getError("IN C-"),
        NumberPrefixUtil.getError("SEV1"),
      ]).toContain(message);
    }
  });

  test.each([
    "More Settings",
    "# (default)",
    "Custom prefix for incident numbers (e.g., 'INC-'). Leave empty for default '#'.",
    "Configure custom prefixes for incident and incident episode numbers. For example, set 'INC-' to display incident numbers as 'INC-42' instead of '#42'. Leave empty to use the default '#' prefix.",
  ])("the old key %j is gone from every locale", (text: string) => {
    for (const file of LOCALE_FILES) {
      expect({ file, has: text in locale(file) }).toEqual({ file, has: false });
    }
  });

  test("keeps every translated example code as it is", () => {
    for (const file of LOCALE_FILES) {
      const values: Record<string, string> = locale(file);

      for (const page of NUMBER_PREFIX_PAGES) {
        const code: string = page.cardDescription.match(/like (\S+) in/)![1]!;
        expect({
          file,
          code,
          kept: values[page.cardDescription]!.includes(code),
        }).toEqual({ file, code, kept: true });
      }
    }
  });
});
