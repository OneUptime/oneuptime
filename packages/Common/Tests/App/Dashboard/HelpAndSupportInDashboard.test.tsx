import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * WHERE THE SERVER SENDS ITS PEOPLE FOR HELP, IN THE DASHBOARD AND ON THE
 * SIGN-IN PAGES (Admin Dashboard > Settings > Help and Support, #10864-#10866).
 *
 * Each place, on the defaults - exactly as it was before the settings page
 * existed, which is what OneUptime Cloud and every server that never saved
 * the page shows - pointed at the server's own people, and hidden:
 *
 *   - Help: Support Email, the chat entry (Slack, Microsoft Teams or any
 *     other chat, named for what it opens) and Request Demo;
 *   - the footer's Help and Support link, and Contact on the sign-in pages;
 *   - Give feedback's public GitHub issue;
 *   - Page not found's Contact Support;
 *   - Project Settings > Mobile Apps, in the menu and on the page.
 *
 * Give feedback in Help, Search and its dialog is pinned in
 * ProductFeedbackInDashboard.test.tsx; the mobile app's prompts beside
 * their own suites (MemberFirstSteps, MobileAppCodes, PushDevicesCriticalAlerts,
 * HowToReachMe, OnCallGuidedSetup); the products menu's GitHub link in
 * DashboardCommandPalette.test.tsx.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          if (typeof options === "string") {
            return options;
          }

          if (
            options &&
            typeof options === "object" &&
            typeof (options as { defaultValue?: unknown }).defaultValue ===
              "string"
          ) {
            return (options as { defaultValue: string }).defaultValue;
          }

          return key;
        },
        i18n: { resolvedLanguage: "en", language: "en" },
      };
    },
  };
});

// The edition pill fetches the license on mount; here it only has to be seen.
jest.mock("../../../UI/Components/EditionLabel/EditionLabel", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <span data-testid="edition-label" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/LanguageSwitcher/LanguageSwitcher",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <span data-testid="language-switcher" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Accounts/src/Components/LanguageSwitcher/LanguageSwitcher",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <span data-testid="language-switcher" />;
      },
    };
  },
);

// Page not found's frame: the page itself is what is read.
jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { children?: ReactElement }): ReactElement => {
      return <div data-testid="page">{props.children}</div>;
    },
  };
});

