import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Admin Dashboard > Settings > Custom Channels: each row's ⋯ menu turns its
 * channel off, or on again - the shared row switch (ModelTable's rowSwitch)
 * on the channel's On switch, which the Edit form holds too.
 *
 * The real page and its real table, over an in-memory set of channels behind
 * the Admin Dashboard's model API, as a master admin sees them, read in the
 * Admin Dashboard's own locale files:
 *
 *   - a channel that is on offers Disable and one that is off offers Enable,
 *     never both, first in the menu; the row's button stays Send test;
 *   - each writes that channel's On switch alone, at once, through the Admin
 *     Dashboard's model API (no project), then the list is read again: the
 *     row's On column and its menu say what it now is;
 *   - a change the server refuses is the row's error dialog, in its words;
 *   - it follows the permission of the form's On switch: offered where the
 *     Edit form is, not while the page is read-only (the license lapsed, or
 *     leaves custom channels out), and gated on the On column's own update
 *     permission, locked with the reason;
 *   - in German and Persian the menu words each state as the rest of the
 *     product does.
 */

let mockLicenseMode: string = "editable";

jest.mock(
  "../../../Dashboard/Identity/License/UseEnterpriseLicenseMode",
  () => {
    return {
      __esModule: true,
      default: (): string => {
        return mockLicenseMode;
      },
    };
  },
);

jest.mock("Common/UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

// The Admin Dashboard's reader: a master admin, with no project permissions.
jest.mock("Common/UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("Common/UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { children: ReactNode }): ReactElement => {
      return <div data-testid="page">{props.children}</div>;
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

import CustomChannelsSettingsPage from "../../../AdminDashboard/CustomChannels/CustomChannelsSettingsPage";
import { EnterpriseLicenseMode } from "../../../Dashboard/Identity/License/EnterpriseLicenseMode";
import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";

const FEATURE_SETS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "App",
  "FeatureSet",
);

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

type Locale = Record<string, unknown>;

// A locale of the Admin Dashboard, or of the Dashboard.
function readLocale(
  locale: string,
  frontend: "AdminDashboard" | "Dashboard" = "AdminDashboard",
): Locale {
  return JSON.parse(
    fs.readFileSync(
      path.join(FEATURE_SETS_DIR, frontend, "src", "Locales", `${locale}.json`),
      "utf8",
    ),
  ) as Locale;
}

// An instance like the Admin Dashboard's: one language, English as the fallback.
async function instanceFor(locale: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

interface ChannelRow {
  _id: string;
  name: string;
  webhookUrl: string;
  secret: string;
  isEnabled: boolean;
  pageEveryoneByDefault: boolean;
}

// The company's own app, on and paging everyone.
const CORPO_APP: ChannelRow = {
  _id: "c4a30000-0000-4000-8000-000000000001",
  name: "CorpoApp",
  webhookUrl: "https://push.example.com/oneuptime",
  secret: "a".repeat(64),
  isEnabled: true,
  pageEveryoneByDefault: true,
};

// A channel turned off, which only some people added to their rules.
const NIGHT_PAGER: ChannelRow = {
  _id: "c4a30000-0000-4000-8000-000000000002",
  name: "Night Pager",
  webhookUrl: "https://pager.example.com/hook",
  secret: "b".repeat(64),
  isEnabled: false,
  pageEveryoneByDefault: false,
};

// The server's words when the license lapsed after the page was read.
const LICENSE_REQUIRED_MESSAGE: string =
  "This OneUptime Enterprise feature needs a valid Enterprise license that includes it. Enterprise configuration you already have is kept and can still be viewed or deleted, but it cannot be created or changed until a master admin adds or renews the license from the edition label in the Admin Dashboard header.";

interface UpdateRequest {
  modelType: unknown;
  id: string;
  data: Record<string, unknown>;
}

let rows: Array<ChannelRow> = [];
let listRequests: Array<Record<string, unknown>> = [];
let updateRequests: Array<UpdateRequest> = [];
let projectUpdateCount: number = 0;
let refusedUpdates: Record<string, string> = {};

async function renderPage(
  options: { mode?: EnterpriseLicenseMode; locale?: string } = {},
): Promise<void> {
  mockLicenseMode = options.mode || EnterpriseLicenseMode.Editable;

  const instance: i18n = await instanceFor(options.locale || "en");

  await act(async () => {
    render(
      <I18nextProvider i18n={instance}>
        <MemoryRouter>
          <CustomChannelsSettingsPage />
        </MemoryRouter>
      </I18nextProvider>,
    );
  });

  await screen.findAllByText(NIGHT_PAGER.name);
}

// The table row of a channel, by its name.
function rowOf(name: string): HTMLElement {
  const cell: HTMLElement | undefined = screen
    .getAllByText(name)
    .find((element: HTMLElement): boolean => {
      return Boolean(element.closest("tr"));
    });

  if (!cell) {
    throw new Error(`No table row named ${name}`);
  }

  return cell.closest("tr") as HTMLElement;
}

// Opens a row's ⋯ menu and returns it.
function openMenu(name: string): HTMLElement {
  fireEvent.click(within(rowOf(name)).getByTestId("row-actions-more-button"));

  return screen.getByRole("menu");
}

function closeMenu(name: string): void {
  fireEvent.click(within(rowOf(name)).getByTestId("row-actions-more-button"));
}

function menuLabels(menu: HTMLElement): Array<string> {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

// Every action a row offers: its button, and what its ⋯ menu holds.
function rowActionNames(name: string): Array<string> {
  const row: HTMLElement = rowOf(name);
  const names: Array<string> = within(within(row).getByTestId("row-actions"))
    .queryAllByRole("button")
    .filter((button: HTMLElement): boolean => {
      return button.getAttribute("data-testid") !== "row-actions-more-button";
    })
    .map((button: HTMLElement): string => {
      return (button.textContent || "").trim();
    });

  if (within(row).queryByTestId("row-actions-more-button")) {
    names.push(...menuLabels(openMenu(name)));
    closeMenu(name);
  }

  return names;
}

// The row's ticks: its On column, then its Pages Everyone column.
function ticksIn(name: string): number {
  return within(rowOf(name)).queryAllByTestId("table-boolean-yes").length;
}

beforeEach(() => {
  rows = [{ ...CORPO_APP }, { ...NIGHT_PAGER }];
  listRequests = [];
  updateRequests = [];
  projectUpdateCount = 0;
  refusedUpdates = {};

  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    "/admin/settings/custom-channels",
  );
  Navigation.setLocation({
    pathname: window.location.pathname,
    search: "",
    hash: "",
    state: null,
    key: "test",
  });
  TableFilterUrlState.resetClaimedKeys();
  PermissionGate.clearPermissionPropsCache();

  jest
    .spyOn(AdminModelAPI, "getList")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const request: {
        modelType: unknown;
        select: Record<string, unknown>;
        skip: number;
        limit: number;
      } = data as {
        modelType: unknown;
        select: Record<string, unknown>;
        skip: number;
        limit: number;
      };

      if (request.modelType !== CustomNotificationChannel) {
        throw new Error("Unexpected list request");
      }

      listRequests.push(request.select);

      // The API answers only the columns asked for.
      const channels: Array<CustomNotificationChannel> = rows.map(
        (row: ChannelRow): CustomNotificationChannel => {
          const channel: CustomNotificationChannel =
            new CustomNotificationChannel();

          for (const [key, value] of Object.entries(row)) {
            if (key === "_id" || request.select[key]) {
              Object.assign(channel, { [key]: value });
            }
          }

          return channel;
        },
      );

      return {
        data: channels,
        count: channels.length,
        skip: request.skip,
        limit: request.limit,
      } as never;
    });

  jest
    .spyOn(AdminModelAPI, "updateById")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const request: {
        modelType: unknown;
        id: unknown;
        data: Record<string, unknown>;
      } = data as {
        modelType: unknown;
        id: unknown;
        data: Record<string, unknown>;
      };
      const id: string = String(request.id);

      updateRequests.push({
        modelType: request.modelType,
        id: id,
        data: request.data,
      });

      if (refusedUpdates[id]) {
        throw new Error(refusedUpdates[id]);
      }

      rows = rows.map((row: ChannelRow): ChannelRow => {
        return row._id === id ? { ...row, ...request.data } : row;
      });

      return {} as never;
    });

  /*
   * The Dashboard's model API names the open project: a write of an
   * installation's channel through it would be refused.
   */
  jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(async (): Promise<never> => {
      projectUpdateCount += 1;
      throw new Error("Sent through the Dashboard's model API");
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("each row's ⋯ menu turns its channel off or on again", () => {
  test("a channel that is on offers Disable, one that is off offers Enable - first, before Edit - and the row's button stays Send test", async () => {
    await renderPage();

    expect(
      within(rowOf(CORPO_APP.name)).getByRole("button", { name: "Send test" }),
    ).toBeVisible();
    expect(menuLabels(openMenu(CORPO_APP.name))).toEqual([
      "Disable",
      "Edit",
      "Delete",
    ]);

    closeMenu(CORPO_APP.name);

    expect(
      within(rowOf(NIGHT_PAGER.name)).getByRole("button", {
        name: "Send test",
      }),
    ).toBeVisible();
    expect(menuLabels(openMenu(NIGHT_PAGER.name))).toEqual([
      "Enable",
      "Edit",
      "Delete",
    ]);
  });

  test("the list reads the On switch with the rows, so each row knows which to offer", async () => {
    await renderPage();

    expect(listRequests[0]!["isEnabled"]).toBe(true);
    // On and Pages Everyone are ticked on the channel that is on.
    expect(ticksIn(CORPO_APP.name)).toBe(2);
    expect(ticksIn(NIGHT_PAGER.name)).toBe(0);
  });

  test("Disable turns the channel off at once, through the Admin Dashboard's model API, and the list is read again: its row reads off and offers Enable", async () => {
    await renderPage();

    const readsBefore: number = listRequests.length;

    fireEvent.click(
      within(openMenu(CORPO_APP.name)).getByRole("menuitem", {
        name: "Disable",
      }),
    );

    // No question: the form's On switch asks none either.
    expect(screen.queryByTestId("row-actions-dialog")).toBeNull();

    await waitFor(() => {
      expect(listRequests.length).toBeGreaterThan(readsBefore);
    });
    expect(updateRequests).toEqual([
      {
        modelType: CustomNotificationChannel,
        id: CORPO_APP._id,
        data: { isEnabled: false },
      },
    ]);
    expect(projectUpdateCount).toBe(0);

    // Its On column is off now; Pages Everyone is left as it was.
    await waitFor(() => {
      expect(ticksIn(CORPO_APP.name)).toBe(1);
    });
    expect(menuLabels(openMenu(CORPO_APP.name))[0]).toBe("Enable");
  });

  test("Enable turns a channel that is off on again, and its row then offers Disable", async () => {
    await renderPage();

    fireEvent.click(
      within(openMenu(NIGHT_PAGER.name)).getByRole("menuitem", {
        name: "Enable",
      }),
    );

    await waitFor(() => {
      expect(updateRequests).toEqual([
        {
          modelType: CustomNotificationChannel,
          id: NIGHT_PAGER._id,
          data: { isEnabled: true },
        },
      ]);
    });
    expect(projectUpdateCount).toBe(0);

    await waitFor(() => {
      expect(ticksIn(NIGHT_PAGER.name)).toBe(1);
    });
    expect(menuLabels(openMenu(NIGHT_PAGER.name))[0]).toBe("Disable");
    // The other channel is left alone.
    expect(rows[0]!.isEnabled).toBe(true);
  });

  test("a change the server refuses is the row's error dialog, in its words, and the channel stays as it was", async () => {
    refusedUpdates[CORPO_APP._id] = LICENSE_REQUIRED_MESSAGE;

    await renderPage();

    fireEvent.click(
      within(openMenu(CORPO_APP.name)).getByRole("menuitem", {
        name: "Disable",
      }),
    );

    const dialog: HTMLElement = await screen.findByTestId("row-actions-dialog");

    expect(dialog).toHaveTextContent(LICENSE_REQUIRED_MESSAGE);
    expect(rows[0]!.isEnabled).toBe(true);
    expect(ticksIn(CORPO_APP.name)).toBe(2);
  });
});

describe("it follows the permission of the form's On switch", () => {
  test.each([
    EnterpriseLicenseMode.Editable,
    EnterpriseLicenseMode.Unknown,
    EnterpriseLicenseMode.Grace,
  ])(
    "%s: offered, where the Edit form is",
    async (mode: EnterpriseLicenseMode) => {
      await renderPage({ mode });

      expect(rowActionNames(CORPO_APP.name)).toEqual([
        "Send test",
        "Disable",
        "Edit",
        "Delete",
      ]);
      expect(rowActionNames(NIGHT_PAGER.name)).toEqual([
        "Send test",
        "Enable",
        "Edit",
        "Delete",
      ]);
    },
  );

  test.each([
    EnterpriseLicenseMode.ReadOnly,
    EnterpriseLicenseMode.NotIncluded,
  ])(
    "%s: the page is read-only, the server refuses a change - neither is offered, nor the Edit form, and Delete stays",
    async (mode: EnterpriseLicenseMode) => {
      await renderPage({ mode });

      expect(rowActionNames(CORPO_APP.name)).toEqual(["Delete"]);
      expect(rowActionNames(NIGHT_PAGER.name)).toEqual(["Delete"]);
      expect(updateRequests).toEqual([]);
    },
  );

  test("it is gated on the On column's own update permission: refused, Disable is locked with the reason and sends nothing", async () => {
    const reason: string =
      "You do not have permission to update this Custom Channel.";
    const original: typeof PermissionGate.checkColumnUpdate =
      PermissionGate.checkColumnUpdate.bind(PermissionGate);
    const gate: jest.SpyInstance = jest
      .spyOn(PermissionGate, "checkColumnUpdate")
      .mockImplementation(
        (
          ...args: Parameters<typeof PermissionGate.checkColumnUpdate>
        ): PermissionGateResult => {
          const [model, column] = args;

          if (
            model instanceof CustomNotificationChannel &&
            column === "isEnabled"
          ) {
            return { isAllowed: false, disabledReason: reason };
          }

          return original(...args);
        },
      );

    await renderPage();

    expect(
      gate.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          call[0] instanceof CustomNotificationChannel &&
          call[1] === "isEnabled"
        );
      }),
    ).toBe(true);

    const item: HTMLElement = within(openMenu(CORPO_APP.name)).getByRole(
      "menuitem",
      { name: "Disable" },
    );

    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAccessibleDescription(reason);

    fireEvent.click(item);

    expect(updateRequests).toEqual([]);
    expect(projectUpdateCount).toBe(0);
  });
});

