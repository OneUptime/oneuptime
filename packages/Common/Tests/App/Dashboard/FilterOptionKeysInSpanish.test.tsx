// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * EVERY FILTER'S WORDS IN THE READER'S LANGUAGE, AS ITS ROWS READ THEM (#7781).
 *
 * 72 options in 15 filters had no key in any locale, so every language read
 * them in English - and three were stored values no language reads:
 * "WaitingForManualStep", "TimedOut", "MicrosoftTeams". So, in Spanish:
 *
 *   - Runbook executions: a run's pill read "Esperando", and the Status
 *     filter offered it as "WaitingForManualStep";
 *   - Data observability's schema changes: the Change filter offered
 *     "Column added", "Table dropped"... in English;
 *   - a workspace's notification logs: Microsoft Teams read "MicrosoftTeams"
 *     in the Workspace filter's menu, its chip and the Workspace column;
 *   - a project's invoices: an open invoice's status was looked up as the
 *     Open button's verb, "Abrir" ("open it"), in its pill and its filter.
 *
 * The real pages and tables, in Spanish, over a fake ModelAPI: each list is
 * opened from a link that picks a filter's value, then the filter's chip,
 * its menu and the rows are read. FilterOptionLabelsGuard keeps every other
 * filter to the same rule.
 */

configure({ asyncUtilTimeout: 15000 });

jest.setTimeout(120000);

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      // A project owner: may read every list below.
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

// The invoices page loads Stripe's script only to pay: never here.
jest.mock(
  "@stripe/stripe-js/pure",
  () => {
    return {
      loadStripe: async () => {
        return {};
      },
    };
  },
  { virtual: true },
);

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "77810000-0000-4000-8000-000000000001";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BillingInvoice, {
  InvoiceStatus,
} from "../../../Models/DatabaseModels/BillingInvoice";
import DataAssetFeed, {
  DataAssetFeedEventType,
} from "../../../Models/DatabaseModels/DataAssetFeed";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RunbookExecutionStatus from "../../../Types/Runbook/RunbookExecutionStatus";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import WorkspaceLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WorkspaceLogsTable";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DataObservabilitySchemaChangesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/SchemaChanges";
import RunbooksExecutions from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Executions";
import SettingsInvoices from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Invoices";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { PROJECT_ID } from "./SideMenuHarness";

const SPANISH: Record<string, string> = readDashboardLocale("es");

// A Spanish word of the Dashboard's, which every case below reads.
function spanish(english: string): string {
  const word: string | undefined = SPANISH[english];

  if (!word) {
    throw new Error(`Spanish has no word for "${english}"`);
  }

  return word;
}

// A run of a runbook, waiting on its manual step.
const WAITING_RUN: RunbookExecution = Object.assign(new RunbookExecution(), {
  _id: "77810000-0000-4000-8000-000000000011",
  runbookId: new ObjectID("77810000-0000-4000-8000-000000000012"),
  runbookNameSnapshot: "Restart the web tier",
  status: RunbookExecutionStatus.WaitingForManualStep,
  createdAt: new Date("2026-11-13T09:00:00Z"),
});

// A column added to a watched table.
const COLUMN_ADDED: DataAssetFeed = Object.assign(new DataAssetFeed(), {
  _id: "77810000-0000-4000-8000-000000000021",
  dataAssetFeedEventType: DataAssetFeedEventType.ColumnAdded,
  feedInfoInMarkdown: "Column email added.",
  postedAt: new Date("2026-11-13T09:00:00Z"),
});

// A message posted to a Microsoft Teams channel.
const TEAMS_MESSAGE: WorkspaceNotificationLog = Object.assign(
  new WorkspaceNotificationLog(),
  {
    _id: "77810000-0000-4000-8000-000000000031",
    workspaceType: WorkspaceType.MicrosoftTeams,
    actionType: WorkspaceNotificationActionType.SendMessage,
    status: WorkspaceNotificationStatus.Success,
    channelName: "incident-war-room",
    createdAt: new Date("2026-11-13T09:00:00Z"),
  },
);

