import EditionLabel from "../../../UI/Components/EditionLabel/EditionLabel";
import UpdateStatusLoader, {
  getUpgradeGuideUrl,
} from "../../../UI/Utils/UpdateStatus";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { SecurityAdvisorySeverity } from "../../../Types/UpdateCheck/SecurityAdvisory";
import UpdateStatusUtil, {
  UpdateState,
  UpdateStatus,
} from "../../../Types/UpdateCheck/UpdateStatus";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The edition dialog's "This installation" card, when a published security
 * advisory affects the version that runs.
 *
 * The footer's pill says "Security update" in red on every page a master
 * admin opens; the card in the dialog beside it said only "Update available"
 * in amber, and offered the upgrade guide for a major upgrade alone. Now it
 * says what the pill says - a red "Security update" (or "Security advisory"
 * with no fixed release), what is affected and the release to upgrade to -
 * and always offers the upgrade guide. It reads what the footer already read
 * (UpdateStatusLoader.peek) and never asks the server itself: with nothing
 * read, the card is exactly as it was.
 */

let billingEnabled: boolean = false;
let isMasterAdmin: boolean = true;
const fetchedUrls: Array<string> = [];
let statusJson: JSONObject | null = null;

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "IS_ENTERPRISE_EDITION", {
    get: (): boolean => {
      return false;
    },
  });

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabled;
    },
  });

  return mockedConfig;
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdmin;
      },
      isLoggedIn: (): boolean => {
        return true;
      },
    },
  };
});

const LICENSE: JSONObject = {
  edition: "community",
  status: null,
  verification: null,
  licenseValid: false,
  currentVersion: "14.0.60",
  latestVersion: "14.0.80",
  latestVersionPublishedAt: "2026-10-20T00:00:00.000Z",
  latestVersionCheckedAt: "2026-10-30T08:00:00.000Z",
  isUpdateAvailable: true,
  isUpdateCheckDisabled: false,
};

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      fetch: (options: {
        url: { toString: () => string };
      }): Promise<HTTPResponse<JSONObject>> => {
        const url: string = options.url.toString();
        fetchedUrls.push(url);

        return Promise.resolve(
          new HTTPResponse<JSONObject>(
            200,
            url.includes("/update-status")
              ? (statusJson as JSONObject)
              : LICENSE,
            {},
          ),
        );
      },
      getFriendlyMessage: (err: unknown): string => {
        return String(err);
      },
    },
  };
});

const status: (overrides?: Partial<UpdateStatus>) => UpdateStatus = (
  overrides?: Partial<UpdateStatus>,
): UpdateStatus => {
  return {
    state: UpdateState.SecurityUpdate,
    currentVersion: "14.0.60",
    isVersionComparable: true,
    isUpdateCheckDisabled: false,
    latestVersion: "14.0.80",
    latestVersionPublishedAt: "2026-10-20T00:00:00.000Z",
    isUpdateAvailable: true,
    isMajorUpgrade: false,
    recommendedVersion: "14.0.80",
    advisories: [
      {
        ghsaId: "GHSA-aaaa-bbbb-cccc",
        cveId: null,
        summary: "A summary",
        severity: SecurityAdvisorySeverity.Critical,
        url: null,
        publishedAt: null,
        affectedVersions: "<= 14.0.66",
        fixedIn: "14.0.67",
      },
    ],
    latestVersionCheckedAt: "2026-10-30T08:00:00.000Z",
    advisoriesCheckedAt: "2026-10-30T08:00:01.000Z",
    lastCheckAttemptedAt: "2026-10-30T08:00:00.000Z",
    lastCheckFailure: null,
    ...(overrides || {}),
  };
};

// What the footer does on every page a master admin opens.
const footerReads: (value: UpdateStatus) => Promise<void> = async (
  value: UpdateStatus,
): Promise<void> => {
  statusJson = UpdateStatusUtil.toJSON(value);
  await UpdateStatusLoader.load();
};

const openDialog: () => Promise<HTMLElement> =
  async (): Promise<HTMLElement> => {
    render(<EditionLabel />);

    fireEvent.click(screen.getByRole("button", { name: /Community Edition/i }));

    await waitFor(() => {
      expect(screen.getByText("This installation")).toBeInTheDocument();
    });

    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });

    return screen
      .getByText("This installation")
      .closest("section") as HTMLElement;
  };

beforeEach(() => {
  billingEnabled = false;
  isMasterAdmin = true;
  fetchedUrls.length = 0;
  statusJson = null;
  UpdateStatusLoader.clear();
});

afterEach(() => {
  cleanup();
});

describe("the dialog's version card, when an advisory affects the version", () => {
  it("says Security update in red, what is affected, and offers the upgrade guide", async () => {
    await footerReads(status());

    const card: HTMLElement = await openDialog();

    expect(card.className).toContain("border-red-200");
    expect(
      within(card).getByTestId("edition-security-update-chip"),
    ).toHaveTextContent("Security update");
    expect(
      within(card).getByTestId("edition-security-update"),
    ).toHaveTextContent(
      "A published security advisory affects version 14.0.60, which this installation runs. Upgrade to 14.0.80.",
    );
    expect(
      within(card).getByRole("link", { name: /Read the upgrade guide/ }),
    ).toHaveAttribute("href", getUpgradeGuideUrl());
    expect(within(card).queryByText("Update available")).toBeNull();
  });

  it("says Security advisory when no release fixes it yet", async () => {
    await footerReads(
      status({ state: UpdateState.SecurityAdvisory, recommendedVersion: null }),
    );

    const card: HTMLElement = await openDialog();

    expect(
      within(card).getByTestId("edition-security-update-chip"),
    ).toHaveTextContent("Security advisory");
    expect(
      within(card).getByTestId("edition-security-update"),
    ).toHaveTextContent("No release fixes it yet.");
  });

  it("asks the server nothing of its own: only the license", async () => {
    await footerReads(status());
    fetchedUrls.length = 0;

    await openDialog();

    expect(
      fetchedUrls.filter((url: string): boolean => {
        return url.includes("/update-status");
      }),
    ).toEqual([]);
  });
});

describe("the dialog's version card, otherwise", () => {
  it("is as it was when the footer has read nothing", async () => {
    const card: HTMLElement = await openDialog();

    expect(within(card).queryByTestId("edition-security-update")).toBeNull();
    expect(within(card).getByText("Update available")).toBeInTheDocument();
    expect(
      fetchedUrls.some((url: string): boolean => {
        return url.includes("/update-status");
      }),
    ).toBe(false);
  });

  it("is as it was when the footer read only an update", async () => {
    await footerReads(
      status({
        state: UpdateState.UpdateAvailable,
        recommendedVersion: null,
        advisories: [],
      }),
    );

    const card: HTMLElement = await openDialog();

    expect(within(card).queryByTestId("edition-security-update")).toBeNull();
    expect(card.className).toContain("border-amber-200");
    expect(within(card).getByText("Update available")).toBeInTheDocument();
  });

  it("says nothing of an advisory to anybody but a master admin", async () => {
    await footerReads(status());
    isMasterAdmin = false;

    render(<EditionLabel />);
    fireEvent.click(screen.getByRole("button", { name: /Community Edition/i }));

    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });

    expect(screen.queryByTestId("edition-security-update")).toBeNull();
    expect(UpdateStatusLoader.peek()).toBeNull();
  });
});
