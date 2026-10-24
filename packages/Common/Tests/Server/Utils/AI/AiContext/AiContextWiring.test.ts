import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH OF ONEUPTIME AI'S FEATURES READ THE PROJECT'S AI CONTEXT (issue
 * #5198), held in the source - the decision is per feature, and a new
 * feature that writes a system prompt cannot ship without making it.
 *
 * It reads it in everything OneUptime AI does for the team on the
 * project's systems:
 *
 *   - every run of the investigation engine - investigations of incidents
 *     and alerts (and their follow-up checks), AI insight triage, security
 *     case triage, and every fix: planning, commands, MCP servers - which
 *     reads it itself, for every run;
 *   - Ask AI: the Dashboard's chat and an incident's or alert's shared
 *     thread (ChatAgentRunner), Slack and Microsoft Teams
 *     (ObservabilityAssistant);
 *   - postmortem drafts: the automatic draft on resolve and Generate with
 *     AI, for incidents and episodes.
 *
 * And the work an AI rule starts reads the rule's notes too: an
 * investigation the rules that investigate its incident (or alert) and
 * match it, a fix its own rule's, a shared thread the same rules as its
 * investigation.
 *
 * It does not read it where it would be wrong, or only cost tokens:
 *
 *   - public notes are written for the status page, and the AI context is
 *     the team's internal reference;
 *   - notes, call summaries and one-call drafts that rewrite a record's own
 *     text, and the short calls that judge or summarize what an
 *     investigation already wrote (its TL;DR, confidence, grade, a chat's
 *     title, a postmortem template pick) - the investigation they draw on
 *     read it already;
 *   - the prompts people write themselves (workflow and runbook AI steps),
 *     a provider's test call, and OneUptime's own drafts that are not
 *     about the project's systems (a detection rule from a description, a
 *     pull request's production review).
 */

const SERVER_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "Server",
);

function readServer(relative: string): string {
  return fs.readFileSync(path.join(SERVER_DIRECTORY, relative), "utf8");
}

// Whitespace, which a formatter moves, and the trailing commas it adds.
const WHITESPACE: RegExp = /\s+/g;
const TRAILING_COMMA: RegExp = /,([)\]}])/g;

// Code as it reads, whatever lines a formatter broke it across.
function squash(code: string): string {
  return code.replace(WHITESPACE, "").replace(TRAILING_COMMA, "$1");
}

// A server file's code, squashed.
function readCode(relative: string): string {
  return squash(readServer(relative));
}

// Every .ts file under Server, repository-relative to it.
function serverFiles(directory: string = SERVER_DIRECTORY): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        files.push(...serverFiles(full));
      }
      continue;
    }

    if (entry.name.endsWith(".ts")) {
      files.push(
        path.relative(SERVER_DIRECTORY, full).split(path.sep).join("/"),
      );
    }
  }

  return files;
}

const SYSTEM_MESSAGE: string = 'role: "system"';

// A fix's runner reads the notes of the rule its suggestion names (squashed).
const READS_THE_FIX_RULES_NOTES: RegExp =
  /AiContextReader\.forRule\(\{projectId,autoRemediationRuleId:suggestion!?\.autoRemediationRuleId\}\)/;

// The files that write a system prompt OneUptime AI's AI context belongs in.
const READS_AI_CONTEXT: Record<string, string> = {
  "Utils/AI/Chat/ObservabilityAssistant.ts":
    "the agent loop of every investigation and fix, and the Slack and Teams answers",
  "Utils/AI/Chat/ChatAgentRunner.ts":
    "Ask AI in the Dashboard and the shared thread of an incident or alert (its title call reads none)",
  "Utils/AI/IncidentAIContextBuilder.ts":
    "an incident's postmortem draft (its note drafts read none)",
  "Utils/AI/IncidentEpisodeAIContextBuilder.ts":
    "an episode's postmortem draft",
};

