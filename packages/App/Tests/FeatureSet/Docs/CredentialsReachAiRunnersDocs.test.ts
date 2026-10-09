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
 * Commands" on (RunnerService), saved one at a time in a project
 * (AiCommandCredentialReach). A workflow's step is not lent a Project
 * Admin's read of runbook credentials: it is asked about the person who last
 * saved the workflow's steps (RunbookCredentialReaders,
 * Workflow.lastSavedByUserId).
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
      "Assigning credentials and turning the switch on are saved one at a time in a project, so the two can't pass their checks together;",
      "it is refused with *Try again in a moment*. Save it again.",
      "A workflow's steps act as a Project Admin, but are not lent a Project Admin's read of runbook credentials: a step has it only when the person who last saved the workflow's steps has it.",
      STEPS_LINK,
    ]);

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
      "A workflow's step is not lent this permission by acting as a Project Admin: it has it only when the person who last saved the workflow's steps has it.",
    ]);
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
        "turning on **Runs AI Remediation Commands** for a Runner that holds SSH credentials, or assigning an SSH credential to a Runner that runs OneUptime AI's commands. A workflow's step acts as a Project Admin but is not lent that read: it has it only when the person who last saved the workflow's steps has it.",
      ),
    ).toBe(true);
  });

  test("What workflow steps can do says a step is not lent the read of runbook credentials, after what a Project Admin may do", () => {
    const text: string = section(
      read("workflows/configuration.md"),
      "## What workflow steps can do",
    );
    const admin: number = text.indexOf(
      "- **Only what a Project Admin may do.**",
    );
    const credentials: number = text.indexOf(
      "- **Not the read of runbook credentials.**",
    );
    const plan: number = text.indexOf("- **Only what your plan includes.**");

    expect(admin).toBeGreaterThan(0);
    expect(credentials).toBeGreaterThan(admin);
    expect(plan).toBeGreaterThan(credentials);

    expectSentences(text.slice(credentials, plan), [
      "A Project Admin may read runbook credentials, but a step is not lent that.",
      "letting OneUptime AI run its commands without asking, turning on **Runs AI Remediation Commands** for a Runner, assigning an SSH credential to a Runner that runs OneUptime AI's commands, or naming a runbook credential, such as in a runbook's steps",
      "a step is asked about the person who last saved the workflow's steps instead, and is refused unless they may read runbook credentials (**Read Runbook Credential**, or a Project Owner or Project Admin).",
      "OneUptime records that person when someone creates the workflow and each time someone saves its steps; renaming the workflow, changing its labels or turning it on or off keeps who last saved its steps.",
      "A save of its steps with an API key records nobody, so the workflow's steps can't make these changes until a person saves them.",
    ]);
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

    expectSentences(page.slice(here, endpoints), [
      "Creating an SSH runbook credential with a Runner that has **Runs AI Remediation Commands** on, or adding such a Runner to one, now needs permission to read runbook credentials (`ReadRunbookCredential`, or `ProjectOwner` or `ProjectAdmin`),",
      "without it the save is refused with a `422` that names the Runner.",
      "Credentials keep the Runners they were assigned before the upgrade,",
      "a save that waits too long for another, or that cannot reach Valkey, is refused with a `400` asking to try again in a moment.",
      "where a change takes that read, a step is asked about the person who last saved the workflow's steps, and is refused unless they may read runbook credentials.",
      "A workflow whose steps were last saved with an API key, or not since the upgrade, names nobody until a person saves its steps.",
      "OneUptime records that person when a workflow is created and each time its steps are saved - not when it is renamed or turned on or off -",
      "in a new read-only `lastSavedByUserId` column on workflows added on start.",
      CREDENTIALS_LINK,
      STEPS_LINK,
    ]);
  });
});
