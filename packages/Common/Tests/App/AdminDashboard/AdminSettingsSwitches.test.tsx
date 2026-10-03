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
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The admin dashboard's one-switch settings save the moment they are
 * flipped (the shared ModelSwitchCard, through AdminModelAPI), and the ones
 * that can lock people out or grant full access ask first:
 *
 *   - Settings > Authentication: "Let people sign up" (on while
 *     GlobalConfig.disableSignup is false), "Require SSO for Login" (asks,
 *     red, before it turns on) and "Let users create projects" (on while
 *     disableUserProjectCreation is false);
 *   - a user's Settings: "Master Admin", asking both ways - with a red
 *     button, and the words "This is your own account", when it would take
 *     the signed-in master admin's own access away;
 *   - a project's Support: "Let OneUptime support access this project",
 *     asking with the consent warning (which used to be a banner on every
 *     visit) before it turns on.
 *
 * The real pages, cards, switches and dialogs are rendered, with the real
 * locale files (English, and German where it says so). Only the admin API,
 * the page chrome and the side menus are stand-ins; the signed-in user is a
 * master admin, as everyone in the admin dashboard is.
 */

let billingEnabledForTest: boolean = true;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
});

const mockGetItem: MockFunction = getJestMockFunction();
const mockUpdateById: MockFunction = getJestMockFunction();

jest.mock("../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return mockUpdateById(...args);
      },
    },
  };
});

interface MockPageProps {
  title?: string | undefined;
  children?: ReactNode | undefined;
}

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: MockPageProps): ReactElement => {
      return <main data-testid="admin-page">{props.children}</main>;
    },
  };
});

