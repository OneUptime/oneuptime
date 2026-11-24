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
import React from "react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * TELEGRAM'S VERIFY DIALOG SAYS "SCAN" ONLY UNDER A CODE THERE IS TO SCAN
 * (#6653).
 *
 * User Settings > Notification Methods > Telegram > Verify draws a QR code of
 * the bot's deep link, with "Scan on phone to open Telegram" under it. Since
 * #6649 a code that cannot be drawn - its library did not load, or the link
 * is too long for any QR code - says "The QR code could not be shown." in its
 * place, and the caption under that notice said the opposite. It goes with
 * the code now; the dialog's other ways in, Open in Telegram and the steps by
 * hand, stay.
 *
 * On a phone it leads with Open in Telegram, and draws no code a phone
 * cannot scan from its own screen, nor the caption saying to scan it
 * (#10916): a screen whose main pointer is a finger, as the authenticator
 * app's setup tells one (PrefersTouch, #6651). A screen worked with a mouse
 * keeps the code, for the phone in the person's hand.
 *
 * The real table, dialog and QR element are drawn; the network and the
 * module that draws a code (QRCodeImage) are stood in, so each test decides
 * whether a code is drawn. jsdom has no matchMedia, so a test is on a
 * desktop unless it hands the page a finger (onATouchScreen).
 */

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();

interface PendingCode {
  text: string;
  resolve: (url: string) => void;
  reject: (error: Error) => void;
}

const mockQRCodeImage: { pending: Array<PendingCode> } = { pending: [] };

// Dereferenced at call time: jest.mock runs before the consts above exist.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>) => {
        return getMock(...args);
      },
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (...args: Array<unknown>) => {
        return getCommonHeadersMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/QR/QRCodeImage", () => {
  return {
    __esModule: true,
    default: (text: string): Promise<string> => {
      return new Promise(
        (resolve: (url: string) => void, reject: (error: Error) => void) => {
          mockQRCodeImage.pending.push({ text, resolve, reject });
        },
      );
    },
  };
});

import TelegramMethods, {
  OPEN_IN_TELEGRAM_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Telegram";
import {
  BOXED_BUTTON_CLASS_NAME,
  BOXED_BUTTON_LOOK_CLASS_NAMES,
  ButtonStyleType,
} from "../../../UI/Components/Button/Button";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { Logger } from "../../../UI/Utils/Logger";
import { getProjectPermissionsStorageKey } from "../../../UI/Utils/Permission";

const USER_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const PROJECT_ID: string = "dddddddd-4444-4444-8444-444444444444";
const ROW_ID: string = "11111111-7777-4777-8777-777777777777";

const CAPTION: string = "Scan on phone to open Telegram";
const QR_FAILED: string = "The QR code could not be shown.";
const IMAGE: string = "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E";

const FIRST_LINK: string = "https://t.me/oneuptime_bot?start=123456";
const ROTATED_LINK: string = "https://t.me/oneuptime_bot?start=654321";

// The deep link the next Verify is answered with.
let deepLink: string = FIRST_LINK;

const signInAsOwner: () => void = (): void => {
  localStorage.setItem("user_id", USER_ID);
  localStorage.setItem("is_master_admin", "true");
  sessionStorage.setItem("current_project_id", PROJECT_ID);
  localStorage.setItem(
    getProjectPermissionsStorageKey(PROJECT_ID)!,
    JSON.stringify({
      projectId: PROJECT_ID,
      permissions: [{ permission: Permission.ProjectOwner }],
    }),
  );
};

const unverifiedRow: () => UserTelegram = (): UserTelegram => {
  const row: UserTelegram = new UserTelegram();
  row.id = new ObjectID(ROW_ID);
  row.telegramUserHandle = "@alexchen";
  row.isVerified = false;
  return row;
};

// Lets the QR element's module load and its code be asked for.
const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  });
};

const lastCode: () => PendingCode = (): PendingCode => {
  return mockQRCodeImage.pending[mockQRCodeImage.pending.length - 1]!;
};

const drawCode: () => Promise<void> = async (): Promise<void> => {
  await settle();
  await act(async () => {
    lastCode().resolve(IMAGE);
  });
};

