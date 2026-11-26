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

/*
 * ADMIN DASHBOARD > SETTINGS > HELP AND SUPPORT (#10864, #10865, #10866).
 *
 * One page to point every support touchpoint at the server's own people.
 * It reads like a short checklist of what people see: a card per place,
 * a row per thing people meet there, each with where it appears, what it
 * does by default and what it does now, and one way to change it. Nothing
 * is changed until an admin changes it, and every value is checked here as
 * the server checks it: links take https, http and mailto only, the
 * message is plain text.
 *
 * The real page is rendered with the Admin Dashboard's English locale; only
 * its two routes (HelpAndSupportApi), the page chrome and the side menu are
 * stand-ins. The routes themselves are pinned in
 * Server/API/HelpAndSupportRoutes.test.ts.
 */

const mockFetch: MockFunction = getJestMockFunction();
const mockPost: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/HelpAndSupport/HelpAndSupportApi",
  () => {
    return {
      __esModule: true,
      fetchHelpAndSupport: (...args: Array<unknown>): unknown => {
        return mockFetch(...args);
      },
      postHelpItemChange: (...args: Array<unknown>): unknown => {
        return mockPost(...args);
      },
    };
  },
);

interface MockPageProps {
  title?: string | undefined;
  breadcrumbLinks?: Array<{ title: string; to: { toString: () => string } }>;
  children?: ReactNode | undefined;
}

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

import SettingsHelpAndSupport from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/HelpAndSupport/Index";
import {
  HELP_AND_SUPPORT_FROM_CONFIGURATION_TEST_ID,
  HELP_AND_SUPPORT_PAGE_TEST_ID,
  HELP_CARDS,
  HELP_ITEM_COPY,
  HelpAndSupportCopy,
  HelpCard,
  getHelpCardTestId,
  getHelpItemTestId,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/HelpAndSupport/HelpAndSupportCopy";
import PageMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/RouteMap";
import {
  DEFAULT_INVITE_MESSAGE,
  HELP_ITEMS,
  HelpAndSupportProblems,
  HelpAndSupportSettings,
  HelpChoice,
  HelpItem,
  HelpItemSetting,
  INVITE_MESSAGE_MAX_LENGTH,
  getDefaultHelpAndSupportSettings,
} from "../../../Types/HelpAndSupport/HelpAndSupport";
import { HelpAndSupportAnswer } from "../../../Types/HelpAndSupport/HelpAndSupportAnswer";
import { HelpAndSupportSeedProblems } from "../../../Types/HelpAndSupport/HelpAndSupportSeed";
import Toast from "../../../UI/Utils/Toast";

const ADMIN_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
);

const ENGLISH: Record<string, unknown> = JSON.parse(
  fs.readFileSync(path.join(ADMIN_SRC, "Locales", "en.json"), "utf8"),
) as Record<string, unknown>;

const answer: (
  changes?: Partial<Record<HelpItem, HelpItemSetting>>,
  extra?: Partial<HelpAndSupportAnswer>,
) => HelpAndSupportAnswer = (
  changes?: Partial<Record<HelpItem, HelpItemSetting>>,
  extra?: Partial<HelpAndSupportAnswer>,
): HelpAndSupportAnswer => {
  const settings: HelpAndSupportSettings = {
    ...getDefaultHelpAndSupportSettings(),
    ...(changes || {}),
  };

  return {
    settings: settings,
    isOneUptimeCloud: false,
    adminNotificationEmail: null,
    canSendEmail: true,
    isProductRenamed: false,
    seededItems: [],
    seedProblems: [],
    ...(extra || {}),
  };
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

async function renderPage(): Promise<void> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: ENGLISH } },
    interpolation: { escapeValue: false },
    keySeparator: ".",
  });

  render(
    <I18nextProvider i18n={instance}>
      <SettingsHelpAndSupport />
    </I18nextProvider>,
  );

  await flush();
}

const stateOf: (item: HelpItem) => string = (item: HelpItem): string => {
  return (
    screen.getByTestId(`${getHelpItemTestId(item)}-state`).textContent || ""
  );
};

const valueOf: (item: HelpItem) => string | null = (
  item: HelpItem,
): string | null => {
  return (
    screen.queryByTestId(`${getHelpItemTestId(item)}-value`)?.textContent ??
    null
  );
};

const openDialog: (item: HelpItem) => Promise<HTMLElement> = async (
  item: HelpItem,
): Promise<HTMLElement> => {
  fireEvent.click(screen.getByTestId(`${getHelpItemTestId(item)}-change`));
  await flush();

  return screen.getByTestId("modal");
};

