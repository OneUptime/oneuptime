import EditionLabel, {
  GRACE_ENFORCEMENT_SUMMARY,
  LICENSE_LAPSED_STATE,
  LICENSE_LAPSE_CONSEQUENCES,
  TRIAL_ENFORCEMENT_SUMMARY,
} from "../../../UI/Components/EditionLabel/EditionLabel";
import { LicenseDetailsProps } from "../../../UI/Components/EditionLabel/LicenseDetails";
import { announceLicenseChanged } from "../../../UI/Components/EditionLabel/LicenseEvents";
import Navigation from "../../../UI/Utils/Navigation";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "../../../Types/EnterpriseLicense/EnterpriseLicensePeriods";
import {
  LAPSED_STATE_PHRASES,
  LAPSE_WARNING_PHRASES,
  RETIRED_NOTICE_EXAMPLES,
  RETIRED_SINGLE_SIGN_ON_STOPS_EXAMPLES,
  lapsedStateProblems,
  lapseWarningProblems,
  singleSignOnMentions,
} from "./EditionLabelLapseCopy";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The core half of the edition dialog: what EditionLabel shows on its own -
 * the login page, and any build without the Enterprise plugin - and what it
 * does with the Enterprise plugin's LicenseDetails (the seat and instance
 * cards), here a fake. The dialog only shows the license: activating and
 * refreshing it is Settings > License in the Admin Dashboard
 * (ee/Tests/UI/License). This one must pass with ee/ deleted.
 *
 * What the edition pill and dialog say about the license, now that the
 * Enterprise license client reports a status rather than a yes/no:
 *
 *   valid    as before;
 *   grace    either an expired license's grace period (renew) or an unlicensed
 *            installation's trial counted from its first run (add a license) -
 *            the two must never be confused;
 *   expired, missing, invalid - with the lapse said plainly: SCIM
 *            provisioning and audit logging are off, configuration is
 *            read-only, and everything resumes when a license is added. The
 *            trial and grace notices warn about exactly that beforehand
 *            (EditionLabelLapseCopy.ts). None of them names single sign-on,
 *            which is part of every edition and does not depend on the
 *            license - the Community dialog lists it among the Community
 *            features;
 *   the Community Edition image running with IS_ENTERPRISE_EDITION set, told to
 *            a master admin;
 *   and what EditionLabel hands the license details, and where they land.
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
        expiresAt: inDays(-25),
      }),
    );
  });

  it("says the license expired and asks for a renewal on the pill", async () => {
    await renderPill();

    await waitFor(() => {
      expect(pill()).toHaveAccessibleName(
        "Enterprise Edition (License Expired, Grace Period), View details",
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
    /*
     * What stops when it ends: SCIM provisioning and audit logging, not just
     * configuration - and nothing about single sign-on.
     */
    expect(lapseWarningProblems(notice.textContent)).toEqual([]);
  });

  /*
   * The seats and the refresh button that sit beside these belong to the
   * license details (ee/Tests/UI/License/LicenseDetailsStatus pins them).
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
      "Without a valid license (after the 30-day grace period), SCIM provisioning stops",
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
        expiresAt: inDays(-25),
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
        "Enterprise Edition (Trial, 10 days left), View details",
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
    /*
     * What stops when it ends: SCIM provisioning and audit logging, not just
     * configuration - and nothing about single sign-on.
     */
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
      "Without a valid license (after the 14-day trial), SCIM provisioning stops",
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
        "Enterprise Edition (Trial, 1 day left), View details",
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
      "Enterprise Edition (License Expired), View details",
      "License expired",
    ],
    [
      "missing",
      "Enterprise Edition (License Required), View details",
      "No valid license",
    ],
    [
      "invalid",
      "Enterprise Edition (License Invalid), View details",
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
       * The lapse, said plainly: SCIM provisioning and audit logging are
       * off, configuration is read-only, it all resumes with a license, and
       * core monitoring is not touched. Single sign-on is not mentioned: the
       * license does not touch it.
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
   * SCIM provisioning and audit logging began to stop with the license.
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
        /A master admin can add the license to keep SCIM provisioning and audit logging running/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Nothing you already configured stops working/),
    ).not.toBeInTheDocument();
  });

  it("asks for a license to turn SCIM provisioning and audit logging back on", async () => {
    respondWith(adminPayload({ status: "expired", licenseValid: false }));

    await openDialog();

    expect(
      await screen.findByText(
        "Add a valid license to turn SCIM provisioning and audit logging back on and make enterprise configuration editable.",
      ),
    ).toBeInTheDocument();
  });

  /*
   * Single sign-on is part of every edition: nothing a lapsed installation
   * shows about the license says it stops, is off or needs the license.
   */
  it.each(["expired", "missing", "invalid"])(
    "a %s license: nothing in the dialog names single sign-on",
    async (status: string) => {
      respondWith(adminPayload({ status, licenseValid: false }));

      await openDialog();

      await screen.findByTestId("enterprise-license-required-notice");
      await screen.findByText("What your license unlocks");

      expect(singleSignOnMentions(document.body.textContent)).toEqual([]);
    },
  );
});

