/* global CredentialCreationOptions */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import API from "../../../UI/Utils/API/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import UserUtil from "../../../UI/Utils/User";
import Navigation from "../../../UI/Utils/Navigation";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import UiAnalytics from "../../../UI/Utils/Analytics";
import WebAuthnTestUtil, {
  registrationOptions,
} from "../../Utils/WebAuthnTestUtil";
import PasskeySettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Passkeys";
import TwoFactorSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/TwoFactorAuth";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import UserWebAuthn from "../../../Models/DatabaseModels/UserWebAuthn";
import UserTotpAuth from "../../../Models/DatabaseModels/UserTotpAuth";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import Permission from "../../../Types/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import Card from "../../../UI/Components/Card/Card";
import EqualToOrNull from "../../../Types/BaseDatabase/EqualToOrNull";

let mockRenderRealPasskeyTable: boolean = false;
let mockRenderRealTotpTable: boolean = false;
let mockCredentialTableProps: ModelTableProps<UserWebAuthn> | undefined;
let mockTotpTableProps: ModelTableProps<UserTotpAuth> | undefined;

/*
 * Keep the real page, enrollment modal, input and browser/API boundary. Only
 * registration cases replace unrelated model lists; header and management
 * cases use the real credential and authenticator tables to verify shared UI,
 * name-only updates, and create-versus-edit enrollment behavior.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<UserWebAuthn>): React.ReactElement => {
      if (props.modelType === UserWebAuthn) {
        mockCredentialTableProps = props;
      } else if (props.id === "totp-auth-table") {
        mockTotpTableProps = props as unknown as ModelTableProps<UserTotpAuth>;
      }
      if (
        (mockRenderRealPasskeyTable && props.modelType === UserWebAuthn) ||
        (mockRenderRealTotpTable && props.id === "totp-auth-table")
      ) {
        const ModelTable: typeof import("../../../UI/Components/ModelTable/ModelTable").default =
          (
            jest.requireActual(
              "../../../UI/Components/ModelTable/ModelTable",
            ) as typeof import("../../../UI/Components/ModelTable/ModelTable")
          ).default;
        return <ModelTable {...props} />;
      }
      return (
        <section data-testid={props.id} data-refresh={props.refreshToggle}>
          <Card {...props.cardProps}>
            <>
              {props.topContent}
              {props.noItemsMessage}
            </>
          </Card>
        </section>
      );
    },
  };
});
jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: {
      children: React.ReactNode;
      sideMenu: React.ReactNode;
    }): React.ReactElement => {
      return (
        <div>
          {props.sideMenu}
          {props.children}
        </div>
      );
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TwoFactorAuth/TwoFactorStatus",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <p>Two factor authentication is disabled</p>;
      },
    };
  },
);
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
        hideCard?: boolean;
      }): React.ReactElement => {
        return (
          <>
            {!props.hideCard && <h2>Backup codes</h2>}
            <div data-testid="enrolment-backup-codes">
              {props.codesFromEnrolment.join(",")}
            </div>
          </>
        );
      },
    };
  },
);

type PostedRequest = {
  url: string;
  data: Parameters<typeof API.post>[0]["data"];
};
let posted: Array<PostedRequest> = [];
let backupCodes: Array<string> = [];

const renderPage: (isPasskey?: boolean) => void = (
  isPasskey: boolean = true,
): void => {
  const SettingsPage: typeof PasskeySettings = isPasskey
    ? PasskeySettings
    : TwoFactorSettings;
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
    key: "security-settings-test",
  });
  render(
    <MemoryRouter initialEntries={[pageRoute.toString()]}>
      <SettingsPage
        pageRoute={pageRoute}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
};

const mockTablePermissions: () => void = (): void => {
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.CurrentUser]);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue({
    projectIds: [],
    globalPermissions: [Permission.CurrentUser],
    _type: "UserGlobalAccessPermission",
  });
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(null);
};

const mockPasskeyTable: (items: Array<UserWebAuthn>) => void = (
  items: Array<UserWebAuthn>,
): void => {
  mockRenderRealPasskeyTable = true;
  mockTablePermissions();
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: items,
    count: items.length,
    skip: 0,
    limit: 10,
  });
};

const click: (element: HTMLElement) => Promise<void> = async (
  element: HTMLElement,
): Promise<void> => {
  await act(async () => {
    await userEvent.click(element);
  });
};

const type: (element: HTMLElement, value: string) => Promise<void> = async (
  element: HTMLElement,
  value: string,
): Promise<void> => {
  await act(async () => {
    await userEvent.type(element, value);
  });
};

const keyboard: (keys: string) => Promise<void> = async (
  keys: string,
): Promise<void> => {
  await act(async () => {
    await userEvent.keyboard(keys);
  });
};

const enterName: () => Promise<void> = async (): Promise<void> => {
  const input: HTMLElement = await screen.findByTestId("passkey-name");
  await act(async () => {
    fireEvent.change(input, { target: { value: "My laptop" } });
  });
  expect(input).toHaveValue("My laptop");
};

const register: (isPasskey?: boolean) => Promise<void> = async (
  isPasskey: boolean = true,
): Promise<void> => {
  await click(
    screen.getByRole("button", {
      name: isPasskey ? "Add Passkey" : "Add Security Key",
    }),
  );
  await enterName();
  await act(async () => {
    await click(
      screen.getByRole("button", {
        name: isPasskey ? "Create Passkey" : "Register Security Key",
      }),
    );
  });
};

describe("Passkey settings registration", () => {
  beforeEach(() => {
    mockRenderRealPasskeyTable = false;
    mockRenderRealTotpTable = false;
    mockCredentialTableProps = undefined;
    mockTotpTableProps = undefined;
    window.localStorage.clear();
    PermissionGate.clearPermissionPropsCache();
    TableFilterUrlState.resetClaimedKeys();
    posted = [];
    backupCodes = [];
    WebAuthnTestUtil.install();
    jest
      .spyOn(UserUtil, "getUserId")
      .mockReturnValue(new ObjectID("33333333-3333-4333-8333-333333333333"));
    jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
    jest
      .spyOn(API, "post")
      .mockImplementation(
        async (
          options: Parameters<typeof API.post>[0],
        ): Promise<HTTPResponse<JSONObject>> => {
          const url: string = options.url?.toString() || "";
          posted.push({ url: url, data: options.data });
          if (url.endsWith("/generate-registration-options")) {
            return new HTTPResponse<JSONObject>(
              200,
              { options: registrationOptions },
              {},
            );
          }
          return new HTTPResponse<JSONObject>(
            200,
            { verified: true, backupCodes: backupCodes },
            {},
          );
        },
      );
  });
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("keeps passwordless sign-in on a dedicated passkeys page", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Add Passkey" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Add Security Key" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Two factor authentication is disabled"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Backup codes/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Authenticator apps/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Passkeys", exact: true }),
    ).toBeVisible();
    expect(mockCredentialTableProps?.query).toEqual({
      userId: UserUtil.getUserId(),
      isPasskey: new EqualToOrNull("true"),
    });
  });

  test("offers security keys and authenticator apps together on the two-factor page", () => {
    renderPage(false);
    expect(
      screen.getByRole("button", { name: "Add Security Key" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Add Passkey" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Authenticator apps/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /Backup codes/i }),
    ).toBeVisible();
    expect(mockCredentialTableProps?.query).toEqual({
      userId: UserUtil.getUserId(),
      isPasskey: new EqualToOrNull("false"),
    });
  });

  test.each([true, false])(
    "provides distinct navigation and removes the old advice panel: passkeys %s",
    (isPasskey: boolean) => {
      renderPage(isPasskey);
      expect(
        screen.getByRole("link", { name: "Passkeys", exact: true }),
      ).toHaveAttribute("href", "/dashboard/user-profile/passkeys");
      expect(
        screen.getByRole("link", { name: /Two.factor authentication/i }),
      ).toHaveAttribute("href", "/dashboard/user-profile/two-factor-auth");
      expect(
        screen.queryByText("Keep another way to sign in"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/keep your password available/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/save your backup codes below/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Passkeys & Two Factor Auth"),
      ).not.toBeInTheDocument();
    },
  );

  test.each([true, false])(
    "shows a concise empty state without the legacy credential notice: passkeys %s",
    async (isPasskey: boolean) => {
      mockPasskeyTable([]);
      renderPage(isPasskey);
      expect(
        await screen.findByText(
          isPasskey ? "No passkeys added yet." : "No security keys added yet.",
        ),
      ).toBeVisible();
      expect(
        screen.queryByText("No passkeys or security keys found."),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          /Existing credentials appear on both security pages/,
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: isPasskey ? "Add Passkey" : "Add Security Key",
        }),
      ).toBeEnabled();
    },
  );

  test.each([false, true])(
    "uses the shared table header and standard add action when a saved passkey is present: %s",
    async (hasPasskey: boolean) => {
      const storedKey: UserWebAuthn = new UserWebAuthn();
      storedKey._id = "44444444-4444-4444-8444-444444444444";
      storedKey.name = "My laptop";
      storedKey.createdAt = new Date("2026-09-08T12:00:00.000Z");
      storedKey.isVerified = true;
      storedKey.isPasskey = true;
      mockPasskeyTable(hasPasskey ? [storedKey] : []);
      renderPage();

      expect(
        await screen.findByText(
          hasPasskey ? "My laptop" : "No passkeys added yet.",
        ),
      ).toBeVisible();
      const heading: HTMLElement = screen.getByRole("heading", {
        name: "Passkeys",
        exact: true,
      });
      const card: HTMLElement = heading.closest(
        '[data-testid="card"]',
      ) as HTMLElement;
      expect(card).toBeInTheDocument();
      expect(within(card).getAllByRole("heading")).toHaveLength(1);
      expect(within(card).getAllByTestId("card-description")).toHaveLength(1);
      expect(within(card).getByTestId("card-description")).toHaveTextContent(
        "Sign in without a password using your fingerprint, face, screen lock, or a compatible security key.",
      );
      expect(
        within(card).queryByText(
          /whether two factor authentication is on or off/,
        ),
      ).not.toBeInTheDocument();
      expect(
        within(card).queryByText("Add your first passkey"),
      ).not.toBeInTheDocument();

      const addPasskey: HTMLElement = within(card).getByRole("button", {
        name: "Add Passkey",
        exact: true,
      });
      expect(addPasskey).toHaveAttribute("data-testid", "card-button");
      expect(addPasskey).toHaveClass(
        "bg-white",
        "border-gray-300",
        "text-gray-700",
      );
      expect(addPasskey).not.toHaveClass("bg-indigo-600");
      expect(addPasskey).toBeEnabled();

      await click(addPasskey);
      const dialog: HTMLElement = screen.getByRole("dialog", {
        name: "Add Passkey",
      });
      expect(
        within(dialog).getByRole("textbox", { name: "Passkey name" }),
      ).toBeVisible();
      expect(
        within(dialog).getByRole("button", { name: "Create Passkey" }),
      ).toBeVisible();
      expect(API.post).not.toHaveBeenCalled();
    },
  );

  test.each([true, false])(
    "omits the legacy notice while keeping mixed saved credentials manageable: passkeys %s",
    async (isPasskey: boolean) => {
      const storedKey: UserWebAuthn = new UserWebAuthn();
      storedKey._id = "44444444-4444-4444-8444-444444444444";
      storedKey.name = "Existing device";
      storedKey.isVerified = true;
      const olderKey: UserWebAuthn = UserWebAuthn.fromJSONObject(
        {
          _id: "55555555-5555-4555-8555-555555555555",
          name: "Older device",
          isVerified: true,
          isPasskey: null,
        },
        UserWebAuthn,
      );
      const currentKey: UserWebAuthn = new UserWebAuthn();
      currentKey._id = "66666666-6666-4666-8666-666666666666";
      currentKey.name = "New device";
      currentKey.isVerified = false;
      currentKey.isPasskey = isPasskey;
      mockPasskeyTable([storedKey, olderKey, currentKey]);
      renderPage(isPasskey);
      expect(await screen.findByText("Existing device")).toBeVisible();
      expect(
        screen.queryByText(
          /Existing credentials appear on both security pages/,
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/They continue to work as before/),
      ).not.toBeInTheDocument();

      for (const name of ["Existing device", "Older device", "New device"]) {
        const row: HTMLElement = screen.getByRole("row", {
          name: new RegExp(name),
        });
        expect(within(row).getByText(name)).toBeVisible();
        expect(
          within(row).getByRole("button", { name: "Rename", exact: true }),
        ).toBeEnabled();
        expect(
          within(row).getByRole("button", { name: "Delete", exact: true }),
        ).toBeEnabled();
        if (name === "New device") {
          expect(
            within(row).queryByText("Existing credential"),
          ).not.toBeInTheDocument();
          expect(within(row).getByText("Setup incomplete")).toBeVisible();
        } else {
          expect(within(row).getByText("Existing credential")).toBeVisible();
          expect(within(row).getByText("Ready")).toBeVisible();
        }
      }
      expect(
        screen.getByRole("button", {
          name: isPasskey ? "Add Passkey" : "Add Security Key",
        }),
      ).toBeEnabled();
      expect(mockCredentialTableProps?.query).toEqual({
        userId: UserUtil.getUserId(),
        isPasskey: new EqualToOrNull(isPasskey ? "true" : "false"),
      });
    },
  );

  test("labels the name input, associates its hint and supports keyboard submission", async () => {
    renderPage();
    await click(screen.getByRole("button", { name: "Add Passkey" }));
    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Add Passkey",
    });
    const input: HTMLElement = within(dialog).getByRole("textbox", {
      name: "Passkey name",
    });
    expect(input).toHaveAccessibleDescription(
      /Choose a name you will recognize later/,
    );
    expect(dialog).toHaveAccessibleDescription(
      /follow your browser's instructions/,
    );
    await type(input, "  My phone  ");
    await keyboard("{Enter}");
    await waitFor(() => {
      expect(posted).toHaveLength(2);
    });
    expect(posted[1]?.data).toMatchObject({ name: "My phone" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("rejects a whitespace-only name before contacting the browser or server", async () => {
    jest.spyOn(navigator.credentials, "create");
    renderPage();
    await click(screen.getByRole("button", { name: "Add Passkey" }));
    await type(screen.getByTestId("passkey-name"), "   ");
    await click(screen.getByRole("button", { name: "Create Passkey" }));
    expect(screen.getByRole("textbox", { name: "Passkey name" })).toBeInvalid();
    expect(
      screen.getByText("Enter a name to recognize this key."),
    ).toBeVisible();
    expect(posted).toHaveLength(0);
    expect(navigator.credentials.create).not.toHaveBeenCalled();
  });

  test("requests a discoverable passkey, verifies registration and refreshes management", async () => {
    renderPage();
    const refreshBefore: string | null = screen
      .getByTestId("passkeys-table")
      .getAttribute("data-refresh");
    await register();
    expect(posted[0]?.data).toEqual({ isPasskey: true });
    expect(posted[1]?.url).toContain("/user-webauthn/verify-registration");
    expect(posted[1]?.data).toMatchObject({
      name: "My laptop",
      credential: {
        id: "-_8A",
        rawId: "-_8A",
        type: "public-key",
        clientExtensionResults: { credProps: { rk: true } },
        response: {
          attestationObject: "BAUG",
          clientDataJSON: "AQID",
          transports: ["internal", "hybrid"],
        },
      },
    });
    expect(
      screen.queryByRole("button", { name: "Create Passkey" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("passkeys-table").getAttribute("data-refresh"),
    ).not.toBe(refreshBefore);
    expect(
      screen.getByTestId("passkey-registration-success"),
    ).toHaveTextContent("Passkey added. Use it the next time you sign in.");
  });

  test("registers security keys, closes registration and refreshes the list without a success banner", async () => {
    renderPage(false);
    for (const registrationNumber of [1, 2]) {
      const refreshBefore: string | null = screen
        .getByTestId("security-keys-table")
        .getAttribute("data-refresh");
      await register(false);

      expect(posted).toHaveLength(registrationNumber * 2);
      expect(posted[(registrationNumber - 1) * 2]?.data).toEqual({
        isPasskey: false,
      });
      expect(posted[registrationNumber * 2 - 1]?.data).toMatchObject({
        name: "My laptop",
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        screen.getByTestId("security-keys-table").getAttribute("data-refresh"),
      ).not.toBe(refreshBefore);
      expect(
        screen.queryByTestId("passkey-registration-success"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          "Security key added. It is ready to use for two-factor authentication.",
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Add Security Key" }),
      ).toBeEnabled();
    }
  });

  test.each([true, false])(
    "passes newly minted recovery codes to their save-once UI: passkey %s",
    async (isPasskey: boolean) => {
      backupCodes = ["ABCDE-12345", "FGHIJ-67890"];
      renderPage(isPasskey);
      await register(isPasskey);
      expect(screen.getByTestId("enrolment-backup-codes")).toHaveTextContent(
        "ABCDE-12345,FGHIJ-67890",
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      if (isPasskey) {
        expect(
          screen.getByTestId("passkey-registration-success"),
        ).toHaveTextContent("Passkey added. Use it the next time you sign in.");
      } else {
        expect(
          screen.queryByTestId("passkey-registration-success"),
        ).not.toBeInTheDocument();
      }
    },
  );

  test.each([true, false])(
    "keeps cancellation recoverable without posting verification: passkey %s",
    async (isPasskey: boolean) => {
      jest
        .spyOn(navigator.credentials, "create")
        .mockRejectedValueOnce(new DOMException("Canceled", "NotAllowedError"));
      renderPage(isPasskey);
      await register(isPasskey);
      expect(
        screen.getByText(
          isPasskey
            ? "Passkey registration was canceled or timed out. Try again when you are ready."
            : "Security key registration was canceled or timed out. Try again when you are ready.",
        ),
      ).toBeInTheDocument();
      expect(posted).toHaveLength(1);
      expect(
        screen.getByRole("button", {
          name: isPasskey ? "Create Passkey" : "Register Security Key",
        }),
      ).toBeEnabled();
      expect(screen.getByTestId("passkey-name")).toHaveValue("My laptop");
      await click(
        screen.getByRole("button", {
          name: isPasskey ? "Create Passkey" : "Register Security Key",
        }),
      );
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(posted).toHaveLength(3);
      expect(posted[2]?.data).toMatchObject({ name: "My laptop" });
      if (!isPasskey) {
        expect(
          screen.queryByTestId("passkey-registration-success"),
        ).not.toBeInTheDocument();
      }
    },
  );

  test("explains duplicate authenticators", async () => {
    jest
      .spyOn(navigator.credentials, "create")
      .mockRejectedValueOnce(
        new DOMException("Duplicate", "InvalidStateError"),
      );
    renderPage();
    await register();
    expect(
      screen.getByText(/This authenticator is already registered/),
    ).toBeInTheDocument();
    expect(posted).toHaveLength(1);
  });

  test("shows verification rejection and leaves the modal available for retry", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(200, { options: registrationOptions }, {}),
      )
      .mockRejectedValueOnce(
        new Error("Registration expired. Please try again."),
      );
    renderPage();
    await register();
    expect(
      screen.getByText("Registration expired. Please try again."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Passkey" }),
    ).toBeEnabled();
    expect(screen.getByTestId("passkey-name")).toHaveValue("My laptop");
    expect(screen.getByTestId("enrolment-backup-codes")).toBeEmptyDOMElement();
  });

  test("rejects unsupported clients before requesting registration options", async () => {
    Object.defineProperty(window, "PublicKeyCredential", { value: undefined });
    renderPage();
    await register();
    expect(
      screen.getByText(/This browser does not support passkeys/),
    ).toBeInTheDocument();
    expect(posted).toHaveLength(0);
  });

  test("prevents duplicate registration while the authenticator is open", async () => {
    let finish: ((value: Credential | null) => void) | undefined;
    jest.spyOn(navigator.credentials, "create").mockImplementation(() => {
      return new Promise<Credential | null>(
        (resolve: (value: Credential | null) => void) => {
          finish = resolve;
        },
      );
    });
    renderPage();
    await click(screen.getByRole("button", { name: "Add Passkey" }));
    await enterName();
    const submit: HTMLElement = screen.getByRole("button", {
      name: "Create Passkey",
    });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => {
      expect(navigator.credentials.create).toHaveBeenCalledTimes(1);
    });
    expect(posted).toHaveLength(1);
    expect(screen.getByTestId("passkey-name")).toHaveValue("My laptop");
    expect(screen.getByTestId("passkey-name")).toHaveAttribute("readonly");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Follow the prompt from your browser or device.",
    );
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
    await act(async () => {
      finish!(WebAuthnTestUtil.credential(true));
    });
    expect(posted).toHaveLength(2);
  });

  test("does not open the browser after the dialog closes while options are loading", async () => {
    let finish: ((value: HTTPResponse<JSONObject>) => void) | undefined;
    jest.spyOn(API, "post").mockImplementationOnce(() => {
      return new Promise<HTTPResponse<JSONObject>>(
        (resolve: (value: HTTPResponse<JSONObject>) => void) => {
          finish = resolve;
        },
      );
    });
    jest.spyOn(navigator.credentials, "create");
    renderPage();
    await register();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Preparing registration",
    );
    await click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => {
      finish!(
        new HTTPResponse<JSONObject>(200, { options: registrationOptions }, {}),
      );
    });
    expect(navigator.credentials.create).not.toHaveBeenCalled();
    expect(API.post).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("aborts a closed prompt and ignores its late result while a new registration is open", async () => {
    let finishFirst: ((value: Credential | null) => void) | undefined;
    let finishSecond: ((value: Credential | null) => void) | undefined;
    let firstSignal: AbortSignal | undefined;
    jest
      .spyOn(navigator.credentials, "create")
      .mockImplementationOnce((options?: CredentialCreationOptions) => {
        firstSignal = options?.signal;
        return new Promise<Credential | null>(
          (resolve: (value: Credential | null) => void) => {
            finishFirst = resolve;
          },
        );
      })
      .mockImplementationOnce(() => {
        return new Promise<Credential | null>(
          (resolve: (value: Credential | null) => void) => {
            finishSecond = resolve;
          },
        );
      });
    renderPage();
    await register();
    await keyboard("{Escape}");
    expect(firstSignal?.aborted).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await register();
    expect(navigator.credentials.create).toHaveBeenCalledTimes(2);
    await act(async () => {
      finishFirst!(WebAuthnTestUtil.credential(true));
    });
    expect(posted).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("Follow the prompt");
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => {
      finishSecond!(WebAuthnTestUtil.credential(true));
    });
    expect(posted).toHaveLength(3);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("passkey-registration-success"),
    ).toHaveTextContent("Passkey added");
  });

  test.each([true, false])(
    "keeps verification visible until saving finishes and preserves returned recovery codes: passkey %s",
    async (isPasskey: boolean) => {
      let finish: ((value: HTTPResponse<JSONObject>) => void) | undefined;
      jest
        .spyOn(API, "post")
        .mockResolvedValueOnce(
          new HTTPResponse<JSONObject>(
            200,
            { options: registrationOptions },
            {},
          ),
        )
        .mockImplementationOnce(() => {
          return new Promise<HTTPResponse<JSONObject>>(
            (resolve: (value: HTTPResponse<JSONObject>) => void) => {
              finish = resolve;
            },
          );
        });
      renderPage(isPasskey);
      await register(isPasskey);
      expect(screen.getByRole("status")).toHaveTextContent("Saving your key");
      expect(
        screen.queryByRole("button", { name: "Cancel" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Close" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("passkey-registration-success"),
      ).not.toBeInTheDocument();
      await keyboard("{Escape}");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      await act(async () => {
        finish!(
          new HTTPResponse<JSONObject>(
            200,
            { verified: true, backupCodes: ["ABCDE-12345"] },
            {},
          ),
        );
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByTestId("enrolment-backup-codes")).toHaveTextContent(
        "ABCDE-12345",
      );
      if (isPasskey) {
        expect(
          screen.getByTestId("passkey-registration-success"),
        ).toHaveTextContent("Passkey added");
      } else {
        expect(
          screen.queryByTestId("passkey-registration-success"),
        ).not.toBeInTheDocument();
      }
    },
  );

  test.each([true, false])(
    "lets the owner rename a key without updating credential or verification fields: passkey %s",
    async (isPasskey: boolean) => {
      const storedKey: UserWebAuthn = new UserWebAuthn();
      storedKey._id = "44444444-4444-4444-8444-444444444444";
      storedKey.name = "Old laptop";
      storedKey.createdAt = new Date("2026-09-08T12:00:00.000Z");
      storedKey.isVerified = true;
      storedKey.isPasskey = isPasskey;
      mockPasskeyTable([storedKey]);
      jest.spyOn(ModelAPI, "getItem").mockResolvedValue(storedKey);
      jest
        .spyOn(ModelAPI, "createOrUpdate")
        .mockResolvedValue(
          new HTTPResponse<UserWebAuthn>(
            200,
            UserWebAuthn.toJSON(storedKey, UserWebAuthn),
            {},
          ),
        );
      renderPage(isPasskey);
      const rename: HTMLElement = await screen.findByRole("button", {
        name: "Rename",
      });
      expect(
        screen.getByRole("columnheader", { name: /Date added/ }),
      ).toBeVisible();
      expect(
        screen.queryByRole("columnheader", { name: /Is Verified/ }),
      ).not.toBeInTheDocument();
      await click(rename);
      const dialog: HTMLElement = await screen.findByRole("dialog", {
        name: isPasskey ? "Edit passkey" : "Edit security key",
      });
      const input: HTMLElement = await within(dialog).findByRole("textbox", {
        name: "Name",
      });
      await waitFor(() => {
        expect(input).toHaveValue("Old laptop");
      });
      expect(within(dialog).getAllByRole("textbox")).toHaveLength(1);
      fireEvent.change(input, { target: { value: "   " } });
      await click(within(dialog).getByRole("button", { name: "Save Changes" }));
      expect(
        await within(dialog).findByText("Enter a name to recognize this key."),
      ).toBeVisible();
      expect(ModelAPI.createOrUpdate).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { value: "Work laptop" } });
      await click(within(dialog).getByRole("button", { name: "Save Changes" }));
      await waitFor(() => {
        expect(ModelAPI.createOrUpdate).toHaveBeenCalledTimes(1);
      });
      expect(ModelAPI.createOrUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: UserWebAuthn,
          model: expect.objectContaining({
            _id: storedKey._id,
            name: "Work laptop",
          }),
        }),
      );
      const savedModel: UserWebAuthn = jest.mocked(ModelAPI.createOrUpdate).mock
        .calls[0]![0].model as UserWebAuthn;
      expect(savedModel.credentialId).toBeUndefined();
      expect(savedModel.publicKey).toBeUndefined();
      expect(savedModel.counter).toBeUndefined();
      expect(savedModel.transports).toBeUndefined();
      expect(savedModel.isVerified).toBeUndefined();
      expect(savedModel.isPasskey).toBeUndefined();
      expect(savedModel.createdAt).toBeUndefined();
      expect(API.post).not.toHaveBeenCalled();
    },
  );

  describe("authenticator app setup", () => {
    const createAuthenticator: (withUrl?: boolean) => UserTotpAuth = (
      withUrl: boolean = true,
    ): UserTotpAuth => {
      const authenticator: UserTotpAuth = new UserTotpAuth();
      authenticator._id = "55555555-5555-4555-8555-555555555555";
      authenticator.name = "My authenticator";
      if (withUrl) {
        authenticator.twoFactorOtpUrl =
          "otpauth://totp/OneUptime?secret=TESTONLY";
      }
      return authenticator;
    };

    const openSetup: () => Promise<void> = async (): Promise<void> => {
      renderPage(false);
      await act(async () => {
        await mockTotpTableProps!.onCreateSuccess!(
          createAuthenticator(),
          ModalType.Create,
        );
      });
    };

    test.each([true, false])(
      "renames an authenticator without reopening setup, then enrolls a new app: verified %s",
      async (isVerified: boolean) => {
        const storedAuthenticator: UserTotpAuth = createAuthenticator();
        storedAuthenticator.isVerified = isVerified;
        const newAuthenticator: UserTotpAuth = createAuthenticator();
        newAuthenticator._id = "66666666-6666-4666-8666-666666666666";
        newAuthenticator.name = "New phone";
        newAuthenticator.isVerified = false;
        backupCodes = ["ABCDE-12345"];
        mockRenderRealTotpTable = true;
        mockTablePermissions();
        jest.spyOn(ModelAPI, "getList").mockResolvedValue({
          data: [storedAuthenticator],
          count: 1,
          skip: 0,
          limit: 10,
        });
        jest.spyOn(ModelAPI, "getItem").mockResolvedValue(storedAuthenticator);
        jest
          .spyOn(ModelAPI, "createOrUpdate")
          .mockResolvedValueOnce(new HTTPResponse<UserTotpAuth>(200, {}, {}))
          .mockResolvedValueOnce(
            new HTTPResponse<UserTotpAuth>(
              200,
              UserTotpAuth.toJSON(newAuthenticator, UserTotpAuth),
              {},
            ),
          );
        renderPage(false);

        await click(await screen.findByRole("button", { name: "Rename" }));
        const renameDialog: HTMLElement = await screen.findByRole("dialog", {
          name: "Edit authenticator app",
        });
        const renameInput: HTMLElement = await within(renameDialog).findByRole(
          "textbox",
          { name: "App name" },
        );
        await waitFor(() => {
          expect(renameInput).toHaveValue("My authenticator");
        });
        fireEvent.change(renameInput, { target: { value: "Renamed phone" } });
        await click(
          within(renameDialog).getByRole("button", { name: "Save Changes" }),
        );
        await waitFor(() => {
          expect(ModelAPI.createOrUpdate).toHaveBeenCalledTimes(1);
          expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        });
        const renameRequest: Parameters<typeof ModelAPI.createOrUpdate>[0] =
          jest.mocked(ModelAPI.createOrUpdate).mock.calls[0]![0];
        expect(renameRequest.formType).toBe(FormType.Update);
        expect(renameRequest.model).toMatchObject({
          _id: storedAuthenticator._id,
          name: "Renamed phone",
        });
        const renamedAuthenticator: UserTotpAuth =
          renameRequest.model as UserTotpAuth;
        expect(renamedAuthenticator.isVerified).toBeUndefined();
        expect(renamedAuthenticator.twoFactorOtpUrl).toBeUndefined();
        expect(renamedAuthenticator.twoFactorSecret).toBeUndefined();
        expect(ModelAPI.getItem).toHaveBeenCalledTimes(1);
        expect(
          screen.queryByTestId("authenticator-qr"),
        ).not.toBeInTheDocument();
        expect(
          screen.getByTestId("enrolment-backup-codes"),
        ).toBeEmptyDOMElement();
        expect(API.post).not.toHaveBeenCalled();

        await click(
          screen.getByRole("button", { name: "Add authenticator app" }),
        );
        const createDialog: HTMLElement = await screen.findByRole("dialog", {
          name: "Add New authenticator app",
        });
        fireEvent.change(
          within(createDialog).getByRole("textbox", { name: "App name" }),
          { target: { value: "New phone" } },
        );
        await click(
          within(createDialog).getByRole("button", {
            name: "Add authenticator app",
          }),
        );
        const setupDialog: HTMLElement = await screen.findByRole("dialog", {
          name: "Set up New phone",
        });
        expect(
          within(setupDialog).getByTestId("authenticator-qr"),
        ).toHaveTextContent(newAuthenticator.twoFactorOtpUrl!);
        const createRequest: Parameters<typeof ModelAPI.createOrUpdate>[0] =
          jest.mocked(ModelAPI.createOrUpdate).mock.calls[1]![0];
        expect(createRequest.formType).toBe(FormType.Create);
        expect(createRequest.model).toMatchObject({ name: "New phone" });
        expect(createRequest.model._id).toBeUndefined();
        fireEvent.change(
          within(setupDialog).getByRole("textbox", {
            name: "Verification code",
          }),
          { target: { value: "012345" } },
        );
        await click(
          within(setupDialog).getByRole("button", {
            name: "Verify and finish",
          }),
        );
        expect(posted).toHaveLength(1);
        expect(posted[0]?.data).toEqual({
          id: newAuthenticator._id,
          code: "012345",
        });
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(screen.getByTestId("enrolment-backup-codes")).toHaveTextContent(
          "ABCDE-12345",
        );
      },
    );

    test("opens QR setup immediately after adding an app with a labeled code input", async () => {
      await openSetup();
      const dialog: HTMLElement = screen.getByRole("dialog", {
        name: "Set up My authenticator",
      });
      expect(within(dialog).getByTestId("authenticator-qr")).toHaveTextContent(
        "otpauth://totp/OneUptime?secret=TESTONLY",
      );
      const code: HTMLElement = within(dialog).getByRole("textbox", {
        name: "Verification code",
      });
      expect(code).toHaveAttribute("autocomplete", "one-time-code");
      expect(code).toHaveAttribute("inputmode", "numeric");
      expect(code).toHaveAccessibleDescription(
        /Codes refresh every 30 seconds/,
      );
      expect(API.post).not.toHaveBeenCalled();
    });

    test.each(["", "12345", "abcdef"])(
      "rejects an invalid verification code before posting: %s",
      async (code: string) => {
        await openSetup();
        fireEvent.change(
          screen.getByRole("textbox", { name: "Verification code" }),
          { target: { value: code } },
        );
        await click(screen.getByRole("button", { name: "Verify and finish" }));
        expect(
          screen.getByText(
            "Enter the 6-digit code from your authenticator app.",
          ),
        ).toBeVisible();
        expect(
          screen.getByRole("textbox", { name: "Verification code" }),
        ).toBeInvalid();
        expect(API.post).not.toHaveBeenCalled();
      },
    );

    test("verifies a code with leading zeroes and preserves newly generated backup codes before closing", async () => {
      backupCodes = ["ABCDE-12345", "FGHIJ-67890"];
      await openSetup();
      const refreshBefore: string | null = screen
        .getByTestId("totp-auth-table")
        .getAttribute("data-refresh");
      fireEvent.change(
        screen.getByRole("textbox", { name: "Verification code" }),
        { target: { value: "012345" } },
      );
      fireEvent.keyDown(
        screen.getByRole("textbox", { name: "Verification code" }),
        { key: "Enter" },
      );
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(posted).toHaveLength(1);
      expect(posted[0]?.url).toContain("/user-totp-auth/validate");
      expect(posted[0]?.data).toEqual({
        id: "55555555-5555-4555-8555-555555555555",
        code: "012345",
      });
      expect(screen.getByTestId("enrolment-backup-codes")).toHaveTextContent(
        "ABCDE-12345,FGHIJ-67890",
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        "Authenticator app added",
      );
      expect(
        screen.getByTestId("totp-auth-table").getAttribute("data-refresh"),
      ).not.toBe(refreshBefore);
    });

    test("fetches a missing QR code when creation only returns the authenticator id", async () => {
      const authenticator: UserTotpAuth = createAuthenticator();
      jest.spyOn(ModelAPI, "getItem").mockResolvedValue(authenticator);
      renderPage(false);
      await act(async () => {
        await mockTotpTableProps!.onCreateSuccess!(
          createAuthenticator(false),
          ModalType.Create,
        );
      });
      expect(ModelAPI.getItem).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: UserTotpAuth,
          id: authenticator.id,
          select: { _id: true, name: true, twoFactorOtpUrl: true },
        }),
      );
      expect(screen.getByTestId("authenticator-qr")).toHaveTextContent(
        authenticator.twoFactorOtpUrl!,
      );
      expect(
        screen.getByRole("button", { name: "Verify and finish" }),
      ).toBeEnabled();
    });

    test("cancels a pending QR load and ignores its late response", async () => {
      let finish: ((authenticator: UserTotpAuth) => void) | undefined;
      jest.spyOn(ModelAPI, "getItem").mockImplementation(() => {
        return new Promise<UserTotpAuth>(
          (resolve: (authenticator: UserTotpAuth) => void) => {
            finish = resolve;
          },
        );
      });
      renderPage(false);
      act(() => {
        void mockTotpTableProps!.onCreateSuccess!(
          createAuthenticator(false),
          ModalType.Create,
        );
      });
      expect(
        screen.getByRole("button", { name: "Verify and finish" }),
      ).toBeDisabled();
      await click(screen.getByRole("button", { name: "Cancel" }));
      expect(
        jest.mocked(ModelAPI.getItem).mock.calls[0]![0].requestOptions
          ?.apiRequestOptions?.signal?.aborted,
      ).toBe(true);
      await act(async () => {
        finish!(createAuthenticator());
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByTestId("authenticator-qr")).not.toBeInTheDocument();
      expect(API.post).not.toHaveBeenCalled();
    });

    test("keeps an expired code error visible and permits a new code", async () => {
      jest
        .spyOn(API, "post")
        .mockRejectedValueOnce(new Error("The verification code has expired."));
      await openSetup();
      fireEvent.change(
        screen.getByRole("textbox", { name: "Verification code" }),
        { target: { value: "123456" } },
      );
      await click(screen.getByRole("button", { name: "Verify and finish" }));
      expect(
        screen.getByText("The verification code has expired."),
      ).toBeVisible();
      expect(
        screen.getByRole("textbox", { name: "Verification code" }),
      ).toHaveValue("123456");
      expect(
        screen.getByRole("button", { name: "Verify and finish" }),
      ).toBeEnabled();
      expect(
        screen.getByTestId("enrolment-backup-codes"),
      ).toBeEmptyDOMElement();
      fireEvent.change(
        screen.getByRole("textbox", { name: "Verification code" }),
        { target: { value: "654321" } },
      );
      await click(screen.getByRole("button", { name: "Verify and finish" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(posted[0]?.data).toMatchObject({ code: "654321" });
    });

    test("prevents duplicate verification and waits for recovery codes before dismissal", async () => {
      let finish: ((response: HTTPResponse<JSONObject>) => void) | undefined;
      jest.spyOn(API, "post").mockImplementationOnce(() => {
        return new Promise<HTTPResponse<JSONObject>>(
          (resolve: (response: HTTPResponse<JSONObject>) => void) => {
            finish = resolve;
          },
        );
      });
      await openSetup();
      fireEvent.change(
        screen.getByRole("textbox", { name: "Verification code" }),
        { target: { value: "123456" } },
      );
      const submit: HTMLElement = screen.getByRole("button", {
        name: "Verify and finish",
      });
      act(() => {
        fireEvent.click(submit);
        fireEvent.click(submit);
      });
      expect(API.post).toHaveBeenCalledTimes(1);
      expect(submit).toBeDisabled();
      expect(
        screen.queryByRole("button", { name: "Cancel" }),
      ).not.toBeInTheDocument();
      await keyboard("{Escape}");
      expect(screen.getByRole("dialog")).toBeVisible();
      await act(async () => {
        finish!(
          new HTTPResponse<JSONObject>(
            200,
            { backupCodes: ["ABCDE-12345"] },
            {},
          ),
        );
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByTestId("enrolment-backup-codes")).toHaveTextContent(
        "ABCDE-12345",
      );
    });
  });
});
