import slugify from "Common/Server/Types/MarkdownSlugify";
import { Argument } from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import MattermostComponents, {
  MATTERMOST_MAX_MESSAGE_LENGTH,
} from "Common/Types/Workflow/Components/Mattermost";
import { WorkflowDocsPaths } from "Common/Types/Workflow/Documentation/DocumentationLinks";
import { TRUNCATED_TEXT_NOTE } from "Common/Utils/MessageFit";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Mattermost step's section of the workflow Components guide, and the
 * pages that list the chat steps. The step's "How to use" help links to the
 * section by anchor, and the docs answer in the reader's language, so every
 * language has it; each names the settings by the names the form shows,
 * and says the step goes through the same address checks as the API steps -
 * the webhook settings, not the data-source one the IRC and Email steps
 * use. The English section is also held to what the step does with each
 * setting and to the limit it really uses.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: ReadonlyArray<string> = fs
  .readdirSync(CONTENT_DIR)
  .filter((entry: string): boolean => {
    return fs.statSync(path.join(CONTENT_DIR, entry)).isDirectory();
  })
  .sort();

function read(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
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

// The text under "## Mattermost", up to the next "## " heading.
function mattermostSection(markdown: string): string {
  const start: number = markdown.indexOf("\n## Mattermost\n");

  expect(start).toBeGreaterThanOrEqual(0);

  const rest: string = markdown.substring(start + "\n## Mattermost\n".length);
  const end: number = rest.indexOf("\n## ");

  return end === -1 ? rest : rest.substring(0, end);
}

// The lines of a page that name Mattermost.
function linesNaming(markdown: string, name: string): Array<string> {
  return markdown.split("\n").filter((line: string) => {
    return line.includes(name);
  });
}

const ARGUMENTS: Array<Argument> = MattermostComponents.find(
  (component: { id: string }) => {
    return component.id === ComponentID.MattermostSendMessageToChannel;
  },
)!.arguments;

describe("the Mattermost section of the Components guide", () => {
  test("is where the step's help links to", () => {
    expect(WorkflowDocsPaths.mattermost).toBe(
      "/workflows/components#mattermost",
    );
  });

  test("is in every language, so the link lands on it whatever the reader's", () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(17);

    for (const language of LANGUAGES) {
      expect({
        language,
        anchors: headings(read(language, "workflows/components")).map(
          (heading: string) => {
            return slugify(heading);
          },
        ),
      }).toEqual({
        language,
        anchors: expect.arrayContaining(["mattermost"]),
      });
    }
  });

  test("comes after IRC and before Email, with the other chat steps, in every language", () => {
    for (const language of LANGUAGES) {
      const all: Array<string> = headings(
        read(language, "workflows/components"),
      );

      expect({
        language,
        before: all[all.indexOf("Mattermost") - 1],
        after: all[all.indexOf("Mattermost") + 1],
      }).toEqual({ language, before: "IRC", after: "Email" });
    }
  });

  test("names every setting as the form does, in every language", () => {
    for (const language of LANGUAGES) {
      const section: string = mattermostSection(
        read(language, "workflows/components"),
      );

      for (const argument of ARGUMENTS) {
        expect({
          language,
          setting: argument.name,
          named: section.includes(`**${argument.name}**`),
        }).toEqual({ language, setting: argument.name, named: true });
      }

      for (const output of ["**Success**", "**Error**"]) {
        expect({ language, output, named: section.includes(output) }).toEqual({
          language,
          output,
          named: true,
        });
      }
    }
  });

  test("says, in every language, what a webhook's URL looks like and where a long message ends", () => {
    for (const language of LANGUAGES) {
      const section: string = mattermostSection(
        read(language, "workflows/components"),
      );

      expect({ language, path: section.includes("`/hooks/`") }).toEqual({
        language,
        path: true,
      });
      expect({ language, channel: section.includes("`town-square`") }).toEqual({
        language,
        channel: true,
      });
      expect({
        language,
        note: section.includes(TRUNCATED_TEXT_NOTE),
      }).toEqual({ language, note: true });
    }
  });

  test("gives, in every language, the settings that decide which servers it can reach: the API steps', not the data sources'", () => {
    for (const language of LANGUAGES) {
      const section: string = mattermostSection(
        read(language, "workflows/components"),
      );

      expect({
        language,
        allow: section.includes("`ALLOW_PRIVATE_NETWORK_WEBHOOKS`"),
        allowlist: section.includes("`PRIVATE_NETWORK_WEBHOOK_ALLOWLIST`"),
        dataSources: section.includes("DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"),
        page: section.includes("(/docs/self-hosted/private-network-access)"),
      }).toEqual({
        language,
        allow: true,
        allowlist: true,
        dataSources: false,
        page: true,
      });
    }
  });

  test("in English, states the limit the step uses, and that redirects are not followed", () => {
    const section: string = mattermostSection(
      read("en", "workflows/components"),
    );

    expect(section).toContain(
      `A Mattermost post holds ${MATTERMOST_MAX_MESSAGE_LENGTH.toLocaleString("en-US")} characters`,
    );
    expect(section).toContain("a redirect is not followed");
    expect(section).toContain("Under **More fields**:");
  });

  test("is linked from the chat steps' row and card, in every language", () => {
    for (const language of LANGUAGES) {
      const page: string = read(language, "workflows/components");

      expect({
        language,
        row: linesNaming(page, "[Mattermost](#mattermost)").length,
      }).toEqual({ language, row: 1 });

      const card: Array<string> = linesNaming(page, "](#slack): ");

      expect({ language, card: card.join("").includes("Mattermost") }).toEqual({
        language,
        card: true,
      });
    }
  });
});