const pick: (dialog: HTMLElement, title: string) => void = (
  dialog: HTMLElement,
  title: string,
): void => {
  fireEvent.click(
    within(dialog).getByRole("radio", { name: new RegExp(`^${title}`) }),
  );
};

const typeInto: (testId: string, value: string) => void = (
  testId: string,
  value: string,
): void => {
  const field: HTMLElement = screen.getByTestId(testId);
  const input: HTMLElement =
    field.tagName === "INPUT" || field.tagName === "TEXTAREA"
      ? field
      : (field.querySelector("input, textarea") as HTMLElement);

  fireEvent.change(input, { target: { value: value } });
};

const save: () => Promise<void> = async (): Promise<void> => {
  fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
  await flush();
};

const previewEntries: () => Array<string> = (): Array<string> => {
  return Array.from(
    screen
      .getByTestId("help-and-support-help-menu-preview")
      .querySelectorAll("li"),
  ).map((entry: Element): string => {
    return entry.textContent || "";
  });
};

beforeEach(() => {
  mockFetch.mockReset();
  mockPost.mockReset();
  mockPageRenders.length = 0;
  Toast.dismissAll();
});

afterEach(() => {
  cleanup();
  Toast.dismissAll();
});

describe("the page", () => {
  test("lives at /admin/settings/help-and-support, with a trail to it", async () => {
    mockFetch.mockResolvedValue(answer());
    await renderPage();

    expect(RouteMap[PageMap.SETTINGS_HELP_AND_SUPPORT]?.toString()).toBe(
      "/admin/settings/help-and-support",
    );

    const trail: Array<string> = (
      mockPageRenders[mockPageRenders.length - 1]?.breadcrumbLinks || []
    ).map((link: { title: string }): string => {
      return link.title;
    });

    expect(trail).toEqual(["Admin Dashboard", "Settings", "Help and Support"]);
  });

  test("a read that fails says so", async () => {
    mockFetch.mockRejectedValue(
      new Error("The help and support settings could not be read."),
    );
    await renderPage();

    expect(
      screen.getByText("The help and support settings could not be read."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(getHelpItemTestId(HelpItem.Chat))).toBeNull();
  });

  test("four cards, in the order people meet them, each listing its places", async () => {
    mockFetch.mockResolvedValue(answer());
    await renderPage();

    const page: HTMLElement = screen.getByTestId(HELP_AND_SUPPORT_PAGE_TEST_ID);
    const cards: Array<string | null> = Array.from(
      page.querySelectorAll("[data-testid^='help-and-support-card-']"),
    ).map((card: Element): string | null => {
      return card.getAttribute("data-testid");
    });

    expect(cards).toEqual(
      [
        HelpCard.HelpMenu,
        HelpCard.Footer,
        HelpCard.MobileApp,
        HelpCard.SignIn,
      ].map(getHelpCardTestId),
    );

    for (const card of HELP_CARDS) {
      const element: HTMLElement = screen.getByTestId(
        getHelpCardTestId(card.card),
      );

      expect(element).toHaveTextContent(card.title);
      expect(element).toHaveTextContent(card.description);
    }

    // Every place is on the page once, in the card of where it is.
    for (const item of HELP_ITEMS) {
      expect(
        within(
          screen.getByTestId(getHelpCardTestId(HELP_ITEM_COPY[item].card)),
        ).getByTestId(getHelpItemTestId(item)),
      ).toHaveTextContent(HELP_ITEM_COPY[item].where);
    }
    expect(
      within(screen.getByTestId(getHelpCardTestId(HelpCard.HelpMenu)))
        .getAllByTestId(
          /^help-and-support-(supportEmail|chat|requestDemo|giveFeedback)$/,
        )
        .map((element: HTMLElement): string | null => {
          return element.getAttribute("data-testid");
        }),
    ).toEqual([
      getHelpItemTestId(HelpItem.SupportEmail),
      getHelpItemTestId(HelpItem.Chat),
      getHelpItemTestId(HelpItem.RequestDemo),
      getHelpItemTestId(HelpItem.GiveFeedback),
    ]);
  });
});

describe("on the defaults: each place says what it does, as it always did", () => {
  test("every place reads Default, with what the default is", async () => {
    mockFetch.mockResolvedValue(answer());
    await renderPage();

    for (const item of HELP_ITEMS) {
      expect({ item, state: stateOf(item) }).toEqual({
        item,
        state: "Default",
      });
    }

    expect(valueOf(HelpItem.SupportEmail)).toBe("support@oneuptime.com");
    expect(valueOf(HelpItem.Chat)).toBe("OneUptime's community on Slack");
    expect(valueOf(HelpItem.HelpLink)).toBe("oneuptime.com/support");
    expect(valueOf(HelpItem.MobileApp)).toBe(
      "OneUptime On-Call, from the App Store and Google Play",
    );
    expect(valueOf(HelpItem.GiveFeedback)).toBe(
      "This server's admins, in Admin Dashboard › Feedback",
    );
  });

  test("Give feedback's default names where it goes on this server", async () => {
    mockFetch.mockResolvedValue(
      answer({}, { adminNotificationEmail: "ops@example.com" }),
    );
    await renderPage();
    expect(valueOf(HelpItem.GiveFeedback)).toBe(
      "This server's admins, at ops@example.com",
    );
    cleanup();

    mockFetch.mockResolvedValue(answer({}, { isOneUptimeCloud: true }));
    await renderPage();
    expect(valueOf(HelpItem.GiveFeedback)).toBe(
      "The OneUptime team, at support@oneuptime.com",
    );
  });

  test("on a server with a name of its own, the footer's default says it is not shown", async () => {
    mockFetch.mockResolvedValue(answer({}, { isProductRenamed: true }));
    await renderPage();

    expect(valueOf(HelpItem.HelpLink)).toBe(
      "Not shown while this server goes by its own name.",
    );
  });

  test("Request Demo and OneUptime's GitHub are switches, on", async () => {
    mockFetch.mockResolvedValue(answer());
    await renderPage();

    for (const item of [HelpItem.RequestDemo, HelpItem.GitHub]) {
      const toggle: HTMLElement = screen.getByTestId(
        `${getHelpItemTestId(item)}-switch`,
      );

      expect(toggle).toHaveAttribute("role", "switch");
      expect(toggle).toHaveAttribute("aria-checked", "true");
      expect(
        screen.queryByTestId(`${getHelpItemTestId(item)}-change`),
      ).toBeNull();
    }

    // Every other place is changed in a dialog.
    for (const item of HELP_ITEMS.filter((candidate: HelpItem): boolean => {
      return (
        candidate !== HelpItem.RequestDemo && candidate !== HelpItem.GitHub
      );
    })) {
      expect(
        screen.getByTestId(`${getHelpItemTestId(item)}-change`),
      ).toHaveTextContent("Change");
    }
  });

  test("the previews show the Help menu and the sign-in screen as people see them", async () => {
    mockFetch.mockResolvedValue(answer());
    await renderPage();

    expect(previewEntries()).toEqual([
      "Give feedback",
      "Keyboard shortcuts",
      "Support Email",
      "Chat on Slack",
      "Request Demo",
    ]);

    const signIn: HTMLElement = screen.getByTestId(
      "help-and-support-sign-in-preview",
    );

    expect(signIn).toHaveTextContent("You need to be invited.");
    expect(
      screen.getByTestId("help-and-support-sign-in-preview-message"),
    ).toHaveTextContent(DEFAULT_INVITE_MESSAGE);
  });
});

describe("pointed at the server's own people", () => {
  const OWN: Partial<Record<HelpItem, HelpItemSetting>> = {
    [HelpItem.SupportEmail]: {
      choice: HelpChoice.Email,
      value: "it-help@example.com",
    },
    [HelpItem.Chat]: {
      choice: HelpChoice.Link,
      value: "https://teams.microsoft.com/l/channel/19%3aabc/Help",
    },
    [HelpItem.GiveFeedback]: {
      choice: HelpChoice.Link,
      value: "https://help.example.com/feedback",
    },
    [HelpItem.HelpLink]: {
      choice: HelpChoice.Link,
      value: "https://help.example.com/oneuptime",
    },
    [HelpItem.MobileApp]: {
      choice: HelpChoice.Link,
      value: "https://apps.example.com/oneuptime",
    },
    [HelpItem.InviteMessage]: {
      choice: HelpChoice.Text,
      value:
        "Ask the IT service desk to invite you:\nit-help@example.com or https://help.example.com/access",
    },
  };

  test("each reads Your Own, with its address or link as written", async () => {
    mockFetch.mockResolvedValue(answer(OWN));
    await renderPage();

    for (const item of [
      HelpItem.SupportEmail,
      HelpItem.Chat,
      HelpItem.GiveFeedback,
      HelpItem.HelpLink,
      HelpItem.MobileApp,
      HelpItem.InviteMessage,
    ]) {
      expect({ item, state: stateOf(item) }).toEqual({
        item,
        state: "Your Own",
      });
    }

    expect(valueOf(HelpItem.SupportEmail)).toBe("it-help@example.com");
    expect(valueOf(HelpItem.Chat)).toBe(
      "https://teams.microsoft.com/l/channel/19%3aabc/Help",
    );
    // Give feedback's page is named by its address.
    expect(valueOf(HelpItem.GiveFeedback)).toBe("Opens help.example.com");
    expect(valueOf(HelpItem.HelpLink)).toBe(
      "https://help.example.com/oneuptime",
    );
    // Addresses read left to right, in any language.
    expect(
      screen.getByTestId(`${getHelpItemTestId(HelpItem.SupportEmail)}-value`),
    ).toHaveAttribute("dir", "ltr");
  });

  test("the previews follow: a Microsoft Teams chat, and the server's own message with its links", async () => {
    mockFetch.mockResolvedValue(answer(OWN));
    await renderPage();

    expect(previewEntries()).toEqual([
      "Give feedback",
      "Keyboard shortcuts",
      "Support Email",
      "Chat on Microsoft Teams",
      "Request Demo",
    ]);

    const message: HTMLElement = screen.getByTestId(
      "help-and-support-sign-in-preview-message",
    );

    expect(message.querySelectorAll("p")).toHaveLength(2);
    expect(message).toHaveTextContent("Ask the IT service desk to invite you:");
    expect(message).not.toHaveTextContent(DEFAULT_INVITE_MESSAGE);
    // A picture of the screen: its links are drawn as links, and open nothing.
    expect(message.querySelectorAll("a")).toHaveLength(0);
    expect(within(message).getByText("it-help@example.com")).toHaveClass(
      "underline",
    );
  });

  test("hidden reads Hidden, and the preview leaves it out", async () => {
    mockFetch.mockResolvedValue(
      answer({
        [HelpItem.SupportEmail]: { choice: HelpChoice.Hidden, value: null },
        [HelpItem.Chat]: { choice: HelpChoice.Hidden, value: null },
        [HelpItem.RequestDemo]: { choice: HelpChoice.Hidden, value: null },
        [HelpItem.GiveFeedback]: { choice: HelpChoice.Hidden, value: null },
      }),
    );
    await renderPage();

    for (const item of [
      HelpItem.SupportEmail,
      HelpItem.Chat,
      HelpItem.RequestDemo,
      HelpItem.GiveFeedback,
    ]) {
      expect({ item, state: stateOf(item) }).toEqual({ item, state: "Hidden" });
    }
    expect(previewEntries()).toEqual(["Keyboard shortcuts"]);
    expect(
      screen.getByTestId(`${getHelpItemTestId(HelpItem.RequestDemo)}-switch`),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("Give feedback to an address this server cannot email yet: said on its row, and left out of the preview", async () => {
    mockFetch.mockResolvedValue(
      answer(
        {
          [HelpItem.GiveFeedback]: {
            choice: HelpChoice.Email,
            value: "it-help@example.com",
          },
        },
        { canSendEmail: false },
      ),
    );
    await renderPage();

    expect(
      screen.getByTestId(
        `${getHelpItemTestId(HelpItem.GiveFeedback)}-cannot-send`,
      ),
    ).toHaveTextContent(HelpAndSupportCopy.feedbackCannotSend);
    expect(previewEntries()).not.toContain("Give feedback");
  });
});

describe("changing a place", () => {
  test("Change opens its choices, the current one picked, each with what it does", async () => {
    mockFetch.mockResolvedValue(answer());
    await renderPage();

    const dialog: HTMLElement = await openDialog(HelpItem.SupportEmail);

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "Support Email",
    );
    expect(within(dialog).getByTestId("modal-description")).toHaveTextContent(
      HELP_ITEM_COPY[HelpItem.SupportEmail].where,
    );

    const radios: Array<HTMLElement> = within(dialog).getAllByRole("radio");

    expect(
      radios.map((radio: HTMLElement): string => {
        return (radio.closest("div")?.textContent || "").trim();
      }),
    ).toEqual(["Defaultsupport@oneuptime.com", "Your own address", "Hide it"]);
    expect(radios[0]).toBeChecked();
    // No field until a choice needs one.
    expect(
      screen.queryByTestId("help-and-support-dialog-email-input"),
    ).toBeNull();
  });

  test("an address of the server's own is saved as typed, and the page shows what the server kept", async () => {
    mockFetch.mockResolvedValue(answer());
    mockPost.mockResolvedValue(
      answer({
        [HelpItem.SupportEmail]: {
          choice: HelpChoice.Email,
          value: "it-help@example.com",
        },
      }),
    );
    await renderPage();

    const dialog: HTMLElement = await openDialog(HelpItem.SupportEmail);

    pick(dialog, "Your own address");
    typeInto("help-and-support-dialog-email-input", "it-help@example.com");
    await save();

    expect(mockPost).toHaveBeenCalledWith({
      item: HelpItem.SupportEmail,
      choice: HelpChoice.Email,
      value: "it-help@example.com",
    });
    expect(screen.queryByTestId("modal")).toBeNull();
    expect(stateOf(HelpItem.SupportEmail)).toBe("Your Own");
    expect(valueOf(HelpItem.SupportEmail)).toBe("it-help@example.com");
    expect(
      Toast.getToasts().map(
        (toast: { title?: unknown; description?: unknown }) => {
          return String(toast.title ?? toast.description);
        },
      ),
    ).toContain("Saved");
  });

  test("Hide it sends no value, and back to Default sends none either", async () => {
    mockFetch.mockResolvedValue(
      answer({
        [HelpItem.Chat]: {
          choice: HelpChoice.Link,
          value: "https://chat.example.com/help",
        },
      }),
    );
    mockPost.mockResolvedValue(
      answer({ [HelpItem.Chat]: { choice: HelpChoice.Hidden, value: null } }),
    );
    await renderPage();

    let dialog: HTMLElement = await openDialog(HelpItem.Chat);

    // The link kept is filled in.
    expect(
      (
        screen
          .getByTestId("help-and-support-dialog-link-input")
          .closest("div")
          ?.querySelector("input") as HTMLInputElement
      ).value,
    ).toBe("https://chat.example.com/help");

    pick(dialog, "Hide it");
    await save();

    expect(mockPost).toHaveBeenLastCalledWith({
      item: HelpItem.Chat,
      choice: HelpChoice.Hidden,
      value: null,
    });
    expect(stateOf(HelpItem.Chat)).toBe("Hidden");

    mockPost.mockResolvedValue(answer());
    dialog = await openDialog(HelpItem.Chat);
    pick(dialog, "Default");
    await save();

    expect(mockPost).toHaveBeenLastCalledWith({
      item: HelpItem.Chat,
      choice: HelpChoice.Default,
      value: null,
    });
    expect(stateOf(HelpItem.Chat)).toBe("Default");
  });

  test.each([
    [
      "javascript:",
      "javascript:alert(document.cookie)",
      HelpAndSupportProblems.linkScheme,
    ],
    [
      "data:",
      "data:text/html,<script>alert(1)</script>",
      HelpAndSupportProblems.linkScheme,
    ],
    [
      "a scheme written in parts",
      "java\tscript:alert(1)",
      HelpAndSupportProblems.linkScheme,
    ],
    ["vbscript:", "vbscript:msgbox(1)", HelpAndSupportProblems.linkScheme],
    [
      "a link with quotes",
      'https://help.example.com/"onmouseover="x',
      HelpAndSupportProblems.linkInvalid,
    ],
    ["nothing", "", HelpAndSupportProblems.linkMissing],
  ])(
    "a link that is %s is refused before anything is sent, and says why",
    async (_name: string, link: string, problem: string) => {
      mockFetch.mockResolvedValue(answer());
      await renderPage();

      const dialog: HTMLElement = await openDialog(HelpItem.HelpLink);

      pick(dialog, "Your own link");
      typeInto("help-and-support-dialog-link-input", link);
      await save();

      expect(mockPost).not.toHaveBeenCalled();
      expect(within(dialog).getByText(problem)).toBeInTheDocument();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    },
  );

  test.each([
    ["with a name", "IT Help <it-help@example.com>"],
    ["with no domain", "it-help"],
    ["two addresses", "a@example.com, b@example.com"],
  ])(
    "an address %s is refused before anything is sent",
    async (_name: string, email: string) => {
      mockFetch.mockResolvedValue(answer());
      await renderPage();

      const dialog: HTMLElement = await openDialog(HelpItem.SupportEmail);

      pick(dialog, "Your own address");
      typeInto("help-and-support-dialog-email-input", email);
      await save();

      expect(mockPost).not.toHaveBeenCalled();
      expect(
        within(dialog).getByText(HelpAndSupportProblems.emailInvalid),
      ).toBeInTheDocument();
    },
  );

  test("a refusal from the server is said in the dialog, which stays open with what was typed", async () => {
    mockFetch.mockResolvedValue(answer());
    mockPost.mockRejectedValue(new Error(HelpAndSupportProblems.linkScheme));
    await renderPage();

    const dialog: HTMLElement = await openDialog(HelpItem.MobileApp);

    pick(dialog, "Your own link");
    typeInto(
      "help-and-support-dialog-link-input",
      "https://apps.example.com/oneuptime",
    );
    await save();

    expect(
      within(dialog).getByText(HelpAndSupportProblems.linkScheme),
    ).toBeInTheDocument();
    expect(screen.getByTestId("modal")).toBeInTheDocument();
    expect(stateOf(HelpItem.MobileApp)).toBe("Default");
  });

  test("Give feedback names its choices by what they are, and warns when the server cannot email yet", async () => {
    mockFetch.mockResolvedValue(answer({}, { canSendEmail: false }));
    await renderPage();

    const dialog: HTMLElement = await openDialog(HelpItem.GiveFeedback);

    expect(dialog).toHaveTextContent("An email address");
    expect(dialog).toHaveTextContent(
      HelpAndSupportCopy.feedbackChoiceEmailDescription,
    );
    expect(dialog).toHaveTextContent("A page of your own");
    expect(dialog).toHaveTextContent(
      HelpAndSupportCopy.feedbackChoiceLinkDescription,
    );
    expect(dialog).toHaveTextContent("Hide Give feedback");

    pick(dialog, "An email address");

    expect(
      screen.getByTestId("help-and-support-dialog-cannot-send"),
    ).toHaveTextContent(HelpAndSupportCopy.feedbackCannotSend);
  });

  test("the sign-in message: plain text, cut at 1000 characters, and markup refused", async () => {
    mockFetch.mockResolvedValue(answer());
    await renderPage();

    const dialog: HTMLElement = await openDialog(HelpItem.InviteMessage);

    // The default is the sentence the screen says now.
    expect(dialog).toHaveTextContent(DEFAULT_INVITE_MESSAGE);

    pick(dialog, "Your own message");
    expect(dialog).toHaveTextContent(HelpAndSupportCopy.messageHint);

    const textarea: HTMLTextAreaElement = (screen
      .getByTestId("help-and-support-dialog-text-input")
      .closest("div")
      ?.querySelector("textarea") ||
      screen.getByTestId(
        "help-and-support-dialog-text-input",
      )) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "x".repeat(1500) } });
    expect(textarea.value).toHaveLength(INVITE_MESSAGE_MAX_LENGTH);

    fireEvent.change(textarea, {
      target: { value: "Ask IT <script>alert(1)</script>" },
    });
    await save();

    expect(mockPost).not.toHaveBeenCalled();
    expect(
      within(dialog).getByText(HelpAndSupportProblems.textHtml),
    ).toBeInTheDocument();
  });

  test("the sign-in message of the server's own is saved as written", async () => {
    const message: string =
      "Ask the IT service desk to invite you: it-help@example.com";
    mockFetch.mockResolvedValue(answer());
    mockPost.mockResolvedValue(
      answer({
        [HelpItem.InviteMessage]: { choice: HelpChoice.Text, value: message },
      }),
    );
    await renderPage();

    const dialog: HTMLElement = await openDialog(HelpItem.InviteMessage);

    pick(dialog, "Your own message");
    typeInto("help-and-support-dialog-text-input", message);
    await save();

    expect(mockPost).toHaveBeenCalledWith({
      item: HelpItem.InviteMessage,
      choice: HelpChoice.Text,
      value: message,
    });
    expect(
      screen.getByTestId("help-and-support-sign-in-preview-message"),
    ).toHaveTextContent(message);
  });
});

