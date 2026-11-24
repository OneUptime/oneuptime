/* global CredentialCreationOptions */
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import TwoFactorSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/TwoFactorAuth";
import PasskeySettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Passkeys";
import { LAST_SECOND_STEP_DELETE_REASON } from "../../../../App/FeatureSet/Dashboard/src/Components/TwoFactorAuth/TwoFactorAuthSetupState";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import Card from "../../../UI/Components/Card/Card";
import User from "../../../Models/DatabaseModels/User";
import UserTotpAuth from "../../../Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "../../../Models/DatabaseModels/UserWebAuthn";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import TwoFactorAuthStatus from "../../../Types/TwoFactorAuthStatus";
import { SSO_MANAGED_SIGN_IN_MESSAGE } from "../../../Types/SSO/SsoManagedSignIn";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import UiAnalytics from "../../../UI/Utils/Analytics";
import {
  isReauthenticationStatusRequest,
  reauthenticationStatusAnswer,
} from "../../Helpers/ReauthenticationStatus";
import WebAuthnTestUtil, {
  registrationOptions,
} from "../../Utils/WebAuthnTestUtil";

/*
 * ENABLE STARTS WITH A SECOND STEP (issue #9666).
 *
 * With nothing set up, Enable used to switch two-factor authentication on
 * over nothing. On User Profile > Security > Two-factor authentication it
 * now opens a short guided setup: pick an authenticator app (scan its QR
 * code, enter its code) or a security key (the browser's prompt), and two-
 * factor authentication is turned on only once that step works. The same
 * setup finishes an account that is on with nothing behind it. And the
 * last second step cannot be removed while it is on - from either page.
 *
 * The real page, status card, setup dialogs and WebAuthn registration are
 * drawn; the lists are a stand-in that records their props, and the
 * server's answers are stood in at API and ModelAPI.
 */

let mockTotpTableProps: ModelTableProps<UserTotpAuth> | undefined;
let mockKeyTableProps: ModelTableProps<UserWebAuthn> | undefined;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<UserWebAuthn>): React.ReactElement => {
      if (props.modelType === UserWebAuthn) {
        mockKeyTableProps = props;
      } else if (props.id === "totp-auth-table") {
        mockTotpTableProps = props as unknown as ModelTableProps<UserTotpAuth>;
      }
      return (
        <section data-testid={props.id} data-refresh={props.refreshToggle}>
          <Card {...props.cardProps}>
            <>{props.noItemsMessage}</>
          </Card>
        </section>
      );
    },
  };
});
jest.mock("../../../UI/Components/QR/QR", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return <div data-testid="authenticator-qr">{props.text}</div>;
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TwoFactorAuth/BackupCodes",
  () => {
    return {
      __esModule: true,
      default: (props: {
        codesFromEnrolment: Array<string>;
      }): React.ReactElement => {
        return (
          <div data-testid="enrolment-backup-codes">
            {props.codesFromEnrolment.join(",")}
          </div>
        );
      },
    };
  },
);

const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const NEW_APP_ID: string = "45454545-4545-4545-8545-454545454545";
const UNFINISHED_APP_ID: string = "46464646-4646-4646-8646-464646464646";
const OTP_URL: string =
  "otpauth://totp/OneUptime:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=OneUptime";

const status: (value: TwoFactorAuthStatus, count: number) => JSONObject = (
  value: TwoFactorAuthStatus,
  count: number,
): JSONObject => {
  return { status: value, verifiedMethodCount: count };
};

// What the server says about where the person stands, read after read.
let statusAnswers: Array<JSONObject>;
let posted: Array<{ url: string; data: unknown }>;
let validateAnswer: HTTPResponse<JSONObject> | Error;
let unfinishedApps: Array<UserTotpAuth>;
let createApp: jest.SpyInstance;
let updateUser: jest.SpyInstance;
let readStatus: jest.SpyInstance;

