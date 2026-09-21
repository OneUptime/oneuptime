import LicenseManager from "../../../AdminDashboard/License/LicenseManager";
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
 * What the license manager does beyond what the original dialog suites pinned
 * (LicenseManagerStatus / LicenseManagerRefresh carry those unchanged): the
 * key change flow, the key input following the stored license, what survives
 * closing the dialog, the seat arithmetic and the instance list.
 *
 * Rendered the way the Enterprise image renders it: core's EditionLabel with
 * this manager, Enterprise Edition, billing off, a signed-in master admin
 * unless a test says otherwise.
 */

let isEnterpriseEdition: boolean = true;
let billingEnabled: boolean = false;
let isMasterAdmin: boolean = true;

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
        return true;
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

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

type PayloadFunction = (overrides?: Record<string, unknown>) => JSONObject;

// What GET /global-config/license gives a master admin for a valid license.
const adminPayload: PayloadFunction = (
  overrides?: Record<string, unknown>,
): JSONObject => {
  return {
    edition: "enterprise",
    status: "valid",
    verification: "verified",
    graceReason: null,
    graceEndsAt: null,
    licenseValid: true,
    companyName: "Acme Inc",
    expiresAt: new Date(Date.now() + 200 * DAY_IN_MS).toISOString(),
    isEvaluation: false,
    isEvaluationLicense: false,
    message: null,
    licenseKey: "acme-license-key",
    token: "signed.license.token",
    activationMode: "online",
    userLimit: 50,
    currentUserCount: 10,
    userCountUpdatedAt: "2026-01-01T00:00:00.000Z",
    instances: [],
    instanceId: "instance-1",
    currentVersion: "13.0.0",
    latestVersion: "13.0.0",
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

const respondWith: (payload: JSONObject) => void = (
  payload: JSONObject,
): void => {
  respond = (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(200, payload, {});
  };
};

const postCalls: () => Array<FetchCall> = (): Array<FetchCall> => {
  return fetchCalls.filter((call: FetchCall): boolean => {
    return call.method === "POST";
  });
};

const pill: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("button", { name: /Enterprise Edition/ });
};

const openDialog: () => Promise<void> = async (): Promise<void> => {
  render(<EditionLabel licenseManager={LicenseManager} />);

  await waitFor(() => {
    expect(fetchCalls.length).toBeGreaterThan(0);
  });

  fireEvent.click(pill());

  await screen.findByTestId("modal-footer-close-button");
};

const closeDialog: () => void = (): void => {
  fireEvent.click(screen.getByTestId("modal-footer-close-button"));

  expect(
    screen.queryByTestId("modal-footer-close-button"),
  ).not.toBeInTheDocument();
};

const reopenDialog: () => Promise<void> = async (): Promise<void> => {
  const getsBefore: number = fetchCalls.length;

  fireEvent.click(pill());

  // Opening the dialog re-reads the license; wait for it to land.
  await waitFor(() => {
    expect(fetchCalls.length).toBeGreaterThan(getsBefore);
  });

  await screen.findByTestId("modal-footer-close-button");

  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
};

const keyInput: () => Promise<HTMLInputElement> =
  async (): Promise<HTMLInputElement> => {
    return (await screen.findByPlaceholderText(
      "Enter your enterprise license key",
    )) as HTMLInputElement;
  };

const seatBar: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("progressbar", { name: "Licensed seat usage" });
};

beforeEach(() => {
  fetchCalls.length = 0;
  isEnterpriseEdition = true;
  billingEnabled = false;
  isMasterAdmin = true;
  respondWith(adminPayload());
});

