import slugify from "Common/Server/Types/MarkdownSlugify";
import { Argument } from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import IRCComponents, {
  IRC_DEFAULT_NICKNAME,
  IRC_DEFAULT_PLAIN_TEXT_PORT,
  IRC_DEFAULT_TLS_PORT,
  IRC_MAX_LINES,
} from "Common/Types/Workflow/Components/IRC";
import { WorkflowDocsPaths } from "Common/Types/Workflow/Documentation/DocumentationLinks";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The IRC step's section of the workflow Components guide. The step's
 * "How to use" help links to it by anchor, and the docs answer in the
 * reader's language, so every language has the section; the English one
 * says what the step does with each of its settings, by the names the form
 * shows, and with the defaults the step really uses.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LOCALES: ReadonlyArray<string> = fs
  .readdirSync(CONTENT_DIR)
  .filter((entry: string): boolean => {
    return fs.statSync(path.join(CONTENT_DIR, entry)).isDirectory();
  })
  .sort();

const PAGE: string = "workflows/components";

function read(language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${PAGE}.md`),
    "utf8",
  );
}

function headings(markdown: string): Array<string> {
  return markdown
    .split("\n")
    .filter((line: string) => {
      return line.startsWith("## ");
    })
    .map((line: string) => {
      return line.substring(3).trim();
    });
}

// The text under "## IRC", up to the next "## " heading.
function ircSection(markdown: string): string {
  const start: number = markdown.indexOf("\n## IRC\n");

  expect(start).toBeGreaterThanOrEqual(0);

  const rest: string = markdown.substring(start + "\n## IRC\n".length);
  const end: number = rest.indexOf("\n## ");

  return end === -1 ? rest : rest.substring(0, end);
}

const ARGUMENTS: Array<Argument> = IRCComponents.find(
  (component: { id: string }) => {
    return component.id === ComponentID.IRCSendMessageToChannel;
  },
)!.arguments;

describe("the IRC section of the Components guide", () => {
  test("is where the step's help links to", () => {
    expect(WorkflowDocsPaths.irc).toBe(`/${PAGE}#irc`);
  });

  test("is in every language, so the link lands on it whatever the reader's", () => {
    expect(LOCALES.length).toBeGreaterThanOrEqual(17);

    for (const language of LOCALES) {
      expect({
        language,
        anchors: headings(read(language)).map((heading: string) => {
          return slugify(heading);
        }),
      }).toEqual({ language, anchors: expect.arrayContaining(["irc"]) });
    }
  });

  test("follows Telegram, with the other chat steps, in every language", () => {
    for (const language of LOCALES) {
      const all: Array<string> = headings(read(language));

      expect({ language, next: all[all.indexOf("Telegram") + 1] }).toEqual({
        language,
        next: "IRC",
      });
    }
  });

  test("names the settings as the form does, in every language", () => {
    for (const language of LOCALES) {
      const section: string = ircSection(read(language));

      for (const name of ["IRC Server", "Channel", "Message Text"]) {
        expect({
          language,
          name,
          named: section.includes(`**${name}**`),
        }).toEqual({ language, name, named: true });
      }

      expect(section).toContain("`irc.libera.chat`");
      expect(section).toContain("`#ops`");
    }
  });

  test("in English, says what every setting of the step does", () => {
    const section: string = ircSection(read("en"));

    for (const argument of ARGUMENTS) {
      expect({
        setting: argument.name,
        named: section.includes(`**${argument.name}**`),
      }).toEqual({
        setting: argument.name,
        named: true,
      });
    }

    expect(section).toContain("**Success**");
    expect(section).toContain("**Error**");
  });

  test("in English, states the defaults and the limit the step uses", () => {
    const section: string = ircSection(read("en"));

    expect(section).toContain(`Defaults to \`${IRC_DEFAULT_NICKNAME}\``);
    expect(section).toContain(
      `defaults to \`${IRC_DEFAULT_TLS_PORT}\`, or \`${IRC_DEFAULT_PLAIN_TEXT_PORT}\` with **Disable TLS** on`,
    );
    expect(section).toContain(`at most ${IRC_MAX_LINES} IRC lines`);
    expect(section).toContain("`DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES`");
    expect(section).toContain("`NODE_EXTRA_CA_CERTS`");
  });
});
