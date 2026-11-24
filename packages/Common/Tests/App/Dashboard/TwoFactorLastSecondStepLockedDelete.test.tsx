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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import TwoFactorSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/TwoFactorAuth";
import PasskeySettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Passkeys";
import { LAST_SECOND_STEP_DELETE_REASON } from "../../../../App/FeatureSet/Dashboard/src/Components/TwoFactorAuth/TwoFactorAuthSetupState";
import UserTotpAuth from "../../../Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "../../../Models/DatabaseModels/UserWebAuthn";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TwoFactorAuthStatus from "../../../Types/TwoFactorAuthStatus";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import PermissionUtil from "../../../UI/Utils/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import UiAnalytics from "../../../UI/Utils/Analytics";
import {
  isReauthenticationStatusRequest,
  reauthenticationStatusAnswer,
} from "../../Helpers/ReauthenticationStatus";

/*
 * THE LAST SECOND STEP SAYS WHY IT STAYS, BEFORE ANYTHING IS REMOVED (#6652).
 *
 * Removing the last authenticator app, security key or passkey while
 * two-factor authentication is on is refused by the server (#9666, held over
 * HTTP by Tests/Server/API/TwoFactorLastSecondStepOverHttp.test.ts). The
 * Dashboard says so first: that row's Delete is locked in its ⋯ menu, and
 * says what to do instead - add another, or turn two-factor authentication
 * off - on hover, on focus, and on a press, the one way a phone can ask. No
 * confirmation opens and nothing is sent.
 *
 * The real pages, lists and row menus are drawn; the server's answers are
 * stood in at API and ModelAPI.
 */

const USER_ID: ObjectID = new ObjectID("47474747-4747-4747-8747-474747474747");
const APP_ID: string = "48484848-4848-4848-8848-484848484848";
const SECOND_APP_ID: string = "49494949-4949-4949-8949-494949494949";
const PASSKEY_ID: string = "4a4a4a4a-4a4a-44a4-84a4-4a4a4a4a4a4a";

// Where the person stands, as GET /user/two-factor-auth-status answers.
let setup: JSONObject;
let apps: Array<UserTotpAuth>;
let keys: Array<UserWebAuthn>;
let deleteItem: ReturnType<typeof jest.spyOn>;

const app: (id: string, name: string) => UserTotpAuth = (
  id: string,
  name: string,
): UserTotpAuth => {
  const row: UserTotpAuth = new UserTotpAuth();
  row._id = id;
  row.name = name;
  row.isVerified = true;
  return row;
};

const passkey: () => UserWebAuthn = (): UserWebAuthn => {
  const row: UserWebAuthn = new UserWebAuthn();
  row._id = PASSKEY_ID;
  row.name = "Laptop";
  row.isVerified = true;
  row.isPasskey = true;
  return row;
};

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
    key: "last-second-step-test",
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

// The tooltips on screen that say why the last second step stays.
const shownReasons: () => number = (): number => {
  return Array.from(document.querySelectorAll("[data-tippy-root]")).filter(
    (tooltip: Element): boolean => {
      return Boolean(
        tooltip.textContent?.includes(LAST_SECOND_STEP_DELETE_REASON),
      );
    },
  ).length;
};

// The ⋯ menu of the row that names `name`, opened.
const openMenuOfRow: (name: string) => Promise<HTMLElement> = async (
  name: string,
): Promise<HTMLElement> => {
  const rowActions: HTMLElement = await waitFor(() => {
    const found: HTMLElement | undefined = screen
      .getAllByTestId("row-actions")
      .find((actions: HTMLElement): boolean => {
        return Boolean(actions.closest("tr")?.textContent?.includes(name));
      });

    expect(found).toBeDefined();
    return found!;
  });

  await act(async () => {
    fireEvent.click(within(rowActions).getByTestId("row-actions-more-button"));
  });

  return screen.getByRole("menu");
};