const renderPage: (isPasskey?: boolean) => void = (
  isPasskey: boolean = false,
): void => {
  const pageRoute: Route = new Route(
    isPasskey
      ? "/dashboard/user-profile/passkeys"
      : "/dashboard/user-profile/two-factor-auth",
  );
  Navigation.setLocation({
    pathname: pageRoute.toString(),
    search: "",
    hash: "",
    state: null,
    key: "guided-setup-test",
  });
  const Page: typeof TwoFactorSettings = isPasskey
    ? PasskeySettings
    : TwoFactorSettings;
  render(
    <MemoryRouter initialEntries={[pageRoute.toString()]}>
      <Page
        pageRoute={pageRoute}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
};

const click: (element: HTMLElement) => Promise<void> = async (
  element: HTMLElement,
): Promise<void> => {
  await act(async () => {
    fireEvent.click(element);
  });
};

const chooser: () => Promise<HTMLElement> = async (): Promise<HTMLElement> => {
  return await screen.findByRole("dialog", {
    name: "Set up two-factor authentication",
  });
};

const verifyWithCode: (code: string) => Promise<HTMLElement> = async (
  code: string,
): Promise<HTMLElement> => {
  const dialog: HTMLElement = await screen.findByRole("dialog", {
    name: /^Set up /,
  });
  await screen.findByTestId("authenticator-qr");
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: code },
    });
  });
  await click(
    within(dialog).getByRole("button", { name: "Verify and finish" }),
  );
  return dialog;
};

