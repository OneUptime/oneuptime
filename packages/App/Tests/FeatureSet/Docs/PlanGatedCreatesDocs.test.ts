import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import Form from "Common/Models/DatabaseModels/Form";
import Project from "Common/Models/DatabaseModels/Project";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ColumnBillingAccessControl from "Common/Types/BaseDatabase/ColumnBillingAccessControl";
import { getColumnBillingAccessControlForAllColumns } from "Common/Types/Database/AccessControl/ColumnBillingAccessControl";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A setting a plan sells needs its plan when a record is created with it,
 * as when it is changed later (@ColumnBillingAccessControl names the same
 * plan for both). The English guides say so where API and Terraform users
 * look for it - the API reference's plans section, Terraform's 402 row, and
 * the status page, dashboard and form guides - and this holds each sentence
 * to the plan the code names, so a guide cannot promise a create the server
 * refuses, or the other way round.
 *
 * Markdown is not compiled, so this reads the columns' billing rules and
 * the guides' text.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Docs/Content/en",
);

function readGuide(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, page), "utf8");
}

// A section, from its heading to the next heading of the same level or above.
function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  expect(`${heading}: ${start >= 0}`).toBe(`${heading}: true`);

  const level: number = heading.indexOf(" ");
  const section: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    const match: RegExpMatchArray | null = line.match(/^(#{1,6}) /);

    if (match && match[1]!.length <= level) {
      break;
    }

    section.push(line);
  }

  return section.join("\n");
}

const billingOf: (
  model: BaseModel,
  column: string,
) => ColumnBillingAccessControl = (
  model: BaseModel,
  column: string,
): ColumnBillingAccessControl => {
  return model.getColumnBillingAccessControl(column);
};

// The settings the guides name, and the plan the code sells each on.
const NAMED_SETTINGS: ReadonlyArray<[string, BaseModel, string, PlanType]> = [
  [
    "a private status page",
    new StatusPage(),
    "isPublicStatusPage",
    PlanType.Growth,
  ],
  ["custom HTML", new StatusPage(), "headerHTML", PlanType.Growth],
  ["custom CSS", new StatusPage(), "customCSS", PlanType.Growth],
  ["custom JavaScript", new StatusPage(), "customJavaScript", PlanType.Growth],
  ["email reports", new StatusPage(), "isReportEnabled", PlanType.Growth],
  [
    "SMS subscribers",
    new StatusPage(),
    "enableSmsSubscribers",
    PlanType.Growth,
  ],
  [
    "Slack subscribers",
    new StatusPage(),
    "enableSlackSubscribers",
    PlanType.Scale,
  ],
  [
    "Microsoft Teams subscribers",
    new StatusPage(),
    "enableMicrosoftTeamsSubscribers",
    PlanType.Scale,
  ],
  [
    "webhook subscribers",
    new StatusPage(),
    "enableWebhookSubscribers",
    PlanType.Scale,
  ],
  [
    "a status page's IP allowlist",
    new StatusPage(),
    "ipWhitelist",
    PlanType.Scale,
  ],
  ["a public dashboard", new Dashboard(), "isPublicDashboard", PlanType.Growth],
  [
    "a dashboard's IP allowlist",
    new Dashboard(),
    "ipWhitelist",
    PlanType.Scale,
  ],
  ["a form's IP allowlist", new Form(), "ipWhitelist", PlanType.Scale],
  [
    "a project's audit logs",
    new Project(),
    "enableAuditLogs",
    PlanType.Enterprise,
  ],
];

describe("the settings the guides name are sold on a create as on an update", () => {
  test.each(NAMED_SETTINGS)(
    "%s: a create and an update need the same plan",
    (_name: string, model: BaseModel, column: string, plan: PlanType) => {
      expect(billingOf(model, column)).toEqual(
        expect.objectContaining({ create: plan, update: plan }),
      );
    },
  );
});

