import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "@jest/globals";
import * as React from "react";
import fs from "fs";
import path from "path";

import MicrosoftTeamsIntegrationDocumentation from "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegrationDocumentation";

/*
 * A self-hosted deployment that Azure Bot Service cannot reach does not look
 * broken. Alert cards keep arriving, because OneUptime posts those by calling
 * Microsoft — no inbound access needed. Everything that travels the other way
 * is dead: card buttons answer "Unable to reach app", bot commands go
 * unanswered, and chats never register because chat registration *is* an
 * inbound bot activity.
 *
 * Read from inside Teams that reads as a half-finished integration, and the
 * cheapest check an admin runs next — opening the messaging endpoint in a
 * browser — used to return "Page not found". So the docs are what has to
 * carry the diagnosis: the two directions are independent, a working alert
 * tests only one of them, and an empty Chats list is the confirmation rather
 * than a second unrelated bug.
 *
 * These assertions are on prose because the failure was prose.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const DOCS_MARKDOWN_PATH: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Docs/Content/en/self-hosted/microsoft-teams-integration.md",
);

const IN_PRODUCT_GUIDE_PATH: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegrationDocumentation.tsx",
);

const TEAMS_API_PATH: string = path.join(
  REPO_ROOT,
  "Common/Server/API/MicrosoftTeamsAPI.ts",
);

const MESSAGING_ENDPOINT_PATH: string = "/api/microsoft-bot/messages";

type ReadFileFunction = (filePath: string) => string;

const readSource: ReadFileFunction = (filePath: string): string => {
  return fs.readFileSync(filePath, "utf8");
};

type RenderDocumentationFunction = () => Promise<string>;

/*
 * react-markdown is mocked globally to a div holding its children, so the
 * resolved markdown (window.location.origin already interpolated) is what
 * lands in the DOM.
 *
 * The explicit timeout is not padding. MarkdownViewer is a React.lazy import,
 * so the very first render has to pull the viewer's whole module graph through
 * ts-jest before anything reaches the DOM — comfortably past findBy's 1s
 * default on a cold cache, while every later render resolves the already
 * loaded chunk in single-digit milliseconds. Left at the default, the first
 * test to render would fail and every other one would pass, which reads as a
 * content bug rather than the warm-up cost it is.
 */
const renderDocumentationText: RenderDocumentationFunction =
  async (): Promise<string> => {
    render(<MicrosoftTeamsIntegrationDocumentation />);

    const markdown: HTMLElement = await screen.findByTestId(
      "react-markdown",
      {},
      { timeout: 30000 },
    );

    return markdown.textContent || "";
  };

/*
 * Raised for the same reason: the lazy chunk has to load once, inside whichever
 * test renders first, and 5s is not enough headroom for that on a cold cache
 * under CI contention.
 */
jest.setTimeout(60000);

const docsMarkdown: string = readSource(DOCS_MARKDOWN_PATH);

describe("Self-hosted docs: verifying the messaging endpoint during setup", () => {
  const stepFour: string = docsMarkdown
    .split("### Step 4: Create a Bot Service")[1]!
    .split("### Step 5:")[0]!;

  test("tells the admin to verify the endpoint before moving on", () => {
    expect(stepFour).toContain("Verify the endpoint before you move on");
  });

  test("says to test from outside the network, not from inside the cluster", () => {
    const lowered: string = stepFour.toLowerCase();

    expect(lowered).toContain("outside your network");
    expect(lowered).toContain("inside the cluster");
    expect(lowered).toContain("vpn");
  });

  test("gives a curl that shows the response body, not only the status code", () => {
    /*
     * An earlier draft used `-o /dev/null -w '%{http_code}'`, which throws
     * away the one thing that makes a 404 diagnosable. Keep -i.
     */
    expect(stepFour).toContain("curl -sS -i");
    expect(stepFour).not.toContain("-o /dev/null");
    expect(stepFour).toContain(MESSAGING_ENDPOINT_PATH);
  });

  test("names 405 as the passing result", () => {
    /*
     * The status code is the whole signal, so it has to be stated as success
     * outright — an admin who reads 405 as an error stops here.
     */
    expect(stepFour).toContain("**405**");
    expect(stepFour.toLowerCase()).toMatch(/405.*(correct|done)/s);
  });

  test("splits 404 by response body rather than calling every 404 unreachable", () => {
    /*
     * The regression this guards is the one the reviewers caught: OneUptime's
     * own not-found handler serves a 404 for this path, so "404 means the
     * request did not reach OneUptime" is false exactly when an admin is most
     * likely to hit it (any build older than the 405, or an ingress that
     * strips the /api prefix). Both readings must be present and separated by
     * the body.
     */
    const lowered: string = stepFour.toLowerCase();

    expect(stepFour).toContain(
      '**404 with a JSON body of `{"message":"Page not found - /api/microsoft-bot/messages"}`**',
    );
    expect(lowered).toContain(
      "came from oneuptime, so the request *did* arrive",
    );

    expect(stepFour).toContain("**404 with an HTML error page**");
    expect(lowered).toContain("never reached oneuptime");

    expect(lowered).toMatch(/proxy|ingress|load balancer/);
    expect(lowered).toContain("tls error");
  });

  test("explains why the body matters before listing the outcomes", () => {
    expect(stepFour.toLowerCase()).toContain(
      "the only thing that tells you who produced it",
    );
  });
});

