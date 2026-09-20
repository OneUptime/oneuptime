import EditionLabel from "../../../UI/Components/EditionLabel/EditionLabel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
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
 * What EditionLabel on its own still does around the license GET and the seat
 * figures, with no license manager (the login page, a build without the
 * Enterprise plugin). This suite must pass with ee/ deleted.
 *
 * The "Refresh license" button this suite used to cover - offered only to a
 * master admin, sending no key, showing the new limit, reporting a failure -
 * is the Enterprise plugin's license manager now, together with the seat
 * card. ee/Tests/UI/License/LicenseManagerRefresh.test.tsx runs every one of
 * this suite's original tests against EditionLabel with that manager. What
 * stays here:
 *
 *   - the signedIn flag on the license GET;
 *   - a non-admin is told who can activate the license;
 *   - EditionLabel never offers a refresh, a key change or the seat card by
 *     itself, and writes nothing;
 *   - the pill still reads the seat figures, enforced usage first.
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
  render(<EditionLabel />);

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
describe("EditionLabel - telling the license route we expect to be signed in", () => {
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
    render(<EditionLabel />);

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

/*
 * Refreshing the license, changing its key and the seat card are the
 * Enterprise plugin's license manager now (ee/Tests/UI/License runs this
 * suite's original refresh and seat tests against it). What EditionLabel
 * still owns is below: telling a non-admin who can act, reading the seat
 * figures for the pill, and never writing the license itself.
 */
describe("EditionLabel - the license, read-only", () => {
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

  it("offers no refresh, key change or seat card on its own, even to a master admin", async () => {
    await openDialog();

    expect(await screen.findByText("Licensed to")).toBeInTheDocument();
    expect(
      screen.queryByTestId("refresh-enterprise-license"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Change license key")).not.toBeInTheDocument();
    expect(screen.queryByText("Licensed seats")).not.toBeInTheDocument();
    expect(
      fetchCalls.filter((call: FetchCall): boolean => {
        return call.method !== "GET" || call.url.includes("/refresh");
      }),
    ).toEqual([]);
  });
});

/*
 * The pill still reads the seat figures: an exhausted limit is what a master
 * admin has to see on every page, not only inside the dialog.
 */
describe("EditionLabel - what an exhausted seat limit looks like on the pill", () => {
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

  const pillNamed: (name: string) => Promise<void> = async (
    name: string,
  ): Promise<void> => {
    render(<EditionLabel />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Enterprise Edition/ }),
      ).toHaveAccessibleName(name);
    });
  };

  /*
   * 50 of 50 is not over the limit, but once the limit is enforced nobody
   * else gets in: a breach, not an amber nudge.
   */
  it("treats a full enforced license as a breach, on the pill and the dialog badge", async () => {
    await pillNamed("Enterprise Edition, User limit exceeded");

    fireEvent.click(screen.getByRole("button", { name: /Enterprise Edition/ }));

    expect(await screen.findByText("Seat limit exceeded")).toBeInTheDocument();
  });

  it("measures against the live enforced usage rather than the last reported count", async () => {
    respond = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        licensePayload({ currentUserCount: 40, seatsInUse: 50 }),
        {},
      );
    };

    await pillNamed("Enterprise Edition, User limit exceeded");
  });

  it("says nothing is wrong when the server reports no enforcement and seats are free", async () => {
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

    await pillNamed("Enterprise Edition, View details");
  });

  it("nudges when seats are nearly full", async () => {
    respond = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        licensePayload({
          isSeatLimitEnforced: false,
          seatsInUse: null,
          seatsRemaining: null,
          canAddMoreUsers: true,
          currentUserCount: 46,
          userLimit: 50,
        }),
        {},
      );
    };

    await pillNamed("Enterprise Edition, Seats nearly full");
  });
});
