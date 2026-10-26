import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import DatabaseRequestType from "Common/Server/Types/BaseDatabase/DatabaseRequestType";
import slugify from "Common/Server/Types/MarkdownSlugify";
import WorkflowAccessChangeRefusedException from "Common/Server/Types/Database/Permissions/WorkflowAccessChangeRefusedException";
import { describeRefusal } from "Common/Server/Types/Workflow/Components/BaseModel/LogComponentError";
import WorkflowPrincipal from "Common/Server/Utils/Workflow/WorkflowPrincipal";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { writtenPermissionTitle } from "./DocsRoleNames";

/*
 * Workflow steps act as a Project Admin of their project, on its plan
 * (WorkflowPrincipal). The docs say so where a workflow author looks: the
 * workflow Configuration & Safety page (in every language), the data
 * components on the Components page, and the 13 -> 14 upgrade notes, which
 * say plainly what changes for an existing workflow and what does not for the
 * API and Terraform. The refusal they quote is the one the run log writes.
 * They also say what a step never does though a Project Admin may: change
 * who has access to the project (WorkflowPrincipal.assertDoesNotChangeAccess).
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
    expect(text).toContain(
      "On Create, On Update, On Create or Update and On Delete triggers",
    );
  });

  test("it names each thing a step is held to", () => {
    expect(text).toContain("**Only the workflow's own project.**");
    expect(text).toContain("an Update never moves a record to another project");
    expect(text).toContain("**Only what a Project Admin may do.**");
    expect(text).toContain(
      "**Project Owner**, billing or project-deletion permissions",
    );
    // A step no longer grants what a Project Admin holds: it grants nothing.
    expect(text).not.toContain("such as the owners' team");
    expect(text).not.toContain("A step can grant only");
    expect(text).toContain("**Only what your plan includes.**");
    expect(text).toContain("refused with the plan it needs");
    expect(text).toContain("**Nothing OneUptime keeps for itself.**");
    expect(text).toContain("editing or deleting a feed entry");
    expect(text).toContain("writing a notification log");
    expect(text).toContain("whether a custom domain's CNAME is verified");
    expect(text).toContain(
      "declaring an incident from a template by sending `createdIncidentTemplateId` to **Create One Incident**",
    );
    // The step names its template under its own setting instead.
    expect(text).toContain(
      "pick the template under the step's **Incident Template** setting instead",
    );
    expect(text).not.toContain("**Find One Incident Template**");
    expect(text).toContain("**As no person.**");
    expect(text).toContain("the audit log names the workflow");
  });

  test("a refused step makes no refused change, and a Create Many keeps what came before", () => {
    expect(text).toContain(
      "the step takes its **Error** output without making the refused change",
    );
    expect(text).toContain(
      "A Create Many step creates its records one at a time and stops at the first one refused: the records it created before that one are kept.",
    );
    expect(text).not.toContain("writes nothing");
  });

  test("the refusal it quotes is the one the run log writes", () => {
    const written: string = describeRefusal({
      error: new NotAuthorizedException("…"),
      message: "…",
      stepTitle: "Find One Probe",
    })!;

    expect(text).toContain(`*${written}*`);
  });

  test("a step changes nobody's access, and the page says who makes those changes", () => {
    expect(text).toContain("**Not who has access.**");
    expect(text).toContain(
      "A step doesn't create, change or delete teams, team members, team permissions, custom roles or API key permissions, even though a Project Admin may.",
    );
    // Why: whoever builds a workflow may be someone with less access.
    expect(text).toContain("that can be a **Project Member**");
    expect(text).toContain("such as **Project Admin**");
    expect(text).toContain(
      "its run log says a person who manages the project's teams and API keys has to make the change",
    );
    expect(text).toContain(
      "Triggers and Find steps on these records still work.",
    );
  });

  test("the access refusal it describes is the one the run log writes", () => {
    const message: string = WorkflowPrincipal.getAccessChangeRefusal(
      TeamPermission,
      DatabaseRequestType.Create,
    );
    const written: string = describeRefusal({
      error: new WorkflowAccessChangeRefusedException(message),
      message: message,
      stepTitle: "Create One Team Permission",
    })!;

    expect(written).toContain(
      "A person who manages the project's teams and API keys has to make this change.",
    );
    expect(written).not.toContain(
      "Workflow steps can do only what a Project Admin of this project can do",
    );
  });

  test("steps that call other systems are not changed", () => {
    expect(text).toContain(
      "API, Email, Slack, Microsoft Teams, Discord, Telegram, IRC, Mattermost, Custom Code and Generate Text with AI",
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
      "A step that creates, changes or deletes a team, a team member, a team permission, a custom role or an API key permission is refused, whatever it would grant, **Project Owner** and **Project Admin** included: workflow steps don't change who has access to the project.",
    );
    expect(text).not.toContain("such as the owners' team");
    expect(text).toContain(
      "look over your workflows' **Runs** for refused steps",
    );
    expect(text).toContain("without making the refused change");
    expect(text).toContain(
      "A **Create One Incident** step that declared from a template by sending `createdIncidentTemplateId` is refused.",
    );
    // The replacement is the step's own setting, not a hand-copied template.
    expect(text).toContain(
      "Pick the template under the step's **Incident Template** setting instead",
    );
    expect(text).toContain(
      "(/docs/workflows/components#declaring-an-incident-from-a-template)",
    );
    expect(text).not.toContain("**Find One Incident Template**");
    expect(text).toContain(
      "a Create Many step stops at the record refused, keeping the ones it created before it",
    );
    expect(text).not.toContain("writes nothing");
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
      "They used to be system events, recorded only when **Store System Events** was turned on.",
    );
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
      const headingsOf: (markdown: string) => Array<string> = (
        markdown: string,
      ): Array<string> => {
        return markdown.split("\n").filter((line: string): boolean => {
          return line.startsWith("## ");
        });
      };
      const english: Array<string> = headingsOf(read("en", CONFIGURATION));
      const page: string = read(locale, CONFIGURATION);
      const headings: Array<string> = headingsOf(page);
      const at: number = english.indexOf(HEADING);

      // The translation has the English page's sections, in its order.
      expect(headings).toHaveLength(english.length);
      expect(english[at + 1]).toBe("## Plan limits");

      const text: string = section(page, headings[at]!);

      // Every point the English section makes, the new one on access included.
      const bullets: (markdown: string) => number = (
        markdown: string,
      ): number => {
        return markdown.split("\n").filter((line: string): boolean => {
          return line.startsWith("- **");
        }).length;
      };

      expect(bullets(text)).toBe(
        bullets(section(read("en", CONFIGURATION), HEADING)),
      );
      // The roles, as the language's Dashboard names them.
      for (const role of ["Project Member", "Project Admin", "Project Owner"]) {
        expect(text).toContain(`**${writtenPermissionTitle(locale, role)}**`);
      }
      expect(text).toContain("**Error**");
      expect(text).toContain("OneUptime Cloud");
      expect(text).toContain("CNAME");
      // A Create Many step keeps the records it made before the refused one.
      expect(text).toContain("Create Many");
      /*
       * Sending the template's id is refused, and the page names the way
       * round it: the step's Incident Template setting, or - until the
       * translation catches up with the English - a Find One Incident
       * Template step.
       */
      expect(text).toContain("`createdIncidentTemplateId`");
      expect(
        text.includes("**Incident Template**") ||
          text.includes("**Find One Incident Template**"),
      ).toBe(true);
    },
  );
});
