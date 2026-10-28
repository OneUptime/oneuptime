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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import DataSecurityScanning, {
  NEVER_SENSITIVE_TITLE,
  SCAN_LIMITS,
  SCAN_LIMITS_TITLE,
  SCANNING_CLOUD_ACCOUNTS_TEST_ID,
  SCANNING_ISSUES_CARD_TEST_ID,
  SCANNING_MORE_SETTINGS_TEST_ID,
  SCANNING_READS_CARD_TEST_ID,
  hasChangedScanLimits,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/Settings/Scanning";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecuritySetting from "../../../Models/DatabaseModels/DataSecuritySetting";
import { DATA_SECURITY_LIMITS } from "../../../Server/Services/DataSecuritySettingService";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import {
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

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
 * Data Security > Settings > Scanning (Pages/DataSecurity/Settings/Scanning),
 * rendered for real - the page, its switch rows, the cloud accounts card,
 * More settings and the cards folded in it - with only the network and the
 * permission snapshot stubbed:
 *
 *   - the switches come first, each its own row; More settings comes last,
 *     folded every time the page opens, naming what it holds - Scan Limits
 *     and Never Sensitive - and showing as chips the ones that are set;
 *   - a project that has no settings yet gets them, made with nothing but
 *     the project (the server fills in every default), as the server's own
 *     getOrCreateForProject does;
 *   - the alert severity is asked for under Raise alerts, only while it is on;
 *   - the cloud accounts card names the three levels a cloud connection
 *     grants and leads to the connections;
 *   - a link that names a card in More settings after the page's "#" opens
 *     it there (MoreSettingsFoldsGuard holds every fold to this).
 */

configure({ asyncUtilTimeout: 15000 });

const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/data-security/settings/scanning`;

const SETTING_ID: string = "5d5d5d5d-0000-4000-8000-000000000005";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(PAGE_PATH),
  currentProject: null,
  hasPaymentMethod: true,
};

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
  Permission.ProjectOwner,
];

// The project's settings as the server holds them; null when none are made.
let stored: Record<string, unknown> | null = null;
let created: Array<DataSecuritySetting> = [];
let updates: Array<JSONObject> = [];

// Every default, as the server makes a project's settings.
const DEFAULTS: Record<string, unknown> = {
  isConfigurationScanEnabled: true,
  isContentScanEnabled: true,
  isTelemetryScanEnabled: true,
  keepMaskedSamples: true,
  openCasesForCriticalIssues: true,
  raiseAlertsForCriticalIssues: false,
  notifyOwners: true,
  useAiForAmbiguousFields: false,
  maxObjectsPerScan: 2000,
  maxBytesPerObject: 65536,
  maxBytesPerScan: 52428800,
  maxRowsPerTable: 1000,
  maxTablesPerScan: 200,
  telemetrySampleSize: 500,
  contentScanIntervalInHours: 24,
  allowedValues: [],
  disabledDataTypeIds: [],
};

function settingOf(values: Record<string, unknown>): DataSecuritySetting {
  const setting: DataSecuritySetting = new DataSecuritySetting();

  Object.assign(setting, values);
  setting._id = SETTING_ID;
  setting.projectId = new ObjectID(PROJECT_ID);

  return setting;
}

function storeSettings(values: Record<string, unknown> = {}): void {
  stored = { ...DEFAULTS, ...values };
}

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
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

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  grant(BASE_PERMISSIONS);
  stored = null;
  created = [];
  updates = [];

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (data: unknown): Promise<ListResult<BaseModel>> => {
        const modelType: { new (): BaseModel } = (
          data as { modelType: { new (): BaseModel } }
        ).modelType;

        if (modelType === DataSecuritySetting) {
          const rows: Array<BaseModel> = stored ? [settingOf(stored)] : [];

          return { data: rows, count: rows.length, skip: 0, limit: 1 };
        }

        if (modelType === AlertSeverity) {
          const rows: Array<BaseModel> = ["Critical", "Major"].map(
            (name: string, index: number): BaseModel => {
              const severity: AlertSeverity = new AlertSeverity();
              severity._id = `6e6e6e6e-0000-4000-8000-00000000000${index}`;
              severity.name = name;
              severity.order = index + 1;
              return severity;
            },
          );

          return { data: rows, count: rows.length, skip: 0, limit: 50 };
        }

        return { data: [], count: 0, skip: 0, limit: 10 };
      },
    );

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<BaseModel | null> => {
      return stored ? settingOf(stored) : null;
    });

  jest
    .spyOn(ModelAPI, "create")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const model: DataSecuritySetting = (
        data as { model: DataSecuritySetting }
      ).model;

      created.push(model);
      storeSettings();

      return new HTTPResponse<JSONObject>(
        200,
        { _id: SETTING_ID },
        {},
      ) as unknown as never;
    });

  jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const change: JSONObject = (data as { data: JSONObject }).data;

      updates.push(change);
      stored = { ...(stored || DEFAULTS), ...change };

      return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
    });

  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(async (): Promise<number> => {
      return 0;
    });
  jest.spyOn(API, "post").mockImplementation(async (): Promise<never> => {
    return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
  });
  jest.spyOn(API, "get").mockImplementation(async (): Promise<never> => {
    return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#");
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 6; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

// The page opened at its address, and `#hash` after it when given.
async function renderPage(hash?: string): Promise<HTMLElement> {
  goTo(PAGE_PATH);

  if (hash) {
    window.history.replaceState(null, "", `#${hash}`);
  }

  render(
    <MemoryRouter initialEntries={[`${PAGE_PATH}${hash ? `#${hash}` : ""}`]}>
      <DataSecurityScanning {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  const fold: HTMLElement = await screen.findByTestId(
    SCANNING_MORE_SETTINGS_TEST_ID,
  );

  await settle();

  return fold;
}

function header(fold: HTMLElement): HTMLElement {
  return within(fold).getByTestId("folded-section-header");
}

function isBefore(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("Data Security > Settings > Scanning", () => {
  test("the switches come first, then the cloud accounts, then More settings, folded", async () => {
    storeSettings();

    const fold: HTMLElement = await renderPage();

    const reads: HTMLElement = screen.getByTestId(SCANNING_READS_CARD_TEST_ID);
    const issues: HTMLElement = screen.getByTestId(
      SCANNING_ISSUES_CARD_TEST_ID,
    );
    const cloud: HTMLElement = screen.getByTestId(
      SCANNING_CLOUD_ACCOUNTS_TEST_ID,
    );

    expect(isBefore(reads, issues)).toBe(true);
    expect(isBefore(issues, cloud)).toBe(true);
    expect(isBefore(cloud, fold)).toBe(true);

    for (const testId of [
      "data-security-check-configuration",
      "data-security-scan-content",
      "data-security-scan-telemetry",
      "data-security-keep-masked-samples",
      "data-security-ask-ai",
    ]) {
      expect(within(reads).getByTestId(`${testId}-row`)).toBeInTheDocument();
    }

    for (const testId of [
      "data-security-open-cases",
      "data-security-raise-alerts",
      "data-security-notify-owners",
    ]) {
      expect(within(issues).getByTestId(`${testId}-row`)).toBeInTheDocument();
    }

    expect(header(fold)).toHaveAttribute("aria-expanded", "false");
    expect(within(fold).getByTestId("folded-section-body")).toHaveClass(
      "invisible",
    );
  });

  test("a switch shows what is stored, and saves only its own column", async () => {
    storeSettings({ isTelemetryScanEnabled: false });

    await renderPage();

    const telemetry: HTMLElement = screen.getByTestId(
      "data-security-scan-telemetry",
    );

    expect(telemetry).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("data-security-scan-content")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await act(async () => {
      fireEvent.click(telemetry);
    });
    await settle();

    await waitFor(() => {
      expect(updates).toEqual([{ isTelemetryScanEnabled: true }]);
    });
  });

  test("a project with no settings yet gets them, made with the project alone", async () => {
    await renderPage();

    expect(created).toHaveLength(1);
    expect(created[0]?.projectId?.toString()).toBe(PROJECT_ID);
    // The server fills in every default: nothing else is sent.
    expect(created[0]?.isContentScanEnabled).toBeUndefined();
    expect(screen.getByTestId(SCANNING_READS_CARD_TEST_ID)).toBeInTheDocument();
  });

  test("a project that has its settings is not given another row", async () => {
    storeSettings();

    await renderPage();

    expect(created).toEqual([]);
  });

  test("the alert severity is asked for under Raise alerts, only while it is on", async () => {
    storeSettings({ raiseAlertsForCriticalIssues: false });

    await renderPage();

    expect(screen.queryByTestId("data-security-alert-severity")).toBeNull();

    cleanup();
    storeSettings({ raiseAlertsForCriticalIssues: true });

    await renderPage();

    const picker: HTMLElement = screen.getByTestId(
      "data-security-alert-severity",
    );

    expect(
      within(screen.getByTestId("data-security-raise-alerts-children")),
    ).toBeTruthy();
    expect(
      screen.getByTestId("data-security-raise-alerts-children"),
    ).toContainElement(picker);
    expect(picker).toHaveTextContent("Alert Severity");
  });

  test("the cloud accounts card names the three levels and leads to the connections", async () => {
    storeSettings();

    await renderPage();

    const cloud: HTMLElement = screen.getByTestId(
      SCANNING_CLOUD_ACCOUNTS_TEST_ID,
    );

    expect(cloud).toHaveTextContent("Off");
    expect(cloud).toHaveTextContent("Configuration only");
    expect(cloud).toHaveTextContent("Configuration and content samples");

    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return undefined;
      });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Open Cloud Connections" }),
      );
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]?.[0])).toBe(
      `/dashboard/${PROJECT_ID}/cloud/connect`,
    );
  });
});

describe("More settings on the Scanning page", () => {
  test("folded, it names the cards it holds, none of them set at the defaults", async () => {
    storeSettings();

    const fold: HTMLElement = await renderPage();

    expect(listedNames(fold)).toEqual([
      SCAN_LIMITS_TITLE,
      NEVER_SENSITIVE_TITLE,
    ]);
    expect(setChips(fold)).toEqual([]);
  });

  test("folded, a changed limit and the never-sensitive values show as chips", async () => {
    storeSettings({
      maxObjectsPerScan: 5000,
      allowedValues: ["support@example.com", "4242424242424242"],
    });

    const fold: HTMLElement = await renderPage();

    await waitFor(() => {
      expect(setChips(fold)).toEqual([
        `${SCAN_LIMITS_TITLE}: Changed`,
        `${NEVER_SENSITIVE_TITLE}: 2`,
      ]);
    });

    // Still folded: knowing they are set does not need it open.
    expect(header(fold)).toHaveAttribute("aria-expanded", "false");
  });

  test("opened, it holds the scan limits and the never-sensitive values", async () => {
    storeSettings({ allowedValues: ["support@example.com"] });

    const fold: HTMLElement = await renderPage();

    await act(async () => {
      fireEvent.click(header(fold));
    });
    await settle();

    expect(header(fold)).toHaveAttribute("aria-expanded", "true");

    const body: HTMLElement = within(fold).getByTestId("folded-section-body");

    expect(body).not.toHaveClass("invisible");
    expect(within(body).getByText("Objects Per Scan")).toBeVisible();
    expect(within(body).getByText("Scan Every (Hours)")).toBeVisible();
    expect(within(body).getByText("support@example.com")).toBeVisible();
    // A size is said in words too.
    expect(body).toHaveTextContent("52,428,800 bytes (50 MB)");
  });

  test("each name it lists is the place of a card in it", async () => {
    storeSettings();

    const fold: HTMLElement = await renderPage();

    for (const key of ["scan-limits", "never-sensitive"]) {
      const place: HTMLElement | null = document.getElementById(key);

      expect({ key, isInFold: Boolean(place && fold.contains(place)) }).toEqual(
        { key, isInFold: true },
      );
    }
  });

  test("opened at #scan-limits, More settings opens there", async () => {
    storeSettings();
    window.history.replaceState(null, "", "#scan-limits");

    const fold: HTMLElement = await renderPage("scan-limits");

    expect(header(fold)).toHaveAttribute("aria-expanded", "true");
  });

  test("opened at #never-sensitive, More settings opens there", async () => {
    storeSettings();

    const fold: HTMLElement = await renderPage("never-sensitive");

    expect(header(fold)).toHaveAttribute("aria-expanded", "true");
  });

  test("opened anywhere else, it stays folded", async () => {
    storeSettings();

    const fold: HTMLElement = await renderPage("cloud-accounts");

    expect(header(fold)).toHaveAttribute("aria-expanded", "false");
  });
});

describe("the scan limits the page holds a form to", () => {
  test("are the server's ranges (DATA_SECURITY_LIMITS) and its columns' defaults", () => {
    expect(Object.keys(SCAN_LIMITS).sort()).toEqual(
      Object.keys(DATA_SECURITY_LIMITS).sort(),
    );

    const model: DataSecuritySetting = new DataSecuritySetting();

    for (const [column, limit] of Object.entries(SCAN_LIMITS)) {
      expect({
        column,
        min: limit.min,
        max: limit.max,
        defaultValue: limit.defaultValue,
      }).toEqual({
        column,
        min: DATA_SECURITY_LIMITS[column]?.min,
        max: DATA_SECURITY_LIMITS[column]?.max,
        defaultValue: model.getTableColumnMetadata(column)?.defaultValue,
      });
    }
  });

  test("a setting is changed only when a limit is not its default", () => {
    expect(hasChangedScanLimits(null)).toBe(false);
    expect(hasChangedScanLimits(settingOf(DEFAULTS))).toBe(false);
    expect(
      hasChangedScanLimits(settingOf({ ...DEFAULTS, maxTablesPerScan: 10 })),
    ).toBe(true);
  });
});
