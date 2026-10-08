import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT A SUBSCRIPTION, A RULE'S RUN NOW, AN LLM PROVIDER LIST AND AN AI
 * PLAN'S APPROVAL REACH STAYS WITHIN WHAT THEY ARE ALLOWED.
 *
 * - A status page subscription names only resources of its own page, and a
 *   visitor only those the page shows (StatusPageSubscriberResources): the
 *   Subscribers page says so.
 * - A network's site assignment, device label and auto import rules run
 *   only with permissions that reach the whole project, and a block with
 *   labels refuses every rule's Run Now (RuleRunPermission): Run Rules on
 *   Existing Resources and the network device page say so.
 * - LLM providers are read by the project's members who may read its
 *   settings, the global list by anyone signed in: the LLM provider page
 *   says so.
 * - Approving an AI plan with an SSH command, and letting a rule run AI
 *   commands without asking, take the read of runbook credentials
 *   (AiRemediationCredentialUse): the AI SRE page says so.
 *
 * Users, Teams & Permissions carries the two rules - a paragraph before the
 * scope-exempt roles, and the last paragraph of How OneUptime decides - and
 * the upgrade notes say what changes. These are the English pages; the
 * translated guides follow them in their own translation pass.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

function read(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, page), "utf8");
}

// The text under the `## heading` of `markdown`, up to the next `## `.
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n## ${heading}\n`);

  expect([heading, start >= 0]).toEqual([heading, true]);

  const bodyStart: number = start + `\n## ${heading}\n`.length;
  const next: number = markdown.indexOf("\n## ", bodyStart);

  return markdown.slice(bodyStart, next === -1 ? undefined : next);
}

// The non-empty paragraphs of `text`, in order.
function paragraphs(text: string): Array<string> {
  return text
    .split(/\n\s*\n/)
    .map((paragraph: string): string => {
      return paragraph.trim();
    })
    .filter((paragraph: string): boolean => {
      return paragraph.length > 0;
    });
}

// The paragraph of `markdown` that starts with `opening`, or "".
function paragraphStartingWith(markdown: string, opening: string): string {
  return (
    paragraphs(markdown).find((paragraph: string): boolean => {
      return paragraph.startsWith(opening);
    }) || ""
  );
}

function expectSentences(text: string, sentences: Array<string>): void {
  for (const sentence of sentences) {
    expect([sentence, text.includes(sentence)]).toEqual([sentence, true]);
  }
}