describe("changing the license key", () => {
  it("opens an empty input for the new key, and Cancel puts everything back", async () => {
    await openDialog();

    fireEvent.click(await screen.findByText("Change license key"));

    expect(screen.getByText("New license key")).toBeInTheDocument();
    expect((await keyInput()).value).toBe("");
    expect(
      screen.getByRole("button", { name: "Validate License" }),
    ).toBeDisabled();
    // The footer actions give way to the input while a change is under way.
    expect(
      screen.queryByTestId("refresh-enterprise-license"),
    ).not.toBeInTheDocument();

    fireEvent.change(await keyInput(), { target: { value: "new-key" } });

    expect(
      screen.getByRole("button", { name: "Validate License" }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("New license key")).not.toBeInTheDocument();
    expect(screen.getByText("Change license key")).toBeInTheDocument();
    expect(screen.getByTestId("refresh-enterprise-license")).toBeInTheDocument();
    expect(postCalls()).toHaveLength(0);
  });

  it("sends the trimmed key, and nothing else, to the activation route, then re-reads the license", async () => {
    await openDialog();

    fireEvent.click(await screen.findByText("Change license key"));
    fireEvent.change(await keyInput(), {
      target: { value: "  new-license-key \n" },
    });

    const callsBeforeValidating: number = fetchCalls.length;

    respondWith(adminPayload({ licenseKey: "new-license-key" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Validate License" }));
    });

    expect(
      await screen.findByText("License validated successfully."),
    ).toBeInTheDocument();

    expect(postCalls()).toHaveLength(1);

    const post: FetchCall = postCalls()[0] as FetchCall;

    expect(post.url).toContain("/global-config/license");
    expect(post.url).not.toContain("/refresh");
    expect(post.data).toEqual({ licenseKey: "new-license-key" });

    // The dialog renders from the GET, so the POST is followed by one.
    const after: Array<FetchCall> = fetchCalls.slice(callsBeforeValidating);

    expect(
      after.map((call: FetchCall): string => {
        return call.method;
      }),
    ).toEqual(["POST", "GET"]);

    await waitFor(() => {
      expect(screen.queryByText("New license key")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Change license key")).toBeInTheDocument();
  });

  it("keeps the input open and says why, once, when the key is refused", async () => {
    await openDialog();

    fireEvent.click(await screen.findByText("Change license key"));
    fireEvent.change(await keyInput(), { target: { value: "typo-key" } });

    respond = (
      call: FetchCall,
    ): HTTPResponse<JSONObject> | HTTPErrorResponse => {
      if (call.method === "POST") {
        return new HTTPErrorResponse(
          400,
          { message: "This license key is not valid." },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(200, adminPayload(), {});
    };

    fireEvent.click(screen.getByRole("button", { name: "Validate License" }));

    expect(
      await screen.findByText("This license key is not valid."),
    ).toBeInTheDocument();
    // The input section carries the alert; the top of the dialog does not repeat it.
    expect(screen.getAllByText("This license key is not valid.")).toHaveLength(
      1,
    );
    expect(screen.getByText("New license key")).toBeInTheDocument();
    expect(
      screen.queryByText("License validated successfully."),
    ).not.toBeInTheDocument();
  });

  it("replaces an offline license with a new token, not a key", async () => {
    respondWith(adminPayload({ activationMode: "offline", licenseKey: null }));

    await openDialog();

    fireEvent.click(await screen.findByText("Replace license"));

    expect(
      screen.getByText("License token (offline activation)"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("enterprise-license-token-input"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Activate License" }),
    ).toBeDisabled();
  });
});

describe("the key input follows the stored license", () => {
  it("starts from the stored key when the license needs validating again", async () => {
    respondWith(
      adminPayload({
        status: "invalid",
        licenseValid: false,
        licenseKey: "stored-license-key",
      }),
    );

    await openDialog();

    await waitFor(async () => {
      expect((await keyInput()).value).toBe("stored-license-key");
    });
  });

  it("keeps what the admin typed when the license is read again", async () => {
    respondWith(adminPayload({ status: "missing", licenseValid: false }));

    await openDialog();

    fireEvent.change(await keyInput(), { target: { value: "typed-key" } });

    closeDialog();
    await reopenDialog();

    expect((await keyInput()).value).toBe("typed-key");
  });
});

describe("closing and reopening the dialog", () => {
  it("keeps the chosen input and the pasted token, and clears the last error", async () => {
    respondWith(adminPayload({ status: "missing", licenseValid: false }));

    await openDialog();

    fireEvent.click(await screen.findByTestId("switch-license-activation-mode"));
    fireEvent.change(screen.getByTestId("enterprise-license-token-input"), {
      target: { value: "header.payload.signature" },
    });

    respond = (
      call: FetchCall,
    ): HTTPResponse<JSONObject> | HTTPErrorResponse => {
      if (call.method === "POST") {
        return new HTTPErrorResponse(
          400,
          { message: "This token has expired." },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(
        200,
        adminPayload({ status: "missing", licenseValid: false }),
        {},
      );
    };

    fireEvent.click(screen.getByRole("button", { name: "Activate License" }));

    expect(
      await screen.findByText("This token has expired."),
    ).toBeInTheDocument();

    closeDialog();
    await reopenDialog();

    expect(
      screen.getByTestId("enterprise-license-token-input"),
    ).toHaveValue("header.payload.signature");
    expect(
      screen.queryByText("This token has expired."),
    ).not.toBeInTheDocument();
  });

  it("abandons a license change", async () => {
    await openDialog();

    fireEvent.click(await screen.findByText("Change license key"));
    expect(screen.getByText("New license key")).toBeInTheDocument();

    closeDialog();
    await reopenDialog();

    expect(screen.queryByText("New license key")).not.toBeInTheDocument();
    expect(await screen.findByText("Change license key")).toBeInTheDocument();
  });

  it("clears the last success message", async () => {
    await openDialog();

    respondWith(adminPayload({ userLimit: 60 }));

    fireEvent.click(await screen.findByTestId("refresh-enterprise-license"));

    expect(
      await screen.findByText("License refreshed from OneUptime."),
    ).toBeInTheDocument();

    closeDialog();
    await reopenDialog();

    expect(
      screen.queryByText("License refreshed from OneUptime."),
    ).not.toBeInTheDocument();
  });
});

describe("seat usage", () => {
  it("nudges before the license fills up", async () => {
    respondWith(adminPayload({ currentUserCount: 46 }));

    await openDialog();

    expect(
      await screen.findByText("Only 4 seats left on your license"),
    ).toBeInTheDocument();
    expect(screen.getByText("4 seats remaining")).toBeInTheDocument();
    expect(
      screen.getByText("92% of licensed seats in use"),
    ).toBeInTheDocument();
    expect(seatBar()).toHaveAttribute("aria-valuenow", "92");
    expect(seatBar()).toHaveAttribute(
      "aria-valuetext",
      "92% of licensed seats in use — 4 seats remaining",
    );
    expect(screen.getByText("Nearly full")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Request more seats/ }),
    ).toBeInTheDocument();
    expect(pill()).toHaveAccessibleName("Enterprise Edition, Seats nearly full");
  });

  it("reports an unenforced breach with its real figure, and keeps the bar inside its track", async () => {
    respondWith(adminPayload({ currentUserCount: 52 }));

    await openDialog();

    expect(
      await screen.findByText("2 users over your licensed seats"),
    ).toBeInTheDocument();
    expect(screen.getByText("2 over limit")).toBeInTheDocument();
    expect(seatBar()).toHaveAttribute("aria-valuenow", "100");
    expect(seatBar()).toHaveAttribute(
      "aria-valuetext",
      "104% of licensed seats in use — 2 users over your licensed seats",
    );
    expect(
      screen.getByText(/Expand your license so it covers everyone/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Expand your license/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/New users cannot be invited/),
    ).not.toBeInTheDocument();
  });

  it("never rounds a free seat up to 100%", async () => {
    respondWith(adminPayload({ userLimit: 600, currentUserCount: 599 }));

    await openDialog();

    expect(
      await screen.findByText("99% of licensed seats in use"),
    ).toBeInTheDocument();
    expect(seatBar()).toHaveAttribute("aria-valuenow", "99");
    expect(screen.getByText("1 seat remaining")).toBeInTheDocument();
    expect(
      screen.getByText("Only 1 seat left on your license"),
    ).toBeInTheDocument();
  });

  it("shows an unlimited license without a bar", async () => {
    respondWith(adminPayload({ userLimit: null }));

    await openDialog();

    expect(await screen.findByText("Licensed seats")).toBeInTheDocument();
    expect(screen.getByText(/unlimited/)).toBeInTheDocument();
    expect(
      screen.queryByRole("progressbar", { name: "Licensed seat usage" }),
    ).not.toBeInTheDocument();
  });

  it("makes no sales ask where the server sent no license key", async () => {
    respondWith(
      adminPayload({
        currentUserCount: 46,
        activationMode: "offline",
        licenseKey: null,
      }),
    );

    await openDialog();

    expect(await screen.findByText("4 seats remaining")).toBeInTheDocument();
    expect(
      screen.queryByText("Only 4 seats left on your license"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Request more seats/ }),
    ).not.toBeInTheDocument();
  });
});

describe("the instances on the license", () => {
  const instances: Array<JSONObject> = [
    {
      instanceId: "instance-1",
      host: "oneuptime.acme.internal",
      userCount: 7,
      lastReportedAt: "2026-01-01T00:00:00.000Z",
      // Reported before the upgrade; this instance now runs 13.0.0.
      version: "12.9.0",
    },
    {
      instanceId: "instance-2",
      host: "staging.acme.internal",
      userCount: 1,
      lastReportedAt: null,
      version: "12.0.0",
    },
  ];

  it("lists each instance with its users, version and last report", async () => {
    respondWith(adminPayload({ instances }));

    await openDialog();

    expect(
      await screen.findByText("Instances on this license"),
    ).toBeInTheDocument();
    expect(screen.getByText("2 instances")).toBeInTheDocument();

    const thisInstance: HTMLElement = screen
      .getByText("oneuptime.acme.internal")
      .closest("li") as HTMLElement;
    const staging: HTMLElement = screen
      .getByText("staging.acme.internal")
      .closest("li") as HTMLElement;

    // The instance serving the page shows what it runs now, not its last report.
    expect(thisInstance).toHaveTextContent("This instance");
    expect(thisInstance).toHaveTextContent("v13.0.0");
    expect(thisInstance).not.toHaveTextContent("v12.9.0");
    expect(thisInstance).toHaveTextContent("7users");
    expect(thisInstance).not.toHaveTextContent("Update available.");

    expect(staging).not.toHaveTextContent("This instance");
    expect(staging).toHaveTextContent("v12.0.0");
    expect(staging).toHaveTextContent("No usage reported yet. Update available.");
    expect(staging).toHaveTextContent("1user");

    expect(
      screen.getByText(/counted uniquely across all 2 instances/),
    ).toHaveTextContent(
      "Per-instance counts can therefore add up to more than the 10 unique users counted above.",
    );
  });

  it("says nothing about overlap for a single instance", async () => {
    respondWith(adminPayload({ instances: [instances[0] as JSONObject] }));

    await openDialog();

    expect(await screen.findByText("1 instance")).toBeInTheDocument();
    expect(
      screen.queryByText(/counted uniquely across/),
    ).not.toBeInTheDocument();
  });

  it("is never shown to somebody who is not a master admin", async () => {
    isMasterAdmin = false;
    respondWith(adminPayload({ instances }));

    await openDialog();

    expect(await screen.findByText("Licensed to")).toBeInTheDocument();
    expect(
      screen.queryByText("Instances on this license"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("staging.acme.internal")).not.toBeInTheDocument();
  });
});

/*
 * A write the server ACCEPTED that did not leave this installation licensed.
 *
 * Activation refuses only a license this installation cannot use at all
 * ("invalid"). A license with no expiry recorded beside it is not that: it is
 * stored on purpose, because a token is better than nothing and the daily sync
 * may complete it. But past the trial, such an install has single sign-on,
 * SCIM and audit logging OFF - and this dialog used to answer the master admin
 * who had just pasted their key to fix that lapse with a green "License
 * validated successfully."
 *
 * The response carries the classification (status, graceReason) and its
 * message, so the dialog can say what actually happened.
 */
describe("a license that is stored but licenses nothing", () => {
  const NO_EXPIRY_MESSAGE: string =
    "A OneUptime Enterprise license is installed, but no expiry is recorded for it, so this installation cannot tell whether it is still current. " +
    "The 14-day trial counted from when this installation first ran the Enterprise Edition has ended, so Enterprise features have stopped. " +
    "A master admin can re-activate the license from the edition label in the Admin Dashboard, or leave the daily license sync to fetch its expiry from oneuptime.com.";

  const validateWith: (payload: JSONObject) => Promise<void> = async (
    payload: JSONObject,
  ): Promise<void> => {
    await openDialog();

    fireEvent.click(await screen.findByText("Change license key"));
    fireEvent.change(await keyInput(), { target: { value: "acme-key" } });

    respondWith(payload);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Validate License" }));
    });
  };

  it("warns instead of claiming success when the license lands past the trial", async () => {
    await validateWith(
      adminPayload({
        status: "missing",
        verification: "unverified",
        licenseValid: false,
        expiresAt: null,
        message: NO_EXPIRY_MESSAGE,
      }),
    );

    const warning: HTMLElement = await screen.findByTestId(
      "enterprise-license-stored-warning",
    );

    expect(warning).toHaveTextContent("no expiry is recorded for it");
    expect(warning).toHaveTextContent("Enterprise features have stopped");
    expect(
      screen.queryByText("License validated successfully."),
    ).not.toBeInTheDocument();
  });

  /*
   * Inside the trial the features are still on, but the license is still not
   * the thing keeping them on - so this is a warning too, not a tick.
   */
  it("warns when the license lands on the unlicensed trial", async () => {
    await validateWith(
      adminPayload({
        status: "grace",
        graceReason: "unlicensed",
        verification: "unverified",
        licenseValid: true,
        expiresAt: null,
        graceEndsAt: new Date(Date.now() + 10 * DAY_IN_MS).toISOString(),
        message: NO_EXPIRY_MESSAGE,
      }),
    );

    expect(
      await screen.findByTestId("enterprise-license-stored-warning"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("License validated successfully."),
    ).not.toBeInTheDocument();
  });

  /*
   * The license IS stored - the warning is not a refusal dressed up as one.
   * The POST went out, and the dialog re-read the license afterwards as it
   * always does.
   */
  it("still stores the license: the write happened and the dialog re-read it", async () => {
    await validateWith(
      adminPayload({
        status: "missing",
        verification: "unverified",
        licenseValid: false,
        expiresAt: null,
        message: NO_EXPIRY_MESSAGE,
      }),
    );

    await screen.findByTestId("enterprise-license-stored-warning");

    expect(postCalls()).toHaveLength(1);
    expect((postCalls()[0] as FetchCall).data).toEqual({
      licenseKey: "acme-key",
    });
  });

  it("falls back to its own words when the server sends no message", async () => {
    await validateWith(
      adminPayload({
        status: "missing",
        verification: "unverified",
        licenseValid: false,
        expiresAt: null,
        message: null,
      }),
    );

    expect(
      await screen.findByTestId("enterprise-license-stored-warning"),
    ).toHaveTextContent("The license was stored, but this installation cannot");
  });

  // A license that really is valid is still a green tick.
  it("still celebrates a license that licenses something", async () => {
    await validateWith(adminPayload({ licenseKey: "acme-key" }));

    expect(
      await screen.findByText("License validated successfully."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("enterprise-license-stored-warning"),
    ).not.toBeInTheDocument();
  });

  /*
   * And so is a license in its own grace period: it expired, but it is a
   * license, and the dialog's grace notice already explains it.
   */
  it("still celebrates a license in its own grace period", async () => {
    await validateWith(
      adminPayload({
        status: "grace",
        graceReason: "expired",
        licenseValid: true,
        expiresAt: new Date(Date.now() - 2 * DAY_IN_MS).toISOString(),
        graceEndsAt: new Date(Date.now() + 28 * DAY_IN_MS).toISOString(),
      }),
    );

    expect(
      await screen.findByText("License validated successfully."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("enterprise-license-stored-warning"),
    ).not.toBeInTheDocument();
  });

  it("warns the same way after a refresh, not only an activation", async () => {
    await openDialog();

    respondWith(
      adminPayload({
        status: "missing",
        verification: "unverified",
        licenseValid: false,
        expiresAt: null,
        message: NO_EXPIRY_MESSAGE,
      }),
    );

    fireEvent.click(await screen.findByTestId("refresh-enterprise-license"));

    expect(
      await screen.findByTestId("enterprise-license-stored-warning"),
    ).toHaveTextContent("no expiry is recorded for it");
    expect(
      screen.queryByText("License refreshed from OneUptime."),
    ).not.toBeInTheDocument();
  });

  it("clears the warning when the dialog is closed and reopened", async () => {
    await validateWith(
      adminPayload({
        status: "missing",
        verification: "unverified",
        licenseValid: false,
        expiresAt: null,
        message: NO_EXPIRY_MESSAGE,
      }),
    );

    await screen.findByTestId("enterprise-license-stored-warning");

    closeDialog();
    await reopenDialog();

    expect(
      screen.queryByTestId("enterprise-license-stored-warning"),
    ).not.toBeInTheDocument();
  });
});
