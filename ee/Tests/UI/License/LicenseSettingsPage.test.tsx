import LicenseDetails from "../../../AdminDashboard/License/LicenseDetails";
import LicenseSettingsPage from "../../../AdminDashboard/License/LicenseSettingsPage";
import LicenseSettingsView from "../../../AdminDashboard/License/LicenseSettingsView";
import EditionLabel from "Common/UI/Components/EditionLabel/EditionLabel";
import { LICENSE_CHANGED_EVENT } from "Common/UI/Components/EditionLabel/LicenseEvents";
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
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Admin Dashboard > Settings > License: the one place the license is changed.
 *
 * Where these scenarios lived before the license moved out of the edition
 * dialog, they ran against the dialog; every one of them is here, against the
 * page. What these pin:
 *
 *   - the page reads the license as a signed-in caller, and says so when it
 *     cannot;
 *   - adding a license with a key, or offline with a token, sends exactly
 *     that, and the server's refusal is shown once, with what was typed kept;
 *   - refreshing sends no key, and a refresh that failed never looks like one
 *     that worked;
 *   - replacing a license is a change that can be cancelled, and offers a
 *     token for a license activated offline;
 *   - a write the server stored that licenses nothing is a warning, never a
 *     green tick;
 *   - every write leaves the page on the terms the server answered with, and
 *     the header's edition pill follows without a reload;
 *   - nothing but this page writes, and it draws nothing where there is no
 *     license to manage.
 */

let isEnterpriseEdition: boolean = true;
let billingEnabled: boolean = false;

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
        return true;
      },
      isLoggedIn: (): boolean => {
        return true;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

jest.mock("Common/UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: {
      title: string;
      breadcrumbLinks: Array<{ title: string; to: { toString: () => string } }>;
      children: ReactElement;
      sideMenu: ReactElement;
    }): ReactElement => {
      return (
        <div data-testid="page">
          <nav data-testid="breadcrumbs">
            {props.breadcrumbLinks.map(
              (link: { title: string; to: { toString: () => string } }) => {
                return (
                  <a key={link.title} href={link.to.toString()}>
                    {link.title}
                  </a>
                );
              },
            )}
          </nav>
          {props.sideMenu}
          {props.children}
        </div>
      );
    },
  };
});

jest.mock("@oneuptime/admin-dashboard/Pages/Settings/SideMenu", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <aside data-testid="settings-side-menu" />;
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
    marketplace: null,
    marketplaceBilling: null,
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

// An installation with no license, inside its trial.
const trialPayload: PayloadFunction = (
  overrides?: Record<string, unknown>,
): JSONObject => {
  return adminPayload({
    status: "grace",
    graceReason: "unlicensed",
    graceEndsAt: inDays(10),
    verification: "none",
    companyName: null,
    expiresAt: null,
    licenseKey: null,
    token: null,
    activationMode: null,
    userLimit: null,
    currentUserCount: null,
    ...(overrides || {}),
  });
};

const respondWith: (payload: JSONObject) => void = (
  payload: JSONObject,
): void => {
  respond = (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(200, payload, {});
  };
};

/*
 * A license GET that keeps answering with what the page loaded, and writes
 * that fail or succeed as a test says.
 */
const respondToWritesWith: (
  loaded: JSONObject,
  write: () => HTTPResponse<JSONObject> | HTTPErrorResponse,
) => void = (
  loaded: JSONObject,
  write: () => HTTPResponse<JSONObject> | HTTPErrorResponse,
): void => {
  respond = (
    call: FetchCall,
  ): HTTPResponse<JSONObject> | HTTPErrorResponse => {
    return call.method === "POST"
      ? write()
      : new HTTPResponse<JSONObject>(200, loaded, {});
  };
};

const refused: (statusCode: number, message: string) => HTTPErrorResponse = (
  statusCode: number,
  message: string,
): HTTPErrorResponse => {
  return new HTTPErrorResponse(statusCode, { message: message }, {});
};

const callsOf: (method: string) => Array<FetchCall> = (
  method: string,
): Array<FetchCall> => {
  return fetchCalls.filter((call: FetchCall): boolean => {
    return call.method === method;
  });
};

const openPage: () => Promise<void> = async (): Promise<void> => {
  render(<LicenseSettingsView />);

  await screen.findByTestId("license-status");
};

const keyInput: () => HTMLInputElement = (): HTMLInputElement => {
  return screen.getByPlaceholderText(
    "Enter your enterprise license key",
  ) as HTMLInputElement;
};

const tokenInput: () => HTMLTextAreaElement = (): HTMLTextAreaElement => {
  return screen.getByPlaceholderText(
    "Paste the signed license token",
  ) as HTMLTextAreaElement;
};

const submitButton: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("activate-enterprise-license");
};

const expectNoWriteHappened: () => void = (): void => {
  expect(callsOf("POST")).toEqual([]);
};

const announcements: Array<Event> = [];

const recordAnnouncement: (event: Event) => void = (event: Event): void => {
  announcements.push(event);
};

