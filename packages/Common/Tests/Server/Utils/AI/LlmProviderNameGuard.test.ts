import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * THE SERVER'S AI MESSAGES NAME THE LLM PROVIDERS SETTING BY ITS NAME (#6738).
 *
 * The page where a project sets up the model OneUptime AI runs on is
 * Project Settings → AI → LLM Providers, and the Dashboard says "LLM
 * provider" everywhere it sends someone there. The server's messages about
 * OneUptime AI said "AI provider" instead - why an incident was not
 * investigated, why Try again or Investigate now could not start, why an
 * insight was not triaged, what an AI agent page is missing - so an API
 * reader, or anyone on an older Dashboard, looked for a setting that does
 * not exist under that name.
 *
 * #7156 added the messages that still said it: Ask AI's provider errors,
 * a failed model call, a refused AI fix's Try again, and the workflow AI
 * step's documentation. The Dashboard's words are held the same way
 * (packages/App/Tests/Dashboard/LlmProviderNameInDashboard.test.ts).
 *
 * This reads the text of every message these files write (string literals
 * and template text, not comments) and holds it to "LLM provider". Log
 * lines are left out: nobody looks for a setting in them. Prompts are not
 * listed: what the model reads names no setting for a person to find.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "../../../..");

// The files whose messages people read about OneUptime AI not starting.
const MESSAGE_FILES: ReadonlyArray<string> = [
  "Server/Utils/AI/SRE/InvestigationEligibility.ts",
  "Server/Utils/AI/SRE/InvestigationTryAgain.ts",
  "Server/Utils/AI/SRE/InvestigationRuleWait.ts",
  "Server/Utils/AI/SRE/InvestigationQueue.ts",
  "Server/Utils/AI/SRE/Insights/Triage.ts",
  "Server/Utils/AI/FirstResponder/AiFirstResponderEligibility.ts",
  "Server/Utils/AI/Security/SecurityCaseTriage.ts",
  "Server/Services/ResourceAiAccessService.ts",
  "Server/Services/KubernetesClusterAiAccessService.ts",
  // #7156: Ask AI, a failed model call, an AI fix, the workflow AI step.
  "Server/API/AIChatAPI.ts",
  "Server/Services/AIService.ts",
  "Server/Utils/AutoRemediation/RemediationRound.ts",
  "Types/AutoRemediation/RemediationRound.ts",
  "Types/Workflow/Documentation/AIDocumentation.ts",
  /*
   * #7359: why Try again or Investigate now did not start, one sentence
   * per refusal code - InvestigationTryAgain, InvestigationRuleWait and
   * InsightTriage refuse with these codes, and write no sentence of their
   * own.
   */
  "Types/AI/AiRunRefusal.ts",
];

// "AI provider", "AI providers", "AI-provider", in any case.
const AI_PROVIDER: RegExp = /\bAI[ -]providers?\b/i;

// A call that only logs: logger.error(...), logger.debug(...) and the rest.
const LOG_CALL: RegExp = /^logger\.\w+$/;

interface MessageText {
  file: string;
  line: number;
  text: string;
}

// Every piece of text a file writes, with the line it starts on.
function messageTexts(file: string, source: string): Array<MessageText> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const texts: Array<MessageText> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      LOG_CALL.test(node.expression.getText(sourceFile))
    ) {
      return;
    }

    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      texts.push({
        file,
        line:
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1,
        text: node.text,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return texts;
}

describe("the server's AI messages say LLM provider, never AI provider", () => {
  test.each(MESSAGE_FILES)("%s", (file: string) => {
    const source: string = fs.readFileSync(
      path.join(COMMON_ROOT, file),
      "utf8",
    );
    const saysAiProvider: Array<string> = messageTexts(file, source)
      .filter((found: MessageText): boolean => {
        return AI_PROVIDER.test(found.text);
      })
      .map((found: MessageText): string => {
        return `${found.file}:${found.line}: ${found.text}`;
      });

    expect(saysAiProvider).toEqual([]);
  });

  test("the files that word a missing provider name the LLM Providers page", () => {
    for (const file of [
      "Server/Utils/AI/SRE/InvestigationEligibility.ts",
      // Try again, Investigate now and a triage's Try again (#7359).
      "Types/AI/AiRunRefusal.ts",
      "Server/Services/ResourceAiAccessService.ts",
      "Server/Services/KubernetesClusterAiAccessService.ts",
      "Server/Services/AIService.ts",
      "Types/AutoRemediation/RemediationRound.ts",
      "Types/Workflow/Documentation/AIDocumentation.ts",
    ]) {
      const texts: Array<string> = messageTexts(
        file,
        fs.readFileSync(path.join(COMMON_ROOT, file), "utf8"),
      ).map((found: MessageText): string => {
        return found.text;
      });

      expect({
        file,
        namesThePage: texts.some((text: string): boolean => {
          return (
            text.includes("Project Settings → AI → LLM Providers") ||
            text.includes("Project Settings > AI > LLM Providers")
          );
        }),
        saysLlmProvider: texts.some((text: string): boolean => {
          return text.includes("LLM provider");
        }),
      }).toEqual({ file, namesThePage: true, saysLlmProvider: true });
    }
  });
});

describe("the reading itself", () => {
  test("reads strings and template text, and leaves out comments and log lines", () => {
    const texts: Array<string> = messageTexts(
      "Example.ts",
      [
        "// No AI provider here: a comment.",
        "/* Nor an AI provider here. */",
        'const title: string = "No LLM provider was available";',
        "const kind: string = 'alert';",
        "const step: string = `Review the ${kind} AI provider settings`;",
        "logger.error(`AI: no AI provider for ${kind}`);",
        "const plain: string = `No AI-provider either`;",
      ].join("\n"),
    ).map((found: MessageText): string => {
      return found.text;
    });

    expect(texts).toEqual([
      "No LLM provider was available",
      "alert",
      "Review the ",
      " AI provider settings",
      "No AI-provider either",
    ]);
    expect(
      texts.filter((text: string): boolean => {
        return AI_PROVIDER.test(text);
      }),
    ).toEqual([" AI provider settings", "No AI-provider either"]);
  });

  test("names the line a text is on", () => {
    expect(
      messageTexts("Example.ts", '\n\nconst a: string = "AI provider";'),
    ).toEqual([{ file: "Example.ts", line: 3, text: "AI provider" }]);
  });

  test("every file it reads is there", () => {
    for (const file of MESSAGE_FILES) {
      expect({
        file,
        exists: fs.existsSync(path.join(COMMON_ROOT, file)),
      }).toEqual({
        file,
        exists: true,
      });
    }
  });
});
