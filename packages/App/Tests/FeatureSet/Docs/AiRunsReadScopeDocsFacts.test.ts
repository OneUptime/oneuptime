import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { readRepoFile } from "./InventoryAndApiDocsSupport";

/*
 * What the AI pages say a fix, an AI insight's triage and a security case's
 * triage read (#9612), in every language. Each is posted where everyone who
 * may see its subject reads it, so each reads only what all of them may
 * read, as an investigation does (#9576):
 *
 *  - a fix reads for its incident's or alert's readers, beside what it acts
 *    on - its cluster or resource, the Runners and runbooks its AI rule
 *    names - and with no rule picks a runbook only from those nobody set
 *    apart (RemediationReadAudience); its track record names and counts no
 *    incident or alert set apart;
 *  - an insight's triage reads as nobody in particular may, beside the
 *    insight's own service: its readers are those of its service, or the
 *    whole project for an insight about none (ReadAudienceReader, subject:
 *    the insight);
 *  - a case's triage reads for the case's readers, beside the case and the
 *    incident it declared, unless that incident is private; posted on the
 *    case alone, it counts only the owner and label narrowing that reaches
 *    somebody who may read security cases or the audit log (#9632), worked
 *    out each time it runs.
 *
 * The English lines are held to their words; every language's lines to
 * their place, which AiDocsTranslations and AiToolingAndSecurityDocsTranslations
 * hold line for line.
 */

const AI_SRE: string = "ai/ai-sre";
const SECURITY_AI: string = "telemetry/security-ai";

const INVESTIGATION_READS: string =
  "Everyone who may see the incident or alert reads its report, in its feed and in the Slack and Microsoft Teams channels it is posted to";
const FIX_READS: string =
  "A fix OneUptime AI works out for the incident or alert reads the same way: its plan, its reasoning and its outcome are posted on the incident or alert and in its channels. What the fix acts on is read whoever owns it and whatever labels it carries: the cluster or resource it fixes, and the Runners and runbooks its AI rule names. With no AI rule, OneUptime AI picks a runbook only from those nobody set apart, since the runbook it picks is posted by name.";
const TRACK_RECORD: string = "- **How the same change went before.**";
const TRACK_RECORD_SET_APART: string =
  "Private incidents and alerts are neither named nor counted. Neither are incidents and alerts that an owner or a label sets apart, where some team, custom role or API key reads them only by owner or by label.";
const INSIGHT_TRIAGE: string =
  "When an LLM provider is configured, each new insight also gets a **triage analysis**";
const INSIGHT_TRIAGE_READS: string =
  "Everyone who may see an insight reads its triage: whoever may read the service it is about, or, for an insight about no service, everyone who may read insights. So a triage reads as an investigation does. A kind of record that no team, custom role or API key reads only by owner or by label is read whole; where some do, a record that an owner or a label sets apart is left out, unless it is the insight's own service, and it is never named or counted. Private incidents and alerts are never read.";
const CASE_READS: string =
  "It can also read the rest of OneUptime the way an incident's investigation does";
const CASE_TRIAGE_READS: string =
  "Everyone who may see the case reads its triage, so a triage reads only what all of them may read. A team, custom role or API key that reads a kind of record only by owner or by label counts only when the API key, or someone on the team, may read security cases or the audit log. A kind of record that none of them reads only by owner or by label is read whole; where some do, a host, cluster, service or other record that an owner or a label sets apart is left out, and it is never named or counted. Who may read security cases is worked out each time a triage runs, so a triage written before someone got that access may name records set apart from them. The case is always read, and so is the incident it declared, unless that incident is private. Private incidents and alerts are never read.";

// A page's lines, 0-based.
function linesOf(lang: string, page: string): Array<string> {
  return readPage(lang, page).split("\n");
}

// The index of the one English line starting with `text`.
function englishLineStarting(page: string, text: string): number {
  const found: Array<number> = linesOf("en", page)
    .map((line: string, index: number): number => {
      return line.startsWith(text) ? index : -1;
    })
    .filter((index: number): boolean => {
      return index >= 0;
    });

  if (found.length !== 1) {
    throw new Error(
      `en/${page}: expected one line starting with ${text.slice(0, 60)}, found ${found.length}`,
    );
  }

  return found[0]!;
}

// The heading a line sits under.
function headingAbove(lines: Array<string>, index: number): string | undefined {
  return lines
    .slice(0, index)
    .reverse()
    .find((line: string): boolean => {
      return line.startsWith("## ");
    });
}

