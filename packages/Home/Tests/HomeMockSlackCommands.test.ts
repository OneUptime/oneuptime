import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE WEBSITE'S PICTURES OF ONEUPTIME NAME ONLY COMMANDS IT HAS.
 *
 * The homepage's incident mock showed a Slack chip, "/incident update" - a
 * command OneUptime never had. OneUptime's Slack app has one command,
 * /oneuptime, and every action is a word after it (/oneuptime incident,
 * /oneuptime page, ...): the old /incident and /maintenance were replaced so
 * they would not clash with other apps. A visitor who tries what the picture
 * shows should find it there.
 *
 * Every text in the mocks that reads as a slash command (a "/" and a word,
 * the whole text of an element) is one the Slack app's manifest registers.
 */

const MOCKS_DIRECTORY: string = path.resolve(
  __dirname,
  "../Views/Partials/home-mocks",
);

const MANIFEST_PATH: string = path.resolve(
  __dirname,
  "../../Common/Server/Utils/Workspace/Slack/app-manifest.json",
);

// The commands the Slack app registers: "/oneuptime".
function registeredCommands(): Array<string> {
  const manifest: {
    features: { slash_commands: Array<{ command: string }> };
  } = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  return manifest.features.slash_commands.map(
    (command: { command: string }): string => {
      return command.command;
    },
  );
}

/*
 * The texts between an element's tags that start like a slash command: "/"
 * then a letter. One walk over the markup.
 */
function commandLikeTexts(markup: string): Array<string> {
  const texts: Array<string> = [];
  let from: number = 0;

  while (from < markup.length) {
    const close: number = markup.indexOf(">", from);

    if (close === -1) {
      break;
    }

    const open: number = markup.indexOf("<", close + 1);
    const text: string = markup
      .substring(close + 1, open === -1 ? markup.length : open)
      .trim();

    if (text.length > 1 && text.charAt(0) === "/") {
      const second: string = text.charAt(1);

      if (second.toLowerCase() !== second.toUpperCase()) {
        texts.push(text);
      }
    }

    if (open === -1) {
      break;
    }

    from = open;
  }

  return texts;
}

describe("the homepage mocks' Slack commands", () => {
  const mocks: Array<string> = fs
    .readdirSync(MOCKS_DIRECTORY)
    .filter((file: string): boolean => {
      return file.endsWith(".ejs");
    });

  test("there are mocks to read", () => {
    expect(mocks.length).toBeGreaterThan(0);
    expect(mocks).toContain("mock-respond.ejs");
  });

  test.each(mocks)("%s names only commands the Slack app has", (file: string) => {
    const markup: string = fs.readFileSync(
      path.join(MOCKS_DIRECTORY, file),
      "utf8",
    );

    for (const text of commandLikeTexts(markup)) {
      const command: string = text.split(" ")[0] as string;

      expect({ file: file, text: text, isRegistered: registeredCommands().includes(command) }).toEqual({
        file: file,
        text: text,
        isRegistered: true,
      });
    }
  });

  test("the incident mock shows a page sent from Slack with /oneuptime page", () => {
    const markup: string = fs.readFileSync(
      path.join(MOCKS_DIRECTORY, "mock-respond.ejs"),
      "utf8",
    );

    expect(commandLikeTexts(markup)).toEqual(["/oneuptime page @db-oncall"]);
    expect(markup).not.toContain("/incident update");
  });

  test("the reader finds a command a mock might name, and nothing else", () => {
    expect(
      commandLikeTexts(
        '<span class="font-mono">/incident update</span><a href="/docs">Docs</a><p> / 3 </p><b>/oneuptime help</b>',
      ),
    ).toEqual(["/incident update", "/oneuptime help"]);
  });
});
