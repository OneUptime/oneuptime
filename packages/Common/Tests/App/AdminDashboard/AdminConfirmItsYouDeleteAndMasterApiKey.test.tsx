// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "../../UI/Utils/API/DashboardHost";
import FakeAxiosServer, {
  FakeReply,
  FakeTransport,
} from "../../UI/Utils/API/FakeAxiosServer";
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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import axios from "axios";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

// The pages' chrome: their title, breadcrumbs and side menus are not what is tested.
jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { children?: ReactNode }): ReactElement => {
      return <main data-testid="admin-page">{props.children}</main>;
    },
  };
});

jest.mock("../../../UI/Components/Page/ModelPage", () => {
  return {
    __esModule: true,
    default: (props: { children?: ReactNode }): ReactElement => {
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

import ReauthenticationPrompt, {
  REAUTHENTICATION_PROMPT_COPY,
  REAUTHENTICATION_PROMPT_DESCRIPTIONS,
} from "../../../UI/Components/Reauthentication/ReauthenticationPrompt";
import {
  BulkActionRunResult,
  runBulkAction,
} from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import { BulkActionOnClickProps } from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import DeletePage from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Users/View/Delete";
import SettingsAPIKey from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/APIKey/Index";
import { MASTER_API_KEY_SWITCH_TEST_ID } from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/APIKey/MasterApiKeyCopy";
import AdminModelAPI from "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI";
import PageMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/RouteMap";
import User from "../../../Models/DatabaseModels/User";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import Route from "../../../Types/API/Route";
import {
  REAUTHENTICATION_FIELDS,
  REAUTHENTICATION_PURPOSE_FIELD,
  REAUTHENTICATION_REQUIRED_MESSAGES,
  REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
  REAUTHENTICATION_ROUTE,
  ReauthenticationPurpose,
} from "../../../Types/Accounts/Reauthentication";
import Email from "../../../Types/Email";
import { REFUSAL_CODE_FIELD } from "../../../Types/Exception/NameTakenException";
import { MASTER_API_KEY_ROUTE } from "../../../Types/MasterApiKey/MasterApiKeyAnswer";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import Reauthentication from "../../../UI/Utils/Reauthentication";
import UserUtil from "../../../UI/Utils/User";
import { getJestSpyOn } from "../../Spy";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE ADMIN DASHBOARD ASKS A MASTER ADMIN TO CONFIRM IT'S THEM BEFORE THEY
 * DELETE SOMEONE'S ACCOUNT OR TURN THE MASTER API KEY BACK ON (#10330),
 * rendered, in English, Persian and Arabic.
 *
 * Users > a user > Delete and Settings > API Key's Enabled switch send what
 * they always sent. The server refuses each until the master admin's
 * session has confirmed it's them, saying what for (AdminChange); the
 * Admin Dashboard's API client hands the refusal to the one prompt it
 * mounts (App.tsx), which says the confirmation is for this change, in the
 * reader's language, and, once the server took the password, sends the
 * same request again. Cancelled, nothing changes, and the page says why in
 * the reader's language. The Users list's bulk Delete asks once for every
 * user it deletes, and a cancelled prompt stops it.
 *
 * The real pages, the real prompt and the real API client (Common/UI/Utils
 * /API), against a stand-in for the server's answers (FakeAxiosServer):
 * the server's side of the same requests is pinned by
 * Server/API/AdminDeleteAndMasterApiKeyOverHttp.test.ts.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

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

const ADMIN_ID: ObjectID = new ObjectID("dddddddd-0000-4000-8000-000000000001");
const SOMEONE_ID: ObjectID = new ObjectID(
  "eeeeeeee-0000-4000-8000-000000000002",
);
const ZERO_ID: string = ObjectID.getZeroObjectID().toString();

const API_ORIGIN: string = `${DASHBOARD_ORIGIN}/api`;
const STATUS_URL: string = `${API_ORIGIN}${REAUTHENTICATION_ROUTE}`;
const MASTER_API_KEY_URL: string = `${API_ORIGIN}${MASTER_API_KEY_ROUTE}`;
const SWITCH_URL: string = `${API_ORIGIN}/global-config/${ZERO_ID}`;

function userUrl(id: ObjectID): string {
  return `${API_ORIGIN}/user/${id.toString()}`;
}

// The server's refusal until the master admin's session confirms (#10330).
const REFUSAL: FakeReply = {
  status: 400,
  data: {
    message:
      REAUTHENTICATION_REQUIRED_MESSAGES[ReauthenticationPurpose.AdminChange],
    [REFUSAL_CODE_FIELD]: REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
    [REAUTHENTICATION_PURPOSE_FIELD]: ReauthenticationPurpose.AdminChange,
  },
};

// A master admin who signs in with a password, and has not confirmed.
const NOT_CONFIRMED: FakeReply = {
  status: 200,
  data: {
    isConfirmed: false,
    confirmedUntil: null,
    windowInMinutes: 10,
    methods: {
      password: true,
      secondStep: null,
      passkey: false,
      signInAgain: false,
    },
    signInAgain: null,
  },
};

const CONFIRMED: FakeReply = {
  status: 200,
  data: { confirmedUntil: "2026-11-20T10:10:00.000Z" },
};

const DONE: FakeReply = { status: 200, data: {} };

// A key that was turned off.
const KEY_OFF: FakeReply = {
  status: 200,
  data: {
    isSet: true,
    isEnabled: false,
    createdAt: "2026-11-16T09:30:00.000Z",
    createdByName: "Ada Lovelace",
    hint: "2b34",
  },
};

let server: FakeAxiosServer;
let navigate: jest.SpyInstance;

interface Language {
  name: string;
  code: string;
  words: Locale;
}

const LANGUAGES: Array<Language> = [
  { name: "English", code: "en", words: ENGLISH },
  { name: "Persian", code: "fa", words: readLocale("fa") },
  { name: "Arabic", code: "ar", words: readLocale("ar") },
];

// A text as the reader's locale words it: the English key itself in English.
function wordsFor(language: Language, key: string): string {
  if (language.code === "en") {
    return key;
  }

  const words: unknown = language.words[key];

  // Translated: never the English.
  expect(typeof words).toBe("string");
  expect(words).not.toBe(key);

  return withoutIsolateMarks(words as string)
    .replace(/\s+/g, " ")
    .trim();
}

function readText(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function renderInLanguage(
  language: Language,
  page: ReactElement,
): Promise<void> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language.code,
    fallbackLng: "en",
    resources: {
      en: { translation: ENGLISH },
      [language.code]: { translation: language.words },
    },
    interpolation: { escapeValue: false },
  });

  render(
    <I18nextProvider i18n={instance}>
      <ReauthenticationPrompt />
      {page}
    </I18nextProvider>,
  );

  await flush();
}

function prompt(): HTMLElement {
  return screen
    .getByTestId("reauthentication-prompt")
    .closest("[role='dialog']") as HTMLElement;
}

async function waitForPrompt(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("reauthentication-prompt")).toBeInTheDocument();
  });
}

