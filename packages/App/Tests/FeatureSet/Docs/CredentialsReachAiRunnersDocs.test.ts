import { CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE } from "Common/Server/Utils/AutoRemediation/AiCommandCredentialReach";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AN SSH CREDENTIAL REACHES A RUNNER THAT RUNS ONEUPTIME AI'S COMMANDS ONLY
 * THROUGH SOMEONE WHO MAY READ RUNBOOK CREDENTIALS.
 *
 * From either side: assigning the credential to such a Runner
 * (RunbookCredentialService) and turning the Runner's "Runs AI Remediation
 * Commands" on (RunnerService), saved one at a time in a project when
 * made by someone who may not read them (AiCommandCredentialReach); a
 * Runner save that leaves the switch as it is never waits. A workflow's
 * step is never lent a Project Admin's read of runbook credentials, or of
 * any other setting that holds credentials (RunbookCredentialReaders,
 * RelationListPermission): a person who has it has to make the change.
 *
 * The credentials page says so where credentials are assigned, the Runners
 * page where the switch is, the AI SRE page and Users, Teams & Permissions
 * where the other changes that take the read are listed, the workflow
 * Configuration & Safety page where a step's limits are, and the upgrade
 * notes say what changes. These are the English pages; the translated
 * guides follow them in their own translation pass.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

function read(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, page), "utf8");
}

// The text under `heading`, up to the next heading of its level or above.
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n${heading}\n`);

  expect([heading, start >= 0]).toEqual([heading, true]);

  const rest: string = markdown.slice(start + heading.length + 2);
  const level: number = heading.match(/^#+/)![0].length;
  const end: number = rest.search(new RegExp(`\\n#{2,${level}} `));

  return end === -1 ? rest : rest.slice(0, end);
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

function expectSentences(text: string, sentences: Array<string>): void {
  const flat: string = text.replace(/\s+/g, " ");

  for (const sentence of sentences) {
    expect([sentence, flat.includes(sentence)]).toEqual([sentence, true]);
  }
}

