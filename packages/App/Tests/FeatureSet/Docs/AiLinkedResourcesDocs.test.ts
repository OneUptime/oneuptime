import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { AI_SRE, ASK_AI } from "./AiDocsPages";
import { readPage } from "./DocsContentSupport";
import { drawnActionLabel } from "./DocsDashboardLabels";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #5293: declared from a host's page, an incident Ask AI created was
 * linked to nothing, and its Remediation card said only that it was "not
 * linked to a Kubernetes cluster or an infrastructure resource". The docs
 * now say what the product does, and this suite ties each sentence to the
 * code that does it:
 *
 *   - Ask AI links an incident or alert to what it is about: one it creates
 *     on a resource's page is linked to that resource, and the approval card
 *     names what each action links (create_incident's prepareMutation, the
 *     card's description line, the add_*_affected_resources tools);
 *   - a cluster is linked when Ask AI declared the incident on its page;
 *   - an incident linked to nothing says what to do - add what it is about
 *     under Affected Resources - and OneUptime AI tries again while it is
 *     open (the Remediation card's line, onSubjectLinksChanged).
 *
 * Every language says it in the English page's places, the Affected
 * Resources card named as its Dashboard draws it.
 */

const REPO_PACKAGES: string = path.resolve(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_PACKAGES, relativePath), "utf8");
}

const ASK_AI_BULLET_START: string =
  "- Link an incident or an alert to the infrastructure and services it is about.";
const CLUSTER_BULLET: string =
  "- Ask AI declared it on the cluster's page, or linked it to the cluster when asked;";
const NOTHING_LINKED_START: string =
  "When the incident is linked to no cluster and no infrastructure resource at all";

const ASK_AI_LINES: Array<string> = readPage("en", ASK_AI).split("\n");
const AI_SRE_LINES: Array<string> = readPage("en", AI_SRE).split("\n");

function lineStarting(lines: Array<string>, start: string): number {
  return lines.findIndex((line: string): boolean => {
    return line.startsWith(start);
  });
}

const ASK_AI_BULLET_LINE: number = lineStarting(
  ASK_AI_LINES,
  ASK_AI_BULLET_START,
);
const CLUSTER_BULLET_LINE: number = lineStarting(AI_SRE_LINES, CLUSTER_BULLET);
const NOTHING_LINKED_LINE: number = lineStarting(
  AI_SRE_LINES,
  NOTHING_LINKED_START,
);

const OTHER_LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

describe("Ask AI links what an incident or alert is about", () => {
  test("the page lists it among the actions, after creating an incident", () => {
    expect(ASK_AI_BULLET_LINE).toBeGreaterThan(-1);
    expect(ASK_AI_LINES[ASK_AI_BULLET_LINE - 1]).toBe(
      "- Create an incident, acknowledge or resolve incidents and alerts, and change an incident's severity.",
    );
    expect(ASK_AI_LINES[ASK_AI_BULLET_LINE]).toBe(
      `${ASK_AI_BULLET_START} An incident it creates on a resource's page, such as a host's, is linked to that resource, and the approval card names what each action links. OneUptime AI investigates and fixes what an incident or alert is linked to.`,
    );
  });

  test("an incident created on a resource's page is linked to it: create_incident writes the page's resource out", () => {
    const tools: string = readSource(
      "Common/Server/Utils/AI/Toolbox/IncidentWriteTools.ts",
    );
    const vocabulary: string = readSource(
      "Common/Types/AI/AiAffectedResources.ts",
    );

    expect(tools).toContain(
      "AffectedResourceLinks.withPageResourceWrittenOut({ args, ctx })",
    );
    expect(tools).toContain("AffectedResourceLinks.setOnRecord(incident");
    // A host's page is a resource's page.
    expect(vocabulary).toContain("AIChatPageContextType.Resource");
  });

  test("the approval card names what each action links", () => {
    const card: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/AIChat/ToolApprovalCard.tsx",
    );
    const runner: string = readSource(
      "Common/Server/Utils/AI/Chat/ChatAgentRunner.ts",
    );

    expect(card).toContain("{action.description}");
    expect(runner).toContain(
      "await this.prepareMutation(toolCall, toolContext)",
    );
  });

  test("existing incidents and alerts are linked by tools of their own", () => {
    const toolbox: string = readSource(
      "Common/Server/Utils/AI/Toolbox/Index.ts",
    );

    expect(toolbox).toContain("    AddIncidentAffectedResourcesTool,");
    expect(toolbox).toContain("    AddAlertAffectedResourcesTool,");
  });
});