// The prompt as the Admin Dashboard words it for a master admin's change.
function expectPromptInLanguage(language: Language): void {
  expect(readText(within(prompt()).getByTestId("modal-title"))).toBe(
    wordsFor(language, REAUTHENTICATION_PROMPT_COPY.title),
  );
  expect(readText(within(prompt()).getByTestId("modal-description"))).toBe(
    wordsFor(
      language,
      REAUTHENTICATION_PROMPT_DESCRIPTIONS[ReauthenticationPurpose.AdminChange]
        .password,
    ),
  );

  if (language.code !== "en") {
    expect(readText(prompt())).not.toContain("Enter your password");
  }
}

async function confirmWithPassword(): Promise<void> {
  fireEvent.change(screen.getByTestId("reauthentication-password"), {
    target: { value: "the right password" },
  });

  await act(async (): Promise<void> => {
    fireEvent.click(within(prompt()).getByTestId("modal-footer-submit-button"));
  });
}

async function cancelPrompt(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(prompt()).getByTestId("modal-footer-close-button"));
  });
}

function confirmationsSent(): Array<unknown> {
  return server
    .requestsTo(HTTPMethod.POST, STATUS_URL)
    .map((request: { data: unknown }): unknown => {
      return typeof request.data === "string"
        ? JSON.parse(request.data)
        : request.data;
    });
}

beforeEach(() => {
  localStorage.clear();
  server = new FakeAxiosServer(mockedAxios);

  // Everyone in the Admin Dashboard is a master admin.
  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
  getJestSpyOn(UserUtil, "getUserId").mockReturnValue(ADMIN_ID);
  getJestSpyOn(UserUtil, "getEmail").mockReturnValue(
    new Email("ada@example.com"),
  );
  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    SOMEONE_ID,
  );
  navigate = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
});

afterEach(() => {
  cleanup();
  Reauthentication.setAsker(null);
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  localStorage.clear();
});