describe("Self-hosted docs: the unreachable-endpoint troubleshooting section", () => {
  const section: string = docsMarkdown
    .split(
      '### Card buttons say "Unable to reach app", and chats never appear',
    )[1]!
    .split("### Checking this deployment's bot configuration")[0]!;

  test("the section exists and is reachable from the Step 4 anchor", () => {
    expect(section.length).toBeGreaterThan(0);
    expect(docsMarkdown).toContain(
      "#card-buttons-say-unable-to-reach-app-and-chats-never-appear",
    );
  });

  test("states the single root cause up front", () => {
    expect(section).toContain(
      "**Azure Bot Service cannot reach your messaging endpoint.**",
    );
    expect(section).toContain("These are one failure, not two");
  });

  test("explains that a working alert card tests the opposite direction", () => {
    const lowered: string = section.toLowerCase();

    expect(lowered).toContain("oneuptime calls microsoft");
    expect(lowered).toMatch(
      /tells you nothing at all about the bot endpoint|working alert/,
    );
  });

  test("tabulates which paths need inbound access and which do not", () => {
    expect(section).toContain("| Direction |");
    expect(section).toContain("Needs Azure to reach you?");

    const rows: Array<string> = section.split("\n").filter((line: string) => {
      return line.trim().startsWith("|") && line.includes("**");
    });

    /*
     * One "No" row (the outbound alert) and three "Yes" rows (button tap, bot
     * command, chat registration) — the asymmetry is the point of the table,
     * so a table that lost the outbound row would still read as consistent
     * and would no longer explain anything.
     */
    expect(
      rows.filter((row: string) => {
        return row.includes("**No**");
      }),
    ).toHaveLength(1);
    expect(
      rows.filter((row: string) => {
        return row.includes("**Yes**");
      }).length,
    ).toBeGreaterThanOrEqual(3);
  });

  test("explains why the empty Chats list confirms the diagnosis", () => {
    const lowered: string = section.toLowerCase();

    expect(lowered).toContain("refresh chats");
    expect(lowered).toContain("application permissions");
  });

  test("names all three activities that register a chat, not just the install event", () => {
    /*
     * captureChatFromBotActivity is called from three inbound paths in
     * MicrosoftTeams.ts: installationUpdate add/add-upgrade, conversationUpdate
     * with the bot in membersAdded, and any message in a personal/groupChat
     * conversation. That third one is deliberate — it is the documented
     * recovery path for chats installed before chat capture shipped, and the
     * Chats card's own empty state tells admins to use it. Saying a chat can
     * only register from an installation event tells an admin their setup is
     * broken when messaging the bot would have fixed it.
     */
    const lowered: string = section.toLowerCase();

    expect(lowered).toContain("installed");
    expect(lowered).toContain("added to the conversation");
    expect(lowered).toContain("any message sent to the bot");
  });

  test("the inbound table describes chat registration as an activity, not an install event", () => {
    const chatRow: string =
      section.split("\n").find((line: string) => {
        return line.includes("A chat registers under");
      }) || "";

    expect(chatRow).not.toBe("");
    expect(chatRow).toContain("bot activity");
    expect(chatRow).not.toContain("installation event");
  });

  test("tells the admin to grep for the POST rather than the 404", () => {
    expect(section).toContain("Look for the POST, not for 404s");
    expect(section).toContain("grep 'POST /api/microsoft-bot/messages'");
  });

  test("covers the certificate chain, with a command that checks it", () => {
    expect(section).toContain("publicly trusted certificate");
    expect(section).toContain("full chain");
    expect(section).toContain("openssl s_client");
    expect(section).toContain("-verify_return_error");
  });

  test("explains why a TLS failure leaves the access log empty", () => {
    expect(section.toLowerCase()).toContain(
      "before oneuptime sees the request",
    );
  });

  test("covers private DNS and split-horizon records", () => {
    const lowered: string = section.toLowerCase();

    expect(lowered).toContain("private dns name");
    expect(lowered).toContain("split-horizon");
  });

  test("says outright that a 404 on GET is not the bug", () => {
    /*
     * This is the sentence the issue was filed for. Without it the docs
     * describe the right fix and still leave the misleading evidence
     * unexplained.
     */
    expect(section).toContain(
      "**A 404 on `GET /api/microsoft-bot/messages` is not the bug, and it is not evidence Azure could not reach you.**",
    );
    expect(section).toContain("has always accepted POST only");
    expect(section).toContain("405 Method Not Allowed");
  });

  test("states that OneUptime generated that 404, so the request reached the app", () => {
    /*
     * The point that closes issue #3488: the reporter's `404 58` is 58 bytes
     * of OneUptime's own JSON, so their request arrived. Reading that 404 as
     * "Azure could not reach us" is the wrong turn the whole section exists
     * to prevent, and the byte count is what makes it checkable against a
     * real access log.
     */
    expect(section).toContain(
      '{"message":"Page not found - /api/microsoft-bot/messages"}',
    );
    expect(section.toLowerCase()).toContain("the request reached the app");
    expect(section).toContain("58 bytes");
    expect(section).toContain(
      '"GET /api/microsoft-bot/messages HTTP/1.1" 404 58',
    );
  });

  test("tells admins on older builds to judge a 404 by its body", () => {
    const lowered: string = section.toLowerCase();

    expect(lowered).toContain("judge a 404 by its body");
    expect(lowered).toContain("html error page");
  });
});