describe("the API reference", () => {
  const section: string = sectionOf(
    readGuide("api-reference/api-reference.md"),
    "### Features your plan does not include",
  );

  test("names the settings a plan sells and says a create needs the plan as a change does", () => {
    expect(section).toContain(
      "Some settings of a resource are sold on a plan in the same way. For example: a status page that is private, that hides one of its lists, or that has custom HTML, CSS or JavaScript, email reports, SMS, Slack, Microsoft Teams or webhook subscribers, or an IP allowlist; a dashboard that is shared publicly, or its IP allowlist; a form's IP allowlist; a project's audit logs. Each one's guide, and the dashboard beside the setting, names the plan it needs.",
    );
    expect(section).toContain(
      "Such a setting needs its plan whenever it is written - when the resource is created with it as when it is changed later - so a create that switches one on below the plan is refused with `402` too.",
    );
  });

  test("says the default works on every plan, for a create that leaves the settings alone and for Terraform", () => {
    expect(section).toContain(
      "A setting left at its default, or put back to it, works on every plan: a create that leaves these settings alone goes through, and so does a Terraform configuration that does not set them.",
    );
  });
});

describe("the Terraform troubleshooting guide", () => {
  test("says the 402 for a setting comes on a create as on a change", () => {
    expect(readGuide("terraform/troubleshooting.md")).toContain(
      "or the configuration switches on a setting your plan does not include (a private status page, email reports, a public dashboard, an IP allowlist...), whether `terraform apply` creates the resource with it or changes it later.",
    );
  });
});

describe("the status pages guide", () => {
  const section: string = sectionOf(
    readGuide("status-pages/index.md"),
    "## Creating a status page",
  );

  test("says a page created through the API or Terraform is held to the same plans, and the 402 names the plan", () => {
    expect(section).toContain(
      "A page created through the API or Terraform is held to the same plans as the settings described below.",
    );
    expect(section).toContain(
      "is refused with `402 Payment Required`, and the message names the plan. Each setting's plan is given with it below. Settings left at their defaults, as this form leaves them, work on every plan.",
    );
  });

  test("the Create form it describes writes none of the paid settings", () => {
    const form: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "App/FeatureSet/Dashboard/src/Pages/StatusPages/StatusPages.tsx",
      ),
      "utf8",
    );
    const formFields: string = form.slice(
      form.indexOf("formFields={["),
      form.indexOf("saveFilterProps="),
    );

    expect(formFields).toContain("name: true");
    expect(formFields).toContain("description: true");

    for (const column of Object.keys(
      getColumnBillingAccessControlForAllColumns(new StatusPage()),
    )) {
      expect([column, formFields.includes(`${column}: true`)]).toEqual([
        column,
        false,
      ]);
    }
  });
});

describe("the dashboard sharing guide", () => {
  test("names Growth for a dashboard created public and Scale for one created with an IP allowlist, as the code does", () => {
    const guide: string = readGuide("dashboards/sharing.md");

    expect(billingOf(new Dashboard(), "isPublicDashboard").create).toBe(
      PlanType.Growth,
    );
    expect(billingOf(new Dashboard(), "ipWhitelist").create).toBe(
      PlanType.Scale,
    );
    expect(guide).toContain(
      "A dashboard created through the API or Terraform is held to the same plans: created public it needs **Growth**, and created with an IP allowlist **Scale**.",
    );
  });
});

describe("the forms guides", () => {
  test("name Scale for a form's IP allowlist set on a create as on an edit, as the code does", () => {
    expect(billingOf(new Form(), "ipWhitelist").create).toBe(PlanType.Scale);

    expect(sectionOf(readGuide("forms/index.md"), "## Plan")).toContain(
      "a form's **IP Allowlist** needs **Scale**, whether it is set when the form is created or edited later.",
    );
    expect(
      sectionOf(readGuide("forms/sharing-and-security.md"), "### IP allowlist"),
    ).toContain(
      "On OneUptime Cloud, setting the IP allowlist needs the **Scale** plan - when a form is created with one through the API as when it is edited - like the IP allowlist of a [public dashboard](/docs/dashboards/sharing). Emptying it works on every plan.",
    );
  });
});