const failCode: () => Promise<void> = async (): Promise<void> => {
  await settle();
  await act(async () => {
    lastCode().reject(new Error("Loading chunk 412 failed."));
  });
};

// The table, and its unverified row's Verify pressed: the dialog open.
const openVerifyDialog: () => Promise<HTMLElement> =
  async (): Promise<HTMLElement> => {
    fireEvent.click(await screen.findByRole("button", { name: "Verify" }));

    return await screen.findByRole("dialog");
  };

/*
 * A screen whose main pointer is a finger - a phone or a tablet - as the
 * browser tells PrefersTouch ("(pointer: coarse)"). Any other query
 * matches nothing.
 */
const onATouchScreen: () => void = (): void => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      return {
        matches: query === "(pointer: coarse)",
        media: query,
        onchange: null,
        addListener: (): void => {},
        removeListener: (): void => {},
        addEventListener: (): void => {},
        removeEventListener: (): void => {},
        dispatchEvent: (): boolean => {
          return false;
        },
      } as MediaQueryList;
    },
  });
};

// Whether `first` comes before `second` in the page.
const isBefore: (first: Node, second: Node) => boolean = (
  first: Node,
  second: Node,
): boolean => {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
};

const closeDialog: (dialog: HTMLElement) => Promise<void> = async (
  dialog: HTMLElement,
): Promise<void> => {
  // The corner's X and the footer's Close both close it.
  fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]!);

  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
};

