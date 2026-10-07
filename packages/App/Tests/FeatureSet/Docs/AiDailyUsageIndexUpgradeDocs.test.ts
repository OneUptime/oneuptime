import {
  UPGRADING_PAGE,
  getHeadings,
  getSection,
  read,
} from "./KubernetesAiAgentDocsSupport";
import {
  LLM_LOG_INDEX_BUILD_LIMITS,
  LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD,
  LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP,
} from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1798300000000-AddLlmLogProjectCreatedAtIndex";
import { describe, expect, it } from "@jest/globals";

/*
 * The upgrade note for the AI Logs index (migration 1798300000000): what it
 * is for, that nothing needs doing, and - for the install whose build could
 * not finish - the statements to run by hand. Those statements and the bounds
 * the note quotes are the migration's own, so the note cannot drift from what
 * the upgrade does or from what its log asks an operator to run.
 */

const THIRTEEN_TO_FOURTEEN_HEADING: string =
  "## Upgrading from OneUptime 13 → 14";
const NOTE_HEADING: string =
  "### The AI Logs get an index for the daily AI limits";
const PREVIOUS_NOTE_HEADING: string = "### AI has no limits by default";
const NEXT_NOTE_HEADING: string =
  "### Fixing new incidents and alerts has a switch of its own";

const SQL_BLOCK: RegExp = /```sql\n([\s\S]*?)\n```/g;
const HELM_TIMEOUT: RegExp = /`--timeout (\d+)m`/;
const WHITESPACE: RegExp = /\s+/g;

const MINUTES_IN_WORDS: Record<number, string> = {
  2: "two",
  15: "fifteen",
};

function note(): string {
  return getSection(read(UPGRADING_PAGE), NOTE_HEADING);
}

function flat(text: string): string {
  return text.replace(WHITESPACE, " ").trim();
}

function minutesInWords(milliseconds: number): string {
  const words: string | undefined = MINUTES_IN_WORDS[milliseconds / 60_000];

  if (!words) {
    throw new Error(`No words for ${milliseconds} ms; add them above`);
  }

  return words;
}

describe("the AI Logs index upgrade note", () => {
  it("sits in the 13 → 14 notes, right after the note on AI limits, once", () => {
    const headings: Array<string> = getHeadings(
      getSection(read(UPGRADING_PAGE), THIRTEEN_TO_FOURTEEN_HEADING),
    );
    const position: number = headings.indexOf(NOTE_HEADING);

    expect(position).toBeGreaterThan(-1);
    expect(headings[position - 1]).toBe(PREVIOUS_NOTE_HEADING);
    expect(headings[position + 1]).toBe(NEXT_NOTE_HEADING);
    expect(
      getHeadings(read(UPGRADING_PAGE)).filter((heading: string): boolean => {
        return heading === NOTE_HEADING;
      }),
    ).toHaveLength(1);
  });

  it("names the limits it serves and where they are set", () => {
    const text: string = flat(note());

    expect(text).toContain(
      "**Project Settings → AI Features → More settings**",
    );
    expect(text).toContain("the incident and alert daily token limits");
    expect(text).toContain("(`LlmLog`)");
  });

  it("says nothing needs doing, and that AI keeps working while it builds", () => {
    const text: string = flat(note());

    expect(text).toContain("Nothing to do");
    expect(text).toContain("`CREATE INDEX CONCURRENTLY`");
    expect(text).toContain("AI calls keep working while it builds");
    expect(text).toContain("the upgrade still completes");
  });

  it("quotes the migration's own bounds", () => {
    const text: string = flat(note());

    expect(text).toContain(
      `waits at most ${minutesInWords(
        LLM_LOG_INDEX_BUILD_LIMITS.lockWaitTimeoutInMs,
      )} minutes behind any one long-running transaction`,
    );
    expect(text).toContain(
      `runs at most ${minutesInWords(
        LLM_LOG_INDEX_BUILD_LIMITS.buildTimeoutInMs,
      )}`,
    );
  });

  it("gives the build the migration runs, to run outside a transaction", () => {
    const blocks: Array<string> = Array.from(note().matchAll(SQL_BLOCK)).map(
      (match: RegExpMatchArray): string => {
        return flat(match[1]!);
      },
    );

    expect(blocks).toEqual([`${LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD};`]);
    expect(flat(note())).toContain("outside a transaction");
  });

  it("gives the drop the migration's log asks for when a copy was left INVALID", () => {
    expect(flat(note())).toContain(
      `\`${LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP};\``,
    );
  });

  it("gives a blocking Helm hook more time than the build may take", () => {
    const timeout: RegExpMatchArray | null = flat(note()).match(HELM_TIMEOUT);

    expect(flat(note())).toContain("`migrate.hook: true`");
    expect(timeout).not.toBeNull();
    // Helm's own default, which a large table's build can outlast.
    expect(flat(note())).toContain("by default for 5 minutes");
    expect(Number(timeout![1]) * 60_000).toBeGreaterThan(
      LLM_LOG_INDEX_BUILD_LIMITS.buildTimeoutInMs +
        LLM_LOG_INDEX_BUILD_LIMITS.lockWaitTimeoutInMs,
    );
  });
});