beforeEach(() => {
  setup = {
    status: TwoFactorAuthStatus.EnabledConfigured,
    verifiedMethodCount: 1,
  };
  apps = [];
  keys = [];
  window.localStorage.clear();

  // Signed in: their own second steps are theirs to list and remove.
  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    globalPermissions: [
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
    ],
    projectIds: [],
  });

  jest.spyOn(UserUtil, "getUserId").mockReturnValue(USER_ID);
  jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
  jest
    .spyOn(API, "getFriendlyMessage")
    .mockImplementation((error: unknown): string => {
      return (error as Error).message;
    });

  jest
    .spyOn(API, "get")
    .mockImplementation(
      async (
        options: Parameters<typeof API.get>[0],
      ): Promise<HTTPResponse<JSONObject>> => {
        const url: string = options.url?.toString() || "";

        if (isReauthenticationStatusRequest(url)) {
          return new HTTPResponse<JSONObject>(
            200,
            reauthenticationStatusAnswer(true),
            {},
          );
        }

        if (url.endsWith("/user/two-factor-auth-status")) {
          return new HTTPResponse<JSONObject>(200, setup, {});
        }

        // The backup codes card: how many are left.
        return new HTTPResponse<JSONObject>(200, { count: 10 }, {});
      },
    );

  jest
    .spyOn(API, "post")
    .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}) as never);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
    modelType: unknown;
  }): Promise<ListResult<UserTotpAuth | UserWebAuthn>> => {
    const rows: Array<UserTotpAuth | UserWebAuthn> =
      data.modelType === UserWebAuthn ? keys : apps;

    return {
      data: rows,
      count: rows.length,
      skip: 0,
      limit: 50,
    } as ListResult<UserTotpAuth | UserWebAuthn>;
  }) as never);

  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation((async (): Promise<number> => {
      return 0;
    }) as never);

  deleteItem = jest
    .spyOn(ModelAPI, "deleteItem")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the last second step's Delete, while two-factor authentication is on", () => {
  test("the last authenticator app's Delete is locked, and a press says why, removing nothing", async () => {
    apps = [app(APP_ID, "Phone")];
    renderPage();

    const menu: HTMLElement = await openMenuOfRow("Phone");
    const deleteAction: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Delete",
    });

    // Locked, but reachable, and described by its reason for a screen reader.
    await waitFor(() => {
      expect(deleteAction).toHaveAttribute("aria-disabled", "true");
    });
    expect(deleteAction).toHaveAccessibleDescription(
      LAST_SECOND_STEP_DELETE_REASON,
    );

    // Pressed - a phone's only way to ask - it says what to do instead.
    await act(async () => {
      fireEvent.click(deleteAction);
    });

    await waitFor(() => {
      expect(shownReasons()).toBe(1);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteItem).not.toHaveBeenCalled();
  });

  test("says it in the words the server's rule gives: add another, or turn two-factor authentication off", () => {
    expect(LAST_SECOND_STEP_DELETE_REASON).toBe(
      "Two-factor authentication needs at least one second step. Add another, or turn off two-factor authentication, before you remove this one.",
    );
  });

  test("with another second step set up, the same Delete asks to confirm, as any delete does", async () => {
    setup = {
      status: TwoFactorAuthStatus.EnabledConfigured,
      verifiedMethodCount: 2,
    };
    apps = [app(APP_ID, "Phone"), app(SECOND_APP_ID, "Tablet")];
    renderPage();

    const menu: HTMLElement = await openMenuOfRow("Phone");
    const deleteAction: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Delete",
    });

    await waitFor(() => {
      expect(deleteAction).not.toHaveAttribute("aria-disabled", "true");
    });

    await act(async () => {
      fireEvent.click(deleteAction);
    });

    const dialog: HTMLElement = await screen.findByRole("dialog");

    expect(dialog).toHaveTextContent("Phone");
    expect(dialog).not.toHaveTextContent(LAST_SECOND_STEP_DELETE_REASON);
  });

  test("the Passkeys page locks the last passkey's Delete the same way", async () => {
    keys = [passkey()];
    renderPage(true);

    const menu: HTMLElement = await openMenuOfRow("Laptop");
    const deleteAction: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Delete",
    });

    await waitFor(() => {
      expect(deleteAction).toHaveAttribute("aria-disabled", "true");
    });
    expect(deleteAction).toHaveAccessibleDescription(
      LAST_SECOND_STEP_DELETE_REASON,
    );

    await act(async () => {
      fireEvent.click(deleteAction);
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteItem).not.toHaveBeenCalled();
  });
});
