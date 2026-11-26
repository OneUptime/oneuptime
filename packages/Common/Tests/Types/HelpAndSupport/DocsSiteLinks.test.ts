import {
  ChatKind,
  DOCS_DEFAULT_SUPPORT_URL,
  DocsSiteLinks,
  HelpAndSupportSettings,
  HelpChoice,
  HelpItem,
  ONEUPTIME_CHAT_URL,
  getDefaultHelpAndSupportSettings,
  getDocsSiteLinks,
  hasOwnChatLink,
} from "../../../Types/HelpAndSupport/HelpAndSupport";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THE DOCS SITE AND THE API REFERENCE LINK TO (#10940).
 *
 * The docs (/docs) and the API reference (/reference) follow Admin
 * Dashboard > Settings > Help and Support as the Dashboard does: GitHub
 * goes with Report a Bug or Request a Feature, the reference's chat with
 * Chat - a link of the server's own only for a signed-in reader, since
 * these pages are public - and its Support link with Help and Support. A
 * server that never changed the page links to exactly what it always did.
 */

type SettingChanges = Partial<
  Record<HelpItem, { choice: HelpChoice; value?: string | null }>
>;

const settingsWith: (changes: SettingChanges) => HelpAndSupportSettings = (
  changes: SettingChanges,
): HelpAndSupportSettings => {
  const settings: HelpAndSupportSettings = getDefaultHelpAndSupportSettings();

  for (const [item, change] of Object.entries(changes)) {
    settings[item as HelpItem] = {
      choice: change!.choice,
      value: change!.value ?? null,
    };
  }

  return settings;
};

const SIGNED_OUT: { isSignedIn: boolean } = { isSignedIn: false };
const SIGNED_IN: { isSignedIn: boolean } = { isSignedIn: true };

describe("a server that never changed the page", () => {
  test("links to OneUptime's GitHub, Slack and Support, signed in or not", () => {
    const expected: DocsSiteLinks = {
      isGitHubShown: true,
      chat: {
        url: ONEUPTIME_CHAT_URL,
        kind: ChatKind.Slack,
        isOneUptime: true,
      },
      supportUrl: DOCS_DEFAULT_SUPPORT_URL,
    };

    expect(
      getDocsSiteLinks(getDefaultHelpAndSupportSettings(), SIGNED_OUT),
    ).toEqual(expected);
    expect(
      getDocsSiteLinks(getDefaultHelpAndSupportSettings(), SIGNED_IN),
    ).toEqual(expected);
  });

  test("its Support link is the address the reference always had", () => {
    expect(DOCS_DEFAULT_SUPPORT_URL).toBe("/support");
  });

  test("has no chat link of its own, so no session needs reading", () => {
    expect(hasOwnChatLink(getDefaultHelpAndSupportSettings())).toBe(false);
  });
});

describe("GitHub (Report a Bug or Request a Feature)", () => {
  test("hidden: no GitHub link anywhere", () => {
    expect(
      getDocsSiteLinks(
        settingsWith({ [HelpItem.GitHub]: { choice: HelpChoice.Hidden } }),
        SIGNED_IN,
      ).isGitHubShown,
    ).toBe(false);
  });

  test("hidden, the other links are as they were", () => {
    const links: DocsSiteLinks = getDocsSiteLinks(
      settingsWith({ [HelpItem.GitHub]: { choice: HelpChoice.Hidden } }),
      SIGNED_OUT,
    );

    expect(links.chat?.isOneUptime).toBe(true);
    expect(links.supportUrl).toBe(DOCS_DEFAULT_SUPPORT_URL);
  });
});

describe("the chat", () => {
  test("hidden: no chat link, signed in or not", () => {
    const settings: HelpAndSupportSettings = settingsWith({
      [HelpItem.Chat]: { choice: HelpChoice.Hidden },
    });

    expect(getDocsSiteLinks(settings, SIGNED_OUT).chat).toBeNull();
    expect(getDocsSiteLinks(settings, SIGNED_IN).chat).toBeNull();
    expect(hasOwnChatLink(settings)).toBe(false);
  });

  test("a link of the server's own goes only to a signed-in reader", () => {
    const settings: HelpAndSupportSettings = settingsWith({
      [HelpItem.Chat]: {
        choice: HelpChoice.Link,
        value: "https://acme.slack.com/archives/C024BE91L",
      },
    });

    expect(hasOwnChatLink(settings)).toBe(true);
    expect(getDocsSiteLinks(settings, SIGNED_OUT).chat).toBeNull();
    expect(getDocsSiteLinks(settings, SIGNED_IN).chat).toEqual({
      url: "https://acme.slack.com/archives/C024BE91L",
      kind: ChatKind.Slack,
      isOneUptime: false,
    });
  });

  test("named for the chat it opens: Slack, Microsoft Teams, or a chat of another kind", () => {
    const kindOf: (url: string) => ChatKind | undefined = (
      url: string,
    ): ChatKind | undefined => {
      return getDocsSiteLinks(
        settingsWith({
          [HelpItem.Chat]: { choice: HelpChoice.Link, value: url },
        }),
        SIGNED_IN,
      ).chat?.kind;
    };

    expect(kindOf("https://acme.slack.com/archives/C024BE91L")).toBe(
      ChatKind.Slack,
    );
    expect(
      kindOf("https://teams.microsoft.com/l/channel/19%3aabc/General"),
    ).toBe(ChatKind.MicrosoftTeams);
    expect(kindOf("https://chat.acme.example/support")).toBe(ChatKind.Other);
  });

  test("a value that would be refused is never linked, whoever reads", () => {
    const settings: HelpAndSupportSettings = settingsWith({
      [HelpItem.Chat]: {
        choice: HelpChoice.Link,
        value: "javascript:alert(1)",
      },
    });

    expect(getDocsSiteLinks(settings, SIGNED_IN).chat).toBeNull();
  });

  test("a link not read yet links to nothing, never to OneUptime's", () => {
    const settings: HelpAndSupportSettings = settingsWith({
      [HelpItem.Chat]: { choice: HelpChoice.Link, value: null },
    });

    expect(getDocsSiteLinks(settings, SIGNED_IN).chat).toBeNull();
  });
});

describe("the Support link (Help and Support)", () => {
  test("a help page of the server's own, for anyone: the sign-in pages show it too", () => {
    const settings: HelpAndSupportSettings = settingsWith({
      [HelpItem.HelpLink]: {
        choice: HelpChoice.Link,
        value: "https://help.acme.example/oneuptime",
      },
    });

    expect(getDocsSiteLinks(settings, SIGNED_OUT).supportUrl).toBe(
      "https://help.acme.example/oneuptime",
    );
    expect(getDocsSiteLinks(settings, SIGNED_IN).supportUrl).toBe(
      "https://help.acme.example/oneuptime",
    );
  });

  test("hidden: no Support link", () => {
    expect(
      getDocsSiteLinks(
        settingsWith({ [HelpItem.HelpLink]: { choice: HelpChoice.Hidden } }),
        SIGNED_OUT,
      ).supportUrl,
    ).toBeNull();
  });

  test("a value that would be refused is never linked", () => {
    expect(
      getDocsSiteLinks(
        settingsWith({
          [HelpItem.HelpLink]: {
            choice: HelpChoice.Link,
            value: "data:text/html,<script>alert(1)</script>",
          },
        }),
        SIGNED_OUT,
      ).supportUrl,
    ).toBeNull();
  });

  test("a mailto: link of the server's own is kept as it is", () => {
    expect(
      getDocsSiteLinks(
        settingsWith({
          [HelpItem.HelpLink]: {
            choice: HelpChoice.Link,
            value: "mailto:it-help@acme.example",
          },
        }),
        SIGNED_OUT,
      ).supportUrl,
    ).toBe("mailto:it-help@acme.example");
  });
});

describe("the settings no docs link reads", () => {
  test.each([
    HelpItem.SupportEmail,
    HelpItem.RequestDemo,
    HelpItem.GiveFeedback,
    HelpItem.MobileApp,
  ])("%s hidden changes nothing the docs link to", (item: HelpItem) => {
    expect(
      getDocsSiteLinks(
        settingsWith({ [item]: { choice: HelpChoice.Hidden } }),
        {
          isSignedIn: false,
        },
      ),
    ).toEqual(
      getDocsSiteLinks(getDefaultHelpAndSupportSettings(), {
        isSignedIn: false,
      }),
    );
  });
});