describe("Docs: what a subscription, a rule run, an LLM provider list and an AI plan reach", () => {
  test("Subscribers says a subscription chooses among its own page's resources", () => {
    const page: string = read("status-pages/subscribers.md");
    const paragraph: string = paragraphStartingWith(
      page,
      "**A subscriber chooses among its own page's resources.**",
    );

    expectSentences(paragraph, [
      "**Subscribed to Resources** names resources of the subscriber's own status page, whoever writes it: a visitor on the page, a teammate on the dashboard, an API key or a workflow.",
      "A visitor picks from what the page shows them, so a resource whose monitor is archived, which the page hides, is not one they can pick.",
      "A resource of another status page, or one the page hides from a visitor, is refused with the `400` that names the field and the ID, as an ID that matches nothing is.",
      "A change asks only about the resources it adds, so a subscription keeps a resource it names already",
      "A subscriber is told about an event only through resources of its own page.",
    ]);

    // Right after the fields the choices land on, under the choosing section.
    const choosing: string = section(
      page,
      "Letting subscribers choose resources and event types",
    );
    const fields: number = choosing.indexOf(
      "The choices land on the subscriber record as **Is Subscribed to All Resources**",
    );
    const rule: number = choosing.indexOf(paragraph);

    expect(fields).toBeGreaterThan(0);
    expect(rule).toBeGreaterThan(fields);
    expect(paragraphs(choosing.slice(fields, rule))).toHaveLength(1);
  });

  test("Run Rules on Existing Resources says, before you begin, that a run takes permissions that reach the whole project", () => {
    const beforeYouBegin: string = section(
      read("configuration/run-rules-now.md"),
      "Before you begin",
    );

    expectSentences(beforeYouBegin, [
      "A permission limited to specific labels, or to resources you own, is not enough: a run can change every resource in the project.",
      "a block limited to some labels counts too: a run would change the resources carrying those labels, so a block with labels on editing the resources a rule changes refuses the run.",
      "A site assignment or device label rule's **Run Now** needs permission to edit the rule and **Edit Network Device**.",
      "An auto import rule's **Dry Run** and **Run Rule** need permission to edit the rule, **Create Network Device** and, when the rule has a Monitor Template, **Create Monitor**.",
      "Each must reach the whole project.",
      "(/docs/monitor/network-device-monitor#importing-automatically-with-auto-import-rules)",
    ]);
  });

  test("the network device page says who may run an auto import rule", () => {
    const page: string = read("monitor/network-device-monitor.md");
    const paragraph: string = paragraphStartingWith(
      page,
      "**Who may run a rule.**",
    );

    expectSentences(paragraph, [
      "A run reaches every scan of the project, so pressing **Dry Run** or **Run Rule** takes permissions that reach the whole project:",
      "permission to edit the rule, to create network devices and - when the rule has a Monitor Template - to create monitors, each scoped to all resources in the project.",
      "A site assignment or device label rule's **Run Now** takes permission to edit the rule and to edit network devices, reaching the whole project the same way",
      "A permission restricted to labels or to owned devices is not enough, and a team's block with labels on creating devices or monitors refuses the run.",
      "(/docs/configuration/run-rules-now#before-you-begin)",
    ]);

    // Right after the two buttons it is about.
    const runRule: number = page.indexOf(
      "- **Run Rule** does the same evaluation and performs the import.",
    );

    expect(runRule).toBeGreaterThan(0);
    expect(page.indexOf(paragraph)).toBeGreaterThan(runRule);
    expect(paragraphs(page.slice(runRule, page.indexOf(paragraph)))).toHaveLength(
      1,
    );
  });

  test("the LLM provider page says who can see a provider", () => {
    const page: string = read("ai/llm-provider.md");
    const start: number = page.indexOf("\n### Who can see a provider\n");
    const end: number = page.indexOf("\n## Provider-Specific Configuration\n");

    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);

    expectSentences(page.slice(start, end), [
      "A project's LLM providers are read only by its members who may read the project's settings: **Project Owner**, **Project Admin**, **Project Member**, **Viewer**, **Settings Admin**, **Settings Member**, **Settings Viewer** and **Read LLM**.",
      "A provider's **API Key** is read by the project's owners and admins alone.",
      "shows their name, description and price to anyone signed in, and nothing else about them.",
    ]);
  });

  test("the AI SRE page says what approving an SSH command and running without asking take", () => {
    const page: string = read("ai/ai-sre.md");
    const paragraph: string = paragraphStartingWith(
      page,
      "**Commands on Runners and the credentials they run with.**",
    );

    expectSentences(paragraph, [
      "Approving a plan with an SSH command confirms that pick, so it takes permission to read runbook credentials (**Read Runbook Credential**, or a Project Owner or Project Admin), as naming a credential in a runbook step does; without it the approval is refused, saying who may approve the plan, and nothing runs.",
      "Letting such a rule run its commands without asking - **Fix without asking**, with a command allowlist - takes the same permission when a save turns that on - switching such a rule on included - or adds allowlist patterns or Runners, however the allowlist is written; narrowing the rule, or turning that off, does not.",
      "A kubectl command runs with the credential bound to its cluster on the **AI agent** page, which only someone who may read runbook credentials can bind (see [Who may change it](#who-may-change-it)), so approving it asks nothing more.",
    ]);

    // It closes the rules section, before auto-remediation waits for the analysis.
    const rule: number = page.indexOf(paragraph);

    expect(rule).toBeGreaterThan(0);
    expect(page.indexOf("## Auto-remediation waits for the analysis")).toBe(
      page.indexOf("\n## ", rule) + 1,
    );
    expect(page).toContain("\n### Who may change it\n");
  });

  test("Users, Teams & Permissions says acting on the whole project takes a permission that reaches it, right before the scope-exempt roles", () => {
    const scope: Array<string> = paragraphs(
      section(
        read("permissions/index.md"),
        "Scope: how far an allow permission reaches",
      ),
    );

    const at: number = scope.findIndex((paragraph: string): boolean => {
      return paragraph.startsWith(
        "**Acting on the whole project takes a permission that reaches it.**",
      );
    });
    const exempt: number = scope.indexOf("{{PERMISSION_SCOPE_EXEMPT_ROLES}}");

    expect(at).toBeGreaterThan(0);
    // The paragraph introducing the scope-exempt roles comes right after.
    expect(exempt).toBe(at + 2);

    expectSentences(scope[at]!, [
      "A rule's **Run Now** applies the rule to every resource of the project, and a network's site assignment, device label and auto import rules to every network device or scan",
      "a permission restricted to labels or to owned resources is not enough, and a block with labels on the resources a run changes refuses the run",
    ]);
  });

  test("Users, Teams & Permissions closes How OneUptime decides with the credential a command runs with", () => {
    const decision: Array<string> = paragraphs(
      section(
        read("permissions/index.md"),
        "How OneUptime decides whether a request is allowed",
      ),
    );
    const last: string = decision[decision.length - 1]!;

    expect(
      last.startsWith(
        "A command runs with a runbook credential only for someone who may read runbook credentials",
      ),
    ).toBe(true);

    expectSentences(last, [
      "(**Read Runbook Credential**; Project Owners and Project Admins may)",
      "Approving an AI command plan with an SSH command, which runs with the credential OneUptime AI picked from those of its Runner, takes that read",
      "saving an auto remediation rule that lets OneUptime AI run its commands without asking, when the save turns that on or adds allowlist patterns or Runners.",
    ]);
  });

  test("the upgrade notes say what changes, before who owns a resource", () => {
    const page: string = read("installation/upgrading.md");
    const heading: string =
      "- **What a subscription, a rule's Run Now, an LLM provider list and an AI\n  plan's approval reach stays within what they are allowed.**";

    expectSentences(page, [
      heading,
      "  - A status page subscription names only resources of its own status page.",
      "    names the field and the ID, as one that does not exist is. A change asks",
      "    resource is left as it is: it is told about events only through the",
      "  - **Run Now** on a network's site assignment, device label and auto import",
      "    or to owned resources is refused with a `422`, and so is a team's block",
      "    a request that is not signed in gets a `401`. The list of global LLM",
      "  - Approving an AI command plan with an SSH command needs permission to",
      "    read runbook credentials (`ReadRunbookCredential`, or `ProjectOwner` or",
      "  See [Letting subscribers choose resources and event types](/docs/status-pages/subscribers#letting-subscribers-choose-resources-and-event-types),",
      "  [Run Rules on Existing Resources](/docs/configuration/run-rules-now#before-you-begin)",
    ]);

    const named: number = page.indexOf(
      "- **The one record a write names, and a change of a record's labels, keep to",
    );
    const reach: number = page.indexOf(heading);
    const owners: number = page.indexOf(
      "- **Who owns a resource, and a setting that holds credentials, are named",
    );

    expect(named).toBeGreaterThan(0);
    expect(reach).toBeGreaterThan(named);
    expect(owners).toBeGreaterThan(reach);
  });
});
