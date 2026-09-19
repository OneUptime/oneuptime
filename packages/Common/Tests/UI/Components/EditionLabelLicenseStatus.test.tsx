import EditionLabel, {
  GRACE_ENFORCEMENT_SUMMARY,
  LICENSE_LAPSED_STATE,
  LICENSE_LAPSE_CONSEQUENCES,
  TRIAL_ENFORCEMENT_SUMMARY,
} from "../../../UI/Components/EditionLabel/EditionLabel";
import {
  LicenseManagerDialogParts,
  LicenseManagerProps,
} from "../../../UI/Components/EditionLabel/LicenseManager";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  LAPSED_STATE_PHRASES,
  LAPSE_WARNING_PHRASES,
  RETIRED_NOTICE_EXAMPLES,
  lapsedStateProblems,
  lapseWarningProblems,
} from "./EditionLabelLapseCopy";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The core half of the edition dialog: what EditionLabel shows on its own,
 * with no license manager - the login page, and any build without the
 * Enterprise plugin. Everything that changes the license (activation, offline
 * activation, refresh, the seat and instance cards) is the Enterprise
 * plugin's LicenseManager now; ee/Tests/UI/License runs this suite's original
 * tests, all of them, against EditionLabel with that manager. This one must
 * pass with ee/ deleted.
 *
 * What the edition pill and dialog say about the license, now that the
 * Enterprise license client reports a status rather than a yes/no:
 *
 *   valid    as before;
 *   grace    either an expired license's grace period (renew) or an unlicensed
 *            installation's trial counted from its first run (add a license) -
 *            the two must never be confused;
 *   expired, missing, invalid - with the lapse said plainly: single sign-on,
 *            SCIM and audit logging are off, "Require SSO" is not enforced
 *            (users sign in with their password), configuration is
 *            read-only, and everything resumes when a license is added. The
 *            trial and grace notices warn about exactly that beforehand
 *            (EditionLabelLapseCopy.ts);
 *   the Community Edition image running with IS_ENTERPRISE_EDITION set, told to
 *            a master admin;
 *   and what EditionLabel hands a license manager, and where its parts land.
 */

let isEnterpriseEdition: boolean = true;
let billingEnabled: boolean = false;
let isMasterAdmin: boolean = true;

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
      /*
       * EditionLabel asks whether anybody is signed in before it fetches the
       * license, to add `signedIn=true` (see EditionLabelLicenseRefresh).
       * These are signed-in dashboard screens.
       */
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

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const MISMATCH_FLAG: string = "ENTERPRISE_EDITION_REQUESTED_BUT_NOT_LOADED";

const inDays: (days: number) => string = (days: number): string => {
  return new Date(Date.now() + days * DAY_IN_MS).toISOString();
};

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
    expiresAt: inDays(200),
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
    isSeatLimitEnforced: true,
    seatsInUse: 10,
    seatsRemaining: 40,
    canAddMoreUsers: true,
    ...(overrides || {}),
  };
};

// What anybody else gets.
const publicPayload: PayloadFunction = (
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
    expiresAt: inDays(200),
    isEvaluation: false,
    isEvaluationLicense: false,
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

const renderPill: () => Promise<void> = async (): Promise<void> => {
  render(<EditionLabel />);

  await waitFor(() => {
    expect(fetchCalls.length).toBeGreaterThan(0);
  });
};

const openDialog: () => Promise<void> = async (): Promise<void> => {
  await renderPill();
  fireEvent.click(screen.getByRole("button", { name: /Enterprise Edition/i }));
};

const pill: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("button", { name: /Edition/ });
};

beforeEach(() => {
  fetchCalls.length = 0;
  isEnterpriseEdition = true;
  billingEnabled = false;
  isMasterAdmin = true;
  delete process.env[MISMATCH_FLAG];
  respondWith(adminPayload());
});

afterEach(() => {
  delete process.env[MISMATCH_FLAG];
});

