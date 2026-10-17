import EditionLabel, {
  LICENSE_LAPSED_STATE,
} from "../../../UI/Components/EditionLabel/EditionLabel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * A self-hosted installation bought on a cloud marketplace has no license key:
 * it is licensed for as long as the marketplace accepts its hourly usage
 * reports. So the edition pill and dialog speak of the marketplace - licensed
 * through it, its reports not accepted, its subscription over - and never
 * offer to renew or refresh a key nobody has.
 */

let isMasterAdmin: boolean = true;

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
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

let payload: JSONObject = {};
let fetchCount: number = 0;

jest.mock("../../../UI/Utils/API/API", () => {
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

const HOUR_IN_MS: number = 60 * 60 * 1000;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

const iso: (offsetInMs: number) => string = (offsetInMs: number): string => {
  return new Date(Date.now() + offsetInMs).toISOString();
};

const BILLING: JSONObject = {
  marketplace: "AWS",
  verifiedAt: iso(-HOUR_IN_MS),
  refusedAt: null,
  refusal: null,
  lastAcceptedReport: {
    hourStart: iso(-2 * HOUR_IN_MS),
    quantity: 42,
    reportId: "record-1",
    acceptedAt: iso(-HOUR_IN_MS),
  },
  pendingReportCount: 0,
  pendingUserHours: 0,
  lastProblem: null,
  lastProblemAt: null,
};

// What GET /global-config/license gives a master admin of a marketplace-licensed installation.
const marketplacePayload: (overrides?: JSONObject) => JSONObject = (
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
    expiresAt: iso(71 * HOUR_IN_MS),
    isEvaluation: false,
    isEvaluationLicense: false,
    features: "all",
    marketplace: "AWS",
    message:
      "Licensed through AWS Marketplace: every user is billed by the hour on your AWS Marketplace account.",
    licenseKey: null,
    token: null,
    activationMode: null,
    userLimit: null,
    currentUserCount: null,
    userCountUpdatedAt: null,
    instances: [],
    instanceId: "instance-1",
    marketplaceBilling: BILLING,
    currentVersion: "14.0.0",
    latestVersion: "14.0.0",
    latestVersionPublishedAt: null,
    latestVersionCheckedAt: null,
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
  render(<EditionLabel />);

  await waitFor(() => {
    expect(fetchCount).toBeGreaterThan(0);
  });

  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: /Enterprise Edition/i }),
    ).not.toHaveTextContent("Checking");
  });

  fireEvent.click(screen.getByRole("button", { name: /Enterprise Edition/i }));
};

beforeEach(() => {
  isMasterAdmin = true;
  fetchCount = 0;
  payload = marketplacePayload();
});

describe("EditionLabel - licensed through a cloud marketplace", () => {
  it("says the installation is licensed through the marketplace, billed per user by the hour", async () => {
    await openDialog();

    const notice: HTMLElement = await screen.findByTestId(
      "enterprise-marketplace-license-notice",
    );

    expect(notice).toHaveTextContent("Licensed through AWS Marketplace");
    expect(notice).toHaveTextContent(
      "Every user of this installation is billed by the hour on your AWS Marketplace account.",
    );
    expect(notice).toHaveTextContent("42 user-hours");
    expect(
      screen.getByText(
        "Licensed through your cloud marketplace subscription: every user is billed by the hour.",
      ),
    ).toBeInTheDocument();
  });

  it("shows no key details: nobody holds a key to be licensed to or to renew", async () => {
    await openDialog();
    await screen.findByTestId("enterprise-marketplace-license-notice");

    expect(screen.queryByText("Licensed to")).not.toBeInTheDocument();
    expect(screen.queryByText(/Renew license/)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("enterprise-license-grace-notice"),
    ).not.toBeInTheDocument();
  });

  it("keeps the pill plain while the marketplace takes the reports", async () => {
    render(<EditionLabel />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Enterprise Edition/i }),
      ).toHaveTextContent("Enterprise Edition");
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Enterprise Edition/i }),
      ).not.toHaveTextContent("Marketplace");
    });
  });

  it("shows a master admin the last problem reporting, while the license still holds", async () => {
    payload = marketplacePayload({
      marketplaceBilling: {
        ...BILLING,
        lastProblem: "ThrottlingException: Rate exceeded",
        lastProblemAt: iso(-10 * 60 * 1000),
      },
    });

    await openDialog();

    expect(
      await screen.findByTestId("enterprise-marketplace-problem"),
    ).toHaveTextContent(
      "Last reporting problem: ThrottlingException: Rate exceeded",
    );
  });

  it("tells anybody else only that the marketplace licenses the installation", async () => {
    isMasterAdmin = false;
    payload = {
      edition: "enterprise",
      status: "valid",
      verification: "none",
      graceReason: null,
      graceEndsAt: null,
      licenseValid: true,
      companyName: null,
      expiresAt: iso(71 * HOUR_IN_MS),
      isEvaluation: false,
      isEvaluationLicense: false,
      features: "all",
      marketplace: "AWS",
    };

    await openDialog();

    const notice: HTMLElement = await screen.findByTestId(
      "enterprise-marketplace-license-notice",
    );
    expect(notice).toHaveTextContent("Licensed through AWS Marketplace");
    expect(notice).not.toHaveTextContent("user-hours");
  });

  it.each([
    ["Azure", "Microsoft Marketplace"],
    ["GoogleCloud", "Google Cloud Marketplace"],
  ])(
    "names %s by the marketplace's own name",
    async (marketplace: string, name: string) => {
      payload = marketplacePayload({ marketplace });

      await openDialog();

      expect(
        await screen.findByTestId("enterprise-marketplace-license-notice"),
      ).toHaveTextContent(`Licensed through ${name}`);
    },
  );

  it("ignores a marketplace it does not know, and shows the license as any other", async () => {
    payload = marketplacePayload({
      marketplace: "Oracle",
      companyName: "Acme Inc",
    });

    await openDialog();

    expect(await screen.findByText("Licensed to")).toBeInTheDocument();
    expect(
      screen.queryByTestId("enterprise-marketplace-license-notice"),
    ).not.toBeInTheDocument();
  });
});

