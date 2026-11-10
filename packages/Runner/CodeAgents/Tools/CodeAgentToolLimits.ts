/*
 * How much the code agent's tools show the model at once, and how much they
 * keep (issue #6441).
 *
 * A tool's answer re-enters the model's context, so each tool shows a
 * window of what it found - never a silent cut. Whatever a window leaves
 * out, the answer says so and says how to see it: read_file reads a file in
 * line windows (start_line / end_line), and a long tool output (a test run,
 * a big search) is kept on the Runner for the task and read in pages with
 * read_tool_output. The context as a whole is kept in bounds by
 * CodeAgentContext, which drops the oldest results first.
 *
 * Pure numbers, so the tools, their tests and the agent read one place.
 */

// read_file: the lines one window shows when the model names no end.
export const READ_FILE_DEFAULT_LINES: number = 2_000;

/*
 * read_file: the most characters one window shows, about 15,000 tokens. A
 * window stops at a whole line before it, and says where to read on.
 */
export const READ_FILE_MAX_WINDOW_CHARS: number = 60_000;

/*
 * read_file: a line longer than this is cut in a window of many lines (a
 * minified bundle, a generated table), and shown up to the whole window
 * when it is read alone (start_line = end_line).
 */
export const READ_FILE_MAX_LINE_CHARS: number = 2_000;

// read_file and edit_file: a file larger than this is not read into memory.
export const MAX_TEXT_FILE_BYTES: number = 32 * 1024 * 1024;

/*
 * The bytes of a file's start that tell text from binary: a NUL among them
 * makes it binary, as git and grep tell it.
 */
export const BINARY_SNIFF_BYTES: number = 8_000;

// edit_file: the unchanged lines shown around each changed region.
export const EDIT_FILE_CONTEXT_LINES: number = 3;

// edit_file: the most characters its answer shows of the changed regions.
export const EDIT_FILE_MAX_SNIPPET_CHARS: number = 8_000;

// edit_file: the most edits one call may make.
export const EDIT_FILE_MAX_EDITS: number = 50;

// list_directory: how deep it may look, and how many entries it shows.
export const LIST_DIRECTORY_DEFAULT_DEPTH: number = 1;
export const LIST_DIRECTORY_MAX_DEPTH: number = 6;
export const LIST_DIRECTORY_MAX_ENTRIES: number = 2_000;

// search_files: the lines of context it may show around a match.
export const SEARCH_MAX_CONTEXT_LINES: number = 10;

/*
 * How long one of the file-finding commands (git grep, git ls-files) or a
 * read-only git command may take before it is stopped.
 */
export const GIT_READ_TIMEOUT_MS: number = 60 * 1000;

// The most output a read-only git command may produce before it is stopped.
export const GIT_READ_MAX_OUTPUT_BYTES: number = 64 * 1024 * 1024;

/*
 * The most a search keeps of what it found: far past what anyone reads, and
 * the answer then says to narrow it.
 */
export const SEARCH_MAX_OUTPUT_BYTES: number = 16 * 1024 * 1024;

/*
 * A tool output up to this many characters is shown whole. A longer one is
 * kept on the Runner (ToolOutputStore) and shown in part, with the id that
 * reads the rest.
 */
export const TOOL_OUTPUT_INLINE_CHARS: number = 30_000;

/*
 * A long command output is shown as its start and its end - a build's or a
 * test run's failures and summary are at its end - and the middle is read
 * with read_tool_output.
 */
export const TOOL_OUTPUT_HEAD_CHARS: number = 6_000;
export const TOOL_OUTPUT_TAIL_CHARS: number = 24_000;

// read_tool_output: the lines one page shows when the model names no end.
export const TOOL_OUTPUT_PAGE_LINES: number = 500;

// read_tool_output with a pattern: the most matching lines it shows.
export const TOOL_OUTPUT_MAX_PATTERN_MATCHES: number = 400;

/*
 * The tool outputs a task keeps for read_tool_output, all told: past it the
 * oldest are let go, and reading one says so.
 */
export const TOOL_OUTPUT_STORE_MAX_CHARS: number = 40_000_000;

/*
 * The output of one command the agent keeps: the first part and the last.
 * A command that prints more loses its middle, and the answer says how much.
 */
export const COMMAND_OUTPUT_KEEP_START_CHARS: number = 1_000_000;
export const COMMAND_OUTPUT_KEEP_END_CHARS: number = 9_000_000;

// update_plan: the most steps a plan holds, and the longest a step may be.
export const PLAN_MAX_STEPS: number = 40;
export const PLAN_MAX_STEP_LENGTH: number = 400;