describe("EditionLabel - a valid license", () => {
  it("reads plainly as the Enterprise Edition", async () => {
    await renderPill();

    await waitFor(() => {
      expect(pill()).toHaveAccessibleName("Enterprise Edition, View details");
    });
  });

  it("shows no status notice", async () => {
    await openDialog();

    expect(await screen.findByText("Licensed to")).toBeInTheDocument();
    expect(
      screen.queryByTestId("enterprise-license-required-notice"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("enterprise-license-grace-notice"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("enterprise-license-trial-notice"),
    ).not.toBeInTheDocument();
  });
});

describe("EditionLabel - an expired license in its grace period", () => {
  const graceEndsAt: string = inDays(5);

  beforeEach(() => {
    respondWith(
      adminPayload({
        status: "grace",
        graceReason: "expired",
        graceEndsAt,
        expiresAt: inDays(-9),
      }),
    );
  });

  it("says the license expired and asks for a renewal on the pill", async () => {
    await renderPill();

    await waitFor(() => {
      expect(pill()).toHaveAccessibleName(
        "Enterprise Edition (License Expired, Grace Period), Renew license",
      );
    });
  });

  it("tells when the grace period ends, and what happens then", async () => {
    await openDialog();

    const notice: HTMLElement = await screen.findByTestId(
      "enterprise-license-grace-notice",
    );

    expect(notice).toHaveTextContent(
      new Date(graceEndsAt).toLocaleDateString(),
    );
    expect(notice).toHaveTextContent("5 days left");
    expect(notice).toHaveTextContent(
      "Every enterprise feature keeps working until the grace period ends",
    );
    // What stops when it ends: SSO, SCIM and audit logging, not just configuration.
    expect(lapseWarningProblems(notice.textContent)).toEqual([]);
  });

  /*
   * The seats and the refresh button that sit beside these belong to the
   * license manager (ee/Tests/UI/License/LicenseManagerStatus pins them).
   */
  it("still counts as licensed: the details and the grace badge stay", async () => {
    await openDialog();

    expect(await screen.findByText("Licensed to")).toBeInTheDocument();
    expect(screen.getByText("Grace period")).toBeInTheDocument();
  });

  it("calls it a grace period, never a trial", async () => {
    await openDialog();

    const notice: HTMLElement = await screen.findByTestId(
      "enterprise-license-grace-notice",
    );

    expect(notice).toHaveTextContent(
      "Without a valid license (after the 14-day grace period), single sign-on (SAML and OIDC) stops",
    );
    expect(notice).not.toHaveTextContent(/trial/i);
  });

  it("does not call an expired license a trial", async () => {
    await openDialog();

    await screen.findByTestId("enterprise-license-grace-notice");

    expect(screen.queryByText(/trial/i)).not.toBeInTheDocument();
  });

  it("asks somebody who is not a master admin to find one", async () => {
    isMasterAdmin = false;
    respondWith(
      publicPayload({
        status: "grace",
        graceReason: "expired",
        graceEndsAt,
        expiresAt: inDays(-9),
      }),
    );

    await openDialog();

    expect(
      await screen.findByText(
        "Ask a master admin of this installation to renew the license.",
      ),
    ).toBeInTheDocument();
  });
});

describe("EditionLabel - an unlicensed installation's trial", () => {
  const graceEndsAt: string = inDays(10);

  beforeEach(() => {
    respondWith(
      adminPayload({
        status: "grace",
        graceReason: "unlicensed",
        verification: "none",
        graceEndsAt,
        licenseValid: true,
        companyName: null,
        expiresAt: null,
        licenseKey: null,
        token: null,
        activationMode: null,
        userLimit: null,
        isSeatLimitEnforced: false,
        seatsInUse: null,
        seatsRemaining: null,
      }),
    );
  });

  it("shows the days left on the pill", async () => {
    await renderPill();

    await waitFor(() => {
      expect(pill()).toHaveAccessibleName(
        "Enterprise Edition (Trial, 10 days left), Add license",
      );
    });
  });

  it("explains the trial and what happens after it", async () => {
    await openDialog();

    const notice: HTMLElement = await screen.findByTestId(
      "enterprise-license-trial-notice",
    );

    expect(notice).toHaveTextContent("Enterprise Edition trial: 10 days left");
    expect(notice).toHaveTextContent("No Enterprise license is installed");
    expect(notice).toHaveTextContent(
      new Date(graceEndsAt).toLocaleDateString(),
    );
    // What stops when it ends: SSO, SCIM and audit logging, not just configuration.
    expect(lapseWarningProblems(notice.textContent)).toEqual([]);
  });

  /*
   * The first 14 days of an unlicensed install are its trial; only a license
   * that lapsed has a grace period. The notice used to call both "the 14-day
   * grace period".
   */
  it("calls the first 14 days a trial, not a grace period", async () => {
    await openDialog();

    const notice: HTMLElement = await screen.findByTestId(
      "enterprise-license-trial-notice",
    );

    expect(notice).toHaveTextContent(
      "Without a valid license (after the 14-day trial), single sign-on (SAML and OIDC) stops",
    );
    expect(notice).not.toHaveTextContent(/grace/i);
  });

  it("shows no empty license details for a license that does not exist", async () => {
    await openDialog();

    await screen.findByTestId("enterprise-license-trial-notice");

    expect(screen.queryByText("Licensed to")).not.toBeInTheDocument();
    expect(screen.queryByText("Licensed seats")).not.toBeInTheDocument();
    expect(screen.queryByText(/renew/i)).not.toBeInTheDocument();
  });

  it("says one day, not one days", async () => {
    respondWith(
      adminPayload({
        status: "grace",
        graceReason: "unlicensed",
        verification: "none",
        graceEndsAt: new Date(Date.now() + DAY_IN_MS / 2).toISOString(),
      }),
    );

    await renderPill();

    await waitFor(() => {
      expect(pill()).toHaveAccessibleName(
        "Enterprise Edition (Trial, 1 day left), Add license",
      );
    });
  });

  it("points somebody who is not a master admin at one", async () => {
    isMasterAdmin = false;
    respondWith(
      publicPayload({
        status: "grace",
        graceReason: "unlicensed",
        verification: "none",
        graceEndsAt,
        companyName: null,
        expiresAt: null,
      }),
    );

    await openDialog();

    expect(
      await screen.findByText(
        "Ask a master admin of this installation to add a license.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Enter your enterprise license key"),
    ).not.toBeInTheDocument();
  });
});

describe("EditionLabel - no usable license", () => {
  it.each([
    [
      "expired",
      "Enterprise Edition (License Expired), Renew license",
      "License expired",
    ],
    [
      "missing",
      "Enterprise Edition (License Required), Validate license",
      "No valid license",
    ],
    [
      "invalid",
      "Enterprise Edition (License Invalid), Fix license",
      "License not valid",
    ],
  ])(
    "a %s license reads as such on the pill and in the dialog",
    async (status: string, pillName: string, noticeTitle: string) => {
      respondWith(
        adminPayload({
          status,
          licenseValid: false,
          verification: status === "missing" ? "none" : "verified",
        }),
      );

      await renderPill();

      await waitFor(() => {
        expect(pill()).toHaveAccessibleName(pillName);
      });

      fireEvent.click(pill());

      const notice: HTMLElement = await screen.findByTestId(
        "enterprise-license-required-notice",
      );

      expect(notice).toHaveTextContent(noticeTitle);
      /*
       * The lapse, said plainly: single sign-on, SCIM and audit logging are
       * off, "Require SSO" is not enforced, configuration is read-only, it
       * all resumes with a license, and core monitoring is not touched.
       */
      expect(lapsedStateProblems(notice.textContent)).toEqual([]);
    },
  );

  it("shows a master admin why the license is not valid", async () => {
    respondWith(
      adminPayload({
        status: "invalid",
        licenseValid: false,
        message: "The license is bound to a different OneUptime instance.",
      }),
    );

    await openDialog();

    expect(
      await screen.findByTestId("enterprise-license-required-notice"),
    ).toHaveTextContent(
      "The license is bound to a different OneUptime instance.",
    );
  });

  /*
   * The old copy promised that validating a key would "turn these on
   * immediately" - the list is services (support, indemnification) as much as
   * features, so it still must not. It then said "Nothing you already
   * configured stops working without one", which stopped being true when
   * single sign-on, SCIM and audit logging began to stop with the license.
   */
  it("says what a license keeps running, and no longer that nothing stops without one", async () => {
    respondWith(adminPayload({ status: "missing", licenseValid: false }));

    await openDialog();

    await screen.findByText("What your license unlocks");

    expect(
      screen.queryByText(/turn these on immediately/),
    ).not.toBeInTheDocument();
    // Without a manager nobody here can add the license, so it names who can.
    expect(
      screen.getByText(
        /A master admin can add the license to keep single sign-on, SCIM provisioning and audit logging running/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Nothing you already configured stops working/),
    ).not.toBeInTheDocument();
  });

  it("asks for a license to turn single sign-on, SCIM and audit logging back on", async () => {
    respondWith(adminPayload({ status: "expired", licenseValid: false }));

    await openDialog();

    expect(
      await screen.findByText(
        "Add a valid license to turn single sign-on, SCIM and audit logging back on and make enterprise configuration editable.",
      ),
    ).toBeInTheDocument();
  });
});

describe("EditionLabel - an unverified legacy license", () => {
  /*
   * The notice tells a master admin that refreshing the license fixes it,
   * which takes the license manager: with it, a master admin is told
   * (ee/Tests/UI/License/LicenseManagerStatus); without it, nobody is.
   */
  it("is not raised where the license cannot be refreshed", async () => {
    respondWith(adminPayload({ verification: "unverified" }));

    await openDialog();

    await screen.findByText("Licensed to");

    expect(
      screen.queryByTestId("enterprise-license-unverified-notice"),
    ).not.toBeInTheDocument();
  });

  it("does not trouble anybody else with it", async () => {
    isMasterAdmin = false;
    respondWith(publicPayload({ verification: "unverified" }));

    await openDialog();

    await screen.findByText("Licensed to");

    expect(
      screen.queryByTestId("enterprise-license-unverified-notice"),
    ).not.toBeInTheDocument();
  });

  it("still reads as a valid license", async () => {
    respondWith(adminPayload({ verification: "unverified" }));

    await renderPill();

    await waitFor(() => {
      expect(pill()).toHaveAccessibleName("Enterprise Edition, View details");
    });
  });
});

describe("EditionLabel - the Community Edition", () => {
  beforeEach(() => {
    isEnterpriseEdition = false;
    respondWith(
      adminPayload({
        edition: "community",
        status: null,
        verification: null,
        licenseValid: false,
        licenseKey: null,
        token: null,
      }),
    );
  });

  it("does not ask about a license on page load", async () => {
    render(<EditionLabel />);

    expect(
      screen.getByRole("button", {
        name: "Community Edition, Learn more",
      }),
    ).toBeInTheDocument();
    expect(fetchCalls).toHaveLength(0);
  });

  it("keeps the comparison and the version card", async () => {
    render(<EditionLabel />);
    fireEvent.click(screen.getByRole("button", { name: /Community Edition/ }));

    expect(
      await screen.findByText(/You are running the Community Edition/),
    ).toBeInTheDocument();
    expect(await screen.findByText("This installation")).toBeInTheDocument();
    expect(screen.getByText("v13.0.0")).toBeInTheDocument();
  });

  /*
   * A leftover IS_ENTERPRISE_EDITION=true on the Community image: the server
   * tells the frontend through env.js. Only a master admin can switch the
   * image, so only a master admin is told.
   */
  it("tells a master admin to switch to the enterprise image", async () => {
    process.env[MISMATCH_FLAG] = "true";

    render(<EditionLabel />);

    const button: HTMLElement = screen.getByRole("button", {
      name: "Community Edition, Action needed",
    });

    fireEvent.click(button);

    expect(
      await screen.findByTestId("enterprise-edition-image-mismatch"),
    ).toHaveTextContent(
      "IS_ENTERPRISE_EDITION is set but this is the Community Edition image — switch to the enterprise image",
    );
  });

  it("does not tell anybody else", async () => {
    process.env[MISMATCH_FLAG] = "true";
    isMasterAdmin = false;

    render(<EditionLabel />);
    fireEvent.click(
      screen.getByRole("button", { name: "Community Edition, Learn more" }),
    );

    await screen.findByText(/You are running the Community Edition/);

    expect(
      screen.queryByTestId("enterprise-edition-image-mismatch"),
    ).not.toBeInTheDocument();
  });

  it("says nothing about the image when it was not asked for", async () => {
    render(<EditionLabel />);
    fireEvent.click(
      screen.getByRole("button", { name: "Community Edition, Learn more" }),
    );

    await screen.findByText(/You are running the Community Edition/);

    expect(
      screen.queryByTestId("enterprise-edition-image-mismatch"),
    ).not.toBeInTheDocument();
  });
});

describe("EditionLabel - oneuptime.com", () => {
  it("renders nothing and asks nothing with billing enabled", async () => {
    billingEnabled = true;

    const { container } = render(<EditionLabel />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(container).toBeEmptyDOMElement();
    expect(fetchCalls).toHaveLength(0);
  });

  /*
   * Every hook runs whatever the edition: the early return for billing sits
   * after them, so a re-render that changes the answer cannot change the
   * number of hooks React sees.
   */
  it("keeps React's hook order when the billing answer changes between renders", async () => {
    billingEnabled = true;

    const { rerender, container } = render(<EditionLabel />);

    billingEnabled = false;
    rerender(<EditionLabel />);

    await waitFor(() => {
      expect(container).not.toBeEmptyDOMElement();
    });
  });
});

const LICENSE_KEY_PLACEHOLDER: string = "Enter your enterprise license key";

const postCalls: () => Array<FetchCall> = (): Array<FetchCall> => {
  return fetchCalls.filter((call: FetchCall): boolean => {
    return call.method !== "GET";
  });
};

// Nothing that changes the license is on screen.
const expectNoLicenseControls: () => void = (): void => {
  expect(
    screen.queryByPlaceholderText(LICENSE_KEY_PLACEHOLDER),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("enterprise-license-token-input"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("switch-license-activation-mode"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("refresh-enterprise-license"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Change license key")).not.toBeInTheDocument();
  expect(screen.queryByText("Replace license")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Validate License|Activate License/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Licensed seats")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Instances on this license"),
  ).not.toBeInTheDocument();
};

/*
 * The login page, and any Dashboard or Admin Dashboard built without the
 * Enterprise plugin: EditionLabel on its own reads the license and never
 * writes it, and tells nobody - not even a master admin - to manage it from
 * a dialog that cannot.
 */
describe("EditionLabel - without a license manager", () => {
  it.each([
    ["no license", { status: "missing", licenseValid: false }],
    [
      "the trial",
      {
        status: "grace",
        graceReason: "unlicensed",
        graceEndsAt: inDays(10),
        licenseKey: null,
      },
    ],
    [
      "an expired license in its grace period",
      { status: "grace", graceReason: "expired", graceEndsAt: inDays(5) },
    ],
    ["a valid license", {}],
  ])(
    "offers no license controls and writes nothing for %s",
    async (_name: string, overrides: Record<string, unknown>) => {
      respondWith(adminPayload(overrides));

      await openDialog();

      await waitFor(() => {
        expect(screen.getByText("This installation")).toBeInTheDocument();
      });

      expectNoLicenseControls();
      expect(postCalls()).toEqual([]);
    },
  );

  it("points even a master admin at somebody else during the trial", async () => {
    respondWith(
      adminPayload({
        status: "grace",
        graceReason: "unlicensed",
        graceEndsAt: inDays(10),
      }),
    );

    await openDialog();

    expect(
      await screen.findByText(
        "Ask a master admin of this installation to add a license.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/below/)).not.toBeInTheDocument();
  });

  it("asks for a renewal rather than a refresh it cannot offer", async () => {
    respondWith(
      adminPayload({
        status: "grace",
        graceReason: "expired",
        graceEndsAt: inDays(5),
        expiresAt: inDays(-9),
      }),
    );

    await openDialog();

    expect(
      await screen.findByText(
        "Ask a master admin of this installation to renew the license.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/refresh it here/)).not.toBeInTheDocument();
  });

  it("explains who can activate a missing license", async () => {
    respondWith(adminPayload({ status: "missing", licenseValid: false }));

    await openDialog();

    expect(
      await screen.findByText("A master admin has to activate this license"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /A master admin can add the license to keep single sign-on, SCIM provisioning and audit logging running and enterprise configuration editable/,
      ),
    ).toBeInTheDocument();
  });
});

describe("EditionLabel - the Community dialog", () => {
  beforeEach(() => {
    isEnterpriseEdition = false;
    respondWith(
      adminPayload({
        edition: "community",
        status: null,
        verification: null,
        licenseValid: false,
        licenseKey: null,
        token: null,
      }),
    );
  });

  it("has no license input, refresh or offline controls, and makes no POST", async () => {
    const originalOpen: typeof window.open = window.open;
    const opened: Array<string> = [];

    window.open = ((url?: string | URL): Window | null => {
      opened.push(String(url));
      return null;
    }) as typeof window.open;

    try {
      render(<EditionLabel />);
      fireEvent.click(
        screen.getByRole("button", { name: "Community Edition, Learn more" }),
      );

      expect(
        await screen.findByText(/You are running the Community Edition/),
      ).toBeInTheDocument();
      await screen.findByText("This installation");

      expectNoLicenseControls();

      // The one primary action is the sales conversation, off-site.
      fireEvent.click(screen.getByRole("button", { name: "Talk to Sales" }));

      expect(opened).toEqual(["https://oneuptime.com/enterprise/demo"]);
      expect(fetchCalls.length).toBeGreaterThan(0);
      expect(postCalls()).toEqual([]);
    } finally {
      window.open = originalOpen;
    }
  });
});

/*
 * The contract with a license manager, proved with a stand-in: what
 * EditionLabel hands it, where the parts it returns land, and when it is
 * rendered at all. The real manager (ee/AdminDashboard/License) is tested in
 * ee/Tests/UI/License.
 */
describe("EditionLabel - with a license manager", () => {
  const managerProps: Array<LicenseManagerProps> = [];
  let parts: LicenseManagerDialogParts = {};
  let submitted: number = 0;

  const FakeLicenseManager: (
    props: LicenseManagerProps,
  ) => React.ReactElement = (
    props: LicenseManagerProps,
  ): React.ReactElement => {
    managerProps.push(props);

    return props.renderDialog(parts);
  };

  const latestProps: () => LicenseManagerProps = (): LicenseManagerProps => {
    const props: LicenseManagerProps | undefined =
      managerProps[managerProps.length - 1];

    expect(props).toBeDefined();

    return props as LicenseManagerProps;
  };

  const renderWithManager: () => Promise<void> = async (): Promise<void> => {
    render(<EditionLabel licenseManager={FakeLicenseManager} />);

    await waitFor(() => {
      expect(fetchCalls.length).toBeGreaterThan(0);
    });
  };

  // Opens the dialog and waits for the license GET to fill its body in.
  const openWithManager: () => Promise<void> = async (): Promise<void> => {
    await renderWithManager();
    fireEvent.click(pill());
    await screen.findByText("This installation");
  };

  const isBefore: (first: HTMLElement, second: HTMLElement) => boolean = (
    first: HTMLElement,
    second: HTMLElement,
  ): boolean => {
    return Boolean(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  };

  beforeEach(() => {
    managerProps.length = 0;
    submitted = 0;
    parts = {
      messages: <div data-testid="fake-messages" />,
      usage: <div data-testid="fake-usage" />,
      activation: <div data-testid="fake-activation" />,
    };
  });

  it("puts each part where the dialog has always had it", async () => {
    await openWithManager();

    const messages: HTMLElement = await screen.findByTestId("fake-messages");
    const details: HTMLElement = screen.getByText("Licensed to");
    const version: HTMLElement = screen.getByText("This installation");
    const usage: HTMLElement = screen.getByTestId("fake-usage");
    const activation: HTMLElement = screen.getByTestId("fake-activation");

    expect(isBefore(messages, details)).toBe(true);
    expect(isBefore(details, version)).toBe(true);
    expect(isBefore(version, usage)).toBe(true);
    expect(isBefore(usage, activation)).toBe(true);
  });

  it("keeps the status notices between the messages and the activation input, and the feature list last", async () => {
    isMasterAdmin = false;
    respondWith(publicPayload({ status: "missing", licenseValid: false }));

    await renderWithManager();
    fireEvent.click(pill());
    await screen.findByText("What your license unlocks");

    const messages: HTMLElement = await screen.findByTestId("fake-messages");
    const required: HTMLElement = screen.getByTestId(
      "enterprise-license-required-notice",
    );
    const askAnAdmin: HTMLElement = screen.getByText(
      "A master admin has to activate this license",
    );
    const activation: HTMLElement = screen.getByTestId("fake-activation");
    const features: HTMLElement = screen.getByText("What your license unlocks");

    expect(isBefore(messages, required)).toBe(true);
    expect(isBefore(required, askAnAdmin)).toBe(true);
    expect(isBefore(askAnAdmin, activation)).toBe(true);
    expect(isBefore(activation, features)).toBe(true);
  });

  it("gives the manager the dialog's primary button and its footer", async () => {
    parts = {
      ...parts,
      submitButtonText: "Fake Submit",
      onSubmit: (): void => {
        submitted += 1;
      },
      leftFooterElement: <button type="button">Fake footer action</button>,
    };

    await openWithManager();

    fireEvent.click(await screen.findByRole("button", { name: "Fake Submit" }));

    expect(submitted).toBe(1);
    expect(
      screen.getByRole("button", { name: "Fake footer action" }),
    ).toBeInTheDocument();
  });

  it("disables the primary button while the manager says so", async () => {
    parts = {
      ...parts,
      submitButtonText: "Fake Submit",
      onSubmit: (): void => {
        submitted += 1;
      },
      disableSubmitButton: true,
    };

    await openWithManager();

    expect(
      await screen.findByRole("button", { name: "Fake Submit" }),
    ).toBeDisabled();
  });

  it("hands the manager what the license GET said", async () => {
    const body: JSONObject = adminPayload();
    respondWith(body);

    await openWithManager();

    await screen.findByText("Licensed to");

    const license: LicenseManagerProps["license"] = latestProps().license;

    expect(license.payload).toEqual(body);
    expect(license).toEqual(
      expect.objectContaining({
        isLoading: false,
        loadError: "",
        canManageLicense: true,
        licenseValid: true,
        isUnlicensedTrial: false,
        showLicenseDetails: true,
        companyName: "Acme Inc",
        licenseKey: "acme-license-key",
        userLimit: 50,
        currentUserCount: 10,
        effectiveUserCount: 10,
        isSeatLimitEnforced: true,
        canAddMoreUsers: true,
        seatTone: "healthy",
        seatUsageDisplayPercent: 20,
        currentVersion: "13.0.0",
        latestVersion: "13.0.0",
        hasComparableVersion: true,
      }),
    );
  });

  it("tells the manager that somebody who is not a master admin cannot manage the license", async () => {
    isMasterAdmin = false;
    respondWith(publicPayload());

    await renderWithManager();
    fireEvent.click(pill());

    await screen.findByText("Licensed to");

    expect(latestProps().license.canManageLicense).toBe(false);
  });

  it("tells the manager about the trial", async () => {
    respondWith(
      adminPayload({
        status: "grace",
        graceReason: "unlicensed",
        graceEndsAt: inDays(10),
      }),
    );

    await renderWithManager();
    fireEvent.click(pill());

    await screen.findByTestId("enterprise-license-trial-notice");

    expect(latestProps().license.isUnlicensedTrial).toBe(true);
    expect(latestProps().license.showLicenseDetails).toBe(false);
    // With a manager to add it with, a master admin is pointed at it.
    expect(
      screen.getByText(
        "Add a license below before the trial ends to keep single sign-on, SCIM and audit logging running and enterprise configuration editable.",
      ),
    ).toBeInTheDocument();
  });

  it("hands over no payload, and the reason, when the license could not be read", async () => {
    respond = (): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        500,
        { message: "The license service is down." },
        {},
      );
    };

    await renderWithManager();
    fireEvent.click(pill());

    expect(
      await screen.findByText("Unable to load license details"),
    ).toBeInTheDocument();
    expect(latestProps().license.payload).toBeNull();
    expect(latestProps().license.loadError).toBe(
      "The license service is down.",
    );
  });

  it("stays mounted while the dialog is closed, and is told when it opens and closes", async () => {
    await renderWithManager();

    expect(latestProps().isDialogOpen).toBe(false);
    expect(screen.queryByTestId("fake-messages")).not.toBeInTheDocument();

    fireEvent.click(pill());

    expect(await screen.findByTestId("fake-messages")).toBeInTheDocument();
    expect(latestProps().isDialogOpen).toBe(true);

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(screen.queryByTestId("fake-messages")).not.toBeInTheDocument();
    expect(latestProps().isDialogOpen).toBe(false);
  });

  it("re-reads the license when the manager asks, with a fresh payload", async () => {
    await openWithManager();
    await screen.findByText("Licensed to");

    const before: number = fetchCalls.length;
    const payloadBefore: LicenseManagerProps["license"]["payload"] =
      latestProps().license.payload;

    await act(async () => {
      await latestProps().reloadLicense();
    });

    expect(fetchCalls.length).toBe(before + 1);
    expect(fetchCalls[fetchCalls.length - 1]?.method).toBe("GET");
    expect(latestProps().license.payload).not.toBe(payloadBefore);
    expect(latestProps().license.payload).toEqual(payloadBefore);
  });

  it("moves the pill when the manager applies the seat fields of a license write", async () => {
    await renderWithManager();

    await waitFor(() => {
      expect(pill()).toHaveAccessibleName("Enterprise Edition, View details");
    });

    act(() => {
      latestProps().applySeatEnforcement({
        isSeatLimitEnforced: true,
        seatsInUse: 50,
        canAddMoreUsers: false,
      });
    });

    expect(pill()).toHaveAccessibleName(
      "Enterprise Edition, User limit exceeded",
    );
    expect(latestProps().license.seatTone).toBe("breached");
    expect(latestProps().license.effectiveUserCount).toBe(50);
  });

  it("is never rendered on the Community Edition", async () => {
    isEnterpriseEdition = false;

    render(<EditionLabel licenseManager={FakeLicenseManager} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Community Edition, Learn more" }),
    );

    expect(
      await screen.findByText(/You are running the Community Edition/),
    ).toBeInTheDocument();
    expect(managerProps).toHaveLength(0);
    expect(screen.queryByTestId("fake-messages")).not.toBeInTheDocument();
  });

  it("is never rendered with billing enabled", async () => {
    billingEnabled = true;

    const { container } = render(
      <EditionLabel licenseManager={FakeLicenseManager} />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(container).toBeEmptyDOMElement();
    expect(managerProps).toHaveLength(0);
    expect(fetchCalls).toHaveLength(0);
  });
});

/*
 * The lapse checks the notices above rely on (EditionLabelLapseCopy.ts), and
 * the sentences EditionLabel builds its notices from. Each check has to fail
 * on the copy that promised SSO, SCIM and audit logging never stop, and on
 * copy that drops any single consequence - otherwise a passing notice test
 * proves nothing.
 */
describe("EditionLabel - the lapse copy and its checks", () => {
  it.each(RETIRED_NOTICE_EXAMPLES)(
    "rejects the retired soft-enforcement copy: %s",
    (retired: string) => {
      expect(lapseWarningProblems(retired)).toContain("retired: never stop");
      expect(lapsedStateProblems(retired)).toContain("retired: never stop");
      expect(lapseWarningProblems(retired)).toContain(
        "missing: single sign-on (SAML and OIDC) stops",
      );
      expect(lapsedStateProblems(retired)).toContain(
        "missing: Single sign-on (SAML and OIDC) and SCIM provisioning are off",
      );
    },
  );

  it("accepts the sentences EditionLabel ships", () => {
    expect(lapseWarningProblems(TRIAL_ENFORCEMENT_SUMMARY)).toEqual([]);
    expect(lapseWarningProblems(GRACE_ENFORCEMENT_SUMMARY)).toEqual([]);
    expect(lapsedStateProblems(LICENSE_LAPSED_STATE)).toEqual([]);
  });

  it.each(
    LAPSE_WARNING_PHRASES.map((phrase: string) => {
      return [phrase];
    }),
  )("reports a warning that leaves out: %s", (phrase: string) => {
    const withoutPhrase: string = LICENSE_LAPSE_CONSEQUENCES.replace(
      phrase,
      "",
    );

    expect(withoutPhrase).not.toBe(LICENSE_LAPSE_CONSEQUENCES);
    expect(lapseWarningProblems(withoutPhrase)).toEqual([`missing: ${phrase}`]);
  });

  it.each(
    LAPSED_STATE_PHRASES.map((phrase: string) => {
      return [phrase];
    }),
  )("reports a lapsed notice that leaves out: %s", (phrase: string) => {
    const withoutPhrase: string = LICENSE_LAPSED_STATE.replace(phrase, "");

    expect(withoutPhrase).not.toBe(LICENSE_LAPSED_STATE);
    expect(lapsedStateProblems(withoutPhrase)).toEqual([`missing: ${phrase}`]);
  });

  it("reports shipped copy that also promises SSO keeps running", () => {
    expect(
      lapseWarningProblems(
        `${TRIAL_ENFORCEMENT_SUMMARY} Everything you already configured keeps working.`,
      ),
    ).toEqual(["retired: already configured keeps working"]);
    expect(
      lapsedStateProblems(
        `${LICENSE_LAPSED_STATE} SSO, SCIM and audit logging never stop.`,
      ),
    ).toEqual(["retired: never stop"]);
  });

  it("warns without calling the trial a grace period, or the grace period a trial", () => {
    expect(LICENSE_LAPSE_CONSEQUENCES).not.toMatch(/grace|trial/i);
    expect(LICENSE_LAPSED_STATE).not.toMatch(/grace|trial/i);
    expect(TRIAL_ENFORCEMENT_SUMMARY).not.toMatch(/grace/i);
    expect(GRACE_ENFORCEMENT_SUMMARY).not.toMatch(/trial/i);
  });
});
