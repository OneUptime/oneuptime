import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import EnterpriseLicenseView from "../../../../App/FeatureSet/AdminDashboard/src/Pages/EnterpriseLicenses/View/Index";
import AdminModelAPI from "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI";
import EnterpriseLicense from "../../../Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseInstance from "../../../Models/DatabaseModels/EnterpriseLicenseInstance";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import OneUptimeDate from "../../../Types/Date";
import EnterpriseLicenseUsageSnapshot from "../../../Types/EnterpriseLicense/EnterpriseLicenseUsageSnapshot";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

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

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
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
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

/*
 * Keep the page's actual table, permission checks and cell renderers. Only
 * unrelated header, detail form and license deletion scaffolding are omitted.
 */
jest.mock("../../../UI/Components/Page/ModelPage", () => {
  return {
    __esModule: true,
    default: (props: { children: ReactNode }): ReactElement => {
      return <>{props.children}</>;
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

const LICENSE_ID: string = "00000000-0000-4000-8000-000000000001";
const INSTANCE_ID: string = "00000000-0000-4000-8000-000000000002";
const OTHER_INSTANCE_ID: string = "00000000-0000-4000-8000-000000000003";
const NOW: Date = new Date("2026-09-17T12:00:00.000Z");
const REPORT_TIME: Date = new Date("2026-09-17T08:00:00.000Z");
const REGISTRATION_TIME: Date = new Date("2026-09-15T10:30:00.000Z");
const OLD_REPORT_TIME: Date = new Date("2026-09-01T08:00:00.000Z");
const INACTIVE_NOTE: string = "Inactive — not counted towards seats";

interface InstanceRow {
  _id: string;
  instanceId: string;
  host: string;
  createdAt?: Date | undefined;
  lastReportedAt?: Date | undefined;
  userCount: number;
  oneuptimeVersion: string;
  masterAdminEmails: Array<string>;
}

interface ListRequest {
  modelType: typeof EnterpriseLicenseInstance;
  select: Record<string, unknown>;
  query: { enterpriseLicenseId: ObjectID };
  skip: number;
  limit: number;
}

let rows: Array<InstanceRow> = [];
let listRequests: Array<ListRequest> = [];
let snapshot: EnterpriseLicenseUsageSnapshot;

const makeRow: (overrides?: Partial<InstanceRow>) => InstanceRow = (
  overrides: Partial<InstanceRow> = {},
): InstanceRow => {
  return {
    _id: INSTANCE_ID,
    instanceId: "self-hosted-production",
    host: "production.example.com",
    createdAt: REGISTRATION_TIME,
    lastReportedAt: REPORT_TIME,
    userCount: 100,
    oneuptimeVersion: "13.0.0",
    masterAdminEmails: ["admin@example.com"],
    ...overrides,
  };
};

const formatted: (date: Date) => string = (date: Date): string => {
  return OneUptimeDate.getDateAsUserFriendlyFormattedString(date);
};

const renderPage: () => Promise<void> = async (): Promise<void> => {
  render(
    <MemoryRouter>
      <EnterpriseLicenseView />
    </MemoryRouter>,
  );

  await screen.findByText(rows[0]!.host);
  await screen.findByText(`Last reported ${formatted(REPORT_TIME)}`);
};

const getRow: (host?: string) => HTMLElement = (
  host: string = "production.example.com",
): HTMLElement => {
  const row: HTMLElement | null = screen.getByText(host).closest("tr");

  if (!row) {
    throw new Error(`No table row for ${host}`);
  }

  return row;
};

beforeEach(() => {
  rows = [makeRow()];
  listRequests = [];
  snapshot = {
    currentUserCount: 100,
    activeInstanceIds: [INSTANCE_ID],
    masterAdminEmails: ["admin@example.com"],
    calculatedAt: NOW.toISOString(),
    lastUsageReportedAt: REPORT_TIME.toISOString(),
    nextInstanceStatusChangeAt: null,
  };

  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/admin/enterprise-licenses/${LICENSE_ID}`,
  );
  Navigation.setLocation({
    pathname: window.location.pathname,
    search: "",
    hash: "",
    state: null,
    key: "test",
  });
  TableFilterUrlState.resetClaimedKeys();
  PermissionGate.clearPermissionPropsCache();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return NOW;
  });
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);

  jest
    .spyOn(AdminModelAPI, "getItem")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const modelType: unknown = (data as { modelType: unknown }).modelType;

      if (modelType === EnterpriseLicense) {
        return Object.assign(new EnterpriseLicense(), {
          _id: LICENSE_ID,
          companyName: "Example Company",
          userLimit: 120,
          expiresAt: new Date("2027-05-15T00:00:00.000Z"),
        }) as never;
      }

      if (modelType === GlobalConfig) {
        return Object.assign(new GlobalConfig(), {
          enterpriseLicenseExpiryReminderDays: 30,
          latestReleaseVersion: "13.0.7",
        }) as never;
      }

      throw new Error("Unexpected detail request");
    });

  jest
    .spyOn(AdminModelAPI, "getList")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const request: ListRequest = data as ListRequest;
      listRequests.push(request);

      if (request.modelType !== EnterpriseLicenseInstance) {
        throw new Error("Unexpected instance list request");
      }

      /*
       * The real API returns only selected fields. Returning complete fixtures
       * here would hide the regression: the cell asks for three fields, but
       * the old table silently discarded both timestamps for a master admin.
       */
      const projectedRows: Array<EnterpriseLicenseInstance> = rows.map(
        (row: InstanceRow): EnterpriseLicenseInstance => {
          const projected: EnterpriseLicenseInstance =
            new EnterpriseLicenseInstance();

          for (const [key, value] of Object.entries(row)) {
            if (request.select[key]) {
              Object.assign(projected, { [key]: value });
            }
          }

          return projected;
        },
      );

      return {
        data: projectedRows,
        count: projectedRows.length,
        skip: request.skip,
        limit: request.limit,
      } as never;
    });

  jest.spyOn(API, "get").mockImplementation(async (): Promise<never> => {
    return { data: snapshot } as never;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Enterprise license instance Last Activity", () => {
  test("shows the September 17 report beside an active instance instead of Never communicated", async () => {
    await renderPage();

    const row: HTMLElement = getRow();
    expect(within(row).getByText(formatted(REPORT_TIME))).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();
    expect(
      within(row).queryByText("Never communicated"),
    ).not.toBeInTheDocument();
    expect(within(row).queryByText(INACTIVE_NOTE)).not.toBeInTheDocument();
    expect(
      within(row).queryByText(formatted(REGISTRATION_TIME)),
    ).not.toBeInTheDocument();
  });

  test("requests both timestamps and the instance identifier from the license-scoped API", async () => {
    await renderPage();

    expect(listRequests.length).toBeGreaterThan(0);

    for (const request of listRequests) {
      expect(request.select).toMatchObject({
        _id: true,
        createdAt: true,
        lastReportedAt: true,
      });
      expect(request.query.enterpriseLicenseId.toString()).toBe(LICENSE_ID);
    }
  });

  test("shows registration time for an instance that has not yet sent a usage report", async () => {
    rows = [makeRow({ lastReportedAt: undefined })];

    await renderPage();

    const row: HTMLElement = getRow();
    expect(
      within(row).getByText(formatted(REGISTRATION_TIME)),
    ).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();
    expect(
      within(row).queryByText("Never communicated"),
    ).not.toBeInTheDocument();
    expect(within(row).queryByText(INACTIVE_NOTE)).not.toBeInTheDocument();
  });

  test("keeps an inactive instance's last report visible with the seat exclusion note", async () => {
    rows = [makeRow({ lastReportedAt: OLD_REPORT_TIME })];
    snapshot = { ...snapshot, activeInstanceIds: [], currentUserCount: 0 };

    await renderPage();

    const row: HTMLElement = getRow();
    expect(
      within(row).getByText(formatted(OLD_REPORT_TIME)),
    ).toBeInTheDocument();
    expect(within(row).getByText("Inactive")).toBeInTheDocument();
    expect(within(row).getByText(INACTIVE_NOTE)).toBeInTheDocument();
    expect(
      within(row).queryByText("Never communicated"),
    ).not.toBeInTheDocument();
  });

  test("retains Never communicated only when neither report nor registration time exists", async () => {
    rows = [makeRow({ createdAt: undefined, lastReportedAt: undefined })];
    snapshot = { ...snapshot, activeInstanceIds: [], currentUserCount: 0 };

    await renderPage();

    const row: HTMLElement = getRow();
    expect(within(row).getByText("Never communicated")).toBeInTheDocument();
    expect(within(row).getByText("Inactive")).toBeInTheDocument();
    expect(
      within(row).queryByText(formatted(REPORT_TIME)),
    ).not.toBeInTheDocument();
  });

  test("uses each instance's own timestamp instead of copying the license aggregate", async () => {
    rows = [
      makeRow(),
      makeRow({
        _id: OTHER_INSTANCE_ID,
        instanceId: "self-hosted-staging",
        host: "staging.example.com",
        lastReportedAt: OLD_REPORT_TIME,
        userCount: 5,
      }),
    ];

    await renderPage();

    const production: HTMLElement = getRow();
    const staging: HTMLElement = getRow("staging.example.com");
    expect(
      within(production).getByText(formatted(REPORT_TIME)),
    ).toBeInTheDocument();
    expect(within(production).getByText("Active")).toBeInTheDocument();
    expect(
      within(staging).getByText(formatted(OLD_REPORT_TIME)),
    ).toBeInTheDocument();
    expect(within(staging).getByText("Inactive")).toBeInTheDocument();
    expect(within(staging).getByText(INACTIVE_NOTE)).toBeInTheDocument();
    expect(
      within(staging).queryByText(formatted(REPORT_TIME)),
    ).not.toBeInTheDocument();
  });

  test("keeps the activity note consistent with the server's active snapshot", async () => {
    rows = [makeRow({ lastReportedAt: OLD_REPORT_TIME })];

    await renderPage();

    const row: HTMLElement = getRow();
    expect(
      within(row).getByText(formatted(OLD_REPORT_TIME)),
    ).toBeInTheDocument();
    // The snapshot arrives after the rows and updates their status renderers.
    expect(await within(row).findByText("Active")).toBeInTheDocument();
    expect(within(row).queryByText(INACTIVE_NOTE)).not.toBeInTheDocument();
  });

  test("refreshes an instance's activity when a new report arrives while the page is open", async () => {
    rows = [makeRow({ lastReportedAt: OLD_REPORT_TIME })];
    snapshot = { ...snapshot, activeInstanceIds: [], currentUserCount: 0 };
    await renderPage();
    expect(within(getRow()).getByText("Inactive")).toBeInTheDocument();

    rows = [makeRow()];
    snapshot = {
      ...snapshot,
      activeInstanceIds: [INSTANCE_ID],
      currentUserCount: 100,
    };

    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    fireEvent.click(screen.getByText("Refresh"));

    await waitFor(() => {
      const row: HTMLElement = getRow();
      expect(within(row).getByText(formatted(REPORT_TIME))).toBeInTheDocument();
      expect(within(row).getByText("Active")).toBeInTheDocument();
      expect(within(row).queryByText(INACTIVE_NOTE)).not.toBeInTheDocument();
    });
    expect(listRequests.length).toBeGreaterThan(1);
  });
});