describe("EditionLabel - a marketplace that is not accepting the reports", () => {
  beforeEach(() => {
    payload = marketplacePayload({
      status: "grace",
      graceReason: "expired",
      graceEndsAt: iso(27 * DAY_IN_MS),
      expiresAt: iso(-3 * DAY_IN_MS),
      marketplaceBilling: {
        ...BILLING,
        verifiedAt: iso(-6 * DAY_IN_MS),
        lastProblem:
          "AWS Marketplace MeterUsage failed (HTTP 400, InvalidEndpointRegionException)",
        lastProblemAt: iso(-15 * 60 * 1000),
      },
    });
  });

  it("says so on the pill, and asks to check billing rather than renew a license", async () => {
    render(<EditionLabel />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Enterprise Edition/i }),
      ).toHaveTextContent("Enterprise Edition (Marketplace Reports Failing)");
    });
    expect(
      screen.getByRole("button", { name: /Enterprise Edition/i }),
    ).toHaveTextContent("Check billing");
    expect(
      screen.getByRole("button", { name: /Enterprise Edition/i }),
    ).not.toHaveTextContent("Renew license");
  });

  it("explains that features keep working until the grace period ends, and shows the problem", async () => {
    await openDialog();

    const notice: HTMLElement = await screen.findByTestId(
      "enterprise-marketplace-grace-notice",
    );

    expect(notice).toHaveTextContent(
      "AWS Marketplace is not accepting usage reports",
    );
    expect(notice).toHaveTextContent(
      "Every enterprise feature keeps working until",
    );
    expect(notice).toHaveTextContent(
      "Make sure this installation can reach AWS Marketplace",
    );
    expect(notice).toHaveTextContent("InvalidEndpointRegionException");
    expect(
      screen.queryByTestId("enterprise-license-grace-notice"),
    ).not.toBeInTheDocument();
  });
});

describe("EditionLabel - a marketplace subscription that has ended", () => {
  beforeEach(() => {
    payload = marketplacePayload({
      status: "expired",
      licenseValid: false,
      features: [],
      expiresAt: iso(-HOUR_IN_MS),
      graceEndsAt: iso(-HOUR_IN_MS),
      message:
        "AWS Marketplace says this installation is not subscribed to OneUptime Enterprise (CustomerNotEntitledException).",
      marketplaceBilling: {
        ...BILLING,
        refusedAt: iso(-HOUR_IN_MS),
        refusal: "CustomerNotEntitledException",
      },
    });
  });

  it("says so on the pill, and asks to check the subscription", async () => {
    render(<EditionLabel />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Enterprise Edition/i }),
      ).toHaveTextContent(
        "Enterprise Edition (Marketplace Subscription Ended)",
      );
    });
    expect(
      screen.getByRole("button", { name: /Enterprise Edition/i }),
    ).toHaveTextContent("Check subscription");
  });

  it("says the marketplace no longer licenses the installation, what it said, and what has stopped", async () => {
    await openDialog();

    const notice: HTMLElement = await screen.findByTestId(
      "enterprise-marketplace-ended-notice",
    );

    expect(notice).toHaveTextContent(
      "AWS Marketplace no longer licenses this installation",
    );
    expect(notice).toHaveTextContent("CustomerNotEntitledException");
    expect(notice).toHaveTextContent(LICENSE_LAPSED_STATE);
    expect(
      screen.getByText(
        "Your cloud marketplace subscription no longer licenses this installation.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("enterprise-license-required-notice"),
    ).not.toBeInTheDocument();
  });
});