beforeEach(() => {
  fetchCalls.length = 0;
  announcements.length = 0;
  isEnterpriseEdition = true;
  billingEnabled = false;
  respondWith(adminPayload());
  window.addEventListener(LICENSE_CHANGED_EVENT, recordAnnouncement);
});

afterEach(() => {
  window.removeEventListener(LICENSE_CHANGED_EVENT, recordAnnouncement);
});

describe("reading the license", () => {
  /*
   * On its own the route answers no session with the anonymous payload and a
   * 200, which reads as "no license". Saying we expect to be signed in turns
   * an expired session into the 401 the API client refreshes and replays.
   */
  it("reads it as a signed-in caller, once", async () => {
    await openPage();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.method).toBe("GET");
    expect(fetchCalls[0]?.url).toContain("/global-config/license");
    expect(fetchCalls[0]?.url).toContain("signedIn=true");
  });

  it("writes nothing just by being opened", async () => {
    await openPage();

    expectNoWriteHappened();
    expect(announcements).toHaveLength(0);
  });

  it("shows what is in place for a valid license", async () => {
    await openPage();

    const status: HTMLElement = screen.getByTestId("license-status");

    expect(status).toHaveTextContent("License active");
    expect(status).toHaveAttribute("data-tone", "healthy");
    expect(screen.getByText("Acme Inc")).toBeInTheDocument();
    expect(screen.getByText("Licensed to")).toBeInTheDocument();
    expect(screen.getByText("Expires")).toBeInTheDocument();
    expect(screen.getByText("License key")).toBeInTheDocument();
    expect(screen.getByTestId("license-instance-id")).toHaveTextContent(
      "instance-1",
    );
  });

  // Not lying around on a screen somebody may be sharing.
  it("keeps the key behind a reveal", async () => {
    await openPage();

    expect(screen.queryByText("acme-license-key")).not.toBeInTheDocument();
    expect(screen.getByText("Click to reveal")).toBeInTheDocument();
  });

  /*
   * The other facts are one line, cut short at their box's end. The key is
   * not: cut to one line, a revealed key longer than its column lost its
   * start on a phone and pushed Copy and Hide out of sight (on a Persian
   * page, Hide was cut off). It wraps inside its box instead.
   */
  it("reveals the whole key, wrapped in its box, with Copy and Hide beside it", async () => {
    await openPage();

    const reveal: HTMLElement = screen.getByRole("button", {
      name: "Click to reveal",
    });
    const value: HTMLElement = reveal.closest("dd") as HTMLElement;

    expect(value).not.toBeNull();
    expect(value).not.toHaveClass("truncate");
    expect(screen.getByText("Licensed to").nextElementSibling).toHaveClass(
      "truncate",
    );

    fireEvent.click(reveal);

    const key: HTMLElement = screen.getByRole("revealed-text");

    expect(key).toHaveTextContent("acme-license-key");
    expect(value).toContainElement(key);
    expect(key).toHaveClass("break-all");
    expect(key.parentElement).toHaveClass("max-w-full");
    expect(
      within(value).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();
    expect(
      within(value).getByRole("button", { name: "Hide" }),
    ).toBeInTheDocument();
  });

  it("names the card with the Admin Dashboard's own word for it", async () => {
    await openPage();

    expect(
      screen.getByText("breadcrumbs.enterpriseLicense"),
    ).toBeInTheDocument();
  });

  it("offers no form while a license is in place", async () => {
    await openPage();

    expect(
      screen.queryByTestId("license-activation-form"),
    ).not.toBeInTheDocument();
  });

  it("shows why it could not read the license, and tries again", async () => {
    respond = (): HTTPErrorResponse => {
      return refused(500, "The license service is down.");
    };

    render(<LicenseSettingsView />);

    expect(
      await screen.findByText("The license service is down."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("license-status")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("license-activation-form"),
    ).not.toBeInTheDocument();

    respondWith(adminPayload());

    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(await screen.findByTestId("license-status")).toHaveTextContent(
      "License active",
    );
  });
});

describe("adding a license", () => {
  it.each([
    ["the trial", trialPayload()],
    [
      "no license",
      adminPayload({
        status: "missing",
        verification: "none",
        licenseValid: false,
        licenseKey: null,
        token: null,
      }),
    ],
    ["an expired license", adminPayload({ status: "expired", licenseValid: false })],
    ["an invalid license", adminPayload({ status: "invalid", licenseValid: false })],
  ])("offers the form on %s", async (_name: string, payload: JSONObject) => {
    respondWith(payload);

    await openPage();

    expect(keyInput()).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Validate License" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("refresh-enterprise-license"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("change-enterprise-license"),
    ).not.toBeInTheDocument();
  });

  it("asks for nothing until there is a key", async () => {
    respondWith(trialPayload());

    await openPage();

    expect(submitButton()).toBeDisabled();

    fireEvent.change(keyInput(), { target: { value: "   " } });

    expect(submitButton()).toBeDisabled();

    fireEvent.change(keyInput(), { target: { value: "acme-key" } });

    expect(submitButton()).toBeEnabled();
  });

  it("sends the trimmed key, and nothing else, to the activation route", async () => {
    respondToWritesWith(trialPayload(), (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        adminPayload({ licenseKey: "new-license-key" }),
        {},
      );
    });

    await openPage();

    fireEvent.change(keyInput(), {
      target: { value: "  new-license-key \n" },
    });
    fireEvent.click(submitButton());

    expect(
      await screen.findByText("License validated successfully."),
    ).toBeInTheDocument();

    expect(callsOf("POST")).toHaveLength(1);

    const post: FetchCall = callsOf("POST")[0] as FetchCall;

    expect(post.url).toContain("/global-config/license");
    expect(post.url).not.toContain("/refresh");
    expect(post.data).toEqual({ licenseKey: "new-license-key" });
  });

  it("submits with Enter", async () => {
    respondToWritesWith(trialPayload(), (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(200, adminPayload(), {});
    });

    await openPage();

    fireEvent.change(keyInput(), { target: { value: "acme-key" } });
    fireEvent.keyDown(keyInput(), { key: "Enter", code: "Enter" });

    expect(
      await screen.findByText("License validated successfully."),
    ).toBeInTheDocument();
    expect(callsOf("POST")).toHaveLength(1);
  });

  it("sends nothing on Enter in an empty field, and says what is missing", async () => {
    respondWith(trialPayload());

    await openPage();

    fireEvent.keyDown(keyInput(), { key: "Enter", code: "Enter" });

    expect(
      await screen.findByText("Please enter a license key before validating."),
    ).toBeInTheDocument();
    expectNoWriteHappened();
  });

  /*
   * The answer to a write is the same body the GET gives a master admin, read
   * fresh by the server: the page shows it, and asks again for nothing.
   */
  it("shows the new license from the answer, without reading it again", async () => {
    respondToWritesWith(trialPayload(), (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        adminPayload({ companyName: "Newly Licensed Ltd" }),
        {},
      );
    });

    await openPage();

    fireEvent.change(keyInput(), { target: { value: "acme-key" } });
    fireEvent.click(submitButton());

    expect(await screen.findByText("Newly Licensed Ltd")).toBeInTheDocument();
    expect(screen.getByTestId("license-status")).toHaveTextContent(
      "License active",
    );
    expect(
      screen.queryByTestId("license-activation-form"),
    ).not.toBeInTheDocument();
    expect(callsOf("GET")).toHaveLength(1);
  });

  it("sends one write however many times the button is pressed", async () => {
    let answer: (response: HTTPResponse<JSONObject>) => void = () => {
      return undefined;
    };

    respond = (call: FetchCall): HTTPResponse<JSONObject> => {
      if (call.method === "POST") {
        return new Promise<HTTPResponse<JSONObject>>(
          (resolve: (response: HTTPResponse<JSONObject>) => void) => {
            answer = resolve;
          },
        ) as unknown as HTTPResponse<JSONObject>;
      }

      return new HTTPResponse<JSONObject>(200, trialPayload(), {});
    };

    await openPage();

    fireEvent.change(keyInput(), { target: { value: "acme-key" } });
    fireEvent.click(submitButton());
    fireEvent.click(submitButton());
    fireEvent.keyDown(keyInput(), { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(callsOf("POST")).toHaveLength(1);
    });

    await act(async () => {
      answer(new HTTPResponse<JSONObject>(200, adminPayload(), {}));
    });

    expect(
      await screen.findByText("License validated successfully."),
    ).toBeInTheDocument();
    expect(callsOf("POST")).toHaveLength(1);
  });

  it("keeps the form and what was typed, and says why once, when the key is refused", async () => {
    respondToWritesWith(trialPayload(), (): HTTPErrorResponse => {
      return refused(400, "This license key is not valid.");
    });

    await openPage();

    fireEvent.change(keyInput(), { target: { value: "typo-key" } });
    fireEvent.click(submitButton());

    expect(
      await screen.findByText("This license key is not valid."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("This license key is not valid.")).toHaveLength(
      1,
    );
    expect(keyInput().value).toBe("typo-key");
    expect(
      screen.queryByText("License validated successfully."),
    ).not.toBeInTheDocument();
    expect(announcements).toHaveLength(0);
  });

  /*
   * A session whose master admin access was removed since the page loaded:
   * the server has the last word, and the page shows it.
   */
  it("shows the server's refusal when the caller is no longer a master admin", async () => {
    respondToWritesWith(trialPayload(), (): HTTPErrorResponse => {
      return refused(
        422,
        "Unauthorized: Only master admins can perform this action.",
      );
    });

    await openPage();

    fireEvent.change(keyInput(), { target: { value: "acme-key" } });
    fireEvent.click(submitButton());

    expect(
      await screen.findByText(
        "Unauthorized: Only master admins can perform this action.",
      ),
    ).toBeInTheDocument();
    expect(announcements).toHaveLength(0);
  });

  it("clears a refusal when the next attempt starts", async () => {
    let isRefused: boolean = true;

    respondToWritesWith(
      trialPayload(),
      (): HTTPResponse<JSONObject> | HTTPErrorResponse => {
        return isRefused
          ? refused(400, "This license key is not valid.")
          : new HTTPResponse<JSONObject>(200, adminPayload(), {});
      },
    );

    await openPage();

    fireEvent.change(keyInput(), { target: { value: "typo-key" } });
    fireEvent.click(submitButton());

    await screen.findByText("This license key is not valid.");

    isRefused = false;

    fireEvent.change(keyInput(), { target: { value: "right-key" } });
    fireEvent.click(submitButton());

    expect(
      await screen.findByText("License validated successfully."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("This license key is not valid."),
    ).not.toBeInTheDocument();
  });

  it("starts from the stored key when the license needs validating again", async () => {
    respondWith(adminPayload({ status: "expired", licenseValid: false }));

    await openPage();

    // Input takes a new value a tick after it is handed one.
    await waitFor(() => {
      expect(keyInput().value).toBe("acme-license-key");
    });
    expect(submitButton()).toBeEnabled();
  });

  it("starts empty where no key is stored", async () => {
    respondWith(trialPayload());

    await openPage();

    expect(keyInput().value).toBe("");
  });

  it("points somebody with no license at sales", async () => {
    respondWith(trialPayload());

    await openPage();

    expect(
      screen.getByRole("link", { name: "sales@oneuptime.com" }),
    ).toHaveAttribute("href", "mailto:sales@oneuptime.com");
  });
});