describe("AI docs: what a fix, an insight's triage and a case's triage read (#9612)", () => {
  it("What an investigation reads says a fix reads the same way, right after the investigation", () => {
    const lines: Array<string> = linesOf("en", AI_SRE);
    const index: number = englishLineStarting(AI_SRE, FIX_READS);

    expect(lines[index]).toBe(FIX_READS);
    expect(index).toBe(englishLineStarting(AI_SRE, INVESTIGATION_READS) + 2);
    expect(headingAbove(lines, index)).toBe("## What an investigation reads");
  });

  it("a change's track record names and counts no incident or alert set apart", () => {
    const lines: Array<string> = linesOf("en", AI_SRE);

    expect(
      lines[englishLineStarting(AI_SRE, TRACK_RECORD)]!.endsWith(
        TRACK_RECORD_SET_APART,
      ),
    ).toBe(true);
  });

  it("Insights say who reads a triage, and that it reads as nobody in particular may", () => {
    const lines: Array<string> = linesOf("en", AI_SRE);
    const index: number = englishLineStarting(AI_SRE, INSIGHT_TRIAGE_READS);

    expect(lines[index]).toBe(INSIGHT_TRIAGE_READS);
    expect(index).toBe(englishLineStarting(AI_SRE, INSIGHT_TRIAGE) + 2);
    expect(headingAbove(lines, index)).toBe(
      "## Insights — proactive detection",
    );
  });

  it("OneUptime AI in Security says what a case's triage reads, after what it reads", () => {
    const lines: Array<string> = linesOf("en", SECURITY_AI);
    const index: number = englishLineStarting(SECURITY_AI, CASE_TRIAGE_READS);

    expect(lines[index]).toBe(CASE_TRIAGE_READS);
    expect(index).toBe(englishLineStarting(SECURITY_AI, CASE_READS) + 2);
    expect(headingAbove(lines, index)).toBe("## Triage a case");
  });

  it("the product reads as the pages say: every runner works out its readers and hands them to the engine", () => {
    const fixReaders: string = readRepoFile(
      "Common/Server/Utils/AI/Remediation/RemediationReadAudience.ts",
    );
    const planRunner: string = readRepoFile(
      "Common/Server/Utils/AI/Remediation/RemediationPlanRunner.ts",
    );
    const executionRunner: string = readRepoFile(
      "Common/Server/Utils/AI/Remediation/RemediationExecutionRunner.ts",
    );
    const mcpRunner: string = readRepoFile(
      "Common/Server/Utils/AI/Remediation/McpRemediationRunner.ts",
    );
    const insightRunner: string = readRepoFile(
      "Common/Server/Utils/AI/SRE/Insights/InsightTriageRunner.ts",
    );
    const caseRunner: string = readRepoFile(
      "Common/Server/Utils/AI/Security/SecurityCaseTriageRunner.ts",
    );
    const readers: string = readRepoFile(
      "Common/Server/Utils/ReadAudience/ReadAudienceReader.ts",
    );

    // What a fix acts on is named: its cluster or resource, its rule's Runners and runbooks.
    for (const target of [
      "kubernetesClusterIds",
      "runnerIds",
      "runbookIds",
      "resource",
    ]) {
      expect(fixReaders).toContain(target);
    }

    for (const runner of [planRunner, executionRunner, mcpRunner]) {
      expect(runner).toContain("RemediationReadAudience.forFix");
    }

    // The project's own pick reads its runbooks for the readers.
    expect(planRunner).toContain(
      "props: ReadAudiencePermission.getReadProps(data.readAudience)",
    );
    // Rollback first reads the recent changes for them.
    expect(executionRunner).toContain("readAudience: data.readAudience");
    expect(insightRunner).toContain("aiInsightId: sentinelInsightId");
    expect(caseRunner).toContain("ReadAudienceReader.forSubject");
    // A private declared incident is never named for the case's readers.
    expect(readers).toContain("incident.isPrivate === true");
    // A case's triage weighs only the narrowing that reaches the case's readers (#9632)...
    expect(caseRunner).toContain("{ postsOnlyWhereTheSubjectIsRead: true }");
    expect(readers).toContain("readRowsReachingReaders");
    // ...who read the case, its timeline, or the audit log.
    for (const readOn of ["SecurityCase,", "SecurityCaseFeed,", "AuditLog()"]) {
      expect(readers).toContain(readOn);
    }

    // An insight's triage and a fix count every row, as the pages say.
    expect(insightRunner).not.toContain("postsOnlyWhereTheSubjectIsRead");
    expect(fixReaders).not.toContain("postsOnlyWhereTheSubjectIsRead");
  });

  describe.each(DOCS_LANGUAGES)("%s", (lang: string) => {
    it("says what a fix, an insight's triage and a case's triage read, where the English pages say it", () => {
      const sre: Array<string> = linesOf(lang, AI_SRE);
      const security: Array<string> = linesOf(lang, SECURITY_AI);
      const fix: string = sre[englishLineStarting(AI_SRE, FIX_READS)]!;
      const insight: string =
        sre[englishLineStarting(AI_SRE, INSIGHT_TRIAGE_READS)]!;
      const triage: string =
        security[englishLineStarting(SECURITY_AI, CASE_TRIAGE_READS)]!;

      expect({
        lang,
        // Product names every language keeps, and an API key every one names.
        fix: fix.includes("OneUptime AI") && fix.includes("Runner"),
        trackRecord:
          sre[englishLineStarting(AI_SRE, TRACK_RECORD)]!.includes("API"),
        insight: insight.includes("API"),
        triage: triage.includes("API"),
        // Paragraphs of their own, as the English ones are.
        own: [
          sre[englishLineStarting(AI_SRE, FIX_READS) + 1],
          sre[englishLineStarting(AI_SRE, INSIGHT_TRIAGE_READS) + 1],
          security[englishLineStarting(SECURITY_AI, CASE_TRIAGE_READS) + 1],
        ],
      }).toEqual({
        lang,
        fix: true,
        trackRecord: true,
        insight: true,
        triage: true,
        own: ["", "", ""],
      });
    });
  });
});
