import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * "Update available" and "Security update" in the footers.
 *
 * In the Dashboard's footer the pill sits right beside the edition pill -
 * the Community or Enterprise license - and in the Admin Dashboard's it
 * comes first; both open the upgrade guide. Only a master admin of a
 * self-hosted installation sees it: the server tells nobody else, and the
 * footer does not even ask. When there is nothing to say, or for anybody
 * else, the footer is exactly as it was: no pill, and no empty slot where
 * it would be. An installation with a name of its own still shows it to
 * its master admins, and it adds no link to OneUptime's site.
 */

let mockBillingEnabled: boolean = false;
let mockIsMasterAdmin: boolean = true;
let mockStatusJson: unknown = null;
let mockFetches: number = 0;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });

  return mocked;
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return mockIsMasterAdmin;
      },
      isLoggedIn: (): boolean => {
        return true;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  const responseModule: typeof import("../../../Types/API/HTTPResponse") =
    jest.requireActual(
      "../../../Types/API/HTTPResponse",
    ) as typeof import("../../../Types/API/HTTPResponse");

  return {
    __esModule: true,
    default: {
      fetch: (): Promise<unknown> => {
        mockFetches++;
        return Promise.resolve(
          new responseModule.default(200, mockStatusJson as never, {}),
        );
      },
      get: (): Promise<unknown> => {
        return Promise.resolve(
          new responseModule.default(200, { version: "14.0.60" }, {}),
        );
      },
    },
  };
});

// The edition pill fetches the license on mount; here it only has to be seen.
jest.mock("../../../UI/Components/EditionLabel/EditionLabel", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <span data-testid="edition-label" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/LanguageSwitcher/LanguageSwitcher",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <span data-testid="language-switcher" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Components/LanguageSwitcher/LanguageSwitcher",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <span data-testid="language-switcher" />;
      },
    };
  },
);