// The files that write one it deliberately leaves out, and why.
const LEAVES_OUT_AI_CONTEXT: Record<string, string> = {
  "API/LlmProviderAPI.ts": "a provider's test call says only hello",
  "Types/Workflow/Components/AI/GenerateText.ts":
    "a workflow's prompt is written by the person who builds it",
  "Utils/AI/AlertAIContextBuilder.ts":
    "an alert's note draft rewrites the alert's own record",
  "Utils/AI/ScheduledMaintenanceAIContextBuilder.ts":
    "a maintenance note is written for the people it notifies, often the public",
  "Utils/AI/SRE/PostmortemTemplatePick.ts":
    "picks a template by name: one short call",
  "Utils/AI/SRE/InvestigationTldr.ts":
    "summarizes an investigation that read the AI context already",
  "Utils/AI/SRE/ConfidenceSignal.ts":
    "judges an investigation that read the AI context already",
  "Utils/AI/SRE/InvestigationGrader.ts":
    "grades an investigation against how the incident was resolved",
  "Utils/AI/Security/DetectionRuleDraft.ts":
    "drafts a detection rule from the words a person typed",
  "Utils/AI/CallSummary/CallSummaryPrompt.ts":
    "summarizes a call's transcript in the speakers' own words",
  "Utils/CodeRepository/ProductionReview/ProductionReviewAI.ts":
    "reads one pull request against production's own data",
};

// Files that name the role without writing a prompt.
const NOT_A_PROMPT: Record<string, string> = {
  "Utils/LLM/LLMService.ts": "the LLMMessage type itself",
  "Utils/AI/AIRunTranscript.ts":
    "a stand-in for the request messages a transcript leaves out",
};

describe("every system prompt OneUptime AI writes has decided about the AI context", () => {
  const writers: Array<string> = serverFiles().filter((file: string) => {
    return readServer(file).includes(SYSTEM_MESSAGE);
  });

  test("the scan finds the writers it should", () => {
    expect(writers.length).toBeGreaterThanOrEqual(
      Object.keys(READS_AI_CONTEXT).length +
        Object.keys(LEAVES_OUT_AI_CONTEXT).length,
    );
  });

  test("each writer is listed, with its reason", () => {
    const undecided: Array<string> = writers.filter((file: string) => {
      return (
        READS_AI_CONTEXT[file] === undefined &&
        LEAVES_OUT_AI_CONTEXT[file] === undefined &&
        NOT_A_PROMPT[file] === undefined
      );
    });

    expect(undecided).toEqual([]);
  });

  test("no listed file is gone, and no list holds a file twice", () => {
    const listed: Array<string> = [
      ...Object.keys(READS_AI_CONTEXT),
      ...Object.keys(LEAVES_OUT_AI_CONTEXT),
      ...Object.keys(NOT_A_PROMPT),
    ];

    for (const file of listed) {
      expect(fs.existsSync(path.join(SERVER_DIRECTORY, file))).toBe(true);
    }

    expect(new Set(listed).size).toBe(listed.length);
  });

  test.each(Object.keys(READS_AI_CONTEXT))(
    "%s places the AI context the one way: withAiContext",
    (file: string) => {
      expect(readServer(file)).toContain("withAiContext(");
    },
  );

  test.each(Object.keys(LEAVES_OUT_AI_CONTEXT))(
    "%s reads no AI context",
    (file: string) => {
      const source: string = readServer(file);

      expect(source).not.toContain("withAiContext(");
      expect(source).not.toContain("AiContextReader");
    },
  );
});