describe.each(LANGUAGES)("in $name", (language: Language) => {
  describe("Users > a user > Delete", () => {
    async function openAndDelete(): Promise<void> {
      await renderInLanguage(language, <DeletePage />);

      await waitFor(() => {
        expect(screen.getByTestId("card-button")).toBeEnabled();
      });

      // The card's Delete User, then the dialog's.
      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("card-button"));
      });
      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      });
    }

    beforeEach(() => {
      server.on(HTTPMethod.POST, `${userUrl(SOMEONE_ID)}/get-item`, [
        {
          status: 200,
          data: {
            _id: SOMEONE_ID.toString(),
            email: "someone@example.com",
          },
        },
      ]);
    });

    test("asks the master admin to confirm it's them, in the reader's words; confirmed, the same delete is sent again and the page goes back to Users", async () => {
      server
        .on(HTTPMethod.DELETE, userUrl(SOMEONE_ID), [REFUSAL, DONE])
        .on(HTTPMethod.GET, STATUS_URL, [NOT_CONFIRMED])
        .on(HTTPMethod.POST, STATUS_URL, [CONFIRMED]);

      await openAndDelete();
      await waitForPrompt();

      expectPromptInLanguage(language);

      // Nothing is deleted while the prompt asks.
      expect(
        server.requestsTo(HTTPMethod.DELETE, userUrl(SOMEONE_ID)),
      ).toHaveLength(1);
      expect(navigate).not.toHaveBeenCalled();

      await confirmWithPassword();

      await waitFor(() => {
        expect(navigate).toHaveBeenCalled();
      });

      expect(confirmationsSent()).toEqual([
        { [REAUTHENTICATION_FIELDS.password]: "the right password" },
      ]);
      expect(
        server.requestsTo(HTTPMethod.DELETE, userUrl(SOMEONE_ID)),
      ).toHaveLength(2);
      expect(String(navigate.mock.calls[0]![0])).toBe(
        String(RouteMap[PageMap.USERS] as Route),
      );
    });

    test("cancelled, nothing is deleted, and the page says why in the reader's words", async () => {
      server
        .on(HTTPMethod.DELETE, userUrl(SOMEONE_ID), [REFUSAL])
        .on(HTTPMethod.GET, STATUS_URL, [NOT_CONFIRMED]);

      await openAndDelete();
      await waitForPrompt();
      await cancelPrompt();

      const refusal: string = wordsFor(
        language,
        REAUTHENTICATION_REQUIRED_MESSAGES[ReauthenticationPurpose.AdminChange],
      );

      await waitFor(() => {
        expect(readText(screen.getByTestId("confirm-modal-description"))).toBe(
          refusal,
        );
      });

      expect(
        server.requestsTo(HTTPMethod.DELETE, userUrl(SOMEONE_ID)),
      ).toHaveLength(1);
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe("Settings > API Key: turning the key back on", () => {
    function keySwitch(): HTMLElement {
      return screen.getByTestId(MASTER_API_KEY_SWITCH_TEST_ID);
    }

    async function openAndFlip(): Promise<void> {
      await renderInLanguage(language, <SettingsAPIKey />);

      await waitFor(() => {
        expect(keySwitch()).toHaveAttribute("aria-checked", "false");
      });

      await act(async (): Promise<void> => {
        fireEvent.click(keySwitch());
      });
    }

    function switchesSent(): Array<unknown> {
      return server
        .requestsTo(HTTPMethod.PUT, SWITCH_URL)
        .map((request: { data: unknown }): unknown => {
          return typeof request.data === "string"
            ? JSON.parse(request.data)
            : request.data;
        });
    }

    test("asks the master admin to confirm it's them, in the reader's words; confirmed, the same switch is sent again and the key is on", async () => {
      server
        .on(HTTPMethod.GET, MASTER_API_KEY_URL, [KEY_OFF])
        .on(HTTPMethod.PUT, SWITCH_URL, [REFUSAL, DONE])
        .on(HTTPMethod.GET, STATUS_URL, [NOT_CONFIRMED])
        .on(HTTPMethod.POST, STATUS_URL, [CONFIRMED]);

      await openAndFlip();
      await waitForPrompt();

      expectPromptInLanguage(language);
      expect(switchesSent()).toHaveLength(1);

      await confirmWithPassword();

      await waitFor(() => {
        expect(switchesSent()).toHaveLength(2);
      });

      // The same request, sent again: the key turned on.
      expect(switchesSent()).toEqual([
        { data: { isMasterApiKeyEnabled: true } },
        { data: { isMasterApiKeyEnabled: true } },
      ]);

      await waitFor(() => {
        expect(keySwitch()).toHaveAttribute("aria-checked", "true");
      });
      expect(screen.queryByTestId("reauthentication-prompt")).toBeNull();
    });

    test("cancelled, the key stays off, and the switch says why in the reader's words", async () => {
      server
        .on(HTTPMethod.GET, MASTER_API_KEY_URL, [KEY_OFF])
        .on(HTTPMethod.PUT, SWITCH_URL, [REFUSAL])
        .on(HTTPMethod.GET, STATUS_URL, [NOT_CONFIRMED]);

      await openAndFlip();
      await waitForPrompt();
      await cancelPrompt();

      const refusal: string = wordsFor(
        language,
        REAUTHENTICATION_REQUIRED_MESSAGES[ReauthenticationPurpose.AdminChange],
      );

      await waitFor(() => {
        expect(keySwitch()).toHaveAttribute("aria-checked", "false");
      });

      await waitFor(() => {
        expect(readText(screen.getByTestId("admin-page"))).toContain(refusal);
      });

      expect(switchesSent()).toHaveLength(1);
      expect(confirmationsSent()).toEqual([]);
    });
  });
});