describe("the switches save as they are flipped", () => {
  test("Request Demo off: hidden at once, and said", async () => {
    mockFetch.mockResolvedValue(answer());
    mockPost.mockResolvedValue(
      answer({
        [HelpItem.RequestDemo]: { choice: HelpChoice.Hidden, value: null },
      }),
    );
    await renderPage();

    fireEvent.click(
      screen.getByTestId(`${getHelpItemTestId(HelpItem.RequestDemo)}-switch`),
    );
    await flush();

    expect(mockPost).toHaveBeenCalledWith({
      item: HelpItem.RequestDemo,
      choice: HelpChoice.Hidden,
      value: null,
    });
    expect(stateOf(HelpItem.RequestDemo)).toBe("Hidden");
    expect(previewEntries()).not.toContain("Request Demo");
  });

  test("OneUptime's GitHub back on: the default again", async () => {
    mockFetch.mockResolvedValue(
      answer({ [HelpItem.GitHub]: { choice: HelpChoice.Hidden, value: null } }),
    );
    mockPost.mockResolvedValue(answer());
    await renderPage();

    fireEvent.click(
      screen.getByTestId(`${getHelpItemTestId(HelpItem.GitHub)}-switch`),
    );
    await flush();

    expect(mockPost).toHaveBeenCalledWith({
      item: HelpItem.GitHub,
      choice: HelpChoice.Default,
      value: null,
    });
    expect(stateOf(HelpItem.GitHub)).toBe("Default");
  });

  test("a flip the server refuses says why, and the switch stays as it was", async () => {
    mockFetch.mockResolvedValue(answer());
    mockPost.mockRejectedValue(
      new Error("Only master admins may change this."),
    );
    await renderPage();

    fireEvent.click(
      screen.getByTestId(`${getHelpItemTestId(HelpItem.RequestDemo)}-switch`),
    );
    await flush();

    expect(stateOf(HelpItem.RequestDemo)).toBe("Default");
    expect(
      Toast.getToasts()
        .map((toast: { title?: unknown; description?: unknown }) => {
          return `${String(toast.title ?? "")} ${String(toast.description ?? "")}`;
        })
        .join(" "),
    ).toContain("Only master admins may change this.");
  });
});

