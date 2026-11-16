import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * AN API KEY'S PAGE, NOW THE KEY IS STORED HASHED (#8902, #8903), on the
 * real page with only the network stubbed.
 *
 * The page read the key back into a hidden field with a copy button, and
 * Reset API Key made the new key in the browser and saved it through the
 * generic API. The key is stored as its hash now, so nothing can show it
 * again:
 *
 *   - the details say how the key ends ("Ends in 00aa"), and that it was
 *     shown only once - never the key, nor a copy button for it;
 *   - Reset API Key asks first, saying what breaks and when, then asks the
 *     server for a new key (POST /api-key/:id/reset-key) and shows it ONCE,
 *     in a dialog whose only way out is Done - no Escape, no Cancel - with
 *     a copy button; once Done is pressed the key is gone from the page,
 *     and the details say how the new key ends;
 *   - a reset the server refuses, or an answer with no key, says why and
 *     shows no key;
 *   - someone who may not change the key - a key's update permissions
 *     without the key column's own, Edit API Key - finds Reset locked,
 *     saying why;
 *   - every Dashboard language words what the page says.
 */

let allPermissionsForTest: Array<string> = [];
let projectPermissionsForTest: unknown = null;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return allPermissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return projectPermissionsForTest;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { tenantid: "0f000000-0000-4000-8000-000000000001" };
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      createOrUpdate: async (): Promise<any> => {
        return { data: {} };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0f000000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import APIKeyViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/APIKeyView";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  API_KEY_HINT_TEST_ID,
  API_KEY_SHOWN_ONCE_TEST_ID,
  API_KEY_SHOWN_ONCE_VALUE_TEST_ID,
  ApiKeyShownOnceCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ApiKey/ApiKeyShownOnceCopy";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { getResetApiKeyRoute } from "../../../Types/ApiKey/ApiKeyShownOnce";
import OneUptimeDate from "../../../Types/Date";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Detail/EmptyValue";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "../../Spy";

jest.setTimeout(30000);

const PROJECT_ID: string = "0f000000-0000-4000-8000-000000000001";
const KEY_ID: string = "0f000000-0000-4000-8000-000000000002";

const NEW_KEY: string = "5f3b9c1e-7a2d-4e8f-b6c0-1d2e3f4a5b6c";
const NEXT_KEY: string = "0b9c8d7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const currentProject: Project = new Project();
currentProject._id = PROJECT_ID;

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.SETTINGS_APIKEY_VIEW] as Route,
  hasPaymentMethod: true,
  currentProject: currentProject,
} as unknown as PageComponentProps;

// How the key ends, as the server keeps it: what the details show.
let storedHint: string | null = "00aa";
let keysToMake: Array<string> = [];
let postSpy: jest.SpyInstance;

function holding(permissions: Array<Permission>): void {
  allPermissionsForTest = permissions;
  projectPermissionsForTest = {
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  };
}

function apiKey(): ApiKey {
  const key: ApiKey = new ApiKey();
  key._id = KEY_ID;
  key.name = "Terraform";
  key.expiresAt = OneUptimeDate.getSomeDaysAfter(365);

  if (storedHint) {
    key.apiKeyHint = storedHint;
  }

  return key;
}