jest.mock("../../../UI/Components/Page/ModelPage", () => {
  return {
    __esModule: true,
    default: (props: MockPageProps): ReactElement => {
      return <main data-testid="admin-model-page">{props.children}</main>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Users/View/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import AuthenticationSettings, {
  getRequireSsoConfirmation,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Authentication/Index";
import {
  PROJECT_CREATION_SWITCH_TEST_ID,
  REQUIRE_SSO_COPY,
  REQUIRE_SSO_SWITCH_TEST_ID,
  SIGN_UP_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Authentication/AuthenticationSwitchesCopy";
import UserSettings, {
  getMasterAdminConfirmation,
  MASTER_ADMIN_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Users/View/Settings";
import ProjectSupport, {
  PROJECT_SUPPORT_ACCESS_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/Support";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import ObjectID from "../../../Types/ObjectID";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { ModelSwitchConfirmation } from "../../../UI/Components/ModelSwitch/ModelSwitchRow";
import UserUtil from "../../../UI/Utils/User";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

const ENGLISH: Locale = readLocale("en");
const GERMAN: Locale = readLocale("de");

// The page's nested locale entry, e.g. pages.userView.masterAdminCardTitle.
function nested(locale: Locale, key: string): string {
  let node: unknown = locale;

  for (const part of key.split(".")) {
    node = (node as Record<string, unknown>)[part];
  }

  if (typeof node !== "string") {
    throw new Error(`No locale entry ${key}`);
  }

  return node;
}

function en(key: string): string {
  return nested(ENGLISH, key);
}

const ZERO_ID: string = ObjectID.getZeroObjectID().toString();
const SIGNED_IN_ADMIN_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_USER_ID: string = "bbbbbbbb-0000-4000-8000-000000000002";
const PROJECT_ID: string = "cccccccc-0000-4000-8000-000000000003";

// What the server holds, by table and id.
let stored: Record<string, Record<string, unknown>> = {};

function storedKey(tableName: string, id: string): string {
  return `${tableName}:${id}`;
}

interface ItemCall {
  modelType: { new (): { tableName?: string | undefined } };
  id: ObjectID;
  select: Record<string, unknown>;
}

interface UpdateCall {
  modelType: { new (): { tableName?: string | undefined } };
  id: ObjectID;
  data: Record<string, unknown>;
}

function itemCalls(): Array<ItemCall> {
  return mockGetItem.mock.calls.map((call: Array<unknown>): ItemCall => {
    return call[0] as ItemCall;
  });
}

function updateCalls(): Array<UpdateCall> {
  return mockUpdateById.mock.calls.map((call: Array<unknown>): UpdateCall => {
    return call[0] as UpdateCall;
  });
}

async function instanceFor(locale: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: ENGLISH },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

async function renderPage(
  page: ReactElement,
  options?: { path?: string; locale?: string },
): Promise<void> {
  if (options?.path) {
    window.history.pushState({}, "", options.path);
  }

  const instance: i18n = await instanceFor(options?.locale || "en");

  render(<I18nextProvider i18n={instance}>{page}</I18nextProvider>);

  await flush();
}

function switchFor(testId: string): HTMLElement {
  return screen.getByTestId(testId);
}

async function press(control: HTMLElement): Promise<void> {
  fireEvent.click(control);
  await flush();
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

async function confirmWith(buttonName: string): Promise<void> {
  fireEvent.click(within(dialog()).getByRole("button", { name: buttonName }));
  await flush();
}

beforeEach(() => {
  billingEnabledForTest = true;
  stored = {};

  mockGetItem.mockReset();
  mockGetItem.mockImplementation(async (options: unknown): Promise<unknown> => {
    const call: ItemCall = options as ItemCall;
    const item: Record<string, unknown> = new call.modelType() as Record<
      string,
      unknown
    >;

    item["_id"] = call.id.toString();

    Object.assign(
      item,
      stored[
        storedKey(new call.modelType().tableName || "", call.id.toString())
      ] || {},
    );

    return item;
  });

  mockUpdateById.mockReset();
  mockUpdateById.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      const call: UpdateCall = options as UpdateCall;
      const key: string = storedKey(
        new call.modelType().tableName || "",
        call.id.toString(),
      );

      stored[key] = { ...(stored[key] || {}), ...call.data };

      return {};
    },
  );

  // Everyone in the admin dashboard is a master admin.
  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
  getJestSpyOn(UserUtil, "getUserId").mockReturnValue(
    new ObjectID(SIGNED_IN_ADMIN_ID),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Settings > Authentication", () => {
  test("is three switches, in order: sign up, require SSO, project creation", async () => {
    await renderPage(<AuthenticationSettings />);

    const switches: Array<string> = screen
      .getAllByRole("switch")
      .map((control: HTMLElement): string => {
        return control.getAttribute("data-testid") || "";
      });

    expect(switches).toEqual([
      SIGN_UP_SWITCH_TEST_ID,
      REQUIRE_SSO_SWITCH_TEST_ID,
      PROJECT_CREATION_SWITCH_TEST_ID,
    ]);

    // Named by their own words, under their cards' titles.
    expect(
      screen.getByRole("switch", {
        name: en("pages.settings.authentication.signUpSwitchTitle"),
      }),
    ).toBe(switchFor(SIGN_UP_SWITCH_TEST_ID));
    expect(
      screen.getByRole("switch", { name: REQUIRE_SSO_COPY.switchTitle }),
    ).toBe(switchFor(REQUIRE_SSO_SWITCH_TEST_ID));
    expect(
      screen.getByRole("switch", {
        name: en("pages.settings.authentication.projectCreationSwitchTitle"),
      }),
    ).toBe(switchFor(PROJECT_CREATION_SWITCH_TEST_ID));

    for (const text of [
      en("pages.settings.authentication.signUpCardTitle"),
      en("pages.settings.authentication.signUpCardDescription"),
      REQUIRE_SSO_COPY.cardTitle,
      REQUIRE_SSO_COPY.cardDescription,
      REQUIRE_SSO_COPY.note,
      en("pages.settings.authentication.projectCreationCardTitle"),
      en("pages.settings.authentication.projectCreationCardDescription"),
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }

    // No Edit dialog anywhere: the switches are the cards.
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
  });

  test("each reads the one GlobalConfig row, through the admin API", async () => {
    await renderPage(<AuthenticationSettings />);

    const reads: Array<string> = itemCalls().map((call: ItemCall): string => {
      expect(call.modelType).toBe(GlobalConfig);
      expect(call.id.toString()).toBe(ZERO_ID);

      return Object.keys(call.select).join(",");
    });

    expect(reads.sort()).toEqual([
      "disableSignup",
      "disableUserProjectCreation",
      "requireSsoForLogin",
    ]);
  });

  test("a server that never set them lets people sign up and create projects, and does not require SSO", async () => {
    await renderPage(<AuthenticationSettings />);

    expect(switchFor(SIGN_UP_SWITCH_TEST_ID)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(switchFor(REQUIRE_SSO_SWITCH_TEST_ID)).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(switchFor(PROJECT_CREATION_SWITCH_TEST_ID)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByText(
        en("pages.settings.authentication.signUpSwitchOnDescription"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        en("pages.settings.authentication.projectCreationSwitchOnDescription"),
      ),
    ).toBeInTheDocument();
  });

  test("closing sign up saves disableSignup: true at once, with no dialog, and says invited people can still join", async () => {
    await renderPage(<AuthenticationSettings />);

    const control: HTMLElement = switchFor(SIGN_UP_SWITCH_TEST_ID);

    await press(control);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0]!.modelType).toBe(GlobalConfig);
    expect(updateCalls()[0]!.id.toString()).toBe(ZERO_ID);
    expect(updateCalls()[0]!.data).toEqual({ disableSignup: true });
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId(`${SIGN_UP_SWITCH_TEST_ID}-status`)).toHaveTextContent(
      "Saved",
    );

    const offSentence: string = en(
      "pages.settings.authentication.signUpSwitchOffDescription",
    );

    expect(screen.getByText(offSentence)).toBeInTheDocument();
    expect(offSentence).toContain("invited to a project");
  });

  test("a server with sign up closed shows the switch off, and opening it saves disableSignup: false", async () => {
    stored[storedKey("GlobalConfig", ZERO_ID)] = { disableSignup: true };

    await renderPage(<AuthenticationSettings />);

    const control: HTMLElement = switchFor(SIGN_UP_SWITCH_TEST_ID);

    expect(control).toHaveAttribute("aria-checked", "false");

    await press(control);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCalls()[0]!.data).toEqual({ disableSignup: false });
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  test("requiring SSO asks first, with a red button, and says who is locked out", async () => {
    await renderPage(<AuthenticationSettings />);

    const control: HTMLElement = switchFor(REQUIRE_SSO_SWITCH_TEST_ID);

    await press(control);

    expect(updateCalls()).toEqual([]);
    expect(dialog()).toHaveAccessibleName(REQUIRE_SSO_COPY.confirmTitle);
    expect(
      within(dialog()).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(REQUIRE_SSO_COPY.confirmDescription);
    expect(
      within(dialog()).getByRole("button", {
        name: REQUIRE_SSO_COPY.confirmButton,
      }),
    ).toHaveClass("bg-red-600");

    // While it asks, the switch shows where it is going, locked.
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(control).toHaveAttribute("aria-disabled", "true");

    await confirmWith(REQUIRE_SSO_COPY.confirmButton);

    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0]!.data).toEqual({ requireSsoForLogin: true });
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("cancelling leaves SSO not required, and saves nothing", async () => {
    await renderPage(<AuthenticationSettings />);

    const control: HTMLElement = switchFor(REQUIRE_SSO_SWITCH_TEST_ID);

    await press(control);
    await confirmWith("Cancel");

    expect(updateCalls()).toEqual([]);
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  test("no longer requiring SSO saves at once: it locks nobody out", async () => {
    stored[storedKey("GlobalConfig", ZERO_ID)] = { requireSsoForLogin: true };

    await renderPage(<AuthenticationSettings />);

    const control: HTMLElement = switchFor(REQUIRE_SSO_SWITCH_TEST_ID);

    expect(control).toHaveAttribute("aria-checked", "true");

    await press(control);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCalls()[0]!.data).toEqual({ requireSsoForLogin: false });
  });

  test("keeping project creation to master admins saves disableUserProjectCreation: true at once", async () => {
    await renderPage(<AuthenticationSettings />);

    const control: HTMLElement = switchFor(PROJECT_CREATION_SWITCH_TEST_ID);

    await press(control);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCalls()[0]!.data).toEqual({
      disableUserProjectCreation: true,
    });
    expect(
      screen.getByText(
        en("pages.settings.authentication.projectCreationSwitchOffDescription"),
      ),
    ).toBeInTheDocument();
  });

  test("a refused save moves the switch back and says why", async () => {
    mockUpdateById.mockImplementation(async (): Promise<unknown> => {
      throw new Error("This setting cannot be changed right now.");
    });

    await renderPage(<AuthenticationSettings />);

    const control: HTMLElement = switchFor(PROJECT_CREATION_SWITCH_TEST_ID);

    await press(control);

    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText("This setting cannot be changed right now."),
    ).toBeInTheDocument();
  });

  test("the confirmation is only for requiring SSO, and it is a danger", () => {
    expect(getRequireSsoConfirmation(false)).toBeUndefined();
    expect(getRequireSsoConfirmation(true)).toEqual({
      title: REQUIRE_SSO_COPY.confirmTitle,
      description: REQUIRE_SSO_COPY.confirmDescription,
      submitButtonText: REQUIRE_SSO_COPY.confirmButton,
      submitButtonType: ButtonStyleType.DANGER,
    });
  });
});

describe("Users > a user > Settings: Master Admin", () => {
  const userPath: (id: string) => string = (id: string): string => {
    return `/admin/users/${id}/settings`;
  };

  test("reads the user's isMasterAdmin through the admin API, under the card's title", async () => {
    await renderPage(<UserSettings />, { path: userPath(OTHER_USER_ID) });

    expect(itemCalls()).toHaveLength(1);
    expect(itemCalls()[0]!.modelType).toBe(User);
    expect(itemCalls()[0]!.id.toString()).toBe(OTHER_USER_ID);
    expect(itemCalls()[0]!.select).toEqual({ isMasterAdmin: true });

    expect(
      screen.getByText(en("pages.userView.masterAdminCardTitle")),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: en("pages.userView.masterAdminSwitchTitle"),
      }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(en("pages.userView.masterAdminSwitchOffDescription")),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Update Access/ })).toBeNull();
  });

  test("making someone a master admin asks first and says what access it grants", async () => {
    await renderPage(<UserSettings />, { path: userPath(OTHER_USER_ID) });

    const control: HTMLElement = switchFor(MASTER_ADMIN_SWITCH_TEST_ID);

    await press(control);

    expect(updateCalls()).toEqual([]);
    expect(dialog()).toHaveAccessibleName(
      en("pages.userView.masterAdminGrantConfirmTitle"),
    );

    const description: string = en(
      "pages.userView.masterAdminGrantConfirmDescription",
    );

    expect(
      within(dialog()).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(description);
    expect(description).toContain("full access to the entire platform");

    await confirmWith(en("pages.userView.masterAdminGrantConfirmButton"));

    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0]!.modelType).toBe(User);
    expect(updateCalls()[0]!.id.toString()).toBe(OTHER_USER_ID);
    expect(updateCalls()[0]!.data).toEqual({ isMasterAdmin: true });
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(en("pages.userView.masterAdminSwitchOnDescription")),
    ).toBeInTheDocument();
  });

  test("removing another user's master admin asks first, with a plain button", async () => {
    stored[storedKey("User", OTHER_USER_ID)] = { isMasterAdmin: true };

    await renderPage(<UserSettings />, { path: userPath(OTHER_USER_ID) });

    const control: HTMLElement = switchFor(MASTER_ADMIN_SWITCH_TEST_ID);

    expect(control).toHaveAttribute("aria-checked", "true");

    await press(control);

    expect(dialog()).toHaveAccessibleName(
      en("pages.userView.masterAdminRevokeConfirmTitle"),
    );

    const button: HTMLElement = within(dialog()).getByRole("button", {
      name: en("pages.userView.masterAdminRevokeConfirmButton"),
    });

    expect(button).not.toHaveClass("bg-red-600");

    await confirmWith(en("pages.userView.masterAdminRevokeConfirmButton"));

    expect(updateCalls()[0]!.data).toEqual({ isMasterAdmin: false });
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  test("removing your own master admin access says you lose this dashboard, with a red button", async () => {
    stored[storedKey("User", SIGNED_IN_ADMIN_ID)] = { isMasterAdmin: true };

    await renderPage(<UserSettings />, { path: userPath(SIGNED_IN_ADMIN_ID) });

    await press(switchFor(MASTER_ADMIN_SWITCH_TEST_ID));

    expect(dialog()).toHaveAccessibleName(
      en("pages.userView.masterAdminRevokeOwnConfirmTitle"),
    );

    const description: string = en(
      "pages.userView.masterAdminRevokeOwnConfirmDescription",
    );

    expect(
      within(dialog()).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(description);
    expect(description).toContain("This is your own account.");
    expect(
      within(dialog()).getByRole("button", {
        name: en("pages.userView.masterAdminRevokeOwnConfirmButton"),
      }),
    ).toHaveClass("bg-red-600");
  });

  test("cancelling leaves the access as it was, and saves nothing", async () => {
    stored[storedKey("User", SIGNED_IN_ADMIN_ID)] = { isMasterAdmin: true };

    await renderPage(<UserSettings />, { path: userPath(SIGNED_IN_ADMIN_ID) });

    const control: HTMLElement = switchFor(MASTER_ADMIN_SWITCH_TEST_ID);

    await press(control);
    await confirmWith("Cancel");

    expect(updateCalls()).toEqual([]);
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  test("every way of flipping it asks, and only removing your own is a danger", () => {
    const t: (key: string) => string = en;

    const grantOther: ModelSwitchConfirmation = getMasterAdminConfirmation({
      isTurningOn: true,
      isOwnAccount: false,
      t: t,
    });
    const grantOwn: ModelSwitchConfirmation = getMasterAdminConfirmation({
      isTurningOn: true,
      isOwnAccount: true,
      t: t,
    });
    const revokeOther: ModelSwitchConfirmation = getMasterAdminConfirmation({
      isTurningOn: false,
      isOwnAccount: false,
      t: t,
    });
    const revokeOwn: ModelSwitchConfirmation = getMasterAdminConfirmation({
      isTurningOn: false,
      isOwnAccount: true,
      t: t,
    });

    expect(grantOther).toEqual(grantOwn);
    expect(grantOther.submitButtonType).toBeUndefined();
    expect(revokeOther.submitButtonType).toBeUndefined();
    expect(revokeOwn.submitButtonType).toBe(ButtonStyleType.DANGER);
    expect(new Set([grantOther.title, revokeOther.title, revokeOwn.title]).size).toBe(3);
  });
});

describe("Projects > a project > Support", () => {
  const supportPath: string = `/admin/projects/${PROJECT_ID}/support`;

  test("is the switch, with no warning banner above it", async () => {
    await renderPage(<ProjectSupport />, { path: supportPath });

    expect(itemCalls()).toHaveLength(1);
    expect(itemCalls()[0]!.modelType).toBe(Project);
    expect(itemCalls()[0]!.id.toString()).toBe(PROJECT_ID);
    expect(itemCalls()[0]!.select).toEqual({
      letCustomerSupportAccessProject: true,
    });

    expect(
      screen.getByRole("switch", {
        name: en("pages.projectSupport.fieldLabel"),
      }),
    ).toBe(switchFor(PROJECT_SUPPORT_ACCESS_SWITCH_TEST_ID));
    expect(en("pages.projectSupport.fieldLabel")).toBe(
      "Let OneUptime support access this project",
    );
    expect(
      screen.getByText(en("pages.projectSupport.fieldDescription")),
    ).toBeInTheDocument();

    // The consent warning waits for the moment it matters.
    expect(
      screen.queryByText(en("pages.projectSupport.consentWarning")),
    ).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("letting support in asks with the consent warning, then saves through the admin API", async () => {
    await renderPage(<ProjectSupport />, { path: supportPath });

    const control: HTMLElement = switchFor(PROJECT_SUPPORT_ACCESS_SWITCH_TEST_ID);

    expect(control).toHaveAttribute("aria-checked", "false");

    await press(control);

    expect(updateCalls()).toEqual([]);
    expect(dialog()).toHaveAccessibleName(
      en("pages.projectSupport.allowConfirmTitle"),
    );
    expect(
      within(dialog()).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(en("pages.projectSupport.consentWarning"));

    await confirmWith(en("pages.projectSupport.allowConfirmButton"));

    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0]!.modelType).toBe(Project);
    expect(updateCalls()[0]!.id.toString()).toBe(PROJECT_ID);
    expect(updateCalls()[0]!.data).toEqual({
      letCustomerSupportAccessProject: true,
    });
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  test("taking support's access away saves at once", async () => {
    stored[storedKey("Project", PROJECT_ID)] = {
      letCustomerSupportAccessProject: true,
    };

    await renderPage(<ProjectSupport />, { path: supportPath });

    await press(switchFor(PROJECT_SUPPORT_ACCESS_SWITCH_TEST_ID));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCalls()[0]!.data).toEqual({
      letCustomerSupportAccessProject: false,
    });
  });

  test("on a server that does not bill, it says there is no support team and offers no switch", async () => {
    billingEnabledForTest = false;

    await renderPage(<ProjectSupport />, { path: supportPath });

    expect(
      screen.getByText(en("pages.projectSupport.billingDisabled")),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(mockGetItem).not.toHaveBeenCalled();
  });
});

describe("in German", () => {
  function de(key: string): string {
    return nested(GERMAN, key);
  }

  test("the authentication switches, the SSO dialog and the save status read as German", async () => {
    await renderPage(<AuthenticationSettings />, { locale: "de" });

    expect(
      screen.getByRole("switch", {
        name: de("pages.settings.authentication.signUpSwitchTitle"),
      }),
    ).toBe(switchFor(SIGN_UP_SWITCH_TEST_ID));
    expect(
      screen.getByRole("switch", {
        name: GERMAN[REQUIRE_SSO_COPY.switchTitle] as string,
      }),
    ).toBe(switchFor(REQUIRE_SSO_SWITCH_TEST_ID));
    expect(
      screen.getByText(de("pages.settings.authentication.signUpCardTitle")),
    ).toBeInTheDocument();

    await press(switchFor(REQUIRE_SSO_SWITCH_TEST_ID));

    expect(dialog()).toHaveAccessibleName(
      GERMAN[REQUIRE_SSO_COPY.confirmTitle] as string,
    );
    expect(
      within(dialog()).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(GERMAN[REQUIRE_SSO_COPY.confirmDescription] as string);

    await confirmWith(GERMAN[REQUIRE_SSO_COPY.confirmButton] as string);

    expect(
      screen.getByTestId(`${REQUIRE_SSO_SWITCH_TEST_ID}-status`),
    ).toHaveTextContent("Gespeichert");
  });

  test("the master admin switch and its dialog read as German", async () => {
    await renderPage(<UserSettings />, {
      path: `/admin/users/${OTHER_USER_ID}/settings`,
      locale: "de",
    });

    expect(
      screen.getByRole("switch", {
        name: de("pages.userView.masterAdminSwitchTitle"),
      }),
    ).toBeInTheDocument();

    await press(switchFor(MASTER_ADMIN_SWITCH_TEST_ID));

    expect(dialog()).toHaveAccessibleName(
      de("pages.userView.masterAdminGrantConfirmTitle"),
    );
    expect(
      within(dialog()).getByRole("button", {
        name: de("pages.userView.masterAdminGrantConfirmButton"),
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog()).getByRole("button", { name: "Abbrechen" }),
    ).toBeInTheDocument();
  });
});
