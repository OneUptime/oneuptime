import { DocsSiteLinksClass } from "../../../../Server/Utils/HelpAndSupport/DocsSiteLinks";
import DocsSiteLinksStore from "../../../../Server/Utils/HelpAndSupport/DocsSiteLinksStore";
import { ExpressRequest } from "../../../../Server/Utils/Express";
import {
  DocsSiteLinks,
  HelpAndSupportSettings,
  HelpChoice,
  HelpItem,
  getDefaultHelpAndSupportSettings,
  getDocsSiteLinks,
} from "../../../../Types/HelpAndSupport/HelpAndSupport";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT THE DOCS SITE AND THE API REFERENCE LINK TO, FOR ONE REQUEST (#10940).
 *
 * The settings come from the copy every page is served from; a session is
 * read only where the server has a chat link of its own, so OneUptime Cloud
 * and every server without one read none. Neither a read that fails nor a
 * session that cannot be read ever stops a page of documentation.
 */

class TestLinks extends DocsSiteLinksClass {
  public settings: HelpAndSupportSettings = getDefaultHelpAndSupportSettings();
  public failSettings: boolean = false;
  public signedIn: boolean = false;
  public failSession: boolean = false;
  public sessionReads: number = 0;

  public override async getSettings(): Promise<HelpAndSupportSettings> {
    if (this.failSettings) {
      throw new Error("connection refused");
    }

    return this.settings;
  }

  public override async isSignedIn(req: ExpressRequest): Promise<boolean> {
    this.sessionReads++;

    if (this.failSession) {
      return await super.isSignedIn(req);
    }

    return this.signedIn;
  }
}

const REQUEST: ExpressRequest = {
  headers: {},
  cookies: {},
} as unknown as ExpressRequest;

const ownChat: (url: string) => HelpAndSupportSettings = (
  url: string,
): HelpAndSupportSettings => {
  return {
    ...getDefaultHelpAndSupportSettings(),
    [HelpItem.Chat]: { choice: HelpChoice.Link, value: url },
  };
};

let links: TestLinks;

beforeEach(() => {
  links = new TestLinks();
});

describe("reading what a page links to", () => {
  test("a server on its defaults links to OneUptime's, and reads no session", async () => {
    expect(await links.getLinks(REQUEST)).toEqual(
      getDocsSiteLinks(getDefaultHelpAndSupportSettings(), {
        isSignedIn: false,
      }),
    );
    expect(links.sessionReads).toBe(0);
  });

  test("a hidden chat reads no session either", async () => {
    links.settings = {
      ...getDefaultHelpAndSupportSettings(),
      [HelpItem.Chat]: { choice: HelpChoice.Hidden, value: null },
    };

    expect((await links.getLinks(REQUEST)).chat).toBeNull();
    expect(links.sessionReads).toBe(0);
  });

  test("a chat link of the server's own is read for a signed-in reader", async () => {
    links.settings = ownChat("https://acme.slack.com/archives/C024BE91L");
    links.signedIn = true;

    const read: DocsSiteLinks = await links.getLinks(REQUEST);

    expect(links.sessionReads).toBe(1);
    expect(read.chat?.url).toBe("https://acme.slack.com/archives/C024BE91L");
  });

  test("a chat link of the server's own is left out for anyone else", async () => {
    links.settings = ownChat("https://acme.slack.com/archives/C024BE91L");
    links.signedIn = false;

    expect((await links.getLinks(REQUEST)).chat).toBeNull();
    expect(links.sessionReads).toBe(1);
  });

  test("a request with no session at all is a reader who is not signed in", async () => {
    links.settings = ownChat("https://acme.slack.com/archives/C024BE91L");
    links.failSession = true;

    expect((await links.getLinks(REQUEST)).chat).toBeNull();
  });

  test("settings that cannot be read link to OneUptime's, and the page is served", async () => {
    links.failSettings = true;

    expect(await links.getLinks(REQUEST)).toEqual(
      getDocsSiteLinks(getDefaultHelpAndSupportSettings(), {
        isSignedIn: false,
      }),
    );
  });

  test("GitHub hidden is read as hidden, whoever reads", async () => {
    links.settings = {
      ...getDefaultHelpAndSupportSettings(),
      [HelpItem.GitHub]: { choice: HelpChoice.Hidden, value: null },
    };

    expect((await links.getLinks(REQUEST)).isGitHubShown).toBe(false);
  });
});

describe("the store the docs and the reference read through", () => {
  afterEach(() => {
    DocsSiteLinksStore.useReader(null);
  });

  test("without the App's reader, null: the pages link to what they always did", async () => {
    expect(await DocsSiteLinksStore.getLinks(REQUEST)).toBeNull();
  });

  test("with it, what the reader answers for the request", async () => {
    const answer: DocsSiteLinks = {
      isGitHubShown: false,
      chat: null,
      supportUrl: "https://help.acme.example",
    };
    const asked: Array<ExpressRequest> = [];

    DocsSiteLinksStore.useReader(
      async (req: ExpressRequest): Promise<DocsSiteLinks> => {
        asked.push(req);
        return answer;
      },
    );

    expect(await DocsSiteLinksStore.getLinks(REQUEST)).toEqual(answer);
    expect(asked).toEqual([REQUEST]);
  });

  test("a reader that fails answers null, never an error", async () => {
    DocsSiteLinksStore.useReader(async (): Promise<DocsSiteLinks> => {
      throw new Error("The database went away.");
    });

    expect(await DocsSiteLinksStore.getLinks(REQUEST)).toBeNull();
  });
});