import Help, {
  CHAT_WITH_SUPPORT_TITLE,
  CHAT_WITH_TEAMS_TITLE,
  HELP_ASK_GROUP_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Header/Help";
import DashboardFooter from "../../../../App/FeatureSet/Dashboard/src/Components/Footer/Footer";
import AccountsFooter from "../../../../App/FeatureSet/Accounts/src/Components/Footer/Footer";
import FeedbackGitHubLink, {
  FEEDBACK_GITHUB_HINT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Feedback/FeedbackGitHubLink";
import PageNotFound from "../../../../App/FeatureSet/Dashboard/src/Pages/PageNotFound/PageNotFound";
import SettingsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu";
import MobileApps, {
  MOBILE_APPS_PAGE_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/MobileApps";
import {
  MOBILE_APP_ANDROID_URL,
  MOBILE_APP_IOS_URL,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/MobileAppStoreLinks";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  HelpAndSupportSettings,
  HelpChoice,
  HelpItem,
  ONEUPTIME_CHAT_URL,
  ONEUPTIME_DEMO_URL,
  ONEUPTIME_HELP_URL,
} from "../../../Types/HelpAndSupport/HelpAndSupport";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  forgetHelpAndSupport,
  helpAndSupportWith,
  setHelpAndSupportEnvironment,
  setSignedInHelpAndSupport,
} from "../../Helpers/HelpAndSupportEnvironment";

const PROJECT_ID: string = "65f00000000000000000cafe";

const OWN_CHAT: Record<string, string> = {
  slack: "https://acme-it.slack.com/archives/C0123456789",
  teams: "https://teams.microsoft.com/l/channel/19%3aabc%40thread.tacv2/Help",
  other: "https://chat.example.com/channel/oneuptime-help",
};

const setBranding: (value: string | null) => void = (
  value: string | null,
): void => {
  const browserWindow: { process?: { env?: Record<string, unknown> } } =
    window as unknown as { process?: { env?: Record<string, unknown> } };

  browserWindow.process = browserWindow.process || {};
  browserWindow.process.env = browserWindow.process.env || {};

  if (value === null) {
    delete browserWindow.process.env["PRODUCT_BRANDING"];
  } else {
    browserWindow.process.env["PRODUCT_BRANDING"] = value;
  }
};

// Every link the page draws, as the address it goes to.
const linkAddresses: (element?: HTMLElement) => Array<string> = (
  element?: HTMLElement,
): Array<string> => {
  return Array.from(
    (element || document.body).querySelectorAll("a[href]"),
  ).map((anchor: Element): string => {
    return anchor.getAttribute("href") || "";
  });
};

beforeEach(() => {
  forgetHelpAndSupport();
});

afterEach(() => {
  cleanup();
  forgetHelpAndSupport();
  setBranding(null);
  jest.restoreAllMocks();
});

describe("Help: the ways to ask", () => {
  const openHelp: () => HTMLElement = (): HTMLElement => {
    render(<Help />);
    fireEvent.click(screen.getByRole("button", { name: "help.label" }));

    return screen.getByTestId(HELP_ASK_GROUP_TEST_ID);
  };

  test("by default: OneUptime's support address, its community Slack and a demo, as always", () => {
    const ask: HTMLElement = openHelp();

    expect(linkAddresses(ask)).toEqual([
      "mailto:support@oneuptime.com",
      ONEUPTIME_CHAT_URL,
      ONEUPTIME_DEMO_URL,
    ]);
    expect(ask).toHaveTextContent("help.supportEmail");
    expect(ask).toHaveTextContent("help.chatSlack");
    expect(ask).toHaveTextContent("help.requestDemo");
    // Each opens apart from the Dashboard.
    for (const link of Array.from(ask.querySelectorAll("a[href]"))) {
      expect(link).toHaveAttribute("target", "_blank");
    }
  });

  test("pointed at the server's own people: their address and their chat, and no demo", () => {
    setSignedInHelpAndSupport(
      helpAndSupportWith({
        [HelpItem.SupportEmail]: {
          choice: HelpChoice.Email,
          value: "it-help@example.com",
        },
        [HelpItem.Chat]: { choice: HelpChoice.Link, value: OWN_CHAT["teams"]! },
        [HelpItem.RequestDemo]: { choice: HelpChoice.Hidden, value: null },
      }),
    );

    const ask: HTMLElement = openHelp();

    expect(linkAddresses(ask)).toEqual([
      "mailto:it-help@example.com",
      OWN_CHAT["teams"],
    ]);
    expect(ask).toHaveTextContent(CHAT_WITH_TEAMS_TITLE);
    expect(ask).not.toHaveTextContent("help.requestDemo");
    expect(ask.textContent).not.toContain("oneuptime.com");
  });

  test.each([
    ["a Slack workspace of their own", OWN_CHAT["slack"]!, "help.chatSlack"],
    ["Microsoft Teams", OWN_CHAT["teams"]!, CHAT_WITH_TEAMS_TITLE],
    ["any other chat", OWN_CHAT["other"]!, CHAT_WITH_SUPPORT_TITLE],
    ["an address to write to", "mailto:it-help@example.com", CHAT_WITH_SUPPORT_TITLE],
  ])(
    "a chat link to %s is named for what it opens",
    (_name: string, url: string, title: string) => {
      setSignedInHelpAndSupport(
        helpAndSupportWith({
          [HelpItem.Chat]: { choice: HelpChoice.Link, value: url },
        }),
      );

      const ask: HTMLElement = openHelp();
      const entry: HTMLElement = within(ask).getByText(title);

      expect(entry.closest("a")).toHaveAttribute("href", url);
    },
  );

  test.each([
    [HelpItem.SupportEmail, "help.supportEmail", "mailto:support@oneuptime.com"],
    [HelpItem.Chat, "help.chatSlack", ONEUPTIME_CHAT_URL],
    [HelpItem.RequestDemo, "help.requestDemo", ONEUPTIME_DEMO_URL],
  ])(
    "%s hidden: that entry alone goes",
    (item: HelpItem, title: string, address: string) => {
      setSignedInHelpAndSupport(
        helpAndSupportWith({
          [item]: { choice: HelpChoice.Hidden, value: null },
        }),
      );

      const ask: HTMLElement = openHelp();

      expect(ask).not.toHaveTextContent(title);
      expect(linkAddresses(ask)).not.toContain(address);
      expect(linkAddresses(ask)).toHaveLength(2);
      // The keyboard shortcuts are still there.
      expect(ask).toHaveTextContent("Keyboard shortcuts");
    },
  );

  test("every way to ask hidden: Help still opens, with the keyboard shortcuts and the ways to learn", () => {
    setSignedInHelpAndSupport(
      helpAndSupportWith({
        [HelpItem.SupportEmail]: { choice: HelpChoice.Hidden, value: null },
        [HelpItem.Chat]: { choice: HelpChoice.Hidden, value: null },
        [HelpItem.RequestDemo]: { choice: HelpChoice.Hidden, value: null },
      }),
    );

    const ask: HTMLElement = openHelp();

    expect(linkAddresses(ask)).toEqual([]);
    expect(ask).toHaveTextContent("Keyboard shortcuts");
    expect(screen.getByText("Quickstart")).toBeInTheDocument();
  });

  test("a chat link of the server's own not read yet: no chat entry, never OneUptime's for a moment", async () => {
    // env.js says the server has a chat link of its own, and holds it back.
    const settings: HelpAndSupportSettings = helpAndSupportWith({
      [HelpItem.Chat]: { choice: HelpChoice.Link, value: OWN_CHAT["other"]! },
    });
    setHelpAndSupportEnvironment(settings);

    const ask: HTMLElement = openHelp();

    expect(linkAddresses(ask)).toEqual([
      "mailto:support@oneuptime.com",
      ONEUPTIME_DEMO_URL,
    ]);

    // Then the server's answer arrives, and Help draws it.
    await act(async () => {
      setSignedInHelpAndSupport(settings);
    });

    expect(linkAddresses(screen.getByTestId(HELP_ASK_GROUP_TEST_ID))).toEqual([
      "mailto:support@oneuptime.com",
      OWN_CHAT["other"],
      ONEUPTIME_DEMO_URL,
    ]);
  });
});

describe("the footer's Help and Support link", () => {
  const renderFooter: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      render(<DashboardFooter />);
    });
  };

  const helpLink: () => HTMLAnchorElement | null =
    (): HTMLAnchorElement | null => {
      return (
        (screen.queryByText("footer.helpSupport")?.closest(
          "a",
        ) as HTMLAnchorElement | null) || null
      );
    };

  test("by default: OneUptime's support page, as always", async () => {
    await renderFooter();

    expect(helpLink()).toHaveAttribute("href", ONEUPTIME_HELP_URL);
    expect(helpLink()).toHaveAttribute("target", "_blank");
  });

  test("the server's own help page", async () => {
    setSignedInHelpAndSupport(
      helpAndSupportWith({
        [HelpItem.HelpLink]: {
          choice: HelpChoice.Link,
          value: "https://help.example.com/oneuptime",
        },
      }),
    );

    await renderFooter();

    expect(helpLink()).toHaveAttribute(
      "href",
      "https://help.example.com/oneuptime",
    );
    expect(linkAddresses()).not.toContain(ONEUPTIME_HELP_URL);
  });

  test("hidden: no Help and Support link, and the rest of the footer as before", async () => {
    setSignedInHelpAndSupport(
      helpAndSupportWith({
        [HelpItem.HelpLink]: { choice: HelpChoice.Hidden, value: null },
      }),
    );

    await renderFooter();

    expect(helpLink()).toBeNull();
    expect(screen.getByText("footer.legal")).toBeInTheDocument();
    expect(screen.getByText("footer.version")).toBeInTheDocument();
    expect(screen.getByTestId("edition-label")).toBeInTheDocument();
  });

  test("an installation with a name of its own leaves OneUptime's out, as it always did - and shows its own", async () => {
    setBranding(JSON.stringify({ productName: "Acme" }));

    await renderFooter();
    expect(helpLink()).toBeNull();
    cleanup();

    setSignedInHelpAndSupport(
      helpAndSupportWith({
        [HelpItem.HelpLink]: {
          choice: HelpChoice.Link,
          value: "https://help.acme.example/oneuptime",
        },
      }),
    );

    await renderFooter();
    expect(helpLink()).toHaveAttribute("href", "https://help.acme.example/oneuptime");
  });
});

