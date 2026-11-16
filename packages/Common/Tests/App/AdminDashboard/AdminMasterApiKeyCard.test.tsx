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
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * ADMIN DASHBOARD > SETTINGS > API KEY: THE SERVER'S MASTER API KEY,
 * STORED HASHED (#7901).
 *
 * The page used to read the key back into a hidden field with a copy
 * button, and its Edit dialog took a key of the admin's choosing. The key
 * is stored as its hash now, so nothing can show it again:
 *
 *   - the card says whether there is a key - never what it is;
 *   - with none, Create Key makes one; with one, Reset Key asks first, as
 *     every script that uses the key stops working, then makes a new one;
 *   - a key made is shown ONCE, in a dialog that says so, whose only way
 *     out is Done - no Escape, no Cancel, no X - with a copy button; once
 *     it closes the key is gone from the page;
 *   - the Enabled switch saves when it is flipped, and shows a new key on;
 *   - a read or a make that fails says why;
 *   - the breadcrumbs end on this page (they pointed at another one);
 *   - which key is set (#8903): when it was made, by whom and how it ends,
 *     the date in the reader's language and time zone, and nothing that is
 *     not known - for a key the data migration hashed, its hint alone.
 *
 * The real page, card, switch and dialogs are rendered with the Admin
 * Dashboard's locales. Only the network (API, AdminModelAPI), the page
 * chrome and the side menu are stand-ins.
 */

jest.setTimeout(60000);

const mockGetItem: MockFunction = getJestMockFunction();
const mockUpdateById: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI",
  () => {
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
  },
);

interface MockPageProps {
  title?: string | undefined;
  breadcrumbLinks?: Array<{ title: string; to: { toString: () => string } }>;
  children?: ReactNode | undefined;
}

// What the page handed its chrome: its title and breadcrumbs.
const mockPageRenders: Array<MockPageProps> = [];

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: MockPageProps): ReactElement => {
      mockPageRenders.push(props);
      return <main data-testid="admin-page">{props.children}</main>;
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

import SettingsAPIKey from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/APIKey/Index";
import {
  getMasterApiKeySwitchDescription,
  MASTER_API_KEY_CARD_TEST_ID,
  MASTER_API_KEY_FACTS_TEST_ID,
  MASTER_API_KEY_SHOWN_ONCE_TEST_ID,
  MASTER_API_KEY_STATE_TEST_ID,
  MASTER_API_KEY_SWITCH_TEST_ID,
  MASTER_API_KEY_VALUE_TEST_ID,
  MasterApiKeyCopy,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/APIKey/MasterApiKeyCopy";
import PageMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/RouteMap";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import { MASTER_API_KEY_ROUTE } from "../../../Types/MasterApiKey/MasterApiKeyAnswer";
import ObjectID from "../../../Types/ObjectID";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import API from "../../../UI/Utils/API/API";
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

function readLocale(code: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Locale;
}

const ENGLISH: Locale = readLocale("en");
const GERMAN: Locale = readLocale("de");

const ZERO_ID: string = ObjectID.getZeroObjectID().toString();
const SIGNED_IN_ADMIN_ID: string = "dddddddd-0000-4000-8000-000000000001";

// A dialog's way out, by the name of its button.
const DONE_BUTTON: RegExp = /Done/;
const WAY_OUT_BUTTON: RegExp = /Cancel|Close/;

const NEW_KEY: string = "5f3b9c1e-7a2d-4e8f-b6c0-1d2e3f4a5b6c";
const NEXT_KEY: string = "0b9c8d7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e";

// When the keys the server makes here were made, and by whom.
const MADE_AT: string = "2026-11-16T09:30:00.000Z";
const MADE_BY: string = "Ada Lovelace";

// The day a key was made, as the page writes it: the reader's language and zone.
function madeOn(iso: string): string {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
    new Date(iso),
    true,
  );
}

// What the server says of its key: never the key.
let serverState: JSONObject = {
  isSet: false,
  isEnabled: false,
};
let keysToMake: Array<string> = [];
let fetchSpy: jest.SpyInstance;
let postSpy: jest.SpyInstance;

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}

