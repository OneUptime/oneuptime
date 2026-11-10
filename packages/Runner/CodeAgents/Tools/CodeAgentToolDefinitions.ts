import { CODE_AGENT_COMMAND_TOOL_NAME } from "Common/Types/Runner/GlobalRunnerWork";
import { LLMToolDefinition } from "Common/Server/Utils/LLM/LLMService";
import {
  AGENT_COMMAND_TIMEOUT_ARGUMENT,
  DEFAULT_AGENT_COMMAND_TIMEOUT_SECONDS,
  MAX_AGENT_COMMAND_TIMEOUT_SECONDS,
} from "../../Utils/AgentCommandLimits";
import { UPDATE_PLAN_TOOL_NAME } from "./AgentPlan";
import {
  LIST_DIRECTORY_MAX_DEPTH,
  READ_FILE_DEFAULT_LINES,
  READ_FILE_MAX_LINE_CHARS,
  SEARCH_MAX_CONTEXT_LINES,
} from "./CodeAgentToolLimits";
import { EDIT_FILE_TOOL_NAME } from "./FileEditTool";
import { DELETE_FILE_TOOL_NAME, MOVE_FILE_TOOL_NAME } from "./FileChangeTools";
import { GIT_TOOL_ACTIONS, GIT_TOOL_NAME } from "./GitTool";
import { FIND_FILES_TOOL_NAME } from "./RepositorySearchTools";
import { READ_TOOL_OUTPUT_TOOL_NAME } from "./ToolOutputStore";

/*
 * The tools that run on the Runner, in the repository, by name: a tool the
 * server offers (production telemetry) never takes one of these names.
 */
export const RUNNER_TOOL_NAMES: ReadonlyArray<string> = [
  "read_file",
  EDIT_FILE_TOOL_NAME,
  "write_file",
  DELETE_FILE_TOOL_NAME,
  MOVE_FILE_TOOL_NAME,
  "list_directory",
  FIND_FILES_TOOL_NAME,
  "search_files",
  GIT_TOOL_NAME,
  READ_TOOL_OUTPUT_TOOL_NAME,
  UPDATE_PLAN_TOOL_NAME,
  CODE_AGENT_COMMAND_TOOL_NAME,
];

const PATH_PROPERTY: { type: string; description: string } = {
  type: "string",
  description: "Path relative to the repository root",
};

/*
 * The definitions of the workspace tools (issue #6441), as the model reads
 * them with every call: what each does, and what each argument means.
 * run_command is not among them: the agent offers it only on a Runner that
 * runs project-authored commands (buildRunCommandToolDefinition).
 */
