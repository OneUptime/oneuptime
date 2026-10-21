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
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * A real ModelTable mounts a card, a header, a full table and, for the
 * picker and the CSV, a menu and a modal on top. Give it room when the whole
 * Common suite competes for the box.
 */
configure({ asyncUtilTimeout: 15000 });

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Workflows > Global Variables and a workflow's Workflow Variables, drawn for
 * real: WorkflowVariablesTable inside the real ModelTable and BaseModelTable,
 * over a fake API that hands back only the fields the list asked for.
 *
 * The maintainer, on the Global Variables list (Name, Type reading "Static",
 * Description): "Please remove the type column from this table. Pelase also
 * remove it from workflow variables table as well. We need to make UI simple
 * for people to understand."
 *
 * So this checks the screen, on both lists: the header, the rows of every
 * kind of variable, what the list asks the API for, the Columns picker, a
 * column layout saved while the Type column was there, the CSV export and
 * what a German viewer reads. The configuration the pages hand the table is
 * pinned in WorkflowVariablesTable.test.tsx, and the variable's own page -
 * where the type is still shown - in WorkflowVariableView.test.tsx.
 *
 * The viewer is a project owner, as in the screenshot: owners may delete
 * variables, so the list has its row checkboxes and, through them, Bulk
 * Actions with Export CSV.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return {
          _type: "UserTenantAccessPermission",
          permissions: permissionsForTest.map((permission: unknown) => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          }),
        };
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import WorkflowVariablesTable from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowVariablesTable";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  OAuth2GrantType,
  WorkflowVariableType,
} from "../../../Types/Workflow/WorkflowVariableOAuth";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableColumnsToCsv from "../../../UI/Utils/TableColumnsToCsv";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import UserPreferences, {
  UserPreferenceType,
} from "../../../Utils/UserPreferences";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

// Both lists keep their column layout under this one key.
const COLUMN_LAYOUT_KEY: string = "workflow-variable-table";

type VariableRow = {
  _id: string;
  name: string;
  description?: string | undefined;
  variableType?: WorkflowVariableType | undefined;
  oauthGrantType?: OAuth2GrantType | undefined;
  isSecret?: boolean | undefined;
};

const STATIC_ROW: VariableRow = {
  _id: "33333333-3333-4333-8333-333333333301",
  name: "SLACK_WEBHOOK_URL",
  description: "Where the on-call alerts are posted.",
  variableType: WorkflowVariableType.Static,
  isSecret: true,
};

const CLIENT_CREDENTIALS_ROW: VariableRow = {
  _id: "33333333-3333-4333-8333-333333333302",
  name: "GRAPH_API_TOKEN",
  description: "Microsoft Graph token for the ticket sync.",
  variableType: WorkflowVariableType.OAuth2,
  oauthGrantType: OAuth2GrantType.ClientCredentials,
  isSecret: true,
};

const REFRESH_TOKEN_ROW: VariableRow = {
  _id: "33333333-3333-4333-8333-333333333303",
  name: "SHEETS_API_TOKEN",
  description: "Google Sheets token for the weekly report.",
  variableType: WorkflowVariableType.OAuth2,
  oauthGrantType: OAuth2GrantType.RefreshToken,
  isSecret: true,
};

// Saved before variables had a type, and never given a description.
const LEGACY_ROW: VariableRow = {
  _id: "33333333-3333-4333-8333-333333333304",
  name: "OLD_API_KEY",
};

// Every kind of variable a list can hold.
const ROWS: Array<VariableRow> = [
  STATIC_ROW,
  CLIENT_CREDENTIALS_ROW,
  REFRESH_TOKEN_ROW,
  LEGACY_ROW,
];

/*
 * Everything the Type column used to put on screen, heading included, and
 * the stored values it was drawn from (today the same words).
 */
const TYPE_TEXT: Array<string> = Array.from(
  new Set<string>([
    "Type",
    "Static",
    "OAuth 2.0",
    "Client Credentials",
    "Refresh Token",
    WorkflowVariableType.Static,
    WorkflowVariableType.OAuth2,
    OAuth2GrantType.ClientCredentials,
    OAuth2GrantType.RefreshToken,
  ]),
);

// Fields that say what kind of variable a row is.
const TYPE_FIELDS: Array<string> = ["variableType", "oauthGrantType"];

// Write-only or secret: no list request may ever select them.
const SECRET_FIELDS: Array<string> = [
  "content",
  "oauthClientSecret",
  "oauthRefreshToken",
  "oauthAccessToken",
];

type PageCase = {
  page: string;
  workflowId: ObjectID | undefined;
  url: string;
};

const PAGE_CASES: Array<PageCase> = [
  {
    page: "Global Variables",
    workflowId: undefined,
    url: `/dashboard/${PROJECT_ID.toString()}/workflows/variables`,
  },
  {
    page: "Workflow Variables",
    workflowId: WORKFLOW_ID,
    url: `/dashboard/${PROJECT_ID.toString()}/workflows/${WORKFLOW_ID.toString()}/variables`,
  },
];

