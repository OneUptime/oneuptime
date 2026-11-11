import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
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

/*
 * ADMIN DASHBOARD > ENTERPRISE LICENSES: A NEW EXPIRY REMINDER, SAVED.
 *
 * The License Notification Settings card under the list sets how many days
 * before a license expires its reminders start - and that window is what
 * makes a license "expiring soon": the Active and Expiring soon tiles over
 * the list count by it, and each row's status says it. Saving a new window
 * left both on the old one until a reload (issue #6766, "When I click on
 * edit and save, the new changes do not reflect").
 *
 * The real list page and table, over licenses and a global config behind
 * AdminModelAPI that a save changes as a server would. The settings card is
 * a stand-in that hands its save to the test.
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

jest.mock("Common/UI/Utils/Translation", () => {
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

jest.mock("Common/UI/Utils/Permission", () => {
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

// The Admin Dashboard's reader: a master admin, with no project permissions.
jest.mock("Common/UI/Utils/User", () => {
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

jest.mock("Common/UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { children: ReactNode }): ReactElement => {
      return <div data-testid="page">{props.children}</div>;
    },
  };
});

interface StandInCardProps {
  name: string;
  onSaveSuccess?: ((item: unknown) => void) | undefined;
}

// Each card the page draws, by name: the test saves through it.
const mockCards: Record<string, StandInCardProps> = {};

jest.mock("Common/UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: StandInCardProps): null => {
      mockCards[props.name] = props;
      return null;
    },
  };
});

import EnterpriseLicenses from "../../../AdminDashboard/EnterpriseLicenses/Pages/Index";
import {
  getLicenseLifecycle,
  getLicenseStatusText,
} from "../../../AdminDashboard/EnterpriseLicenses/Components/LicenseUtil";
import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import OneUptimeDate from "Common/Types/Date";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";

const NOW: Date = new Date("2026-10-23T09:00:00.000Z");

const SETTINGS_CARD: string = "License Notification Settings";

interface LicenseRow {
  _id: string;
  companyName: string;
  licenseKey: string;
  isEvaluationLicense: boolean;
  canBeWhiteLabelled: boolean;
  expiresAt: Date;
  userLimit: number;
  currentUserCount: number;
}

// Sixty days to go: expiring soon in a 90-day window, not in a 30-day one.
const ACME: LicenseRow = {
  _id: "6c1f0e2d-3b4a-4c5d-8e6f-7a8b9c0d1e11",
  companyName: "Acme Corp",
  licenseKey: `ac11${"a".repeat(56)}0001`,
  isEvaluationLicense: false,
  canBeWhiteLabelled: false,
  expiresAt: new Date("2026-12-22T09:00:00.000Z"),
  userLimit: 50,
  currentUserCount: 10,
};

const GOVTECH: LicenseRow = {
  _id: "6c1f0e2d-3b4a-4c5d-8e6f-7a8b9c0d1e12",
  companyName: "GovTech Singapore",
  licenseKey: `832c${"c".repeat(56)}8915`,
  isEvaluationLicense: false,
  canBeWhiteLabelled: false,
  expiresAt: new Date("2099-10-09T00:00:00.000Z"),
  userLimit: 150,
  currentUserCount: 13,
};

// The window as the server holds it.
let storedReminderDays: number = 30;

const renderPage: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <EnterpriseLicenses />
      </MemoryRouter>,
    );
  });

  await screen.findAllByText("GovTech Singapore");
  await screen.findAllByText("Acme Corp");
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 20; index++) {
      await Promise.resolve();
    }
  });
}

// A tile's number, by its label.
function tileValue(label: string): string {
  const tileLabel: HTMLElement | undefined = screen
    .getAllByText(label)
    .find((element: HTMLElement): boolean => {
      return Boolean(
        element.nextElementSibling?.className.includes("text-2xl"),
      );
    });

  if (!tileLabel) {
    throw new Error(`No tile ${label}`);
  }

  return tileLabel.nextElementSibling!.textContent || "";
}

// The row of a company's license, as the table draws it for a desk.
function rowOf(companyName: string): HTMLElement {
  const cell: HTMLElement | undefined = screen
    .getAllByText(companyName)
    .find((element: HTMLElement): boolean => {
      return Boolean(element.closest("tr"));
    });

  if (!cell) {
    throw new Error(`No table row for ${companyName}`);
  }

  return cell.closest("tr") as HTMLElement;
}

// What the settings card's save does once the server holds the new window.
async function saveReminderDays(days: number): Promise<void> {
  storedReminderDays = days;

  await act(async () => {
    mockCards[SETTINGS_CARD]!.onSaveSuccess?.(new GlobalConfig());
  });
  await flush();
}

beforeEach(() => {
  storedReminderDays = 30;

  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    "/admin/enterprise-licenses",
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
    .spyOn(AdminModelAPI, "getItem")
    .mockImplementation(async (data: unknown): Promise<never> => {
      if ((data as { modelType: unknown }).modelType === GlobalConfig) {
        return Object.assign(new GlobalConfig(), {
          enterpriseLicenseExpiryReminderDays: storedReminderDays,
        }) as never;
      }

      throw new Error("Unexpected detail request");
    });

  jest
    .spyOn(AdminModelAPI, "getList")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const request: {
        modelType: unknown;
        select: Record<string, unknown>;
        skip: number;
        limit: number;
      } = data as {
        modelType: unknown;
        select: Record<string, unknown>;
        skip: number;
        limit: number;
      };

      if (request.modelType !== EnterpriseLicense) {
        throw new Error("Unexpected list request");
      }

      // The API answers only the columns asked for.
      const projected: Array<EnterpriseLicense> = [ACME, GOVTECH].map(
        (row: LicenseRow): EnterpriseLicense => {
          const license: EnterpriseLicense = new EnterpriseLicense();

          for (const [key, value] of Object.entries(row)) {
            if (key === "_id" || request.select[key]) {
              Object.assign(license, { [key]: value });
            }
          }

          return license;
        },
      );

      return {
        data: projected,
        count: projected.length,
        skip: request.skip,
        limit: request.limit,
      } as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a new expiry reminder, saved under the license list (issue #6766)", () => {
  test("the tiles and each row's status count by it at once", async () => {
    await renderPage();

    expect(tileValue("Active")).toBe("2");
    expect(tileValue("Expiring soon")).toBe("0");
    expect(within(rowOf("Acme Corp")).getByText("Active")).toBeInTheDocument();

    await saveReminderDays(90);

    expect(tileValue("Active")).toBe("1");
    expect(tileValue("Expiring soon")).toBe("1");
    // "Expires in 60 days", as the badge words it.
    const acmeStatus: string = getLicenseStatusText(
      getLicenseLifecycle(ACME.expiresAt, 90),
    );
    expect(acmeStatus).toMatch(/^Expires in \d+ days$/);
    expect(
      within(rowOf("Acme Corp")).getByText(acmeStatus),
    ).toBeInTheDocument();
    expect(
      within(rowOf("GovTech Singapore")).getByText("Active"),
    ).toBeInTheDocument();
  });

  test("a shorter window counts the other way, at once", async () => {
    storedReminderDays = 90;
    await renderPage();

    expect(tileValue("Expiring soon")).toBe("1");

    await saveReminderDays(14);

    expect(tileValue("Expiring soon")).toBe("0");
    expect(tileValue("Active")).toBe("2");
    expect(within(rowOf("Acme Corp")).getByText("Active")).toBeInTheDocument();
  });
});