function answer(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

function refusal(message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(400, { error: message }, {});
}

beforeEach(() => {
  holding([Permission.ProjectOwner]);
  storedHint = "00aa";
  keysToMake = [NEW_KEY, NEXT_KEY];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/settings/api-keys/${KEY_ID}`,
  );

  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    new ObjectID(KEY_ID),
  );
  getJestSpyOn(Navigation, "navigate").mockImplementation((): void => {});

  getItemMock.mockImplementation(async (): Promise<any> => {
    return apiKey();
  });

  getListMock.mockImplementation(async (): Promise<any> => {
    return { data: [], count: 0, skip: 0, limit: 10 };
  });

  // The server makes the key, keeps its hint, and answers the key once.
  postSpy = getJestSpyOn(API, "post").mockImplementation((async (options: {
    url: unknown;
  }): Promise<unknown> => {
    if (!String(options.url).endsWith(getResetApiKeyRoute(KEY_ID))) {
      throw new Error(`Unexpected request: ${String(options.url)}`);
    }

    const made: string = keysToMake.shift()!;

    storedHint = made.slice(-4);

    return answer({ apiKey: made, apiKeyHint: made.slice(-4) });
  }) as never);
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  render(<APIKeyViewPage {...pageProps} />);

  await waitFor(
    () => {
      expect(screen.getAllByText("Terraform").length).toBeGreaterThan(0);
    },
    { timeout: 10000 },
  );
}

function card(title: string): HTMLElement {
  const heading: HTMLElement | undefined = screen
    .getAllByTestId("card-details-heading")
    .find((candidate: HTMLElement): boolean => {
      return candidate.textContent === title;
    });

  if (!heading) {
    throw new Error(`No card titled ${title}`);
  }

  return heading.closest("[data-testid='card']") as HTMLElement;
}

function cardButton(container: HTMLElement, title: string): HTMLElement {
  const button: HTMLElement | undefined = within(container)
    .getAllByTestId("card-button")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").trim() === title;
    });

  if (!button) {
    throw new Error(`No ${title} button`);
  }

  return button;
}

async function press(control: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(control);
  });
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

function shownKey(): string | null {
  return (
    screen.queryByTestId(API_KEY_SHOWN_ONCE_VALUE_TEST_ID)?.textContent || null
  );
}

async function resetAndConfirm(): Promise<void> {
  await press(cardButton(card("Reset API Key"), "Reset API Key"));
  await press(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Reset Key",
    }),
  );
}

describe("the key's details", () => {
  test("say how the key ends and that it was shown once - never the key", async () => {
    await renderPage();

    const details: HTMLElement = card("API Key Details");

    expect(within(details).getByTestId(API_KEY_HINT_TEST_ID)).toHaveTextContent(
      "Ends in 00aa",
    );
    expect(
      within(details).getByText(ApiKeyShownOnceCopy.keyFieldDescription),
    ).toBeInTheDocument();
    // The hint reads left to right on every page.
    expect(
      within(within(details).getByTestId(API_KEY_HINT_TEST_ID)).getByText(
        "00aa",
      ),
    ).toHaveAttribute("dir", "ltr");
    expect(within(details).queryByText(/Click to reveal/i)).toBeNull();
  });

  test("read the hint, and nothing else of the key, from the server", async () => {
    await renderPage();

    const selects: Array<Record<string, unknown>> = getItemMock.mock.calls.map(
      (call: Array<any>): Record<string, unknown> => {
        return (call[0]?.select || {}) as Record<string, unknown>;
      },
    );

    expect(selects.length).toBeGreaterThan(0);

    for (const select of selects) {
      expect(select).not.toHaveProperty("apiKey");
    }

    expect(
      selects.some((select: Record<string, unknown>): boolean => {
        return Boolean(select["apiKeyHint"]);
      }),
    ).toBe(true);
  });

  test("a key with no hint draws the quiet dash in its place", async () => {
    storedHint = null;

    await renderPage();

    const details: HTMLElement = card("API Key Details");

    expect(within(details).queryByTestId(API_KEY_HINT_TEST_ID)).toBeNull();
    expect(
      within(details).getAllByTestId(EMPTY_VALUE_TEST_ID).length,
    ).toBeGreaterThan(0);
  });
});

describe("Reset API Key", () => {
  test("says what it does: a new key shown once, the current one stops within a minute", async () => {
    await renderPage();

    expect(
      within(card("Reset API Key")).getByText(
        ApiKeyShownOnceCopy.resetCardDescription,
      ),
    ).toBeInTheDocument();
    expect(ApiKeyShownOnceCopy.resetCardDescription).toContain("shows it once");
  });

  test("asks first, says what breaks, and Cancel makes no key", async () => {
    await renderPage();

    await press(cardButton(card("Reset API Key"), "Reset API Key"));

    const asked: HTMLElement = screen.getByRole("dialog");

    expect(within(asked).getByText("Reset API Key?")).toBeVisible();
    expect(
      within(asked).getByText(
        "The current key stops working within a minute, for every script and tool that uses it. The new key is shown once.",
      ),
    ).toBeVisible();

    await press(within(asked).getByRole("button", { name: "Cancel" }));

    expect(postSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shownKey()).toBeNull();
  });

  test("is a danger: the confirmation's button says Reset Key in the danger style", () => {
    expect(ApiKeyShownOnceCopy.resetConfirmation).toEqual({
      title: "Reset API Key?",
      description:
        "The current key stops working within a minute, for every script and tool that uses it. The new key is shown once.",
      submitButtonText: "Reset Key",
      submitButtonType: ButtonStyleType.DANGER,
    });
  });

  test("confirmed, the server makes the key - in this project - and the page shows it once", async () => {
    await renderPage();

    await resetAndConfirm();

    expect(postSpy).toHaveBeenCalledTimes(1);

    const request: { url: unknown; headers: Record<string, string> } = postSpy
      .mock.calls[0]![0] as { url: unknown; headers: Record<string, string> };

    expect(String(request.url)).toContain(
      `/api-key/${KEY_ID}/reset-key`,
    );
    // The project the server resolves the reset's permissions in.
    expect(request.headers).toEqual({ tenantid: PROJECT_ID });

    expect(shownKey()).toBe(NEW_KEY);

    const shown: HTMLElement = screen.getByRole("dialog");

    expect(within(shown).getByText("Copy Your API Key")).toBeVisible();
    expect(
      within(shown).getByText(ApiKeyShownOnceCopy.shownOnceDescription),
    ).toBeVisible();
    expect(ApiKeyShownOnceCopy.shownOnceDescription).toContain(
      "It is shown only this once",
    );
    expect(within(shown).getByTestId(API_KEY_SHOWN_ONCE_TEST_ID)).toContainElement(
      screen.getByTestId(API_KEY_SHOWN_ONCE_VALUE_TEST_ID),
    );
    // A copy button beside it, and the key read left to right.
    expect(within(shown).getByRole("button", { name: /Copy/ })).toBeVisible();
    expect(screen.getByTestId(API_KEY_SHOWN_ONCE_VALUE_TEST_ID)).toHaveAttribute(
      "dir",
      "ltr",
    );
    // Only the dialog that shows it is open.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  test("the dialog's only way out is Done: no Cancel, no close button, no Escape", async () => {
    await renderPage();
    await resetAndConfirm();

    const names: Array<string> = within(screen.getByRole("dialog"))
      .getAllByRole("button")
      .map((element: HTMLElement): string => {
        return element.textContent || element.getAttribute("aria-label") || "";
      });

    expect(
      names.some((name: string): boolean => {
        return /Done/.test(name);
      }),
    ).toBe(true);
    expect(
      names.some((name: string): boolean => {
        return /Cancel|Close/.test(name);
      }),
    ).toBe(false);

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog"), {
        key: "Escape",
        code: "Escape",
      });
      fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    });

    expect(shownKey()).toBe(NEW_KEY);
  });

  test("once Done is pressed the key is gone, and the details say how the new key ends", async () => {
    await renderPage();
    await resetAndConfirm();

    await press(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }),
    );

    expect(shownKey()).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.textContent).not.toContain(NEW_KEY);

    await waitFor(() => {
      expect(
        within(card("API Key Details")).getByTestId(API_KEY_HINT_TEST_ID),
      ).toHaveTextContent(`Ends in ${NEW_KEY.slice(-4)}`);
    });
  });

  test("each reset shows that reset's key, and no earlier one", async () => {
    await renderPage();

    await resetAndConfirm();
    await press(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }),
    );
    await resetAndConfirm();

    expect(shownKey()).toBe(NEXT_KEY);
    expect(document.body.textContent).not.toContain(NEW_KEY);
  });

  test("a reset the server refuses says why in its dialog, and shows no key", async () => {
    postSpy.mockResolvedValue(
      refusal(
        "You do not have permission to update API Key. You need one of these permissions: Project Owner, Project Admin, Edit API Key.",
      ) as never,
    );

    await renderPage();
    await resetAndConfirm();

    expect(
      within(screen.getByRole("dialog")).getByText(
        /You do not have permission to update API Key/,
      ),
    ).toBeVisible();
    expect(shownKey()).toBeNull();
  });

  test("an answer with no key in it is a failure, not a key of nothing", async () => {
    postSpy.mockResolvedValue(answer({ apiKeyHint: "5b6c" }) as never);

    await renderPage();
    await resetAndConfirm();

    expect(
      within(screen.getByRole("dialog")).getByText(
        ApiKeyShownOnceCopy.notAnswered,
      ),
    ).toBeVisible();
    expect(shownKey()).toBeNull();
  });

  test.each([
    ["can only read keys", [Permission.ReadProjectApiKey]],
    [
      "may change what a key can do, not the key",
      [Permission.ReadProjectApiKey, Permission.EditProjectApiKeyPermissions],
    ],
  ])(
    "someone who %s finds it locked, saying why",
    async (_label: string, permissions: Array<Permission>) => {
      holding(permissions);

      await renderPage();

      const button: HTMLElement = cardButton(
        card("Reset API Key"),
        "Reset API Key",
      );

      expect(button).toBeDisabled();

      await press(button);

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(postSpy).not.toHaveBeenCalled();
    },
  );

  test("someone with Edit API Key may reset it", async () => {
    holding([Permission.ReadProjectApiKey, Permission.EditProjectApiKey]);

    await renderPage();

    expect(
      cardButton(card("Reset API Key"), "Reset API Key"),
    ).not.toBeDisabled();
  });
});

describe("in every language", () => {
  const NEW_SENTENCES: Array<[string, Array<string>]> = [
    [ApiKeyShownOnceCopy.shownOnceTitle, []],
    [ApiKeyShownOnceCopy.shownOnceDescription, ["OneUptime"]],
    [ApiKeyShownOnceCopy.endsIn, ["{{hint}}"]],
    [ApiKeyShownOnceCopy.keyFieldDescription, []],
    [ApiKeyShownOnceCopy.resetCardDescription, []],
    [ApiKeyShownOnceCopy.resetConfirmation.title, []],
    [ApiKeyShownOnceCopy.resetConfirmation.description, []],
    [ApiKeyShownOnceCopy.notAnswered, []],
  ];

  test("every Dashboard language words what the page says, its values and names kept", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files.length).toBeGreaterThanOrEqual(18);

    for (const file of files) {
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      ) as Record<string, unknown>;

      for (const [key, kept] of NEW_SENTENCES) {
        const worded: unknown = locale[key];

        expect([file, key, typeof worded]).toEqual([file, key, "string"]);

        for (const value of kept) {
          expect([file, key, (worded as string).includes(value)]).toEqual([
            file,
            key,
            true,
          ]);
        }

        if (file !== "en.json") {
          expect([file, worded]).not.toEqual([file, key]);
        }
      }
    }
  });
});
