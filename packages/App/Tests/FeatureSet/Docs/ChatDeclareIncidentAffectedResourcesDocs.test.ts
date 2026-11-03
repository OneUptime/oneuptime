import slugify from "Common/Server/Types/MarkdownSlugify";
import WorkspaceAffectedResources, {
  WORKSPACE_AFFECTED_RESOURCES_TEXT,
} from "Common/Server/Utils/Workspace/WorkspaceAffectedResources";
import { AiAffectedResourceKind } from "Common/Types/AI/AiAffectedResources";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT THE SLACK AND MICROSOFT TEAMS PAGES SAY OF AN INCIDENT DECLARED FROM
 * CHAT, HELD TO WHAT THE FORMS DO (#5303 follow-up).
 *
 * Both chats' Declare Incident forms offer Affected Resources - searched as
 * the person types, as the member, linked so OneUptime AI can investigate
 * and fix the incident - and, in an alert's own channel, link the alert. The
 * pages say so in two bullets of "Creating incidents and maintenance from
 * ...", and AI SRE lists the chats among the ways an incident is linked to
 * a cluster. Each claim is held here to the code that makes it true: the
 * field's name as the forms draw it, the kinds it searches, that monitors
 * are never among them and that a monitor picked on purpose pauses its
 * checks, that the field is left off for nothing to offer, and that the
 * link the bullets give lands on the section that lists the ways.
 */

const DOCS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);
const COMMON_DIR: string = path.resolve(__dirname, "../../../../Common");

function read(page: string): string {
  return fs.readFileSync(path.join(DOCS_DIR, page), "utf8");
}

function readCommon(relativePath: string): string {
  return fs.readFileSync(path.join(COMMON_DIR, relativePath), "utf8");
}

// The text under an H2 heading, up to the next H2.
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(`## ${heading}`);

  expect(start).toBeGreaterThanOrEqual(0);

  const rest: Array<string> = lines.slice(start + 1);
  const end: number = rest.findIndex((line: string): boolean => {
    return line.startsWith("## ");
  });

  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

// The bullets of a section, in order.
function bulletsOf(text: string): Array<string> {
  return text.split("\n").filter((line: string): boolean => {
    return line.startsWith("- **");
  });
}

function bullet(text: string, lead: string): string {
  const line: string | undefined = bulletsOf(text).find((item: string) => {
    return item.startsWith(`- **${lead}**`);
  });

  expect(line).toBeDefined();
  return line!;
}

const PAGES: Array<{ name: string; page: string; heading: string }> = [
  {
    name: "Slack",
    page: "workspace-connections/slack.md",
    heading: "Creating incidents and maintenance from Slack",
  },
  {
    name: "Microsoft Teams",
    page: "workspace-connections/microsoft-teams.md",
    heading: "Creating incidents and maintenance from Microsoft Teams",
  },
];

const ABOUT_LEAD: string = "What the incident is about.";
const ALERT_LEAD: string = "In an alert's own channel.";

// What the bullets say a kind of resource is called, in the order they list them.
const KINDS_SENTENCE: string =
  "hosts, network devices, clusters, databases, cloud resources and services";

describe.each(PAGES)(
  "$name: Declare Incident's affected resources",
  (row: { name: string; page: string; heading: string }) => {
    const text: string = section(read(row.page), row.heading);

    test("two bullets, right after what a form offers and before what it may name", () => {
      const leads: Array<string> = bulletsOf(text).map((line: string) => {
        return line.substring(4, line.indexOf("**", 4));
      });

      expect(leads).toEqual([
        "Who may use them.",
        "What a form offers.",
        ABOUT_LEAD,
        ALERT_LEAD,
        "What a form may name.",
      ]);
    });

    test("names the field as the form draws it, and the kinds it searches", () => {
      const about: string = bullet(text, ABOUT_LEAD);

      expect(about).toContain(`**${WORKSPACE_AFFECTED_RESOURCES_TEXT.label}**`);
      expect(about).toContain(KINDS_SENTENCE);

      // Each kind the sentence names is one the forms offer.
      const offered: Array<string> = WorkspaceAffectedResources.getKinds();

      for (const kind of [
        AiAffectedResourceKind.Host,
        AiAffectedResourceKind.NetworkDevice,
        AiAffectedResourceKind.KubernetesCluster,
        AiAffectedResourceKind.DatabaseServer,
        AiAffectedResourceKind.CloudResource,
        AiAffectedResourceKind.Service,
      ]) {
        expect(offered).toContain(kind);
      }
    });

    test("says monitors are picked on purpose only, and what a pick does, as the field's hint does", () => {
      const about: string = bullet(text, ABOUT_LEAD);

      expect(WorkspaceAffectedResources.getKinds()).not.toContain("Monitor");
      expect(about).toContain(
        "pauses its checks until the incident is resolved",
      );
      expect(WORKSPACE_AFFECTED_RESOURCES_TEXT.monitorsHint).toContain(
        "pauses its checks until the incident is resolved",
      );
      expect(readCommon("Server/Services/IncidentService.ts")).toContain(
        "public async disableActiveMonitoringIfManualIncident(",
      );
    });

    test("says the field is left off for somebody who may read none, or a project with none", () => {
      expect(bullet(text, ABOUT_LEAD)).toContain("may read none of them");
      expect(
        readCommon("Server/Utils/Workspace/WorkspaceAffectedResources.ts"),
      ).toContain("public static async isOffered(");
    });

    test("links to the section of AI SRE that lists how an incident is linked to a cluster", () => {
      const about: string = bullet(text, ABOUT_LEAD);
      const heading: string = "Which incidents a cluster's fixes act on";

      expect(about).toContain(
        `[${heading}](/docs/ai/ai-sre#${slugify(heading)})`,
      );
      expect(read("ai/ai-sre.md").split("\n")).toContain(`### ${heading}`);
    });

    test("says an alert's own channel links the alert, private like a private alert, and what happens when it may not be linked", () => {
      const alert: string = bullet(text, ALERT_LEAD);

      expect(alert).toContain("while the alert is open");
      expect(alert).toContain("the incident is declared from that alert");
      expect(alert).toContain("a private alert's incident is private too");
      expect(alert).toContain("the incident is declared without the link");
    });
  },
);

describe("AI SRE lists the chats among the ways an incident is linked to a cluster", () => {
  test("after the Dashboard's Other Affected Resources, linking both pages", () => {
    const lines: Array<string> = read("ai/ai-sre.md").split("\n");
    const dashboard: number = lines.findIndex((line: string): boolean => {
      return line.startsWith(
        "- someone picked the cluster under **Other Affected Resources**",
      );
    });

    expect(dashboard).toBeGreaterThan(-1);
    expect(lines[dashboard]!.endsWith(";")).toBe(true);
    expect(lines[dashboard + 1]).toBe(
      "- someone picked the cluster when declaring it from [Slack](/docs/workspace-connections/slack) or [Microsoft Teams](/docs/workspace-connections/microsoft-teams).",
    );
    expect(lines[dashboard + 2]).toBe("");
  });
});