function answer(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

function refusal(message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(400, { error: message }, {});
}

function isMasterApiKeyRoute(url: unknown): boolean {
  return String(url).endsWith(MASTER_API_KEY_ROUTE);
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function renderPage(
  locale: Locale = ENGLISH,
  lng: string = "en",
): Promise<void> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: lng,
    fallbackLng: "en",
    resources: {
      en: { translation: ENGLISH },
      [lng]: { translation: locale },
    },
    interpolation: { escapeValue: false },
  });

  render(
    <I18nextProvider i18n={instance}>
      <SettingsAPIKey />
    </I18nextProvider>,
  );

  await flush();
}

function card(): HTMLElement {
  return screen.getByTestId(MASTER_API_KEY_CARD_TEST_ID);
}

function stateLine(): HTMLElement {
  return screen.getByTestId(MASTER_API_KEY_STATE_TEST_ID);
}

function factsLine(): HTMLElement | null {
  return screen.queryByTestId(MASTER_API_KEY_FACTS_TEST_ID);
}

async function press(control: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(control);
  });
  await flush();
}

function button(name: string, within_: HTMLElement = card()): HTMLElement {
  return within(within_).getByRole("button", { name: name });
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function shownKey(): string | null {
  return (
    screen.queryByTestId(MASTER_API_KEY_VALUE_TEST_ID)?.textContent || null
  );
}

beforeEach(() => {
  serverState = { isSet: false, isEnabled: false };
  keysToMake = [NEW_KEY, NEXT_KEY];
  mockPageRenders.length = 0;

  fetchSpy = getJestSpyOn(API, "fetch").mockImplementation((async (options: {
    method: HTTPMethod;
    url: unknown;
  }): Promise<unknown> => {
    if (options.method === HTTPMethod.GET && isMasterApiKeyRoute(options.url)) {
      return answer({ ...serverState });
    }

    throw new Error(`Unexpected request: ${String(options.url)}`);
  }) as never);

  postSpy = getJestSpyOn(API, "post").mockImplementation((async (options: {
    url: unknown;
  }): Promise<unknown> => {
    if (!isMasterApiKeyRoute(options.url)) {
      throw new Error(`Unexpected request: ${String(options.url)}`);
    }

    const masterApiKey: string = keysToMake.shift()!;

    serverState = {
      isSet: true,
      isEnabled: true,
      createdAt: MADE_AT,
      createdByName: MADE_BY,
      hint: masterApiKey.slice(-4),
    };

    return answer({ ...serverState, masterApiKey: masterApiKey });
  }) as never);

  mockGetItem.mockReset();
  mockUpdateById.mockReset();
  mockUpdateById.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      const data: Record<string, unknown> = (options as UpdateCall).data;
      serverState = {
        ...serverState,
        isEnabled: Boolean(data["isMasterApiKeyEnabled"]),
      };
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

describe("what the page says (MasterApiKeyCopy)", () => {
  test("the switch says what on and off mean", () => {
    expect(getMasterApiKeySwitchDescription(true)).toBe(
      "Requests with the key are accepted.",
    );
    expect(getMasterApiKeySwitchDescription(false)).toBe(
      "While it is off, every request with the key fails.",
    );
  });

  test("a key that is set says it cannot be shown again, and what to do if it is lost", () => {
    expect(MasterApiKeyCopy.keySet).toContain("can't be shown again");
    expect(MasterApiKeyCopy.keySet).toContain("If you lost it, reset it.");
  });

  test("the dialog that shows a key says it is shown only once", () => {
    expect(MasterApiKeyCopy.shownOnceDescription).toContain(
      "It is shown only this once",
    );
    expect(MasterApiKeyCopy.shownOnceDescription).toContain("Copy it now");
  });

  test("Reset Key asks first, says what breaks, and is a danger", () => {
    expect(MasterApiKeyCopy.resetConfirmation).toEqual({
      title: "Reset Master API Key?",
      description:
        "The current key stops working at once, for every script and tool that uses it. The new key is shown once.",
      submitButtonText: "Reset Key",
      submitButtonType: ButtonStyleType.DANGER,
    });
  });
});

describe("Settings > API Key", () => {
  test("reads whether there is a key from its own route, and nothing reads the key", async () => {
    await renderPage();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ method: HTTPMethod.GET }),
    );
    expect(
      isMasterApiKeyRoute((fetchSpy.mock.calls[0]![0] as { url: unknown }).url),
    ).toBe(true);
    // The generic API is never asked for the key.
    expect(mockGetItem).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("its breadcrumbs end on this page", async () => {
    await renderPage();

    const page: MockPageProps = mockPageRenders[mockPageRenders.length - 1]!;
    const last: { title: string; to: { toString: () => string } } =
      page.breadcrumbLinks![page.breadcrumbLinks!.length - 1]!;

    expect(last.to.toString()).toBe(
      RouteMap[PageMap.SETTINGS_API_KEY]!.toString(),
    );
    expect(last.to.toString()).toBe("/admin/settings/api-key");
  });

  describe("with no key", () => {
    test("says there is none, and offers Create Key - nothing else", async () => {
      await renderPage();

      expect(stateLine()).toHaveTextContent(MasterApiKeyCopy.noKey);
      expect(stateLine()).toHaveAttribute("data-is-set", "false");
      expect(button("Create Key")).toBeEnabled();
      expect(
        within(card()).queryByRole("button", { name: "Reset Key" }),
      ).toBeNull();
      // Nothing to switch on yet.
      expect(screen.queryByTestId(MASTER_API_KEY_SWITCH_TEST_ID)).toBeNull();
      // No Edit dialog takes a key of one's choosing any more.
      expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    });

    test("Create Key makes one at once - nothing breaks - and shows it once", async () => {
      await renderPage();

      await press(button("Create Key"));

      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(shownKey()).toBe(NEW_KEY);

      const shown: HTMLElement = dialog();

      expect(
        within(shown).getByText(MasterApiKeyCopy.shownOnceTitle),
      ).toBeVisible();
      expect(
        within(shown).getByText(MasterApiKeyCopy.shownOnceDescription),
      ).toBeVisible();
      expect(
        within(shown).getByTestId(MASTER_API_KEY_SHOWN_ONCE_TEST_ID),
      ).toContainElement(screen.getByTestId(MASTER_API_KEY_VALUE_TEST_ID));
      // A copy button beside it.
      expect(within(shown).getByRole("button", { name: /Copy/ })).toBeVisible();
      // A key reads left to right on every page.
      expect(screen.getByTestId(MASTER_API_KEY_VALUE_TEST_ID)).toHaveAttribute(
        "dir",
        "ltr",
      );
    });
  });

  describe("the dialog that shows a key", () => {
    async function makeKey(): Promise<void> {
      await renderPage();
      await press(button("Create Key"));
      expect(shownKey()).toBe(NEW_KEY);
    }

    test("has Done as its only way out: no Cancel, no close button", async () => {
      await makeKey();

      const names: Array<string> = within(dialog())
        .getAllByRole("button")
        .map((element: HTMLElement): string => {
          return (
            element.textContent || element.getAttribute("aria-label") || ""
          );
        });

      expect(
        names.some((name: string) => {
          return DONE_BUTTON.test(name);
        }),
      ).toBe(true);
      expect(
        names.some((name: string) => {
          return WAY_OUT_BUTTON.test(name);
        }),
      ).toBe(false);
    });

    test("Escape does not close it: a reflex cannot lose the key", async () => {
      await makeKey();

      await act(async () => {
        fireEvent.keyDown(dialog(), { key: "Escape", code: "Escape" });
        fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
      });
      await flush();

      expect(shownKey()).toBe(NEW_KEY);
    });

    test("once Done is pressed, the key is gone from the page, and nothing shows it again", async () => {
      await makeKey();

      await press(within(dialog()).getByRole("button", { name: "Done" }));

      expect(shownKey()).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.body.textContent).not.toContain(NEW_KEY);
      // The card says a key is set, never what it is.
      expect(stateLine()).toHaveTextContent(MasterApiKeyCopy.keySet);
      expect(within(card()).queryByText(/Click to reveal/i)).toBeNull();
    });

    test("the new key is on: the switch shows it on", async () => {
      await makeKey();
      await press(within(dialog()).getByRole("button", { name: "Done" }));

      expect(screen.getByTestId(MASTER_API_KEY_SWITCH_TEST_ID)).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });
  });

  describe("with a key", () => {
    beforeEach(() => {
      serverState = { isSet: true, isEnabled: true };
    });

    test("says one is set and cannot be shown again, offers Reset Key and the switch", async () => {
      await renderPage();

      expect(stateLine()).toHaveTextContent(MasterApiKeyCopy.keySet);
      expect(stateLine()).toHaveAttribute("data-is-set", "true");
      expect(button("Reset Key")).toBeEnabled();
      expect(
        within(card()).queryByRole("button", { name: "Create Key" }),
      ).toBeNull();
      expect(screen.getByRole("switch", { name: "Enabled" })).toBe(
        screen.getByTestId(MASTER_API_KEY_SWITCH_TEST_ID),
      );
      expect(
        screen.getByText("Requests with the key are accepted."),
      ).toBeVisible();
    });

    test("a key that is off shows the switch off, with what that means", async () => {
      serverState = { isSet: true, isEnabled: false };

      await renderPage();

      expect(screen.getByTestId(MASTER_API_KEY_SWITCH_TEST_ID)).toHaveAttribute(
        "aria-checked",
        "false",
      );
      expect(
        screen.getByText("While it is off, every request with the key fails."),
      ).toBeVisible();
    });

    test("the switch saves the moment it is flipped, on the server's settings row", async () => {
      await renderPage();

      await press(screen.getByTestId(MASTER_API_KEY_SWITCH_TEST_ID));

      expect(mockUpdateById).toHaveBeenCalledTimes(1);

      const call: UpdateCall = mockUpdateById.mock.calls[0]![0] as UpdateCall;

      expect(call.modelType).toBe(GlobalConfig);
      expect(call.id.toString()).toBe(ZERO_ID);
      expect(call.data).toEqual({ isMasterApiKeyEnabled: false });
      expect(screen.getByTestId(MASTER_API_KEY_SWITCH_TEST_ID)).toHaveAttribute(
        "aria-checked",
        "false",
      );
      // Flipping it makes no key.
      expect(postSpy).not.toHaveBeenCalled();
    });

    test("Reset Key asks first, and Cancel makes no key", async () => {
      await renderPage();

      await press(button("Reset Key"));

      const asked: HTMLElement = dialog();

      expect(within(asked).getByText("Reset Master API Key?")).toBeVisible();
      expect(
        within(asked).getByText(
          "The current key stops working at once, for every script and tool that uses it. The new key is shown once.",
        ),
      ).toBeVisible();

      await press(within(asked).getByRole("button", { name: "Cancel" }));

      expect(postSpy).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(shownKey()).toBeNull();
    });

    test("confirmed, it makes a new key and shows it once", async () => {
      await renderPage();

      await press(button("Reset Key"));
      await press(within(dialog()).getByRole("button", { name: "Reset Key" }));

      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(shownKey()).toBe(NEW_KEY);
      expect(screen.getByText(MasterApiKeyCopy.shownOnceTitle)).toBeVisible();
      // Only the dialog that shows it is open.
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });

    test("each reset shows that reset's key, and no earlier one", async () => {
      await renderPage();

      await press(button("Reset Key"));
      await press(within(dialog()).getByRole("button", { name: "Reset Key" }));
      await press(within(dialog()).getByRole("button", { name: "Done" }));

      await press(button("Reset Key"));
      await press(within(dialog()).getByRole("button", { name: "Reset Key" }));

      expect(shownKey()).toBe(NEXT_KEY);
      expect(document.body.textContent).not.toContain(NEW_KEY);
    });

    test("a reset the server refuses says why in its dialog, and shows no key", async () => {
      postSpy.mockResolvedValue(
        refusal("Only master admins can perform this action.") as never,
      );

      await renderPage();

      await press(button("Reset Key"));
      await press(within(dialog()).getByRole("button", { name: "Reset Key" }));

      expect(
        within(dialog()).getByText(
          /Only master admins can perform this action/,
        ),
      ).toBeVisible();
      expect(shownKey()).toBeNull();
    });
  });

  test("a Create Key the server refuses says why on the card, and shows no key", async () => {
    postSpy.mockResolvedValue(
      refusal(
        "No master API key was made: this server's settings were not found. Restart OneUptime so it creates them, then try again.",
      ) as never,
    );

    await renderPage();
    await press(button("Create Key"));

    expect(
      within(card()).getByText(/this server's settings were not found/),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shownKey()).toBeNull();
  });

  test("an answer with no key in it is a failure, not a key of nothing", async () => {
    postSpy.mockResolvedValue(
      answer({ isSet: true, isEnabled: true }) as never,
    );

    await renderPage();
    await press(button("Create Key"));

    expect(
      within(card()).getByText(/did not answer with the master API key/),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a read that fails says why, and Try again reads again", async () => {
    fetchSpy.mockResolvedValueOnce(
      refusal("The server's settings could not be read.") as never,
    );

    await renderPage();

    expect(
      within(card()).getByText(/The server's settings could not be read/),
    ).toBeVisible();
    expect(screen.queryByTestId(MASTER_API_KEY_STATE_TEST_ID)).toBeNull();

    await press(
      within(card()).getByRole("button", { name: /Try again|Refresh/i }),
    );

    expect(stateLine()).toHaveTextContent(MasterApiKeyCopy.noKey);
  });

  describe("which key is set (#8903)", () => {
    test("says when the key was made, by whom, and how it ends", async () => {
      serverState = {
        isSet: true,
        isEnabled: true,
        createdAt: MADE_AT,
        createdByName: MADE_BY,
        hint: "2b34",
      };

      await renderPage();

      expect(factsLine()).toHaveTextContent(
        `Made by Ada Lovelace on ${madeOn(MADE_AT)} · Ends in 2b34`,
      );
      expect(madeOn(MADE_AT)).toContain("2026");
      // Still never the key: the hint is all it says of it.
      expect(document.body.textContent).not.toContain(NEW_KEY);
    });

    test("a maker nobody knows any more is left out: when it was made, and how it ends", async () => {
      serverState = {
        isSet: true,
        isEnabled: true,
        createdAt: MADE_AT,
        createdByName: null,
        hint: "2b34",
      };

      await renderPage();

      expect(factsLine()).toHaveTextContent(
        `Made on ${madeOn(MADE_AT)} · Ends in 2b34`,
      );
      expect(factsLine()).not.toHaveTextContent("Made by");
    });

    test("a key the upgrade hashed says how it ends, and nothing it does not know", async () => {
      serverState = {
        isSet: true,
        isEnabled: true,
        createdAt: null,
        createdByName: null,
        hint: "2b34",
      };

      await renderPage();

      expect(factsLine()).toHaveTextContent(/^Ends in 2b34$/);
    });

    test("a key nothing is known of says nothing about it, only that it is set", async () => {
      serverState = { isSet: true, isEnabled: true };

      await renderPage();

      expect(factsLine()).toBeNull();
      expect(stateLine()).toHaveTextContent(MasterApiKeyCopy.keySet);
    });

    test("with no key there is nothing to say of one", async () => {
      serverState = {
        isSet: false,
        isEnabled: false,
        createdAt: MADE_AT,
        createdByName: MADE_BY,
        hint: "2b34",
      };

      await renderPage();

      expect(factsLine()).toBeNull();
      expect(stateLine()).toHaveTextContent(MasterApiKeyCopy.noKey);
    });

    test("a key made here says, once Done is pressed, that its maker made it just now, and how it ends", async () => {
      await renderPage();

      await press(button("Create Key"));
      await press(within(dialog()).getByRole("button", { name: "Done" }));

      expect(factsLine()).toHaveTextContent(
        `Made by Ada Lovelace on ${madeOn(MADE_AT)} · Ends in ${NEW_KEY.slice(-4)}`,
      );
      expect(document.body.textContent).not.toContain(NEW_KEY);
    });

    test("flipping the switch keeps what the card says of the key", async () => {
      serverState = {
        isSet: true,
        isEnabled: true,
        createdAt: MADE_AT,
        createdByName: MADE_BY,
        hint: "2b34",
      };

      await renderPage();

      await press(screen.getByTestId(MASTER_API_KEY_SWITCH_TEST_ID));

      expect(factsLine()).toHaveTextContent("Ends in 2b34");
      expect(factsLine()).toHaveTextContent("Made by Ada Lovelace");
    });

    test("reads in the reader's language, the date too", async () => {
      serverState = {
        isSet: true,
        isEnabled: true,
        createdAt: MADE_AT,
        createdByName: MADE_BY,
        hint: "2b34",
      };

      await renderPage(GERMAN, "de");

      expect(GERMAN[MasterApiKeyCopy.madeByOn]).toBe(
        "Erstellt von {{name}} am {{date}}",
      );
      expect(factsLine()).toHaveTextContent(
        /^Erstellt von Ada Lovelace am .+ · Endet auf 2b34$/,
      );
    });

    test("every Admin Dashboard language words the facts, around their values", () => {
      const localeFiles: Array<string> = fs
        .readdirSync(LOCALES_DIR)
        .filter((file: string): boolean => {
          return file.endsWith(".json");
        });

      expect(localeFiles.length).toBeGreaterThanOrEqual(18);

      for (const file of localeFiles) {
        const locale: Locale = readLocale(file.replace(".json", ""));

        for (const [key, values] of [
          [MasterApiKeyCopy.madeByOn, ["{{name}}", "{{date}}"]],
          [MasterApiKeyCopy.madeOn, ["{{date}}"]],
          [MasterApiKeyCopy.endsIn, ["{{hint}}"]],
        ] as Array<[string, Array<string>]>) {
          const worded: unknown = locale[key];

          expect([file, key, typeof worded]).toEqual([file, key, "string"]);

          for (const value of values) {
            expect([file, key, (worded as string).includes(value)]).toEqual([
              file,
              key,
              true,
            ]);
          }

          // Worded in the language, not left in English.
          if (file !== "en.json") {
            expect([file, worded]).not.toEqual([file, key]);
          }
        }
      }
    });
  });

  test("reads in the reader's language", async () => {
    serverState = { isSet: true, isEnabled: true };

    await renderPage(GERMAN, "de");

    expect(
      within(card()).getByText(GERMAN["Master API Key"] as string),
    ).toBeVisible();
    expect(stateLine()).toHaveTextContent(
      GERMAN[MasterApiKeyCopy.keySet] as string,
    );
    expect(
      within(card()).getByRole("button", {
        name: GERMAN["Reset Key"] as string,
      }),
    ).toBeVisible();
    expect(GERMAN["Reset Key"]).toBe("Schlüssel zurücksetzen");
  });
});