// An invoice issued and not yet paid.
const OPEN_INVOICE: BillingInvoice = Object.assign(new BillingInvoice(), {
  _id: "77810000-0000-4000-8000-000000000041",
  invoiceNumber: "INV-7781",
  status: InvoiceStatus.Open,
  amount: 1200,
  currencyCode: "usd",
  invoiceDate: new Date("2026-11-13T09:00:00Z"),
});

// What each list holds, by the model it lists.
function rowsOf(modelType: { new (): BaseModel }): Array<BaseModel> {
  if (modelType === BillingInvoice) {
    return [OPEN_INVOICE];
  }

  if (modelType === RunbookExecution) {
    return [WAITING_RUN];
  }

  if (modelType === DataAssetFeed) {
    return [COLUMN_ADDED];
  }

  if (modelType === WorkspaceNotificationLog) {
    return [TEAMS_MESSAGE];
  }

  return [];
}

function pageProps(path: string): PageComponentProps {
  return {
    pageRoute: new Route(`/dashboard/${PROJECT_ID}/${path}`),
    currentProject: null,
    hasPaymentMethod: true,
  } as unknown as PageComponentProps;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "es",
    fallbackLng: "en",
    resources: {
      es: { translation: SPANISH },
      en: { translation: readDashboardLocale("en") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null as never);
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        skip?: number;
        limit?: number;
      }): Promise<ListResult<BaseModel>> => {
        const data: Array<BaseModel> = rowsOf(options.modelType);

        return {
          data,
          count: data.length,
          skip: options.skip || 0,
          limit: options.limit || 10,
        } as ListResult<BaseModel>;
      },
    );
  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
      }): Promise<number> => {
        return rowsOf(options.modelType).length;
      },
    );
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// A list opened from a link that has already picked a filter's value.
async function renderFiltered(data: {
  path: string;
  tableId: string;
  filter: JSONObject;
  element: React.ReactElement;
}): Promise<void> {
  const params: Record<string, string> = TableFilterUrlState.getLinkQueryParams(
    data.tableId,
    { filter: data.filter },
  );
  const search: string = Object.keys(params)
    .map((name: string): string => {
      return `${name}=${params[name]}`;
    })
    .join("&");

  window.history.replaceState(
    null,
    "",
    `/dashboard/${PROJECT_ID}/${data.path}?${search}`,
  );

  await act(async () => {
    render(<MemoryRouter>{data.element}</MemoryRouter>);
  });
  await settle();
}

// The chip over the list that starts with a filter's name.
function chipOf(field: string): string {
  const chip: HTMLElement | undefined = Array.from(
    document.querySelectorAll<HTMLElement>(".rounded-full"),
  ).find((element: HTMLElement): boolean => {
    return (element.textContent || "").startsWith(`${field} `);
  });

  if (!chip) {
    throw new Error(`No chip for ${field}`);
  }

  return chip.textContent || "";
}

/*
 * Edit Filters, then one filter's menu: the values it has picked, and every
 * value it offers. The button is named in Spanish but where a case reads
 * the page in English.
 */
async function openFilterMenu(
  field: string,
  editFilters: string = spanish("Edit Filters"),
): Promise<{
  picked: Array<string>;
  options: Array<string>;
}> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: editFilters }));
  });
  await settle();

  const label: HTMLElement = screen.getByText(field, { selector: "label" });
  const row: HTMLElement = label.parentElement!.parentElement as HTMLElement;
  const picked: Array<string> = within(row)
    .queryAllByTestId("dropdown-value-label")
    .map((value: HTMLElement): string => {
      return value.textContent || "";
    });
  const input: HTMLInputElement | null = row.querySelector<HTMLInputElement>(
    "input[role='combobox']",
  );

  if (!input) {
    throw new Error(`The ${field} filter has no menu`);
  }

  await act(async () => {
    fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
  });
  await settle();

  const menu: HTMLElement | null =
    document.querySelector<HTMLElement>(".ou-select__menu");

  if (!menu) {
    throw new Error(`The ${field} menu did not open`);
  }

  return {
    picked,
    options: within(menu)
      .getAllByTestId("dropdown-option-label")
      .map((option: HTMLElement): string => {
        return option.textContent || "";
      }),
  };
}

