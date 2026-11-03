import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import AIToolbox from "../../../Server/Utils/AI/Toolbox/Index";
import { ObservabilityTool } from "../../../Server/Utils/AI/Toolbox/ToolTypes";
import { READ_TOOL_OUTPUT_TOOL_NAME } from "../../../Server/Utils/AI/Chat/ToolOutputPager";
import { ROLL_BACK_CHANGE_TOOL_NAME } from "../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import {
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
} from "../../../Server/Utils/AI/ResourceAccess/ResourceAccessToolNames";
import {
  CALL_MCP_TOOL_TOOL_NAME,
  LIST_MCP_TOOLS_TOOL_NAME,
} from "../../../Types/AI/ExternalMcpServer/ExternalMcpToolNames";
import {
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import ObjectID from "../../../Types/ObjectID";
import { Translator } from "../../../Types/Translator";
import {
  describeLiveActivity,
  friendlyToolNames,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import {
  EvidenceToolDescription,
  getKnownEvidenceTool,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * EVERY STEP OneUptime AI TAKES READS AS WHAT IT DOES, IN THE READER'S
 * LANGUAGE.
 *
 * While Ask AI answers, its live line names the step it is on ("Checking
 * SLOs"), and an investigation's activity and its Evidence checked list
 * say each step again once it ran ("Checked SLOs"). Both read the tool a
 * step ran from two lists of the Dashboard - ChatActivityFeed's step
 * labels and InvestigationEvidenceFormat's evidence lines - and a tool
 * missing from them read as its own name: "Running query_slos", "Ran
 * query slos", in English on every page.
 *
 * So every tool a run can call - each of the toolbox's, and each one a
 * run adds beside it (kubectl, infrastructure commands, fixes and their
 * rollback, the project's MCP servers, the rest of a long output) - has a
 * step label and an evidence line, and each of those is worded in the
 * sixteen languages the Dashboard speaks. A new tool, or a new word, that
 * skips either fails here, not on a reader's screen.
 */

const SERVER_AI_DIR: string = path.resolve(
  __dirname,
  "../../../Server/Utils/AI",
);

/*
 * The tools a run adds beside the toolbox, by the constant each is named
 * by where it has one: a definition naming a constant missing here fails
 * "every tool a run adds is checked" until it is added.
 */
const EXTRA_TOOL_NAME_CONSTANTS: Record<string, string> = {
  RUN_KUBECTL_TOOL_NAME,
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
  LIST_MCP_TOOLS_TOOL_NAME,
  CALL_MCP_TOOL_TOOL_NAME,
  ROLL_BACK_CHANGE_TOOL_NAME,
  READ_TOOL_OUTPUT_TOOL_NAME,
};

// A run's own tool definition: `definition: { name: "x"` or `name: X_TOOL_NAME`.
const DEFINITION_NAME: RegExp =
  /definition:\s*\{\s*name:\s*("[^"\n]+"|[A-Z][A-Z0-9_]*)\s*,/g;

const TYPESCRIPT_FILE: RegExp = /\.ts$/;

function serverSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...serverSourceFiles(full));
    } else if (TYPESCRIPT_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

interface DefinedTool {
  file: string;
  written: string;
  name: string | undefined;
}

// Every tool definition a run adds, as written, with the name it resolves to.
function definedExtraTools(): Array<DefinedTool> {
  const defined: Array<DefinedTool> = [];

  for (const file of serverSourceFiles(SERVER_AI_DIR)) {
    const text: string = fs.readFileSync(file, "utf8");

    for (const match of text.matchAll(DEFINITION_NAME)) {
      const written: string = match[1]!;

      defined.push({
        file: path.relative(SERVER_AI_DIR, file),
        written,
        name: written.startsWith('"')
          ? (JSON.parse(written) as string)
          : EXTRA_TOOL_NAME_CONSTANTS[written],
      });
    }
  }

  return defined;
}

function toolboxToolNames(): Array<string> {
  return AIToolbox.getTools().map((tool: ObservabilityTool): string => {
    return tool.name;
  });
}

function extraToolNames(): Array<string> {
  return Array.from(
    new Set(
      definedExtraTools()
        .map((tool: DefinedTool): string | undefined => {
          return tool.name;
        })
        .filter((name: string | undefined): name is string => {
          return Boolean(name);
        }),
    ),
  ).sort();
}

const EVERY_TOOL: Array<string> = Array.from(
  new Set([...toolboxToolNames(), ...extraToolNames()]),
).sort();

function stepLabel(tool: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(friendlyToolNames, tool)
    ? friendlyToolNames[tool]
    : undefined;
}

function evidenceLine(tool: string): string | undefined {
  const known: EvidenceToolDescription | null = getKnownEvidenceTool(tool);

  return known ? known.description : undefined;
}

// The step a run is on while it calls `tool`, as Ask AI's live line says it.
function liveStep(tool: string, translator: Translator): string {
  const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
  event.eventType = AIRunEventType.ToolCallStarted;
  event.toolName = tool;

  return describeLiveActivity([event], translator).text;
}

describe("every tool a run can call is checked", () => {
  test("the toolbox and what a run adds beside it are both read", () => {
    expect(toolboxToolNames().length).toBeGreaterThanOrEqual(60);
    expect(extraToolNames()).toEqual(
      expect.arrayContaining([
        RUN_KUBECTL_TOOL_NAME,
        LIST_CLUSTER_ACCESS_TOOL_NAME,
        RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
        LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
        LIST_MCP_TOOLS_TOOL_NAME,
        CALL_MCP_TOOL_TOOL_NAME,
        ROLL_BACK_CHANGE_TOOL_NAME,
        READ_TOOL_OUTPUT_TOOL_NAME,
        "list_command_targets",
        "execute_remediation_command",
        "propose_remediation_commands",
      ]),
    );
  });

  test("every tool a run adds is named by a string or a constant this suite knows", () => {
    const unresolved: Array<string> = definedExtraTools()
      .filter((tool: DefinedTool): boolean => {
        return !tool.name;
      })
      .map((tool: DefinedTool): string => {
        return `${tool.file}: ${tool.written}`;
      });

    // Add the constant to EXTRA_TOOL_NAME_CONSTANTS.
    expect(unresolved).toEqual([]);
  });
});

describe("every tool says what it does while it runs and what it did once it ran", () => {
  test.each(EVERY_TOOL)("%s has a step label", (tool: string) => {
    expect({ tool, label: stepLabel(tool) }).toEqual({
      tool,
      label: expect.any(String),
    });
  });

  test.each(EVERY_TOOL)("%s has an evidence line", (tool: string) => {
    expect({ tool, line: evidenceLine(tool) }).toEqual({
      tool,
      line: expect.any(String),
    });
  });

  test.each(EVERY_TOOL)(
    "%s is never named by its own name in either",
    (tool: string) => {
      for (const words of [stepLabel(tool), evidenceLine(tool)]) {
        expect(words).toBeDefined();
        expect(words).not.toContain(tool);
        // A tool's name, or any part of one ("query_slos").
        expect(words).not.toContain("_");
      }
    },
  );
});

describe("every step label and evidence line is the Dashboard's English", () => {
  const english: Record<string, string> = readDashboardLocale("en");

  test.each(EVERY_TOOL)(
    "%s's words are keys English holds as themselves",
    (tool: string) => {
      for (const words of [stepLabel(tool)!, evidenceLine(tool)!]) {
        expect({ key: words, english: english[words] }).toEqual({
          key: words,
          english: words,
        });
      }
    },
  );
});

describe.each(DASHBOARD_LANGUAGES)("in %s", (language: string) => {
  const words: Record<string, string> = readDashboardLocale(language);

  test.each(EVERY_TOOL)(
    "%s's step and evidence line are worded",
    (tool: string) => {
      for (const key of [stepLabel(tool)!, evidenceLine(tool)!]) {
        expect({
          key,
          worded: isWordedInDashboardLocale(key, language),
        }).toEqual({ key, worded: true });
        expect(placeholdersOf(words[key]!)).toEqual(placeholdersOf(key));
      }
    },
  );

  test("the live line says each step in the reader's words, never the tool's name", () => {
    const translator: Translator = dashboardTranslator(language);

    for (const tool of EVERY_TOOL) {
      const said: string = liveStep(tool, translator);

      expect({ tool, said }).toEqual({ tool, said: words[stepLabel(tool)!] });
      expect(said).not.toContain(tool);
    }
  });
});

describe("a tool the lists do not know still reads as a step", () => {
  test("named in a sentence, never left blank", () => {
    const translator: Translator = dashboardTranslator("de");

    expect(liveStep("some_new_tool", translator)).toBe(
      translator.translateTemplate("Running {{tool}}", {
        tool: "some_new_tool",
      }),
    );
    expect(evidenceLine("some_new_tool")).toBeUndefined();
  });
});
