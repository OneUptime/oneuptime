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
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * What the edition pill and dialog say about the license, now that the
 * Enterprise license client reports a status rather than a yes/no:
 *
 *   valid    as before;
 *   grace    either an expired license's grace period (renew) or an unlicensed
 *            installation's trial counted from its first run (add a license) -
 *            the two must never be confused;
 *   expired, missing, invalid - with soft enforcement described accurately:
 *            configuration becomes read-only, nothing configured stops;
 *   unverified legacy licenses, told apart for a master admin;
 *   offline activation with a pasted signed token;
 *   the Community Edition image running with IS_ENTERPRISE_EDITION set, told to
 *            a master admin.
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
      "enterprise configuration becomes read-only",
    );
    expect(notice).toHaveTextContent(
      "SSO, SCIM and audit logging never stop",
    );
    expect(notice).toHaveTextContent("core monitoring is never affected");
  });

  it("still counts as licensed: details, seats and the refresh button stay", async () => {
    await openDialog();

    expect(await screen.findByText("Licensed to")).toBeInTheDocument();
    expect(screen.getByText("Licensed seats")).toBeInTheDocument();
    expect(
      screen.getByTestId("refresh-enterprise-license"),
    ).toBeInTheDocument();
    expect(screen.getByText("Grace period")).toBeInTheDocument();
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
    expect(notice).toHaveTextContent(
      "enterprise configuration becomes read-only",
    );
  });

  it("lets a master admin add the license during the trial", async () => {
    await openDialog();

    expect(
      await screen.findByPlaceholderText("Enter your enterprise license key"),
    ).toBeInTheDocument();
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
       * Soft enforcement, described accurately: nothing configured stops, and
       * core monitoring is not touched.
       */
      expect(notice).toHaveTextContent("Enterprise configuration is read-only");
      expect(notice).toHaveTextContent(
        "SSO, SCIM and audit logging never stop",
      );
      expect(notice).toHaveTextContent("core monitoring is never affected");
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
   * immediately" - but nothing configured is ever turned off, and the list is
   * services as much as features.
   */
  it("no longer claims a key turns features on", async () => {
    respondWith(adminPayload({ status: "missing", licenseValid: false }));

    await openDialog();

    await screen.findByText("What your license unlocks");

    expect(
      screen.queryByText(/turn these on immediately/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Nothing you already configured stops working/),
    ).toBeInTheDocument();
  });

  it("offers the license input to a master admin", async () => {
    respondWith(adminPayload({ status: "expired", licenseValid: false }));

    await openDialog();

    expect(
      await screen.findByPlaceholderText("Enter your enterprise license key"),
    ).toBeInTheDocument();
  });
});

describe("EditionLabel - an unverified legacy license", () => {
  it("tells a master admin it cannot be verified offline", async () => {
    respondWith(adminPayload({ verification: "unverified" }));

    await openDialog();

    expect(
      await screen.findByTestId("enterprise-license-unverified-notice"),
    ).toHaveTextContent("cannot verify it offline");
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

describe("EditionLabel - offline activation", () => {
  beforeEach(() => {
    respondWith(adminPayload({ status: "missing", licenseValid: false }));
  });

  const switchToToken: () => Promise<void> = async (): Promise<void> => {
    fireEvent.click(
      await screen.findByTestId("switch-license-activation-mode"),
    );
  };

  it("offers a master admin a way to paste a signed token instead of a key", async () => {
    await openDialog();

    await switchToToken();

    expect(
      screen.getByTestId("enterprise-license-token-input"),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Enter your enterprise license key"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Activate License" }),
    ).toBeInTheDocument();
  });

  it("sends the pasted token, and no key, to the activation route", async () => {
    await openDialog();
    await switchToToken();

    fireEvent.change(screen.getByTestId("enterprise-license-token-input"), {
      target: { value: "  header.payload.signature \n" },
    });

    respondWith(adminPayload());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Activate License" }));
    });

    await waitFor(() => {
      expect(
        fetchCalls.some((call: FetchCall): boolean => {
          return call.method === "POST";
        }),
      ).toBe(true);
    });

    const post: FetchCall = fetchCalls.find((call: FetchCall): boolean => {
      return call.method === "POST";
    }) as FetchCall;

    expect(post.url).toContain("/global-config/license");
    expect(post.url).not.toContain("/refresh");
    expect(post.data).toEqual({ licenseToken: "header.payload.signature" });
    expect(
      await screen.findByText("License activated offline."),
    ).toBeInTheDocument();
  });

  it("shows the server's refusal of a token this build does not trust", async () => {
    await openDialog();
    await switchToToken();

    fireEvent.change(screen.getByTestId("enterprise-license-token-input"), {
      target: { value: "header.payload.signature" },
    });

    respond = (
      call: FetchCall,
    ): HTTPResponse<JSONObject> | HTTPErrorResponse => {
      if (call.method === "POST") {
        return new HTTPErrorResponse(
          400,
          {
            message:
              "This build does not trust the key that signed this token, so it cannot be activated offline.",
          },
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
      await screen.findByText(/does not trust the key that signed this token/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("License activated offline."),
    ).not.toBeInTheDocument();
  });

  it("keeps the activate button disabled until a token is pasted", async () => {
    await openDialog();
    await switchToToken();

    expect(
      screen.getByRole("button", { name: "Activate License" }),
    ).toBeDisabled();
  });

  it("switches back to the license key", async () => {
    await openDialog();
    await switchToToken();

    fireEvent.click(screen.getByText("Use a license key instead"));

    expect(
      screen.getByPlaceholderText("Enter your enterprise license key"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Validate License" }),
    ).toBeInTheDocument();
  });

  it("is never offered to somebody who is not a master admin", async () => {
    isMasterAdmin = false;
    respondWith(publicPayload({ status: "missing", licenseValid: false }));

    await openDialog();

    await screen.findByText("A master admin has to activate this license");

    expect(
      screen.queryByTestId("switch-license-activation-mode"),
    ).not.toBeInTheDocument();
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
