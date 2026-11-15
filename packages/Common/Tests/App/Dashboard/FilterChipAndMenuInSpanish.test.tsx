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
 * ONE OPTION, ONE READING: A FILTER'S MENU AND ITS CHIP AGREE (#7690).
 *
 * An option's label reads by one rule (DropdownOption.isUserContent): the
 * product's words, looked up in the reader's language, or a name - a
 * record's, a product's - drawn as written. The menu kept the rule; the
 * chip a filter leaves above its table drew every label as written, and a
 * filter of records looked every record's name up. So, in Spanish:
 *
 *   - the Health filter read "Con problemas" in its menu, and "Unhealthy"
 *     in its chip;
 *   - a monitor named "Network" read "Red" in the Monitors filter's menu,
 *     and "Network" in its rows;
 *   - the email provider Resend read "Reenviar" - the verb - in the
 *     Provider filter's menu, beside "Resend" in its rows.
 *
 * The real pages and tables, in Spanish, over a fake ModelAPI: each
 * filter is opened from a link that picks its value, then its Edit Filters
 * menu is read. FilterOptionLabelsGuard keeps every other filter to the
 * same rule.
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
            return "76900000-0000-4000-8000-000000000001";
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
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudHealthSeverity } from "../../../Types/Cloud/CloudResourceHealth";
import MailTransportType from "../../../Types/Email/MailTransportType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import ModelTable from "../../../UI/Components/ModelTable/ModelTable";
import FieldType from "../../../UI/Components/Types/FieldType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getCloudProviderOptions } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudProviderOptions";
import CustomSMTPTable, {
  EMAIL_PROVIDER_FILTER_OPTIONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomSMTP/CustomSMTPTable";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import CloudAccounts from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/Accounts";
import CloudAccountResources from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Resources";
import Slos from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Slos";
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

// An Azure account, with one unhealthy virtual machine.
const AZURE_ACCOUNT_ROW_ID: string = "76900000-0000-4000-8000-000000000010";
const SUBSCRIPTION: string = "00000000-0000-4000-8000-0000000076aa";

const AZURE_ACCOUNT: CloudAccount = Object.assign(new CloudAccount(), {
  _id: AZURE_ACCOUNT_ROW_ID,
  name: "Production",
  provider: CloudProvider.Azure,
  accountId: SUBSCRIPTION,
});

const UNHEALTHY_VM: CloudResource = Object.assign(new CloudResource(), {
  _id: "76900000-0000-4000-8000-000000000011",
  name: "web-01",
  cloudProvider: CloudProvider.Azure,
  cloudAccountId: SUBSCRIPTION,
  cloudResourceType: "Microsoft.Compute/virtualMachines",
  cloudRegion: "westeurope",
  providerResourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/web/providers/Microsoft.Compute/virtualMachines/web-01`,
  healthSeverity: CloudHealthSeverity.Critical,
});

/*
 * Three monitors: two named with words the Dashboard translates - one of
 * them a name OneUptime gives an incident's state - and one not.
 */
const NETWORK_MONITOR: Monitor = Object.assign(new Monitor(), {
  _id: "76900000-0000-4000-8000-000000000021",
  name: "Network",
});
const CHECKOUT_MONITOR: Monitor = Object.assign(new Monitor(), {
  _id: "76900000-0000-4000-8000-000000000022",
  name: "Checkout API",
});
const RESOLVED_MONITOR: Monitor = Object.assign(new Monitor(), {
  _id: "76900000-0000-4000-8000-000000000024",
  name: "Resolved",
});

/*
 * A project's alert severities and states: the ones every new project
 * starts with, OneUptime's words, and one the project named itself.
 */
const ALERT_SEVERITIES: Array<AlertSeverity> = [
  ["76900000-0000-4000-8000-000000000051", "High"],
  ["76900000-0000-4000-8000-000000000052", "Low"],
  ["76900000-0000-4000-8000-000000000053", "Network"],
].map(([id, name]: Array<string>): AlertSeverity => {
  return Object.assign(new AlertSeverity(), { _id: id, name });
});
const ALERT_STATES: Array<AlertState> = [
  ["76900000-0000-4000-8000-000000000061", "Identified"],
  ["76900000-0000-4000-8000-000000000062", "Resolved"],
  ["76900000-0000-4000-8000-000000000063", "Network"],
].map(([id, name]: Array<string>): AlertState => {
  return Object.assign(new AlertState(), { _id: id, name });
});

const DISK_ALERT: Alert = Object.assign(new Alert(), {
  _id: "76900000-0000-4000-8000-000000000071",
  title: "Disk full",
});

const NETWORK_SLO: ServiceLevelObjective = Object.assign(
  new ServiceLevelObjective(),
  {
    _id: "76900000-0000-4000-8000-000000000023",
    name: "Office uptime",
    monitors: [NETWORK_MONITOR],
  },
);

// A Google Cloud project, connected as an account.
const GCP_ACCOUNT: CloudAccount = Object.assign(new CloudAccount(), {
  _id: "76900000-0000-4000-8000-000000000031",
  name: "shop-prod",
  provider: CloudProvider.GCP,
  accountId: "shop-prod",
});

// A project's mail, sent through Resend.
const RESEND_CONFIG: ProjectSmtpConfig = Object.assign(
  new ProjectSmtpConfig(),
  {
    _id: "76900000-0000-4000-8000-000000000041",
    name: "Transactional mail",
    transportType: MailTransportType.Resend,
    fromEmail: "alerts@example.com",
  },
);

// What each list holds, by the model it lists.
function rowsOf(modelType: { new (): BaseModel }): Array<BaseModel> {
  if (modelType === CloudResource) {
    return [UNHEALTHY_VM];
  }

  if (modelType === Monitor) {
    return [NETWORK_MONITOR, CHECKOUT_MONITOR, RESOLVED_MONITOR];
  }

  if (modelType === AlertSeverity) {
    return ALERT_SEVERITIES;
  }

  if (modelType === AlertState) {
    return ALERT_STATES;
  }

  if (modelType === Alert) {
    return [DISK_ALERT];
  }

  if (modelType === ServiceLevelObjective) {
    return [NETWORK_SLO];
  }

  if (modelType === CloudAccount) {
    return [GCP_ACCOUNT];
  }

  if (modelType === ProjectSmtpConfig) {
    return [RESEND_CONFIG];
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
  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
      }): Promise<BaseModel | null> => {
        return options.modelType === CloudAccount ? AZURE_ACCOUNT : null;
      },
    );
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

// The Filter dialog, opened from the chips' Edit Filters.
async function openFilters(): Promise<void> {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: spanish("Edit Filters") }),
    );
  });
  await settle();
}

/*
 * Edit Filters, then one filter's menu: the values it has picked, and every
 * value it offers.
 */
async function openFilterMenu(field: string): Promise<{
  picked: Array<string>;
  options: Array<string>;
}> {
  await openFilters();

  return readFilterMenu(field);
}

// One filter's menu in the open Filter dialog, read and closed again.
async function readFilterMenu(field: string): Promise<{
  picked: Array<string>;
  options: Array<string>;
}> {
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

  const options: Array<string> = within(menu)
    .getAllByTestId("dropdown-option-label")
    .map((option: HTMLElement): string => {
      return option.textContent || "";
    });

  await act(async () => {
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
  });
  await settle();

  return { picked, options };
}

describe("the words the cases below lean on", () => {
  test("Spanish has words of its own for Unhealthy, Network and Resend, and writes Google Cloud as it is", () => {
    expect(spanish("Unhealthy")).toBe("Con problemas");
    expect(spanish("Degraded")).toBe("Degradado");
    expect(spanish("Network")).toBe("Red");
    expect(spanish("Resend")).toBe("Reenviar");
    expect(spanish("Google Cloud")).toBe("Google Cloud");
  });
});

describe("a Spanish cloud account's resources, filtered to the unhealthy", () => {
  test("the Health filter's chip and its menu read the same Spanish word", async () => {
    await renderFiltered({
      path: `cloud/accounts/${AZURE_ACCOUNT_ROW_ID}/resources`,
      tableId: "cloud-account-resources-table",
      filter: { healthSeverity: CloudHealthSeverity.Critical },
      element: <CloudAccountResources {...pageProps("cloud/accounts")} />,
    });

    expect(await screen.findByText("web-01")).toBeInTheDocument();

    // The chip: "Salud es Con problemas", never "Salud es Unhealthy".
    expect(chipOf(spanish("Health"))).toBe(
      `${spanish("Health")} es Con problemas`,
    );

    const menu: { picked: Array<string>; options: Array<string> } =
      await openFilterMenu(spanish("Health"));

    expect(menu.picked).toEqual(["Con problemas"]);
    expect(menu.options).toEqual(["Con problemas", "Degradado"]);
  });
});

// The SLO list, opened from a link that filters it to one monitor.
async function renderSlosOfMonitor(monitor: Monitor): Promise<void> {
  await renderFiltered({
    path: "slos",
    tableId: "slos-table",
    filter: {
      monitors: new Includes([monitor._id as string]),
    } as unknown as JSONObject,
    element: <Slos {...pageProps("slos")} />,
  });

  expect(await screen.findByText("Office uptime")).toBeInTheDocument();
}

describe("a Spanish SLO list, filtered to a monitor named Network", () => {
  test("the monitor reads Network in the row, the Monitors filter's chip and its picked value - never Red", async () => {
    await renderSlosOfMonitor(NETWORK_MONITOR);

    // The row: the SLO's monitor, by its name.
    const row: HTMLElement = screen
      .getByText("Office uptime")
      .closest("tr") as HTMLElement;

    expect(within(row).getByText("Network")).toBeInTheDocument();
    expect(within(row).queryByText("Red")).toBeNull();

    // The chip: "Monitores es Network".
    expect(chipOf(spanish("Monitors"))).toBe(
      `${spanish("Monitors")} es Network`,
    );

    /*
     * A multi-select's menu leaves out what it has picked: the rest, a
     * monitor named "Resolved" as written too.
     */
    const menu: { picked: Array<string>; options: Array<string> } =
      await openFilterMenu(spanish("Monitors"));

    expect(menu.picked).toEqual(["Network"]);
    expect(menu.options).toEqual(["Checkout API", "Resolved"]);
  });

  test("and Network in the menu of a list filtered to another monitor", async () => {
    await renderSlosOfMonitor(CHECKOUT_MONITOR);

    expect(chipOf(spanish("Monitors"))).toBe(
      `${spanish("Monitors")} es Checkout API`,
    );

    const menu: { picked: Array<string>; options: Array<string> } =
      await openFilterMenu(spanish("Monitors"));

    expect(menu.picked).toEqual(["Checkout API"]);
    expect(menu.options).toEqual(["Network", "Resolved"]);
  });
});

describe("a Spanish alert list's filters of severities, states and monitors", () => {
  test("a new project's severities and states in Spanish, every name a project gave as written", async () => {
    await renderFiltered({
      path: "alerts",
      tableId: "alerts-filter-words",
      filter: { monitor: NETWORK_MONITOR._id as string },
      element: (
        <ModelTable<Alert>
          modelType={Alert}
          id="alerts-filter-words"
          name="Alerts"
          userPreferencesKey="alerts-filter-words"
          isCreateable={false}
          isEditable={false}
          isDeleteable={false}
          isViewable={false}
          cardProps={{ title: "Alerts", description: "Alerts" }}
          columns={[
            { field: { title: true }, title: "Title", type: FieldType.Text },
          ]}
          filters={[
            {
              field: { alertSeverity: true },
              title: "Severity",
              type: FieldType.Entity,
              filterEntityType: AlertSeverity,
              filterQuery: {},
              filterDropdownField: { label: "name", value: "_id" },
            },
            {
              field: { currentAlertState: true },
              title: "State",
              type: FieldType.Entity,
              filterEntityType: AlertState,
              filterQuery: {},
              filterDropdownField: { label: "name", value: "_id" },
            },
            {
              field: { monitor: true },
              title: "Monitor",
              type: FieldType.Entity,
              filterEntityType: Monitor,
              filterQuery: {},
              filterDropdownField: { label: "name", value: "_id" },
            },
          ]}
        />
      ),
    });

    expect(await screen.findByText("Disk full")).toBeInTheDocument();
    expect(chipOf(spanish("Monitor"))).toBe(`${spanish("Monitor")} es Network`);

    await openFilters();

    // OneUptime's words for a new project's, in Spanish; the project's own as written.
    expect((await readFilterMenu(spanish("Severity"))).options).toEqual([
      spanish("High"),
      spanish("Low"),
      "Network",
    ]);
    expect((await readFilterMenu(spanish("State"))).options).toEqual([
      spanish("Identified"),
      spanish("Resolved"),
      "Network",
    ]);

    // A monitor is the project's, whatever its name: "Resolved", never "Resuelto".
    expect((await readFilterMenu(spanish("Monitor"))).options).toEqual([
      "Network",
      "Checkout API",
      "Resolved",
    ]);
  });
});

describe("a Spanish list filtered by a product's name", () => {
  test("the clouds are named as they name themselves, and marked so", async () => {
    // Every cloud is drawn as written, never looked up as a word.
    expect(
      getCloudProviderOptions().map((option: DropdownOption) => {
        return [option.label, option.isUserContent];
      }),
    ).toEqual([
      ["AWS", true],
      ["Google Cloud", true],
      ["Azure", true],
    ]);

    await renderFiltered({
      path: "cloud/accounts",
      tableId: "cloud-accounts-table",
      filter: { provider: CloudProvider.GCP },
      element: <CloudAccounts {...pageProps("cloud/accounts")} />,
    });

    expect(await screen.findByText("shop-prod")).toBeInTheDocument();
    expect(chipOf(spanish("Cloud"))).toBe(
      `${spanish("Cloud")} es Google Cloud`,
    );

    const menu: { picked: Array<string>; options: Array<string> } =
      await openFilterMenu(spanish("Cloud"));

    expect(menu.picked).toEqual(["Google Cloud"]);
    expect(menu.options).toEqual(["AWS", "Google Cloud", "Azure"]);
  });

  test("REGRESSION: the email provider Resend reads Resend in the Provider filter's menu and chip, never Reenviar", async () => {
    await renderFiltered({
      path: "settings/notification-settings",
      tableId: "smtp-table",
      filter: { transportType: MailTransportType.Resend },
      element: <CustomSMTPTable />,
    });

    expect(await screen.findByText("Transactional mail")).toBeInTheDocument();
    expect(chipOf(spanish("Provider"))).toBe(
      `${spanish("Provider")} es Resend`,
    );

    const menu: { picked: Array<string>; options: Array<string> } =
      await openFilterMenu(spanish("Provider"));

    expect(menu.picked).toEqual(["Resend"]);
    expect(menu.options).toEqual([
      spanish("SMTP Server"),
      "Amazon SES",
      "SendGrid",
      "Mailgun",
      "Postmark",
      "Resend",
      spanish("Microsoft Graph"),
    ]);
    expect(menu.options).not.toContain("Reenviar");

    // Each product's name marked as written; the words "SMTP Server" looked up.
    expect(
      EMAIL_PROVIDER_FILTER_OPTIONS.filter((option: DropdownOption) => {
        return option.isUserContent;
      }).map((option: DropdownOption) => {
        return option.label;
      }),
    ).toEqual(["Amazon SES", "SendGrid", "Mailgun", "Postmark", "Resend"]);
  });
});