// The row a text is drawn in.
function rowWith(text: string): HTMLElement {
  return screen.getByText(text).closest("tr") as HTMLElement;
}

describe("the words the cases below lean on", () => {
  test("Spanish has words of its own for a waiting run and an added column, and writes Microsoft Teams as it is", () => {
    expect(spanish("Waiting")).toBe("Esperando");
    expect(spanish("Column added")).toBe("Columna añadida");
    expect(spanish("Table dropped")).toBe("Tabla eliminada");
    expect(spanish("Microsoft Teams")).toBe("Microsoft Teams");
  });

  test("Spanish words an open invoice as a state, and the bare Open as the button's verb", () => {
    expect(spanish("Open (invoice status)")).toBe("Pendiente");
    expect(spanish("Open")).toBe("Abrir");
  });
});

describe("Spanish runbook executions, filtered to the runs waiting on a manual step: a list built from an enum", () => {
  test("the Status filter's chip, its menu and the run's pill read Esperando - never WaitingForManualStep", async () => {
    await renderFiltered({
      path: "runbooks/executions",
      tableId: "runbook-executions-table",
      filter: { status: RunbookExecutionStatus.WaitingForManualStep },
      element: <RunbooksExecutions {...pageProps("runbooks/executions")} />,
    });

    expect(await screen.findByText("Restart the web tier")).toBeInTheDocument();

    // The row: the run's status in the pill's word.
    expect(
      within(rowWith("Restart the web tier")).getByText("Esperando"),
    ).toBeInTheDocument();

    // The chip: "Estado es Esperando".
    expect(chipOf(spanish("Status"))).toBe(`${spanish("Status")} es Esperando`);

    const menu: { picked: Array<string>; options: Array<string> } =
      await openFilterMenu(spanish("Status"));

    expect(menu.picked).toEqual(["Esperando"]);
    expect(menu.options).toEqual(
      [
        "Scheduled",
        "Running",
        "Waiting",
        "Completed",
        "Failed",
        "Cancelled",
      ].map(spanish),
    );
    expect(document.body.textContent).not.toContain("WaitingForManualStep");
  });
});

describe("Spanish schema changes, filtered to the columns added: a list written by hand", () => {
  test("the Change filter's chip and its menu read every change in Spanish", async () => {
    await renderFiltered({
      path: "data-observability/schema-changes",
      tableId: "data-observability-schema-changes",
      filter: { dataAssetFeedEventType: DataAssetFeedEventType.ColumnAdded },
      element: (
        <DataObservabilitySchemaChangesPage
          {...pageProps("data-observability/schema-changes")}
        />
      ),
    });

    expect(await screen.findByText("Column email added.")).toBeInTheDocument();

    // The chip: "... es Columna añadida", never "Column added".
    expect(chipOf(spanish("Change"))).toBe(
      `${spanish("Change")} es Columna añadida`,
    );

    const menu: { picked: Array<string>; options: Array<string> } =
      await openFilterMenu(spanish("Change"));

    expect(menu.picked).toEqual(["Columna añadida"]);
    expect(menu.options).toEqual(
      [
        "Column added",
        "Column removed",
        "Column renamed",
        "Type changed",
        "Nullability changed",
        "Table dropped",
        "Table restored",
      ].map(spanish),
    );
    expect(menu.options).not.toContain("Table dropped");
  });
});

