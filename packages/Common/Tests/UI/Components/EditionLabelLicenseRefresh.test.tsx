import EditionLabel from "../../../UI/Components/EditionLabel/EditionLabel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The "Refresh license" button, and who is allowed to see it.
 *
 * The seat limit is set on oneuptime.com and can change on any day. It reaches
 * a self-hosted installation through a job that runs once a day — which was
 * merely slow while nothing acted on the number, and is a real problem now that
 * the installation refuses users above it. An administrator who has just bought
 * ten seats should not have to wait until tomorrow, and should not have to
 * re-type the license key into a box the dialog hides while the license is
 * valid. This button is the answer, so these tests pin that it:
 *
 *   - is offered only to a master admin, matching the server, which now
 *     requires one on both license writes;
 *   - sends no license key, so it can only ever refresh the key already
 *     stored and never replace a working license with a typo;
 *   - shows the new limit afterwards;
 *   - says so when it fails, rather than looking like it worked. The whole
 *     reason it was pressed is a belief that the stored terms are stale.
 */

let isEnterpriseEdition: boolean = true;
let billingEnabled: boolean = false;
let isMasterAdmin: boolean = true;

/*
 * Object.defineProperty rather than getters in an object literal: this file is
 * down-levelled, so `{ ...actual, get X() {} }` becomes Object.assign, which
 * reads each getter once and freezes it at module-load time.
 */
jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "IS_ENTERPRISE_EDITION", {
    get: (): boolean => {
      return isEnterpriseEdition;
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
    },
  };
});

interface FetchCall {
  method: string;
  url: string;
  data: JSONObject | undefined;
}

const fetchCalls: Array<FetchCall> = [];

type FetchResponder = (
  call: FetchCall,
) => HTTPResponse<JSONObject> | HTTPErrorResponse;

let respond: FetchResponder;

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      fetch: (options: {
        method: { toString: () => string };
        url: { toString: () => string };
        data?: JSONObject | undefined;
      }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const call: FetchCall = {
          method: options.method.toString(),
          url: options.url.toString(),
          data: options.data,
        };

        fetchCalls.push(call);

        return Promise.resolve(respond(call));
      },
      getFriendlyMessage: (err: unknown): string => {
        if (err instanceof HTTPErrorResponse) {
          return err.message;
        }

        return String(err);
      },
    },
  };
});

const EXPIRES_AT: string = "2031-01-01T00:00:00.000Z";

type LicensePayloadFunction = (
  overrides?: Record<string, unknown>,
) => JSONObject;

const licensePayload: LicensePayloadFunction = (
  overrides?: Record<string, unknown>,
): JSONObject => {
  return {
    companyName: "Acme Inc",
    expiresAt: EXPIRES_AT,
    licenseKey: "acme-license-key",
    token: "signed.jwt.token",
    licenseValid: true,
    isEvaluationLicense: false,
    userLimit: 50,
    currentUserCount: 50,
    userCountUpdatedAt: "2026-01-01T00:00:00.000Z",
    instances: [],
    instanceId: "instance-1",
    currentVersion: "12.0.30",
    latestVersion: "12.0.30",
    isUpdateAvailable: false,
    isUpdateCheckDisabled: false,
    isSeatLimitEnforced: true,
    seatsInUse: 50,
    seatsRemaining: 0,
    canAddMoreUsers: false,
    ...overrides,
  };
};

type OpenDialogFunction = () => Promise<void>;

const openDialog: OpenDialogFunction = async (): Promise<void> => {
  render(<EditionLabel />);

  // The pill only knows what to say once the license GET has come back.
  await waitFor(() => {
    expect(fetchCalls.length).toBeGreaterThan(0);
  });

  fireEvent.click(screen.getByRole("button", { name: /Enterprise Edition/i }));
};

