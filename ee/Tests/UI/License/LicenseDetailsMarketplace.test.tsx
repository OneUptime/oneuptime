import LicenseDetails from "../../../AdminDashboard/License/LicenseDetails";
import EditionLabel from "Common/UI/Components/EditionLabel/EditionLabel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The edition dialog with the Enterprise license details, on an installation
 * licensed through a cloud marketplace. There is no key to refresh - the
 * license renews itself with every usage report the marketplace accepts - and
 * no seat limit: every user is billed by the hour. A master admin can still
 * put a license key in place of the subscription, on the license page.
 */

jest.mock("Common/UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "Common/UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "IS_ENTERPRISE_EDITION", {
    get: (): boolean => {
      return true;
    },
  });

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  return mockedConfig;
});

jest.mock("Common/UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      isLoggedIn: (): boolean => {
        return true;
      },
    },
  };
});

let payload: JSONObject = {};
let fetchCount: number = 0;

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      fetch: (): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        fetchCount++;
        return Promise.resolve(new HTTPResponse<JSONObject>(200, payload, {}));
      },
      getFriendlyMessage: (err: unknown): string => {
        return String(err);
      },
    },
  };
});

const licensePayload: (overrides?: JSONObject) => JSONObject = (
  overrides?: JSONObject,
): JSONObject => {
  return {
    edition: "enterprise",
    status: "valid",
    verification: "none",
    graceReason: null,
    graceEndsAt: null,
    licenseValid: true,
    companyName: null,
    expiresAt: "2031-01-01T00:00:00.000Z",
    isEvaluation: false,
    isEvaluationLicense: false,
    features: "all",
    marketplace: "Azure",
    message: null,
    licenseKey: null,
    token: null,
    activationMode: null,
    userLimit: null,
    currentUserCount: null,
    userCountUpdatedAt: null,
    instances: [],
    instanceId: "instance-1",
    marketplaceBilling: null,
    currentVersion: "14.0.0",
    latestVersion: "14.0.0",
    isUpdateAvailable: false,
    isUpdateCheckDisabled: false,
    isSeatLimitEnforced: false,
    seatsInUse: null,
    seatsRemaining: null,
    canAddMoreUsers: true,
    ...(overrides || {}),
  };
};

const openDialog: () => Promise<void> = async (): Promise<void> => {
  render(<EditionLabel licenseDetails={LicenseDetails} />);

  await waitFor(() => {
    expect(fetchCount).toBeGreaterThan(0);
  });

  fireEvent.click(screen.getByRole("button", { name: /Enterprise Edition/i }));
};

beforeEach(() => {
  fetchCount = 0;
  payload = licensePayload();
});

describe("the license details on a marketplace-licensed installation", () => {
  it("offers no refresh: there is no key, and the license renews itself", async () => {
    await openDialog();

    expect(
      await screen.findByTestId("enterprise-marketplace-license-notice"),
    ).toHaveTextContent("Licensed through Microsoft Marketplace");
    expect(
      screen.queryByTestId("refresh-enterprise-license"),
    ).not.toBeInTheDocument();
  });

  it("shows no seat card: there is no seat limit to measure against", async () => {
    await openDialog();

    await screen.findByTestId("enterprise-marketplace-license-notice");

    expect(screen.queryByText("Licensed seats")).not.toBeInTheDocument();
    expect(screen.queryByText(/unlimited/)).not.toBeInTheDocument();
  });

  it("leaves a master admin the way to the license page", async () => {
    await openDialog();

    await screen.findByTestId("enterprise-marketplace-license-notice");

    expect(
      screen.getByRole("button", { name: "Manage license" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Change license key")).not.toBeInTheDocument();
  });

  it("keeps the seat card for a license key", async () => {
    payload = licensePayload({
      marketplace: null,
      licenseKey: "acme-license-key",
      token: "signed.jwt.token",
      activationMode: "online",
      companyName: "Acme Inc",
      verification: "verified",
    });

    await openDialog();

    expect(await screen.findByText("Licensed seats")).toBeInTheDocument();
  });
});
