import {
  WorkflowTemplate,
  WorkflowTemplateCategory,
  WorkflowTemplateVariable,
  getWorkflowTemplatesByCategory,
} from "Common/Types/Workflow/Templates";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The settings the Jira templates ask for, as the English Jira guide names
 * them, held to the templates themselves.
 *
 * The templates that link the issue in what they write into OneUptime ask
 * for a Jira Site URL, the address people open Jira at, and the links go to
 * that site whatever the event says. The field the API calls go to, which
 * was titled Jira Site URL too, is the Jira API URL. So the guide's tables
 * say which template asks for which, its list describes each by the title
 * the create wizard shows, and it says where the link goes and how a
 * workflow created before the setting gets it. The guide's translations are
 * rewritten with the integration pages, and hold to English then.
 */

const GUIDE: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../FeatureSet/Docs/Content/en/integrations/jira.md",
  ),
  "utf8",
);

const JIRA_TEMPLATES: Array<WorkflowTemplate> = getWorkflowTemplatesByCategory(
  WorkflowTemplateCategory.Jira,
);

// How the tables' "What it asks for" column words each setting.
const TABLE_WORDS: Record<string, string> = {
  jiraSiteUrl: "Site URL",
  jiraBaseUrl: "API URL",
  jiraBasicAuthToken: "API token",
  jiraProjectKey: "project key",
  jiraIssueType: "issue type",
  oneuptimeUrl: "OneUptime URL",
};

const WEBHOOK_PART: RegExp =
  /,? ?(?:and )?an? Jira webhook for \*\*[^*]+\*\*$/i;

type RowOfFunction = (templateName: string) => Array<string>;

// A template's row in the guide's tables: its cells, trimmed.
const rowOf: RowOfFunction = (templateName: string): Array<string> => {
  const line: string | undefined = GUIDE.split("\n").find(
    (candidate: string): boolean => {
      return candidate.startsWith(`| ${templateName} `);
    },
  );

  if (!line) {
    throw new Error(`The Jira guide has no row for "${templateName}".`);
  }

  return line
    .slice(1, -1)
    .split("|")
    .map((cell: string): string => {
      return cell.trim();
    });
};

describe("the Jira guide's settings", () => {
  test("the tables give each template's settings in the order the wizard asks for them", () => {
    expect(JIRA_TEMPLATES).toHaveLength(17);

    for (const template of JIRA_TEMPLATES) {
      const asks: string = rowOf(template.name)[2] as string;
      const settings: string = asks.replace(WEBHOOK_PART, "");

      expect({
        template: template.id,
        settings: settings ? settings.split(", ") : [],
      }).toEqual({
        template: template.id,
        settings: template.variables.map(
          (variable: WorkflowTemplateVariable): string => {
            return TABLE_WORDS[variable.name] as string;
          },
        ),
      });
    }
  });

  test("the list describes each setting under the title the wizard shows", () => {
    const titles: Set<string> = new Set();

    for (const template of JIRA_TEMPLATES) {
      for (const variable of template.variables) {
        titles.add(variable.title);
      }
    }

    expect(Array.from(titles)).toContain("Jira Site URL");
    expect(Array.from(titles)).toContain("Jira API URL");

    for (const title of titles) {
      expect({
        title,
        described: GUIDE.includes(`\n- **${title}** — `),
      }).toEqual({ title, described: true });
    }
  });

  test("it says the issue's link goes to the Jira Site URL, whatever the event says", () => {
    expect(GUIDE).toContain(
      "the link to the issue goes to the site your **Jira Site URL** names, whatever the request says",
    );
    expect(GUIDE).toContain(
      "The link to the issue goes to the site the workflow's **Jira Site URL** names.",
    );
    // The site was the request's before the setting.
    expect(GUIDE).not.toContain(
      "the request also names the site the link to the issue goes to",
    );
    expect(GUIDE).not.toContain(
      "The link to the issue goes to the site in the issue's REST address",
    );
  });

  test("it says how a workflow created before the setting gets it: created again, its webhook moved", () => {
    expect(GUIDE).toContain(
      "**Workflows created before the Jira Site URL link the issue at the site the event names.**",
    );
    expect(GUIDE).toContain(
      "create the workflow again from its template, which asks for the **Jira Site URL**",
    );
    expect(GUIDE).toContain(
      "paste its webhook URL into the Jira webhook in place of the old one",
    );
  });

  test("it says what the Jira Site URL is on Jira Data Center, and that a scoped token changes only the API URL", () => {
    expect(GUIDE).toContain("**The Jira Site URL is your base URL**");
    expect(GUIDE).toContain("`https://example.com/jira`");
    expect(GUIDE).toContain(
      "so **Jira API URL** must be the `https://api.atlassian.com/ex/jira/<cloudId>` address (the **Jira Site URL** stays your site)",
    );
  });
});