describe("activating offline", () => {
  const switchToToken: () => void = (): void => {
    fireEvent.click(screen.getByTestId("switch-license-activation-mode"));
  };

  it("is one link away, for the few who need it", async () => {
    respondWith(trialPayload());

    await openPage();

    expect(
      screen.queryByPlaceholderText("Paste the signed license token"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("switch-license-activation-mode"),
    ).toHaveTextContent(
      "No internet access? Activate offline with a license token",
    );

    switchToToken();

    expect(tokenInput()).toBeInTheDocument();
    expect(
      screen.getByText("License token (offline activation)"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Activate License" }),
    ).toBeInTheDocument();
  });

  /*
   * A token works only on the instance it was issued for, so the person
   * asking OneUptime for one needs this id, before there is any license.
   */
  it("says which instance to ask for a token for", async () => {
    respondWith(trialPayload());

    await openPage();

    switchToToken();

    expect(screen.getByTestId("license-token-instance-id")).toHaveTextContent(
      "instance-1",
    );
  });

  it("says nothing about an instance id the server did not send", async () => {
    respondWith(trialPayload({ instanceId: null }));

    await openPage();

    switchToToken();

    expect(
      screen.queryByTestId("license-token-instance-id"),
    ).not.toBeInTheDocument();
  });

  it("keeps the button disabled until a token is pasted", async () => {
    respondWith(trialPayload());

    await openPage();

    switchToToken();

    expect(submitButton()).toBeDisabled();

    fireEvent.change(tokenInput(), { target: { value: "signed.token" } });

    expect(submitButton()).toBeEnabled();
  });

  it("sends the pasted token, and no key, to the activation route", async () => {
    respondToWritesWith(trialPayload(), (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        adminPayload({ activationMode: "offline", licenseKey: null }),
        {},
      );
    });

    await openPage();

    fireEvent.change(keyInput(), { target: { value: "half-typed-key" } });
    switchToToken();
    fireEvent.change(tokenInput(), {
      target: { value: "  signed.license.token\n" },
    });
    fireEvent.click(submitButton());

    expect(
      await screen.findByText("License activated offline."),
    ).toBeInTheDocument();

    expect(callsOf("POST")).toHaveLength(1);
    expect(callsOf("POST")[0]?.data).toEqual({
      licenseToken: "signed.license.token",
    });
  });

  it("shows the server's refusal of a token this build does not trust, and keeps it", async () => {
    respondToWritesWith(trialPayload(), (): HTTPErrorResponse => {
      return refused(
        400,
        "This build does not trust the key that signed this token.",
      );
    });

    await openPage();

    switchToToken();
    fireEvent.change(tokenInput(), { target: { value: "unknown.token" } });
    fireEvent.click(submitButton());

    expect(
      await screen.findByText(
        "This build does not trust the key that signed this token.",
      ),
    ).toBeInTheDocument();
    expect(tokenInput().value).toBe("unknown.token");
  });

  it("switches back to the license key, keeping both as typed", async () => {
    respondWith(trialPayload());

    await openPage();

    fireEvent.change(keyInput(), { target: { value: "half-typed-key" } });
    switchToToken();
    fireEvent.change(tokenInput(), { target: { value: "half.pasted" } });

    expect(
      screen.getByTestId("switch-license-activation-mode"),
    ).toHaveTextContent("Use a license key instead");

    fireEvent.click(screen.getByTestId("switch-license-activation-mode"));

    expect(keyInput().value).toBe("half-typed-key");

    switchToToken();

    expect(tokenInput().value).toBe("half.pasted");
  });

  it("clears the last refusal when switching", async () => {
    respondToWritesWith(trialPayload(), (): HTTPErrorResponse => {
      return refused(400, "This license key is not valid.");
    });

    await openPage();

    fireEvent.change(keyInput(), { target: { value: "typo-key" } });
    fireEvent.click(submitButton());

    await screen.findByText("This license key is not valid.");

    switchToToken();

    expect(
      screen.queryByText("This license key is not valid."),
    ).not.toBeInTheDocument();
  });
});

describe("refreshing the license", () => {
  it("offers it once a license is in place", async () => {
    await openPage();

    expect(screen.getByTestId("refresh-enterprise-license")).toHaveTextContent(
      "Refresh license",
    );
  });

  it("offers it during an expired license's grace period, when it is what a renewal needs", async () => {
    respondWith(
      adminPayload({
        status: "grace",
        graceReason: "expired",
        graceEndsAt: inDays(5),
        expiresAt: inDays(-25),
      }),
    );

    await openPage();

    expect(
      screen.getByTestId("refresh-enterprise-license"),
    ).toBeInTheDocument();
  });

  /*
   * No license key in the body. A refresh that carried one would be an
   * activation with a friendlier name.
   */
  it("refreshes the stored license without sending a key", async () => {
    await openPage();

    fireEvent.click(screen.getByTestId("refresh-enterprise-license"));

    await screen.findByText("License refreshed from OneUptime.");

    expect(callsOf("POST")).toHaveLength(1);
    expect(callsOf("POST")[0]?.url).toContain("/global-config/license/refresh");
    expect(callsOf("POST")[0]?.data).toBeUndefined();
  });

  it("shows the new seat limit, from the answer", async () => {
    await openPage();

    // Ten more seats bought on oneuptime.com since the page loaded.
    respondWith(adminPayload({ userLimit: 60 }));

    fireEvent.click(screen.getByTestId("refresh-enterprise-license"));

    expect(
      await screen.findByText("License refreshed from OneUptime."),
    ).toBeInTheDocument();
    expect(await screen.findByText(/60 seats/)).toBeInTheDocument();
    expect(callsOf("GET")).toHaveLength(1);
  });

  /*
   * A refresh that quietly kept the old terms and said nothing would be worse
   * than no button at all: the administrator pressed it precisely because they
   * think the stored terms are wrong.
   */
  it("reports a failed refresh instead of looking like it worked", async () => {
    respondToWritesWith(adminPayload(), (): HTTPErrorResponse => {
      return refused(500, "Could not reach OneUptime.");
    });

    await openPage();

    fireEvent.click(screen.getByTestId("refresh-enterprise-license"));

    expect(
      await screen.findByText("Could not reach OneUptime."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("License refreshed from OneUptime."),
    ).not.toBeInTheDocument();
    // The license it holds is still the license it shows.
    expect(screen.getByText("Acme Inc")).toBeInTheDocument();
    expect(announcements).toHaveLength(0);
  });

  it("sends one refresh however many times the button is pressed", async () => {
    let answer: (response: HTTPResponse<JSONObject>) => void = () => {
      return undefined;
    };

    respond = (call: FetchCall): HTTPResponse<JSONObject> => {
      if (call.method === "POST") {
        return new Promise<HTTPResponse<JSONObject>>(
          (resolve: (response: HTTPResponse<JSONObject>) => void) => {
            answer = resolve;
          },
        ) as unknown as HTTPResponse<JSONObject>;
      }

      return new HTTPResponse<JSONObject>(200, adminPayload(), {});
    };

    await openPage();

    fireEvent.click(screen.getByTestId("refresh-enterprise-license"));
    fireEvent.click(screen.getByTestId("refresh-enterprise-license"));

    await waitFor(() => {
      expect(callsOf("POST")).toHaveLength(1);
    });

    await act(async () => {
      answer(new HTTPResponse<JSONObject>(200, adminPayload(), {}));
    });

    await screen.findByText("License refreshed from OneUptime.");

    expect(callsOf("POST")).toHaveLength(1);
  });

  /*
   * An installation activated offline holds no license key, so there is
   * nothing to refresh from oneuptime.com: a new token replaces the license.
   */
  it("offers no refresh to an installation activated offline", async () => {
    respondWith(adminPayload({ activationMode: "offline", licenseKey: null }));

    await openPage();

    expect(screen.getByText("Replace license")).toBeInTheDocument();
    expect(
      screen.queryByTestId("refresh-enterprise-license"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Offline, with a signed token"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/activated offline, so it does not report/),
    ).toBeInTheDocument();
  });
});

describe("replacing the license", () => {
  it("opens an empty input for the new key, and Cancel puts everything back", async () => {
    await openPage();

    fireEvent.click(screen.getByText("Change license key"));

    expect(screen.getByText("New license key")).toBeInTheDocument();
    expect(keyInput().value).toBe("");
    expect(submitButton()).toBeDisabled();
    // The actions give way to the form while a change is under way.
    expect(
      screen.queryByTestId("refresh-enterprise-license"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Change license key")).not.toBeInTheDocument();

    fireEvent.change(keyInput(), { target: { value: "new-key" } });

    expect(submitButton()).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("New license key")).not.toBeInTheDocument();
    expect(screen.getByText("Change license key")).toBeInTheDocument();
    expect(
      screen.getByTestId("refresh-enterprise-license"),
    ).toBeInTheDocument();
    expectNoWriteHappened();
  });

  it("says the current license stays until the new key is validated", async () => {
    await openPage();

    fireEvent.click(screen.getByText("Change license key"));

    expect(
      screen.getByText(/Your existing license stays active/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("license-status")).toHaveTextContent(
      "License active",
    );
  });

  it("keeps the input open and says why when the new key is refused", async () => {
    respondToWritesWith(adminPayload(), (): HTTPErrorResponse => {
      return refused(400, "This license key is not valid.");
    });

    await openPage();

    fireEvent.click(screen.getByText("Change license key"));
    fireEvent.change(keyInput(), { target: { value: "typo-key" } });
    fireEvent.click(submitButton());

    expect(
      await screen.findByText("This license key is not valid."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("This license key is not valid.")).toHaveLength(
      1,
    );
    expect(screen.getByText("New license key")).toBeInTheDocument();
  });

  it("closes the form once the new key is in place", async () => {
    respondToWritesWith(adminPayload(), (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        adminPayload({ licenseKey: "new-license-key" }),
        {},
      );
    });

    await openPage();

    fireEvent.click(screen.getByText("Change license key"));
    fireEvent.change(keyInput(), { target: { value: "new-license-key" } });
    fireEvent.click(submitButton());

    await screen.findByText("License validated successfully.");

    expect(screen.queryByText("New license key")).not.toBeInTheDocument();
    expect(screen.getByText("Change license key")).toBeInTheDocument();
  });

  it("replaces an offline license with a new token, not a key", async () => {
    respondWith(adminPayload({ activationMode: "offline", licenseKey: null }));

    await openPage();

    fireEvent.click(screen.getByText("Replace license"));

    expect(
      screen.getByText("License token (offline activation)"),
    ).toBeInTheDocument();
    expect(tokenInput()).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Activate License" }),
    ).toBeDisabled();
  });

  it("forgets a switch to the token once the change is cancelled", async () => {
    await openPage();

    fireEvent.click(screen.getByText("Change license key"));
    fireEvent.click(screen.getByTestId("switch-license-activation-mode"));

    expect(tokenInput()).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByText("Change license key"));

    expect(keyInput()).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Paste the signed license token"),
    ).not.toBeInTheDocument();
  });

  it("drops a half-typed replacement when the change is cancelled", async () => {
    await openPage();

    fireEvent.click(screen.getByText("Change license key"));
    fireEvent.change(keyInput(), { target: { value: "half-typed-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByText("Change license key"));

    expect(keyInput().value).toBe("");
  });
});

/*
 * A license that is a cloud marketplace subscription has no key to refresh:
 * it renews itself with every usage report the marketplace accepts.
 */
describe("a marketplace license", () => {
  const marketplacePayload: PayloadFunction = (
    overrides?: Record<string, unknown>,
  ): JSONObject => {
    return adminPayload({
      marketplace: "Azure",
      licenseKey: null,
      token: null,
      activationMode: null,
      companyName: null,
      expiresAt: inDays(1),
      userLimit: null,
      currentUserCount: null,
      ...(overrides || {}),
    });
  };

  it("says where it comes from, and offers no refresh", async () => {
    respondWith(marketplacePayload());

    await openPage();

    expect(screen.getByTestId("license-status")).toHaveTextContent(
      "Licensed through Microsoft Marketplace",
    );
    expect(
      screen.queryByTestId("refresh-enterprise-license"),
    ).not.toBeInTheDocument();
  });

  it("still lets a master admin put a license key in its place", async () => {
    respondWith(marketplacePayload());

    await openPage();

    fireEvent.click(screen.getByText("Change license key"));

    expect(keyInput()).toBeInTheDocument();
  });

  it("shows no company, expiry or key: a subscription has none", async () => {
    respondWith(marketplacePayload());

    await openPage();

    expect(screen.queryByText("Licensed to")).not.toBeInTheDocument();
    expect(screen.queryByText("Expires")).not.toBeInTheDocument();
    expect(screen.queryByText("License key")).not.toBeInTheDocument();
  });

  it("shows no seat card: every user is billed by the hour", async () => {
    respondWith(marketplacePayload());

    await openPage();

    expect(screen.queryByText("Licensed seats")).not.toBeInTheDocument();
    expect(screen.queryByText(/unlimited/)).not.toBeInTheDocument();
  });

  it("keeps the refresh for a license key", async () => {
    respondWith(adminPayload());

    await openPage();

    expect(
      screen.getByTestId("refresh-enterprise-license"),
    ).toBeInTheDocument();
  });
});

/*
 * A write the server ACCEPTED that did not leave this installation licensed.
 *
 * Activation refuses only a license this installation cannot use at all
 * ("invalid"). A license with no expiry recorded beside it is not that: it is
 * stored on purpose, because a token is better than nothing and the daily sync
 * may complete it. But past the trial, such an install has SCIM provisioning
 * and audit logging OFF - and answering the master admin who had just pasted
 * their key to fix that lapse with a green "License validated successfully."
 * would tell them they had fixed it.
 */
describe("a license that is stored but licenses nothing", () => {
  const NO_EXPIRY_MESSAGE: string =
    "A OneUptime Enterprise license is installed, but no expiry is recorded for it, so this installation cannot tell whether it is still current. " +
    "The 14-day trial counted from when this installation first ran the Enterprise Edition has ended, so Enterprise features have stopped. " +
    "A master admin can re-activate the license on Settings > License in the Admin Dashboard, or leave the daily license sync to fetch its expiry from oneuptime.com.";

  const STORED_PAST_THE_TRIAL: JSONObject = adminPayload({
    status: "missing",
    verification: "unverified",
    licenseValid: false,
    expiresAt: null,
    message: NO_EXPIRY_MESSAGE,
  });

  const validateWith: (payload: JSONObject) => Promise<void> = async (
    payload: JSONObject,
  ): Promise<void> => {
    respondToWritesWith(trialPayload(), (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(200, payload, {});
    });

    await openPage();

    fireEvent.change(keyInput(), { target: { value: "acme-key" } });
    fireEvent.click(submitButton());
  };

  it("warns instead of claiming success when the license lands past the trial", async () => {
    await validateWith(STORED_PAST_THE_TRIAL);

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
        expiresAt: null,
        graceEndsAt: inDays(10),
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
   * The license IS stored - the warning is not a refusal dressed up as one -
   * and the form stays, because the installation is still not licensed.
   */
  it("still stores the license, and keeps the form open with the key in it", async () => {
    await validateWith(STORED_PAST_THE_TRIAL);

    await screen.findByTestId("enterprise-license-stored-warning");

    expect(callsOf("POST")).toHaveLength(1);
    expect(callsOf("POST")[0]?.data).toEqual({ licenseKey: "acme-key" });
    await waitFor(() => {
      expect(keyInput().value).toBe("acme-license-key");
    });
    expect(announcements).toHaveLength(1);
  });

  it("falls back to its own words when the server sends no message", async () => {
    await validateWith(adminPayload({ ...STORED_PAST_THE_TRIAL, message: null }));

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
   * license, and the page's status already explains it.
   */
  it("still celebrates a license in its own grace period", async () => {
    await validateWith(
      adminPayload({
        status: "grace",
        graceReason: "expired",
        expiresAt: inDays(-2),
        graceEndsAt: inDays(28),
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
    await openPage();

    respondWith(STORED_PAST_THE_TRIAL);

    fireEvent.click(screen.getByTestId("refresh-enterprise-license"));

    expect(
      await screen.findByTestId("enterprise-license-stored-warning"),
    ).toHaveTextContent("no expiry is recorded for it");
    expect(
      screen.queryByText("License refreshed from OneUptime."),
    ).not.toBeInTheDocument();
  });

  it("replaces the warning with the next outcome", async () => {
    await validateWith(STORED_PAST_THE_TRIAL);

    await screen.findByTestId("enterprise-license-stored-warning");

    respondWith(adminPayload());

    fireEvent.click(submitButton());

    expect(
      await screen.findByText("License validated successfully."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("enterprise-license-stored-warning"),
    ).not.toBeInTheDocument();
  });
});

describe("the seat usage and the instances", () => {
  const instances: Array<JSONObject> = [
    {
      instanceId: "instance-1",
      host: "oneuptime.acme.internal",
      userCount: 7,
      lastReportedAt: "2026-01-01T00:00:00.000Z",
      version: "13.0.0",
    },
    {
      instanceId: "instance-2",
      host: "staging.acme.internal",
      userCount: 1,
      lastReportedAt: null,
      version: "12.0.0",
    },
  ];

  it("are on the page with a license in place", async () => {
    respondWith(adminPayload({ instances }));

    await openPage();

    expect(screen.getByText("Licensed seats")).toBeInTheDocument();
    expect(screen.getByText("Instances on this license")).toBeInTheDocument();
    expect(screen.getByText("oneuptime.acme.internal")).toBeInTheDocument();
    expect(screen.getByText("staging.acme.internal")).toBeInTheDocument();
  });

  it("are not on the page without one", async () => {
    respondWith(trialPayload({ instances }));

    await openPage();

    expect(screen.queryByText("Licensed seats")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Instances on this license"),
    ).not.toBeInTheDocument();
  });

  it("read the figures the way the pill does: enforced usage first", async () => {
    respondWith(
      adminPayload({
        userLimit: 50,
        currentUserCount: 40,
        isSeatLimitEnforced: true,
        seatsInUse: 50,
        canAddMoreUsers: false,
      }),
    );

    await openPage();

    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.queryByText("40")).not.toBeInTheDocument();
    expect(screen.getByText("Limit exceeded")).toBeInTheDocument();
  });

  it("offer the refresh to an enforced limit, where the button is", async () => {
    respondWith(
      adminPayload({
        isSeatLimitEnforced: true,
        seatsInUse: 10,
      }),
    );

    await openPage();

    expect(screen.getByText(/Bought more seats/)).toBeInTheDocument();
  });

  /*
   * The sentence used to be there for an offline license too, pointing at a
   * button that license does not have.
   */
  it("do not offer a refresh an offline license cannot do", async () => {
    respondWith(
      adminPayload({
        activationMode: "offline",
        licenseKey: null,
        isSeatLimitEnforced: true,
        seatsInUse: 10,
      }),
    );

    await openPage();

    expect(screen.getByText("Licensed seats")).toBeInTheDocument();
    expect(screen.queryByText(/Bought more seats/)).not.toBeInTheDocument();
  });
});

/*
 * The page and the header's edition pill no longer share a dialog: the page
 * has to tell the pill, or it keeps saying "Trial" beside a license that was
 * just activated, until somebody reloads.
 */
describe("the edition pill above the page", () => {
  const pill: () => HTMLElement = (): HTMLElement => {
    return screen.getByRole("button", { name: /Enterprise Edition/ });
  };

  const openPageWithPill: () => Promise<void> = async (): Promise<void> => {
    render(
      <>
        <EditionLabel licenseDetails={LicenseDetails} />
        <LicenseSettingsView />
      </>,
    );

    await screen.findByTestId("license-status");

    await waitFor(() => {
      expect(pill().textContent).not.toContain("Checking");
    });
  };

  it("follows an activation, with no reload", async () => {
    respondWith(trialPayload());

    await openPageWithPill();

    expect(pill()).toHaveAccessibleName(
      "Enterprise Edition (Trial, 10 days left), Add license",
    );

    respondWith(adminPayload());

    fireEvent.change(keyInput(), { target: { value: "acme-key" } });
    fireEvent.click(submitButton());

    await screen.findByText("License validated successfully.");

    await waitFor(() => {
      expect(pill()).toHaveAccessibleName("Enterprise Edition, View details");
    });
  });

  it("follows a refresh", async () => {
    respondWith(
      adminPayload({
        isSeatLimitEnforced: true,
        seatsInUse: 50,
        canAddMoreUsers: false,
      }),
    );

    await openPageWithPill();

    expect(pill()).toHaveAccessibleName(
      "Enterprise Edition, User limit exceeded",
    );

    respondWith(
      adminPayload({
        userLimit: 100,
        isSeatLimitEnforced: true,
        seatsInUse: 50,
        canAddMoreUsers: true,
      }),
    );

    fireEvent.click(screen.getByTestId("refresh-enterprise-license"));

    await screen.findByText("License refreshed from OneUptime.");

    await waitFor(() => {
      expect(pill()).toHaveAccessibleName("Enterprise Edition, View details");
    });
  });

  it("is told once per change, and never about a refused write", async () => {
    respondToWritesWith(trialPayload(), (): HTTPErrorResponse => {
      return refused(400, "This license key is not valid.");
    });

    await openPage();

    fireEvent.change(keyInput(), { target: { value: "typo-key" } });
    fireEvent.click(submitButton());

    await screen.findByText("This license key is not valid.");

    expect(announcements).toHaveLength(0);

    respondWith(adminPayload());

    fireEvent.change(keyInput(), { target: { value: "right-key" } });
    fireEvent.click(submitButton());

    await screen.findByText("License validated successfully.");

    expect(announcements).toHaveLength(1);
  });
});

describe("the page around it", () => {
  it("sits in Settings, with the Settings side menu and its breadcrumbs", async () => {
    render(<LicenseSettingsPage />);

    await screen.findByTestId("license-status");

    expect(screen.getByTestId("settings-side-menu")).toBeInTheDocument();

    const links: Array<HTMLElement> = within(
      screen.getByTestId("breadcrumbs"),
    ).getAllByRole("link");

    expect(
      links.map((link: HTMLElement): string | null => {
        return link.textContent;
      }),
    ).toEqual([
      "breadcrumbs.adminDashboard",
      "breadcrumbs.settings",
      "breadcrumbs.enterpriseLicense",
    ]);
    expect(links[2]).toHaveAttribute("href", "/admin/settings/license");
  });

  it.each([
    [
      "the Community Edition, on the Enterprise image",
      (): void => {
        isEnterpriseEdition = false;
      },
    ],
    [
      "OneUptime Cloud, where subscriptions bound seats and plans",
      (): void => {
        billingEnabled = true;
      },
    ],
  ])(
    "draws nothing, and asks nothing, on %s",
    async (_name: string, setUp: () => void) => {
      setUp();

      const { container } = render(<LicenseSettingsPage />);

      await act(async () => {
        await Promise.resolve();
      });

      expect(container).toBeEmptyDOMElement();
      expect(fetchCalls).toHaveLength(0);
    },
  );
});