describe("Contact, on the sign-in pages", () => {
  const contactLink: () => HTMLAnchorElement | null =
    (): HTMLAnchorElement | null => {
      return (
        (screen.queryByText("footer.contact")?.closest(
          "a",
        ) as HTMLAnchorElement | null) || null
      );
    };

  test("by default: OneUptime's support page, as always", () => {
    render(<AccountsFooter />);

    expect(contactLink()).toHaveAttribute("href", ONEUPTIME_HELP_URL);
  });

  test("the server's own help page, read from env.js before anyone signs in", () => {
    setHelpAndSupportEnvironment(
      helpAndSupportWith({
        [HelpItem.HelpLink]: {
          choice: HelpChoice.Link,
          value: "https://help.example.com/oneuptime",
        },
      }),
    );

    render(<AccountsFooter />);

    expect(contactLink()).toHaveAttribute(
      "href",
      "https://help.example.com/oneuptime",
    );
  });

  test("hidden: no Contact, and Privacy and Terms as before", () => {
    setHelpAndSupportEnvironment(
      helpAndSupportWith({
        [HelpItem.HelpLink]: { choice: HelpChoice.Hidden, value: null },
      }),
    );

    render(<AccountsFooter />);

    expect(contactLink()).toBeNull();
    expect(screen.getByText("footer.privacyAndTerms")).toBeInTheDocument();
  });
});

