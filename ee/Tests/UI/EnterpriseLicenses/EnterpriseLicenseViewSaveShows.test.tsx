import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
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
 * ADMIN DASHBOARD > ENTERPRISE LICENSES > (LICENSE): THE LICENSE, EDITED.
 *
 * The license card's Edit changes the company, the user limit and the expiry.
 * The page read the license once, for the seat meter ("100 of 120
 * licensed"), the expiry badge, the offline token card and the Delete card -
 * so a save showed in the card and nowhere else on the page until a reload
 * (issue #6766, "When I click on edit and save, the new changes do not
 * reflect").
 *
 * The real page, over a license behind AdminModelAPI that a save changes as
 * a server would. The license card is a stand-in that hands its save to the
 * test; the header and the delete card are left out.
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

jest.mock("Common/UI/Components/Page/ModelPage", () => {
  return {
    __esModule: true,
    default: (props: { children: ReactNode }): ReactElement => {
      return <>{props.children}</>;
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

jest.mock("Common/UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

import EnterpriseLicenseView from "../../../AdminDashboard/EnterpriseLicenses/Pages/View/Index";
import {
  getLicenseLifecycle,
  getLicenseStatusText,
} from "../../../AdminDashboard/EnterpriseLicenses/Components/LicenseUtil";
import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseInstance from "Common/Models/DatabaseModels/EnterpriseLicenseInstance";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import OneUptimeDate from "Common/Types/Date";
import EnterpriseLicenseUsageSnapshot from "Common/Types/EnterpriseLicense/EnterpriseLicenseUsageSnapshot";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";

const LICENSE_ID: string = "00000000-0000-4000-8000-000000000001";
const INSTANCE_ID: string = "00000000-0000-4000-8000-000000000002";
const NOW: Date = new Date("2026-09-17T12:00:00.000Z");
const REPORT_TIME: Date = new Date("2026-09-17T08:00:00.000Z");

const LICENSE_CARD: string = "Enterprise License";

interface StoredLicense {
  companyName: string;
  userLimit: number;
  expiresAt: Date;
}

// The license as the server holds it.
let storedLicense: StoredLicense;

const snapshot: EnterpriseLicenseUsageSnapshot = {
  currentUserCount: 100,
  activeInstanceIds: [INSTANCE_ID],
  masterAdminEmails: ["admin@example.com"],
  calculatedAt: NOW.toISOString(),
  lastUsageReportedAt: REPORT_TIME.toISOString(),
  nextInstanceStatusChangeAt: null,
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 20; index++) {
      await Promise.resolve();
    }
  });
}

const renderPage: () => Promise<void> = async (): Promise<void> => {
  render(
    <MemoryRouter>
      <EnterpriseLicenseView />
    </MemoryRouter>,
  );

  await screen.findByText("production.example.com");
  await screen.findByText("of 120 licensed");
};

// What the license card's save does once the server holds the edit.
async function saveLicense(edit: Partial<StoredLicense>): Promise<void> {
  storedLicense = { ...storedLicense, ...edit };

  await act(async () => {
    mockCards[LICENSE_CARD]!.onSaveSuccess?.(new EnterpriseLicense());
  });
  await flush();
}

function statusFor(expiresAt: Date): string {
  return getLicenseStatusText(getLicenseLifecycle(expiresAt, 30));
}

beforeEach(() => {
  storedLicense = {
    companyName: "Example Company",
    userLimit: 120,
    expiresAt: new Date("2027-05-15T00:00:00.000Z"),
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
          ...storedLicense,
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

      if (request.modelType !== EnterpriseLicenseInstance) {
        throw new Error("Unexpected list request");
      }

      const instance: EnterpriseLicenseInstance =
        new EnterpriseLicenseInstance();
      const row: Record<string, unknown> = {
        _id: INSTANCE_ID,
        instanceId: "self-hosted-production",
        host: "production.example.com",
        lastReportedAt: REPORT_TIME,
        userCount: 100,
        oneuptimeVersion: "13.0.7",
        masterAdminEmails: ["admin@example.com"],
      };

      for (const [key, value] of Object.entries(row)) {
        if (request.select[key]) {
          Object.assign(instance, { [key]: value });
        }
      }

      return {
        data: [instance],
        count: 1,
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

describe("an enterprise license, edited on its page (issue #6766)", () => {
  test("a new user limit is in the seat meter at once", async () => {
    await renderPage();

    await saveLicense({ userLimit: 200 });

    expect(await screen.findByText("of 200 licensed")).toBeInTheDocument();
    expect(screen.queryByText("of 120 licensed")).toBeNull();
  });

  test("a limit taken away says no seat limit at once", async () => {
    await renderPage();

    await saveLicense({ userLimit: 0 });

    expect(await screen.findByText("· no seat limit")).toBeInTheDocument();
    expect(screen.queryByText("of 120 licensed")).toBeNull();
  });

  test("a new expiry is in the status badge at once", async () => {
    await renderPage();

    // Two weeks out: inside the 30-day reminder window.
    const soon: Date = new Date("2026-10-01T12:00:00.000Z");
    expect(statusFor(new Date("2027-05-15T00:00:00.000Z"))).toBe("Active");
    expect(statusFor(soon)).toMatch(/^Expires in \d+ days$/);
    expect(screen.queryByText(statusFor(soon))).toBeNull();

    await saveLicense({ expiresAt: soon });

    expect(await screen.findByText(statusFor(soon))).toBeInTheDocument();
  });
});