describe("EditionLabel - refreshing the license", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    isEnterpriseEdition = true;
    billingEnabled = false;
    isMasterAdmin = true;
    respond = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(200, licensePayload(), {});
    };
  });

  it("offers the button to a master admin once the license is valid", async () => {
    await openDialog();

    expect(
      await screen.findByTestId("refresh-enterprise-license"),
    ).toBeInTheDocument();
  });

  /*
   * The server requires a master admin on both license writes, so offering the
   * button to anyone else would only ever produce a permission error.
   */
  it("does not offer the button to a user who is not a master admin", async () => {
    isMasterAdmin = false;

    await openDialog();

    await waitFor(() => {
      expect(screen.getByText("Licensed seats")).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId("refresh-enterprise-license"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Change license key")).not.toBeInTheDocument();
  });

  it("asks a non-admin to find one when the license needs activating", async () => {
    isMasterAdmin = false;
    respond = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        licensePayload({ licenseValid: false, token: null }),
        {},
      );
    };

    await openDialog();

    expect(
      await screen.findByText("A master admin has to activate this license"),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Enter your enterprise license key"),
    ).not.toBeInTheDocument();
  });

  /*
   * No license key in the body. A refresh that carried one would be an
   * activation with a friendlier name.
   */
  it("refreshes the stored license without sending a key", async () => {
    await openDialog();

    fireEvent.click(await screen.findByTestId("refresh-enterprise-license"));

    await waitFor(() => {
      expect(
        fetchCalls.some((call: FetchCall): boolean => {
          return call.url.includes("/global-config/license/refresh");
        }),
      ).toBe(true);
    });

    const refreshCall: FetchCall = fetchCalls.find(
      (call: FetchCall): boolean => {
        return call.url.includes("/global-config/license/refresh");
      },
    ) as FetchCall;

    expect(refreshCall.method).toBe("POST");
    expect(refreshCall.data).toBeUndefined();
  });

  it("shows the new seat limit after a refresh", async () => {
    await openDialog();

    await screen.findByTestId("refresh-enterprise-license");

    // Ten more seats bought on oneuptime.com since the page loaded.
    respond = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        licensePayload({
          userLimit: 60,
          seatsRemaining: 10,
          canAddMoreUsers: true,
        }),
        {},
      );
    };

    fireEvent.click(screen.getByTestId("refresh-enterprise-license"));

    expect(
      await screen.findByText(/License refreshed from OneUptime/),
    ).toBeInTheDocument();
    expect(await screen.findByText(/60 seats/)).toBeInTheDocument();
  });

  /*
   * A refresh that quietly kept the old terms and said nothing would be worse
   * than no button at all: the administrator pressed it precisely because they
   * think the stored terms are wrong.
   */
  it("reports a failed refresh instead of looking like it worked", async () => {
    await openDialog();

    await screen.findByTestId("refresh-enterprise-license");

    respond = (
      call: FetchCall,
    ): HTTPResponse<JSONObject> | HTTPErrorResponse => {
      if (call.url.includes("/refresh")) {
        return new HTTPErrorResponse(
          500,
          { message: "Could not reach OneUptime." },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(200, licensePayload(), {});
    };

    fireEvent.click(screen.getByTestId("refresh-enterprise-license"));

    expect(
      await screen.findByText(/Could not reach OneUptime/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/License refreshed from OneUptime/),
    ).not.toBeInTheDocument();
  });
});

describe("EditionLabel - what an exhausted seat limit looks like", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    isEnterpriseEdition = true;
    billingEnabled = false;
    isMasterAdmin = true;
    respond = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(200, licensePayload(), {});
    };
  });

  /*
   * 50 of 50 is not over the limit, so the old arithmetic called it "nearly
   * full" — an amber nudge in front of a door that is already shut. Once the
   * limit is enforced, being exactly on it is the thing the administrator has
   * to act on.
   */
  it("treats a full license as a breach rather than a nudge", async () => {
    await openDialog();

    expect(
      await screen.findByText("Every licensed seat is in use"),
    ).toBeInTheDocument();
    expect(screen.getByText("Limit exceeded")).toBeInTheDocument();
  });

  it("says plainly that no more users can be added", async () => {
    await openDialog();

    expect(
      await screen.findByText(
        /New users cannot be invited, signed up or provisioned/,
      ),
    ).toBeInTheDocument();
  });

  /*
   * seatsInUse is computed from the live User table; currentUserCount is the
   * licence-wide figure oneuptime.com last computed, up to a day ago. The card
   * has to show the one enforcement uses, or it contradicts the invitation that
   * just bounced.
   */
  it("shows the live enforced usage rather than the last reported count", async () => {
    respond = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        licensePayload({
          currentUserCount: 40,
          seatsInUse: 50,
        }),
        {},
      );
    };

    await openDialog();

    await waitFor(() => {
      expect(screen.getByText("Licensed seats")).toBeInTheDocument();
    });

    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.queryByText("40")).not.toBeInTheDocument();
  });

  /*
   * A build or a deployment that reports no enforcement must not be rendered as
   * one that is refusing users.
   */
  it("says nothing about enforcement when the server reports none", async () => {
    respond = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        licensePayload({
          isSeatLimitEnforced: false,
          seatsInUse: null,
          seatsRemaining: null,
          canAddMoreUsers: true,
          currentUserCount: 10,
          userLimit: 50,
        }),
        {},
      );
    };

    await openDialog();

    await waitFor(() => {
      expect(screen.getByText("Licensed seats")).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/New users cannot be invited/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/This installation enforces the seat limit/),
    ).not.toBeInTheDocument();
  });
});