describe("Self-hosted docs: the bot configuration check", () => {
  const section: string = docsMarkdown
    .split("### Checking this deployment's bot configuration")[1]!
    .split('### "The OneUptime app is not installed')[0]!;

  test("documents the /api/microsoft-bot/test endpoint", () => {
    expect(section).toContain("/api/microsoft-bot/test");
    expect(section).toContain("curl");
  });

  test("says what it cannot tell you, so it is not mistaken for a green light", () => {
    const lowered: string = section.toLowerCase();

    expect(lowered).toContain("does not call azure");
    expect(lowered).toContain("cannot tell you");
    expect(lowered).toContain("reach you");
  });

  test("names the bot id comparison as the decisive check", () => {
    expect(section).toContain("botId");
    expect(section.toLowerCase()).toContain("bot id of the oneuptime app");
  });
});

describe("In-product setup guide", () => {
  test("Step 5 tells the admin to verify the endpoint and names 405 as correct", async () => {
    const text: string = await renderDocumentationText();

    const stepFive: string = text
      .split("##### Step 5: Create a Bot Service")[1]!
      .split("##### Step 6")[0]!;

    expect(stepFive).toContain("Verify the endpoint before moving on");
    expect(stepFive).toContain("**405**");
    expect(stepFive).toContain("curl -sS -i");
    expect(stepFive).not.toContain("-o /dev/null");
    expect(stepFive.toLowerCase()).toContain("outside your network");
  });

  test("Step 5 splits 404 by response body, matching the self-hosted docs", async () => {
    const text: string = await renderDocumentationText();

    const stepFive: string = text
      .split("##### Step 5: Create a Bot Service")[1]!
      .split("##### Step 6")[0]!;

    expect(stepFive).toContain("**404 with a JSON body of");
    expect(stepFive).toContain("**404 with an HTML error page**");
    expect(stepFive.toLowerCase()).toContain("the request *did* arrive");
    expect(stepFive.toLowerCase()).toContain("never reached oneuptime");
  });

  test("Step 5 interpolates this deployment's own origin into the check", async () => {
    const text: string = await renderDocumentationText();

    const stepFive: string = text
      .split("##### Step 5: Create a Bot Service")[1]!
      .split("##### Step 6")[0]!;

    expect(stepFive).toContain(
      `${window.location.origin}${MESSAGING_ENDPOINT_PATH}`,
    );
  });

  test("Troubleshooting covers the unreachable endpoint as one failure, not two", async () => {
    const text: string = await renderDocumentationText();
    const troubleshooting: string = text.split("##### Troubleshooting")[1]!;

    expect(troubleshooting).toContain(
      'Card buttons say "Unable to reach app", and chats never appear',
    );
    expect(troubleshooting).toContain("One failure, not two");
    expect(troubleshooting).toContain(
      "**Azure Bot Service cannot reach your messaging endpoint.**",
    );
  });

  test("Troubleshooting tells the admin to grep for the POST", async () => {
    const text: string = await renderDocumentationText();
    const troubleshooting: string = text.split("##### Troubleshooting")[1]!;

    expect(troubleshooting).toContain("Look for the POST, not for 404s");
    expect(troubleshooting).toContain("POST /api/microsoft-bot/messages");
  });

  test("Troubleshooting covers the TLS chain and public DNS resolution", async () => {
    const text: string = await renderDocumentationText();
    const troubleshooting: string = text.split("##### Troubleshooting")[1]!;

    expect(troubleshooting).toContain("publicly trusted certificate");
    expect(troubleshooting.toLowerCase()).toContain("split-horizon");
  });

  test("Troubleshooting says a 404 on GET is not the bug, and that OneUptime served it", async () => {
    const text: string = await renderDocumentationText();
    const troubleshooting: string = text.split("##### Troubleshooting")[1]!;

    expect(troubleshooting).toContain(
      "A 404 on `GET /api/microsoft-bot/messages` is not the bug, and it is not evidence Azure could not reach you.",
    );
    expect(troubleshooting).toContain(
      '{"message":"Page not found - /api/microsoft-bot/messages"}',
    );
    expect(troubleshooting.toLowerCase()).toContain("reached the app");
    expect(troubleshooting).toContain("58 bytes");
  });

  test("the empty-chats entry names every activity that registers a chat", async () => {
    /*
     * An earlier draft said chats register "only when the bot receives an
     * activity" here while the markdown said "only ... the installation
     * event" — two documents in one change disagreeing, with the markdown
     * being the wrong one. Both now name all three paths.
     */
    const text: string = await renderDocumentationText();
    const troubleshooting: string = text.split("##### Troubleshooting")[1]!;

    const chatsSection: string = troubleshooting.split(
      "**No chats appear under Microsoft Teams Chats**",
    )[1]!;

    const lowered: string = chatsSection.toLowerCase();

    expect(lowered).toContain("the app being installed");
    expect(lowered).toContain("added to the conversation");
    expect(lowered).toContain("any message sent to the bot");
  });

  test("the empty-chats entry now lists the unreachable endpoint first", async () => {
    /*
     * It used to name exactly one cause — a wrong app package — which is the
     * rarer of the two and sends the admin to re-upload a manifest that was
     * already correct. The giveaway for the common cause (alerts still post)
     * has to be on this screen.
     */
    const text: string = await renderDocumentationText();
    const troubleshooting: string = text.split("##### Troubleshooting")[1]!;

    const chatsSection: string = troubleshooting.split(
      "**No chats appear under Microsoft Teams Chats**",
    )[1]!;

    const unreachableIndex: number = chatsSection.indexOf(
      "The messaging endpoint is unreachable",
    );
    const wrongPackageIndex: number = chatsSection.indexOf(
      "The installed package points at a different deployment",
    );

    expect(unreachableIndex).toBeGreaterThan(-1);
    expect(wrongPackageIndex).toBeGreaterThan(-1);
    expect(unreachableIndex).toBeLessThan(wrongPackageIndex);
    expect(chatsSection).toContain("alerts still post to channels");
  });

  test("documents /api/microsoft-bot/test and its limits", async () => {
    const text: string = await renderDocumentationText();
    const troubleshooting: string = text.split("##### Troubleshooting")[1]!;

    expect(troubleshooting).toContain("/api/microsoft-bot/test");
    expect(troubleshooting).toContain("does not call Azure");
  });
});