describe("AI SRE says how an incident is linked, and what to do when it is not", () => {
  test("a cluster is linked when Ask AI declared the incident on its page, among the other ways", () => {
    expect(CLUSTER_BULLET_LINE).toBeGreaterThan(-1);
    expect(AI_SRE_LINES[CLUSTER_BULLET_LINE - 1]).toMatch(
      /^- its monitor is linked to the cluster under/,
    );
    expect(AI_SRE_LINES[CLUSTER_BULLET_LINE + 1]).toMatch(
      /^- someone picked the cluster under \*\*Other Affected Resources\*\*/,
    );
  });

  test("an incident linked to nothing says what to do, and OneUptime AI tries again while it is open", () => {
    const paragraph: string = AI_SRE_LINES[NOTHING_LINKED_LINE] || "";

    expect(paragraph).toContain(
      "with what to do: add the host, cluster or database it is about under **Affected Resources**, and OneUptime AI tries again while the incident is open, as it would for a new one.",
    );
    expect(paragraph).toContain(
      "An incident with monitors also gets a link to each of them",
    );
  });

  test("the card says the same, in the same words", () => {
    const lines: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionLines.ts",
    );
    const paragraph: string = AI_SRE_LINES[NOTHING_LINKED_LINE] || "";

    expect(lines).toContain(
      '"This {{signal}} is not linked to a host, cluster or database, so OneUptime AI had nothing to fix."',
    );
    expect(lines).toContain(
      '"Add the host, cluster or database it is about under Affected Resources, and OneUptime AI tries again."',
    );
    // What to add, named as the page names it.
    expect(paragraph).toContain(
      "add the host, cluster or database it is about under **Affected Resources**, and OneUptime AI tries again",
    );
  });

  test("it tries again only while the incident is open, from what the card's Edit writes", () => {
    const engine: string = readSource(
      "Common/Server/Services/AutoRemediationRuleEngineService.ts",
    );
    const incidents: string = readSource(
      "Common/Server/Services/IncidentService.ts",
    );

    expect(engine).toContain("public async onSubjectLinksChanged(");
    expect(engine).toContain("IncidentService.isIncidentResolved(");
    expect(incidents).toContain(
      "AutoRemediationRuleEngineService.onSubjectUpdated({",
    );
  });

  test("the card it names is the incident page's Affected Resources card", () => {
    const page: string = readSource(
      "App/FeatureSet/Dashboard/src/Pages/Incidents/View/Index.tsx",
    );

    expect(page).toContain('title: "Affected Resources",');
  });
});

describe("every language says it in the English page's places", () => {
  test.each(OTHER_LANGUAGES)("%s", (language: string) => {
    const askAi: Array<string> = readPage(language, ASK_AI).split("\n");
    const aiSre: Array<string> = readPage(language, AI_SRE).split("\n");

    // The bullet sits where the English one does, a list item of its own.
    expect(askAi[ASK_AI_BULLET_LINE]).toMatch(/^- /);
    expect(askAi[ASK_AI_BULLET_LINE]).not.toBe(
      ASK_AI_LINES[ASK_AI_BULLET_LINE],
    );
    expect(askAi[ASK_AI_BULLET_LINE]).toContain("OneUptime AI");

    expect(aiSre[CLUSTER_BULLET_LINE]).toMatch(/^- /);
    expect(aiSre[CLUSTER_BULLET_LINE]).not.toBe(CLUSTER_BULLET);

    // The card named as the Dashboard draws it in this language.
    const affectedResources: string = drawnActionLabel(
      language,
      "Affected Resources",
    );
    expect(affectedResources).not.toBe("");
    expect(aiSre[NOTHING_LINKED_LINE]).toContain(`**${affectedResources}**`);
    expect(aiSre[NOTHING_LINKED_LINE]).toContain("OneUptime AI");
  });
});