describe("Give feedback's public GitHub issue", () => {
  const drawLink: () => void = (): void => {
    render(
      <FeedbackGitHubLink
        href="https://github.com/OneUptime/oneuptime/issues/new?title=x"
        dataTestId="feedback-github"
      />,
    );
  };

  test("offered by default, saying it is public", () => {
    drawLink();

    expect(screen.getByTestId("feedback-github")).toHaveTextContent(
      "Also tell OneUptime in a public GitHub issue",
    );
    expect(screen.getByTestId(FEEDBACK_GITHUB_HINT_TEST_ID)).toBeInTheDocument();
  });

  test("not offered where the server's admins took OneUptime's GitHub away", () => {
    setSignedInHelpAndSupport(
      helpAndSupportWith({
        [HelpItem.GitHub]: { choice: HelpChoice.Hidden, value: null },
      }),
    );

    drawLink();

    expect(screen.queryByTestId("feedback-github")).toBeNull();
    expect(screen.queryByTestId(FEEDBACK_GITHUB_HINT_TEST_ID)).toBeNull();
  });
});

describe("Page not found", () => {
  const PAGE_PROPS: {
    pageRoute: Route;
    currentProject: null;
    hasPaymentMethod: boolean;
  } = {
    pageRoute: new Route("/dashboard/not-a-page"),
    currentProject: null,
    hasPaymentMethod: true,
  };

  test("Contact Support writes to OneUptime's support by default", () => {
    const navigate: jest.SpiedFunction<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {
        // Where it goes is what is checked.
      });

    render(<PageNotFound {...PAGE_PROPS} />);
    fireEvent.click(screen.getByText("Contact Support"));

    expect(String(navigate.mock.calls[0]![0])).toBe(
      "mailto:support@oneuptime.com",
    );
  });

  test("Contact Support writes to the server's own address", () => {
    setSignedInHelpAndSupport(
      helpAndSupportWith({
        [HelpItem.SupportEmail]: {
          choice: HelpChoice.Email,
          value: "it-help@example.com",
        },
      }),
    );
    const navigate: jest.SpiedFunction<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {
        // Where it goes is what is checked.
      });

    render(<PageNotFound {...PAGE_PROPS} />);
    fireEvent.click(screen.getByText("Contact Support"));

    expect(String(navigate.mock.calls[0]![0])).toBe(
      "mailto:it-help@example.com",
    );
  });

  test("no Contact Support where the address is hidden", () => {
    setSignedInHelpAndSupport(
      helpAndSupportWith({
        [HelpItem.SupportEmail]: { choice: HelpChoice.Hidden, value: null },
      }),
    );

    render(<PageNotFound {...PAGE_PROPS} />);

    expect(screen.queryByText("Contact Support")).toBeNull();
    expect(screen.getByText("Go Home")).toBeInTheDocument();
  });
});