describe("every run of the investigation engine reads it", () => {
  test("the engine reads the project's AI context and the rules it is handed, records it, and hands it to the loop", () => {
    const engine: string = readCode("Utils/AI/SRE/AIInvestigationEngine.ts");

    expect(engine).toContain(
      squash(
        "await AiContextReader.read({ projectId, rules: request.aiContextRules });",
      ),
    );
    expect(engine).toContain(
      squash("resultSummary: getAiContextEventSummary(aiContext)"),
    );
    // The loop is told what was read - null too - so it never reads again.
    expect(engine).toContain(squash("ObservabilityAssistant.answerQuestion("));
    expect(engine).toContain(squash("aiContext,"));
  });

  test("the loop reads the project's itself only when no caller read it", () => {
    const loop: string = readCode("Utils/AI/Chat/ObservabilityAssistant.ts");

    expect(loop).toContain(
      squash(
        "request.aiContext !== undefined ? request.aiContext : await AiContextReader.read({ projectId: request.projectId });",
      ),
    );
  });

  // The engine call's code, squashed: from executeRun( to its closing ")".
  function engineCall(source: string): string {
    const code: string = squash(source);
    const start: number = code.indexOf("AIInvestigationEngine.executeRun(");

    expect(start).toBeGreaterThan(-1);

    let depth: number = 0;

    for (let index: number = start; index < code.length; index++) {
      if (code[index] === "(") {
        depth++;
      } else if (code[index] === ")") {
        depth--;

        if (depth === 0) {
          return code.slice(start, index + 1);
        }
      }
    }

    return code.slice(start);
  }

  const HANDS_THE_RULES_TO_THE_RUN: string = squash(
    "...(aiContextRules.length > 0 ? { aiContextRules } : {}),",
  );

  test.each([
    "Utils/AI/Remediation/RemediationPlanRunner.ts",
    "Utils/AI/Remediation/RemediationExecutionRunner.ts",
    "Utils/AI/Remediation/McpRemediationRunner.ts",
  ])(
    "%s reads the notes of the rule the fix works for, and hands them to the run",
    (file: string) => {
      const source: string = readServer(file);

      expect(squash(source)).toMatch(READS_THE_FIX_RULES_NOTES);
      expect(engineCall(source)).toContain(HANDS_THE_RULES_TO_THE_RUN);
    },
  );

  test.each([
    [
      "Utils/AI/SRE/IncidentInvestigationRunner.ts",
      "forIncident({ projectId, incidentId })",
    ],
    [
      "Utils/AI/SRE/AlertInvestigationRunner.ts",
      "forAlert({ projectId, alertId })",
    ],
  ])(
    "%s reads the notes of the rules that investigate and match, and hands them to the run",
    (file: string, read: string) => {
      const source: string = readServer(file);

      expect(squash(source)).toContain(
        squash(`await AiContextReader.${read};`),
      );
      expect(engineCall(source)).toContain(HANDS_THE_RULES_TO_THE_RUN);
    },
  );

  test.each([
    "Utils/AI/SRE/Insights/InsightTriageRunner.ts",
    "Utils/AI/Security/SecurityCaseTriageRunner.ts",
  ])(
    "%s has no rule of its own: the project's notes, which the engine reads",
    (file: string) => {
      const source: string = readServer(file);

      expect(source).toContain("AIInvestigationEngine.executeRun(");
      expect(source).not.toContain("aiContextRules");
    },
  );
});

describe("Ask AI and the postmortem drafts read it", () => {
  test("a chat turn reads it, records it after it starts, and places it first", () => {
    const runner: string = readCode("Utils/AI/Chat/ChatAgentRunner.ts");
    const records: string = squash(
      "resultSummary: getAiContextEventSummary(aiContext)",
    );

    expect(runner).toContain(
      squash(
        "await AiContextReader.read({ projectId: request.projectId, rules: request.aiContextRules });",
      ),
    );
    expect(runner).toContain(records);
    expect(
      runner.indexOf(squash("eventType: AIRunEventType.RunStarted")),
    ).toBeLessThan(runner.indexOf(records));
  });

  test("a shared thread hands the turn the notes of the rules its investigation read", () => {
    const thread: string = readCode("Utils/AI/SRE/InvestigationThread.ts");
    const service: string = readCode(
      "Utils/AI/SRE/InvestigationThreadService.ts",
    );

    expect(thread).toContain(squash("await AiContextReader.forIncident({"));
    expect(thread).toContain(squash("await AiContextReader.forAlert({"));
    expect(service).toContain(
      squash("{ aiContextRules: context.aiContextRules }"),
    );
  });

  test("Generate with AI reads the row's project's notes for an incident's and an episode's postmortem", () => {
    expect(readCode("API/IncidentAPI.ts")).toContain(
      squash("await AiContextReader.read({ projectId: incident.projectId })"),
    );
    expect(readCode("API/IncidentEpisodeAPI.ts")).toContain(
      squash("await AiContextReader.read({ projectId: episode.projectId })"),
    );
  });

  test("the automatic draft reads them first and hands them to the draft", () => {
    const runner: string = readCode("Utils/AI/SRE/IncidentPostmortemRunner.ts");

    expect(runner).toContain(
      squash(
        "const aiContext: AiContextActivity | null = await AiContextReader.read({ projectId });",
      ),
    );
    // The draft is written with what was read.
    expect(runner).toContain(
      squash("llmProviderId: llmProviderChoice.llmProviderId, aiContext })"),
    );
  });

  test("an incident's note drafts and public notes never read it", () => {
    const builder: string = readServer("Utils/AI/IncidentAIContextBuilder.ts");
    const noteBuilder: string = builder.slice(
      builder.indexOf("public static formatIncidentContextForNote("),
      builder.indexOf("public static buildGenericAIContext("),
    );

    expect(noteBuilder.length).toBeGreaterThan(0);
    expect(noteBuilder).not.toContain("withAiContext(");
  });
});