const SUBSECTION: string = "### Runners that run OneUptime AI's commands";
const ANCHOR: string = slugify(SUBSECTION.replace(/^#+\s*/, ""));
const CREDENTIALS_LINK: string = `(/docs/runbooks/credentials#${ANCHOR})`;
const STEPS_LINK: string =
  "(/docs/workflows/configuration#what-workflow-steps-can-do)";

describe("Docs: an SSH credential reaches a Runner that runs AI commands only through someone who may read it", () => {
  test("the link to the credentials page lands on its subsection", () => {
    expect(ANCHOR).toBe("runners-that-run-oneuptime-ais-commands");
  });

  test("Runbook Credentials says, under assigning a credential, what reaching such a Runner takes", () => {
    const page: string = read("runbooks/credentials.md");
    const assigning: string = section(
      page,
      "## Assigning a credential to Runners",
    );

    // A subsection of the assignment section, right after the access boundary.
    const boundary: number = assigning.indexOf(
      "The assignment is the access boundary",
    );
    const here: number = assigning.indexOf(`\n${SUBSECTION}\n`);

    expect(boundary).toBeGreaterThan(0);
    expect(here).toBeGreaterThan(boundary);
    expect(paragraphs(assigning.slice(boundary, here))).toHaveLength(1);

    const text: string = section(page, SUBSECTION);

    expectSentences(text, [
      "On a Runner with **Runs AI Remediation Commands** on, OneUptime AI picks from the SSH credentials assigned to the Runner for the commands it runs there.",
      "So an SSH credential reaches such a Runner only through someone who may read runbook credentials (**Read Runbook Credential**, or a Project Owner or Project Admin), whichever is saved first:",
      "**Assigning the credential.** Creating an SSH credential with such a Runner, or adding such a Runner to one, takes that permission.",
      "Without it, the save is refused and names the Runner: assign the credential to Runners that don't run AI remediation commands, or ask someone who has the permission to assign it.",
      "**Turning the switch on.** Turning on **Runs AI Remediation Commands** for a Runner that holds SSH credentials takes the same permission.",
      "Removing Runners from a credential, saving a credential with the Runners it has, and Kubernetes credentials ask nothing more",
      "Creating a credential with Runners and turning the switch on by someone without that permission are saved one at a time in a project, so the two can't pass their checks together;",
      "it is refused with *Try again in a moment*. Save it again.",
      "Saving a Runner without changing its switch, such as editing its description, never waits.",
      "A workflow's steps act as a Project Admin, but are never lent a Project Admin's read of runbook credentials: a person who has it has to make these changes.",
      STEPS_LINK,
    ]);

    expect(text).not.toContain("last saved");

    // The words it quotes are the server's.
    expect(CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE).toContain(
      "Try again in a moment.",
    );

    // Before you begin points at it.
    expectSentences(section(page, "## Before you begin"), [
      "Assigning an SSH credential to a Runner that runs OneUptime AI's commands also takes **Read Runbook Credential**; see [Runners that run OneUptime AI's commands](#runners-that-run-oneuptime-ais-commands).",
    ]);
  });

  test("Runbook Agents says, at the switch, what turning it on takes", () => {
    const row: string =
      read("runbooks/agents.md")
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith("| **Runs AI Remediation Commands** |");
        }) || "";

    expectSentences(row, [
      "Off by default. Lets AI auto-remediation run policy-checked commands on it.",
      "Turning it on for a Runner that holds SSH credentials takes permission to read runbook credentials;",
      CREDENTIALS_LINK,
    ]);
  });

  test("the AI SRE page lists assigning the credential with the other changes that take the read", () => {
    const paragraph: string =
      paragraphs(read("ai/ai-sre.md")).find((text: string): boolean => {
        return text.startsWith(
          "**Commands on Runners and the credentials they run with.**",
        );
      }) || "";

    expectSentences(paragraph, [
      "Turning on **Runs AI Remediation Commands** for a Runner that holds SSH credentials takes the same permission, since a rule that names no Runners reaches every Runner that runs OneUptime AI's commands.",
      "Assigning an SSH credential to a Runner that runs OneUptime AI's commands - creating the credential with that Runner, or adding the Runner to it - takes it too, so an SSH credential reaches such a Runner only through someone who may read it, whichever is saved first, the credential or the switch",
      CREDENTIALS_LINK,
      "A workflow's step is never lent this permission by acting as a Project Admin: a person who has it has to make these changes.",
    ]);

    expect(paragraph).not.toContain("last saved");
  });

  test("Users, Teams & Permissions closes the paragraph on settings that hold credentials with the assignment and the workflow rule", () => {
    const decision: Array<string> = paragraphs(
      section(
        read("permissions/index.md"),
        "## How OneUptime decides whether a request is allowed",
      ),
    );
    const credentials: string =
      decision.find((paragraph: string): boolean => {
        return paragraph.startsWith(
          "A setting that holds credentials is named only by someone who may read it.",
        );
      }) || "";

    expect(
      credentials.endsWith(
        "turning on **Runs AI Remediation Commands** for a Runner that holds SSH credentials, or assigning an SSH credential to a Runner that runs OneUptime AI's commands. A workflow's step acts as a Project Admin but is never lent the read of a setting that holds credentials: it names none of them and makes none of these changes, and a person who may read them has to.",
      ),
    ).toBe(true);
  });

  test("What workflow steps can do says a step is never lent the read of settings that hold credentials, after what a Project Admin may do", () => {
    const text: string = section(
      read("workflows/configuration.md"),
      "## What workflow steps can do",
    );
    const admin: number = text.indexOf(
      "- **Only what a Project Admin may do.**",
    );
    const credentials: number = text.indexOf(
      "- **Not the read of settings that hold credentials.**",
    );
    const plan: number = text.indexOf("- **Only what your plan includes.**");

    expect(admin).toBeGreaterThan(0);
    expect(credentials).toBeGreaterThan(admin);
    expect(plan).toBeGreaterThan(credentials);

    const bullet: string = text.slice(credentials, plan);

    expectSentences(bullet, [
      "A Project Admin may read runbook credentials, SMTP servers, call and SMS providers, SNMP credentials, video call connections and API keys, but a step is never lent that, whoever built or saved the workflow.",
      "A step can't name one of these settings, such as the SMTP server a status page sends email with or the API key a permission is granted to,",
      "letting OneUptime AI run its commands without asking, turning on **Runs AI Remediation Commands** for a Runner, assigning an SSH credential to a Runner that runs OneUptime AI's commands, or naming a runbook credential, such as in a runbook's steps.",
      "The step is refused, and its run log says a person who may read them (**Read Runbook Credential**, the read permission of that kind of setting, or a Project Owner or Project Admin) has to make the change.",
      "A step that keeps the setting a record names already, or clears it, is not refused.",
    ]);

    expect(bullet).not.toContain("last saved");
  });

  test("no English page says a workflow's step is answered by whoever last saved it", () => {
    const pages: Array<string> = [];

    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".md")) {
          const flat: string = fs
            .readFileSync(full, "utf8")
            .replace(/\s+/g, " ");

          if (
            flat.includes("last saved the workflow") ||
            flat.includes("records that person")
          ) {
            pages.push(path.relative(CONTENT_DIR, full));
          }
        }
      }
    };

    walk(CONTENT_DIR);

    expect(pages).toEqual([]);
  });

  test("the upgrade notes say what changes, after the chat buttons and before the endpoint changes", () => {
    const page: string = read("installation/upgrading.md");
    const heading: string =
      "- **An SSH credential reaches a Runner that runs OneUptime AI's commands only\n  through someone who may read runbook credentials.**";
    const here: number = page.indexOf(heading);
    const buttons: number = page.indexOf(
      "- **Slack and Microsoft Teams buttons act as the OneUptime member who",
    );
    const endpoints: number = page.indexOf(
      "- See [API and endpoint changes](#api-and-endpoint-changes) above for the",
    );

    expect(buttons).toBeGreaterThan(0);
    expect(here).toBeGreaterThan(buttons);
    expect(endpoints).toBeGreaterThan(here);

    const note: string = page.slice(here, endpoints);

    expectSentences(note, [
      "Creating an SSH runbook credential with a Runner that has **Runs AI Remediation Commands** on, or adding such a Runner to one, now needs permission to read runbook credentials (`ReadRunbookCredential`, or `ProjectOwner` or `ProjectAdmin`),",
      "without it the save is refused with a `422` that names the Runner.",
      "Credentials keep the Runners they were assigned before the upgrade,",
      "Creating such a credential and turning the switch on by someone without that permission are saved one at a time in a project: such a save that waits too long for another, or that cannot reach Valkey, is refused with a `400` asking to try again in a moment.",
      "Saving a Runner without changing its switch - editing its description, say - never waits and needs no Valkey, whoever saves it.",
      "A workflow's steps act as a Project Admin but are never lent the read of runbook credentials, or of any other setting that holds credentials:",
      "that names an SMTP server, a call and SMS provider, SNMP credentials, a video call connection, an API key or a runbook credential, is refused, and its run log says a person who may read them has to make the change.",
      // For an install that ran 14.0.26 to 14.0.31.
      "Upgrading from 14.0.26 to 14.0.31: those releases asked instead about the person who last saved a workflow's steps, recorded in a read-only `lastSavedByUserId` column on workflows.",
      "That column is dropped on start, the API and Terraform no longer return it, and a step is refused whoever saved the workflow.",
      CREDENTIALS_LINK,
      STEPS_LINK,
    ]);

    expect(note.replace(/\s+/g, " ")).not.toContain(
      "OneUptime records that person",
    );
  });

  test("the upgrade notes on workflow steps say a step names no setting that holds credentials", () => {
    const text: string = section(
      read("installation/upgrading.md"),
      "### Workflow steps act as a Project Admin",
    );

    expectSentences(text, [
      "A step that names an SMTP server, a call and SMS provider, SNMP credentials, a video call connection, an API key or a runbook credential is refused - one that sets a status page's SMTP server, say, or grants an API key a permission.",
      "A step is never lent the read of settings that hold credentials: a person who may read them has to make that change.",
      "A step that keeps the one a record names already, or clears it, is not refused.",
    ]);
  });
});
