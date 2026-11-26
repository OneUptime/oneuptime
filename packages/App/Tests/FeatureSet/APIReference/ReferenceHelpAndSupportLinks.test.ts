import {
  PAGE_FIXTURES,
  PageFixture,
  countOccurrences,
  renderPage,
} from "./ReferenceFixtures";
import { buildPageRenderContext } from "../../../FeatureSet/APIReference/Utils/RenderContext";
import DocsSiteLinksStore from "Common/Server/Utils/HelpAndSupport/DocsSiteLinksStore";
import { ExpressRequest } from "Common/Server/Utils/Express";
import {
  ChatKind,
  DocsSiteLinks,
  HelpAndSupportSettings,
  HelpChoice,
  HelpItem,
  ONEUPTIME_CHAT_URL,
  getDefaultHelpAndSupportSettings,
  getDocsSiteLinks,
} from "Common/Types/HelpAndSupport/HelpAndSupport";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * THE API REFERENCE FOLLOWS THIS SERVER'S HELP AND SUPPORT SETTINGS (#10940).
 *
 * Its top bar links to Slack, Support and GitHub, and its footer to GitHub.
 * Where a self-hosted server's admins pointed those at their own people or
 * hid them (Admin Dashboard > Settings > Help and Support), the reference
 * does the same: no Slack, or the server's own chat - named for the chat it
 * opens, and only for a signed-in reader, as these pages are public - its
 * own help page as Support, or none, and no GitHub. Rendered without the
 * server's links, or with them on their defaults, it reads as it always did.
 */

const SLACK_INVITE: string = `href="${ONEUPTIME_CHAT_URL}"`;
const GITHUB: string = 'href="https://github.com/oneuptime/oneuptime"';
const SUPPORT: string = 'href="/support"';

const linksWith: (
  changes: Partial<
    Record<HelpItem, { choice: HelpChoice; value?: string | null }>
  >,
  isSignedIn?: boolean,
) => DocsSiteLinks = (
  changes: Partial<
    Record<HelpItem, { choice: HelpChoice; value?: string | null }>
  >,
  isSignedIn: boolean = false,
): DocsSiteLinks => {
  const settings: HelpAndSupportSettings = getDefaultHelpAndSupportSettings();

  for (const [item, change] of Object.entries(changes)) {
    settings[item as HelpItem] = {
      choice: change!.choice,
      value: change!.value ?? null,
    };
  }

  return getDocsSiteLinks(settings, { isSignedIn: isSignedIn });
};

const INTRODUCTION: PageFixture = PAGE_FIXTURES["introduction"]!;

// The top bar's links, as drawn (the nav before the sign-in button).
const topBarOf: (html: string) => string = (html: string): string => {
  const start: number = html.indexOf('<nav class="max-xl:hidden xl:block"');
  const end: number = html.indexOf("</nav>", start);

  return start >= 0 && end > start ? html.slice(start, end) : "";
};

// The footer, as drawn.
const footerOf: (html: string) => string = (html: string): string => {
  const start: number = html.lastIndexOf("<footer");

  return start >= 0 ? html.slice(start) : "";
};

describe("a server that never changed Help and Support", () => {
  it.each([
    ["rendered without the server's links", {}],
    ["rendered with no answer from the server", { helpLinks: null }],
    [
      "rendered with them on their defaults",
      {
        helpLinks: getDocsSiteLinks(getDefaultHelpAndSupportSettings(), {
          isSignedIn: false,
        }),
      },
    ],
  ])(
    "%s: OneUptime's Slack, Support and GitHub, as always",
    async (_name: string, options: { helpLinks?: DocsSiteLinks | null }) => {
      const html: string = await renderPage(INTRODUCTION, options);
      const topBar: string = topBarOf(html);

      expect(topBar).toContain(SLACK_INVITE);
      expect(topBar).toContain(SUPPORT);
      expect(topBar).toContain(GITHUB);
      expect(topBar).toContain(">Slack</a>");
      expect(footerOf(html)).toContain(GITHUB);
    },
  );

  it("names the links in the reader's language", async () => {
    const topBar: string = topBarOf(
      await renderPage(INTRODUCTION, { lang: "es" }),
    );

    expect(topBar).toContain(">Soporte</a>");
  });
});

describe("GitHub hidden", () => {
  const hidden: DocsSiteLinks = linksWith({
    [HelpItem.GitHub]: { choice: HelpChoice.Hidden },
  });

  it("leaves GitHub out of the top bar and the footer", async () => {
    const html: string = await renderPage(INTRODUCTION, { helpLinks: hidden });

    expect(topBarOf(html)).not.toContain(GITHUB);
    expect(footerOf(html)).not.toContain(GITHUB);
    expect(countOccurrences(html, GITHUB)).toBe(0);
  });

  it("keeps the other links", async () => {
    const topBar: string = topBarOf(
      await renderPage(INTRODUCTION, { helpLinks: hidden }),
    );

    expect(topBar).toContain(SLACK_INVITE);
    expect(topBar).toContain(SUPPORT);
  });

  it.each(Object.entries(PAGE_FIXTURES))(
    "on every page: %s",
    async (_name: string, fixture: PageFixture) => {
      const html: string = await renderPage(fixture, { helpLinks: hidden });

      expect(countOccurrences(html, GITHUB)).toBe(0);
    },
  );
});