export function buildWorkspaceToolDefinitions(): Array<LLMToolDefinition> {
  return [
    {
      name: "read_file",
      description: `Read a text file of the repository as numbered lines: each line starts with its number and a tab, which are not part of the file. Reads up to ${READ_FILE_DEFAULT_LINES.toLocaleString(
        "en-US",
      )} lines at a time; read a longer file in windows with start_line and end_line - every partial read says which lines it showed and where to read on. A line longer than ${READ_FILE_MAX_LINE_CHARS.toLocaleString(
        "en-US",
      )} characters is cut unless it is read alone.`,
      inputSchema: {
        type: "object",
        properties: {
          path: PATH_PROPERTY,
          start_line: {
            type: "integer",
            description: "The first line to read, counted from 1 (default 1)",
          },
          end_line: {
            type: "integer",
            description: `The last line to read (default: ${READ_FILE_DEFAULT_LINES.toLocaleString(
              "en-US",
            )} lines from start_line)`,
          },
        },
        required: ["path"],
      },
    },
    {
      name: EDIT_FILE_TOOL_NAME,
      description:
        "Change an existing file by replacing exact text. old_text must be in the file exactly as written - whitespace and indentation included, without read_file's line numbers - and only once, unless replace_all is set: include enough surrounding lines to make it unique. Several changes to one file go in edits and apply in order, all or none. Use it for every change to an existing file. Returns the changed lines as they now read.",
      inputSchema: {
        type: "object",
        properties: {
          path: PATH_PROPERTY,
          old_text: {
            type: "string",
            description: "The exact text to replace",
          },
          new_text: {
            type: "string",
            description: "What old_text becomes (an empty string removes it)",
          },
          replace_all: {
            type: "boolean",
            description:
              "Replace every place old_text is, rather than the one place it must be",
          },
          edits: {
            type: "array",
            description:
              "Several edits to this file, applied in order, in place of old_text and new_text",
            items: {
              type: "object",
              properties: {
                old_text: { type: "string" },
                new_text: { type: "string" },
                replace_all: { type: "boolean" },
              },
              required: ["old_text", "new_text"],
            },
          },
        },
        required: ["path"],
      },
    },
    {
      name: "write_file",
      description:
        "Create a new file (and its folders), or replace the whole of a file you have read in this task. To change part of an existing file, use edit_file.",
      inputSchema: {
        type: "object",
        properties: {
          path: PATH_PROPERTY,
          content: {
            type: "string",
            description: "The full content of the file",
          },
        },
        required: ["path", "content"],
      },
    },
    {
      name: DELETE_FILE_TOOL_NAME,
      description: "Delete one file of the repository.",
      inputSchema: {
        type: "object",
        properties: { path: PATH_PROPERTY },
        required: ["path"],
      },
    },
    {
      name: MOVE_FILE_TOOL_NAME,
      description:
        "Move or rename one file of the repository; the folders of its new path are created.",
      inputSchema: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description: "The file's path now, relative to the repository root",
          },
          to: {
            type: "string",
            description: "Its new path, relative to the repository root",
          },
        },
        required: ["from", "to"],
      },
    },
    {
      name: "list_directory",
      description: `List a folder of the repository; folders end with '/'. With depth (1 to ${LIST_DIRECTORY_MAX_DEPTH}, default 1) it lists the folders inside it too, indented, skipping .git and the folders .gitignore leaves out.`,
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Folder path relative to the repository root (default: the root)",
          },
          depth: {
            type: "integer",
            description: "How many levels of folders to list (default 1)",
          },
        },
      },
    },
    {
      name: FIND_FILES_TOOL_NAME,
      description:
        "Find files by name or path: a glob such as **/*.test.ts or src/**/user*.{ts,tsx} (without a '/', it matches file names anywhere), or plain text that is part of the path. Lists tracked and new files, never ones .gitignore leaves out (node_modules, build output).",
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "A glob, or text that is part of the path",
          },
          path: {
            type: "string",
            description: "A folder to look in (default: the whole repository)",
          },
        },
        required: ["pattern"],
      },
    },
    {
      name: "search_files",
      description:
        "Search the contents of the repository's files - tracked and new, never ones .gitignore leaves out - for a regular expression (Perl syntax), or for plain text with literal. Returns path:line:text for each matching line, or with files_only just the paths.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description:
              "The regular expression, or with literal the text, to find",
          },
          path: {
            type: "string",
            description:
              "A file or folder, relative to the repository root, to search in",
          },
          glob: {
            type: "string",
            description:
              "Only files whose name (or, with a '/', path) matches, such as *.ts or src/**/*.py",
          },
          literal: {
            type: "boolean",
            description: "Search for the pattern as plain text",
          },
          case_insensitive: {
            type: "boolean",
            description: "Ignore case",
          },
          context_lines: {
            type: "integer",
            description: `Lines to show before and after each match (0 to ${SEARCH_MAX_CONTEXT_LINES})`,
          },
          files_only: {
            type: "boolean",
            description: "Return only the paths of the files that match",
          },
        },
        required: ["pattern"],
      },
    },
    {
      name: GIT_TOOL_NAME,
      description:
        "Read-only git. status: what has changed in the working tree. diff: your changes against HEAD (or a revision), with the new files listed. log: commits, newest first. show: a commit, or a file as it was (revision HEAD~1:path). blame: who last changed each line of a file. The pipeline commits, branches and pushes your change; you never do.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [...GIT_TOOL_ACTIONS],
            description: "What to read",
          },
          path: {
            type: "string",
            description:
              "A file or folder to limit it to (blame: the file, required)",
          },
          revision: {
            type: "string",
            description:
              "A commit, branch or tag, HEAD~3, a range like main..HEAD, or HEAD:path for show",
          },
          stat: {
            type: "boolean",
            description:
              "diff, log, show: only which files changed, and how much",
          },
          max_count: {
            type: "integer",
            description: "log: how many commits (default 20, at most 200)",
          },
          patch: {
            type: "boolean",
            description: "log: each commit's changes too",
          },
          start_line: {
            type: "integer",
            description: "blame: the first line",
          },
          end_line: {
            type: "integer",
            description: "blame: the last line",
          },
        },
        required: ["action"],
      },
    },
    {
      name: READ_TOOL_OUTPUT_TOOL_NAME,
      description:
        "Read the part of a long tool output that was left out of what you were shown (a test run's middle, the rest of a search): by its output_id and line numbers, or every line of it that holds a text (pattern, case ignored).",
      inputSchema: {
        type: "object",
        properties: {
          output_id: {
            type: "string",
            description: "The id the shortened output gave, such as out-3",
          },
          start_line: {
            type: "integer",
            description: "The first line to read, counted from 1",
          },
          end_line: {
            type: "integer",
            description: "The last line to read",
          },
          pattern: {
            type: "string",
            description:
              "Instead of lines: show every line that holds this text",
          },
        },
        required: ["output_id"],
      },
    },
    {
      name: UPDATE_PLAN_TOOL_NAME,
      description:
        "Keep a plan for a task of several steps: send the whole plan each time it changes, with the step you are working on in_progress (one at most). In a long task, the plan stays in front of you when the oldest turns are left out.",
      inputSchema: {
        type: "object",
        properties: {
          plan: {
            type: "array",
            description: "The steps, in order",
            items: {
              type: "object",
              properties: {
                step: { type: "string" },
                status: {
                  type: "string",
                  enum: ["pending", "in_progress", "done"],
                },
              },
              required: ["step", "status"],
            },
          },
        },
        required: ["plan"],
      },
    },
  ];
}

/*
 * run_command: offered only on a Runner that runs project-authored commands
 * (a project's own Runner). A global Runner never offers it, and refuses it
 * when a model sends it anyway (InHouseCodeAgent.toolRunCommand).
 */
export function buildRunCommandToolDefinition(): LLMToolDefinition {
  return {
    name: CODE_AGENT_COMMAND_TOOL_NAME,
    description: `Run a shell command in the repository root. It stops after ${DEFAULT_AGENT_COMMAND_TIMEOUT_SECONDS} seconds unless ${AGENT_COMMAND_TIMEOUT_ARGUMENT} gives it longer. Returns the exit code and the combined output; a long output shows its start and its end, and read_tool_output reads the rest.`,
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to run",
        },
        [AGENT_COMMAND_TIMEOUT_ARGUMENT]: {
          type: "integer",
          description: `How long the command may run, in seconds: ${DEFAULT_AGENT_COMMAND_TIMEOUT_SECONDS} when left out, at most ${MAX_AGENT_COMMAND_TIMEOUT_SECONDS}. Give more only to a slow install, build or test suite.`,
        },
      },
      required: ["command"],
    },
  };
}