describe("the pages that list the chat steps", () => {
  test("put Mattermost in the configuration table's row of the API steps, in every language", () => {
    for (const language of LANGUAGES) {
      const rows: Array<string> = linesNaming(
        read(language, "workflows/configuration"),
        "**Mattermost**",
      );

      expect({ language, rows: rows.length }).toEqual({ language, rows: 1 });

      const row: string = rows[0] as string;

      expect({
        language,
        table: row.startsWith("|"),
        api: row.includes("**API**"),
        allow: row.includes("`ALLOW_PRIVATE_NETWORK_WEBHOOKS`"),
        allowlist: row.includes("`PRIVATE_NETWORK_WEBHOOK_ALLOWLIST`"),
      }).toEqual({
        language,
        table: true,
        api: true,
        allow: true,
        allowlist: true,
      });
    }
  });

  test.each([
    "workflows/configuration",
    "workflows/variables",
    "workflows/index",
  ])(
    "name it after IRC where %s lists the chat steps, in every language",
    (page: string) => {
      for (const language of LANGUAGES) {
        const lists: Array<string> = linesNaming(
          read(language, page),
          "IRC",
        ).filter((line: string) => {
          return line.indexOf("Mattermost") > line.indexOf("IRC");
        });

        expect({ language, lists: lists.length }).toEqual({
          language,
          lists: 1,
        });
      }
    },
  );

  test("count it among the webhooks a self-hosted administrator can open to the private network, in every language", () => {
    for (const language of LANGUAGES) {
      const page: string = read(language, "self-hosted/private-network-access");
      const items: Array<string> = linesNaming(page, "**Mattermost**");

      expect({ language, items }).toEqual({
        language,
        items: [expect.stringMatching(/^- /)],
      });

      // Listed with the API steps, before the sinks that are never covered.
      const lines: Array<string> = page.split("\n");
      const mattermost: number = lines.indexOf(items[0] as string);

      expect({
        language,
        afterApi: (lines[mattermost - 1] || "").includes("**API**"),
      }).toEqual({ language, afterApi: true });
    }
  });
});