describe("EditionLabel - an unverified legacy license", () => {
  /*
   * The notice tells a master admin that refreshing the license fixes it,
   * which takes the Enterprise frontends: with them, a master admin is told
   * (ee/Tests/UI/License/LicenseDetailsStatus); without it, nobody is.
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
   * SAML and OIDC single sign-on, for projects, status pages and the whole
   * instance, and "Require SSO for login" are Community Edition features;
   * the Enterprise column does not claim them.
   */
  it("lists single sign-on among the Community Edition's features, not the Enterprise Edition's", async () => {
    render(<EditionLabel />);
    fireEvent.click(screen.getByRole("button", { name: /Community Edition/ }));

    await screen.findByText(/You are running the Community Edition/);

    const communityColumn: HTMLElement = screen.getByText("Community Edition", {
      selector: "h4",
    }).parentElement as HTMLElement;
    const enterpriseColumn: HTMLElement = screen.getByText(
      "Enterprise Edition",
      { selector: "h4" },
    ).parentElement as HTMLElement;

    const communityFeatures: Array<string> = within(communityColumn)
      .getAllByRole("listitem")
      .map((item: HTMLElement) => {
        return item.textContent || "";
      });

    expect(communityFeatures).toContain(
      'SAML and OIDC single sign-on (SSO) for projects, status pages, and the whole instance, including "Require SSO for login".',
    );
    expect(singleSignOnMentions(enterpriseColumn.textContent)).toEqual([]);
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
const expectNoWriteControls: () => void = (): void => {
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
};

// Nor is anything the Enterprise details add.
const expectNoLicenseControls: () => void = (): void => {
  expectNoWriteControls();
  expect(screen.queryByText("Licensed seats")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Instances on this license"),
  ).not.toBeInTheDocument();
};

/*
 * The login page, and any Dashboard or Admin Dashboard built without the
 * Enterprise plugin: EditionLabel on its own reads the license and never
 * writes it, and tells nobody - not even a master admin - to manage it from
 * a page that is not there.
 */
describe("EditionLabel - without the license details", () => {
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
        /*
         * No license at all, which is what the server sends for this trial:
         * no token, and verification "none" because there was nothing to
         * judge. An install that IS holding a license reaches the same trial
         * (a token with no expiry recorded) and is told something different.
         */
        verification: "none",
        token: null,
        licenseKey: null,
        expiresAt: null,
        graceEndsAt: inDays(10),
      }),
    );

    await openDialog();

    expect(
      await screen.findByText(
        "Ask a master admin of this installation to add a license.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/in the Admin Dashboard/),
    ).not.toBeInTheDocument();
  });

  it("asks for a renewal rather than a refresh it cannot offer", async () => {
    respondWith(
      adminPayload({
        status: "grace",
        graceReason: "expired",
        graceEndsAt: inDays(5),
        expiresAt: inDays(-25),
      }),
    );

    await openDialog();

    expect(
      await screen.findByText(
        "Ask a master admin of this installation to renew the license.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/refresh it in the Admin Dashboard/),
    ).not.toBeInTheDocument();
  });

  it("explains who can activate a missing license", async () => {
    respondWith(adminPayload({ status: "missing", licenseValid: false }));

    await openDialog();

    expect(
      await screen.findByText("A master admin has to activate this license"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /A master admin can add the license to keep SCIM provisioning and audit logging running and enterprise configuration editable/,
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
 * The contract with the license details, proved with a stand-in: what
 * EditionLabel hands them, where they land, and when they are rendered at
 * all. Then the dialog's one action, what the pill asks of its reader, and
 * following the license page. The real details (ee/AdminDashboard/License)
 * are tested in ee/Tests/UI/License.
 */
describe("EditionLabel - with the license details", () => {
  const detailsProps: Array<LicenseDetailsProps> = [];

  const FakeLicenseDetails: (
    props: LicenseDetailsProps,
  ) => React.ReactElement = (
    props: LicenseDetailsProps,
  ): React.ReactElement => {
    detailsProps.push(props);

    return <div data-testid="fake-details" />;
  };

  const latestProps: () => LicenseDetailsProps = (): LicenseDetailsProps => {
    const props: LicenseDetailsProps | undefined =
      detailsProps[detailsProps.length - 1];

    expect(props).toBeDefined();

    return props as LicenseDetailsProps;
  };

  const renderWithDetails: () => Promise<void> = async (): Promise<void> => {
    render(<EditionLabel licenseDetails={FakeLicenseDetails} />);

    await waitFor(() => {
      expect(fetchCalls.length).toBeGreaterThan(0);
    });
  };

  // Opens the dialog and waits for the license GET to fill its body in.
  const openWithDetails: () => Promise<void> = async (): Promise<void> => {
    await renderWithDetails();
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
    detailsProps.length = 0;
  });

  it("draws the details after the version card", async () => {
    await openWithDetails();

    const details: HTMLElement = screen.getByText("Licensed to");
    const version: HTMLElement = screen.getByText("This installation");
    const usage: HTMLElement = await screen.findByTestId("fake-details");

    expect(isBefore(details, version)).toBe(true);
    expect(isBefore(version, usage)).toBe(true);
  });

  it("keeps the status notices above the details, and the feature list last", async () => {
    isMasterAdmin = false;
    respondWith(publicPayload({ status: "missing", licenseValid: false }));

    await renderWithDetails();
    fireEvent.click(pill());
    await screen.findByText("What your license unlocks");

    const required: HTMLElement = screen.getByTestId(
      "enterprise-license-required-notice",
    );
    const usage: HTMLElement = screen.getByTestId("fake-details");
    const askAnAdmin: HTMLElement = screen.getByText(
      "A master admin has to activate this license",
    );
    const features: HTMLElement = screen.getByText("What your license unlocks");

    expect(isBefore(required, usage)).toBe(true);
    expect(isBefore(usage, askAnAdmin)).toBe(true);
    expect(isBefore(askAnAdmin, features)).toBe(true);
  });

  it("hands the details what the license GET said", async () => {
    const body: JSONObject = adminPayload();
    respondWith(body);

    await openWithDetails();

    await screen.findByText("Licensed to");

    const license: LicenseDetailsProps["license"] = latestProps().license;

    expect(license.payload).toEqual(body);
    expect(license).toEqual(
      expect.objectContaining({
        canManageLicense: true,
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

  it("tells the details that somebody who is not a master admin cannot manage the license", async () => {
    isMasterAdmin = false;
    respondWith(publicPayload());

    await renderWithDetails();
    fireEvent.click(pill());

    await screen.findByText("Licensed to");

    expect(latestProps().license.canManageLicense).toBe(false);
  });

  it("tells the details about the trial, and sends a master admin to the Admin Dashboard", async () => {
    respondWith(
      adminPayload({
        status: "grace",
        graceReason: "unlicensed",
        // No license at all: no token, and nothing to verify.
        verification: "none",
        token: null,
        licenseKey: null,
        expiresAt: null,
        graceEndsAt: inDays(10),
      }),
    );

    await renderWithDetails();
    fireEvent.click(pill());

    await screen.findByTestId("enterprise-license-trial-notice");

    expect(latestProps().license.showLicenseDetails).toBe(false);
    expect(
      screen.getByText(
        "Add a license in the Admin Dashboard before the trial ends to keep SCIM provisioning and audit logging running and enterprise configuration editable.",
      ),
    ).toBeInTheDocument();
  });

  it("asks a master admin to refresh a renewed license in the Admin Dashboard", async () => {
    respondWith(
      adminPayload({
        status: "grace",
        graceReason: "expired",
        graceEndsAt: inDays(5),
        expiresAt: inDays(-25),
      }),
    );

    await renderWithDetails();
    fireEvent.click(pill());

    expect(
      await screen.findByText(
        "Renew the license with OneUptime, then refresh it in the Admin Dashboard.",
      ),
    ).toBeInTheDocument();
  });

  it("hands over no payload when the license could not be read", async () => {
    respond = (): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        500,
        { message: "The license service is down." },
        {},
      );
    };

    await renderWithDetails();
    fireEvent.click(pill());

    expect(
      await screen.findByText("Unable to load license details"),
    ).toBeInTheDocument();
    expect(latestProps().license.payload).toBeNull();
    expect(latestProps().license.showLicenseDetails).toBe(false);
  });

  it("is drawn only while the dialog is open", async () => {
    await renderWithDetails();

    expect(screen.queryByTestId("fake-details")).not.toBeInTheDocument();

    fireEvent.click(pill());

    expect(await screen.findByTestId("fake-details")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(screen.queryByTestId("fake-details")).not.toBeInTheDocument();
  });

  it("is never rendered on the Community Edition", async () => {
    isEnterpriseEdition = false;

    render(<EditionLabel licenseDetails={FakeLicenseDetails} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Community Edition, Learn more" }),
    );

    expect(
      await screen.findByText(/You are running the Community Edition/),
    ).toBeInTheDocument();
    expect(detailsProps).toHaveLength(0);
  });

  it("is never rendered with billing enabled", async () => {
    billingEnabled = true;

    const { container } = render(
      <EditionLabel licenseDetails={FakeLicenseDetails} />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(container).toBeEmptyDOMElement();
    expect(detailsProps).toHaveLength(0);
    expect(fetchCalls).toHaveLength(0);
  });

  /*
   * The footer of the dialog: nothing changes the license here, and the one
   * action takes a master admin to the page that does.
   */
  describe("the dialog's one action", () => {
    const manageLicense: () => HTMLElement | null = (): HTMLElement | null => {
      return screen.queryByRole("button", { name: "Manage license" });
    };

    let navigatedTo: Array<string> = [];
    let navigate: jest.SpyInstance;

    beforeEach(() => {
      navigatedTo = [];
      navigate = jest
        .spyOn(Navigation, "navigate")
        .mockImplementation((to: Route | URL): void => {
          navigatedTo.push(to.toString());
        });
    });

    afterEach(() => {
      navigate.mockRestore();
    });

    it.each([
      ["a valid license", {}],
      [
        "the trial",
        { status: "grace", graceReason: "unlicensed", graceEndsAt: inDays(10) },
      ],
      [
        "an expired license in its grace period",
        { status: "grace", graceReason: "expired", graceEndsAt: inDays(5) },
      ],
      ["no usable license", { status: "missing", licenseValid: false }],
      ["an invalid license", { status: "invalid", licenseValid: false }],
    ])(
      "takes a master admin to the license page from %s",
      async (_name: string, overrides: Record<string, unknown>) => {
        respondWith(adminPayload(overrides));

        await openWithDetails();

        fireEvent.click(manageLicense() as HTMLElement);

        expect(navigatedTo).toHaveLength(1);
        expect(navigatedTo[0]).toMatch(/\/admin\/settings\/license$/);
        // Takes them there; it changes nothing on the way.
        expect(postCalls()).toEqual([]);
      },
    );

    it("closes the dialog as it leaves", async () => {
      await openWithDetails();

      fireEvent.click(manageLicense() as HTMLElement);

      expect(screen.queryByTestId("fake-details")).not.toBeInTheDocument();
    });

    it("is the only action a master admin is offered", async () => {
      await openWithDetails();

      const footer: HTMLElement = screen.getByTestId(
        "modal-footer-close-button",
      ).parentElement as HTMLElement;

      expect(
        within(footer)
          .getAllByRole("button")
          .map((button: HTMLElement): string | null => {
            return button.textContent;
          }),
      ).toEqual(["Close", "Manage license"]);
      expectNoWriteControls();
    });

    it("is offered to nobody else, on any license", async () => {
      isMasterAdmin = false;
      respondWith(publicPayload({ status: "missing", licenseValid: false }));

      await renderWithDetails();
      fireEvent.click(pill());
      await screen.findByText("A master admin has to activate this license");

      expect(manageLicense()).not.toBeInTheDocument();
      expectNoWriteControls();
    });

    it("is not offered without the Enterprise details, even to a master admin", async () => {
      respondWith(adminPayload({ status: "missing", licenseValid: false }));

      await openDialog();
      await screen.findByText("A master admin has to activate this license");

      expect(manageLicense()).not.toBeInTheDocument();
    });

    it("leaves the Community dialog its Talk to Sales", async () => {
      isEnterpriseEdition = false;

      render(<EditionLabel licenseDetails={FakeLicenseDetails} />);
      fireEvent.click(
        screen.getByRole("button", { name: "Community Edition, Learn more" }),
      );

      expect(
        await screen.findByRole("button", { name: "Talk to Sales" }),
      ).toBeInTheDocument();
      expect(manageLicense()).not.toBeInTheDocument();
    });
  });

  /*
   * The same pill is in everybody's footer, and on the login page. It says
   * what the reader can do about the license: somebody who cannot change it
   * is never told to.
   */
  describe("what the pill asks for", () => {
    const LICENSE_STATES: Array<[string, Record<string, unknown>, string]> = [
      [
        "the trial",
        { status: "grace", graceReason: "unlicensed", graceEndsAt: inDays(10) },
        "Add license",
      ],
      [
        "an expired license in its grace period",
        { status: "grace", graceReason: "expired", graceEndsAt: inDays(5) },
        "Renew license",
      ],
      [
        "an expired license",
        { status: "expired", licenseValid: false },
        "Renew license",
      ],
      [
        "an invalid license",
        { status: "invalid", licenseValid: false },
        "Fix license",
      ],
      [
        "no license",
        { status: "missing", licenseValid: false },
        "Validate license",
      ],
    ];

    it.each(LICENSE_STATES)(
      "asks a master admin to act on %s",
      async (
        _name: string,
        overrides: Record<string, unknown>,
        action: string,
      ) => {
        respondWith(adminPayload(overrides));

        await renderWithDetails();

        await waitFor(() => {
          expect(pill().textContent).toContain(action);
        });
      },
    );

    it.each(LICENSE_STATES)(
      "offers anybody else the details of %s",
      async (
        _name: string,
        overrides: Record<string, unknown>,
        action: string,
      ) => {
        isMasterAdmin = false;
        respondWith(publicPayload(overrides));

        await renderWithDetails();

        await waitFor(() => {
          expect(pill().textContent).toContain("View details");
        });

        expect(pill().textContent).not.toContain(action);
      },
    );

    it.each(LICENSE_STATES)(
      "offers a signed-out visitor on the login page the details of %s",
      async (
        _name: string,
        overrides: Record<string, unknown>,
        action: string,
      ) => {
        isMasterAdmin = false;
        respondWith(publicPayload(overrides));

        // The login page passes no details.
        render(<EditionLabel />);

        await waitFor(() => {
          expect(pill().textContent).toContain("View details");
        });

        expect(pill().textContent).not.toContain(action);
      },
    );
  });

  /*
   * The license page is a page of its own, and the pill sits in the header
   * above it: it follows what the page changes without a reload.
   */
  describe("following the license page", () => {
    it("reads the license again when the page announces a change", async () => {
      respondWith(
        adminPayload({
          status: "grace",
          graceReason: "unlicensed",
          graceEndsAt: inDays(10),
          verification: "none",
          token: null,
          licenseKey: null,
        }),
      );

      await renderWithDetails();

      await waitFor(() => {
        expect(pill().textContent).toContain("Add license");
      });

      const before: number = fetchCalls.length;

      respondWith(adminPayload());

      act(() => {
        announceLicenseChanged();
      });

      await waitFor(() => {
        expect(pill()).toHaveAccessibleName("Enterprise Edition, View details");
      });

      expect(fetchCalls.length).toBe(before + 1);
      expect(fetchCalls[fetchCalls.length - 1]?.method).toBe("GET");
    });

    it("stops listening once it is gone", async () => {
      const { unmount } = render(
        <EditionLabel licenseDetails={FakeLicenseDetails} />,
      );

      await waitFor(() => {
        expect(fetchCalls.length).toBeGreaterThan(0);
      });

      unmount();

      const before: number = fetchCalls.length;

      act(() => {
        announceLicenseChanged();
      });

      expect(fetchCalls.length).toBe(before);
    });
  });
});

/*
 * The lapse checks the notices above rely on (EditionLabelLapseCopy.ts), and
 * the sentences EditionLabel builds its notices from. Each check has to fail
 * on the copy that promised SSO, SCIM and audit logging never stop, on the
 * copy that said single sign-on stops with the license, and on copy that
 * drops any single consequence - otherwise a passing notice test proves
 * nothing.
 */
describe("EditionLabel - the lapse copy and its checks", () => {
  it.each(RETIRED_NOTICE_EXAMPLES)(
    "rejects the retired soft-enforcement copy: %s",
    (retired: string) => {
      expect(lapseWarningProblems(retired)).toContain("retired: never stop");
      expect(lapsedStateProblems(retired)).toContain("retired: never stop");
      expect(lapseWarningProblems(retired)).toContain(
        "missing: SCIM provisioning stops",
      );
      expect(lapsedStateProblems(retired)).toContain(
        "missing: SCIM provisioning is off",
      );
      expect(lapseWarningProblems(retired)).toContain(
        "mentions single sign-on: \\bSSO\\b",
      );
    },
  );

  /*
   * The notices said single sign-on stops with the license while it was an
   * Enterprise Edition feature. Everything else in them is still right, so
   * the single sign-on check is what rejects them.
   */
  it.each(RETIRED_SINGLE_SIGN_ON_STOPS_EXAMPLES.slice(0, 2))(
    "rejects the warning that said single sign-on stops: %s",
    (retired: string) => {
      expect(lapseWarningProblems(retired)).toEqual([
        "mentions single sign-on: single sign-on",
        "mentions single sign-on: \\bSSO\\b",
        "mentions single sign-on: \\bSAML\\b",
        "mentions single sign-on: \\bOIDC\\b",
      ]);
    },
  );

  it("rejects the lapsed notice that said single sign-on is off", () => {
    const retired: string = RETIRED_SINGLE_SIGN_ON_STOPS_EXAMPLES[2] || "";

    expect(lapsedStateProblems(retired)).toEqual(
      expect.arrayContaining([
        "mentions single sign-on: single sign-on",
        "mentions single sign-on: \\bSSO\\b",
      ]),
    );
    expect(lapsedStateProblems(retired)).not.toEqual([]);
  });

  it("rejects a notice that names single sign-on at all, even to say it is unaffected", () => {
    expect(
      lapseWarningProblems(
        `${GRACE_ENFORCEMENT_SUMMARY} Single sign-on is part of every edition.`,
      ),
    ).toEqual(["mentions single sign-on: single sign-on"]);
    expect(
      lapsedStateProblems(
        `${LICENSE_LAPSED_STATE} "Require SSO" still applies.`,
      ),
    ).toEqual(["mentions single sign-on: \\bSSO\\b"]);
  });

  it("accepts the sentences EditionLabel ships", () => {
    expect(lapseWarningProblems(TRIAL_ENFORCEMENT_SUMMARY)).toEqual([]);
    expect(lapseWarningProblems(GRACE_ENFORCEMENT_SUMMARY)).toEqual([]);
    expect(lapsedStateProblems(LICENSE_LAPSED_STATE)).toEqual([]);
    expect(singleSignOnMentions(LICENSE_LAPSE_CONSEQUENCES)).toEqual([]);
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
    ).toEqual(["retired: never stop", "mentions single sign-on: \\bSSO\\b"]);
  });

  it("warns without calling the trial a grace period, or the grace period a trial", () => {
    expect(LICENSE_LAPSE_CONSEQUENCES).not.toMatch(/grace|trial/i);
    expect(LICENSE_LAPSED_STATE).not.toMatch(/grace|trial/i);
    expect(TRIAL_ENFORCEMENT_SUMMARY).not.toMatch(/grace/i);
    expect(GRACE_ENFORCEMENT_SUMMARY).not.toMatch(/trial/i);
  });

  /*
   * The trial is 14 days and the grace period after a license expires is 30.
   * Each summary states its own length, derived from the constant the license
   * classifier uses, so the two can never drift apart.
   */
  it("states a 14-day trial and a 30-day grace period, from the constants", () => {
    expect(ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS).toBe(14);
    expect(ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS).toBe(30);
    expect(TRIAL_ENFORCEMENT_SUMMARY).toContain(
      `Without a valid license (after the ${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial),`,
    );
    expect(GRACE_ENFORCEMENT_SUMMARY).toContain(
      `Without a valid license (after the ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period),`,
    );
    expect(GRACE_ENFORCEMENT_SUMMARY).not.toContain("14-day");
  });

  /*
   * Each summary is one whole sentence a locale can word its own way, so the
   * English is no longer built from LICENSE_LAPSE_CONSEQUENCES. It must still
   * read exactly as it did when it was.
   */
  it("reads as the lapse consequences after its own period, word for word", () => {
    expect(TRIAL_ENFORCEMENT_SUMMARY).toBe(
      `Without a valid license (after the ${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial), ${LICENSE_LAPSE_CONSEQUENCES}`,
    );
    expect(GRACE_ENFORCEMENT_SUMMARY).toBe(
      `Without a valid license (after the ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period), ${LICENSE_LAPSE_CONSEQUENCES}`,
    );
  });
});

/*
 * A license IS installed, and the expiry beside it never was.
 *
 * The license client stopped calling that "invalid" - it is the product's own
 * bookkeeping failing, not an entitlement ending - and falls back to the
 * unlicensed trial instead. Two things followed for this dialog, and both were
 * wrong until these cases existed:
 *
 *   - the explanation ("no expiry is recorded, re-activate it or let the daily
 *     sync fetch it") was rendered in exactly one place, inside the "invalid"
 *     branch, which this state deliberately is not. It reached nobody.
 *   - the copy it fell into instead is the trial notice, which opens "No
 *     Enterprise license is installed." - said to a customer who is holding
 *     one.
 *
 * The server sends the token to a master admin and the verification to
 * everybody, so both audiences can tell the two apart.
 */
describe("EditionLabel - a license whose expiry was never recorded", () => {
  const NO_EXPIRY_MESSAGE: string =
    "A OneUptime Enterprise license is installed, but no expiry is recorded for it, so this installation cannot tell whether it is still current. " +
    "A master admin can re-activate the license on Settings > License in the Admin Dashboard, or leave the daily license sync to fetch its expiry from oneuptime.com.";

  // Inside the trial the classifier reports grace/unlicensed, with a token.
  const inTrial: PayloadFunction = (
    overrides?: Record<string, unknown>,
  ): JSONObject => {
    return adminPayload({
      status: "grace",
      graceReason: "unlicensed",
      verification: "unverified",
      graceEndsAt: inDays(10),
      licenseValid: true,
      expiresAt: null,
      message: NO_EXPIRY_MESSAGE,
      userLimit: null,
      isSeatLimitEnforced: false,
      seatsInUse: null,
      seatsRemaining: null,
      ...(overrides || {}),
    });
  };

  it("does not tell a customer holding a license that none is installed", async () => {
    respondWith(inTrial());

    await openDialog();

    const notice: HTMLElement = await screen.findByTestId(
      "enterprise-license-trial-notice",
    );

    expect(notice).not.toHaveTextContent("No Enterprise license is installed");
    expect(notice).toHaveTextContent(
      "A license is installed, but this installation cannot tell whether it is still current",
    );
  });

  it("shows the explanation the license client sent, inside the trial", async () => {
    respondWith(inTrial());

    await openDialog();

    expect(
      await screen.findByTestId("enterprise-license-status-message"),
    ).toHaveTextContent("no expiry is recorded for it");
    expect(
      screen.getByTestId("enterprise-license-status-message"),
    ).toHaveTextContent("daily license sync");
  });

  /*
   * And the remedy names the license that is there. This dialog is rendered
   * with no license details, so nobody here can act on it and the copy is the
   * "ask a master admin" one - re-activate the license, not add a first.
   */
  it("asks for the installed license to be re-activated, not for a new one", async () => {
    respondWith(inTrial());

    await openDialog();

    const notice: HTMLElement = await screen.findByTestId(
      "enterprise-license-trial-notice",
    );

    expect(notice).toHaveTextContent(
      "Ask a master admin of this installation to re-activate the license",
    );
    expect(notice).not.toHaveTextContent("to add a license");
  });

  /*
   * Past the trial the classifier reports "missing", which used to render the
   * bare "This installation has no valid Enterprise license." and nothing
   * else - the one state where an administrator most needs to be told what is
   * actually wrong.
   */
  it("shows the explanation past the trial, where the status alone says nothing", async () => {
    respondWith(
      adminPayload({
        status: "missing",
        verification: "unverified",
        licenseValid: false,
        expiresAt: null,
        graceEndsAt: inDays(-1),
        message: NO_EXPIRY_MESSAGE,
      }),
    );

    await openDialog();

    const notice: HTMLElement = await screen.findByTestId(
      "enterprise-license-required-notice",
    );

    expect(notice).toHaveTextContent("no expiry is recorded for it");
    expect(notice).toHaveTextContent("re-activate the license");
    expect(notice).not.toHaveTextContent(
      "This installation has no valid Enterprise license",
    );
  });

  /*
   * Somebody who is not a master admin is sent no token and no message, but is
   * sent the verification - which is "none" only when there was no token to
   * judge. So they are not told that no license is installed either.
   */
  it("tells a non-master-admin the same thing, from the verification alone", async () => {
    isMasterAdmin = false;
    respondWith(
      publicPayload({
        status: "grace",
        graceReason: "unlicensed",
        verification: "unverified",
        graceEndsAt: inDays(10),
        expiresAt: null,
      }),
    );

    await openDialog();

    const notice: HTMLElement = await screen.findByTestId(
      "enterprise-license-trial-notice",
    );

    expect(notice).not.toHaveTextContent("No Enterprise license is installed");
    expect(notice).toHaveTextContent(
      "Ask a master admin of this installation to re-activate the license",
    );
    // No message is sent to them, so none is rendered.
    expect(
      screen.queryByTestId("enterprise-license-status-message"),
    ).not.toBeInTheDocument();
  });

  /*
   * The genuinely unlicensed installation, unchanged. The whole point of the
   * qualification is that it applies only when a license IS there: verification
   * "none" and no token.
   */
  it("leaves the copy for an install with no license at all exactly as it was", async () => {
    respondWith(
      adminPayload({
        status: "grace",
        graceReason: "unlicensed",
        verification: "none",
        graceEndsAt: inDays(10),
        licenseValid: true,
        token: null,
        licenseKey: null,
        expiresAt: null,
        companyName: null,
      }),
    );

    await openDialog();

    const notice: HTMLElement = await screen.findByTestId(
      "enterprise-license-trial-notice",
    );

    expect(notice).toHaveTextContent("No Enterprise license is installed");
    expect(notice).toHaveTextContent(
      "Ask a master admin of this installation to add a license",
    );
    expect(notice).not.toHaveTextContent("A license is installed");
  });

  /*
   * An "invalid" license still shows its message exactly once: it is both the
   * reason line and the message, and a master admin must not read the same
   * sentence twice.
   */
  it("does not repeat the message for an invalid license", async () => {
    respondWith(
      adminPayload({
        status: "invalid",
        licenseValid: false,
        message: "The license is bound to a different OneUptime instance.",
      }),
    );

    await openDialog();

    await screen.findByTestId("enterprise-license-required-notice");

    expect(
      screen.getAllByText(/bound to a different OneUptime instance/),
    ).toHaveLength(1);
  });
});