type DownloadedCsvFile = {
  csv: string;
  filename: string;
};

type ListRequest = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
};

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

const readLocale: (locale: string) => Record<string, string> = (
  locale: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
};

const english: i18n = createInstance();
const german: i18n = createInstance();

let listRequests: Array<ListRequest> = [];
let downloadedCsvFiles: Array<DownloadedCsvFile> = [];

/*
 * The API returns exactly the fields the request selected (and the id), so
 * a column the list stopped asking for cannot be drawn from a row that
 * happened to carry it anyway.
 */
const toModel: (
  row: VariableRow,
  select: Record<string, unknown>,
) => WorkflowVariable = (
  row: VariableRow,
  select: Record<string, unknown>,
): WorkflowVariable => {
  const variable: WorkflowVariable = new WorkflowVariable();
  variable._id = row._id;

  for (const key of Object.keys(select)) {
    const value: unknown = (row as Record<string, unknown>)[key];

    if (value !== undefined) {
      (variable as unknown as Record<string, unknown>)[key] = value;
    }
  }

  return variable;
};

const renderList: (data: {
  pageCase: PageCase;
  language?: i18n | undefined;
}) => Promise<void> = async (data: {
  pageCase: PageCase;
  language?: i18n | undefined;
}): Promise<void> => {
  window.history.replaceState(window.history.state, "", data.pageCase.url);

  const language: i18n = data.language || english;

  const Wrapper: (props: { children?: ReactNode }) => ReactElement = (props: {
    children?: ReactNode;
  }): ReactElement => {
    return <I18nextProvider i18n={language}>{props.children}</I18nextProvider>;
  };

  render(<WorkflowVariablesTable workflowId={data.pageCase.workflowId} />, {
    wrapper: Wrapper,
  });

  await waitFor(() => {
    expect(listRequests.length).toBeGreaterThan(0);
  });

  await screen.findByText(LEGACY_ROW.name);
};

const getHeaders: () => Array<string> = (): Array<string> => {
  return screen.getAllByRole("columnheader").map((header: HTMLElement) => {
    return (header.textContent || "").trim();
  });
};

const lastListRequest: () => ListRequest = (): ListRequest => {
  const request: ListRequest | undefined =
    listRequests[listRequests.length - 1];

  if (!request) {
    throw new Error("The list asked the API for nothing");
  }

  return request;
};

const click: (element: Element) => Promise<void> = async (
  element: Element,
): Promise<void> => {
  await act(async () => {
    fireEvent.click(element);
  });
};

/*
 * The real click path. The Columns control is an icon-only card button, and
 * the card folds every button but Create into its More options (⋯) menu.
 */
const openColumnsPicker: () => Promise<void> = async (): Promise<void> => {
  await click(screen.getByRole("button", { name: "More options" }));
  await click(screen.getByText("Columns"));

  await waitFor(() => {
    expect(screen.queryByTestId("column-customization-modal")).not.toBeNull();
  });
};

// The column ids the picker offers, one checkbox per column.
const getPickerColumnIds: () => Array<string> = (): Array<string> => {
  const modal: HTMLElement = screen.getByTestId("column-customization-modal");

  return Array.from(
    modal.querySelectorAll('[data-testid^="column-toggle-"]'),
  ).map((element: Element) => {
    return (element.getAttribute("data-testid") || "").replace(
      "column-toggle-",
      "",
    );
  });
};

const saveColumnLayout: (layout: {
  order: Array<string>;
  hidden: Array<string>;
}) => void = (layout: {
  order: Array<string>;
  hidden: Array<string>;
}): void => {
  UserPreferences.saveUserPreferenceByTypeAsJSON({
    key: COLUMN_LAYOUT_KEY,
    userPreferenceType: UserPreferenceType.BaseModelTableColumns,
    value: { order: layout.order, hidden: layout.hidden },
  });
};

