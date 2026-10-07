import slugify from "Common/Server/Types/MarkdownSlugify";
import { describeRefusal } from "Common/Server/Types/Workflow/Components/BaseModel/LogComponentError";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Workflow steps act as a Project Admin of their project, on its plan
 * (WorkflowPrincipal). The docs say so where a workflow author looks: the
 * workflow Configuration & Safety page (in every language), the data
 * components on the Components page, and the 13 -> 14 upgrade notes, which
 * say plainly what changes for an existing workflow and what does not for the
 * API and Terraform. The refusal they quote is the one the run log writes.
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

function read(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

// The text under `heading`, up to the next heading of its level or above.
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(heading);

  expect(start).toBeGreaterThanOrEqual(0);

  const rest: string = markdown.slice(start + heading.length);
  const level: number = heading.match(/^#+/)![0].length;
  const end: number = rest.search(new RegExp(`\\n#{2,${level}} `));

  return end === -1 ? rest : rest.slice(0, end);
}

const CONFIGURATION: string = "workflows/configuration";
const HEADING: string = "## What workflow steps can do";
const ANCHOR: string = slugify(HEADING.replace(/^#+\s*/, ""));
const LINK: string = `(/docs/workflows/configuration#${ANCHOR})`;

describe("the Configuration & Safety page says what a step may do", () => {
  const page: string = read("en", CONFIGURATION);
  const text: string = section(page, HEADING);

  test("the section sits after Permissions and before Plan limits", () => {
    const permissions: number = page.indexOf("## Permissions");
    const here: number = page.indexOf(HEADING);
    const plan: number = page.indexOf("## Plan limits");

    expect(permissions).toBeGreaterThan(0);
    expect(here).toBeGreaterThan(permissions);
    expect(plan).toBeGreaterThan(here);
  });

  test("the record steps act as a Project Admin of the workflow's project", () => {
    expect(text).toContain(
      "act as a **Project Admin** of the workflow's project",
    );
    expect(text).toContain("Find, Create, Update and Delete components");
    expect(text).toContain("On Create, On Update and On Delete triggers");
  });

  test("it names each thing a step is held to", () => {
    expect(text).toContain("**Only the workflow's own project.**");
    expect(text).toContain("an Update never moves a record to another project");
    expect(text).toContain("**Only what a Project Admin may do.**");
    expect(text).toContain(
      "**Project Owner**, billing or project-deletion permissions",
    );
    expect(text).toContain("such as the owners' team");
    expect(text).toContain("**Only what your plan includes.**");
    expect(text).toContain("refused with the plan it needs");
    expect(text).toContain("**Nothing OneUptime keeps for itself.**");
    expect(text).toContain("editing or deleting a feed entry");
    expect(text).toContain("writing a notification log");
    expect(text).toContain("whether a custom domain's CNAME is verified");
    expect(text).toContain("**As no person.**");
    expect(text).toContain("the audit log names the workflow");
  });

  test("the refusal it quotes is the one the run log writes", () => {
    const written: string = describeRefusal({
      error: new NotAuthorizedException("…"),
      message: "…",
      stepTitle: "Create One Team Permission",
    })!;

    expect(text).toContain(`*${written}*`);
  });

  test("steps that call other systems are not changed", () => {
    expect(text).toContain(
      "API, Email, Slack, Microsoft Teams, Discord, Telegram, Custom Code and Generate Text with AI",
    );
  });
});

describe("the Components page points the data components at it", () => {
  test("the OneUptime data components link to the section", () => {
    const page: string = read("en", "workflows/components");
    const text: string = section(page, "## OneUptime data components");

    expect(text).toContain("act as a Project Admin of the workflow's project");
    expect(text).toContain(LINK);
  });
});

describe("the upgrade notes say what changes", () => {
  const page: string = read("en", "installation/upgrading");
  const heading: string = "### Workflow steps act as a Project Admin";
  const text: string = section(page, heading);

  test("in the notes for 14, before the edition checks", () => {
    const fourteen: number = page.indexOf(
      "## Upgrading from OneUptime 13 → 14",
    );
    const here: number = page.indexOf(heading);
    const verify: number = page.indexOf(
      "### Verify the edition and the license",
    );

    expect(fourteen).toBeGreaterThan(0);
    expect(here).toBeGreaterThan(fourteen);
    expect(verify).toBeGreaterThan(here);
  });

  test("what an existing workflow meets, and how to find what it refused", () => {
    expect(text).toContain("used to act as OneUptime itself");
    expect(text).toContain("What changes for an existing workflow:");
    expect(text).toContain(
      "look over your workflows' **Runs** for refused steps",
    );
    expect(text).toContain(LINK);
  });

  test("what does not change, for the API and Terraform", () => {
    expect(text).toContain(
      "the API, Terraform and the MCP server already held their callers to these checks",
    );
  });

  test("the audit log columns and chat actions", () => {
    expect(text).toContain("`workflowId` and `workflowName`");
    expect(text).toContain(
      "Slack and Microsoft Teams actions are held to the project's plan too",
    );
  });
});

describe("every language's Configuration page has the section", () => {
  test("there are the 17 languages", () => {
    expect(LOCALES).toHaveLength(17);
    expect(LOCALES).toContain("en");
  });

  test.each(
    LOCALES.filter((locale: string) => {
      return locale !== "en";
    }),
  )(
    "%s: a section on Project Admin steps, just before the plan limits",
    (locale: string) => {
      const page: string = read(locale, CONFIGURATION);
      const headings: Array<string> = page
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("## ");
        });

      // The section is the eleventh heading, and the plan limits the twelfth.
      expect(headings).toHaveLength(14);

      const text: string = section(page, headings[10]!);

      expect(text).toContain("**Project Admin**");
      expect(text).toContain("**Project Owner**");
      expect(text).toContain("**Error**");
      expect(text).toContain("OneUptime Cloud");
      expect(text).toContain("CNAME");
    },
  );
});
