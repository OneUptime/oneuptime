import LicenseDetails from "../../../AdminDashboard/License/LicenseDetails";
import EditionLabel from "Common/UI/Components/EditionLabel/EditionLabel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The edition dialog of the Enterprise Edition: core's EditionLabel with these
 * license details (ee/AdminDashboard/License/LicenseDetails). The core suite
 * keeps the part that holds without ee/; refreshing the license is
 * Settings > License (LicenseSettingsPage.test.tsx).
 *
 * Who sees the seat figures, and how a seat limit that is being enforced
 * reads: the installation refuses users above it, so the dialog must say what
 * it is already doing rather than suggest what could be done.
 */

let isEnterpriseEdition: boolean = true;
let billingEnabled: boolean = false;
let isMasterAdmin: boolean = true;
let isLoggedIn: boolean = true;

/*
 * Object.defineProperty rather than getters in an object literal: this file is
 * down-levelled, so `{ ...actual, get X() {} }` becomes Object.assign, which
 * reads each getter once and freezes it at module-load time.
 */
jest.mock("Common/UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "Common/UI/Config",
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

jest.mock("Common/UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdmin;
      },
      isLoggedIn: (): boolean => {
        return isLoggedIn;
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

jest.mock("Common/UI/Utils/API/API", () => {
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
    edition: "enterprise",
    status: "valid",
    verification: "verified",
    graceReason: null,
    graceEndsAt: null,
    activationMode: "online",
    licenseValid: true,
    isEvaluation: false,
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
  render(<EditionLabel licenseDetails={LicenseDetails} />);

  // The pill only knows what to say once the license GET has come back.
  await waitFor(() => {
    expect(fetchCalls.length).toBeGreaterThan(0);
  });

  fireEvent.click(screen.getByRole("button", { name: /Enterprise Edition/i }));
};

/*
 * The license GET also serves the login page, so on its own the server answers
 * a caller with no session with the reduced anonymous payload and a 200. Inside
 * a signed-in app that caller is this component with an expired session, and
 * the reduced payload reads as "no license, no instances". Sending
 * `signedIn=true` makes the server answer 401 instead, which the API client
 * refreshes and replays. On the login page (nobody signed in) the flag must
 * NOT be sent, or the page would get a 401 instead of the edition pill.
 */
describe("EditionLabel with the license details - telling the license route we expect to be signed in", () => {
  type LicenseGetFunction = () => FetchCall;

  const licenseGet: LicenseGetFunction = (): FetchCall => {
    const call: FetchCall | undefined = fetchCalls.find(
      (candidate: FetchCall): boolean => {
        return (
          candidate.method === "GET" &&
          candidate.url.includes("/global-config/license")
        );
      },
    );

    expect(call).toBeDefined();

    return call as FetchCall;
  };

  type RenderAndSettleFunction = () => Promise<void>;

  /*
   * Renders and waits for the license GET, then lets the response's state
   * updates land inside act() so they do not spill past the end of the test.
   */
  const renderAndSettle: RenderAndSettleFunction = async (): Promise<void> => {
    render(<EditionLabel licenseDetails={LicenseDetails} />);

    await waitFor(() => {
      expect(fetchCalls.length).toBeGreaterThan(0);
    });

    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });
  };

  beforeEach(() => {
    fetchCalls.length = 0;
    isEnterpriseEdition = true;
    billingEnabled = false;
    isMasterAdmin = true;
    isLoggedIn = true;
    respond = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(200, licensePayload(), {});
    };
  });

  it("adds signedIn=true to the license fetch when a user is logged in", async () => {
    isLoggedIn = true;

    await renderAndSettle();

    expect(licenseGet().url).toContain("signedIn=true");
  });

  it("does not add signedIn to the license fetch when nobody is logged in", async () => {
    isLoggedIn = false;

    await renderAndSettle();

    expect(licenseGet().url).toContain("/global-config/license");
    expect(licenseGet().url).not.toContain("signedIn");
  });
});

describe("EditionLabel with the license details - who sees what", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    isEnterpriseEdition = true;
    billingEnabled = false;
    isMasterAdmin = true;
    isLoggedIn = true;
    respond = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(200, licensePayload(), {});
    };
  });

  /*
   * The server gives seat figures to a master admin only; anybody else would
   * be shown an empty "unlimited" card.
   */
  it("does not show the seat card to a user who is not a master admin", async () => {
    isMasterAdmin = false;
    respond = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          edition: "enterprise",
          status: "valid",
          verification: "verified",
          licenseValid: true,
          companyName: "Acme Inc",
          expiresAt: EXPIRES_AT,
          isEvaluation: false,
          isEvaluationLicense: false,
          graceEndsAt: null,
          graceReason: null,
        },
        {},
      );
    };

    await openDialog();

    expect(await screen.findByText("Licensed to")).toBeInTheDocument();
    expect(screen.queryByText("Licensed seats")).not.toBeInTheDocument();
    expect(screen.queryByText(/unlimited/)).not.toBeInTheDocument();
  });

  it("asks a non-admin to find one when the license needs activating", async () => {
    isMasterAdmin = false;
    respond = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        licensePayload({ licenseValid: false, token: null, status: "missing" }),
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
});

describe("EditionLabel with the license details - what an exhausted seat limit looks like", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    isEnterpriseEdition = true;
    billingEnabled = false;
    isMasterAdmin = true;
    isLoggedIn = true;
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