beforeEach(() => {
  mockTotpTableProps = undefined;
  mockKeyTableProps = undefined;
  statusAnswers = [status(TwoFactorAuthStatus.NotEnabled, 0)];
  posted = [];
  validateAnswer = new HTTPResponse<JSONObject>(
    200,
    { backupCodes: ["ABCDE-FGHIJ"] },
    {},
  );
  unfinishedApps = [];
  window.localStorage.clear();
  WebAuthnTestUtil.install();

  jest.spyOn(UserUtil, "getUserId").mockReturnValue(USER_ID);
  jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
  jest
    .spyOn(API, "getFriendlyMessage")
    .mockImplementation((error: unknown): string => {
      return (error as Error).message;
    });

  readStatus = jest
    .spyOn(API, "get")
    .mockImplementation(
      async (
        options: Parameters<typeof API.get>[0],
      ): Promise<HTTPResponse<JSONObject>> => {
        const url: string = options.url?.toString() || "";
        /*
         * A security key's registration confirms the session first
         * (#10155): here it has, so the browser's prompt opens at once.
         */
        if (isReauthenticationStatusRequest(url)) {
          return new HTTPResponse<JSONObject>(
            200,
            reauthenticationStatusAnswer(true),
            {},
          );
        }
        if (!url.endsWith("/user/two-factor-auth-status")) {
          throw new Error(`Unexpected request: ${url}`);
        }
        const next: JSONObject =
          (statusAnswers.length > 1
            ? statusAnswers.shift()
            : statusAnswers[0]) || {};
        return new HTTPResponse<JSONObject>(200, next, {});
      },
    );

  jest
    .spyOn(API, "post")
    .mockImplementation(
      async (
        options: Parameters<typeof API.post>[0],
      ): Promise<HTTPResponse<JSONObject>> => {
        const url: string = options.url?.toString() || "";
        posted.push({ url: url, data: options.data });
        if (url.endsWith("/user-totp-auth/validate")) {
          if (validateAnswer instanceof Error) {
            throw validateAnswer;
          }
          return validateAnswer;
        }
        if (url.endsWith("/generate-registration-options")) {
          return new HTTPResponse<JSONObject>(
            200,
            { options: registrationOptions },
            {},
          );
        }
        return new HTTPResponse<JSONObject>(200, { backupCodes: [] }, {});
      },
    );

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<ListResult<UserTotpAuth>> => {
      return {
        data: unfinishedApps,
        count: unfinishedApps.length,
        skip: 0,
        limit: 1,
      } as ListResult<UserTotpAuth>;
    }) as never;

  createApp = jest
    .spyOn(ModelAPI, "create")
    .mockImplementation(async (data: { model: unknown }): Promise<never> => {
      const created: UserTotpAuth = new UserTotpAuth();
      created._id = NEW_APP_ID;
      created.name = (data.model as UserTotpAuth).name || "";
      // ModelAPI hands the created record back as a model, as it reads it.
      const response: HTTPResponse<UserTotpAuth> =
        new HTTPResponse<UserTotpAuth>(200, {}, {});
      response.data = created;
      return response as never;
    });

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (data: { id: ObjectID }): Promise<never> => {
      const item: UserTotpAuth = new UserTotpAuth();
      item._id = data.id.toString();
      item.name = "Authenticator app";
      item.twoFactorOtpUrl = OTP_URL;
      return item as never;
    }) as never;

  updateUser = jest
    .spyOn(ModelAPI, "updateById")
    .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Enable, with nothing set up: the guided setup", () => {
  test("opens a choice of second step - an authenticator app first - and turns nothing on yet", async () => {
    renderPage();

    await click(
      await screen.findByRole("button", {
        name: "Enable two-factor authentication",
      }),
    );
    const dialog: HTMLElement = await chooser();

    expect(dialog).toHaveTextContent(
      "Choose your second step. You can add more later.",
    );
    expect(within(dialog).getByText("Authenticator app")).toBeVisible();
    expect(within(dialog).getByText("Security key")).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Continue" }),
    ).toBeEnabled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });

  test("an authenticator app: QR code, its code, and two-factor authentication turned on at the end", async () => {
    statusAnswers = [
      status(TwoFactorAuthStatus.NotEnabled, 0),
      status(TwoFactorAuthStatus.EnabledConfigured, 1),
    ];
    renderPage();

    await click(
      await screen.findByRole("button", {
        name: "Enable two-factor authentication",
      }),
    );
    await click(
      within(await chooser()).getByRole("button", { name: "Continue" }),
    );

    // A new app, named after its kind, to be renamed from its card.
    expect(createApp).toHaveBeenCalledTimes(1);
    expect((createApp.mock.calls[0]![0].model as UserTotpAuth).name).toBe(
      "Authenticator app",
    );
    // Nothing is on while the code is being typed.
    expect(updateUser).not.toHaveBeenCalled();

    await verifyWithCode("123456");

    expect(posted).toEqual([
      {
        url: expect.stringMatching(/\/user-totp-auth\/validate$/),
        data: { code: "123456", id: NEW_APP_ID },
      },
    ]);
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith({
      modelType: User,
      id: USER_ID,
      data: { enableTwoFactorAuth: true },
    });
    expect(
      await screen.findByText("Two-factor authentication is on."),
    ).toBeVisible();
    // The backup codes minted with the first second step reach their screen.
    expect(screen.getByTestId("enrolment-backup-codes")).toHaveTextContent(
      "ABCDE-FGHIJ",
    );
    // The card reads where the person stands again, and says so.
    expect(
      await within(screen.getByTestId("two-factor-status")).findByText(
        "Enabled",
        { exact: true },
      ),
    ).toBeVisible();
  });

  test("picks up an app left unfinished, so a QR code already scanned still works", async () => {
    const unfinished: UserTotpAuth = new UserTotpAuth();
    unfinished._id = UNFINISHED_APP_ID;
    unfinished.name = "Work phone";
    unfinishedApps = [unfinished];
    renderPage();

    await click(
      await screen.findByRole("button", {
        name: "Enable two-factor authentication",
      }),
    );
    await click(
      within(await chooser()).getByRole("button", { name: "Continue" }),
    );
    await verifyWithCode("654321");

    expect(createApp).not.toHaveBeenCalled();
    expect(posted[0]!.data).toEqual({ code: "654321", id: UNFINISHED_APP_ID });
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  test("a wrong code turns nothing on, and says why", async () => {
    validateAnswer = new Error("Invalid code");
    renderPage();

    await click(
      await screen.findByRole("button", {
        name: "Enable two-factor authentication",
      }),
    );
    await click(
      within(await chooser()).getByRole("button", { name: "Continue" }),
    );
    const dialog: HTMLElement = await verifyWithCode("000000");

    expect(await within(dialog).findByText("Invalid code")).toBeVisible();
    expect(updateUser).not.toHaveBeenCalled();
  });

  test("closing the QR code turns nothing on, even if the app is finished later from its card", async () => {
    renderPage();

    await click(
      await screen.findByRole("button", {
        name: "Enable two-factor authentication",
      }),
    );
    await click(
      within(await chooser()).getByRole("button", { name: "Continue" }),
    );
    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: /^Set up /,
    });
    await click(within(dialog).getByRole("button", { name: "Cancel" }));

    // The app's own "Finish setup" afterwards adds it, and nothing more.
    const item: UserTotpAuth = new UserTotpAuth();
    item._id = NEW_APP_ID;
    item.name = "Authenticator app";
    await act(async () => {
      // Typed as a click handler; the page's is async, so wait for it.
      const opening: unknown = mockTotpTableProps!.actionButtons![0]!.onClick(
        item,
        () => {},
        () => {},
      );
      await Promise.resolve(opening);
    });
    await verifyWithCode("123456");

    expect(posted).toHaveLength(1);
    expect(updateUser).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "Authenticator app added. It is ready to use for two-factor authentication.",
      ),
    ).toBeVisible();
  });

  test("a turn-on the server refuses after the app works says so, and the app stays", async () => {
    updateUser.mockRejectedValueOnce(new Error(SSO_MANAGED_SIGN_IN_MESSAGE));
    renderPage();

    await click(
      await screen.findByRole("button", {
        name: "Enable two-factor authentication",
      }),
    );
    await click(
      within(await chooser()).getByRole("button", { name: "Continue" }),
    );
    await verifyWithCode("123456");

    expect(
      await screen.findByText(
        /Your organization signs you in with single sign-on/,
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("Two-factor authentication is on."),
    ).not.toBeInTheDocument();
  });

  test("a security key: the browser's prompt, and two-factor authentication turned on at the end", async () => {
    renderPage();

    await click(
      await screen.findByRole("button", {
        name: "Enable two-factor authentication",
      }),
    );
    const dialog: HTMLElement = await chooser();
    await click(within(dialog).getByText("Security key"));
    await click(within(dialog).getByRole("button", { name: "Continue" }));

    // The same registration the Security keys card's Add opens.
    const registration: HTMLElement = await screen.findByRole("dialog", {
      name: "Add Security Key",
    });
    expect(createApp).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.change(within(registration).getByTestId("passkey-name"), {
        target: { value: "YubiKey 5C" },
      });
    });
    await click(
      within(registration).getByRole("button", {
        name: "Register Security Key",
      }),
    );

    expect(
      posted.map((request: { url: string }): string => {
        return request.url.replace(/^.*\/user-webauthn/, "/user-webauthn");
      }),
    ).toEqual([
      "/user-webauthn/generate-registration-options",
      "/user-webauthn/verify-registration",
    ]);
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith({
      modelType: User,
      id: USER_ID,
      data: { enableTwoFactorAuth: true },
    });
    expect(
      await screen.findByText("Two-factor authentication is on."),
    ).toBeVisible();
  });

  test("closing the security key's prompt turns nothing on", async () => {
    renderPage();

    await click(
      await screen.findByRole("button", {
        name: "Enable two-factor authentication",
      }),
    );
    const dialog: HTMLElement = await chooser();
    await click(within(dialog).getByText("Security key"));
    await click(within(dialog).getByRole("button", { name: "Continue" }));
    const registration: HTMLElement = await screen.findByRole("dialog", {
      name: "Add Security Key",
    });
    await click(within(registration).getByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByRole("dialog", { name: "Add Security Key" }),
    ).not.toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });

  test("Cancel on the choice changes nothing", async () => {
    renderPage();

    await click(
      await screen.findByRole("button", {
        name: "Enable two-factor authentication",
      }),
    );
    await click(
      within(await chooser()).getByRole("button", { name: "Cancel" }),
    );

    expect(
      screen.queryByRole("dialog", {
        name: "Set up two-factor authentication",
      }),
    ).not.toBeInTheDocument();
    expect(createApp).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("Setup needed: on, with nothing set up", () => {
  test("Finish setup adds the missing second step, and turns nothing on again", async () => {
    statusAnswers = [
      status(TwoFactorAuthStatus.EnabledPendingSetup, 0),
      status(TwoFactorAuthStatus.EnabledConfigured, 1),
    ];
    renderPage();

    expect(await screen.findByTestId("two-factor-status")).toHaveTextContent(
      "Setup needed",
    );
    await click(screen.getByRole("button", { name: "Finish setup" }));
    await click(
      within(await chooser()).getByRole("button", { name: "Continue" }),
    );
    await verifyWithCode("123456");

    // It is on already: the second step was all it lacked.
    expect(updateUser).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Two-factor authentication is on."),
    ).toBeVisible();
    expect(
      await within(screen.getByTestId("two-factor-status")).findByText(
        "Enabled",
        { exact: true },
      ),
    ).toBeVisible();
  });
});

describe("the last second step stays while two-factor authentication is on", () => {
  const verified: UserTotpAuth = new UserTotpAuth();
  verified.isVerified = true;
  const unfinished: UserTotpAuth = new UserTotpAuth();
  unfinished.isVerified = false;
  const key: UserWebAuthn = new UserWebAuthn();
  key.isVerified = true;

  test("its delete is locked, with what to do, on both lists of the page", async () => {
    statusAnswers = [status(TwoFactorAuthStatus.EnabledConfigured, 1)];
    renderPage();
    await screen.findByTestId("two-factor-status");

    expect(mockTotpTableProps!.getDeleteDisabledReason!(verified)).toBe(
      LAST_SECOND_STEP_DELETE_REASON,
    );
    expect(mockKeyTableProps!.getDeleteDisabledReason!(key)).toBe(
      LAST_SECOND_STEP_DELETE_REASON,
    );
    // An unfinished setup, which no sign-in can ask for, can always go.
    expect(
      mockTotpTableProps!.getDeleteDisabledReason!(unfinished),
    ).toBeUndefined();
  });

  test.each([
    ["two are set up", status(TwoFactorAuthStatus.EnabledConfigured, 2)],
    ["it is off", status(TwoFactorAuthStatus.NotEnabled, 1)],
    [
      "it is on with nothing set up",
      status(TwoFactorAuthStatus.EnabledPendingSetup, 0),
    ],
  ])(
    "nothing is locked when %s",
    async (_label: string, answer: JSONObject) => {
      statusAnswers = [answer];
      renderPage();
      await screen.findByTestId("two-factor-status");

      expect(
        mockTotpTableProps!.getDeleteDisabledReason!(verified),
      ).toBeUndefined();
      expect(mockKeyTableProps!.getDeleteDisabledReason!(key)).toBeUndefined();
    },
  );

  test("a removed second step reads the status again", async () => {
    statusAnswers = [
      status(TwoFactorAuthStatus.EnabledConfigured, 2),
      status(TwoFactorAuthStatus.EnabledConfigured, 1),
    ];
    renderPage();
    await screen.findByTestId("two-factor-status");
    const reads: number = readStatus.mock.calls.length;

    await act(async () => {
      mockTotpTableProps!.onItemDeleted!(verified);
    });

    expect(readStatus.mock.calls.length).toBe(reads + 1);
    expect(mockTotpTableProps!.getDeleteDisabledReason!(verified)).toBe(
      LAST_SECOND_STEP_DELETE_REASON,
    );
  });

  test("the Passkeys page locks the last passkey the same way", async () => {
    statusAnswers = [status(TwoFactorAuthStatus.EnabledConfigured, 1)];
    renderPage(true);

    await act(async () => {
      await Promise.resolve();
    });

    const passkey: UserWebAuthn = new UserWebAuthn();
    passkey.isVerified = true;
    passkey.isPasskey = true;

    expect(mockKeyTableProps!.getDeleteDisabledReason!(passkey)).toBe(
      LAST_SECOND_STEP_DELETE_REASON,
    );
  });
});
