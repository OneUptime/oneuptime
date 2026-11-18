import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { readRepoFile } from "./InventoryAndApiDocsSupport";

/*
 * What the AI pages say an investigation, an answer and a code fix read
 * (#9576), in every language:
 *
 *  - an investigation's report is read by everyone who may see its
 *    incident or alert, so it - and a check it makes again - reads only
 *    what all of them may read: everything of a kind no role reads only by
 *    owner or label, and otherwise none an owner or a label sets apart,
 *    beside the subject's own monitors and affected resources
 *    (ReadAudiencePermission, ReadAudienceReader);
 *  - an answer in a shared thread, Slack or Microsoft Teams reads what the
 *    person who asked may read, and everyone there reads it;
 *  - a code fix's pull request is read outside the project's roles, so the
 *    agent leaves out what an owner or a label sets apart
 *    (CodeAgentTelemetryScope); a production review names everything a
 *    change reaches, and says that everyone who can read the repository
 *    reads it.
 *
 * The English lines are held to their words; every language's lines to
 * their place, which AiDocsTranslations holds line for line.
 */

const AI_SRE: string = "ai/ai-sre";
const ASK_AI: string = "ai/ask-ai";
const CODE: string = "ai/ai-agent";

const INVESTIGATION_READS: string =
  "Everyone who may see the incident or alert reads its report, in its feed and in the Slack and Microsoft Teams channels it is posted to, so an investigation, and a check it makes again, reads only what all of them may read. A kind of record that no team, custom role or API key reads only by owner or by label is read whole, as before. Where some do, a monitor, service, host, cluster, SLO, alert or other record that an owner or a label sets apart is left out, unless it is one of the incident's or alert's own monitors and affected resources. What is left out is never named or counted, in what the investigation starts from or in what it asks along the way. A record nobody set apart is still read, even where a role sees only what its members own, or only some labels.";
const THREAD_ANSWER: string =
  "An answer reads what the person who asked may read, and everyone in the thread reads it.";
const CHANNEL_ANSWER: string =
  "An answer in Slack or Microsoft Teams reads what the person who asked may read, and everyone in the channel reads it; an autonomous AI investigation reads only what everyone who may see its incident or alert may read.";
const CODE_FIX_READS: string =
  "- **What everyone may read.** What the agent finds lands in a pull request, which people outside your OneUptime roles may read.";
const REVIEW_READERS: string =
  "- **Everyone who can read the repository reads it.** A review names what production shows of the repository's services, and every table, service, dashboard and data product a change to the data reaches, whoever owns them and whatever labels they carry";

// A page's lines, 0-based.
function linesOf(lang: string, page: string): Array<string> {
  return readPage(lang, page).split("\n");
}

// The index of the one English line holding `text`.
function englishLineWith(page: string, text: string): number {
  const found: Array<number> = linesOf("en", page)
    .map((line: string, index: number): number => {
      return line.includes(text) ? index : -1;
    })
    .filter((index: number): boolean => {
      return index >= 0;
    });

  if (found.length !== 1) {
    throw new Error(
      `en/${page}: expected one line with ${text.slice(0, 60)}, found ${found.length}`,
    );
  }

  return found[0]!;
}

describe("AI docs: what an investigation, an answer and a code fix read (#9576)", () => {
  it("What an investigation reads says it reads only what everyone who may see the subject may read", () => {
    const lines: Array<string> = linesOf("en", AI_SRE);
    const index: number = englishLineWith(AI_SRE, INVESTIGATION_READS);

    // After the section's list of what it reads, before what its activity says.
    expect(
      lines[index - 2]!.startsWith("- The project's resolved incidents"),
    ).toBe(true);
    expect(lines[index]).toBe(INVESTIGATION_READS);
    expect(
      lines
        .slice(0, index)
        .reverse()
        .find((line: string): boolean => {
          return line.startsWith("## ");
        }),
    ).toBe("## What an investigation reads");
  });

  it("an answer in the shared thread, or in Slack or Microsoft Teams, reads what the person who asked may read", () => {
    expect(
      linesOf("en", AI_SRE)[
        englishLineWith(AI_SRE, "**One shared thread.**")
      ]!.endsWith(THREAD_ANSWER),
    ).toBe(true);
    expect(
      linesOf("en", ASK_AI)[
        englishLineWith(
          ASK_AI,
          "**Slack, Microsoft Teams and AI investigations.**",
        )
      ]!.endsWith(CHANNEL_ANSWER),
    ).toBe(true);
  });

  it("a fix's agent leaves out what is set apart, and a production review says who reads it", () => {
    expect(englishLineWith(CODE, CODE_FIX_READS)).toBeGreaterThan(0);
    expect(englishLineWith(CODE, REVIEW_READERS)).toBeGreaterThan(0);
  });

  it("the product reads as the pages say: the runners work out the readers, and the engine and the code agent read for them", () => {
    const engine: string = readRepoFile(
      "Common/Server/Utils/AI/SRE/AIInvestigationEngine.ts",
    );
    const alertRunner: string = readRepoFile(
      "Common/Server/Utils/AI/SRE/AlertInvestigationRunner.ts",
    );
    const incidentRunner: string = readRepoFile(
      "Common/Server/Utils/AI/SRE/IncidentInvestigationRunner.ts",
    );
    const codeAgent: string = readRepoFile(
      "Common/Server/Utils/AI/CodeFix/CodeAgentTelemetryTools.ts",
    );

    expect(engine).toContain(
      "ReadAudiencePermission.getReadProps(request.readAudience)",
    );
    expect(alertRunner).toContain("ReadAudienceReader.forSubject");
    expect(incidentRunner).toContain("ReadAudienceReader.forSubject");
    expect(codeAgent).toContain(
      "ReadAudiencePermission.getReadProps(scope.readAudience)",
    );
  });

  describe.each(DOCS_LANGUAGES)("%s", (lang: string) => {
    it("says what an investigation reads where the English page says it", () => {
      const line: string = linesOf(lang, AI_SRE)[
        englishLineWith(AI_SRE, INVESTIGATION_READS)
      ]!;

      expect({
        lang,
        slack: line.includes("Slack"),
        teams: line.includes("Microsoft Teams"),
        slo: line.includes("SLO"),
      }).toEqual({ lang, slack: true, teams: true, slo: true });
    });

    it("names who reads a fix's pull request and a production review, as bullets of their lists", () => {
      const lines: Array<string> = linesOf(lang, CODE);

      expect({
        lang,
        fix: lines[englishLineWith(CODE, CODE_FIX_READS)]!.startsWith("- **"),
        review:
          lines[englishLineWith(CODE, REVIEW_READERS)]!.startsWith("- **"),
      }).toEqual({ lang, fix: true, review: true });
    });
  });
});