describe("a Spanish workspace's notification logs, filtered to Microsoft Teams: a product's name", () => {
  test("the Workspace filter's chip, its menu and the Workspace column read Microsoft Teams - never MicrosoftTeams", async () => {
    await renderFiltered({
      path: "settings/workspace-connection-logs",
      tableId: "workspace-logs-table",
      filter: { workspaceType: WorkspaceType.MicrosoftTeams },
      element: <WorkspaceLogsTable />,
    });

    expect(await screen.findByText("incident-war-room")).toBeInTheDocument();

    // The row: the product, by the name it gives itself.
    expect(
      within(rowWith("incident-war-room")).getByText("Microsoft Teams"),
    ).toBeInTheDocument();

    // The chip: "Espacio de trabajo es Microsoft Teams".
    expect(chipOf(spanish("Workspace"))).toBe(
      `${spanish("Workspace")} es Microsoft Teams`,
    );

    const menu: { picked: Array<string>; options: Array<string> } =
      await openFilterMenu(spanish("Workspace"));

    expect(menu.picked).toEqual(["Microsoft Teams"]);
    expect(menu.options).toEqual(["Slack", "Microsoft Teams", "Mattermost"]);
    expect(document.body.textContent).not.toContain("MicrosoftTeams");
  });
});

describe("Spanish invoices, filtered to the open ones: a state whose English is a button's verb", () => {
  const INVOICES: { path: string; tableId: string } = {
    path: "settings/invoices",
    tableId: "settings-invoices-table",
  };

  test("the Invoice Status filter's chip, its menu and the invoice's pill read Pendiente - never the Open button's Abrir", async () => {
    await renderFiltered({
      ...INVOICES,
      filter: { status: InvoiceStatus.Open },
      element: <SettingsInvoices {...pageProps(INVOICES.path)} />,
    });

    expect(await screen.findByText("INV-7781")).toBeInTheDocument();

    // The row: the invoice's state, not the verb.
    const row: HTMLElement = rowWith("INV-7781");

    expect(within(row).getByText("Pendiente")).toBeInTheDocument();
    expect(within(row).queryByText(spanish("Open"))).toBeNull();

    // The chip: "... es Pendiente".
    expect(chipOf(spanish("Invoice Status"))).toBe(
      `${spanish("Invoice Status")} es Pendiente`,
    );

    const menu: { picked: Array<string>; options: Array<string> } =
      await openFilterMenu(spanish("Invoice Status"));

    expect(menu.picked).toEqual(["Pendiente"]);
    expect(menu.options).toEqual(
      [
        "Paid",
        "Draft",
        "Void",
        "Uncollectible",
        "Deleted",
        "Open (invoice status)",
        "Undefined",
      ].map(spanish),
    );
    expect(menu.options).not.toContain(spanish("Open"));
  });

  test("in English, the open invoice still reads Open: the key's own English is never drawn", async () => {
    await i18next.changeLanguage("en");

    try {
      await renderFiltered({
        ...INVOICES,
        filter: { status: InvoiceStatus.Open },
        element: <SettingsInvoices {...pageProps(INVOICES.path)} />,
      });

      expect(await screen.findByText("INV-7781")).toBeInTheDocument();
      expect(within(rowWith("INV-7781")).getByText("Open")).toBeInTheDocument();
      expect(chipOf("Invoice Status")).toBe("Invoice Status is Open");

      const menu: { picked: Array<string>; options: Array<string> } =
        await openFilterMenu("Invoice Status", "Edit Filters");

      expect(menu.picked).toEqual(["Open"]);
      expect(menu.options).toEqual([
        "Paid",
        "Draft",
        "Void",
        "Uncollectible",
        "Deleted",
        "Open",
        "Undefined",
      ]);
      expect(document.body.textContent).not.toContain("(invoice status)");
    } finally {
      await i18next.changeLanguage("es");
    }
  });
});