describe("the words the page draws", () => {
  test("are the Admin Dashboard's English, every one of them", () => {
    const keys: Array<string> = [
      ...Object.values(HelpAndSupportCopy),
      ...Object.values(HELP_ITEM_COPY).flatMap(
        (copy: { title: string; where: string }): Array<string> => {
          return [copy.title, copy.where];
        },
      ),
      ...Object.values(HelpAndSupportProblems),
      ...Object.values(HelpAndSupportSeedProblems),
    ];

    for (const key of keys) {
      expect({ key, english: ENGLISH[key] }).toEqual({ key, english: key });
    }
  });
});

/*
 * WHAT CAME FROM THE SERVER'S CONFIGURATION (#10938). The Helm chart's
 * helpAndSupport values, or config.env's HELP_AND_SUPPORT_*, set these
 * settings while nothing was saved here. The page says so once, above the
 * cards, and on each place set so, by its variable, until an admin changes
 * that place; and each value the configuration sets that was refused, with
 * why. A server whose configuration sets nothing shows none of it.
 */
describe("what came from the server's configuration", () => {
  const seeded: () => HelpAndSupportAnswer = (): HelpAndSupportAnswer => {
    return answer(
      {
        [HelpItem.SupportEmail]: {
          choice: HelpChoice.Email,
          value: "it-help@example.com",
        },
        [HelpItem.GitHub]: { choice: HelpChoice.Hidden, value: null },
      },
      { seededItems: [HelpItem.SupportEmail, HelpItem.GitHub] },
    );
  };

  test("a server whose configuration sets nothing shows none of it", async () => {
    mockFetch.mockResolvedValue(answer());
    await renderPage();

    expect(
      screen.queryByTestId(HELP_AND_SUPPORT_FROM_CONFIGURATION_TEST_ID),
    ).toBeNull();

    for (const item of HELP_ITEMS) {
      expect(
        screen.queryByTestId(`${getHelpItemTestId(item)}-from-configuration`),
      ).toBeNull();
    }
  });

  test("says once, above the cards, that a change made here is kept", async () => {
    mockFetch.mockResolvedValue(seeded());
    await renderPage();

    const notice: HTMLElement = screen.getByTestId(
      HELP_AND_SUPPORT_FROM_CONFIGURATION_TEST_ID,
    );

    expect(notice).toHaveTextContent(HelpAndSupportCopy.fromConfigurationTitle);
    expect(notice).toHaveTextContent(
      HelpAndSupportCopy.fromConfigurationDescription,
    );
    expect(notice).toHaveAttribute("role", "note");

    // Above every card.
    const page: HTMLElement = screen.getByTestId(HELP_AND_SUPPORT_PAGE_TEST_ID);
    const firstCard: HTMLElement = screen.getByTestId(
      getHelpCardTestId(HELP_CARDS[0]!.card),
    );

    expect(page.firstElementChild).toBe(notice);
    expect(
      notice.compareDocumentPosition(firstCard) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("each place set from it names its variable, and only those places", async () => {
    mockFetch.mockResolvedValue(seeded());
    await renderPage();

    expect(
      screen.getByTestId(
        `${getHelpItemTestId(HelpItem.SupportEmail)}-from-configuration`,
      ),
    ).toHaveTextContent(
      "Set from HELP_AND_SUPPORT_SUPPORT_EMAIL (helpAndSupport.supportEmail) in this server's configuration.",
    );
    // Named by its config.env variable and its Helm value: either may have set it.
    expect(
      screen.getByTestId(
        `${getHelpItemTestId(HelpItem.GitHub)}-from-configuration`,
      ),
    ).toHaveTextContent(
      "Set from HELP_AND_SUPPORT_GITHUB (helpAndSupport.gitHub) in this server's configuration.",
    );

    for (const item of HELP_ITEMS) {
      if (item === HelpItem.SupportEmail || item === HelpItem.GitHub) {
        continue;
      }

      expect(
        screen.queryByTestId(`${getHelpItemTestId(item)}-from-configuration`),
      ).toBeNull();
    }

    // The place still reads as it always does: its pill and its value.
    expect(stateOf(HelpItem.SupportEmail)).toBe("Your Own");
    expect(valueOf(HelpItem.SupportEmail)).toBe("it-help@example.com");
  });

  test("a place an admin changes is their own from then on: its line goes", async () => {
    mockFetch.mockResolvedValue(seeded());
    mockPost.mockResolvedValue(
      answer(
        {
          [HelpItem.SupportEmail]: {
            choice: HelpChoice.Email,
            value: "desk@example.com",
          },
          [HelpItem.GitHub]: { choice: HelpChoice.Hidden, value: null },
        },
        { seededItems: [HelpItem.GitHub] },
      ),
    );
    await renderPage();

    const dialog: HTMLElement = await openDialog(HelpItem.SupportEmail);

    typeInto("help-and-support-dialog-email-input", "desk@example.com");
    await save();

    expect(
      screen.queryByTestId(
        `${getHelpItemTestId(HelpItem.SupportEmail)}-from-configuration`,
      ),
    ).toBeNull();
    expect(
      screen.getByTestId(
        `${getHelpItemTestId(HelpItem.GitHub)}-from-configuration`,
      ),
    ).toBeInTheDocument();
    expect(valueOf(HelpItem.SupportEmail)).toBe("desk@example.com");
    expect(dialog).not.toBeInTheDocument();
  });

  test("the last place changed takes the notice away", async () => {
    mockFetch.mockResolvedValue(
      answer(
        { [HelpItem.GitHub]: { choice: HelpChoice.Hidden, value: null } },
        { seededItems: [HelpItem.GitHub] },
      ),
    );
    mockPost.mockResolvedValue(answer());
    await renderPage();

    expect(
      screen.getByTestId(HELP_AND_SUPPORT_FROM_CONFIGURATION_TEST_ID),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId(`${getHelpItemTestId(HelpItem.GitHub)}-switch`),
    );
    await flush();

    expect(
      screen.queryByTestId(HELP_AND_SUPPORT_FROM_CONFIGURATION_TEST_ID),
    ).toBeNull();
  });

  test("a value the configuration sets that was refused is said, with why, in the page's words", async () => {
    mockFetch.mockResolvedValue(
      answer(
        {},
        {
          seedProblems: [
            {
              item: HelpItem.Chat,
              variable: "HELP_AND_SUPPORT_CHAT",
              problem: HelpAndSupportProblems.linkScheme,
            },
            {
              item: HelpItem.RequestDemo,
              variable: "HELP_AND_SUPPORT_REQUEST_DEMO",
              problem: HelpAndSupportSeedProblems.notShownOrHidden,
            },
          ],
        },
      ),
    );
    await renderPage();

    const notice: HTMLElement = screen.getByTestId(
      HELP_AND_SUPPORT_FROM_CONFIGURATION_TEST_ID,
    );

    expect(notice).toHaveTextContent(HelpAndSupportCopy.fromConfigurationTitle);
    // Nothing was seeded, so it says nothing about what was.
    expect(
      screen.queryByTestId(
        `${HELP_AND_SUPPORT_FROM_CONFIGURATION_TEST_ID}-description`,
      ),
    ).toBeNull();
    expect(
      screen.getByTestId(
        `${HELP_AND_SUPPORT_FROM_CONFIGURATION_TEST_ID}-chat-not-used`,
      ),
    ).toHaveTextContent(
      `HELP_AND_SUPPORT_CHAT (helpAndSupport.chat) in this server's configuration was not used: ${HelpAndSupportProblems.linkScheme}`,
    );
    expect(
      screen.getByTestId(
        `${HELP_AND_SUPPORT_FROM_CONFIGURATION_TEST_ID}-requestDemo-not-used`,
      ),
    ).toHaveTextContent('Use "shown" or "hidden".');
  });

  test("in the admin's language: German, the variable as written", async () => {
    const GERMAN: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(ADMIN_SRC, "Locales", "de.json"), "utf8"),
    ) as Record<string, unknown>;
    const instance: i18n = createInstance();

    await instance.init({
      lng: "de",
      fallbackLng: "en",
      resources: {
        en: { translation: ENGLISH },
        de: { translation: GERMAN },
      },
      interpolation: { escapeValue: false },
      keySeparator: ".",
    });

    mockFetch.mockResolvedValue(seeded());

    render(
      <I18nextProvider i18n={instance}>
        <SettingsHelpAndSupport />
      </I18nextProvider>,
    );
    await flush();

    expect(
      screen.getByTestId(HELP_AND_SUPPORT_FROM_CONFIGURATION_TEST_ID),
    ).toHaveTextContent("Aus der Konfiguration dieses Servers");
    expect(
      screen.getByTestId(
        `${getHelpItemTestId(HelpItem.SupportEmail)}-from-configuration`,
      ),
    ).toHaveTextContent(
      "Aus HELP_AND_SUPPORT_SUPPORT_EMAIL (helpAndSupport.supportEmail) in der Konfiguration dieses Servers gesetzt.",
    );
  });
});
