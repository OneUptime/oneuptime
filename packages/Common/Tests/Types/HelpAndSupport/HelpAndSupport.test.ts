import {
  ChatKind,
  ChatLink,
  DEFAULT_INVITE_MESSAGE,
  DEFAULT_NO_PROJECT_MESSAGE,
  HELP_AND_SUPPORT_ENVIRONMENT_ITEMS,
  HELP_AND_SUPPORT_ENVIRONMENT_KEY,
  HELP_AND_SUPPORT_FRONTENDS,
  HELP_AND_SUPPORT_LINKS_ROUTE,
  HELP_AND_SUPPORT_PUBLIC_VALUE_ITEMS,
  HELP_AND_SUPPORT_SETTINGS_ROUTE,
  HELP_ITEMS,
  HELP_ITEM_CHOICES,
  HELP_LINK_MAX_LENGTH,
  HelpAndSupportProblems,
  HelpAndSupportSettings,
  HelpChoice,
  HelpItem,
  HelpItemChange,
  INVITE_MESSAGE_MAX_LENGTH,
  MobileAppOfferKind,
  ONEUPTIME_CHAT_URL,
  ONEUPTIME_DEMO_URL,
  ONEUPTIME_HELP_URL,
  ONEUPTIME_REPORT_ISSUE_URL,
  ONEUPTIME_SUPPORT_EMAIL,
  SAFE_LINK_PROTOCOLS,
  fromHelpAndSupportEnvironmentValue,
  getChatKind,
  getChatLink,
  getDefaultHelpAndSupportSettings,
  getHelpEmailProblem,
  getHelpItemProblem,
  getHelpLinkLabel,
  getHelpLinkProblem,
  getHelpPageLink,
  getInviteMessage,
  getInviteMessageProblem,
  getMobileAppOffer,
  getRequestDemoUrl,
  getSupportEmailAddress,
  hasOwnInviteMessage,
  isHelpItem,
  isOnDefault,
  isOneUptimeGitHubShown,
  isOneUptimeSupportEmail,
  isSafeHelpLink,
  readHelpAndSupportSettings,
  readHelpItemChange,
  shouldCarryHelpAndSupport,
  toHelpAndSupportEnvironmentValue,
  toHelpAndSupportJSON,
  toInviteMessage,
  withHelpItemChanged,
} from "../../../Types/HelpAndSupport/HelpAndSupport";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * WHERE A SERVER SENDS ITS PEOPLE FOR HELP, AS RULES (#10864-#10866).
 *
 * The defaults are exactly what every server showed before (OneUptime's
 * support address, community Slack, support page, demo, GitHub and app
 * stores); every place can point at the server's own address or link, or
 * be hidden; a link is https, http or mailto and nothing else, an address
 * is one address, and the sign-in message is plain text. Whatever is read
 * back - from the database, from env.js - is held to the same rules, so no
 * page can be handed an unsafe link.
 */

const settingsWith: (
  changes: Partial<
    Record<HelpItem, { choice: HelpChoice; value?: string | null }>
  >,
) => HelpAndSupportSettings = (
  changes: Partial<
    Record<HelpItem, { choice: HelpChoice; value?: string | null }>
  >,
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

describe("the places and their choices", () => {
  test("every place is listed once, in the order the page draws them", () => {
    expect(HELP_ITEMS).toEqual([
      HelpItem.SupportEmail,
      HelpItem.Chat,
      HelpItem.RequestDemo,
      HelpItem.GiveFeedback,
      HelpItem.HelpLink,
      HelpItem.GitHub,
      HelpItem.MobileApp,
      HelpItem.InviteMessage,
    ]);
    expect(new Set(HELP_ITEMS).size).toBe(Object.values(HelpItem).length);
  });

  test("each place starts on its default, and has the choices it can use", () => {
    for (const item of HELP_ITEMS) {
      expect(HELP_ITEM_CHOICES[item][0]).toBe(HelpChoice.Default);
    }

    expect(HELP_ITEM_CHOICES[HelpItem.SupportEmail]).toEqual([
      HelpChoice.Default,
      HelpChoice.Email,
      HelpChoice.Hidden,
    ]);
    expect(HELP_ITEM_CHOICES[HelpItem.Chat]).toEqual([
      HelpChoice.Default,
      HelpChoice.Link,
      HelpChoice.Hidden,
    ]);
    expect(HELP_ITEM_CHOICES[HelpItem.HelpLink]).toEqual([
      HelpChoice.Default,
      HelpChoice.Link,
      HelpChoice.Hidden,
    ]);
    // Request Demo and OneUptime's GitHub are OneUptime's or nothing.
    expect(HELP_ITEM_CHOICES[HelpItem.RequestDemo]).toEqual([
      HelpChoice.Default,
      HelpChoice.Hidden,
    ]);
    expect(HELP_ITEM_CHOICES[HelpItem.GitHub]).toEqual([
      HelpChoice.Default,
      HelpChoice.Hidden,
    ]);
    expect(HELP_ITEM_CHOICES[HelpItem.GiveFeedback]).toEqual([
      HelpChoice.Default,
      HelpChoice.Email,
      HelpChoice.Link,
      HelpChoice.Hidden,
    ]);
    // The sign-in message cannot be hidden: the screen must say something.
    expect(HELP_ITEM_CHOICES[HelpItem.InviteMessage]).toEqual([
      HelpChoice.Default,
      HelpChoice.Text,
    ]);
    expect(HELP_ITEM_CHOICES[HelpItem.MobileApp]).toEqual([
      HelpChoice.Default,
      HelpChoice.Link,
      HelpChoice.Hidden,
    ]);
  });

  test("isHelpItem knows the places and nothing else", () => {
    for (const item of HELP_ITEMS) {
      expect(isHelpItem(item)).toBe(true);
    }

    for (const value of ["", "support", "SUPPORTEMAIL", 1, null, {}, []]) {
      expect(isHelpItem(value)).toBe(false);
    }
  });

  test("the routes are the ones the Admin Dashboard and the Dashboard ask", () => {
    expect(HELP_AND_SUPPORT_SETTINGS_ROUTE).toBe(
      "/global-config/help-and-support",
    );
    expect(HELP_AND_SUPPORT_LINKS_ROUTE).toBe(
      "/global-config/help-and-support/links",
    );
  });
});

describe("the defaults keep what every server always showed", () => {
  const defaults: HelpAndSupportSettings = getDefaultHelpAndSupportSettings();

  test("every place is on its default, with no value", () => {
    for (const item of HELP_ITEMS) {
      expect(defaults[item]).toEqual({
        choice: HelpChoice.Default,
        value: null,
      });
      expect(isOnDefault(defaults, item)).toBe(true);
    }
  });

  test("OneUptime's own channels, word for word", () => {
    expect(ONEUPTIME_SUPPORT_EMAIL).toBe("support@oneuptime.com");
    expect(ONEUPTIME_CHAT_URL).toBe(
      "https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA",
    );
    expect(ONEUPTIME_HELP_URL).toBe("https://oneuptime.com/support");
    expect(ONEUPTIME_DEMO_URL).toBe("https://oneuptime.com/enterprise/demo");
    expect(ONEUPTIME_REPORT_ISSUE_URL).toBe(
      "https://github.com/OneUptime/oneuptime/issues/new/choose",
    );
  });

  test("what each place shows by default", () => {
    expect(getSupportEmailAddress(defaults)).toBe(ONEUPTIME_SUPPORT_EMAIL);
    expect(isOneUptimeSupportEmail(defaults)).toBe(true);
    expect(getChatLink(defaults)).toEqual({
      url: ONEUPTIME_CHAT_URL,
      kind: ChatKind.Slack,
      isOneUptime: true,
    });
    expect(getHelpPageLink(defaults)).toEqual({
      url: ONEUPTIME_HELP_URL,
      isOneUptime: true,
    });
    expect(getRequestDemoUrl(defaults)).toBe(ONEUPTIME_DEMO_URL);
    expect(isOneUptimeGitHubShown(defaults)).toBe(true);
    expect(getMobileAppOffer(defaults)).toEqual({
      kind: MobileAppOfferKind.OneUptime,
      url: null,
    });
    expect(hasOwnInviteMessage(defaults)).toBe(false);
  });

  test("the single sign-on screens say what they always said", () => {
    expect(DEFAULT_INVITE_MESSAGE).toBe(
      "You must be invited to a project on this OneUptime instance before you can sign in with SSO. Please contact your administrator.",
    );
    expect(DEFAULT_NO_PROJECT_MESSAGE).toBe(
      "You are not a member of any project on this OneUptime instance. Please contact your administrator to be invited.",
    );
    expect(getInviteMessage(defaults, DEFAULT_INVITE_MESSAGE)).toBe(
      DEFAULT_INVITE_MESSAGE,
    );
    expect(getInviteMessage(defaults, DEFAULT_NO_PROJECT_MESSAGE)).toBe(
      DEFAULT_NO_PROJECT_MESSAGE,
    );
  });

  test("a renamed installation leaves OneUptime's help page out, as its footer always did", () => {
    expect(getHelpPageLink(defaults, { isProductRenamed: true })).toBeNull();
    expect(getHelpPageLink(defaults, { isProductRenamed: false })).toEqual({
      url: ONEUPTIME_HELP_URL,
      isOneUptime: true,
    });
  });
});

describe("a link", () => {
  test.each([
    "https://help.example.com",
    "https://help.example.com/",
    "https://help.example.com/oneuptime?team=sre#chat",
    "http://intranet.example.local/help",
    "HTTPS://HELP.EXAMPLE.COM/PATH",
    "https://example.com:8443/servicedesk",
    "https://join.slack.com/t/acme/shared_invite/zt-abc123",
    "https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/Support",
    "mailto:it-help@example.com",
    "mailto:it-help@example.com?subject=OneUptime%20help",
    "mailto:a@example.com,b@example.com",
    "  https://help.example.com  ",
  ])("%s is safe", (link: string) => {
    expect(getHelpLinkProblem(link)).toBeNull();
    expect(isSafeHelpLink(link)).toBe(true);
  });

  test.each([
    "javascript:alert(1)",
    "JavaScript:alert(document.cookie)",
    "  javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://files.example.com",
    "tel:+15551234567",
    "sms:+15551234567",
    "ws://example.com",
    "blob:https://example.com/uuid",
  ])("%s is refused for its scheme, with why", (link: string) => {
    expect(getHelpLinkProblem(link)).toBe(HelpAndSupportProblems.linkScheme);
    expect(isSafeHelpLink(link)).toBe(false);
  });

  test.each([
    ["no scheme", "help.example.com"],
    ["a path", "/help"],
    ["another host, scheme-relative", "//evil.example.com"],
    ["a scheme with no slashes", "https:help.example.com"],
    ["one slash", "http:/help.example.com"],
    ["a space", "https://help.example.com/a b"],
    ["a tab", "https://help.example.com/\ta"],
    ["a line break", "https://help.example.com/\nmore"],
    ["a double quote", 'https://help.example.com/"onmouseover="x'],
    ["a single quote", "https://help.example.com/'x"],
    ["angle brackets", "https://help.example.com/<script>"],
    ["a backtick", "https://help.example.com/`x`"],
    ["a backslash", "https:\\\\help.example.com"],
    ["a name before the host", "https://oneuptime.com@evil.example.com"],
    [
      "a name and password before the host",
      "https://user:pass@help.example.com",
    ],
    ["a control character", "https://help.example.com/\u0007"],
    ["a mailto with no address", "mailto:"],
    ["a mailto with a broken address", "mailto:not-an-address"],
    ["a mailto with a name", "mailto:Alice%20%3Ca%40example.com%3E"],
    ["a mailto with a bad second address", "mailto:a@example.com,nope"],
  ])("with %s is refused", (_why: string, link: string) => {
    expect(getHelpLinkProblem(link)).not.toBeNull();
    expect(isSafeHelpLink(link)).toBe(false);
  });

  test("an empty or missing link asks for one", () => {
    for (const value of ["", "   ", undefined, null, 42, {}]) {
      expect(getHelpLinkProblem(value)).toBe(
        HelpAndSupportProblems.linkMissing,
      );
    }
  });

  test("a link longer than the most a link may be is refused, one at the most is kept", () => {
    const base: string = "https://help.example.com/";
    const atMost: string =
      base + "a".repeat(HELP_LINK_MAX_LENGTH - base.length);
    const tooLong: string = atMost + "a";

    expect(atMost.length).toBe(HELP_LINK_MAX_LENGTH);
    expect(getHelpLinkProblem(atMost)).toBeNull();
    expect(getHelpLinkProblem(tooLong)).toBe(
      HelpAndSupportProblems.linkTooLong,
    );
  });

  test("only https, http and mailto are safe schemes", () => {
    expect(SAFE_LINK_PROTOCOLS).toEqual(["https:", "http:", "mailto:"]);
  });

  test("is named by its host, or its address", () => {
    expect(getHelpLinkLabel("https://help.example.com/oneuptime?x=1")).toBe(
      "help.example.com",
    );
    expect(getHelpLinkLabel("mailto:it-help@example.com?subject=Hi")).toBe(
      "it-help@example.com",
    );
    expect(getHelpLinkLabel("mailto:a@example.com,b@example.com")).toBe(
      "a@example.com, b@example.com",
    );
  });
});

describe("an address", () => {
  test.each([
    "it-help@example.com",
    "IT-Help@Example.com",
    "  support@example.co.uk  ",
    "first.last+oneuptime@example.org",
  ])("%s is an address people can write to", (address: string) => {
    expect(getHelpEmailProblem(address)).toBeNull();
  });

  test.each([
    "",
    "   ",
    "it-help",
    "it-help@",
    "@example.com",
    "Alice <alice@example.com>",
    "a@example.com, b@example.com",
    '"<b>"@example.com',
    "it help@example.com",
    "javascript:alert(1)",
    "it-help@example.com\nBcc: everyone@example.com",
  ])("%j is refused", (address: string) => {
    expect(getHelpEmailProblem(address)).not.toBeNull();
  });

  test("a missing one asks for one; a wrong one says how to write it", () => {
    expect(getHelpEmailProblem("")).toBe(HelpAndSupportProblems.emailMissing);
    expect(getHelpEmailProblem(undefined)).toBe(
      HelpAndSupportProblems.emailMissing,
    );
    expect(getHelpEmailProblem("nope")).toBe(
      HelpAndSupportProblems.emailInvalid,
    );
  });
});

describe("the sign-in message", () => {
  test("plain text with line breaks is kept, tidied", () => {
    const text: string =
      "Ask the IT service desk:\r\n\tit-help@example.com   \r\nhttps://help.example.com\n\n";

    expect(getInviteMessageProblem(text)).toBeNull();
    expect(toInviteMessage(text)).toBe(
      "Ask the IT service desk:\n it-help@example.com\nhttps://help.example.com",
    );
  });

  test("HTML is refused, whatever it would do", () => {
    for (const html of [
      "<b>Ask IT</b>",
      "Ask IT <script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "a < b",
      "a > b",
      "<!-- hidden -->",
    ]) {
      expect(getInviteMessageProblem(html)).toBe(
        HelpAndSupportProblems.textHtml,
      );
    }
  });

  test("control characters are refused, line breaks and tabs are not", () => {
    expect(getInviteMessageProblem("Ask IT\u0000")).toBe(
      HelpAndSupportProblems.textControlCharacters,
    );
    expect(getInviteMessageProblem("Ask IT\u001b[31m")).toBe(
      HelpAndSupportProblems.textControlCharacters,
    );
    expect(getInviteMessageProblem("Ask IT\u0085")).toBe(
      HelpAndSupportProblems.textControlCharacters,
    );
    expect(getInviteMessageProblem("Ask\tIT\nnow")).toBeNull();
  });

  test("up to the longest a message may be, and not one character more", () => {
    expect(
      getInviteMessageProblem("a".repeat(INVITE_MESSAGE_MAX_LENGTH)),
    ).toBeNull();
    expect(
      getInviteMessageProblem("a".repeat(INVITE_MESSAGE_MAX_LENGTH + 1)),
    ).toBe(HelpAndSupportProblems.textTooLong);
  });

  test("an empty message asks for one", () => {
    for (const value of ["", "  \n ", undefined, null]) {
      expect(getInviteMessageProblem(value)).toBe(
        HelpAndSupportProblems.textMissing,
      );
    }
  });

  test("is the server's own on both screens once it is set", () => {
    const settings: HelpAndSupportSettings = settingsWith({
      [HelpItem.InviteMessage]: {
        choice: HelpChoice.Text,
        value: "Ask the IT service desk.",
      },
    });

    expect(hasOwnInviteMessage(settings)).toBe(true);
    expect(getInviteMessage(settings, DEFAULT_INVITE_MESSAGE)).toBe(
      "Ask the IT service desk.",
    );
    expect(getInviteMessage(settings, DEFAULT_NO_PROJECT_MESSAGE)).toBe(
      "Ask the IT service desk.",
    );
  });

  test("a message that would be refused is never said, even if it was stored", () => {
    const settings: HelpAndSupportSettings = settingsWith({
      [HelpItem.InviteMessage]: {
        choice: HelpChoice.Text,
        value: "<script>alert(1)</script>",
      },
    });

    expect(getInviteMessage(settings, DEFAULT_INVITE_MESSAGE)).toBe(
      DEFAULT_INVITE_MESSAGE,
    );
  });
});

describe("a change the page posts", () => {
  test("to an address of the server's own, kept trimmed and in lower case", () => {
    const change: HelpItemChange | string = readHelpItemChange({
      item: HelpItem.SupportEmail,
      choice: HelpChoice.Email,
      value: "  IT-Help@Example.com ",
    });

    expect(change).toEqual({
      item: HelpItem.SupportEmail,
      setting: { choice: HelpChoice.Email, value: "it-help@example.com" },
    });
  });

  test("to a link of the server's own, kept trimmed", () => {
    expect(
      readHelpItemChange({
        item: HelpItem.Chat,
        choice: HelpChoice.Link,
        value: "  https://chat.example.com/support  ",
      }),
    ).toEqual({
      item: HelpItem.Chat,
      setting: {
        choice: HelpChoice.Link,
        value: "https://chat.example.com/support",
      },
    });
  });

  test("to the server's own words, kept tidied", () => {
    expect(
      readHelpItemChange({
        item: HelpItem.InviteMessage,
        choice: HelpChoice.Text,
        value: "Ask IT.\r\nit-help@example.com  ",
      }),
    ).toEqual({
      item: HelpItem.InviteMessage,
      setting: {
        choice: HelpChoice.Text,
        value: "Ask IT.\nit-help@example.com",
      },
    });
  });

  test("back to the default, or hidden, keeps no value whatever was sent", () => {
    expect(
      readHelpItemChange({
        item: HelpItem.HelpLink,
        choice: HelpChoice.Default,
        value: "javascript:alert(1)",
      }),
    ).toEqual({
      item: HelpItem.HelpLink,
      setting: { choice: HelpChoice.Default, value: null },
    });
    expect(
      readHelpItemChange({
        item: HelpItem.RequestDemo,
        choice: HelpChoice.Hidden,
        value: "anything",
      }),
    ).toEqual({
      item: HelpItem.RequestDemo,
      setting: { choice: HelpChoice.Hidden, value: null },
    });
  });

  test("is refused, with why, for a javascript: link on every place that takes a link", () => {
    for (const item of [
      HelpItem.Chat,
      HelpItem.HelpLink,
      HelpItem.GiveFeedback,
      HelpItem.MobileApp,
    ]) {
      expect(
        readHelpItemChange({
          item: item,
          choice: HelpChoice.Link,
          value: "javascript:alert(document.cookie)",
        }),
      ).toBe(HelpAndSupportProblems.linkScheme);
    }
  });

  test("is refused for HTML in the sign-in message", () => {
    expect(
      readHelpItemChange({
        item: HelpItem.InviteMessage,
        choice: HelpChoice.Text,
        value: "<a href='javascript:alert(1)'>Ask IT</a>",
      }),
    ).toBe(HelpAndSupportProblems.textHtml);
  });

  test("is refused for a choice the place does not have", () => {
    const refusals: Array<[HelpItem, unknown]> = [
      [HelpItem.RequestDemo, HelpChoice.Link],
      [HelpItem.GitHub, HelpChoice.Link],
      [HelpItem.SupportEmail, HelpChoice.Link],
      [HelpItem.Chat, HelpChoice.Email],
      [HelpItem.InviteMessage, HelpChoice.Hidden],
      [HelpItem.HelpLink, HelpChoice.Text],
      [HelpItem.Chat, "everything"],
      [HelpItem.Chat, undefined],
    ];

    for (const [item, choice] of refusals) {
      expect(
        readHelpItemChange({
          item: item,
          choice: choice,
          value: "https://help.example.com",
        }),
      ).toBe(HelpAndSupportProblems.unknownChoice);
    }
  });

  test("is refused for a place that does not exist, or a body that is not one", () => {
    for (const body of [
      { item: "footer", choice: HelpChoice.Hidden },
      { choice: HelpChoice.Hidden },
      null,
      "supportEmail",
      [],
      42,
    ]) {
      expect(readHelpItemChange(body)).toBe(HelpAndSupportProblems.unknownItem);
    }
  });

  test("is refused for a missing value where the choice needs one", () => {
    expect(
      readHelpItemChange({
        item: HelpItem.SupportEmail,
        choice: HelpChoice.Email,
      }),
    ).toBe(HelpAndSupportProblems.emailMissing);
    expect(
      readHelpItemChange({ item: HelpItem.Chat, choice: HelpChoice.Link }),
    ).toBe(HelpAndSupportProblems.linkMissing);
    expect(
      readHelpItemChange({
        item: HelpItem.InviteMessage,
        choice: HelpChoice.Text,
        value: "",
      }),
    ).toBe(HelpAndSupportProblems.textMissing);
  });

  test("getHelpItemProblem says the same as a change would", () => {
    expect(
      getHelpItemProblem(HelpItem.Chat, HelpChoice.Link, "ftp://x.example"),
    ).toBe(HelpAndSupportProblems.linkScheme);
    expect(
      getHelpItemProblem(HelpItem.Chat, HelpChoice.Hidden, undefined),
    ).toBeNull();
  });
});

describe("what is kept, and read back", () => {
  test("only the places off their default are kept", () => {
    const settings: HelpAndSupportSettings = settingsWith({
      [HelpItem.SupportEmail]: {
        choice: HelpChoice.Email,
        value: "it-help@example.com",
      },
      [HelpItem.RequestDemo]: { choice: HelpChoice.Hidden },
    });

    expect(toHelpAndSupportJSON(settings)).toEqual({
      supportEmail: { choice: "email", value: "it-help@example.com" },
      requestDemo: { choice: "hidden" },
    });
    expect(toHelpAndSupportJSON(getDefaultHelpAndSupportSettings())).toEqual(
      {},
    );
  });

  test("a chosen set of places, for the links signed-in people read", () => {
    const settings: HelpAndSupportSettings = settingsWith({
      [HelpItem.Chat]: {
        choice: HelpChoice.Link,
        value: "https://chat.example.com",
      },
      [HelpItem.InviteMessage]: { choice: HelpChoice.Text, value: "Ask IT." },
    });

    expect(toHelpAndSupportJSON(settings, [HelpItem.Chat])).toEqual({
      chat: { choice: "link", value: "https://chat.example.com" },
    });
  });

  test("reads back exactly what it kept", () => {
    const settings: HelpAndSupportSettings = settingsWith({
      [HelpItem.SupportEmail]: {
        choice: HelpChoice.Email,
        value: "it-help@example.com",
      },
      [HelpItem.Chat]: {
        choice: HelpChoice.Link,
        value: "https://chat.example.com",
      },
      [HelpItem.HelpLink]: { choice: HelpChoice.Hidden },
      [HelpItem.RequestDemo]: { choice: HelpChoice.Hidden },
      [HelpItem.GiveFeedback]: {
        choice: HelpChoice.Link,
        value: "https://desk.example.com/feedback",
      },
      [HelpItem.InviteMessage]: {
        choice: HelpChoice.Text,
        value: "Ask IT:\nit-help@example.com",
      },
      [HelpItem.MobileApp]: { choice: HelpChoice.Hidden },
      [HelpItem.GitHub]: { choice: HelpChoice.Hidden },
    });

    expect(readHelpAndSupportSettings(toHelpAndSupportJSON(settings))).toEqual(
      settings,
    );
  });

  test("nothing stored reads as every default", () => {
    for (const stored of [null, undefined, "", "x", 42, [], {}]) {
      expect(readHelpAndSupportSettings(stored)).toEqual(
        getDefaultHelpAndSupportSettings(),
      );
    }
  });

  test("a value written straight into the database is held to the same rules, place by place", () => {
    const stored: JSONObject = {
      supportEmail: { choice: "email", value: "Alice <a@example.com>" },
      chat: { choice: "link", value: "javascript:alert(1)" },
      helpLink: { choice: "link", value: "https://help.example.com" },
      requestDemo: { choice: "link", value: "https://demo.example.com" },
      giveFeedback: { choice: "email" },
      inviteMessage: { choice: "text", value: "<b>hi</b>" },
      mobileApp: { choice: "nonsense" },
      gitHub: "hidden",
    };

    const settings: HelpAndSupportSettings = readHelpAndSupportSettings(stored);

    // Only the one valid place is read; every other reads as its default.
    expect(settings[HelpItem.HelpLink]).toEqual({
      choice: HelpChoice.Link,
      value: "https://help.example.com",
    });

    for (const item of HELP_ITEMS.filter((each: HelpItem): boolean => {
      return each !== HelpItem.HelpLink;
    })) {
      expect(settings[item]).toEqual({
        choice: HelpChoice.Default,
        value: null,
      });
    }
  });

  test("one place changed leaves the others as they were", () => {
    const before: HelpAndSupportSettings = settingsWith({
      [HelpItem.RequestDemo]: { choice: HelpChoice.Hidden },
    });
    const after: HelpAndSupportSettings = withHelpItemChanged(before, {
      item: HelpItem.GitHub,
      setting: { choice: HelpChoice.Hidden, value: null },
    });

    expect(after[HelpItem.RequestDemo].choice).toBe(HelpChoice.Hidden);
    expect(after[HelpItem.GitHub].choice).toBe(HelpChoice.Hidden);
    expect(before[HelpItem.GitHub].choice).toBe(HelpChoice.Default);
  });
});

describe("env.js", () => {
  test("is carried by the Dashboard and the sign-in pages only", () => {
    expect(HELP_AND_SUPPORT_ENVIRONMENT_KEY).toBe("HELP_AND_SUPPORT");
    expect(HELP_AND_SUPPORT_FRONTENDS).toEqual(["dashboard", "accounts"]);

    for (const frontend of [
      "dashboard",
      "/dashboard",
      "accounts",
      "/Accounts",
    ]) {
      expect(shouldCarryHelpAndSupport(frontend)).toBe(true);
    }

    for (const frontend of [
      "admin",
      "/admin",
      "status-page",
      "/status-page",
      "public-dashboard",
      "",
    ]) {
      expect(shouldCarryHelpAndSupport(frontend)).toBe(false);
    }
  });

  test("leaves the key out while every place is on its default", () => {
    expect(
      toHelpAndSupportEnvironmentValue(getDefaultHelpAndSupportSettings()),
    ).toBeNull();
    // A message or feedback of the server's own is never in env.js.
    expect(
      toHelpAndSupportEnvironmentValue(
        settingsWith({
          [HelpItem.InviteMessage]: {
            choice: HelpChoice.Text,
            value: "Ask IT.",
          },
          [HelpItem.GiveFeedback]: {
            choice: HelpChoice.Email,
            value: "fb@example.com",
          },
        }),
      ),
    ).toBeNull();
  });

  test("carries every place's choice, but only the values pages anybody can open show", () => {
    const value: string | null = toHelpAndSupportEnvironmentValue(
      settingsWith({
        [HelpItem.SupportEmail]: {
          choice: HelpChoice.Email,
          value: "it-help@example.com",
        },
        [HelpItem.HelpLink]: {
          choice: HelpChoice.Link,
          value: "https://help.example.com",
        },
        [HelpItem.Chat]: {
          choice: HelpChoice.Link,
          value: "https://join.slack.com/t/acme/shared_invite/zt-secret",
        },
        [HelpItem.MobileApp]: {
          choice: HelpChoice.Link,
          value: "https://portal.example.com/apps",
        },
        [HelpItem.RequestDemo]: { choice: HelpChoice.Hidden },
        [HelpItem.GitHub]: { choice: HelpChoice.Hidden },
        [HelpItem.InviteMessage]: {
          choice: HelpChoice.Text,
          value: "Ask IT.",
        },
      }),
    );

    expect(value).not.toBeNull();
    expect(JSON.parse(value!)).toEqual({
      supportEmail: { choice: "email", value: "it-help@example.com" },
      chat: { choice: "link" },
      helpLink: { choice: "link", value: "https://help.example.com" },
      requestDemo: { choice: "hidden" },
      mobileApp: { choice: "link" },
      gitHub: { choice: "hidden" },
    });
    // A chat invitation and the app's page never reach env.js.
    expect(value).not.toContain("zt-secret");
    expect(value).not.toContain("portal.example.com");
    expect(value).not.toContain("Ask IT.");
  });

  test("the items it carries, and those it carries a value for", () => {
    expect(HELP_AND_SUPPORT_ENVIRONMENT_ITEMS).not.toContain(
      HelpItem.InviteMessage,
    );
    expect(HELP_AND_SUPPORT_ENVIRONMENT_ITEMS).not.toContain(
      HelpItem.GiveFeedback,
    );
    expect(HELP_AND_SUPPORT_PUBLIC_VALUE_ITEMS).toEqual([
      HelpItem.SupportEmail,
      HelpItem.HelpLink,
    ]);
  });

  test("is read back by a frontend as the server meant it", () => {
    const settings: HelpAndSupportSettings = fromHelpAndSupportEnvironmentValue(
      JSON.stringify({
        supportEmail: { choice: "email", value: "it-help@example.com" },
        chat: { choice: "link" },
        helpLink: { choice: "hidden" },
        requestDemo: { choice: "hidden" },
        mobileApp: { choice: "link" },
        gitHub: { choice: "hidden" },
      }),
    );

    expect(getSupportEmailAddress(settings)).toBe("it-help@example.com");
    expect(isOneUptimeSupportEmail(settings)).toBe(false);
    // A chat link of the server's own, not read yet: no entry, never OneUptime's.
    expect(settings[HelpItem.Chat]).toEqual({
      choice: HelpChoice.Link,
      value: null,
    });
    expect(getChatLink(settings)).toBeNull();
    expect(getHelpPageLink(settings)).toBeNull();
    expect(getRequestDemoUrl(settings)).toBeNull();
    expect(isOneUptimeGitHubShown(settings)).toBe(false);
    expect(getMobileAppOffer(settings)).toEqual({
      kind: MobileAppOfferKind.OwnPage,
      url: null,
    });
  });

  test("a link env.js never holds back, sent without its value, reads as the default", () => {
    const settings: HelpAndSupportSettings = fromHelpAndSupportEnvironmentValue(
      JSON.stringify({ helpLink: { choice: "link" } }),
    );

    expect(settings[HelpItem.HelpLink]).toEqual({
      choice: HelpChoice.Default,
      value: null,
    });
  });

  test("an unsafe value in env.js is never shown", () => {
    const settings: HelpAndSupportSettings = fromHelpAndSupportEnvironmentValue(
      JSON.stringify({
        supportEmail: { choice: "email", value: "x<y>@example.com" },
        helpLink: { choice: "link", value: "javascript:alert(1)" },
        chat: { choice: "link", value: "data:text/html,hi" },
      }),
    );

    expect(getSupportEmailAddress(settings)).toBe(ONEUPTIME_SUPPORT_EMAIL);
    expect(getHelpPageLink(settings)?.url).toBe(ONEUPTIME_HELP_URL);
    expect(getChatLink(settings)?.url).toBe(ONEUPTIME_CHAT_URL);
  });

  test("nothing, or something env.js could not have written, reads as every default", () => {
    for (const raw of [undefined, null, "", "   ", "not json", "[]", "42"]) {
      expect(fromHelpAndSupportEnvironmentValue(raw)).toEqual(
        getDefaultHelpAndSupportSettings(),
      );
    }
  });

  test("round-trips every choice env.js carries", () => {
    const settings: HelpAndSupportSettings = settingsWith({
      [HelpItem.SupportEmail]: { choice: HelpChoice.Hidden },
      [HelpItem.HelpLink]: {
        choice: HelpChoice.Link,
        value: "mailto:help@example.com",
      },
      [HelpItem.Chat]: { choice: HelpChoice.Hidden },
    });

    const read: HelpAndSupportSettings = fromHelpAndSupportEnvironmentValue(
      toHelpAndSupportEnvironmentValue(settings),
    );

    expect(read[HelpItem.SupportEmail]).toEqual(
      settings[HelpItem.SupportEmail],
    );
    expect(read[HelpItem.HelpLink]).toEqual(settings[HelpItem.HelpLink]);
    expect(read[HelpItem.Chat]).toEqual(settings[HelpItem.Chat]);
  });
});

describe("what people see, place by place", () => {
  test("the support address: OneUptime's, the server's own, or none", () => {
    expect(
      getSupportEmailAddress(
        settingsWith({
          [HelpItem.SupportEmail]: {
            choice: HelpChoice.Email,
            value: "it-help@example.com",
          },
        }),
      ),
    ).toBe("it-help@example.com");
    expect(
      getSupportEmailAddress(
        settingsWith({
          [HelpItem.SupportEmail]: { choice: HelpChoice.Hidden },
        }),
      ),
    ).toBeNull();
  });

  test("the chat: named for the chat a link of the server's own opens", () => {
    const chatOf: (url: string) => ChatLink | null = (
      url: string,
    ): ChatLink | null => {
      return getChatLink(
        settingsWith({
          [HelpItem.Chat]: { choice: HelpChoice.Link, value: url },
        }),
      );
    };

    expect(chatOf("https://acme.slack.com/archives/C0123")).toEqual({
      url: "https://acme.slack.com/archives/C0123",
      kind: ChatKind.Slack,
      isOneUptime: false,
    });
    expect(
      chatOf("https://teams.microsoft.com/l/channel/19%3Aabc/Support")?.kind,
    ).toBe(ChatKind.MicrosoftTeams);
    expect(chatOf("https://chat.example.com/channel/help")?.kind).toBe(
      ChatKind.Other,
    );
    expect(
      getChatLink(
        settingsWith({ [HelpItem.Chat]: { choice: HelpChoice.Hidden } }),
      ),
    ).toBeNull();
  });

  test("a chat kind is read from the host, never from a lookalike", () => {
    expect(getChatKind("https://slack.com/x")).toBe(ChatKind.Slack);
    expect(getChatKind("https://acme.enterprise.slack.com/x")).toBe(
      ChatKind.Slack,
    );
    expect(getChatKind("https://notslack.com/x")).toBe(ChatKind.Other);
    expect(getChatKind("https://slack.com.evil.example/x")).toBe(
      ChatKind.Other,
    );
    expect(getChatKind("https://teams.live.com/meet/1")).toBe(
      ChatKind.MicrosoftTeams,
    );
    expect(getChatKind("https://teams.microsoft.com.evil.example")).toBe(
      ChatKind.Other,
    );
    expect(getChatKind("not a link")).toBe(ChatKind.Other);
  });

  test("the help page: the server's own shows even where the installation is renamed", () => {
    const own: HelpAndSupportSettings = settingsWith({
      [HelpItem.HelpLink]: {
        choice: HelpChoice.Link,
        value: "https://intranet.example.com/help",
      },
    });

    expect(getHelpPageLink(own, { isProductRenamed: true })).toEqual({
      url: "https://intranet.example.com/help",
      isOneUptime: false,
    });
    expect(
      getHelpPageLink(
        settingsWith({ [HelpItem.HelpLink]: { choice: HelpChoice.Hidden } }),
      ),
    ).toBeNull();
  });

  test("Request Demo and OneUptime's GitHub, shown or hidden", () => {
    const hidden: HelpAndSupportSettings = settingsWith({
      [HelpItem.RequestDemo]: { choice: HelpChoice.Hidden },
      [HelpItem.GitHub]: { choice: HelpChoice.Hidden },
    });

    expect(getRequestDemoUrl(hidden)).toBeNull();
    expect(isOneUptimeGitHubShown(hidden)).toBe(false);
  });

  test("the mobile app: OneUptime's stores, the server's own page, or nothing", () => {
    expect(
      getMobileAppOffer(
        settingsWith({
          [HelpItem.MobileApp]: {
            choice: HelpChoice.Link,
            value: "https://portal.example.com/apps/oneuptime",
          },
        }),
      ),
    ).toEqual({
      kind: MobileAppOfferKind.OwnPage,
      url: "https://portal.example.com/apps/oneuptime",
    });
    expect(
      getMobileAppOffer(
        settingsWith({ [HelpItem.MobileApp]: { choice: HelpChoice.Hidden } }),
      ),
    ).toBeNull();
  });
});