describe("The messaging endpoint path is stated identically everywhere", () => {
  /*
   * Three files tell an admin what to paste into the Azure Bot's Configuration
   * blade, and the API is the only one of them that decides what the server
   * actually serves. A drift between them is unfalsifiable from inside Teams:
   * the bot simply never responds, which is the same symptom as every other
   * cause in this section.
   */
  const SOURCES: Array<string> = [
    DOCS_MARKDOWN_PATH,
    IN_PRODUCT_GUIDE_PATH,
    TEAMS_API_PATH,
  ];

  test.each(SOURCES)("%s names /microsoft-bot/messages", (filePath: string) => {
    expect(readSource(filePath)).toContain("/microsoft-bot/messages");
  });

  test("no source has drifted to a different bot path", () => {
    const BOT_PATH_PATTERN: RegExp = /\/microsoft-bot\/[a-z-]+/g;
    const KNOWN_PATHS: Array<string> = [
      "/microsoft-bot/messages",
      "/microsoft-bot/test",
    ];

    SOURCES.forEach((filePath: string) => {
      const found: Array<string> = readSource(filePath).match(
        BOT_PATH_PATTERN,
      ) as Array<string>;

      expect(found).not.toBeNull();

      found.forEach((botPath: string) => {
        expect(KNOWN_PATHS).toContain(botPath);
      });
    });
  });
});