describe("the chat", () => {
  it("hidden: no chat link", async () => {
    const topBar: string = topBarOf(
      await renderPage(INTRODUCTION, {
        helpLinks: linksWith({
          [HelpItem.Chat]: { choice: HelpChoice.Hidden },
        }),
      }),
    );

    expect(topBar).not.toContain("data-reference-chat");
    expect(topBar).not.toContain(SLACK_INVITE);
    expect(topBar).not.toContain(">Slack</a>");
  });

  it("a Slack of the server's own, for a signed-in reader: named Slack, opening it", async () => {
    const topBar: string = topBarOf(
      await renderPage(INTRODUCTION, {
        helpLinks: linksWith(
          {
            [HelpItem.Chat]: {
              choice: HelpChoice.Link,
              value: "https://acme.slack.com/archives/C024BE91L",
            },
          },
          true,
        ),
      }),
    );

    expect(topBar).toContain(
      'href="https://acme.slack.com/archives/C024BE91L"',
    );
    expect(topBar).toContain('data-reference-chat="own"');
    expect(topBar).toContain(">Slack</a>");
    expect(topBar).not.toContain(SLACK_INVITE);
  });

  it("a Microsoft Teams link of the server's own is named Microsoft Teams", async () => {
    const topBar: string = topBarOf(
      await renderPage(INTRODUCTION, {
        helpLinks: linksWith(
          {
            [HelpItem.Chat]: {
              choice: HelpChoice.Link,
              value: "https://teams.microsoft.com/l/channel/19%3aabc/General",
            },
          },
          true,
        ),
      }),
    );

    expect(topBar).toContain(">Microsoft Teams</a>");
  });

  it("any other chat of the server's own is named Chat, in the reader's language", async () => {
    const helpLinks: DocsSiteLinks = linksWith(
      {
        [HelpItem.Chat]: {
          choice: HelpChoice.Link,
          value: "https://chat.acme.example/support",
        },
      },
      true,
    );

    expect(helpLinks.chat?.kind).toBe(ChatKind.Other);
    expect(
      topBarOf(await renderPage(INTRODUCTION, { helpLinks: helpLinks })),
    ).toContain(">Chat</a>");
    expect(
      topBarOf(
        await renderPage(INTRODUCTION, { helpLinks: helpLinks, lang: "ru" }),
      ),
    ).toContain(">Чат</a>");
  });

  it("a chat of the server's own is never shown to a reader who is not signed in", async () => {
    const topBar: string = topBarOf(
      await renderPage(INTRODUCTION, {
        helpLinks: linksWith({
          [HelpItem.Chat]: {
            choice: HelpChoice.Link,
            value: "https://join.slack.com/t/acme/shared_invite/zt-secret",
          },
        }),
      }),
    );

    expect(topBar).not.toContain("zt-secret");
    expect(topBar).not.toContain("data-reference-chat");
  });
});

describe("Support", () => {
  it("a help page of the server's own opens in a new tab", async () => {
    const topBar: string = topBarOf(
      await renderPage(INTRODUCTION, {
        helpLinks: linksWith({
          [HelpItem.HelpLink]: {
            choice: HelpChoice.Link,
            value: "https://help.acme.example/oneuptime?from=docs&lang=en",
          },
        }),
      }),
    );

    // Written escaped, as every value in the page is.
    expect(topBar).toContain(
      'href="https://help.acme.example/oneuptime?from=docs&amp;lang=en"',
    );
    expect(topBar).not.toContain(SUPPORT);

    const support: string = topBar.slice(
      topBar.lastIndexOf("<a", topBar.indexOf("data-reference-support")),
    );

    expect(support).toContain('target="_blank"');
  });

  it("the address the reference always had stays where it is, in the same tab", async () => {
    const topBar: string = topBarOf(await renderPage(INTRODUCTION, {}));
    const support: string = topBar.slice(
      topBar.lastIndexOf("<a", topBar.indexOf("data-reference-support")),
      topBar.indexOf("</a>", topBar.indexOf("data-reference-support")),
    );

    expect(support).toContain(SUPPORT);
    expect(support).not.toContain('target="_blank"');
  });

  it("hidden: no Support link", async () => {
    const topBar: string = topBarOf(
      await renderPage(INTRODUCTION, {
        helpLinks: linksWith({
          [HelpItem.HelpLink]: { choice: HelpChoice.Hidden },
        }),
      }),
    );

    expect(topBar).not.toContain("data-reference-support");
    expect(topBar).not.toContain(SUPPORT);
  });
});

describe("a page's context, as the services build it", () => {
  const request: ExpressRequest = {
    params: { lang: "en", page: "introduction" },
    originalUrl: "/reference/en/introduction",
    headers: {},
  } as unknown as ExpressRequest;

  afterEach(() => {
    DocsSiteLinksStore.useReader(null);
  });

  it("carries the links the App's reader answers for the request", async () => {
    const answer: DocsSiteLinks = linksWith({
      [HelpItem.GitHub]: { choice: HelpChoice.Hidden },
    });

    DocsSiteLinksStore.useReader(async (): Promise<DocsSiteLinks> => {
      return answer;
    });

    const context: Awaited<ReturnType<typeof buildPageRenderContext>> =
      await buildPageRenderContext(request);

    expect(context.helpLinks).toEqual(answer);
    expect(context.lang).toBe("en");
    expect(context.currentPage).toBe("introduction");
  });

  it("carries none without the reader, so the page links to what it always did", async () => {
    expect((await buildPageRenderContext(request)).helpLinks).toBeNull();
  });
});