describe("in the Admin Dashboard's languages", () => {
  test.each([
    ["de", "Deaktivieren", "Aktivieren"],
    ["fa", "غیرفعال کردن", "فعال کردن"],
  ])(
    "in %s, the menu words each state - %s on a channel that is on, %s on one that is off",
    async (locale: string, disable: string, enable: string) => {
      await renderPage({ locale });

      expect(menuLabels(openMenu(CORPO_APP.name))[0]).toBe(disable);

      closeMenu(CORPO_APP.name);

      expect(menuLabels(openMenu(NIGHT_PAGER.name))[0]).toBe(enable);
    },
  );

  test.each(OTHER_LOCALES)(
    "%s has both words, translated as the Dashboard words the same switch",
    (locale: string) => {
      const admin: Locale = readLocale(locale);
      const dashboard: Locale = readLocale(locale, "Dashboard");

      for (const word of ["Enable", "Disable"]) {
        expect({ locale, word, value: admin[word] }).toEqual({
          locale,
          word,
          value: dashboard[word],
        });
        expect(typeof admin[word]).toBe("string");
        expect(admin[word]).not.toBe(word);
      }
    },
  );

  test("English has both words as they are", () => {
    expect(readLocale("en")["Enable"]).toBe("Enable");
    expect(readLocale("en")["Disable"]).toBe("Disable");
  });
});