describe("Project Settings > Mobile Apps", () => {
  const PAGE_PROPS: {
    pageRoute: Route;
    currentProject: null;
    hasPaymentMethod: boolean;
  } = {
    pageRoute: new Route(`/dashboard/${PROJECT_ID}/settings/mobile-apps`),
    currentProject: null,
    hasPaymentMethod: true,
  };

  const openSettingsMenu: () => void = (): void => {
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    Navigation.setLocation({
      pathname: (RouteMap[PageMap.SETTINGS_NOTIFICATION_SETTINGS] as Route)
        .toString()
        .replace(":projectId", PROJECT_ID),
      search: "",
      hash: "",
      state: null,
      key: "help-and-support-settings-menu",
    });
    render(<SettingsSideMenu />);
  };

  afterEach(() => {
    (Navigation as unknown as { location: unknown }).location = undefined;
  });

  test("listed under Notifications by default, and where the app comes from a page of the server's own", () => {
    openSettingsMenu();
    expect(screen.getByText("Mobile Apps")).toBeInTheDocument();
    cleanup();

    setSignedInHelpAndSupport(
      helpAndSupportWith({
        [HelpItem.MobileApp]: {
          choice: HelpChoice.Link,
          value: "https://apps.example.com/oneuptime",
        },
      }),
    );
    openSettingsMenu();
    expect(screen.getByText("Mobile Apps")).toBeInTheDocument();
  });

  test("not listed where the server's admins took the app away; the rest of Notifications is", () => {
    setSignedInHelpAndSupport(
      helpAndSupportWith({
        [HelpItem.MobileApp]: { choice: HelpChoice.Hidden, value: null },
      }),
    );
    openSettingsMenu();

    expect(screen.queryByText("Mobile Apps")).toBeNull();
    expect(screen.getByText("Notification Channels")).toBeInTheDocument();
    expect(screen.getByText("Notification Logs")).toBeInTheDocument();
  });

  test("the page, by default: OneUptime's stores, as always", () => {
    const open: jest.SpiedFunction<typeof window.open> = jest
      .spyOn(window, "open")
      .mockImplementation(() => {
        return null;
      });

    render(<MobileApps {...PAGE_PROPS} />);

    expect(screen.queryByTestId("mobile-apps-own-page")).toBeNull();
    fireEvent.click(screen.getByText("App Store").closest("button")!);
    fireEvent.click(screen.getByText("Google Play").closest("button")!);

    expect(
      open.mock.calls.map((call: Array<unknown>): unknown => {
        return call[0];
      }),
    ).toEqual([MOBILE_APP_IOS_URL, MOBILE_APP_ANDROID_URL]);
  });

  test("the page, from the server's own page: one row, its address as written, opened apart", () => {
    setSignedInHelpAndSupport(
      helpAndSupportWith({
        [HelpItem.MobileApp]: {
          choice: HelpChoice.Link,
          value: "https://apps.example.com/catalog/oneuptime",
        },
      }),
    );
    const open: jest.SpiedFunction<typeof window.open> = jest
      .spyOn(window, "open")
      .mockImplementation(() => {
        return null;
      });

    render(<MobileApps {...PAGE_PROPS} />);

    const row: HTMLElement = screen.getByTestId("mobile-apps-own-page");

    expect(row).toHaveTextContent(MOBILE_APPS_PAGE_COPY.ownPageTitle);
    expect(within(row).getByText("apps.example.com")).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(screen.queryByText("App Store")).toBeNull();
    expect(screen.queryByText("Google Play")).toBeNull();

    fireEvent.click(within(row).getByRole("button"));

    expect(open).toHaveBeenCalledWith(
      "https://apps.example.com/catalog/oneuptime",
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("the page, where the server's admins took the app away: says so, and offers no store", () => {
    setSignedInHelpAndSupport(
      helpAndSupportWith({
        [HelpItem.MobileApp]: { choice: HelpChoice.Hidden, value: null },
      }),
    );

    render(<MobileApps {...PAGE_PROPS} />);

    expect(
      screen.getByText(MOBILE_APPS_PAGE_COPY.turnedOffTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(MOBILE_APPS_PAGE_COPY.turnedOffDescription),
    ).toBeInTheDocument();
    expect(screen.queryByText("App Store")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
