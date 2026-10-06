import slugify from "Common/Server/Types/MarkdownSlugify";
import OnCallNotRunOnCreate from "Common/Server/Utils/OnCall/OnCallNotRunOnCreate";
import { StartingStage } from "Common/Utils/StartingStage";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A record created already acknowledged or resolved pages nobody, and one
 * created resolved sets off nothing that answers a live problem. The docs
 * say so where a reader looks: the declare page (English, and Persian, which
 * keeps its incident pages in step), the API reference beside the state a
 * new record starts in, the on-call escalation page, runbook rules, the
 * Slack page, AI SRE, and the 14 upgrade notes. Every link to the section
 * lands on its heading.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

function read(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

// The text of the section under `heading`, up to the next heading of its level or above.
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(heading);

  expect(start).toBeGreaterThanOrEqual(0);

  const rest: string = markdown.slice(start + heading.length);
  const end: number = rest.search(/\n#{2,3} /);

  return end === -1 ? rest : rest.slice(0, end);
}

const DECLARING: string = "incidents/declaring-incidents";
const EN_HEADING: string = "### Declared already acknowledged or resolved";
const FA_HEADING: string =
  "### حادثه‌ای که از پیش تأییدشده یا برطرف‌شده اعلام می‌شود";

function anchorOf(heading: string): string {
  return slugify(heading.replace(/^#+\s*/, ""));
}

const EN_LINK: string = `(/docs/incidents/declaring-incidents#${anchorOf(EN_HEADING)})`;

describe("the declare page says what a create in a later state sets off", () => {
  const page: string = read("en", DECLARING);
  const text: string = section(page, EN_HEADING);

  test("the section sits with what happens the moment an incident is declared", () => {
    const happens: number = page.indexOf(
      "## What happens the moment an incident is declared",
    );
    const here: number = page.indexOf(EN_HEADING);
    const next: number = page.indexOf("## Where to read next");

    expect(happens).toBeGreaterThan(0);
    expect(here).toBeGreaterThan(happens);
    expect(next).toBeGreaterThan(here);
  });

  test("at or past acknowledged: no one is paged, the policies stay listed, and the feed says why", () => {
    expect(text).toContain("**At or past your acknowledged state**");
    expect(text).toContain("no on-call policy runs, so no one is paged");
    expect(text).toContain("its feed says why in one line");
    expect(text).toContain("starts already responded to");
  });

  test("the feed line it quotes is the one the server writes", () => {
    const written: string = OnCallNotRunOnCreate.getMarkdown({
      noun: "incident",
      stage: StartingStage.Acknowledged,
      policyNames: ["Primary"],
    })
      .replace("📞 ", "")
      .replace("**No one was paged.**", "No one was paged.");

    expect(text).toContain(`_${written}_`);
  });

  test("at or past resolved: nothing that answers a live incident runs", () => {
    expect(text).toContain("**At or past your resolved state**");

    for (const sentence of [
      "it is not grouped into an episode",
      "no runbook rule and no auto-remediation rule acts on it",
      "OneUptime AI does not investigate it",
      "**AI Investigation** card says it was created already resolved",
      "no Slack or Microsoft Teams channel is created for it",
      "its monitors keep their status and keep being monitored",
      "no SLA is started for it",
    ]) {
      expect(text).toContain(sentence);
    }
  });

  test("what still happens: rules, owners, the created entry and status page subscribers", () => {
    expect(text).toContain("**What still happens:**");
    expect(text).toContain("privacy, owner, label and on-call rules run");
    expect(text).toContain("**Incident Created** entry");
    expect(text).toContain("status page subscribers are told");
  });

  test("alerts and both kinds of episode follow the same rule; the created state is unchanged", () => {
    expect(text).toContain(
      "Alerts, alert episodes and incident episodes follow the same rule",
    );
    expect(text).toContain("every one a monitor opens");
  });

  test("the Initial State field, the alerts paragraph, the on-call step and the template table point to it", () => {
    const inPageLink: string = `(#${anchorOf(EN_HEADING)})`;
    const links: number = page.split(inPageLink).length - 1;

    expect(links).toBeGreaterThanOrEqual(3);
    expect(page).toContain(
      "An incident that starts acknowledged or resolved pages no one.",
    );
  });
});

describe("the Persian declare page keeps the section in step", () => {
  const page: string = read("fa", DECLARING);
  const text: string = section(page, FA_HEADING);

  test("the section is there, with the same field names and the feed line as written", () => {
    for (const name of [
      "**Initial State**",
      "**Initial Incident State**",
      "`currentIncidentStateId`",
      "**AI Investigation**",
      "**Ask OneUptime AI**",
      "**Change Monitor Status to**",
      "**Incident Created**",
      "**Notify Status Page Subscribers**",
      "_No one was paged. This incident was created already acknowledged, so its on-call policy **Primary** was not run._",
    ]) {
      expect(text).toContain(name);
    }
  });

  test("its links land on its own heading", () => {
    const inPageLink: string = `(#${anchorOf(FA_HEADING)})`;

    expect(page.split(inPageLink).length - 1).toBeGreaterThanOrEqual(3);
  });
});

describe("the API reference on the state a new record starts in", () => {
  test("English says a later state pages no one, and links to the section", () => {
    const text: string = section(
      read("en", "api-reference/api-reference"),
      "### The state a new record starts in",
    );

    expect(text).toContain(
      "A record created at or past your acknowledged state pages no one",
    );
    expect(text).toContain(EN_LINK);
  });

  test("Persian says the same and links to the Persian section", () => {
    const text: string = section(
      read("fa", "api-reference/api-reference"),
      "### وضعیتی که رکورد تازه در آن آغاز می‌شود",
    );

    expect(text).toContain(
      `(/docs/incidents/declaring-incidents#${anchorOf(FA_HEADING)})`,
    );
  });
});

describe("the other pages a reader checks", () => {
  test.each([
    [
      "on-call/escalation-rules",
      "runs none of its policies: no one is paged, and its feed says so",
    ],
    [
      "runbooks/rules",
      "An incident or alert created already resolved starts no runbook",
    ],
    [
      "workspace-connections/slack",
      "An incident, alert or episode created already resolved gets no channel of its own",
    ],
    [
      "ai/ai-sre",
      "An incident or alert **created already resolved** is neither investigated nor remediated",
    ],
  ])("%s says it, and links to the section", (page: string, sentence: string) => {
    const markdown: string = read("en", page);

    expect(markdown).toContain(sentence);
    expect(markdown).toContain(EN_LINK);
  });

  test("the 14 upgrade notes tell existing customers what changed", () => {
    const text: string = section(
      read("en", "installation/upgrading"),
      "### Other changes in 14",
    );

    expect(text).toContain(
      "**A record created already acknowledged or resolved pages no one.**",
    );
    expect(text).toContain("Records created in the created state");
    expect(text).toContain(EN_LINK);
  });
});