/*
 * The Users list's bulk Delete runs each user's delete one at a time
 * through AdminModelAPI (Pages/Users/Index.tsx, getBulkDeleteAction): the
 * first is refused, the prompt asks once, and every delete after it goes
 * through on the same confirmation. Cancelled, the run stops: nobody else
 * is asked about, and nobody is deleted.
 */
describe("the Users list's bulk Delete", () => {
  const PEOPLE: Array<User> = [1, 2, 3].map((n: number): User => {
    const user: User = new User();
    user._id = `cccccccc-0000-4000-8000-00000000000${n}`;
    user.id = new ObjectID(user._id);
    return user;
  });

  function deleteUrlOf(user: User): string {
    return userUrl(user.id!);
  }

  // What getBulkDeleteAction runs: each user's delete, one at a time.
  function startBulkDelete(): Promise<BulkActionRunResult<User>> {
    return runBulkAction<User>({
      actionProps: {
        items: PEOPLE,
        onProgressInfo: (): void => {},
        onBulkActionStart: (): void => {},
        onBulkActionEnd: (): void => {},
      } as unknown as BulkActionOnClickProps<User>,
      concurrency: 1,
      step: async (user: User): Promise<void> => {
        await AdminModelAPI.deleteItem<User>({
          modelType: User,
          id: user.id!,
        });
      },
    });
  }

  test("asks once: confirmed, every user is deleted on the same confirmation", async () => {
    server
      .on(HTTPMethod.DELETE, deleteUrlOf(PEOPLE[0]!), [REFUSAL, DONE])
      .on(HTTPMethod.DELETE, deleteUrlOf(PEOPLE[1]!), [DONE])
      .on(HTTPMethod.DELETE, deleteUrlOf(PEOPLE[2]!), [DONE])
      .on(HTTPMethod.GET, STATUS_URL, [NOT_CONFIRMED])
      .on(HTTPMethod.POST, STATUS_URL, [CONFIRMED]);

    await renderInLanguage(LANGUAGES[0]!, <></>);

    const running: Promise<BulkActionRunResult<User>> = startBulkDelete();

    await waitForPrompt();
    await confirmWithPassword();

    const result: BulkActionRunResult<User> = await running;

    expect(result.changed).toHaveLength(3);
    expect(result.failed).toEqual([]);
    expect(result.notStarted).toEqual([]);
    expect(confirmationsSent()).toHaveLength(1);
    expect(server.requestsTo(HTTPMethod.GET, STATUS_URL)).toHaveLength(1);
  });

  test("cancelled: the first user is not deleted, and the rest are not started - nobody is asked about again", async () => {
    server
      .on(HTTPMethod.DELETE, deleteUrlOf(PEOPLE[0]!), [REFUSAL])
      .on(HTTPMethod.GET, STATUS_URL, [NOT_CONFIRMED]);

    await renderInLanguage(LANGUAGES[0]!, <></>);

    const running: Promise<BulkActionRunResult<User>> = startBulkDelete();

    await waitForPrompt();
    await cancelPrompt();

    const result: BulkActionRunResult<User> = await running;

    expect(result.changed).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.failedMessage).toBe(
      REAUTHENTICATION_REQUIRED_MESSAGES[ReauthenticationPurpose.AdminChange],
    );
    expect(result.notStarted).toEqual([PEOPLE[1], PEOPLE[2]]);
    expect(
      server.requestsTo(HTTPMethod.DELETE, deleteUrlOf(PEOPLE[1]!)),
    ).toEqual([]);
    expect(
      server.requestsTo(HTTPMethod.DELETE, deleteUrlOf(PEOPLE[2]!)),
    ).toEqual([]);
    // Asked once: the prompt never opened again.
    expect(server.requestsTo(HTTPMethod.GET, STATUS_URL)).toHaveLength(1);
  });
});
