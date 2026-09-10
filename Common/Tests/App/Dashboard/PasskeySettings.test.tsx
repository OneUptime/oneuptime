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
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import UiAnalytics from "../../../UI/Utils/Analytics";
import WebAuthnTestUtil, {
  registrationOptions,
} from "../../Utils/WebAuthnTestUtil";
import PasskeySettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/TwoFactorAuth";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import UserWebAuthn from "../../../Models/DatabaseModels/UserWebAuthn";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import Permission from "../../../Types/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import Card from "../../../UI/Components/Card/Card";

let mockRenderRealPasskeyTable: boolean = false;

/*
 * Keep the real page, enrollment modal, input and browser/API boundary. Only
 * registration cases replace unrelated model lists; header and management
 * cases use the real passkey table to verify shared UI and name-only updates.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<UserWebAuthn>): React.ReactElement => {
      if (mockRenderRealPasskeyTable && props.id === "webauthn-table") {
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
    default: (props: { children: React.ReactNode }): React.ReactElement => {
      return <div>{props.children}</div>;
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <p>Two factor authentication is disabled</p>;
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

type PostedRequest = {
  url: string;
  data: Parameters<typeof API.post>[0]["data"];
};
let posted: Array<PostedRequest> = [];
let backupCodes: Array<string> = [];

const renderPage: () => void = (): void => {
  render(
    <MemoryRouter>
      <PasskeySettings
        pageRoute={new Route("/user-profile/two-factor-auth")}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
};

const mockPasskeyTable: (items: Array<UserWebAuthn>) => void = (
  items: Array<UserWebAuthn>,
): void => {
  mockRenderRealPasskeyTable = true;
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.CurrentUser]);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue({
    projectIds: [],
    globalPermissions: [Permission.CurrentUser],
    _type: "UserGlobalAccessPermission",
  });
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(null);
  jest
    .spyOn(ModelAPI, "getList")
    .mockResolvedValue({
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

  test("makes passkeys available even when two factor authentication is disabled", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Add Passkey" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Add Security Key" }),
    ).toBeEnabled();
    expect(
      screen.getByText("Two factor authentication is disabled"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading")[0]).toHaveTextContent("Passkeys");
  });

  test("shows a simple empty state and explains password fallback and second-step security keys", () => {
    renderPage();
    expect(
      screen.getByText("No passkeys or security keys found."),
    ).toBeVisible();
    expect(screen.getByText(/keep your password available/)).toBeVisible();
    expect(screen.getByText(/save your backup codes below/)).toBeVisible();
    expect(
      screen.getByText(/as a second step after your password/),
    ).toBeVisible();
  });

  test.each([false, true])(
    "uses the shared table header and standard add action when a saved passkey is present: %s",
    async (hasPasskey: boolean) => {
      const storedKey: UserWebAuthn = new UserWebAuthn();
      storedKey._id = "44444444-4444-4444-8444-444444444444";
      storedKey.name = "My laptop";
      storedKey.createdAt = new Date("2026-09-08T12:00:00.000Z");
      storedKey.isVerified = true;
      mockPasskeyTable(hasPasskey ? [storedKey] : []);
      renderPage();

      expect(
        await screen.findByText(
          hasPasskey ? "My laptop" : "No passkeys or security keys found.",
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
        "Use your fingerprint, face, screen lock, or security key to sign in.",
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

      await click(within(card).getByRole("button", { name: "More options" }));
      const listCallsBeforeRefresh: number = jest.mocked(ModelAPI.getList).mock
        .calls.length;
      await click(within(card).getByRole("menuitem", { name: "Refresh" }));
      await waitFor(() => {
        expect(ModelAPI.getList).toHaveBeenCalledTimes(
          listCallsBeforeRefresh + 1,
        );
      });

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
      .getByTestId("webauthn-table")
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
      screen.getByTestId("webauthn-table").getAttribute("data-refresh"),
    ).not.toBe(refreshBefore);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Passkey added. Use it the next time you sign in.",
    );
  });

  test("preserves separate legacy security key MFA registration", async () => {
    renderPage();
    await register(false);
    expect(posted[0]?.data).toEqual({ isPasskey: false });
    expect(posted[1]?.data).toMatchObject({ name: "My laptop" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Security key added. It is ready to use for two factor authentication.",
    );
  });

  test("passes newly minted recovery codes to their save-once UI", async () => {
    backupCodes = ["ABCDE-12345", "FGHIJ-67890"];
    renderPage();
    await register();
    expect(screen.getByTestId("enrolment-backup-codes")).toHaveTextContent(
      "ABCDE-12345,FGHIJ-67890",
    );
  });

  test("keeps cancellation recoverable without posting verification", async () => {
    jest
      .spyOn(navigator.credentials, "create")
      .mockRejectedValueOnce(new DOMException("Canceled", "NotAllowedError"));
    renderPage();
    await register();
    expect(
      screen.getByText(
        "Passkey registration was canceled or timed out. Try again when you are ready.",
      ),
    ).toBeInTheDocument();
    expect(posted).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Create Passkey" }),
    ).toBeEnabled();
    expect(screen.getByTestId("passkey-name")).toHaveValue("My laptop");
    await click(screen.getByRole("button", { name: "Create Passkey" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(posted).toHaveLength(3);
    expect(posted[2]?.data).toMatchObject({ name: "My laptop" });
  });

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
    expect(screen.getByRole("alert")).toHaveTextContent("Passkey added");
  });

  test("keeps verification visible until saving finishes and preserves returned recovery codes", async () => {
    let finish: ((value: HTTPResponse<JSONObject>) => void) | undefined;
    jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(200, { options: registrationOptions }, {}),
      )
      .mockImplementationOnce(() => {
        return new Promise<HTTPResponse<JSONObject>>(
          (resolve: (value: HTTPResponse<JSONObject>) => void) => {
            finish = resolve;
          },
        );
      });
    renderPage();
    await register();
    expect(screen.getByRole("status")).toHaveTextContent("Saving your key");
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close" }),
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
    expect(screen.getByRole("alert")).toHaveTextContent("Passkey added");
  });

  test("lets the owner rename a key without updating credential or verification fields", async () => {
    const storedKey: UserWebAuthn = new UserWebAuthn();
    storedKey._id = "44444444-4444-4444-8444-444444444444";
    storedKey.name = "Old laptop";
    storedKey.createdAt = new Date("2026-09-08T12:00:00.000Z");
    storedKey.isVerified = true;
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
    renderPage();
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
      name: "Edit Passkey or Security Key",
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
    expect(savedModel.createdAt).toBeUndefined();
    expect(API.post).not.toHaveBeenCalled();
  });
});