jest.mock("react-i18next", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "react-i18next",
  ) as Record<string, unknown>;

  return {
    ...actual,
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

import AdminDashboardFooter from "../../../../App/FeatureSet/AdminDashboard/src/Components/Footer/Footer";
import DashboardFooter from "../../../../App/FeatureSet/Dashboard/src/Components/Footer/Footer";
import UpdateStatusLoader from "../../../UI/Utils/UpdateStatus";
import { SecurityAdvisorySeverity } from "../../../Types/UpdateCheck/SecurityAdvisory";
import UpdateStatusUtil, {
  UpdateState,
  UpdateStatus,
} from "../../../Types/UpdateCheck/UpdateStatus";

const status: (overrides?: Partial<UpdateStatus>) => UpdateStatus = (
  overrides?: Partial<UpdateStatus>,
): UpdateStatus => {
  return {
    state: UpdateState.UpdateAvailable,
    currentVersion: "14.0.60",
    isVersionComparable: true,
    isUpdateCheckDisabled: false,
    latestVersion: "14.0.80",
    latestVersionPublishedAt: null,
    isUpdateAvailable: true,
    isMajorUpgrade: false,
    recommendedVersion: null,
    advisories: [],
    latestVersionCheckedAt: "2026-10-30T08:00:00.000Z",
    advisoriesCheckedAt: "2026-10-30T08:00:01.000Z",
    lastCheckAttemptedAt: "2026-10-30T08:00:00.000Z",
    lastCheckFailure: null,
    ...(overrides || {}),
  };
};

const SECURITY_UPDATE: UpdateStatus = status({
  state: UpdateState.SecurityUpdate,
  recommendedVersion: "14.0.80",
  advisories: [
    {
      ghsaId: "GHSA-aaaa-bbbb-cccc",
      cveId: null,
      summary: "A summary",
      severity: SecurityAdvisorySeverity.High,
      url: null,
      publishedAt: null,
      affectedVersions: "<= 14.0.66",
      fixedIn: "14.0.67",
    },
  ],
});

const setBranding: (value: string | null) => void = (
  value: string | null,
): void => {
  const browserWindow: { process?: { env?: Record<string, unknown> } } =
    window as unknown as { process?: { env?: Record<string, unknown> } };

  browserWindow.process = browserWindow.process || {};
  browserWindow.process.env = browserWindow.process.env || {};

  if (value === null) {
    delete browserWindow.process.env["PRODUCT_BRANDING"];
  } else {
    browserWindow.process.env["PRODUCT_BRANDING"] = value;
  }
};

async function renderFooter(Footer: () => JSX.Element): Promise<void> {
  await act(async () => {
    render(<Footer />);
  });

  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

// The footer's slots, in order, as what each one holds.
const slots: () => Array<string> = (): Array<string> => {
  const row: Element | null = document.querySelector("footer > div > div");

  return Array.from(row?.children || []).map((child: Element): string => {
    const marked: Element | null = child.matches("[data-testid]")
      ? child
      : child.querySelector("[data-testid]");

    return marked?.getAttribute("data-testid") || child.textContent || "";
  });
};

beforeEach(() => {
  mockBillingEnabled = false;
  mockIsMasterAdmin = true;
  mockStatusJson = UpdateStatusUtil.toJSON(status());
  mockFetches = 0;
  UpdateStatusLoader.clear();
});

afterEach(() => {
  cleanup();
  setBranding(null);
});

describe("the Dashboard's footer", () => {
  test("draws Update available right beside the edition pill", async () => {
    await renderFooter(DashboardFooter);

    expect(slots()).toEqual([
      "edition-label",
      "update-status-pill",
      "footer.helpSupport",
      "footer.legal",
      "footer.version",
      "language-switcher",
    ]);
    expect(screen.getByTestId("update-status-pill")).toHaveTextContent(
      "Update available",
    );
  });

  test("draws Security update there when an advisory affects the version", async () => {
    mockStatusJson = UpdateStatusUtil.toJSON(SECURITY_UPDATE);

    await renderFooter(DashboardFooter);

    expect(screen.getByTestId("update-status-pill")).toHaveTextContent(
      "Security update",
    );
    expect(screen.getByTestId("update-status-pill")).toHaveAttribute(
      "data-state",
      UpdateState.SecurityUpdate,
    );
  });

  test.each([
    [
      "up to date",
      status({ state: UpdateState.UpToDate, isUpdateAvailable: false }),
    ],
    ["unknown", status({ state: UpdateState.Unknown })],
  ] as Array<[string, UpdateStatus]>)(
    "is exactly as it was when %s: no pill, and no empty slot",
    async (_name: string, value: UpdateStatus) => {
      mockStatusJson = UpdateStatusUtil.toJSON(value);

      await renderFooter(DashboardFooter);

      expect(
        screen.queryByTestId("update-status-pill"),
      ).not.toBeInTheDocument();
      expect(slots()).toEqual([
        "edition-label",
        "footer.helpSupport",
        "footer.legal",
        "footer.version",
        "language-switcher",
      ]);
    },
  );

  test("anybody but a master admin sees nothing, and the footer never asks", async () => {
    mockIsMasterAdmin = false;
    mockStatusJson = UpdateStatusUtil.toJSON(SECURITY_UPDATE);

    await renderFooter(DashboardFooter);

    expect(screen.queryByTestId("update-status-pill")).not.toBeInTheDocument();
    expect(mockFetches).toBe(0);
  });

  test("OneUptime Cloud never asks, and shows nothing", async () => {
    mockBillingEnabled = true;
    mockStatusJson = UpdateStatusUtil.toJSON(SECURITY_UPDATE);

    await renderFooter(DashboardFooter);

    expect(screen.queryByTestId("update-status-pill")).not.toBeInTheDocument();
    expect(mockFetches).toBe(0);
  });

  test("an installation with a name of its own still tells its master admins, with no link to OneUptime", async () => {
    setBranding(JSON.stringify({ productName: "Acme" }));
    mockStatusJson = UpdateStatusUtil.toJSON(SECURITY_UPDATE);

    await renderFooter(DashboardFooter);

    expect(slots()[0]).toBe("update-status-pill");
    expect(
      Array.from(document.querySelectorAll("a[href]")).filter(
        (anchor: Element): boolean => {
          // The link's host, a relative link's included: oneuptime.com or below it.
          const host: string = new URL(
            anchor.getAttribute("href") || "",
            "https://dashboard.invalid",
          ).hostname;
          return host === "oneuptime.com" || host.endsWith(".oneuptime.com");
        },
      ),
    ).toEqual([]);
  });
});

describe("the Admin Dashboard's footer", () => {
  test("draws the pill first", async () => {
    mockStatusJson = UpdateStatusUtil.toJSON(SECURITY_UPDATE);

    await renderFooter(AdminDashboardFooter);

    expect(slots()[0]).toBe("update-status-pill");
    expect(screen.getByTestId("update-status-pill")).toHaveTextContent(
      "Security update",
    );
  });

  test("is exactly as it was with nothing to say", async () => {
    mockStatusJson = UpdateStatusUtil.toJSON(
      status({ state: UpdateState.UpToDate, isUpdateAvailable: false }),
    );

    await renderFooter(AdminDashboardFooter);

    expect(slots()).toEqual([
      "footer.helpSupport",
      "footer.legal",
      "footer.version",
      "language-switcher",
    ]);
  });
});