beforeAll(async () => {
  await english.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: readLocale("en") } },
    interpolation: { escapeValue: false },
  });

  await german.init({
    lng: "de",
    fallbackLng: "de",
    resources: { de: { translation: readLocale("de") } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  permissionsForTest = [Permission.ProjectOwner];
  listRequests = [];
  downloadedCsvFiles = [];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
    modelType: { new (): BaseModel };
    query?: Record<string, unknown>;
    select?: Record<string, unknown>;
  }) => {
    // The saved-views menu asks for its own rows; there are none.
    if (args.modelType !== WorkflowVariable) {
      return { data: [], count: 0, skip: 0, limit: 10 };
    }

    const select: Record<string, unknown> = args.select || {};

    listRequests.push({ query: args.query || {}, select: select });

    return {
      data: ROWS.map((row: VariableRow) => {
        return toModel(row, select);
      }),
      count: ROWS.length,
      skip: 0,
      limit: 10,
    } as ListResult<WorkflowVariable>;
  }) as never);

  jest
    .spyOn(TableColumnsToCsv, "downloadCsv")
    .mockImplementation((data: DownloadedCsvFile): void => {
      downloadedCsvFiles.push(data);
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(PAGE_CASES)("the $page list, rendered", (pageCase: PageCase) => {
  test("the header is Name and Description, between the row checkboxes and the actions", async () => {
    await renderList({ pageCase });

    expect(getHeaders()).toEqual([
      "Select all items",
      "Name",
      "Description",
      "Actions",
    ]);

    expect(
      screen.queryByRole("columnheader", { name: "Type" }),
    ).not.toBeInTheDocument();
  });

  test("every variable is listed by its name and description, whatever its kind", async () => {
    await renderList({ pageCase });

    const table: HTMLElement = screen.getByRole("table");

    for (const row of ROWS) {
      expect(within(table).getByText(row.name)).toBeInTheDocument();

      if (row.description) {
        expect(within(table).getByText(row.description)).toBeInTheDocument();
      }
    }

    // One row each, every one opened the same way.
    expect(within(table).getAllByRole("button", { name: "View" })).toHaveLength(
      ROWS.length,
    );
  });

  test("no row says what kind of variable it is", async () => {
    await renderList({ pageCase });

    const table: HTMLElement = screen.getByRole("table");
    const tableText: string = table.textContent || "";

    for (const text of TYPE_TEXT) {
      expect({ text, onScreen: tableText.includes(text) }).toEqual({
        text,
        onScreen: false,
      });
    }
  });

  test("asks the API for the name and the description, never the type or the grant type", async () => {
    await renderList({ pageCase });

    const select: Record<string, unknown> = lastListRequest().select;

    expect(Object.keys(select).sort()).toEqual(["_id", "description", "name"]);

    for (const field of [...TYPE_FIELDS, ...SECRET_FIELDS, "isSecret"]) {
      expect({ field, selected: Boolean(select[field]) }).toEqual({
        field,
        selected: false,
      });
    }
  });

  test("reads this list's own variables, in the project the address names", async () => {
    await renderList({ pageCase });

    const query: Record<string, unknown> = lastListRequest().query;

    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());

    if (pageCase.workflowId) {
      expect(String(query["workflowId"])).toBe(pageCase.workflowId.toString());
    } else {
      expect(query["workflowId"]).toBeInstanceOf(IsNull);
    }
  });

  test("the Columns picker offers Name and Description, and no Type", async () => {
    await renderList({ pageCase });
    await openColumnsPicker();

    expect(getPickerColumnIds()).toEqual(["name", "description"]);

    const picker: HTMLElement = screen.getByTestId(
      "column-customization-modal",
    );

    expect(within(picker).queryByText("Type")).not.toBeInTheDocument();
  });

  /*
   * A layout outlives the release that saved it. One arranged while the
   * Type column was there keeps the viewer's order, without the column.
   */
  test("a column order saved while the Type column was there keeps its order, without Type", async () => {
    saveColumnLayout({
      order: ["description", "variableType", "name"],
      hidden: [],
    });

    await renderList({ pageCase });

    expect(getHeaders()).toEqual([
      "Select all items",
      "Description",
      "Name",
      "Actions",
    ]);
  });

  test("a viewer who had switched the Type column off sees Name and Description", async () => {
    saveColumnLayout({
      order: ["name", "variableType", "description"],
      hidden: ["variableType"],
    });

    await renderList({ pageCase });

    expect(getHeaders()).toEqual([
      "Select all items",
      "Name",
      "Description",
      "Actions",
    ]);
  });

  test("Export CSV writes the Name and Description columns, and no type", async () => {
    await renderList({ pageCase });

    // The header checkbox selects every row and brings up the bulk bar.
    await click(screen.getByRole("checkbox", { name: "Select all items" }));
    await click(screen.getByText("Bulk Actions"));

    await waitFor(() => {
      expect(screen.queryByText("Export CSV")).not.toBeNull();
    });

    await click(screen.getByText("Export CSV"));

    await waitFor(() => {
      expect(downloadedCsvFiles).toHaveLength(1);
    });

    const lines: Array<string> = (downloadedCsvFiles[0]?.csv || "").split(
      "\r\n",
    );

    expect(lines[0]).toBe("Name,Description");
    expect(lines).toContain(`${STATIC_ROW.name},${STATIC_ROW.description}`);
    expect(lines).toContain(
      `${CLIENT_CREDENTIALS_ROW.name},${CLIENT_CREDENTIALS_ROW.description}`,
    );

    const csv: string = downloadedCsvFiles[0]?.csv || "";

    for (const text of TYPE_TEXT) {
      expect({ text, inCsv: csv.includes(text) }).toEqual({
        text,
        inCsv: false,
      });
    }
  });

  test("a German viewer reads Name and Beschreibung, and no Typ", async () => {
    await renderList({ pageCase, language: german });

    expect(getHeaders()).toEqual([
      "Alle Elemente auswählen",
      "Name",
      "Beschreibung",
      "Aktionen",
    ]);

    expect(
      screen.queryByRole("columnheader", { name: "Typ" }),
    ).not.toBeInTheDocument();
  });
});