beforeEach(() => {
  mockQRCodeImage.pending = [];
  deepLink = FIRST_LINK;
  jest.spyOn(Logger, "error").mockImplementation(() => {});

  signInAsOwner();
  getCommonHeadersMock.mockReturnValue({});
  getListMock.mockImplementation(async (params: unknown) => {
    const isTelegram: boolean =
      (params as { modelType?: unknown }).modelType === UserTelegram;
    const rows: Array<UserTelegram> = isTelegram ? [unverifiedRow()] : [];

    return { data: rows, count: rows.length, skip: 0, limit: 50 };
  });
  // The bot's deep link, which Verify asks for before its dialog shows it.
  postMock.mockImplementation(async () => {
    return new HTTPResponse<JSONObject>(
      200,
      {
        verificationCode: "123456",
        telegramBotUsername: "oneuptime_bot",
        isVerified: false,
        deepLinkUrl: deepLink,
        startCommand: "/start 123456",
      },
      {},
    );
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  // Back to jsdom's own window, which has no matchMedia: a desktop.
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  getMock.mockReset();
  postMock.mockReset();
  getListMock.mockReset();
  getItemMock.mockReset();
  getCommonHeadersMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

describe("Telegram's Verify dialog: the QR code's caption", () => {
  test("a code that draws says to scan it on a phone", async () => {
    render(<TelegramMethods />);
    const dialog: HTMLElement = await openVerifyDialog();
    await drawCode();

    expect(lastCode().text).toBe(FIRST_LINK);
    expect(within(dialog).getByTestId("qr-code")).toHaveAttribute("src", IMAGE);
    expect(within(dialog).getByText(CAPTION)).toBeInTheDocument();
  });

  test("a code that cannot be drawn says so, with no caption to scan it, and the other ways in stay", async () => {
    render(<TelegramMethods />);
    const dialog: HTMLElement = await openVerifyDialog();
    await failCode();

    expect(within(dialog).getByRole("alert")).toHaveTextContent(QR_FAILED);
    expect(within(dialog).queryByText(CAPTION)).not.toBeInTheDocument();
    expect(
      within(dialog).queryByTestId("telegram-qr-caption"),
    ).not.toBeInTheDocument();

    // Open in Telegram, to the same deep link.
    expect(
      within(dialog).getByRole("link", { name: "Open in Telegram" }),
    ).toHaveAttribute("href", FIRST_LINK);
    // And the steps by hand.
    expect(
      within(dialog).getByText("Can't use either? Open Telegram manually:"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("@oneuptime_bot")).toBeInTheDocument();
    expect(within(dialog).getByText("/start 123456")).toBeInTheDocument();
  });

  test("keeps the caption while the code is still being drawn", async () => {
    render(<TelegramMethods />);
    const dialog: HTMLElement = await openVerifyDialog();
    await settle();

    expect(within(dialog).getByTestId("qr-code-loading")).toBeInTheDocument();
    expect(within(dialog).getByText(CAPTION)).toBeInTheDocument();
  });

  test("opened again, the code is drawn again, and captioned once it is", async () => {
    render(<TelegramMethods />);
    const first: HTMLElement = await openVerifyDialog();
    await failCode();

    expect(within(first).queryByText(CAPTION)).not.toBeInTheDocument();

    await closeDialog(first);

    // The connection is back: the same link's code draws this time.
    const second: HTMLElement = await openVerifyDialog();
    await drawCode();

    expect(lastCode().text).toBe(FIRST_LINK);
    expect(within(second).getByText(CAPTION)).toBeInTheDocument();
  });

  test("a new link, after the code is rotated, is drawn and captioned again", async () => {
    render(<TelegramMethods />);
    const first: HTMLElement = await openVerifyDialog();
    await failCode();
    await closeDialog(first);

    deepLink = ROTATED_LINK;

    const second: HTMLElement = await openVerifyDialog();
    await drawCode();

    expect(lastCode().text).toBe(ROTATED_LINK);
    expect(within(second).getByText(CAPTION)).toBeInTheDocument();
    expect(
      within(second).getByRole("link", { name: "Open in Telegram" }),
    ).toHaveAttribute("href", ROTATED_LINK);
  });
});

/*
 * ON A PHONE, OPEN IN TELEGRAM LEADS, AND NO CODE IS DRAWN (#10916).
 *
 * A phone cannot scan its own screen. Its dialog opened with a 192px code
 * and "Scan on phone to open Telegram", and Open in Telegram - the one way
 * in that works there - came under them, below the fold of a small screen.
 */
const INTRO: string =
  "To verify, message our bot in Telegram. Pick whichever option is easiest:";
const DESKTOP_HINT: string =
  "Works on desktop if you have Telegram Desktop installed, or via web.telegram.org.";
const BY_HAND_ON_A_DESKTOP: string =
  "Can't use either? Open Telegram manually:";
const BY_HAND_ON_A_PHONE: string =
  "Can't use the link? Open Telegram manually:";

describe("Telegram's Verify dialog on a phone and on a desktop", () => {
  test("a phone leads with Open in Telegram and draws no code, nor a caption to scan one", async () => {
    onATouchScreen();
    render(<TelegramMethods />);
    const dialog: HTMLElement = await openVerifyDialog();
    await settle();

    const link: HTMLElement = within(dialog).getByRole("link", {
      name: "Open in Telegram",
    });

    expect(link).toHaveAttribute("href", FIRST_LINK);
    // No code was even asked for, so none is drawn or loading.
    expect(mockQRCodeImage.pending).toEqual([]);
    expect(within(dialog).queryByTestId("telegram-qr")).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId("qr-code")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByTestId("qr-code-loading"),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText(CAPTION)).not.toBeInTheDocument();

    // It is the first way in after the sentence that offers them.
    const intro: HTMLElement = within(dialog).getByText(INTRO);
    const byHand: HTMLElement = within(dialog).getByText(BY_HAND_ON_A_PHONE);
    expect(isBefore(intro, link)).toBe(true);
    expect(isBefore(link, byHand)).toBe(true);
    expect(within(dialog).getAllByRole("link")[0]).toBe(link);
  });

  test("a phone keeps the steps by hand, says them of the one link it has, and not the desktop's hint", async () => {
    onATouchScreen();
    render(<TelegramMethods />);
    const dialog: HTMLElement = await openVerifyDialog();
    await settle();

    expect(within(dialog).getByText(BY_HAND_ON_A_PHONE)).toBeInTheDocument();
    // "Either" was the code and the link: a phone has only the link.
    expect(
      within(dialog).queryByText(BY_HAND_ON_A_DESKTOP),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText(DESKTOP_HINT)).not.toBeInTheDocument();
    expect(within(dialog).getByText("@oneuptime_bot")).toBeInTheDocument();
    expect(within(dialog).getByText("/start 123456")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", {
        name: "I've sent the message — check",
      }),
    ).toBeInTheDocument();
  });

  test("a desktop keeps the code and its caption first, then the link, its hint and the steps by hand", async () => {
    render(<TelegramMethods />);
    const dialog: HTMLElement = await openVerifyDialog();
    await drawCode();

    const code: HTMLElement = within(dialog).getByTestId("qr-code");
    const link: HTMLElement = within(dialog).getByRole("link", {
      name: "Open in Telegram",
    });

    expect(code).toHaveAttribute("src", IMAGE);
    expect(within(dialog).getByText(CAPTION)).toBeInTheDocument();
    expect(isBefore(code, link)).toBe(true);
    expect(within(dialog).getByText(DESKTOP_HINT)).toBeInTheDocument();
    expect(within(dialog).getByText(BY_HAND_ON_A_DESKTOP)).toBeInTheDocument();
    expect(
      within(dialog).queryByText(BY_HAND_ON_A_PHONE),
    ).not.toBeInTheDocument();
  });

  test.each([
    ["a phone", true],
    ["a desktop", false],
  ])(
    "on %s, Open in Telegram is the shared plain button, beside the dialog's one primary action",
    async (_screen: string, isTouch: boolean) => {
      if (isTouch) {
        onATouchScreen();
      }
      render(<TelegramMethods />);
      const dialog: HTMLElement = await openVerifyDialog();
      await settle();

      const link: HTMLElement = within(dialog).getByRole("link", {
        name: "Open in Telegram",
      });

      expect(link.className).toBe(OPEN_IN_TELEGRAM_CLASS_NAME);
      for (const token of `${BOXED_BUTTON_CLASS_NAME} ${
        BOXED_BUTTON_LOOK_CLASS_NAMES[ButtonStyleType.NORMAL]
      }`.split(" ")) {
        expect(link).toHaveClass(token);
      }
      // A finger's 44px, and none of the primary button's fill.
      expect(link).toHaveClass("[@media(pointer:coarse)]:min-h-11");
      expect(link).not.toHaveClass("bg-indigo-600");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");

      // The one primary action is the check.
      const filled: Array<Element> = Array.from(
        dialog.querySelectorAll(".bg-indigo-600"),
      );
      expect(filled).toHaveLength(1);
      expect(filled[0]).toHaveTextContent("I've sent the message — check");
    },
  );

  test("a page read from the right keeps the numbered steps' room at the start", async () => {
    onATouchScreen();
    render(<TelegramMethods />);
    const dialog: HTMLElement = await openVerifyDialog();
    await settle();

    const steps: HTMLElement = within(dialog).getByRole("list");
    expect(steps).toHaveClass("ps-5");
    expect(steps).not.toHaveClass("pl-5");
  });
});

/*
 * The phone's words are the Dashboard's, in every language it speaks: a
 * Persian or an Arabic page reads them from the right, Telegram's name as
 * written.
 */
describe("Telegram's Verify dialog on a phone, in the reader's language", () => {
  test.each([
    ["de", "Können Sie den Link nicht nutzen? Öffnen Sie Telegram manuell:"],
    ["fa", "نمی‌توانید از پیوند استفاده کنید؟ Telegram را دستی باز کنید:"],
    ["ar", "لا يمكنك استخدام الرابط؟ افتح Telegram يدويًا:"],
  ])("%s", async (language: string, byHand: string) => {
    const instance: i18n = createInstance();
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { [language]: { translation: readDashboardLocale(language) } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    onATouchScreen();
    render(
      <I18nextProvider i18n={instance}>
        <TelegramMethods />
      </I18nextProvider>,
    );

    const words: Record<string, string> = readDashboardLocale(language);
    fireEvent.click(
      await screen.findByRole("button", { name: words["Verify"] || "Verify" }),
    );
    const dialog: HTMLElement = await screen.findByRole("dialog");
    await settle();

    expect(within(dialog).getByText(byHand)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", {
        name: words["Open in Telegram"] || "Open in Telegram",
      }),
    ).toHaveAttribute("href", FIRST_LINK);
    expect(mockQRCodeImage.pending).toEqual([]);
  });
});
